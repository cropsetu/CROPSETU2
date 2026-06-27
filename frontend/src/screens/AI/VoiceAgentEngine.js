/**
 * VoiceAgentEngine — reusable "Hey Krushi" voice-form engine (domain-agnostic).
 *
 * This is the ONE place the hard parts live: expo-av recording with silence
 * endpointing, base64-WAV playback, the hands-free multi-turn loop, the live
 * draft panel, and the spoken read-back + "say yes to save" confirmation. Each
 * feature (MyFarm, animal posting, rental, …) wraps this with a thin screen that
 * supplies a `domain`, an `onSave(draft)` mapper, and an optional `renderDraft`.
 *
 * Turn loop:
 *   tap/auto → record (auto-stop on ~1.8s silence) → POST /ai/voice-agent/turn
 *   → play the assistant's spoken line → if it asked something, re-open the mic
 *   automatically; if everything's captured it reads back and waits for "yes";
 *   on "yes" it calls onSave(draft) and closes.
 *
 * Props:
 *   domain       {string}   required — voice-agent domain key (e.g. 'farm')
 *   title        {string}   header title
 *   subtitle     {string}   header subtitle / hint
 *   context      {object}   optional domain context (e.g. { farmId } for edits)
 *   onSave       {(draft)=>Promise<void>} persists the confirmed draft
 *   renderDraft  {(draft, missing)=>ReactNode} optional custom draft panel
 *   onClose      {()=>void} pop the screen
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, Dimensions,
  StatusBar, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Mic, Square as SquareIcon, X as CloseIcon, Check } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Audio } from 'expo-av';
import { sendVoiceAgentTurn, cancelVoiceAgentSession } from '../../services/aiApi';
import { useLanguage } from '../../context/LanguageContext';

const { width: W } = Dimensions.get('window');

// Recording safety limits (match VoiceChatScreen — tuned for rural networks).
const MAX_REC_MS = 60_000;
const MIN_REC_MS = 500;
const SILENCE_DB = -45;
const SILENCE_MS = 1_800;

// Short code → Sarvam BCP-47 (mirrors VoiceChatScreen LANG_MAP).
const LANG_MAP = {
  en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', ta: 'ta-IN', te: 'te-IN',
  kn: 'kn-IN', gu: 'gu-IN', pa: 'pa-IN', bn: 'bn-IN', ml: 'ml-IN', or: 'or-IN',
};

function humanReadableVoiceError(err, fallback = 'Could not process. Please try again.') {
  const status = err?.response?.status ?? err?.status;
  const serverMsg = err?.response?.data?.error?.message;
  if (status === 429) return 'Too many requests — please wait a moment and try again.';
  if (status === 402) return 'You’ve used all your AI credits for this month. They refill on the 1st.';
  if (status === 503 || status === 500 || status === 502 || status === 504)
    return 'The voice service is temporarily down. Please try again in a moment.';
  if (status === 413) return 'That recording was too long. Please keep it shorter.';
  if (status === 401) return 'Session expired. Please log in again.';
  if (err?.message === 'Network Error' || err?.code === 'ERR_NETWORK')
    return 'No internet — check your connection and try again.';
  return serverMsg || fallback;
}

// Default draft panel — flattens non-empty scalar fields into labelled chips so a
// brand-new domain renders something useful with zero extra code.
function prettyLabel(k) {
  return k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace(/\bAcres\b/, '(acres)').trim();
}
function flattenDraft(obj, prefix = '', out = []) {
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === '') return;
    if (Array.isArray(v)) { if (v.length) out.push([k, v.join(', ')]); return; }
    if (typeof v === 'object') { flattenDraft(v, prefix, out); return; }
    out.push([k, String(v)]);
  });
  return out;
}
function DefaultDraftPanel({ draft }) {
  const rows = flattenDraft(draft);
  if (!rows.length) return null;
  return (
    <View style={styles.chipsWrap}>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.chip}>
          <Text style={styles.chipKey}>{prettyLabel(k)}</Text>
          <Text style={styles.chipVal} numberOfLines={1}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

export default function VoiceAgentEngine({
  domain,
  title = 'Krushi Assistant',
  subtitle = '',
  context = null,
  onSave,
  renderDraft,
  onClose,
}) {
  const insets = useSafeAreaInsets();
  const { language, t } = useLanguage();
  const sarvamLang = LANG_MAP[language] || 'hi-IN';

  // phase: idle | recording | processing | speaking | saving | done | cancelled | error
  const [phase, setPhase] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [speakText, setSpeakText] = useState('');
  const [draft, setDraft] = useState({});
  const [missing, setMissing] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);

  const recordRef = useRef(null);
  const soundRef = useRef(null);
  const sessionIdRef = useRef(null);
  const recStartAtRef = useRef(0);
  const silenceStartRef = useRef(null);
  const maxTimerRef = useRef(null);
  const lockRef = useRef(false);
  const aliveRef = useRef(true);
  const finishedRef = useRef(false); // true once saved/cancelled — stops the loop
  const startRecordingRef = useRef(null); // always-latest startRecording for the hands-free loop

  const orbScale = useRef(new Animated.Value(1)).current;

  // ── Cleanup helpers ─────────────────────────────────────────────────────────
  const teardownRecording = useCallback(async () => {
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
    silenceStartRef.current = null;
    if (recordRef.current) {
      try { await recordRef.current.stopAndUnloadAsync(); } catch { /* ignore */ }
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch { /* ignore */ }
      recordRef.current = null;
    }
  }, []);

  const teardownSound = useCallback(async () => {
    if (soundRef.current) {
      try { await soundRef.current.unloadAsync(); } catch { /* ignore */ }
      soundRef.current = null;
    }
  }, []);

  useFocusEffect(useCallback(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      teardownRecording();
      teardownSound();
      // Leaving mid-conversation without saving → drop the server session.
      if (!finishedRef.current && sessionIdRef.current) {
        cancelVoiceAgentSession(sessionIdRef.current);
      }
    };
  }, [teardownRecording, teardownSound]));

  // Orb pulse while recording / speaking.
  useEffect(() => {
    let anim;
    if (phase === 'recording') {
      orbScale.setValue(1 + audioLevel * 0.25);
    } else if (phase === 'speaking' || phase === 'processing' || phase === 'saving') {
      anim = Animated.loop(Animated.sequence([
        Animated.timing(orbScale, { toValue: 1.12, duration: 700, useNativeDriver: true }),
        Animated.timing(orbScale, { toValue: 1.0, duration: 700, useNativeDriver: true }),
      ]));
      anim.start();
    } else {
      orbScale.setValue(1);
    }
    return () => { if (anim) anim.stop(); };
  }, [phase, audioLevel, orbScale]);

  // ── Playback ────────────────────────────────────────────────────────────────
  const playBase64 = useCallback(async (base64, mimeType = 'audio/wav') => {
    await teardownSound();
    return new Promise(async (resolve) => {
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, shouldDuckAndroid: true });
        const uri = `data:${mimeType};base64,${base64}`;
        const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((st) => {
          if (st.didJustFinish || st.error) {
            try { sound.unloadAsync(); } catch { /* ignore */ }
            if (soundRef.current === sound) soundRef.current = null;
            resolve();
          }
        });
      } catch { resolve(); }
    });
  }, [teardownSound]);

  // ── Save the confirmed draft ──────────────────────────────────────────────
  const doSave = useCallback(async (finalDraft) => {
    setPhase('saving');
    try {
      if (onSave) await onSave(finalDraft);
      finishedRef.current = true;
      setPhase('done');
      // Give the "saved" spoken line a beat to finish, then close.
      setTimeout(() => { if (aliveRef.current && onClose) onClose(); }, 1400);
    } catch (e) {
      setErrorMsg(humanReadableVoiceError(e, 'Could not save. Please try again.'));
      setPhase('error');
    }
  }, [onSave, onClose]);

  // After the assistant's spoken line finishes, decide what happens next.
  const handleAfterSpeak = useCallback((nextAction, readyToSave, finalDraft) => {
    if (!aliveRef.current) return;
    if (nextAction === 'save' && readyToSave) { doSave(finalDraft); return; }
    if (nextAction === 'cancelled') {
      finishedRef.current = true;
      setPhase('cancelled');
      setTimeout(() => { if (aliveRef.current && onClose) onClose(); }, 1400);
      return;
    }
    // ask / readback → re-open the mic for the next answer (hands-free).
    setPhase('idle');
    setTimeout(() => {
      if (aliveRef.current && !finishedRef.current && startRecordingRef.current) startRecordingRef.current();
    }, 350);
  }, [doSave, onClose]);

  // ── Send one turn ─────────────────────────────────────────────────────────
  const stopAndSend = useCallback(async () => {
    if (!recordRef.current) return;
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
    const elapsed = recStartAtRef.current ? Date.now() - recStartAtRef.current : 0;

    if (elapsed < MIN_REC_MS) {
      await teardownRecording();
      setPhase('idle'); setAudioLevel(0);
      return;
    }

    setAudioLevel(0);
    setPhase('processing');
    silenceStartRef.current = null;

    let uri;
    try {
      await recordRef.current.stopAndUnloadAsync();
      uri = recordRef.current.getURI();
      recordRef.current = null;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch (e) {
      await teardownRecording();
      setErrorMsg(humanReadableVoiceError(e));
      setPhase('error');
      return;
    }

    try {
      const result = await sendVoiceAgentTurn(uri, {
        domain, language: sarvamLang, sessionId: sessionIdRef.current, context,
      });
      if (!aliveRef.current) return;

      if (result.sessionId) sessionIdRef.current = result.sessionId;
      setTranscript((result.transcription || '').trim());
      setSpeakText(result.speak || '');
      if (result.draft) setDraft(result.draft);
      setMissing(Array.isArray(result.missingRequired) ? result.missingRequired : []);

      const next = result.nextAction || 'ask';
      const ready = !!result.readyToSave;
      const finalDraft = result.draft || draft;

      if (result.audio?.audio) {
        setPhase('speaking');
        await playBase64(result.audio.audio, result.audio.mimeType || 'audio/wav');
      }
      handleAfterSpeak(next, ready, finalDraft);
    } catch (err) {
      if (!aliveRef.current) return;
      setErrorMsg(humanReadableVoiceError(err));
      setPhase('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, sarvamLang, context, draft, playBase64, handleAfterSpeak, teardownRecording]);

  // ── Start recording ───────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (lockRef.current || finishedRef.current) return;
    if (phase === 'recording' || phase === 'processing' || phase === 'speaking' || phase === 'saving') return;
    lockRef.current = true;
    setErrorMsg('');
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('aiChat.micPermTitle', 'Microphone needed'), t('aiChat.micPermMsg', 'Please allow microphone access to use voice.'));
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true, playsInSilentModeIOS: true,
        staysActiveInBackground: false, shouldDuckAndroid: true,
      });
      const { recording } = await Audio.Recording.createAsync({
        isMeteringEnabled: true,
        android: { extension: '.m4a', outputFormat: 2, audioEncoder: 3, sampleRate: 16000, numberOfChannels: 1, bitRate: 32000 },
        ios: { extension: '.m4a', outputFormat: 'aac ', audioQuality: 0x60, sampleRate: 16000, numberOfChannels: 1, bitRate: 32000 },
        web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
      });
      recordRef.current = recording;
      recStartAtRef.current = Date.now();
      silenceStartRef.current = null;
      setPhase('recording');

      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      maxTimerRef.current = setTimeout(() => { if (recordRef.current) stopAndSend(); }, MAX_REC_MS);

      recording.setOnRecordingStatusUpdate((st) => {
        if (st?.isDoneRecording) return;
        if (st && st.canRecord === false && !st.isRecording) { silenceStartRef.current = null; teardownRecording(); setPhase('idle'); return; }
        if (!st.isRecording || st.metering == null) return;
        setAudioLevel(Math.max(0, Math.min(1, (st.metering + 50) / 50)));
        const now = Date.now();
        if (st.metering < SILENCE_DB) {
          if (silenceStartRef.current == null) silenceStartRef.current = now;
          else if (now - silenceStartRef.current > SILENCE_MS) { silenceStartRef.current = null; stopAndSend(); }
        } else {
          silenceStartRef.current = null;
        }
      });
    } catch (err) {
      Alert.alert(t('aiChat.recErrorTitle', 'Recording error'), err?.message || 'Could not start microphone.');
    } finally {
      lockRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stopAndSend, teardownRecording, t]);

  // Keep the ref pointing at the latest startRecording so the hands-free
  // auto-restart (in handleAfterSpeak's setTimeout) never calls a stale closure.
  useEffect(() => { startRecordingRef.current = startRecording; }, [startRecording]);

  const handleClose = useCallback(async () => {
    finishedRef.current = true;
    await teardownRecording();
    await teardownSound();
    if (sessionIdRef.current) cancelVoiceAgentSession(sessionIdRef.current);
    if (onClose) onClose();
  }, [teardownRecording, teardownSound, onClose]);

  // ── UI ────────────────────────────────────────────────────────────────────
  const statusLabel = {
    idle:       t('voiceAgent.tapToSpeak', 'Tap the mic and speak'),
    recording:  t('voiceAgent.listening', 'Listening…'),
    processing: t('voiceAgent.thinking', 'Thinking…'),
    speaking:   t('voiceAgent.speaking', 'Speaking…'),
    saving:     t('voiceAgent.saving', 'Saving…'),
    done:       t('voiceAgent.saved', 'Saved!'),
    cancelled:  t('voiceAgent.cancelled', 'Cancelled'),
    error:      t('voiceAgent.error', 'Something went wrong'),
  }[phase] || '';

  const isBusy = phase === 'processing' || phase === 'speaking' || phase === 'saving';
  const draftNode = renderDraft ? renderDraft(draft, missing) : <DefaultDraftPanel draft={draft} />;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <LinearGradient colors={['#0B1F12', '#0E2A18', '#0A1A10']} style={StyleSheet.absoluteFill} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>
        <TouchableOpacity onPress={handleClose} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <CloseIcon size={22} color="#CFE8D6" />
        </TouchableOpacity>
      </View>

      {/* Orb + status */}
      <View style={styles.orbWrap}>
        <Animated.View style={[styles.orb, { transform: [{ scale: orbScale }] }]}>
          <LinearGradient colors={['#34D399', '#10B981', '#0EA5E9']} style={styles.orbInner}>
            {phase === 'done'
              ? <Check size={40} color="#fff" />
              : isBusy
                ? <ActivityIndicator color="#fff" size="large" />
                : <Mic size={40} color="#fff" />}
          </LinearGradient>
        </Animated.View>
        <Text style={styles.status}>{statusLabel}</Text>
      </View>

      {/* Spoken line + transcript */}
      <View style={styles.speechBox}>
        {!!speakText && <Text style={styles.speak}>{speakText}</Text>}
        {!!transcript && <Text style={styles.transcript}>“{transcript}”</Text>}
        {!!errorMsg && <Text style={styles.error}>{errorMsg}</Text>}
      </View>

      {/* Captured draft */}
      <ScrollView style={styles.draftScroll} contentContainerStyle={{ paddingBottom: 16 }}>
        {draftNode}
      </ScrollView>

      {/* Controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 18 }]}>
        {phase === 'recording' ? (
          <TouchableOpacity style={[styles.bigBtn, styles.stopBtn]} onPress={stopAndSend}>
            <SquareIcon size={26} color="#fff" fill="#fff" />
            <Text style={styles.bigBtnLabel}>{t('voiceAgent.stop', 'Stop')}</Text>
          </TouchableOpacity>
        ) : (phase === 'idle' || phase === 'error') ? (
          <TouchableOpacity style={[styles.bigBtn, styles.micBtn]} onPress={startRecording}>
            <Mic size={26} color="#fff" />
            <Text style={styles.bigBtnLabel}>
              {phase === 'error' ? t('voiceAgent.retry', 'Try again') : t('voiceAgent.speak', 'Speak')}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.bigBtn, styles.micBtnDisabled]}>
            <Text style={styles.bigBtnLabel}>{statusLabel}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B1F12' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 10 },
  title: { color: '#F4FFF7', fontSize: 20, fontWeight: '800' },
  subtitle: { color: '#9FC6AC', fontSize: 13, marginTop: 2 },
  closeBtn: { padding: 6 },
  orbWrap: { alignItems: 'center', marginTop: 14, marginBottom: 6 },
  orb: { width: 150, height: 150, borderRadius: 75, alignItems: 'center', justifyContent: 'center' },
  orbInner: { width: 150, height: 150, borderRadius: 75, alignItems: 'center', justifyContent: 'center' },
  status: { color: '#BFE6CC', fontSize: 15, marginTop: 16, fontWeight: '600' },
  speechBox: { paddingHorizontal: 22, marginTop: 8, minHeight: 60 },
  speak: { color: '#FFFFFF', fontSize: 17, lineHeight: 24, textAlign: 'center', fontWeight: '600' },
  transcript: { color: '#9FC6AC', fontSize: 14, fontStyle: 'italic', textAlign: 'center', marginTop: 10 },
  error: { color: '#FCA5A5', fontSize: 14, textAlign: 'center', marginTop: 10 },
  draftScroll: { flex: 1, marginTop: 12, paddingHorizontal: 18 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  chip: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(52,211,153,0.25)', maxWidth: W - 60 },
  chipKey: { color: '#7FB893', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  chipVal: { color: '#EAFBEF', fontSize: 15, fontWeight: '600', marginTop: 2 },
  controls: { paddingHorizontal: 24, paddingTop: 8 },
  bigBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 60, borderRadius: 30 },
  micBtn: { backgroundColor: '#10B981' },
  micBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.08)' },
  stopBtn: { backgroundColor: '#EF4444' },
  bigBtnLabel: { color: '#fff', fontSize: 17, fontWeight: '800' },
});

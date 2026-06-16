import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Animated,
  ActivityIndicator, StatusBar, Dimensions, Alert, Easing, Image,
} from 'react-native';
import {
  Sprout, Mic, Send, Plus, Menu, PenSquare, Paperclip,
  Leaf, ChevronDown, ChevronUp, ChevronRight, Check, X as CloseIcon,
  MessageSquare, ScanLine, History as HistoryIcon,
  ShieldCheck, ShoppingCart, Lightbulb, ToggleLeft, ToggleRight,
  Volume2, Square as SquareIcon, Loader2, Trash2, Copy,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import {
  sendChatMessage, sendVoiceMessage, textToSpeech,
  getConversationMessages, getConversations,
  deleteConversation,
} from '../../services/aiApi';
import { useFarm } from '../../context/FarmContext';
import { useMultiFarm } from '../../context/MultiFarmContext';
import { useLanguage } from '../../context/LanguageContext';
import { COLORS } from '../../constants/colors';
import { SoundEffects } from '../../utils/sounds';
import AnimatedScreen from '../../components/ui/AnimatedScreen';
import VoiceWaveform from './components/VoiceWaveform';
import LanguageSelector from './components/LanguageSelector';
import ResponseLengthSelector from './components/ResponseLengthSelector';
import * as ImagePicker from 'expo-image-picker';
import { compressImage } from '../../utils/mediaCompressor';
import { detectLanguage } from '../../utils/languageDetect';

const { width: W } = Dimensions.get('window');

// ─── Lovable cosmic-chat-companion theme tokens (OKLCH → hex) ─────────────────
const BG       = '#050D08';                    // deep cosmic background
const PRIMARY  = '#22C55E';                    // leaf green (--primary / --leaf)
const P_LIGHT  = '#4ADE80';                    // lighter leaf
const ACCENT   = '#F5B841';                    // harvest gold (--accent / --harvest)
const BORDER   = 'rgba(255,255,255,0.1)';
const SURFACE  = 'rgba(255,255,255,0.05)';
const TEXT     = '#F0FDF4';                    // light foreground
const TEXT2    = 'rgba(255,255,255,0.75)';
const MUTED    = 'rgba(255,255,255,0.55)';
const USER_A   = '#22C55E';                    // gradient-bubble-user start (leaf)
const USER_B   = '#16A373';                    // gradient-bubble-user end  (muted teal-green)
const DANGER   = '#EF4444';

const INTER_REG = 'Inter_400Regular';
const INTER_SEMI = 'Inter_600SemiBold';
const INTER_BOLD = 'Inter_700Bold';
const INTER_EXTRA = 'Inter_800ExtraBold';

// ── Recording safety limits ──────────────────────────────────────────────────
// 60s hard cap so a mic left open (or forgotten in-pocket) never runs forever.
// 500ms min so a stray tap doesn't POST a near-empty audio blob that Sarvam
// would reject as unintelligible.
const MAX_REC_MS = 60_000;
const MIN_REC_MS = 500;

// Human-readable error mapping for API failures. Keeps bubble text short and
// actionable in whatever language the UI is showing.
function humanReadableError(err, fallback = 'Something went wrong. Please try again.') {
  const status = err?.response?.status ?? err?.status;
  const serverMsg = err?.response?.data?.error?.message;
  if (status === 429) return 'Too many requests — please wait 30 seconds and try again.';
  if (status === 402) return 'You’ve used all your AI credits for this month. They refill on the 1st — check your balance in the AI home screen.';
  if (status === 503 || status === 500 || status === 502 || status === 504)
    return 'The AI service is temporarily down. Please try again in a moment.';
  if (status === 413) return 'That was too large. Please try a shorter message or smaller photo.';
  if (status === 401) return 'Session expired. Please log in again.';
  if (err?.message === 'Network Error' || err?.code === 'ERR_NETWORK')
    return 'No internet — check your connection and try again.';
  return serverMsg || fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Header: logo badge + title + LanguageSelector  (direct port of Lovable)
// ─────────────────────────────────────────────────────────────────────────────
function ChatHeader({ insets, onMenuPress, onNewChatPress }) {
  const { t } = useLanguage();
  return (
    <BlurView intensity={30} tint="dark" style={[H.wrap, { paddingTop: insets.top + 10 }]}>
      <View style={H.row}>
        <TouchableOpacity onPress={onMenuPress} style={H.iconBtn} activeOpacity={0.7}>
          <Menu size={22} color={TEXT} strokeWidth={2.2} />
        </TouchableOpacity>

        <View style={H.brand}>
          <LinearGradient
            colors={[PRIMARY, ACCENT, ACCENT]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={H.logoBadge}
          >
            <Sprout size={16} color={BG} strokeWidth={2.6} />
          </LinearGradient>
          <View style={H.brandText}>
            <Text style={H.title} numberOfLines={1}>{t('aiBrand.gyaan', 'Krushi Gyaan')}</Text>
            <Text style={H.sub} numberOfLines={1}>{t('aiChat.assistantSubtitle', "Farmer's assistant")}</Text>
          </View>
        </View>

        <LanguageSelector />

        <TouchableOpacity onPress={onNewChatPress} style={H.iconBtn} activeOpacity={0.7}>
          <PenSquare size={18} color={TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
      </View>
    </BlurView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Chat sub-components
// ─────────────────────────────────────────────────────────────────────────────

function TypingDots() {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    Animated.parallel(dots.map((d, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 150),
        Animated.timing(d, { toValue: 1, duration: 350, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(d, { toValue: 0, duration: 350, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]))
    )).start();
  }, []);
  return (
    <View style={S.dotsRow}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={[S.dot, { opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }), transform: [{ scale: d.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] }) }] }]} />
      ))}
    </View>
  );
}

function DiagnosisCard({ data, onBuyMedicine }) {
  const sevColor = { low: PRIMARY, moderate: ACCENT, high: DANGER, critical: '#B91C1C' }[data.severity] || MUTED;
  const steps = Array.isArray(data.treatment)
    ? data.treatment
    : data.treatment && typeof data.treatment === 'object'
      ? Object.entries(data.treatment).filter(([, v]) => v).map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`)
      : [];
  const note = data.prevention || data.expectedRecovery || data.additionalNotes || '';
  return (
    <View style={S.diagCard}>
      <View style={S.diagHeader}>
        <View style={[S.diagSevDot, { backgroundColor: sevColor }]} />
        <Text style={S.diagName}>{data.disease || data.name}</Text>
        <View style={[S.diagConf, { backgroundColor: `${sevColor}18` }]}>
          <Text style={[S.diagConfText, { color: sevColor }]}>{data.confidence}% match</Text>
        </View>
      </View>
      <View style={S.diagMeta}><Leaf size={12} color={MUTED} strokeWidth={2.2} /><Text style={S.diagMetaText}>{data.crop ? `${data.crop} · ` : ''}{data.severity}</Text></View>
      <View style={S.diagDivider} />
      <Text style={S.diagSectionLabel}>Treatment Plan</Text>
      {steps.map((step, i) => (
        <View key={i} style={S.diagStep}>
          <View style={S.diagStepNum}><Text style={S.diagStepNumText}>{i + 1}</Text></View>
          <Text style={S.diagStepText}>{typeof step === 'string' ? step : step.action}</Text>
        </View>
      ))}
      {!!note && <View style={S.diagTip}><ShieldCheck size={12} color={ACCENT} strokeWidth={2.2} /><Text style={S.diagTipText}>{note}</Text></View>}
      <TouchableOpacity style={S.buyBtn} onPress={onBuyMedicine} activeOpacity={0.8}>
        <LinearGradient colors={[USER_A, USER_B]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={S.buyBtnGrad}>
          <ShoppingCart size={14} color={COLORS.white} strokeWidth={2.4} />
          <Text style={S.buyBtnText}>Buy Products</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

function MarketCard({ data }) {
  const prices  = data.prices || [];
  const insight = data.insight || data.sellingAdvice || '';
  const metaRows = [
    data.msp         && { label: 'MSP',         value: data.msp },
    data.marketRange && { label: 'Market range', value: data.marketRange },
    data.trend       && { label: 'Trend',        value: data.trend },
    data.bestMarket  && { label: 'Best market',  value: data.bestMarket },
  ].filter(Boolean);
  return (
    <View style={S.mktCard}>
      <Text style={S.mktCrop}>{data.crop} Prices Today</Text>
      {prices.map((p, i) => <View key={i} style={S.mktRow}><Text style={S.mktMandi}>{p.mandi}</Text><Text style={S.mktPrice}>₹{(p.price || 0).toLocaleString()}</Text></View>)}
      {metaRows.map((r, i) => <View key={i} style={S.mktRow}><Text style={S.mktMandi}>{r.label}</Text><Text style={S.mktPrice}>{r.value}</Text></View>)}
      {!!insight && <View style={S.mktTip}><Lightbulb size={12} color={ACCENT} strokeWidth={2.2} /><Text style={S.mktTipText}>{insight}</Text></View>}
    </View>
  );
}

function formatInline(line, baseStyle) {
  const parts = (line || '').split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return <Text style={baseStyle}>{line}</Text>;
  return (
    <Text style={baseStyle}>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <Text key={i} style={{ fontWeight: '800' }}>{p.slice(2, -2)}</Text>
          : <Text key={i}>{p}</Text>
      )}
    </Text>
  );
}

function FormattedAIText({ text }) {
  const lines = (text || '').split('\n');
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) { elements.push(<View key={i} style={{ height: 6 }} />); continue; }
    if (/^\*\*[^*]+\*\*[:\s]*$/.test(trimmed)) {
      const headerText = trimmed.replace(/^\*\*/, '').replace(/\*\*[:\s]*$/, '');
      elements.push(
        <View key={i} style={{ marginTop: i > 0 ? 10 : 0, marginBottom: 4 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: TEXT, lineHeight: 22, fontFamily: INTER_BOLD }}>{headerText}</Text>
        </View>
      );
      continue;
    }
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/) || trimmed.match(/^(\d+)\.\s+(.+)/);
    if (bulletMatch) {
      const isNumbered = /^\d+\./.test(trimmed);
      const bulletContent = isNumbered ? bulletMatch[2] : bulletMatch[1];
      const bulletLabel = isNumbered ? `${bulletMatch[1]}.` : '•';
      elements.push(
        <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 3, paddingLeft: 2 }}>
          <Text style={{ fontSize: 15, color: TEXT2, fontWeight: '500', width: isNumbered ? 22 : 14, lineHeight: 24, fontFamily: INTER_SEMI }}>{bulletLabel}</Text>
          <View style={{ flex: 1 }}>{formatInline(bulletContent, { fontSize: 15, color: TEXT, lineHeight: 24, fontFamily: INTER_REG })}</View>
        </View>
      );
      continue;
    }
    elements.push(
      <View key={i} style={{ marginTop: 1 }}>
        {formatInline(trimmed, { fontSize: 15, color: TEXT, lineHeight: 24, fontFamily: INTER_REG })}
      </View>
    );
  }
  return <View>{elements}</View>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── MessageBubble: user = gradient pill / AI = glass pill with Listen button
// ─────────────────────────────────────────────────────────────────────────────
function MessageBubble({ msg, onBuyMedicine, language, isLast, onFollowUp }) {
  const isUser = msg.role === 'user';
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(8)).current;
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const ttsSoundRef = useRef(null);
  const copyTimerRef = useRef(null);

  // Copy the reply to the clipboard. Lazy-require expo-clipboard so a missing
  // native module (e.g. an older build) can never crash the bubble — on any
  // failure we just silently do nothing. Strips the **bold** markers so the
  // pasted text is clean prose.
  const handleCopy = async () => {
    try {
      const Clipboard = require('expo-clipboard');
      await Clipboard.setStringAsync((msg.text || '').replace(/\*\*/g, ''));
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (e) {}
  };
  // Per-bubble audio cache. The first Listen hits Sarvam TTS; every replay
  // after that re-uses this base64 payload so we never bill the same reply
  // twice. Tied to the message's language so it stays valid even if the
  // user later switches the global chat language.
  const audioCacheRef = useRef(null); // { uri, mimeType, lang }

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      // Component unmount: kill any in-flight playback so it doesn't keep
      // talking after the bubble is gone.
      const s = ttsSoundRef.current;
      ttsSoundRef.current = null;
      if (s) {
        (async () => {
          try { await s.stopAsync(); } catch {}
          try { await s.unloadAsync(); } catch {}
        })();
      }
    };
  }, []);

  // Stop currently-playing TTS (if any). Safe to call when nothing is playing.
  const stopTts = async () => {
    const s = ttsSoundRef.current;
    ttsSoundRef.current = null;
    setTtsPlaying(false);
    if (!s) return;
    try { await s.stopAsync(); } catch {}
    try { await s.unloadAsync(); } catch {}
  };

  // Toggle play/stop. Click while idle → use cache if present, else fetch +
  // play + cache. Click while playing → stop.
  const playTts = async () => {
    if (!msg.text) return;
    if (ttsLoading) return;             // mid-fetch — ignore extra taps
    if (ttsPlaying) { await stopTts(); return; }

    // The language the message was produced in is the source of truth for
    // playback; the cache key follows it so language switches in the picker
    // never invalidate cached audio for old messages.
    const lang = msg.lang || language || 'hi';
    setTtsLoading(true);
    try {
      // ── Resolve audio URI (cache hit, else fetch from Sarvam) ─────────────
      let cached = audioCacheRef.current;
      if (cached && cached.lang !== lang) cached = null;   // language mismatch → refetch

      let uri, mimeType;
      if (cached) {
        uri      = cached.uri;
        mimeType = cached.mimeType;
      } else {
        // Backend TTS caps text at 1000 chars. For very long AI replies we
        // truncate at a sentence boundary so playback doesn't stop mid-word
        // and the request doesn't 400.
        let spoken = msg.text;
        if (spoken.length > 1000) {
          const cut = spoken.slice(0, 1000);
          const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('।'), cut.lastIndexOf('\n'));
          spoken = lastStop > 200 ? cut.slice(0, lastStop + 1) : cut;
        }
        const result = await textToSpeech(spoken, lang);
        if (!result.audio) { setTtsLoading(false); return; }
        mimeType = result.mimeType || 'audio/wav';
        uri      = `data:${mimeType};base64,${result.audio}`;
        // Cache the URI for subsequent replays — Sarvam not hit again for
        // this bubble unless the bubble is unmounted (chat closed/cleared).
        audioCacheRef.current = { uri, mimeType, lang };
      }

      // ── Set audio mode + play ─────────────────────────────────────────────
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
      });
      // Defensive: if a previous sound is still hanging around, kill it first.
      if (ttsSoundRef.current) {
        try { await ttsSoundRef.current.unloadAsync(); } catch {}
        ttsSoundRef.current = null;
      }
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      ttsSoundRef.current = sound;
      setTtsPlaying(true);
      sound.setOnPlaybackStatusUpdate((st) => {
        // Track natural completion AND any error/stop event so the button
        // returns to the idle state without the user having to tap Stop.
        if (!st.isLoaded) return;
        if (st.didJustFinish || (st.error && !st.isPlaying)) {
          (async () => {
            try { await sound.unloadAsync(); } catch {}
            if (ttsSoundRef.current === sound) ttsSoundRef.current = null;
            setTtsPlaying(false);
          })();
        }
      });
    } catch (err) {
      // Silent fail on TTS — the chat bubble still shows the reply text.
      if (__DEV__) console.warn('[TTS] playback failed:', err?.message || err);
      setTtsPlaying(false);
    } finally {
      setTtsLoading(false);
    }
  };

  if (isUser) {
    return (
      <Animated.View style={[S.userBubbleWrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <View style={S.userBubble}>
          <LinearGradient
            colors={[USER_A, USER_B]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          {msg.isVoice && (
            <View style={S.voiceTag}>
              <Mic size={10} color="rgba(12,36,21,0.85)" strokeWidth={2.4} />
              <Text style={S.voiceTagText}>voice</Text>
            </View>
          )}
          {msg.imageUri ? <Image source={{ uri: msg.imageUri }} style={S.userImage} /> : null}
          {msg.text ? <Text style={S.userBubbleText}>{msg.transcribing ? '…' : msg.text}</Text> : null}
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[S.aiBubbleWrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={{ flex: 1, gap: 8 }}>
        {msg.text ? (
          <View style={S.aiBubble}>
            <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFillObject} />
            <FormattedAIText text={msg.text} />
            <View style={S.actionRow}>
              <TouchableOpacity
                style={[S.listenBtn, ttsPlaying && S.listenBtnPlaying]}
                onPress={playTts}
                activeOpacity={0.7}
                disabled={ttsLoading}
                accessibilityRole="button"
                accessibilityLabel={ttsPlaying ? 'Stop listening' : 'Listen to reply'}
              >
                {ttsLoading
                  ? <ActivityIndicator size="small" color={ACCENT} />
                  : ttsPlaying
                  ? <SquareIcon size={15} color={ACCENT} strokeWidth={2.6} fill={ACCENT} />
                  : <Volume2 size={16} color={ACCENT} strokeWidth={2.4} />}
                <Text style={S.listenTxt}>{ttsPlaying ? 'Stop' : 'Listen'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.copyBtn, copied && S.copyBtnDone]}
                onPress={handleCopy}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={copied ? 'Copied' : 'Copy reply'}
              >
                {copied
                  ? <Check size={15} color={P_LIGHT} strokeWidth={2.8} />
                  : <Copy size={15} color={MUTED} strokeWidth={2.4} />}
                <Text style={[S.copyTxt, copied && { color: P_LIGHT }]}>{copied ? 'Copied' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
        {msg.diagnosisData && <DiagnosisCard data={msg.diagnosisData} onBuyMedicine={onBuyMedicine} />}
        {msg.marketData    && <MarketCard data={msg.marketData} />}
        {isLast && Array.isArray(msg.followUps) && msg.followUps.length > 0 && (
          <View style={S.followUpWrap}>
            {msg.followUps.map((q, i) => (
              <TouchableOpacity
                key={i}
                style={S.followUpChip}
                onPress={() => onFollowUp?.(q)}
                activeOpacity={0.75}
                accessibilityRole="button"
              >
                <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFillObject} />
                <Text style={S.followUpText} numberOfLines={2}>{q}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// ── Sidebar (opens from Menu or History tab) ─────────────────────────────────
function Sidebar({ isOpen, onClose, sessions, historyLoading, onSessionPress, onNewChat, onDeleteSession, insets }) {
  const { t } = useLanguage();
  const translateX     = useRef(new Animated.Value(-W * 0.82)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateX,     { toValue: isOpen ? 0 : -W * 0.82, speed: 18, bounciness: 0, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: isOpen ? 1 : 0, duration: 250, useNativeDriver: true }),
    ]).start();
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[SB.overlay, { opacity: overlayOpacity }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
      </Animated.View>
      <Animated.View style={[SB.panel, { paddingTop: insets.top + 12, transform: [{ translateX }] }]}>
        <View style={SB.panelHeader}>
          <View style={SB.panelTitleRow}>
            <LinearGradient colors={[PRIMARY, ACCENT]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={SB.panelAvatar}>
              <Sprout size={14} color={BG} strokeWidth={2.6} />
            </LinearGradient>
            <Text style={SB.panelTitle} numberOfLines={1}>{t('aiBrand.gyaan', 'Krushi Gyaan')}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={SB.closeBtn} activeOpacity={0.7}>
            <CloseIcon size={20} color={MUTED} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={SB.newChatBtn} onPress={() => { onNewChat(); onClose(); }} activeOpacity={0.8}>
          <LinearGradient colors={[USER_A, USER_B]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={SB.newChatGrad}>
            <Plus size={18} color="#fff" strokeWidth={2.6} />
            <Text style={SB.newChatText}>New Chat</Text>
          </LinearGradient>
        </TouchableOpacity>

        <Text style={SB.sectionLabel}>Recent History</Text>
        {historyLoading ? (
          <View style={SB.loaderRow}>
            <ActivityIndicator color={PRIMARY} size="small" />
            <Text style={SB.loaderText}>Loading…</Text>
          </View>
        ) : sessions.length === 0 ? (
          <Text style={SB.emptyText}>No conversations yet</Text>
        ) : (
          <FlatList
            windowSize={5}
            maxToRenderPerBatch={10}
            removeClippedSubviews
            data={sessions}
            keyExtractor={s => s.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 32 }}
            renderItem={({ item }) => {
              const isScan  = item.isScanSession;
              const dateStr = new Date(item.updatedAt || item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
              return (
                <View style={SB.sessionRowWrap}>
                  <TouchableOpacity style={SB.sessionRow} onPress={() => { onSessionPress(item); onClose(); }} activeOpacity={0.75}>
                    <View style={[SB.sessionIcon, { backgroundColor: isScan ? 'rgba(34,197,94,0.12)' : 'rgba(245,184,65,0.12)' }]}>
                      {isScan
                        ? <ScanLine size={16} color={P_LIGHT} strokeWidth={2.2} />
                        : <MessageSquare size={16} color={ACCENT} strokeWidth={2.2} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={SB.sessionTitle} numberOfLines={1}>{item.title || 'AI Chat'}</Text>
                      <Text style={SB.sessionMeta}>{dateStr} · {item._count?.messages || item.messages?.length || 0} msgs</Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={SB.trashBtn}
                    onPress={() => {
                      Alert.alert(
                        'Delete conversation?',
                        `"${item.title || 'AI Chat'}" will be removed from your history. This cannot be undone.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => onDeleteSession?.(item),
                          },
                        ]
                      );
                    }}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Trash2 size={16} color={DANGER} strokeWidth={2.2} />
                  </TouchableOpacity>
                </View>
              );
            }}
          />
        )}
      </Animated.View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Red Pulse Dot (recording indicator)
// ─────────────────────────────────────────────────────────────────────────────
function PulseDot() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1,   duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])).start();
  }, []);
  return (
    <View style={C.pulseOuter}>
      <Animated.View style={[C.pulseInner, { opacity: pulse }]} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Main Screen
// ─────────────────────────────────────────────────────────────────────────────
export default function AIChatScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const farmCtx      = useFarm();
  const getAIContext = farmCtx?.getAIContext || (() => ({}));
  const { farms, activeFarm, activeFarmId, switchActiveFarm, hasFarms } = useMultiFarm();
  const { language, chatLanguage, responseLength, t } = useLanguage();
  // Resolve which language to send each message in:
  //   • chatLanguage === 'auto' → script-detect from the message (Devanagari
  //     ties broken by the app UI language).
  //   • else → use chatLanguage verbatim (picker is authoritative).
  // Caller must invoke this with the actual user message text.
  const resolveMsgLang = useCallback((text) => {
    if (chatLanguage === 'auto') return detectLanguage(text || '', language);
    return chatLanguage || language || 'en';
  }, [chatLanguage, language]);

  const initialMsg             = route?.params?.initialMessage;
  const existingConversationId = route?.params?.conversationId;

  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [farmPickerOpen, setFarmPickerOpen] = useState(false);
  const [farmContextEnabled, setFarmContextEnabled] = useState(true);

  const [messages, setMessages]     = useState([{
    id: '0',
    role: 'ai',
    text: t('aiChat.welcomeMsg', "नमस्ते किसान भाई! 🌱 I'm Krushi Intelligence, your farming assistant. Ask me about crops, soil, weather, pests, or fertilizers — type, speak, or share a photo of your field."),
  }]);
  const [input,    setInput]        = useState('');
  const [typing,   setTyping]       = useState(false);
  const [conversationId, setConvId] = useState(existingConversationId || null);
  // Photo attached to the composer (camera/gallery) → conversational diagnosis.
  const [attachedImage, setAttachedImage] = useState(null); // { uri, base64, mime_type }
  const flatRef    = useRef(null);
  const lastSentAt = useRef(0);

  const [isRecording,  setIsRecording]  = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioLevel,   setAudioLevel]   = useState(0);
  const recordRef        = useRef(null);
  const recordingLockRef = useRef(false);
  const silenceStartRef  = useRef(null);
  const recStartAtRef    = useRef(0);                // timestamp when recording began
  const maxDurationTimerRef = useRef(null);          // 60s auto-stop timer

  const [sessions,       setSessions]  = useState([]);
  const [historyLoading, setHLoading]  = useState(false);
  const [historyLoaded,  setHLoaded]   = useState(false);

  // ── Message helpers ───────────────────────────────────────────────────────
  const addMessage = useCallback((msg) => {
    const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    setMessages(prev => [...prev, { id, ...msg }]);
  }, []);

  const sendMessage = useCallback(async (text) => {
    const msg = text || input.trim();
    // Capture (and clear) any attached photo up-front so a slow request can't
    // leak it into the next message. A photo alone — no text — is valid.
    const img = attachedImage;
    if ((!msg && !img) || typing) return;
    SoundEffects.send();
    const now = Date.now();
    if (now - lastSentAt.current < 6000) {
      addMessage({ role: 'ai', text: `Please wait ${Math.ceil((6000 - (now - lastSentAt.current)) / 1000)}s before sending another message.` });
      return;
    }
    lastSentAt.current = now;
    setInput('');
    setAttachedImage(null);
    addMessage({ role: 'user', text: msg, imageUri: img?.uri });
    setTyping(true);
    try {
      // Picker is authoritative unless user picked Auto-detect — in that case
      // we script-detect on each message so a Marathi-typed reply comes back
      // in Marathi etc.
      const msgLang = resolveMsgLang(msg);
      const result = await sendChatMessage(
        msg,
        conversationId,
        farmContextEnabled ? getAIContext() : {},
        farmContextEnabled,
        msgLang,
        responseLength,
        img ? { data: img.base64, mime_type: img.mime_type } : null,
      );
      if (result.conversationId && !conversationId) setConvId(result.conversationId);
      // Pure conversational chat — no diagnosis/market cards. Crop-disease
      // diagnosis lives in the dedicated Crop Scan flow.
      const aiMsg = { role: 'ai', text: result.reply, lang: msgLang };
      if (Array.isArray(result.followUps) && result.followUps.length) aiMsg.followUps = result.followUps;
      addMessage(aiMsg);
    } catch (err) {
      addMessage({ role: 'ai', text: `⚠ ${humanReadableError(err, 'Could not reach Krushi Intelligence. Check your connection.')}` });
    } finally { setTyping(false); }
  }, [input, typing, conversationId, addMessage, getAIContext, farmContextEnabled, resolveMsgLang, responseLength, attachedImage]);

  // ── Reset / new chat ───────────────────────────────────────────────────────
  // Clears the on-screen conversation only — saved history stays in the sidebar.
  const resetChat = useCallback(() => {
    setMessages([{ id: '0', role: 'ai', text: t('aiChat.welcomeMsg', "नमस्ते किसान भाई! 🌱 I'm Krushi Intelligence, your farming assistant. Ask me about crops, soil, weather, pests, or fertilizers — type, speak, or share a photo of your field.") }]);
    setConvId(null);
    setInput('');
    setAttachedImage(null);
    setTyping(false);
  }, [t]);

  const confirmReset = useCallback(() => {
    // Nothing to clear (only the welcome bubble) → reset silently.
    if (messages.length <= 1) { resetChat(); return; }
    Alert.alert(
      t('aiChat.newChatTitle', 'Start a new chat?'),
      t('aiChat.newChatBody', 'This clears the current conversation from the screen. Your saved history is not deleted.'),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        { text: t('aiChat.newChat', 'New chat'), style: 'destructive', onPress: resetChat },
      ],
    );
  }, [messages.length, resetChat, t]);

  // ── Image attach (camera / gallery) → conversational diagnosis ──────────────
  const attachImage = useCallback(async (asset) => {
    if (!asset?.uri) return;
    try {
      const c = await compressImage(asset.uri, { needBase64: true });
      const base64 = c?.base64;
      if (!base64) { Alert.alert('Photo', 'Could not read that image. Please try another.'); return; }
      setAttachedImage({ uri: c?.uri || asset.uri, base64, mime_type: 'image/jpeg' });
    } catch (e) {
      if (__DEV__) console.warn('[AIChat] image compress failed', e?.message);
      Alert.alert('Photo', 'Could not process that image. Please try another.');
    }
  }, []);

  const pickFromCamera = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera Permission', 'Please allow camera access in Settings → Apps → CropSetu → Permissions.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.85, allowsEditing: true, aspect: [4, 3] });
    if (!res.canceled && res.assets?.[0]) attachImage(res.assets[0]);
  }, [attachImage]);

  const pickFromGallery = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Photos Permission', 'Please allow photo access in Settings → Apps → CropSetu → Permissions.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.85 });
    if (!res.canceled && res.assets?.[0]) attachImage(res.assets[0]);
  }, [attachImage]);

  const onAttachPress = useCallback(() => {
    Alert.alert(t('cropScan.addImage', 'Add a photo'), t('aiChat.attachHint', 'Share a photo of your crop for a quick diagnosis.'), [
      { text: t('cropScan.takePhoto', 'Take photo'), onPress: pickFromCamera },
      { text: t('cropScan.chooseGallery', 'From gallery'), onPress: pickFromGallery },
      { text: t('common.cancel', 'Cancel'), style: 'cancel' },
    ]);
  }, [t, pickFromCamera, pickFromGallery]);

  const onFollowUpPress = useCallback((q) => { sendMessage(q); }, [sendMessage]);

  // ── Inline recording (Lovable composer UX) ────────────────────────────────
  const startRecording = useCallback(async () => {
    if (isProcessing || recordRef.current || recordingLockRef.current) return;
    recordingLockRef.current = true;
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Microphone Permission', 'Please allow microphone access in Settings → Apps → CropSetu → Permissions.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS:        true,
        playsInSilentModeIOS:      true,
        staysActiveInBackground:   false,
        shouldDuckAndroid:         true,
        playThroughEarpieceAndroid: false,
      });
      const { recording } = await Audio.Recording.createAsync({
        isMeteringEnabled: true,
        android: {
          extension:        '.m4a',
          outputFormat:     Audio.AndroidOutputFormat?.MPEG_4 ?? 2,
          audioEncoder:     Audio.AndroidAudioEncoder?.AAC   ?? 3,
          sampleRate:       44100,
          numberOfChannels: 1,
          bitRate:          64000,
        },
        ios: {
          extension:           '.m4a',
          outputFormat:        Audio.IOSOutputFormat?.MPEG4AAC ?? 'aac ',
          audioQuality:        Audio.IOSAudioQuality?.MEDIUM   ?? 0x60,
          sampleRate:          44100,
          numberOfChannels:    1,
          bitRate:             64000,
          linearPCMBitDepth:   16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat:    false,
        },
        web: { mimeType: 'audio/webm', bitsPerSecond: 64000 },
      });

      let lastUpdate = 0;
      silenceStartRef.current = null;
      recording.setOnRecordingStatusUpdate((s) => {
        // Some Android builds deliver a `canRecord=false` event when the OS
        // preempts the audio session (incoming call, other app). Drop the recorder.
        if (s?.isDoneRecording) return;
        if (s && s.canRecord === false && !s.isRecording) {
          silenceStartRef.current = null;
          cancelRecording();
          return;
        }
        const now = Date.now();
        if (!s.isRecording) return;
        // Amplitude display (metering in dB, normalize to 0..1)
        if (s.metering !== undefined && now - lastUpdate > 90) {
          lastUpdate = now;
          setAudioLevel(Math.max(0, Math.min(1, (s.metering + 60) / 48)));
        }
        // Silence auto-stop. 10 s of below-threshold audio ends the recording
        // — generous so a thoughtful pause mid-sentence doesn't cut the user off.
        if (s.metering !== undefined) {
          const silent = s.metering < -45;
          if (silent) {
            if (silenceStartRef.current == null) silenceStartRef.current = now;
            else if (now - silenceStartRef.current > 10_000) {
              silenceStartRef.current = null;
              stopAndSend();
            }
          } else {
            silenceStartRef.current = null;
          }
        }
      });
      recordRef.current = recording;
      recStartAtRef.current = Date.now();
      // Hard safety cap: user left the mic open / kept speaking past MAX_REC_MS.
      if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = setTimeout(() => {
        if (recordRef.current) stopAndSend();
      }, MAX_REC_MS);
      setIsRecording(true); setAudioLevel(0);
    } catch (err) {
      console.error('[Recording] startRecording failed:', err?.message || err);
      Alert.alert('Recording Error', `Could not start microphone.\n${err?.message || 'Please check microphone permissions and try again.'}`);
    } finally {
      recordingLockRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProcessing]);

  const stopAndSend = useCallback(async () => {
    if (!recordRef.current) return;
    // Clear the max-duration safety timer immediately
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    const elapsed = recStartAtRef.current ? Date.now() - recStartAtRef.current : 0;
    // Guard: tap happened too soon — discard the clip silently so we don't
    // POST an empty audio file Sarvam will reject as unintelligible.
    if (elapsed < MIN_REC_MS) {
      try { await recordRef.current.stopAndUnloadAsync(); } catch {}
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}
      recordRef.current = null;
      silenceStartRef.current = null;
      setIsRecording(false); setAudioLevel(0);
      return;
    }

    setIsRecording(false); setIsProcessing(true); setAudioLevel(0);
    silenceStartRef.current = null;
    try {
      await recordRef.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recordRef.current.getURI();
      recordRef.current = null;
      if (!uri) { setIsProcessing(false); return; }
      // For voice: when chatLanguage is 'auto' we let Sarvam STT auto-detect
      // and reply in the spoken tongue (pass null hint). Otherwise force the
      // picked language so transcription + reply both stay on rails.
      const voiceLang = chatLanguage === 'auto' ? null : (chatLanguage || language || 'en');
      const result = await sendVoiceMessage(uri, conversationId, getAIContext(), voiceLang);
      if (result.conversationId && !conversationId) setConvId(result.conversationId);
      const transcribed = (result.transcription || '').trim();
      // If STT returned nothing meaningful (user said nothing), skip the user
      // bubble and just surface a hint so they know to try again.
      if (!transcribed) {
        addMessage({ role: 'ai', text: '🎙 I didn’t catch that — try speaking a bit closer to the mic.' });
      } else {
        addMessage({ role: 'user', text: transcribed, isVoice: true });
        const aiMsg = {
          role: 'ai',
          text: result.reply,
          // Sarvam STT returns `detectedLanguage` like 'mr-IN' — remember it so Listen
          // replays in the same language the user spoke in.
          lang: (result.detectedLanguage || '').split('-')[0] || undefined,
        };
        if (Array.isArray(result.followUps) && result.followUps.length) aiMsg.followUps = result.followUps;
        addMessage(aiMsg);
      }
    } catch (err) {
      recordRef.current = null;
      addMessage({ role: 'ai', text: `⚠ ${humanReadableError(err, 'Processing failed. Please try again.')}` });
    } finally { setIsProcessing(false); }
  }, [conversationId, addMessage, getAIContext, language, chatLanguage]);

  const cancelRecording = useCallback(async () => {
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    if (recordRef.current) {
      try { await recordRef.current.stopAndUnloadAsync(); await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch { }
      recordRef.current = null;
    }
    recordingLockRef.current = false;
    silenceStartRef.current = null;
    setIsRecording(false); setIsProcessing(false); setAudioLevel(0);
  }, []);

  // Unmount safety — don't leave the mic hot if user navigates away mid-record.
  useEffect(() => {
    return () => {
      if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
      if (recordRef.current) {
        try { recordRef.current.stopAndUnloadAsync(); } catch {}
        try { Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}
        recordRef.current = null;
      }
    };
  }, []);

  // ── History lazy-load (text chats only — voice/scan have their own screens) ──
  const loadHistory = useCallback(async () => {
    if (historyLoading) return;
    setHLoading(true);
    try {
      const convos = await getConversations();
      const convoList = (convos || []).map(c => ({ ...c, isScanSession: false }));
      setSessions(convoList.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
      setHLoaded(true);
    } finally { setHLoading(false); }
  }, [historyLoading]);

  // Soft-delete a conversation: optimistically remove from the sidebar list,
  // call the backend, and rollback + surface an error if the call fails.
  const deleteSession = useCallback(async (item) => {
    if (!item?.id) return;
    // Optimistic: drop it immediately so the UI feels instant
    setSessions(prev => prev.filter(s => s.id !== item.id));
    try {
      await deleteConversation(item.id);
      // If the user is currently viewing the conversation they just deleted,
      // reset the chat to a fresh welcome state.
      if (conversationId === item.id) {
        resetChat();
      }
    } catch (err) {
      // Rollback — put the item back at its original position (sorted by updatedAt)
      setSessions(prev => {
        const next = [...prev, item];
        return next.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      });
      Alert.alert(
        'Could not delete',
        err?.response?.data?.error?.message || err?.message || 'Please check your connection and try again.'
      );
    }
  }, [conversationId, t]);

  useEffect(() => { if (sidebarOpen && !historyLoaded) loadHistory(); }, [sidebarOpen]);

  // Arriving from the AI hub's "Chat history" entry → open the history sidebar
  // (param-watched so it works whether AIChat is freshly pushed or already in
  // the stack; cleared after so it doesn't re-trigger).
  useEffect(() => {
    if (route?.params?.showHistory) {
      setSidebarOpen(true);
      navigation.setParams({ showHistory: undefined });
    }
  }, [route?.params?.showHistory]);

  useEffect(() => {
    if (existingConversationId) {
      getConversationMessages(existingConversationId)
        .then(convo => {
          if (convo?.messages?.length) {
            setMessages(convo.messages.map(m => ({
              id: m.id, role: m.role === 'assistant' ? 'ai' : 'user', text: m.content,
              diagnosisData: m.messageType === 'diagnosis' ? m.structuredData : null,
              marketData:    m.messageType === 'market'    ? m.structuredData : null,
            })));
          }
        }).catch(() => {});
    }
  }, []);

  useEffect(() => { if (initialMsg) setTimeout(() => sendMessage(initialMsg), 600); }, []);

  useEffect(() => {
    if (!flatRef.current || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === 'user' || typing) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
    } else if (lastMsg.role === 'ai') {
      const userMsgIndex = Math.max(0, messages.length - 2);
      setTimeout(() => {
        try { flatRef.current?.scrollToIndex({ index: userMsgIndex, animated: true, viewPosition: 0 }); }
        catch { flatRef.current?.scrollToEnd({ animated: true }); }
      }, 120);
    }
  }, [messages, typing]);

  // ───────────────────────────────────────────────────────────────────────────
  // ── Render
  // ───────────────────────────────────────────────────────────────────────────
  const showSend = input.trim().length > 0 || !!attachedImage;

  return (
    <AnimatedScreen>
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* ── Header ── */}
      <ChatHeader
        insets={insets}
        onMenuPress={() => setSidebarOpen(true)}
        onNewChatPress={confirmReset}
      />

      {/* ── Farm context bar (minimal glass pill) ── */}
      {hasFarms ? (
        <View style={S.farmBar}>
          <View style={S.farmBarRow}>
            <TouchableOpacity style={[S.farmBarInner, { flex: 1 }]} onPress={() => farmContextEnabled && setFarmPickerOpen(!farmPickerOpen)} activeOpacity={farmContextEnabled ? 0.7 : 1}>
              <Leaf size={14} color={farmContextEnabled ? P_LIGHT : MUTED} strokeWidth={2.2} />
              <Text style={[S.farmBarName, !farmContextEnabled && { color: MUTED }]} numberOfLines={1}>
                {farmContextEnabled ? (activeFarm?.farmName || activeFarm?.farmAlias || 'Select Farm') : 'Farm context off'}
              </Text>
              {farmContextEnabled && (
                <>
                  <Text style={S.farmBarMeta} numberOfLines={1}>
                    {activeFarm ? `${activeFarm.landSizeAcres}ac · ${(activeFarm.soilType || '').replace('_', ' ')} · ${activeFarm.irrigationSystem}` : ''}
                  </Text>
                  {farmPickerOpen
                    ? <ChevronUp size={14} color={MUTED} strokeWidth={2.2} />
                    : <ChevronDown size={14} color={MUTED} strokeWidth={2.2} />}
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.farmBarPill, { backgroundColor: farmContextEnabled ? 'rgba(34,197,94,0.15)' : SURFACE, borderWidth: 1, borderColor: farmContextEnabled ? 'rgba(34,197,94,0.3)' : BORDER }]}
              onPress={() => { setFarmContextEnabled(v => !v); setFarmPickerOpen(false); }}
              activeOpacity={0.7}
            >
              {farmContextEnabled
                ? <ToggleRight size={16} color={P_LIGHT} strokeWidth={2.2} style={{ marginRight: 4 }} />
                : <ToggleLeft size={16} color={MUTED} strokeWidth={2.2} style={{ marginRight: 4 }} />}
              <Text style={[S.farmBarPillText, { color: farmContextEnabled ? P_LIGHT : MUTED }]}>
                {farmContextEnabled ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>
          </View>

          {farmPickerOpen && farmContextEnabled && (
            <View style={S.farmDropdown}>
              {farms.map(f => (
                <TouchableOpacity
                  key={f.id}
                  style={[S.farmDropItem, f.id === activeFarmId && S.farmDropItemActive]}
                  onPress={() => { switchActiveFarm(f.id); setFarmPickerOpen(false); }}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[S.farmDropName, f.id === activeFarmId && { color: P_LIGHT }]}>
                      {f.farmName || f.farmAlias}
                    </Text>
                    <Text style={S.farmDropMeta}>
                      {[f.village, f.district].filter(Boolean).join(', ')} · {f.landSizeAcres}ac · {(f.soilType || '').replace('_', ' ')}
                    </Text>
                  </View>
                  {f.id === activeFarmId && <Check size={18} color={P_LIGHT} strokeWidth={2.4} />}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      ) : (
        <TouchableOpacity
          style={[S.farmBar, { backgroundColor: 'rgba(245,184,65,0.1)', borderBottomColor: 'rgba(245,184,65,0.22)' }]}
          onPress={() => navigation.navigate('FarmAddEdit')}
          activeOpacity={0.7}
        >
          <View style={S.farmBarInner}>
            <Plus size={14} color={ACCENT} strokeWidth={2.4} />
            <Text style={[S.farmBarName, { color: ACCENT }]}>Add your farm for personalized AI advice</Text>
            <ChevronRight size={14} color={ACCENT} strokeWidth={2.2} />
          </View>
        </TouchableOpacity>
      )}

      {/* ── Chat + Composer ── */}
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: 'transparent' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={10}
          removeClippedSubviews={false}
          ref={flatRef}
          data={messages}
          keyExtractor={m => m.id}
          contentContainerStyle={S.msgList}
          showsVerticalScrollIndicator={false}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              try { flatRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0 }); }
              catch { flatRef.current?.scrollToEnd({ animated: true }); }
            }, 200);
          }}
          renderItem={({ item, index }) => (
            <MessageBubble
              msg={item}
              onBuyMedicine={() => navigation.navigate('AgriStore')}
              language={language}
              isLast={index === messages.length - 1}
              onFollowUp={onFollowUpPress}
            />
          )}
          ListFooterComponent={typing ? (
            <View style={S.aiBubbleWrap}>
              <View style={S.aiBubble}>
                <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFillObject} />
                <TypingDots />
              </View>
            </View>
          ) : null}
        />

        {/* ── Composer (Lovable spec) ── */}
        <View style={[C.composerWrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          {isRecording ? (
            // ── Recording state ───────────────────────────────────────────────
            <BlurView intensity={30} tint="dark" style={C.composer}>
              <View style={C.recordRow}>
                <PulseDot />
                <View style={C.recordMid}>
                  <Text style={C.recordLabel}>Listening… auto-stops on silence</Text>
                  <VoiceWaveform amplitude={audioLevel} bars={28} height={20} />
                </View>
                <TouchableOpacity style={C.stopBtn} onPress={stopAndSend} activeOpacity={0.85}>
                  <SquareIcon size={16} color="#fff" strokeWidth={2.6} fill="#fff" />
                </TouchableOpacity>
              </View>
            </BlurView>
          ) : (
            // ── Idle / typing state ───────────────────────────────────────────
            <BlurView intensity={30} tint="dark" style={C.composer}>
              {attachedImage ? (
                <View style={C.attachRow}>
                  <Image source={{ uri: attachedImage.uri }} style={C.attachThumb} />
                  <Text style={C.attachLabel} numberOfLines={1}>{t('aiChat.photoAttached', 'Photo attached')}</Text>
                  <TouchableOpacity onPress={() => setAttachedImage(null)} style={C.attachClose} activeOpacity={0.7} accessibilityLabel="Remove photo">
                    <CloseIcon size={16} color={MUTED} strokeWidth={2.4} />
                  </TouchableOpacity>
                </View>
              ) : null}
              <View style={C.inputRow}>
                <TouchableOpacity
                  style={C.iconBtn}
                  onPress={onAttachPress}
                  activeOpacity={0.7}
                >
                  <Paperclip size={20} color={attachedImage ? PRIMARY : MUTED} strokeWidth={2.2} />
                </TouchableOpacity>
                <ResponseLengthSelector compact />

                <TextInput
                  style={C.textInput}
                  placeholder={attachedImage ? t('aiChat.photoNote', 'Add a note (optional)…') : 'Type a message…'}
                  placeholderTextColor={MUTED}
                  value={input}
                  onChangeText={setInput}
                  multiline
                  maxLength={1000}
                  returnKeyType="send"
                  blurOnSubmit
                  onSubmitEditing={() => sendMessage()}
                  editable={!typing && !isProcessing}
                />
                {showSend ? (
                  <TouchableOpacity
                    style={[C.sendBtn, typing && { opacity: 0.5 }]}
                    onPress={() => sendMessage()}
                    disabled={typing}
                    activeOpacity={0.85}
                  >
                    {typing
                      ? <ActivityIndicator size={16} color="#fff" />
                      : <Send size={16} color={BG} strokeWidth={2.6} />}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[C.micBtn, isProcessing && { opacity: 0.5 }]}
                    onPress={startRecording}
                    disabled={isProcessing}
                    activeOpacity={0.85}
                  >
                    {isProcessing
                      ? <ActivityIndicator size={16} color={BG} />
                      : <Mic size={16} color={BG} strokeWidth={2.6} />}
                  </TouchableOpacity>
                )}
              </View>
            </BlurView>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* ── Sidebar (Menu + History tab both open this) ── */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sessions={sessions}
        historyLoading={historyLoading}
        insets={insets}
        onNewChat={confirmReset}
        onSessionPress={(item) => navigation.push('AIChat', { conversationId: item.id })}
        onDeleteSession={deleteSession}
      />
    </View>
    </AnimatedScreen>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ── Styles
// ═════════════════════════════════════════════════════════════════════════════

const H = StyleSheet.create({
  wrap: {
    paddingBottom: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: 'rgba(6,17,9,0.55)',
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  // flex:1 + minWidth:0 lets the brand block shrink so its title ellipsizes
  // instead of overflowing into the LanguageSelector on narrow screens.
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  brandText: { flex: 1, minWidth: 0 },
  logoBadge: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: PRIMARY, shadowOpacity: 0.55, shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 }, elevation: 6,
  },
  title: { fontSize: 14, color: TEXT, fontFamily: INTER_BOLD, letterSpacing: 0.1 },
  sub: { fontSize: 11, color: MUTED, fontFamily: INTER_REG, marginTop: 1 },
});

const C = StyleSheet.create({
  composerWrap: {
    paddingHorizontal: 12,
    paddingTop: 6,
    backgroundColor: 'transparent',
  },
  composer: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  // ── Attached-photo preview row (above the input) ─────────────────────────────
  attachRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2,
  },
  attachThumb: {
    width: 44, height: 44, borderRadius: 10,
    // Subtle neutral/translucent frame only — no green tint around the preview.
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  attachLabel: {
    flex: 1, fontSize: 13, color: TEXT2, fontFamily: INTER_SEMI,
  },
  attachClose: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
  },
  // ── Idle row ────────────────────────────────────────────────────────────────
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6,
    paddingHorizontal: 8, paddingVertical: 8,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  textInput: {
    flex: 1, fontSize: 15, color: TEXT,
    maxHeight: 120, minHeight: 40,
    paddingVertical: 8, paddingHorizontal: 6,
    fontFamily: INTER_REG,
  },
  micBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: ACCENT,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: ACCENT, shadowOpacity: 0.6, shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 }, elevation: 8,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: PRIMARY,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: PRIMARY, shadowOpacity: 0.6, shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 }, elevation: 8,
  },
  // ── Recording row ───────────────────────────────────────────────────────────
  recordRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 10, paddingVertical: 10,
  },
  pulseOuter: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(239,68,68,0.18)',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.28)',
    alignItems: 'center', justifyContent: 'center',
  },
  pulseInner: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: DANGER,
  },
  recordMid: { flex: 1 },
  recordLabel: {
    fontSize: 11, color: MUTED, letterSpacing: 0.2,
    fontFamily: INTER_REG, marginBottom: 4,
  },
  stopBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: DANGER,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: DANGER, shadowOpacity: 0.5, shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 }, elevation: 6,
  },
});

const S = StyleSheet.create({
  // Farm context bar — glass pill
  farmBar: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderBottomWidth: 1, borderBottomColor: BORDER,
    marginTop: 4,
  },
  farmBarRow: { flexDirection: 'row', alignItems: 'center' },
  farmBarInner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7 },
  farmBarName: { fontSize: 12, color: TEXT2, fontFamily: INTER_SEMI },
  farmBarMeta: { flex: 1, fontSize: 10.5, color: MUTED, marginLeft: 2, fontFamily: INTER_REG },
  farmBarPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginRight: 10 },
  farmBarPillText: { fontSize: 10, letterSpacing: 0.3, fontFamily: INTER_BOLD },
  farmDropdown: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderBottomWidth: 1, borderBottomColor: BORDER,
    paddingHorizontal: 10, paddingBottom: 6,
  },
  farmDropItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, marginTop: 4 },
  farmDropItemActive: { backgroundColor: 'rgba(34,197,94,0.1)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.18)' },
  farmDropName: { fontSize: 14, color: TEXT, fontFamily: INTER_SEMI },
  farmDropMeta: { fontSize: 11, color: MUTED, marginTop: 1, fontFamily: INTER_REG },

  // Messages
  msgList: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 },

  // AI bubble (glass)
  aiBubbleWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  aiBubble: {
    flex: 1, maxWidth: '100%',
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16, borderTopLeftRadius: 4,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  // Listen + Copy actions under AI messages.
  actionRow: {
    marginTop: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    flexWrap: 'wrap',
  },
  // Listen button under AI messages — sized for a comfortable thumb tap.
  listenBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 14, paddingVertical: 9,
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  // Copy button — same pill shape as Listen; flashes a green "Copied" state.
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 9,
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  copyBtnDone: {
    backgroundColor: 'rgba(34,197,94,0.18)',
    borderColor: 'rgba(34,197,94,0.45)',
  },
  copyTxt: {
    fontSize: 13,
    color: TEXT2,
    fontFamily: INTER_SEMI,
    letterSpacing: 0.2,
  },
  // While playing — gold accent border + soft tint so the user immediately
  // sees the bubble is "talking" and that tapping it again will stop it.
  listenBtnPlaying: {
    backgroundColor: 'rgba(245,184,65,0.20)',
    borderColor: 'rgba(245,184,65,0.65)',
  },
  listenTxt: {
    fontSize: 13,
    color: TEXT,
    fontFamily: INTER_SEMI,
    letterSpacing: 0.2,
  },

  // User bubble (leaf→teal gradient pill)
  userBubbleWrap: { alignItems: 'flex-end', marginBottom: 14 },
  userBubble: {
    maxWidth: W * 0.82,
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 16, borderBottomRightRadius: 4,
    overflow: 'hidden',
    shadowColor: PRIMARY, shadowOpacity: 0.25, shadowRadius: 14,
    shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  voiceTag: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 3 },
  voiceTagText: { fontSize: 9, color: 'rgba(12,36,21,0.85)', letterSpacing: 0.5, fontFamily: INTER_SEMI },
  userBubbleText: { fontSize: 15, color: BG, lineHeight: 22, fontFamily: INTER_SEMI },
  userImage: {
    width: 180, height: 135, borderRadius: 12, marginBottom: 6,
    backgroundColor: 'rgba(0,0,0,0.12)',
    // Subtle neutral frame so the green bubble gradient doesn't read as a
    // green border bleeding around the photo.
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },

  // Follow-up suggestion chips (rendered under the latest AI reply)
  followUpWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  followUpChip: {
    borderRadius: 999, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.28)',
    backgroundColor: 'rgba(34,197,94,0.07)',
    paddingHorizontal: 12, paddingVertical: 8, maxWidth: '100%',
  },
  followUpText: { fontSize: 13, color: P_LIGHT, fontFamily: INTER_SEMI, lineHeight: 17 },

  // Typing dots
  dotsRow: { flexDirection: 'row', gap: 5, alignItems: 'center', height: 20 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: ACCENT },

  // Diagnosis / Market cards (glass)
  diagCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16, padding: 14, gap: 10,
    borderWidth: 1, borderColor: BORDER, maxWidth: W * 0.82,
  },
  diagHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  diagSevDot: { width: 8, height: 8, borderRadius: 4 },
  diagName: { fontSize: 15, color: TEXT, flex: 1, fontFamily: INTER_EXTRA },
  diagConf: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  diagConfText: { fontSize: 11, fontFamily: INTER_BOLD },
  diagMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  diagMetaText: { fontSize: 11, color: MUTED, fontFamily: INTER_REG },
  diagDivider: { height: 1, backgroundColor: BORDER },
  diagSectionLabel: { fontSize: 10, color: MUTED, letterSpacing: 1, textTransform: 'uppercase', fontFamily: INTER_EXTRA },
  diagStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  diagStepNum: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(34,197,94,0.18)',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0, marginTop: 1,
  },
  diagStepNumText: { fontSize: 10, color: P_LIGHT, fontFamily: INTER_EXTRA },
  diagStepText: { fontSize: 12, color: TEXT2, lineHeight: 18, flex: 1, fontFamily: INTER_REG },
  diagTip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: 'rgba(245,184,65,0.1)',
    borderWidth: 1, borderColor: 'rgba(245,184,65,0.2)',
    borderRadius: 10, padding: 10,
  },
  diagTipText: { fontSize: 11, color: TEXT2, lineHeight: 16, flex: 1, fontFamily: INTER_REG },
  buyBtn: { borderRadius: 10, overflow: 'hidden', marginTop: 2 },
  buyBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  buyBtnText: { fontSize: 13, color: '#FFFFFF', fontFamily: INTER_EXTRA },

  mktCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16, padding: 14, gap: 8,
    borderWidth: 1, borderColor: BORDER, maxWidth: W * 0.82,
  },
  mktCrop: { fontSize: 13, color: ACCENT, fontFamily: INTER_EXTRA },
  mktRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mktMandi: { fontSize: 12, color: MUTED, flex: 1, fontFamily: INTER_REG },
  mktPrice: { fontSize: 13, color: TEXT, fontFamily: INTER_BOLD },
  mktTip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: 'rgba(245,184,65,0.1)',
    borderWidth: 1, borderColor: 'rgba(245,184,65,0.2)',
    borderRadius: 10, padding: 10, marginTop: 2,
  },
  mktTipText: { fontSize: 11, color: TEXT2, lineHeight: 16, flex: 1, fontFamily: INTER_REG },
});

// ── Sidebar styles ────────────────────────────────────────────────────────────
const SB = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  panel: { position: 'absolute', left: 0, top: 0, bottom: 0, width: W * 0.82, backgroundColor: BG, borderRightWidth: 1, borderRightColor: BORDER, paddingHorizontal: 16 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  panelTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  panelAvatar: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  panelTitle: { fontSize: 16, color: TEXT, fontFamily: INTER_EXTRA },
  closeBtn: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },

  newChatBtn: { borderRadius: 14, overflow: 'hidden', marginBottom: 24 },
  newChatGrad: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 13, paddingHorizontal: 16 },
  newChatText: { fontSize: 14, color: '#fff', fontFamily: INTER_BOLD },

  sectionLabel: { fontSize: 10, color: MUTED, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, fontFamily: INTER_EXTRA },
  loaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16 },
  loaderText: { fontSize: 13, color: TEXT2, fontFamily: INTER_REG },
  emptyText: { fontSize: 13, color: MUTED, textAlign: 'center', paddingVertical: 24, fontFamily: INTER_REG },

  sessionRowWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: SURFACE,
  },
  sessionRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  sessionIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  sessionTitle: { fontSize: 13, color: TEXT, marginBottom: 2, fontFamily: INTER_SEMI },
  sessionMeta: { fontSize: 11, color: MUTED, fontFamily: INTER_REG },

  // Red trash button per session row
  trashBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
    marginLeft: 6,
  },
});

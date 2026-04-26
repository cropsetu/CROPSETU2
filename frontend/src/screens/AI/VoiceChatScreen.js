/**
 * VoiceChatScreen — ChatGPT-style immersive voice conversation with FarmMind AI
 *
 * Full-screen holographic particle sphere as centerpiece.
 * Gradient-colored particles (green → teal → cyan → blue).
 * Minimal dark UI overlaid on top.
 *
 * Flow: User speaks → STT → AI reply → TTS → plays audio response
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Dimensions, StatusBar, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ArrowLeft, ChevronDown, MessageSquare, Mic, MicOff, PhoneOff, Square as SquareIcon, Plus, Keyboard as KeyboardIcon, X as CloseIcon, ArrowUp } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import { WebView } from 'react-native-webview';
import { sendVoiceChatMessage } from '../../services/aiApi';
import { useFarm } from '../../context/FarmContext';
import { useLanguage } from '../../context/LanguageContext';
import { COLORS } from '../../constants/colors';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const { width: W, height: H } = Dimensions.get('window');

// ── Recording safety limits ──────────────────────────────────────────────────
// 60s hard cap so a mic left open never runs forever.
// 500ms minimum so stray taps don't POST near-empty audio blobs to Sarvam.
const MAX_REC_MS = 60_000;
const MIN_REC_MS = 500;
// 10s of audio below this dBFS threshold → user finished speaking → auto-stop.
// Generous so a thoughtful pause mid-sentence doesn't get cut off.
const SILENCE_DB = -45;
const SILENCE_MS = 10_000;

function humanReadableVoiceError(err, fallback = 'Could not process. Please try again.') {
  const status = err?.response?.status ?? err?.status;
  const serverMsg = err?.response?.data?.error?.message;
  if (status === 429) return 'Too many requests — please wait 30 seconds.';
  if (status === 402) return 'You’re out of AI credits. Top up to continue.';
  if (status === 503) return 'Voice service is temporarily unavailable.';
  if (status === 413) return 'Recording was too long. Please keep it shorter.';
  if (status === 401) return 'Session expired. Please log in again.';
  if (err?.message === 'Network Error' || err?.code === 'ERR_NETWORK')
    return 'No internet — check your connection.';
  return serverMsg || fallback;
}

// ── Galaxy Particle Sphere — exact port of Lovable cosmic-chat-companion Galaxy.tsx ──
// N=2200 Fibonacci sphere · radius 0.32 · destination-out + lighter composite (additive glow)
// Body is transparent so CosmicBackdrop (leaf/harvest/soil radial gradient) shows through.
const SPHERE_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>*{margin:0;padding:0;box-sizing:border-box;}html,body{background:transparent;overflow:hidden;height:100vh;width:100vw;}canvas{position:fixed;inset:0;width:100%;height:100%;}</style>
</head><body><canvas id="c"></canvas><script>
(function(){
var canvas=document.getElementById('c'),ctx=canvas.getContext('2d'),W,H,CX,CY,dpr,t=0,rotY=0;
var state='idle',amp=0;
var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Lovable uses N=2200 — match exactly
var N=2200,px=new Float32Array(N),py=new Float32Array(N),pz=new Float32Array(N);
var vx=new Float32Array(N),vy=new Float32Array(N),vz=new Float32Array(N);
var tx=new Float32Array(N),ty=new Float32Array(N),tz=new Float32Array(N);
var hue=new Float32Array(N),phase=new Float32Array(N);
var PHI=Math.PI*(1+Math.sqrt(5)),FOV=500,CAM=520;

function resize(){
  dpr=Math.min(window.devicePixelRatio||1,2);
  W=window.innerWidth;H=window.innerHeight;CX=W/2;CY=H/2;
  canvas.width=W*dpr;canvas.height=H*dpr;
  canvas.style.width=W+'px';canvas.style.height=H+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  initSphere();
}

function initSphere(){
  // Lovable uses R = min(W,H) * 0.32
  var R=Math.min(W,H)*0.32;
  for(var i=0;i<N;i++){
    var p=Math.acos(1-2*(i+0.5)/N),a=PHI*i;
    tx[i]=Math.sin(p)*Math.cos(a)*R;
    ty[i]=Math.sin(p)*Math.sin(a)*R;
    tz[i]=Math.cos(p)*R;
  }
}

function initParticles(){
  // Start particles AT their sphere target positions with a tiny jitter —
  // sphere shows up already formed on screen open (no "flying in from corners" assembly).
  for(var i=0;i<N;i++){
    px[i]=tx[i]+(Math.random()-.5)*2;
    py[i]=ty[i]+(Math.random()-.5)*2;
    pz[i]=tz[i]+(Math.random()-.5)*2;
    vx[i]=vy[i]=vz[i]=0;
    // Lovable: hue 140(green) → 220(blue) — leaf through teal/cyan to blue
    hue[i]=140+(i/N)*80;
    phase[i]=Math.random()*Math.PI*2;
  }
}

function draw(){
  t+=reduced?0.001:0.003;
  var isActive=state!=='idle';
  var isRec=state==='recording'||state==='listening';
  var isPlay=state==='playing'||state==='speaking';
  var isProc=state==='processing'||state==='thinking';

  rotY+=isRec?0.015+amp*0.02:isPlay?0.012:isProc?0.008:0.004;
  var jitter=isRec?2.5+amp*10:isPlay?3+amp*5:isProc?2:1.2;
  var breathAmp=isRec?0.15+amp*0.15:isPlay?0.1:isProc?0.08:0.03;
  var breathSpd=isRec?4:isPlay?3:2;
  var breathe=Math.sin(t*breathSpd)*breathAmp;

  for(var i=0;i<N;i++){
    var bx=tx[i]*(1+breathe),by=ty[i]*(1+breathe),bz=tz[i]*(1+breathe);
    var cY=Math.cos(rotY),sY=Math.sin(rotY);
    var rx=bx*cY-bz*sY,ry=by,rz=bx*sY+bz*cY;

    rx+=Math.sin(t*8+phase[i])*jitter;
    ry+=Math.cos(t*9+phase[i])*jitter;
    rz+=Math.sin(t*7+phase[i]*2)*jitter;

    if(isRec&&amp>0.2){
      var f=(amp-0.2)*8;
      var norm=Math.sqrt(tx[i]*tx[i]+ty[i]*ty[i]+tz[i]*tz[i])||1;
      rx+=tx[i]/norm*f*Math.sin(phase[i]*3);
      ry+=ty[i]/norm*f*Math.cos(phase[i]*5);
      rz+=tz[i]/norm*f*Math.sin(phase[i]*7);
    }

    if(isPlay){
      var ang=Math.atan2(ty[i],tx[i]);
      ry+=Math.sin(ang*3+t*6)*3*(1+amp*3);
    }

    if(isProc){
      var orb=Math.sin(t*2+phase[i]*4)*4;
      rx+=orb;ry+=Math.cos(t*2.5+phase[i]*3)*3;
    }

    vx[i]+=(rx-px[i])*0.025;vy[i]+=(ry-py[i])*0.025;vz[i]+=(rz-pz[i])*0.025;
    vx[i]*=0.84;vy[i]*=0.84;vz[i]*=0.84;
    px[i]+=vx[i];py[i]+=vy[i];pz[i]+=vz[i];
  }

  // Trail fade via destination-out (erases with semi-transparent black = slight fade of previous frame)
  ctx.globalCompositeOperation='destination-out';
  ctx.fillStyle='rgba(0,0,0,0.25)';
  ctx.fillRect(0,0,W,H);
  // Switch to additive blending for glowing particles
  ctx.globalCompositeOperation='lighter';

  for(var i=0;i<N;i++){
    var z=pz[i]+CAM;if(z<10)continue;
    var sc=FOV/z,sx=px[i]*sc+CX,sy=py[i]*sc+CY;
    var spd=Math.sqrt(vx[i]*vx[i]+vy[i]*vy[i]+vz[i]*vz[i]);
    // Lovable: a = (0.55 + spd*0.08) * (sc * 0.7)
    var a=Math.min(1,(0.55+spd*0.08)*(sc*0.7));
    // Lovable: sz = (0.9 + spd*0.15) * sc
    var sz=(0.9+spd*0.15)*sc;

    var h=(hue[i]+t*25+Math.sin(phase[i]+t)*15)%360;
    // Lovable: sat = isActive ? 85 + amp*10 : 80
    var sat=isActive?85+amp*10:80;
    // Lovable: li = isActive ? 60 + amp*18 + spd*3 : 58 + spd*2
    var li=isActive?60+amp*18+spd*3:58+spd*2;

    if(isActive){
      a=Math.min(1,a*(1.15+amp*0.5));
      sz*=(1+amp*0.35);
    }

    ctx.beginPath();ctx.arc(sx,sy,sz,0,6.2832);
    ctx.fillStyle='hsla('+h+','+sat+'%,'+li+'%,'+a+')';ctx.fill();
  }

  // Inner radial glow (green → teal)
  if(isActive){
    var gr=60+amp*50;
    var grd=ctx.createRadialGradient(CX,CY,0,CX,CY,gr);
    grd.addColorStop(0,'rgba(22,163,74,'+(0.04+amp*0.08)+')');
    grd.addColorStop(0.5,'rgba(13,148,136,'+(0.02+amp*0.04)+')');
    grd.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath();ctx.arc(CX,CY,gr,0,6.2832);ctx.fillStyle=grd;ctx.fill();
  }

  requestAnimationFrame(draw);
}

function onMsg(e){
  try{
    var d=JSON.parse(typeof e==='string'?e:(e.data||''));
    if(d.type==='state')state=d.value;
    // accept both "audioLevel" (Cropsetu legacy) and "amplitude" (Lovable naming)
    if(d.type==='audioLevel'||d.type==='amplitude')amp=d.value;
  }catch(err){}
}
document.addEventListener('message',onMsg);window.addEventListener('message',onMsg);
resize();initParticles();requestAnimationFrame(draw);
window.addEventListener('resize',resize);
})();
</script></body></html>`;

// ── Cosmic atmospheric backdrop (leaf-green + harvest-gold radial glows) ────
// Ported from cosmic-chat-companion's OKLCH gradient tokens, approximated as
// SVG RadialGradient (RN doesn't parse OKLCH). Sits behind the sphere.
function CosmicBackdrop() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        {/* leaf-green glow top-left */}
        <RadialGradient id="leafGlow" cx="20%" cy="10%" rx="75%" ry="60%" fx="20%" fy="10%">
          <Stop offset="0%" stopColor="#1F8B4E" stopOpacity="0.55" />
          <Stop offset="60%" stopColor="#0C2415" stopOpacity="0" />
        </RadialGradient>
        {/* harvest-gold glow bottom-right */}
        <RadialGradient id="harvestGlow" cx="80%" cy="90%" rx="70%" ry="60%" fx="80%" fy="90%">
          <Stop offset="0%" stopColor="#B8862C" stopOpacity="0.35" />
          <Stop offset="60%" stopColor="#0C2415" stopOpacity="0" />
        </RadialGradient>
        {/* soil warm glow center */}
        <RadialGradient id="soilGlow" cx="50%" cy="50%" rx="70%" ry="60%" fx="50%" fy="50%">
          <Stop offset="0%" stopColor="#5C3D14" stopOpacity="0.25" />
          <Stop offset="70%" stopColor="#050D08" stopOpacity="0" />
        </RadialGradient>
        {/* base vertical wash */}
        <RadialGradient id="base" cx="50%" cy="100%" rx="100%" ry="100%">
          <Stop offset="0%" stopColor="#0C2415" stopOpacity="1" />
          <Stop offset="100%" stopColor="#061109" stopOpacity="1" />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#base)" />
      <Rect width="100%" height="100%" fill="url(#soilGlow)" />
      <Rect width="100%" height="100%" fill="url(#leafGlow)" />
      <Rect width="100%" height="100%" fill="url(#harvestGlow)" />
    </Svg>
  );
}

// ── Sphere component (sized like Lovable Galaxy: default 300) ────────────────
function HolographicSphere({ state, audioLevel, size }) {
  const wvRef = useRef(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    wvRef.current?.postMessage(JSON.stringify({ type: 'state', value: state }));
  }, [state]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    wvRef.current?.postMessage(JSON.stringify({ type: 'audioLevel', value: audioLevel }));
  }, [audioLevel]);

  const wrapper = size
    ? { width: size, height: size }
    : StyleSheet.absoluteFillObject;

  if (Platform.OS === 'web') {
    return <View style={[wrapper, { backgroundColor: 'transparent' }]} />;
  }

  return (
    <View style={wrapper} pointerEvents="none">
      <WebView
        ref={wvRef}
        source={{ html: SPHERE_HTML }}
        style={{ flex: 1, backgroundColor: 'transparent' }}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        javaScriptEnabled
        originWhitelist={['*']}
        backgroundColor="transparent"
        allowsInlineMediaPlayback
      />
    </View>
  );
}

// Map app language codes to Sarvam BCP-47
const LANG_MAP = {
  en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', ta: 'ta-IN', te: 'te-IN',
  kn: 'kn-IN', gu: 'gu-IN', pa: 'pa-IN', bn: 'bn-IN', ml: 'ml-IN',
};
const LANG_NAMES = {
  en: 'English', hi: 'Hindi', mr: 'Marathi', ta: 'Tamil', te: 'Telugu',
  kn: 'Kannada', gu: 'Gujarati', pa: 'Punjabi', bn: 'Bengali', ml: 'Malayalam',
};

// ── Main screen ─────────────────────────────────────────────────────────────
export default function VoiceChatScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const farmCtx = useFarm();
  const getAIContext = farmCtx?.getAIContext || (() => ({}));
  const { language, t } = useLanguage();
  const sarvamLang = LANG_MAP[language] || 'hi-IN';
  const langName = LANG_NAMES[language] || 'Hindi';

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [conversationId, setConvId] = useState(null);

  // Transcript state — shows what user said & AI reply as floating text
  const [userTranscript, setUserTranscript] = useState('');
  const [aiReply, setAiReply] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);

  const recordRef = useRef(null);
  const lockRef = useRef(false);
  const soundRef = useRef(null);
  const silenceStartRef = useRef(null);   // first time mic went silent
  const recStartAtRef = useRef(0);        // recording start timestamp
  const maxDurationTimerRef = useRef(null); // hard cap auto-stop

  // Animations
  const transcriptFade = useRef(new Animated.Value(0)).current;
  const micScale = useRef(new Animated.Value(1)).current;

  // Sphere state
  const sphereState = isRecording ? 'recording'
    : isProcessing ? 'processing'
    : isPlaying ? 'playing'
    : 'idle';

  // Cleanup on unmount — kill mic + audio session so we don't leak resources
  useEffect(() => {
    return () => {
      if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
      if (recordRef.current) {
        try { recordRef.current.stopAndUnloadAsync(); } catch {}
        try { Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}
        recordRef.current = null;
      }
      if (soundRef.current) {
        try { soundRef.current.unloadAsync(); } catch {}
        soundRef.current = null;
      }
    };
  }, []);

  // Transcript animation
  useEffect(() => {
    Animated.timing(transcriptFade, {
      toValue: showTranscript ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [showTranscript]);

  // ── Start recording ─────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (isProcessing || isPlaying || lockRef.current) return;
    lockRef.current = true;

    // Clear previous transcripts
    setUserTranscript('');
    setAiReply('');
    setShowTranscript(false);

    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('aiChat.micPermTitle'), t('aiChat.micPermMsg'));
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true, playsInSilentModeIOS: true,
        staysActiveInBackground: false, shouldDuckAndroid: true,
      });
      const { recording } = await Audio.Recording.createAsync({
        isMeteringEnabled: true,
        android: { extension: '.m4a', outputFormat: 2, audioEncoder: 3, sampleRate: 44100, numberOfChannels: 1, bitRate: 64000 },
        ios: { extension: '.m4a', outputFormat: 'aac ', audioQuality: 0x60, sampleRate: 44100, numberOfChannels: 1, bitRate: 64000 },
        web: { mimeType: 'audio/webm', bitsPerSecond: 64000 },
      });
      recordRef.current = recording;
      recStartAtRef.current = Date.now();
      silenceStartRef.current = null;
      setIsRecording(true);

      // Mic press animation
      Animated.spring(micScale, { toValue: 0.9, useNativeDriver: true, speed: 50 }).start();

      // Hard safety cap: user left the mic open (or kept speaking past MAX).
      if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = setTimeout(() => {
        if (recordRef.current) stopAndSend();
      }, MAX_REC_MS);

      // Status callback: amplitude + silence auto-stop + session-loss handling
      recording.setOnRecordingStatusUpdate((st) => {
        if (st?.isDoneRecording) return;
        if (st && st.canRecord === false && !st.isRecording) {
          // OS preempted the audio session (incoming call, other app) — abort
          silenceStartRef.current = null;
          cancelRecording();
          return;
        }
        if (!st.isRecording || st.metering == null) return;

        setAudioLevel(Math.max(0, Math.min(1, (st.metering + 50) / 50)));

        // Silence auto-stop — matches the in-chat composer's behavior.
        const now = Date.now();
        if (st.metering < SILENCE_DB) {
          if (silenceStartRef.current == null) silenceStartRef.current = now;
          else if (now - silenceStartRef.current > SILENCE_MS) {
            silenceStartRef.current = null;
            stopAndSend();
          }
        } else {
          silenceStartRef.current = null;
        }
      });
    } catch (err) {
      Alert.alert(t('aiChat.recErrorTitle'), err?.message || 'Could not start microphone.');
    } finally {
      lockRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProcessing, isPlaying]);

  // ── Stop and send ─────────────────────────────────────────────────────────
  const stopAndSend = useCallback(async () => {
    if (!recordRef.current) return;
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    const elapsed = recStartAtRef.current ? Date.now() - recStartAtRef.current : 0;

    // Discard near-instant taps silently — nothing meaningful got recorded.
    if (elapsed < MIN_REC_MS) {
      try { await recordRef.current.stopAndUnloadAsync(); } catch {}
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}
      recordRef.current = null;
      silenceStartRef.current = null;
      setIsRecording(false); setAudioLevel(0);
      Animated.spring(micScale, { toValue: 1, useNativeDriver: true, friction: 4 }).start();
      return;
    }

    setIsRecording(false);
    setAudioLevel(0);
    setIsProcessing(true);
    silenceStartRef.current = null;
    Animated.spring(micScale, { toValue: 1, useNativeDriver: true, friction: 4 }).start();

    try {
      await recordRef.current.stopAndUnloadAsync();
      const uri = recordRef.current.getURI();
      recordRef.current = null;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const result = await sendVoiceChatMessage(uri, sarvamLang, conversationId, getAIContext());

      if (result.conversationId && !conversationId) setConvId(result.conversationId);

      const transcribed = (result.transcription || '').trim();

      // If STT returned nothing meaningful, surface a friendly hint instead of
      // a fake voice bubble + garbage reply.
      if (!transcribed) {
        setUserTranscript('');
        setAiReply('I didn’t catch that — try speaking closer to the mic.');
        setShowTranscript(true);
        setIsProcessing(false);
        return;
      }

      setUserTranscript(transcribed);
      if (result.reply) setAiReply(result.reply);
      setShowTranscript(true);

      // Play audio response if backend returned TTS audio
      if (result.audio?.audio) {
        setIsProcessing(false);
        await playBase64Audio(result.audio.audio, result.audio.mimeType || 'audio/wav');
      } else {
        setIsProcessing(false);
      }
    } catch (err) {
      recordRef.current = null;
      setAiReply(humanReadableVoiceError(err));
      setShowTranscript(true);
      setIsProcessing(false);
    }
  }, [conversationId, sarvamLang, getAIContext]);

  // ── Cancel recording ────────────────────────────────────────────────────────
  const cancelRecording = useCallback(async () => {
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    silenceStartRef.current = null;
    setIsRecording(false);
    setAudioLevel(0);
    Animated.spring(micScale, { toValue: 1, useNativeDriver: true, friction: 4 }).start();
    if (recordRef.current) {
      try { await recordRef.current.stopAndUnloadAsync(); } catch {}
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}
      recordRef.current = null;
    }
  }, []);

  // ── Play base64 audio ───────────────────────────────────────────────────────
  async function playBase64Audio(base64, mimeType) {
    try {
      setIsPlaying(true);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false, playsInSilentModeIOS: true, shouldDuckAndroid: true,
      });
      const uri = `data:${mimeType};base64,${base64}`;
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.didJustFinish) {
          setIsPlaying(false);
          sound.unloadAsync();
          soundRef.current = null;
        }
      });
    } catch {
      setIsPlaying(false);
    }
  }

  // Status text — minimum, action-only (language-agnostic)
  const statusText = isRecording ? 'Listening…'
    : isProcessing ? 'Processing…'
    : isPlaying ? 'Speaking…'
    : 'Tap to speak…';

  // Main mic button logic: idle→startRecording / recording→stopAndSend
  const onMicTap = () => {
    if (isRecording) stopAndSend();
    else if (!isProcessing && !isPlaying) startRecording();
  };

  return (
    <AnimatedScreen>
      <View style={S.root}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

        {/* ── Cosmic atmospheric backdrop (bottom layer) ── */}
        <CosmicBackdrop />

        {/* ── Full-screen particle sphere (fills whole screen, particles spread edge-to-edge) ── */}
        <HolographicSphere state={sphereState} audioLevel={audioLevel} />

        {/* ── Vignette — darken extreme top + bottom so overlays are legible ── */}
        <LinearGradient
          colors={['rgba(6,17,9,0.7)', 'transparent', 'transparent', 'rgba(6,17,9,0.88)']}
          locations={[0, 0.18, 0.65, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* ── TOP overlay: proper back button only ── */}
        <View style={[S.topOverlay, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
          <TouchableOpacity
            onPress={() => {
              if (isRecording) cancelRecording();
              navigation.goBack();
            }}
            style={S.backBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ArrowLeft size={22} color="#F0FDF4" strokeWidth={2.2} />
          </TouchableOpacity>
        </View>

        {/* ── MIDDLE-LOW overlay: state label + transcript (no timer — conversational UX) ── */}
        <View style={S.midLowOverlay} pointerEvents="box-none">
          <Text style={S.stateLabel} key={statusText}>{statusText}</Text>

          <Animated.View
            style={[S.transcriptArea, { opacity: transcriptFade }]}
            pointerEvents={showTranscript ? 'auto' : 'none'}
          >
            {userTranscript ? (
              <Text style={S.tUserTxt} numberOfLines={2}>
                <Text style={S.tYouLabel}>You: </Text>{userTranscript}
              </Text>
            ) : null}
            {aiReply ? (
              <Text style={S.tAiTxt} numberOfLines={5}>
                <Text style={S.tAiLabel}>AI: </Text>{aiReply}
              </Text>
            ) : null}
          </Animated.View>
        </View>

        {/* ── BOTTOM: 3-button glass pill ── */}
        <View style={[S.bottomSection, { paddingBottom: Math.max(insets.bottom, 20) + 14 }]}>
          <BlurView intensity={44} tint="dark" style={S.controlsPill}>
            <View style={S.controlsRow}>
              <TouchableOpacity
                style={S.ghostBtn}
                onPress={() => navigation.replace('AIChat')}
                activeOpacity={0.7}
              >
                <MessageSquare size={20} color="rgba(255,255,255,0.85)" strokeWidth={2.2} />
              </TouchableOpacity>

              <Animated.View style={{ transform: [{ scale: micScale }] }}>
                <TouchableOpacity
                  style={[
                    S.mainMicBtn,
                    (isProcessing || isPlaying) && { opacity: 0.4 },
                    isRecording && S.mainMicBtnRecording,
                  ]}
                  onPress={onMicTap}
                  disabled={isProcessing || isPlaying}
                  activeOpacity={0.85}
                >
                  {isRecording
                    ? <SquareIcon size={22} color="#0C2415" strokeWidth={3} fill="#0C2415" />
                    : <Mic size={24} color="#0C2415" strokeWidth={2.6} />}
                </TouchableOpacity>
              </Animated.View>

              <TouchableOpacity
                style={S.ghostBtn}
                onPress={() => {
                  if (isRecording) cancelRecording();
                  navigation.goBack();
                }}
                activeOpacity={0.7}
              >
                <PhoneOff size={20} color="#EF4444" strokeWidth={2.4} />
              </TouchableOpacity>
            </View>
          </BlurView>
        </View>
      </View>
    </AnimatedScreen>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const INTER_REG = 'Inter_400Regular';
const INTER_SEMI = 'Inter_600SemiBold';
const INTER_BOLD = 'Inter_700Bold';
const INTER_EXTRA = 'Inter_800ExtraBold';

// Lovable TalkTab cosmic tokens (OKLCH → hex approximations)
const HARVEST = '#F5B841';             // --accent (harvest gold)
const HARVEST_FG = '#0C2415';          // --accent-foreground (dark brown-green)
const FG = 'rgba(255,255,255,0.92)';   // --foreground

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050D08' },

  // ── TOP overlay: proper back button, left-aligned ──────────────────────────
  topOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start',
    paddingHorizontal: 16, paddingBottom: 8, zIndex: 10,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },

  // ── MID-LOW overlay: state label + transcript, sits just above the bottom pill ──
  midLowOverlay: {
    position: 'absolute', left: 0, right: 0,
    bottom: 150, alignItems: 'center',
    paddingHorizontal: 28, zIndex: 8,
  },
  stateLabel: {
    fontSize: 17, color: FG, letterSpacing: 0.6,
    textAlign: 'center', marginBottom: 10,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 10,
    fontFamily: INTER_SEMI,
  },
  transcriptArea: {
    minHeight: 48, maxWidth: 480, alignItems: 'center',
    paddingHorizontal: 12,
  },
  tYouLabel: { color: HARVEST, fontFamily: INTER_SEMI },
  tAiLabel: { color: '#4ADE80', fontFamily: INTER_SEMI },
  tUserTxt: {
    fontSize: 13, color: 'rgba(255,255,255,0.7)',
    textAlign: 'center', lineHeight: 19,
    fontFamily: INTER_REG,
  },
  tAiTxt: {
    fontSize: 14, color: 'rgba(255,255,255,0.92)',
    textAlign: 'center', lineHeight: 22, marginTop: 4,
    fontFamily: INTER_REG,
  },

  // ── BOTTOM: 3-button glass pill (floats at the bottom over the sphere) ─────
  bottomSection: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center', paddingHorizontal: 20,
    paddingTop: 8, zIndex: 10,
  },
  controlsPill: {
    borderRadius: 999, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 }, elevation: 14,
  },
  controlsRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, paddingHorizontal: 8, paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },

  // Ghost side buttons (48x48 rounded-full, transparent-ish) — matches Lovable "variant=ghost size=icon"
  ghostBtn: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent',
  },

  // Main mic button (56x56 rounded-full, harvest accent with glow) — matches Lovable accent button
  mainMicBtn: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: HARVEST,
    shadowColor: HARVEST, shadowOpacity: 0.7, shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 }, elevation: 14,
  },
  mainMicBtnRecording: {
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444', shadowOpacity: 0.7,
  },
});

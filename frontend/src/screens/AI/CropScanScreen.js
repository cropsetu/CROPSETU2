/**
 * CropScanScreen — Production-ready 4-step crop disease diagnosis wizard.
 *
 * Step 1 — Crop & Context  : crop name, age, farm info (pre-filled from FarmContext)
 * Step 2 — Symptoms        : visual symptom chips, affected %, first-noticed, free text
 * Step 3 — Photo           : camera or gallery, full preview
 * Step 4 — Analysing       : animated progress + navigate to DiagnosisResult
 *
 * All collected data is sent to Gemini Vision with full context → richest diagnosis.
 */
import { useRef, useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable, ScrollView,
  TextInput, Dimensions, Animated, Easing, StatusBar, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Linking,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import PhotoIcon from '../../components/PhotoIcon';
import SymptomImage from '../../components/SymptomImage';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '@cropsetu/shared/utils/haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { scanCropImage, newIdemKey } from '../../services/aiApi';
import { useMultiFarm } from '../../context/MultiFarmContext';
import { listCropCycles, getCropCycle } from '../../services/farmApi';
import { summarizeFertilizers, summarizePesticides, buildFarmHistory } from '../../utils/farmHistory';

import { useFarm, COMMON_CROPS, COMMON_CROP_KEYS, SOIL_TYPES, IRRIGATION_TYPES } from '../../context/FarmContext';
import { useAuth } from '@cropsetu/shared/context/AuthContext';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import { SoundEffects } from '@cropsetu/shared/utils/sounds';
import { COLORS } from '@cropsetu/shared/constants/colors';
import {
  KHET, KSPACE, KGUTTER, KRADIUS, KICON, KBORDER, circle, withAlpha,
} from '@cropsetu/shared/constants/khetTheme';
import { CropIcon } from '@cropsetu/shared/components/CropIcons';
import SoilIcon from '../../components/SoilIcons';
import IrrigationIcon from '../../components/IrrigationIcons';

const { width: W } = Dimensions.get('window');

// ─── Constants ────────────────────────────────────────────────────────────────

// Visual metadata for soil tiles — gradient backgrounds match Farm-Setup look.
// Keys mirror SOIL_TYPES in FarmContext (lowercase).
//
// NOT MIGRATED, deliberately. These 12 hexes are DATA, not theme: each pair is a
// literal depiction of a soil — black cotton IS near-black, laterite IS rust —
// so the hue is fixed by the thing it names, not by a role in the design system.
// Giving them semantic names in KHET would create tokens that mean nothing off this
// screen, which is exactly how a data palette gets laundered into a theme (see
// the header of shared/constants/dataPalette.js).
// PROPOSED: move verbatim to dataPalette.js as
//   export const SOIL_TILE_GRADIENTS = { black: [...], ..., fallback: [...] };
// alongside SECTION_TINTS, which already carries a `soilBrown` of the same kind.
const SOIL_TILE_BG = {
  black:    ['#3E3631', '#1A1512'],
  red:      ['#C45A3C', '#8B3626'],
  alluvial: ['#D4A76A', '#B8935A'],
  sandy:    ['#E8D5A3', '#C9B07A'],
  clay:     ['#8B7D6B', '#6B5D4B'],
  laterite: ['#CD7F32', '#A0522D'],
};

// Visual metadata for irrigation chips — colour + tinted bg.
//
// NOT MIGRATED, deliberately — CATEGORICAL data, same reasoning as SOIL_TILE_BG.
// Correctness here is a property of the SET (five mutually distinguishable
// accents), not of any one entry, so no single member survives being given a
// semantic name. Each `bg` is the Material 50 tint of its own `color`, so the
// pair must move together or the tile loses its tint relationship.
// PROPOSED: move verbatim to dataPalette.js as
//   export const IRRIGATION_TINTS = { drip: { color, bg }, ... };
// These are used behind an icon only, never behind text, so — like SECTION_TINTS
// — they carry no contrast guarantee and need none.
const IRR_TILE_THEME = {
  drip:      { color: '#2196F3', bg: '#E3F2FD' },
  sprinkler: { color: '#00BCD4', bg: '#E0F7FA' },
  flood:     { color: '#4CAF50', bg: '#E8F5E9' },
  rainfed:   { color: '#FF9800', bg: '#FFF3E0' },
  canal:     { color: '#3F51B5', bg: '#E8EAF6' },
};

// Keys only — labels resolved via t() at render time; each chip shows its emoji
const SYMPTOM_KEYS = [
  { key: 'yellow_leaves', tKey: 'sym_yellow_leaves', emoji: '🍂' },
  { key: 'brown_spots',   tKey: 'sym_brown_spots',   emoji: '🟤' },
  { key: 'white_powder',  tKey: 'sym_white_powder',  emoji: '🤍' },
  { key: 'wilting',       tKey: 'sym_wilting',       emoji: '🥀' },
  { key: 'insects',       tKey: 'sym_insects',       emoji: '🐛' },
  { key: 'holes',         tKey: 'sym_holes',         emoji: '🕳️' },
  { key: 'stunted',       tKey: 'sym_stunted',       emoji: '📉' },
  { key: 'fruit_damage',  tKey: 'sym_fruit_damage',  emoji: '🍅' },
  { key: 'stem_rot',      tKey: 'sym_stem_rot',      emoji: '🪵' },
  { key: 'curling_leaves',tKey: 'sym_curling_leaves',emoji: '🌀' },
  { key: 'root_rot',      tKey: 'sym_root_rot',      emoji: '💀' },
  { key: 'pale_color',    tKey: 'sym_pale_color',    emoji: '🫥' },
];

const WHEN_KEYS = [
  { key: 'today',   tKey: 'when_today'  },
  { key: '2-3days', tKey: 'when_23days' },
  { key: 'week',    tKey: 'when_week'   },
  { key: '2weeks',  tKey: 'when_2weeks' },
];

// `pct` is the numeric midpoint of each band, sent as `affectedAreaPercent`.
// Express reads farmCtx.affectedAreaPercent (a 0-100 integer) to render
// "Affected Area: N%" in the vision prompt; the client only ever sent
// `affectedArea`, the TRANSLATED label, so the prompt always said "?%".
// Both fields are sent now — `affectedArea` still feeds the report card's
// affectedAreaEstimate, so it must not be repurposed.
const AREA_KEYS = [
  { key: 'less10', pct: 5,  tLabel: 'area_less10', tDesc: 'area_less10_desc' },
  { key: '10-25',  pct: 18, tLabel: 'area_1025',   tDesc: 'area_1025_desc'   },
  { key: '25-50',  pct: 38, tLabel: 'area_2550',   tDesc: 'area_2550_desc'   },
  { key: 'over50', pct: 75, tLabel: 'area_over50', tDesc: 'area_over50_desc' },
];

// Quality tier forwarded to FastAPI's model chain selector. 'fast' is the cheap
// chain, 'best' the frontier fan-out; anything else is coerced to 'fast' on both
// sides (_scanTier in ai.routes.js, normalize_tier in FastAPI). There is no UI to
// choose yet, so this pins the wire value to what every scan already ran as
// instead of leaving the server to infer it from an absent field.
const SCAN_TIER = 'fast';

const ANALYSIS_STEP_KEYS = [
  'analysisStep0', 'analysisStep1', 'analysisStep2',
  'analysisStep3', 'analysisStep4', 'analysisStep5',
];

// ── Animation / timing constants ──────────────────────────────────────────────
// Extracted from inline magic numbers so step pacing + animation feel can be
// tuned in one place. Values are absolute delays from analysis start (ms).
const ANALYSIS_STEP_DELAYS_MS = [800, 2000, 4000, 5500, 6700];
const STEP_TRANSITION_OUT_MS  = 180;
const STEP_TRANSITION_IN_MS   = 280;
const CHIP_PRESS_DAMPING      = 15;
const CHIP_PRESS_STIFFNESS    = 200;
const CARD_FADE_IN_MS         = 380;

// ── Crop key → icon label ────────────────────────────────────────────────────
// COMMON_CROP_KEYS (lowercase) drives the UI; COMMON_CROPS (Capitalised) is
// what CropIcon expects. Deriving the icon label from the key — instead of
// indexing the second array by position — removes a silent-mismatch hazard
// if the two arrays ever drift in length or order.
function cropIconLabel(key) {
  if (!key) return '';
  return key.charAt(0).toUpperCase() + key.slice(1);
}
// Dev-time sanity check: warn loudly if the two arrays drift apart so the
// hazard isn't silent. (Stripped from prod by Metro's __DEV__ guard.)
if (typeof __DEV__ !== 'undefined' && __DEV__) {
  if (COMMON_CROPS.length !== COMMON_CROP_KEYS.length) {
    console.warn('[CropScan] COMMON_CROPS and COMMON_CROP_KEYS length mismatch — UI labels may not align with icons');
  }
}

// ── Permission-denied alert helper ────────────────────────────────────────────
// Shared by camera + gallery flows. When a permission was permanently denied
// (e.g. user tapped "Don't allow" twice on Android), re-requesting from
// ImagePicker silently fails — the user must open OS Settings. Offer that
// path directly so the flow isn't a dead-end.
function showPermissionAlert({ title, message, onOpenSettings }) {
  Alert.alert(
    title,
    message,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Settings', onPress: onOpenSettings || (() => Linking.openSettings()) },
    ],
    { cancelable: true },
  );
}

// Map a raw scan/network error to a friendly { kind, title, message } the user
// can actually act on. We never put HTTP status codes or stack snippets in the
// title/message that the user sees — those go to the console for debugging.
// Returns:
//   kind: 'network' | 'auth' | 'busy' | 'warmup' | 'timeout' | 'image' | 'server' | 'unknown'
function classifyScanError(err, t = (k, def) => def) {
  const status   = err?.response?.status ?? err?.status;
  const rawMsg   = err?.response?.data?.error?.message || err?.message || '';
  const isOffline = (err?.message || '').toLowerCase().includes('network')
                 || err?.code === 'ECONNABORTED'
                 || err?.code === 'ERR_NETWORK';

  if (err?.sessionExpired || status === 401) {
    return {
      kind: 'auth',
      title: t('cropScan.err.authTitle', 'Session expired'),
      message: t('cropScan.err.authMsg', 'Please log out and log back in to continue.'),
    };
  }
  if (status === 402 || status === 403) {
    // Out of AI credits (or daily limit). Show the server's specific message when
    // present; otherwise a clear, non-retryable explanation. Retrying just re-fails.
    return {
      kind: 'credits',
      title: t('cropScan.err.creditsTitle', 'Your AI credit limit is exhausted'),
      message: rawMsg
        || t('cropScan.err.creditsMsg', "You've used all your AI credits for this month. They refill on the 1st. Check your balance on the AI home screen."),
    };
  }
  if (status === 429) {
    return {
      kind: 'busy',
      title: t('cropScan.err.busyTitle', 'AI is busy right now'),
      message: t('cropScan.err.busyMsg', 'Too many requests at the moment. Please wait a minute and try again.'),
    };
  }
  if (status === 503) {
    return {
      kind: 'warmup',
      title: t('cropScan.err.warmupTitle', 'AI is warming up'),
      message: t('cropScan.err.warmupMsg', 'The diagnosis service is starting. Please wait about 30 seconds and try again.'),
    };
  }
  if (status === 413 || /too large|payload/i.test(rawMsg)) {
    return {
      kind: 'image',
      title: t('cropScan.err.imageTitle', 'Image too large'),
      message: t('cropScan.err.imageMsg', 'One of your photos is too big. Please remove it and try again with a smaller image.'),
    };
  }
  if (/timed out|timeout/i.test(rawMsg)) {
    return {
      kind: 'timeout',
      title: t('cropScan.err.timeoutTitle', 'Diagnosis is taking too long'),
      message: t('cropScan.err.timeoutMsg', 'The AI took longer than expected. Check your internet and try again — usually it works the second time.'),
    };
  }
  if (isOffline) {
    return {
      kind: 'network',
      title: t('cropScan.err.networkTitle', 'No internet connection'),
      message: t('cropScan.err.networkMsg', 'KrushiSarva can\'t reach the diagnosis service. Check your Wi-Fi or mobile data, then try again.'),
    };
  }
  if (status && status >= 500) {
    return {
      kind: 'server',
      title: t('cropScan.err.serverTitle', 'Something went wrong on our side'),
      message: t('cropScan.err.serverMsg', 'The diagnosis service ran into a problem. Please try again in a moment.'),
    };
  }
  // Fall-through for everything else — keep the message clean, no debug junk.
  return {
    kind: 'unknown',
    title: t('cropScan.err.unknownTitle', 'Diagnosis failed'),
    message: t('cropScan.err.unknownMsg', 'We couldn\'t finish the diagnosis. Please try again with a clearer photo.'),
  };
}

// FastAPI can return a NON-RESULT envelope instead of a diagnosis: the photos
// were unusable (`needs_rescan`) or the vision provider was down and they were
// never analysed at all (`service_unavailable`). Express flattens both to a
// single `nonResult` field and — since C5/C6 landed — charges nothing and
// persists nothing for them. The client used to play the success chime and open
// DiagnosisResultScreen anyway, so a blurry photo produced a full report card
// titled "Needs rescan" and a Gemini outage produced one whose disease name was
// the literal string "SERVICE UNAVAILABLE", both with a 0% confidence ring and a
// red VERY_LOW badge, and neither with a retake affordance.
//
// Returns the same { kind, title, message } shape classifyScanError does, so the
// existing modal renders it and its primary button already lands back on step 3
// (the photo step) — which is the correct action for both kinds.
function nonResultModal(kind, t = (k, def) => def) {
  if (kind === 'needs_rescan') {
    return {
      kind: 'rescan',
      title: t('cropScan.err.rescanTitle', 'We need a clearer photo'),
      message: t('cropScan.err.rescanMsg', 'The photo was too blurry, dark or far away to read. Take another one in daylight, close to the affected leaf. You were not charged for this.'),
    };
  }
  return {
    kind: 'warmup',
    title: t('cropScan.err.unavailableTitle', 'Diagnosis service is busy'),
    message: t('cropScan.err.unavailableMsg', 'Your photo was not analysed, so nothing was charged. Please try the scan again in a few minutes.'),
  };
}

function getCurrentSeason() {
  const m = new Date().getMonth() + 1;
  if (m >= 6 && m <= 9)   return 'Kharif (Monsoon)';
  if (m >= 10 && m <= 11) return 'Rabi sowing';
  if (m >= 12 || m <= 2)  return 'Rabi (Winter)';
  return 'Zaid (Summer)';
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StepDot({ step, current }) {
  const done   = step < current;
  const active = step === current;
  return (
    <View style={[SC.stepDot,
      done   && SC.stepDotDone,
      active && SC.stepDotActive,
    ]}>
      {done
        ? <Ionicons name="checkmark" size={10} color={COLORS.white} />
        : <Text style={[SC.stepDotNum, active && { color: COLORS.white }]}>{step}</Text>
      }
    </View>
  );
}

function StepBar({ current }) {
  return (
    <View style={SC.stepBar}>
      {[1, 2, 3].map((s, i) => (
        <View key={s} style={{ flexDirection: 'row', alignItems: 'center', flex: i < 2 ? 1 : 0 }}>
          <StepDot step={s} current={current} />
          {i < 2 && (
            <View style={[SC.stepLine, current > s && SC.stepLineDone]} />
          )}
        </View>
      ))}
    </View>
  );
}

function SectionLabel({ children }) {
  return <Text style={SC.sectionLabel}>{children}</Text>;
}

/** Chip/button with spring press scale effect */
function AnimChip({ chipStyle, onPress, children }) {
  const scale = useRef(new Animated.Value(1)).current;
  const onIn  = () => Animated.spring(scale, { toValue: 0.93, useNativeDriver: true, damping: CHIP_PRESS_DAMPING, stiffness: CHIP_PRESS_STIFFNESS }).start();
  const onOut = () => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, damping: 12, stiffness: 120 }).start();
  return (
    <Pressable onPress={onPress} onPressIn={onIn} onPressOut={onOut}>
      <Animated.View style={[chipStyle, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

/** Full-width gradient action button with spring press */
function GradientBtn({ onPress, disabled, colors = [COLORS.greenBright, COLORS.greenLive], style, children }) {
  const scale = useRef(new Animated.Value(1)).current;
  const onIn  = () => !disabled && Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, damping: CHIP_PRESS_DAMPING, stiffness: CHIP_PRESS_STIFFNESS }).start();
  const onOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 12, stiffness: 120 }).start();
  return (
    <Pressable onPress={disabled ? null : onPress} onPressIn={onIn} onPressOut={onOut}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <LinearGradient
          colors={disabled ? [COLORS.gray175, COLORS.gray175] : colors}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0.5 }}
          style={[SC.nextBtnGradient, style]}
        >
          {children}
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

/** Section that fades + slides up on mount */
function AnimCard({ delay = 0, children, style }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1, duration: CARD_FADE_IN_MS, delay,
      useNativeDriver: true,
      easing: Easing.out(Easing.cubic),
    }).start();
  }, []);
  return (
    <Animated.View style={[style, {
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
    }]}>
      {children}
    </Animated.View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function CropScanScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { t, language } = useLanguage();
  const { farmProfile, getAIContext } = useFarm();
  const { user } = useAuth();
  const { farms, activeFarm, activeFarmId } = useMultiFarm();

  // ── Farm reference (futuristic farm-context bar, mirrors AI Chat) ──
  // ON → attach the selected farm + crop-cycle history to the scan AND pull
  // the farmer's name/contact/address silently into the report (no input UI).
  const [useFarmHistory, setUseFarmHistory] = useState(true);
  const [farmPickerOpen,  setFarmPickerOpen]  = useState(false);
  const [selectedFarmId,  setSelectedFarmId]  = useState(activeFarmId);
  const [selectedCycleId, setSelectedCycleId] = useState(null);
  const [cycleOptions,    setCycleOptions]    = useState([]);
  const [loadingCycles,   setLoadingCycles]   = useState(false);

  // Picking a crop cycle auto-fills the whole context — crop, age, soil and
  // irrigation — from that cycle + its farm. Every field stays editable, so
  // the user can change/override anything afterwards.
  const applyCycle = (cycle) => {
    if (!cycle) return;
    setSelectedCycleId(cycle.id);

    // Crop (e.g. a Wheat cycle selects "Wheat"; else fall back to custom).
    const key = (cycle.cropName || '').toLowerCase().trim();
    if (key && COMMON_CROP_KEYS.includes(key)) {
      setSelectedCrop(key); setShowCustomCrop(false);
    } else if (cycle.cropName) {
      setShowCustomCrop(true); setCustomCrop(cycle.cropName); setSelectedCrop('');
    }

    // Crop age — days since sowing.
    if (cycle.sowingDate) {
      const days = Math.floor((Date.now() - new Date(cycle.sowingDate).getTime()) / 86400000);
      if (Number.isFinite(days) && days >= 0) setCropAge(String(days));
    }

    // Soil + irrigation — map the owning farm's enums to the scan's option keys.
    const farm = farms.find(x => x.id === selectedFarmId);
    const SOIL = { BLACK_COTTON: 'black', RED: 'red', ALLUVIAL: 'alluvial', SANDY: 'sandy', SANDY_LOAM: 'sandy', CLAY_LOAM: 'clay', LATERITE: 'laterite' };
    const IRR  = { DRIP: 'drip', SPRINKLER: 'sprinkler', FLOOD: 'flood', FURROW: 'flood', RAINFED: 'rainfed' };
    const soilKey = SOIL[(farm?.soilType || '').toUpperCase()];
    if (soilKey) setSoilType(soilKey);
    const irrKey = IRR[(farm?.irrigationSystem || '').toUpperCase()];
    if (irrKey) setIrrigation(irrKey);
  };

  // Default the farm selection to the active farm once it loads.
  useEffect(() => {
    if (!selectedFarmId && activeFarmId) setSelectedFarmId(activeFarmId);
  }, [activeFarmId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Load the selected farm's ACTIVE crop cycles when farm context is on, and
  // auto-apply one (keep current if still valid, else the most recent).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!useFarmHistory || !selectedFarmId) { setCycleOptions([]); return; }
      setLoadingCycles(true);
      try {
        const cycles = await listCropCycles(selectedFarmId, { status: 'ACTIVE' });
        if (cancelled) return;
        const list = Array.isArray(cycles) ? cycles : [];
        setCycleOptions(list);
        const keep = selectedCycleId && list.find(c => c.id === selectedCycleId);
        if (keep) applyCycle(keep);
        else if (list.length >= 1) applyCycle(list[0]);
        else setSelectedCycleId(null);
      } catch {
        if (!cancelled) setCycleOptions([]);
      } finally {
        if (!cancelled) setLoadingCycles(false);
      }
    })();
    return () => { cancelled = true; };
  }, [useFarmHistory, selectedFarmId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const selFarm  = farms.find(f => f.id === selectedFarmId) || null;
  const selCycle = cycleOptions.find(c => c.id === selectedCycleId) || null;

  const [step, setStep]   = useState(1);
  const stepAnim = useRef(new Animated.Value(0)).current;

  // ── Step 1: Crop & Context
  const aiCtx = getAIContext();
  const [selectedCrop,   setSelectedCrop]   = useState(aiCtx.primaryCropName || '');
  const [customCrop,     setCustomCrop]     = useState('');
  const [showCustomCrop, setShowCustomCrop] = useState(false);
  const [cropAge,        setCropAge]        = useState(
    aiCtx.primaryCropAge ? String(aiCtx.primaryCropAge) : ''
  );
  const [soilType,       setSoilType]       = useState(farmProfile.soilType || '');
  const [irrigation,     setIrrigation]     = useState(farmProfile.irrigationType || '');
  const [previousCrop,   setPreviousCrop]   = useState(farmProfile.previousCrop || '');

  // ── Step 2: Symptoms
  const [selectedSymptoms, setSelectedSymptoms] = useState(new Set());
  const [firstNoticed,     setFirstNoticed]     = useState('');
  const [affectedArea,     setAffectedArea]     = useState('');
  const [additionalText,   setAdditionalText]   = useState('');

  // ── Step 3: Photo (single — backend still receives an array of one so the
  // scanCropImage(imageUris, …) contract and the result screen keep working).
  const [imageUris,      setImageUris]      = useState([]);
  const [imageMimeTypes, setImageMimeTypes] = useState([]);
  // Single-image aliases used by the preview UI + diagnosis-result nav param.
  const imageUri      = imageUris[0] || null;
  const imageMimeType = imageMimeTypes[0] || null;

  // ── Step 4: Analysis
  const [analysisStep, setAnalysisStep]   = useState(0);
  // analysisError is now a STRUCTURED { kind, title, message } object instead
  // of a bare string with debug junk. The Modal renders title + message; the
  // raw error stays in the console for triage.
  const [analysisError, setAnalysisError] = useState(null);
  const analysisAnim = useRef(new Animated.Value(0)).current;

  // Animate step transitions (durations driven by STEP_TRANSITION_* constants)
  const goToStep = useCallback((n) => {
    Animated.timing(stepAnim, { toValue: 0, duration: STEP_TRANSITION_OUT_MS, useNativeDriver: true }).start(() => {
      setStep(n);
      Animated.timing(stepAnim, { toValue: 1, duration: STEP_TRANSITION_IN_MS, useNativeDriver: true }).start();
    });
  }, []);

  // ── Refs for cleanup + double-tap guards ────────────────────────────────
  // analysisTimersRef: holds pending setTimeout IDs so we can cancel them
  //   if the user backs out of step 4 mid-analysis. Also used to know
  //   whether we're still mounted before calling navigation.replace().
  // isPickingImageRef: prevents a second picker from launching while one
  //   is already on-screen (rapid double-tap on camera/gallery buttons).
  const analysisTimersRef = useRef([]);
  const isMountedRef       = useRef(true);
  const isPickingImageRef  = useRef(false);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      analysisTimersRef.current.forEach(id => clearTimeout(id));
      analysisTimersRef.current = [];
    };
  }, []);

  useEffect(() => {
    stepAnim.setValue(1);
  }, []);

  const cropName = showCustomCrop ? customCrop.trim() : selectedCrop;

  // ── Step 1 validation
  const step1Valid = cropName.length > 0;

  // ── Step 2 validation
  const step2Valid = selectedSymptoms.size > 0 || additionalText.trim().length > 0;

  // ── Step 3: image picker
  // Both pickers share an in-flight guard (`isPickingImageRef`) so a rapid
  // double-tap can't launch two pickers at once. Permission failures show a
  // proper title + body alert with an "Open Settings" action — since on
  // Android once a user permanently denies a permission, the in-app request
  // is silently rejected and the only recovery path is OS Settings.
  const requestPermissionOrPrompt = async (requestFn, settingsTitle, settingsMessage) => {
    const { status, canAskAgain } = await requestFn();
    if (status === 'granted') return true;
    // If we can still ask again, just bail silently (user said "no this time")
    // and only nag with the Settings path if it's permanently denied.
    showPermissionAlert({
      title: settingsTitle,
      message: canAskAgain
        ? settingsMessage
        : `${settingsMessage}\n\nThis permission is currently blocked. Tap "Open Settings" to enable it.`,
    });
    return false;
  };

  // Single-photo pipeline: a new pick REPLACES the current photo rather than
  // appending. Kept array-shaped so the scan API contract is unchanged.
  const setImage = (asset) => {
    if (!asset) return;
    setImageUris([asset.uri]);
    setImageMimeTypes([asset.mimeType || null]);
  };

  const clearImage = () => {
    setImageUris([]);
    setImageMimeTypes([]);
  };

  // Action sheet for "Retake / Replace" — lets the user swap the current photo
  // via camera or gallery without us rendering two separate buttons.
  // Uses the native Alert so the look matches the rest of the app's prompts.
  const openReplacePhotoSheet = () => {
    Alert.alert(
      t('cropScan.replacePhoto', 'Replace photo'),
      t('cropScan.addPhotoFrom', 'Choose a source'),
      [
        { text: t('cropScan.takePhoto', 'Take photo'),     onPress: pickFromCamera },
        { text: t('cropScan.chooseGallery', 'From gallery'), onPress: pickFromGallery },
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
      ],
      { cancelable: true },
    );
  };

  const pickFromGallery = async () => {
    if (isPickingImageRef.current) return;          // guard rapid double-tap
    isPickingImageRef.current = true;
    try {
      const ok = await requestPermissionOrPrompt(
        ImagePicker.requestMediaLibraryPermissionsAsync,
        t('cropScan.galleryPermissionTitle', 'Photos access needed'),
        t('cropScan.galleryPermission', 'KrushiSarva needs access to your photos to scan a crop image.'),
      );
      if (!ok) return;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images', quality: 0.85,
      });
      if (!res.canceled && res.assets?.[0]) {
        setImage(res.assets[0]);
      }
    } finally {
      isPickingImageRef.current = false;
    }
  };

  const pickFromCamera = async () => {
    if (isPickingImageRef.current) return;          // guard rapid double-tap
    isPickingImageRef.current = true;
    try {
      const ok = await requestPermissionOrPrompt(
        ImagePicker.requestCameraPermissionsAsync,
        t('cropScan.cameraPermissionTitle', 'Camera access needed'),
        t('cropScan.cameraPermission', 'KrushiSarva needs camera access to take a crop photo.'),
      );
      if (!ok) return;
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: 'images', quality: 0.85, allowsEditing: true, aspect: [4, 3],
      });
      if (!res.canceled && res.assets?.[0]) {
        setImage(res.assets[0]);
      }
    } finally {
      isPickingImageRef.current = false;
    }
  };

  // ── Step 4: analysis
  const startAnalysis = async () => {
    goToStep(4);
    setAnalysisStep(0);
    setAnalysisError(null);

    // Build complete farm context (merge user profile + farm profile)
    const farmCtx = {
      ...getAIContext(),
      // Farmer identity from AuthContext
      farmerName:       user?.name || '',
      phone:            user?.phone || '',
      village:          user?.village || '',
      pincode:          user?.pincode || '',
      // Crop details
      cropName,
      cropAge:          cropAge ? parseInt(cropAge, 10) : null,
      soilType:         soilType || farmProfile.soilType || '',
      irrigationType:   irrigation || farmProfile.irrigationType || '',
      previousCrop:     previousCrop || farmProfile.previousCrop || '',
      landSize:         farmProfile.landSize || '',
      state:            user?.state || farmProfile.location?.state || '',
      district:         user?.district || farmProfile.location?.district || '',
      city:             user?.city || farmProfile.location?.city || '',
      season:           getCurrentSeason(),
      month:            new Date().toLocaleString('en-IN', { month: 'long' }),
      symptoms:         [],
      firstNoticed:     '',
      affectedArea:     '',
      // NOTE: `affectedAreaPercent` is deliberately NOT initialised here. It is
      // assigned below only when the farmer actually picks a band, because
      // Express's _scanAffectedPercent does Number(v), and Number(null) and
      // Number('') are both 0 — seeding either would put "Affected Area: 0%" in
      // the vision prompt, which reads as "no visible damage" rather than "not
      // stated". Only an absent key reaches the intended "?%".
      tier:             SCAN_TIER,
      additionalSymptoms: additionalText.trim(),
    };

    // Animate through steps. Delays are absolute (ms from start) — see
    // ANALYSIS_STEP_DELAYS_MS at the top of the file. The previous code had
    // a dead [800, 1200, 2000, 1500, 1200] array that was mapped over but
    // never used; its values were misleading because the actual delay
    // schedule lived in the inner [800, 2000, 4000, 5500, 6700] array.
    let stepIdx = 0;
    const advance = () => {
      stepIdx++;
      if (isMountedRef.current && stepIdx < ANALYSIS_STEP_KEYS.length) {
        setAnalysisStep(stepIdx);
      }
    };
    const timers = ANALYSIS_STEP_DELAYS_MS.map(ms => setTimeout(advance, ms));
    analysisTimersRef.current = timers;

    // Build symptom labels for farm context (with translated labels)
    const symptomChipsForCtx = SYMPTOM_KEYS.map(s => ({ key: s.key, label: t(`cropScan.${s.tKey}`) }));
    farmCtx.symptoms = Array.from(selectedSymptoms).map(k => {
      const chip = symptomChipsForCtx.find(c => c.key === k);
      return chip ? chip.label : k;
    });
    const whenOpt = WHEN_KEYS.find(o => o.key === firstNoticed);
    const areaOpt = AREA_KEYS.find(o => o.key === affectedArea);
    farmCtx.firstNoticed = whenOpt ? t(`cropScan.${whenOpt.tKey}`) : '';
    farmCtx.affectedArea = areaOpt ? t(`cropScan.${areaOpt.tLabel}`) : '';
    if (areaOpt) farmCtx.affectedAreaPercent = areaOpt.pct;

    // Helper to clear all step-advance timers (cancellation point used on
    // success, error, and unmount). Centralised so we never leak timers.
    const clearStepTimers = () => {
      analysisTimersRef.current.forEach(id => clearTimeout(id));
      analysisTimersRef.current = [];
    };

    try {
      SoundEffects.scan();
      farmCtx.language = language;

      // Attach MyFarm crop-cycle history (optional toggle) into the existing
      // AI param slots (+ the new farm_history block). Best-effort: a fetch
      // failure must not block the scan.
      if (useFarmHistory && selectedFarmId && selectedCycleId) {
        try {
          const cycle = await getCropCycle(selectedCycleId);
          const farm  = farms.find(f => f.id === selectedFarmId);
          if (cycle) {
            farmCtx.variety            = cycle.variety || farmCtx.variety;
            farmCtx.plantingDate       = cycle.sowingDate || farmCtx.plantingDate;
            farmCtx.growthStage        = cycle.growthStage || farmCtx.growthStage;
            farmCtx.fertilizerHistory  = summarizeFertilizers(cycle.fertilizersUsed);
            farmCtx.recentPesticideUsed = summarizePesticides(cycle.pesticidesUsed);
            farmCtx.farmHistory        = buildFarmHistory(cycle, farm);
            if (farm) {
              // soil/irrigation now flow from the (auto-filled, user-editable)
              // form fields — don't clobber the user's choice with the raw enum.
              farmCtx.landSize = farm.landSizeAcres || farmCtx.landSize;
              farmCtx.state    = farm.state || farmCtx.state;
              farmCtx.district = farm.district || farmCtx.district;
              // Express forwards `village` into the diagnose params; the profile's
              // village is where the farmer lives, the farm's is where the crop is.
              farmCtx.village  = farm.village || farmCtx.village;
            }
          }
        } catch (e) {
          console.warn('[Scan] farm history fetch failed:', e?.message);
        }
      }

      // Report contact details — pulled SILENTLY from the profile + selected
      // farm (no input shown to the user), printed on the final report only.
      const refFarm = farms.find(f => f.id === selectedFarmId) || activeFarm;
      farmCtx.farmerName    = user?.name || '';
      farmCtx.farmerContact = user?.phone || '';
      farmCtx.farmAddress   = refFarm
        ? [refFarm.village, refFarm.taluka, refFarm.district, refFarm.state, refFarm.pincode].filter(Boolean).join(', ')
        : [user?.village, user?.district, user?.state, user?.pincode].filter(Boolean).join(', ');

      // One id per ATTEMPT, minted here (AI-04).
      //
      // The id scopes the HTTP SUBMIT, not the whole scan-and-poll. That is the
      // thing the client actually replays without the user asking: the axios
      // 401-refresh-and-replay resends the SAME config, so the same header goes
      // with it and Express dedupes. Everything after submit — the 2 s poll loop
      // — is already keyed by jobId and needs no protection.
      //
      // Scoping it to the whole scan instead was worse than not having it: the
      // id outlived the submit, so a farmer who lost signal DURING polling and
      // tapped Try again replayed the cached 200 and got the same dead jobId
      // back, forever. A user-initiated retry is a NEW attempt and must be able
      // to enqueue new work; only the invisible transport-level replay must not.
      const diagnosis = await scanCropImage(
        imageUris, farmCtx, imageMimeTypes, newIdemKey(),
      );
      clearStepTimers();
      // Bail out if the user has navigated away while we awaited the network
      // call — prevents state-update-on-unmounted warnings + redundant nav.
      if (!isMountedRef.current) return;
      setAnalysisStep(ANALYSIS_STEP_KEYS.length - 1);

      if (diagnosis.error) {
        console.error('[Scan] diagnosis.error field set:', diagnosis.error);
        setAnalysisError(classifyScanError({ message: String(diagnosis.error) }, t));
        return;
      }

      // Non-result envelope — no diagnosis exists. Must be checked BEFORE the
      // success chime and the navigation.replace below, or the farmer is walked
      // into a report screen for a scan that never happened.
      if (diagnosis.nonResult) {
        console.warn('[Scan] non-result envelope:', diagnosis.nonResult);
        setAnalysisError(nonResultModal(diagnosis.nonResult, t));
        return;
      }

      console.log('[Scan] Success — disease=', diagnosis?.disease?.name_common ?? diagnosis?.disease,
        'sessionId=', diagnosis?.sessionId, 'risk=', diagnosis?.risk_level);
      Haptics.success();
      SoundEffects.success();

      const navTimer = setTimeout(() => {
        if (!isMountedRef.current) return;        // user backed out — abort nav
        try {
          // Pass the (single-element) image array so DiagnosisResultScreen
          // can render the submitted photo. `imageUri` is kept for back-compat
          // with older screens that still read the legacy single-image param.
          navigation.replace('DiagnosisResult', {
            diagnosis,
            farmContext: farmCtx,
            imageUri,
            imageUris,
          });
        } catch (navErr) {
          console.error('[Scan] Navigation error:', navErr?.message, navErr?.stack);
          setAnalysisError({
            kind: 'unknown',
            title: t('cropScan.err.navTitle', 'Could not open results'),
            message: t('cropScan.err.navMsg', 'The diagnosis finished, but we couldn\'t open the report. Please try again.'),
          });
        }
      }, 800);
      analysisTimersRef.current.push(navTimer);
    } catch (err) {
      clearStepTimers();
      if (!isMountedRef.current) return;
      // Log full detail for triage; show a clean, friendly modal to the user.
      console.error('[Scan] error:', err?.message,
        'status=', err?.response?.status ?? err?.status,
        'body=', err?.response?.data,
      );
      setAnalysisError(classifyScanError(err, t));
    }
  };

  const stepTitles    = [t('cropScan.stepTitle1'), t('cropScan.stepTitle2'), t('cropScan.stepTitle3'), t('cropScan.stepTitle4')];
  const stepSubtitles = [t('cropScan.stepSub1'),   t('cropScan.stepSub2'),   t('cropScan.stepSub3'),   t('cropScan.stepSub4')];

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={SC.root}>
      <StatusBar barStyle="dark-content" />

      {/* ── Header ── */}
      <View style={[SC.header, { paddingTop: insets.top + KSPACE.s8 }]}>
        <TouchableOpacity
          onPress={() => step > 1 && step < 4 ? goToStep(step - 1) : navigation.goBack()}
          style={SC.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t('cropScan.back', 'Back')}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={KICON.xl} color={COLORS.greenBright} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: KSPACE.s8 }}>
          <Text style={SC.headerTitle}>{stepTitles[step - 1]}</Text>
          <Text style={SC.headerSub}>{stepSubtitles[step - 1]}</Text>
        </View>
        {step === 1 ? (
          <TouchableOpacity
            onPress={() => navigation.navigate('ScanHistory')}
            style={SC.historyBtn}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('scanHistory.cta', 'History')}
          >
            <Ionicons name="time-outline" size={KICON.sm} color={COLORS.primary} />
            <Text style={SC.historyBtnText}>{t('scanHistory.cta', 'History')}</Text>
          </TouchableOpacity>
        ) : null}
        <View style={SC.aiBadge}>
          <Ionicons name="hardware-chip" size={11} color={COLORS.primary} />
          <Text style={SC.aiBadgeText}>{t('cropScan.geminiBadge')}</Text>
        </View>
      </View>

      {/* ── Step bar (hidden on step 4) ── */}
      {step < 4 && <StepBar current={step} />}

      {/* ── Content ── */}
      <Animated.View style={[{ flex: 1 }, { opacity: stepAnim }]}>

        {/* ══════════ STEP 1: Crop & Farm Info ══════════ */}
        {step === 1 && (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={SC.scrollContent} showsVerticalScrollIndicator={false}>

              {/* ── Farm reference bar (futuristic; attaches farm + crop cycle to the AI) ── */}
              {farms.length > 0 && (
                <AnimCard delay={0} style={SC.farmBarWrap}>
                  <LinearGradient
                    colors={useFarmHistory ? ['#E9FBF0', '#F3FBF6'] : ['#F4F5F7', '#F8F9FA']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={[SC.farmBar, !useFarmHistory && { borderColor: COLORS.border }]}
                  >
                    <TouchableOpacity
                      style={SC.farmBarMain}
                      activeOpacity={useFarmHistory ? 0.7 : 1}
                      onPress={() => useFarmHistory && setFarmPickerOpen(o => !o)}
                    >
                      <View style={[SC.farmBarIcon, useFarmHistory && SC.farmBarIconOn]}>
                        <Ionicons name="leaf" size={KICON.base} color={useFarmHistory ? COLORS.white : COLORS.gray350} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={SC.farmBarTitle} numberOfLines={1}>
                          {useFarmHistory ? (selFarm?.farmName || selFarm?.farmAlias || t('cropScan.selectFarm', 'Select farm')) : t('cropScan.farmCtxOff', 'Farm context off')}
                        </Text>
                        <Text style={SC.farmBarMeta} numberOfLines={1}>
                          {!useFarmHistory
                            ? t('cropScan.farmCtxHint', 'Tap ON to personalise the AI with your farm records')
                            : selCycle
                              ? `${selCycle.cropName}${selCycle.variety ? ' · ' + selCycle.variety : ''} · ${selCycle.seasonLabel || [selCycle.season, selCycle.year].filter(Boolean).join(' ')}`
                              : selFarm
                                ? `${selFarm.landSizeAcres ?? '?'}ac · ${(selFarm.soilType || '').replace(/_/g, ' ')}`
                                : t('cropScan.tapPickCycle', 'Tap to pick a crop cycle')}
                        </Text>
                      </View>
                      {useFarmHistory && (
                        <Ionicons name={farmPickerOpen ? 'chevron-up' : 'chevron-down'} size={KICON.base} color={COLORS.textMedium} />
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[SC.farmBarToggle, useFarmHistory && SC.farmBarToggleOn]}
                      onPress={() => { setUseFarmHistory(v => !v); setFarmPickerOpen(false); }}
                      activeOpacity={0.8}
                    >
                      {/* A11Y: the ON ink was greenBright on its own 12% tint — 2.79:1.
                          COLORS.primary is the darker step of the same hue (5.52:1) and is
                          already this screen's green. The icon moves with the label so the
                          pill doesn't end up two-tone. OFF keeps gray350: an inactive
                          control, which WCAG 1.4.3 exempts. */}
                      <Ionicons name={useFarmHistory ? 'flash' : 'flash-off'} size={13} color={useFarmHistory ? COLORS.primary : COLORS.gray350} />
                      <Text style={[SC.farmBarToggleText, { color: useFarmHistory ? COLORS.primary : COLORS.gray350 }]}>
                        {useFarmHistory ? 'ON' : 'OFF'}
                      </Text>
                    </TouchableOpacity>
                  </LinearGradient>

                  {useFarmHistory && farmPickerOpen && (
                    <View style={SC.farmDrop}>
                      {farms.length > 1 && (
                        <>
                          <Text style={SC.farmDropLabel}>{t('cropScan.farmLabel', 'FARM')}</Text>
                          {farms.map(f => (
                            <TouchableOpacity key={f.id} style={[SC.farmDropItem, selectedFarmId === f.id && SC.farmDropItemOn]}
                              onPress={() => { setSelectedFarmId(f.id); setSelectedCycleId(null); }} activeOpacity={0.7}>
                              <Ionicons name={selectedFarmId === f.id ? 'radio-button-on' : 'radio-button-off'} size={KICON.base}
                                color={selectedFarmId === f.id ? COLORS.greenBright : COLORS.gray350} />
                              <View style={{ flex: 1, marginLeft: KSPACE.s8 }}>
                                <Text style={SC.farmDropName}>{f.farmName || f.farmAlias}</Text>
                                <Text style={SC.farmDropMeta}>{[f.village, f.district].filter(Boolean).join(', ')}{f.landSizeAcres ? ` · ${f.landSizeAcres}ac` : ''}</Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </>
                      )}
                      <Text style={SC.farmDropLabel}>{t('cropScan.cycleLabel', 'CROP CYCLE')}</Text>
                      {loadingCycles ? (
                        <ActivityIndicator color={COLORS.greenBright} style={{ marginVertical: KSPACE.s8 }} />
                      ) : cycleOptions.length === 0 ? (
                        <Text style={SC.farmDropEmpty}>{t('cropScan.noCycles', 'No active crop cycle on this farm')}</Text>
                      ) : (
                        cycleOptions.map(c => (
                          <TouchableOpacity key={c.id} style={[SC.farmDropItem, selectedCycleId === c.id && SC.farmDropItemOn]}
                            onPress={() => { applyCycle(c); setFarmPickerOpen(false); }} activeOpacity={0.7}>
                            <Ionicons name={selectedCycleId === c.id ? 'radio-button-on' : 'radio-button-off'} size={KICON.base}
                              color={selectedCycleId === c.id ? COLORS.greenBright : COLORS.gray350} />
                            <View style={{ flex: 1, marginLeft: KSPACE.s8 }}>
                              <Text style={SC.farmDropName}>{c.cropName}{c.variety ? ` · ${c.variety}` : ''}</Text>
                              <Text style={SC.farmDropMeta}>{c.seasonLabel || [c.season, c.year].filter(Boolean).join(' ')}</Text>
                            </View>
                          </TouchableOpacity>
                        ))
                      )}
                    </View>
                  )}
                </AnimCard>
              )}

              {/* Crop selection — 4-column grid, all crops visible */}
              <AnimCard delay={0}>
              <SectionLabel>{t('cropScan.whichCrop')}</SectionLabel>
              <View style={SC.cropGrid}>
                {COMMON_CROP_KEYS.map((k, i) => {
                  const active = !showCustomCrop && selectedCrop === k;
                  return (
                    <TouchableOpacity
                      key={k}
                      style={[SC.cropTile, active && SC.cropTileSel]}
                      onPress={() => { setSelectedCrop(k); setShowCustomCrop(false); }}
                      activeOpacity={0.8}
                    >
                      {/* Use the lowercase key directly via cropIconLabel
                          so we never depend on COMMON_CROPS[i] alignment. */}
                      <PhotoIcon
                        set="crop" name={cropIconLabel(k)} size={44} radius={8}
                        fallback={<CropIcon crop={cropIconLabel(k)} size={32} />}
                      />
                      <Text style={[SC.cropTileLabel, active && SC.cropTileLabelSel]} numberOfLines={1}>
                        {t('crops.' + k)}
                      </Text>
                      {active && (
                        <Ionicons
                          name="checkmark-circle"
                          size={KICON.sm}
                          color={COLORS.primary}
                          style={SC.cropTileCheck}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={[SC.cropTile, showCustomCrop && SC.cropTileSel]}
                  onPress={() => { setShowCustomCrop(true); setSelectedCrop(''); }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="add-circle-outline" size={40} color={showCustomCrop ? COLORS.primary : COLORS.textMedium} />
                  <Text style={[SC.cropTileLabel, showCustomCrop && SC.cropTileLabelSel]} numberOfLines={1}>
                    {t('cropScan.other')}
                  </Text>
                </TouchableOpacity>
              </View>
              </AnimCard>
              {showCustomCrop && (
                <TextInput
                  style={SC.textField}
                  placeholder={t('cropScan.enterCropName')}
                  placeholderTextColor={COLORS.gray350}
                  value={customCrop}
                  onChangeText={setCustomCrop}
                  autoFocus
                />
              )}

              {/* Crop age */}
              <SectionLabel>{t('cropScan.cropAgeDays')}</SectionLabel>
              <View style={SC.rowInputWrap}>
                <TextInput
                  style={[SC.textField, { flex: 1 }]}
                  placeholder="e.g. 45"
                  placeholderTextColor={COLORS.gray350}
                  keyboardType="number-pad"
                  value={cropAge}
                  onChangeText={v => setCropAge(v.replace(/[^0-9]/g, ''))}
                />
                <Text style={SC.inputUnit}>{t('cropScan.days')}</Text>
              </View>

              {/* Soil type — gradient square grid (6 across) */}
              <AnimCard delay={80}>
              <SectionLabel>{t('cropScan.soilTypeLabel')}</SectionLabel>
              <View style={SC.soilGrid}>
                {SOIL_TYPES.map(s => {
                  const active = soilType === s.key;
                  const bg = SOIL_TILE_BG[s.key] || ['#9E9E9E', '#757575'];
                  return (
                    <TouchableOpacity
                      key={s.key}
                      style={SC.soilCard}
                      onPress={() => setSoilType(active ? '' : s.key)}
                      activeOpacity={0.8}
                    >
                      <LinearGradient
                        colors={bg}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        style={[SC.soilSquare, active && SC.soilSquareSel]}
                      >
                        <PhotoIcon
                          set="soil" name={s.key} fill radius={KRADIUS.r12}
                          fallback={<SoilIcon type={s.key} size={28} />}
                        />
                        {active && (
                          <View style={SC.soilCheck}>
                            <Ionicons name="checkmark" size={10} color={KHET.white} />
                          </View>
                        )}
                      </LinearGradient>
                      <Text style={[SC.soilLabel, active && SC.soilLabelSel]} numberOfLines={2}>
                        {t(s.tKey)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              </AnimCard>

              {/* Irrigation — 3-per-row tile cards */}
              <AnimCard delay={140}>
              <SectionLabel>{t('cropScan.irrigationLabel')}</SectionLabel>
              <View style={SC.irrGrid}>
                {IRRIGATION_TYPES.map(ir => {
                  const active = irrigation === ir.key;
                  const theme = IRR_TILE_THEME[ir.key] || { color: COLORS.primary, bg: COLORS.greenTint };
                  return (
                    <TouchableOpacity
                      key={ir.key}
                      style={[
                        SC.irrTile,
                        active && { borderColor: theme.color, backgroundColor: theme.bg },
                      ]}
                      onPress={() => setIrrigation(active ? '' : ir.key)}
                      activeOpacity={0.8}
                    >
                      <View style={[SC.irrTileIcon, { backgroundColor: theme.bg }]}>
                        <PhotoIcon
                          set="irrigation" name={ir.key} fill radius={KRADIUS.r12}
                          fallback={<IrrigationIcon type={ir.key} size={44} />}
                        />
                      </View>
                      <Text style={[SC.irrTileLabel, active && { color: theme.color, fontWeight: '800' }]} numberOfLines={2}>
                        {t(ir.tKey)}
                      </Text>
                      {active && (
                        <View style={[SC.irrTileCheck, { backgroundColor: theme.color }]}>
                          <Ionicons name="checkmark" size={10} color={KHET.white} />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              </AnimCard>

              {/* Previous crop */}
              <SectionLabel>{t('cropScan.previousCropLabel')}</SectionLabel>
              <TextInput
                style={SC.textField}
                placeholder={t('cropScan.prevCropPlaceholder')}
                placeholderTextColor={COLORS.gray350}
                value={previousCrop}
                onChangeText={setPreviousCrop}
              />

              <View style={{ height: KSPACE.s16 }} />
            </ScrollView>

            {/* Next button */}
            <View style={[SC.footer, { paddingBottom: insets.bottom > 0 ? insets.bottom : KSPACE.s6 }]}>
              <GradientBtn
                onPress={() => goToStep(2)}
                disabled={!step1Valid}
                colors={[COLORS.greenBright, COLORS.greenLive]}
              >
                <Text style={SC.nextBtnText}>{t('cropScan.nextSymptoms')}</Text>
                <Ionicons name="arrow-forward" size={KICON.md} color={COLORS.white} />
              </GradientBtn>
            </View>
          </KeyboardAvoidingView>
        )}

        {/* ══════════ STEP 2: Symptoms ══════════ */}
        {step === 2 && (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={SC.scrollContent} showsVerticalScrollIndicator={false}>

              {/* Symptom chips */}
              <AnimCard delay={0}>
              <SectionLabel>{t('cropScan.symptomsSectionLabel')}</SectionLabel>
              <View style={SC.symptomGrid}>
                {SYMPTOM_KEYS.map(sym => {
                  const active = selectedSymptoms.has(sym.key);
                  return (
                    <AnimChip
                      key={sym.key}
                      chipStyle={[SC.symptomChip, active && SC.symptomChipActive]}
                      onPress={() => {
                        setSelectedSymptoms(prev => {
                          const next = new Set(prev);
                          next.has(sym.key) ? next.delete(sym.key) : next.add(sym.key);
                          return next;
                        });
                      }}
                    >
                      <SymptomImage symptom={sym.key} size={34} />
                      <Text style={[SC.symptomChipText, active && SC.symptomChipTextActive]}>
                        {t(`cropScan.${sym.tKey}`)}
                      </Text>
                    </AnimChip>
                  );
                })}
              </View>
              </AnimCard>

              {/* When first noticed */}
              <AnimCard delay={80}>
              <SectionLabel>{t('cropScan.whenNoticed')}</SectionLabel>
              <View style={SC.optionRow}>
                {WHEN_KEYS.map(o => (
                  <TouchableOpacity
                    key={o.key}
                    style={[SC.optionBtn, firstNoticed === o.key && SC.optionBtnActive]}
                    onPress={() => setFirstNoticed(firstNoticed === o.key ? '' : o.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={[SC.optionBtnText, firstNoticed === o.key && SC.optionBtnTextActive]} numberOfLines={2}>
                      {t(`cropScan.${o.tKey}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              </AnimCard>

              {/* Affected area */}
              <AnimCard delay={150}>
              <SectionLabel>{t('cropScan.affectedAreaLabel')}</SectionLabel>
              <View style={SC.areaRow}>
                {AREA_KEYS.map(o => (
                  <TouchableOpacity
                    key={o.key}
                    style={[SC.areaBtn, affectedArea === o.key && SC.areaBtnActive]}
                    onPress={() => setAffectedArea(affectedArea === o.key ? '' : o.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={[SC.areaBtnPct, affectedArea === o.key && SC.areaBtnPctActive]}>
                      {t(`cropScan.${o.tLabel}`)}
                    </Text>
                    {/* A11Y: greenBright on the 8% green tint was 3.02:1 → COLORS.primary, 5.97:1. */}
                    <Text style={[SC.areaBtnDesc, affectedArea === o.key && { color: COLORS.primary }]}>
                      {t(`cropScan.${o.tDesc}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              </AnimCard>

              {/* Additional text */}
              <SectionLabel>{t('cropScan.additionalDesc')}</SectionLabel>
              <TextInput
                // height 90 deliberately NOT converted to minHeight: a multiline
                // TextInput scrolls its own content, so large OS text shows fewer
                // lines but loses none — unlike the stepDot View, which clipped.
                // Switching to minHeight would also make the box grow as the user
                // types, a behaviour change this migration has no mandate for.
                style={[SC.textField, { height: 90, textAlignVertical: 'top', paddingTop: KSPACE.s12 }]}
                placeholder={t('cropScan.additionalPlaceholder')}
                placeholderTextColor={COLORS.gray350}
                multiline
                value={additionalText}
                onChangeText={setAdditionalText}
              />

              <View style={{ height: KSPACE.s16 }} />
            </ScrollView>

            <View style={[SC.footer, { paddingBottom: insets.bottom > 0 ? insets.bottom : KSPACE.s6 }]}>
              <GradientBtn
                onPress={() => goToStep(3)}
                disabled={!step2Valid}
                colors={[COLORS.greenBright, COLORS.greenLive]}
              >
                <Text style={SC.nextBtnText}>{t('cropScan.nextPhoto')}</Text>
                <Ionicons name="arrow-forward" size={KICON.md} color={COLORS.white} />
              </GradientBtn>
            </View>
          </KeyboardAvoidingView>
        )}

        {/* ══════════ STEP 3: Photo ══════════ */}
        {step === 3 && (
          <View style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={SC.scrollContent} showsVerticalScrollIndicator={false}>

            {/* Photo tip */}
            <View style={SC.photoTipCard}>
              {/* A11Y: icon follows photoTipTitle off amberDark (2.12:1 on ivoryWarm)
                  onto KHET.warningInk, 5.36:1 — see the style block. */}
              <Ionicons name="bulb-outline" size={KICON.md} color={KHET.warningInk} />
              <View style={{ flex: 1, gap: KSPACE.s3 }}>
                <Text style={SC.photoTipTitle}>{t('cropScan.photoTipsTitle')}</Text>
                <Text style={SC.photoTipText}>{t('cropScan.tip1')}</Text>
                <Text style={SC.photoTipText}>{t('cropScan.tip2')}</Text>
                <Text style={SC.photoTipText}>{t('cropScan.tip3')}</Text>
                <Text style={SC.photoTipText}>{t('cropScan.tip4')}</Text>
              </View>
            </View>

            {/* Photo picker — empty state shows the two big camera + gallery
                cards (familiar onboarding pattern). Once a photo is picked,
                the view collapses into a single full-width preview with a
                retake/replace affordance. Single-photo pipeline. */}
            {imageUri === null ? (
              <View style={SC.photoPickerWrap}>
                <TouchableOpacity
                  style={SC.photoPickerBtn}
                  onPress={pickFromCamera}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={t('cropScan.takePhoto')}
                >
                  <View style={SC.photoPickerIcon}>
                    <Ionicons name="camera" size={32} color={COLORS.primary} />
                  </View>
                  <Text style={SC.photoPickerTitle}>{t('cropScan.takePhoto')}</Text>
                  <Text style={SC.photoPickerSub}>{t('cropScan.takePhotoSub')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={SC.photoPickerBtn}
                  onPress={pickFromGallery}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={t('cropScan.chooseGallery')}
                >
                  <View style={SC.photoPickerIcon}>
                    <Ionicons name="images" size={32} color={COLORS.blue} />
                  </View>
                  <Text style={SC.photoPickerTitle}>{t('cropScan.chooseGallery')}</Text>
                  <Text style={SC.photoPickerSub}>{t('cropScan.chooseGallerySub')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                {/* Single full-width preview with a remove button. */}
                <View style={SC.previewWrap}>
                  <Image source={{ uri: imageUri }} style={SC.previewImg} resizeMode="cover" />
                  <View style={SC.previewOverlay}>
                    <View style={SC.previewBadge}>
                      {/* A11Y: this badge sits on a 65% BLACK scrim over the photo, and it
                          was carrying dark-green ink — 3.22:1 at the very best (black photo)
                          and 1.07:1 over a bright one, i.e. invisible exactly when the user
                          has taken a well-lit picture. White is >= 6.98:1 against every
                          possible photo behind it. */}
                      <Ionicons name="checkmark-circle" size={13} color={KHET.white} />
                      <Text style={SC.previewBadgeText}>{t('cropScan.photoReady', 'Photo ready')}</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={SC.photoCellRemove}
                    onPress={clearImage}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t('cropScan.removePhoto', 'Remove photo')}
                  >
                    <Ionicons name="close" size={KICON.sm} color={COLORS.white} />
                  </TouchableOpacity>
                </View>

                {/* Retake / replace affordance. */}
                <TouchableOpacity
                  style={SC.changePhotoBtn}
                  onPress={openReplacePhotoSheet}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={t('cropScan.replacePhoto', 'Replace photo')}
                >
                  {/* A11Y: icon follows changePhotoBtnText off amberDark (1.90:1 on its own
                      10% tint) onto KHET.warningInk, 4.80:1 — see the style block. */}
                  <Ionicons name="camera-reverse-outline" size={15} color={KHET.warningInk} />
                  <Text style={SC.changePhotoBtnText}>{t('cropScan.replacePhoto', 'Replace photo')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Crop summary */}
            <View style={SC.summaryCard}>
              <Text style={SC.summaryTitle}>{t('cropScan.scanSummary')}</Text>
              <View style={SC.summaryRow}>
                <Ionicons name="leaf" size={13} color={COLORS.primary} />
                <Text style={SC.summaryText}>{t('cropScan.cropLabel')} <Text style={{ color: COLORS.slate800, fontWeight: '700' }}>{cropName || '—'}</Text></Text>
              </View>
              {cropAge ? (
                <View style={SC.summaryRow}>
                  <Ionicons name="time" size={13} color={COLORS.primary} />
                  <Text style={SC.summaryText}>{t('cropScan.ageLabel')} <Text style={{ color: COLORS.slate800, fontWeight: '700' }}>{cropAge} {t('cropScan.daysUnit')}</Text></Text>
                </View>
              ) : null}
              {selectedSymptoms.size > 0 && (
                <View style={SC.summaryRow}>
                  <Ionicons name="alert-circle" size={13} color={COLORS.amberDark} />
                  <Text style={SC.summaryText} numberOfLines={2}>
                    {t('cropScan.symptomsLabel')} <Text style={{ color: COLORS.slate800, fontWeight: '700' }}>
                      {Array.from(selectedSymptoms).map(k => {
                        const sym = SYMPTOM_KEYS.find(c => c.key === k);
                        return sym ? t(`cropScan.${sym.tKey}`) : k;
                      }).join(', ')}
                    </Text>
                  </Text>
                </View>
              )}
              {(soilType || farmProfile.soilType) && (
                <View style={SC.summaryRow}>
                  <Ionicons name="layers" size={13} color={COLORS.tangerine} />
                  <Text style={SC.summaryText}>
                    {t('cropScan.soilLabel')} <Text style={{ color: COLORS.slate800, fontWeight: '700' }}>
                      {(() => { const st = SOIL_TYPES.find(s => s.key === (soilType || farmProfile.soilType)); return st ? t(st.tKey) : soilType; })()}
                    </Text>
                  </Text>
                </View>
              )}
            </View>

            {/* Breathing room so SCAN SUMMARY doesn't sit flush against the
                sticky footer border. */}
            <View style={{ height: KSPACE.s20 }} />
          </ScrollView>

          {/* Analyse button — sticky bottom (consistent with steps 1 + 2) */}
          <View style={[SC.footer, { paddingBottom: insets.bottom > 0 ? insets.bottom : KSPACE.s6 }]}>
            <GradientBtn
              onPress={startAnalysis}
              disabled={imageUris.length === 0}
              colors={[COLORS.greenBright, COLORS.greenLive]}
            >
              <Ionicons name="hardware-chip" size={KICON.md} color={COLORS.white} />
              <Text style={SC.nextBtnText}>
                {imageUris.length > 0 ? t('cropScan.runDiagnosis') : t('cropScan.selectPhotoFirst')}
              </Text>
            </GradientBtn>
          </View>
          </View>
        )}

        {/* ══════════ STEP 4: Analysing ══════════ */}
        {step === 4 && (
          <View style={SC.analysisScreen}>
            {!analysisError && (
              <>
                {/* Animated brain icon */}
                <View style={SC.analysisIconWrap}>
                  <Animated.View style={[SC.analysisIconBg]}>
                    <ActivityIndicator size="large" color={COLORS.primary} />
                  </Animated.View>
                  <Text style={SC.analysisMainText}>{t('cropScan.runningDiagnosis')}</Text>
                  <Text style={SC.analysisSubText}>{t('cropScan.geminiFarmContext')}</Text>
                </View>

                {/* Context confirmation chips */}
                <View style={SC.contextBadges}>
                  {cropName ? (
                    <View style={SC.contextBadge}>
                      <Ionicons name="leaf" size={11} color={COLORS.primary} />
                      <Text style={SC.contextBadgeText}>{cropName}</Text>
                    </View>
                  ) : null}
                  {cropAge ? (
                    <View style={SC.contextBadge}>
                      <Ionicons name="time" size={11} color={COLORS.primary} />
                      <Text style={SC.contextBadgeText}>{cropAge} days</Text>
                    </View>
                  ) : null}
                  {selectedSymptoms.size > 0 && (
                    <View style={SC.contextBadge}>
                      <Ionicons name="alert-circle" size={11} color={COLORS.amberDark} />
                      <Text style={SC.contextBadgeText}>{t('cropScan.symptomsCount', { count: selectedSymptoms.size })}</Text>
                    </View>
                  )}
                  {(farmProfile.location?.state) && (
                    <View style={SC.contextBadge}>
                      <Ionicons name="location" size={11} color={COLORS.blue} />
                      <Text style={SC.contextBadgeText}>{farmProfile.location.state}</Text>
                    </View>
                  )}
                </View>

                {/* Progress steps */}
                <View style={SC.progressList}>
                  {ANALYSIS_STEP_KEYS.map((key, i) => {
                    const isDone    = i < analysisStep;
                    const isActive  = i === analysisStep;
                    return (
                      <View key={i} style={SC.progressRow}>
                        <View style={[
                          SC.progressDot,
                          isDone  && SC.progressDotDone,
                          isActive && SC.progressDotActive,
                        ]}>
                          {isDone
                            ? <Ionicons name="checkmark" size={10} color={COLORS.white} />
                            : isActive
                              ? <ActivityIndicator size={10} color={COLORS.white} />
                              : null
                          }
                        </View>
                        <Text style={[
                          SC.progressText,
                          isDone   && SC.progressTextDone,
                          isActive && SC.progressTextActive,
                        ]}>
                          {t(`cropScan.${key}`)}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                {/* Honest timing hint — sets expectations so the wait
                    feels reasonable. */}
                <Text style={SC.analysisNote}>
                  {t('cropScan.analysisNote')}
                </Text>
              </>
            )}
          </View>
        )}

      </Animated.View>

      {/* ══════════ Friendly error modal — replaces the inline
          "Diagnosis failed [status=undefined]" code-dump. Shows a categorised
          title + readable message + actionable buttons. ══════════ */}
      <Modal
        visible={!!analysisError}
        transparent
        animationType="fade"
        onRequestClose={() => setAnalysisError(null)}
      >
        <View style={SC.errModalBackdrop}>
          <View style={SC.errModalCard}>
            <View style={[SC.errModalIcon, {
              backgroundColor: (analysisError?.kind === 'auth' || analysisError?.kind === 'credits')
                ? withAlpha(COLORS.amberDark, '20')
                : analysisError?.kind === 'network'
                  ? withAlpha(COLORS.blue, '20')
                  : withAlpha(COLORS.red, '18'),
            }]}>
              <Ionicons
                name={
                  analysisError?.kind === 'network' ? 'cloud-offline-outline'
                  : analysisError?.kind === 'auth' ? 'lock-closed-outline'
                  : analysisError?.kind === 'credits' ? 'wallet-outline'
                  : analysisError?.kind === 'busy' ? 'time-outline'
                  : analysisError?.kind === 'rescan' ? 'camera-outline'
                  : analysisError?.kind === 'warmup' ? 'flash-outline'
                  : analysisError?.kind === 'image' ? 'image-outline'
                  : analysisError?.kind === 'timeout' ? 'hourglass-outline'
                  : 'alert-circle-outline'
                }
                size={30}
                color={
                  (analysisError?.kind === 'auth' || analysisError?.kind === 'credits') ? COLORS.amberDark
                  : analysisError?.kind === 'network' ? COLORS.blue
                  : COLORS.red
                }
              />
            </View>
            <Text style={SC.errModalTitle}>
              {analysisError?.title || t('cropScan.diagnosisFailed', 'Diagnosis failed')}
            </Text>
            <Text style={SC.errModalMsg}>
              {analysisError?.message || t('cropScan.err.unknownMsg', 'Please try again.')}
            </Text>
            <View style={SC.errModalRow}>
              <TouchableOpacity
                style={SC.errModalBtnSecondary}
                onPress={() => { setAnalysisError(null); navigation.goBack(); }}
                accessibilityRole="button"
              >
                <Text style={SC.errModalBtnSecondaryTxt}>
                  {t('common.cancel', 'Cancel')}
                </Text>
              </TouchableOpacity>
              {analysisError?.kind === 'credits' ? (
                <TouchableOpacity
                  style={SC.errModalBtnPrimary}
                  onPress={() => { setAnalysisError(null); navigation.navigate('AICredits'); }}
                  accessibilityRole="button"
                >
                  <Ionicons name="wallet-outline" size={KICON.base} color={COLORS.white} />
                  <Text style={SC.errModalBtnPrimaryTxt}>
                    {t('cropScan.viewCredits', 'View credits')}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={SC.errModalBtnPrimary}
                  onPress={() => { setAnalysisError(null); goToStep(3); }}
                  accessibilityRole="button"
                >
                  <Ionicons name={analysisError?.kind === 'rescan' ? 'camera' : 'refresh'} size={KICON.base} color={COLORS.white} />
                  <Text style={SC.errModalBtnPrimaryTxt}>
                    {analysisError?.kind === 'rescan'
                      ? t('cropScan.retakePhoto', 'Retake photo')
                      : t('cropScan.tryAgain', 'Try again')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const SC = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.background },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: KGUTTER.base, paddingBottom: KSPACE.s12,
    borderBottomWidth: KBORDER.hairline, borderBottomColor: COLORS.border,
  },
  // A11y: 44dp tappable surface (chevron remains 22px but hitSlop + box hits the target).
  // 44 is a touch-target minimum, not rhythm — it has no KSPACE step and must not gain one.
  backBtn:     { width: 44, height: 44, borderRadius: KRADIUS.r10, justifyContent: 'center', alignItems: 'center', marginLeft: KSPACE.n8 },
  headerTitle: { fontSize: 16, fontWeight: '800', color: COLORS.slate800 },
  headerSub:   { fontSize: 11, color: COLORS.textMedium, marginTop: KSPACE.s2 },
  historyBtn:  { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s4, paddingHorizontal: KSPACE.s10, paddingVertical: KSPACE.s6, borderRadius: KRADIUS.r14, backgroundColor: withAlpha(COLORS.primary, '12'), marginRight: KSPACE.s8 },
  historyBtnText: { fontSize: 11, fontWeight: '800', color: COLORS.primary },
  aiBadge: {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s4,
    backgroundColor: withAlpha(COLORS.greenBright, 0.1), borderRadius: KRADIUS.r10,
    paddingHorizontal: 9, paddingVertical: 5,
    borderWidth: KBORDER.hairline, borderColor: withAlpha(COLORS.greenBright, 0.25),
  },
  // A11Y: was COLORS.greenBright on its own 10% tint — 2.76:1. COLORS.primary is
  // the darker step of the same hue and already this screen's green: 5.46:1.
  aiBadgeText: { fontSize: 10, fontWeight: '800', color: COLORS.primary },

  // Step bar
  stepBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: KSPACE.s24, paddingTop: KSPACE.s10, paddingBottom: KSPACE.s8,
  },
  // RESPONSIVE: height → minHeight. This box wraps a digit, and at the OS's 200%
  // text setting an 11px glyph leads out past the 23dp content box (26 less the
  // 1.5 border each side). A View cannot scroll, so the step number was clipped.
  // KRADIUS.pill is the size-independent form of the old `borderRadius: 26/2` —
  // RN clamps it to half the shorter side, so at rest it renders identically.
  stepDot: {
    width: 26, minHeight: 26, borderRadius: KRADIUS.pill,
    backgroundColor: COLORS.grayBg, borderWidth: KBORDER.chip, borderColor: COLORS.border,
    justifyContent: 'center', alignItems: 'center',
  },
  stepDotActive:   { backgroundColor: COLORS.greenBright, borderColor: COLORS.greenBright },
  stepDotDone:     { backgroundColor: COLORS.greenBright, borderColor: COLORS.greenBright },
  stepDotNum:      { fontSize: 11, fontWeight: '800', color: COLORS.textMedium },
  stepLine:        { flex: 1, height: 2, backgroundColor: COLORS.grayBorder, marginHorizontal: KSPACE.s4 },
  stepLineDone:    { backgroundColor: COLORS.greenBright },

  // Scroll content
  // 18 is the body gutter and it is LOAD-BEARING: the soil grid clears 360dp by
  // exactly 2.12dp and the crop grid by 1.92dp off this number. KGUTTER has no 18
  // step (14/16/20), so this is KSPACE.s18 — an exact value, not a gutter role.
  // Moving it to KGUTTER.wide or .base retunes both grids. Don't.
  scrollContent: { paddingHorizontal: KSPACE.s18, paddingTop: KSPACE.s4 },

  // Section label
  sectionLabel: {
    fontSize: 13, fontWeight: '800', color: COLORS.gray700dark,
    letterSpacing: 0.6, textTransform: 'uppercase',
    marginBottom: KSPACE.s10, marginTop: KSPACE.s14,
  },

  // Crop tile grid — 4 columns, copies OnboardingProfileScreen pattern
  // DO NOT RETUNE: width 23% + gap 8 inside the 18dp gutter clears 360dp by
  // exactly 1.92dp (4 × 74.52 + 3 × 8 = 322.08 of 324). Any change to the gutter,
  // the gap or the percentage wraps the fourth tile onto its own row.
  cropGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: KSPACE.s8 },
  cropTile: {
    width: '23%',
    backgroundColor: '#FAFAFA',
    borderRadius: KRADIUS.r12,
    paddingVertical: KSPACE.s12, paddingHorizontal: KSPACE.s6,
    alignItems: 'center',
    borderWidth: KBORDER.chip, borderColor: '#E8E8E8',
    position: 'relative',
    gap: KSPACE.s6,
  },
  cropTileSel: { borderColor: COLORS.primary, backgroundColor: withAlpha(COLORS.primary, '0C') },
  cropTileLabel: { fontSize: 11, color: '#444', textAlign: 'center', fontWeight: '600' },
  cropTileLabelSel: { color: COLORS.primary, fontWeight: '800' },
  cropTileCheck: { position: 'absolute', top: KSPACE.s4, right: KSPACE.s4 },

  // Soil tile grid — gradient squares
  // DO NOT RETUNE: width 14.5% + gap 8 inside the 18dp gutter clears 360dp by
  // exactly 2.12dp (6 × 46.98 + 5 × 8 = 321.88 of 324).
  soilGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: KSPACE.s8 },
  soilCard: { width: '31.5%', alignItems: 'center' },
  soilSquare: {
    width: '100%', aspectRatio: 1, borderRadius: KRADIUS.r12,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: KBORDER.selected, borderColor: 'transparent',
    overflow: 'hidden',
  },
  // Shadow left RAW: no KELEV tier matches. e2 is offset (0,3) / opacity .10 /
  // radius 10 / elevation 3 on ink #0e3a20; this is a tight opaque GREEN lift at
  // offset (0,2) / .35 / 4. Adopting a tier would visibly restyle the selection.
  soilSquareSel: {
    borderColor: KHET.white,
    elevation: 4,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 4,
  },
  soilCheck: {
    position: 'absolute', top: KSPACE.s3, right: KSPACE.s3,
    ...circle(18),
    backgroundColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  soilLabel: { fontSize: 12, color: '#666', marginTop: KSPACE.s6, textAlign: 'center', fontWeight: '600' },
  soilLabelSel: { color: COLORS.primary, fontWeight: '800' },

  // Irrigation tile grid — 3 per row, card style with stacked icon + label
  irrGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: KSPACE.s8 },
  irrTile: {
    flexBasis: '31.5%',
    paddingVertical: KSPACE.s8, paddingHorizontal: KSPACE.s6,
    borderRadius: KRADIUS.r14,
    borderWidth: KBORDER.chip, borderColor: '#E8E8E8',
    backgroundColor: '#FAFAFA',
    alignItems: 'center', gap: KSPACE.s8,
    position: 'relative',
  },
  irrTileIcon: {
    width: '100%', aspectRatio: 1, borderRadius: KRADIUS.r12,
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
  },
  irrTileLabel: { fontSize: 12, color: '#555', fontWeight: '700', textAlign: 'center', lineHeight: 15 },
  irrTileCheck: {
    position: 'absolute', top: KSPACE.s4, right: KSPACE.s4,
    ...circle(18),
    justifyContent: 'center', alignItems: 'center',
  },

  // Input fields
  textField: {
    backgroundColor: COLORS.white, borderRadius: KRADIUS.r12, paddingHorizontal: KSPACE.s14, paddingVertical: KSPACE.s12,
    fontSize: 14, color: COLORS.slate800,
    borderWidth: KBORDER.hairline, borderColor: COLORS.border,
    marginBottom: KSPACE.s4,
  },
  rowInputWrap: { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s10 },
  inputUnit:    { fontSize: 13, color: COLORS.textMedium, marginBottom: KSPACE.s4, width: 40 },

  // Farm reference bar (futuristic) + dropdown
  farmBarWrap: { marginBottom: KSPACE.s6 },
  farmBar: {
    flexDirection: 'row', alignItems: 'center', borderRadius: KRADIUS.r16,
    paddingVertical: KSPACE.s8, paddingLeft: KSPACE.s10, paddingRight: KSPACE.s8,
    borderWidth: KBORDER.hairline, borderColor: withAlpha(COLORS.greenLive, 0.22),
  },
  farmBarMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: KSPACE.s10 },
  farmBarIcon: {
    width: 32, height: 32, borderRadius: KRADIUS.r10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.gray175,
  },
  farmBarIconOn: { backgroundColor: COLORS.greenBright },
  farmBarTitle: { fontSize: 13.5, fontWeight: '800', color: COLORS.slate800 },
  farmBarMeta: { fontSize: 11, color: COLORS.textMedium, marginTop: KSPACE.s1 },
  farmBarToggle: {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s4, paddingHorizontal: KSPACE.s10, paddingVertical: KSPACE.s6,
    borderRadius: KRADIUS.r10, backgroundColor: COLORS.white, borderWidth: KBORDER.hairline, borderColor: COLORS.border, marginLeft: KSPACE.s8,
  },
  farmBarToggleOn: { backgroundColor: withAlpha(COLORS.greenLive, 0.12), borderColor: withAlpha(COLORS.greenLive, 0.35) },
  farmBarToggleText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  farmDrop: {
    marginTop: KSPACE.s6, backgroundColor: COLORS.white, borderRadius: KRADIUS.r14, padding: KSPACE.s10,
    borderWidth: KBORDER.hairline, borderColor: COLORS.border,
  },
  farmDropLabel: { fontSize: 10.5, fontWeight: '800', color: COLORS.gray700dark, letterSpacing: 0.6, marginTop: KSPACE.s6, marginBottom: KSPACE.s2 },
  farmDropItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: KSPACE.s8,
    borderRadius: KRADIUS.r10, marginTop: KSPACE.s4, borderWidth: KBORDER.hairline, borderColor: 'transparent',
  },
  farmDropItemOn: { backgroundColor: withAlpha(COLORS.greenLive, 0.08), borderColor: withAlpha(COLORS.greenLive, 0.20) },
  farmDropName: { fontSize: 13.5, fontWeight: '700', color: COLORS.slate800 },
  farmDropMeta: { fontSize: 11, color: COLORS.textMedium, marginTop: KSPACE.s1 },
  farmDropEmpty: { fontSize: 12, color: COLORS.textMedium, fontStyle: 'italic', marginVertical: KSPACE.s6, paddingHorizontal: KSPACE.s8 },

  // Symptom grid
  symptomGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: KSPACE.s8 },
  symptomChip: {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s8,
    backgroundColor: COLORS.white, borderRadius: KRADIUS.r12,
    paddingHorizontal: KSPACE.s8, paddingVertical: 7,
    borderWidth: KBORDER.hairline, borderColor: COLORS.border,
    // (W - 44) / 2, where 44 = the 36dp gutter pair + the 8dp gap. Two chips fill
    // the row with EXACTLY 0dp of slack at 360dp — left as authored, see gaps.
    minWidth: (W - 44) / 2, flexGrow: 1,
  },
  symptomChipActive:     { backgroundColor: COLORS.greenBright, borderColor: COLORS.greenBright },
  symptomChipText:       { fontSize: 12, color: COLORS.gray700dark, fontWeight: '600', flex: 1 },
  symptomChipTextActive: { color: COLORS.white },

  // Option buttons (when/area)
  // When-noticed chips — 4 across one row, equal share of width
  optionRow: { flexDirection: 'row', gap: KSPACE.s6 },
  optionBtn: {
    flex: 1,
    // minHeight ensures a ~44dp touch target even on small text/zoom settings.
    minHeight: 44,
    paddingVertical: KSPACE.s10, paddingHorizontal: KSPACE.s4, borderRadius: KRADIUS.r10,
    backgroundColor: COLORS.white, borderWidth: KBORDER.hairline, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  optionBtnActive:    { backgroundColor: withAlpha(COLORS.greenBright, 0.1), borderColor: COLORS.greenBright },
  optionBtnText:      { fontSize: 11, color: COLORS.gray700dark, fontWeight: '600', textAlign: 'center' },
  // A11Y: greenBright on its own 10% tint was 2.95:1 — and this is the SELECTED
  // state, so the failure landed on the option the user had just chosen. 5.84:1.
  optionBtnTextActive:{ color: COLORS.primary, fontWeight: '700' },

  // Affected area — 2x2 grid, larger tap targets
  areaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: KSPACE.s8 },
  areaBtn: {
    width: '48%',
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: KSPACE.s14, paddingHorizontal: KSPACE.s10, borderRadius: KRADIUS.r12,
    backgroundColor: COLORS.white, borderWidth: KBORDER.chip, borderColor: COLORS.border,
    gap: KSPACE.s2,
  },
  areaBtnActive:    { backgroundColor: withAlpha(COLORS.greenBright, 0.08), borderColor: COLORS.greenBright },
  areaBtnPct:       { fontSize: 15, fontWeight: '800', color: COLORS.gray700dark },
  // A11Y: 3.02:1 → 5.97:1 on the 8% tint. 15px/ExtraBold is NOT WCAG "large
  // text" (that needs 18.66px bold), so the full 4.5:1 applies here.
  areaBtnPctActive: { color: COLORS.primary },
  areaBtnDesc:      { fontSize: 11, color: COLORS.textMedium, textAlign: 'center' },

  // Photo picker
  photoTipCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: KSPACE.s12,
    backgroundColor: COLORS.ivoryWarm, borderRadius: KRADIUS.r14, padding: KSPACE.s14,
    borderWidth: KBORDER.hairline, borderColor: withAlpha(COLORS.amberDark, 0.25), marginBottom: KSPACE.s4,
  },
  // A11Y: amberDark on ivoryWarm is 2.12:1 — the same "gold used as text" failure
  // khetTheme documents for KHET.gold (2.03:1 on white). KHET.warningInk is the
  // darker step of that hue and exists for precisely this: 5.36:1.
  photoTipTitle: { fontSize: 12, fontWeight: '800', color: KHET.warningInk, marginBottom: KSPACE.s4 },
  photoTipText:  { fontSize: 11, color: COLORS.gray700dark, lineHeight: 17 },

  photoPickerWrap: { gap: KSPACE.s12, marginTop: KSPACE.s8 },
  // Shadow left RAW: opacity .04 / radius 8 / elevation 2 with NO shadowOffset
  // matches no KELEV tier (e1 is offset (0,1) / .06 / 4 / 1 on ink #0e3a20).
  // This block IS one of the 42 offset-less shadows KELEV exists to fix — it
  // renders on iOS and vanishes on Android — but adopting e1 changes the blur
  // and the ink, which is a restyle. Flagged, not fixed. See the shadow gap.
  photoPickerBtn: {
    backgroundColor: COLORS.white, borderRadius: KRADIUS.r16, padding: KSPACE.s24,
    alignItems: 'center', gap: KSPACE.s8,
    borderWidth: KBORDER.hairline, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  photoPickerIcon: {
    ...circle(64),
    backgroundColor: withAlpha(COLORS.greenBright, 0.1),
    justifyContent: 'center', alignItems: 'center',
  },
  photoPickerTitle: { fontSize: 15, fontWeight: '800', color: COLORS.slate800 },
  photoPickerSub:   { fontSize: 12, color: COLORS.textMedium },

  previewWrap:    { borderRadius: KRADIUS.r16, overflow: 'hidden', marginBottom: KSPACE.s12 },
  previewImg:     { width: '100%', height: W * 0.65, borderRadius: KRADIUS.r16 },
  previewOverlay: {
    position: 'absolute', top: KSPACE.s12, left: KSPACE.s12,
  },
  previewBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: withAlpha(COLORS.black, 0.65), borderRadius: KRADIUS.r20,
    paddingHorizontal: KSPACE.s10, paddingVertical: 5,
  },
  // A11Y: was COLORS.primary — dark green ink on a 65% BLACK scrim. 3.22:1 at the
  // very best (a black photo behind it) and 1.07:1 over a bright one, i.e. gone
  // exactly when the user has taken a well-lit picture. White is >= 6.98:1 over
  // any possible photo.
  previewBadgeText: { fontSize: 11, color: KHET.white, fontWeight: '700' },
  changePhotoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s6,
    alignSelf: 'center', marginTop: KSPACE.s8,
    paddingHorizontal: KSPACE.s14, paddingVertical: KSPACE.s8,
    backgroundColor: withAlpha(COLORS.amberDark, 0.1), borderRadius: KRADIUS.r10,
    borderWidth: KBORDER.hairline, borderColor: withAlpha(COLORS.amberDark, 0.25),
  },
  // A11Y: amberDark on its own 10% tint was 1.90:1 — the worst pairing on the
  // screen. KHET.warningInk: 4.80:1.
  changePhotoBtnText: { fontSize: 12, color: KHET.warningInk, fontWeight: '700' },

  photoCellRemove: {
    position: 'absolute', top: KSPACE.s6, right: KSPACE.s6,
    ...circle(24),
    backgroundColor: withAlpha(COLORS.black, 0.65),
    justifyContent: 'center', alignItems: 'center',
  },

  // Error modal (proper popup, replaces the inline "[status=undefined]" text)
  // The scrim is #0F172A at 55% — not a COLORS token, so it stays a literal.
  errModalBackdrop: {
    flex: 1, backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28,
  },
  errModalCard: {
    width: '100%', maxWidth: 380,
    backgroundColor: COLORS.white, borderRadius: KRADIUS.r18, padding: 22,
    shadowColor: COLORS.black, shadowOpacity: 0.15, shadowRadius: 20, elevation: 8,
  },
  errModalIcon: {
    alignSelf: 'center', ...circle(56),
    justifyContent: 'center', alignItems: 'center', marginBottom: KSPACE.s12,
  },
  errModalTitle: { fontSize: 17, fontWeight: '900', color: COLORS.slate800, textAlign: 'center', marginBottom: KSPACE.s6 },
  errModalMsg:   { fontSize: 13, color: COLORS.textMedium, textAlign: 'center', lineHeight: 19, marginBottom: KSPACE.s18 },
  errModalRow:   { flexDirection: 'row', gap: KSPACE.s8 },
  errModalBtnSecondary: {
    flex: 1, paddingVertical: KSPACE.s12, borderRadius: KRADIUS.r12,
    backgroundColor: COLORS.surface, borderWidth: KBORDER.hairline, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  errModalBtnSecondaryTxt: { fontSize: 13, fontWeight: '800', color: COLORS.gray700dark },
  errModalBtnPrimary: {
    flex: 1, paddingVertical: KSPACE.s12, borderRadius: KRADIUS.r12,
    backgroundColor: COLORS.greenBright,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: KSPACE.s6,
  },
  errModalBtnPrimaryTxt: { fontSize: 13, fontWeight: '800', color: COLORS.white },

  summaryCard: {
    backgroundColor: COLORS.white, borderRadius: KRADIUS.r14, padding: KSPACE.s14, gap: KSPACE.s8,
    borderWidth: KBORDER.hairline, borderColor: COLORS.border, marginTop: KSPACE.s8,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  summaryTitle: { fontSize: 11, fontWeight: '800', color: COLORS.textMedium, letterSpacing: 1, textTransform: 'uppercase', marginBottom: KSPACE.s4 },
  summaryRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: KSPACE.s8 },
  summaryText:  { fontSize: 12, color: COLORS.gray700dark, flex: 1 },

  // Footer / buttons — sticks tight under content, consistent across devices
  footer: {
    paddingHorizontal: KSPACE.s18, paddingTop: KSPACE.s10,
    backgroundColor: COLORS.white,
    borderTopWidth: KBORDER.hairline, borderTopColor: COLORS.grayBorder,
  },
  // Shadow left RAW: a coloured glow (greenBright, .3, radius 8, offset (0,3)),
  // which no KELEV tier expresses — they are all neutral #0e3a20 lifts.
  nextBtnGradient: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: KSPACE.s8,
    borderRadius: KRADIUS.r12, paddingVertical: KSPACE.s14,
    shadowColor: COLORS.greenBright, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  nextBtnText: { fontSize: 15, fontWeight: '800', color: COLORS.white },

  // Analysis screen
  analysisScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: KSPACE.s24 },
  analysisIconWrap: { alignItems: 'center', gap: KSPACE.s8, marginBottom: KSPACE.s24 },
  analysisIconBg: {
    ...circle(80),
    backgroundColor: withAlpha(COLORS.greenBright, 0.1),
    borderWidth: KBORDER.chip, borderColor: withAlpha(COLORS.greenBright, 0.3),
    justifyContent: 'center', alignItems: 'center', marginBottom: KSPACE.s8,
  },
  analysisMainText: { fontSize: 20, fontWeight: '900', color: COLORS.slate800, textAlign: 'center' },
  analysisSubText:  { fontSize: 12, color: COLORS.textMedium, textAlign: 'center' },

  contextBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: KSPACE.s8, justifyContent: 'center', marginBottom: KSPACE.s24 },
  contextBadge:  {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.white, borderRadius: KRADIUS.r20,
    paddingHorizontal: KSPACE.s10, paddingVertical: 5,
    borderWidth: KBORDER.hairline, borderColor: COLORS.border,
  },
  contextBadgeText: { fontSize: 11, color: COLORS.gray700dark, fontWeight: '600' },

  progressList: { gap: KSPACE.s12, width: '100%', marginBottom: KSPACE.s24 },
  progressRow:  { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s12 },
  // circle(22) is exact here, and unlike stepDot this box holds an icon or a
  // spinner rather than text, so it has nothing to clip.
  progressDot: {
    ...circle(22),
    backgroundColor: COLORS.grayBg, borderWidth: KBORDER.chip, borderColor: COLORS.border,
    justifyContent: 'center', alignItems: 'center',
  },
  progressDotDone:   { backgroundColor: COLORS.greenBright, borderColor: COLORS.greenBright },
  progressDotActive: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  progressText:      { fontSize: 13, color: COLORS.textMedium, flex: 1 },
  // A11Y: greenBright on the page background was 3.07:1 → COLORS.primary, 6.07:1.
  progressTextDone:  { color: COLORS.primary },
  progressTextActive:{ color: COLORS.slate800, fontWeight: '700' },
  analysisNote: { fontSize: 11, color: COLORS.textMedium, textAlign: 'center', fontStyle: 'italic' },
});

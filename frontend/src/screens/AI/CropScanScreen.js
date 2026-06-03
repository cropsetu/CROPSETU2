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
  Modal, Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '../../utils/haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Location   from 'expo-location';
import { scanCropImage } from '../../services/aiApi';
import { useMultiFarm } from '../../context/MultiFarmContext';
import { listCropCycles, getCropCycle } from '../../services/farmApi';
import { summarizeFertilizers, summarizePesticides, buildFarmHistory } from '../../utils/farmHistory';

import { useFarm, COMMON_CROPS, COMMON_CROP_KEYS, SOIL_TYPES, IRRIGATION_TYPES } from '../../context/FarmContext';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import FarmProfileBanner from '../../components/FarmProfileBanner';
import { SoundEffects } from '../../utils/sounds';
import { COLORS } from '../../constants/colors';
import { CropIcon } from '../../components/CropIcons';
import SoilIcon from '../../components/SoilIcons';
import IrrigationIcon from '../../components/IrrigationIcons';

const { width: W } = Dimensions.get('window');

// ─── Constants ────────────────────────────────────────────────────────────────

// Visual metadata for soil tiles — gradient backgrounds match Farm-Setup look.
// Keys mirror SOIL_TYPES in FarmContext (lowercase).
const SOIL_TILE_BG = {
  black:    ['#3E3631', '#1A1512'],
  red:      ['#C45A3C', '#8B3626'],
  alluvial: ['#D4A76A', '#B8935A'],
  sandy:    ['#E8D5A3', '#C9B07A'],
  clay:     ['#8B7D6B', '#6B5D4B'],
  laterite: ['#CD7F32', '#A0522D'],
};

// Visual metadata for irrigation chips — colour + tinted bg.
const IRR_TILE_THEME = {
  drip:      { color: '#2196F3', bg: '#E3F2FD' },
  sprinkler: { color: '#00BCD4', bg: '#E0F7FA' },
  flood:     { color: '#4CAF50', bg: '#E8F5E9' },
  rainfed:   { color: '#FF9800', bg: '#FFF3E0' },
  canal:     { color: '#3F51B5', bg: '#E8EAF6' },
};

// Keys only — labels resolved via t() at render time
const SYMPTOM_KEYS = [
  { key: 'yellow_leaves', tKey: 'sym_yellow_leaves', icon: 'leaf-outline',          emoji: '🍂' },
  { key: 'brown_spots',   tKey: 'sym_brown_spots',   icon: 'ellipse-outline',       emoji: '🟤' },
  { key: 'white_powder',  tKey: 'sym_white_powder',  icon: 'snow-outline',          emoji: '🤍' },
  { key: 'wilting',       tKey: 'sym_wilting',       icon: 'trending-down-outline', emoji: '🥀' },
  { key: 'insects',       tKey: 'sym_insects',       icon: 'bug-outline',           emoji: '🐛' },
  { key: 'holes',         tKey: 'sym_holes',         icon: 'aperture-outline',      emoji: '🕳️' },
  { key: 'stunted',       tKey: 'sym_stunted',       icon: 'resize-outline',        emoji: '📉' },
  { key: 'fruit_damage',  tKey: 'sym_fruit_damage',  icon: 'nutrition-outline',     emoji: '🍅' },
  { key: 'stem_rot',      tKey: 'sym_stem_rot',      icon: 'git-merge-outline',     emoji: '🪵' },
  { key: 'curling_leaves',tKey: 'sym_curling_leaves',icon: 'refresh-outline',       emoji: '🌀' },
  { key: 'root_rot',      tKey: 'sym_root_rot',      icon: 'git-network-outline',   emoji: '💀' },
  { key: 'pale_color',    tKey: 'sym_pale_color',    icon: 'contrast-outline',      emoji: '🫥' },
];

const WHEN_KEYS = [
  { key: 'today',   tKey: 'when_today'  },
  { key: '2-3days', tKey: 'when_23days' },
  { key: 'week',    tKey: 'when_week'   },
  { key: '2weeks',  tKey: 'when_2weeks' },
];

const AREA_KEYS = [
  { key: 'less10', tLabel: 'area_less10', tDesc: 'area_less10_desc' },
  { key: '10-25',  tLabel: 'area_1025',   tDesc: 'area_1025_desc'   },
  { key: '25-50',  tLabel: 'area_2550',   tDesc: 'area_2550_desc'   },
  { key: 'over50', tLabel: 'area_over50', tDesc: 'area_over50_desc' },
];

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
      message: t('cropScan.err.networkMsg', 'CropSetu can\'t reach the diagnosis service. Check your Wi-Fi or mobile data, then try again.'),
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

  // ── Step 3: Photos (up to 5 — backend sends all to the FastAPI pipeline)
  const MAX_IMAGES = 5;
  const [imageUris,      setImageUris]      = useState([]);
  const [imageMimeTypes, setImageMimeTypes] = useState([]);
  // Legacy single-image aliases kept so the rest of the file (preview img,
  // diagnosis-result nav param) keeps working without sprawling edits.
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

  // How many image slots are still free.
  const remainingSlots = () => MAX_IMAGES - imageUris.length;

  // Append assets to the image arrays, capped at MAX_IMAGES.
  const appendImages = (assets) => {
    const slots = remainingSlots();
    if (slots <= 0) return;
    const next = assets.slice(0, slots);
    setImageUris(prev      => [...prev, ...next.map(a => a.uri)]);
    setImageMimeTypes(prev => [...prev, ...next.map(a => a.mimeType || null)]);
  };

  const removeImageAt = (idx) => {
    setImageUris(prev      => prev.filter((_, i) => i !== idx));
    setImageMimeTypes(prev => prev.filter((_, i) => i !== idx));
  };

  // Action sheet for "Add photo" — lets the user pick camera or gallery
  // without us having to render two separate buttons in the gallery grid.
  // Uses the native Alert so the look matches the rest of the app's prompts.
  const openAddPhotoSheet = () => {
    if (remainingSlots() <= 0) return;
    Alert.alert(
      t('cropScan.addPhoto', 'Add photo'),
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
    if (remainingSlots() <= 0) return;
    isPickingImageRef.current = true;
    try {
      const ok = await requestPermissionOrPrompt(
        ImagePicker.requestMediaLibraryPermissionsAsync,
        t('cropScan.galleryPermissionTitle', 'Photos access needed'),
        t('cropScan.galleryPermission', 'CropSetu needs access to your photos to scan a crop image.'),
      );
      if (!ok) return;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images', quality: 0.85,
        allowsMultipleSelection: true,
        selectionLimit: remainingSlots(),
      });
      if (!res.canceled && res.assets?.length) {
        appendImages(res.assets);
      }
    } finally {
      isPickingImageRef.current = false;
    }
  };

  const pickFromCamera = async () => {
    if (isPickingImageRef.current) return;          // guard rapid double-tap
    if (remainingSlots() <= 0) return;
    isPickingImageRef.current = true;
    try {
      const ok = await requestPermissionOrPrompt(
        ImagePicker.requestCameraPermissionsAsync,
        t('cropScan.cameraPermissionTitle', 'Camera access needed'),
        t('cropScan.cameraPermission', 'CropSetu needs camera access to take a crop photo.'),
      );
      if (!ok) return;
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: 'images', quality: 0.85, allowsEditing: true, aspect: [4, 3],
      });
      if (!res.canceled && res.assets?.[0]) {
        appendImages([res.assets[0]]);
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
    farmCtx.firstNoticed = WHEN_KEYS.find(o => o.key === firstNoticed) ? t(`cropScan.${WHEN_KEYS.find(o => o.key === firstNoticed).tKey}`) : '';
    farmCtx.affectedArea = AREA_KEYS.find(o => o.key === affectedArea) ? t(`cropScan.${AREA_KEYS.find(o => o.key === affectedArea).tLabel}`) : '';

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

      const diagnosis = await scanCropImage(imageUris, farmCtx, imageMimeTypes);
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

      console.log('[Scan] Success — disease=', diagnosis?.disease?.name_common ?? diagnosis?.disease,
        'sessionId=', diagnosis?.sessionId, 'risk=', diagnosis?.risk_level);
      Haptics.success();
      SoundEffects.success();

      const navTimer = setTimeout(() => {
        if (!isMountedRef.current) return;        // user backed out — abort nav
        try {
          // Pass the FULL image array so DiagnosisResultScreen can render
          // every submitted photo, not just the first. `imageUri` is kept
          // for back-compat with older screens that still read the legacy
          // single-image param.
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
      <View style={[SC.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => step > 1 && step < 4 ? goToStep(step - 1) : navigation.goBack()}
          style={SC.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t('cropScan.back', 'Back')}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={22} color={COLORS.greenBright} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
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
            <Ionicons name="time-outline" size={14} color={COLORS.primary} />
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
                        <Ionicons name="leaf" size={16} color={useFarmHistory ? COLORS.white : COLORS.gray350} />
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
                        <Ionicons name={farmPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textMedium} />
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[SC.farmBarToggle, useFarmHistory && SC.farmBarToggleOn]}
                      onPress={() => { setUseFarmHistory(v => !v); setFarmPickerOpen(false); }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name={useFarmHistory ? 'flash' : 'flash-off'} size={13} color={useFarmHistory ? COLORS.greenBright : COLORS.gray350} />
                      <Text style={[SC.farmBarToggleText, { color: useFarmHistory ? COLORS.greenBright : COLORS.gray350 }]}>
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
                              <Ionicons name={selectedFarmId === f.id ? 'radio-button-on' : 'radio-button-off'} size={16}
                                color={selectedFarmId === f.id ? COLORS.greenBright : COLORS.gray350} />
                              <View style={{ flex: 1, marginLeft: 8 }}>
                                <Text style={SC.farmDropName}>{f.farmName || f.farmAlias}</Text>
                                <Text style={SC.farmDropMeta}>{[f.village, f.district].filter(Boolean).join(', ')}{f.landSizeAcres ? ` · ${f.landSizeAcres}ac` : ''}</Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </>
                      )}
                      <Text style={SC.farmDropLabel}>{t('cropScan.cycleLabel', 'CROP CYCLE')}</Text>
                      {loadingCycles ? (
                        <ActivityIndicator color={COLORS.greenBright} style={{ marginVertical: 8 }} />
                      ) : cycleOptions.length === 0 ? (
                        <Text style={SC.farmDropEmpty}>{t('cropScan.noCycles', 'No active crop cycle on this farm')}</Text>
                      ) : (
                        cycleOptions.map(c => (
                          <TouchableOpacity key={c.id} style={[SC.farmDropItem, selectedCycleId === c.id && SC.farmDropItemOn]}
                            onPress={() => { applyCycle(c); setFarmPickerOpen(false); }} activeOpacity={0.7}>
                            <Ionicons name={selectedCycleId === c.id ? 'radio-button-on' : 'radio-button-off'} size={16}
                              color={selectedCycleId === c.id ? COLORS.greenBright : COLORS.gray350} />
                            <View style={{ flex: 1, marginLeft: 8 }}>
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
                      <CropIcon crop={cropIconLabel(k)} size={32} />
                      <Text style={[SC.cropTileLabel, active && SC.cropTileLabelSel]} numberOfLines={1}>
                        {t('crops.' + k)}
                      </Text>
                      {active && (
                        <Ionicons
                          name="checkmark-circle"
                          size={14}
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
                  <Ionicons name="add-circle-outline" size={28} color={showCustomCrop ? COLORS.primary : COLORS.textMedium} />
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
                        <SoilIcon type={s.key} size={28} />
                        {active && (
                          <View style={SC.soilCheck}>
                            <Ionicons name="checkmark" size={10} color="#FFF" />
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
                        <IrrigationIcon type={ir.key} size={38} />
                      </View>
                      <Text style={[SC.irrTileLabel, active && { color: theme.color, fontWeight: '800' }]} numberOfLines={2}>
                        {t(ir.tKey)}
                      </Text>
                      {active && (
                        <View style={[SC.irrTileCheck, { backgroundColor: theme.color }]}>
                          <Ionicons name="checkmark" size={10} color="#FFF" />
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

              <View style={{ height: 16 }} />
            </ScrollView>

            {/* Next button */}
            <View style={[SC.footer, { paddingBottom: insets.bottom > 0 ? insets.bottom : 6 }]}>
              <GradientBtn
                onPress={() => goToStep(2)}
                disabled={!step1Valid}
                colors={[COLORS.greenBright, COLORS.greenLive]}
              >
                <Text style={SC.nextBtnText}>{t('cropScan.nextSymptoms')}</Text>
                <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
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
                      <Text style={{ fontSize: 18 }}>{sym.emoji}</Text>
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
                    <Text style={[SC.areaBtnDesc, affectedArea === o.key && { color: COLORS.greenBright }]}>
                      {t(`cropScan.${o.tDesc}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              </AnimCard>

              {/* Additional text */}
              <SectionLabel>{t('cropScan.additionalDesc')}</SectionLabel>
              <TextInput
                style={[SC.textField, { height: 90, textAlignVertical: 'top', paddingTop: 12 }]}
                placeholder={t('cropScan.additionalPlaceholder')}
                placeholderTextColor={COLORS.gray350}
                multiline
                value={additionalText}
                onChangeText={setAdditionalText}
              />

              <View style={{ height: 16 }} />
            </ScrollView>

            <View style={[SC.footer, { paddingBottom: insets.bottom > 0 ? insets.bottom : 6 }]}>
              <GradientBtn
                onPress={() => goToStep(3)}
                disabled={!step2Valid}
                colors={[COLORS.greenBright, COLORS.greenLive]}
              >
                <Text style={SC.nextBtnText}>{t('cropScan.nextPhoto')}</Text>
                <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
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
              <Ionicons name="bulb-outline" size={18} color={COLORS.amberDark} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={SC.photoTipTitle}>{t('cropScan.photoTipsTitle')}</Text>
                <Text style={SC.photoTipText}>{t('cropScan.tip1')}</Text>
                <Text style={SC.photoTipText}>{t('cropScan.tip2')}</Text>
                <Text style={SC.photoTipText}>{t('cropScan.tip3')}</Text>
                <Text style={SC.photoTipText}>{t('cropScan.tip4')}</Text>
              </View>
            </View>

            {/* Photo picker — empty state shows the two big camera + gallery
                cards (familiar onboarding pattern). Once any photo is picked,
                the entire view collapses into a single tidy gallery grid with
                numbered tiles and a single "Add Photo" add-slot. No more
                duplicate hero+thumb-strip pair. */}
            {imageUris.length === 0 ? (
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
              <View style={SC.photoGallery}>
                {/* Header — counter + small "Add more" button when slots remain. */}
                <View style={SC.photoGalleryHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="images" size={14} color={COLORS.primary} />
                    <Text style={SC.photoGalleryTitle}>
                      {t('cropScan.photosCount', {
                        count: imageUris.length,
                        max: MAX_IMAGES,
                        defaultValue: '{{count}}/{{max}} photos',
                      })}
                    </Text>
                  </View>
                  {imageUris.length < MAX_IMAGES && (
                    <TouchableOpacity
                      style={SC.addMoreBtn}
                      onPress={openAddPhotoSheet}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={t('cropScan.addPhoto', 'Add photo')}
                    >
                      <Ionicons name="add" size={14} color={COLORS.primary} />
                      <Text style={SC.addMoreBtnTxt}>{t('cropScan.addPhoto', 'Add photo')}</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* 3-column gallery grid — each tile shows image + index badge
                    + close button. The very first photo is highlighted as
                    "Primary" since it leads the vision-model prompt. */}
                <View style={SC.photoGrid}>
                  {imageUris.map((uri, i) => (
                    <View key={uri + i} style={SC.photoCell}>
                      <Image source={{ uri }} style={SC.photoCellImg} resizeMode="cover" />
                      <View style={[SC.photoCellBadge, i === 0 && SC.photoCellBadgePrimary]}>
                        <Text style={SC.photoCellBadgeTxt}>
                          {i === 0 ? '★' : i + 1}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={SC.photoCellRemove}
                        onPress={() => removeImageAt(i)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={t('cropScan.removePhoto', 'Remove photo')}
                      >
                        <Ionicons name="close" size={14} color={COLORS.white} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {imageUris.length < MAX_IMAGES && (
                    <TouchableOpacity
                      style={[SC.photoCell, SC.photoCellAdd]}
                      onPress={openAddPhotoSheet}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={t('cropScan.addPhoto', 'Add photo')}
                    >
                      <Ionicons name="add-circle" size={30} color={COLORS.primary} />
                      <Text style={SC.photoCellAddTxt}>{t('cropScan.addPhoto', 'Add photo')}</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* One-line hint — clear, single source of truth. */}
                <View style={SC.photoGalleryHint}>
                  <Ionicons name="information-circle-outline" size={13} color={COLORS.blue} />
                  <Text style={SC.photoGalleryHintTxt}>
                    {t(
                      'cropScan.multiPhotoHint',
                      'Add multiple angles (top, side, close-up) for a more accurate diagnosis.',
                    )}
                  </Text>
                </View>
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
            <View style={{ height: 20 }} />
          </ScrollView>

          {/* Analyse button — sticky bottom (consistent with steps 1 + 2) */}
          <View style={[SC.footer, { paddingBottom: insets.bottom > 0 ? insets.bottom : 6 }]}>
            <GradientBtn
              onPress={startAnalysis}
              disabled={imageUris.length === 0}
              colors={[COLORS.greenBright, COLORS.greenLive]}
            >
              <Ionicons name="hardware-chip" size={18} color={COLORS.white} />
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

                {/* Honest timing hint — multi-image scans take longer
                    because the vision model has more pixels to reason
                    over. Set expectations so the wait feels reasonable. */}
                <Text style={SC.analysisNote}>
                  {imageUris.length > 1
                    ? t('cropScan.analysisNoteMulti', {
                        count: imageUris.length,
                        defaultValue: 'Analysing {{count}} photos — usually 2–4 minutes for a multi-angle diagnosis',
                      })
                    : t('cropScan.analysisNote')}
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
              backgroundColor: analysisError?.kind === 'auth'
                ? COLORS.amberDark + '20'
                : analysisError?.kind === 'network'
                  ? COLORS.blue + '20'
                  : COLORS.red + '18',
            }]}>
              <Ionicons
                name={
                  analysisError?.kind === 'network' ? 'cloud-offline-outline'
                  : analysisError?.kind === 'auth' ? 'lock-closed-outline'
                  : analysisError?.kind === 'busy' ? 'time-outline'
                  : analysisError?.kind === 'warmup' ? 'flash-outline'
                  : analysisError?.kind === 'image' ? 'image-outline'
                  : analysisError?.kind === 'timeout' ? 'hourglass-outline'
                  : 'alert-circle-outline'
                }
                size={30}
                color={
                  analysisError?.kind === 'auth' ? COLORS.amberDark
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
              <TouchableOpacity
                style={SC.errModalBtnPrimary}
                onPress={() => { setAnalysisError(null); goToStep(3); }}
                accessibilityRole="button"
              >
                <Ionicons name="refresh" size={16} color={COLORS.white} />
                <Text style={SC.errModalBtnPrimaryTxt}>
                  {t('cropScan.tryAgain', 'Try again')}
                </Text>
              </TouchableOpacity>
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
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  // A11y: 44dp tappable surface (chevron remains 22px but hitSlop + box hits the target).
  backBtn:     { width: 44, height: 44, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginLeft: -8 },
  headerTitle: { fontSize: 16, fontWeight: '800', color: COLORS.slate800 },
  headerSub:   { fontSize: 11, color: COLORS.textMedium, marginTop: 2 },
  historyBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: COLORS.primary + '12', marginRight: 8 },
  historyBtnText: { fontSize: 11, fontWeight: '800', color: COLORS.primary },
  aiBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(22,163,74,0.1)', borderRadius: 10,
    paddingHorizontal: 9, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(22,163,74,0.25)',
  },
  aiBadgeText: { fontSize: 10, fontWeight: '800', color: COLORS.greenBright },

  // Step bar
  stepBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 24, paddingVertical: 14,
  },
  stepDot: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: COLORS.grayBg, borderWidth: 1.5, borderColor: COLORS.border,
    justifyContent: 'center', alignItems: 'center',
  },
  stepDotActive:   { backgroundColor: COLORS.greenBright, borderColor: COLORS.greenBright },
  stepDotDone:     { backgroundColor: COLORS.greenBright, borderColor: COLORS.greenBright },
  stepDotNum:      { fontSize: 11, fontWeight: '800', color: COLORS.textMedium },
  stepLine:        { flex: 1, height: 2, backgroundColor: COLORS.grayBorder, marginHorizontal: 4 },
  stepLineDone:    { backgroundColor: COLORS.greenBright },

  // Scroll content
  scrollContent: { paddingHorizontal: 18, paddingTop: 18 },
  farmBanner: { marginBottom: 18 },

  // Section label
  sectionLabel: {
    fontSize: 13, fontWeight: '800', color: COLORS.gray700dark,
    letterSpacing: 0.6, textTransform: 'uppercase',
    marginBottom: 10, marginTop: 20,
  },

  // Crop tile grid — 4 columns, copies OnboardingProfileScreen pattern
  cropGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cropTile: {
    width: '23%',
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1.5, borderColor: '#E8E8E8',
    position: 'relative',
    gap: 6,
  },
  cropTileSel: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '0C' },
  cropTileLabel: { fontSize: 11, color: '#444', textAlign: 'center', fontWeight: '600' },
  cropTileLabelSel: { color: COLORS.primary, fontWeight: '800' },
  cropTileCheck: { position: 'absolute', top: 4, right: 4 },

  // Soil tile grid — gradient squares
  soilGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  soilCard: { width: '14.5%', alignItems: 'center' },
  soilSquare: {
    width: '100%', aspectRatio: 1, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'transparent',
    overflow: 'hidden',
  },
  soilSquareSel: {
    borderColor: '#FFF',
    elevation: 4,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 4,
  },
  soilCheck: {
    position: 'absolute', top: 3, right: 3,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  soilLabel: { fontSize: 10, color: '#666', marginTop: 4, textAlign: 'center', fontWeight: '600' },
  soilLabelSel: { color: COLORS.primary, fontWeight: '800' },

  // Irrigation tile grid — 3 per row, card style with stacked icon + label
  irrGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  irrTile: {
    flexBasis: '31.5%', flexGrow: 1,
    paddingVertical: 14, paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 1.5, borderColor: '#E8E8E8',
    backgroundColor: '#FAFAFA',
    alignItems: 'center', gap: 8,
    position: 'relative',
  },
  irrTileIcon: {
    width: 56, height: 56, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  irrTileLabel: { fontSize: 11, color: '#555', fontWeight: '700', textAlign: 'center', lineHeight: 14 },
  irrTileCheck: {
    position: 'absolute', top: 4, right: 4,
    width: 18, height: 18, borderRadius: 9,
    justifyContent: 'center', alignItems: 'center',
  },

  // Chip row
  chipRow: { gap: 8, paddingBottom: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.white, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  chipActive:     { backgroundColor: COLORS.greenBright, borderColor: COLORS.greenBright },
  chipText:       { fontSize: 13, color: COLORS.gray700dark, fontWeight: '600' },
  chipTextActive: { color: COLORS.white },

  cropChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.white, borderRadius: 22,
    paddingLeft: 4, paddingRight: 14, paddingVertical: 4,
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  cropChipActive: { backgroundColor: COLORS.greenBright, borderColor: COLORS.greenBright },
  cropChipIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.surface, overflow: 'hidden',
    justifyContent: 'center', alignItems: 'center',
  },
  cropChipText: { fontSize: 12, color: COLORS.gray700dark, fontWeight: '700' },
  chipThumb: {
    width: 32, height: 32, borderRadius: 16,
  },

  // Input fields
  textField: {
    backgroundColor: COLORS.white, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: COLORS.slate800,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 4,
  },
  rowInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inputUnit:    { fontSize: 13, color: COLORS.textMedium, marginBottom: 4, width: 40 },

  profileHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(52,152,219,0.06)', borderRadius: 8,
    padding: 10, marginTop: 16,
    borderWidth: 1, borderColor: 'rgba(52,152,219,0.15)',
  },
  profileHintText: { fontSize: 11, color: COLORS.blue, flex: 1 },

  // Farm reference bar (futuristic) + dropdown
  farmBarWrap: { marginBottom: 6 },
  farmBar: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 16,
    paddingVertical: 8, paddingLeft: 10, paddingRight: 8,
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.22)',
  },
  farmBarMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  farmBarIcon: {
    width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.gray175,
  },
  farmBarIconOn: { backgroundColor: COLORS.greenBright },
  farmBarTitle: { fontSize: 13.5, fontWeight: '800', color: COLORS.slate800 },
  farmBarMeta: { fontSize: 11, color: COLORS.textMedium, marginTop: 1 },
  farmBarToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border, marginLeft: 8,
  },
  farmBarToggleOn: { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.35)' },
  farmBarToggleText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  farmDrop: {
    marginTop: 6, backgroundColor: COLORS.white, borderRadius: 14, padding: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  farmDropLabel: { fontSize: 10.5, fontWeight: '800', color: COLORS.gray700dark, letterSpacing: 0.6, marginTop: 6, marginBottom: 2 },
  farmDropItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 8,
    borderRadius: 10, marginTop: 4, borderWidth: 1, borderColor: 'transparent',
  },
  farmDropItemOn: { backgroundColor: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.20)' },
  farmDropName: { fontSize: 13.5, fontWeight: '700', color: COLORS.slate800 },
  farmDropMeta: { fontSize: 11, color: COLORS.textMedium, marginTop: 1 },
  farmDropEmpty: { fontSize: 12, color: COLORS.textMedium, fontStyle: 'italic', marginVertical: 6, paddingHorizontal: 8 },

  // Symptom grid
  symptomGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  symptomChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.white, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: COLORS.border,
    minWidth: (W - 44) / 2, flexGrow: 1,
  },
  symptomChipActive:     { backgroundColor: COLORS.greenBright, borderColor: COLORS.greenBright },
  symptomChipText:       { fontSize: 12, color: COLORS.gray700dark, fontWeight: '600', flex: 1 },
  symptomChipTextActive: { color: COLORS.white },

  // Option buttons (when/area)
  // When-noticed chips — 4 across one row, equal share of width
  optionRow: { flexDirection: 'row', gap: 6 },
  optionBtn: {
    flex: 1,
    // minHeight ensures a ~44dp touch target even on small text/zoom settings.
    minHeight: 44,
    paddingVertical: 10, paddingHorizontal: 4, borderRadius: 10,
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  optionBtnActive:    { backgroundColor: 'rgba(22,163,74,0.1)', borderColor: COLORS.greenBright },
  optionBtnText:      { fontSize: 11, color: COLORS.gray700dark, fontWeight: '600', textAlign: 'center' },
  optionBtnTextActive:{ color: COLORS.greenBright, fontWeight: '700' },

  // Affected area — 2x2 grid, larger tap targets
  areaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  areaBtn: {
    width: '48%',
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, paddingHorizontal: 10, borderRadius: 12,
    backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.border,
    gap: 2,
  },
  areaBtnActive:    { backgroundColor: 'rgba(22,163,74,0.08)', borderColor: COLORS.greenBright },
  areaBtnPct:       { fontSize: 15, fontWeight: '800', color: COLORS.gray700dark },
  areaBtnPctActive: { color: COLORS.greenBright },
  areaBtnDesc:      { fontSize: 11, color: COLORS.textMedium, textAlign: 'center' },

  // Photo picker
  photoTipCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: COLORS.ivoryWarm, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: 'rgba(243,156,18,0.25)', marginBottom: 4,
  },
  photoTipTitle: { fontSize: 12, fontWeight: '800', color: COLORS.amberDark, marginBottom: 4 },
  photoTipText:  { fontSize: 11, color: COLORS.gray700dark, lineHeight: 17 },

  photoPickerWrap: { gap: 12, marginTop: 8 },
  photoPickerBtn: {
    backgroundColor: COLORS.white, borderRadius: 16, padding: 24,
    alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  photoPickerIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(22,163,74,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  photoPickerTitle: { fontSize: 15, fontWeight: '800', color: COLORS.slate800 },
  photoPickerSub:   { fontSize: 12, color: COLORS.textMedium },

  previewWrap:    { borderRadius: 16, overflow: 'hidden', marginBottom: 12 },
  previewImg:     { width: '100%', height: W * 0.65, borderRadius: 16 },
  previewOverlay: {
    position: 'absolute', top: 12, left: 12,
  },
  previewBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  previewBadgeText: { fontSize: 11, color: COLORS.primary, fontWeight: '700' },
  changePhotoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'center', marginTop: 8,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: 'rgba(243,156,18,0.1)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(243,156,18,0.25)',
  },
  changePhotoBtnText: { fontSize: 12, color: COLORS.amberDark, fontWeight: '700' },

  // Multi-image gallery card — replaces the old hero-preview + thumb-strip
  // duality with a single clean grid that scales 1-to-5 images cleanly.
  photoGallery: {
    backgroundColor: COLORS.white,
    borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
    marginTop: 8, marginBottom: 8,
  },
  photoGalleryHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10, paddingHorizontal: 2,
  },
  photoGalleryTitle: { fontSize: 13, fontWeight: '800', color: COLORS.slate800 },
  addMoreBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    backgroundColor: COLORS.primary + '14',
  },
  addMoreBtnTxt: { fontSize: 11, fontWeight: '800', color: COLORS.primary },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // (card padding 12 each side ≈ 24, gaps 8×2 ≈ 16, screen padding 18×2 ≈ 36)
  // Available row width = W - 36 - 24, ÷3 = tile width.
  photoCell: {
    width: (W - 36 - 24 - 16) / 3, aspectRatio: 1,
    borderRadius: 12, overflow: 'hidden',
    backgroundColor: COLORS.surface,
    position: 'relative',
  },
  photoCellImg: { width: '100%', height: '100%' },
  photoCellBadge: {
    position: 'absolute', top: 6, left: 6,
    minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center',
  },
  photoCellBadgePrimary: { backgroundColor: COLORS.primary },
  photoCellBadgeTxt: { fontSize: 10, color: COLORS.white, fontWeight: '800' },
  photoCellRemove: {
    position: 'absolute', top: 6, right: 6,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center', alignItems: 'center',
  },
  photoCellAdd: {
    backgroundColor: COLORS.primary + '08',
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLORS.primary + '55',
    justifyContent: 'center', alignItems: 'center', gap: 4,
    padding: 6,
  },
  photoCellAddTxt: { fontSize: 11, fontWeight: '800', color: COLORS.primary, textAlign: 'center' },

  photoGalleryHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12,
    paddingHorizontal: 2,
  },
  photoGalleryHintTxt: { fontSize: 11, color: COLORS.textMedium, flex: 1, lineHeight: 16 },

  // Error modal (proper popup, replaces the inline "[status=undefined]" text)
  errModalBackdrop: {
    flex: 1, backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28,
  },
  errModalCard: {
    width: '100%', maxWidth: 380,
    backgroundColor: COLORS.white, borderRadius: 18, padding: 22,
    shadowColor: COLORS.black, shadowOpacity: 0.15, shadowRadius: 20, elevation: 8,
  },
  errModalIcon: {
    alignSelf: 'center', width: 56, height: 56, borderRadius: 28,
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  errModalTitle: { fontSize: 17, fontWeight: '900', color: COLORS.slate800, textAlign: 'center', marginBottom: 6 },
  errModalMsg:   { fontSize: 13, color: COLORS.textMedium, textAlign: 'center', lineHeight: 19, marginBottom: 18 },
  errModalRow:   { flexDirection: 'row', gap: 8 },
  errModalBtnSecondary: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  errModalBtnSecondaryTxt: { fontSize: 13, fontWeight: '800', color: COLORS.gray700dark },
  errModalBtnPrimary: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    backgroundColor: COLORS.greenBright,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6,
  },
  errModalBtnPrimaryTxt: { fontSize: 13, fontWeight: '800', color: COLORS.white },

  summaryCard: {
    backgroundColor: COLORS.white, borderRadius: 14, padding: 14, gap: 8,
    borderWidth: 1, borderColor: COLORS.border, marginTop: 8,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  summaryTitle: { fontSize: 11, fontWeight: '800', color: COLORS.textMedium, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  summaryRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  summaryText:  { fontSize: 12, color: COLORS.gray700dark, flex: 1 },

  // Footer / buttons — sticks tight under content, consistent across devices
  footer: {
    paddingHorizontal: 18, paddingTop: 10,
    backgroundColor: COLORS.white,
    borderTopWidth: 1, borderTopColor: COLORS.grayBorder,
  },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.greenBright, borderRadius: 12, paddingVertical: 14,
  },
  nextBtnGradient: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, paddingVertical: 14,
    shadowColor: COLORS.greenBright, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  nextBtnDisabled: { backgroundColor: COLORS.gray175 },
  analyseBtn:      { backgroundColor: COLORS.greenBright },
  nextBtnText: { fontSize: 15, fontWeight: '800', color: COLORS.white },

  // Analysis screen
  analysisScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  analysisIconWrap: { alignItems: 'center', gap: 8, marginBottom: 24 },
  analysisIconBg: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(22,163,74,0.1)',
    borderWidth: 1.5, borderColor: 'rgba(22,163,74,0.3)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 8,
  },
  analysisMainText: { fontSize: 20, fontWeight: '900', color: COLORS.slate800, textAlign: 'center' },
  analysisSubText:  { fontSize: 12, color: COLORS.textMedium, textAlign: 'center' },

  contextBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 24 },
  contextBadge:  {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.white, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: COLORS.border,
  },
  contextBadgeText: { fontSize: 11, color: COLORS.gray700dark, fontWeight: '600' },

  progressList: { gap: 12, width: '100%', marginBottom: 24 },
  progressRow:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  progressDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.grayBg, borderWidth: 1.5, borderColor: COLORS.border,
    justifyContent: 'center', alignItems: 'center',
  },
  progressDotDone:   { backgroundColor: COLORS.greenBright, borderColor: COLORS.greenBright },
  progressDotActive: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  progressText:      { fontSize: 13, color: COLORS.textMedium, flex: 1 },
  progressTextDone:  { color: COLORS.greenBright },
  progressTextActive:{ color: COLORS.slate800, fontWeight: '700' },
  analysisNote: { fontSize: 11, color: COLORS.textMedium, textAlign: 'center', fontStyle: 'italic' },

  // Error
  errorBox: { alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  errorTitle: { fontSize: 18, fontWeight: '900', color: COLORS.red },
  errorMsg:   { fontSize: 13, color: COLORS.textMedium, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.greenBright, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12,
    marginTop: 8,
  },
  retryBtnText: { fontSize: 14, fontWeight: '800', color: COLORS.white },
});

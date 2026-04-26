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
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '../../utils/haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Location   from 'expo-location';
import { scanCropImage } from '../../services/aiApi';
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
  const onIn  = () => Animated.spring(scale, { toValue: 0.93, useNativeDriver: true, damping: 15, stiffness: 200 }).start();
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
  const onIn  = () => !disabled && Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, damping: 15, stiffness: 200 }).start();
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
      toValue: 1, duration: 380, delay,
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

  // ── Step 3: Photo
  const [imageUri,      setImageUri]      = useState(null);
  const [imageMimeType, setImageMimeType] = useState(null);

  // ── Step 4: Analysis
  const [analysisStep, setAnalysisStep]   = useState(0);
  const [analysisError, setAnalysisError] = useState(null);
  const analysisAnim = useRef(new Animated.Value(0)).current;

  // Animate step transitions
  const goToStep = useCallback((n) => {
    Animated.timing(stepAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      setStep(n);
      Animated.timing(stepAnim, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    });
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
  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert(t('cropScan.galleryPermission')); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images', quality: 0.85, allowsEditing: true, aspect: [4, 3],
    });
    if (!res.canceled && res.assets?.[0]) {
      setImageUri(res.assets[0].uri);
      setImageMimeType(res.assets[0].mimeType || null);
    }
  };

  const pickFromCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert(t('cropScan.cameraPermission')); return; }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: 'images', quality: 0.85, allowsEditing: true, aspect: [4, 3],
    });
    if (!res.canceled && res.assets?.[0]) {
      setImageUri(res.assets[0].uri);
      setImageMimeType(res.assets[0].mimeType || null);
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

    // Animate through steps
    let stepIdx = 0;
    const advance = () => {
      stepIdx++;
      if (stepIdx < ANALYSIS_STEP_KEYS.length) setAnalysisStep(stepIdx);
    };
    const timers = [800, 1200, 2000, 1500, 1200].map((ms, i) =>
      setTimeout(() => advance(), [800, 2000, 4000, 5500, 6700][i])
    );

    // Build symptom labels for farm context (with translated labels)
    const symptomChipsForCtx = SYMPTOM_KEYS.map(s => ({ key: s.key, label: t(`cropScan.${s.tKey}`) }));
    farmCtx.symptoms = Array.from(selectedSymptoms).map(k => {
      const chip = symptomChipsForCtx.find(c => c.key === k);
      return chip ? chip.label : k;
    });
    farmCtx.firstNoticed = WHEN_KEYS.find(o => o.key === firstNoticed) ? t(`cropScan.${WHEN_KEYS.find(o => o.key === firstNoticed).tKey}`) : '';
    farmCtx.affectedArea = AREA_KEYS.find(o => o.key === affectedArea) ? t(`cropScan.${AREA_KEYS.find(o => o.key === affectedArea).tLabel}`) : '';

    try {
      SoundEffects.scan();
      farmCtx.language = language;
      const diagnosis = await scanCropImage(imageUri, farmCtx, imageMimeType);
      timers.forEach(timer => clearTimeout(timer));
      setAnalysisStep(ANALYSIS_STEP_KEYS.length - 1);

      if (diagnosis.error) {
        console.error('[Scan] diagnosis.error field set:', diagnosis.error);
        setAnalysisError(diagnosis.error);
        return;
      }

      console.log('[Scan] Success — disease=', diagnosis?.disease?.name_common ?? diagnosis?.disease,
        'sessionId=', diagnosis?.sessionId, 'risk=', diagnosis?.risk_level);
      Haptics.success();
      SoundEffects.success();

      setTimeout(() => {
        try {
          navigation.replace('DiagnosisResult', { diagnosis, farmContext: farmCtx, imageUri });
        } catch (navErr) {
          console.error('[Scan] Navigation error:', navErr?.message, navErr?.stack);
          setAnalysisError('Navigation failed: ' + navErr?.message);
        }
      }, 800);
    } catch (err) {
      timers.forEach(timer => clearTimeout(timer));
      // Show full error detail on-screen so it's visible without USB/adb
      const debugDetail = `${err?.message || 'unknown'} | status=${err?.response?.status ?? err?.status ?? 'none'}`;
      console.error('[Scan] error:', debugDetail);
      const status = err?.response?.status ?? err?.status;
      const msg = err?.sessionExpired
        ? 'Session expired. Please log out and log back in.'
        : status === 429
        ? t('cropScan.aiBusy')
        : status === 503
        ? 'AI service is warming up. Please wait 30 seconds and try again.'
        : status === 401
        ? 'Session expired. Please log out and log back in.'
        : `${t('cropScan.scanFailed')}\n\n[${debugDetail}]`;
      setAnalysisError(msg);
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

              {/* ── Farm Profile Banner ── */}
              <FarmProfileBanner
                compact
                style={SC.farmBanner}
                onEdit={() => navigation.navigate('Account')}
              />

              {/* Crop selection */}
              <AnimCard delay={0}>
              <SectionLabel>{t('cropScan.whichCrop')}</SectionLabel>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={SC.chipRow}>
                {COMMON_CROP_KEYS.map((k, i) => {
                  const active = !showCustomCrop && selectedCrop === k;
                  return (
                    <AnimChip
                      key={k}
                      chipStyle={[SC.cropChip, active && SC.cropChipActive]}
                      onPress={() => { setSelectedCrop(k); setShowCustomCrop(false); }}
                    >
                      <View style={SC.cropChipIcon}>
                        <CropIcon crop={COMMON_CROPS[i]} size={28} />
                      </View>
                      <Text style={[SC.cropChipText, active && SC.chipTextActive]}>{t('crops.' + k)}</Text>
                    </AnimChip>
                  );
                })}
                <AnimChip
                  chipStyle={[SC.chip, showCustomCrop && SC.chipActive]}
                  onPress={() => { setShowCustomCrop(true); setSelectedCrop(''); }}
                >
                  <Ionicons name="add" size={14} color={showCustomCrop ? COLORS.white : COLORS.gray550} />
                  <Text style={[SC.chipText, showCustomCrop && SC.chipTextActive]}>{t('cropScan.other')}</Text>
                </AnimChip>
              </ScrollView>
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

              {/* Soil type */}
              <AnimCard delay={80}>
              <SectionLabel>{t('cropScan.soilTypeLabel')}</SectionLabel>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={SC.chipRow}>
                {SOIL_TYPES.map(s => {
                  const active = soilType === s.key;
                  return (
                    <AnimChip
                      key={s.key}
                      chipStyle={[SC.cropChip, active && SC.cropChipActive]}
                      onPress={() => setSoilType(active ? '' : s.key)}
                    >
                      <View style={SC.chipThumb}><SoilIcon type={s.key} size={28} /></View>
                      <Text style={[SC.cropChipText, active && SC.chipTextActive]} numberOfLines={1}>{t(s.tKey)}</Text>
                    </AnimChip>
                  );
                })}
              </ScrollView>
              </AnimCard>

              {/* Irrigation */}
              <AnimCard delay={140}>
              <SectionLabel>{t('cropScan.irrigationLabel')}</SectionLabel>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={SC.chipRow}>
                {IRRIGATION_TYPES.map(ir => {
                  const active = irrigation === ir.key;
                  return (
                    <AnimChip
                      key={ir.key}
                      chipStyle={[SC.cropChip, active && SC.cropChipActive]}
                      onPress={() => setIrrigation(active ? '' : ir.key)}
                    >
                      <View style={SC.chipThumb}><IrrigationIcon type={ir.key} size={28} /></View>
                      <Text style={[SC.cropChipText, active && SC.chipTextActive]} numberOfLines={1}>{t(ir.tKey)}</Text>
                    </AnimChip>
                  );
                })}
              </ScrollView>
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

              {/* Farm profile indicator */}
              {(farmProfile.location?.state || farmProfile.landSize) && (
                <View style={SC.profileHint}>
                  <Ionicons name="information-circle-outline" size={13} color={COLORS.blue} />
                  <Text style={SC.profileHintText}>
                    {t('cropScan.farmProfileLoaded')}{' '}
                    {[farmProfile.location?.state, farmProfile.landSize ? `${farmProfile.landSize} ${t('cropScan.acresUnit')}` : null]
                      .filter(Boolean).join(' · ')}
                  </Text>
                </View>
              )}

              <View style={{ height: 120 }} />
            </ScrollView>

            {/* Next button */}
            <View style={[SC.footer, { paddingBottom: insets.bottom + 16 }]}>
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
                  <AnimChip
                    key={o.key}
                    chipStyle={[SC.optionBtn, firstNoticed === o.key && SC.optionBtnActive]}
                    onPress={() => setFirstNoticed(firstNoticed === o.key ? '' : o.key)}
                  >
                    <Text style={[SC.optionBtnText, firstNoticed === o.key && SC.optionBtnTextActive]}>
                      {t(`cropScan.${o.tKey}`)}
                    </Text>
                  </AnimChip>
                ))}
              </View>
              </AnimCard>

              {/* Affected area */}
              <AnimCard delay={150}>
              <SectionLabel>{t('cropScan.affectedAreaLabel')}</SectionLabel>
              <View style={SC.areaRow}>
                {AREA_KEYS.map(o => (
                  <AnimChip
                    key={o.key}
                    chipStyle={[SC.areaBtn, affectedArea === o.key && SC.areaBtnActive]}
                    onPress={() => setAffectedArea(affectedArea === o.key ? '' : o.key)}
                  >
                    <Text style={[SC.areaBtnPct, affectedArea === o.key && SC.areaBtnPctActive]}>
                      {t(`cropScan.${o.tLabel}`)}
                    </Text>
                    <Text style={[SC.areaBtnDesc, affectedArea === o.key && { color: COLORS.greenBright }]}>
                      {t(`cropScan.${o.tDesc}`)}
                    </Text>
                  </AnimChip>
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

              <View style={{ height: 120 }} />
            </ScrollView>

            <View style={[SC.footer, { paddingBottom: insets.bottom + 16 }]}>
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

            {/* Photo preview */}
            {imageUri ? (
              <View style={SC.previewWrap}>
                <Image source={{ uri: imageUri }} style={SC.previewImg} resizeMode="cover" />
                <View style={SC.previewOverlay}>
                  <View style={SC.previewBadge}>
                    <Ionicons name="checkmark-circle" size={16} color={COLORS.primary} />
                    <Text style={SC.previewBadgeText}>{t('cropScan.photoSelected')}</Text>
                  </View>
                </View>
                <TouchableOpacity style={SC.changePhotoBtn} onPress={() => setImageUri(null)}>
                  <Ionicons name="refresh" size={14} color={COLORS.amberDark} />
                  <Text style={SC.changePhotoBtnText}>{t('cropScan.changePhoto')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={SC.photoPickerWrap}>
                <TouchableOpacity style={SC.photoPickerBtn} onPress={pickFromCamera} activeOpacity={0.85}>
                  <View style={SC.photoPickerIcon}>
                    <Ionicons name="camera" size={32} color={COLORS.primary} />
                  </View>
                  <Text style={SC.photoPickerTitle}>{t('cropScan.takePhoto')}</Text>
                  <Text style={SC.photoPickerSub}>{t('cropScan.takePhotoSub')}</Text>
                </TouchableOpacity>

                <TouchableOpacity style={SC.photoPickerBtn} onPress={pickFromGallery} activeOpacity={0.85}>
                  <View style={SC.photoPickerIcon}>
                    <Ionicons name="images" size={32} color={COLORS.blue} />
                  </View>
                  <Text style={SC.photoPickerTitle}>{t('cropScan.chooseGallery')}</Text>
                  <Text style={SC.photoPickerSub}>{t('cropScan.chooseGallerySub')}</Text>
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

            <View style={{ height: 120 }} />

            {/* Analyse button */}
            <View style={[SC.footer, { paddingBottom: insets.bottom + 16 }]}>
              <GradientBtn
                onPress={startAnalysis}
                disabled={!imageUri}
                colors={[COLORS.lushGreen, COLORS.greenBright, COLORS.greenLive]}
              >
                <Ionicons name="hardware-chip" size={18} color={COLORS.white} />
                <Text style={SC.nextBtnText}>
                  {imageUri ? t('cropScan.runDiagnosis') : t('cropScan.selectPhotoFirst')}
                </Text>
              </GradientBtn>
            </View>
          </ScrollView>
        )}

        {/* ══════════ STEP 4: Analysing ══════════ */}
        {step === 4 && (
          <View style={SC.analysisScreen}>
            {!analysisError ? (
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

                <Text style={SC.analysisNote}>{t('cropScan.analysisNote')}</Text>
              </>
            ) : (
              <View style={SC.errorBox}>
                <Ionicons name="alert-circle" size={48} color={COLORS.red} />
                <Text style={SC.errorTitle}>{t('cropScan.diagnosisFailed')}</Text>
                <Text style={SC.errorMsg}>{analysisError}</Text>
                <TouchableOpacity style={SC.retryBtn} onPress={() => goToStep(3)}>
                  <Ionicons name="refresh" size={16} color={COLORS.white} />
                  <Text style={SC.retryBtnText}>{t('cropScan.tryAgain')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

      </Animated.View>
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
  backBtn:     { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
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
  optionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  optionBtn: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border,
  },
  optionBtnActive:    { backgroundColor: 'rgba(22,163,74,0.1)', borderColor: COLORS.greenBright },
  optionBtnText:      { fontSize: 12, color: COLORS.gray700dark, fontWeight: '600' },
  optionBtnTextActive:{ color: COLORS.greenBright, fontWeight: '700' },

  areaRow: { flexDirection: 'row', gap: 8 },
  areaBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12,
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border,
  },
  areaBtnActive:    { backgroundColor: 'rgba(22,163,74,0.1)', borderColor: COLORS.greenBright },
  areaBtnPct:       { fontSize: 14, fontWeight: '800', color: COLORS.gray700dark },
  areaBtnPctActive: { color: COLORS.greenBright },
  areaBtnDesc:      { fontSize: 10, color: COLORS.textMedium, marginTop: 2 },

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

  summaryCard: {
    backgroundColor: COLORS.white, borderRadius: 14, padding: 14, gap: 8,
    borderWidth: 1, borderColor: COLORS.border, marginTop: 8,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  summaryTitle: { fontSize: 11, fontWeight: '800', color: COLORS.textMedium, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  summaryRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  summaryText:  { fontSize: 12, color: COLORS.gray700dark, flex: 1 },

  // Footer / buttons
  footer: {
    paddingHorizontal: 18, paddingTop: 12,
    backgroundColor: COLORS.white,
    borderTopWidth: 1, borderTopColor: COLORS.grayBorder,
  },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.greenBright, borderRadius: 14, paddingVertical: 16,
  },
  nextBtnGradient: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 16,
    shadowColor: COLORS.greenBright, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 5,
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

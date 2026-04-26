/**
 * AIRecommendation — Complete Crop Advisor Wizard
 *
 * Step 1 — Crop & Field Setup   : Select crop type, land size, previous crop
 * Step 2 — Photo Scan            : Camera / Gallery capture (leaf, stem, root, field)
 * Step 3 — Field Conditions      : Live weather + soil type selection
 * Step 4 — AI Analysis Results   : Photo-based disease detection + full report
 */
import { COLORS } from '../../constants/colors';
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Image, ActivityIndicator, StatusBar,
  Animated, Alert, Platform, FlatList, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLanguage } from '../../context/LanguageContext';
import { useLocation } from '../../context/LocationContext';
import api from '../../services/api';

const { width: SCREEN_W } = Dimensions.get('window');

const BLUE   = COLORS.blue;
const ORANGE = COLORS.cta;
const RED    = COLORS.error;

// Translation keys for previous crop dropdown — rendered via t() inside component
const PREV_CROP_KEYS = [
  'ai.prevCropPlaceholder',
  'ai.prevCropWheat',
  'ai.prevCropRice',
  'ai.prevCropPulses',
  'ai.prevCropMustard',
  'ai.prevCropMaize',
  'ai.prevCropSorghum',
  'ai.prevCropFallow',
];

// Translation keys for scan type chips — labels and hints rendered via t()
const SCAN_TYPES = [
  { id: 'leaf',  labelKey: 'ai.scanLeaf',  icon: 'leaf',         hintKey: 'ai.scanLeafHint'  },
  { id: 'stem',  labelKey: 'ai.scanStem',  icon: 'git-commit',   hintKey: 'ai.scanStemHint'  },
  { id: 'root',  labelKey: 'ai.scanRoot',  icon: 'git-branch',   hintKey: 'ai.scanRootHint'  },
  { id: 'field', labelKey: 'ai.scanField', icon: 'image',        hintKey: 'ai.scanFieldHint' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const sevColor = (s) => s === 'critical' ? RED : s === 'moderate' ? ORANGE : COLORS.primary;
const sevBg    = (s) => s === 'critical' ? COLORS.redPale : s === 'moderate' ? COLORS.orangeWarm : COLORS.primaryPale;
const sevLabelKey = (s) => s === 'critical' ? 'sevPillCritical' : s === 'moderate' ? 'sevPillModerate' : 'sevPillLow';
const statColor = (s) => s === 'critical' ? RED : s === 'scheduled' ? BLUE : COLORS.grayMedium;
const statLabelKey = (s) => s === 'critical' ? 'statPillCritical' : s === 'scheduled' ? 'statPillScheduled' : 'statPillPending';

// ─────────────────────────────────────────────────────────────────────────────
// Futuristic animation primitives
// ─────────────────────────────────────────────────────────────────────────────

/** Single ambient particle that floats upward in a loop */
function ParticleDot({ x, y, size = 4, color = COLORS.primary, delay = 0, amplitude = 14 }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 2400 + delay * 120, delay, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 2400 + delay * 120, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -amplitude] });
  const opacity    = anim.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0.1, 0.85, 0.85, 0.1] });
  return (
    <Animated.View style={{
      position: 'absolute', left: x, top: y,
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color, opacity, transform: [{ translateY }],
    }} />
  );
}

/** Ring of equally-spaced dots that rotates around its center */
function OrbitRing({ size, radius, dotCount, dotSize, color, duration, reverse = false }) {
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rot, { toValue: reverse ? -1 : 1, duration, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const spin = rot.interpolate({
    inputRange:  reverse ? [-1, 0] : [0, 1],
    outputRange: reverse ? ['-360deg', '0deg'] : ['0deg', '360deg'],
  });
  const center = size / 2;
  return (
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, width: size, height: size, transform: [{ rotate: spin }] }}>
      {Array.from({ length: dotCount }, (_, i) => {
        const rad  = ((360 / dotCount) * i) * Math.PI / 180;
        const left = center + radius * Math.cos(rad) - dotSize / 2;
        const top  = center + radius * Math.sin(rad) - dotSize / 2;
        return <View key={i} style={{ position: 'absolute', left, top, width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: color }} />;
      })}
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HeroBanner — Step 1 dark sphere header
// ─────────────────────────────────────────────────────────────────────────────
const HERO_P = [
  { x: 16,            y: 24,  size: 3, color: COLORS.primary,     delay: 0,    amplitude: 10 },
  { x: SCREEN_W - 36, y: 18,  size: 4, color: COLORS.sellerAccentLight, delay: 400,  amplitude: 12 },
  { x: 28,            y: 118, size: 3, color: COLORS.softSage, delay: 900,  amplitude: 9  },
  { x: SCREEN_W - 28, y: 104, size: 5, color: COLORS.primary,     delay: 200,  amplitude: 14 },
  { x: 22,            y: 72,  size: 2, color: COLORS.paleGreen, delay: 1200, amplitude: 8  },
  { x: SCREEN_W - 50, y: 66,  size: 3, color: COLORS.leafGreen, delay: 700,  amplitude: 11 },
  { x: 58,            y: 14,  size: 2, color: COLORS.sellerAccentLight, delay: 550,  amplitude: 7  },
  { x: SCREEN_W - 68, y: 128, size: 4, color: COLORS.primary,     delay: 300,  amplitude: 13 },
];

function HeroBanner() {
  const { t } = useLanguage();
  const pulse  = useRef(new Animated.Value(0.92)).current;
  const glowOp = useRef(new Animated.Value(0.35)).current;
  const chipDotPulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse,  { toValue: 1.07, duration: 1800, useNativeDriver: true }),
      Animated.timing(pulse,  { toValue: 0.92, duration: 1800, useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(glowOp, { toValue: 0.9,  duration: 1800, useNativeDriver: true }),
      Animated.timing(glowOp, { toValue: 0.35, duration: 1800, useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(chipDotPulse, { toValue: 1,   duration: 600, useNativeDriver: true }),
      Animated.timing(chipDotPulse, { toValue: 0.3, duration: 600, useNativeDriver: true }),
    ])).start();
  }, []);

  return (
    <View style={HB.wrap}>
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: COLORS.forestNight }]} />

      {/* Background dot grid */}
      {Array.from({ length: 35 }).map((_, i) => (
        <View key={i} style={{
          position: 'absolute',
          left: (i % 7) * 52 + 10,
          top:  Math.floor(i / 7) * 34 + 8,
          width: 2.5, height: 2.5, borderRadius: 1.25,
          backgroundColor: COLORS.primary + '22',
        }} />
      ))}

      {/* Ambient particles */}
      {HERO_P.map((p, i) => <ParticleDot key={i} {...p} />)}

      {/* Content row: sphere + text */}
      <View style={HB.contentRow}>
        {/* 3-ring orbit sphere */}
        <View style={HB.sphereWrap}>
          <OrbitRing size={140} radius={62} dotCount={8} dotSize={7}  color={COLORS.primary}     duration={9000}         />
          <OrbitRing size={140} radius={45} dotCount={6} dotSize={5}  color={COLORS.sellerAccentLight} duration={6200} reverse />
          <OrbitRing size={140} radius={28} dotCount={4} dotSize={4}  color={COLORS.softSage} duration={4200}         />
          {/* Glow ring */}
          <Animated.View style={[HB.glowRing, { opacity: glowOp }]} />
          {/* Center leaf */}
          <Animated.View style={[HB.centerIcon, { transform: [{ scale: pulse }] }]}>
            <View style={HB.centerGrad}>
              <Ionicons name="leaf" size={28} color={COLORS.white} />
            </View>
          </Animated.View>
        </View>

        {/* Text */}
        <View style={HB.textArea}>
          <View style={HB.aiChip}>
            <Animated.View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: COLORS.primary, opacity: chipDotPulse }} />
            <Text style={HB.aiChipTxt}>{t('ai.aiActive')}</Text>
          </View>
          <Text style={HB.heroTitle}>{t('ai.heroTitle')}</Text>
          <Text style={HB.heroSub}>{t('ai.heroSub')}</Text>
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ScanModeBanner — Step 2 photo-capture header
// ─────────────────────────────────────────────────────────────────────────────
function ScanModeBanner({ cropName }) {
  const { t } = useLanguage();
  const sweepAnim = useRef(new Animated.Value(0)).current;
  const dotPulse  = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(dotPulse, { toValue: 1,   duration: 700, useNativeDriver: true }),
      Animated.timing(dotPulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(sweepAnim, { toValue: 1,   duration: 1800, useNativeDriver: true }),
      Animated.delay(500),
      Animated.timing(sweepAnim, { toValue: 0,   duration: 0,    useNativeDriver: true }),
      Animated.delay(400),
    ])).start();
  }, []);

  const sweepY  = sweepAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 104] });
  const sweepOp = sweepAnim.interpolate({ inputRange: [0, 0.05, 0.88, 1], outputRange: [0, 0.75, 0.75, 0] });

  const BL = 20; const BW = 2.5; const BC = COLORS.primary;

  return (
    <View style={SMB.wrap}>
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: COLORS.forestNight }]} />

      {/* Dot grid */}
      {Array.from({ length: 24 }).map((_, i) => (
        <View key={i} style={{
          position: 'absolute',
          left: (i % 6) * 55 + 16,
          top:  Math.floor(i / 6) * 30 + 10,
          width: 2, height: 2, borderRadius: 1,
          backgroundColor: COLORS.primary + '1E',
        }} />
      ))}

      {/* Scan frame box (104 × 104) */}
      <View style={SMB.frameWrap}>
        {/* TL */}
        <View style={{ position: 'absolute', top: 0, left: 0 }}>
          <View style={{ width: BL, height: BW, backgroundColor: BC, borderRadius: 1 }} />
          <View style={{ width: BW, height: BL, backgroundColor: BC, marginTop: -BW, borderRadius: 1 }} />
        </View>
        {/* TR */}
        <View style={{ position: 'absolute', top: 0, right: 0, alignItems: 'flex-end' }}>
          <View style={{ width: BL, height: BW, backgroundColor: BC, borderRadius: 1 }} />
          <View style={{ width: BW, height: BL, backgroundColor: BC, marginTop: -BW, borderRadius: 1 }} />
        </View>
        {/* BL */}
        <View style={{ position: 'absolute', bottom: 0, left: 0 }}>
          <View style={{ width: BW, height: BL, backgroundColor: BC, borderRadius: 1 }} />
          <View style={{ width: BL, height: BW, backgroundColor: BC, borderRadius: 1 }} />
        </View>
        {/* BR */}
        <View style={{ position: 'absolute', bottom: 0, right: 0, alignItems: 'flex-end' }}>
          <View style={{ width: BW, height: BL, backgroundColor: BC, borderRadius: 1 }} />
          <View style={{ width: BL, height: BW, backgroundColor: BC, borderRadius: 1 }} />
        </View>
        {/* Center icon */}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Ionicons name="leaf" size={22} color={COLORS.primary + '70'} />
        </View>
        {/* Sweep line */}
        <Animated.View style={{
          position: 'absolute', left: 0, right: 0, height: 2,
          backgroundColor: COLORS.primary, opacity: sweepOp,
          transform: [{ translateY: sweepY }],
          shadowColor: COLORS.primary, shadowOpacity: 0.8, shadowRadius: 6, elevation: 2,
        }} />
      </View>

      {/* Text */}
      <View style={SMB.textArea}>
        <View style={SMB.chip}>
          <Animated.View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: COLORS.primary, opacity: dotPulse }} />
          <Text style={SMB.chipTxt}>{t('ai.scanMode')}</Text>
        </View>
        <Text style={SMB.title}>{t('ai.photographCrop', { crop: cropName })}</Text>
        <Text style={SMB.sub}>{t('ai.captureHint')}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step Indicator (4 steps)
// ─────────────────────────────────────────────────────────────────────────────
function StepIndicator({ current }) {
  const { t } = useLanguage();
  const labels = [t('ai.stepCrop'), t('ai.stepPhotos'), t('ai.stepConditions'), t('ai.stepResults')];
  return (
    <View style={S.stepWrap}>
      {[1, 2, 3, 4].map((s, i) => (
        <React.Fragment key={s}>
          <View style={S.stepItem}>
            <View style={[S.stepDot, current >= s && S.stepDotActive, current > s && S.stepDotDone]}>
              {current > s
                ? <Ionicons name="checkmark" size={10} color={COLORS.white} />
                : <Text style={[S.stepNum, current >= s && S.stepNumActive]}>{s}</Text>}
            </View>
            <Text style={[S.stepLabel, current >= s && S.stepLabelActive]}>{labels[i]}</Text>
          </View>
          {s < 4 && <View style={[S.stepLine, current > s && S.stepLineActive]} />}
        </React.Fragment>
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Analyzing overlay (shown between Step 3 → Step 4)
// ─────────────────────────────────────────────────────────────────────────────
const OVERLAY_P = [
  { x: 22,            y: 70,  size: 3, color: COLORS.primary,     delay: 0,   amplitude: 16 },
  { x: SCREEN_W - 32, y: 90,  size: 4, color: COLORS.sellerAccentLight, delay: 400, amplitude: 14 },
  { x: 36,            y: 200, size: 3, color: COLORS.primary,     delay: 700, amplitude: 12 },
  { x: SCREEN_W - 48, y: 220, size: 5, color: COLORS.leafGreen, delay: 200, amplitude: 18 },
  { x: 20,            y: 340, size: 3, color: COLORS.primary,     delay: 900, amplitude: 13 },
  { x: SCREEN_W - 36, y: 360, size: 3, color: COLORS.sellerAccentLight, delay: 600, amplitude: 15 },
];

function AnalyzingOverlay({ visible, photos }) {
  const { t } = useLanguage();
  const pulse    = useRef(new Animated.Value(0.6)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const glowOp   = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (!visible) return;
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: 2800, useNativeDriver: false }).start();
    Animated.loop(Animated.sequence([
      Animated.timing(pulse,  { toValue: 1,   duration: 700, useNativeDriver: true }),
      Animated.timing(pulse,  { toValue: 0.6, duration: 700, useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(glowOp, { toValue: 0.85, duration: 900, useNativeDriver: true }),
      Animated.timing(glowOp, { toValue: 0.3,  duration: 900, useNativeDriver: true }),
    ])).start();
  }, [visible]);

  if (!visible) return null;

  const barW = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={S.overlayRoot}>
      <View style={S.overlayGradient}>

        {/* Background dot grid */}
        {Array.from({ length: 48 }).map((_, i) => (
          <View key={i} style={{
            position: 'absolute',
            left: (i % 8) * 44 + 14,
            top:  Math.floor(i / 8) * 56 + 20,
            width: 2, height: 2, borderRadius: 1,
            backgroundColor: COLORS.primary + '18',
          }} />
        ))}

        {/* Ambient particles */}
        {OVERLAY_P.map((p, i) => <ParticleDot key={i} {...p} />)}

        {/* 3-ring orbit sphere */}
        <View style={S.overlaySphereWrap}>
          <OrbitRing size={190} radius={84} dotCount={10} dotSize={8}  color={COLORS.primary}     duration={8500}         />
          <OrbitRing size={190} radius={60} dotCount={7}  dotSize={5}  color={COLORS.sellerAccentLight} duration={5800} reverse />
          <OrbitRing size={190} radius={38} dotCount={4}  dotSize={4}  color={COLORS.softSage} duration={3900}         />
          {/* Outer glow */}
          <Animated.View style={[S.overlayGlow, { opacity: glowOp }]} />
          {/* Center icon */}
          <Animated.View style={[S.scanIconWrap, { transform: [{ scale: pulse }] }]}>
            <Ionicons name="leaf" size={44} color={COLORS.primary} />
          </Animated.View>
        </View>

        <Text style={S.overlayTitle}>{t('ai.analyzing')}</Text>
        <Text style={S.overlaySub}>{t('ai.analyzingPhotos', { count: photos.length })}</Text>

        {/* Progress bar */}
        <View style={S.progressBarWrap}>
          <Animated.View style={[S.progressBarFill, { width: barW }]} />
        </View>

        {/* Step hints */}
        {[t('ai.analyzingStep1'), t('ai.analyzingStep2'), t('ai.analyzingStep3'), t('ai.analyzingStep4')].map((txt, i) => (
          <View key={i} style={S.overlayStepRow}>
            <Ionicons name="checkmark-circle" size={14} color={COLORS.primary + 'AA'} />
            <Text style={S.overlayStepTxt}>{txt}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Crop & Field Setup
// ─────────────────────────────────────────────────────────────────────────────
function Step1({ onNext }) {
  const { t } = useLanguage();
  const [crops,        setCrops]        = useState([]);
  const [cropsLoading, setCropsLoading] = useState(true);
  const [selectedCrop, setSelectedCrop] = useState(null);
  const [landSize,     setLandSize]     = useState('');
  const [prevCropIdx,  setPrevCropIdx]  = useState(0);
  const [showMenu,     setShowMenu]     = useState(false);

  useEffect(() => {
    const fallbackCrops = [
      { id: 1, name: 'Tomato', icon: '🍅' }, { id: 2, name: 'Wheat', icon: '🌾' },
      { id: 3, name: 'Rice', icon: '🌾' },   { id: 4, name: 'Cotton', icon: '🪴' },
      { id: 5, name: 'Onion', icon: '🧅' },  { id: 6, name: 'Soybean', icon: '🫘' },
      { id: 7, name: 'Potato', icon: '🥔' }, { id: 8, name: 'Maize', icon: '🌽' },
    ];
    api.get('/agristore/crops')
      .then(({ data }) => setCrops(data.data?.length ? data.data : fallbackCrops))
      .catch(() => setCrops(fallbackCrops))
      .finally(() => setCropsLoading(false));
  }, []);

  const prevCropOptions = PREV_CROP_KEYS.map(k => t(k));
  const canContinue = !!selectedCrop;

  if (cropsLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={S.scrollContent}>
      <HeroBanner />
      <Text style={[S.stepTitle, { marginTop: 20 }]}>{t('ai.whatAreYouGrowing')}</Text>
      <Text style={S.stepSub}>{t('ai.cropAdvisorDesc')}</Text>

      {/* Crop grid */}
      <View style={S.rowBetween}>
        <Text style={S.sectionLabel}>{t('ai.selectCurrentCrop')}</Text>
        <View style={S.aiBadge}><Ionicons name="sparkles" size={11} color={BLUE} /><Text style={S.aiBadgeTxt}>{t('ai.aiReady')}</Text></View>
      </View>

      <View style={S.cropGrid}>
        {crops.map((crop) => {
          const sel = selectedCrop?.id === crop.id;
          return (
            <TouchableOpacity
              key={crop.id}
              style={[S.cropCard, sel && { borderColor: COLORS.primary, borderWidth: 2.5 }]}
              onPress={() => setSelectedCrop(crop)}
              activeOpacity={0.85}
            >
              <Image source={{ uri: crop.image }} style={S.cropImg} resizeMode="cover" />
              {sel && (
                <View style={S.cropCheckBadge}>
                  <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />
                </View>
              )}
              <View style={S.cropFooter}>
                <Text style={[S.cropName, sel && { color: COLORS.primary, fontWeight: '800' }]}>{crop.name}</Text>
                <Text style={S.cropSeason}>{crop.season.split('(')[0].trim()}</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Other crop card */}
        <TouchableOpacity
          style={[S.cropCard, S.otherCropCard]}
          onPress={() => Alert.alert(t('ai.comingSoon'), t('ai.comingSoonMsg'))}
          activeOpacity={0.8}
        >
          <View style={S.otherCropIconWrap}>
            <Ionicons name="add-circle-outline" size={30} color={COLORS.grayLight2} />
          </View>
          <View style={S.cropFooter}>
            <Text style={S.otherCropTxt}>{t('ai.otherCrop')}</Text>
            <Text style={S.cropSeason}>{t('ai.customEntry')}</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Selected crop pill */}
      {selectedCrop && (
        <View style={S.selectedPill}>
          <View style={[S.selectedPillDot, { backgroundColor: selectedCrop.color }]} />
          <Text style={S.selectedPillTxt}>
            {selectedCrop.name} · {t('ai.knownCritical', { count: (selectedCrop.diseases || []).filter(d => d.severity === 'critical').length })}
          </Text>
        </View>
      )}

      {/* Land size */}
      <Text style={[S.sectionLabel, { marginTop: 22 }]}>{t('ai.landSize')}</Text>
      <View style={S.inputRow}>
        <Ionicons name="resize-outline" size={18} color={COLORS.grayMedium} style={{ marginRight: 10 }} />
        <TextInput
          style={S.textInput}
          placeholder={t('ai.landSizePlaceholder')}
          placeholderTextColor={COLORS.grayLightMid}
          keyboardType="decimal-pad"
          value={landSize}
          onChangeText={setLandSize}
        />
        <Text style={S.inputUnit}>{t('ai.acres')}</Text>
      </View>

      {/* Previous crop */}
      <Text style={[S.sectionLabel, { marginTop: 18 }]}>{t('ai.previousCrop')}</Text>
      <TouchableOpacity style={S.dropdown} onPress={() => setShowMenu(v => !v)}>
        <Ionicons name="time-outline" size={18} color={COLORS.grayMedium} style={{ marginRight: 10 }} />
        <Text style={[S.dropdownTxt, prevCropIdx === 0 && { color: COLORS.grayLightMid }]}>
          {prevCropOptions[prevCropIdx]}
        </Text>
        <Ionicons name={showMenu ? 'chevron-up' : 'chevron-down'} size={17} color={COLORS.grayMedium} />
      </TouchableOpacity>
      {showMenu && (
        <View style={S.dropdownMenu}>
          {prevCropOptions.slice(1).map((pc, i) => (
            <TouchableOpacity
              key={i}
              style={[S.dropdownItem, i === prevCropOptions.length - 2 && { borderBottomWidth: 0 }]}
              onPress={() => { setPrevCropIdx(i + 1); setShowMenu(false); }}
            >
              <Text style={[S.dropdownItemTxt, prevCropIdx === i + 1 && { color: COLORS.primary, fontWeight: '700' }]}>
                {pc}
              </Text>
              {prevCropIdx === i + 1 && <Ionicons name="checkmark" size={14} color={COLORS.primary} />}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* AI info box */}
      {selectedCrop && (
        <View style={S.infoBox}>
          <View style={[S.infoBoxIcon, { backgroundColor: COLORS.primary + '20' }]}>
            <Ionicons name="leaf" size={18} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[S.infoBoxTitle, { color: COLORS.primary }]}>{t('ai.cropDetected')}</Text>
            <Text style={S.infoBoxTxt}>{t('ai.cropDetectedDesc', { name: selectedCrop.name, count: (selectedCrop.diseases || []).length })}</Text>
          </View>
        </View>
      )}

      <TouchableOpacity
        style={[S.primaryBtn, !canContinue && S.btnDisabled]}
        disabled={!canContinue}
        onPress={() => onNext(selectedCrop, landSize, prevCropIdx > 0 ? prevCropOptions[prevCropIdx] : null)}
      >
        <Ionicons name="camera" size={18} color={COLORS.white} style={{ marginRight: 8 }} />
        <Text style={S.primaryBtnTxt}>{t('ai.nextPhotograph')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Photo Scan
// ─────────────────────────────────────────────────────────────────────────────
function Step2({ crop, onNext, onBack }) {
  const { t } = useLanguage();
  const [photos,       setPhotos]       = useState([]);
  const [activeScan,   setActiveScan]   = useState('leaf');
  const maxPhotos = 4;

  const requestPerms = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    const { status: camStatus } = await ImagePicker.requestCameraPermissionsAsync();
    return status === 'granted' && camStatus === 'granted';
  };

  const takePhoto = async () => {
    if (photos.length >= maxPhotos) {
      Alert.alert(t('ai.limitReached'), t('ai.limitReachedMsg', { max: maxPhotos }));
      return;
    }
    const ok = await requestPerms();
    if (!ok) { Alert.alert(t('ai.permissionRequired'), t('ai.cameraPermission')); return; }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      setPhotos(prev => [...prev, { uri: result.assets[0].uri, type: activeScan, id: Date.now().toString() }]);
    }
  };

  const pickPhoto = async () => {
    if (photos.length >= maxPhotos) {
      Alert.alert(t('ai.limitReached'), t('ai.limitReachedMsg', { max: maxPhotos }));
      return;
    }
    const ok = await requestPerms();
    if (!ok) { Alert.alert(t('ai.permissionRequired'), t('ai.galleryPermission')); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      setPhotos(prev => [...prev, { uri: result.assets[0].uri, type: activeScan, id: Date.now().toString() }]);
    }
  };

  const removePhoto = (id) => setPhotos(prev => prev.filter(p => p.id !== id));

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={S.scrollContent}>
      <ScanModeBanner cropName={crop.name} />
      <Text style={[S.stepTitle, { marginTop: 20 }]}>{t('ai.photographYourCrop')}</Text>
      <Text style={S.stepSub}>{t('ai.photographDesc')}</Text>

      {/* How-to tips */}
      <View style={S.tipsBanner}>
        <Ionicons name="bulb-outline" size={16} color={ORANGE} />
        <Text style={S.tipsBannerTxt}>
          <Text style={{ fontWeight: '800', color: ORANGE }}>{t('ai.photoTips')} </Text>
          {t('ai.photoTipsText')}
        </Text>
      </View>

      {/* Scan type selector */}
      <Text style={S.sectionLabel}>{t('ai.selectScanType')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', gap: 10, paddingRight: 16 }}>
          {SCAN_TYPES.map((st) => {
            const active = activeScan === st.id;
            return (
              <TouchableOpacity
                key={st.id}
                style={[S.scanTypeChip, active && S.scanTypeChipActive]}
                onPress={() => setActiveScan(st.id)}
                activeOpacity={0.8}
              >
                <Ionicons name={st.icon} size={15} color={active ? COLORS.white : COLORS.textMedium} />
                <Text style={[S.scanTypeLabel, active && { color: COLORS.white }]}>{t(st.labelKey)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Hint for selected scan type */}
      <Text style={S.scanHint}>
        {t(SCAN_TYPES.find(s => s.id === activeScan)?.hintKey || 'ai.scanLeafHint')}
      </Text>

      {/* Capture buttons */}
      <View style={S.captureRow}>
        <TouchableOpacity style={S.captureBtn} onPress={takePhoto} activeOpacity={0.85}>
          <View style={S.captureBtnGrad}>
            <Ionicons name="camera" size={24} color={COLORS.white} />
            <Text style={S.captureBtnTxt}>{t('ai.takePhoto')}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={[S.captureBtn, S.captureBtnOutline]} onPress={pickPhoto} activeOpacity={0.85}>
          <Ionicons name="images-outline" size={24} color={COLORS.primary} />
          <Text style={[S.captureBtnTxt, { color: COLORS.primary }]}>{t('ai.uploadPhoto')}</Text>
        </TouchableOpacity>
      </View>

      {/* Photo count indicator */}
      <View style={S.photoCountRow}>
        <Text style={S.photoCountTxt}>{t('ai.photosCaptured', { count: photos.length, max: maxPhotos })}</Text>
        <View style={S.photoCountBar}>
          {[...Array(maxPhotos)].map((_, i) => (
            <View key={i} style={[S.photoCountDot, i < photos.length && S.photoCountDotFilled]} />
          ))}
        </View>
      </View>

      {/* Captured photos */}
      {photos.length > 0 && (
        <>
          <Text style={S.sectionLabel}>{t('ai.capturedPhotos')}</Text>
          <View style={S.photoGrid}>
            {photos.map((photo) => (
              <View key={photo.id} style={S.photoThumb}>
                <Image source={{ uri: photo.uri }} style={S.photoThumbImg} resizeMode="cover" />
                {/* Scan type tag */}
                <View style={S.photoTag}>
                  <Text style={S.photoTagTxt}>{t(SCAN_TYPES.find(s => s.id === photo.type)?.labelKey || 'ai.scanLeaf')}</Text>
                </View>
                {/* AI scan indicator */}
                <View style={S.photoAiTag}>
                  <Ionicons name="scan" size={10} color={COLORS.primary} />
                  <Text style={S.photoAiTxt}>{t('ai.aiScan')}</Text>
                </View>
                {/* Remove button */}
                <TouchableOpacity style={S.photoRemove} onPress={() => removePhoto(photo.id)}>
                  <Ionicons name="close-circle" size={20} color={COLORS.white} />
                </TouchableOpacity>
              </View>
            ))}
            {/* Add more placeholder */}
            {photos.length < maxPhotos && (
              <TouchableOpacity style={S.photoAddMore} onPress={takePhoto}>
                <Ionicons name="add" size={22} color={COLORS.divider} />
                <Text style={S.photoAddMoreTxt}>{t('ai.addMore')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}

      {/* Skip note */}
      {photos.length === 0 && (
        <View style={[S.infoBox, { borderColor: BLUE + '40', backgroundColor: COLORS.bluePale }]}>
          <View style={[S.infoBoxIcon, { backgroundColor: BLUE + '20' }]}>
            <Ionicons name="information-circle" size={18} color={BLUE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[S.infoBoxTitle, { color: BLUE }]}>{t('ai.whyPhotos')}</Text>
            <Text style={S.infoBoxTxt}>{t('ai.whyPhotosTxt')}</Text>
          </View>
        </View>
      )}

      {photos.length > 0 && (
        <View style={[S.infoBox, { borderColor: COLORS.primary + '40', backgroundColor: COLORS.primaryPale }]}>
          <View style={[S.infoBoxIcon, { backgroundColor: COLORS.primary + '20' }]}>
            <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[S.infoBoxTitle, { color: COLORS.primary }]}>{t('ai.readyToScan')}</Text>
            <Text style={S.infoBoxTxt}>{t('ai.readyToScanTxt', { count: photos.length, crop: crop.name, diseases: (crop.diseases || []).length })}</Text>
          </View>
        </View>
      )}

      <TouchableOpacity
        style={[S.primaryBtn, { backgroundColor: ORANGE }]}
        onPress={() => onNext(photos)}
        activeOpacity={0.85}
      >
        <Ionicons name="flask" size={18} color={COLORS.white} style={{ marginRight: 8 }} />
        <Text style={S.primaryBtnTxt}>
          {photos.length > 0 ? t('ai.nextConditions') : t('ai.skipPhotos')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={S.backBtn} onPress={onBack}>
        <Ionicons name="arrow-back" size={15} color={COLORS.grayMedium} />
        <Text style={S.backBtnTxt}>{t('ai.backToCrop')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Field Conditions (Weather + Soil)
// ─────────────────────────────────────────────────────────────────────────────
function Step3({ crop, photos, onNext, onBack }) {
  const { t } = useLanguage();
  const [soilType,     setSoilType]     = useState(null);
  const [soils,        setSoils]        = useState([]);
  const [soilsLoading, setSoilsLoading] = useState(true);
  const [weather,      setWeather]      = useState(null);
  const [loadingWx,    setLoadingWx]    = useState(true);

  useEffect(() => {
    const fallbackSoils = [
      { id: 1, name: 'Black (Regur)', nameHi: 'काली मिट्टी', desc: 'High moisture retention, ideal for cotton & soybean' },
      { id: 2, name: 'Red Loam',      nameHi: 'लाल मिट्टी',  desc: 'Well-drained, good for vegetables & pulses' },
      { id: 3, name: 'Alluvial',      nameHi: 'जलोढ़ मिट्टी', desc: 'Highly fertile, excellent for wheat & rice' },
      { id: 4, name: 'Sandy Loam',    nameHi: 'रेतीली मिट्टी', desc: 'Fast-draining, suitable for root crops & groundnut' },
      { id: 5, name: 'Clay',          nameHi: 'चिकनी मिट्टी', desc: 'Heavy soil, retains water, good for paddy' },
    ];
    api.get('/agristore/soils')
      .then(({ data }) => setSoils(data.data?.length ? data.data : fallbackSoils))
      .catch(() => setSoils(fallbackSoils))
      .finally(() => setSoilsLoading(false));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const lat = gpsCoords?.latitude  ?? 18.52;
        const lon = gpsCoords?.longitude ?? 73.86;
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
          `&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m` +
          `&timezone=Asia%2FKolkata`;
        const res  = await fetch(url);
        const data = await res.json();
        setWeather({
          temp:     Math.round(data.current.temperature_2m),
          humidity: data.current.relative_humidity_2m,
          rainfall: Math.round((data.current.precipitation || 0) * 10) / 10,
          wind:     Math.round(data.current.wind_speed_10m || 0),
        });
      } catch {
        setWeather({ temp: 28, humidity: 64, rainfall: 12, wind: 14 });
      } finally {
        setLoadingWx(false);
      }
    })();
  }, [gpsCoords]);

  const conditions = weather ? [
    {
      icon: 'thermometer', label: t('ai.condTemp'),
      value: `${weather.temp}°C`,
      sub: weather.temp < 35 ? t('ai.condTempOptimal') : t('ai.condTempHeat'),
      color: weather.temp >= 35 ? RED : ORANGE,
    },
    {
      icon: 'water', label: t('ai.condHumidity'),
      value: `${weather.humidity}%`,
      sub: weather.humidity >= 70 ? t('ai.condHumidityHigh') : t('ai.condHumidityMod'),
      color: BLUE,
    },
    {
      icon: 'rainy', label: t('ai.condRainfall'),
      value: `${weather.rainfall} mm`,
      sub: t('ai.condRainfallSub'),
      color: BLUE,
    },
    {
      icon: 'flag', label: t('ai.condWind'),
      value: `${weather.wind} km/h`,
      sub: weather.wind > 25 ? t('ai.condWindWarn') : t('ai.condWindGood'),
      color: COLORS.primary,
    },
  ] : [];

  // AI weather insight
  const weatherInsight = weather
    ? weather.humidity >= 70
      ? t('ai.weatherHighHumidity', { humidity: weather.humidity, rainfall: weather.rainfall, crop: crop.name })
      : t('ai.weatherStable', { temp: weather.temp, crop: crop.name })
    : null;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={S.scrollContent}>
      <Text style={S.stepTitle}>{t('ai.fieldConditions')}</Text>
      <Text style={S.stepSub}>{t('ai.fieldConditionsSub')}</Text>

      {/* Weather section */}
      <View style={S.rowBetween}>
        <Text style={S.sectionLabel}>{t('ai.liveWeather')}</Text>
        <View style={S.liveTag}>
          <View style={S.liveDot} />
          <Text style={S.liveTxt}>LIVE</Text>
        </View>
      </View>

      {loadingWx ? (
        <View style={S.weatherLoading}>
          <ActivityIndicator color={COLORS.primary} size="small" />
          <Text style={S.weatherLoadingTxt}>{t('ai.fetchingWeather')}</Text>
        </View>
      ) : (
        <View style={S.condGrid}>
          {conditions.map((c) => (
            <View key={c.label} style={S.condCard}>
              <View style={[S.condIconWrap, { backgroundColor: c.color + '15' }]}>
                <Ionicons name={c.icon} size={24} color={c.color} />
              </View>
              <Text style={S.condLabel}>{c.label}</Text>
              <Text style={[S.condValue, { color: c.color }]}>{c.value}</Text>
              <Text style={S.condSub}>{c.sub}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Weather AI insight */}
      {weatherInsight && (
        <View style={[S.infoBox, { borderColor: BLUE + '40', backgroundColor: COLORS.bluePale }]}>
          <View style={[S.infoBoxIcon, { backgroundColor: BLUE + '15' }]}>
            <Ionicons name="analytics" size={18} color={BLUE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[S.infoBoxTitle, { color: BLUE }]}>{t('ai.weatherInsight')}</Text>
            <Text style={S.infoBoxTxt}>{weatherInsight}</Text>
          </View>
        </View>
      )}

      {/* Soil type */}
      <Text style={[S.sectionLabel, { marginTop: 24 }]}>{t('ai.yourSoilType')}</Text>
      <Text style={S.stepSub}>{t('ai.soilTypeSub')}</Text>
      {soilsLoading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 16 }} />
      ) : (
        <View style={S.soilGrid}>
          {soils.map((soil) => {
            const sel = soilType?.id === soil.id;
            return (
              <TouchableOpacity
                key={soil.id}
                style={[S.soilCard, sel && { borderColor: COLORS.primary, borderWidth: 2.5 }]}
                onPress={() => setSoilType(soil)}
                activeOpacity={0.85}
              >
                <Image source={{ uri: soil.image }} style={S.soilImg} resizeMode="cover" />
                {sel && (
                  <View style={S.soilCheck}>
                    <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
                  </View>
                )}
                <View style={S.soilFooter}>
                  <Text style={[S.soilName, sel && { color: COLORS.primary, fontWeight: '800' }]}>{soil.name}</Text>
                  <Text style={S.soilDesc}>{soil.desc}</Text>
                  <Text style={S.soilCrops}>{t('ai.soilBestFor')} {(soil.crops || []).slice(0, 2).join(', ')}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {soilType && (
        <View style={[S.infoBox, { borderColor: COLORS.primary + '40', backgroundColor: COLORS.primaryPale }]}>
          <View style={[S.infoBoxIcon, { backgroundColor: COLORS.primary + '20' }]}>
            <Ionicons name="earth" size={18} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[S.infoBoxTitle, { color: COLORS.primary }]}>{t('ai.soilMatched')}</Text>
            <Text style={S.infoBoxTxt}>{t('ai.soilMatchedDesc', { name: soilType.name })}</Text>
          </View>
        </View>
      )}

      <TouchableOpacity
        style={[S.primaryBtn, !soilType && S.btnDisabled]}
        disabled={!soilType}
        onPress={() => onNext(soilType, weather)}
        activeOpacity={0.85}
      >
        <Ionicons name="sparkles" size={18} color={COLORS.white} style={{ marginRight: 8 }} />
        <Text style={S.primaryBtnTxt}>
          {photos.length > 0 ? t('ai.analyzeBtnPhotos', { count: photos.length }) : t('ai.analyzeBtnField')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={S.backBtn} onPress={onBack}>
        <Ionicons name="arrow-back" size={15} color={COLORS.grayMedium} />
        <Text style={S.backBtnTxt}>{t('ai.backToPhotos')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — AI Analysis Results
// ─────────────────────────────────────────────────────────────────────────────
function Step4({ crop, soil, landSize, prevCrop, weather, photos, detections, onBack }) {
  const soilPh      = soil?.ph ?? 7.0;
  const soilCarbon  = soil?.carbon ?? 'Medium';
  const soilHealth  = soil?.health ?? 'Moderate';
  const soilColor   = soil?.healthColor ?? ORANGE;
  const phPercent   = ((soilPh - 5) / 4) * 100;

  // Entrance animations — 7 sections slide up + fade in
  const anims = useRef(Array.from({ length: 7 }, () => ({
    op: new Animated.Value(0),
    ty: new Animated.Value(24),
  }))).current;

  useEffect(() => {
    anims.forEach((a, i) => {
      Animated.parallel([
        Animated.timing(a.op, { toValue: 1, duration: 380, delay: i * 90, useNativeDriver: true }),
        Animated.timing(a.ty, { toValue: 0, duration: 380, delay: i * 90, useNativeDriver: true }),
      ]).start();
    });
  }, []);

  const aS = (i) => ({ opacity: anims[i].op, transform: [{ translateY: anims[i].ty }] });

  // Overall severity = worst across all detections + crop diseases
  const overallCritical = (detections || []).some(d => d.severity === 'critical') ||
    (crop.diseases || []).some(d => d.severity === 'critical');

  const { t } = useLanguage();
  const scanSummaryColor = overallCritical ? RED : ORANGE;
  const scanSummaryBg    = overallCritical ? COLORS.redPale : COLORS.orangeWarm;
  const scanSummaryLabel = overallCritical ? t('ai.actionRequired') : t('ai.monitorClosely');
  const safeDetections   = detections || [];
  const safeDiseases     = crop.diseases || [];
  const safeFertilizer   = crop.fertilizer || [];
  const safePesticide    = crop.pesticide || {};

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[S.scrollContent, { paddingBottom: 60 }]}>

      {/* ── Analysis Complete Header ── */}
      <Animated.View style={aS(0)}>
      <View style={S.resultsHeader}>
        <View style={S.resultsHeaderGrad}>
          <View style={S.verifiedBadge}>
            <Ionicons name="shield-checkmark" size={12} color={COLORS.white} />
            <Text style={S.verifiedTxt}>{t('ai.verifiedAI')}</Text>
          </View>
          <Text style={S.resultsTitle}>{t('ai.analysisComplete')}</Text>
          <Text style={S.resultsSub}>
            {t('ai.resultsSub', { crop: crop.name, count: photos.length })}
          </Text>
          <View style={S.resultsStats}>
            <View style={S.resultsStat}>
              <Text style={S.resultsStatVal}>{safeDiseases.length}</Text>
              <Text style={S.resultsStatLbl}>{t('ai.diseasesChecked')}</Text>
            </View>
            <View style={S.resultsStatDiv} />
            <View style={S.resultsStat}>
              <Text style={S.resultsStatVal}>{photos.length || '—'}</Text>
              <Text style={S.resultsStatLbl}>{t('ai.photosAnalyzed')}</Text>
            </View>
            <View style={S.resultsStatDiv} />
            <View style={S.resultsStat}>
              <Text style={S.resultsStatVal}>{landSize || '—'}</Text>
              <Text style={S.resultsStatLbl}>{t('ai.acresCovered')}</Text>
            </View>
          </View>
        </View>
      </View>
      </Animated.View>

      {/* ── Download Report ── */}
      <Animated.View style={aS(1)}>
      <TouchableOpacity style={S.downloadBtn} activeOpacity={0.85}>
        <Ionicons name="document-text-outline" size={16} color={BLUE} />
        <Text style={S.downloadBtnTxt}>{t('ai.downloadReport')}</Text>
        <Ionicons name="download-outline" size={16} color={BLUE} />
      </TouchableOpacity>
      </Animated.View>

      {/* ── Photo Scan Results ── */}
      <Animated.View style={aS(2)}>
      {photos.length > 0 && (
        <View style={S.card}>
          <View style={S.cardTitleRow}>
            <Text style={S.cardTitle}>{t('ai.photoScanResults')}</Text>
            <View style={[S.scanResultBadge, { backgroundColor: scanSummaryBg }]}>
              <Text style={[S.scanResultBadgeTxt, { color: scanSummaryColor }]}>{scanSummaryLabel}</Text>
            </View>
          </View>
          <Text style={S.cardSubtitle}>{t('ai.photoMatched', { crop: crop.name })}</Text>
          {safeDetections.map((det, idx) => (
            <View key={det.id || idx} style={S.photoResultRow}>
              {/* Thumbnail */}
              <View style={S.photoResultThumbWrap}>
                <Image source={{ uri: det.uri }} style={S.photoResultThumb} resizeMode="cover" />
                <View style={S.photoResultScanTag}>
                  <Text style={S.photoResultScanTxt}>
                    {t(SCAN_TYPES.find(s => s.id === det.type)?.labelKey || 'ai.scanLeaf')}
                  </Text>
                </View>
              </View>
              {/* Detection info */}
              <View style={S.photoResultInfo}>
                <Text style={S.photoResultIdx}>{t('ai.photoLabel', { num: idx + 1 })}</Text>
                <Text style={S.photoResultDisease}>{det.disease}</Text>
                <View style={[S.severityPill, { backgroundColor: sevBg(det.severity) }]}>
                  <Text style={[S.severityPillTxt, { color: sevColor(det.severity) }]}>
                    {t('ai.' + sevLabelKey(det.severity))}
                  </Text>
                </View>
                {/* Confidence bar */}
                <View style={S.confRow}>
                  <Text style={S.confLabel}>{t('ai.confidence')}</Text>
                  <View style={S.confBarWrap}>
                    <View style={[S.confBarFill, { width: `${det.confidence}%`, backgroundColor: sevColor(det.severity) }]} />
                  </View>
                  <Text style={[S.confPct, { color: sevColor(det.severity) }]}>{det.confidence}%</Text>
                </View>
                <Text style={S.photoResultDesc} numberOfLines={2}>{det.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
      </Animated.View>

      {/* ── Diagnosis Overview ── */}
      <Animated.View style={aS(3)}>
      <View style={S.card}>
        <Text style={S.cardTitle}>{t('ai.fieldDiagnosis')}</Text>
        <View style={S.diagHeaderRow}>
          <Image source={{ uri: crop.image }} style={S.diagCropImg} resizeMode="cover" />
          <View style={S.diagHeaderInfo}>
            <Text style={S.diagCropName}>{crop.name}</Text>
            <Text style={S.diagSeason}>{crop.season}</Text>
            {prevCrop && (
              <Text style={S.diagPrevCrop}>{t('ai.prevCropLabel', { crop: prevCrop })}</Text>
            )}
            <View style={[S.severityBadge, { backgroundColor: scanSummaryBg, marginTop: 8 }]}>
              <Ionicons name={overallCritical ? 'warning' : 'alert-circle'} size={12} color={scanSummaryColor} />
              <Text style={[S.severityBadgeTxt, { color: scanSummaryColor }]}>{scanSummaryLabel}</Text>
            </View>
          </View>
        </View>

        <View style={S.diagDivider} />

        <Text style={[S.sectionLabel, { marginBottom: 10 }]}>{t('ai.activeRiskSummary')}</Text>
        {safeDiseases.slice(0, 2).map((d) => (
          <View key={d.name} style={S.diagItem}>
            <View style={[S.diagDot, { backgroundColor: sevColor(d.severity) }]} />
            <Text style={S.diagItemName}>{d.name}</Text>
            <View style={[S.severityPill, { backgroundColor: sevBg(d.severity) }]}>
              <Text style={[S.severityPillTxt, { color: sevColor(d.severity) }]}>{sevLabel(d.severity)}</Text>
            </View>
          </View>
        ))}
      </View>
      </Animated.View>

      {/* ── Disease Symptoms Catalog ── */}
      <Animated.View style={aS(4)}>
      <Text style={S.sectionLabel}>{t('ai.diseaseSymptoms', { crop: crop.name })}</Text>
      <Text style={[S.stepSub, { marginBottom: 12 }]}>{t('ai.diseaseSymptomsSubd')}</Text>
      {safeDiseases.map((d) => (
        <View key={d.name} style={[S.diseaseCard, { borderLeftColor: sevColor(d.severity) }]}>
          <View style={S.diseaseCardHeader}>
            <View style={[S.diseaseIconBg, { backgroundColor: sevBg(d.severity) }]}>
              <Ionicons name={d.icon || 'warning'} size={18} color={sevColor(d.severity)} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.diseaseName}>{d.name}</Text>
              <View style={[S.severityPill, { backgroundColor: sevBg(d.severity), alignSelf: 'flex-start' }]}>
                <Text style={[S.severityPillTxt, { color: sevColor(d.severity) }]}>{sevLabel(d.severity)}</Text>
              </View>
            </View>
            {/* If detected in photos, show camera icon */}
            {safeDetections.some(det => det.disease === d.name) && (
              <View style={S.cameraDetectedBadge}>
                <Ionicons name="camera" size={12} color={BLUE} />
                <Text style={S.cameraDetectedTxt}>{t('ai.detected')}</Text>
              </View>
            )}
          </View>
          <Text style={S.diseaseDesc}>{d.desc}</Text>
        </View>
      ))}
      </Animated.View>

      {/* ── Soil Health ── */}
      <Animated.View style={aS(5)}>
      <View style={[S.card, { borderLeftWidth: 4, borderLeftColor: soilColor }]}>
        <View style={S.cardTitleRow}>
          <Text style={S.cardTitle}>{t('ai.soilHealth')}</Text>
          <Text style={[S.soilHealthScore, { color: soilColor }]}>{soilHealth}</Text>
        </View>
        <Text style={S.cardSubtitle}>{soil?.name} · {soil?.desc}</Text>

        <View style={S.phRow}>
          <Text style={S.phLabel}>{t('ai.phLevel')}</Text>
          <View style={S.phBarWrap}>
            <View style={[S.phBarFill, { width: `${phPercent}%`, backgroundColor: soilColor }]} />
          </View>
          <Text style={[S.phValue, { color: soilColor }]}>{soilPh}</Text>
        </View>
        <View style={S.phRow}>
          <Text style={S.phLabel}>{t('ai.carbonIndex')}</Text>
          <View style={S.phBarWrap}>
            <View style={[S.phBarFill, {
              width: soilCarbon === 'High' ? '85%' : soilCarbon === 'Medium' ? '55%' : '30%',
              backgroundColor: soilColor,
            }]} />
          </View>
          <Text style={[S.phValue, { color: soilColor }]}>{soilCarbon}</Text>
        </View>

        <Text style={S.soilNote}>
          {soilHealth === 'Excellent'
            ? t('ai.soilHealthExcellent')
            : soilHealth === 'Moderate'
            ? t('ai.soilHealthModerate')
            : t('ai.soilHealthPoor')}
        </Text>

        {weather && (
          <View style={S.soilWeatherNote}>
            <Ionicons name="partly-sunny" size={14} color={ORANGE} />
            <Text style={S.soilWeatherNoteTxt}>
              {t('ai.soilHumidityNote', { humidity: weather.humidity, condition: soilHealth === 'Poor' ? t('ai.soilDrainPoor') : t('ai.soilDrainGood') })}
            </Text>
          </View>
        )}
      </View>
      </Animated.View>

      {/* ── Fertilizer Action Plan ── */}
      <Animated.View style={aS(6)}>
      <View style={S.card}>
        <Text style={S.cardTitle}>{t('ai.fertPlan')}</Text>
        <Text style={S.cardSubtitle}>{t('ai.fertPlanSub', { field: landSize ? t('ai.fertField', { landSize }) : t('ai.fertYourField'), crop: crop.name })}</Text>
        {safeFertilizer.map((f, i) => (
          <View key={f.name} style={[S.fertRow, i < safeFertilizer.length - 1 && S.fertRowBorder]}>
            <View style={[S.fertIconWrap, { backgroundColor: statColor(f.status) + '18' }]}>
              <Ionicons
                name={f.status === 'critical' ? 'alert-circle' : f.status === 'scheduled' ? 'calendar' : 'time'}
                size={20}
                color={statColor(f.status)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <View style={S.fertTopRow}>
                <Text style={S.fertName}>{f.name}</Text>
                <View style={[S.fertBadge, { backgroundColor: statColor(f.status) + '18' }]}>
                  <Text style={[S.fertBadgeTxt, { color: statColor(f.status) }]}>{t('ai.' + statLabelKey(f.status))}</Text>
                </View>
              </View>
              <Text style={S.fertDose}>{f.dose}</Text>
              <Text style={S.fertTiming}>{f.timing}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* ── Pesticide Recommendation ── */}
      {safePesticide.name ? (
      <View style={S.card}>
        <View style={S.cardTitleRow}>
          <Text style={S.cardTitle}>{t('ai.pesticideRec')}</Text>
          <View style={S.topRatedBadge}><Text style={S.topRatedTxt}>{t('ai.topRated')}</Text></View>
        </View>

        <View style={S.pestHeader}>
          <View style={S.pestIconWrap}>
            <Ionicons name="flask" size={28} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={S.pestName}>{safePesticide.name}</Text>
            <Text style={S.pestTagline}>{t('ai.pesticideTagline', { crop: crop.name })}</Text>
          </View>
        </View>

        <View style={S.pestStatsRow}>
          <View style={S.pestStatCell}>
            <Text style={S.pestStatLabel}>{t('ai.dosage')}</Text>
            <Text style={S.pestStatValue}>{safePesticide.dose}</Text>
          </View>
          <View style={S.pestStatDiv} />
          <View style={S.pestStatCell}>
            <Text style={S.pestStatLabel}>{t('ai.frequency')}</Text>
            <Text style={S.pestStatValue}>{safePesticide.freq}</Text>
          </View>
        </View>

        <View style={S.safetyBox}>
          <Ionicons name="warning" size={14} color={ORANGE} />
          <View style={{ flex: 1 }}>
            <Text style={[S.safetyTitle, { color: ORANGE }]}>{t('ai.safetyNote')}</Text>
            <Text style={S.safetyDesc}>{safePesticide.safety}</Text>
          </View>
        </View>

        {weather && weather.wind > 25 && (
          <View style={[S.safetyBox, { backgroundColor: COLORS.redPale, borderColor: RED + '40' }]}>
            <Ionicons name="warning" size={14} color={RED} />
            <Text style={[S.safetyDesc, { flex: 1, color: RED }]}>
              {t('ai.windWarn', { wind: weather.wind })}
            </Text>
          </View>
        )}

        <TouchableOpacity style={S.mixingBtn}>
          <Ionicons name="document-text-outline" size={16} color={BLUE} />
          <Text style={S.mixingBtnTxt}>{t('ai.mixingInstructions')}</Text>
        </TouchableOpacity>
      </View>
      ) : null}
      </Animated.View>

      {/* ── Start New Analysis ── */}
      <TouchableOpacity style={S.backBtn} onPress={onBack}>
        <Ionicons name="refresh" size={15} color={COLORS.grayMedium} />
        <Text style={S.backBtnTxt}>{t('ai.startNewAnalysis')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────
export default function AIRecommendation({ navigation }) {
  const { t } = useLanguage();
  const { coords: gpsCoords } = useLocation(); // global GPS — no extra prompt
  const [step,       setStep]       = useState(1);
  const [crop,       setCrop]       = useState(null);
  const [landSize,   setLandSize]   = useState('');
  const [prevCrop,   setPrevCrop]   = useState('');
  const [photos,     setPhotos]     = useState([]);
  const [soil,       setSoil]       = useState(null);
  const [weather,    setWeather]    = useState(null);
  const [analyzing,  setAnalyzing]  = useState(false);
  const [detections, setDetections] = useState([]);

  const goBack = () => {
    if (step === 1) navigation.goBack();
    else setStep(s => s - 1);
  };

  const proceedToResults = async (soilType, wx) => {
    setSoil(soilType);
    setWeather(wx);
    setAnalyzing(true);
    try {
      const formData = new FormData();
      formData.append('cropId', crop.id);
      formData.append('soilId', soilType.id);
      formData.append('landSize', landSize);
      formData.append('weather', JSON.stringify(wx));
      photos.forEach((photo, i) => {
        formData.append('photos', { uri: photo.uri, type: 'image/jpeg', name: `photo_${i}.jpg` });
        formData.append(`photoTypes[${i}]`, photo.type);
      });
      const { data } = await api.post('/agristore/analyze', formData);
      setDetections(data.data?.detections || []);
    } catch {
      setDetections([]);
    } finally {
      setAnalyzing(false);
      setStep(4);
    }
  };

  const resetAll = () => {
    setCrop(null); setLandSize(''); setPrevCrop('');
    setPhotos([]); setSoil(null); setWeather(null);
    setDetections([]); setStep(1);
  };

  return (
    <View style={S.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity style={S.headerBack} onPress={goBack} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color={COLORS.charcoal} />
        </TouchableOpacity>
        <View style={S.headerCenter}>
          <Text style={S.headerTitle}>AI Crop Advisor</Text>
          {crop && <Text style={S.headerSub}>{crop.name} · {step < 4 ? `Step ${step} of 4` : 'Results'}</Text>}
        </View>
        <View style={[S.headerAvatar, { backgroundColor: COLORS.primary }]}>
          <Ionicons name="leaf" size={16} color={COLORS.white} />
        </View>
      </View>

      {/* Step indicator */}
      <StepIndicator current={step} />

      {/* Content */}
      <View style={S.body}>
        {step === 1 && (
          <Step1
            onNext={(c, land, prev) => {
              setCrop(c); setLandSize(land); setPrevCrop(prev);
              setStep(2);
            }}
          />
        )}
        {step === 2 && (
          <Step2
            crop={crop}
            onNext={(capturedPhotos) => { setPhotos(capturedPhotos); setStep(3); }}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && (
          <Step3
            crop={crop}
            photos={photos}
            onNext={proceedToResults}
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && !analyzing && (
          <Step4
            crop={crop}
            soil={soil}
            landSize={landSize}
            prevCrop={prevCrop}
            weather={weather}
            photos={photos}
            detections={detections}
            onBack={resetAll}
          />
        )}
      </View>

      {/* AI Analyzing overlay */}
      <AnalyzingOverlay visible={analyzing} photos={photos} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 40 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.white,
    paddingTop: Platform.OS === 'ios' ? 52 : 36,
    paddingBottom: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.lightGray2,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  headerBack:   { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle:  { fontSize: 16, fontWeight: '800', color: COLORS.textDark },
  headerSub:    { fontSize: 11, color: COLORS.textLight, marginTop: 1 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },

  // Step indicator
  stepWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.white, paddingHorizontal: 20,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.lightGray2,
  },
  stepItem:   { alignItems: 'center', gap: 4 },
  stepDot:    { width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.gray150, justifyContent: 'center', alignItems: 'center' },
  stepDotActive: { backgroundColor: BLUE },
  stepDotDone:   { backgroundColor: COLORS.primary },
  stepNum:    { fontSize: 11, fontWeight: '800', color: COLORS.grayLight2 },
  stepNumActive: { color: COLORS.white },
  stepLabel:  { fontSize: 9, fontWeight: '600', color: COLORS.grayLight2, letterSpacing: 0.3 },
  stepLabelActive: { color: BLUE, fontWeight: '800' },
  stepLine:   { flex: 1, height: 2, backgroundColor: COLORS.gray150, marginHorizontal: 4 },
  stepLineActive: { backgroundColor: COLORS.primary },

  // Analyzing overlay
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
  },
  overlayGradient: {
    flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 36,
    backgroundColor: COLORS.deepNavy,
  },
  overlayTitle:    { fontSize: 26, fontWeight: '900', color: COLORS.white, marginBottom: 8 },
  overlaySub:      { fontSize: 13, color: COLORS.grayLight2, marginBottom: 28, textAlign: 'center' },
  progressBarWrap: { width: '100%', height: 6, backgroundColor: COLORS.darkHerb, borderRadius: 3, overflow: 'hidden', marginBottom: 24 },
  progressBarFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 3 },
  overlayStepRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  overlayStepTxt:  { fontSize: 12, color: COLORS.textLight },

  // Common
  rowBetween:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  stepTitle:     { fontSize: 22, fontWeight: '900', color: COLORS.textDark, marginBottom: 8 },
  stepSub:       { fontSize: 13, color: COLORS.textBody, lineHeight: 20, marginBottom: 18 },
  sectionLabel:  { fontSize: 15, fontWeight: '800', color: COLORS.textDark, marginBottom: 12 },

  aiBadge:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.bluePale, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  aiBadgeTxt: { fontSize: 10, fontWeight: '800', color: BLUE },

  // Crop grid
  cropGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  cropCard: {
    width: (SCREEN_W - 32 - 10) / 2 - 2, // 2 cols with gap
    backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden',
    borderWidth: 2, borderColor: COLORS.gray100alt,
    shadowColor: COLORS.black, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  cropImg:        { width: '100%', height: 100 },
  cropCheckBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: COLORS.white, borderRadius: 11 },
  cropFooter:     { paddingHorizontal: 10, paddingVertical: 10 },
  cropName:       { fontSize: 14, fontWeight: '700', color: COLORS.textDark, marginBottom: 2 },
  cropSeason:     { fontSize: 10, color: COLORS.textLight, fontWeight: '500' },
  otherCropCard:  { justifyContent: 'center', alignItems: 'center', minHeight: 140, borderStyle: 'dashed', borderColor: COLORS.divider },
  otherCropIconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  otherCropTxt:   { fontSize: 13, color: COLORS.grayLight2, fontWeight: '600' },

  selectedPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.primaryPale, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, marginBottom: 4 },
  selectedPillDot: { width: 8, height: 8, borderRadius: 4 },
  selectedPillTxt: { fontSize: 12, color: COLORS.primary, fontWeight: '600', flex: 1 },

  // Inputs
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.white, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.gray150,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  textInput: { flex: 1, fontSize: 15, color: COLORS.textDark },
  inputUnit: { fontSize: 13, color: COLORS.textLight, fontWeight: '700' },

  // Dropdown
  dropdown: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.gray150, paddingHorizontal: 14, paddingVertical: 14 },
  dropdownTxt: { flex: 1, fontSize: 14, color: COLORS.textDark, fontWeight: '600' },
  dropdownMenu: { backgroundColor: COLORS.white, borderRadius: 12, borderWidth: 1, borderColor: COLORS.gray100alt, marginTop: 4, overflow: 'hidden', shadowColor: COLORS.black, shadowOpacity: 0.08, shadowRadius: 6, elevation: 4 },
  dropdownItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  dropdownItemTxt: { fontSize: 14, color: COLORS.textDark },

  // Info box
  infoBox: { flexDirection: 'row', gap: 12, backgroundColor: COLORS.warmBg, borderRadius: 14, padding: 14, marginTop: 16, borderWidth: 1, borderColor: 'rgba(245,166,35,0.31)' },
  infoBoxIcon:  { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  infoBoxTitle: { fontSize: 10, fontWeight: '900', letterSpacing: 1, marginBottom: 4 },
  infoBoxTxt:   { fontSize: 12, color: COLORS.grayMid2, lineHeight: 18 },

  // Tips banner
  tipsBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: COLORS.warmBg, borderRadius: 10, padding: 12, marginBottom: 20, borderWidth: 1, borderColor: ORANGE + '30' },
  tipsBannerTxt: { flex: 1, fontSize: 12, color: COLORS.grayMid2, lineHeight: 17 },

  // Scan type chips
  scanTypeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.grayLight, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
  scanTypeChipActive: { backgroundColor: COLORS.primary },
  scanTypeLabel: { fontSize: 13, fontWeight: '700', color: COLORS.grayMid2 },
  scanHint: { fontSize: 12, color: COLORS.textLight, marginBottom: 14, fontStyle: 'italic' },

  // Capture buttons
  captureRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  captureBtn: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  captureBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  captureBtnOutline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderWidth: 2, borderColor: COLORS.primary, borderRadius: 14 },
  captureBtnTxt: { fontSize: 13, fontWeight: '800', color: COLORS.white },

  // Photo count
  photoCountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  photoCountTxt: { fontSize: 12, color: COLORS.textLight, fontWeight: '600' },
  photoCountBar: { flexDirection: 'row', gap: 6 },
  photoCountDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.gray150 },
  photoCountDotFilled: { backgroundColor: COLORS.primary },

  // Photo grid
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  photoThumb: {
    width: (SCREEN_W - 32 - 10) / 2,
    height: 130, borderRadius: 12, overflow: 'hidden',
    backgroundColor: COLORS.lightGray2,
    position: 'relative',
  },
  photoThumbImg:   { width: '100%', height: '100%' },
  photoTag:        { position: 'absolute', bottom: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  photoTagTxt:     { fontSize: 10, fontWeight: '800', color: COLORS.white },
  photoAiTag:      { position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: COLORS.white, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  photoAiTxt:      { fontSize: 9, fontWeight: '800', color: COLORS.primary },
  photoRemove:     { position: 'absolute', top: 6, right: 6 },
  photoAddMore:    {
    width: (SCREEN_W - 32 - 10) / 2,
    height: 130, borderRadius: 12,
    borderWidth: 2, borderColor: COLORS.border, borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center', gap: 6,
  },
  photoAddMoreTxt: { fontSize: 11, color: COLORS.divider, fontWeight: '600' },

  // Buttons
  primaryBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: BLUE, borderRadius: 14, paddingVertical: 16, marginTop: 20 },
  primaryBtnTxt: { color: COLORS.white, fontSize: 14, fontWeight: '900', letterSpacing: 0.3 },
  btnDisabled:   { opacity: 0.45 },
  backBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, marginTop: 8 },
  backBtnTxt:    { fontSize: 13, color: COLORS.textLight, fontWeight: '600' },

  // Live weather tag
  liveTag:  { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.primaryPale, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  liveDot:  { width: 7, height: 7, borderRadius: 3.5, backgroundColor: COLORS.primary },
  liveTxt:  { fontSize: 10, fontWeight: '900', color: COLORS.primary },
  weatherLoading:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 20 },
  weatherLoadingTxt: { fontSize: 13, color: COLORS.textLight },

  // Condition grid (2×2)
  condGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  condCard: {
    width: (SCREEN_W - 32 - 10) / 2,
    backgroundColor: COLORS.white, borderRadius: 14, padding: 14,
    shadowColor: COLORS.black, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
    alignItems: 'flex-start',
  },
  condIconWrap: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  condLabel:    { fontSize: 9, fontWeight: '900', color: COLORS.grayLight2, letterSpacing: 1.5, marginBottom: 4 },
  condValue:    { fontSize: 22, fontWeight: '900', marginBottom: 2 },
  condSub:      { fontSize: 10, color: COLORS.textLight, lineHeight: 14 },

  // Soil grid
  soilGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  soilCard: {
    width: (SCREEN_W - 32 - 10) / 2,
    backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden',
    borderWidth: 2, borderColor: COLORS.gray100alt,
    shadowColor: COLORS.black, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  soilImg:     { width: '100%', height: 85 },
  soilCheck:   { position: 'absolute', top: 6, right: 6, backgroundColor: COLORS.white, borderRadius: 10 },
  soilFooter:  { padding: 10 },
  soilName:    { fontSize: 13, fontWeight: '700', color: COLORS.textDark, marginBottom: 3 },
  soilDesc:    { fontSize: 10, color: COLORS.textLight, lineHeight: 14, marginBottom: 4 },
  soilCrops:   { fontSize: 9, color: COLORS.grayLight2, fontWeight: '600' },

  // Results header
  resultsHeader:     { borderRadius: 18, overflow: 'hidden', marginBottom: 14 },
  resultsHeaderGrad: { padding: 22 },
  verifiedBadge:     { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 12 },
  verifiedTxt:       { fontSize: 10, fontWeight: '900', color: COLORS.white, letterSpacing: 1 },
  resultsTitle:      { fontSize: 26, fontWeight: '900', color: COLORS.white, marginBottom: 6 },
  resultsSub:        { fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 19, marginBottom: 16 },
  resultsStats:      { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 12, padding: 14 },
  resultsStat:       { flex: 1, alignItems: 'center' },
  resultsStatVal:    { fontSize: 22, fontWeight: '900', color: COLORS.white },
  resultsStatLbl:    { fontSize: 9, color: 'rgba(255,255,255,0.65)', textAlign: 'center', marginTop: 4, lineHeight: 12 },
  resultsStatDiv:    { width: 1, backgroundColor: 'rgba(255,255,255,0.2)' },

  // Download button
  downloadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.bluePale, borderRadius: 14, paddingVertical: 14, marginBottom: 16, borderWidth: 1, borderColor: BLUE + '30' },
  downloadBtnTxt: { fontSize: 12, fontWeight: '900', color: BLUE, letterSpacing: 0.5 },

  // Cards
  card:         { backgroundColor: COLORS.white, borderRadius: 16, padding: 18, marginBottom: 14, shadowColor: COLORS.black, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardTitle:    { fontSize: 11, fontWeight: '900', color: COLORS.grayLight2, letterSpacing: 1.2 },
  cardSubtitle: { fontSize: 12, color: COLORS.textLight, marginBottom: 14, lineHeight: 17 },

  // Scan result badge
  scanResultBadge:    { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  scanResultBadgeTxt: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },

  // Photo result row
  photoResultRow: { flexDirection: 'row', gap: 12, marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: COLORS.grayLight },
  photoResultThumbWrap: { position: 'relative' },
  photoResultThumb:    { width: 90, height: 100, borderRadius: 12 },
  photoResultScanTag:  { position: 'absolute', bottom: 6, left: 0, right: 0, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.65)', paddingVertical: 3 },
  photoResultScanTxt:  { fontSize: 9, color: COLORS.white, fontWeight: '700' },
  photoResultInfo:     { flex: 1 },
  photoResultIdx:      { fontSize: 9, color: COLORS.grayLight2, fontWeight: '700', letterSpacing: 0.8, marginBottom: 3 },
  photoResultDisease:  { fontSize: 14, fontWeight: '800', color: COLORS.textDark, marginBottom: 6 },
  confRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 6 },
  confLabel:   { fontSize: 9, color: COLORS.grayLight2, width: 60 },
  confBarWrap: { flex: 1, height: 5, backgroundColor: COLORS.grayLight, borderRadius: 3, overflow: 'hidden' },
  confBarFill: { height: '100%', borderRadius: 3 },
  confPct:     { fontSize: 11, fontWeight: '800', width: 32, textAlign: 'right' },
  photoResultDesc: { fontSize: 11, color: COLORS.textLight, lineHeight: 15 },

  // Diagnosis header
  diagHeaderRow:  { flexDirection: 'row', gap: 14, marginBottom: 16 },
  diagCropImg:    { width: 90, height: 90, borderRadius: 14 },
  diagHeaderInfo: { flex: 1, justifyContent: 'center' },
  diagCropName:   { fontSize: 20, fontWeight: '900', color: COLORS.textDark, marginBottom: 3 },
  diagSeason:     { fontSize: 11, color: COLORS.textLight, marginBottom: 2 },
  diagPrevCrop:   { fontSize: 11, color: COLORS.textLight },
  diagDivider:    { height: 1, backgroundColor: COLORS.grayLight, marginBottom: 14 },
  diagItem:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  diagDot:        { width: 8, height: 8, borderRadius: 4 },
  diagItemName:   { flex: 1, fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  severityBadge:  { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  severityBadgeTxt: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },

  // Severity pill
  severityPill:    { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3, marginTop: 4 },
  severityPillTxt: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },

  // Disease cards
  diseaseCard: {
    backgroundColor: COLORS.white, borderRadius: 14, padding: 14,
    marginBottom: 10, borderLeftWidth: 4,
    shadowColor: COLORS.black, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  diseaseCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  diseaseIconBg:     { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  diseaseName:       { fontSize: 15, fontWeight: '800', color: COLORS.textDark, marginBottom: 2 },
  diseaseDesc:       { fontSize: 12, color: COLORS.grayMid2, lineHeight: 18 },
  cameraDetectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.bluePale, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4, alignSelf: 'flex-start' },
  cameraDetectedTxt:   { fontSize: 8, fontWeight: '900', color: BLUE, letterSpacing: 0.5 },

  // Soil health
  soilHealthScore: { fontSize: 18, fontWeight: '900' },
  phRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  phLabel:   { width: 90, fontSize: 12, color: COLORS.textBody, fontWeight: '600' },
  phBarWrap: { flex: 1, height: 7, backgroundColor: COLORS.grayLight, borderRadius: 4, overflow: 'hidden' },
  phBarFill: { height: '100%', borderRadius: 4 },
  phValue:   { width: 50, fontSize: 12, fontWeight: '800', color: COLORS.textDark, textAlign: 'right' },
  soilNote:  { fontSize: 12, color: COLORS.grayMid2, lineHeight: 18, marginTop: 4 },
  soilWeatherNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: COLORS.warmBg, borderRadius: 10, padding: 10, marginTop: 12 },
  soilWeatherNoteTxt: { flex: 1, fontSize: 11, color: COLORS.grayMid2, lineHeight: 16 },

  // Fertilizer
  fertRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12 },
  fertRowBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  fertIconWrap:  { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  fertTopRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  fertName:      { fontSize: 14, fontWeight: '800', color: COLORS.textDark, flex: 1 },
  fertBadge:     { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3, marginLeft: 8 },
  fertBadgeTxt:  { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  fertDose:      { fontSize: 13, color: COLORS.textDark, fontWeight: '700', marginBottom: 2 },
  fertTiming:    { fontSize: 11, color: COLORS.textLight },

  // Pesticide
  topRatedBadge: { backgroundColor: COLORS.primaryPale, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  topRatedTxt:   { fontSize: 9, fontWeight: '900', color: COLORS.primary, letterSpacing: 0.8 },
  pestHeader:    { flexDirection: 'row', alignItems: 'center', gap: 14, marginVertical: 14 },
  pestIconWrap:  { width: 58, height: 58, borderRadius: 14, backgroundColor: COLORS.primaryPale, justifyContent: 'center', alignItems: 'center' },
  pestName:      { fontSize: 15, fontWeight: '800', color: COLORS.textDark, marginBottom: 4, flex: 1 },
  pestTagline:   { fontSize: 11, color: COLORS.textLight },
  pestStatsRow:  { flexDirection: 'row', backgroundColor: COLORS.background, borderRadius: 12, overflow: 'hidden', marginBottom: 14 },
  pestStatCell:  { flex: 1, padding: 14, alignItems: 'center' },
  pestStatLabel: { fontSize: 9, fontWeight: '900', color: COLORS.grayLight2, letterSpacing: 1, marginBottom: 5 },
  pestStatValue: { fontSize: 13, fontWeight: '800', color: COLORS.textDark },
  pestStatDiv:   { width: 1, backgroundColor: COLORS.gray150 },
  safetyBox:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: COLORS.warmBg, borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: ORANGE + '30' },
  safetyTitle:   { fontSize: 9, fontWeight: '900', letterSpacing: 0.8, marginBottom: 3 },
  safetyDesc:    { fontSize: 12, color: COLORS.grayMid2, lineHeight: 17 },
  mixingBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12, paddingVertical: 13 },
  mixingBtnTxt:  { fontSize: 12, fontWeight: '700', color: BLUE },

  // Analyzing overlay — enhanced sphere
  overlaySphereWrap: { width: 190, height: 190, justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  overlayGlow: {
    position: 'absolute',
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: COLORS.primary + '35',
    top: 40, left: 40,
  },
  scanIconWrap: {
    position: 'absolute',
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: COLORS.primary + '20',
    justifyContent: 'center', alignItems: 'center',
    top: 50, left: 50,
    borderWidth: 2, borderColor: COLORS.primary + '40',
  },
});

// ─── HeroBanner styles ───────────────────────────────────────────────────────
const HB = StyleSheet.create({
  wrap: {
    height: 160, borderRadius: 18, overflow: 'hidden',
    marginBottom: 4,
  },
  contentRow: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  sphereWrap: { width: 140, height: 140 },
  glowRing: {
    position: 'absolute', width: 70, height: 70, borderRadius: 35,
    backgroundColor: COLORS.primary + '40',
    top: 35, left: 35,
    shadowColor: COLORS.primary, shadowOpacity: 0.8, shadowRadius: 12, elevation: 4,
  },
  centerIcon: {
    position: 'absolute', top: 45, left: 45,
    width: 50, height: 50, borderRadius: 25, overflow: 'hidden',
  },
  centerGrad: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  textArea: { flex: 1, paddingLeft: 16 },
  aiChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary + '25', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
    alignSelf: 'flex-start', marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  aiChipTxt: { fontSize: 9, fontWeight: '900', color: COLORS.primary, letterSpacing: 1.2 },
  heroTitle: { fontSize: 18, fontWeight: '900', color: COLORS.white, lineHeight: 24, marginBottom: 6 },
  heroSub:   { fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 17 },
});

// ─── ScanModeBanner styles ───────────────────────────────────────────────────
const SMB = StyleSheet.create({
  wrap: {
    height: 130, borderRadius: 18, overflow: 'hidden',
    marginBottom: 4,
  },
  frameWrap: {
    position: 'absolute', left: 20, top: 13,
    width: 104, height: 104,
  },
  textArea: {
    position: 'absolute', left: 144, top: 16, right: 16,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary + '25', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
    alignSelf: 'flex-start', marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.primary + '30',
  },
  chipTxt: { fontSize: 8, fontWeight: '900', color: COLORS.primary, letterSpacing: 1 },
  title:   { fontSize: 15, fontWeight: '900', color: COLORS.white, marginBottom: 5, lineHeight: 19 },
  sub:     { fontSize: 10, color: 'rgba(255,255,255,0.55)', lineHeight: 15 },
});

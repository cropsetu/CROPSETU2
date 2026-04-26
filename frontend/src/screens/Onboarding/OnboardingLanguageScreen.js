/**
 * OnboardingLanguageScreen — Screen 1/2: Pick your language.
 * Colorful SVG decorations, flag emojis, region labels, animated cards.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Animated, Easing, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path, Defs, RadialGradient, Stop, Rect, Ellipse } from 'react-native-svg';
import { useLanguage } from '../../context/LanguageContext';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../../constants/colors';
import { s, vs, fs, ms } from '../../utils/responsive';

const { width: W } = Dimensions.get('window');

const LANGS = [
  { code: 'en', name: 'English',   native: 'English',  flag: '🌍', region: 'Global',             accent: '#4CAF50', bg: '#E8F5E9' },
  { code: 'hi', name: 'Hindi',     native: 'हिन्दी',     flag: '🏛️', region: 'UP · MP · Rajasthan', accent: '#FF9800', bg: '#FFF3E0' },
  { code: 'mr', name: 'Marathi',   native: 'मराठी',      flag: '🏰', region: 'Maharashtra',        accent: '#E65100', bg: '#FBE9E7' },
  { code: 'ta', name: 'Tamil',     native: 'தமிழ்',      flag: '🛕', region: 'Tamil Nadu',         accent: '#9C27B0', bg: '#F3E5F5' },
  { code: 'te', name: 'Telugu',    native: 'తెలుగు',     flag: '💎', region: 'Telangana · AP',     accent: '#1976D2', bg: '#E3F2FD' },
  { code: 'kn', name: 'Kannada',   native: 'ಕನ್ನಡ',      flag: '🪷', region: 'Karnataka',          accent: '#E91E63', bg: '#FCE4EC' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം',    flag: '🌴', region: 'Kerala',             accent: '#00897B', bg: '#E0F2F1' },
  { code: 'bn', name: 'Bengali',   native: 'বাংলা',      flag: '🐅', region: 'West Bengal',        accent: '#F57F17', bg: '#FFF8E1' },
  { code: 'gu', name: 'Gujarati',  native: 'ગુજરાતી',    flag: '🦁', region: 'Gujarat',            accent: '#C62828', bg: '#FFEBEE' },
  { code: 'pa', name: 'Punjabi',   native: 'ਪੰਜਾਬੀ',     flag: '🌾', region: 'Punjab',             accent: '#2E7D32', bg: '#E8F5E9' },
];

// ── Decorative SVG background ───────────────────────────────────────────────
function HeroBgDecoration() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="g1" cx="85%" cy="15%" r="45%">
            <Stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.08" />
            <Stop offset="100%" stopColor={COLORS.primary} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="g2" cx="10%" cy="80%" r="50%">
            <Stop offset="0%" stopColor="#FF9800" stopOpacity="0.06" />
            <Stop offset="100%" stopColor="#FF9800" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="g3" cx="50%" cy="50%" r="60%">
            <Stop offset="0%" stopColor="#E3F2FD" stopOpacity="0.3" />
            <Stop offset="100%" stopColor="#E3F2FD" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {/* Soft gradient blobs */}
        <Circle cx="90%" cy="8%" r="120" fill="url(#g1)" />
        <Circle cx="5%" cy="85%" r="100" fill="url(#g2)" />
        <Circle cx="50%" cy="45%" r="180" fill="url(#g3)" />

        {/* Decorative leaf paths */}
        <Path
          d="M-10,60 Q40,30 80,55 T160,50 T240,60 T320,55 T400,65"
          stroke={COLORS.primary}
          strokeWidth="1.2"
          strokeOpacity="0.06"
          fill="none"
        />
        <Path
          d="M-10,120 Q60,95 120,115 T240,110 T360,120 T440,108"
          stroke="#FF9800"
          strokeWidth="1"
          strokeOpacity="0.05"
          fill="none"
        />

        {/* Small decorative circles */}
        <Circle cx="15%" cy="20%" r="4" fill={COLORS.primary} fillOpacity="0.08" />
        <Circle cx="80%" cy="30%" r="6" fill="#FF9800" fillOpacity="0.07" />
        <Circle cx="25%" cy="70%" r="5" fill="#9C27B0" fillOpacity="0.06" />
        <Circle cx="70%" cy="75%" r="3" fill="#1976D2" fillOpacity="0.08" />

        {/* Leaf icon shape (top right) */}
        <Path
          d="M340,40 C350,20 380,15 390,35 C395,45 370,55 340,40Z"
          fill={COLORS.primary}
          fillOpacity="0.05"
        />
        <Path
          d="M20,160 C30,140 55,138 60,155 C63,163 42,170 20,160Z"
          fill="#FF9800"
          fillOpacity="0.04"
        />
      </Svg>
    </View>
  );
}

// ── Floating animated dots ──────────────────────────────────────────────────
function FloatingDot({ x, y, size, color, delay }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  const opacity = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 0.7, 0.3] });
  return (
    <Animated.View style={{
      position: 'absolute', left: x, top: y,
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color,
      transform: [{ translateY }], opacity,
    }} />
  );
}

// ── Language Card with press animation ──────────────────────────────────────
function LangCard({ lang, active, onSelect, index }) {
  const scale = useRef(new Animated.Value(1)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeIn, {
      toValue: 1, duration: 400, delay: index * 60,
      easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
  }, []);

  const translateY = fadeIn.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });

  return (
    <Animated.View style={{ opacity: fadeIn, transform: [{ scale }, { translateY }] }}>
      <TouchableOpacity
        style={[sty.langCard, active && { borderColor: lang.accent, backgroundColor: lang.bg }]}
        activeOpacity={1}
        onPressIn={() => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 40 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5 }).start()}
        onPress={() => onSelect(lang.code)}
      >
        {/* Flag emoji circle */}
        <View style={[sty.flagWrap, active && { backgroundColor: lang.accent + '18' }]}>
          <Text style={sty.flag}>{lang.flag}</Text>
        </View>

        {/* Text content */}
        <View style={{ flex: 1 }}>
          <Text style={[sty.langNative, active && { color: lang.accent, fontWeight: '800' }]}>
            {lang.native}
          </Text>
          <Text style={[sty.langRegion, active && { color: lang.accent + 'AA' }]}>
            {lang.region}
          </Text>
        </View>

        {/* Check / Radio */}
        {active ? (
          <View style={[sty.checkCircle, { backgroundColor: lang.accent }]}>
            <Ionicons name="checkmark" size={14} color="#FFF" />
          </View>
        ) : (
          <View style={sty.radioCircle} />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function OnboardingLanguageScreen({ navigation }) {
  const { language, setLanguage, t } = useLanguage();
  const [selected, setSelected] = useState(language || 'en');

  const handleNext = async () => {
    await setLanguage(selected);
    navigation.navigate('OnboardingProfile');
  };

  const selectedLang = LANGS.find(l => l.code === selected);

  return (
    <View style={sty.container}>
      <HeroBgDecoration />

      {/* Floating animated dots */}
      <FloatingDot x={W * 0.12} y={vs(80)} size={8} color={COLORS.primary} delay={0} />
      <FloatingDot x={W * 0.82} y={vs(100)} size={6} color="#FF9800" delay={500} />
      <FloatingDot x={W * 0.65} y={vs(140)} size={5} color="#9C27B0" delay={1000} />
      <FloatingDot x={W * 0.3} y={vs(130)} size={7} color="#1976D2" delay={800} />

      <ScrollView
        contentContainerStyle={sty.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <View style={sty.header}>
          <View style={sty.logoRow}>
            <LinearGradient
              colors={[COLORS.primary, COLORS.primaryMedium || '#21865A']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={sty.logoCircle}
            >
              <Ionicons name="leaf" size={ms(22)} color="#FFF" />
            </LinearGradient>
            <View>
              <Text style={sty.appName}>{t('appName')}</Text>
              <Text style={sty.appSub}>{t('onboarding.smartFarming')}</Text>
            </View>
          </View>

          {/* Hero illustration area */}
          <View style={sty.heroIllustration}>
            <Svg width={s(80)} height={s(80)} viewBox="0 0 80 80">
              <Defs>
                <RadialGradient id="iconBg" cx="50%" cy="50%" r="50%">
                  <Stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.12" />
                  <Stop offset="100%" stopColor={COLORS.primary} stopOpacity="0.03" />
                </RadialGradient>
              </Defs>
              <Circle cx="40" cy="40" r="38" fill="url(#iconBg)" />
              <Circle cx="40" cy="40" r="28" fill={COLORS.primary} fillOpacity="0.08" />
              {/* Globe lines */}
              <Ellipse cx="40" cy="40" rx="20" ry="20" stroke={COLORS.primary} strokeWidth="1.5" strokeOpacity="0.2" fill="none" />
              <Ellipse cx="40" cy="40" rx="10" ry="20" stroke={COLORS.primary} strokeWidth="1" strokeOpacity="0.15" fill="none" />
              <Path d="M20,40 H60" stroke={COLORS.primary} strokeWidth="1" strokeOpacity="0.15" />
              <Path d="M40,20 V60" stroke={COLORS.primary} strokeWidth="1" strokeOpacity="0.12" />
            </Svg>
            <View style={{ marginLeft: s(16) }}>
              <Text style={sty.title}>Choose your{'\n'}language</Text>
              <Text style={sty.subtitle}>अपनी भाषा चुनें · तुमची भाषा निवडा</Text>
            </View>
          </View>
        </View>

        {/* ── Language List ────────────────────────────────────────────── */}
        <View style={sty.listContainer}>
          {LANGS.map((lang, i) => (
            <LangCard
              key={lang.code}
              lang={lang}
              active={selected === lang.code}
              onSelect={setSelected}
              index={i}
            />
          ))}
        </View>

        <View style={{ height: vs(100) }} />
      </ScrollView>

      {/* ── Bottom CTA ────────────────────────────────────────────────── */}
      <View style={sty.bottomBar}>
        {/* Selected language indicator */}
        <View style={sty.selectedIndicator}>
          <Text style={sty.selectedFlag}>{selectedLang?.flag}</Text>
          <Text style={sty.selectedText}>
            <Text style={{ fontWeight: '700', color: selectedLang?.accent }}>{selectedLang?.native}</Text>
            {'  ·  '}{selectedLang?.name}
          </Text>
        </View>

        <TouchableOpacity style={sty.btn} onPress={handleNext} activeOpacity={0.8}>
          <LinearGradient
            colors={[COLORS.primary, COLORS.primaryMedium || '#21865A']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={sty.btnGrad}
          >
            <Text style={sty.btnTxt}>{t('next')}</Text>
            <View style={sty.btnArrow}>
              <Ionicons name="arrow-forward" size={16} color={COLORS.primary} />
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const sty = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { paddingBottom: vs(20) },

  // Header
  header: { paddingHorizontal: s(24), paddingTop: vs(58) },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: s(10), marginBottom: vs(24) },
  logoCircle: {
    width: ms(42), height: ms(42), borderRadius: ms(14),
    justifyContent: 'center', alignItems: 'center',
    ...SHADOWS.greenGlow,
  },
  appName: { fontSize: fs(20), fontWeight: TYPE.weight.black || '900', color: COLORS.textDark, letterSpacing: -0.3 },
  appSub: { fontSize: fs(11), color: COLORS.textMedium, marginTop: vs(1) },

  // Hero illustration
  heroIllustration: { flexDirection: 'row', alignItems: 'center', marginBottom: vs(24) },
  title: { fontSize: fs(26), fontWeight: TYPE.weight.black || '900', color: COLORS.textDark, lineHeight: fs(34) },
  subtitle: { fontSize: fs(12), color: COLORS.textMedium, marginTop: vs(6), lineHeight: fs(18) },

  // List
  listContainer: { paddingHorizontal: s(20), gap: vs(8) },
  langCard: {
    flexDirection: 'row', alignItems: 'center', gap: s(14),
    paddingHorizontal: s(16), paddingVertical: vs(14),
    borderRadius: s(16), borderWidth: 1.5, borderColor: '#F0F0F0',
    backgroundColor: '#FAFAFA',
  },
  flagWrap: {
    width: s(46), height: s(46), borderRadius: s(14),
    backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center',
  },
  flag: { fontSize: fs(24) },
  langNative: { fontSize: fs(16), fontWeight: '600', color: COLORS.textDark },
  langRegion: { fontSize: fs(11), color: COLORS.textLight, marginTop: vs(2) },
  checkCircle: {
    width: s(26), height: s(26), borderRadius: s(13),
    justifyContent: 'center', alignItems: 'center',
    ...SHADOWS.xs,
  },
  radioCircle: {
    width: s(24), height: s(24), borderRadius: s(12),
    borderWidth: 1.5, borderColor: '#D6D3D1',
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: s(24), paddingTop: vs(10), paddingBottom: vs(34),
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1, borderTopColor: '#F0F0F0',
    ...SHADOWS.medium,
  },
  selectedIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: s(8),
    alignSelf: 'center', marginBottom: vs(10),
    paddingHorizontal: s(14), paddingVertical: vs(5),
    borderRadius: s(20), backgroundColor: '#F8F8F8',
  },
  selectedFlag: { fontSize: fs(16) },
  selectedText: { fontSize: fs(13), color: COLORS.textMedium },
  btn: { borderRadius: RADIUS.full || 28, overflow: 'hidden' },
  btnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: s(10), paddingVertical: vs(16),
    ...SHADOWS.greenGlow,
  },
  btnTxt: { color: '#FFF', fontSize: fs(16), fontWeight: TYPE.weight.bold || '700' },
  btnArrow: {
    width: s(28), height: s(28), borderRadius: s(14),
    backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center',
  },
});

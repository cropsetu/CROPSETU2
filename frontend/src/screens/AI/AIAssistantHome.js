/**
 * AIAssistantHome — FarmMind AI hub
 *
 * Layout:
 *  Header (sparkles + title)
 *  Greeting card (name, location, quick pills)
 *  Ask input → AIChat
 *  Quick Services 4-col (Scan, Chat, Markets, Schemes)
 *  AI TOOLS 2-col grid  ← expanded: 6 tools total
 *  Quick Weather card
 */
import { useRef, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Dimensions, Animated, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { fetchWeatherForCurrentLocation } from '../../services/weatherApi';
import { getAICredits } from '../../services/aiApi';
import FarmProfileBanner from '../../components/FarmProfileBanner';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../../constants/colors';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const { width: W } = Dimensions.get('window');
const GREEN   = COLORS.primary;
const GREEN_L = COLORS.primaryPale;

// ── Quick services (4-col icon grid) — labels resolved via t() in render ─────
const QUICK_SERVICES = [
  { id: 'scan',    labelKey: 'aiHome.quickServices.scan',    icon: 'scan-circle',         color: COLORS.primary, bg: COLORS.greenTint,  screen: 'CropScan' },
  { id: 'chat',    labelKey: 'aiHome.quickServices.chat',    icon: 'chatbubble-ellipses', color: COLORS.blue, bg: COLORS.blueMist,  screen: 'AIChat'   },
  { id: 'markets', labelKey: 'aiHome.quickServices.markets', icon: 'trending-up',         color: COLORS.rustOrange, bg: COLORS.creamOrange, screen: 'Market'   },
  { id: 'weather', labelKey: 'aiHome.quickServices.weather', icon: 'partly-sunny',        color: COLORS.sellerConfirmed, bg: COLORS.skyPale, screen: 'Weather'  },
];

// ── AI Tools (2-col grid) ────────────────────────────────────────────────────
// Order: 1. Crop scan  2. AI Chat  3. Voice chat  4. Price prediction  5. My Farms
const AI_TOOLS = [
  { id: 'disease', labelKey: 'aiHome.tools.disease.label', descKey: 'aiHome.tools.disease.desc', icon: 'scan', color: GREEN, bg: COLORS.greenTint, screen: 'CropScan', badge: 'AI' },
  { id: 'chatSupport', labelKey: 'aiHome.tools.chatSupport.label', descKey: 'aiHome.tools.chatSupport.desc', icon: 'chatbubbles', color: COLORS.blue, bg: COLORS.blueMist, screen: 'AIChat', badge: 'LIVE' },
  { id: 'voiceChat', labelKey: 'aiHome.tools.voiceChat.label', descKey: 'aiHome.tools.voiceChat.desc', icon: 'mic', color: COLORS.rustOrange, bg: COLORS.creamOrange, screen: 'VoiceChat', badge: 'NEW' },
  { id: 'price', labelKey: 'aiHome.tools.price.label', descKey: 'aiHome.tools.price.desc', icon: 'analytics', color: COLORS.rustOrange, bg: COLORS.creamOrange, screen: 'Market' },
  { id: 'farms', labelKey: 'aiHome.tools.farms.label', descKey: 'aiHome.tools.farms.desc', icon: 'leaf', color: COLORS.primary, bg: COLORS.greenTint, screen: 'FarmList' },
  { id: 'soil', labelKey: 'aiHome.tools.soil.label', descKey: 'aiHome.tools.soil.desc', icon: 'flask', color: COLORS.brownAlt, bg: COLORS.brownPale, screen: 'SoilHealth' },
  { id: 'pest', labelKey: 'aiHome.tools.pest.label', descKey: 'aiHome.tools.pest.desc', icon: 'bug', color: COLORS.crimsonAlt, bg: COLORS.errorLight, screen: 'PestAlerts' },
];

// ── ServiceBtn ────────────────────────────────────────────────────────────────
function ServiceBtn({ item, onPress, t }) {
  const sc = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[S.svcWrap, { transform: [{ scale: sc }] }]}>
      <TouchableOpacity
        style={S.svcBtn}
        activeOpacity={1}
        onPressIn={() => Animated.spring(sc, { toValue: 0.88, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(sc, { toValue: 1, useNativeDriver: true, friction: 4 }).start()}
        onPress={() => onPress(item)}
      >
        <View style={[S.svcIcon, { backgroundColor: item.bg, borderColor: item.color + '33' }]}>
          <Ionicons name={item.icon} size={26} color={item.color} />
        </View>
        <Text style={S.svcLabel}>{t(item.labelKey)}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── AIToolCard ────────────────────────────────────────────────────────────────
function AIToolCard({ tool, index, navigation, t }) {
  const sc   = useRef(new Animated.Value(1)).current;
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1, duration: 350, delay: 60 + index * 55, useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View style={[
      S.toolCardWrap,
      {
        opacity: anim,
        transform: [
          { scale: sc },
          { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
        ],
      },
    ]}>
      <TouchableOpacity
        style={S.toolCard}
        activeOpacity={1}
        onPressIn={() => Animated.spring(sc, { toValue: 0.94, useNativeDriver: true, speed: 40 }).start()}
        onPressOut={() => Animated.spring(sc, { toValue: 1, useNativeDriver: true, friction: 4 }).start()}
        onPress={() => navigation.navigate(tool.screen, tool.params || {})}
      >
        {/* Badge */}
        {tool.badge && (
          <View style={[S.badge, { backgroundColor: tool.badge === 'NEW' ? COLORS.cta : COLORS.greenDeep }]}>
            <Text style={S.badgeTxt}>{tool.badge}</Text>
          </View>
        )}

        {/* Icon */}
        <View style={[S.toolIconWrap, { backgroundColor: tool.bg }]}>
          <Ionicons name={tool.icon + '-outline'} size={22} color={tool.color} />
        </View>

        {/* Text */}
        <Text style={S.toolTitle}>{t(tool.labelKey)}</Text>
        <Text style={S.toolDesc}>{t(tool.descKey)}</Text>

        {/* Arrow */}
        <Ionicons name="chevron-forward" size={14} color={COLORS.grayNeutral} style={S.toolArrow} />
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AIAssistantHome({ navigation, embeddedInHub }) {
  const { user } = useAuth();
  const { t, language }    = useLanguage();

  const headerAnim = useRef(new Animated.Value(0)).current;

  // ── Live weather state ────────────────────────────────────────────────────
  const [wxData, setWxData] = useState(null);
  // ── AI Credit state ───────────────────────────────────────────────────────
  const [creditInfo, setCreditInfo] = useState(null);

  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();

    // Load weather — use cache-first so it's instant
    fetchWeatherForCurrentLocation({
      lang: language,
      onCacheHit: ({ data }) => { if (data?.current) setWxData(data); },
    }).then(result => {
      if (result?.data?.current) setWxData(result.data);
    }).catch(() => {});

    // Load AI credits
    getAICredits().then(setCreditInfo).catch(() => {});
  }, []);

  const handleService = (item) => {
    if (item.screen) navigation.navigate(item.screen, item.params || {});
  };

  return (

    <AnimatedScreen>
    <View style={[S.root]}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={S.scroll}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <Animated.View style={[
          S.headerRow,
          embeddedInHub && { paddingTop: 12 },
          { opacity: headerAnim, transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] },
        ]}>
          <View style={S.brandIconWrap}>
            <Ionicons name="hardware-chip" size={20} color={GREEN} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={S.headerTitle}>{t('aiHome.title')}</Text>
            <Text style={S.headerSub}>{t('aiHome.subtitle')}</Text>
          </View>
        </Animated.View>

        {/* ── Ask input ──────────────────────────────────────────────────── */}
        <TouchableOpacity style={S.askBtn} activeOpacity={0.85} onPress={() => navigation.navigate('AIChat')}>
          <Ionicons name="sparkles-outline" size={16} color={COLORS.textLight} />
          <Text style={S.askPlaceholder}>{t('aiHome.askPlaceholder')}</Text>
          <View style={S.askMic}>
            <Ionicons name="mic" size={16} color={GREEN} />
          </View>
        </TouchableOpacity>

        {/* ── Farm Profile Banner ────────────────────────────────────────── */}
        <FarmProfileBanner
          style={S.farmBanner}
          onEdit={() => navigation.navigate('Account')}
        />

        {/* ── Quick Services ─────────────────────────────────────────────── */}
        <View style={S.svcGrid}>
          {QUICK_SERVICES.map(item => (
            <ServiceBtn key={item.id} item={item} onPress={handleService} t={t} />
          ))}
        </View>

        {/* ── AI Tools section ───────────────────────────────────────────── */}
        <View style={S.sectionHeader}>
          <View style={[S.sectionDot, { backgroundColor: GREEN }]} />
          <Text style={S.sectionTitle}>{t('aiHome.aiTools')}</Text>
          <View style={S.newBadge}>
            <Text style={S.newBadgeTxt}>{t('aiHome.newBadge', { count: '1' })}</Text>
          </View>
        </View>

        {/* 2-column grid — 3 rows */}
        <View style={S.toolsGrid}>
          {AI_TOOLS.map((tool, i) => (
            <AIToolCard key={tool.id} tool={tool} index={i} navigation={navigation} t={t} />
          ))}
        </View>

        {/* ── AI Credits card ─────────────────────────────────────────────── */}
        {creditInfo && (
          <TouchableOpacity
            style={S.creditCard}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('AICredits')}
          >
            <View style={S.creditCardLeft}>
              <View style={S.creditIconWrap}>
                <Ionicons name="flash" size={18} color={COLORS.amber} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.creditCardTitle}>
                  {t('aiHome.aiCreditsTitle')}
                </Text>
                <Text style={S.creditCardSub}>
                  {t('aiHome.aiCreditsSub', { tier: creditInfo.tierLabel, spent: creditInfo.todaySpent || 0 })}
                </Text>
              </View>
            </View>
            <View style={S.creditCardRight}>
              <Text style={[
                S.creditBalance,
                creditInfo.balance <= 10 && { color: '#DC2626' },
              ]}>
                {creditInfo.balance}
              </Text>
              <Text style={S.creditBalanceLabel}>
                {t('aiHome.remaining')}
              </Text>
            </View>
            {/* Usage bar */}
            <View style={S.creditBarWrap}>
              <View style={[S.creditBar, {
                width: `${Math.min(100, Math.round(((creditInfo.lifetimeSpent || 0) / Math.max(creditInfo.lifetimeEarned || 1, 1)) * 100))}%`,
                backgroundColor: creditInfo.balance <= 10 ? '#DC2626' : COLORS.amber,
              }]} />
            </View>
          </TouchableOpacity>
        )}

        {/* ── Quick Weather card ─────────────────────────────────────────── */}
        <TouchableOpacity style={S.weatherCard} activeOpacity={0.88} onPress={() => navigation.navigate('Weather')}>
          <LinearGradient
            colors={[COLORS.skyBg, COLORS.iceBluePale, COLORS.skyBorder, COLORS.babyBlue]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={S.wxGradient}
          >

          {/* Row 1 — location + open arrow */}
          <View style={S.wxTopRow}>
            <Ionicons name="location-outline" size={11} color={COLORS.blueDark} />
            <Text style={S.wxLocation} numberOfLines={1}>
              {wxData?.meta?.location?.name || user?.district || user?.city || '—'}
            </Text>
            <Ionicons name="chevron-forward" size={13} color={COLORS.skyDark} />
          </View>

          {/* Row 2 — big temp + icon */}
          <View style={S.wxMidRow}>
            <Text style={S.wxTemp}>
              {wxData?.current?.temperature != null ? `${wxData.current.temperature}°` : '—'}
            </Text>
            <View style={S.wxIconWrap}>
              <Ionicons
                name={wxData?.current?.conditionIcon ? `${wxData.current.conditionIcon}` : 'partly-sunny'}
                size={44}
                color={COLORS.amber}
              />
            </View>
          </View>

          {/* Row 3 — condition label */}
          <Text style={S.wxCondition}>
            {wxData?.current?.condition || t('aiHome.partlyCloudy')}
          </Text>

          {/* Row 4 — stat pills */}
          <View style={S.wxStatRow}>
            <View style={S.wxStatPill}>
              <Ionicons name="water-outline" size={11} color={COLORS.blueDark} />
              <Text style={S.wxStatTxt}>{wxData?.current?.humidity ?? '—'}%</Text>
            </View>
            <View style={S.wxStatPill}>
              <Ionicons name="navigate-outline" size={11} color={COLORS.blueDark} />
              <Text style={S.wxStatTxt}>{wxData?.current?.windSpeed ?? '—'} km/h</Text>
            </View>
            <View style={S.wxStatPill}>
              <Ionicons name="sunny-outline" size={11} color={COLORS.blueDark} />
              <Text style={S.wxStatTxt}>UV {wxData?.current?.uvIndex ?? '—'}</Text>
            </View>
            <View style={[S.wxStatPill, {
              backgroundColor: wxData?.current?.isStorm ? 'rgba(183,28,28,0.20)'
                             : wxData?.current?.isRain  ? 'rgba(1,87,155,0.20)'
                             : 'rgba(27,94,32,0.20)',
            }]}>
              <Ionicons
                name={wxData?.current?.isStorm ? 'thunderstorm-outline' : wxData?.current?.isRain ? 'rainy-outline' : 'leaf-outline'}
                size={11} color={COLORS.blueDark}
              />
              <Text style={S.wxStatTxt}>
                {wxData?.current?.isStorm
                  ? t('aiHome.storm')
                  : wxData?.current?.isRain
                  ? t('aiHome.rain')
                  : t('aiHome.goodForSowing')}
              </Text>
            </View>
          </View>

          </LinearGradient>
        </TouchableOpacity>

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
    </AnimatedScreen>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.background },
  scroll: { paddingBottom: 48 },

  // Header
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    paddingTop: 58, paddingHorizontal: 20, paddingBottom: 18,
  },
  brandIconWrap: {
    width: 46, height: 46, borderRadius: 16,
    backgroundColor: GREEN_L, borderWidth: 1, borderColor: GREEN + '24',
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { fontSize: 23, fontWeight: TYPE.weight.black, color: COLORS.textDark, letterSpacing: -0.4 },
  headerSub:   { fontSize: 12, color: COLORS.textMedium, marginTop: 3, lineHeight: 17 },

  // Greeting
  greetCard: {
    marginHorizontal: 18, marginBottom: 14,
    backgroundColor: 'rgba(26,92,42,0.04)',
    borderRadius: 18, padding: 16,
    borderWidth: 1.5, borderColor: GREEN + '28',
    gap: 14,
    shadowColor: GREEN, shadowOpacity: 0.07, shadowRadius: 10, elevation: 2,
  },
  greetTop:    { flexDirection: 'row', alignItems: 'flex-start' },
  greetHi:     { fontSize: 20, fontWeight: '800', color: COLORS.textDark, marginBottom: 6 },
  greetMeta:   { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  greetMetaTxt:{ fontSize: 12, color: COLORS.textMedium },
  greetMetaDot:{ fontSize: 12, color: COLORS.textLight },
  greetCropTxt:{ fontSize: 12, color: GREEN, fontWeight: '700' },
  pillRow:     { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 10, borderWidth: 1, borderColor: GREEN + '30',
  },
  pillTxt: { fontSize: 12, fontWeight: '700', color: COLORS.textDark },

  // Ask input
  askBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 20, marginBottom: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 15,
    borderWidth: 1, borderColor: COLORS.border,
    ...SHADOWS.small,
  },
  askPlaceholder: { flex: 1, fontSize: 14, color: COLORS.textMedium, fontWeight: TYPE.weight.medium },
  askMic: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: GREEN_L,
    justifyContent: 'center', alignItems: 'center',
  },

  // Quick services
  farmBanner: {
    marginHorizontal: 20,
    marginBottom: 16,
  },

  svcGrid: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginHorizontal: 20, marginBottom: 8,
  },
  svcWrap: { alignItems: 'center', width: (W - 40 - 24) / 4 },
  svcBtn:  { alignItems: 'center', gap: 7 },
  svcIcon: {
    width: 60, height: 60, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center', borderWidth: 1,
  },
  svcLabel: { fontSize: 10.5, color: COLORS.textDark, fontWeight: TYPE.weight.bold, textAlign: 'center', lineHeight: 13 },

  // Section header
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, marginTop: 24, marginBottom: 13,
  },
  sectionDot:   { width: 6, height: 6, borderRadius: 3 },
  sectionTitle: {
    fontSize: 11, fontWeight: TYPE.weight.black, color: COLORS.textMedium,
    letterSpacing: 1.2, textTransform: 'uppercase', flex: 1,
  },
  newBadge: {
    backgroundColor: COLORS.cta, borderRadius: 7,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  newBadgeTxt: { fontSize: 9, fontWeight: '800', color: COLORS.white },

  // AI tools — 2-column grid
  toolsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    marginHorizontal: 20, gap: 12,
  },
  toolCardWrap: { width: (W - 40 - 12) / 2 },
  toolCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20, padding: 15,
    borderWidth: 1, borderColor: COLORS.border,
    ...SHADOWS.small,
    minHeight: 132,
  },
  badge: {
    position: 'absolute', top: 10, right: 10,
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  badgeTxt: { fontSize: 8, fontWeight: '900', color: COLORS.white },
  toolIconWrap: {
    width: 44, height: 44, borderRadius: 15,
    justifyContent: 'center', alignItems: 'center', marginBottom: 10,
  },
  toolTitle:  { fontSize: 13.5, fontWeight: TYPE.weight.black, color: COLORS.textDark, marginBottom: 5, lineHeight: 18 },
  toolDesc:   { fontSize: 11.5, color: COLORS.textMedium, lineHeight: 16 },
  toolArrow:  { position: 'absolute', bottom: 12, right: 12 },

  // AI Credits card
  creditCard: {
    marginHorizontal: 20, marginTop: 20,
    backgroundColor: COLORS.surface, borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: '#FFE082',
    ...SHADOWS.small,
  },
  creditCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  creditIconWrap: {
    width: 40, height: 40, borderRadius: 13,
    backgroundColor: '#FFF8E1', justifyContent: 'center', alignItems: 'center',
  },
  creditCardTitle: { fontSize: 14, fontWeight: TYPE.weight.black, color: COLORS.textDark },
  creditCardSub: { fontSize: 11, color: COLORS.textMedium, marginTop: 2 },
  creditCardRight: { position: 'absolute', top: 16, right: 16, alignItems: 'flex-end' },
  creditBalance: { fontSize: 26, fontWeight: '900', color: COLORS.amber, lineHeight: 28 },
  creditBalanceLabel: { fontSize: 9, color: COLORS.textLight, fontWeight: '600', marginTop: 1 },
  creditBarWrap: {
    height: 5, backgroundColor: '#FFF3E0', borderRadius: 3, overflow: 'hidden',
  },
  creditBar: { height: 5, borderRadius: 3 },

  // Weather card — sky gradient light theme
  weatherCard: {
    marginHorizontal: 20, marginTop: 22, borderRadius: 24, overflow: 'hidden',
    shadowColor: COLORS.babyBlue, shadowOpacity: 0.40, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  wxGradient: { borderRadius: 22, padding: 18 },
  wxTopRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 14,
  },
  wxLocation: {
    flex: 1, fontSize: 11, fontWeight: '700',
    color: COLORS.blueDark, letterSpacing: 0.4,
  },
  wxMidRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 4,
  },
  wxTemp: {
    fontSize: 56, fontWeight: '900', color: COLORS.blueDark, lineHeight: 58,
  },
  wxIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.35)',
    justifyContent: 'center', alignItems: 'center',
  },
  wxCondition: {
    fontSize: 14, color: COLORS.skyDark, fontWeight: '600', marginBottom: 16,
  },
  wxStatRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
  },
  wxStatPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.40)',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
  },
  wxStatTxt: { fontSize: 11, color: COLORS.blueDark, fontWeight: '700' },
});

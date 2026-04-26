/**
 * KisanRakshak — Pest Alert Dashboard
 *
 * Beautiful, comprehensive pest risk dashboard powered by agentic AI.
 * Features:
 *   - Overall risk gauge with animated score
 *   - Weather summary card with condition chips
 *   - Individual pest risk cards with progress bars
 *   - Expandable advisory sections
 *   - AI engine badge (agentic vs rule-based)
 *   - Community reports indicator
 */
import { COLORS, SHADOWS } from '../../constants/colors';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, StatusBar, Animated, Dimensions, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useFarm } from '../../context/FarmContext';
import { useLanguage } from '../../context/LanguageContext';
import { useLocation } from '../../context/LocationContext';
import { getPestPrediction, getPestAlerts, getAICredits } from '../../services/aiApi';
import { fetchWeatherForCurrentLocation } from '../../services/weatherApi';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const { width: W } = Dimensions.get('window');
const scale = (v) => Math.round(v * (W / 390));

// ── Risk level config ─────────────────────────────────────────────────────────
const RISK_CONFIG = {
  critical: { color: '#DC2626', bg: '#FEE2E2', icon: 'warning',             tKey: 'pestAlerts.riskCritical', gradient: ['#DC2626', '#EF4444'] },
  high:     { color: '#F57F17', bg: '#FFF8E1', icon: 'alert-circle',        tKey: 'pestAlerts.riskHigh',     gradient: ['#F57F17', '#FFB300'] },
  moderate: { color: '#F59E0B', bg: '#FEF3C7', icon: 'information-circle',  tKey: 'pestAlerts.riskModerate', gradient: ['#F59E0B', '#FBBF24'] },
  low:      { color: '#16A34A', bg: '#DCFCE7', icon: 'checkmark-circle',    tKey: 'pestAlerts.riskLow',      gradient: ['#16A34A', '#22C55E'] },
  unknown:  { color: '#78716C', bg: '#F5F5F4', icon: 'help-circle',         tKey: 'pestAlerts.riskUnknown',  gradient: ['#78716C', '#A8A29E'] },
};

const TREND_ICONS = {
  warm_humid: { icon: 'water', color: '#0288D1', tKey: 'pestAlerts.trendWarmHumid' },
  cool_humid: { icon: 'rainy',  color: '#0277BD', tKey: 'pestAlerts.trendCoolHumid' },
  hot_dry:    { icon: 'sunny',  color: '#E65100', tKey: 'pestAlerts.trendHotDry' },
  cool_dry:   { icon: 'snow',   color: '#00897B', tKey: 'pestAlerts.trendCoolDry' },
  rainy:      { icon: 'thunderstorm', color: '#1565C0', tKey: 'pestAlerts.trendRainy' },
};

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATED RISK GAUGE
// ═══════════════════════════════════════════════════════════════════════════════

function RiskGauge({ score, level, language }) {
  const { t } = useLanguage();
  const anim = useRef(new Animated.Value(0)).current;
  const cfg = RISK_CONFIG[level] || RISK_CONFIG.unknown;

  useEffect(() => {
    Animated.spring(anim, { toValue: score, useNativeDriver: false, tension: 40, friction: 8 }).start();
  }, [score]);

  const percentage = Math.round(score * 100);
  const circumference = 2 * Math.PI * 52;
  const strokeDashoffset = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, circumference * (1 - score)],
  });

  return (
    <View style={S.gaugeContainer}>
      <View style={S.gaugeCircle}>
        {/* Background circle */}
        <View style={S.gaugeSvgWrap}>
          <View style={[S.gaugeTrack, { borderColor: COLORS.border }]} />
          <Animated.View style={[S.gaugeProgress, {
            borderColor: cfg.color,
            borderTopColor: cfg.color,
            borderRightColor: score > 0.25 ? cfg.color : 'transparent',
            borderBottomColor: score > 0.5 ? cfg.color : 'transparent',
            borderLeftColor: score > 0.75 ? cfg.color : 'transparent',
            transform: [{ rotate: '-90deg' }],
          }]} />
        </View>
        <View style={S.gaugeCenter}>
          <Text style={[S.gaugeScore, { color: cfg.color }]}>{percentage}%</Text>
          <Text style={[S.gaugeLabel, { color: cfg.color }]}>
            {t('pestAlerts.riskLevel_' + level)}
          </Text>
        </View>
      </View>
      <View style={[S.gaugeBadge, { backgroundColor: cfg.bg }]}>
        <Ionicons name={cfg.icon} size={14} color={cfg.color} />
        <Text style={[S.gaugeBadgeText, { color: cfg.color }]}>
          {t('pestAlerts.overallRisk')}
        </Text>
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEATHER SUMMARY CARD
// ═══════════════════════════════════════════════════════════════════════════════

function WeatherCard({ weather, language }) {
  const { t } = useLanguage();
  if (!weather) return null;
  const trend = TREND_ICONS[weather.forecast_trend] || TREND_ICONS.warm_humid;

  return (
    <View style={S.weatherCard}>
      <View style={S.weatherHeader}>
        <View style={[S.weatherIconWrap, { backgroundColor: trend.color + '18' }]}>
          <Ionicons name={trend.icon} size={20} color={trend.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={S.weatherTitle}>
            {t('pestAlerts.weatherSummary')}
          </Text>
          <Text style={[S.weatherTrend, { color: trend.color }]}>
            {t('pestAlerts.trend_' + (weather.forecast_trend || 'warm_humid'))}
          </Text>
        </View>
      </View>
      <View style={S.weatherGrid}>
        <WeatherChip icon="thermometer" value={`${weather.temp_max || '--'}°`} label={t('pestAlerts.tempMax')} color="#E65100" />
        <WeatherChip icon="thermometer-outline" value={`${weather.temp_min || '--'}°`} label={t('pestAlerts.tempMin')} color="#0288D1" />
        <WeatherChip icon="water" value={`${weather.humidity_avg || '--'}%`} label={t('pestAlerts.humidity')} color="#00897B" />
        <WeatherChip icon="rainy" value={`${weather.rainfall_weekly_mm || 0}mm`} label={t('pestAlerts.rainfall')} color="#1565C0" />
        {weather.consecutive_rain_days > 0 && (
          <WeatherChip icon="cloud" value={`${weather.consecutive_rain_days}d`} label={t('pestAlerts.rainDays')} color="#7C3AED" />
        )}
      </View>
    </View>
  );
}

function WeatherChip({ icon, value, label, color }) {
  return (
    <View style={[S.weatherChip, { borderColor: color + '30' }]}>
      <Ionicons name={icon} size={14} color={color} />
      <Text style={[S.chipValue, { color }]}>{value}</Text>
      <Text style={S.chipLabel}>{label}</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PEST RISK CARD
// ═══════════════════════════════════════════════════════════════════════════════

function PestRiskCard({ pest, language, onPress }) {
  const { t } = useLanguage();
  const cfg = RISK_CONFIG[pest.risk_level] || RISK_CONFIG.moderate;
  const barWidth = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(barWidth, { toValue: pest.risk_score, useNativeDriver: false, tension: 50, friction: 10 }),
      Animated.spring(cardAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 12 }),
    ]).start();
  }, [pest.risk_score]);

  const widthInterp = barWidth.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <Animated.View style={{ opacity: cardAnim, transform: [{ translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
      <TouchableOpacity style={[S.pestCard, { borderLeftColor: cfg.color, borderLeftWidth: 4 }]} onPress={onPress} activeOpacity={0.7}>
        {/* Header row */}
        <View style={S.pestCardHeader}>
          <View style={[S.pestIconWrap, { backgroundColor: cfg.bg }]}>
            <Ionicons name="bug" size={18} color={cfg.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={S.pestName}>{pest.pest_name}</Text>
            {pest.pest_name_hi && <Text style={S.pestNameHi}>{pest.pest_name_hi}</Text>}
          </View>
          <View style={[S.riskBadge, { backgroundColor: cfg.bg }]}>
            <Text style={[S.riskBadgeText, { color: cfg.color }]}>
              {Math.round(pest.risk_score * 100)}%
            </Text>
          </View>
        </View>

        {/* Risk bar */}
        <View style={S.riskBarContainer}>
          <View style={S.riskBarBg}>
            <Animated.View style={[S.riskBarFill, { width: widthInterp, backgroundColor: cfg.color }]} />
          </View>
          <View style={[S.riskLevelTag, { backgroundColor: cfg.bg }]}>
            <Ionicons name={cfg.icon} size={10} color={cfg.color} />
            <Text style={[S.riskLevelText, { color: cfg.color }]}>
              {t('pestAlerts.riskLevel_' + (pest.risk_level || 'moderate'))}
            </Text>
          </View>
        </View>

        {/* Affected crops */}
        {pest.affected_crops?.length > 0 && (
          <View style={S.cropsRow}>
            <Ionicons name="leaf-outline" size={12} color={COLORS.primary} />
            <Text style={S.cropsText}>
              {pest.affected_crops.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(' · ')}
            </Text>
          </View>
        )}

        {/* Reasoning */}
        {pest.reasoning && (
          <Text style={S.reasoningText} numberOfLines={2}>{pest.reasoning}</Text>
        )}

        {/* Peak risk window */}
        {pest.peak_risk_window && (
          <View style={S.peakRow}>
            <Ionicons name="time-outline" size={12} color={COLORS.amber} />
            <Text style={S.peakText}>
              {t('pestAlerts.peakRisk', { window: pest.peak_risk_window })}
            </Text>
          </View>
        )}

        {/* Tap for details */}
        <View style={S.tapHint}>
          <Text style={S.tapHintText}>
            {t('pestAlerts.viewDetails')}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.primary} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PEST DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════════════════

function PestDetailView({ pest, language, onBack }) {
  const cfg = RISK_CONFIG[pest.risk_level] || RISK_CONFIG.moderate;
  const advisory = pest.advisory || {};

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={S.detailScroll} showsVerticalScrollIndicator={false}>
      {/* Back button */}
      <TouchableOpacity onPress={onBack} style={S.detailBack}>
        <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
        <Text style={S.detailBackText}>{t('pestAlerts.backToDashboard')}</Text>
      </TouchableOpacity>

      {/* Pest header */}
      <View style={[S.detailHeaderCard, { borderLeftColor: cfg.color, borderLeftWidth: 5 }]}>
        <View style={S.detailHeaderRow}>
          <View style={[S.detailIconLarge, { backgroundColor: cfg.bg }]}>
            <Ionicons name="bug" size={28} color={cfg.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={S.detailPestName}>{pest.pest_name}</Text>
            {pest.pest_name_hi && <Text style={S.detailPestHi}>{pest.pest_name_hi}</Text>}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <View style={[S.detailBadge, { backgroundColor: cfg.bg }]}>
                <Ionicons name={cfg.icon} size={12} color={cfg.color} />
                <Text style={[S.detailBadgeText, { color: cfg.color }]}>
                  {t(cfg.tKey)} — {Math.round(pest.risk_score * 100)}%
                </Text>
              </View>
              {pest.confidence && (
                <View style={[S.detailBadge, { backgroundColor: COLORS.surfaceSunken }]}>
                  <Text style={[S.detailBadgeText, { color: COLORS.textMedium }]}>
                    {t('pestAlerts.confidence')}: {pest.confidence}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
        {pest.affected_crops?.length > 0 && (
          <View style={S.detailCropsRow}>
            <Ionicons name="leaf" size={14} color={COLORS.primary} />
            <Text style={S.detailCropsText}>
              {pest.affected_crops.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(' · ')}
            </Text>
          </View>
        )}
      </View>

      {/* Reasoning */}
      {pest.reasoning && (
        <View style={S.detailSection}>
          <View style={S.sectionHeader}>
            <Ionicons name="analytics" size={16} color={COLORS.amber} />
            <Text style={S.sectionTitle}>{t('pestAlerts.analysis')}</Text>
          </View>
          <Text style={S.sectionBody}>{pest.reasoning}</Text>
        </View>
      )}

      {/* Symptoms */}
      {pest.symptoms?.length > 0 && (
        <View style={S.detailSection}>
          <View style={S.sectionHeader}>
            <Ionicons name="eye" size={16} color={cfg.color} />
            <Text style={S.sectionTitle}>{t('pestAlerts.symptomsToWatch')}</Text>
          </View>
          {pest.symptoms.map((s, i) => (
            <View key={i} style={S.symptomRow}>
              <View style={[S.symptomDot, { backgroundColor: cfg.color }]} />
              <Text style={S.symptomText}>{typeof s === 'string' ? s : s[language] || s.en || s.description || JSON.stringify(s)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Advisory sections */}
      {advisory.immediate && (
        <AdvisorySection
          icon="flash" color="#DC2626" bgColor="#FEE2E2"
          title={t('pestAlerts.immediateAction')}
          content={advisory.immediate}
        />
      )}
      {advisory.cultural && (
        <AdvisorySection
          icon="leaf" color="#16A34A" bgColor="#DCFCE7"
          title={t('pestAlerts.culturalControl')}
          content={advisory.cultural}
        />
      )}
      {advisory.biological && (
        <AdvisorySection
          icon="flower" color="#0891B2" bgColor="#CFFAFE"
          title={t('pestAlerts.biologicalControl')}
          content={advisory.biological}
        />
      )}
      {advisory.chemical_last_resort && (
        <AdvisorySection
          icon="flask" color="#9333EA" bgColor="#F3E8FF"
          title={t('pestAlerts.chemicalControlLastResort')}
          content={advisory.chemical_last_resort}
        />
      )}
      {/* Also handle the old format: organic/chemical from rule-based engine */}
      {!advisory.immediate && advisory.organic && (
        <AdvisorySection
          icon="leaf" color="#16A34A" bgColor="#DCFCE7"
          title={t('pestAlerts.organicControl')}
          content={typeof advisory.organic === 'string' ? advisory.organic : JSON.stringify(advisory.organic)}
        />
      )}
      {!advisory.immediate && advisory.chemical && (
        <AdvisorySection
          icon="flask" color="#9333EA" bgColor="#F3E8FF"
          title={t('pestAlerts.chemicalControl')}
          content={typeof advisory.chemical === 'string' ? advisory.chemical : JSON.stringify(advisory.chemical)}
        />
      )}

      {/* Preventive measures */}
      {pest.preventive_measures?.length > 0 && (
        <View style={S.detailSection}>
          <View style={S.sectionHeader}>
            <Ionicons name="shield-checkmark" size={16} color={COLORS.primary} />
            <Text style={S.sectionTitle}>{t('pestAlerts.preventiveMeasures')}</Text>
          </View>
          {pest.preventive_measures.map((m, i) => (
            <View key={i} style={S.symptomRow}>
              <View style={[S.symptomDot, { backgroundColor: COLORS.primary }]} />
              <Text style={S.symptomText}>{m}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function AdvisorySection({ icon, color, bgColor, title, content }) {
  return (
    <View style={[S.advisoryCard, { borderLeftColor: color, borderLeftWidth: 3 }]}>
      <View style={S.advisoryHeader}>
        <View style={[S.advisoryIconWrap, { backgroundColor: bgColor }]}>
          <Ionicons name={icon} size={14} color={color} />
        </View>
        <Text style={[S.advisoryTitle, { color }]}>{title}</Text>
      </View>
      <Text style={S.advisoryContent}>{content}</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

export default function PestAlertsScreen({ navigation }) {
  const { user } = useAuth();
  const { farmProfile } = useFarm();
  const { language, t } = useLanguage();
  const { coords: gpsCoords } = useLocation();

  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [selectedPest, setSelectedPest] = useState(null);
  const [useAI, setUseAI]           = useState(true);
  const [credits, setCredits]       = useState(null);     // { balance, used, level }
  const [tokenInfo, setTokenInfo]   = useState(null);     // { totalTokens, costUsd, model }

  const fetchPrediction = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const lat = gpsCoords?.latitude  ?? farmProfile?.location?.lat ?? user?.lat ?? 19.9975;
      const lon = gpsCoords?.longitude ?? farmProfile?.location?.lon ?? user?.lon ?? 73.7898;
      const crops = farmProfile?.currentCrops?.map(c => c.name) || user?.crops || [];
      const state = farmProfile?.location?.state || user?.state || 'Maharashtra';
      const district = farmProfile?.location?.district || user?.district || 'Pune';

      // Calculate day of season from first crop planting date
      let dayOfSeason = 45;
      if (farmProfile?.currentCrops?.[0]?.plantingDate) {
        const planted = new Date(farmProfile.currentCrops[0].plantingDate);
        dayOfSeason = Math.max(1, Math.round((Date.now() - planted.getTime()) / (1000 * 60 * 60 * 24)));
      }

      // Reuse existing cached weather data — no redundant API call
      let weatherData = null;
      try {
        const wx = await fetchWeatherForCurrentLocation({ lang: language });
        if (wx?.data) weatherData = wx.data;
      } catch { /* weather cache miss is fine — backend will fetch if needed */ }

      if (useAI) {
        // Try AI-powered agentic prediction — pass cached weather to avoid re-fetch
        try {
          const { prediction: result, credits: creditInfo, tokenUsage: tkInfo } = await getPestPrediction(lat, lon, crops, state, district, dayOfSeason, language, weatherData);
          setPrediction(result);
          if (creditInfo) setCredits(creditInfo);
          if (tkInfo) setTokenInfo(tkInfo);
          return;
        } catch (aiErr) {
          console.warn('AI prediction failed, falling back to rule-based:', aiErr?.message);
        }
      }

      // Fallback: use the basic rule-based alerts
      const alerts = await getPestAlerts(lat, lon, crops, state, district);
      // Transform to prediction format
      const transformed = {
        prediction_date: new Date().toISOString().split('T')[0],
        weather_summary: null,
        overall_risk: 'low',
        overall_risk_score: 0,
        predictions: (alerts || []).map(a => ({
          pest_name: a.pest,
          pest_name_hi: a.pestHi,
          risk_score: a.severity === 'critical' ? 0.9 : a.severity === 'high' ? 0.7 : a.severity === 'moderate' ? 0.45 : 0.2,
          risk_level: a.severity || 'moderate',
          confidence: 'medium',
          reasoning: a.triggerConditions?.description || a.reason || '',
          affected_crops: a.affectedCrops || a.crops || [],
          symptoms: (a.symptoms || []).map(s => typeof s === 'object' ? s : { en: s }),
          advisory: a.solutions || {},
          preventive_measures: [],
        })),
        _meta: { engine: 'rule_based' },
      };
      if (transformed.predictions.length > 0) {
        transformed.overall_risk_score = Math.max(...transformed.predictions.map(p => p.risk_score));
        transformed.overall_risk = transformed.overall_risk_score >= 0.75 ? 'critical'
          : transformed.overall_risk_score >= 0.5 ? 'high'
          : transformed.overall_risk_score >= 0.3 ? 'moderate' : 'low';
      }
      setPrediction(transformed);

    } catch (err) {
      setError(err?.response?.data?.error?.message || err?.message || 'Failed to analyze pest risk');
    } finally {
      setLoading(false);
    }
  }, [user, farmProfile, gpsCoords, language, useAI]);

  useEffect(() => { fetchPrediction(); }, [fetchPrediction]);

  // ── Detail view ──────────────────────────────────────────────────────────
  if (selectedPest) {
    return (
      <AnimatedScreen style={S.root}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
        <View style={S.header}>
          <TouchableOpacity onPress={() => setSelectedPest(null)} style={S.backBtn}>
            <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={S.headerTitle}>{selectedPest.pest_name}</Text>
            <Text style={S.headerSub}>{t('pestAlerts.pestAnalysis')}</Text>
          </View>
        </View>
        <PestDetailView pest={selectedPest} language={language} onBack={() => setSelectedPest(null)} />
      </AnimatedScreen>
    );
  }

  // ── Main dashboard ───────────────────────────────────────────────────────
  return (
    <AnimatedScreen style={S.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>
            {t('pestAlerts.kisanrakshak')}
          </Text>
          <Text style={S.headerSub}>
            {t('pestAlerts.aiPestPrediction')}
          </Text>
        </View>
        <TouchableOpacity onPress={fetchPrediction} style={S.refreshBtn} disabled={loading}>
          <Ionicons name="refresh-outline" size={20} color={loading ? COLORS.textDisabled : COLORS.primary} />
        </TouchableOpacity>
      </View>

      {/* Loading state */}
      {loading ? (
        <View style={S.centered}>
          <View style={S.loadingCard}>
            <ActivityIndicator color={COLORS.primary} size="large" />
            <Text style={S.loadingTitle}>
              {t('pestAlerts.aiAnalysisInProgress')}
            </Text>
            <Text style={S.loadingSub}>
              {t('pestAlerts.analyzingSub')}
            </Text>
            <View style={S.loadingSteps}>
              {[
                t('pestAlerts.fetchingWeatherData'),
                t('pestAlerts.checkingPestPatterns'),
                t('pestAlerts.calculatingRiskScores'),
              ].map((step, i) => (
                <View key={i} style={S.loadingStep}>
                  <Ionicons name="ellipse" size={6} color={COLORS.primary} />
                  <Text style={S.loadingStepText}>{step}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      ) : error ? (
        /* Error state */
        <View style={S.centered}>
          <View style={S.errorCard}>
            <View style={S.errorIconWrap}>
              <Ionicons name="cloud-offline" size={40} color={COLORS.error} />
            </View>
            <Text style={S.errorTitle}>{t('pestAlerts.analysisFailed')}</Text>
            <Text style={S.errorMsg}>{error}</Text>
            <TouchableOpacity style={S.retryBtn} onPress={fetchPrediction}>
              <Ionicons name="refresh" size={16} color={COLORS.white} />
              <Text style={S.retryText}>{t('pestAlerts.retry')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : prediction ? (
        /* Dashboard */
        <ScrollView contentContainerStyle={S.scrollContent} showsVerticalScrollIndicator={false}>

          {/* AI Engine + Credits badge row */}
          <View style={S.badgeRow}>
            <View style={S.engineBadge}>
              <Ionicons
                name={prediction._meta?.level >= 2 ? 'hardware-chip' : prediction._meta?.level === 1 ? 'sparkles' : 'cog'}
                size={12}
                color={prediction._meta?.level >= 2 ? COLORS.primary : prediction._meta?.level === 1 ? COLORS.amber : COLORS.textMedium}
              />
              <Text style={[S.engineText, {
                color: prediction._meta?.level >= 2 ? COLORS.primary : prediction._meta?.level === 1 ? COLORS.amber : COLORS.textMedium,
              }]}>
                {prediction._meta?.level >= 2
                  ? (t('pestAlerts.aiAgent'))
                  : prediction._meta?.level === 1
                  ? (t('pestAlerts.aiEnhanced'))
                  : (t('pestAlerts.rulebased'))}
                {prediction._meta?.elapsed_seconds > 0 && ` · ${prediction._meta.elapsed_seconds}s`}
              </Text>
            </View>
            {credits && (
              <View style={[S.creditBadge, credits.balance <= 5 && S.creditBadgeLow]}>
                <Ionicons name="flash" size={11} color={credits.balance <= 5 ? '#DC2626' : COLORS.amber} />
                <Text style={[S.creditText, credits.balance <= 5 && { color: '#DC2626' }]}>
                  {credits.balance ?? '--'} {t('pestAlerts.credits')}
                </Text>
              </View>
            )}
          </View>

          {/* Token usage info (collapsed) */}
          {tokenInfo && tokenInfo.totalTokens > 0 && (
            <View style={S.tokenRow}>
              <Ionicons name="analytics-outline" size={11} color={COLORS.textLight} />
              <Text style={S.tokenText}>
                {tokenInfo.totalTokens} tokens · ${tokenInfo.costUsd?.toFixed(4) || '0'} · {tokenInfo.model || 'rule_based'}
                {credits?.used > 0 && ` · -${credits.used} credits`}
              </Text>
            </View>
          )}

          {/* Risk Gauge */}
          <RiskGauge
            score={prediction.overall_risk_score || 0}
            level={prediction.overall_risk || 'low'}
            language={language}
          />

          {/* Weather Summary */}
          <WeatherCard weather={prediction.weather_summary} language={language} />

          {/* Community reports */}
          {prediction.community_reports_nearby > 0 && (
            <View style={S.communityCard}>
              <Ionicons name="people" size={16} color={COLORS.amber} />
              <Text style={S.communityText}>
                {t('pestAlerts.nearbyReports', { count: prediction.community_reports_nearby })}
              </Text>
            </View>
          )}

          {/* Pest predictions */}
          <View style={S.pestListHeader}>
            <Text style={S.pestListTitle}>
              {t('pestAlerts.pestRisks')}
            </Text>
            <Text style={S.pestListCount}>
              {prediction.predictions?.length || 0} {t('pestAlerts.detected')}
            </Text>
          </View>

          {(prediction.predictions?.length || 0) === 0 ? (
            <View style={S.safeCard}>
              <View style={S.safeIconWrap}>
                <Ionicons name="shield-checkmark" size={36} color={COLORS.primary} />
              </View>
              <Text style={S.safeTitle}>
                {t('pestAlerts.yourFieldIsSafe')}
              </Text>
              <Text style={S.safeSub}>
                {t('pestAlerts.noActiveRisks')}
              </Text>
            </View>
          ) : (
            prediction.predictions.map((pest, idx) => (
              <PestRiskCard
                key={pest.pest_name + idx}
                pest={pest}
                language={language}
                onPress={() => setSelectedPest(pest)}
              />
            ))
          )}

          {/* Info attribution */}
          <View style={S.attribution}>
            <Ionicons name="information-circle-outline" size={14} color={COLORS.textLight} />
            <Text style={S.attributionText}>
              {t('pestAlerts.source')}
            </Text>
          </View>

          <View style={{ height: 30 }} />
        </ScrollView>
      ) : null}
    </AnimatedScreen>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════════

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingTop: Platform.OS === 'ios' ? 56 : 16, paddingHorizontal: 18, paddingBottom: 14,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    ...SHADOWS.small,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 10, backgroundColor: COLORS.primaryPale },
  headerTitle: { fontSize: 20, fontWeight: '900', color: COLORS.textDark, letterSpacing: -0.3 },
  headerSub: { fontSize: 11, color: COLORS.textLight, marginTop: 1 },
  refreshBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 10, backgroundColor: COLORS.primaryPale },

  scrollContent: { padding: 18, gap: 14 },

  // ── Engine + Credit badges ───────────────────────────────────────────────
  badgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  engineBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: COLORS.border,
  },
  engineText: { fontSize: 11, fontWeight: '600' },
  creditBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFF8E1', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: '#FFE082',
  },
  creditBadgeLow: { backgroundColor: '#FEE2E2', borderColor: '#FECACA' },
  creditText: { fontSize: 11, fontWeight: '700', color: COLORS.amber },
  tokenRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
  },
  tokenText: { fontSize: 10, color: COLORS.textLight },

  // ── Risk Gauge ──────────────────────────────────────────────────────────
  gaugeContainer: { alignItems: 'center', paddingVertical: 8 },
  gaugeCircle: { width: 130, height: 130, justifyContent: 'center', alignItems: 'center' },
  gaugeSvgWrap: { position: 'absolute', width: 130, height: 130 },
  gaugeTrack: {
    position: 'absolute', width: 120, height: 120, borderRadius: 60,
    borderWidth: 8, borderColor: COLORS.border, top: 5, left: 5,
  },
  gaugeProgress: {
    position: 'absolute', width: 120, height: 120, borderRadius: 60,
    borderWidth: 8, top: 5, left: 5,
  },
  gaugeCenter: { alignItems: 'center' },
  gaugeScore: { fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  gaugeLabel: { fontSize: 12, fontWeight: '700', marginTop: -2 },
  gaugeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10,
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 5,
  },
  gaugeBadgeText: { fontSize: 11, fontWeight: '700' },

  // ── Weather Card ────────────────────────────────────────────────────────
  weatherCard: {
    backgroundColor: COLORS.surface, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.small,
  },
  weatherHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  weatherIconWrap: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  weatherTitle: { fontSize: 14, fontWeight: '800', color: COLORS.textDark },
  weatherTrend: { fontSize: 12, fontWeight: '600', marginTop: 1 },
  weatherGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  weatherChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.surfaceRaised, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, flex: 1, minWidth: scale(80),
  },
  chipValue: { fontSize: 14, fontWeight: '800' },
  chipLabel: { fontSize: 9, color: COLORS.textLight, fontWeight: '600' },

  // ── Pest Risk Card ──────────────────────────────────────────────────────
  pestCard: {
    backgroundColor: COLORS.surface, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.small,
  },
  pestCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  pestIconWrap: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  pestName: { fontSize: 16, fontWeight: '800', color: COLORS.textDark },
  pestNameHi: { fontSize: 12, color: COLORS.textMedium, marginTop: 1 },
  riskBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  riskBadgeText: { fontSize: 16, fontWeight: '900' },

  riskBarContainer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  riskBarBg: { flex: 1, height: 8, backgroundColor: COLORS.surfaceSunken, borderRadius: 4, overflow: 'hidden' },
  riskBarFill: { height: 8, borderRadius: 4 },
  riskLevelTag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  riskLevelText: { fontSize: 10, fontWeight: '800' },

  cropsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  cropsText: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },

  reasoningText: { fontSize: 12, color: COLORS.textBody, lineHeight: 18, marginBottom: 6 },

  peakRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  peakText: { fontSize: 11, color: COLORS.amber, fontWeight: '600' },

  tapHint: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
    paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.divider,
  },
  tapHintText: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },

  // ── Pest List Header ────────────────────────────────────────────────────
  pestListHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pestListTitle: { fontSize: 16, fontWeight: '900', color: COLORS.textDark },
  pestListCount: { fontSize: 12, color: COLORS.textMedium, fontWeight: '600' },

  // ── Safe card ───────────────────────────────────────────────────────────
  safeCard: {
    alignItems: 'center', padding: 32, borderRadius: 16,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.borderGreen,
  },
  safeIconWrap: {
    width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center',
    backgroundColor: COLORS.primaryPale, marginBottom: 16,
  },
  safeTitle: { fontSize: 18, fontWeight: '900', color: COLORS.primary, textAlign: 'center' },
  safeSub: { fontSize: 13, color: COLORS.textMedium, textAlign: 'center', marginTop: 6, lineHeight: 20 },

  // ── Community card ──────────────────────────────────────────────────────
  communityCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFF8E1', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#FFE082',
  },
  communityText: { flex: 1, fontSize: 13, color: '#F57F17', fontWeight: '600' },

  // ── Detail view ─────────────────────────────────────────────────────────
  detailScroll: { padding: 18, gap: 14 },
  detailBack: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  detailBackText: { fontSize: 14, color: COLORS.primary, fontWeight: '600' },
  detailHeaderCard: {
    backgroundColor: COLORS.surface, borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.small,
  },
  detailHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  detailIconLarge: { width: 56, height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  detailPestName: { fontSize: 22, fontWeight: '900', color: COLORS.textDark },
  detailPestHi: { fontSize: 14, color: COLORS.textMedium, marginTop: 2 },
  detailBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  detailBadgeText: { fontSize: 11, fontWeight: '700' },
  detailCropsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.divider },
  detailCropsText: { flex: 1, fontSize: 13, color: COLORS.primary, fontWeight: '600' },

  detailSection: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: COLORS.border, gap: 10,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: COLORS.textDark },
  sectionBody: { fontSize: 13, color: COLORS.textBody, lineHeight: 21 },

  symptomRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  symptomDot: { width: 7, height: 7, borderRadius: 4, marginTop: 7 },
  symptomText: { flex: 1, fontSize: 13, color: COLORS.textBody, lineHeight: 20 },

  // ── Advisory card ───────────────────────────────────────────────────────
  advisoryCard: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: COLORS.border, gap: 10,
  },
  advisoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  advisoryIconWrap: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  advisoryTitle: { fontSize: 13, fontWeight: '800' },
  advisoryContent: { fontSize: 13, color: COLORS.textBody, lineHeight: 21 },

  // ── Loading ─────────────────────────────────────────────────────────────
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingCard: {
    alignItems: 'center', padding: 32, borderRadius: 20,
    backgroundColor: COLORS.surface, width: '100%',
    borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.small,
  },
  loadingTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textDark, marginTop: 20 },
  loadingSub: { fontSize: 12, color: COLORS.textMedium, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  loadingSteps: { marginTop: 20, gap: 10, alignSelf: 'flex-start', width: '100%' },
  loadingStep: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingStepText: { fontSize: 12, color: COLORS.textLight },

  // ── Error ───────────────────────────────────────────────────────────────
  errorCard: {
    alignItems: 'center', padding: 32, borderRadius: 20,
    backgroundColor: COLORS.surface, width: '100%',
    borderWidth: 1, borderColor: COLORS.border,
  },
  errorIconWrap: {
    width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center',
    backgroundColor: COLORS.errorLight, marginBottom: 16,
  },
  errorTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textDark },
  errorMsg: { fontSize: 13, color: COLORS.error, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20,
    backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12,
  },
  retryText: { fontSize: 14, fontWeight: '700', color: COLORS.white },

  // ── Attribution ─────────────────────────────────────────────────────────
  attribution: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.divider,
  },
  attributionText: { flex: 1, fontSize: 10, color: COLORS.textLight, lineHeight: 16 },
});

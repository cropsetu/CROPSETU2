/**
 * FarmDetailScreen — cosmic-theme farm dashboard.
 *
 * Sections (scroll):
 *   1. Hero    — farm name, location, edit chip, 3 KPIs, active-badge
 *   2. Insights — AI-derived advisory built from soil/irrigation/cycles
 *   3. Crops   — active cycles with StageTimelineBar
 *   4. Soil    — pH/N/P/K/OC rating chips
 *   5. AI Actions — 2x2 grid of FarmMind entry points
 *
 * Plot-level tabs land in the next milestone once the Plot/ActivityLog
 * tables ship in Prisma. For now the screen scrolls top-to-bottom.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import CosmicScreen from './ui/CosmicScreen';
import CosmicHeader from './ui/CosmicHeader';
import GlassCard    from './ui/GlassCard';
import GlowButton   from './ui/GlowButton';
import StageTimelineBar from './ui/StageTimelineBar';
import WhyThisButton    from './ui/WhyThisButton';
import { CropIcon }  from '../../components/CropIcons';
import { RadialGauge } from '../../components/charts';
import { useMultiFarm } from '../../context/MultiFarmContext';
import { useLanguage }  from '../../context/LanguageContext';
import * as farmApi     from '../../services/farmApi';
import { COSMIC, CR, CS, CT, GLOW } from './theme/cosmicTheme';
import { Haptics } from '../../utils/haptics';

// ──────────────────────────────────────────────────────────────────────────────
// Screen
// ──────────────────────────────────────────────────────────────────────────────

// Soil rating → gauge colour (high = healthy green, low = red, else amber).
function soilColor(rating) {
  const r = (rating || '').toLowerCase();
  if (r.includes('high') || r.includes('adequate') || r.includes('optimum') || r.includes('normal')) return COSMIC.SUCCESS;
  if (r.includes('low') || r.includes('deficient')) return COSMIC.DANGER;
  return COSMIC.WARN;
}

export default function FarmDetailScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { activeFarmId, switchActiveFarm } = useMultiFarm();
  const { farmId } = route.params;

  const [farm, setFarm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await farmApi.getFarm(farmId);
      setFarm(data);
    } catch {
      Alert.alert(t('login.error') || 'Error', t('farmProfile.loadError') || 'Could not load farm details.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [farmId, t]);

  // Reload on every focus so a newly created/edited cycle shows up without a manual refresh.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);
  const onEdit    = useCallback(() => farm && navigation.navigate('FarmAddEdit', { farm }), [farm, navigation]);
  const onAdd     = useCallback(() => farm && navigation.navigate('CropCycleCreate', { farmId: farm.id }), [farm, navigation]);
  const onSetActive = useCallback(() => {
    if (!farm) return;
    Haptics.success?.();
    switchActiveFarm(farm.id);
  }, [farm, switchActiveFarm]);

  // ── Loading / error states ───────────────────────────────────────────────
  if (loading) {
    return (
      <CosmicScreen>
        <CosmicHeader title={t('loading')} />
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color={COSMIC.PRIMARY} />
        </View>
      </CosmicScreen>
    );
  }
  if (!farm) {
    return (
      <CosmicScreen>
        <CosmicHeader title={t('farmProfile.notFound')} />
        <View style={styles.centerWrap}>
          <Ionicons name="leaf-outline" size={48} color={COSMIC.MUTED} />
          <Text style={[styles.mutedText, { marginTop: 14 }]}>{t('farmProfile.notFound') || 'Farm not found.'}</Text>
          <GlowButton label={t('farmProfile.goBack')} variant="glass" onPress={() => navigation.goBack()} style={{ marginTop: 16 }} />
        </View>
      </CosmicScreen>
    );
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const isActive    = farm.id === activeFarmId;
  const soil        = (farm.soilReports || [])[0] || null;
  const cycles      = farm.cropCycles || [];
  const activeCycles    = cycles.filter((c) => c.status !== 'COMPLETED');
  const completedCycles = cycles.filter((c) => c.status === 'COMPLETED');
  const insights    = computeInsights(farm, soil, cycles, t);

  const farmName    = farm.farmName || farm.farmAlias || `Farm ${farm.farmNumber}`;
  const location    = [farm.village, farm.taluka, farm.district].filter(Boolean).join(', ');

  const editRight = (
    <CosmicHeader.IconButton icon="create-outline" onPress={onEdit} accessibilityLabel={t('farmProfile.editFarm')} />
  );

  return (
    <CosmicScreen backgroundVariant="default" edges={{ top: false, bottom: false }}>
      <CosmicHeader
        title={farmName}
        subtitle={location || undefined}
        right={editRight}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COSMIC.PRIMARY} colors={[COSMIC.PRIMARY]} />
        }
      >
        {/* ── Hero ─────────────────────────────────────────── */}
        <HeroCard
          farm={farm}
          isActive={isActive}
          onSetActive={onSetActive}
          t={t}
        />

        {/* ── Insights ─────────────────────────────────────── */}
        {insights.length > 0 && (
          <>
            <SectionLabel title={t('farmProfile.todaysInsights')} badge="Krushi AI" />
            <GlassCard variant="plain" style={styles.section} padding={0}>
              {insights.map((ins, i) => (
                <View key={i} style={[styles.insightRow, i > 0 && styles.insightRowBordered]}>
                  <View style={[styles.insightIconWrap, { backgroundColor: ins.color + '28', borderColor: ins.color + '55' }]}>
                    <Ionicons name={ins.icon} size={18} color={ins.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.insightText}>{ins.text}</Text>
                    {ins.action && (
                      <WhyThisButton
                        compact
                        label={ins.action}
                        onPress={() => navigation.navigate('AIAssistant', { screen: 'AIChat', params: { seed: ins.text } })}
                        style={{ marginTop: 6 }}
                      />
                    )}
                  </View>
                </View>
              ))}
            </GlassCard>
          </>
        )}

        {/* ── Active crop cycles ──────────────────────────── */}
        <SectionLabel
          title={t('farmProfile.activeCrops')}
          action={{ label: activeCycles.length ? t('farmProfile.addCycle') : t('farmProfile.startACycle'), onPress: onAdd }}
        />
        {activeCycles.length === 0 ? (
          <GlassCard variant="plain" style={styles.section}>
            <View style={styles.emptyCyclesRow}>
              <View style={[styles.bigBubble, GLOW.green]}>
                <CropIcon crop="Wheat" size={26} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionHeading}>{completedCycles.length ? t('farmProfile.noActiveCrops') : t('farmProfile.noCropCyclesYet')}</Text>
                <Text style={styles.mutedText}>{t('farmProfile.startCycleHint')}</Text>
              </View>
            </View>
            <GlowButton label={t('farmProfile.startACropCycle')} icon="leaf-outline" variant="primary" full onPress={onAdd} style={{ marginTop: 14 }} />
          </GlassCard>
        ) : (
          <View style={styles.section}>
            {activeCycles.map((c) => (
              <CycleRow key={c.id} cycle={c} onPress={() => navigation.navigate('CropCycleDetail', { cycleId: c.id })} />
            ))}
          </View>
        )}

        {/* ── History (completed cycles) ──────────────────── */}
        {completedCycles.length > 0 && (
          <>
            <SectionLabel title={t('farmProfile.historyCompleted', { count: completedCycles.length })} />
            <View style={styles.section}>
              {completedCycles.map((c) => (
                <CycleRow key={c.id} cycle={c} onPress={() => navigation.navigate('CropCycleDetail', { cycleId: c.id })} />
              ))}
            </View>
          </>
        )}

        {/* ── Soil health ─────────────────────────────────── */}
        <SectionLabel title={t('farmProfile.soilHealth')} action={!soil ? { label: t('farmProfile.uploadReport'), onPress: () => navigation.navigate('AIAssistant', { screen: 'SoilHealth' }) } : undefined} />
        <GlassCard variant="plain" style={styles.section}>
          {soil ? (
            <View style={styles.soilRow}>
              <RadialGauge size={62} strokeWidth={7} label="pH" value={soil.ph}            min={3} max={9}   decimals={1} color={soilColor(soil.phRating)} />
              <RadialGauge size={62} strokeWidth={7} label="N"  value={soil.nitrogen}      min={0} max={600} color={soilColor(soil.nitrogenRating)} />
              <RadialGauge size={62} strokeWidth={7} label="P"  value={soil.phosphorus}    min={0} max={60}  color={soilColor(soil.phosphorusRating)} />
              <RadialGauge size={62} strokeWidth={7} label="K"  value={soil.potassium}     min={0} max={400} color={soilColor(soil.potassiumRating)} />
              <RadialGauge size={62} strokeWidth={7} label="OC" value={soil.organicCarbon} min={0} max={2}   decimals={1} color={soilColor(soil.organicCarbonRating)} />
            </View>
          ) : (
            <View style={styles.emptyCyclesRow}>
              <View style={[styles.bigBubble, { backgroundColor: COSMIC.SURFACE_HI, borderWidth: 1, borderColor: COSMIC.BORDER_HI }]}>
                <Ionicons name="document-text-outline" size={22} color={COSMIC.TEXT_2} />
              </View>
              <Text style={[styles.mutedText, { flex: 1 }]}>
                {t('farmProfile.noSoilReportHint')}
              </Text>
            </View>
          )}
        </GlassCard>

        {/* ── AI Actions ──────────────────────────────────── */}
        <SectionLabel title={t('farmProfile.askFarmMind')} badge="AI" />
        <View style={[styles.section, styles.predGrid]}>
          <PredCard
            icon="chatbubble-ellipses"
            tint={COSMIC.PRIMARY}
            title={t('farmProfile.askFarmMind') || 'Ask Krushi Intelligence'}
            sub={t('farmProfile.chatAboutFarm') || 'Personal advisory for this farm'}
            onPress={() => navigation.navigate('AIAssistant', {
              screen: 'AIChat',
              params: { initialMessage: `Advise me on my ${farm.landSizeAcres || ''} acre farm in ${farm.district || ''} with ${(farm.soilType || '').replace(/_/g, ' ').toLowerCase()} soil and ${(farm.irrigationSystem || '').toLowerCase()} irrigation.` },
            })}
          />
          <PredCard
            icon="trending-up"
            tint={COSMIC.INFO}
            title={t('farmProfile.bestCrop') || 'Best crop this season'}
            sub={t('farmProfile.top5Soil') || 'Top picks for your soil + water'}
            onPress={() => navigation.navigate('AIAssistant', { screen: 'AIChat', params: { seed: 'Which crop suits my farm this season?' } })}
          />
          <PredCard
            icon="calculator"
            tint={COSMIC.ACCENT}
            title={t('farmProfile.seedQty') || 'Seed & fertilizer calc'}
            sub={t('farmProfile.exactKg') || 'Exact kg per acre'}
            onPress={() => navigation.navigate('AIAssistant', { screen: 'InputCalculator' })}
          />
          <PredCard
            icon="cash"
            tint={COSMIC.SUCCESS}
            title={t('farmProfile.income') || 'Income forecast'}
            sub={t('farmProfile.forecastRevenue') || 'Revenue projection'}
            onPress={() => navigation.navigate('AIAssistant', { screen: 'Market' })}
          />
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </CosmicScreen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Hero card — matches MyFarmHome hero visual language.
// ──────────────────────────────────────────────────────────────────────────────
function HeroCard({ farm, isActive, onSetActive, t }) {
  const acres  = Number(farm.landSizeAcres || 0);
  const soilLbl = (farm.soilType || 'unknown').replace(/_/g, ' ').toLowerCase();
  const irrLbl  = (farm.irrigationSystem || 'rainfed').toLowerCase();

  return (
    <View style={styles.heroOuter}>
      <GlassCard variant="bordered" padding={14}>
        <View style={styles.heroStatsRow}>
          <HeroStat icon="resize-outline" label={t('farmProfile.acresLabel')} value={acres > 0 ? acres.toFixed(2) : '—'} />
          <View style={styles.heroDivider} />
          <HeroStat icon="layers-outline" label={t('farmProfile.soilLabel')}  value={soilLbl} capitalize />
          <View style={styles.heroDivider} />
          <HeroStat icon="water-outline"  label={t('farmProfile.waterLabel')} value={irrLbl} capitalize />
        </View>

        {isActive ? (
          <View style={styles.activePill}>
            <Ionicons name="star" size={10} color={COSMIC.INVERSE} />
            <Text style={styles.activePillText}>{t('farmProfile.activeFarmMindUses')}</Text>
          </View>
        ) : (
          <Pressable onPress={onSetActive} style={({ pressed }) => [styles.setActiveBtn, pressed && { opacity: 0.7 }]}>
            <Ionicons name="star-outline" size={12} color={COSMIC.ACCENT} />
            <Text style={styles.setActiveText}>{t('farmProfile.setAsActiveFarm')}</Text>
          </Pressable>
        )}
      </GlassCard>
    </View>
  );
}

function HeroStat({ icon, value, label, capitalize }) {
  return (
    <View style={styles.heroStatCol}>
      <Ionicons name={icon} size={12} color={COSMIC.PRIMARY} />
      <Text style={[styles.heroStatValue, capitalize && { textTransform: 'capitalize' }]} numberOfLines={1}>
        {value || '—'}
      </Text>
      <Text style={styles.heroStatLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Crop cycle row — compact card
// ──────────────────────────────────────────────────────────────────────────────
function CycleRow({ cycle, onPress }) {
  const stage = cycle.growthStage || 'PLANNING';
  const das   = cycle.sowingDate
    ? Math.max(0, Math.floor((Date.now() - new Date(cycle.sowingDate).getTime()) / 86400000))
    : null;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ marginBottom: 10 }, pressed && { opacity: 0.88 }]}>
      <GlassCard variant="bordered">
        <View style={styles.cycleTopRow}>
          <View style={styles.cropIconWrap}>
            <CropIcon crop={cycle.cropName} size={44} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.cycleTitle} numberOfLines={1}>
              {cycle.cropName}{cycle.variety ? ` · ${cycle.variety}` : ''}
            </Text>
            <Text style={styles.cycleMeta} numberOfLines={1}>
              {Number(cycle.areaAllocatedAcres || 0).toFixed(2)} ac · {cycle.season || '—'} {cycle.year || ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COSMIC.TEXT_3} />
        </View>
        <StageTimelineBar currentStage={stage} das={das} style={{ marginTop: 10 }} />
      </GlassCard>
    </Pressable>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Soil rating badge
// ──────────────────────────────────────────────────────────────────────────────
function SoilBadge({ label, value, rating }) {
  const color = rating === 'high'
    ? COSMIC.PRIMARY_LT
    : rating === 'low'
    ? COSMIC.DANGER
    : COSMIC.WARN;
  return (
    <View style={styles.sBadge}>
      <Text style={styles.sBadgeLbl}>{label}</Text>
      <Text style={[styles.sBadgeVal, { color }]}>{value ?? '—'}</Text>
      <View style={[styles.sBadgePill, { backgroundColor: color + '22', borderColor: color + '55' }]}>
        <Text style={[styles.sBadgeRat, { color }]}>{rating || '—'}</Text>
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// AI prediction card
// ──────────────────────────────────────────────────────────────────────────────
function PredCard({ icon, tint, title, sub, onPress }) {
  return (
    <Pressable
      onPress={() => { Haptics.light?.(); onPress && onPress(); }}
      style={({ pressed }) => [styles.predCard, { borderColor: tint + '44' }, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}
    >
      <View style={[styles.predIcon, { backgroundColor: tint + '22', borderColor: tint + '55' }]}>
        <Ionicons name={icon} size={20} color={tint} />
      </View>
      <Text style={styles.predTitle} numberOfLines={2}>{title}</Text>
      <Text style={styles.predSub} numberOfLines={2}>{sub}</Text>
    </Pressable>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Section label (scoped to this screen — keeps screen self-contained)
// ──────────────────────────────────────────────────────────────────────────────
function SectionLabel({ title, action, badge }) {
  return (
    <View style={styles.sectionLabel}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {!!badge && (
          <View style={styles.sectionBadge}>
            <Text style={styles.sectionBadgeText}>{badge}</Text>
          </View>
        )}
      </View>
      {action && (
        <Pressable onPress={action.onPress}>
          <Text style={styles.sectionAction}>{action.label} →</Text>
        </Pressable>
      )}
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Insight heuristics — placeholder until v2 context-aware backend lands.
// ──────────────────────────────────────────────────────────────────────────────
function computeInsights(farm, soil, cycles, t) {
  const out = [];
  if (soil?.nitrogenRating === 'low') {
    out.push({ icon: 'alert-circle', color: COSMIC.DANGER,
      text: t('farmProfile.insightLowNitrogen'),
      action: t('farmProfile.askFarmMind') });
  }
  if (soil?.phRating === 'acidic') {
    out.push({ icon: 'flask', color: COSMIC.WARN,
      text: t('farmProfile.insightAcidicSoil'),
      action: t('farmProfile.insightHowToApplyLime') });
  }
  if (farm.irrigationSystem === 'RAINFED') {
    out.push({ icon: 'rainy-outline', color: COSMIC.INFO,
      text: t('farmProfile.insightRainfed'),
      action: t('farmProfile.insightOpenWeather') });
  }
  if (!soil) {
    out.push({ icon: 'document-text-outline', color: COSMIC.ACCENT,
      text: t('farmProfile.insightUploadShc'),
      action: t('farmProfile.insightUploadNow') });
  }
  if (cycles.length === 0) {
    out.push({ icon: 'leaf-outline', color: COSMIC.PRIMARY,
      text: t('farmProfile.insightNoCrops'),
      action: t('farmProfile.insightGetCropAdvice') });
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  scroll: { paddingBottom: 30 },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },

  // Hero
  heroOuter: { marginHorizontal: CS.base, marginTop: CS.sm },
  heroStatsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: COSMIC.SURFACE_HI,
    borderRadius: CR.md,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: COSMIC.BORDER,
  },
  heroStatCol: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  heroStatValue: { fontSize: 15, color: COSMIC.TEXT, fontFamily: 'PlusJakartaSans_800ExtraBold' },
  heroStatLabel: {
    fontSize: 10,
    color: COSMIC.TEXT_3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  heroDivider: { width: StyleSheet.hairlineWidth, backgroundColor: COSMIC.BORDER, marginVertical: 2 },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 4,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: CR.pill,
    backgroundColor: COSMIC.PRIMARY,
  },
  activePillText: { fontSize: 11, color: COSMIC.INVERSE, fontFamily: 'PlusJakartaSans_700Bold' },
  setActiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 4,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: CR.pill,
    backgroundColor: COSMIC.ACCENT_SOFT,
    borderWidth: 1,
    borderColor: COSMIC.ACCENT + '40',
  },
  setActiveText: { fontSize: 12, color: COSMIC.ACCENT, fontFamily: 'PlusJakartaSans_700Bold' },

  // Sections
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: CS.base,
    paddingTop: CS.lg,
    paddingBottom: 6,
    gap: 8,
  },
  sectionTitle: { fontSize: 14, color: COSMIC.TEXT, fontFamily: 'PlusJakartaSans_700Bold' },
  sectionBadge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: CR.pill,
    backgroundColor: COSMIC.PRIMARY_SOFT,
    borderWidth: 1,
    borderColor: COSMIC.PRIMARY + '33',
  },
  sectionBadgeText: { fontSize: 9, color: COSMIC.PRIMARY, fontFamily: 'PlusJakartaSans_700Bold', letterSpacing: 0.6 },
  sectionAction: { fontSize: 12, color: COSMIC.PRIMARY, fontFamily: 'PlusJakartaSans_700Bold' },
  section: { marginHorizontal: CS.base },

  // Insights
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
  },
  insightRowBordered: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COSMIC.BORDER },
  insightIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightText: { fontSize: 13, color: COSMIC.TEXT, lineHeight: 18, fontFamily: 'PlusJakartaSans_400Regular' },

  // Cycles
  cycleTopRow: { flexDirection: 'row', alignItems: 'center' },
  cropIconWrap: {
    width: 40,
    height: 40,
    borderRadius: CR.md,
    backgroundColor: COSMIC.SURFACE_HI,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COSMIC.BORDER,
    overflow: 'hidden',
  },
  cycleTitle: { fontSize: 14, color: COSMIC.TEXT, fontFamily: 'PlusJakartaSans_700Bold' },
  cycleMeta: {
    fontSize: 11,
    color: COSMIC.TEXT_3,
    marginTop: 1,
    textTransform: 'capitalize',
    fontFamily: 'PlusJakartaSans_400Regular',
  },

  // Empty cycle state
  emptyCyclesRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bigBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COSMIC.PRIMARY_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeading: { fontSize: 14, color: COSMIC.TEXT, fontFamily: 'PlusJakartaSans_700Bold', marginBottom: 2 },
  mutedText: { fontSize: 12, color: COSMIC.TEXT_2, lineHeight: 17, fontFamily: 'PlusJakartaSans_400Regular' },

  // Soil badges
  soilRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  sBadge: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 2 },
  sBadgeLbl: {
    fontSize: 10,
    color: COSMIC.TEXT_3,
    fontFamily: 'PlusJakartaSans_700Bold',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  sBadgeVal: { fontSize: 15, fontFamily: 'PlusJakartaSans_800ExtraBold' },
  sBadgePill: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: CR.pill,
    borderWidth: 1,
  },
  sBadgeRat: {
    fontSize: 8,
    fontFamily: 'PlusJakartaSans_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  // AI predictions grid
  predGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  predCard: {
    flexGrow: 1,
    flexBasis: '47%',
    padding: 10,
    borderRadius: CR.lg,
    borderWidth: 1,
    backgroundColor: COSMIC.SURFACE,
    gap: 4,
  },
  predIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  predTitle: { fontSize: 13, color: COSMIC.TEXT, fontFamily: 'PlusJakartaSans_700Bold' },
  predSub: { fontSize: 11, color: COSMIC.TEXT_3, fontFamily: 'PlusJakartaSans_400Regular' },
});

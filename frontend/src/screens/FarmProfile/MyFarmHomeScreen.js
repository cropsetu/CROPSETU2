/**
 * MyFarmHomeScreen — compact dashboard for the MyFarm tab.
 *
 * Layout:
 *   • Greeting row + sync badge
 *   • Hero card (active farm, location, streak, 3 KPIs)
 *   • Quick-log chip rail (5 activities)
 *   • Recent activity feed
 *   • Active crop cycles (with stage timeline)
 *   • AI insights
 *   • View-all-farms link
 *
 * Minimalist light theme — matches the rest of the app. Typography compact
 * (15px body), cards white with soft shadow.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import CosmicScreen from './ui/CosmicScreen';
import GlassCard from './ui/GlassCard';
import GlowButton from './ui/GlowButton';
import ActivityChip from './ui/ActivityChip';
import StreakBadge from './ui/StreakBadge';
import SyncBadge from './ui/SyncBadge';
import CelebrationSheet from './ui/CelebrationSheet';
import ActivityFeedItem from './ui/ActivityFeedItem';
import StageTimelineBar from './ui/StageTimelineBar';
import WhyThisButton from './ui/WhyThisButton';
import { CropIcon } from '../../components/CropIcons';
import { COSMIC, GLOW, CR, CS, CT } from './theme/cosmicTheme';

import { useMultiFarm } from '../../context/MultiFarmContext';
import { useSyncStatus } from '../../services/writeQueue';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import * as farmApi from '../../services/farmApi';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function greetingFor(hour) {
  if (hour < 5) return 'Still working?';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 20) return 'Good evening';
  return 'Good night';
}

const QUICK_LOG_TYPES = ['IRRIGATION', 'FERTILIZER', 'SPRAY', 'SCOUT', 'HARVEST'];

// ──────────────────────────────────────────────────────────────────────────────
// Screen
// ──────────────────────────────────────────────────────────────────────────────

export default function MyFarmHomeScreen({ navigation }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { farms, activeFarm, activeFarmId, refresh, syncing, hasFarms, loading } = useMultiFarm();

  const [cycles, setCycles] = useState([]);
  const [insights, setInsights] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [celebrate, setCelebrate] = useState(null);

  const loadAll = useCallback(async () => {
    // Don't fire authenticated farm calls without a session or an active farm —
    // a stale activeFarmId during a logout/login transition was causing
    // /farms/:id/cycles to be requested with no token → 401.
    if (!user?.id || !activeFarmId) { setCycles([]); setInsights([]); return; }
    setLoadingDetail(true);
    const [c, i] = await Promise.allSettled([
      farmApi.listCropCycles(activeFarmId, { status: 'ACTIVE' }),
      farmApi.getFarmInsights(activeFarmId, { limit: 3 }),
    ]);
    if (c.status === 'fulfilled') setCycles(c.value || []);
    if (i.status === 'fulfilled') setInsights(i.value || []);
    setLoadingDetail(false);
  }, [activeFarmId, user?.id]);

  // Reload on every focus so a newly created cycle appears without a manual pull-to-refresh.
  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  const onRefresh = useCallback(async () => {
    await refresh();
    await loadAll();
  }, [refresh, loadAll]);

  const farmerName = user?.preferredName || user?.fullName?.split(' ')[0] || 'Farmer';
  const greeting = greetingFor(new Date().getHours());

  const farmName = activeFarm?.farmName || activeFarm?.farmAlias || (activeFarm ? `Farm ${activeFarm.farmNumber}` : '');
  const farmLocation = activeFarm ? [activeFarm.village, activeFarm.taluka, activeFarm.district].filter(Boolean).join(', ') : '';

  const recentActivities = useMemo(() => buildRecentActivities(cycles), [cycles]);
  const streakDays = useMemo(() => computeStreak(recentActivities), [recentActivities]);

  // Real sync state: a failed/in-flight write (writeQueue) wins over the
  // background farm-list refresh (syncing).
  const write = useSyncStatus();
  const syncStatus =
    write.status === 'offline' || write.status === 'error' ? write.status
    : (write.status === 'syncing' || syncing) ? 'syncing'
    : 'synced';
  const activeCycleId = cycles[0]?.id;

  const goActivityPicker = (type) => {
    if (!activeFarmId) return navigation.navigate('FarmAddEdit');
    if (type === 'IRRIGATION') {
      return navigation.navigate('ActivityIrrigationLog', { farmId: activeFarmId, cycleId: activeCycleId });
    }
    navigation.navigate('ActivityTypePicker', { farmId: activeFarmId, cycleId: activeCycleId });
  };
  const goFarmList = () => navigation.navigate('FarmList');
  const goAddFarm = () => navigation.navigate('FarmAddEdit');
  const goFarmDetail = () => activeFarmId && navigation.navigate('FarmDetail', { farmId: activeFarmId });
  const goCycleCreate = () => activeFarmId && navigation.navigate('CropCycleCreate', { farmId: activeFarmId });
  const goCycleDetail = (id) => navigation.navigate('CropCycleDetail', { cycleId: id });

  if (!hasFarms && !syncing && !loading) {
    return (
      <CosmicScreen scroll refreshing={syncing} onRefresh={onRefresh}>
        <EmptyState onAddFarm={goAddFarm} />
      </CosmicScreen>
    );
  }

  return (
    <CosmicScreen scroll refreshing={syncing} onRefresh={onRefresh} contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
      {/* Greeting */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting} numberOfLines={1}>{greeting},</Text>
          <Text style={styles.farmer} numberOfLines={1}>{farmerName}</Text>
        </View>
        <SyncBadge status={syncStatus} compact />
      </View>

      {/* Hero */}
      <HeroCard
        farmName={farmName}
        farmLocation={farmLocation}
        farms={farms}
        cycles={cycles}
        activeFarm={activeFarm}
        streakDays={streakDays}
        onSwitch={goFarmList}
        onOpenFarm={goFarmDetail}
      />

      {/* Quick log */}
      <SectionLabel title="Log today" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickRail}
      >
        {QUICK_LOG_TYPES.map((type) => (
          <ActivityChip
            key={type}
            type={type}
            label={activityLabel(type)}
            onPress={() => goActivityPicker(type)}
            size="md"
            style={{ marginRight: 8 }}
          />
        ))}
        <Pressable onPress={() => goActivityPicker(null)} style={styles.seeMoreChip}>
          <Ionicons name="grid-outline" size={14} color={COSMIC.TEXT_2} />
          <Text style={styles.seeMoreText}>More</Text>
        </Pressable>
      </ScrollView>

      {/* Recent activity */}
      <SectionLabel
        title="Recent activity"
        action={recentActivities.length > 0 ? { label: 'See all', onPress: goFarmDetail } : undefined}
      />
      <GlassCard style={styles.section} padding={0}>
        {loadingDetail && recentActivities.length === 0 ? (
          <ActivityIndicator color={COSMIC.PRIMARY} style={{ paddingVertical: 18 }} />
        ) : recentActivities.length === 0 ? (
          <EmptyFeed onStart={() => goActivityPicker(null)} />
        ) : (
          recentActivities.slice(0, 5).map((a, i) => (
            <View key={a.id || i}>
              {i > 0 && <View style={styles.feedDivider} />}
              <ActivityFeedItem
                type={a.type}
                title={a.title}
                subtitle={a.subtitle}
                timeAgo={timeAgo(a.occurredAt)}
                photos={a.photos || []}
                onPress={() => goCycleDetail(a.cycleId)}
              />
            </View>
          ))
        )}
      </GlassCard>

      {/* Active crops */}
      <SectionLabel
        title="Active crops"
        action={
          cycles.length === 0 && activeFarmId
            ? { label: 'Start a cycle', onPress: goCycleCreate }
            : cycles.length > 0
            ? { label: 'View all', onPress: goFarmDetail }
            : undefined
        }
      />
      {loadingDetail && cycles.length === 0 ? (
        <GlassCard style={styles.section}>
          <ActivityIndicator color={COSMIC.PRIMARY} />
        </GlassCard>
      ) : cycles.length === 0 ? (
        <GlassCard style={styles.section}>
          <Text style={styles.emptyText}>
            No crop cycles yet. Start one to unlock stage tracking, budget monitoring, and AI advisories.
          </Text>
          {!!activeFarmId && (
            <GlowButton label="Start a crop cycle" icon="leaf-outline" variant="primary" full onPress={goCycleCreate} style={{ marginTop: 10 }} />
          )}
        </GlassCard>
      ) : (
        <View style={styles.cyclesList}>
          {cycles.slice(0, 3).map((c) => (
            <CycleCard key={c.id} cycle={c} onPress={() => goCycleDetail(c.id)} />
          ))}
        </View>
      )}

      {/* AI Insights */}
      <SectionLabel title="AI insights" badge="CropSetu AI" />
      {insights.length === 0 ? (
        <GlassCard style={styles.section}>
          <View style={styles.insightEmptyRow}>
            <View style={styles.aiBubble}>
              <Ionicons name="sparkles" size={14} color={COSMIC.INVERSE} />
            </View>
            <Text style={[styles.emptyText, { flex: 1 }]}>
              Log a few activities and CropSetu AI will tailor advice to your plot, variety and weather.
            </Text>
          </View>
        </GlassCard>
      ) : (
        insights.slice(0, 3).map((ins, i) => <InsightCard key={ins.id || i} insight={ins} navigation={navigation} />)
      )}

      {/* Footer */}
      {farms.length > 1 && (
        <Pressable onPress={goFarmList} style={({ pressed }) => [styles.footer, pressed && { opacity: 0.75 }]}>
          <Ionicons name="layers-outline" size={16} color={COSMIC.PRIMARY} />
          <Text style={styles.footerText}>View all {farms.length} farms</Text>
          <Ionicons name="chevron-forward" size={16} color={COSMIC.PRIMARY} />
        </Pressable>
      )}

      <CelebrationSheet
        visible={!!celebrate}
        title={celebrate?.title}
        subtitle={celebrate?.subtitle}
        streakDays={celebrate?.streakDays}
        onClose={() => setCelebrate(null)}
      />
    </CosmicScreen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Sub-components
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

function HeroCard({ farmName, farmLocation, farms, cycles, activeFarm, streakDays, onSwitch, onOpenFarm }) {
  const acres = Number(activeFarm?.landSizeAcres || 0);

  return (
    <Pressable onPress={onOpenFarm} style={styles.heroOuter}>
      <GlassCard variant="bordered" style={{ padding: CS.lg }}>
        <View style={styles.heroTopRow}>
          <Text style={styles.heroLabel}>ACTIVE FARM</Text>
          {farms.length > 1 && (
            <Pressable onPress={onSwitch} style={styles.switchPill}>
              <Ionicons name="swap-horizontal" size={12} color={COSMIC.PRIMARY} />
              <Text style={styles.switchText}>Switch</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.heroName} numberOfLines={1}>{farmName || 'Add your farm'}</Text>
        {!!farmLocation && (
          <View style={styles.heroLocRow}>
            <Ionicons name="location-outline" size={12} color={COSMIC.TEXT_3} />
            <Text style={styles.heroLoc} numberOfLines={1}>{farmLocation}</Text>
          </View>
        )}

        {streakDays > 0 && (
          <View style={styles.heroStreakRow}>
            <StreakBadge days={streakDays} compact />
          </View>
        )}

        <View style={styles.heroStats}>
          <HeroStat icon="resize-outline" value={acres > 0 ? acres.toFixed(2) : '—'} label="acres" />
          <View style={styles.divider} />
          <HeroStat icon="leaf-outline" value={cycles.length} label={cycles.length === 1 ? 'crop' : 'crops'} />
          <View style={styles.divider} />
          <HeroStat icon="map-outline" value={farms.length} label={farms.length === 1 ? 'farm' : 'farms'} />
        </View>
      </GlassCard>
    </Pressable>
  );
}

function HeroStat({ icon, value, label }) {
  return (
    <View style={styles.heroStatCol}>
      <Ionicons name={icon} size={12} color={COSMIC.PRIMARY} />
      <Text style={styles.heroStatValue}>{value}</Text>
      <Text style={styles.heroStatLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function CycleCard({ cycle, onPress }) {
  const stage = cycle.growthStage || 'PLANNING';
  const area = Number(cycle.areaAllocatedAcres || 0).toFixed(2);
  const budget = Number(cycle.totalInputCostInr || 0);
  const revenue = Number(cycle.grossIncomeInr || 0);

  const das = cycle.sowingDate
    ? Math.max(0, Math.floor((Date.now() - new Date(cycle.sowingDate).getTime()) / 86400000))
    : null;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ marginBottom: 8 }, pressed && { opacity: 0.88 }]}>
      <GlassCard>
        <View style={styles.cycleRow}>
          <View style={styles.cropIconWrap}>
            <CropIcon crop={cycle.cropName} size={36} />
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.cycleCrop} numberOfLines={1}>
              {cycle.cropName}{cycle.variety ? `  ·  ${cycle.variety}` : ''}
            </Text>
            <Text style={styles.cycleMeta} numberOfLines={1}>
              {area} ac · {cycle.season || '—'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={COSMIC.TEXT_3} />
        </View>

        <StageTimelineBar currentStage={stage} das={das} style={{ marginTop: 8 }} />

        {(budget > 0 || revenue > 0) && (
          <View style={styles.cycleMoneyRow}>
            <MoneyPill icon="arrow-down-outline" tone="expense" amount={budget} label="spent" />
            <MoneyPill icon="arrow-up-outline" tone="income" amount={revenue} label="earned" />
          </View>
        )}
      </GlassCard>
    </Pressable>
  );
}

function MoneyPill({ icon, tone, amount, label }) {
  const color = tone === 'income' ? COSMIC.PRIMARY : COSMIC.DANGER;
  const bg = tone === 'income' ? COSMIC.PRIMARY_SOFT : COSMIC.DANGER_SOFT;
  const formatted = amount >= 1000 ? `₹${(amount / 1000).toFixed(1)}k` : `₹${amount}`;
  return (
    <View style={[styles.moneyPill, { backgroundColor: bg, borderColor: color + '40' }]}>
      <Ionicons name={icon} size={12} color={color} />
      <Text style={[styles.moneyPillText, { color }]}>{formatted}</Text>
      <Text style={styles.moneyPillLabel}>{label}</Text>
    </View>
  );
}

function InsightCard({ insight, navigation }) {
  const severityColor = {
    low: COSMIC.SEV_LOW, moderate: COSMIC.SEV_MODERATE, high: COSMIC.SEV_HIGH, critical: COSMIC.SEV_CRITICAL,
  }[insight.severity] || COSMIC.PRIMARY;

  return (
    <GlassCard style={styles.section}>
      <View style={styles.insightHeader}>
        <View style={[styles.sevDot, { backgroundColor: severityColor }]} />
        <Text style={styles.insightTitle} numberOfLines={2}>
          {insight.title || insight.summary}
        </Text>
      </View>
      {!!insight.body && <Text style={styles.insightBody} numberOfLines={4}>{insight.body}</Text>}
      <View style={styles.insightFooter}>
        <WhyThisButton compact onPress={() => navigation.navigate('AIAssistant', { screen: 'AIChat', params: { seed: insight.title } })} />
        {!!insight.actionLabel && (
          <Pressable onPress={() => navigation.navigate('AIAssistant', { screen: 'AIChat' })}>
            <Text style={styles.insightAction}>{insight.actionLabel} →</Text>
          </Pressable>
        )}
      </View>
    </GlassCard>
  );
}

function EmptyFeed({ onStart }) {
  return (
    <View style={styles.emptyFeed}>
      <View style={[styles.mediumBubble, { backgroundColor: COSMIC.PRIMARY_SOFT }]}>
        <Ionicons name="sparkles" size={18} color={COSMIC.PRIMARY} />
      </View>
      <Text style={styles.emptyHeading}>Your farm diary starts here</Text>
      <Text style={styles.emptyText}>
        Log each day's work. The more you log, the smarter CropSetu AI gets.
      </Text>
      <GlowButton label="Pick an activity" icon="add-circle-outline" variant="primary" onPress={onStart} style={{ marginTop: 10 }} size="sm" />
    </View>
  );
}

function EmptyState({ onAddFarm }) {
  return (
    <View style={styles.emptyRoot}>
      <View style={[styles.mediumBubble, { backgroundColor: COSMIC.PRIMARY_SOFT, width: 64, height: 64, borderRadius: 32 }]}>
        <Ionicons name="leaf" size={28} color={COSMIC.PRIMARY} />
      </View>
      <Text style={styles.emptyRootHeading}>Set up your farm</Text>
      <Text style={[styles.emptyText, { textAlign: 'center', maxWidth: 280 }]}>
        Add your first farm in under 3 minutes. Name, village, size, main crop — that's all we need today.
      </Text>
      <GlowButton label="Add your first farm" icon="add" variant="primary" onPress={onAddFarm} style={{ marginTop: 16, minWidth: 220 }} />
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Data helpers
// ──────────────────────────────────────────────────────────────────────────────

function activityLabel(type) {
  switch (type) {
    case 'IRRIGATION': return 'Water';
    case 'FERTILIZER': return 'Fertilize';
    case 'SPRAY': return 'Spray';
    case 'SCOUT': return 'Scout';
    case 'HARVEST': return 'Harvest';
    case 'SOWING': return 'Sow';
    case 'LAND_PREP': return 'Prep';
    default: return 'Log';
  }
}

// Pick a usable timestamp from a log entry — fall back to the cycle's
// own timestamps so an entry without a date never disappears.
function pickDate(entry, ...fallbacks) {
  const candidates = [
    entry?.date, entry?.occurredAt, entry?.timestamp, entry?.createdAt,
    entry?.applicationDate, entry?.loggedAt, entry?.dateTime, entry?.appliedOn,
    ...fallbacks,
  ];
  for (const v of candidates) {
    if (v == null) continue;
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function buildRecentActivities(cycles) {
  const rows = [];
  let i = 0;
  for (const c of cycles) {
    const fb = c.updatedAt || c.createdAt;
    const push = (type, title, subtitle, iso) => {
      rows.push({ id: `${c.id}-${type}-${i++}-${iso}`, type, title, subtitle, occurredAt: iso, cycleId: c.id });
    };
    (c.irrigationLogs || []).slice(-3).forEach((it) =>
      push('IRRIGATION', 'Irrigation',
        [it.method, it.durationHours ? `${it.durationHours} h` : null, it.volumeLitres ? `${it.volumeLitres} L` : null]
          .filter(Boolean).join(' · '),
        pickDate(it, fb)));
    (c.fertilizersUsed || []).slice(-3).forEach((it) =>
      push('FERTILIZER', 'Fertilizer',
        [it.productName || it.product || it.name, it.quantityKg ? `${it.quantityKg} kg` : null]
          .filter(Boolean).join(' · '),
        pickDate(it, fb)));
    (c.pesticidesUsed || []).slice(-3).forEach((it) =>
      push('SPRAY', 'Spray',
        it.productName || it.product || it.name || 'Applied',
        pickDate(it, fb)));
    (c.observedEvents || []).slice(-3).forEach((it) =>
      push('SCOUT', 'Observation',
        it.description || it.type || '',
        pickDate(it, fb)));
    if (c.actualHarvestDate) {
      push('HARVEST', 'Harvest',
        `${c.harvestYieldQuintal || c.harvestYieldKg || '—'} ${c.harvestYieldQuintal ? 'qtl' : 'kg'} · ${c.cropName}`,
        pickDate({ date: c.actualHarvestDate }, fb));
    }
    if (c.saleDate) {
      push('SALE', 'Sale',
        `₹${c.saleTotalRevenueInr || 0} · ${c.saleBuyerName || c.saleBuyerType || 'Sold'}`,
        pickDate({ date: c.saleDate }, fb));
    }
  }
  rows.sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  return rows;
}

function computeStreak(activities) {
  if (!activities.length) return 0;
  const byDay = new Set(activities.map((a) => new Date(a.occurredAt).toDateString()));
  let streak = 0;
  const cursor = new Date();
  if (!byDay.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  while (byDay.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ──────────────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: CS.base,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 8,
  },
  greeting: {
    fontSize: 12,
    color: COSMIC.TEXT_3,
    fontFamily: 'Inter_500Medium',
  },
  farmer: {
    fontSize: 18,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_700Bold',
    marginTop: 1,
  },

  // Hero
  heroOuter: {
    marginHorizontal: CS.base,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  heroLabel: {
    fontSize: 10,
    color: COSMIC.PRIMARY,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.8,
  },
  switchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: CR.pill,
    backgroundColor: COSMIC.PRIMARY_SOFT,
    borderWidth: 1,
    borderColor: COSMIC.PRIMARY + '33',
  },
  switchText: {
    color: COSMIC.PRIMARY,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  heroName: {
    fontSize: 22,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_800ExtraBold',
  },
  heroLocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  heroLoc: {
    fontSize: 12,
    color: COSMIC.TEXT_3,
    fontFamily: 'Inter_400Regular',
    flexShrink: 1,
  },
  heroStreakRow: {
    marginTop: 10,
  },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COSMIC.BORDER,
  },
  heroStatCol: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  heroStatValue: {
    fontSize: 16,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_800ExtraBold',
  },
  heroStatLabel: {
    fontSize: 10,
    color: COSMIC.TEXT_3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'Inter_600SemiBold',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: COSMIC.BORDER,
  },

  // Section labels
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: CS.base,
    paddingTop: CS.lg,
    paddingBottom: 6,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_700Bold',
  },
  sectionBadge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: CR.pill,
    backgroundColor: COSMIC.PRIMARY_SOFT,
    borderWidth: 1,
    borderColor: COSMIC.PRIMARY + '33',
  },
  sectionBadgeText: {
    fontSize: 9,
    color: COSMIC.PRIMARY,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.6,
  },
  sectionAction: {
    fontSize: 12,
    color: COSMIC.PRIMARY,
    fontFamily: 'Inter_700Bold',
  },

  // Quick rail
  quickRail: {
    paddingHorizontal: CS.base,
    paddingBottom: 2,
  },
  seeMoreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: CR.pill,
    backgroundColor: COSMIC.SURFACE,
    borderWidth: 1,
    borderColor: COSMIC.BORDER,
    minHeight: 36,
  },
  seeMoreText: {
    fontSize: 12,
    color: COSMIC.TEXT_2,
    fontFamily: 'Inter_600SemiBold',
  },

  // Sections
  section: {
    marginHorizontal: CS.base,
  },
  feedDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COSMIC.BORDER,
    marginLeft: 14 + 36 + 12,    // align under content column (row pad + icon + gap)
  },

  // Cycles
  cyclesList: {
    paddingHorizontal: CS.base,
  },
  cycleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cropIconWrap: {
    width: 44,
    height: 44,
    borderRadius: CR.md,
    backgroundColor: COSMIC.SURFACE_HI,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COSMIC.BORDER,
    overflow: 'hidden',
  },
  cycleCrop: {
    fontSize: 14,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_700Bold',
  },
  cycleMeta: {
    fontSize: 12,
    color: COSMIC.TEXT_3,
    marginTop: 1,
    fontFamily: 'Inter_400Regular',
  },
  cycleMoneyRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  moneyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: CR.pill,
    borderWidth: 1,
  },
  moneyPillText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  moneyPillLabel: {
    fontSize: 10,
    color: COSMIC.TEXT_3,
    fontFamily: 'Inter_500Medium',
  },

  // Insights
  insightEmptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  insightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  sevDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  insightTitle: {
    fontSize: 14,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_700Bold',
    flex: 1,
  },
  insightBody: {
    fontSize: 13,
    color: COSMIC.TEXT_2,
    lineHeight: 18,
    marginBottom: 6,
    fontFamily: 'Inter_400Regular',
  },
  insightFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  insightAction: {
    fontSize: 12,
    color: COSMIC.PRIMARY,
    fontFamily: 'Inter_700Bold',
  },

  aiBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COSMIC.PRIMARY,
  },
  mediumBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 8,
  },

  // Empty feed
  emptyFeed: {
    paddingVertical: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  emptyHeading: {
    fontSize: 15,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginTop: 2,
  },
  emptyText: {
    fontSize: 13,
    color: COSMIC.TEXT_2,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
    fontFamily: 'Inter_400Regular',
  },

  // Empty root (no farms)
  emptyRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 60,
  },
  emptyRootHeading: {
    fontSize: 18,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_800ExtraBold',
    textAlign: 'center',
    marginTop: 10,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: CS.base,
    marginTop: CS.lg,
    paddingVertical: 10,
    borderRadius: CR.lg,
    backgroundColor: COSMIC.SURFACE,
    borderWidth: 1,
    borderColor: COSMIC.BORDER,
  },
  footerText: {
    fontSize: 12,
    color: COSMIC.PRIMARY,
    fontFamily: 'Inter_700Bold',
  },
});

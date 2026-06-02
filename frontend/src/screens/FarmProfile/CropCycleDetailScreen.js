/**
 * CropCycleDetailScreen — clean, focused cycle dashboard.
 *
 * Layout (top to bottom):
 *   • Hero — gradient bg, large crop illustration, name + variety, stage
 *     pill, 3-stat row (DAS · Acres · Season), embedded stage timeline.
 *   • Profit & Loss — only when data exists, compact 3-card row.
 *   • Quick log rail — 4 chips for the most common activities.
 *   • Activity feed — single chronological list (irrigation, fertilizer,
 *     spray, scout, harvest, sale all merged & sorted by date).
 *   • Footer — Complete-cycle text button when applicable.
 *
 * Inline log modal preserved for typed entry; saves via existing farmApi.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Modal, TextInput,
  Alert, RefreshControl, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import CosmicScreen from './ui/CosmicScreen';
import CosmicHeader from './ui/CosmicHeader';
import GlassCard from './ui/GlassCard';
import GlowButton from './ui/GlowButton';
import StageTimelineBar from './ui/StageTimelineBar';
import ActivityChip from './ui/ActivityChip';

import CropIcon from '../../components/CropIcons';
import * as farmApi from '../../services/farmApi';
import { useLanguage } from '../../context/LanguageContext';
import { COSMIC, CR, CS, activityMeta } from './theme/cosmicTheme';
import { Haptics } from '../../utils/haptics';

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

function formatInr(v) {
  const n = Number(v || 0);
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function prettyStage(stage) {
  if (!stage) return '—';
  return stage.replace(/_/g, ' ').toLowerCase();
}

// Pull a usable timestamp from a log entry, in order of preference.
// Falls back to the cycle's own timestamp or `now` so an entry without
// a date never silently disappears from the feed.
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

// Merge all log arrays into one chronological feed.
function buildActivityFeed(cycle) {
  if (!cycle) return [];
  const rows = [];
  let i = 0;
  const fallback = cycle.updatedAt || cycle.createdAt;

  const push = (type, title, subtitle, iso) => {
    rows.push({ id: `${type}-${i++}-${iso}`, type, title: title || type, subtitle: subtitle || '', occurredAt: iso });
  };

  (cycle.irrigationLogs || []).forEach((it) =>
    push('IRRIGATION', it.method ? `${it.method} irrigation` : 'Irrigation',
      [
        it.durationHours ? `${it.durationHours} h` : null,
        it.volumeLitres ? `${it.volumeLitres} L` : null,
        it.waterSource,
      ].filter(Boolean).join(' · '),
      pickDate(it, fallback)));

  (cycle.fertilizersUsed || []).forEach((it) =>
    push('FERTILIZER', it.productName || it.product || it.name || 'Fertilizer',
      [
        it.quantityKg ? `${it.quantityKg} kg` : null,
        it.applicationMethod,
        it.costInr ? formatInr(it.costInr) : null,
      ].filter(Boolean).join(' · '),
      pickDate(it, fallback)));

  (cycle.pesticidesUsed || []).forEach((it) =>
    push('SPRAY', it.productName || it.product || it.name || 'Spray',
      [
        it.activeIngredient,
        it.quantityMl ? `${it.quantityMl} ml` : null,
        it.targetPest,
        it.costInr ? formatInr(it.costInr) : null,
      ].filter(Boolean).join(' · '),
      pickDate(it, fallback)));

  (cycle.observedEvents || []).forEach((it) =>
    push('SCOUT', it.type || it.title || 'Observation',
      it.description || it.note || it.severity || '',
      pickDate(it, fallback)));

  if (cycle.actualHarvestDate || cycle.harvestYieldKg || cycle.harvestYieldQuintal) {
    const yieldVal = cycle.harvestYieldQuintal
      ? `${cycle.harvestYieldQuintal} qtl`
      : cycle.harvestYieldKg
      ? `${cycle.harvestYieldKg} kg`
      : null;
    push('HARVEST', 'Harvest',
      [yieldVal, cycle.harvestQualityGrade ? `Grade ${cycle.harvestQualityGrade}` : null]
        .filter(Boolean).join(' · '),
      pickDate({ date: cycle.actualHarvestDate }, fallback));
  }

  if (cycle.saleDate || cycle.saleTotalRevenueInr) {
    push('SALE', 'Sale',
      [
        cycle.saleTotalRevenueInr ? formatInr(cycle.saleTotalRevenueInr) : null,
        cycle.saleBuyerName || cycle.saleBuyerType || cycle.saleMandiName,
      ].filter(Boolean).join(' · '),
      pickDate({ date: cycle.saleDate }, fallback));
  }

  rows.sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  return rows;
}

// ──────────────────────────────────────────────────────────────────────────────
// Screen
// ──────────────────────────────────────────────────────────────────────────────

export default function CropCycleDetailScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { cycleId } = route.params;

  const [cycle, setCycle] = useState(null);
  const [financials, setFinancials] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState(null);
  const [formData, setFormData] = useState({});
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [completing, setCompleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, f] = await Promise.all([
        farmApi.getCropCycle(cycleId),
        farmApi.getCycleFinancials(cycleId).catch(() => null),
      ]);
      setCycle(c);
      setFinancials(f);
    } catch {
      Alert.alert(t('login.error') || 'Error', t('farmProfile.loadCropCycleError') || 'Could not load cycle.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cycleId, t]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const submitModal = useCallback(async () => {
    try {
      if (modal === 'fertilizer')      await farmApi.addFertilizer(cycleId, formData);
      else if (modal === 'pesticide')  await farmApi.addPesticide(cycleId, formData);
      else if (modal === 'irrigation') await farmApi.addIrrigationLog(cycleId, formData);
      else if (modal === 'harvest')    await farmApi.recordHarvest(cycleId, formData);
      else if (modal === 'sale')       await farmApi.recordSale(cycleId, formData);
      Haptics.success?.();
      setModal(null);
      setFormData({});
      load();
    } catch (e) {
      Haptics.error?.();
      Alert.alert(t('login.error') || 'Error', e.message || (t('farmProfile.saveFailed') || 'Save failed.'));
    }
  }, [modal, formData, cycleId, load, t]);

  const completeCycle = useCallback(async () => {
    setCompleting(true);
    try {
      await farmApi.completeCycle(cycleId);
      Haptics.success?.();
      setShowComplete(false);
      load();
    } catch (e) {
      Haptics.error?.();
      Alert.alert(t('login.error') || 'Error', e?.response?.data?.error?.message || e.message || 'Could not complete cycle.');
    } finally {
      setCompleting(false);
    }
  }, [cycleId, load, t]);

  const confirmDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await farmApi.deleteCropCycle(cycleId);
      Haptics.success?.();
      setShowDelete(false);
      navigation.goBack();   // FarmDetail/MyFarmHome reload on focus
    } catch (e) {
      Haptics.error?.();
      setShowDelete(false);
      Alert.alert(t('login.error', 'Error'), e?.response?.data?.error?.message || t('farmProfile.deleteFailed', 'Could not delete cycle.'));
    } finally {
      setDeleting(false);
    }
  }, [cycleId, navigation, t]);

  const activityFeed = useMemo(() => buildActivityFeed(cycle), [cycle]);

  // ── Loading / error states ─────────────────────────────────────────────
  if (loading) {
    return (
      <CosmicScreen>
        <CosmicHeader title="Loading…" />
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color={COSMIC.PRIMARY} />
        </View>
      </CosmicScreen>
    );
  }
  if (!cycle) {
    return (
      <CosmicScreen>
        <CosmicHeader title="Not found" />
        <View style={styles.centerWrap}>
          <Text style={styles.mutedText}>{t('farmProfile.notFound') || 'Cycle not found.'}</Text>
          <GlowButton label="Go back" variant="glass" size="sm" onPress={() => navigation.goBack()} style={{ marginTop: 12 }} />
        </View>
      </CosmicScreen>
    );
  }

  const stage   = cycle.growthStage || 'PLANNING';
  const area    = Number(cycle.areaAllocatedAcres || 0).toFixed(2);
  const das     = cycle.sowingDate
    ? Math.max(0, Math.floor((Date.now() - new Date(cycle.sowingDate).getTime()) / 86400000))
    : null;

  const totalCost = Number(financials?.totalInputCostInr || cycle.totalInputCostInr || 0);
  const revenue   = Number(financials?.revenue || cycle.grossIncomeInr || 0);
  const net       = Number(financials?.netProfitInr || cycle.netProfitInr || (revenue - totalCost));
  const showPL    = totalCost > 0 || revenue > 0;

  const isCompleted = cycle.status === 'COMPLETED';

  return (
    <CosmicScreen edges={{ top: false, bottom: false }}>
      <CosmicHeader
        title={cycle.cropName}
        subtitle={cycle.variety || `${cycle.season || ''} ${cycle.year || ''}`.trim() || undefined}
        right={
          <CosmicHeader.IconButton
            icon="trash-outline"
            accessibilityLabel={t('farmProfile.deleteCycle', 'Delete crop cycle')}
            onPress={() => setShowDelete(true)}
          />
        }
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COSMIC.PRIMARY} colors={[COSMIC.PRIMARY]} />
        }
      >
        {/* ── Hero ─────────────────────────────────────────── */}
        <View style={styles.heroOuter}>
          <LinearGradient
            colors={['#0E5C3A', COSMIC.PRIMARY, '#2E9B63']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            <View style={styles.heroHeadRow}>
              <View style={styles.heroIconWrap}>
                <CropIcon crop={cycle.cropName} size={52} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.heroName} numberOfLines={1}>{cycle.cropName}</Text>
                {!!cycle.variety && (
                  <Text style={styles.heroVariety} numberOfLines={1}>{cycle.variety}</Text>
                )}
                <View style={styles.stagePill}>
                  <View style={styles.stageDot} />
                  <Text style={styles.stagePillText} numberOfLines={1}>{prettyStage(stage)}</Text>
                </View>
              </View>
              {isCompleted && (
                <View style={styles.completedBadge}>
                  <Ionicons name="checkmark-circle" size={11} color={COSMIC.PRIMARY} />
                  <Text style={styles.completedText}>Done</Text>
                </View>
              )}
            </View>

            <View style={styles.statRow}>
              <Stat light value={das != null ? `${das}` : '—'} label="days" />
              <View style={styles.statDivider} />
              <Stat light value={area} label="acres" />
              <View style={styles.statDivider} />
              <Stat light value={`${cycle.season || '—'}`} label={cycle.year ? `${cycle.year}` : 'season'} />
            </View>
          </LinearGradient>
        </View>

        {/* ── Growth stage timeline (on a light card) ──────── */}
        <SectionLabel title="Growth stage" />
        <GlassCard style={styles.section}>
          <StageTimelineBar currentStage={stage} das={das} />
        </GlassCard>

        {/* ── Profit & loss (only when data exists) ───────── */}
        {showPL && (
          <>
            <SectionLabel title="Profit & loss" />
            <GlassCard style={styles.section}>
              <View style={styles.finGrid}>
                <FinCard label="Spent"   value={formatInr(totalCost)} tint={COSMIC.DANGER} icon="trending-down" />
                <FinCard label="Earned"  value={formatInr(revenue)}   tint={COSMIC.PRIMARY} icon="trending-up" />
                <FinCard
                  label={net >= 0 ? 'Profit' : 'Loss'}
                  value={formatInr(Math.abs(net))}
                  tint={net >= 0 ? COSMIC.PRIMARY : COSMIC.DANGER}
                  icon={net >= 0 ? 'arrow-up' : 'arrow-down'}
                />
              </View>
            </GlassCard>
          </>
        )}

        {/* ── Quick log ───────────────────────────────────── */}
        {!isCompleted && (
          <>
            <SectionLabel title="Log activity" />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickRail}
            >
              <ActivityChip type="IRRIGATION" label="Water"     size="md" onPress={() => { setFormData({}); setModal('irrigation'); }} style={{ marginRight: 8 }} />
              <ActivityChip type="FERTILIZER" label="Fertilize" size="md" onPress={() => { setFormData({}); setModal('fertilizer'); }} style={{ marginRight: 8 }} />
              <ActivityChip type="SPRAY"      label="Spray"     size="md" onPress={() => { setFormData({}); setModal('pesticide'); }}  style={{ marginRight: 8 }} />
              <ActivityChip type="HARVEST"    label="Harvest"   size="md" onPress={() => { setFormData({}); setModal('harvest'); }}    style={{ marginRight: 8 }} />
              <ActivityChip type="SALE"       label="Sale"      size="md" onPress={() => { setFormData({}); setModal('sale'); }} />
            </ScrollView>
          </>
        )}

        {/* ── Activity feed (combined chronological) ──────── */}
        <SectionLabel
          title={activityFeed.length > 0 ? `Recent activity · ${activityFeed.length}` : 'Recent activity'}
        />
        <GlassCard style={styles.section} padding={0}>
          {activityFeed.length === 0 ? (
            <View style={styles.emptyFeed}>
              <View style={styles.emptyBubble}>
                <Ionicons name="reader-outline" size={20} color={COSMIC.PRIMARY} />
              </View>
              <Text style={styles.emptyHeading}>Nothing logged yet</Text>
              <Text style={styles.emptyMuted}>
                Tap a chip above to log your first irrigation, spray or harvest. Each entry will show up here as a clean timeline.
              </Text>
            </View>
          ) : (
            <View style={styles.timeline}>
              {activityFeed.map((a, i) => (
                <TimelineRow key={a.id} item={a} isLast={i === activityFeed.length - 1} />
              ))}
            </View>
          )}
        </GlassCard>

        {/* ── Footer: complete cycle ─────────────────────── */}
        {!isCompleted && (
          <Pressable
            onPress={() => setShowComplete(true)}
            style={({ pressed }) => [styles.completeFooter, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="checkmark-done" size={18} color={COSMIC.INVERSE} />
            <Text style={styles.completeFooterText}>Mark cycle complete</Text>
          </Pressable>
        )}

        {/* ── Footer: delete cycle ───────────────────────── */}
        <Pressable
          onPress={() => setShowDelete(true)}
          style={({ pressed }) => [styles.deleteFooter, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="trash-outline" size={15} color={COSMIC.DANGER} />
          <Text style={styles.deleteFooterText}>{t('farmProfile.deleteCycle', 'Delete crop cycle')}</Text>
        </Pressable>

        <View style={{ height: 30 }} />
      </ScrollView>

      {/* ── Inline log modals ─────────────────────────── */}
      <InputModal
        visible={modal === 'fertilizer'}
        title="Add fertilizer"
        tint={COSMIC.FERTILIZER}
        icon="flask-outline"
        onClose={() => setModal(null)}
        onSave={submitModal}
        data={formData}
        setData={setFormData}
        fields={[
          { key: 'productName', label: 'Product *', ph: 'e.g. Urea, DAP' },
          { key: 'quantityKg',  label: 'Quantity (kg)', ph: '50', kb: 'decimal-pad' },
          { key: 'costInr',     label: 'Cost (₹)',     ph: '1500', kb: 'numeric' },
        ]}
      />
      <InputModal
        visible={modal === 'pesticide'}
        title="Add spray"
        tint={COSMIC.SPRAY}
        icon="color-filter-outline"
        onClose={() => setModal(null)}
        onSave={submitModal}
        data={formData}
        setData={setFormData}
        fields={[
          { key: 'productName',      label: 'Product *',          ph: 'e.g. Coragen' },
          { key: 'activeIngredient', label: 'Active ingredient',  ph: 'e.g. Chlorantraniliprole 18.5%' },
          { key: 'quantityMl',       label: 'Quantity (ml)',      ph: '500', kb: 'decimal-pad' },
          { key: 'costInr',          label: 'Cost (₹)',           ph: '800', kb: 'numeric' },
        ]}
      />
      <InputModal
        visible={modal === 'irrigation'}
        title="Log irrigation"
        tint={COSMIC.IRRIGATION}
        icon="water-outline"
        onClose={() => setModal(null)}
        onSave={submitModal}
        data={formData}
        setData={setFormData}
        fields={[
          { key: 'method',         label: 'Method',           ph: 'drip / flood / sprinkler' },
          { key: 'durationHours',  label: 'Duration (hours)', ph: '3', kb: 'decimal-pad' },
        ]}
      />
      <InputModal
        visible={modal === 'harvest'}
        title="Record harvest"
        tint={COSMIC.HARVEST}
        icon="basket-outline"
        onClose={() => setModal(null)}
        onSave={submitModal}
        data={formData}
        setData={setFormData}
        fields={[
          { key: 'yieldKg',      label: 'Yield (kg) *',  ph: '2500', kb: 'decimal-pad' },
          { key: 'qualityGrade', label: 'Quality grade', ph: 'A / B / C' },
        ]}
      />
      <InputModal
        visible={modal === 'sale'}
        title="Record sale"
        tint={COSMIC.SALE}
        icon="cash-outline"
        onClose={() => setModal(null)}
        onSave={submitModal}
        data={formData}
        setData={setFormData}
        fields={[
          { key: 'soldQuantityKg', label: 'Quantity (kg) *',    ph: '2000', kb: 'decimal-pad' },
          { key: 'pricePerKgInr',  label: 'Price per kg (₹) *', ph: '45',   kb: 'decimal-pad' },
          { key: 'buyerName',      label: 'Buyer / mandi',      ph: 'Nashik APMC' },
        ]}
      />

      {/* Delete confirmation — in-app popup */}
      <Modal visible={showDelete} transparent animationType="fade" onRequestClose={() => !deleting && setShowDelete(false)}>
        <Pressable style={styles.delBackdrop} onPress={() => !deleting && setShowDelete(false)}>
          <Pressable style={styles.delCard} onPress={() => {}}>
            <View style={styles.delIconWrap}>
              <Ionicons name="trash-outline" size={26} color={COSMIC.DANGER} />
            </View>
            <Text style={styles.delTitle}>{t('farmProfile.deleteCycleTitle', 'Delete crop cycle?')}</Text>
            <Text style={styles.delMsg}>
              {t('farmProfile.deleteCycleMsg', `This permanently removes "${cycle.cropName}" and all its logs. This can't be undone.`)}
            </Text>
            <View style={styles.delBtnRow}>
              <Pressable style={[styles.delBtn, styles.delCancel]} onPress={() => setShowDelete(false)} disabled={deleting}>
                <Text style={styles.delCancelTxt}>{t('rent.cancel') || 'Cancel'}</Text>
              </Pressable>
              <Pressable style={[styles.delBtn, styles.delDanger, deleting && { opacity: 0.7 }]} onPress={confirmDelete} disabled={deleting}>
                {deleting
                  ? <ActivityIndicator size="small" color={COSMIC.INVERSE} />
                  : <Text style={styles.delDangerTxt}>{t('rent.delete') || 'Delete'}</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Complete confirmation — in-app popup (works on web + native, unlike Alert.alert) */}
      <Modal visible={showComplete} transparent animationType="fade" onRequestClose={() => !completing && setShowComplete(false)}>
        <Pressable style={styles.delBackdrop} onPress={() => !completing && setShowComplete(false)}>
          <Pressable style={styles.delCard} onPress={() => {}}>
            <View style={styles.completeIconWrap}>
              <Ionicons name="checkmark-done" size={26} color={COSMIC.PRIMARY} />
            </View>
            <Text style={styles.delTitle}>{t('farmProfile.completeCycleTitle', 'Complete cycle?')}</Text>
            <Text style={styles.delMsg}>
              {t('farmProfile.completeCycleMsg', `Mark "${cycle.cropName}" as completed. You can still view its records afterwards.`)}
            </Text>
            <View style={styles.delBtnRow}>
              <Pressable style={[styles.delBtn, styles.delCancel]} onPress={() => setShowComplete(false)} disabled={completing}>
                <Text style={styles.delCancelTxt}>{t('rent.cancel') || 'Cancel'}</Text>
              </Pressable>
              <Pressable style={[styles.delBtn, styles.completeConfirm, completing && { opacity: 0.7 }]} onPress={completeCycle} disabled={completing}>
                {completing
                  ? <ActivityIndicator size="small" color={COSMIC.INVERSE} />
                  : <Text style={styles.completeConfirmTxt}>{t('farmProfile.complete', 'Complete')}</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </CosmicScreen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────────

function SectionLabel({ title }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function Stat({ value, label, light }) {
  return (
    <View style={styles.statCol}>
      <Text style={[styles.statValue, light && styles.statValueLight]} numberOfLines={1}>{value}</Text>
      <Text style={[styles.statLabel, light && styles.statLabelLight]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function TimelineRow({ item, isLast }) {
  const meta = activityMeta(item.type);
  return (
    <View style={styles.tlRow}>
      <View style={styles.tlRail}>
        <View style={[styles.tlDot, { backgroundColor: meta.color }]}>
          <Ionicons name={meta.icon} size={13} color="#FFFFFF" />
        </View>
        {!isLast && <View style={styles.tlLine} />}
      </View>
      <View style={[styles.tlContent, isLast && { paddingBottom: 4 }]}>
        <View style={styles.tlTitleRow}>
          <Text style={styles.tlTitle} numberOfLines={1}>{item.title}</Text>
          {!!item.occurredAt && <Text style={styles.tlTime} numberOfLines={1}>{timeAgo(item.occurredAt)}</Text>}
        </View>
        {!!item.subtitle && <Text style={styles.tlSub} numberOfLines={2}>{item.subtitle}</Text>}
      </View>
    </View>
  );
}

function FinCard({ label, value, tint, icon }) {
  return (
    <View style={[styles.finCard, { borderLeftColor: tint }]}>
      <View style={styles.finCardHead}>
        <Ionicons name={icon} size={11} color={tint} />
        <Text style={styles.finLabel} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={[styles.finValue, { color: tint }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function InputModal({ visible, title, tint = COSMIC.PRIMARY, icon, onClose, onSave, fields, data, setData }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ justifyContent: 'flex-end' }}
      >
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />

          <View style={styles.modalHeader}>
            <View style={[styles.modalIconWrap, { backgroundColor: tint + '22', borderColor: tint + '55' }]}>
              <Ionicons name={icon || 'create-outline'} size={16} color={tint} />
            </View>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}>
              <Ionicons name="close" size={18} color={COSMIC.TEXT_2} />
            </Pressable>
          </View>

          {fields.map((f) => (
            <View key={f.key} style={{ marginTop: 10 }}>
              <Text style={styles.modalLabel}>{f.label}</Text>
              <TextInput
                value={data[f.key] || ''}
                onChangeText={(v) => setData((p) => ({ ...p, [f.key]: v }))}
                placeholder={f.ph}
                placeholderTextColor={COSMIC.MUTED}
                keyboardType={f.kb || 'default'}
                style={styles.modalInput}
              />
            </View>
          ))}

          <GlowButton label="Save log" icon="checkmark" variant="primary" full onPress={onSave} style={{ marginTop: 14 }} size="md" />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { paddingBottom: 30 },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },

  // Footer delete button
  deleteFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    marginHorizontal: CS.base, marginTop: 10, paddingVertical: 13,
    borderRadius: CR.md, borderWidth: 1.5, borderColor: COSMIC.DANGER + '40',
    backgroundColor: COSMIC.DANGER_SOFT,
  },
  deleteFooterText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: COSMIC.DANGER },

  // Delete confirmation popup
  delBackdrop: { flex: 1, backgroundColor: COSMIC.OVERLAY, justifyContent: 'center', alignItems: 'center', padding: 28 },
  delCard: { width: '100%', maxWidth: 360, backgroundColor: COSMIC.SURFACE, borderRadius: 22, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 18, alignItems: 'center', borderWidth: 1, borderColor: COSMIC.BORDER },
  delIconWrap: { width: 54, height: 54, borderRadius: 27, backgroundColor: COSMIC.DANGER_SOFT, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  delTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: COSMIC.TEXT, textAlign: 'center', marginBottom: 6 },
  delMsg: { fontSize: 13.5, fontFamily: 'Inter_400Regular', color: COSMIC.TEXT_2, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  delBtnRow: { flexDirection: 'row', gap: 10, width: '100%' },
  delBtn: { flex: 1, paddingVertical: 13, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  delCancel: { backgroundColor: COSMIC.SURFACE_LO },
  delCancelTxt: { fontSize: 15, fontFamily: 'Inter_700Bold', color: COSMIC.TEXT },
  delDanger: { backgroundColor: COSMIC.DANGER },
  delDangerTxt: { fontSize: 15, fontFamily: 'Inter_700Bold', color: COSMIC.INVERSE },
  completeIconWrap: { width: 54, height: 54, borderRadius: 27, backgroundColor: COSMIC.PRIMARY_SOFT, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  completeConfirm: { backgroundColor: COSMIC.PRIMARY },
  completeConfirmTxt: { fontSize: 15, fontFamily: 'Inter_700Bold', color: COSMIC.INVERSE },

  // Hero
  heroOuter: { marginHorizontal: CS.base, marginTop: CS.sm },
  heroCard: {
    borderRadius: CR.lg,
    padding: 16,
    overflow: 'hidden',
    shadowColor: COSMIC.PRIMARY,
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  heroHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroName: {
    fontSize: 19,
    color: '#FFFFFF',
    fontFamily: 'Inter_800ExtraBold',
    letterSpacing: -0.2,
  },
  heroVariety: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.85)',
    fontFamily: 'Inter_500Medium',
    marginTop: 1,
  },
  stagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 7,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: CR.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  stageDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  stagePillText: {
    fontSize: 10.5,
    color: '#FFFFFF',
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.4,
    textTransform: 'capitalize',
  },
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: CR.pill,
    backgroundColor: '#FFFFFF',
  },
  completedText: {
    fontSize: 9,
    color: COSMIC.PRIMARY,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },

  // Stat row
  statRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: CR.md,
    paddingVertical: 11,
    marginTop: 14,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
  },
  statValue: {
    fontSize: 16,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_800ExtraBold',
    textTransform: 'capitalize',
  },
  statLabel: {
    fontSize: 10,
    color: COSMIC.TEXT_3,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValueLight: { color: '#FFFFFF' },
  statLabelLight: { color: 'rgba(255,255,255,0.8)' },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginVertical: 4,
  },

  // Section labels
  sectionLabel: {
    paddingHorizontal: CS.base,
    paddingTop: CS.lg,
    paddingBottom: 6,
  },
  sectionTitle: {
    fontSize: 13,
    color: COSMIC.TEXT_2,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  section: {
    marginHorizontal: CS.base,
  },

  // Profit & loss
  finGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  finCard: {
    flex: 1,
    minHeight: 56,
    padding: 8,
    borderRadius: CR.md,
    borderLeftWidth: 3,
    backgroundColor: COSMIC.SURFACE_HI,
    gap: 2,
  },
  finCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  finLabel: {
    fontSize: 10,
    color: COSMIC.TEXT_3,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  finValue: {
    fontSize: 16,
    fontFamily: 'Inter_800ExtraBold',
    marginTop: 2,
  },

  // Quick rail
  quickRail: {
    paddingHorizontal: CS.base,
    paddingVertical: 4,
    paddingBottom: 4,
  },

  // Activity feed — divider runs full-width inside the white card
  feedDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COSMIC.BORDER,
    marginLeft: 14 + 36 + 12,    // align under the content column (row padding + icon + gap)
  },

  // Activity timeline
  timeline: { paddingTop: 14, paddingHorizontal: 14 },
  tlRow: { flexDirection: 'row', gap: 12 },
  tlRail: { width: 30, alignItems: 'center' },
  tlDot: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  tlLine: { flex: 1, width: 2, backgroundColor: COSMIC.BORDER, marginTop: 4, marginBottom: 2, borderRadius: 1 },
  tlContent: { flex: 1, paddingBottom: 18 },
  tlTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  tlTitle: { flex: 1, fontSize: 14, color: COSMIC.TEXT, fontFamily: 'Inter_700Bold', textTransform: 'capitalize' },
  tlTime: { fontSize: 11, color: COSMIC.TEXT_3, fontFamily: 'Inter_500Medium' },
  tlSub: { fontSize: 12.5, color: COSMIC.TEXT_2, fontFamily: 'Inter_400Regular', marginTop: 3, lineHeight: 17 },
  emptyFeed: {
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  emptyBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COSMIC.PRIMARY_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COSMIC.PRIMARY + '22',
  },
  emptyHeading: {
    fontSize: 14,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 4,
  },
  emptyMuted: {
    fontSize: 12,
    color: COSMIC.TEXT_2,
    lineHeight: 17,
    textAlign: 'center',
    fontFamily: 'Inter_400Regular',
    maxWidth: 280,
  },
  mutedText: {
    fontSize: 12,
    color: COSMIC.TEXT_2,
    lineHeight: 17,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },

  // Complete cycle footer — primary action button
  completeFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: CS.base,
    marginTop: CS.lg,
    paddingVertical: 15,
    borderRadius: CR.md,
    backgroundColor: COSMIC.PRIMARY,
    shadowColor: COSMIC.PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  completeFooterText: {
    fontSize: 15,
    color: COSMIC.INVERSE,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.2,
  },

  // Modal
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COSMIC.OVERLAY,
  },
  modalSheet: {
    paddingHorizontal: CS.base,
    paddingTop: 8,
    borderTopLeftRadius: CR.xxl,
    borderTopRightRadius: CR.xxl,
    backgroundColor: COSMIC.SURFACE,
    borderTopWidth: 1,
    borderColor: COSMIC.BORDER,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: COSMIC.BORDER_HI,
    marginBottom: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  modalIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 15,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_700Bold',
    flex: 1,
  },
  modalLabel: {
    fontSize: 11,
    color: COSMIC.TEXT_2,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  modalInput: {
    borderWidth: 1.2,
    borderColor: COSMIC.BORDER_HI,
    borderRadius: CR.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    fontSize: 14,
    color: COSMIC.TEXT,
    backgroundColor: COSMIC.SURFACE,
    fontFamily: 'Inter_500Medium',
    minHeight: 44,
  },
});

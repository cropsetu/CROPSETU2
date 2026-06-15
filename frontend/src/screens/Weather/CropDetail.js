/**
 * CropDetail — the crop documentation / "crop guide" page.
 * Themed to the KhetAI (Login) design system: Fraunces serif titles + Plus Jakarta
 * body, forest-green/gold palette, gradient hero, accent pills, soft elegant shadows.
 * Renders the rich crop encyclopedia entry (getCropGuide) plus the growth timeline.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KHET, KFONT, KSHADOW } from '../../constants/khetTheme';
import { useLanguage } from '../../context/LanguageContext';
import { tc } from '../../data/contentI18n';
import { getCropGuide } from '../../data/cropGuide';

// Forest-green → gold progression for the growth-stage timeline.
const STAGE_COLORS = ['#0E5C2B', '#176B3A', '#1F8A45', '#2E9B53', '#4BAE66', '#74C58A', '#C9A227', KHET.gold];

// Per-section accent tints (kept green/gold-leaning to match the Login look).
const TINT = {
  about: KHET.primary, varieties: KHET.gold, soil: KHET.primaryGlow, seed: '#1F8A45',
  fert: '#0A8F6E', water: '#2E90C9', pests: KHET.destructive, dis: '#B8431F',
  harvest: KHET.gold, market: '#C8922A', dd: KHET.primary,
};

function StageCard({ stage, index, total, isActive, t, language }) {
  const color = STAGE_COLORS[index % STAGE_COLORS.length];
  const progressPct = ((index + 1) / total) * 100;

  return (
    <View style={styles.stageWrapper}>
      <View style={styles.timelineCol}>
        <View style={[styles.timelineDot, { backgroundColor: color }, isActive && styles.timelineDotActive]}>
          <Text style={styles.timelineDotNum}>{index + 1}</Text>
        </View>
        {index < total - 1 && <View style={styles.timelineLine} />}
      </View>

      <View style={[styles.stageCard, isActive && { borderColor: color, borderWidth: 2 }]}>
        <View style={styles.stageHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.stageName}>{stage.name}</Text>
            {language !== 'en' && <Text style={styles.stageNameHi}>{tc(stage.name, language)}</Text>}
          </View>
          <View style={[styles.stageDayBadge, { backgroundColor: color }]}>
            <Text style={styles.stageDayText}>{t('cropDetail.dayLabel')} {stage.day}</Text>
          </View>
        </View>

        <View style={styles.stageDurationRow}>
          <Ionicons name="time" size={14} color={KHET.mutedForeground} />
          <Text style={styles.stageDuration}>{stage.duration} {t('cropDetail.daysDuration')}</Text>
        </View>

        <View style={styles.stageTip}>
          <Ionicons name="bulb" size={14} color={KHET.gold} />
          <Text style={styles.stageTipText}>{tc(stage.tip, language)}</Text>
        </View>

        <View style={styles.stageProgressBar}>
          <View style={[styles.stageProgressFill, { width: `${progressPct}%`, backgroundColor: color }]} />
        </View>
        <Text style={styles.stageProgressLabel}>{Math.round(progressPct)}{t('cropDetail.percentCropCycle')}</Text>
      </View>
    </View>
  );
}

export default function CropDetail({ route }) {
  const { t, language } = useLanguage();
  const insets = useSafeAreaInsets();
  const { crop } = route.params;
  const [activeStageIndex, setActiveStageIndex] = useState(1);

  // Rich documentation for this crop (encyclopedia entry), if we have one.
  const guide = getCropGuide(crop?.name);

  const hasStages = Array.isArray(crop.stages) && crop.stages.length > 0;
  const lastStage = hasStages ? crop.stages[crop.stages.length - 1] : null;
  const totalDays = lastStage ? (lastStage.day || 0) + (lastStage.duration || 0) : 0;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>

        {/* ── Gradient hero header ─────────────────────────────────────────── */}
        <LinearGradient
          colors={KHET.gradPrimary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, { paddingTop: insets.top + 18 }]}
        >
          <View style={styles.heroEmojiWrap}>
            <Text style={styles.cropIcon}>{crop.icon}</Text>
          </View>
          <Text style={styles.cropName}>{crop.name}</Text>
          {language !== 'en' && <Text style={styles.cropNameHi}>{tc(crop.name, language)}</Text>}
          <View style={styles.seasonPill}>
            <Ionicons name="calendar" size={13} color="#fff" />
            <Text style={styles.seasonText}>{crop.season}</Text>
          </View>
        </LinearGradient>

        {/* ── Summary cards ────────────────────────────────────────────────── */}
        <View style={styles.summaryGrid}>
          <SummaryCard icon="calendar" tint={KHET.primary} value={crop.sowingMonth} label={t('cropDetail.bestSowingTime')} />
          <SummaryCard icon="time" tint={KHET.gold} value={crop.duration} label={t('cropDetail.totalDuration')} />
          <SummaryCard icon="cut" tint={KHET.primaryGlow} value={crop.harvestMonth} label={t('cropDetail.harvestTime')} />
          <SummaryCard icon="water" tint="#2E90C9" value={crop.waterNeeded ? crop.waterNeeded.split('(')[0] : t('cropDetail.varies')} label={t('cropDetail.waterNeeded')} />
          <SummaryCard icon="thermometer" tint={KHET.destructive} value={crop.idealTemp} label={t('cropDetail.idealTemperature')} />
          <SummaryCard icon="layers" tint="#A6792E" value={crop.soilType} label={t('cropDetail.bestSoil')} />
        </View>

        {/* ── Crop documentation (encyclopedia) ────────────────────────────── */}
        {guide && (
          <View style={styles.guideWrap}>
            <InfoSection icon="information-circle" tint={TINT.about} title={t('cropGuide.about', 'About this crop')}>
              <Text style={styles.gBody}>{guide.about}</Text>
              {!!guide.uses && <Text style={[styles.gMeta, { marginTop: 8 }]}><Text style={styles.gMetaK}>{t('cropGuide.uses', 'Uses')}: </Text>{guide.uses}</Text>}
            </InfoSection>

            {guide.varieties?.length > 0 && (
              <InfoSection icon="ribbon" tint={TINT.varieties} title={t('cropGuide.varieties', 'Recommended varieties')}>
                <View style={styles.chipWrap}>
                  {guide.varieties.map((v, i) => (
                    <View key={i} style={styles.gChip}><Text style={styles.gChipTxt}>{v}</Text></View>
                  ))}
                </View>
              </InfoSection>
            )}

            <InfoSection icon="leaf" tint={TINT.soil} title={t('cropGuide.soilClimate', 'Soil & climate')}>
              <Row k={t('cropGuide.soil', 'Soil')} v={guide.soil} />
              <Row k={t('cropGuide.climate', 'Climate')} v={guide.climate} />
              <Row k={t('cropGuide.season', 'Season')} v={guide.season} />
              <Row k={t('cropDetail.totalDuration', 'Duration')} v={guide.duration} />
            </InfoSection>

            <InfoSection icon="nutrition" tint={TINT.seed} title={t('cropGuide.seedSowing', 'Seed & sowing')}>
              <Row k={t('cropGuide.seedRate', 'Seed rate')} v={guide.seedRate} />
              <Row k={t('cropGuide.spacing', 'Spacing')} v={guide.spacing} />
              <Row k={t('cropGuide.method', 'Method')} v={guide.sowingMethod} />
            </InfoSection>

            {guide.nutrients && (
              <InfoSection icon="flask" tint={TINT.fert} title={t('cropGuide.fertilizer', 'Fertilizer schedule')}>
                <Row k={t('cropGuide.basal', 'Basal')} v={guide.nutrients.basal} />
                {(guide.nutrients.topDress || []).map((d, i) => (
                  <Row key={i} k={`${t('cropGuide.topDress', 'Top-dress')} ${i + 1}`} v={d} />
                ))}
              </InfoSection>
            )}

            <InfoSection icon="water" tint={TINT.water} title={t('cropGuide.water', 'Water & weeding')}>
              <Text style={styles.gBody}>{guide.irrigation}</Text>
              {!!guide.weed && <Text style={[styles.gMeta, { marginTop: 8 }]}><Text style={styles.gMetaK}>{t('cropGuide.weed', 'Weeds')}: </Text>{guide.weed}</Text>}
            </InfoSection>

            {guide.pests?.length > 0 && (
              <InfoSection icon="bug" tint={TINT.pests} title={t('cropGuide.pests', 'Major pests')}>
                {guide.pests.map((p, i) => <PdRow key={i} item={p} last={i === guide.pests.length - 1} t={t} />)}
              </InfoSection>
            )}

            {guide.diseases?.length > 0 && (
              <InfoSection icon="medkit" tint={TINT.dis} title={t('cropGuide.diseases', 'Major diseases')}>
                {guide.diseases.map((d, i) => <PdRow key={i} item={d} last={i === guide.diseases.length - 1} t={t} />)}
              </InfoSection>
            )}

            <InfoSection icon="cut" tint={TINT.harvest} title={t('cropGuide.harvestYield', 'Harvest & yield')}>
              <Text style={styles.gBody}>{guide.harvest}</Text>
              {!!guide.yield && <Text style={[styles.gMeta, { marginTop: 8 }]}><Text style={styles.gMetaK}>{t('cropGuide.yield', 'Yield')}: </Text>{guide.yield}</Text>}
              {!!guide.postHarvest && <Text style={[styles.gMeta, { marginTop: 8 }]}><Text style={styles.gMetaK}>{t('cropGuide.postHarvest', 'Post-harvest')}: </Text>{guide.postHarvest}</Text>}
            </InfoSection>

            {!!guide.marketTips && (
              <InfoSection icon="trending-up" tint={TINT.market} title={t('cropGuide.market', 'Market & economics')}>
                <Text style={styles.gBody}>{guide.marketTips}</Text>
              </InfoSection>
            )}

            {guide.dosDonts?.length > 0 && (
              <InfoSection icon="checkmark-circle" tint={TINT.dd} title={t('cropGuide.dosDonts', "Do’s & Don’ts")}>
                {guide.dosDonts.map((d, i) => (
                  <View key={i} style={styles.ddRow}>
                    <View style={styles.ddDot} />
                    <Text style={[styles.gBody, { flex: 1 }]}>{d}</Text>
                  </View>
                ))}
              </InfoSection>
            )}
          </View>
        )}

        {/* ── Growth timeline ──────────────────────────────────────────────── */}
        {hasStages && (
          <View style={styles.timelineSection}>
            <Text style={styles.sectionTitle}>{t('cropDetail.cropGrowthTimeline')}</Text>
            <Text style={styles.sectionSub}>{t('cropDetail.stagesSummary', { stages: crop.stages.length, totalDays })}</Text>

            <View style={styles.stageSelector}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stageSelectorScroll}>
                {crop.stages.map((stage, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.stageSelectorChip, activeStageIndex === i && styles.stageSelectorChipActive]}
                    onPress={() => setActiveStageIndex(i)}
                  >
                    <Text style={[styles.stageSelectorText, activeStageIndex === i && styles.stageSelectorTextActive]}>
                      {i + 1}. {stage.name?.split(' ')[0] || stage.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.activeStageDetail}>
              <View style={styles.activeStageHeader}>
                <Text style={styles.activeStageName}>{crop.stages[activeStageIndex].name}</Text>
                <Text style={styles.activeStageHi}>{crop.stages[activeStageIndex].nameHi}</Text>
              </View>
              <View style={styles.activeStageStats}>
                <View style={styles.activeStatItem}>
                  <Ionicons name="play" size={16} color={KHET.primary} />
                  <Text style={styles.activeStatLabel}>{t('cropDetail.startsDay')}</Text>
                  <Text style={styles.activeStatValue}>{crop.stages[activeStageIndex].day}</Text>
                </View>
                <View style={styles.activeStatItem}>
                  <Ionicons name="time" size={16} color={KHET.gold} />
                  <Text style={styles.activeStatLabel}>{t('cropDetail.totalDuration')}</Text>
                  <Text style={styles.activeStatValue}>{crop.stages[activeStageIndex].duration}d</Text>
                </View>
              </View>
              <View style={styles.tipBox}>
                <Ionicons name="bulb" size={18} color={KHET.gold} />
                <Text style={styles.tipBoxText}>{crop.stages[activeStageIndex].tip}</Text>
              </View>
            </View>

            <View style={styles.timeline}>
              {crop.stages.map((stage, i) => (
                <StageCard key={i} stage={stage} index={i} total={crop.stages.length} isActive={activeStageIndex === i} t={t} language={language} />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────────
function SummaryCard({ icon, tint, value, label }) {
  return (
    <View style={styles.summaryCard}>
      <View style={[styles.summaryIcon, { backgroundColor: tint + '18', borderColor: tint + '3A' }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <Text style={styles.summaryValue} numberOfLines={2}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function InfoSection({ icon, tint, title, children }) {
  return (
    <View style={styles.gSection}>
      <View style={styles.gSecHead}>
        <View style={[styles.gSecIcon, { backgroundColor: tint + '18', borderColor: tint + '40' }]}>
          <Ionicons name={icon} size={16} color={tint} />
        </View>
        <Text style={styles.gSecTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Row({ k, v }) {
  if (!v) return null;
  return (
    <View style={styles.gKv}>
      <Text style={styles.gKvK}>{k}</Text>
      <Text style={styles.gKvV}>{v}</Text>
    </View>
  );
}

function PdRow({ item, last, t }) {
  return (
    <View style={[styles.pdRow, last && { borderBottomWidth: 0, marginBottom: 0, paddingBottom: 0 }]}>
      <Text style={styles.pdName}>{item.name}</Text>
      {!!item.symptom && <Text style={styles.pdLine}><Text style={styles.gMetaK}>{t('cropGuide.symptom', 'Symptom')}: </Text>{item.symptom}</Text>}
      {!!item.control && <Text style={styles.pdLine}><Text style={styles.gMetaK}>{t('cropGuide.control', 'Control')}: </Text>{item.control}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: KHET.background },

  // Hero
  hero: {
    alignItems: 'center', gap: 6, paddingHorizontal: 24, paddingBottom: 28,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28, ...KSHADOW.elegant,
  },
  heroEmojiWrap: {
    width: 84, height: 84, borderRadius: 42, marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.26)',
    alignItems: 'center', justifyContent: 'center',
  },
  cropIcon: { fontSize: 46 },
  cropName: { fontSize: 30, fontFamily: KFONT.displayBold, color: '#fff', letterSpacing: -0.4, textAlign: 'center' },
  cropNameHi: { fontSize: 15, fontFamily: KFONT.sansMed, color: 'rgba(244,251,237,0.85)', marginTop: 2 },
  seasonPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)',
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 6,
  },
  seasonText: { fontSize: 13, fontFamily: KFONT.sansSemi, color: '#fff' },

  // Summary
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 16 },
  summaryCard: {
    backgroundColor: KHET.card, borderRadius: 16, padding: 12, alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: KHET.border, ...KSHADOW.soft, flexBasis: '30%', flexGrow: 1, minWidth: '29%',
  },
  summaryIcon: { width: 36, height: 36, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  summaryValue: { fontSize: 13, fontFamily: KFONT.sansBold, color: KHET.foreground, textAlign: 'center' },
  summaryLabel: { fontSize: 10.5, fontFamily: KFONT.sans, color: KHET.mutedForeground, textAlign: 'center' },

  // Crop documentation
  guideWrap: { paddingHorizontal: 16, paddingTop: 4 },
  gSection: { backgroundColor: KHET.card, borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: KHET.border, ...KSHADOW.soft },
  gSecHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 11 },
  gSecIcon: { width: 34, height: 34, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  gSecTitle: { fontSize: 17, fontFamily: KFONT.displaySemi, color: KHET.foreground, letterSpacing: -0.2, flex: 1 },
  gBody: { fontSize: 14, fontFamily: KFONT.sans, color: KHET.mutedForeground, lineHeight: 21 },
  gMeta: { fontSize: 13.5, fontFamily: KFONT.sans, color: KHET.mutedForeground, lineHeight: 20 },
  gMetaK: { fontFamily: KFONT.sansBold, color: KHET.foreground },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gChip: { backgroundColor: KHET.secondary, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(0,95,33,0.16)' },
  gChipTxt: { fontSize: 12.5, fontFamily: KFONT.sansSemi, color: KHET.primary },
  gKv: { flexDirection: 'row', marginBottom: 8, gap: 10 },
  gKvK: { fontSize: 12.5, fontFamily: KFONT.sansBold, color: KHET.foreground, width: 96 },
  gKvV: { fontSize: 13, fontFamily: KFONT.sans, color: KHET.mutedForeground, flex: 1, lineHeight: 19 },
  pdRow: { marginBottom: 11, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: KHET.border },
  pdName: { fontSize: 14, fontFamily: KFONT.sansBold, color: KHET.foreground, marginBottom: 3 },
  pdLine: { fontSize: 12.5, fontFamily: KFONT.sans, color: KHET.mutedForeground, lineHeight: 18, marginTop: 1 },
  ddRow: { flexDirection: 'row', gap: 9, marginBottom: 8, alignItems: 'flex-start' },
  ddDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: KHET.primary, marginTop: 7 },

  // Timeline
  timelineSection: { paddingHorizontal: 16, paddingTop: 6 },
  sectionTitle: { fontSize: 22, fontFamily: KFONT.displayBold, color: KHET.foreground, letterSpacing: -0.4 },
  sectionSub: { fontSize: 13, fontFamily: KFONT.sans, color: KHET.mutedForeground, marginTop: 4, marginBottom: 16 },

  stageSelector: { marginBottom: 16 },
  stageSelectorScroll: { gap: 8 },
  stageSelectorChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: KHET.card, borderWidth: 1.5, borderColor: KHET.border },
  stageSelectorChipActive: { backgroundColor: KHET.primary, borderColor: KHET.primary },
  stageSelectorText: { fontSize: 13, fontFamily: KFONT.sansSemi, color: KHET.mutedForeground },
  stageSelectorTextActive: { color: '#fff' },

  activeStageDetail: { borderRadius: 18, padding: 16, marginBottom: 22, backgroundColor: KHET.muted, borderWidth: 1, borderColor: KHET.border, ...KSHADOW.soft },
  activeStageHeader: { marginBottom: 12 },
  activeStageName: { fontSize: 18, fontFamily: KFONT.displaySemi, color: KHET.foreground },
  activeStageHi: { fontSize: 14, fontFamily: KFONT.sansMed, color: KHET.mutedForeground, marginTop: 3 },
  activeStageStats: { flexDirection: 'row', gap: 20, marginBottom: 14 },
  activeStatItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activeStatLabel: { fontSize: 13, fontFamily: KFONT.sans, color: KHET.mutedForeground },
  activeStatValue: { fontSize: 16, fontFamily: KFONT.sansExtra, color: KHET.primary },
  tipBox: { flexDirection: 'row', gap: 10, backgroundColor: KHET.white, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: KHET.border },
  tipBoxText: { flex: 1, fontSize: 13.5, fontFamily: KFONT.sans, color: KHET.foreground, lineHeight: 20 },

  timeline: { paddingBottom: 10 },
  stageWrapper: { flexDirection: 'row', gap: 14, marginBottom: 16 },
  timelineCol: { width: 32, alignItems: 'center' },
  timelineDot: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  timelineDotActive: { width: 36, height: 36, borderRadius: 18, borderWidth: 3, borderColor: KHET.gold },
  timelineDotNum: { fontSize: 13, fontFamily: KFONT.sansBold, color: '#fff' },
  timelineLine: { flex: 1, width: 2, backgroundColor: KHET.border, marginVertical: 4, minHeight: 20 },

  stageCard: { flex: 1, backgroundColor: KHET.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: KHET.border, ...KSHADOW.soft },
  stageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  stageName: { fontSize: 15, fontFamily: KFONT.sansBold, color: KHET.foreground },
  stageNameHi: { fontSize: 12, fontFamily: KFONT.sans, color: KHET.mutedForeground, marginTop: 3 },
  stageDayBadge: { borderRadius: 9, paddingHorizontal: 10, paddingVertical: 4 },
  stageDayText: { fontSize: 12, fontFamily: KFONT.sansSemi, color: '#fff' },
  stageDurationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  stageDuration: { fontSize: 12, fontFamily: KFONT.sans, color: KHET.mutedForeground },
  stageTip: { flexDirection: 'row', gap: 8, backgroundColor: KHET.secondary, borderRadius: 12, padding: 10, marginBottom: 10 },
  stageTipText: { flex: 1, fontSize: 13, fontFamily: KFONT.sans, color: KHET.secondaryForeground, lineHeight: 18 },
  stageProgressBar: { height: 5, backgroundColor: KHET.muted, borderRadius: 3, overflow: 'hidden', marginBottom: 4 },
  stageProgressFill: { height: '100%', borderRadius: 3 },
  stageProgressLabel: { fontSize: 11, fontFamily: KFONT.sans, color: KHET.mutedForeground },
});

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
import {
  KHET, KFONT, KSPACE, KGUTTER, KRADIUS, KELEV, KTYPE, noLead, circle, withAlpha,
} from '@cropsetu/shared/constants/khetTheme';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import { tc } from '../../data/contentI18n';
import { getCropGuide } from '../../data/cropGuide';
import { STAGE_RAMP, STAGE_RAMP_INK, SECTION_TINTS } from '@cropsetu/shared/constants/dataPalette';

// The stage ramp and section tints are DATA, not theme — see the header of
// shared/constants/dataPalette.js for why they live outside KHET.
const STAGE_COLORS = STAGE_RAMP;
const TINT = SECTION_TINTS;

function StageCard({ stage, index, total, isActive, t, language }) {
  const step = index % STAGE_COLORS.length;
  const color = STAGE_COLORS[step];
  // Ink is per-step, not always white: six of the eight ramp colours fail WCAG
  // AA behind white text (the gold end sits at 2.03:1). See dataPalette.js.
  const onColor = STAGE_RAMP_INK[step];
  const progressPct = ((index + 1) / total) * 100;

  return (
    <View style={styles.stageWrapper}>
      <View style={styles.timelineCol}>
        <View style={[styles.timelineDot, { backgroundColor: color }, isActive && styles.timelineDotActive]}>
          <Text style={[styles.timelineDotNum, { color: onColor }]}>{index + 1}</Text>
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
            <Text style={[styles.stageDayText, { color: onColor }]}>{t('cropDetail.dayLabel')} {stage.day}</Text>
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
          style={[styles.hero, { paddingTop: insets.top + KSPACE.s18 }]}
        >
          <View style={styles.heroEmojiWrap}>
            <Text style={styles.cropIcon}>{crop.icon}</Text>
          </View>
          <Text style={styles.cropName}>{crop.name}</Text>
          {language !== 'en' && <Text style={styles.cropNameHi}>{tc(crop.name, language)}</Text>}
          <View style={styles.seasonPill}>
            <Ionicons name="calendar" size={13} color={KHET.white} />
            <Text style={styles.seasonText}>{crop.season}</Text>
          </View>
        </LinearGradient>

        {/* ── Summary cards ────────────────────────────────────────────────── */}
        <View style={styles.summaryGrid}>
          <SummaryCard icon="calendar" tint={KHET.primary} value={crop.sowingMonth} label={t('cropDetail.bestSowingTime')} />
          <SummaryCard icon="time" tint={KHET.gold} value={crop.duration} label={t('cropDetail.totalDuration')} />
          <SummaryCard icon="cut" tint={KHET.primaryGlow} value={crop.harvestMonth} label={t('cropDetail.harvestTime')} />
          <SummaryCard icon="water" tint={TINT.water} value={crop.waterNeeded ? crop.waterNeeded.split('(')[0] : t('cropDetail.varies')} label={t('cropDetail.waterNeeded')} />
          <SummaryCard icon="thermometer" tint={KHET.destructive} value={crop.idealTemp} label={t('cropDetail.idealTemperature')} />
          <SummaryCard icon="layers" tint={TINT.soilBrown} value={crop.soilType} label={t('cropDetail.bestSoil')} />
        </View>

        {/* ── Crop documentation (encyclopedia) ────────────────────────────── */}
        {guide && (
          <View style={styles.guideWrap}>
            <InfoSection icon="information-circle" tint={TINT.about} title={t('cropGuide.about', 'About this crop')}>
              <Text style={styles.gBody}>{guide.about}</Text>
              {!!guide.uses && <Text style={[styles.gMeta, { marginTop: KSPACE.s8 }]}><Text style={styles.gMetaK}>{t('cropGuide.uses', 'Uses')}: </Text>{guide.uses}</Text>}
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
              {!!guide.weed && <Text style={[styles.gMeta, { marginTop: KSPACE.s8 }]}><Text style={styles.gMetaK}>{t('cropGuide.weed', 'Weeds')}: </Text>{guide.weed}</Text>}
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
              {!!guide.yield && <Text style={[styles.gMeta, { marginTop: KSPACE.s8 }]}><Text style={styles.gMetaK}>{t('cropGuide.yield', 'Yield')}: </Text>{guide.yield}</Text>}
              {!!guide.postHarvest && <Text style={[styles.gMeta, { marginTop: KSPACE.s8 }]}><Text style={styles.gMetaK}>{t('cropGuide.postHarvest', 'Post-harvest')}: </Text>{guide.postHarvest}</Text>}
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
    <View style={[styles.pdRow, last && { borderBottomWidth: 0, marginBottom: KSPACE.s0, paddingBottom: KSPACE.s0 }]}>
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
    alignItems: 'center', gap: KSPACE.s6, paddingHorizontal: KSPACE.s24, paddingBottom: 28,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28, ...KELEV.e4,
  },
  heroEmojiWrap: {
    ...circle(84), marginBottom: KSPACE.s8,
    backgroundColor: withAlpha(KHET.white, 0.16), borderWidth: 1, borderColor: withAlpha(KHET.white, 0.26),
    alignItems: 'center', justifyContent: 'center',
  },
  cropIcon: { fontSize: 46 },
  cropName: { fontSize: 30, fontFamily: KFONT.displayBold, color: KHET.white, letterSpacing: -0.4, textAlign: 'center' },
  cropNameHi: { fontSize: 15, fontFamily: KFONT.sansMed, color: withAlpha(KHET.primaryForeground, 0.85), marginTop: KSPACE.s2 },
  seasonPill: {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s6, marginTop: KSPACE.s8,
    backgroundColor: withAlpha(KHET.white, 0.16), borderWidth: 1, borderColor: withAlpha(KHET.white, 0.24),
    borderRadius: KRADIUS.pill, paddingHorizontal: 13, paddingVertical: KSPACE.s6,
  },
  seasonText: { ...noLead(KTYPE.label), color: KHET.white },

  // Summary
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: KSPACE.s10, padding: KSPACE.s16 },
  summaryCard: {
    backgroundColor: KHET.card, borderRadius: KRADIUS.r16, padding: KSPACE.s12, alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: KHET.border, ...KELEV.e3, flexBasis: '30%', flexGrow: 1, minWidth: '29%',
  },
  summaryIcon: { width: 36, height: 36, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: KSPACE.s2 },
  summaryValue: { ...noLead(KTYPE.labelBold), color: KHET.foreground, textAlign: 'center' },
  summaryLabel: { fontSize: 10.5, fontFamily: KFONT.sans, color: KHET.mutedForeground, textAlign: 'center' },

  // Crop documentation
  guideWrap: { paddingHorizontal: KGUTTER.base, paddingTop: KSPACE.s4 },
  gSection: { backgroundColor: KHET.card, borderRadius: 18, padding: KSPACE.s16, marginBottom: KSPACE.s12, borderWidth: 1, borderColor: KHET.border, ...KELEV.e3 },
  gSecHead: { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s10, marginBottom: 11 },
  gSecIcon: { width: 34, height: 34, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  gSecTitle: { fontSize: 17, fontFamily: KFONT.displaySemi, color: KHET.foreground, letterSpacing: -0.2, flex: 1 },
  gBody: { ...noLead(KTYPE.body), color: KHET.mutedForeground, lineHeight: 21 },
  gMeta: { fontSize: 13.5, fontFamily: KFONT.sans, color: KHET.mutedForeground, lineHeight: 20 },
  gMetaK: { fontFamily: KFONT.sansBold, color: KHET.foreground },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: KSPACE.s8 },
  gChip: { backgroundColor: KHET.secondary, borderRadius: KRADIUS.pill, paddingHorizontal: 13, paddingVertical: 7, borderWidth: 1, borderColor: withAlpha(KHET.primary, 0.16) },
  gChipTxt: { fontSize: 12.5, fontFamily: KFONT.sansSemi, color: KHET.primary },
  gKv: { flexDirection: 'row', marginBottom: KSPACE.s8, gap: KSPACE.s10 },
  gKvK: { fontSize: 12.5, fontFamily: KFONT.sansBold, color: KHET.foreground, width: 96 },
  gKvV: { ...noLead(KTYPE.bodySm), color: KHET.mutedForeground, flex: 1, lineHeight: 19 },
  pdRow: { marginBottom: 11, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: KHET.border },
  pdName: { ...noLead(KTYPE.bodyBold), color: KHET.foreground, marginBottom: KSPACE.s3 },
  pdLine: { fontSize: 12.5, fontFamily: KFONT.sans, color: KHET.mutedForeground, lineHeight: 18, marginTop: KSPACE.s1 },
  ddRow: { flexDirection: 'row', gap: 9, marginBottom: KSPACE.s8, alignItems: 'flex-start' },
  ddDot: { ...circle(6), backgroundColor: KHET.primary, marginTop: 7 },

  // Timeline
  timelineSection: { paddingHorizontal: KGUTTER.base, paddingTop: KSPACE.s6 },
  sectionTitle: { fontSize: 22, fontFamily: KFONT.displayBold, color: KHET.foreground, letterSpacing: -0.4 },
  sectionSub: { ...noLead(KTYPE.bodySm), color: KHET.mutedForeground, marginTop: KSPACE.s4, marginBottom: KSPACE.s16 },

  stageSelector: { marginBottom: KSPACE.s16 },
  stageSelectorScroll: { gap: KSPACE.s8 },
  stageSelectorChip: { paddingVertical: KSPACE.s8, paddingHorizontal: KSPACE.s14, borderRadius: KRADIUS.pill, backgroundColor: KHET.card, borderWidth: 1.5, borderColor: KHET.border },
  stageSelectorChipActive: { backgroundColor: KHET.primary, borderColor: KHET.primary },
  stageSelectorText: { ...noLead(KTYPE.label), color: KHET.mutedForeground },
  stageSelectorTextActive: { color: KHET.white },

  activeStageDetail: { borderRadius: 18, padding: KSPACE.s16, marginBottom: 22, backgroundColor: KHET.muted, borderWidth: 1, borderColor: KHET.border, ...KELEV.e3 },
  activeStageHeader: { marginBottom: KSPACE.s12 },
  activeStageName: { fontSize: 18, fontFamily: KFONT.displaySemi, color: KHET.foreground },
  activeStageHi: { fontSize: 14, fontFamily: KFONT.sansMed, color: KHET.mutedForeground, marginTop: KSPACE.s3 },
  activeStageStats: { flexDirection: 'row', gap: KSPACE.s20, marginBottom: KSPACE.s14 },
  activeStatItem: { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s8 },
  activeStatLabel: { ...noLead(KTYPE.bodySm), color: KHET.mutedForeground },
  activeStatValue: { ...noLead(KTYPE.subheadingExtra), color: KHET.primary },
  tipBox: { flexDirection: 'row', gap: KSPACE.s10, backgroundColor: KHET.white, borderRadius: KRADIUS.r14, padding: KSPACE.s12, borderWidth: 1, borderColor: KHET.border },
  tipBoxText: { flex: 1, fontSize: 13.5, fontFamily: KFONT.sans, color: KHET.foreground, lineHeight: 20 },

  timeline: { paddingBottom: KSPACE.s10 },
  stageWrapper: { flexDirection: 'row', gap: KSPACE.s14, marginBottom: KSPACE.s16 },
  timelineCol: { width: 32, alignItems: 'center' },
  timelineDot: { ...circle(32), justifyContent: 'center', alignItems: 'center' },
  timelineDotActive: { ...circle(36), borderWidth: 3, borderColor: KHET.gold },
  timelineDotNum: { ...noLead(KTYPE.labelBold) },  // colour supplied per stage step
  timelineLine: { flex: 1, width: 2, backgroundColor: KHET.border, marginVertical: KSPACE.s4, minHeight: 20 },

  stageCard: { flex: 1, backgroundColor: KHET.card, borderRadius: KRADIUS.r16, padding: KSPACE.s14, borderWidth: 1, borderColor: KHET.border, ...KELEV.e3 },
  stageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: KSPACE.s8 },
  stageName: { ...noLead(KTYPE.subhead), color: KHET.foreground },
  stageNameHi: { fontSize: 12, fontFamily: KFONT.sans, color: KHET.mutedForeground, marginTop: KSPACE.s3 },
  stageDayBadge: { borderRadius: 9, paddingHorizontal: KSPACE.s10, paddingVertical: KSPACE.s4 },
  stageDayText: { fontSize: 12, fontFamily: KFONT.sansSemi },  // colour supplied per stage step
  stageDurationRow: { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s6, marginBottom: KSPACE.s10 },
  stageDuration: { fontSize: 12, fontFamily: KFONT.sans, color: KHET.mutedForeground },
  stageTip: { flexDirection: 'row', gap: KSPACE.s8, backgroundColor: KHET.secondary, borderRadius: KRADIUS.r12, padding: KSPACE.s10, marginBottom: KSPACE.s10 },
  stageTipText: { flex: 1, ...KTYPE.bodySm, color: KHET.secondaryForeground },
  stageProgressBar: { height: 5, backgroundColor: KHET.muted, borderRadius: 3, overflow: 'hidden', marginBottom: KSPACE.s4 },
  stageProgressFill: { height: '100%', borderRadius: 3 },
  stageProgressLabel: { fontSize: 11, fontFamily: KFONT.sans, color: KHET.mutedForeground },
});

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOWS } from '../../constants/colors';
import { useLanguage } from '../../context/LanguageContext';

const STAGE_COLORS = [
  COLORS.deepPine, COLORS.warmGreen, COLORS.sageMid, COLORS.sageLight, COLORS.calmGreen,
  COLORS.mintLight, COLORS.seafoam, COLORS.paleForest,
];

function StageCard({ stage, index, total, isActive, t }) {
  const color = STAGE_COLORS[index % STAGE_COLORS.length];
  const progressPct = ((index + 1) / total) * 100;

  return (
    <View style={styles.stageWrapper}>
      {/* Timeline line */}
      <View style={styles.timelineCol}>
        <View style={[styles.timelineDot, { backgroundColor: color }, isActive && styles.timelineDotActive]}>
          <Text style={styles.timelineDotNum}>{index + 1}</Text>
        </View>
        {index < total - 1 && <View style={styles.timelineLine} />}
      </View>

      {/* Stage card */}
      <View style={[styles.stageCard, isActive && { borderColor: color, borderWidth: 2 }]}>
        <View style={styles.stageHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.stageName}>{stage.name}</Text>
            <Text style={styles.stageNameHi}>{stage.nameHi}</Text>
          </View>
          <View style={[styles.stageDayBadge, { backgroundColor: color }]}>
            <Text style={styles.stageDayText}>{t('cropDetail.dayLabel')} {stage.day}</Text>
          </View>
        </View>

        <View style={styles.stageDurationRow}>
          <Ionicons name="time" size={14} color={COLORS.textLight} />
          <Text style={styles.stageDuration}>{stage.duration} {t('cropDetail.daysDuration')}</Text>
        </View>

        {/* Tip */}
        <View style={styles.stageTip}>
          <Ionicons name="bulb" size={14} color={COLORS.gold} />
          <Text style={styles.stageTipText}>{stage.tip}</Text>
        </View>

        {/* Progress bar */}
        <View style={styles.stageProgressBar}>
          <View style={[styles.stageProgressFill, { width: `${progressPct}%`, backgroundColor: color }]} />
        </View>
        <Text style={styles.stageProgressLabel}>{Math.round(progressPct)}{t('cropDetail.percentCropCycle')}</Text>
      </View>
    </View>
  );
}

export default function CropDetail({ route }) {
  const { t } = useLanguage();
  const { crop } = route.params;
  const [activeStageIndex, setActiveStageIndex] = useState(1);

  const hasStages = Array.isArray(crop.stages) && crop.stages.length > 0;
  const lastStage = hasStages ? crop.stages[crop.stages.length - 1] : null;
  const totalDays = lastStage ? (lastStage.day || 0) + (lastStage.duration || 0) : 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Crop Header */}
        <View style={styles.cropHeader}>
          <Text style={styles.cropIcon}>{crop.icon}</Text>
          <Text style={styles.cropName}>{crop.name}</Text>
          <Text style={styles.cropNameHi}>{crop.nameHi}</Text>
          <View style={styles.seasonBadge}>
            <Ionicons name="calendar" size={14} color={COLORS.textWhite} />
            <Text style={styles.seasonText}>{crop.season}</Text>
          </View>
        </View>

        {/* Crop Summary Cards */}
        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <Ionicons name="calendar" size={20} color={COLORS.primary} />
            <Text style={styles.summaryValue}>{crop.sowingMonth}</Text>
            <Text style={styles.summaryLabel}>{t('cropDetail.bestSowingTime')}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Ionicons name="time" size={20} color={COLORS.accent} />
            <Text style={styles.summaryValue}>{crop.duration}</Text>
            <Text style={styles.summaryLabel}>{t('cropDetail.totalDuration')}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Ionicons name="cut" size={20} color={COLORS.success} />
            <Text style={styles.summaryValue}>{crop.harvestMonth}</Text>
            <Text style={styles.summaryLabel}>{t('cropDetail.harvestTime')}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Ionicons name="water" size={20} color={COLORS.info} />
            <Text style={styles.summaryValue} numberOfLines={2}>{crop.waterNeeded ? crop.waterNeeded.split('(')[0] : t('cropDetail.varies')}</Text>
            <Text style={styles.summaryLabel}>{t('cropDetail.waterNeeded')}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Ionicons name="thermometer" size={20} color={COLORS.error} />
            <Text style={styles.summaryValue}>{crop.idealTemp}</Text>
            <Text style={styles.summaryLabel}>{t('cropDetail.idealTemperature')}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Ionicons name="layers" size={20} color={COLORS.gold} />
            <Text style={styles.summaryValue} numberOfLines={2}>{crop.soilType}</Text>
            <Text style={styles.summaryLabel}>{t('cropDetail.bestSoil')}</Text>
          </View>
        </View>

        {/* Visual Timeline */}
        {hasStages && (
        <View style={styles.timelineSection}>
          <Text style={styles.sectionTitle}>{t('cropDetail.cropGrowthTimeline')}</Text>
          <Text style={styles.sectionSub}>{t('cropDetail.stagesSummary', { stages: crop.stages.length, totalDays })}</Text>

          {/* Stage selector mini-bar */}
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

          {/* Highlighted stage detail */}
          <View style={styles.activeStageDetail}>
            <View style={styles.activeStageGradient}>
              <View style={styles.activeStageHeader}>
                <Text style={styles.activeStageName}>{crop.stages[activeStageIndex].name}</Text>
                <Text style={styles.activeStageHi}>{crop.stages[activeStageIndex].nameHi}</Text>
              </View>
              <View style={styles.activeStageStats}>
                <View style={styles.activeStatItem}>
                  <Ionicons name="play" size={16} color={COLORS.primary} />
                  <Text style={styles.activeStatLabel}>{t('cropDetail.startsDay')}</Text>
                  <Text style={styles.activeStatValue}>{crop.stages[activeStageIndex].day}</Text>
                </View>
                <View style={styles.activeStatItem}>
                  <Ionicons name="time" size={16} color={COLORS.accent} />
                  <Text style={styles.activeStatLabel}>{t('cropDetail.totalDuration')}</Text>
                  <Text style={styles.activeStatValue}>{crop.stages[activeStageIndex].duration}d</Text>
                </View>
              </View>
              <View style={styles.tipBox}>
                <Ionicons name="bulb" size={18} color={COLORS.gold} />
                <Text style={styles.tipBoxText}>{crop.stages[activeStageIndex].tip}</Text>
              </View>
            </View>
          </View>

          {/* Full timeline */}
          <View style={styles.timeline}>
            {crop.stages.map((stage, i) => (
              <StageCard
                key={i}
                stage={stage}
                index={i}
                total={crop.stages.length}
                isActive={activeStageIndex === i}
                t={t}
              />
            ))}
          </View>
        </View>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  cropHeader: { padding: 28, alignItems: 'center', gap: 8 },
  cropIcon: { fontSize: 56 },
  cropName: { fontSize: 26, fontWeight: '900', color: COLORS.textWhite },
  cropNameHi: { fontSize: 18, color: COLORS.primaryPale, fontWeight: '600' },
  seasonBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.13)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6, marginTop: 4 },
  seasonText: { fontSize: 14, fontWeight: '600', color: COLORS.textWhite },

  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 16 },
  summaryCard: { width: '30%', backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 6, ...SHADOWS.small, flex: 1, minWidth: '30%' },
  summaryValue: { fontSize: 13, fontWeight: '800', color: COLORS.textDark, textAlign: 'center' },
  summaryLabel: { fontSize: 11, color: COLORS.textLight, textAlign: 'center' },

  timelineSection: { paddingHorizontal: 16 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textDark },
  sectionSub: { fontSize: 13, color: COLORS.textLight, marginTop: 4, marginBottom: 16 },

  stageSelector: { marginBottom: 16 },
  stageSelectorScroll: { gap: 10 },
  stageSelectorChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border },
  stageSelectorChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  stageSelectorText: { fontSize: 13, fontWeight: '600', color: COLORS.textMedium },
  stageSelectorTextActive: { color: COLORS.textWhite },

  activeStageDetail: { borderRadius: 16, overflow: 'hidden', marginBottom: 24, ...SHADOWS.small },
  activeStageGradient: { padding: 16 },
  activeStageHeader: { marginBottom: 12 },
  activeStageName: { fontSize: 18, fontWeight: '800', color: COLORS.textDark },
  activeStageHi: { fontSize: 14, color: COLORS.textMedium, fontWeight: '600', marginTop: 4 },
  activeStageStats: { flexDirection: 'row', gap: 20, marginBottom: 14 },
  activeStatItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activeStatLabel: { fontSize: 13, color: COLORS.textMedium },
  activeStatValue: { fontSize: 16, fontWeight: '800', color: COLORS.primary },
  tipBox: { flexDirection: 'row', gap: 10, backgroundColor: COLORS.textWhite + 'AA', borderRadius: 12, padding: 12 },
  tipBoxText: { flex: 1, fontSize: 14, color: COLORS.textDark, lineHeight: 20 },

  timeline: { paddingBottom: 10 },
  stageWrapper: { flexDirection: 'row', gap: 14, marginBottom: 16 },
  timelineCol: { width: 32, alignItems: 'center' },
  timelineDot: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  timelineDotActive: { width: 36, height: 36, borderRadius: 18, borderWidth: 3, borderColor: COLORS.gold },
  timelineDotNum: { fontSize: 13, fontWeight: '800', color: COLORS.textWhite },
  timelineLine: { flex: 1, width: 2, backgroundColor: COLORS.border, marginVertical: 4, minHeight: 20 },

  stageCard: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.small },
  stageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  stageName: { fontSize: 15, fontWeight: '800', color: COLORS.textDark },
  stageNameHi: { fontSize: 12, color: COLORS.textMedium, marginTop: 3 },
  stageDayBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  stageDayText: { fontSize: 12, fontWeight: '700', color: COLORS.textWhite },
  stageDurationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  stageDuration: { fontSize: 12, color: COLORS.textLight },
  stageTip: { flexDirection: 'row', gap: 8, backgroundColor: COLORS.yellowWarm, borderRadius: 10, padding: 10, marginBottom: 10 },
  stageTipText: { flex: 1, fontSize: 13, color: COLORS.textMedium, lineHeight: 18 },
  stageProgressBar: { height: 5, backgroundColor: COLORS.divider, borderRadius: 3, overflow: 'hidden', marginBottom: 4 },
  stageProgressFill: { height: '100%', borderRadius: 3 },
  stageProgressLabel: { fontSize: 11, color: COLORS.textLight },
});

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../../../context/LanguageContext';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../../../constants/colors';
import { COSMIC } from '../theme/cosmicTheme';
import { RadialGauge } from '../../../components/charts';

const ratingColor = (rating) => {
  const r = (rating || '').toLowerCase();
  if (r.includes('low') || r.includes('deficient')) return COSMIC.DANGER;
  if (r.includes('high') || r.includes('excess')) return COSMIC.WARN;
  if (r.includes('medium') || r.includes('adequate') || r.includes('normal') || r.includes('optimum')) return COSMIC.SUCCESS;
  return COLORS.textMedium;
};

// Per-nutrient display ranges (visual fraction only; colour conveys health).
const RANGES = {
  ph: { min: 3, max: 9, decimals: 1 },
  n:  { min: 0, max: 600, decimals: 0 },
  p:  { min: 0, max: 60, decimals: 0 },
  k:  { min: 0, max: 400, decimals: 0 },
};

export default function SoilGlanceCard({ report, onUpload }) {
  const { t } = useLanguage();

  if (!report) {
    return (
      <TouchableOpacity style={styles.card} onPress={onUpload} activeOpacity={0.7}>
        <Text style={styles.title}>{t('myFarm.soil.title')}</Text>
        <View style={styles.emptyRow}>
          <Ionicons name="leaf-outline" size={22} color={COLORS.textMedium} />
          <Text style={styles.emptyText}>{t('myFarm.soil.noReport')}</Text>
        </View>
        <Text style={styles.cta}>{t('myFarm.soil.uploadCta')}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('myFarm.soil.title')}</Text>
      <View style={styles.grid}>
        <RadialGauge value={report.ph} {...RANGES.ph} label={t('myFarm.soil.pH')} color={ratingColor(report.phRating)} />
        <RadialGauge value={report.nitrogen} {...RANGES.n} label={t('myFarm.soil.nitrogen')} color={ratingColor(report.nitrogenRating)} />
        <RadialGauge value={report.phosphorus} {...RANGES.p} label={t('myFarm.soil.phosphorus')} color={ratingColor(report.phosphorusRating)} />
        <RadialGauge value={report.potassium} {...RANGES.k} label={t('myFarm.soil.potassium')} color={ratingColor(report.potassiumRating)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    ...SHADOWS.small,
  },
  title: {
    fontSize: TYPE.size.base,
    fontWeight: TYPE.weight.semibold,
    color: COLORS.textDark,
    marginBottom: 12,
  },
  grid: { flexDirection: 'row', justifyContent: 'space-between' },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  emptyText: { fontSize: TYPE.size.sm, color: COLORS.textMedium },
  cta: { fontSize: TYPE.size.sm, fontWeight: TYPE.weight.semibold, color: COLORS.primary, marginTop: 4 },
});

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../../../context/LanguageContext';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../../../constants/colors';

const ratingColor = (rating) => {
  const r = (rating || '').toLowerCase();
  if (r.includes('low') || r.includes('deficient')) return '#E53935';
  if (r.includes('high') || r.includes('excess')) return '#F59E0B';
  if (r.includes('medium') || r.includes('adequate') || r.includes('normal') || r.includes('optimum')) return '#43A047';
  return COLORS.textMedium;
};

function Nutrient({ label, value, rating }) {
  return (
    <View style={styles.nutrient}>
      <Text style={styles.nLabel}>{label}</Text>
      <Text style={styles.nValue}>{value != null ? value.toFixed(1) : '—'}</Text>
      <View style={[styles.dot, { backgroundColor: ratingColor(rating) }]} />
    </View>
  );
}

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
        <Nutrient label={t('myFarm.soil.pH')} value={report.ph} rating={report.phRating} />
        <Nutrient label={t('myFarm.soil.nitrogen')} value={report.nitrogen} rating={report.nitrogenRating} />
        <Nutrient label={t('myFarm.soil.phosphorus')} value={report.phosphorus} rating={report.phosphorusRating} />
        <Nutrient label={t('myFarm.soil.potassium')} value={report.potassium} rating={report.potassiumRating} />
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
  nutrient: { alignItems: 'center', flex: 1 },
  nLabel: { fontSize: TYPE.size.xs, color: COLORS.textMedium, fontWeight: TYPE.weight.medium },
  nValue: { fontSize: TYPE.size.md, fontWeight: TYPE.weight.bold, color: COLORS.textDark, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  emptyText: { fontSize: TYPE.size.sm, color: COLORS.textMedium },
  cta: { fontSize: TYPE.size.sm, fontWeight: TYPE.weight.semibold, color: COLORS.primary, marginTop: 4 },
});

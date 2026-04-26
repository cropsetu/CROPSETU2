import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../../../context/LanguageContext';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../../../constants/colors';

const TYPE_META = {
  CROP_SUGGESTION:  { icon: 'sparkles',          color: '#8B5CF6' },
  YIELD_FORECAST:   { icon: 'trending-up',       color: '#16A34A' },
  INCOME_FORECAST:  { icon: 'cash',              color: '#0EA5E9' },
  FERTILIZER_PLAN:  { icon: 'leaf',              color: '#10B981' },
  IRRIGATION_PLAN:  { icon: 'water',             color: '#0891B2' },
  PEST_RISK:        { icon: 'bug',               color: '#DC2626' },
  SEED_QUANTITY:    { icon: 'albums-outline',    color: '#7C3AED' },
};

export default function AIInsightsPanel({ insights, loading, onViewAll }) {
  const { t, language } = useLanguage();

  const pickExplanation = (item) => {
    if (language === 'hi' && item.explanationHi) return item.explanationHi;
    if (language === 'mr' && item.explanationMr) return item.explanationMr;
    return item.explanationEn || '';
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('myFarm.insights.title')}</Text>
        {onViewAll && insights && insights.length > 0 && (
          <TouchableOpacity onPress={onViewAll}>
            <Text style={styles.viewAll}>{t('myFarm.insights.viewAll')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <Text style={styles.empty}>…</Text>
      ) : !insights || insights.length === 0 ? (
        <View style={styles.emptyRow}>
          <Ionicons name="bulb-outline" size={22} color={COLORS.textMedium} />
          <Text style={styles.emptyText}>{t('myFarm.insights.noInsights')}</Text>
        </View>
      ) : (
        insights.map((item) => {
          const meta = TYPE_META[item.predictionType] || { icon: 'information-circle', color: COLORS.primary };
          const text = pickExplanation(item);
          const pct = item.confidence != null ? Math.round(item.confidence * 100) : null;
          return (
            <View key={item.id} style={styles.insight}>
              <View style={[styles.iconWrap, { backgroundColor: meta.color + '22' }]}>
                <Ionicons name={meta.icon} size={18} color={meta.color} />
              </View>
              <View style={styles.insightBody}>
                <Text style={styles.insightText} numberOfLines={2}>{text}</Text>
                {pct != null && <Text style={styles.conf}>{t('myFarm.insights.confidence', { pct })}</Text>}
              </View>
            </View>
          );
        })
      )}
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: TYPE.size.base, fontWeight: TYPE.weight.semibold, color: COLORS.textDark },
  viewAll: { fontSize: TYPE.size.sm, fontWeight: TYPE.weight.semibold, color: COLORS.primary },
  empty: { textAlign: 'center', color: COLORS.textMedium },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  emptyText: { fontSize: TYPE.size.sm, color: COLORS.textMedium, flex: 1 },
  insight: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  iconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  insightBody: { flex: 1 },
  insightText: { fontSize: TYPE.size.sm, color: COLORS.textDark, lineHeight: TYPE.size.sm * TYPE.leading.normal },
  conf: { fontSize: TYPE.size.xs, color: COLORS.textMedium, marginTop: 2 },
});

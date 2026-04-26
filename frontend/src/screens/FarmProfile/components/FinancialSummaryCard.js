import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../../../context/LanguageContext';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../../../constants/colors';

const SEASONS = ['YTD', 'KHARIF', 'RABI', 'ZAID'];

const fmtInr = (n) => {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${Math.round(n)}`;
};

function Stat({ label, value, color, icon }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statLabelRow}>
        <Ionicons name={icon} size={14} color={color} />
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

export default function FinancialSummaryCard({ summary, activeSeason, onSeasonChange, loading }) {
  const { t } = useLanguage();
  const totals = summary?.totals;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('myFarm.financials.title')}</Text>

      <View style={styles.tabs}>
        {SEASONS.map((s) => {
          const isActive = s === activeSeason;
          return (
            <TouchableOpacity
              key={s}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => onSeasonChange?.(s)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {t(`myFarm.financials.season.${s.toLowerCase()}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <Text style={styles.empty}>…</Text>
      ) : !totals || totals.cycleCount === 0 ? (
        <Text style={styles.empty}>{t('myFarm.financials.noData')}</Text>
      ) : (
        <View style={styles.grid}>
          <Stat label={t('myFarm.financials.grossIncome')} value={fmtInr(totals.grossIncomeInr)} color="#16A34A" icon="trending-up" />
          <Stat label={t('myFarm.financials.totalCost')}   value={fmtInr(totals.totalCostInr)}   color="#DC2626" icon="trending-down" />
          <Stat label={t('myFarm.financials.netProfit')}   value={fmtInr(totals.netProfitInr)}   color={COLORS.primary} icon="wallet" />
          <Stat label={t('myFarm.financials.profitPerAcre')} value={fmtInr(totals.profitPerAcreInr)} color={COLORS.cta} icon="stats-chart" />
        </View>
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
  title: { fontSize: TYPE.size.base, fontWeight: TYPE.weight.semibold, color: COLORS.textDark, marginBottom: 12 },
  tabs: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  tab: { flex: 1, paddingVertical: 6, paddingHorizontal: 4, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken, alignItems: 'center' },
  tabActive: { backgroundColor: COLORS.primaryPale },
  tabText: { fontSize: TYPE.size.xs, fontWeight: TYPE.weight.medium, color: COLORS.textMedium },
  tabTextActive: { color: COLORS.primary, fontWeight: TYPE.weight.semibold },
  empty: { textAlign: 'center', color: COLORS.textMedium, paddingVertical: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { width: '48%', padding: 10, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSunken },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  statLabel: { fontSize: TYPE.size.xs, color: COLORS.textMedium },
  statValue: { fontSize: TYPE.size.md, fontWeight: TYPE.weight.bold },
});

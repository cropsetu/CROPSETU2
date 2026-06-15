/**
 * AICreditsScreen — AI Credit Usage Dashboard
 *
 * Shows: balance left, used this month, and a Buy button.
 * Runs on a fixed monthly credit budget.
 */
import { COLORS, TYPE, SHADOWS } from '../../constants/colors';
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, StatusBar, Platform, RefreshControl, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../../context/LanguageContext';
import { getAICredits } from '../../services/aiApi';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const BUDGET = 100000;

export default function AICreditsScreen({ navigation }) {
  const { language, t } = useLanguage();
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const result = await getAICredits();
      setData(result);
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <AnimatedScreen style={S.root}>
        <StatusBar barStyle="dark-content" />
        <View style={S.centered}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      </AnimatedScreen>
    );
  }

  const balance = data?.balance ?? 0;
  const used    = Math.max(0, BUDGET - balance);
  const usedPct = Math.min(100, Math.round((used / BUDGET) * 100));

  const handleBuy = () => {
    Alert.alert(
      t('aiCredits.buyCredits', 'Buy Credits'),
      t('aiCredits.buySoon', 'Purchasing will be available soon.'),
    );
  };

  return (
    <AnimatedScreen style={S.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>{t('aiCredits.title')}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={S.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[COLORS.primary]} />}
      >

        {/* Balance card */}
        <View style={S.balanceCard}>
          <View style={S.balanceRow}>
            <View>
              <Text style={S.balanceLabel}>{t('aiCredits.balanceLeft', 'Balance left')}</Text>
              <Text style={S.balanceValue}>{balance}</Text>
            </View>
            <View style={S.usedBox}>
              <Text style={S.usedValue}>{used}</Text>
              <Text style={S.usedLabel}>{t('aiCredits.usedThisMonth', 'Used this month')}</Text>
            </View>
          </View>

          {/* Usage bar */}
          <View style={S.barWrap}>
            <View style={[S.barFill, { width: `${usedPct}%`, backgroundColor: COLORS.amber }]} />
          </View>
          <View style={S.barLabels}>
            <Text style={S.barLabel}>{used} {t('aiCredits.usedThisMonth', 'Used this month')}</Text>
            <Text style={S.barLabel}>{BUDGET} {t('aiCredits.monthlyBudget', 'Monthly budget')}</Text>
          </View>
        </View>

        {/* Buy button */}
        <TouchableOpacity style={S.buyBtn} activeOpacity={0.85} onPress={handleBuy}>
          <Ionicons name="flash" size={16} color={COLORS.white} />
          <Text style={S.buyBtnText}>{t('aiCredits.buyCredits', 'Buy Credits')}</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </AnimatedScreen>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 18, gap: 14 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingTop: Platform.OS === 'ios' ? 56 : 16, paddingHorizontal: 18, paddingBottom: 14,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, ...SHADOWS.small,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 10, backgroundColor: COLORS.primaryPale },
  headerTitle: { fontSize: 20, fontWeight: '900', color: COLORS.textDark },

  // Balance card
  balanceCard: {
    backgroundColor: COLORS.surface, borderRadius: 20, padding: 20,
    borderWidth: 1, borderColor: '#FFE082', ...SHADOWS.small,
  },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  balanceLabel: { fontSize: 12, color: COLORS.textMedium, fontWeight: '600' },
  balanceValue: { fontSize: 44, fontWeight: '900', color: COLORS.amber, lineHeight: 48 },
  usedBox: { alignItems: 'flex-end' },
  usedValue: { fontSize: 22, fontWeight: '900', color: COLORS.textDark },
  usedLabel: { fontSize: 11, color: COLORS.textLight, fontWeight: '600', marginTop: 2 },

  barWrap: { height: 8, backgroundColor: '#FFF3E0', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  barFill: { height: 8, borderRadius: 4 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  barLabel: { fontSize: 10, color: COLORS.textLight, fontWeight: '600' },

  // Buy button
  buyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.amber, borderRadius: 16, paddingVertical: 16, ...SHADOWS.small,
  },
  buyBtnText: { fontSize: 15, fontWeight: '900', color: COLORS.white },
});

/**
 * AICreditsScreen — AI Credit Usage Dashboard
 *
 * Shows: balance, tier, usage history, cost breakdown, buy credits packs.
 */
import { COLORS, TYPE, SHADOWS } from '../../constants/colors';
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, StatusBar, Platform, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../../context/LanguageContext';
import { getAICredits } from '../../services/aiApi';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const TYPE_ICONS = {
  ai_scan_gemini: { icon: 'scan', color: '#16A34A' },
  ai_scan_claude: { icon: 'scan', color: '#9333EA' },
  ai_chat_groq:   { icon: 'chatbubble', color: '#0288D1' },
  ai_chat_claude:  { icon: 'chatbubble', color: '#9333EA' },
  ai_pest_rule:    { icon: 'bug', color: '#78716C' },
  ai_pest_haiku:   { icon: 'bug', color: '#F59E0B' },
  ai_pest_sonnet:  { icon: 'bug', color: '#DC2626' },
  ai_voice:        { icon: 'mic', color: '#E65100' },
  ai_translate:    { icon: 'language', color: '#0891B2' },
  ai_planner:      { icon: 'leaf', color: '#00897B' },
  free_refill:     { icon: 'gift', color: '#16A34A' },
  purchase:        { icon: 'card', color: '#1565C0' },
  admin_grant:     { icon: 'shield', color: '#9333EA' },
  referral:        { icon: 'people', color: '#F59E0B' },
};

function TypeIcon({ type }) {
  const cfg = TYPE_ICONS[type] || { icon: 'ellipse', color: '#78716C' };
  return (
    <View style={[S.txnIcon, { backgroundColor: cfg.color + '18' }]}>
      <Ionicons name={cfg.icon} size={14} color={cfg.color} />
    </View>
  );
}

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

  const balance   = data?.balance ?? 0;
  const tier      = data?.tierLabel ?? 'Free';
  const monthly   = data?.monthlyAllowance ?? 100;
  const spent     = data?.lifetimeSpent ?? 0;
  const earned    = data?.lifetimeEarned ?? 100;
  const todayUsed = data?.todaySpent ?? 0;
  const usedPct   = Math.min(100, Math.round((spent / Math.max(earned, 1)) * 100));
  const isLow     = balance <= 10;
  const txns      = data?.recentTransactions ?? [];
  const costs     = data?.costs ?? {};
  const packs     = data?.packs ?? [];

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
          <Text style={S.headerSub}>{tier} {t('aiCredits.plan')}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={S.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[COLORS.primary]} />}
      >

        {/* Balance card */}
        <View style={[S.balanceCard, isLow && { borderColor: '#FECACA' }]}>
          <View style={S.balanceRow}>
            <View>
              <Text style={S.balanceLabel}>{t('aiCredits.availableCredits')}</Text>
              <Text style={[S.balanceValue, isLow && { color: '#DC2626' }]}>{balance}</Text>
            </View>
            <View style={[S.tierBadge, { backgroundColor: isLow ? '#FEE2E2' : '#FFF8E1' }]}>
              <Ionicons name="flash" size={14} color={isLow ? '#DC2626' : COLORS.amber} />
              <Text style={[S.tierText, isLow && { color: '#DC2626' }]}>{tier}</Text>
            </View>
          </View>

          {/* Usage bar */}
          <View style={S.barWrap}>
            <View style={[S.barFill, { width: `${usedPct}%`, backgroundColor: isLow ? '#DC2626' : COLORS.amber }]} />
          </View>
          <View style={S.barLabels}>
            <Text style={S.barLabel}>{spent} {t('aiCredits.used')}</Text>
            <Text style={S.barLabel}>{earned} {t('aiCredits.total')}</Text>
          </View>

          {/* Stats row */}
          <View style={S.statsRow}>
            <View style={S.stat}>
              <Text style={S.statValue}>{todayUsed}</Text>
              <Text style={S.statLabel}>{t('aiCredits.today')}</Text>
            </View>
            <View style={S.statDivider} />
            <View style={S.stat}>
              <Text style={S.statValue}>{monthly}</Text>
              <Text style={S.statLabel}>{t('aiCredits.monthly')}</Text>
            </View>
            <View style={S.statDivider} />
            <View style={S.stat}>
              <Text style={S.statValue}>{spent}</Text>
              <Text style={S.statLabel}>{t('aiCredits.lifetime')}</Text>
            </View>
          </View>
        </View>

        {/* Credit costs table */}
        <Text style={S.sectionTitle}>{t('aiCredits.creditCosts')}</Text>
        <View style={S.costCard}>
          {Object.entries(costs).map(([key, cost]) => {
            const cfg = TYPE_ICONS[key] || { icon: 'ellipse', color: '#78716C' };
            const label = key.replace('ai_', '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
            return (
              <View key={key} style={S.costRow}>
                <View style={[S.costIcon, { backgroundColor: cfg.color + '18' }]}>
                  <Ionicons name={cfg.icon} size={12} color={cfg.color} />
                </View>
                <Text style={S.costLabel}>{label}</Text>
                <Text style={[S.costValue, cost === 0 && { color: COLORS.primary }]}>
                  {cost === 0 ? t('aiCredits.free') : `${cost} cr`}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Buy credits (future) */}
        {packs.length > 0 && (
          <>
            <Text style={S.sectionTitle}>{t('aiCredits.buyCredits')}</Text>
            <View style={S.packsRow}>
              {packs.map(pack => (
                <TouchableOpacity key={pack.id} style={S.packCard} activeOpacity={0.8}>
                  <Ionicons name="flash" size={16} color={COLORS.amber} />
                  <Text style={S.packCredits}>{pack.credits}</Text>
                  <Text style={S.packLabel}>{t('aiCredits.credits')}</Text>
                  <View style={S.packPrice}>
                    <Text style={S.packPriceText}>Rs {pack.priceInr}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* Recent transactions */}
        <Text style={S.sectionTitle}>
          {t('aiCredits.recentActivity')}
        </Text>
        {txns.length === 0 ? (
          <View style={S.emptyTxn}>
            <Ionicons name="receipt-outline" size={32} color={COLORS.textDisabled} />
            <Text style={S.emptyTxnText}>
              {t('aiCredits.noActivity')}
            </Text>
          </View>
        ) : (
          <View style={S.txnList}>
            {txns.map(txn => (
              <View key={txn.id} style={S.txnRow}>
                <TypeIcon type={txn.type} />
                <View style={{ flex: 1 }}>
                  <Text style={S.txnDesc} numberOfLines={1}>{txn.description}</Text>
                  <View style={S.txnMetaRow}>
                    {txn.model ? <Text style={S.txnMetaChip}>{txn.model}</Text> : null}
                    {txn.tokens ? <Text style={S.txnMetaChip}>{txn.tokens} tokens</Text> : null}
                    {txn.cost ? <Text style={S.txnMetaChip}>${txn.cost.toFixed(4)}</Text> : null}
                    <Text style={S.txnMetaDate}>
                      {new Date(txn.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>
                <View style={S.txnRight}>
                  <Text style={[S.txnAmount, txn.amount > 0 ? S.txnPositive : S.txnNegative]}>
                    {txn.amount > 0 ? '+' : ''}{txn.amount}
                  </Text>
                  <Text style={S.txnCreditLabel}>{t('aiChat.credits')}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

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
  headerSub: { fontSize: 11, color: COLORS.textLight, marginTop: 1 },

  // Balance card
  balanceCard: {
    backgroundColor: COLORS.surface, borderRadius: 20, padding: 20,
    borderWidth: 1, borderColor: '#FFE082', ...SHADOWS.small,
  },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  balanceLabel: { fontSize: 12, color: COLORS.textMedium, fontWeight: '600' },
  balanceValue: { fontSize: 44, fontWeight: '900', color: COLORS.amber, lineHeight: 48 },
  tierBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5,
  },
  tierText: { fontSize: 12, fontWeight: '800', color: COLORS.amber },

  barWrap: { height: 8, backgroundColor: '#FFF3E0', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  barFill: { height: 8, borderRadius: 4 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  barLabel: { fontSize: 10, color: COLORS.textLight, fontWeight: '600' },

  statsRow: { flexDirection: 'row', marginTop: 16, borderTopWidth: 1, borderTopColor: COLORS.divider, paddingTop: 14 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '900', color: COLORS.textDark },
  statLabel: { fontSize: 10, color: COLORS.textLight, marginTop: 2, fontWeight: '600' },
  statDivider: { width: 1, backgroundColor: COLORS.divider },

  // Section title
  sectionTitle: { fontSize: 11, fontWeight: '900', color: COLORS.textMedium, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 8 },

  // Cost table
  costCard: {
    backgroundColor: COLORS.surface, borderRadius: 16, padding: 4,
    borderWidth: 1, borderColor: COLORS.border,
  },
  costRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: COLORS.divider },
  costIcon: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  costLabel: { flex: 1, fontSize: 13, color: COLORS.textBody, fontWeight: '600' },
  costValue: { fontSize: 13, fontWeight: '800', color: COLORS.amber },

  // Packs
  packsRow: { flexDirection: 'row', gap: 10 },
  packCard: {
    flex: 1, alignItems: 'center', padding: 14, borderRadius: 16,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: '#FFE082', gap: 4,
  },
  packCredits: { fontSize: 22, fontWeight: '900', color: COLORS.textDark },
  packLabel: { fontSize: 10, color: COLORS.textLight, fontWeight: '600' },
  packPrice: {
    marginTop: 6, backgroundColor: COLORS.amber, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  packPriceText: { fontSize: 12, fontWeight: '800', color: COLORS.white },

  // Transactions
  txnList: {
    backgroundColor: COLORS.surface, borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden',
  },
  txnRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.divider,
  },
  txnIcon: { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  txnDesc: { fontSize: 13, fontWeight: '600', color: COLORS.textDark },
  txnMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  txnMetaChip: {
    fontSize: 9, fontWeight: '700', color: COLORS.textMedium,
    backgroundColor: COLORS.surfaceSunken, borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden',
  },
  txnMetaDate: { fontSize: 9, color: COLORS.textLight },
  txnRight: { alignItems: 'flex-end' },
  txnAmount: { fontSize: 15, fontWeight: '900' },
  txnCreditLabel: { fontSize: 8, color: COLORS.textLight, fontWeight: '600' },
  txnPositive: { color: '#16A34A' },
  txnNegative: { color: '#DC2626' },

  emptyTxn: { alignItems: 'center', padding: 32, gap: 8 },
  emptyTxnText: { fontSize: 13, color: COLORS.textLight },
});

/**
 * ReceivedReportsScreen — Seller inbox of crop diagnosis reports
 * shared by farmers via DiagnosisResultScreen → KrushiKendraShareSheet.
 *
 * Uses GET /api/v1/crop-reports/seller/inbox.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOWS, RADIUS } from '../../constants/colors';
import { useLanguage } from '../../context/LanguageContext';
import api, { safeErrorMessage } from '../../services/api';
import { CropIcon } from '../../components/CropIcons';

const RISK_COLOR = {
  HIGH:     COLORS.error,
  MEDIUM:   COLORS.amberDark,
  MODERATE: COLORS.amberDark,
  LOW:      COLORS.primary,
};

function relativeTime(iso, t) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1)    return t('share.justNow', 'Just now');
  if (min < 60)   return t('share.minAgo', { n: min, defaultValue: '{{n}} min ago' });
  const hr = Math.floor(min / 60);
  if (hr < 24)    return t('share.hourAgo', { n: hr, defaultValue: '{{n}} h ago' });
  const day = Math.floor(hr / 24);
  if (day < 7)    return t('share.dayAgo', { n: day, defaultValue: '{{n}} d ago' });
  return new Date(iso).toLocaleDateString();
}

export default function ReceivedReportsScreen({ navigation }) {
  const { t } = useLanguage();
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefresh]  = useState(false);
  const [error, setError]         = useState(null);
  const [filter, setFilter]       = useState('ALL');  // ALL | PENDING | REPLIED

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = filter === 'ALL' ? {} : { status: filter };
      const res = await api.get('/crop-reports/seller/inbox', { params });
      setItems(res.data.data || []);
    } catch (e) {
      setError(safeErrorMessage(e, t('share.loadFailed', 'Could not load reports.')));
    }
  }, [filter, t]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefresh(true);
    await load();
    setRefresh(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={S.center}>
        <ActivityIndicator size="large" color={COLORS.sellerPrimary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={S.safe}>
      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.white} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>{t('inbox.title', 'Received Reports')}</Text>
          <Text style={S.headerSub}>{t('inbox.subtitle', 'Crop diagnosis from nearby farmers')}</Text>
        </View>
      </View>

      {/* Filter tabs */}
      <View style={S.tabs}>
        {[
          { key: 'ALL',     tKey: 'tabAll',     label: 'All' },
          { key: 'PENDING', tKey: 'tabPending', label: 'Pending' },
          { key: 'REPLIED', tKey: 'tabReplied', label: 'Replied' },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[S.tab, filter === tab.key && S.tabActive]}
            onPress={() => setFilter(tab.key)}
            activeOpacity={0.85}
          >
            <Text style={[S.tabTxt, filter === tab.key && S.tabTxtActive]}>
              {t(`inbox.${tab.tKey}`, tab.label)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? (
        <View style={S.empty}>
          <Ionicons name="cloud-offline-outline" size={48} color={COLORS.gray175} />
          <Text style={S.emptyTitle}>{error}</Text>
          <TouchableOpacity style={S.retryBtn} onPress={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
            <Text style={S.retryTxt}>{t('retry', 'Retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View style={S.empty}>
          <CropIcon crop="Wheat" size={56} />
          <Text style={S.emptyTitle}>{t('inbox.emptyTitle', 'No reports yet')}</Text>
          <Text style={S.emptyText}>
            {t('inbox.emptyText', 'When a nearby farmer sends you a crop diagnosis, it will appear here.')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.sellerPrimary} />}
          renderItem={({ item }) => {
            const r = item.report || {};
            const farmer = item.farmer || {};
            const riskCol = RISK_COLOR[r.riskLevel] || COLORS.textMedium;
            const unread = !item.readAt;

            return (
              <TouchableOpacity
                style={[S.card, unread && S.cardUnread]}
                onPress={() => navigation.navigate('ReceivedReportDetail', { shareId: item.id })}
                activeOpacity={0.85}
              >
                <View style={[S.riskBar, { backgroundColor: riskCol }]} />
                <View style={{ flex: 1, padding: 12 }}>
                  <View style={S.rowTop}>
                    <Text style={S.disease} numberOfLines={1}>{r.primaryDisease || t('share.unknownDisease', 'Unknown disease')}</Text>
                    {unread ? <View style={S.unreadDot} /> : null}
                  </View>
                  <Text style={S.crop}>
                    {r.cropType || ''}{r.growthStage ? ` · ${r.growthStage}` : ''}
                  </Text>
                  <View style={S.rowMeta}>
                    <Ionicons name="person-circle-outline" size={14} color={COLORS.textLight} />
                    <Text style={S.farmer} numberOfLines={1}>
                      {farmer.name || `+91 ${farmer.phone}`}{farmer.village ? ` · ${farmer.village}` : ''}
                    </Text>
                  </View>
                  <View style={S.rowFoot}>
                    <View style={[S.riskPill, { backgroundColor: riskCol + '15' }]}>
                      <Text style={[S.riskTxt, { color: riskCol }]}>
                        {r.riskLevel || 'UNKNOWN'} · {Math.round((r.confidenceScore || 0))}%
                      </Text>
                    </View>
                    <Text style={S.time}>{relativeTime(item.createdAt, t)}</Text>
                  </View>
                  {item.status === 'REPLIED' ? (
                    <View style={S.repliedRow}>
                      <Ionicons name="checkmark-done" size={12} color={COLORS.primary} />
                      <Text style={S.repliedTxt}>{t('inbox.replied', 'You replied')}</Text>
                    </View>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.sellerBg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.sellerBg },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 14,
    backgroundColor: COLORS.cta,
  },
  backBtn:     { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white },
  headerSub:   { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 1 },

  tabs:       { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tab:        { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: COLORS.surface },
  tabActive:  { backgroundColor: COLORS.sellerPrimary },
  tabTxt:     { fontSize: 12, fontWeight: '700', color: COLORS.textMedium },
  tabTxtActive: { color: COLORS.white },

  card: {
    flexDirection: 'row', backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    overflow: 'hidden', marginBottom: 10, ...SHADOWS.small,
  },
  cardUnread: { borderWidth: 1.5, borderColor: COLORS.sellerPrimary },
  riskBar:    { width: 4 },
  rowTop:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  disease:    { flex: 1, fontSize: 15, fontWeight: '800', color: COLORS.textDark, marginRight: 8 },
  unreadDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.sellerPrimary },
  crop:       { fontSize: 12, color: COLORS.textMedium, marginBottom: 6 },
  rowMeta:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  farmer:     { flex: 1, fontSize: 12, color: COLORS.textLight },
  rowFoot:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  riskPill:   { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  riskTxt:    { fontSize: 10, fontWeight: '800' },
  time:       { fontSize: 11, color: COLORS.textLight },
  repliedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  repliedTxt: { fontSize: 11, color: COLORS.primary, fontWeight: '700' },

  empty:      { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textDark, textAlign: 'center' },
  emptyText:  { fontSize: 13, color: COLORS.textLight, textAlign: 'center', lineHeight: 20 },
  retryBtn:   { marginTop: 8, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.sellerPrimary + '15' },
  retryTxt:   { color: COLORS.sellerPrimary, fontWeight: '700' },
});

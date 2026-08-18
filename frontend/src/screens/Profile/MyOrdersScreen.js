/**
 * My Orders — the farmer's record of what they bought and what they paid.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * This screen read `order.total`. The column is `totalAmount`, so the expression
 * evaluated to `parseFloat(undefined || 0)` and EVERY order displayed ₹0.00 —
 * on the one screen a farmer opens to check they were charged correctly.
 *
 * The status badges were equally broken: they looked up `orders.statusPending`
 * and friends, none of which exist in translations.js, so the badge rendered the
 * literal key text "orders.statusConfirmed".
 *
 * ── The snapshot rule ───────────────────────────────────────────────────────
 * Item name, image and price come from the ORDER ITEM's own snapshot columns
 * first, and only fall back to the live product join. An order is a record of a
 * past transaction: if the seller renames the product, re-photographs it or
 * delists it, the farmer's receipt must not change underneath them. The live
 * join is the fallback for rows written before those columns existed.
 */
import { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@cropsetu/shared/constants/colors';
import api from '@cropsetu/shared/services/api';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import DashboardStatIcon from '@cropsetu/shared/components/DashboardStatIcons';

/** ₹ with Indian digit grouping (1,20,000 — not 120,000). */
function inr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '₹0';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Every member of the OrderStatus enum is represented. REFUNDED was missing,
// which meant a refunded order showed the raw string "REFUNDED" in grey — the
// one status where the farmer most needs a clear answer.
const STATUS_META = {
  PENDING:   { key: 'orders.statusPending',   color: COLORS.gold,      bg: COLORS.goldPale   },
  CONFIRMED: { key: 'orders.statusConfirmed', color: COLORS.blue,      bg: COLORS.bluePale   },
  SHIPPED:   { key: 'orders.statusShipped',   color: COLORS.violet,    bg: COLORS.violetPale },
  DELIVERED: { key: 'orders.statusDelivered', color: COLORS.emerald,   bg: COLORS.mintPale   },
  CANCELLED: { key: 'orders.statusCancelled', color: COLORS.error,     bg: COLORS.errorLight },
  REFUNDED:  { key: 'orders.statusRefunded',  color: COLORS.textMedium, bg: COLORS.grayBg    },
};

function StatusBadge({ status }) {
  const { t } = useLanguage();
  const meta = STATUS_META[status];
  // An unknown status (a future enum value on an old build) shows the raw code
  // rather than a wrong label — better an unfamiliar word than a false one.
  const label = meta ? t(meta.key) : status;
  return (
    <View style={[styles.badge, { backgroundColor: meta?.bg || COLORS.grayBg }]}>
      <Text style={[styles.badgeTxt, { color: meta?.color || COLORS.textMedium }]}>{label}</Text>
    </View>
  );
}

const OrderCard = memo(function OrderCard({ order }) {
  const { t, language } = useLanguage();
  const [imgFailed, setImgFailed] = useState(false);

  const firstItem = order.items?.[0];
  // Snapshot first, live join second — see the header.
  const itemName =
    (language === 'mr' && firstItem?.productNameMr) ||
    firstItem?.productName ||
    firstItem?.product?.name ||
    t('orders.itemFallback');
  const itemImg = firstItem?.productImage || firstItem?.product?.images?.[0];

  const extraCount = Math.max((order.items?.length || 1) - 1, 0);

  // `totalAmount` is THE PAYABLE (goods + delivery + tax − discount) since the
  // Shop hardening pass. `total` is kept as a fallback only so an older cached
  // response cannot blank the figure out.
  const payable = Number(order.totalAmount ?? order.total ?? 0);
  const delivery = Number(order.deliveryFee ?? 0);
  const tax = Number(order.taxAmount ?? 0);
  const showBreakdown = delivery > 0 || tax > 0;

  const date = order.createdAt
    ? new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.orderId} numberOfLines={1}>#{order.id?.slice(-8)?.toUpperCase()}</Text>
        <StatusBadge status={order.status} />
      </View>

      <View style={styles.itemRow}>
        {itemImg && !imgFailed ? (
          <Image source={{ uri: itemImg }} style={styles.thumb} onError={() => setImgFailed(true)} />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="cube-outline" size={22} color={COLORS.textMedium} />
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.productName} numberOfLines={2}>{itemName}</Text>
          {extraCount > 0 ? (
            <Text style={styles.moreItems}>
              {extraCount > 1
                ? t('orders.moreItemsPlural', { count: extraCount })
                : t('orders.moreItem', { count: extraCount })}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Shown only when the farmer actually paid these — a ₹0 delivery line is
          noise, and printing "Tax ₹0" invites the question of why. */}
      {showBreakdown ? (
        <View style={styles.breakdown}>
          {delivery > 0 ? (
            <View style={styles.breakRow}>
              <Text style={styles.breakLabel}>{t('orders.deliveryFee')}</Text>
              <Text style={styles.breakVal}>{inr(delivery)}</Text>
            </View>
          ) : null}
          {tax > 0 ? (
            <View style={styles.breakRow}>
              <Text style={styles.breakLabel}>{t('orders.tax')}</Text>
              <Text style={styles.breakVal}>{inr(tax)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.cardFooter}>
        <View style={styles.footerLeft}>
          <Ionicons name="calendar-outline" size={13} color={COLORS.textMedium} />
          <Text style={styles.footerTxt}>{date}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.totalLabel}>{t('orders.paid')}</Text>
          <Text style={styles.total}>{inr(payable)}</Text>
        </View>
      </View>
    </View>
  );
});

export default function MyOrdersScreen({ navigation }) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  const [orders,      setOrders]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [cursor,      setCursor]      = useState(null);
  const [hasMore,     setHasMore]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,       setError]       = useState(null);

  // One request in flight at a time. Without this, FlatList fires onEndReached
  // repeatedly during a fast flick and the same page is appended several times —
  // duplicate rows and duplicate React keys.
  const inFlight = useRef(false);
  const alive    = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  /**
   * Keyset (cursor) pagination. The first page opts in with `paginate=cursor`;
   * each later page passes the server-issued `nextCursor`, so page 40 costs the
   * same as page 1.
   */
  const fetchOrders = useCallback(async (cur = null, { refresh = false } = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (!cur) setError(null);
      const qs = cur
        ? `cursor=${encodeURIComponent(cur)}&limit=10`
        : 'paginate=cursor&limit=10';
      const { data } = await api.get(`/agristore/orders?${qs}`);
      if (!alive.current) return;

      const items = Array.isArray(data?.data) ? data.data : [];
      const meta  = data?.meta || {};
      setOrders((prev) => (refresh || !cur ? items : [...prev, ...items]));
      setHasMore(Boolean(meta.nextCursor));
      setCursor(meta.nextCursor || null);
    } catch (e) {
      if (!alive.current) return;
      // Only a first-page failure blanks the screen. A failed "load more" leaves
      // the orders already on screen alone — the farmer keeps what they had.
      if (!cur) setError(e?.response?.data?.error?.message || t('orders.loadFailed'));
    } finally {
      inFlight.current = false;
      if (alive.current) { setLoading(false); setRefreshing(false); setLoadingMore(false); }
    }
  }, [t]);

  useEffect(() => { fetchOrders(null); }, [fetchOrders]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchOrders(null, { refresh: true });
  }, [fetchOrders]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore || !cursor || inFlight.current) return;
    setLoadingMore(true);
    fetchOrders(cursor);
  }, [hasMore, loading, loadingMore, cursor, fetchOrders]);

  // Retry the FIRST page. This previously called fetchOrders(1), passing a page
  // number where a cursor was expected — so the retry button never worked.
  const handleRetry = useCallback(() => {
    setLoading(true);
    fetchOrders(null, { refresh: true });
  }, [fetchOrders]);

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      {/* The status-bar inset is measured, not assumed. The old `Platform.OS ===
          'android' ? 44 : 12` was wrong on every punch-hole and notched device. */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('profile.back', { defaultValue: 'Back' })}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('myOrders')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading && orders.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.error} />
          <Text style={styles.errorTxt}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleRetry} accessibilityRole="button">
            <Text style={styles.retryTxt}>{t('profile.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <OrderCard order={item} />}
          contentContainerStyle={
            orders.length ? { padding: 16, paddingBottom: 32 } : { flexGrow: 1 }
          }
          windowSize={5}
          maxToRenderPerBatch={10}
          initialNumToRender={6}
          removeClippedSubviews
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[COLORS.primary]} />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          // Only while a page is genuinely in flight. The old condition was
          // `hasMore`, so a spinner sat at the bottom of an idle list forever.
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 16 }} /> : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <DashboardStatIcon type="orders" size={72} />
              <Text style={styles.emptyTitle}>{t('profile.noOrdersYet')}</Text>
              <Text style={styles.emptySubtitle}>{t('profile.ordersAppearHere')}</Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface, paddingHorizontal: 12, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn:     { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: COLORS.textDark },

  card: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 14,
    shadowColor: COLORS.black, shadowOpacity: 0.05,
    shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  orderId:     { fontSize: 13, fontWeight: '700', color: COLORS.textMedium, flex: 1 },
  badge:       { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  badgeTxt:    { fontSize: 12, fontWeight: '700' },

  itemRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  thumb:    { width: 56, height: 56, borderRadius: 10, backgroundColor: COLORS.grayBg },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  productName: { fontSize: 14, fontWeight: '600', color: COLORS.textDark, lineHeight: 20 },
  moreItems:   { fontSize: 12, color: COLORS.textMedium, marginTop: 4 },

  breakdown:  { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 8, marginBottom: 4, gap: 3 },
  breakRow:   { flexDirection: 'row', justifyContent: 'space-between' },
  breakLabel: { fontSize: 12, color: COLORS.textMedium },
  breakVal:   { fontSize: 12, color: COLORS.textMedium, fontWeight: '600' },

  cardFooter: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10,
  },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerTxt:  { fontSize: 12, color: COLORS.textMedium },
  totalLabel: { fontSize: 11, color: COLORS.textMedium, marginBottom: 1 },
  total:      { fontSize: 16, fontWeight: '800', color: COLORS.textDark },

  errorTxt:  { fontSize: 15, color: COLORS.error, textAlign: 'center' },
  retryBtn:  { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10, marginTop: 8 },
  retryTxt:  { color: COLORS.white, fontWeight: '700', fontSize: 15 },

  emptyTitle:    { fontSize: 18, fontWeight: '700', color: COLORS.gray700dark, marginTop: 12 },
  emptySubtitle: { fontSize: 14, color: COLORS.textMedium, textAlign: 'center', marginTop: 4 },
});

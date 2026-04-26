/**
 * MyOrdersScreen — shows buyer's AgriStore orders
 */
import { COLORS } from '../../constants/colors';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';

const STATUS_META = {
  PENDING:    { label: 'Pending',    color: COLORS.gold, bg: COLORS.goldPale },
  CONFIRMED:  { label: 'Confirmed',  color: COLORS.blue, bg: COLORS.bluePale },
  SHIPPED:    { label: 'Shipped',    color: COLORS.violet, bg: COLORS.violetPale },
  DELIVERED:  { label: 'Delivered',  color: COLORS.emerald, bg: COLORS.mintPale },
  CANCELLED:  { label: 'Cancelled',  color: COLORS.error, bg: COLORS.errorLight },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, color: COLORS.textMedium, bg: COLORS.grayBg };
  return (
    <View style={[styles.badge, { backgroundColor: meta.bg }]}>
      <Text style={[styles.badgeTxt, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

function OrderCard({ order }) {
  const firstItem  = order.items?.[0];
  const productImg = firstItem?.product?.images?.[0];
  const extraCount = (order.items?.length || 1) - 1;
  const total      = typeof order.total === 'number' ? order.total : parseFloat(order.total || 0);
  const date       = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.orderId} numberOfLines={1}>#{order.id?.slice(-8)?.toUpperCase()}</Text>
        <StatusBadge status={order.status} />
      </View>

      <View style={styles.itemRow}>
        {productImg ? (
          <Image source={{ uri: productImg }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="cube-outline" size={22} color={COLORS.textMedium} />
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.productName} numberOfLines={2}>
            {firstItem?.product?.name || 'Product'}
          </Text>
          {extraCount > 0 && (
            <Text style={styles.moreItems}>+{extraCount} more item{extraCount > 1 ? 's' : ''}</Text>
          )}
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.footerLeft}>
          <Ionicons name="calendar-outline" size={13} color={COLORS.textMedium} />
          <Text style={styles.footerTxt}>{date}</Text>
        </View>
        <Text style={styles.total}>₹{total.toFixed(2)}</Text>
      </View>
    </View>
  );
}

export default function MyOrdersScreen({ navigation }) {
  const { t } = useLanguage();
  const [orders,    setOrders]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page,      setPage]      = useState(1);
  const [hasMore,   setHasMore]   = useState(true);
  const [error,     setError]     = useState(null);

  const fetchOrders = useCallback(async (p = 1, refresh = false) => {
    try {
      if (p === 1) setError(null);
      const { data } = await api.get(`/agristore/orders?page=${p}&limit=10`);
      const items = data.data || [];
      const meta  = data.meta || {};
      setOrders((prev) => refresh || p === 1 ? items : [...prev, ...items]);
      setHasMore(p < (meta.totalPages || 1));
      setPage(p);
    } catch (e) {
      setError(e?.response?.data?.error?.message || 'Failed to load orders');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchOrders(1); }, [fetchOrders]);

  const handleRefresh = () => { setRefreshing(true); fetchOrders(1, true); };
  const handleLoadMore = () => { if (hasMore && !loading) fetchOrders(page + 1); };

  if (loading && orders.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Orders</Text>
        <View style={{ width: 40 }} />
      </View>

      {error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.error} />
          <Text style={styles.errorTxt}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchOrders(1)}>
            <Text style={styles.retryTxt}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={10}
          removeClippedSubviews
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          renderItem={({ item }) => <OrderCard order={item} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[COLORS.primary]} />}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={hasMore ? <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 16 }} /> : null}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="cart-outline" size={64} color={COLORS.gray175} />
              <Text style={styles.emptyTitle}>No orders yet</Text>
              <Text style={styles.emptySubtitle}>Your AgriStore orders will appear here</Text>
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
    backgroundColor: COLORS.surface, paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    paddingTop: Platform.OS === 'android' ? 44 : 12,
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

  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10 },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerTxt:  { fontSize: 12, color: COLORS.textMedium },
  total:      { fontSize: 16, fontWeight: '800', color: COLORS.textDark },

  errorTxt:  { fontSize: 15, color: COLORS.error, textAlign: 'center' },
  retryBtn:  { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10, marginTop: 8 },
  retryTxt:  { color: COLORS.white, fontWeight: '700', fontSize: 15 },

  emptyTitle:    { fontSize: 18, fontWeight: '700', color: COLORS.gray700dark, marginTop: 12 },
  emptySubtitle: { fontSize: 14, color: COLORS.textMedium, textAlign: 'center', marginTop: 4 },
});

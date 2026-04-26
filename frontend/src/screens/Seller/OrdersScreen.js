import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, SafeAreaView, Alert,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '../../utils/haptics';
import { COLORS, SHADOWS, RADIUS } from '../../constants/colors';
import { useLanguage } from '../../context/LanguageContext';
import api from '../../services/api';

const STATUS_FLOW = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED'];
const STATUS_COLOR = {
  PENDING:   COLORS.sellerPending,
  CONFIRMED: COLORS.sellerConfirmed,
  SHIPPED:   COLORS.sellerShipped,
  DELIVERED: COLORS.sellerDelivered,
  CANCELLED: COLORS.error,
  REFUNDED:  COLORS.gray550,
};
const STATUS_ICON = {
  PENDING:   'time-outline',
  CONFIRMED: 'checkmark-circle-outline',
  SHIPPED:   'car-outline',
  DELIVERED: 'bag-check-outline',
  CANCELLED: 'close-circle-outline',
  REFUNDED:  'return-up-back-outline',
};
const STATUS_LABELS = ['All', 'PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] || COLORS.gray550;
  return (
    <View style={[ob.badge, { backgroundColor: color + '18' }]}>
      <Ionicons name={STATUS_ICON[status] || 'ellipse-outline'} size={12} color={color} />
      <Text style={[ob.badgeTxt, { color }]}>{status}</Text>
    </View>
  );
}

function OrderCard({ item, onUpdateStatus, index = 0 }) {
  const { t } = useLanguage();
  const status = item.order?.status;
  const canAdvance = STATUS_FLOW.includes(status) &&
    STATUS_FLOW.indexOf(status) < STATUS_FLOW.length - 1 &&
    status !== 'DELIVERED' && status !== 'CANCELLED';
  const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(status) + 1];

  const translateX = useRef(new Animated.Value(60)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateX, { toValue: 0, tension: 70, friction: 9, delay: index * 70, useNativeDriver: true }),
      Animated.timing(opacity,    { toValue: 1, duration: 380, delay: index * 70, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[ob.card, { transform: [{ translateX }], opacity }]}>
      {/* Top row */}
      <View style={ob.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={ob.productName} numberOfLines={2}>{item.product?.name}</Text>
          <Text style={ob.buyer}>
            {item.order?.user?.name || 'Farmer'} · {item.order?.user?.phone}
          </Text>
        </View>
        <StatusBadge status={status} />
      </View>

      {/* Details row */}
      <View style={ob.detailRow}>
        <View style={ob.detailItem}>
          <Text style={ob.detailLabel}>{t('orders.qty')}</Text>
          <Text style={ob.detailVal}>{item.quantity} {item.product?.unit}</Text>
        </View>
        <View style={ob.detailDivider} />
        <View style={ob.detailItem}>
          <Text style={ob.detailLabel}>{t('orders.amount')}</Text>
          <Text style={[ob.detailVal, { color: COLORS.sellerAccent }]}>
            ₹{item.totalPrice?.toLocaleString('en-IN')}
          </Text>
        </View>
        <View style={ob.detailDivider} />
        <View style={ob.detailItem}>
          <Text style={ob.detailLabel}>{t('orders.payment')}</Text>
          <Text style={ob.detailVal}>{item.order?.paymentMethod?.toUpperCase()}</Text>
        </View>
      </View>

      {/* Delivery address */}
      {item.order?.deliveryAddress && (
        <View style={ob.addrRow}>
          <Ionicons name="location-outline" size={14} color={COLORS.gray550} />
          <Text style={ob.addrTxt} numberOfLines={2}>
            {[
              item.order.deliveryAddress.name,
              item.order.deliveryAddress.addressLine,
              item.order.deliveryAddress.city,
              item.order.deliveryAddress.pincode,
            ].filter(Boolean).join(', ')}
          </Text>
        </View>
      )}

      {/* Update status button */}
      {canAdvance && (
        <TouchableOpacity
          style={ob.advanceBtn}
          onPress={() => onUpdateStatus(item, nextStatus)}
          activeOpacity={0.8}
        >
          <Ionicons name="arrow-forward-circle-outline" size={18} color={COLORS.sellerPrimary} />
          <Text style={ob.advanceTxt}>{t('orders.markAs', { status: nextStatus })}</Text>
        </TouchableOpacity>
      )}

      {/* Cancel button only for PENDING */}
      {status === 'PENDING' && (
        <TouchableOpacity
          style={[ob.advanceBtn, { borderColor: COLORS.error + '50', marginTop: 4 }]}
          onPress={() => onUpdateStatus(item, 'CANCELLED')}
          activeOpacity={0.8}
        >
          <Ionicons name="close-circle-outline" size={18} color={COLORS.error} />
          <Text style={[ob.advanceTxt, { color: COLORS.error }]}>{t('orders.cancelOrder')}</Text>
        </TouchableOpacity>
      )}

      {/* Order date */}
      <Text style={ob.date}>
        {new Date(item.order?.createdAt || Date.now()).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric',
        })}
      </Text>
    </Animated.View>
  );
}

export default function OrdersScreen() {
  const { t } = useLanguage();
  const [orders,      setOrders]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [filter,      setFilter]      = useState('All');
  const [page,        setPage]        = useState(1);
  const [hasMore,     setHasMore]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (pageNum = 1, replace = true) => {
    try {
      const statusQ = filter !== 'All' ? `&status=${filter}` : '';
      const { data } = await api.get(`/agristore/seller/orders?page=${pageNum}&limit=20${statusQ}`);
      const list = data.data || [];
      if (replace) {
        setOrders(list);
      } else {
        setOrders((prev) => [...prev, ...list]);
      }
      setHasMore(list.length === 20);
      setPage(pageNum);
    } catch (e) {
      console.warn('Orders load:', e.message);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    load(1, true).finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(1, true);
    setRefreshing(false);
  };

  const onLoadMore = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    await load(page + 1, false);
    setLoadingMore(false);
  };

  const handleUpdateStatus = (item, newStatus) => {
    const orderId = item.order?.id;
    Alert.alert(
      t('orders.markAs', { status: newStatus }),
      t('orders.markAsMsg', { status: newStatus }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('orders.confirm'),
          onPress: async () => {
            Haptics.success();
            try {
              await api.put(`/agristore/seller/orders/${orderId}/status`, { status: newStatus });
              setOrders((prev) =>
                prev.map((o) =>
                  o.order?.id === orderId
                    ? { ...o, order: { ...o.order, status: newStatus } }
                    : o
                )
              );
            } catch (e) {
              Alert.alert(t('error'), e.response?.data?.error?.message || t('orders.updateStatusError'));
            }
          },
        },
      ]
    );
  };

  const filtered = filter === 'All' ? orders : orders.filter((o) => o.order?.status === filter);

  return (
    <SafeAreaView style={s.safe}>
      {/* Filter chips */}
      <View style={s.filterWrap}>
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={10}
          removeClippedSubviews
          data={STATUS_LABELS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(f) => f}
          contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[s.chip, filter === item && s.chipActive]}
              onPress={() => setFilter(item)}
            >
              <Text style={[s.chipTxt, filter === item && s.chipTxtActive]}>{item}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={COLORS.sellerPrimary} />
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={10}
          removeClippedSubviews
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <OrderCard item={item} index={index} onUpdateStatus={handleUpdateStatus} />
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.sellerPrimary} />
          }
          contentContainerStyle={{ padding: 12, paddingBottom: 40, flexGrow: 1 }}
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore
              ? <ActivityIndicator color={COLORS.sellerPrimary} style={{ marginVertical: 16 }} />
              : null
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="receipt-outline" size={64} color={COLORS.gray175} />
              <Text style={s.emptyTitle}>{t('orders.noOrdersFound')}</Text>
              <Text style={s.emptyText}>
                {filter === 'All'
                  ? t('orders.noOrdersAll')
                  : t('orders.noOrdersFilter', { status: filter })}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.sellerBg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  filterWrap: { paddingVertical: 10, backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.grayBg },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: RADIUS.sm, backgroundColor: COLORS.grayBg, borderWidth: 1, borderColor: 'transparent' },
  chipActive: { backgroundColor: COLORS.sellerPrimary + '14', borderColor: COLORS.sellerPrimary },
  chipTxt:       { fontSize: 13, color: COLORS.textMedium, fontWeight: '600' },
  chipTxtActive: { color: COLORS.sellerPrimary, fontWeight: '800' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textMedium },
  emptyText:  { fontSize: 14, color: COLORS.textLight, textAlign: 'center' },
});

const ob = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    padding: 14, marginBottom: 12, ...SHADOWS.small,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, gap: 8 },
  productName: { fontSize: 15, fontWeight: '700', color: COLORS.textDark, marginBottom: 4 },
  buyer: { fontSize: 12, color: COLORS.textMedium },

  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 4 },
  badgeTxt: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },

  detailRow: { flexDirection: 'row', backgroundColor: COLORS.grayPaper, borderRadius: RADIUS.md, paddingVertical: 10, marginBottom: 10 },
  detailItem: { flex: 1, alignItems: 'center' },
  detailLabel: { fontSize: 11, color: COLORS.textMedium, marginBottom: 3 },
  detailVal:   { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  detailDivider: { width: 1, backgroundColor: COLORS.grayBorder },

  addrRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 10 },
  addrTxt: { flex: 1, fontSize: 12, color: COLORS.textMedium, lineHeight: 18 },

  advanceBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 10, borderRadius: RADIUS.md, borderWidth: 1.5,
    borderColor: COLORS.sellerPrimary + '50', marginBottom: 4,
  },
  advanceTxt: { fontSize: 14, fontWeight: '700', color: COLORS.sellerPrimary },

  date: { fontSize: 11, color: COLORS.textLight, textAlign: 'right', marginTop: 4 },
});

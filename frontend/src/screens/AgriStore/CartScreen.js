/**
 * CartScreen — Redesigned to match KisanMart reference UI
 * Staggered entrance, pill qty selector, animated progress bar, bottom action bar
 */
import { COLORS } from '../../constants/colors';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, Animated, Alert, Easing, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '../../utils/haptics';
import { LinearGradient } from 'expo-linear-gradient';
import api from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const W = Dimensions.get('window').width;

const GREEN_BG = 'rgba(23,107,67,0.08)';

// ── Shimmer box ───────────────────────────────────────────────────────────────
function ShimmerBox({ style }) {
  const s = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(s, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true })).start();
  }, []);
  const tx = s.interpolate({ inputRange: [0, 1], outputRange: [-200, 200] });
  return (
    <View style={[{ backgroundColor: COLORS.coolGray, overflow: 'hidden', borderRadius: 8 }, style]}>
      <Animated.View style={{ ...StyleSheet.absoluteFillObject, transform: [{ translateX: tx }] }}>
        <LinearGradient colors={['transparent', 'rgba(255,255,255,0.6)', 'transparent']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: 100, height: '100%' }} />
      </Animated.View>
    </View>
  );
}

function CartItemSkeleton() {
  return (
    <View style={S.itemCard}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <ShimmerBox style={{ width: 80, height: 80, borderRadius: 12 }} />
        <View style={{ flex: 1, gap: 8 }}>
          <ShimmerBox style={{ width: 60, height: 9 }} />
          <ShimmerBox style={{ width: '80%', height: 13 }} />
          <ShimmerBox style={{ width: 70, height: 11 }} />
        </View>
      </View>
      <View style={[S.itemCardFooter, { marginTop: 14 }]}>
        <ShimmerBox style={{ width: 120, height: 36, borderRadius: 20 }} />
        <ShimmerBox style={{ width: 60, height: 20 }} />
      </View>
    </View>
  );
}

// ── Press scale wrapper ───────────────────────────────────────────────────────
function PressScale({ onPress, style, down = 0.88, children }) {
  const sc = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[style, { transform: [{ scale: sc }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(sc, { toValue: down, useNativeDriver: true, friction: 8, tension: 150 }).start()}
        onPressOut={() => Animated.spring(sc, { toValue: 1, useNativeDriver: true, friction: 5, tension: 80 }).start()}
        activeOpacity={1}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Empty cart ────────────────────────────────────────────────────────────────
function EmptyCart({ navigation }) {
  const { t } = useLanguage();
  const fadeY = useRef(new Animated.Value(30)).current;
  const op    = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(op, { toValue: 1, duration: 380, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.spring(fadeY, { toValue: 0, friction: 7, tension: 50, useNativeDriver: true }),
    ]).start();
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.14, duration: 960, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 960, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])).start();
  }, []);

  return (
    <SafeAreaView style={S.container}>
      <Animated.View style={[S.emptyWrap, { opacity: op, transform: [{ translateY: fadeY }] }]}>
        <Animated.View style={[S.emptyIconWrap, { transform: [{ scale: pulse }] }]}>
          <Ionicons name="bag-outline" size={56} color={COLORS.primary} />
        </Animated.View>
        <Text style={S.emptyTitle}>{t('cart.emptyTitle')}</Text>
        <Text style={S.emptySub}>{t('cart.emptySub')}</Text>
        <PressScale onPress={() => navigation.goBack()} down={0.96} style={S.shopBtnWrap}>
          <LinearGradient colors={[COLORS.greenSoft, COLORS.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={S.shopBtnGrad}>
            <Ionicons name="storefront-outline" size={18} color={COLORS.white} />
            <Text style={S.shopBtnTxt}>{t('cart.browseProducts')}</Text>
          </LinearGradient>
        </PressScale>
      </Animated.View>
    </SafeAreaView>
  );
}

// ── Cart Item ─────────────────────────────────────────────────────────────────
function CartItem({ item, onQtyChange, onRemove, index, t }) {
  const op    = useRef(new Animated.Value(0)).current;
  const y     = useRef(new Animated.Value(20)).current;
  const slideX = useRef(new Animated.Value(0)).current;
  const qtyAnim = useRef(new Animated.Value(1)).current;
  const prevQty = useRef(item.quantity);
  const removing = useRef(false);

  const product  = item.product;
  const subtotal = product.price * item.quantity;
  const imageUrl = product.images?.[0];

  useEffect(() => {
    Animated.parallel([
      Animated.timing(op, { toValue: 1, duration: 260, delay: index * 80, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.spring(y, { toValue: 0, friction: 7, tension: 55, delay: index * 80, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    if (item.quantity !== prevQty.current) {
      prevQty.current = item.quantity;
      Animated.sequence([
        Animated.spring(qtyAnim, { toValue: 1.4, useNativeDriver: true, friction: 8, tension: 220 }),
        Animated.spring(qtyAnim, { toValue: 1, useNativeDriver: true, friction: 5, tension: 80 }),
      ]).start();
    }
  }, [item.quantity]);

  function slideRemove(cb) {
    if (removing.current) return;
    removing.current = true;
    Animated.timing(slideX, { toValue: -(W + 20), duration: 260, easing: Easing.in(Easing.ease), useNativeDriver: true }).start(cb);
  }

  function confirmRemove() {
    Alert.alert(t('cart.removeItem'), `Remove "${product.name}" from your cart?`, [
      { text: 'Cancel', style: 'cancel', onPress: () => { removing.current = false; } },
      { text: 'Remove', style: 'destructive', onPress: () => slideRemove(() => onRemove(product.id)) },
    ]);
  }

  return (
    <Animated.View style={{ opacity: op, transform: [{ translateY: y }] }}>
      <Animated.View style={{ transform: [{ translateX: slideX }] }}>
        <View style={S.itemCard}>
          {/* Top row */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {/* Image */}
            <View style={S.itemImgBox}>
              {imageUrl
                ? <Image source={{ uri: imageUrl }} style={S.itemImg} resizeMode="cover" />
                : <Ionicons name="leaf" size={28} color={COLORS.primary} />
              }
            </View>

            {/* Info */}
            <View style={{ flex: 1 }}>
              <Text style={S.itemCat}>{product.category?.name}</Text>
              <Text style={S.itemName} numberOfLines={2}>{product.name}</Text>
              <Text style={S.itemPrice}>
                ₹{product.price.toLocaleString()}
                <Text style={S.itemUnit}> / {product.unit}</Text>
              </Text>
            </View>

            {/* Trash */}
            <PressScale onPress={confirmRemove} down={0.8}>
              <View style={S.trashBtn}>
                <Ionicons name="trash-outline" size={18} color={COLORS.error} />
              </View>
            </PressScale>
          </View>

          {/* Bottom row — qty pill + subtotal */}
          <View style={S.itemCardFooter}>
            {/* Pill qty selector */}
            <View style={S.qtyPill}>
              <PressScale onPress={() => onQtyChange(product.id, item.quantity - 1)} down={0.8}>
                <View style={S.qPillBtn}>
                  <Ionicons name="remove" size={15} color={COLORS.charcoal} />
                </View>
              </PressScale>
              <Animated.Text style={[S.qNum, { transform: [{ scale: qtyAnim }] }]}>
                {item.quantity}
              </Animated.Text>
              <PressScale onPress={() => onQtyChange(product.id, item.quantity + 1)} down={0.8}>
                <View style={S.qPillBtn}>
                  <Ionicons name="add" size={15} color={COLORS.charcoal} />
                </View>
              </PressScale>
            </View>

            <Text style={S.itemSubtotal}>₹{subtotal.toLocaleString()}</Text>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

// ── Animated delivery progress bar ───────────────────────────────────────────
function DeliveryProgress({ current, threshold }) {
  const progress = Math.min(current / threshold, 1);
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(widthAnim, { toValue: progress, duration: 600, easing: Easing.out(Easing.ease), useNativeDriver: false }).start();
  }, [progress]);

  const fillPct = widthAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={S.progressWrap}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Ionicons name="car-outline" size={15} color={COLORS.primary} />
        <Text style={S.progressTxt}>
          Add <Text style={{ color: COLORS.primary, fontWeight: '700' }}>₹{(threshold - current).toLocaleString()}</Text> more for free delivery!
        </Text>
      </View>
      <View style={S.progressTrack}>
        <Animated.View style={[S.progressFill, { width: fillPct }]} />
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function CartScreen({ navigation }) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  const [items,      setItems]      = useState([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const FREE_THRESHOLD = 999;
  const delivery   = total >= FREE_THRESHOLD ? 0 : 49;
  const grandTotal = total + delivery;

  const fetchCart = useCallback(async () => {
    try {
      const { data } = await api.get('/agristore/cart');
      setItems(data.data.items || []);
      setTotal(data.data.total || 0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchCart(); }, []);

  const handleRefresh = useCallback(() => { setRefreshing(true); fetchCart(); }, [fetchCart]);

  async function handleQtyChange(productId, newQty) {
    if (newQty < 1) { handleRemove(productId); return; }
    const item = items.find(i => i.product.id === productId);
    if (!item) return;
    setItems(prev => prev.map(i => i.product.id === productId ? { ...i, quantity: newQty } : i));
    setTotal(prev => prev - item.product.price * item.quantity + item.product.price * newQty);
    try { await api.put(`/agristore/cart/${productId}`, { quantity: newQty }); }
    catch { fetchCart(); }
  }

  async function handleRemove(productId) {
    const removed = items.find(i => i.product.id === productId);
    setItems(prev => prev.filter(i => i.product.id !== productId));
    if (removed) setTotal(prev => prev - removed.product.price * removed.quantity);
    try { await api.delete(`/agristore/cart/${productId}`); }
    catch { fetchCart(); }
  }

  function handleCheckout() {
    navigation.navigate('Checkout', { total, delivery, grandTotal, itemCount: items.length });
  }

  if (loading) {
    return (
      <SafeAreaView style={S.container}>
        {/* Header */}
        <View style={S.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={S.headerBack}>
            <Ionicons name="arrow-back" size={22} color={COLORS.charcoal} />
          </TouchableOpacity>
          <View>
            <Text style={S.headerTitle}>{t('cart.myCart')}</Text>
            <Text style={S.headerSub}>{t('loading')}</Text>
          </View>
        </View>
        <View style={{ padding: 14, gap: 12 }}>
          {[0, 1, 2].map(i => <CartItemSkeleton key={i} />)}
        </View>
      </SafeAreaView>
    );
  }

  if (!loading && items.length === 0) return <EmptyCart navigation={navigation} />;

  const totalQty = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <AnimatedScreen>
    <SafeAreaView style={S.container} edges={['top', 'left', 'right']}>
      {/* ── Header ── */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.headerBack}>
          <Ionicons name="arrow-back" size={22} color={COLORS.charcoal} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>My Cart</Text>
          <Text style={S.headerSub}>{items.length} item{items.length !== 1 ? 's' : ''}</Text>
        </View>
        {items.length > 0 && (
          <View style={S.headerBadge}>
            <Text style={S.headerBadgeTxt}>{items.length}</Text>
          </View>
        )}
      </View>

      {/* ── List ── */}
      <FlatList
        windowSize={5}
        maxToRenderPerBatch={10}
        removeClippedSubviews
        data={items}
        keyExtractor={i => i.id}
        contentContainerStyle={S.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
        renderItem={({ item, index }) => (
          <CartItem item={item} onQtyChange={handleQtyChange} onRemove={handleRemove} index={index} t={t} />
        )}
        ListFooterComponent={(
          <View style={S.summaryCard}>
            <Text style={S.summaryTitle}>{t('cart.orderSummary')}</Text>

            <View style={S.summaryRow}>
              <Text style={S.summaryLabel}>Subtotal ({totalQty} item{totalQty !== 1 ? 's' : ''})</Text>
              <Text style={S.summaryValue}>₹{total.toLocaleString()}</Text>
            </View>

            <View style={S.summaryRow}>
              <Text style={S.summaryLabel}>{t('cart.delivery')}</Text>
              <Text style={[S.summaryValue, delivery === 0 && { color: COLORS.primary, fontWeight: '700' }]}>
                {delivery === 0 ? t('free') : `₹${delivery}`}
              </Text>
            </View>

            {/* Free delivery progress bar */}
            {delivery > 0 && (
              <DeliveryProgress current={total} threshold={FREE_THRESHOLD} />
            )}

            <View style={S.summaryDivider} />

            <View style={S.summaryRow}>
              <Text style={S.totalLabel}>{t('cart.totalPayable')}</Text>
              <Text style={S.totalValue}>₹{grandTotal.toLocaleString()}</Text>
            </View>

            {delivery === 0 && (
              <View style={S.savingsBadge}>
                <Ionicons name="checkmark-circle" size={14} color={COLORS.primary} />
                <Text style={S.savingsTxt}>You saved ₹49 on delivery!</Text>
              </View>
            )}
          </View>
        )}
      />

      {/* ── Bottom action bar ── */}
      <View style={[S.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View>
          <Text style={S.barTotal}>₹{grandTotal.toLocaleString()}</Text>
          <Text style={S.barSub}>
            {totalQty} item{totalQty !== 1 ? 's' : ''} · {delivery === 0 ? 'Free delivery' : `+₹${delivery} delivery`}
          </Text>
        </View>
        <PressScale onPress={handleCheckout} down={0.96} style={S.checkoutBtn}>
          <View style={S.checkoutGrad}>
            <Text style={S.checkoutTxt}>{t('cart.proceedCheckout')}</Text>
            <Ionicons name="arrow-forward" size={17} color={COLORS.white} />
          </View>
        </PressScale>
      </View>
    </SafeAreaView>
    </AnimatedScreen>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  headerBack:    { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' },
  headerTitle:   { fontSize: 16, fontWeight: '800', color: COLORS.textDark },
  headerSub:     { fontSize: 12, color: COLORS.textMedium, marginTop: 1 },
  headerBadge:   { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
  headerBadgeTxt:{ color: COLORS.white, fontSize: 13, fontWeight: '800' },

  listContent: { padding: 14, paddingBottom: 10 },

  // Cart item card
  itemCard: {
    backgroundColor: COLORS.surface, borderRadius: 20,
    padding: 14, borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  itemImgBox: { width: 80, height: 80, borderRadius: 12, backgroundColor: COLORS.background, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  itemImg:    { width: '100%', height: '100%' },
  itemCat:    { fontSize: 10, color: COLORS.primary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  itemName:   { fontSize: 14, fontWeight: '700', color: COLORS.textDark, marginTop: 2, lineHeight: 19 },
  itemPrice:  { fontSize: 14, fontWeight: '800', color: COLORS.primary, marginTop: 4 },
  itemUnit:   { fontSize: 12, fontWeight: '400', color: COLORS.textMedium },
  trashBtn:   { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.errorLight, justifyContent: 'center', alignItems: 'center' },

  itemCardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: COLORS.border },

  // Pill quantity selector
  qtyPill:    { flexDirection: 'row', alignItems: 'center', gap: 0, backgroundColor: COLORS.paperGray, borderRadius: 50, padding: 4 },
  qPillBtn:   { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center', shadowColor: COLORS.black, shadowOpacity: 0.08, shadowRadius: 3, elevation: 1 },
  qNum:       { fontSize: 15, fontWeight: '800', color: COLORS.textDark, minWidth: 32, textAlign: 'center' },
  itemSubtotal: { fontSize: 17, fontWeight: '800', color: COLORS.textDark },

  // Order summary
  summaryCard: {
    backgroundColor: COLORS.surface, borderRadius: 20, padding: 18,
    marginTop: 12, borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  summaryTitle: { fontSize: 15, fontWeight: '800', color: COLORS.textDark, marginBottom: 16 },
  summaryRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  summaryLabel: { fontSize: 14, color: COLORS.textMedium },
  summaryValue: { fontSize: 14, fontWeight: '600', color: COLORS.textDark },
  summaryDivider:{ borderTopWidth: 1, borderTopColor: COLORS.border, marginVertical: 10 },
  totalLabel:   { fontSize: 15, fontWeight: '800', color: COLORS.textDark },
  totalValue:   { fontSize: 19, fontWeight: '900', color: COLORS.primary },
  savingsBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  savingsTxt:   { fontSize: 12, color: COLORS.primary, fontWeight: '600' },

  // Free delivery progress
  progressWrap: { paddingVertical: 10 },
  progressTxt:  { fontSize: 13, color: COLORS.textMedium, flex: 1 },
  progressTrack:{ height: 7, backgroundColor: COLORS.grayTint, borderRadius: 10, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 10 },

  // Empty
  emptyWrap:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 14 },
  emptyIconWrap:{ width: 100, height: 100, borderRadius: 50, backgroundColor: GREEN_BG, justifyContent: 'center', alignItems: 'center' },
  emptyTitle:   { fontSize: 20, fontWeight: '800', color: COLORS.textDark },
  emptySub:     { fontSize: 14, color: COLORS.textMedium, textAlign: 'center' },
  shopBtnWrap:  { borderRadius: 50, overflow: 'hidden', marginTop: 6 },
  shopBtnGrad:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 28, paddingVertical: 14 },
  shopBtnTxt:   { color: COLORS.white, fontSize: 15, fontWeight: '700' },

  // Bottom bar
  bar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingTop: 8,
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: -3 }, elevation: 8,
  },
  barTotal:     { fontSize: 17, fontWeight: '900', color: COLORS.primary },
  barSub:       { fontSize: 10, color: COLORS.textMedium, marginTop: 1 },
  checkoutBtn:  { borderRadius: 14, overflow: 'hidden' },
  checkoutGrad: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, paddingVertical: 14, backgroundColor: COLORS.primary },
  checkoutTxt:  { color: COLORS.white, fontSize: 15, fontWeight: '700' },
});

/**
 * CartScreen — Redesigned to match KisanMart reference UI
 * Staggered entrance, pill qty selector, animated progress bar, bottom action bar
 */
import { COLORS } from '@krushisarva/shared/constants/colors';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, Animated, Alert, Easing, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '@krushisarva/shared/utils/haptics';
import { LinearGradient } from 'expo-linear-gradient';
import api from '@krushisarva/shared/services/api';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import { useCart } from '../../context/CartContext';
import AnimatedScreen from '@krushisarva/shared/components/ui/AnimatedScreen';
import { StoreCategoryIcon } from '@krushisarva/shared/components/StoreCategoryIcons';
import MockImagePlaceholder from '../../components/MockImagePlaceholder';
import { SkeletonList } from '../../components/ui/Skeleton';
import { classifyError, inr, thumbUrl, SHOP_ERRORS } from './shopClient';

const W = Dimensions.get('window').width;

const GREEN_BG = 'rgba(23,107,67,0.08)';

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
          <StoreCategoryIcon type="bag" size={88} animated={false} />
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

  // Price, stock and the seller name come from the OFFER this line was added
  // from — the catalog row has none of them post-split. `item.product` remains
  // the fallback for a cart row written before the backfill.
  const listing  = item.listing || null;
  const product  = listing?.variant?.product || item.product || {};
  const rowKey   = item.listingId || item.id;
  const price    = Number(listing?.sellingPrice ?? item.unitPrice ?? item.product?.price ?? 0);
  const stock    = listing?.stockQty ?? item.product?.stock ?? null;
  const minQty   = listing?.minOrderQty ?? 1;
  const sellerNm = listing?.seller?.name || null;
  const packSize = listing?.variant?.attributes?.packSize || listing?.variant?.unit || item.product?.unit;
  const subtotal = price * item.quantity;
  // 80px box — a thumbnail, not the original upload.
  const imageUrl = thumbUrl(listing?.images?.[0] || product.images?.[0], 200);

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

  // Removal is reversible (item can be re-added from ProductDetail), so we skip
  // the Alert.alert confirm — it doesn't render reliably on web and adds friction
  // on native. The slide-out animation provides enough feedback.
  function confirmRemove() {
    slideRemove(() => onRemove(rowKey));
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
                : <MockImagePlaceholder category={product.category || product.categoryId} size={80} />
              }
            </View>

            {/* Info */}
            <View style={{ flex: 1 }}>
              <Text style={S.itemCat}>{product.category?.name}</Text>
              <Text style={S.itemName} numberOfLines={2}>{product.name}</Text>
              {/* WHICH Kendra this line is from. With two offers of the same seed
                  in the cart, the seller name is the only thing telling the two
                  lines apart. */}
              {sellerNm ? (
                <Text style={S.itemSeller} numberOfLines={1}>
                  <Ionicons name="storefront-outline" size={11} color={COLORS.textLight} /> {sellerNm}
                </Text>
              ) : null}
              <Text style={S.itemPrice}>
                {inr(price)}
                <Text style={S.itemUnit}> / {packSize}</Text>
              </Text>
              {item.priceChanged ? (
                <Text style={S.itemPriceChanged}>
                  {t('cart.priceChanged', {
                    from: `₹${Number(item.previousPrice).toLocaleString('en-IN')}`,
                    defaultValue: `Price changed from ₹${item.previousPrice}`,
                  })}
                </Text>
              ) : null}
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
            {/* Pill qty selector — capped at product.stock */}
            <View style={S.qtyPill}>
              {/* Below the seller's minimum order there is no valid quantity, so
                  stepping down past it removes the line instead of sending a
                  quantity the server will reject. minOrderQty is enforced now —
                  it used to be stored on every listing and read by nothing. */}
              <PressScale
                onPress={() => onQtyChange(rowKey, item.quantity - 1 < minQty ? 0 : item.quantity - 1)}
                down={0.8}
              >
                <View style={S.qPillBtn}>
                  <Ionicons name="remove" size={15} color={COLORS.charcoal} />
                </View>
              </PressScale>
              <Animated.Text style={[S.qNum, { transform: [{ scale: qtyAnim }] }]}>
                {item.quantity}
              </Animated.Text>
              {(() => {
                const atMax = stock != null && item.quantity >= stock;
                return (
                  <PressScale
                    onPress={() => { if (!atMax) onQtyChange(rowKey, item.quantity + 1); }}
                    down={atMax ? 1 : 0.8}
                  >
                    <View style={[S.qPillBtn, atMax && { opacity: 0.4 }]}>
                      <Ionicons name="add" size={15} color={COLORS.charcoal} />
                    </View>
                  </PressScale>
                );
              })()}
            </View>

            <Text style={S.itemSubtotal}>{inr(subtotal)}</Text>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

// ── Animated delivery progress bar ───────────────────────────────────────────
function DeliveryProgress({ current, threshold }) {
  const { t } = useLanguage();
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
          {t('cart.freeDeliveryPrefix')} <Text style={{ color: COLORS.primary, fontWeight: '700' }}>{inr(threshold - current)}</Text> {t('cart.freeDeliverySuffix')}
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
  const { refresh: refreshCart } = useCart();

  const [items,      setItems]      = useState([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [quote,      setQuote]      = useState(null);
  const [error,      setError]      = useState(null);
  // The buyer's default delivery PIN code, used to price the quote. Read-only
  // here; checkout is where it can be changed.
  const [defaultPincode, setDefaultPincode] = useState(null);

  // ── The delivery fee is the SERVER'S number now ────────────────────────────
  // This screen used to compute it:
  //
  //     const FREE_THRESHOLD = 999;
  //     const delivery   = total >= FREE_THRESHOLD ? 0 : 49;
  //     const grandTotal = total + delivery;
  //
  // …and then never send it anywhere. The farmer approved ₹448.98 here, the app
  // posted the goods subtotal, and the order was created for ₹399.98. Both
  // numbers were wrong and neither was auditable. Everything below reads the
  // quote returned by GET /agristore/cart, which is the same computation the
  // order is written from.
  const subtotal   = quote ? Number(quote.subtotal) : total;
  const delivery   = quote ? Number(quote.deliveryFee) : 0;
  const taxAmount  = quote ? Number(quote.taxAmount) : 0;
  const grandTotal = quote ? Number(quote.total) : total;
  // Blocking problems (out of stock, price changed, a blocked chemical, an
  // unserviceable PIN code). Checkout is disabled while any exist, and each one
  // names the line it is about.
  const blockingIssues = quote?.issues || [];

  const fetchCart = useCallback(async () => {
    try {
      // Send the delivery PIN CODE so the cart quote is priced for where the
      // order is actually going. Without it the cart ignored the address
      // entirely — no per-area surcharge, no ETA, no unserviceable warning —
      // and could quote a different delivery fee from the checkout screen,
      // which does send it.
      const params = defaultPincode ? { pincode: defaultPincode } : undefined;
      const { data } = await api.get('/agristore/cart', { params });
      setItems(data.data.items || []);
      setTotal(data.data.total || 0);
      setQuote(data.data.quote || null);
      setError(null);
    } catch (err) {
      // NOT `setItems([])`.
      //
      // That was the old behaviour, and it meant a dropped packet rendered the
      // EMPTY CART screen — "your cart is empty, browse products" — to a farmer
      // whose cart was full. They would re-add everything they had already
      // chosen. The lines stay; the failure is shown as a bar with a retry.
      const info = classifyError(err);
      if (info) setError(info);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [defaultPincode]);

  // Resolve the default address first, then price the cart against it.
  useEffect(() => {
    let alive = true;
    api.get('/addresses')
      .then(({ data }) => {
        if (!alive) return;
        const list = data?.data || [];
        const def = list.find((a) => a.isDefault) || list[0];
        setDefaultPincode(def?.pincode || null);
      })
      // No address yet is normal for a first-time buyer — the quote just falls
      // back to the platform default ETA and no surcharge.
      .catch(() => { if (alive) setDefaultPincode(null); });
    return () => { alive = false; };
  }, []);

  useEffect(() => { fetchCart(); }, [fetchCart]);

  const handleRefresh = useCallback(() => { setRefreshing(true); fetchCart(); }, [fetchCart]);

  // ── Lines are keyed on the CART ROW, not on the product ───────────────────
  // `items.find(i => i.product.id === productId)` mirrored the backend's old
  // assumption that a buyer could hold each product only once. With two Kendras'
  // offers of the same seed in the cart, `find` returns the first match and
  // `filter` drops BOTH — so changing the quantity on one line silently mutated
  // the other, and removing one removed both.
  const rowKey = (i) => i.listingId || i.id;
  const unitPrice = (i) => Number(i.listing?.sellingPrice ?? i.product?.price ?? 0);

  async function handleQtyChange(key, newQty) {
    if (newQty < 1) { handleRemove(key); return; }
    const item = items.find(i => rowKey(i) === key);
    if (!item) return;
    const price = unitPrice(item);
    setItems(prev => prev.map(i => (rowKey(i) === key ? { ...i, quantity: newQty } : i)));
    setTotal(prev => prev - price * item.quantity + price * newQty);
    // The cart API is re-keyed to the listing; it still resolves a product id for
    // older clients, so this path works either way.
    try { await api.put(`/agristore/cart/${key}`, { quantity: newQty }); }
    catch { fetchCart(); }
  }

  async function handleRemove(key) {
    const removed = items.find(i => rowKey(i) === key);
    setItems(prev => prev.filter(i => rowKey(i) !== key));
    if (removed) setTotal(prev => prev - unitPrice(removed) * removed.quantity);
    try { await api.delete(`/agristore/cart/${key}`); refreshCart(); }
    catch { fetchCart(); refreshCart(); }
  }

  function handleCheckout() {
    // Checkout re-fetches its own quote; these are passed only so the first
    // frame does not flash different numbers. The AUTHORITY is always the quote
    // the server returns at checkout time, never these.
    navigation.navigate('Checkout', {
      total: subtotal, delivery, grandTotal, itemCount: items.length, quote,
    });
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
        <View style={{ padding: 14 }}>
          {/* thumbSize matches itemImgBox so the rows do not resize on load. */}
          {/* rowH 179 is the real itemCard's height — without it the list
              collapses ~230pt upward the moment the cart lands. */}
          <SkeletonList rows={3} thumb="square" thumbSize={80} rowH={179} bordered label={t('loading')} />
        </View>
      </SafeAreaView>
    );
  }

  // The empty state is only shown when the server actually said the cart is
  // empty — never when the request failed. `!error` is the whole guard.
  if (!loading && items.length === 0 && !error) return <EmptyCart navigation={navigation} />;

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
          <Text style={S.headerTitle}>{t('cart.myCart')}</Text>
          <Text style={S.headerSub}>{items.length !== 1 ? t('cart.itemCountPlural', { count: items.length }) : t('cart.itemCount', { count: items.length })}</Text>
        </View>
        {items.length > 0 && (
          <View style={S.headerBadge}>
            <Text style={S.headerBadgeTxt}>{items.length}</Text>
          </View>
        )}
      </View>

      {/* A failed refresh keeps the cart on screen and explains itself. */}
      {error ? (
        <View style={[S.banner, S.bannerError]}>
          <Ionicons
            name={error.code === SHOP_ERRORS.OFFLINE ? 'cloud-offline-outline' : 'warning-outline'}
            size={16}
            color={COLORS.error}
          />
          <Text style={S.bannerTxt} numberOfLines={2}>{error.message}</Text>
          <TouchableOpacity onPress={handleRefresh} hitSlop={10} style={S.bannerBtn}>
            <Text style={S.bannerAction}>{t('retry', 'Retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Blocking problems, itemised. "Something went wrong" gives a farmer
          nothing to do; "Only 3 left of Urea 50kg" tells them exactly what to
          change. Each issue carries a code the backend defined, so the wording
          is never a guess about what happened. */}
      {blockingIssues.length > 0 ? (
        <View style={[S.banner, S.bannerWarn, { flexDirection: 'column', alignItems: 'stretch', gap: 6 }]}>
          {blockingIssues.slice(0, 4).map((issue, i) => (
            <View key={`${issue.code}-${issue.listingId || i}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <Ionicons name="alert-circle-outline" size={15} color={COLORS.yellowDark} style={{ marginTop: 1 }} />
              <Text style={[S.bannerTxt, { color: COLORS.yellowDark }]}>{issue.message}</Text>
            </View>
          ))}
          {blockingIssues.length > 4 ? (
            <Text style={[S.bannerTxt, { color: COLORS.yellowDark }]}>
              {t('cart.moreIssues', { count: blockingIssues.length - 4, defaultValue: `+${blockingIssues.length - 4} more` })}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ── List ── */}
      <FlatList
        windowSize={5}
        maxToRenderPerBatch={10}
        removeClippedSubviews
        data={items}
        keyExtractor={i => i.listingId || i.id}
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
              <Text style={S.summaryLabel}>{totalQty !== 1 ? t('cart.subtotalPlural', { count: totalQty }) : t('cart.subtotal', { count: totalQty })}</Text>
              <Text style={S.summaryValue}>{inr(subtotal)}</Text>
            </View>

            <View style={S.summaryRow}>
              <Text style={S.summaryLabel}>
                {t('cart.delivery')}
                {quote?.shipmentCount > 1
                  ? ` (${t('cart.shipments', { count: quote.shipmentCount, defaultValue: `${quote.shipmentCount} deliveries` })})`
                  : ''}
              </Text>
              <Text style={[S.summaryValue, delivery === 0 && { color: COLORS.primary, fontWeight: '700' }]}>
                {delivery === 0 ? t('free') : inr(delivery)}
              </Text>
            </View>

            {/* Tax, only when the platform is actually charging or showing it.
                The product page said "inclusive of all taxes" under every price
                while no tax existed anywhere in the system. */}
            {taxAmount > 0 && (
              <View style={S.summaryRow}>
                <Text style={S.summaryLabel}>
                  {quote?.taxIncludedInPrice
                    ? t('cart.taxIncluded', 'GST (included in price)')
                    : t('cart.tax', 'GST')}
                </Text>
                <Text style={S.summaryValue}>{inr(taxAmount)}</Text>
              </View>
            )}

            {/* Free-delivery progress, driven by the SERVER's threshold and the
                server's per-shipment shortfall — not a hard-coded 999. */}
            {delivery > 0 && quote?.shipments?.[0]?.freeDeliveryShortfall ? (
              <DeliveryProgress
                current={Number(quote.shipments[0].goodsSubtotal)}
                threshold={Number(quote.shipments[0].goodsSubtotal) + Number(quote.shipments[0].freeDeliveryShortfall)}
              />
            ) : null}

            {/* A cart spanning two Kendras arrives as two deliveries and is
                charged as two. Saying so here stops it reading as a double
                charge on the order screen. */}
            {quote?.shipmentCount > 1 && (
              <View style={S.shipmentsBox}>
                {quote.shipments.map((s) => (
                  <View key={s.sellerId || s.sellerName} style={S.shipmentRow}>
                    <Ionicons name="cube-outline" size={13} color={COLORS.textMedium} />
                    <Text style={S.shipmentTxt} numberOfLines={1}>
                      {s.sellerName || t('cart.seller', 'Seller')} · {inr(s.goodsSubtotal)}
                      {Number(s.deliveryFee) > 0 ? ` + ${inr(s.deliveryFee)}` : ` · ${t('free')}`}
                      {s.etaMaxDays ? ` · ${t('cart.etaDays', { count: s.etaMaxDays, defaultValue: `in ${s.etaMaxDays} days` })}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <View style={S.summaryDivider} />

            <View style={S.summaryRow}>
              <Text style={S.totalLabel}>{t('cart.totalPayable')}</Text>
              <Text style={S.totalValue}>{inr(grandTotal)}</Text>
            </View>

            {delivery === 0 && subtotal > 0 && (
              <View style={S.savingsBadge}>
                <Ionicons name="checkmark-circle" size={14} color={COLORS.primary} />
                <Text style={S.savingsTxt}>{t('cart.savedOnDelivery')}</Text>
              </View>
            )}
          </View>
        )}
      />

      {/* ── Bottom action bar ── */}
      <View style={[S.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={{ flexShrink: 1 }}>
          <Text style={S.barTotal}>{inr(grandTotal)}</Text>
          <Text style={S.barSub} numberOfLines={1}>
            {(totalQty !== 1 ? t('cart.itemCountPlural', { count: totalQty }) : t('cart.itemCount', { count: totalQty }))} · {delivery === 0 ? t('cart.freeDelivery') : t('cart.deliveryCharge', { amount: delivery })}
          </Text>
        </View>
        {/* Checkout is disabled while the server says something blocks it. The
            farmer used to be able to walk into a payment sheet with an
            out-of-stock line and only find out afterwards. */}
        <PressScale
          onPress={blockingIssues.length ? handleRefresh : handleCheckout}
          down={0.96}
          style={S.checkoutBtn}
        >
          <View style={[S.checkoutGrad, blockingIssues.length > 0 && { backgroundColor: COLORS.grayMedium }]}>
            <Text style={S.checkoutTxt}>
              {blockingIssues.length ? t('cart.reviewCart', 'Review cart') : t('cart.proceedCheckout')}
            </Text>
            <Ionicons name={blockingIssues.length ? 'refresh' : 'arrow-forward'} size={17} color={COLORS.white} />
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

  // ── Banners (recoverable error / blocking cart issues) ──
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 14, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1,
  },
  bannerError: { backgroundColor: COLORS.errorLight, borderColor: COLORS.error + '40' },
  bannerWarn:  { backgroundColor: COLORS.yellowWarm, borderColor: COLORS.yellowDark + '40' },
  bannerTxt:   { flex: 1, fontSize: 12.5, lineHeight: 17, color: COLORS.error },
  // 44dp tap target for the recovery action.
  bannerBtn:   { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  bannerAction:{ fontSize: 12.5, fontWeight: '800', color: COLORS.primary },

  // ── Per-seller shipment breakdown ──
  shipmentsBox: { marginTop: 10, gap: 6, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  shipmentRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shipmentTxt:  { flex: 1, fontSize: 11.5, color: COLORS.textMedium },

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
  itemSeller:        { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  itemPriceChanged:  { fontSize: 10.5, color: COLORS.cta, marginTop: 2, fontWeight: '700' },
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

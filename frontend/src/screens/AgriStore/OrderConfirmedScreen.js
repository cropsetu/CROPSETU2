/**
 * OrderConfirmedScreen — Redesigned to match KisanMart reference UI
 * Green gradient header, breathing circles, spring checkmark, staggered item list
 */
import { COLORS } from '../../constants/colors';
import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Animated, Easing, Image, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '../../utils/haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useLanguage } from '../../context/LanguageContext';
import { SoundEffects } from '../../utils/sounds';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const W      = Dimensions.get('window').width;



// ── Press scale ───────────────────────────────────────────────────────────────
function PressScale({ onPress, style, down = 0.96, children }) {
  const sc = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[style, { transform: [{ scale: sc }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(sc, { toValue: down, useNativeDriver: true, friction: 8, tension: 200 }).start()}
        onPressOut={() => Animated.spring(sc, { toValue: 1, useNativeDriver: true, friction: 5, tension: 80 }).start()}
        activeOpacity={1}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Staggered item row ────────────────────────────────────────────────────────
function OrderItemRow({ item, index }) {
  const op = useRef(new Animated.Value(0)).current;
  const x  = useRef(new Animated.Value(-12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(op, { toValue: 1, duration: 260, delay: 500 + index * 100, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.spring(x, { toValue: 0, friction: 8, tension: 70, delay: 500 + index * 100, useNativeDriver: true }),
    ]).start();
  }, []);

  const name      = item.product?.name || 'Product';
  const imageUrl  = item.product?.images?.[0];
  const price     = item.unitPrice || item.product?.price || 0;
  const qty       = item.quantity || 1;
  const lineTotal = item.totalPrice || price * qty;

  return (
    <Animated.View style={{ opacity: op, transform: [{ translateX: x }] }}>
      <View style={[S.itemRow, index > 0 && { marginTop: 8 }]}>
        <View style={S.itemImgBox}>
          {imageUrl
            ? <Image source={{ uri: imageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            : <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(23,107,67,0.08)' }}>
                <Ionicons name="leaf" size={18} color={COLORS.primary} />
              </View>
          }
        </View>
        <View style={{ flex: 1 }}>
          <Text style={S.itemName} numberOfLines={1}>{name}</Text>
          <Text style={S.itemMeta}>Qty: {qty} × ₹{price.toLocaleString()}</Text>
        </View>
        <Text style={S.itemTotal}>₹{lineTotal.toLocaleString()}</Text>
      </View>
    </Animated.View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function OrderConfirmedScreen({ route, navigation }) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { order, paymentMethod, grandTotal } = route.params || {};

  // Hero animations
  const checkSc    = useRef(new Animated.Value(0)).current;
  const checkRot   = useRef(new Animated.Value(-180)).current;  // rotate degrees (faked via interpolate)
  const titleOp    = useRef(new Animated.Value(0)).current;
  const titleY     = useRef(new Animated.Value(10)).current;
  const subOp      = useRef(new Animated.Value(0)).current;

  // Breathing circle animations
  const circle1    = useRef(new Animated.Value(1)).current;
  const circle2    = useRef(new Animated.Value(1)).current;

  // Content card animations
  const cardOp     = useRef(new Animated.Value(0)).current;
  const cardY      = useRef(new Animated.Value(30)).current;
  const delivOp    = useRef(new Animated.Value(0)).current;
  const delivY     = useRef(new Animated.Value(20)).current;
  const btnOp      = useRef(new Animated.Value(0)).current;
  const btnY       = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Haptics.success();
    SoundEffects.success();
    // 1) Spring-pop the checkmark
    Animated.sequence([
      Animated.spring(checkSc, { toValue: 1, tension: 200, friction: 15, useNativeDriver: true }),
    ]).start();

    // 2) Title fades in after checkmark
    Animated.parallel([
      Animated.timing(titleOp, { toValue: 1, duration: 350, delay: 200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.spring(titleY, { toValue: 0, friction: 8, tension: 60, delay: 200, useNativeDriver: true }),
    ]).start();

    // 3) Sub text
    Animated.timing(subOp, { toValue: 1, duration: 300, delay: 350, useNativeDriver: true }).start();

    // 4) Content cards slide up
    Animated.parallel([
      Animated.timing(cardOp, { toValue: 1, duration: 360, delay: 400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.spring(cardY, { toValue: 0, friction: 8, tension: 60, delay: 400, useNativeDriver: true }),
    ]).start();

    // 5) Delivery card
    Animated.parallel([
      Animated.timing(delivOp, { toValue: 1, duration: 300, delay: 600, useNativeDriver: true }),
      Animated.spring(delivY, { toValue: 0, friction: 8, tension: 60, delay: 600, useNativeDriver: true }),
    ]).start();

    // 6) Button
    Animated.parallel([
      Animated.timing(btnOp, { toValue: 1, duration: 300, delay: 700, useNativeDriver: true }),
      Animated.spring(btnY, { toValue: 0, friction: 8, tension: 60, delay: 700, useNativeDriver: true }),
    ]).start();

    // Breathing circles loop
    Animated.loop(Animated.sequence([
      Animated.timing(circle1, { toValue: 1.2, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(circle1, { toValue: 1, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(circle2, { toValue: 1.3, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: true, delay: 500 }),
      Animated.timing(circle2, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])).start();
  }, []);

  // Data
  const shortId   = order?.id ? order.id.slice(0, 8).toUpperCase() : '--------';
  const items     = order?.items || [];
  const totalAmt  = grandTotal || order?.totalAmount || 0;

  const today = new Date();
  const from  = new Date(today); from.setDate(today.getDate() + 2);
  const to    = new Date(today); to.setDate(today.getDate() + 4);
  const fmt   = d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const delivEst = `${fmt(from)} – ${fmt(to)}`;

  const PAY_LABEL = { cod: 'Cash on Delivery', upi: 'UPI Payment', card: 'Card' };
  const PAY_BADGE_BG = { cod: COLORS.successLight, upi: COLORS.blueBg, card: COLORS.orangeBg };
  const PAY_BADGE_TXT = { cod: COLORS.greenBright, upi: COLORS.blue, card: COLORS.cta };

  return (

    <AnimatedScreen>
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>

        {/* ── Green gradient success header ── */}
        <LinearGradient
          colors={[COLORS.primary, COLORS.greenBright, COLORS.greenDeep]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[S.heroGrad, { paddingTop: insets.top + 16 }]}
        >
          {/* Breathing decorative circles */}
          <Animated.View style={[S.decorCircle1, { transform: [{ scale: circle1 }] }]} />
          <Animated.View style={[S.decorCircle2, { transform: [{ scale: circle2 }] }]} />

          {/* Spring checkmark */}
          <Animated.View style={[S.checkWrap, { transform: [{ scale: checkSc }] }]}>
            <View style={S.checkInner}>
              <Ionicons name="checkmark" size={32} color={COLORS.primary} strokeWidth={3} />
            </View>
          </Animated.View>

          {/* Title */}
          <Animated.View style={{ opacity: titleOp, transform: [{ translateY: titleY }] }}>
            <Text style={S.heroTitle}>{t('orderConfirmed.heroTitle')}</Text>
          </Animated.View>

          {/* Sub */}
          <Animated.Text style={[S.heroSub, { opacity: subOp }]}>
            तुमचा ऑर्डर यशस्वीरित्या पुष्टी झाला
          </Animated.Text>
        </LinearGradient>

        {/* ── Order details card ── */}
        <Animated.View style={[S.card, { marginTop: 16, opacity: cardOp, transform: [{ translateY: cardY }] }]}>
          {/* Card header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={S.cardTitle}>{t('orderConfirmed.orderDetails')}</Text>
            <View style={S.orderIdBadge}>
              <Text style={S.orderIdTxt}>#{shortId}</Text>
            </View>
          </View>

          {/* Details */}
          {[
            { icon: 'cube-outline',      label: 'Items',          value: `${items.length} item${items.length !== 1 ? 's' : ''}` },
            { icon: 'cash-outline',      label: 'Total Paid',     value: `₹${totalAmt.toLocaleString()}`, green: true },
            { icon: 'card-outline',      label: 'Payment',        badge: true },
            { icon: 'car-outline',       label: 'Est. Delivery',  value: delivEst },
          ].map((row, i) => (
            <View key={i} style={[S.detailRow, i === 3 && { borderBottomWidth: 0 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name={row.icon} size={16} color={COLORS.textMedium} />
                <Text style={S.detailLabel}>{row.label}</Text>
              </View>
              {row.badge ? (
                <View style={[S.payBadge, { backgroundColor: PAY_BADGE_BG[paymentMethod] || COLORS.grayBg }]}>
                  <Text style={[S.payBadgeTxt, { color: PAY_BADGE_TXT[paymentMethod] || COLORS.grayMid2 }]}>
                    {PAY_LABEL[paymentMethod] || 'Cash on Delivery'}
                  </Text>
                </View>
              ) : (
                <Text style={[S.detailValue, row.green && { color: COLORS.primary, fontWeight: '800' }]}>{row.value}</Text>
              )}
            </View>
          ))}

          {/* Items ordered */}
          {items.length > 0 && (
            <>
              <View style={{ borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 4, paddingTop: 14, marginBottom: 6 }}>
                <Text style={[S.cardTitle, { marginBottom: 8 }]}>{t('orderConfirmed.itemsOrdered')}</Text>
              </View>
              {items.map((item, i) => (
                <OrderItemRow key={item.id || i} item={item} index={i} />
              ))}
            </>
          )}
        </Animated.View>

        {/* ── Estimated delivery card ── */}
        <Animated.View style={[S.delivCard, { opacity: delivOp, transform: [{ translateY: delivY }] }]}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(45,145,98,0.12)', justifyContent: 'center', alignItems: 'center' }}>
            <Ionicons name="car-outline" size={18} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.textDark }}>{t('orderConfirmed.estDelivery')}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textMedium, marginTop: 1 }}>{delivEst}</Text>
          </View>
          <Ionicons name="time-outline" size={18} color={COLORS.textMedium} />
        </Animated.View>

        {/* ── Continue Shopping button ── */}
        <Animated.View style={[{ paddingHorizontal: 16, marginTop: 12, opacity: btnOp, transform: [{ translateY: btnY }] }]}>
          <PressScale onPress={() => navigation.navigate('AgriStoreHome')} down={0.97} style={{ borderRadius: 16, overflow: 'hidden' }}>
            <LinearGradient colors={[COLORS.primary, COLORS.greenBright]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={S.ctaBtn}>
              <Ionicons name="bag-outline" size={18} color={COLORS.white} />
              <Text style={S.ctaTxt}>{t('orderConfirmed.continueShopping')}</Text>
            </LinearGradient>
          </PressScale>
        </Animated.View>

        {/* Thank you note */}
        <Animated.Text style={[S.thanksTxt, { opacity: btnOp }]}>
          Thank you for shopping with CropSetu!
        </Animated.Text>

      </ScrollView>
    </View>
    </AnimatedScreen>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  // Hero
  heroGrad: {
    paddingHorizontal: 20, paddingBottom: 28,
    alignItems: 'center', gap: 8,
    position: 'relative', overflow: 'hidden',
  },
  decorCircle1: {
    position: 'absolute', top: -30, right: -30,
    width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(255,255,255,0.10)',
  },
  decorCircle2: {
    position: 'absolute', bottom: -20, left: -20,
    width: 90, height: 90, borderRadius: 45, backgroundColor: 'rgba(255,255,255,0.10)',
  },
  checkWrap: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: COLORS.white, justifyContent: 'center', alignItems: 'center',
    shadowColor: COLORS.black, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
    marginBottom: 4,
  },
  checkInner: { justifyContent: 'center', alignItems: 'center' },
  heroTitle:  { fontSize: 18, fontWeight: '800', color: COLORS.white, textAlign: 'center' },
  heroSub:    { fontSize: 13, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },

  // Card
  card: {
    marginHorizontal: 16, backgroundColor: COLORS.surface, borderRadius: 20,
    padding: 16, borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.06, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  cardTitle:    { fontSize: 15, fontWeight: '800', color: COLORS.textDark },
  orderIdBadge: { backgroundColor: COLORS.grayBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  orderIdTxt:   { fontSize: 12, fontWeight: '700', color: COLORS.grayMid2, fontVariant: ['tabular-nums'] },

  // Detail rows
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  detailLabel: { fontSize: 13, color: COLORS.textMedium },
  detailValue: { fontSize: 13, fontWeight: '600', color: COLORS.textDark },
  payBadge:    { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  payBadgeTxt: { fontSize: 12, fontWeight: '700' },

  // Items list
  itemRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.slate50, borderRadius: 12, padding: 10 },
  itemImgBox: { width: 42, height: 42, borderRadius: 10, overflow: 'hidden', backgroundColor: COLORS.surface },
  itemName:   { fontSize: 13, fontWeight: '700', color: COLORS.textDark },
  itemMeta:   { fontSize: 11, color: COLORS.textMedium, marginTop: 2 },
  itemTotal:  { fontSize: 14, fontWeight: '800', color: COLORS.primary },

  // Delivery card
  delivCard: {
    marginHorizontal: 16, marginTop: 10,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(45,145,98,0.06)', borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: 'rgba(45,145,98,0.2)',
  },

  // CTA
  ctaBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15, borderRadius: 16 },
  ctaTxt:   { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  thanksTxt:{ textAlign: 'center', color: COLORS.textMedium, fontSize: 12, marginTop: 16, paddingHorizontal: 20 },
});

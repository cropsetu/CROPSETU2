/**
 * CheckoutScreen — Redesigned to match KisanMart reference UI
 * 3-step flow: Address → Order Summary → Payment
 * Staggered entrance, spring selection, animated radio, icon circles
 */
import { COLORS } from '@cropsetu/shared/constants/colors';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, Animated, Image, StatusBar, Dimensions, Easing, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PhotoIcon from '../../components/PhotoIcon';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import api from '@cropsetu/shared/services/api';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import { isValidPhone, isValidPincode, normalizePhone } from '@cropsetu/shared/utils/validators';
import AnimatedScreen from '@cropsetu/shared/components/ui/AnimatedScreen';
import {
  fetchCartQuote, fetchPaymentConfig, fetchPaymentStatus, initiatePayment, confirmPayment,
  classifyError, inr, thumbUrl,
} from './shopClient';
import RazorpayCheckout from './RazorpayCheckout';

/**
 * A fresh idempotency key per order ATTEMPT.
 *
 * Order creation had no idempotency protection at all: a double-tap on "Place
 * Order", or the axios 401-refresh replay, or a retry after a timeout on a
 * village connection, each created a SECOND order and decremented stock twice.
 * The online path was accidentally covered by the unique index on `paymentRef`;
 * cash on delivery — which is what most farmers use — was not.
 */
function newIdempotencyKey() {
  try { if (global.crypto?.randomUUID) return global.crypto.randomUUID(); } catch { /* RN without WebCrypto */ }
  return `order-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// A translucent tint, for surfaces that are drawn FLAT (chips, icon circles,
// selected rows). Safe there because nothing casts a shadow underneath them.
const GREEN_BG = 'rgba(23,107,67,0.08)';
const GREEN_B  = 'rgba(23,107,67,0.15)';

/**
 * The same mint, OPAQUE — for anything that also has elevation.
 *
 * `CW.card` carries `elevation: 2`. On Android the elevation shadow is painted
 * BEHIND the view, so an 8%-opaque background lets it show straight through:
 * the card renders muddy grey instead of pale green, and the shadow under the
 * padding box separates out as a second, lighter rectangle inside it. That
 * double-box is what it looked like on the Total Payable card and on
 * "Add New Address".
 *
 * Fixed by making the fill opaque rather than by removing the elevation — the
 * card is meant to sit above the page, and every other card here does.
 */
const GREEN_CARD_BG = COLORS.primaryPale;   // #DFF3EA

// ─── Helpers ──────────────────────────────────────────────────────────────────
const addrLine  = a => a ? [a.flat, a.street, a.city, a.state, a.pincode].filter(Boolean).join(', ') : '';

const TYPE_ICON  = { HOME: 'home-outline', OFFICE: 'business-outline', OTHER: 'location-outline' };
const TYPE_COLOR = { HOME: COLORS.primary, OFFICE: COLORS.vibrantPurple, OTHER: COLORS.coral };

// ─── Press scale helper ───────────────────────────────────────────────────────
function PressScale({ onPress, style, down = 0.94, children }) {
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

// ─── Step Dot (isolated so useRef/useEffect are at component level) ───────────
function StepDot({ stepNum, currentStep, label }) {
  const done   = stepNum < currentStep;
  const active = stepNum === currentStep;
  const sc     = useRef(new Animated.Value(active ? 1.08 : done ? 1 : 0.85)).current;

  useEffect(() => {
    Animated.spring(sc, { toValue: active ? 1.08 : done ? 1 : 0.85, useNativeDriver: true, friction: 7, tension: 160 }).start();
  }, [currentStep]);

  return (
    <View style={SH.stepCol}>
      <Animated.View style={[
        SH.dot,
        active && { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
        done   && { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
        { transform: [{ scale: sc }] },
      ]}>
        {done
          ? <Ionicons name="checkmark" size={11} color={COLORS.white} />
          : <Text style={[SH.dotNum, (active || done) && { color: COLORS.white }]}>{stepNum}</Text>
        }
      </Animated.View>
      <Text style={[SH.dotLbl, (active || done) && { color: COLORS.primary, fontWeight: '700' }]}>
        {label}
      </Text>
    </View>
  );
}

// ─── Step Stepper Header ──────────────────────────────────────────────────────
function StepHeader({ step, onBack }) {
  const STEPS = ['Address', 'Summary', 'Payment'];

  return (
    <View style={SH.root}>
      {/* Back button */}
      <TouchableOpacity onPress={onBack} style={SH.back} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
        <Ionicons name="arrow-back" size={20} color={COLORS.charcoal} />
      </TouchableOpacity>

      {/* Steps */}
      <View style={SH.stepsRow}>
        {STEPS.map((label, i) => (
          <View key={i} style={SH.stepItem}>
            {i > 0 && <View style={[SH.connector, i < step && { backgroundColor: COLORS.primary }]} />}
            <StepDot stepNum={i + 1} currentStep={step} label={label} />
          </View>
        ))}
      </View>
    </View>
  );
}

const SH = StyleSheet.create({
  root: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface, paddingHorizontal: 14,
    paddingTop: 10, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 3,
  },
  back: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.softGray, justifyContent: 'center', alignItems: 'center',
    marginRight: 14, flexShrink: 0,
  },
  stepsRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 0 },
  stepItem: { flexDirection: 'row', alignItems: 'center' },
  connector: { width: 28, height: 2, backgroundColor: COLORS.border, marginBottom: 14 },
  stepCol:  { alignItems: 'center', gap: 5 },
  dot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLORS.surface, borderWidth: 2, borderColor: COLORS.lightGray,
    justifyContent: 'center', alignItems: 'center',
  },
  dotNum: { fontSize: 11, fontWeight: '700', color: COLORS.grayLight2 },
  dotLbl: { fontSize: 10, fontWeight: '600', color: COLORS.grayLightMid },
});

// ─── Icon Circle ──────────────────────────────────────────────────────────────
function IconCircle({ name, size = 20, color = COLORS.primary, bg = GREEN_BG }) {
  return (
    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: bg, justifyContent: 'center', alignItems: 'center' }}>
      <Ionicons name={name} size={size} color={color} />
    </View>
  );
}

// ─── Slide-in Card ────────────────────────────────────────────────────────────
function SlideCard({ children, style, delay = 0 }) {
  const op = useRef(new Animated.Value(0)).current;
  const y  = useRef(new Animated.Value(20)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(op, { toValue: 1, duration: 280, delay, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.spring(y, { toValue: 0, friction: 8, tension: 70, delay, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Animated.View style={[CW.card, style, { opacity: op, transform: [{ translateY: y }] }]}>
      {children}
    </Animated.View>
  );
}

// ─── Card header row ──────────────────────────────────────────────────────────
function CardHead({ icon, title, iconBg, iconColor, right }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
      <IconCircle name={icon} color={iconColor || COLORS.primary} bg={iconBg || GREEN_BG} />
      <Text style={{ fontSize: 15, fontWeight: '800', color: COLORS.textDark, flex: 1 }}>{title}</Text>
      {right}
    </View>
  );
}

const CW = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface, borderRadius: 20, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.05, shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
});

// ─── Labelled Input ───────────────────────────────────────────────────────────
function FInput({ label, req, style, ...props }) {
  return (
    <View style={[{ marginBottom: 12 }, style]}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.textLight, marginBottom: 5, letterSpacing: 0.2 }}>
        {label}{req && <Text style={{ color: COLORS.red }}> *</Text>}
      </Text>
      <TextInput
        style={{
          borderWidth: 1.5, borderColor: COLORS.gray150, borderRadius: 12,
          paddingHorizontal: 13, paddingVertical: Platform.OS === 'ios' ? 13 : 10,
          fontSize: 14, color: COLORS.textDark, backgroundColor: COLORS.surfaceRaised,
        }}
        placeholderTextColor={COLORS.silver}
        returnKeyType="next"
        autoCorrect={false}
        {...props}
      />
    </View>
  );
}

// ─── Price Row ────────────────────────────────────────────────────────────────
function PRow({ label, value, bold, green }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
      <Text style={{ fontSize: bold ? 15 : 14, color: bold ? COLORS.charcoal : COLORS.textMedium, fontWeight: bold ? '800' : '400' }}>{label}</Text>
      <Text style={{ fontSize: bold ? 18 : 14, color: green || bold ? COLORS.primary : COLORS.charcoal, fontWeight: bold ? '900' : '600' }}>{value}</Text>
    </View>
  );
}

// ─── Address Card (step 1) ────────────────────────────────────────────────────
function AddrCard({ addr, selected, onSelect, onDelete, delay = 0, t }) {
  const op     = useRef(new Animated.Value(0)).current;
  const y      = useRef(new Animated.Value(20)).current;
  const checkSc = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(op, { toValue: 1, duration: 280, delay, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.spring(y, { toValue: 0, friction: 8, tension: 65, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    Animated.spring(checkSc, {
      toValue: selected ? 1 : 0,
      useNativeDriver: true, type: 'spring',
      stiffness: 500, damping: 30,
    }).start();
  }, [selected]);

  const col = TYPE_COLOR[addr.type] || COLORS.primary;

  return (
    <Animated.View style={{ opacity: op, transform: [{ translateY: y }], marginBottom: 10 }}>
      <TouchableOpacity
        onPress={() => onSelect(addr.id)}
        activeOpacity={0.92}
        style={[
          AC.card,
          selected && { borderColor: col, shadowColor: col, shadowOpacity: 0.15 },
        ]}
      >
        {/* Left color stripe */}
        {selected && <View style={[AC.stripe, { backgroundColor: col }]} />}

        <View style={AC.body}>
          {/* Header row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <IconCircle name={TYPE_ICON[addr.type] || 'location-outline'} size={18} color={col} bg={col + '18'} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={[AC.typeBadge, { backgroundColor: col + '15' }]}>
                  <Text style={[AC.typeTxt, { color: col }]}>{addr.type}</Text>
                </View>
                {addr.isDefault && (
                  <View style={AC.defaultBadge}><Text style={AC.defaultTxt}>{t('product.defaultBadge')}</Text></View>
                )}
              </View>
              <Text style={AC.name}>{addr.name}</Text>
            </View>

            {/* Spring checkmark */}
            <Animated.View style={[AC.checkCircle, { backgroundColor: col, transform: [{ scale: checkSc }] }]}>
              <Ionicons name="checkmark" size={14} color={COLORS.white} />
            </Animated.View>

            {/* Delete */}
            <TouchableOpacity
              onPress={() => onDelete(addr.id)}
              hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
              style={AC.deleteBtn}
            >
              <Ionicons name="trash-outline" size={16} color={COLORS.error} />
            </TouchableOpacity>
          </View>

          {/* Address line */}
          <Text style={AC.addrTxt} numberOfLines={2}>{addrLine(addr)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 }}>
            <Ionicons name="call-outline" size={12} color={COLORS.textMedium} />
            <Text style={AC.phoneTxt}>{addr.phone}</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const AC = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface, borderRadius: 20, borderWidth: 2,
    borderColor: COLORS.border, overflow: 'hidden',
    shadowColor: COLORS.black, shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  stripe:       { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  body:         { padding: 14, paddingLeft: 18 },
  typeBadge:    { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  typeTxt:      { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  defaultBadge: { backgroundColor: COLORS.yellowWarm, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 },
  defaultTxt:   { fontSize: 9, fontWeight: '700', color: COLORS.yellowDark2 },
  name:         { fontSize: 14, fontWeight: '800', color: COLORS.textDark, marginTop: 2 },
  checkCircle:  { width: 26, height: 26, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
  deleteBtn:    { width: 30, height: 30, borderRadius: 15, backgroundColor: COLORS.errorLight, justifyContent: 'center', alignItems: 'center', marginLeft: 4 },
  addrTxt:      { fontSize: 13, color: COLORS.textMedium, lineHeight: 18 },
  phoneTxt:     { fontSize: 12, color: COLORS.textMedium },
});

// ─── Payment Option ───────────────────────────────────────────────────────────
function PayOption({ id, name, nameHi, desc, icon, iconBg, iconColor, selected, onSelect, delay = 0 }) {
  const op     = useRef(new Animated.Value(0)).current;
  const x      = useRef(new Animated.Value(-20)).current;
  const dotSc  = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(op, { toValue: 1, duration: 260, delay, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.spring(x, { toValue: 0, friction: 8, tension: 70, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    Animated.spring(dotSc, { toValue: selected ? 1 : 0, useNativeDriver: true, stiffness: 500, damping: 30 }).start();
  }, [selected]);

  return (
    <Animated.View style={{ opacity: op, transform: [{ translateX: x }] }}>
      <TouchableOpacity
        onPress={() => onSelect(id)}
        activeOpacity={0.9}
        style={[PO.row, selected && { borderColor: COLORS.primary, backgroundColor: GREEN_BG }]}
      >
        {/* Colored icon box */}
        <View style={[PO.iconBox, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={22} color={iconColor} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={PO.name}>{nameHi || name}</Text>
          <Text style={PO.desc}>{desc}</Text>
        </View>

        {/* Animated radio dot */}
        <View style={[PO.radioOuter, selected && { borderColor: COLORS.primary }]}>
          <Animated.View style={[PO.radioDot, { transform: [{ scale: dotSc }] }]} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const PO = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 16, borderWidth: 2, borderColor: COLORS.border, marginBottom: 10 },
  iconBox:  { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  name:     { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  desc:     { fontSize: 12, color: COLORS.textMedium, marginTop: 1 },
  radioOuter: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: COLORS.border, justifyContent: 'center', alignItems: 'center' },
  radioDot:   { width: 12, height: 12, borderRadius: 6, backgroundColor: COLORS.primary },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function CheckoutScreen({ route, navigation }) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  // Route params are the FIRST PAINT only, so the numbers do not flash on the
  // way in from the cart. Everything below re-reads them from `quote`, which is
  // the server's own computation and the only thing the order is written from.
  const params = route.params || {};

  const [step,          setStep]          = useState(1);
  // The authoritative quote. Re-fetched when the payment method or the delivery
  // PIN code changes, because both can move the payable (COD fee, per-area
  // surcharge, per-seller serviceability).
  const [quote,         setQuote]         = useState(params.quote || null);
  const [quoteError,    setQuoteError]    = useState(null);
  const idemKeyRef = useRef(newIdempotencyKey());

  // ── Online payment ─────────────────────────────────────────────────────────
  // `payCfg` decides which methods are even OFFERED. Until it loads, and
  // whenever the gateway is unconfigured, only cash on delivery is shown — the
  // app must never present a payment method the server cannot collect with.
  const [payCfg,   setPayCfg]   = useState({ onlineEnabled: false, methods: ['cod'], keyId: null });
  const [rzp,      setRzp]      = useState(null);   // { orderId, amountPaise } while the sheet is open
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchPaymentConfig().then((cfg) => {
      if (!alive) return;
      setPayCfg(cfg);
      // If the farmer had somehow selected an unavailable method, fall back.
      if (!cfg.onlineEnabled) setPayMethod('cod');
    });
    return () => { alive = false; };
  }, []);
  const [addresses,     setAddresses]     = useState([]);
  const [selectedAddr,  setSelectedAddr]  = useState(null);
  const [showForm,      setShowForm]      = useState(false);
  const [savingAddr,    setSavingAddr]    = useState(false);
  const [payMethod,     setPayMethod]     = useState('cod');
  const [placing,       setPlacing]       = useState(false);
  const [cartItems,     setCartItems]     = useState([]);
  const [note,          setNote]          = useState('');
  const [addrSheet,     setAddrSheet]     = useState(false);

  // Form state
  const [form, setForm] = useState({ type: 'HOME', name: '', phone: '', flat: '', street: '', city: '', state: '', pincode: '', landmark: '' });

  // Refs for keyboard
  const phoneRef    = useRef(); const flatRef     = useRef();
  const streetRef   = useRef(); const cityRef     = useRef();
  const stateRef    = useRef(); const pincodeRef  = useRef();
  const landmarkRef = useRef();

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Load addresses + cart items
  useEffect(() => {
    api.get('/addresses').then(({ data }) => {
      const list = data.data || [];
      setAddresses(list);
      const def = list.find(a => a.isDefault) || list[0];
      if (def) setSelectedAddr(def.id);
    }).catch(() => {});

    api.get('/agristore/cart').then(({ data }) => {
      setCartItems(data.data?.items || []);
    }).catch(() => {});
  }, []);

  const selectedAddrObj = addresses.find(a => a.id === selectedAddr);

  // Derived from the quote, never computed here. The COD fee, any per-area
  // delivery surcharge and the tax split all change with the payment method and
  // the delivery PIN code, so the summary has to follow both.
  const total      = quote ? Number(quote.subtotal)    : Number(params.total || 0);
  const delivery   = quote ? Number(quote.deliveryFee) : Number(params.delivery || 0);
  const taxAmount  = quote ? Number(quote.taxAmount)   : 0;
  const grandTotal = quote ? Number(quote.total)       : Number(params.grandTotal || 0);

  // Re-quote whenever an input to the price changes.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const fresh = await fetchCartQuote({
          paymentMethod: payMethod,
          pincode: selectedAddrObj?.pincode,
        });
        if (alive) { setQuote(fresh); setQuoteError(null); }
      } catch (err) {
        const info = classifyError(err);
        // Keep the previous quote on screen — a failed re-quote must not blank
        // the order summary the farmer is reading.
        if (alive && info) setQuoteError(info);
      }
    })();
    return () => { alive = false; };
  }, [payMethod, selectedAddrObj?.pincode]);

  async function saveAddress() {
    const phone = normalizePhone(form.phone);
    if (!form.name.trim() || !form.phone.trim() || !form.flat.trim() || !form.street.trim() ||
        !form.city.trim() || !form.state.trim() || !form.pincode.trim()) {
      Alert.alert(t('checkout.required'), t('checkout.fillAllFields'));
      return;
    }
    if (!isValidPhone(phone)) {
      Alert.alert(t('checkout.invalidPhone'), t('checkout.invalidPhoneMsg'));
      return;
    }
    if (!isValidPincode(form.pincode)) {
      Alert.alert(t('checkout.invalidPincode'), t('checkout.invalidPincodeMsg'));
      return;
    }
    setSavingAddr(true);
    try {
      const { data } = await api.post('/addresses', { ...form, phone });
      const newAddr = data.data;
      setAddresses(prev => [newAddr, ...prev]);
      setSelectedAddr(newAddr.id);
      setShowForm(false);
      setForm({ type: 'HOME', name: '', phone: '', flat: '', street: '', city: '', state: '', pincode: '', landmark: '' });
    } catch (err) {
      Alert.alert(t('login.error'), err?.response?.data?.error?.message || t('checkout.saveAddressError'));
    } finally {
      setSavingAddr(false);
    }
  }

  async function deleteAddress(id) {
    Alert.alert(t('checkout.deleteAddress'), t('checkout.deleteAddressMsg'), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await api.delete(`/addresses/${id}`);
            setAddresses(prev => prev.filter(a => a.id !== id));
            if (selectedAddr === id) setSelectedAddr(addresses.find(a => a.id !== id)?.id || null);
          } catch { Alert.alert(t('login.error'), t('checkout.deleteAddressError')); }
        }
      },
    ]);
  }

  async function placeOrder() {
    if (!selectedAddr) { Alert.alert(t('checkout.selectAddress'), t('checkout.selectAddressMsg')); return; }
    // A double-tap must not become two orders. The key is generated ONCE per
    // attempt and reused across the retry below, so the server's idempotency
    // middleware can recognise the second call as the same order.
    if (placing) return;
    setPlacing(true);

    try {
      // ── Re-quote immediately before ordering ────────────────────────────
      // This screen used to compute what it thought the total was:
      //
      //     cartItems.reduce((s, i) => s + i.product.price * i.quantity, 0)
      //
      // `product.price` is the DEPRECATED pre-split catalog column and is NULL
      // for any product that has been through the catalog split — the price
      // lives on the seller's listing. So that sum was NaN for split products,
      // and the server (correctly) rejected the checkout as a total mismatch.
      // The client no longer computes a total at all: it asks for the quote and
      // echoes it back, which is also what lets the server detect tampering.
      const fresh = await fetchCartQuote({
        paymentMethod: payMethod,
        pincode: selectedAddrObj?.pincode,
      });
      setQuote(fresh);

      if (fresh?.issues?.length) {
        const first = fresh.issues[0];
        Alert.alert(t('checkout.orderFailed'), first.message, [{ text: t('ok', 'OK') }]);
        setPlacing(false);
        return;
      }

      // ── ONLINE: raise a gateway order and open checkout ──────────────────
      // This branch did not exist. Every method — including UPI and Card — was
      // posted to /orders, which creates an order and never asks for money: the
      // farmer saw "Order Placed!" with a UPI badge and was charged nothing.
      if (payMethod !== 'cod') {
        if (!payCfg.onlineEnabled) {
          Alert.alert(
            t('checkout.onlineUnavailableTitle', 'Online payment unavailable'),
            t('checkout.onlineUnavailableMsg', 'Online payment is not available right now. Please choose Cash on Delivery.'),
          );
          setPayMethod('cod');
          setPlacing(false);
          return;
        }

        const intent = await initiatePayment({
          paymentMethod: payMethod,
          deliveryAddressId: selectedAddr,
          pincode: selectedAddrObj?.pincode,
          expectedTotal: Number(fresh.subtotal),
          expectedPayable: Number(fresh.total),
        });

        // Hand off to the sheet. `placing` stays true so the button cannot be
        // pressed again behind the modal.
        setRzp({
          orderId: intent.razorpayOrderId,
          amountPaise: intent.amountInPaise,
        });
        return;
      }

      // ── CASH ON DELIVERY ────────────────────────────────────────────────
      const { data } = await api.post(
        '/agristore/orders',
        {
          deliveryAddressId: selectedAddr,
          paymentMethod: payMethod,
          note: note.trim() || undefined,
          // Both are echoed from the quote: the goods subtotal (the field older
          // builds send) and the amount actually payable.
          expectedTotal: Number(fresh.subtotal),
          expectedPayable: Number(fresh.total),
        },
        { headers: { 'Idempotency-Key': idemKeyRef.current } },
      );

      navigation.replace('OrderConfirmed', {
        order: data.data,
        paymentMethod: payMethod,
        grandTotal: Number(data.data?.totalAmount ?? fresh.total),
      });
    } catch (err) {
      const info = classifyError(err);
      // A cancelled request is not a failure and must not raise an alert.
      if (!info) { setPlacing(false); return; }

      // The server returns the structured reason for a refused checkout — an
      // out-of-stock line, a price change, a blocked chemical, an unserviceable
      // PIN code. Showing that beats "order failed", which tells the farmer
      // nothing about what to change.
      const issues = info.issues;
      Alert.alert(
        t('checkout.orderFailed'),
        issues?.length ? issues.map((i) => i.message).join('\n\n') : info.message,
        [{ text: t('ok', 'OK') }],
      );
      // A new attempt is a new order, so it gets a new key. Without this, a
      // legitimate retry after fixing the cart would be swallowed as a duplicate.
      idemKeyRef.current = newIdempotencyKey();
    } finally {
      setPlacing(false);
    }
  }

  /** Razorpay verified the payment — turn it into an order. */
  async function handlePaymentSuccess(result) {
    setRzp(null);
    setVerifying(true);
    try {
      const order = await confirmPayment({
        razorpayOrderId: result.razorpayOrderId,
        razorpayPaymentId: result.razorpayPaymentId,
        razorpaySignature: result.razorpaySignature,
        deliveryAddressId: selectedAddr,
        expectedTotal: quote ? Number(quote.subtotal) : undefined,
        expectedPayable: quote ? Number(quote.total) : undefined,
      });
      navigation.replace('OrderConfirmed', {
        order,
        paymentMethod: payMethod,
        grandTotal: Number(order?.totalAmount ?? grandTotal),
      });
    } catch (err) {
      const info = classifyError(err);
      // The money has moved. Whatever went wrong now, the farmer must NOT be
      // told to pay again — the server keeps the payment intent and the
      // reconciler surfaces it for refund or fulfilment.
      Alert.alert(
        t('checkout.paymentTakenTitle', 'Payment received'),
        info?.message || t('checkout.paymentTakenMsg',
          'Your payment went through but we could not finish the order. Our team will contact you — please do not pay again.'),
        [{ text: t('ok', 'OK'), onPress: () => navigation.replace('Main') }],
      );
    } finally {
      setVerifying(false);
      setPlacing(false);
    }
  }

  /**
   * The farmer closed the sheet. THE PAYMENT MAY HAVE SUCCEEDED.
   *
   * This is the case that makes people pay twice: a UPI approval completes, the
   * app is backgrounded, the sheet closes without firing the handler. Treating
   * that as "cancelled" is how a farmer is charged and then charged again. Ask
   * the server what actually happened instead of guessing.
   */
  async function handlePaymentDismiss() {
    const providerOrderId = rzp?.orderId;
    setRzp(null);
    if (!providerOrderId) { setPlacing(false); return; }

    setVerifying(true);
    try {
      const status = await fetchPaymentStatus(providerOrderId);

      if (status?.orderId || status?.state === 'ORDER_CREATED') {
        navigation.replace('OrderConfirmed', {
          order: status.order, paymentMethod: payMethod, grandTotal,
        });
        return;
      }
      if (status?.state === 'CONFIRMING' || status?.state === 'PAID') {
        Alert.alert(
          t('checkout.paymentConfirmingTitle', 'Payment is being confirmed'),
          status.message || t('checkout.paymentConfirmingMsg',
            'Your payment has gone through and we are creating your order. Do not pay again — check My Orders in a few minutes.'),
          [{ text: t('ok', 'OK') }],
        );
        return;
      }
      // Genuinely not paid — safe to let them try again.
      Alert.alert(
        t('checkout.paymentCancelled', 'Payment cancelled'),
        t('checkout.paymentCancelledMsg', 'No money was taken. You can try again or choose Cash on Delivery.'),
      );
    } catch {
      // Could not reach the server to find out. Say exactly that rather than
      // claiming either outcome.
      Alert.alert(
        t('checkout.paymentUnknownTitle', 'We could not confirm your payment'),
        t('checkout.paymentUnknownMsg',
          'Please check My Orders before trying again, so you are not charged twice.'),
      );
    } finally {
      setVerifying(false);
      setPlacing(false);
    }
  }

  /** The gateway explicitly reported a failure — nothing was captured. */
  function handlePaymentFailure({ code, reason } = {}) {
    setRzp(null);
    setPlacing(false);
    // A new attempt is a new order, so it needs a new idempotency key.
    idemKeyRef.current = newIdempotencyKey();
    Alert.alert(
      t('checkout.paymentFailed', 'Payment failed'),
      code === 'SCRIPT_LOAD'
        ? t('checkout.paymentNoNetwork', 'Could not open the payment page. Check your internet connection and try again.')
        : (reason || t('checkout.paymentFailedMsg', 'No money was taken. Please try again or choose Cash on Delivery.')),
    );
  }

  function handleBack() {
    if (step > 1) setStep(s => s - 1);
    else navigation.goBack();
  }

  function handleContinue() {
    if (step === 1) {
      if (!selectedAddr && !showForm) { Alert.alert(t('checkout.selectAddress'), t('checkout.selectAddressMsg')); return; }
      if (showForm) { saveAddress(); return; }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else {
      placeOrder();
    }
  }

  const TYPE_OPTS = ['HOME', 'OFFICE', 'OTHER'];
  const ALL_PAY_OPTS = [
    { id: 'cod',  name: 'Cash on Delivery',    nameHi: 'कॅश ऑन डिलिव्हरी',  desc: 'Pay when you receive',     icon: 'cash-outline',          iconBg: COLORS.successLight, iconColor: COLORS.greenBright },
    { id: 'upi',  name: 'UPI Payment',          nameHi: 'UPI पेमेंट',           desc: 'GPay, PhonePe, Paytm',    icon: 'phone-portrait-outline', iconBg: COLORS.blueBg, iconColor: COLORS.blue },
    { id: 'card', name: 'Credit / Debit Card',  nameHi: 'क्रेडिट / डेबिट कार्ड', desc: 'Visa, Mastercard, RuPay', icon: 'card-outline',           iconBg: COLORS.orangeBg, iconColor: COLORS.cta },
  ];
  // Only what the SERVER says it can collect with. UPI and Card were previously
  // shown unconditionally and posted to an endpoint that takes no money.
  const PAY_OPTS = ALL_PAY_OPTS.filter((o) => payCfg.methods?.includes(o.id));

  const ctaLabel = step === 1 ? (showForm ? (savingAddr ? 'Saving...' : 'Save & Continue') : 'Continue') :
                   step === 2 ? 'Proceed to Payment' :
                   (placing || verifying)
                     ? (verifying ? 'Confirming payment...' : (payMethod === 'cod' ? 'Placing Order...' : 'Opening payment...'))
                     : (payMethod === 'cod' ? 'Place Order' : `Pay ${inr(grandTotal)}`);

  return (
    <AnimatedScreen>
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.surface} />
      <View style={{ height: insets.top, backgroundColor: COLORS.surface }} />

      {/* Stepper header */}
      <StepHeader step={step} onBack={handleBack} />

      {/* ── Content ── */}
      <View style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="none"
          showsVerticalScrollIndicator={false}
        >

          {/* ════ STEP 1: ADDRESS ════ */}
          {step === 1 && (
            <>
              <Text style={ST.sectionTitle}>{t('checkout.deliveryAddress')}</Text>
              <Text style={ST.sectionSub}>डिलिव्हरी पत्ता निवडा</Text>

              {/* Saved address cards */}
              {addresses.map((addr, i) => (
                <AddrCard
                  key={addr.id}
                  addr={addr}
                  selected={selectedAddr === addr.id && !showForm}
                  onSelect={(id) => { setSelectedAddr(id); setShowForm(false); }}
                  onDelete={deleteAddress}
                  delay={i * 80}
                  t={t}
                />
              ))}

              {/* Add new address card (dashed) */}
              {!showForm && (
                <SlideCard delay={addresses.length * 80} style={{ borderStyle: 'dashed', borderWidth: 2, borderColor: COLORS.primary + '50', backgroundColor: GREEN_CARD_BG }}>
                  <TouchableOpacity onPress={() => setShowForm(true)} activeOpacity={0.85}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <IconCircle name="add" size={20} color={COLORS.primary} bg={GREEN_B} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.primary }}>{t('checkout.addNewAddress')}</Text>
                        <Text style={{ fontSize: 12, color: COLORS.textMedium, marginTop: 1 }}>नवीन पत्ता जोडा</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
                    </View>
                  </TouchableOpacity>
                </SlideCard>
              )}

              {/* Inline form */}
              {showForm && (
                <SlideCard>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: COLORS.textDark }}>{t('checkout.newAddress')}</Text>
                    <TouchableOpacity onPress={() => setShowForm(false)}>
                      <Ionicons name="close-circle" size={22} color={COLORS.textMedium} />
                    </TouchableOpacity>
                  </View>

                  {/* Type chips */}
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                    {TYPE_OPTS.map(tp => (
                      <TouchableOpacity
                        key={tp}
                        onPress={() => upd('type', tp)}
                        style={[ST.typeChip, form.type === tp && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]}
                      >
                        <Ionicons name={TYPE_ICON[tp]} size={13} color={form.type === tp ? COLORS.white : COLORS.textMedium} />
                        <Text style={[ST.typeChipTxt, form.type === tp && { color: COLORS.white }]}>{tp}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <FInput label={t('checkout.fullName')} req style={{ flex: 1 }} value={form.name} onChangeText={v => upd('name', v)}
                      returnKeyType="next" onSubmitEditing={() => phoneRef.current?.focus()} />
                    <FInput label={t('checkout.mobileNumber')} req style={{ flex: 1 }} value={form.phone} onChangeText={v => upd('phone', v)}
                      keyboardType="phone-pad" ref={phoneRef} onSubmitEditing={() => flatRef.current?.focus()} />
                  </View>
                  <FInput label={t('checkout.flat')} req value={form.flat} onChangeText={v => upd('flat', v)}
                    ref={flatRef} onSubmitEditing={() => streetRef.current?.focus()} />
                  <FInput label={t('checkout.street')} req value={form.street} onChangeText={v => upd('street', v)}
                    ref={streetRef} onSubmitEditing={() => cityRef.current?.focus()} />
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <FInput label={t('checkout.city')} req style={{ flex: 1 }} value={form.city} onChangeText={v => upd('city', v)}
                      ref={cityRef} onSubmitEditing={() => stateRef.current?.focus()} />
                    <FInput label={t('checkout.state')} req style={{ flex: 1 }} value={form.state} onChangeText={v => upd('state', v)}
                      ref={stateRef} onSubmitEditing={() => pincodeRef.current?.focus()} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <FInput label={t('checkout.pincode')} req style={{ flex: 1 }} value={form.pincode} onChangeText={v => upd('pincode', v)}
                      keyboardType="number-pad" ref={pincodeRef} onSubmitEditing={() => landmarkRef.current?.focus()} />
                    <FInput label={t('checkout.landmark')} style={{ flex: 1 }} value={form.landmark} onChangeText={v => upd('landmark', v)}
                      ref={landmarkRef} returnKeyType="done" />
                  </View>
                </SlideCard>
              )}
            </>
          )}

          {/* ════ STEP 2: ORDER SUMMARY ════ */}
          {step === 2 && (
            <>
              {/* Deliver to card */}
              <SlideCard delay={0}>
                <CardHead icon="location-outline" title={t('checkout.deliverTo')}
                  right={
                    <TouchableOpacity onPress={() => setAddrSheet(true)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 }}>
                      <Ionicons name="create-outline" size={13} color={COLORS.primary} />
                      <Text style={{ fontSize: 12, color: COLORS.primary, fontWeight: '700' }}>{t('checkout.change')}</Text>
                    </TouchableOpacity>
                  }
                />
                <View style={{ marginLeft: 52 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: COLORS.textDark }}>{selectedAddrObj?.name}</Text>
                    <View style={{ backgroundColor: GREEN_BG, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: COLORS.primary }}>{selectedAddrObj?.type}</Text>
                    </View>
                  </View>
                  {/* `addrLine` already ends with the pincode, so appending it
                      again rendered "Pune, Maharashtra, 411005 — 411005" on the
                      order summary. Fixed here rather than in `addrLine`, whose
                      three other callers render it standalone and DO need the
                      pincode in the string. */}
                  <Text style={{ fontSize: 13, color: COLORS.textMedium, lineHeight: 18 }}>{addrLine(selectedAddrObj)}</Text>
                  <Text style={{ fontSize: 13, color: COLORS.textMedium, marginTop: 2 }}>{selectedAddrObj?.phone}</Text>
                </View>
              </SlideCard>

              {/* Order items */}
              <SlideCard delay={100}>
                <CardHead icon="cube-outline" title={`Order Items (${cartItems.length})`} />
                {cartItems.map((item, i) => {
                  // Post-split, the PRICE and the seller's own photographs live
                  // on the listing; `item.product` is the shared catalog row and
                  // its `price` column is deprecated and NULL for any migrated
                  // product. Reading it here rendered "₹" with nothing after it,
                  // and `p.price * qty` rendered NaN.
                  const listing = item.listing || null;
                  const p = listing?.variant?.product || item.product || {};
                  const unitPrice = Number(listing?.sellingPrice ?? item.unitPrice ?? item.product?.price ?? 0);
                  const image = thumbUrl(listing?.images?.[0] || p.images?.[0], 160);
                  return (
                    <View key={item.id}
                      style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
                        i < cartItems.length - 1 && { borderBottomWidth: 1, borderBottomColor: COLORS.border }]}>
                      <View style={{ width: 60, height: 60, borderRadius: 12, backgroundColor: COLORS.background, overflow: 'hidden' }}>
                        {image
                          ? <Image source={{ uri: image }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                          : <PhotoIcon set="placeholders" name="product" fill radius={12}
                              fallback={<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Ionicons name="leaf" size={24} color={COLORS.primary} /></View>} />
                        }
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.textDark }} numberOfLines={1}>{p.name}</Text>
                        <Text style={{ fontSize: 12, color: COLORS.textMedium, marginTop: 2 }}>
                          {item.quantity} × {inr(unitPrice)}
                          {listing?.seller?.name ? ` · ${listing.seller.name}` : ''}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 15, fontWeight: '800', color: COLORS.textDark }}>{inr(unitPrice * item.quantity)}</Text>
                    </View>
                  );
                })}
              </SlideCard>

              {/* Price details */}
              <SlideCard delay={200}>
                <CardHead icon="receipt-outline" title={t('checkout.priceDetails')} />
                {/* Every row below is the SERVER's number. This block used to
                    show a client-computed subtotal plus a hard-coded ₹49 that
                    the order never recorded. */}
                <PRow label={`Items (${quote?.unitCount ?? cartItems.reduce((s, i) => s + i.quantity, 0)})`} value={inr(total)} />
                <PRow
                  label={
                    quote?.shipmentCount > 1
                      ? t('checkout.deliveryShipments', { count: quote.shipmentCount, defaultValue: `Delivery (${quote.shipmentCount} shipments)` })
                      : t('checkout.delivery')
                  }
                  value={delivery === 0 ? t('free') : inr(delivery)}
                  green={delivery === 0}
                />
                {taxAmount > 0 && (
                  <PRow
                    label={quote?.taxIncludedInPrice ? t('cart.taxIncluded', 'GST (included)') : t('cart.tax', 'GST')}
                    value={inr(taxAmount)}
                  />
                )}
                <View style={{ borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 4, paddingTop: 12 }}>
                  <PRow label={t('cart.totalPayable')} value={inr(grandTotal)} bold />
                </View>

                {/* The delivery promise recorded on the order, so the farmer and
                    the platform are looking at the same commitment. */}
                {quote?.promisedEtaMaxDays ? (
                  <Text style={{ fontSize: 12, color: COLORS.textMedium, marginTop: 10 }}>
                    <Ionicons name="time-outline" size={12} color={COLORS.textMedium} />{' '}
                    {t('checkout.etaNote', {
                      count: quote.promisedEtaMaxDays,
                      defaultValue: `Expected delivery within ${quote.promisedEtaMaxDays} days`,
                    })}
                  </Text>
                ) : null}

                {quoteError ? (
                  <Text style={{ fontSize: 12, color: COLORS.error, marginTop: 8 }}>
                    {t('checkout.quoteStale', 'Could not refresh the total. It will be confirmed when you place the order.')}
                  </Text>
                ) : null}
              </SlideCard>
            </>
          )}

          {/* ════ STEP 3: PAYMENT ════ */}
          {step === 3 && (
            <>
              {/* Address mini card */}
              <SlideCard delay={0}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <IconCircle name="home-outline" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.textDark }}>{selectedAddrObj?.name}</Text>
                    <Text style={{ fontSize: 12, color: COLORS.textMedium, marginTop: 1 }} numberOfLines={1}>{addrLine(selectedAddrObj)?.substring(0, 32)}...</Text>
                  </View>
                  <TouchableOpacity onPress={() => setAddrSheet(true)}
                    style={{ borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
                    <Text style={{ fontSize: 12, color: COLORS.primary, fontWeight: '700' }}>{t('checkout.change')}</Text>
                  </TouchableOpacity>
                </View>
              </SlideCard>

              {/* Payment methods */}
              <SlideCard delay={100}>
                <CardHead icon="card-outline" title={t('checkout.paymentMethod')} />
                {PAY_OPTS.map((opt, i) => (
                  <PayOption key={opt.id} {...opt} selected={payMethod === opt.id} onSelect={setPayMethod} delay={i * 60} />
                ))}
                {/* Said plainly rather than silently showing one option, so the
                    farmer knows online payment is unavailable right now — not
                    that this shop never accepts it. */}
                {!payCfg.onlineEnabled ? (
                  <Text style={{ fontSize: 12, color: COLORS.textMedium, marginTop: 10, lineHeight: 17 }}>
                    {t('checkout.onlineComingSoon', 'Online payment is not available right now. You can pay cash on delivery.')}
                  </Text>
                ) : null}
              </SlideCard>

              {/* Order notes */}
              <SlideCard delay={200}>
                <CardHead icon="chatbubble-outline" title={t('checkout.orderNotes')} />
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder={t('checkout.notesPlaceholder')}
                  placeholderTextColor={COLORS.silver}
                  multiline
                  numberOfLines={3}
                  style={{
                    backgroundColor: COLORS.background, borderRadius: 14, padding: 13,
                    fontSize: 14, color: COLORS.textDark, minHeight: 80, textAlignVertical: 'top',
                  }}
                  keyboardShouldPersistTaps="always"
                />
              </SlideCard>

              {/* Total payable card */}
              <SlideCard delay={300} style={{ backgroundColor: GREEN_CARD_BG, borderColor: COLORS.primary + '40' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.textDark }}>{t('cart.totalPayable')}</Text>
                  <Text style={{ fontSize: 24, fontWeight: '900', color: COLORS.primary }}>{inr(grandTotal)}</Text>
                </View>
              </SlideCard>
            </>
          )}

        </ScrollView>
      </View>

      {/* ── Bottom action bar ── */}
      <View style={[BOT.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {/* Delivering to / total */}
        {step === 1 && !showForm && selectedAddrObj && (
          <TouchableOpacity onPress={() => setAddrSheet(true)} activeOpacity={0.7}>
            <Text style={{ fontSize: 11, color: COLORS.textMedium }}>Delivering to  ›</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.textDark }} numberOfLines={1}>{selectedAddrObj.name}</Text>
          </TouchableOpacity>
        )}
        {(step === 2 || step === 3) && (
          <View>
            <Text style={{ fontSize: 20, fontWeight: '900', color: COLORS.primary }}>{inr(grandTotal)}</Text>
            <Text style={{ fontSize: 11, color: COLORS.textMedium, marginTop: 1 }}>
              {step === 3 ? (payMethod === 'cod' ? 'Cash on Delivery' : payMethod === 'upi' ? 'UPI' : 'Card') : `${cartItems.reduce((s, i) => s + i.quantity, 0)} items`}
            </Text>
          </View>
        )}
        {step === 1 && showForm && <View />}

        <PressScale onPress={handleContinue} down={0.96} style={BOT.ctaWrap}>
          <View style={BOT.ctaGrad}>
            {placing || savingAddr
              ? <ActivityIndicator size="small" color={COLORS.white} />
              : <>
                  <Text style={BOT.ctaTxt}>{ctaLabel}</Text>
                  {step < 3 && <Ionicons name="arrow-forward" size={17} color={COLORS.white} />}
                  {step === 3 && <Ionicons name="checkmark" size={17} color={COLORS.white} />}
                </>
            }
          </View>
        </PressScale>
      </View>
      {/* ── Razorpay checkout ──────────────────────────────────────────────
          Only ever opened with a gateway ORDER ID minted server-side, so the
          amount cannot be set from here. The signature it returns is re-verified
          against the secret key on /orders/confirm. */}
      <RazorpayCheckout
        visible={!!rzp}
        keyId={payCfg.keyId}
        orderId={rzp?.orderId}
        amountPaise={rzp?.amountPaise}
        buyerName={selectedAddrObj?.name}
        buyerPhone={selectedAddrObj?.phone}
        description={`${quote?.itemCount ?? cartItems.length} item(s) · KrushiSarva`}
        onSuccess={handlePaymentSuccess}
        onDismiss={handlePaymentDismiss}
        onFailure={handlePaymentFailure}
      />

      {/* Blocking overlay while the server verifies — the farmer must not be
          able to start a second payment during this window. */}
      {verifying ? (
        <Modal visible transparent animationType="fade">
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ backgroundColor: COLORS.surface, borderRadius: 16, padding: 28, alignItems: 'center', gap: 14, marginHorizontal: 40 }}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.textDark, textAlign: 'center' }}>
                {t('checkout.confirmingPayment', 'Confirming your payment')}
              </Text>
              <Text style={{ fontSize: 13, color: COLORS.textMedium, textAlign: 'center', lineHeight: 19 }}>
                {t('checkout.doNotClose', 'Please do not close the app or pay again.')}
              </Text>
            </View>
          </View>
        </Modal>
      ) : null}

      {/* ── Address Picker Bottom Sheet ── */}
      <Modal
        visible={addrSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setAddrSheet(false)}
      >
        <View style={{ flex: 1 }}>
          <TouchableOpacity
            style={SH2.backdrop}
            activeOpacity={1}
            onPress={() => setAddrSheet(false)}
          />
          <View style={SH2.sheet}>
            <View style={SH2.handle} />
            <Text style={SH2.title}>{t('checkout.deliveryAddress')}</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 400 }}>
              {addresses.map(addr => (
                <TouchableOpacity
                  key={addr.id}
                  style={[SH2.addrCard, selectedAddr === addr.id && SH2.addrCardActive]}
                  onPress={() => { setSelectedAddr(addr.id); setAddrSheet(false); }}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <View style={[SH2.typeBadge, { backgroundColor: TYPE_COLOR[addr.type] + '20' }]}>
                        <Ionicons name={TYPE_ICON[addr.type]} size={11} color={TYPE_COLOR[addr.type]} />
                        <Text style={[SH2.typeTxt, { color: TYPE_COLOR[addr.type] }]}>{addr.type}</Text>
                      </View>
                      {addr.isDefault && (
                        <View style={SH2.defaultBadge}>
                          <Text style={SH2.defaultTxt}>{t('product.defaultBadge')}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={SH2.addrName}>{addr.name}</Text>
                    <Text style={SH2.addrLine} numberOfLines={2}>{addrLine(addr)}</Text>
                    <Text style={SH2.addrPhone}>{addr.phone}</Text>
                  </View>
                  <View style={[SH2.radioOuter, selectedAddr === addr.id && { borderColor: COLORS.primary }]}>
                    {selectedAddr === addr.id && <View style={SH2.radioDot} />}
                  </View>
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                style={SH2.addNew}
                onPress={() => {
                  setAddrSheet(false);
                  setShowForm(true);
                  if (step !== 1) setStep(1);
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="add-circle-outline" size={20} color={COLORS.primary} />
                <Text style={SH2.addNewTxt}>{t('checkout.addNewAddress')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
    </AnimatedScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const ST = StyleSheet.create({
  sectionTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textDark, marginBottom: 4 },
  sectionSub:   { fontSize: 13, color: COLORS.textMedium, marginBottom: 16 },
  typeChip:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.background },
  typeChipTxt:  { fontSize: 12, fontWeight: '700', color: COLORS.textMedium },
});

const BOT = StyleSheet.create({
  bar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.08, shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 }, elevation: 12,
  },
  ctaWrap: { borderRadius: 14, overflow: 'hidden' },
  ctaGrad: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, paddingVertical: 14, backgroundColor: COLORS.primary },
  ctaTxt:  { color: COLORS.white, fontSize: 15, fontWeight: '700' },
});

const SH2 = StyleSheet.create({
  backdrop:      { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:         { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingBottom: 32, paddingTop: 10 },
  handle:        { width: 40, height: 4, backgroundColor: COLORS.gray150, borderRadius: 99, alignSelf: 'center', marginBottom: 14 },
  title:         { fontSize: 16, fontWeight: '800', color: COLORS.textDark, marginBottom: 14 },
  addrCard:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1.5, borderColor: COLORS.border, marginBottom: 10, backgroundColor: COLORS.surfaceRaised },
  addrCardActive:{ borderColor: COLORS.primary, backgroundColor: GREEN_BG },
  typeBadge:     { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  typeTxt:       { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  defaultBadge:  { backgroundColor: COLORS.yellowWarm, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 },
  defaultTxt:    { fontSize: 9, fontWeight: '700', color: COLORS.yellowDark2 },
  addrName:      { fontSize: 14, fontWeight: '700', color: COLORS.textDark, marginBottom: 2 },
  addrLine:      { fontSize: 12, color: COLORS.textMedium, lineHeight: 17 },
  addrPhone:     { fontSize: 11, color: COLORS.textMedium, marginTop: 2 },
  radioOuter:    { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: COLORS.border, justifyContent: 'center', alignItems: 'center' },
  radioDot:      { width: 11, height: 11, borderRadius: 6, backgroundColor: COLORS.primary },
  addNew:        { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLORS.primary + '60', backgroundColor: GREEN_BG, marginBottom: 4 },
  addNewTxt:     { fontSize: 14, fontWeight: '700', color: COLORS.primary },
});

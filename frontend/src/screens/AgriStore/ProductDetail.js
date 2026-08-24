import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, Image, ActivityIndicator, Dimensions, Animated,
  FlatList, TextInput, Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SHADOWS } from '@krushisarva/shared/constants/colors';
import api from '@krushisarva/shared/services/api';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import { useCart } from '../../context/CartContext';
import AnimatedScreen from '@krushisarva/shared/components/ui/AnimatedScreen';
import MockImagePlaceholder from '../../components/MockImagePlaceholder';
import { SkeletonDetail } from '../../components/ui/Skeleton';
import OfferListSheet from './OfferListSheet';
import { fs } from '../../utils/responsive';
import {
  checkServiceability, classifyError, inr, discountPct, thumbUrl, detailImageUrl,
} from './shopClient';


// ── Spring press wrapper ──────────────────────────────────────────────────────
function PressScale({ children, style, onPress, scaleTo = 0.96 }) {
  const sc = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[style, { transform: [{ scale: sc }] }]}>
      <TouchableOpacity
        activeOpacity={1}
        onPressIn={() =>
          Animated.spring(sc, { toValue: scaleTo, useNativeDriver: true, tension: 300, friction: 10 }).start()
        }
        onPressOut={() =>
          Animated.spring(sc, { toValue: 1, useNativeDriver: true, tension: 300, friction: 10 }).start()
        }
        onPress={onPress}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Collapsible card ──────────────────────────────────────────────────────────
function Collapsible({ title, icon, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const rot = useRef(new Animated.Value(defaultOpen ? 1 : 0)).current;

  const toggle = () => {
    Animated.spring(rot, { toValue: open ? 0 : 1, useNativeDriver: true, tension: 200, friction: 20 }).start();
    setOpen(v => !v);
  };

  const rotate = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <View style={S.collapseCard}>
      <TouchableOpacity style={S.collapseHead} onPress={toggle} activeOpacity={0.85}>
        <View style={S.collapseLeft}>
          <View style={S.collapseIconCircle}>
            <Ionicons name={icon} size={16} color={COLORS.primary} />
          </View>
          <Text style={S.collapseTitle}>{title}</Text>
        </View>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="chevron-down" size={20} color={COLORS.textMedium} />
        </Animated.View>
      </TouchableOpacity>
      {open && <View style={S.collapseBody}>{children}</View>}
    </View>
  );
}

// ── Spec table row ────────────────────────────────────────────────────────────
function SpecRow({ label, value, last }) {
  return (
    <View style={[S.specRow, last && { borderBottomWidth: 0 }]}>
      <Text style={S.specLabel}>{label}</Text>
      <Text style={S.specValue}>{value}</Text>
    </View>
  );
}

// ── Coming-soon placeholder card ──────────────────────────────────────────────
// Used in place of the previous fake delivery / trust-badge sections. Same
// section-card padding so it visually slots in cleanly.
function ComingSoonCard({ icon, title, subtitle }) {
  const { t } = useLanguage();
  return (
    <View style={S.sectionCard}>
      <View style={S.comingRow}>
        <View style={S.comingIconCircle}>
          <Ionicons name={icon || 'time-outline'} size={18} color={COLORS.textMedium} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={S.comingTitleRow}>
            <Text style={S.comingTitle} numberOfLines={1}>{title}</Text>
            <View style={S.comingPill}>
              <Text style={S.comingPillTxt}>{t('ai.comingSoon')}</Text>
            </View>
          </View>
          {!!subtitle && <Text style={S.comingSub}>{subtitle}</Text>}
        </View>
      </View>
    </View>
  );
}

// ── Chemical safety panel ─────────────────────────────────────────────────────
/**
 * Approved-label information for a regulated agricultural chemical.
 *
 * Every string rendered here was transcribed from the manufacturer's approved
 * label and checked by a reviewer before the product could be published. This
 * component does not derive, summarise, complete or generate ANY of it:
 *
 *   - a missing section renders as "not supplied", never as generic advice;
 *   - approved crops and target pests are the label's list, shown as the label's
 *     list, and are explicitly NOT a recommendation for this farmer's field;
 *   - there is no mixing guidance of any kind, because no combination here has
 *     been verified as permitted;
 *   - the standing notice pointing at the label and at a qualified agriculture
 *     professional is always shown, not just when a section is missing.
 */
function SafetyPanel({ safety, recall }) {
  const { t } = useLanguage();
  if (!safety) return null;

  const Section = ({ icon, title, children }) => (
    <View style={S.safetySection}>
      <View style={S.safetyHeadRow}>
        <Ionicons name={icon} size={15} color={COLORS.error} />
        <Text style={S.safetyHeadTxt}>{title}</Text>
      </View>
      {children}
    </View>
  );

  const Missing = () => (
    <Text style={S.safetyMissing}>
      {t('safety.notSupplied', 'Not supplied by the manufacturer. Read the printed label on the pack.')}
    </Text>
  );

  return (
    <View style={S.safetyCard}>
      {/* An active recall is the first thing on the page, above the label. */}
      {recall?.active ? (
        <View style={S.recallBox}>
          <Ionicons name="alert-circle" size={18} color={COLORS.white} />
          <View style={{ flex: 1 }}>
            <Text style={S.recallTitle}>{t('safety.recalled', 'This product has been recalled')}</Text>
            <Text style={S.recallTxt}>{recall.reason}</Text>
            {recall.advice ? <Text style={S.recallTxt}>{recall.advice}</Text> : null}
          </View>
        </View>
      ) : null}

      <View style={S.safetyTitleRow}>
        <Ionicons name="shield-checkmark-outline" size={18} color={COLORS.error} />
        <Text style={S.safetyTitle}>{t('safety.title', 'Safety and label information')}</Text>
      </View>

      {/* Provenance, stated up front. The farmer should know this is the label
          talking, not the app. */}
      <Text style={S.safetyProvenance}>
        {t('safety.fromLabel', 'Taken from the approved manufacturer label.')}
        {safety.labelVersion ? ` (${safety.labelVersion})` : ''}
      </Text>

      <View style={S.safetyGrid}>
        {safety.activeIngredient ? (
          <View style={S.safetyCell}>
            <Text style={S.safetyCellLabel}>{t('safety.activeIngredient', 'Active ingredient')}</Text>
            <Text style={S.safetyCellValue}>{safety.activeIngredient}</Text>
          </View>
        ) : null}
        {safety.concentration ? (
          <View style={S.safetyCell}>
            <Text style={S.safetyCellLabel}>{t('safety.concentration', 'Concentration')}</Text>
            <Text style={S.safetyCellValue}>{safety.concentration}</Text>
          </View>
        ) : null}
        {safety.formulation ? (
          <View style={S.safetyCell}>
            <Text style={S.safetyCellLabel}>{t('safety.formulation', 'Formulation')}</Text>
            <Text style={S.safetyCellValue}>{safety.formulation}</Text>
          </View>
        ) : null}
        {safety.registrationNumber ? (
          <View style={S.safetyCell}>
            <Text style={S.safetyCellLabel}>
              {t('safety.registration', 'Registration no.')}
              {safety.registrationAuthority ? ` (${safety.registrationAuthority})` : ''}
            </Text>
            <Text style={S.safetyCellValue}>{safety.registrationNumber}</Text>
          </View>
        ) : null}
      </View>

      <Section icon="shirt-outline" title={t('safety.equipment', 'Protective equipment required')}>
        {safety.safetyEquipment?.length
          ? safety.safetyEquipment.map((e, i) => (
              <View key={i} style={S.safetyBullet}>
                <View style={S.safetyDot} />
                <Text style={S.safetyBulletTxt}>{e}</Text>
              </View>
            ))
          : <Missing />}
      </Section>

      {/* The label's approved list — NOT a prescription for this farm. Said
          plainly, because a list of crops under a photo reads as advice. */}
      <Section icon="leaf-outline" title={t('safety.approvedFor', 'Approved on the label for')}>
        {safety.approvedCrops?.length ? (
          <>
            <Text style={S.safetyBody}>{safety.approvedCrops.join(', ')}</Text>
            {safety.targetPests?.length ? (
              <Text style={S.safetyBody}>
                {t('safety.targetPests', 'Target pests')}: {safety.targetPests.join(', ')}
              </Text>
            ) : null}
            <Text style={S.safetyCaveat}>
              {t('safety.notPrescription', 'This is what the label lists — not a recommendation for your crop. Ask a qualified agriculture officer before using it.')}
            </Text>
          </>
        ) : <Missing />}
      </Section>

      <Section icon="water-outline" title={t('safety.dosage', 'Dosage on the label')}>
        {safety.dosageText ? <Text style={S.safetyBody}>{safety.dosageText}</Text> : <Missing />}
      </Section>

      <Section icon="cube-outline" title={t('safety.storage', 'Storage')}>
        {safety.storageInstructions ? <Text style={S.safetyBody}>{safety.storageInstructions}</Text> : <Missing />}
      </Section>

      <Section icon="medkit-outline" title={t('safety.firstAid', 'First aid')}>
        {safety.firstAidText ? <Text style={S.safetyBody}>{safety.firstAidText}</Text> : <Missing />}
      </Section>

      {safety.precautionText ? (
        <Section icon="warning-outline" title={t('safety.precautions', 'Precautions')}>
          <Text style={S.safetyBody}>{safety.precautionText}</Text>
        </Section>
      ) : null}

      {/* The standing notice, from settings, always shown. */}
      {safety.safetyNotice ? (
        <View style={S.safetyNoticeBox}>
          <Ionicons name="information-circle-outline" size={16} color={COLORS.textBody} />
          <Text style={S.safetyNoticeTxt}>{safety.safetyNotice}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Delivery / PIN-code check ─────────────────────────────────────────────────
/**
 * "Will it reach my village, and when?"
 *
 * This card replaces a "Delivery — coming soon" placeholder. The answer comes
 * from the seller's declared service areas via the backend; the app never
 * guesses a delivery date.
 */
function DeliveryCheck({ productId, defaultPincode }) {
  const { t } = useLanguage();
  const [pin, setPin] = useState(defaultPincode || '');
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState(null);

  const check = useCallback(async () => {
    if (!/^[1-9][0-9]{5}$/.test(pin)) {
      setErr(t('shop.invalidPincode', 'Enter a valid 6-digit PIN code.'));
      setResult(null);
      return;
    }
    setErr(null); setChecking(true);
    try {
      const data = await checkServiceability(productId, pin);
      setResult(data);
    } catch (e) {
      const info = classifyError(e);
      if (info) setErr(info.message);
    } finally {
      setChecking(false);
    }
  }, [pin, productId, t]);

  return (
    <View style={S.sectionCard}>
      <View style={S.deliveryHeadRow}>
        <Ionicons name="location-outline" size={18} color={COLORS.primary} />
        <Text style={S.sectionTitle}>{t('product.deliveryCheck', 'Check delivery')}</Text>
      </View>
      <View style={S.pinRow}>
        <TextInput
          style={S.pinInput}
          value={pin}
          onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))}
          placeholder={t('product.enterPincode', 'Enter PIN code')}
          placeholderTextColor={COLORS.textMedium}
          keyboardType="number-pad"
          maxLength={6}
          accessibilityLabel={t('product.enterPincode', 'Enter PIN code')}
          returnKeyType="done"
          onSubmitEditing={check}
        />
        <TouchableOpacity style={S.pinBtn} onPress={check} disabled={checking} accessibilityRole="button">
          {checking
            ? <ActivityIndicator size="small" color={COLORS.white} />
            : <Text style={S.pinBtnTxt}>{t('product.check', 'Check')}</Text>}
        </TouchableOpacity>
      </View>

      {err ? <Text style={S.pinError}>{err}</Text> : null}

      {result?.serviceable ? (
        <View style={S.pinResultOk}>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.primary} />
          <Text style={S.pinResultTxt}>
            {t('product.deliversIn', {
              min: result.etaMinDays, max: result.etaMaxDays,
              defaultValue: `Delivery in ${result.etaMinDays}–${result.etaMaxDays} days`,
            })}
            {result.codAvailable ? ` · ${t('product.codAvailable', 'Cash on delivery available')}` : ''}
          </Text>
        </View>
      ) : null}

      {result && result.serviceable === false ? (
        <View style={S.pinResultBad}>
          <Ionicons name="close-circle" size={16} color={COLORS.error} />
          <Text style={[S.pinResultTxt, { color: COLORS.error }]}>
            {result.reason === 'NO_SELLERS'
              ? t('product.noSellersHere', 'No seller has this product in stock right now.')
              : t('product.notDeliverable', 'No seller delivers to this PIN code yet. Try another PIN code.')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Similar product card ──────────────────────────────────────────────────────
function SimilarCard({ item, onPress }) {
  const sc   = useRef(new Animated.Value(1)).current;
  const disc = discountPct(item.mrp, item.price);
  return (
    <Animated.View style={[S.simCard, { transform: [{ scale: sc }] }]}>
      <TouchableOpacity
        activeOpacity={1}
        onPressIn={() => Animated.spring(sc, { toValue: 0.95, useNativeDriver: true, tension: 300, friction: 10 }).start()}
        onPressOut={() => Animated.spring(sc, { toValue: 1,    useNativeDriver: true, tension: 300, friction: 10 }).start()}
        onPress={() => onPress(item)}
      >
        <View style={S.simImgBox}>
          {item.images?.[0]
            ? <Image source={{ uri: thumbUrl(item.images[0], 320) }} style={S.simImg} resizeMode="cover" />
            : <View style={[S.simImg, S.simImgPlaceholder]}><MockImagePlaceholder category={item.category || item.categoryId} size={130} /></View>
          }
          {disc > 0 && (
            <View style={S.simDiscBadge}>
              <Text style={S.simDiscTxt}>{disc}%{'\n'}OFF</Text>
            </View>
          )}
        </View>
        <View style={S.simInfo}>
          <Text style={S.simName} numberOfLines={2}>{item.name}</Text>
          <Text style={S.simPrice}>{inr(item.price)}</Text>
          {item.mrp > item.price && (
            <Text style={S.simMrp}>{inr(item.mrp)}</Text>
          )}
          {item.rating > 0 && (
            <View style={S.simRating}>
              <Text style={S.simRatingTxt}>{item.rating} </Text>
              <Ionicons name="star" size={9} color={COLORS.white} />
            </View>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProductDetail({ route, navigation }) {
  const { t }       = useLanguage();
  const insets      = useSafeAreaInsets();

  // ── Route params carry the CATALOG product, never a listing ────────────────
  // Navigation still passes the whole product object (AgriStoreHome does it from
  // a card), so it is used as the first paint. But an id-based REFETCH is now
  // mandatory, not optional: switching between sellers' offers has to re-resolve
  // price and stock, and a screen with no fetch can only ever show whatever the
  // list screen happened to have cached.
  const routeProduct = route.params?.product || null;
  const productId    = route.params?.productId || routeProduct?.id;
  const buyerDistrict = route.params?.district || null;

  const [detail,      setDetail]      = useState(routeProduct);
  const [loading,     setLoading]     = useState(!routeProduct);
  const [offer,       setOffer]       = useState(null);   // the chosen seller's offer
  const [variants,    setVariants]    = useState([]);
  const [variantId,   setVariantId]   = useState(null);
  const [offersOpen,  setOffersOpen]  = useState(false);
  const [addingId,    setAddingId]    = useState(null);

  const [quantity,    setQuantity]    = useState(1);
  const [imgIdx,      setImgIdx]      = useState(0);
  const [adding,      setAdding]      = useState(false);
  const [similar,     setSimilar]     = useState([]);

  const product = detail || routeProduct || {};

  // Default tab: 'spec' if specs exist, else 'mfr'
  const hasSpecs = !!(product.specifications && Object.keys(product.specifications).length > 0);
  const [activeTab, setActiveTab] = useState(hasSpecs ? 'spec' : 'mfr');

  const fadeIn   = useRef(new Animated.Value(0)).current;
  const slideUp  = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn,  { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(slideUp, { toValue: 0, tension: 100, friction: 14, useNativeDriver: true }),
    ]).start();

    const catId = product.category?.id || product.categoryId;
    if (catId) {
      // The parameter is `category`, not `categoryId`.
      //
      // /agristore/products reads `req.query.category`; `categoryId` was silently
      // ignored by express-validator and by the handler, so "Similar Products"
      // was fetching the FIRST 10 ROWS OF THE WHOLE CATALOGUE — a paddy seed
      // page recommending a sprayer — and paying for the payload to do it.
      // `district` matters for the same reason it does everywhere else: a
      // recommendation from a seller who cannot deliver here is not a
      // recommendation.
      api.get('/agristore/products', {
        params: { category: catId, limit: 10, ...(buyerDistrict ? { district: buyerDistrict } : {}) },
      })
        .then(res => {
          const list = (res.data?.data || []).filter(p => p.id !== productId);
          setSimilar(list.slice(0, 8));
        })
        .catch(() => {});
    }
  }, []);

  // ── Id-based refetch: catalog + winning offer ──────────────────────────────
  // Also follows a MERGED product's redirect, so an old link or a
  // CropReportShare recommendation still lands on the surviving page.
  useEffect(() => {
    if (!productId) return;
    let alive = true;
    setLoading(true);

    const qs = buyerDistrict ? `?district=${encodeURIComponent(buyerDistrict)}` : '';
    api.get(`/agristore/products/${productId}${qs}`)
      .then((res) => {
        if (!alive) return;
        const data = res.data?.data;
        if (data?.redirectTo) {
          navigation.replace('ProductDetail', { productId: data.redirectTo, district: buyerDistrict });
          return;
        }
        setDetail(data);
        setVariants(data?.variants || []);
        // The buy-box winner is the default offer AND the default Add to Cart.
        setOffer(data?.buyBox || null);
        setVariantId(data?.buyBox?.variantId || data?.variants?.[0]?.id || null);
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [productId, buyerDistrict, navigation]);

  /** Re-resolve the winning offer when the buyer switches pack size. */
  async function selectVariant(v) {
    if (!v?.id || v.id === variantId) return;
    setVariantId(v.id);
    setQuantity(1);
    try {
      const qs = new URLSearchParams({ variantId: v.id });
      if (buyerDistrict) qs.set('district', buyerDistrict);
      const res = await api.get(`/agristore/products/${productId}/offers?${qs.toString()}`);
      const group = res.data?.data?.variants?.[0];
      setOffer(group?.offers?.[0] || null);
    } catch { /* keep the current offer rather than blanking the page */ }
  }

  // ── Derived values — ALL read off the SELECTED OFFER, not the catalog row ──
  // Price, MRP, discount, "You save", the HOT DEAL badge, the quantity cap and
  // the quantity subtotal used to read `product.price` / `product.stock`, which
  // post-split are catalog columns that mean nothing. `legacyOffer` is the
  // dual-read fallback the API returns while a product has no listings yet.
  const legacy   = product.legacyOffer || null;
  const price    = Number(offer?.price ?? legacy?.price ?? product.price ?? 0);
  const mrp      = Number(offer?.mrp ?? legacy?.mrp ?? product.mrp ?? 0);
  const stock    = offer?.stock ?? legacy?.stock ?? product.stock ?? 0;
  const minOrder = offer?.minOrderQty ?? legacy?.minOrderQty ?? product.minOrderQty ?? 1;
  const unit     = variants.find(v => v.id === variantId)?.attributes?.packSize
                || variants.find(v => v.id === variantId)?.unit
                || legacy?.unit || product.unit;

  const discount   = discountPct(mrp, price);
  const saving     = mrp > price ? mrp - price : 0;
  const inStock    = stock > 0;
  const reviews    = product.ratingCount ?? product.reviews ?? 0;
  const brandLabel = product.brand || product.category?.name || 'KrushiSarva';
  const mfrLabel   = product.manufacturer || brandLabel;

  const otherOffers = Math.max((product.offerCount ?? 0) - 1, 0);

  const { count: cartCount, refresh: refreshCart } = useCart();

  // ── Cart helpers ────────────────────────────────────────────────────────────
  // Keyed on listingId: there was previously nowhere to say WHICH Kendra's offer
  // the buyer chose, so `productId` alone decided it. productId is still sent as
  // the fallback for a product that has no listings yet, where the server
  // resolves the buy-box winner itself.
  async function addToCart(chosen = offer, qty = quantity) {
    const listingId = chosen?.listingId || null;
    setAdding(true);
    setAddingId(listingId);
    try {
      await api.post('/agristore/cart', listingId
        ? { listingId, quantity: qty }
        : { productId, variantId: variantId || undefined, quantity: qty });
      refreshCart();
      return true;
    } catch (err) {
      Alert.alert(t('product.error'), err.response?.data?.error?.message || t('product.cartError'));
      return false;
    } finally {
      setAdding(false);
      setAddingId(null);
    }
  }

  async function handleAddToCart() {
    const ok = await addToCart();
    if (ok) Alert.alert(t('product.addedToCart'), t('product.addedToCartMsg', { qty: quantity, name: product.name }), [{ text: t('ok') }]);
  }

  async function handleBuyNow() {
    const ok = await addToCart();
    if (ok) navigation.navigate('Cart');
  }

  /** Add straight from a row in the offers sheet — each row has its own button. */
  async function handleAddOffer(chosen) {
    const ok = await addToCart(chosen, 1);
    if (ok) {
      setOffer(chosen);
      setOffersOpen(false);
      Alert.alert(
        t('product.addedToCart'),
        t('offers.addedFrom', { seller: chosen.sellerName, defaultValue: `Added from ${chosen.sellerName}` }),
        [{ text: t('ok') }],
      );
    }
  }

  /**
   * Share the product.
   *
   * The share button previously had NO onPress at all — it animated on tap and
   * did nothing. React Native's Share API needs no dependency, so it is wired up
   * rather than removed. Nothing private is shared: a product name, the current
   * price, and a deep link.
   */
  async function handleShare() {
    try {
      await Share.share({
        message: `${product.name}${price ? ` — ${inr(price)}` : ''}\nkrushisarva://product/${productId}`,
        title: product.name,
      });
    } catch { /* the user dismissed the sheet — not an error */ }
  }

  // ── Spec data — prefer real DB fields, fallback to derived ─────────────────

  // Product Highlights: use seller-entered highlights[] or fall back to key fields
  const highlightBullets = product.highlights?.length
    ? product.highlights
    : null;

  // Spec table: use seller-entered specifications{} + always include base fields
  const baseSpecRows = [
    { label: t('rent.brandLabel'),        value: brandLabel },
    { label: t('products.category'),     value: product.category?.name || '—' },
    { label: t('products.unit'),         value: unit || '—' },
    { label: t('product.availability'), value: inStock ? t('product.inStockShort') : t('product.outOfStock') },
    { label: t('product.minOrder'),   value: minOrder > 1 ? `${minOrder} ${unit || ''}`.trim() : '1' },
    { label: t('rent.ratingLabel'),       value: product.rating ? `${product.rating} ★` : '—' },
  ];

  // Merge seller-entered specs on top of base rows
  const specRows = (() => {
    const specs = product.specifications;
    if (specs && typeof specs === 'object' && Object.keys(specs).length > 0) {
      const fromDB = Object.entries(specs).map(([label, value]) => ({ label, value: String(value) }));
      // Add base rows that aren't already covered by seller specs
      const coveredKeys = new Set(fromDB.map(r => r.label.toLowerCase()));
      const extra = baseSpecRows.filter(r => !coveredKeys.has(r.label.toLowerCase()));
      return [...fromDB, ...extra];
    }
    return baseSpecRows;
  })();

  // Highlights grid: if no bullet highlights, show spec grid instead
  const highlights = highlightBullets
    ? null   // rendered as bullet list
    : [
        { label: t('rent.brandLabel'),    value: brandLabel },
        { label: t('products.category'), value: product.category?.name || '—' },
        { label: t('products.unit'),     value: unit || '—' },
        { label: t('rent.ratingLabel'),   value: product.rating ? `${product.rating} / 5` : '—' },
        { label: t('product.reviewsLabel'),  value: reviews > 0 ? t('product.ratingsCount', { count: reviews.toLocaleString() }) : '—' },
        { label: t('product.stockLabel'),    value: inStock ? t('product.unitsCount', { count: stock }) : t('product.outOfStock') },
      ];

  // Manufacturer rows.
  //
  // REMOVED three rows that were asserted for EVERY product regardless of the
  // data behind it:
  //   "Product code: FE-XXXXXXXX"  — a UUID prefix dressed up as a manufacturer
  //                                   SKU. Not a real code for anything.
  //   "Quality check: KrushiSarva Verified" — a trust claim the platform had not
  //                                   made. Nothing verified these products.
  //   "Customer support: <hours>"  — support hours hard-coded in the app.
  // Verification is a platform decision, and it must come from a
  // platform-controlled backend field, never from a string constant in the
  // client. `countryOfOrigin` no longer defaults to "India" either — an unknown
  // origin is shown as unknown.
  const mfrRows = [
    { label: t('product.manufacturerLabel'), value: mfrLabel },
    { label: t('rent.brandLabel'),           value: brandLabel },
    ...(product.countryOfOrigin
      ? [{ label: t('product.countryOfOrigin'), value: product.countryOfOrigin }]
      : []),
    ...(product.modelNumber
      ? [{ label: t('product.modelNumber', 'Model number'), value: product.modelNumber }]
      : []),
  ];

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <AnimatedScreen>
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>

      {/* ── Top Safe Area + Header ─────────────────────────────────────────── */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: COLORS.surface, ...SHADOWS.medium }}>
        <View style={S.header}>
          <TouchableOpacity style={S.headerIconBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textDark} />
          </TouchableOpacity>
          <Text style={S.headerTitle} numberOfLines={1}>{product.name}</Text>
          <TouchableOpacity style={S.headerIconBtn} onPress={() => navigation.navigate('Cart')}>
            <Ionicons name="cart-outline" size={23} color={COLORS.textDark} />
            {cartCount > 0 && (
              <View style={S.cartBadge}>
                <Text style={S.cartBadgeTxt} numberOfLines={1}>
                  {cartCount > 99 ? '99+' : cartCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Cold open: arrived with only a product id, so `product` is still {} and
          every derived value below reads zero. Hold the page's shape until the
          record lands rather than painting an empty product and a "Buy at ₹0"
          bar under it. heroH tracks imgBox's 1.2 aspect ratio so the gallery
          does not jump when the real image arrives. */}
      {loading && !detail ? (
        <SkeletonDetail heroH={Math.round(Dimensions.get('window').width / 1.2)} label={t('loading')} />
      ) : (
      <>

      {/* ── Scroll content ────────────────────────────────────────────────── */}
      <Animated.ScrollView
        style={{ opacity: fadeIn }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >

        {/* ── Image Gallery ─────────────────────────────────────────────── */}
        <View style={S.imgSection}>
          {/* Main image — fixed height, overlays inside */}
          <View style={S.imgBox}>
            {product.images?.[imgIdx]
              ? <Image source={{ uri: detailImageUrl(product.images[imgIdx]) }} style={S.mainImg} resizeMode="contain" />
              : (
                <View style={S.imgPlaceholder}>
                  <MockImagePlaceholder category={product.category || product.categoryId} size={160} />
                </View>
              )
            }

            {/* Top-right: share.
                The wishlist heart is GONE. It was `useState(false)` with no API
                call and no persistence — tapping it animated, and the "saved"
                state was thrown away the moment the screen unmounted. A control
                that silently discards the farmer's action is worse than no
                control; it comes back when there is a wishlist table behind it. */}
            <View style={S.imgTopRight}>
              <TouchableOpacity
                style={S.imgActionBtn}
                onPress={handleShare}
                accessibilityRole="button"
                accessibilityLabel={t('product.share', 'Share this product')}
              >
                <Ionicons name="share-social-outline" size={22} color={COLORS.textBody} />
              </TouchableOpacity>
            </View>

            {/* Discount badge top-left */}
            {discount > 0 && (
              <View style={S.discBadge}>
                <Text style={S.discBadgeTxt}>{discount}%{'\n'}OFF</Text>
              </View>
            )}

            {/* Bottom bar: rating pill left + thumbnails right — same level */}
            <View style={S.imgBottomBar}>
              {/* Rating pill — left side */}
              {product.rating > 0 && (
                <View style={S.ratingPill}>
                  <Text style={S.ratingPillTxt}>{product.rating}</Text>
                  <Ionicons name="star" size={11} color={COLORS.white} />
                  {reviews > 0 && (
                    <>
                      <View style={S.ratingPillDivider} />
                      <Text style={S.ratingPillTxt}>{reviews.toLocaleString()}</Text>
                    </>
                  )}
                </View>
              )}

              {/* Thumbnail strip — right side, same row */}
              {product.images?.length > 1 && (
                <View style={S.thumbRow}>
                  {product.images.map((url, i) => (
                    <TouchableOpacity key={i} onPress={() => setImgIdx(i)} activeOpacity={0.8}>
                      <Image
                        source={{ uri: thumbUrl(url, 120) }}
                        style={[S.thumb, i === imgIdx && S.thumbActive]}
                        resizeMode="cover"
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>

        </View>

        {/* ── Product Info ───────────────────────────────────────────────── */}
        <Animated.View style={[S.infoCard, { transform: [{ translateY: slideUp }] }]}>
          {/* Brand */}
          <Text style={S.brandLabel}>{brandLabel.toUpperCase()}</Text>

          {/* Name */}
          <Text style={S.productName}>{product.name}</Text>
          {product.nameHi ? <Text style={S.productNameHi}>{product.nameHi}</Text> : null}

          {/* Tags row */}
          <View style={S.tagRow}>
            {discount >= 20 && (
              <View style={S.hotBadge}>
                <Ionicons name="flame" size={11} color={COLORS.white} />
                <Text style={S.hotBadgeTxt}>{t('product.hotDeal')}</Text>
              </View>
            )}
            {(() => {
              // Stock is the CHOSEN SELLER's stock, not a catalog-wide number.
              if (stock === 0) return <View style={S.outStockTag}><Text style={S.outStockTxt}>{t('product.outOfStock')}</Text></View>;
              if (stock <= 5)  return <View style={S.lowStockTag}><Text style={S.lowStockTxt}>{t('product.onlyLeft', { count: stock })}</Text></View>;
              return <View style={S.inStockTag}><Text style={S.inStockTxt}>{t('product.inStockDot')}</Text></View>;
            })()}
          </View>

          {/* Inline rating — show ratings count only; review count was a bogus
              derivation from rating count, removed. */}
          {product.rating > 0 && (
            <View style={S.ratingRow}>
              <View style={S.ratingChip}>
                <Text style={S.ratingChipTxt}>{product.rating}</Text>
                <Ionicons name="star" size={11} color={COLORS.white} />
              </View>
              {reviews > 0 && (
                <Text style={S.ratingCountTxt}>{t('product.ratingsLabel', { count: reviews.toLocaleString() })}</Text>
              )}
            </View>
          )}

          {/* ── Pack size ── The variant axis for agri-inputs. Switching packs
              re-resolves the winning offer, because a Kendra can be cheapest on
              450 g and not on 1 kg. */}
          {variants.length > 1 ? (
            <View style={S.variantBlock}>
              <Text style={S.sectionTitle}>{t('product.packSize', 'Pack size')}</Text>
              <View style={S.variantRow}>
                {variants.map((v) => {
                  const selected = v.id === variantId;
                  const label = v.attributes?.packSize || v.unit;
                  return (
                    <TouchableOpacity
                      key={v.id}
                      onPress={() => selectVariant(v)}
                      style={[S.variantChip, selected && S.variantChipOn]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[S.variantChipTxt, selected && S.variantChipTxtOn]}>{label}</Text>
                      {v.lowestPrice != null && (
                        <Text style={[S.variantChipSub, selected && S.variantChipTxtOn]}>
                          ₹{Number(v.lowestPrice).toLocaleString('en-IN')}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Price — the SELECTED OFFER's price */}
          <View style={S.priceRow}>
            <Text style={S.price}>{inr(price)}</Text>
            {mrp > price && (
              <View style={S.priceMeta}>
                <View style={S.discRow}>
                  <Text style={S.discPct}>↓{discount}%</Text>
                  <Text style={S.mrpTxt}>{inr(mrp)}</Text>
                </View>
                <View style={S.savePill}>
                  <Text style={S.savePillTxt}>{t('product.youSave', { amount: saving.toLocaleString('en-IN') })}</Text>
                </View>
              </View>
            )}
          </View>
          <Text style={S.inclTax}>{t('product.inclusiveTaxes', { unit: unit || t('product.unitFallback') })}</Text>

          {/* ── Quantity Selector (inside info card) ───────────────────── */}
          <View style={S.qtyBlock}>
            <View style={S.qtyHeaderRow}>
              <Text style={S.sectionTitle}>{t('product.quantity')}</Text>
              <Text style={S.qtyTotal}>
                {t('product.totalLabel')}:{' '}
                <Text style={{ color: COLORS.greenDeep, fontWeight: '800' }}>
                  {inr(price * quantity)}
                </Text>
              </Text>
            </View>
            <View style={S.qtyRow}>
              <View style={S.qtyPill}>
                <TouchableOpacity
                  style={[S.qPillBtn, quantity <= minOrder && { opacity: 0.4 }]}
                  onPress={() => setQuantity(q => Math.max(minOrder, q - 1))}
                  disabled={quantity <= minOrder}
                >
                  <Ionicons name="remove" size={18} color={COLORS.textDark} />
                </TouchableOpacity>
                <Text style={S.qtyNum}>{quantity}</Text>
                <TouchableOpacity
                  style={[S.qPillBtn, quantity >= stock && { opacity: 0.4 }]}
                  onPress={() => setQuantity(q => Math.min(q + 1, stock || q + 1))}
                  disabled={quantity >= stock}
                >
                  <Ionicons name="add" size={18} color={COLORS.textDark} />
                </TouchableOpacity>
              </View>
              {minOrder > 1 ? (
                <Text style={S.moqNote}>
                  {t('product.minOrderNote', { count: minOrder, defaultValue: `This seller's minimum order is ${minOrder}` })}
                </Text>
              ) : null}
            </View>
          </View>
        </Animated.View>

        {/* ── Chemical safety — approved-label information only ─────────────
            Rendered only for a regulated product (the API returns `safety: null`
            for everything else), and placed ABOVE the seller and the buy
            buttons: a farmer must see the protective equipment a product needs
            before they see the button that buys it. */}
        <SafetyPanel safety={product.safety} recall={product.recall} />

        {/* ── Delivery & PIN-code check ──────────────────────────────────────
            Replaces a "coming soon" placeholder. Real serviceability, from the
            seller's declared areas. */}
        <DeliveryCheck productId={productId} defaultPincode={null} />

        {/* ── Seller + other offers ────────────────────────────────────────
            This whole surface is new. Before the split there was no seller in the
            buyer app at all — this card rendered a hard-coded string
            ("KrushiSarva Direct") because a product row WAS one seller's offer and
            there was nothing to name or to choose between. */}
        <View style={S.sectionCard}>
          <View style={S.sellerRow}>
            <View style={S.sellerIconCircle}>
              <Ionicons name="storefront-outline" size={18} color={COLORS.blue} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={S.sellerBy}>{t('product.soldBy')}</Text>
              <Text style={S.sellerName} numberOfLines={1}>
                {offer?.sellerName || t('product.farmEasyDirect')}
              </Text>
              {offer ? (
                <View style={S.sellerMetaRow}>
                  {offer.sellerRatingCount > 0 ? (
                    <View style={S.sellerRatingChip}>
                      <Ionicons name="star" size={10} color={COLORS.white} />
                      <Text style={S.sellerRatingTxt}>{Number(offer.sellerRating).toFixed(1)}</Text>
                    </View>
                  ) : (
                    <Text style={S.sellerMetaTxt}>{t('offers.newSeller', 'New seller')}</Text>
                  )}
                  {offer.district ? <Text style={S.sellerMetaTxt}>· {offer.district}</Text> : null}
                  <Text style={S.sellerMetaTxt}>
                    · {t('offers.dispatchDays', { count: offer.dispatchSlaDays, defaultValue: `dispatch in ${offer.dispatchSlaDays}d` })}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {otherOffers > 0 ? (
            <TouchableOpacity
              style={S.otherOffersRow}
              onPress={() => setOffersOpen(true)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('offers.openA11y', 'See all sellers for this product')}
            >
              <View style={{ flex: 1 }}>
                <Text style={S.otherOffersTitle}>
                  {t('offers.alsoAvailable', {
                    count: otherOffers,
                    price: `₹${Number(product.lowestPrice ?? price).toLocaleString('en-IN')}`,
                    defaultValue: `Also available from ${otherOffers} other seller(s) from ₹${product.lowestPrice ?? price}`,
                  })}
                </Text>
                <Text style={S.otherOffersSub}>
                  {t('offers.compareHint', 'Compare price, delivery time and rating')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
            </TouchableOpacity>
          ) : null}
        </View>

        <OfferListSheet
          visible={offersOpen}
          onClose={() => setOffersOpen(false)}
          productId={productId}
          variantId={variantId}
          district={buyerDistrict}
          selectedListingId={offer?.listingId}
          onSelectOffer={(o) => { setOffer(o); setQuantity(Math.max(1, o.minOrderQty || 1)); setOffersOpen(false); }}
          onAddToCart={handleAddOffer}
          addingListingId={addingId}
        />

        {/* ── Returns & policies — coming soon ─────────────────────────────── */}
        <ComingSoonCard
          icon="shield-checkmark-outline"
          title={t('product.returnsPoliciesTitle')}
          subtitle={t('product.returnsPoliciesSub')}
        />

        {/* ── Similar Products ───────────────────────────────────────────── */}
        {similar.length > 0 && (
          <View style={S.similarSection}>
            <View style={S.simHeader}>
              <Text style={S.sectionTitle}>{t('product.similarProducts')}</Text>
              <TouchableOpacity>
                <Text style={S.seeAll}>{t('store.viewAll')}</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              windowSize={5}
              maxToRenderPerBatch={10}
              removeClippedSubviews
              data={similar}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 4, gap: 10 }}
              renderItem={({ item }) => (
                <SimilarCard
                  item={item}
                  // `productId` and `district` were both dropped here, so tapping
                  // a similar product landed on a screen that could only render
                  // whatever the card happened to carry, and lost the buyer's
                  // geography — which decides which offers exist at all.
                  onPress={(p) => navigation.push('ProductDetail', {
                    productId: p.id, product: p, district: buyerDistrict,
                  })}
                />
              )}
            />
          </View>
        )}

        {/* ── Collapsible sections — only shown if seller provided data ─── */}
        <View style={{ paddingHorizontal: 10, marginTop: 8, gap: 8 }}>

          {/* Product Highlights — only if seller uploaded highlights */}
          {product.highlights?.length > 0 && (
            <Collapsible title={t('product.highlightsTitle')} icon="list-outline" defaultOpen>
              <View style={S.bulletList}>
                {product.highlights.map((h, i) => (
                  <View key={i} style={S.bulletRow}>
                    <View style={S.bulletDot} />
                    <Text style={S.bulletTxt}>{h}</Text>
                  </View>
                ))}
              </View>
            </Collapsible>
          )}

          {/* All Details — only if seller uploaded specifications or manufacturer info */}
          {(product.specifications && Object.keys(product.specifications).length > 0) || product.manufacturer ? (
            <Collapsible title={t('product.allDetailsTitle')} icon="information-circle-outline">
              <View style={S.tabRow}>
                {product.specifications && Object.keys(product.specifications).length > 0 && (
                  <TouchableOpacity
                    style={[S.tabBtn, activeTab === 'spec' && S.tabBtnActive]}
                    onPress={() => setActiveTab('spec')}
                  >
                    <Text style={[S.tabBtnTxt, activeTab === 'spec' && S.tabBtnTxtActive]}>
                      {t('product.specifications')}
                    </Text>
                  </TouchableOpacity>
                )}
                {product.manufacturer ? (
                  <TouchableOpacity
                    style={[S.tabBtn, activeTab === 'mfr' && S.tabBtnActive]}
                    onPress={() => setActiveTab('mfr')}
                  >
                    <Text style={[S.tabBtnTxt, activeTab === 'mfr' && S.tabBtnTxtActive]}>
                      {t('product.manufacturer')}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {activeTab === 'spec' && product.specifications && (
                <View style={S.specTable}>
                  <View style={S.specGroupHeader}>
                    <Text style={S.specGroupHeadTxt}>{t('product.specifications')}</Text>
                  </View>
                  {Object.entries(product.specifications).map(([label, value], i, arr) => (
                    <SpecRow key={i} label={label} value={String(value)} last={i === arr.length - 1} />
                  ))}
                </View>
              )}

              {activeTab === 'mfr' && product.manufacturer && (
                <View style={S.specTable}>
                  <View style={S.specGroupHeader}>
                    <Text style={S.specGroupHeadTxt}>{t('product.manufacturer')}</Text>
                  </View>
                  {mfrRows.map((r, i) => (
                    <SpecRow key={i} label={r.label} value={r.value} last={i === mfrRows.length - 1} />
                  ))}
                </View>
              )}
            </Collapsible>
          ) : null}

          {/* Product Description — only if seller provided description */}
          {product.description ? (
            <Collapsible title={t('product.productDescription')} icon="document-text-outline">
              <Text style={[S.descText, { paddingBottom: 4 }]}>{product.description}</Text>
            </Collapsible>
          ) : null}

        </View>
      </Animated.ScrollView>

      {/* ── Bottom Action Bar ──────────────────────────────────────────────── */}
      <View style={[S.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity
          style={[S.addCartBtn, (!inStock || adding) && { opacity: 0.45 }]}
          onPress={handleAddToCart}
          disabled={adding || !inStock}
        >
          {adding
            ? <ActivityIndicator size="small" color={COLORS.primary} />
            : (
              <>
                <Ionicons name="cart-outline" size={20} color={COLORS.primary} />
                <Text style={S.addCartTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{t('addToCart')}</Text>
              </>
            )
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={[S.buyNowBtn, (!inStock || adding) && { opacity: 0.45 }]}
          onPress={handleBuyNow}
          disabled={adding || !inStock}
          activeOpacity={0.82}
        >
          {adding
            ? <ActivityIndicator size="small" color={COLORS.yellowDark} />
            : (
              <>
                <Ionicons name="flash" size={18} color={COLORS.yellowDark} />
                <Text style={S.buyNowTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{t('product.buyAt', { price: price.toLocaleString('en-IN') })}</Text>
              </>
            )
          }
        </TouchableOpacity>
      </View>

      </>
      )}

    </View>
    </AnimatedScreen>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  // Header
  header:         { flexDirection: 'row', alignItems: 'center', height: 52, paddingHorizontal: 8, gap: 4 },
  headerIconBtn:  { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  cartBadge:      { position: 'absolute', top: 4, right: 4, minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, backgroundColor: COLORS.error, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.surface },
  cartBadgeTxt:   { color: '#fff', fontSize: 9.5, fontWeight: '900', lineHeight: 11 },
  headerTitle:    { flex: 1, fontSize: 15, fontWeight: '700', color: COLORS.textDark },

  // Image gallery
  imgSection:     { backgroundColor: COLORS.surface },
  imgBox:         { aspectRatio: 1.2, justifyContent: 'center', alignItems: 'center', position: 'relative', overflow: 'hidden' },
  mainImg:        { width: '100%', height: '100%' },
  imgPlaceholder: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primaryPale },
  imgTopRight:    { position: 'absolute', top: 12, right: 12, gap: 8 },
  imgActionBtn:   {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center',
    ...SHADOWS.medium,
  },
  discBadge:      {
    position: 'absolute', top: 12, left: 12,
    backgroundColor: COLORS.error, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 5,
    alignItems: 'center',
  },
  discBadgeTxt:   { color: COLORS.white, fontSize: 11, fontWeight: '900', textAlign: 'center', lineHeight: 14 },
  // Bottom bar inside imgBox — rating left, thumbs right
  imgBottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
  ratingPill:     {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primary, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  ratingPillTxt:    { color: COLORS.white, fontSize: 12, fontWeight: '800' },
  ratingPillDivider:{ width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.4)' },
  // Thumbnail strip — right side of bottom bar
  thumbRow:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  thumb:       { width: 38, height: 38, borderRadius: 7, borderWidth: 2, borderColor: 'transparent', opacity: 0.55 },
  thumbActive: { borderColor: COLORS.primary, opacity: 1 },

  // Info card
  infoCard:       { backgroundColor: COLORS.surface, marginTop: 8, padding: 16 },
  brandLabel:     { fontSize: 11, fontWeight: '700', color: COLORS.textMedium, letterSpacing: 1.2 },
  productName:    { fontSize: 20, fontWeight: '800', color: COLORS.textDark, marginTop: 4, lineHeight: 26 },
  productNameHi:  { fontSize: 14, color: COLORS.textBody, fontWeight: '500', marginTop: 3 },
  tagRow:         { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  hotBadge:       {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.orange, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  hotBadgeTxt:    { color: COLORS.white, fontSize: 11, fontWeight: '800' },
  inStockTag:     { backgroundColor: COLORS.primaryPale, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  lowStockTag:    { backgroundColor: '#FFF3E0', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  lowStockTxt:    { color: '#E65100', fontSize: 11, fontWeight: '800' },
  inStockTxt:     { color: COLORS.textPrimary, fontSize: 11, fontWeight: '700' },
  outStockTag:    { backgroundColor: COLORS.errorLight, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  outStockTxt:    { color: COLORS.error, fontSize: 11, fontWeight: '700' },
  ratingRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  ratingChip:     {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: COLORS.primary, borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  ratingChipTxt:  { color: COLORS.white, fontSize: 12, fontWeight: '800' },
  ratingCountTxt: { fontSize: 12, color: COLORS.textBody },
  priceRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginTop: 14 },
  price:          { fontSize: 30, fontWeight: '900', color: COLORS.textDark },
  priceMeta:      { paddingTop: 5, gap: 5 },
  discRow:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  discPct:        { fontSize: 15, fontWeight: '800', color: COLORS.textPrimary },
  mrpTxt:         { fontSize: 14, color: COLORS.textMedium, textDecorationLine: 'line-through' },
  savePill:       {
    backgroundColor: COLORS.yellowWarm, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  savePillTxt:    { fontSize: 11, fontWeight: '700', color: COLORS.yellowDark },
  inclTax:        { fontSize: 11, color: COLORS.textMedium, marginTop: 5 },

  // Section card
  sectionCard:    { backgroundColor: COLORS.surface, marginTop: 8, padding: 16 },
  sectionTitle:   { fontSize: 15, fontWeight: '700', color: COLORS.textDark },

  // ── Chemical safety panel ──
  // Visually distinct from every other card on the page (red hairline, tinted
  // ground) so it does not read as one more marketing block. It carries the only
  // information on this screen that can hurt someone.
  safetyCard: {
    backgroundColor: COLORS.surface, marginTop: 8, padding: 16,
    borderTopWidth: 3, borderTopColor: COLORS.error,
  },
  safetyTitleRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  safetyTitle:      { fontSize: 15, fontWeight: '800', color: COLORS.textDark },
  safetyProvenance: { fontSize: 11.5, color: COLORS.textMedium, marginTop: 4, fontStyle: 'italic' },
  safetyGrid:       { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, gap: 10 },
  safetyCell:       { minWidth: '46%', flexGrow: 1, backgroundColor: COLORS.paperGray, borderRadius: 10, padding: 10 },
  safetyCellLabel:  { fontSize: 10.5, color: COLORS.textMedium, fontWeight: '600' },
  safetyCellValue:  { fontSize: 13, color: COLORS.textDark, fontWeight: '700', marginTop: 2 },
  safetySection:    { marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  safetyHeadRow:    { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 6 },
  safetyHeadTxt:    { fontSize: 13, fontWeight: '800', color: COLORS.textDark },
  safetyBody:       { fontSize: 13.5, lineHeight: 21, color: COLORS.textBody },
  // A missing label section is stated as missing, in the same weight as the
  // present ones — never quietly hidden and never filled in with generic advice.
  safetyMissing:    { fontSize: 13, lineHeight: 20, color: COLORS.textMedium, fontStyle: 'italic' },
  safetyCaveat:     { fontSize: 12, lineHeight: 18, color: COLORS.error, marginTop: 6, fontWeight: '600' },
  safetyBullet:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 4 },
  safetyDot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.error, marginTop: 7 },
  safetyBulletTxt:  { flex: 1, fontSize: 13.5, lineHeight: 20, color: COLORS.textDark },
  safetyNoticeBox:  {
    flexDirection: 'row', gap: 8, marginTop: 14, padding: 12,
    backgroundColor: COLORS.paperGray, borderRadius: 10,
  },
  safetyNoticeTxt:  { flex: 1, fontSize: 12.5, lineHeight: 19, color: COLORS.textBody },

  // ── Recall banner ──
  recallBox: {
    flexDirection: 'row', gap: 10, padding: 12, borderRadius: 10,
    backgroundColor: COLORS.error, marginBottom: 14,
  },
  recallTitle: { color: COLORS.white, fontSize: 13.5, fontWeight: '800' },
  recallTxt:   { color: COLORS.white, fontSize: 12.5, lineHeight: 18, marginTop: 3 },

  // ── Delivery / PIN check ──
  deliveryHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  pinRow:      { flexDirection: 'row', gap: 10, alignItems: 'center' },
  // 48dp tall: this is a numeric entry a farmer may be doing outdoors.
  pinInput: {
    flex: 1, minHeight: 48, borderWidth: 1.4, borderColor: COLORS.border, borderRadius: 12,
    paddingHorizontal: 14, fontSize: 15, color: COLORS.textDark, letterSpacing: 1,
  },
  pinBtn: {
    minHeight: 48, minWidth: 92, paddingHorizontal: 18, borderRadius: 12,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  pinBtnTxt:   { color: COLORS.white, fontSize: 14, fontWeight: '800' },
  pinError:    { fontSize: 12.5, color: COLORS.error, marginTop: 8 },
  pinResultOk: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  pinResultBad:{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  pinResultTxt:{ flex: 1, fontSize: 13, lineHeight: 19, color: COLORS.textDark, fontWeight: '600' },

  // Coming-soon placeholder card (replaces fake delivery + trust badges)
  comingRow:       { flexDirection: 'row', alignItems: 'center' },
  comingIconCircle:{ width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.paperGray },
  comingTitleRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  comingTitle:     { flexShrink: 1, fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  comingPill:      {
    backgroundColor: COLORS.paperGray, borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: COLORS.border,
  },
  comingPillTxt:   { fontSize: 10, fontWeight: '800', color: COLORS.textMedium, letterSpacing: 0.4 },
  comingSub:       { fontSize: 12, color: COLORS.textMedium, marginTop: 3, lineHeight: 17 },

  // Seller (basic — multi-seller listing later)
  sellerRow:        { flexDirection: 'row', alignItems: 'center' },
  sellerIconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.blueBg, justifyContent: 'center', alignItems: 'center' },
  sellerBy:         { fontSize: 11, color: COLORS.textMedium, fontWeight: '600' },
  sellerName:       { fontSize: 14, fontWeight: '700', color: COLORS.textDark, marginTop: 2 },
  sellerMetaRow:    { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' },
  sellerMetaTxt:    { fontSize: 11, color: COLORS.textLight },
  sellerRatingChip: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: COLORS.greenDeep, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  sellerRatingTxt:  { fontSize: 10, fontWeight: '800', color: COLORS.white },

  otherOffersRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border,
  },
  otherOffersTitle: { fontSize: 13, fontWeight: '800', color: COLORS.primary },
  otherOffersSub:   { fontSize: 11, color: COLORS.textLight, marginTop: 2 },

  variantBlock:  { marginTop: 14 },
  variantRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  variantChip: {
    borderWidth: 1.4, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 7, alignItems: 'center', minWidth: 74,
  },
  variantChipOn:     { borderColor: COLORS.primary, backgroundColor: COLORS.primaryPale ?? 'rgba(23,107,67,0.07)' },
  variantChipTxt:    { fontSize: 13, fontWeight: '800', color: COLORS.textDark },
  variantChipSub:    { fontSize: 11, color: COLORS.textLight, marginTop: 1 },
  variantChipTxtOn:  { color: COLORS.primary },

  moqNote: { fontSize: 11, color: COLORS.textLight, marginLeft: 12, flexShrink: 1 },

  // Quantity (inside info card)
  qtyBlock:     { marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border },

  // Quantity
  qtyHeaderRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  qtyTotal:       { fontSize: 14, color: COLORS.textBody },
  qtyRow:         { flexDirection: 'row', alignItems: 'center', gap: 16 },
  qtyPill:        {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.paperGray, borderRadius: 50, padding: 4,
  },
  qPillBtn:       {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center',
    ...SHADOWS.small,
  },
  qtyNum:         { fontSize: 18, fontWeight: '800', color: COLORS.textDark, minWidth: 44, textAlign: 'center' },

  // Similar products
  similarSection: { backgroundColor: COLORS.surface, marginTop: 8, paddingTop: 14, paddingBottom: 14 },
  simHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, marginBottom: 12 },
  seeAll:         { fontSize: 13, fontWeight: '700', color: COLORS.primary },
  simCard:        {
    width: 140, backgroundColor: COLORS.surface, borderRadius: 12,
    overflow: 'hidden', ...SHADOWS.medium,
  },
  simImgBox:      { width: 140, height: 140, backgroundColor: COLORS.snowGray },
  simImg:         { width: '100%', height: '100%' },
  simImgPlaceholder:{ justifyContent: 'center', alignItems: 'center' },
  simDiscBadge:   {
    position: 'absolute', top: 6, left: 6,
    backgroundColor: COLORS.primary, borderRadius: 6,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  simDiscTxt:     { color: COLORS.white, fontSize: 9, fontWeight: '900', textAlign: 'center', lineHeight: 12 },
  simInfo:        { padding: 9 },
  simName:        { fontSize: 12, fontWeight: '600', color: COLORS.textDark, lineHeight: 16, marginBottom: 4 },
  simPrice:       { fontSize: 14, fontWeight: '800', color: COLORS.textDark },
  simMrp:         { fontSize: 11, color: COLORS.textMedium, textDecorationLine: 'line-through', marginTop: 1 },
  simRating:      {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.primary, borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
    alignSelf: 'flex-start', marginTop: 4,
  },
  simRatingTxt:   { color: COLORS.white, fontSize: 10, fontWeight: '700' },

  // Collapsible
  collapseCard:       {
    backgroundColor: COLORS.surface, borderRadius: 14,
    overflow: 'hidden', ...SHADOWS.small,
  },
  collapseHead:       {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14,
  },
  collapseLeft:       { flexDirection: 'row', alignItems: 'center', gap: 10 },
  collapseIconCircle: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.primaryPale, justifyContent: 'center', alignItems: 'center',
  },
  collapseTitle:      { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  collapseBody:       { paddingHorizontal: 14, paddingBottom: 14 },

  // Bullet highlights (from DB)
  bulletList:  { gap: 8 },
  bulletRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bulletDot:   { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.primary, marginTop: 6 },
  bulletTxt:   { flex: 1, fontSize: 14, color: COLORS.textDark, lineHeight: 22 },

  // Tabs
  tabRow:       { flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: COLORS.border, marginBottom: 12 },
  tabBtn:       { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2.5, borderBottomColor: 'transparent', marginBottom: -1.5 },
  tabBtnActive: { borderBottomColor: COLORS.primary },
  tabBtnTxt:    { fontSize: 13, color: COLORS.textMedium, fontWeight: '600' },
  tabBtnTxtActive:{ color: COLORS.primary, fontWeight: '800' },

  // Spec table
  specTable:        { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, overflow: 'hidden' },
  specGroupHeader:  { backgroundColor: COLORS.cloudBg, paddingHorizontal: 12, paddingVertical: 9 },
  specGroupHeadTxt: { fontSize: 12, fontWeight: '700', color: COLORS.textBody, textTransform: 'uppercase', letterSpacing: 0.5 },
  specRow:          { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  specLabel:        { width: '42%', fontSize: 13, color: COLORS.textMedium, fontWeight: '500' },
  specValue:        { flex: 1, fontSize: 13, color: COLORS.textDark, fontWeight: '700' },
  descText:         { fontSize: 14, color: COLORS.textBody, lineHeight: 22 },

  // Bottom bar
  bottomBar:    {
    flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingTop: 12,
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
    ...SHADOWS.medium,
  },
  addCartBtn:   {
    flex: 1, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingHorizontal: 8, borderWidth: 2, borderColor: COLORS.primary, borderRadius: 14,
  },
  addCartTxt:   { flexShrink: 1, textAlign: 'center', fontSize: fs(13), fontWeight: '800', color: COLORS.primary, letterSpacing: 0.3 },
  buyNowBtn:    {
    flex: 1, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingHorizontal: 8, backgroundColor: COLORS.yellowBright, borderRadius: 14,
    borderWidth: 2, borderColor: COLORS.yellowBright,
  },
  buyNowTxt:    { flexShrink: 1, textAlign: 'center', fontSize: fs(13), fontWeight: '800', color: COLORS.brownDark, letterSpacing: 0.2 },

});

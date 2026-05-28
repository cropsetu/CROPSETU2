import { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, Image, ActivityIndicator, Dimensions, Animated,
  FlatList,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SHADOWS } from '../../constants/colors';
import api from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import { useCart } from '../../context/CartContext';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const { width: W } = Dimensions.get('window');

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
              <Text style={S.comingPillTxt}>Coming soon</Text>
            </View>
          </View>
          {!!subtitle && <Text style={S.comingSub}>{subtitle}</Text>}
        </View>
      </View>
    </View>
  );
}

// ── Similar product card ──────────────────────────────────────────────────────
function SimilarCard({ item, onPress }) {
  const sc   = useRef(new Animated.Value(1)).current;
  const disc = item.mrp > item.price ? Math.round(((item.mrp - item.price) / item.mrp) * 100) : 0;
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
            ? <Image source={{ uri: item.images[0] }} style={S.simImg} resizeMode="cover" />
            : <View style={[S.simImg, S.simImgPlaceholder]}><Ionicons name="leaf" size={26} color={COLORS.primary} /></View>
          }
          {disc > 0 && (
            <View style={S.simDiscBadge}>
              <Text style={S.simDiscTxt}>{disc}%{'\n'}OFF</Text>
            </View>
          )}
        </View>
        <View style={S.simInfo}>
          <Text style={S.simName} numberOfLines={2}>{item.name}</Text>
          <Text style={S.simPrice}>₹{item.price.toLocaleString()}</Text>
          {item.mrp > item.price && (
            <Text style={S.simMrp}>₹{item.mrp.toLocaleString()}</Text>
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
  const { product } = route.params;
  const { t }       = useLanguage();
  const insets      = useSafeAreaInsets();

  const [quantity,    setQuantity]    = useState(1);
  const [wishlist,    setWishlist]    = useState(false);
  const [imgIdx,      setImgIdx]      = useState(0);
  const [adding,      setAdding]      = useState(false);
  const [similar,     setSimilar]     = useState([]);

  // Default tab: 'spec' if specs exist, else 'mfr'
  const hasSpecs = !!(product.specifications && Object.keys(product.specifications).length > 0);
  const [activeTab, setActiveTab] = useState(hasSpecs ? 'spec' : 'mfr');

  const fadeIn   = useRef(new Animated.Value(0)).current;
  const slideUp  = useRef(new Animated.Value(24)).current;
  const heartSc  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn,  { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(slideUp, { toValue: 0, tension: 100, friction: 14, useNativeDriver: true }),
    ]).start();

    const catId = product.category?.id || product.categoryId;
    if (catId) {
      api.get(`/agristore/products?categoryId=${catId}&limit=10`)
        .then(res => {
          const list = (res.data?.data || res.data || []).filter(p => p.id !== product.id);
          setSimilar(list.slice(0, 8));
        })
        .catch(() => {});
    }
  }, []);

  // ── Derived values ─────────────────────────────────────────────────────────
  const discount   = product.mrp > product.price
    ? Math.round(((product.mrp - product.price) / product.mrp) * 100)
    : 0;
  const saving     = product.mrp > product.price ? product.mrp - product.price : 0;
  const inStock    = (product.stock ?? (product.inStock ? 1 : 0)) > 0;
  const reviews    = product.ratingCount ?? product.reviews ?? 0;
  const brandLabel = product.brand || product.category?.name || 'CropSetu';
  const mfrLabel   = product.manufacturer || brandLabel;

  const { count: cartCount, refresh: refreshCart } = useCart();

  // ── Cart helpers ────────────────────────────────────────────────────────────
  async function addToCart() {
    setAdding(true);
    try {
      await api.post('/agristore/cart', { productId: product.id, quantity });
      refreshCart();
      return true;
    } catch (err) {
      Alert.alert(t('product.error'), err.response?.data?.error?.message || t('product.cartError'));
      return false;
    } finally {
      setAdding(false);
    }
  }

  async function handleAddToCart() {
    const ok = await addToCart();
    if (ok) Alert.alert(t('product.addedToCart'), `${quantity}× ${product.name}`, [{ text: 'OK' }]);
  }

  async function handleBuyNow() {
    const ok = await addToCart();
    if (ok) navigation.navigate('Cart');
  }

  function toggleWishlist() {
    Animated.sequence([
      Animated.spring(heartSc, { toValue: 1.4, useNativeDriver: true, tension: 300, friction: 8 }),
      Animated.spring(heartSc, { toValue: 1,   useNativeDriver: true, tension: 300, friction: 8 }),
    ]).start();
    setWishlist(v => !v);
  }

  // ── Spec data — prefer real DB fields, fallback to derived ─────────────────

  // Product Highlights: use seller-entered highlights[] or fall back to key fields
  const highlightBullets = product.highlights?.length
    ? product.highlights
    : null;

  // Spec table: use seller-entered specifications{} + always include base fields
  const baseSpecRows = [
    { label: 'Brand',        value: brandLabel },
    { label: 'Category',     value: product.category?.name || '—' },
    { label: 'Unit',         value: product.unit || '—' },
    { label: 'Availability', value: inStock ? 'In Stock' : 'Out of Stock' },
    { label: 'Min. Order',   value: product.minOrderQty ? `${product.minOrderQty} ${product.unit}` : '1' },
    { label: 'Rating',       value: product.rating ? `${product.rating} ★` : '—' },
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
        { label: 'Brand',    value: brandLabel },
        { label: 'Category', value: product.category?.name || '—' },
        { label: 'Unit',     value: product.unit || '—' },
        { label: 'Rating',   value: product.rating ? `${product.rating} / 5` : '—' },
        { label: 'Reviews',  value: reviews > 0 ? `${reviews.toLocaleString()} ratings` : '—' },
        { label: 'Stock',    value: inStock ? `${typeof product.stock === 'number' ? product.stock + ' units' : 'Available'}` : 'Out of Stock' },
      ];

  const mfrRows = [
    { label: 'Manufacturer',     value: mfrLabel },
    { label: 'Brand',            value: brandLabel },
    { label: 'Country of Origin', value: product.countryOfOrigin || 'India' },
    { label: 'Product Code',     value: `FE-${(product.id || '').slice(0, 8).toUpperCase()}` },
    { label: 'Quality Check',    value: 'CropSetu Verified' },
    { label: 'Customer Support', value: 'Mon–Sat, 9 AM–6 PM' },
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
              ? <Image source={{ uri: product.images[imgIdx] }} style={S.mainImg} resizeMode="contain" />
              : (
                <View style={S.imgPlaceholder}>
                  <Ionicons name="leaf" size={80} color={COLORS.primary} />
                </View>
              )
            }

            {/* Top-right: wishlist + share */}
            <View style={S.imgTopRight}>
              <Animated.View style={{ transform: [{ scale: heartSc }] }}>
                <TouchableOpacity style={S.imgActionBtn} onPress={toggleWishlist}>
                  <Ionicons
                    name={wishlist ? 'heart' : 'heart-outline'}
                    size={22}
                    color={wishlist ? COLORS.error : COLORS.textBody}
                  />
                </TouchableOpacity>
              </Animated.View>
              <TouchableOpacity style={S.imgActionBtn}>
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
                        source={{ uri: url }}
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
              const s = product.stock ?? (product.inStock ? Infinity : 0);
              if (s === 0)  return <View style={S.outStockTag}><Text style={S.outStockTxt}>{t('product.outOfStock')}</Text></View>;
              if (s <= 5)   return <View style={S.lowStockTag}><Text style={S.lowStockTxt}>{`Only ${s} left`}</Text></View>;
              return <View style={S.inStockTag}><Text style={S.inStockTxt}>● In Stock</Text></View>;
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
                <Text style={S.ratingCountTxt}>{reviews.toLocaleString()} Ratings</Text>
              )}
            </View>
          )}

          {/* Price */}
          <View style={S.priceRow}>
            <Text style={S.price}>₹{product.price.toLocaleString()}</Text>
            {product.mrp > product.price && (
              <View style={S.priceMeta}>
                <View style={S.discRow}>
                  <Text style={S.discPct}>↓{discount}%</Text>
                  <Text style={S.mrpTxt}>₹{product.mrp.toLocaleString()}</Text>
                </View>
                <View style={S.savePill}>
                  <Text style={S.savePillTxt}>You save ₹{saving.toLocaleString()}</Text>
                </View>
              </View>
            )}
          </View>
          <Text style={S.inclTax}>Inclusive of all taxes · per {product.unit || 'unit'}</Text>

          {/* ── Quantity Selector (inside info card) ───────────────────── */}
          <View style={S.qtyBlock}>
            <View style={S.qtyHeaderRow}>
              <Text style={S.sectionTitle}>{t('product.quantity')}</Text>
              <Text style={S.qtyTotal}>
                Total:{' '}
                <Text style={{ color: COLORS.greenDeep, fontWeight: '800' }}>
                  ₹{(product.price * quantity).toLocaleString()}
                </Text>
              </Text>
            </View>
            <View style={S.qtyRow}>
              <View style={S.qtyPill}>
                <TouchableOpacity
                  style={S.qPillBtn}
                  onPress={() => setQuantity(q => Math.max(1, q - 1))}
                >
                  <Ionicons name="remove" size={18} color={COLORS.textDark} />
                </TouchableOpacity>
                <Text style={S.qtyNum}>{quantity}</Text>
                <TouchableOpacity
                  style={[S.qPillBtn, product.stock != null && quantity >= product.stock && { opacity: 0.4 }]}
                  onPress={() => setQuantity(q => (product.stock != null ? Math.min(q + 1, product.stock) : q + 1))}
                  disabled={product.stock != null && quantity >= product.stock}
                >
                  <Ionicons name="add" size={18} color={COLORS.textDark} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* ── Delivery & address — coming soon ─────────────────────────────── */}
        <ComingSoonCard
          icon="cube-outline"
          title="Delivery & address"
          subtitle="Live shipping estimates and saved addresses are coming soon."
        />

        {/* ── Seller Card (basic — multi-seller listing coming later) ─────── */}
        <View style={S.sectionCard}>
          <View style={S.sellerRow}>
            <View style={S.sellerIconCircle}>
              <Ionicons name="storefront-outline" size={18} color={COLORS.blue} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={S.sellerBy}>{t('product.soldBy')}</Text>
              <Text style={S.sellerName}>{t('product.farmEasyDirect')}</Text>
            </View>
          </View>
        </View>

        {/* ── Returns & policies — coming soon ─────────────────────────────── */}
        <ComingSoonCard
          icon="shield-checkmark-outline"
          title="Returns & policies"
          subtitle="Return windows, COD eligibility and assured-quality details are coming soon."
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
                  onPress={(p) => navigation.push('ProductDetail', { product: p })}
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
      <View style={[S.bottomBar, { paddingBottom: Math.max(insets.bottom + 4, 14) }]}>
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
                <Text style={S.addCartTxt}>{t('addToCart')}</Text>
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
                <Text style={S.buyNowTxt}>{t('product.buyAt', { price: product.price.toLocaleString() })}</Text>
              </>
            )
          }
        </TouchableOpacity>
      </View>

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
  ratingDot:      { fontSize: 12, color: COLORS.textMedium },
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

  // Highlights grid (2-col)
  highlightGrid:  { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 0.5, borderColor: COLORS.border, borderRadius: 10, overflow: 'hidden' },
  highlightCell:  { width: '50%', padding: 12, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  highlightLabel: { fontSize: 11, color: COLORS.textMedium, fontWeight: '600', marginBottom: 3 },
  highlightValue: { fontSize: 13, fontWeight: '700', color: COLORS.textDark },

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
    gap: 7, borderWidth: 2, borderColor: COLORS.primary, borderRadius: 14,
  },
  addCartTxt:   { fontSize: 13, fontWeight: '800', color: COLORS.primary, letterSpacing: 0.5 },
  buyNowBtn:    {
    flex: 1, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, backgroundColor: COLORS.yellowBright, borderRadius: 14,
    borderWidth: 2, borderColor: COLORS.yellowBright,
  },
  buyNowTxt:    { fontSize: 13, fontWeight: '800', color: COLORS.brownDark, letterSpacing: 0.3 },

});

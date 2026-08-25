/**
 * AgriStoreHome — web-prototype structure (shop-tab.tsx) with full API backend
 * Header → Search → Banner → Best Sellers → All Products grid
 * Left slide drawer (flat category list) + animated language bottom sheet
 */
import { useState, useCallback, useEffect, useRef, memo } from 'react';
import useFocusRefresh from '../../hooks/useFocusRefresh';
import { useCart } from '../../context/CartContext';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable,
  FlatList, TextInput, StatusBar, Image, Easing, Keyboard,
  Modal, TouchableWithoutFeedback, Dimensions, RefreshControl, ActivityIndicator,
  Animated as RNAnimated,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withSequence,
  FadeIn, FadeInDown,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '@krushisarva/shared/utils/haptics';
import { SPRINGS, AnimatedCard, enterAnimation } from '@krushisarva/shared/components/ui/motion';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useScrollHeader from '../../hooks/useScrollHeader';
import api from '@krushisarva/shared/services/api';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import { useAuth } from '@krushisarva/shared/context/AuthContext';
import { COLORS, TYPE, RADIUS, SHADOWS } from '@krushisarva/shared/constants/colors';
import { KHET, KFONT, KSHADOW } from '@krushisarva/shared/constants/khetTheme';
import AnimatedScreen from '@krushisarva/shared/components/ui/AnimatedScreen';
import ScrollToTopButton from '../../components/ScrollToTopButton';
import PhotoIcon from '../../components/PhotoIcon';
import MockImagePlaceholder from '../../components/MockImagePlaceholder';
import { SkeletonGrid } from '../../components/ui/Skeleton';
import { StoreCategoryIcon } from '@krushisarva/shared/components/StoreCategoryIcons';
import {
  createRequestLane, fetchProducts as apiFetchProducts, fetchCategories as apiFetchCategories,
  readCache, writeCache, formatCacheAge, thumbUrl, inr, discountPct,
  pushRecentSearch, readRecentSearches, SHOP_ERRORS,
} from './shopClient';

const { width: W, height: H } = Dimensions.get('window');

/**
 * Sort chips for the All Products grid.
 *
 * Every key here is one the server implements (agristore.routes.js `SORTS` +
 * `OFFER_SORTS`). Deliberately NO "bestselling"/"popular" chip: that route's own
 * comment records that there is no sales counter, and `popularity` was removed
 * because it ordered by a viewCount column nothing writes. Offering the chip
 * would be a fabricated claim about what other farmers bought.
 *
 * The `sort` state, the fetch param and the cache key already existed and were
 * threaded end-to-end — only the control was missing, so this adds no new
 * request shape.
 */
const SORT_OPTIONS = [
  { key: 'relevance',  labelKey: 'store.sortTopRated',  fallback: 'Top rated',       icon: 'star' },
  { key: 'latest',     labelKey: 'store.sortLatest',    fallback: 'Newest',          icon: 'sparkles' },
  { key: 'price_asc',  labelKey: 'store.sortPriceAsc',  fallback: 'Price: Low–High', icon: 'arrow-up' },
  { key: 'price_desc', labelKey: 'store.sortPriceDesc', fallback: 'Price: High–Low', icon: 'arrow-down' },
];
const GREEN    = COLORS.primary;
const GREEN_L  = COLORS.primaryPale;
const ORANGE   = COLORS.cta;
const GOLD     = COLORS.yellowDark2;
const BG       = COLORS.background;
const CARD     = COLORS.surface;
const BORDER   = COLORS.border;
const DRAWER_W = W * 0.85;

// ─────────────────────────────────────────────────────────────────────────────
// Category Drawer — flat list, slides from left, web-prototype style
// ─────────────────────────────────────────────────────────────────────────────
function CategoryDrawer({ visible, categories, selectedCat, language, onSelect, onClose, insets, t }) {
  const slideX    = useRef(new RNAnimated.Value(-DRAWER_W)).current;
  const bgOpacity = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      RNAnimated.parallel([
        RNAnimated.spring(slideX,    { toValue: 0,          useNativeDriver: true, friction: 22, tension: 200 }),
        RNAnimated.timing(bgOpacity, { toValue: 1,          useNativeDriver: true, duration: 220 }),
      ]).start();
    } else {
      RNAnimated.parallel([
        RNAnimated.timing(slideX,    { toValue: -DRAWER_W,  useNativeDriver: true, duration: 200 }),
        RNAnimated.timing(bgOpacity, { toValue: 0,          useNativeDriver: true, duration: 200 }),
      ]).start();
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <TouchableWithoutFeedback onPress={onClose}>
        <RNAnimated.View style={[DR.backdrop, { opacity: bgOpacity }]} />
      </TouchableWithoutFeedback>

      <RNAnimated.View style={[DR.panel, { transform: [{ translateX: slideX }] }]}>
        {/* Header — green-tint like web prototype */}
        <View style={[DR.header, { paddingTop: insets.top + 12 }]}>
          <View>
            <Text style={DR.headerSub}>{t('store.browse')}</Text>
            <Text style={DR.headerTitle}>{t('store.shopName')}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={DR.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={22} color={GREEN} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {/* All Products */}
          <TouchableOpacity
            style={[DR.allRow, selectedCat === '__all__' && DR.allRowActive]}
            onPress={() => { onSelect('__all__', null); onClose(); }}
            activeOpacity={0.75}
          >
            <Text style={[DR.allRowTxt, selectedCat === '__all__' && DR.allRowTxtActive]}>{t('store.allProducts')}</Text>
            <Ionicons name="chevron-forward" size={18} color={selectedCat === '__all__' ? GREEN : COLORS.grayMedium} />
          </TouchableOpacity>

          <View style={DR.sectionHeader}>
            <Text style={DR.sectionHeaderTxt}>{t('store.shopBySection')}</Text>
          </View>

          {categories.map(cat => {
            const langKey = language === 'mr' ? 'nameMr' : language === 'hi' ? 'nameHi' : language === 'ta' ? 'nameTa' : language === 'kn' ? 'nameKn' : language === 'ml' ? 'nameMl' : language === 'te' ? 'nameTe' : language === 'bn' ? 'nameBn' : language === 'gu' ? 'nameGu' : language === 'pa' ? 'namePa' : null;
            const label = (langKey && cat[langKey]) || cat.name || cat.nameHi;
            const active = selectedCat === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[DR.catRow, active && DR.catRowActive]}
                onPress={() => { onSelect(cat.id, null); onClose(); }}
                activeOpacity={0.75}
              >
                <PhotoIcon
                  set="cat" name={cat.icon || cat.name} size={34} radius={8}
                  fallback={<StoreCategoryIcon type={cat.icon || cat.name} size={26} animated={false} />}
                />
                <Text style={[DR.catRowTxt, active && DR.catRowTxtActive]} numberOfLines={1}>{label}</Text>
                <Ionicons name="chevron-forward" size={16} color={active ? GREEN : COLORS.grayMedium} />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </RNAnimated.View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Language item — isolated for useRef per row
// ─────────────────────────────────────────────────────────────────────────────
function LangItem({ lang, active, onSelect }) {
  const sc = useSharedValue(1);
  const scStyle = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  return (
    <Animated.View style={scStyle}>
      <Pressable
        style={[S.lpRow, active && S.lpRowActive]}
        onPressIn={() => { sc.value = withSpring(0.97, SPRINGS.snappy); }}
        onPressOut={() => { sc.value = withSpring(1, SPRINGS.snappy); }}
        onPress={() => { Haptics.selection(); onSelect(lang.code); }}
      >
        <View style={[S.lpFlagWrap, active && { backgroundColor: GREEN + '14' }]}>
          <Text style={S.lpFlag}>{lang.flag}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[S.lpName, active && S.lpNameActive]}>{lang.name}</Text>
          <Text style={S.lpNative}>{lang.nativeName}{lang.region ? `  ·  ${lang.region}` : ''}</Text>
        </View>
        {active
          ? <View style={S.lpCheck}><Ionicons name="checkmark" size={14} color={COLORS.white} /></View>
          : <View style={S.lpRadio} />
        }
      </Pressable>
    </Animated.View>
  );
}

// Make a soft tinted background from a hex color
function hexToRgba(hex = COLORS.primary, alpha = 0.12) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Horizontal category pill tabs — uses icon + color from API response
// ─────────────────────────────────────────────────────────────────────────────
function CategoryPills({ categories, selected, onSelect, language, t }) {
  return (
    <View style={S.pillsWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={S.pillsRow}
      >
        {/* "All" pill */}
        <TouchableOpacity
          style={[S.pill, selected === '__all__' && S.pillActive]}
          onPress={() => onSelect('__all__', null)}
          activeOpacity={0.82}
        >
          <View style={[S.pillIcon, { backgroundColor: selected === '__all__' ? 'rgba(255,255,255,0.25)' : GREEN_L }]}>
            <Ionicons name="storefront" size={14} color={selected === '__all__' ? COLORS.white : GREEN} />
          </View>
          <Text style={[S.pillTxt, selected === '__all__' && S.pillTxtActive]} numberOfLines={1}>{t('all')}</Text>
        </TouchableOpacity>

        {categories.map(cat => {
          const langKey = language === 'mr' ? 'nameMr' : language === 'hi' ? 'nameHi' : language === 'ta' ? 'nameTa' : language === 'kn' ? 'nameKn' : language === 'ml' ? 'nameMl' : language === 'te' ? 'nameTe' : language === 'bn' ? 'nameBn' : language === 'gu' ? 'nameGu' : language === 'pa' ? 'namePa' : null;
          const label = (langKey && cat[langKey]) || cat.name || cat.nameHi;
          const active  = selected === cat.id;
          const color    = cat.color || GREEN;

          return (
            <TouchableOpacity
              key={cat.id}
              style={[S.pill, active && S.pillActive, active && { borderColor: color, backgroundColor: color }]}
              onPress={() => onSelect(cat.id, null)}
              activeOpacity={0.82}
            >
              <View style={[S.pillIcon, { backgroundColor: active ? 'rgba(255,255,255,0.25)' : hexToRgba(color, 0.14) }]}>
                <PhotoIcon
                  set="cat" name={cat.icon || cat.name} size={30} radius={8}
                  fallback={<StoreCategoryIcon type={cat.icon || cat.name} size={24} animated={false} />}
                />
              </View>
              <Text style={[S.pillTxt, active && S.pillTxtActive]} numberOfLines={2}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stock urgency badge — out-of-stock or "Only N left" when stock <= 5
// ─────────────────────────────────────────────────────────────────────────────
function StockBadge({ stock }) {
  const { t } = useLanguage();
  if (stock == null) return null;
  if (stock === 0) {
    return (
      <View style={[S.stockBadge, S.stockBadgeOut]}>
        <Text style={S.stockBadgeTxt}>{t('product.outOfStock')}</Text>
      </View>
    );
  }
  if (stock <= 5) {
    return (
      <View style={[S.stockBadge, S.stockBadgeLow]}>
        <Text style={S.stockBadgeTxt}>{t('store.onlyLeft', { stock })}</Text>
      </View>
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Best Seller card — web prototype: image + discount top-left, price, circle add
// ─────────────────────────────────────────────────────────────────────────────
function BestSellerCard({ item, onPress }) {
  const { t } = useLanguage();
  const discount = discountPct(item.mrp, item.price);
  // A card-sized thumbnail, not the full-resolution original — see thumbUrl().
  const imageUrl = thumbUrl(item.images?.[0], 320);

  return (
    <AnimatedCard style={S.bsCard} onPress={() => onPress(item)} scaleValue={0.96}>
      <View>
        <View style={S.bsImgWrap}>
          {imageUrl
            ? <Image source={{ uri: imageUrl }} style={S.bsImg} resizeMode="cover" />
            : <View style={[S.bsImg, { justifyContent: 'center', alignItems: 'center' }]}>
                <MockImagePlaceholder category={item.category || item.categoryId} size={130} />
              </View>
          }
          {discount > 0 && (
            <View style={S.bsDiscLeft}><Text style={S.bsDiscTxt}>{t('store.percentOff', { discount })}</Text></View>
          )}
          <StockBadge stock={item.stock} />
        </View>
        <View style={S.bsBody}>
          <Text style={S.bsName} numberOfLines={2}>{item.name}</Text>
          <View style={S.bsRatingRow}>
            <Ionicons name="star" size={11} color={GOLD} />
            <Text style={S.bsRatingTxt}>{item.rating} ({item.ratingCount})</Text>
          </View>
          <View style={S.bsFooter}>
            <Text style={S.bsPrice}>{inr(item.price)}</Text>
            <TouchableOpacity
              style={S.bsAddBtn}
              onPress={() => onPress(item)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('product.viewDetails', { name: item.name, defaultValue: `View ${item.name}` })}
            >
              <Ionicons name="add" size={18} color={COLORS.white} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </AnimatedCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Product grid card — web prototype: heart top-left, discount top-right, full-width add btn
// ─────────────────────────────────────────────────────────────────────────────
const ProductCard = memo(function ProductCard({ item, onPress, t, index }) {
  const discount = discountPct(item.mrp, item.price);
  // Thumbnail, not the original: a 20-card grid was downloading and decoding 20
  // full-resolution images into a 130px box.
  const imageUrl = thumbUrl(item.images?.[0], 320);

  // REMOVED: the local `liked` heart.
  // It was `useState(false)` and nothing else — no API, no persistence. Tapping
  // it animated, then the value was discarded the moment the card scrolled out
  // of the render window, so the farmer's "saved" item silently un-saved itself.
  // A control that does nothing is worse than no control; wishlist needs a
  // backend table before the heart comes back.

  return (
    <AnimatedCard
      style={S.gridCard}
      onPress={() => onPress(item)}
      index={index}
      scaleValue={0.97}
      accessibilityLabel={`${item.name} ${item.price} rupees`}
    >
        <View style={S.gridImgWrap}>
          {imageUrl
            ? <Image source={{ uri: imageUrl }} style={S.gridImg} resizeMode="cover" />
            : <View style={[S.gridImg, { justifyContent: 'center', alignItems: 'center' }]}>
                <MockImagePlaceholder category={item.category || item.categoryId} size={130} />
              </View>
          }
          {/* Bottom gradient overlay */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.22)']}
            style={S.gridImgGrad}
            pointerEvents="none"
          />
          {/* Discount top-RIGHT */}
          {discount > 0 && (
            <View style={S.gridDiscRight}><Text style={S.gridDiscTxt}>{t('store.percentOff', { discount })}</Text></View>
          )}
          {/* Star rating bottom-right overlay */}
          {item.rating > 0 && (
            <View style={S.gridRatingBadge}>
              <Ionicons name="star" size={9} color={GOLD} />
              <Text style={S.gridRatingBadgeTxt}>{item.rating}</Text>
            </View>
          )}
          <StockBadge stock={item.stock} />
        </View>
        <View style={S.gridBody}>
          <Text style={S.gridName} numberOfLines={2}>{item.name}</Text>
          <View style={S.gridPriceRow}>
            {/* The cheapest ELIGIBLE offer — cheapest among the sellers who can
                actually deliver to this buyer, not a catalog price. */}
            <Text style={S.gridPrice}>{inr(item.price)}</Text>
            {/* Struck MRP only when there is a real, positive difference — no
                MRP means no "% off" badge, rather than an invented one. */}
            {discount > 0 && <Text style={S.gridMrp}>{inr(item.mrp)}</Text>}
          </View>
          {item.sellerCount > 1 && (
            <Text style={S.gridSellers} numberOfLines={1}>
              {t('store.fromSellers', { count: item.sellerCount, defaultValue: `from ${item.sellerCount} sellers` })}
            </Text>
          )}
          {/* Opens the product. Labelled for what it does — the button reads
              "Add to cart" but has always navigated to the detail screen, and a
              farmer tapping it expects the item to be in their cart. */}
          <TouchableOpacity
            style={S.addToCartBtn}
            onPress={() => onPress(item)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('product.viewDetails', { name: item.name, defaultValue: `View ${item.name}` })}
          >
            <Ionicons name="eye-outline" size={14} color={COLORS.white} />
            <Text style={S.addToCartTxt}>{t('store.viewProduct', 'View')}</Text>
          </TouchableOpacity>
        </View>
    </AnimatedCard>
  );
}, (prev, next) => (
  // Memoised on the fields a card actually renders. Without this every card
  // re-renders on every keystroke in the search box, because the parent
  // re-renders and `renderItem` produces a fresh element each time — the single
  // biggest source of dropped frames while typing on a mid-range device.
  prev.item.id === next.item.id
  && prev.item.price === next.item.price
  && prev.item.mrp === next.item.mrp
  && prev.item.stock === next.item.stock
  && prev.item.rating === next.item.rating
  && prev.item.sellerCount === next.item.sellerCount
  && prev.index === next.index
));


// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────
const ALL_ID = '__all__';

export default function AgriStoreHome({ navigation }) {
  const { t, language, setLanguage, LANGUAGES } = useLanguage();
  const insets = useSafeAreaInsets();
  // ── Only the LOGO BAR collapses; the status-bar inset never does ───────────
  // This was `insets.top + 60`, i.e. the safe-area inset was inside the
  // collapsing region and got animated to zero along with it. On scroll the
  // whole header — inset included — closed to nothing and the search bar slid up
  // underneath the clock and battery icons.
  //
  // 78 = paddingTop 10 + logo 44 + row margin 12 + paddingBottom 10 + hairline.
  // A constant rather than an onLayout measurement because the element being
  // measured lives inside the very view whose height is being animated, so
  // feeding its layout back in would oscillate. Over-estimating is harmless
  // (the collapse just finishes fractionally early); the previous value
  // under-estimated by 16px and was already clipping the logo's bottom edge.
  const HEADER_BAR_H = 78;
  const { onScroll: hideOnScroll, headerAnimatedStyle, showTopBtn } = useScrollHeader(HEADER_BAR_H);
  const scrollRef = useRef(null);

  // Geography GATES which offers exist, so the storefront asks for the buyer's
  // district and the API filters at the LISTING level. Before the split this was
  // a filter on the fused product row; a Kendra that cannot deliver here is now
  // excluded from the price on the card, not just from the buy box.
  const { user } = useAuth();
  const district = user?.district || null;

  const [drawerOpen,         setDrawerOpen]         = useState(false);
  const [langPickerOpen,     setLangPickerOpen]     = useState(false);
  const [selectedCategory,   setSelectedCategory]   = useState(ALL_ID);
  const [selectedSubcategory, setSelectedSubcategory] = useState(null);
  const [searchQuery,        setSearchQuery]        = useState('');
  const [searchFocused,      setSearchFocused]      = useState(false);
  const [categories,         setCategories]         = useState([]);
  const [products,           setProducts]           = useState([]);
  const { count: cartCount, refresh: refreshCart } = useCart();
  const [loading,            setLoading]            = useState(true);
  const searchTimer = useRef(null);

  // ── Paging, refresh, offline and error state ──────────────────────────────
  // The screen used to hold exactly two pieces of state: `products` and
  // `loading`. That is why a network blip emptied the shop (nowhere to record
  // "the fetch failed but these products are still valid"), why there was no
  // second page (nowhere to record a cursor), and why "no products here" and
  // "we could not reach the server" rendered identically.
  const [page,        setPage]        = useState(1);
  const [hasMore,     setHasMore]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [error,       setError]       = useState(null);   // { code, action, message, requestId }
  const [fromCache,   setFromCache]   = useState(null);   // { ageMs } when showing saved results
  const [totalCount,  setTotalCount]  = useState(null);
  const [sort,        setSort]        = useState('relevance');
  const [recent,      setRecent]      = useState([]);

  const PAGE_SIZE = 20;

  // One lane for the grid. Issuing a fetch aborts the previous one and stamps a
  // sequence number, so a slow response for an old query can never overwrite a
  // fast response for the current one.
  const gridLane = useRef(createRequestLane()).current;
  const catLane  = useRef(createRequestLane()).current;

  // Language bottom-sheet animation
  const sheetY  = useRef(new RNAnimated.Value(H)).current;
  const sheetBg = useRef(new RNAnimated.Value(0)).current;

  const openLangPicker = () => {
    setLangPickerOpen(true);
    RNAnimated.parallel([
      RNAnimated.spring(sheetY,  { toValue: 0, useNativeDriver: true, friction: 20, tension: 180 }),
      RNAnimated.timing(sheetBg, { toValue: 1, useNativeDriver: true, duration: 220 }),
    ]).start();
  };

  const closeLangPicker = () => {
    RNAnimated.parallel([
      RNAnimated.timing(sheetY,  { toValue: H,   useNativeDriver: true, duration: 240, easing: Easing.in(Easing.quad) }),
      RNAnimated.timing(sheetBg, { toValue: 0,   useNativeDriver: true, duration: 200 }),
    ]).start(() => setLangPickerOpen(false));
  };

  // Categories: paint the cached copy first, then refresh in the background.
  // Categories change about once a quarter and are needed to render the very
  // first frame, so waiting on the network for them is pure latency. A failed
  // refresh leaves the cached list in place rather than clearing the nav.
  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await readCache('categories');
      if (alive && cached?.data?.length) setCategories(cached.data);

      const { stale, data } = await catLane.send((signal) => apiFetchCategories(signal));
      if (!alive || stale) return;
      if (Array.isArray(data)) {
        setCategories(data);
        writeCache('categories', data);
      }
      // On failure: keep whatever is on screen. An empty category rail with a
      // full product grid is a worse state than a slightly stale rail.
    })();
    return () => { alive = false; };
  }, [catLane]);

  useEffect(() => { readRecentSearches().then(setRecent); }, []);

  // Clear the search focus ring once the keyboard is dismissed — on Android the
  // back-press hides the keyboard without firing onBlur, so the ring would stick.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => setSearchFocused(false));
    return () => sub.remove();
  }, []);

  /** The query the current filter state describes. Page is supplied per call. */
  const buildParams = useCallback((pageNum) => {
    const params = { limit: PAGE_SIZE, page: pageNum, sort };
    if (selectedCategory !== ALL_ID) params.category    = selectedCategory;
    if (selectedSubcategory)         params.subcategory = selectedSubcategory;
    if (searchQuery.trim())          params.search      = searchQuery.trim();
    if (district)                    params.district    = district;
    return params;
  }, [selectedCategory, selectedSubcategory, searchQuery, district, sort]);

  /** Cache key for the current filter set. Page 1 only — deeper pages are not cached. */
  const cacheKey = useCallback(
    () => `products:${selectedCategory}:${selectedSubcategory || ''}:${district || ''}:${sort}`,
    [selectedCategory, selectedSubcategory, district, sort],
  );

  /**
   * Load page 1.
   *
   * `isRefresh` distinguishes a pull-to-refresh (keep the current products on
   * screen, show the spinner in the control) from a filter change (show
   * skeletons). Neither ever clears the grid on failure — that was the old
   * `catch { setProducts([]) }`, which turned a dropped packet into "this shop
   * has no products".
   */
  const loadFirstPage = useCallback(async ({ isRefresh = false } = {}) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);

    const { stale, data, error: err } = await gridLane.send(
      (signal) => apiFetchProducts(buildParams(1), signal),
    );
    // Superseded by a newer query — drop it. Rendering it is exactly the stale
    // -response bug this lane exists to prevent.
    if (stale) return;

    if (err) {
      setError(err);
      // Nothing on screen yet? Fall back to the last good results for this
      // filter set, clearly labelled with their age.
      if (!products.length) {
        const cached = await readCache(cacheKey());
        if (cached?.data?.length) {
          setProducts(cached.data);
          setFromCache({ ageMs: cached.ageMs });
          setHasMore(false);
        }
      }
      setLoading(false); setRefreshing(false);
      return;
    }

    const items = data?.items || [];
    setProducts(items);
    setPage(1);
    setTotalCount(data?.meta?.total ?? null);
    setHasMore(items.length >= PAGE_SIZE && (data?.meta?.hasMore ?? true));
    setFromCache(null);
    // Only page 1 of an unsearched view is worth caching — a search result is
    // ephemeral and caching it would fill storage with single-use entries.
    if (!searchQuery.trim()) writeCache(cacheKey(), items);

    setLoading(false); setRefreshing(false);
  }, [gridLane, buildParams, cacheKey, products.length, searchQuery]);

  /**
   * Append the next page.
   *
   * De-duplicated by id: offset pagination over a catalogue that is being
   * written to can return a row twice, and a duplicate key in a FlatList is both
   * a React warning and a product the farmer sees twice.
   */
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading || refreshing) return;
    setLoadingMore(true);

    const next = page + 1;
    // Deliberately NOT on gridLane: a page-2 request must not abort the page-1
    // request, and vice versa. It carries its own guard via the page check below.
    try {
      const { items } = await apiFetchProducts(buildParams(next), undefined);
      setProducts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const fresh = items.filter((p) => !seen.has(p.id));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
      setPage(next);
      setHasMore(items.length >= PAGE_SIZE);
    } catch {
      // A failed "load more" must not disturb what is already on screen; the
      // farmer simply scrolls again.
      setHasMore(true);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, loading, refreshing, page, buildParams]);

  // Debounced reload on any filter/search change. 400 ms while typing (inside
  // the 300–500 ms band that keeps search feeling live without a request per
  // keystroke), immediate for a filter tap.
  useEffect(() => {
    clearTimeout(searchTimer.current);
    const delay = searchQuery.length > 0 ? 400 : 0;
    searchTimer.current = setTimeout(() => loadFirstPage(), delay);
    return () => clearTimeout(searchTimer.current);
    // loadFirstPage is intentionally excluded: it changes identity on every
    // products-length change, which would re-fire this effect after every load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, selectedSubcategory, searchQuery, district, sort]);

  // Remember a search only once it has produced results the farmer looked at.
  useEffect(() => {
    if (!loading && searchQuery.trim().length >= 2 && products.length > 0) {
      pushRecentSearch(searchQuery.trim());
    }
  }, [loading, searchQuery, products.length]);

  const handleCategorySelect = (catId, sub) => {
    setSelectedCategory(catId);
    setSelectedSubcategory(sub || null);
    // A category change is a new result set, not more of the current one.
    setPage(1);
    setHasMore(false);
  };

  // Re-sync the global cart count on focus — covers a change made in a screen
  // that doesn't go through CartContext. Gated: CartContext already loads the
  // count on mount, and cart mutations update it through the context, so the
  // only job left here is catching drift. Once a minute is plenty.
  useFocusRefresh(refreshCart, { key: 'cart', staleMs: 60_000, runOnFirstFocus: false });

  // Route params carry the CATALOG product id — never a listing id. The detail
  // screen refetches by id and resolves the winning offer itself; passing the
  // object alone would leave it unable to re-price when the buyer switches
  // sellers. `district` travels too, because geography gates which offers exist.
  const handleProductPress = useCallback((item) => {
    navigation.navigate('ProductDetail', {
      productId: item.id,
      product: item,
      district: district || null,
    });
  }, [navigation, district]);

  // The rail is TOP RATED, and is derived by rating rather than by list position.
  // `products.slice(0, 8)` under a "Best Sellers" heading was the first 8 rows of
  // whatever the current sort happened to be — which under a price sort is "the
  // 8 cheapest", presented as what other farmers buy most.
  const topRated = products
    .filter((p) => Number(p.rating) > 0 && Number(p.ratingCount) > 0)
    .slice(0, 8);

  return (

    <AnimatedScreen>
    <View style={[S.root]}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* ── Category Drawer ── */}
      <CategoryDrawer
        visible={drawerOpen}
        categories={categories}
        selectedCat={selectedCategory}
        language={language}
        onSelect={handleCategorySelect}
        onClose={() => setDrawerOpen(false)}
        insets={insets}
        t={t}
      />

      {/* Status-bar inset — deliberately OUTSIDE the collapsing header, so the
          content below can never scroll up under the clock and battery. */}
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* ── Header top bar (collapses on scroll) ── */}
      <Animated.View style={headerAnimatedStyle}>
        <View style={[S.header, { paddingTop: 10, paddingBottom: 10 }]}>
          <View style={S.headerTop}>
            <View style={S.headerSide}>
              <TouchableOpacity style={S.hamburger} onPress={() => setDrawerOpen(true)} activeOpacity={0.7}>
                <View style={S.hamLine} />
                <View style={[S.hamLine, { width: 18 }]} />
                <View style={S.hamLine} />
              </TouchableOpacity>
              <Image
                source={require('../../../assets/krushisarva-header.png')}
                style={S.brandLogo}
                resizeMode="contain"
                accessibilityLabel={t('appName')}
              />
            </View>
            <View style={S.headerRight}>
              <TouchableOpacity style={S.langBtn} onPress={openLangPicker} activeOpacity={0.8}>
                <Ionicons name="globe-outline" size={16} color={GREEN} />
                <Text style={S.langBtnTxt}>{language.toUpperCase()}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.cartBtn} onPress={() => navigation.navigate('Cart')} activeOpacity={0.8}>
                <Ionicons name="cart-outline" size={26} color={COLORS.charcoal} />
                {cartCount > 0 && <View style={S.cartBadge}><Text style={S.cartBadgeTxt}>{cartCount}</Text></View>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Animated.View>

      {/* ── Search + Categories (always visible) ── */}
      <View style={{ backgroundColor: KHET.muted, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4 }}>
        <View style={[S.searchBar, searchFocused && S.searchBarFocused]}>
          <Ionicons
            name="search-outline"
            size={18}
            color={searchFocused ? KHET.primary : KHET.mutedForeground}
          />
          <TextInput
            style={S.searchInput}
            placeholder={t('store.searchPlaceholder', 'Search agri-related products here')}
            placeholderTextColor="rgba(87,104,90,0.5)"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            returnKeyType="search"
            selectionColor={KHET.primary}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color={KHET.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </View>
      {categories.length > 0 && (
        <CategoryPills
          categories={categories}
          selected={selectedCategory}
          onSelect={handleCategorySelect}
          language={language}
          t={t}
        />
      )}

      {/* ── Scrollable content ────────────────────────────────────────────────
          ONE FlatList, not a FlatList inside a ScrollView.

          The grid used to be `<FlatList scrollEnabled={false}>` nested in a
          ScrollView, which switches virtualisation OFF entirely: every product
          mounts at once, `windowSize` and `maxToRenderPerBatch` do nothing, and
          the scroll gets heavier with each item. That is fine at 40 rows and is
          exactly what makes a mid-range Android drop frames at 400.

          The rails and section headers move into ListHeaderComponent, so the
          layout is unchanged and virtualisation is real. */}
      <FlatList
        ref={scrollRef}
        data={loading && !products.length ? [] : products}
        keyExtractor={(item) => item.id}
        numColumns={2}
        showsVerticalScrollIndicator={false}
        style={S.scroll}
        contentContainerStyle={[S.scrollContent, S.contentSheet]}
        columnWrapperStyle={{ gap: 12, alignItems: 'stretch', paddingHorizontal: 12 }}
        onScroll={hideOnScroll}
        scrollEventThrottle={16}
        windowSize={7}
        initialNumToRender={PAGE_SIZE / 2}
        maxToRenderPerBatch={PAGE_SIZE / 2}
        removeClippedSubviews
        // Infinite scroll. 0.6 rather than the default 0.1 so the next page is
        // already arriving before the farmer reaches the bottom — on a slow
        // connection a late trigger reads as the list having ended.
        onEndReachedThreshold={0.6}
        onEndReached={loadMore}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadFirstPage({ isRefresh: true })}
            tintColor={GREEN}
            colors={[GREEN]}
          />
        )}
        renderItem={({ item, index }) => (
          <ProductCard item={item} onPress={handleProductPress} t={t} index={index} />
        )}
        ListHeaderComponent={(
          <View>
            {/* Cached-results banner. Showing saved prices without saying they
                are saved is worse than showing nothing; saying so makes them
                useful. */}
            {fromCache ? (
              <View style={S.noticeBar}>
                <Ionicons name="cloud-offline-outline" size={15} color={COLORS.textMedium} />
                <Text style={S.noticeTxt} numberOfLines={2}>
                  {t('shop.showingSaved', 'Showing saved results')} · {formatCacheAge(fromCache.ageMs, t)}
                </Text>
                <TouchableOpacity onPress={() => loadFirstPage({ isRefresh: true })} hitSlop={8}>
                  <Text style={S.noticeAction}>{t('retry', 'Retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* An error WITH products still on screen is a thin bar, not a
                takeover: the products are still valid and still shoppable. */}
            {error && products.length > 0 ? (
              <View style={[S.noticeBar, S.noticeBarWarn]}>
                <Ionicons name="warning-outline" size={15} color={COLORS.error} />
                <Text style={[S.noticeTxt, { color: COLORS.error }]} numberOfLines={2}>{error.message}</Text>
                <TouchableOpacity onPress={() => loadFirstPage({ isRefresh: true })} hitSlop={8}>
                  <Text style={S.noticeAction}>{t('retry', 'Retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Top rated rail.
                Previously labelled "Best Sellers" — but there is no sales
                counter anywhere in this system, so the list was simply the first
                8 of a rating-ordered page. Naming it after what the data
                actually is costs nothing and stops the app making a claim about
                what other farmers bought that it cannot support. */}
            {!loading && topRated.length > 0 && !searchQuery.trim() && (
              <View style={S.section}>
                <View style={S.sectionRow}>
                  <Text style={S.sectionTitle}>{t('store.topRated', 'Top rated')}</Text>
                  <TouchableOpacity style={S.seeAllBtn} onPress={() => { setSort('rating'); setSelectedCategory(ALL_ID); }}>
                    <Text style={S.seeAllTxt}>{t('store.viewAll')}</Text>
                    <Ionicons name="chevron-forward" size={14} color={GREEN} />
                  </TouchableOpacity>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.bsScroll}>
                  {topRated.map((item) => (
                    <BestSellerCard key={item.id} item={item} onPress={handleProductPress} />
                  ))}
                </ScrollView>
              </View>
            )}

            <View style={S.sectionRow}>
              <Text style={S.sectionTitle}>
                {searchQuery.trim() ? t('store.searchResults', 'Results') : t('store.allProducts')}
              </Text>
              <Text style={S.resultCount}>
                {t('store.itemCount', { count: totalCount ?? products.length })}
              </Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={S.sortRow}
              keyboardShouldPersistTaps="handled"
            >
              {SORT_OPTIONS.map((opt) => {
                const active = sort === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[S.sortChip, active && S.sortChipActive]}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => { if (!active) { Haptics.selection(); setSort(opt.key); } }}
                  >
                    <Ionicons
                      name={opt.icon}
                      size={13}
                      color={active ? COLORS.white : GREEN}
                    />
                    <Text style={[S.sortChipTxt, active && S.sortChipTxtActive]} numberOfLines={1}>
                      {t(opt.labelKey, opt.fallback)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {loading && !products.length ? (
              // 2 rows × 2 columns = the same four placeholder cards this grid has
              // always shown, now from the shared kit. gutter tracks
              // columnWrapperStyle's 12pt padding and photoRatio the 130px
              // gridImgWrap, so nothing shifts when the products land.
              <SkeletonGrid rows={2} gutter={12} gap={12} photoH={130} bordered style={S.productGrid} label={t('loading')} />
            ) : null}
          </View>
        )}
        ListEmptyComponent={loading ? null : (
          <View style={S.emptyWrap}>
            <View style={S.emptyIconWrap}>
              <StoreCategoryIcon type={error ? 'bag' : 'bag'} size={72} animated />
            </View>
            {error ? (
              <>
                {/* "We could not reach the server" and "this shop is empty" are
                    different situations with different next steps. They used to
                    render as the same "coming soon" screen. */}
                <Text style={S.emptyTitle}>
                  {error.code === SHOP_ERRORS.OFFLINE
                    ? t('shop.offlineTitle', 'No internet connection')
                    : t('shop.errorTitle', 'Could not load products')}
                </Text>
                <Text style={S.emptyTxt}>{error.message}</Text>
                <TouchableOpacity style={S.emptyBtn} onPress={() => loadFirstPage({ isRefresh: true })}>
                  <Ionicons name="refresh" size={16} color={COLORS.white} />
                  <Text style={S.emptyBtnTxt}>{t('retry', 'Try again')}</Text>
                </TouchableOpacity>
                {error.requestId ? (
                  <Text style={S.emptyHint}>
                    {t('shop.refCode', 'Reference')}: {String(error.requestId).slice(0, 8)}
                  </Text>
                ) : null}
              </>
            ) : searchQuery.trim() || selectedCategory !== ALL_ID ? (
              <>
                {/* An empty SEARCH is not an empty catalogue. The recovery is to
                    widen the search, and the screen says so and offers it. */}
                <Text style={S.emptyTitle}>{t('shop.noResultsTitle', 'No products found')}</Text>
                <Text style={S.emptyTxt}>
                  {t('shop.noResultsMsg', 'Try a different word, or search in all categories.')}
                </Text>
                <TouchableOpacity
                  style={S.emptyBtn}
                  onPress={() => { setSearchQuery(''); setSelectedCategory(ALL_ID); setSelectedSubcategory(null); }}
                >
                  <Ionicons name="close-circle-outline" size={16} color={COLORS.white} />
                  <Text style={S.emptyBtnTxt}>{t('shop.clearFilters', 'Clear filters')}</Text>
                </TouchableOpacity>
                {district ? (
                  <Text style={S.emptyHint}>
                    {t('shop.tryOtherLocation', { district, defaultValue: `Showing sellers who deliver to ${district}.` })}
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={S.emptyTitle}>{t('ai.comingSoon')}</Text>
                <Text style={S.emptyTxt}>{t('store.comingSoonMsg')}</Text>
                <Text style={S.emptyHint}>{t('store.comingSoonHint')}</Text>
              </>
            )}
          </View>
        )}
        ListFooterComponent={(
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            {loadingMore ? <ActivityIndicator size="small" color={GREEN} /> : null}
            {!loadingMore && !hasMore && products.length > 0 ? (
              <Text style={S.endTxt}>{t('shop.endOfList', 'That is everything for now')}</Text>
            ) : null}
          </View>
        )}
      />

      <ScrollToTopButton
        visible={showTopBtn}
        onPress={() => scrollRef.current?.scrollToOffset({ offset: 0, animated: true })}
      />

      {/* ── Language Picker Modal (animated bottom sheet) ── */}
      <Modal
        visible={langPickerOpen}
        transparent
        animationType="none"
        onRequestClose={closeLangPicker}
        statusBarTranslucent
      >
        <TouchableWithoutFeedback onPress={closeLangPicker}>
          <RNAnimated.View style={[S.lpBackdrop, { opacity: sheetBg }]} />
        </TouchableWithoutFeedback>

        <RNAnimated.View style={[S.lpSheet, { paddingBottom: insets.bottom + 16, transform: [{ translateY: sheetY }] }]}>
          {/* Drag handle */}
          <View style={S.lpHandleWrap}>
            <View style={S.lpHandle} />
          </View>
          {/* Title */}
          <Text style={S.lpTitle}>{t('profile.selectLanguage')}</Text>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            {LANGUAGES.map(lang => (
              <LangItem
                key={lang.code}
                lang={lang}
                active={lang.code === language}
                onSelect={code => { setLanguage(code); closeLangPicker(); }}
              />
            ))}
          </ScrollView>
        </RNAnimated.View>
      </Modal>
    </View>
    </AnimatedScreen>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  root:   { flex: 1, backgroundColor: KHET.muted },
  scroll: { flex: 1, backgroundColor: KHET.muted },
  scrollContent: { flexGrow: 1 },
  // Rounded-top white "sheet" holding the product list — echoes the rounded
  // search card so the list reads as a defined panel, not a flat region.
  contentSheet: {
    flexGrow: 1,
    backgroundColor: KHET.card,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    marginTop: 10,
    paddingTop: 6,
    borderTopWidth: 1,
    borderColor: KHET.border,
    shadowColor: '#0e3a20',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },

  // ── Header ──
  header: {
    paddingBottom: 14, paddingHorizontal: 18,
    backgroundColor: CARD,
    borderBottomWidth: 1, borderBottomColor: BORDER,
    ...SHADOWS.small,
  },
  headerTop:   { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  // Left zone groups the hamburger + wordmark together so the logo sits right
  // next to the menu; the right zone (headerRight) holds the actions, flex-end.
  headerSide:  { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  hamburger:   { padding: 4, gap: 4, justifyContent: 'center' },
  hamLine:     { width: 22, height: 2.5, borderRadius: 2, backgroundColor: COLORS.textDark },
  // KrushiSarva header lockup (mark + Fraunces wordmark), transparent PNG. The
  // tagline variant is deliberately NOT used here: at 44dp it renders ~4px tall.
  // Explicit
  // width+height (source aspect ~2.46:1) — an Image with only height+aspectRatio
  // balloons to full width inside this flex/animated header, so both are pinned.
  brandLogo:   { width: 180, height: 44 },

  // Sort chips — same pill language as the category row above them.
  sortRow:   { paddingHorizontal: 18, paddingBottom: 12, gap: 8 },
  sortChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 18, borderWidth: 1,
    borderColor: GREEN + '33', backgroundColor: CARD,
  },
  sortChipActive: { backgroundColor: GREEN, borderColor: GREEN },
  sortChipTxt:    { fontSize: 12, fontWeight: TYPE.weight.bold, color: GREEN },
  sortChipTxtActive: { color: COLORS.white },
  headerRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  // Both controls are sized against the 180x44 brand lockup opposite them: at the
  // old 29dp pill / 20dp cart-ink the right side read as an afterthought. They
  // also now clear the 40dp minimum touch target they previously missed.
  langBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, height: 36, borderRadius: 18,
    backgroundColor: GREEN_L, borderWidth: 1, borderColor: GREEN + '30',
  },
  langBtnTxt:  { color: GREEN, fontSize: 12.5, fontWeight: '700' },
  cartBtn:     { position: 'relative', width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  cartBadge:   { position: 'absolute', top: 2, right: 0, backgroundColor: COLORS.error, borderRadius: 9, minWidth: 17, height: 17, paddingHorizontal: 3, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.white },
  cartBadgeTxt:{ color: COLORS.white, fontSize: 9.5, fontWeight: '900' },

  // ── Search ──
  searchBar:   { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: KHET.card, borderRadius: 16, paddingHorizontal: 16, height: 52, borderWidth: 1, borderColor: KHET.border, ...KSHADOW.soft },
  // Focus state — green ring + glow so the bar feels interactive when tapped.
  searchBarFocused: { borderColor: KHET.primary, borderWidth: 2, shadowColor: KHET.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 14, elevation: 8 },
  searchInput: { flex: 1, fontSize: 15, color: KHET.foreground, padding: 0, fontFamily: KFONT.sansMed },

  // ── Category pills ──
  pillsWrap:     { backgroundColor: KHET.muted, minHeight: 66 },
  pillsRow:      { paddingHorizontal: 12, paddingVertical: 10, gap: 8, alignItems: 'center' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingLeft: 6, paddingRight: 12, paddingVertical: 6,
    borderRadius: 50, backgroundColor: KHET.secondary,
    borderWidth: 1.5, borderColor: KHET.border,
    minHeight: 40,
  },
  pillActive:    { backgroundColor: KHET.primary, borderColor: KHET.primary },
  pillIcon:      { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  pillTxt:       { fontSize: 12, fontFamily: KFONT.sansMed, color: KHET.secondaryForeground, flexShrink: 1, maxWidth: 108, lineHeight: 15 },
  pillTxtActive: { color: KHET.primaryForeground, fontFamily: KFONT.sansSemi },

  // ── Sections ──
  section:     { marginTop: 6 },
  sectionRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  sectionTitle:{ fontSize: 20, fontFamily: KFONT.displaySemi, color: KHET.foreground, letterSpacing: -0.5 },
  seeAllBtn:   { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAllTxt:   { fontSize: 13, color: KHET.primary, fontFamily: KFONT.sansSemi },
  resultCount: { fontSize: 12, color: KHET.mutedForeground, fontFamily: KFONT.sans },

  // ── Best sellers ──
  bsScroll:    { paddingHorizontal: 16, paddingBottom: 4, gap: 12 },
  bsCard:      { width: 158, backgroundColor: KHET.card, borderRadius: 18, overflow: 'hidden', ...KSHADOW.soft, borderWidth: 1, borderColor: KHET.border },
  bsImgWrap:   { height: 110, backgroundColor: KHET.secondary, position: 'relative' },
  bsImg:       { width: '100%', height: '100%' },
  bsDiscLeft:  { position: 'absolute', top: 8, left: 8, backgroundColor: KHET.gold, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  bsDiscTxt:   { color: KHET.goldForeground, fontSize: 9, fontFamily: KFONT.sansBold },
  bsBody:      { padding: 10, gap: 4 },
  bsName:      { fontSize: 12, fontFamily: KFONT.sansSemi, color: KHET.foreground, lineHeight: 16, minHeight: 32 },
  bsRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  bsRatingTxt: { fontSize: 10, color: KHET.mutedForeground, fontFamily: KFONT.sans },
  bsFooter:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  bsPrice:     { fontSize: 15, fontFamily: KFONT.sansBold, color: KHET.goldInk },
  bsAddBtn:    { width: 28, height: 28, borderRadius: 14, backgroundColor: KHET.primary, justifyContent: 'center', alignItems: 'center' },

  // ── Product grid ──
  productGrid:   { paddingHorizontal: 12, paddingBottom: 8, gap: 12 },
  gridCard:      { flex: 1, backgroundColor: KHET.card, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: KHET.border, ...KSHADOW.soft },
  gridImgWrap:   { height: 130, backgroundColor: KHET.secondary, position: 'relative' },
  gridImg:           { width: '100%', height: '100%' },
  gridImgGrad:       { position: 'absolute', bottom: 0, left: 0, right: 0, height: 50 },
  // wishBtn: removed with the non-functional wishlist heart it styled.
  gridDiscRight:     { position: 'absolute', top: 8, right: 8, backgroundColor: KHET.gold, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  gridDiscTxt:       { color: KHET.goldForeground, fontSize: 9, fontFamily: KFONT.sansBold },
  gridRatingBadge:   { position: 'absolute', bottom: 6, right: 8, flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  gridRatingBadgeTxt:{ color: COLORS.white, fontSize: 9, fontFamily: KFONT.sansSemi },
  // Stock urgency badge — bottom-left of the image, sits opposite the rating chip.
  stockBadge:        { position: 'absolute', bottom: 6, left: 8, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  stockBadgeOut:     { backgroundColor: KHET.destructive },
  stockBadgeLow:     { backgroundColor: '#E65100' },
  stockBadgeTxt:     { color: COLORS.white, fontSize: 9.5, fontFamily: KFONT.sansBold, letterSpacing: 0.2 },
  gridBody:          { padding: 10, gap: 4 },
  gridName:          { fontSize: 13.5, fontFamily: KFONT.sansSemi, color: KHET.foreground, lineHeight: 18, minHeight: 36 },
  gridPriceRow:      { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  gridSellers:       { fontSize: 10.5, color: COLORS.textLight, marginTop: 1 },
  // goldInk, not gold: KHET.gold as TEXT is 2.03:1 on a white card, a WCAG AA
  // failure. Kept from this branch while taking gridSellers from main.
  gridPrice:     { fontSize: 15, fontFamily: KFONT.sansBold, color: KHET.goldInk },
  gridMrp:       { fontSize: 10, color: KHET.mutedForeground, textDecorationLine: 'line-through', fontFamily: KFONT.sans },
  addToCartBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: KHET.primary, borderRadius: 12, paddingVertical: 10, marginTop: 4, ...KSHADOW.soft },
  addToCartTxt:  { color: KHET.primaryForeground, fontSize: 12, fontFamily: KFONT.sansSemi },

  // ── Notice bars (cached results / recoverable error) ──
  // Deliberately a BAR, not a takeover: when there are products on screen they
  // are still valid and still shoppable, and replacing them with a full-screen
  // error is what made a dropped packet look like an empty shop.
  noticeBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 12, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 12, backgroundColor: KHET.muted, borderWidth: 1, borderColor: KHET.border,
  },
  noticeBarWarn: { backgroundColor: COLORS.errorLight, borderColor: COLORS.error + '40' },
  noticeTxt:     { flex: 1, fontSize: 12, color: COLORS.textMedium, fontFamily: KFONT.sans },
  // 44dp minimum tap target — this is the recovery action, so it has to be
  // comfortably tappable with wet or gloved hands.
  noticeAction:  { fontSize: 12, color: KHET.primary, fontFamily: KFONT.sansBold, paddingVertical: 12, paddingHorizontal: 8 },
  endTxt:        { fontSize: 12, color: KHET.mutedForeground, fontFamily: KFONT.sans },

  // ── Empty ──
  emptyWrap:   { alignItems: 'center', paddingVertical: 52, paddingHorizontal: 24, gap: 6 },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14,
    paddingHorizontal: 20, minHeight: 48, borderRadius: 14, backgroundColor: KHET.primary,
    justifyContent: 'center',
  },
  emptyBtnTxt: { color: KHET.primaryForeground, fontSize: 14, fontFamily: KFONT.sansSemi },
  emptyIconWrap: { width: 96, height: 96, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 8, backgroundColor: KHET.muted },
  emptyTitle:  { fontSize: 22, fontFamily: KFONT.displaySemi, color: KHET.foreground, letterSpacing: -0.5 },
  emptyTxt:    { fontSize: 14, color: KHET.mutedForeground, fontFamily: KFONT.sans, textAlign: 'center' },
  emptyHint:   { fontSize: 12, color: KHET.mutedForeground, fontFamily: KFONT.sans, textAlign: 'center' },

  // ── Language Picker ──
  lpBackdrop:  { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.50)' },
  lpSheet:     { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: CARD, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '78%', shadowColor: COLORS.black, shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: -6 }, elevation: 20 },
  lpHandleWrap:{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  lpHandle:    { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.gray175 },
  lpTitle:     { fontSize: 17, fontWeight: '800', color: COLORS.textDark, paddingHorizontal: 20, paddingVertical: 12 },
  lpRow:       { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: COLORS.grayBg },
  lpRowActive: { backgroundColor: GREEN_L },
  lpFlagWrap:  { width: 44, height: 44, borderRadius: 13, backgroundColor: COLORS.grayBg, justifyContent: 'center', alignItems: 'center' },
  lpFlag:      { fontSize: 24 },
  lpName:      { fontSize: 15, fontWeight: '600', color: COLORS.textDark },
  lpNameActive:{ color: GREEN, fontWeight: '800' },
  lpNative:    { fontSize: 12, color: COLORS.textLight, marginTop: 1 },
  lpCheck:     { width: 24, height: 24, borderRadius: 12, backgroundColor: GREEN, justifyContent: 'center', alignItems: 'center' },
  lpRadio:     { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.gray175 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Category Drawer styles
// ─────────────────────────────────────────────────────────────────────────────
const DR = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.50)' },
  panel: {
    position: 'absolute', top: 0, left: 0, bottom: 0, width: DRAWER_W,
    backgroundColor: CARD,
    shadowColor: COLORS.black, shadowOpacity: 0.20, shadowRadius: 20, shadowOffset: { width: 6, height: 0 }, elevation: 15,
  },
  // White header with green tint bg (web prototype: bg-primary/5)
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: GREEN + '0D',
    borderBottomWidth: 1, borderBottomColor: GREEN + '18',
  },
  headerSub:   { fontSize: 11, color: GREEN + 'AA', fontWeight: '500' },
  headerTitle: { fontSize: 18, color: COLORS.textDark, fontWeight: '800', marginTop: 2 },
  closeBtn:    { padding: 6 },

  // All Products row
  allRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 15,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  allRowActive: { backgroundColor: GREEN_L },
  allRowTxt:    { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  allRowTxtActive: { color: GREEN },

  // Section label
  sectionHeader:   { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  sectionHeaderTxt:{ fontSize: 11, fontWeight: '800', color: COLORS.textLight, letterSpacing: 0.8 },

  // Flat category rows
  catRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 13,
    borderRadius: 10, marginHorizontal: 8, marginBottom: 2,
  },
  catRowActive: { backgroundColor: GREEN + '10' },
  catRowTxt:    { flex: 1, fontSize: 14, color: COLORS.textDark, fontWeight: '500', paddingRight: 8 },
  catRowTxtActive: { color: GREEN, fontWeight: '700' },
});

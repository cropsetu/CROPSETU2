/**
 * AgriStoreHome — web-prototype structure (shop-tab.tsx) with full API backend
 * Header → Search → Banner → Best Sellers → All Products grid
 * Left slide drawer (flat category list) + animated language bottom sheet
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useCart } from '../../context/CartContext';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable,
  FlatList, TextInput, StatusBar, Image, Easing, Keyboard,
  Modal, TouchableWithoutFeedback, Dimensions,
  Animated as RNAnimated,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withSequence,
  FadeIn, FadeInDown,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '../../utils/haptics';
import { SPRINGS, AnimatedCard, enterAnimation } from '../../components/ui/motion';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useScrollHeader from '../../hooks/useScrollHeader';
import api from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../../constants/colors';
import { KHET, KFONT, KSHADOW } from '../../constants/khetTheme';
import AnimatedScreen from '../../components/ui/AnimatedScreen';
import ScrollToTopButton from '../../components/ScrollToTopButton';
import MockImagePlaceholder from '../../components/MockImagePlaceholder';
import { StoreCategoryIcon } from '../../components/StoreCategoryIcons';

const { width: W, height: H } = Dimensions.get('window');
const GREEN    = COLORS.primary;
const GREEN_L  = COLORS.primaryPale;
const ORANGE   = COLORS.cta;
const GOLD     = COLORS.yellowDark2;
const BG       = COLORS.background;
const CARD     = COLORS.surface;
const BORDER   = COLORS.border;
const DRAWER_W = W * 0.85;

// ─────────────────────────────────────────────────────────────────────────────
// Shimmer skeleton
// ─────────────────────────────────────────────────────────────────────────────
function Skeleton() {
  const anim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    RNAnimated.loop(RNAnimated.sequence([
      RNAnimated.timing(anim, { toValue: 1, duration: 750, useNativeDriver: false, easing: Easing.inOut(Easing.ease) }),
      RNAnimated.timing(anim, { toValue: 0, duration: 750, useNativeDriver: false, easing: Easing.inOut(Easing.ease) }),
    ])).start();
  }, []);
  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: [COLORS.greenAsh, COLORS.greenMist] });
  return (
    <View style={S.gridCard}>
      <RNAnimated.View style={[{ height: 130, backgroundColor: bg }]} />
      <View style={{ padding: 10, gap: 7 }}>
        <RNAnimated.View style={{ height: 11, width: '85%', borderRadius: 5, backgroundColor: bg }} />
        <RNAnimated.View style={{ height: 9,  width: '55%', borderRadius: 5, backgroundColor: bg }} />
        <RNAnimated.View style={{ height: 9,  width: '40%', borderRadius: 5, backgroundColor: bg }} />
        <RNAnimated.View style={{ height: 32, borderRadius: 10, marginTop: 4, backgroundColor: bg }} />
      </View>
    </View>
  );
}

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
          // Short label — trim to keep pill width sane
          const shortLabel = label.length > 13 ? label.slice(0, 12) + '…' : label;

          return (
            <TouchableOpacity
              key={cat.id}
              style={[S.pill, active && S.pillActive, active && { borderColor: color, backgroundColor: color }]}
              onPress={() => onSelect(cat.id, null)}
              activeOpacity={0.82}
            >
              <View style={[S.pillIcon, { backgroundColor: active ? 'rgba(255,255,255,0.25)' : hexToRgba(color, 0.14) }]}>
                <StoreCategoryIcon type={cat.icon || cat.name} size={24} animated={false} />
              </View>
              <Text style={[S.pillTxt, active && S.pillTxtActive]} numberOfLines={1}>{shortLabel}</Text>
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
  const discount = item.mrp > item.price ? Math.round(((item.mrp - item.price) / item.mrp) * 100) : 0;
  const imageUrl = item.images?.[0];

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
            <Text style={S.bsPrice}>₹{item.price?.toLocaleString()}</Text>
            <TouchableOpacity style={S.bsAddBtn} onPress={() => onPress(item)} activeOpacity={0.8}>
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
function ProductCard({ item, onPress, t, index }) {
  const discount    = item.mrp > item.price ? Math.round(((item.mrp - item.price) / item.mrp) * 100) : 0;
  const imageUrl    = item.images?.[0];
  const [liked, setLiked] = useState(false);
  const heartSc     = useSharedValue(1);
  const heartStyle  = useAnimatedStyle(() => ({ transform: [{ scale: heartSc.value }] }));

  const toggleLike = () => {
    setLiked(v => !v);
    Haptics.light();
    // Heart pop: 1 → 0.8 → 1.3 → 1 (physics chain)
    heartSc.value = withSequence(
      withSpring(0.8, { ...SPRINGS.snappy, stiffness: 400 }),
      withSpring(1.3, SPRINGS.bouncy),
      withSpring(1, SPRINGS.snappy),
    );
  };

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
          {/* Heart top-LEFT */}
          <Pressable style={S.wishBtn} onPress={toggleLike} hitSlop={8}>
            <Animated.View style={heartStyle}>
              <Ionicons name={liked ? 'heart' : 'heart-outline'} size={16} color={liked ? COLORS.error : COLORS.grayLight2} />
            </Animated.View>
          </Pressable>
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
            <Text style={S.gridPrice}>₹{item.price?.toLocaleString()}</Text>
            {item.mrp > item.price && (
              <Text style={S.gridMrp}>₹{item.mrp?.toLocaleString()}</Text>
            )}
          </View>
          {/* Full-width "View Details" button */}
          <TouchableOpacity style={S.addToCartBtn} onPress={() => onPress(item)} activeOpacity={0.85}>
            <Ionicons name="cart-outline" size={14} color={COLORS.white} />
            <Text style={S.addToCartTxt}>{t('addToCart')}</Text>
          </TouchableOpacity>
        </View>
    </AnimatedCard>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────
const ALL_ID = '__all__';

export default function AgriStoreHome({ navigation }) {
  const { t, language, setLanguage, LANGUAGES } = useLanguage();
  const insets = useSafeAreaInsets();
  const headerMaxH = insets.top + 60; // safe area + logo bar
  const { onScroll: hideOnScroll, headerAnimatedStyle, showTopBtn } = useScrollHeader(headerMaxH);
  const scrollRef = useRef(null);

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

  // Load categories from API. No mock fallback — if the API has nothing yet
  // we show the "coming soon" empty state instead of pretending there's data.
  useEffect(() => {
    api.get('/agristore/categories')
      .then(({ data }) => {
        const cats = data.data;
        setCategories(Array.isArray(cats) ? cats : []);
      })
      .catch(() => setCategories([]));
  }, []);

  // Clear the search focus ring once the keyboard is dismissed — on Android the
  // back-press hides the keyboard without firing onBlur, so the ring would stick.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => setSearchFocused(false));
    return () => sub.remove();
  }, []);

  // Load products on filter/search change
  useEffect(() => {
    clearTimeout(searchTimer.current);
    const delay = searchQuery.length > 0 ? 400 : 0;
    searchTimer.current = setTimeout(fetchProducts, delay);
    return () => clearTimeout(searchTimer.current);
  }, [selectedCategory, selectedSubcategory, searchQuery]);

  async function fetchProducts() {
    setLoading(true);
    try {
      const params = { limit: 40 };
      if (selectedCategory !== ALL_ID) params.category    = selectedCategory;
      if (selectedSubcategory)         params.subcategory = selectedSubcategory;
      if (searchQuery.trim())          params.search      = searchQuery.trim();
      const { data } = await api.get('/agristore/products', { params });
      const items = data.data;
      // No mock fallback — empty list lets the "coming soon" empty state show.
      setProducts(Array.isArray(items) ? items : []);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }

  const handleCategorySelect = (catId, sub) => {
    setSelectedCategory(catId);
    setSelectedSubcategory(sub || null);
  };

  // Re-sync the global cart count whenever this screen regains focus —
  // covers the case where it changed in a screen that doesn't go through CartContext.
  useFocusEffect(useCallback(() => { refreshCart(); }, [refreshCart]));

  const handleProductPress = useCallback((item) => {
    navigation.navigate('ProductDetail', { product: item });
  }, [navigation]);

  const bestSellers = products.slice(0, 8);

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

      {/* ── Header top bar (collapses on scroll) ── */}
      <Animated.View style={headerAnimatedStyle}>
        <View style={[S.header, { paddingTop: insets.top + 10, paddingBottom: 10 }]}>
          <View style={S.headerTop}>
            <View style={S.headerSide}>
              <TouchableOpacity style={S.hamburger} onPress={() => setDrawerOpen(true)} activeOpacity={0.7}>
                <View style={S.hamLine} />
                <View style={[S.hamLine, { width: 18 }]} />
                <View style={S.hamLine} />
              </TouchableOpacity>
              <Image
                source={require('../../../assets/cropsetu-wordmark.png')}
                style={S.brandLogo}
                resizeMode="contain"
                accessibilityLabel={t('appName')}
              />
            </View>
            <View style={S.headerRight}>
              <TouchableOpacity style={S.langBtn} onPress={openLangPicker} activeOpacity={0.8}>
                <Ionicons name="globe-outline" size={14} color={GREEN} />
                <Text style={S.langBtnTxt}>{language.toUpperCase()}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.cartBtn} onPress={() => navigation.navigate('Cart')} activeOpacity={0.8}>
                <Ionicons name="cart-outline" size={22} color={COLORS.charcoal} />
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

      {/* ── Scrollable content ── */}
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} style={S.scroll} contentContainerStyle={S.scrollContent} onScroll={hideOnScroll} scrollEventThrottle={16}>
        <View style={S.contentSheet}>

        {/* Best Sellers */}
        {!loading && bestSellers.length > 0 && (
          <View style={S.section}>
            <View style={S.sectionRow}>
              <Text style={S.sectionTitle}>{t('store.bestSellers')}</Text>
              <TouchableOpacity style={S.seeAllBtn} onPress={() => setSelectedCategory(ALL_ID)}>
                <Text style={S.seeAllTxt}>{t('store.viewAll')}</Text>
                <Ionicons name="chevron-forward" size={14} color={GREEN} />
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={S.bsScroll}
            >
              {bestSellers.map(item => (
                <BestSellerCard key={item.id} item={item} onPress={handleProductPress} />
              ))}
            </ScrollView>
          </View>
        )}

        {/* All Products */}
        <View style={S.section}>
          <View style={S.sectionRow}>
            <Text style={S.sectionTitle}>{t('store.allProducts')}</Text>
            <Text style={S.resultCount}>{t('store.itemCount', { count: products.length })}</Text>
          </View>

          {loading ? (
            <View style={S.productGrid}>
              {[0, 1, 2, 3].map(i => <Skeleton key={i} />)}
            </View>
          ) : products.length === 0 ? (
            <View style={S.emptyWrap}>
              <View style={S.emptyIconWrap}>
                <StoreCategoryIcon type="bag" size={72} animated />
              </View>
              <Text style={S.emptyTitle}>{t('ai.comingSoon')}</Text>
              <Text style={S.emptyTxt}>{t('store.comingSoonMsg')}</Text>
              <Text style={S.emptyHint}>{t('store.comingSoonHint')}</Text>
            </View>
          ) : (
            <FlatList
              windowSize={5}
              maxToRenderPerBatch={10}
              removeClippedSubviews
              data={products}
              keyExtractor={item => item.id}
              numColumns={2}
              scrollEnabled={false}
              contentContainerStyle={S.productGrid}
              columnWrapperStyle={{ gap: 12, alignItems: 'stretch' }}
              renderItem={({ item, index }) => (
                <ProductCard item={item} onPress={handleProductPress} t={t} index={index} />
              )}
            />
          )}
        </View>

        <View style={{ height: 40 }} />
        </View>
      </ScrollView>

      <ScrollToTopButton visible={showTopBtn} onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })} />

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
  headerSide:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  hamburger:   { padding: 4, gap: 4, justifyContent: 'center' },
  hamLine:     { width: 22, height: 2.5, borderRadius: 2, backgroundColor: COLORS.textDark },
  // CropSetu wordmark (tree-in-C + "SMART FARMING"), transparent PNG. Explicit
  // width+height (source aspect ~2.46:1) — an Image with only height+aspectRatio
  // balloons to full width inside this flex/animated header, so both are pinned.
  brandLogo:   { width: 112, height: 44 },
  headerRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  langBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: GREEN_L, borderWidth: 1, borderColor: GREEN + '30' },
  langBtnTxt:  { color: GREEN, fontSize: 11, fontWeight: '700' },
  cartBtn:     { position: 'relative', padding: 4 },
  cartBadge:   { position: 'absolute', top: -2, right: -2, backgroundColor: COLORS.error, borderRadius: 9, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.white },
  cartBadgeTxt:{ color: COLORS.white, fontSize: 9, fontWeight: '900' },

  // ── Search ──
  searchBar:   { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: KHET.card, borderRadius: 16, paddingHorizontal: 16, height: 52, borderWidth: 1, borderColor: KHET.border, ...KSHADOW.soft },
  // Focus state — green ring + glow so the bar feels interactive when tapped.
  searchBarFocused: { borderColor: KHET.primary, borderWidth: 2, shadowColor: KHET.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 14, elevation: 8 },
  searchInput: { flex: 1, fontSize: 15, color: KHET.foreground, padding: 0, fontFamily: KFONT.sansMed },

  // ── Category pills ──
  pillsWrap:     { backgroundColor: KHET.muted, height: 66 },
  pillsRow:      { paddingHorizontal: 12, paddingVertical: 10, gap: 8, alignItems: 'center' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingLeft: 6, paddingRight: 12, paddingVertical: 6,
    borderRadius: 50, backgroundColor: KHET.secondary,
    borderWidth: 1.5, borderColor: KHET.border,
    height: 40,
  },
  pillActive:    { backgroundColor: KHET.primary, borderColor: KHET.primary },
  pillIcon:      { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  pillTxt:       { fontSize: 12, fontFamily: KFONT.sansMed, color: KHET.secondaryForeground, flexShrink: 1 },
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
  bsDiscTxt:   { color: COLORS.white, fontSize: 9, fontFamily: KFONT.sansBold },
  bsBody:      { padding: 10, gap: 4 },
  bsName:      { fontSize: 12, fontFamily: KFONT.sansSemi, color: KHET.foreground, lineHeight: 16, minHeight: 32 },
  bsRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  bsRatingTxt: { fontSize: 10, color: KHET.mutedForeground, fontFamily: KFONT.sans },
  bsFooter:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  bsPrice:     { fontSize: 15, fontFamily: KFONT.sansBold, color: KHET.gold },
  bsAddBtn:    { width: 28, height: 28, borderRadius: 14, backgroundColor: KHET.primary, justifyContent: 'center', alignItems: 'center' },

  // ── Product grid ──
  productGrid:   { paddingHorizontal: 12, paddingBottom: 8, gap: 12 },
  gridCard:      { flex: 1, backgroundColor: KHET.card, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: KHET.border, ...KSHADOW.soft },
  gridImgWrap:   { height: 130, backgroundColor: KHET.secondary, position: 'relative' },
  gridImg:           { width: '100%', height: '100%' },
  gridImgGrad:       { position: 'absolute', bottom: 0, left: 0, right: 0, height: 50 },
  wishBtn:           { position: 'absolute', top: 8, left: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.9)', justifyContent: 'center', alignItems: 'center', shadowColor: COLORS.black, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  gridDiscRight:     { position: 'absolute', top: 8, right: 8, backgroundColor: KHET.gold, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  gridDiscTxt:       { color: COLORS.white, fontSize: 9, fontFamily: KFONT.sansBold },
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
  gridPrice:     { fontSize: 15, fontFamily: KFONT.sansBold, color: KHET.gold },
  gridMrp:       { fontSize: 10, color: KHET.mutedForeground, textDecorationLine: 'line-through', fontFamily: KFONT.sans },
  addToCartBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: KHET.primary, borderRadius: 12, paddingVertical: 10, marginTop: 4, ...KSHADOW.soft },
  addToCartTxt:  { color: KHET.primaryForeground, fontSize: 12, fontFamily: KFONT.sansSemi },

  // ── Empty ──
  emptyWrap:   { alignItems: 'center', paddingVertical: 52, paddingHorizontal: 24, gap: 6 },
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

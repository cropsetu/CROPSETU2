/**
 * AnimalTradeHome — livestock marketplace.
 *
 * Data comes from ONE source, useAnimalListings, which owns debouncing,
 * cancellation, pagination and the offline cache. This screen only renders it.
 * The previous version fetched inline from a useEffect keyed on searchQuery, so
 * every keystroke was a request and the last response to arrive won regardless
 * of which query it answered.
 *
 * Rendering notes that matter on a mid-range Android:
 *   • Cards are memoised and receive only primitives + stable callbacks, so
 *     typing in the search box does not re-render 20 cards.
 *   • The grid uses FlatList's own 2-column mode with a per-listing key rather
 *     than pairing rows under an index key — an index key re-renders every row
 *     below any insertion, which is every row on every page append.
 *   • Cards load the server-derived ~320 px thumbnail, not the 1080 px original.
 */
import { useState, useCallback, useEffect, useRef, useMemo, memo } from 'react';
import useFocusRefresh from '../../hooks/useFocusRefresh';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Pressable,
  TextInput, StatusBar, Image, ScrollView, Dimensions,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '@cropsetu/shared/utils/haptics';
import { SPRINGS, AnimatedCard } from '@cropsetu/shared/components/ui/motion';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useScrollHeader from '../../hooks/useScrollHeader';
import ScrollToTopButton from '../../components/ScrollToTopButton';
import { useLocation } from '../../context/LocationContext';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import { useAuth } from '@cropsetu/shared/context/AuthContext';
import { COLORS, TYPE, SHADOWS } from '@cropsetu/shared/constants/colors';
import AnimatedScreen from '@cropsetu/shared/components/ui/AnimatedScreen';
import AnimalIcon from '../../components/AnimalIcons';
import AnimalCardSkeleton from '../../components/AnimalCardSkeleton';
import { locationVillageTaluka } from '../../utils/location';
import useAnimalListings from '../../hooks/useAnimalListings';
import { ERROR_CODES } from '../../utils/apiError';
import AnimalFilterSheet, { activeFilterCount, SHEET_FILTER_KEYS } from './components/AnimalFilterSheet';
import LocationSheet from './components/LocationSheet';
import {
  getManualLocation, setManualLocation as persistManualLocation,
  getRecentSearches, pushRecentSearch, clearRecentSearches, relativeTime,
} from '../../utils/animalPrefs';

const { width: W } = Dimensions.get('window');
const CARD_W = (W - 14 * 2 - 10) / 2;

const GREEN = COLORS.primary;
const BG    = COLORS.background;

const ANIMAL_CATEGORIES = [
  { key: 'All',      tKey: 'all' },
  { key: 'Cow',      tKey: 'cow' },
  { key: 'Buffalo',  tKey: 'buffalo' },
  { key: 'Goat',     tKey: 'goat' },
  { key: 'Bullock',  tKey: 'bullock' },
  { key: 'Sheep',    tKey: 'sheep' },
  { key: 'Poultry',  tKey: 'poultry' },
  { key: 'Horse',    tKey: 'horse' },
  { key: 'Camel',    tKey: 'camel' },
  { key: 'Pig',      tKey: 'pig' },
  { key: 'Duck',     tKey: 'duck' },
  { key: 'Rabbit',   tKey: 'rabbit' },
  { key: 'Donkey',   tKey: 'donkey' },
  { key: 'Dog',      tKey: 'dog' },
  { key: 'Fish',     tKey: 'fish' },
  { key: 'Honeybee', tKey: 'honeybee' },
];

/** Animal types the milk-yield filter applies to. */
const MILCH_TYPES = new Set(['All', 'Cow', 'Buffalo', 'Goat', 'Camel']);

const DISTANCE_KEYS = [null, 10, 25, 50, 100];

/**
 * Sort options. `nearest` and `relevance` are conditional: sorting by distance
 * without a location, or by relevance without a query, is meaningless — the
 * chip is hidden rather than shown and silently ignored.
 */
const SORTS = [
  { key: 'relevance',  tKey: 'animal.sortRelevance', needs: 'search' },
  { key: 'latest',     tKey: 'animal.sortLatest' },
  { key: 'nearest',    tKey: 'animal.sortNearest',   needs: 'coords' },
  { key: 'price_asc',  tKey: 'animal.sortPriceLow' },
  { key: 'price_desc', tKey: 'animal.sortPriceHigh' },
];

const EMPTY_FILTERS = SHEET_FILTER_KEYS.reduce((o, k) => ({ ...o, [k]: null }), {});

// ── Category pill ─────────────────────────────────────────────────────────────
const CategoryPill = memo(function CategoryPill({ item, active, onPress, t }) {
  const sc = useSharedValue(1);
  const scStyle = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  const label = t(item.tKey === 'all' ? 'all' : `animals.${item.tKey.toLowerCase()}`) || item.key.toUpperCase();
  return (
    <Animated.View style={[S.catWrap, scStyle]}>
      <Pressable
        onPress={() => { Haptics.selection(); onPress(item.key); }}
        onPressIn={() => { sc.value = withSpring(0.9, SPRINGS.snappy); }}
        onPressOut={() => { sc.value = withSpring(1, SPRINGS.snappy); }}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
      >
        <View style={S.catImgWrap}>
          <AnimalIcon type={item.key} size={50} />
        </View>
        <Text style={[S.catLabel, active && S.catLabelActive]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
});

// ── Animal Card ───────────────────────────────────────────────────────────────
const AnimalCard = memo(function AnimalCard({ item, onPress, t, index = 0, currentUserId }) {
  const isOwn = !!(currentUserId && item.sellerId && currentUserId === item.sellerId);
  // Prefer the server-derived card thumbnail; fall back to the original for
  // listings whose images are not on Cloudinary.
  const source = Array.isArray(item.thumbnails) && item.thumbnails.length
    ? item.thumbnails
    : (Array.isArray(item.images) ? item.images : []);
  const firstImage = source.find((u) => typeof u === 'string' && /^https?:\/\//i.test(u)) || null;
  // Track a runtime image-load failure so a broken/unreachable URL falls back to
  // the animal icon instead of rendering a permanent blank thumbnail.
  const [imgFailed, setImgFailed] = useState(false);
  const imageUrl = !imgFailed ? firstImage : null;
  const milkStr  = item.milkYield && item.milkYield !== 'N/A' ? item.milkYield : null;
  const price    = item.price ? Number(item.price).toLocaleString('en-IN') : '—';
  const place    = locationVillageTaluka(item.sellerLocation) || '—';
  const dist     = item.distanceKm != null ? `${item.distanceKm} km` : null;
  const verified = item.verification?.listingVerified;
  const sold     = item.status === 'SOLD';

  const handlePress = useCallback(() => onPress(item), [onPress, item]);

  return (
    <AnimatedCard
      style={S.card}
      onPress={handlePress}
      index={index}
      scaleValue={0.96}
      accessibilityLabel={[
        `${item.breed} ${item.animal}`,
        `₹${price}`,
        place !== '—' ? place : null,
        dist,
        verified ? t('animalDetail.sellerVerified') : null,
      ].filter(Boolean).join(', ')}
    >
      <View style={S.photoWrap}>
        {imageUrl
          ? (
            <Image
              source={{ uri: imageUrl }}
              style={S.photo}
              resizeMode="cover"
              onError={() => setImgFailed(true)}
              accessible
              accessibilityLabel={`${item.breed} ${item.animal}`}
            />
          )
          : (
            <View style={[S.photo, S.photoFallback]}>
              <AnimalIcon type={item.animal || 'Cow'} size={CARD_W - 20} />
            </View>
          )}
        {/* Gradient overlay on image */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.45)']}
          style={S.photoGradient}
          pointerEvents="none"
        />
        {sold ? (
          <View style={S.soldOverlay}>
            <Text style={S.soldTxt}>{t('animal.sold', 'SOLD')}</Text>
          </View>
        ) : null}
        {dist ? (
          <View style={S.distBadge}>
            <Ionicons name="location" size={9} color={COLORS.white} />
            <Text style={S.distBadgeTxt}>{dist}</Text>
          </View>
        ) : null}
        {item.vaccinated ? (
          <View style={S.vaccBadge} accessibilityLabel={t('vaccinated')}>
            <Ionicons name="shield-checkmark" size={10} color={COLORS.white} />
          </View>
        ) : null}
        {isOwn ? (
          <View style={S.ownBadge}>
            <Ionicons name="person-circle" size={11} color={COLORS.white} />
            <Text style={S.ownBadgeTxt}>{t('animal.yourListing', 'Your listing')}</Text>
          </View>
        ) : verified ? (
          <View style={S.verifiedBadge}>
            <Ionicons name="shield-checkmark" size={10} color={COLORS.white} />
            <Text style={S.ownBadgeTxt}>{t('animal.verified', 'Verified')}</Text>
          </View>
        ) : null}
      </View>

      <View style={S.cardBody}>
        <Text style={S.animalName} numberOfLines={1}>{item.breed} {item.animal}</Text>
        <Text style={S.price}>₹{price}</Text>
        <View style={S.metaRow}>
          <Ionicons name="location-outline" size={11} color={COLORS.grayMedium} />
          <Text style={S.metaTxt} numberOfLines={1}>{place}</Text>
        </View>
        <View style={S.statsRow}>
          <View style={S.statItem}>
            <Ionicons name="time-outline" size={11} color={COLORS.grayMedium} />
            <Text style={S.statTxt}>{item.age}</Text>
          </View>
          {milkStr ? (
            <View style={S.statItem}>
              <Ionicons name="water-outline" size={11} color={GREEN} />
              <Text style={[S.statTxt, { color: GREEN }]}>{milkStr}</Text>
            </View>
          ) : null}
        </View>
        {isOwn ? (
          <TouchableOpacity style={[S.bookBtn, S.editBtn]} onPress={handlePress} accessibilityRole="button">
            <Ionicons name="create-outline" size={13} color={COLORS.primary} />
            <Text style={[S.bookBtnTxt, { color: COLORS.primary }]}>{t('animal.editView', 'Edit / View')}</Text>
          </TouchableOpacity>
        ) : (
          // "Book Now" promised a booking flow that does not exist — there is no
          // reservation and no payment, only a call or a chat. The label now
          // says what the button actually does.
          <TouchableOpacity style={S.bookBtn} onPress={handlePress} accessibilityRole="button">
            <Ionicons name="chatbubble-ellipses-outline" size={13} color={COLORS.white} />
            <Text style={S.bookBtnTxt}>{t('animal.contactSeller')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </AnimatedCard>
  );
});

// ── Distance chip ─────────────────────────────────────────────────────────────
const DistChip = memo(function DistChip({ km, label, active, onPress }) {
  const sc = useSharedValue(1);
  const scStyle = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  return (
    <Animated.View style={scStyle}>
      <Pressable
        style={[S.distChip, active && S.distChipActive]}
        onPress={() => { Haptics.selection(); onPress(km); }}
        onPressIn={() => { sc.value = withSpring(0.9, SPRINGS.snappy); }}
        onPressOut={() => { sc.value = withSpring(1, SPRINGS.snappy); }}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
      >
        <Text style={[S.distChipTxt, active && S.distChipTxtActive]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
});

// ── Sort Chip ─────────────────────────────────────────────────────────────────
const SortChip = memo(function SortChip({ label, active, onPress }) {
  const sc = useSharedValue(1);
  const scStyle = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  return (
    <Animated.View style={scStyle}>
      <Pressable
        style={[S.sortChip, active && S.sortChipActive]}
        onPress={() => { Haptics.selection(); onPress(); }}
        onPressIn={() => { sc.value = withSpring(0.93, SPRINGS.snappy); }}
        onPressOut={() => { sc.value = withSpring(1, SPRINGS.snappy); }}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
      >
        <Text style={[S.sortChipTxt, active && S.sortChipTxtActive]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
});

/**
 * The banner strip above the grid: how many results, whether they came off disk,
 * and what went wrong if anything did. Every error state carries the action that
 * resolves it rather than a bare message.
 */
function StatusStrip({ error, cachedAt, onRetry, onSignIn, onWidenRadius, hasRadius, t }) {
  if (cachedAt) {
    return (
      <View style={[S.banner, S.bannerMuted]} accessibilityRole="alert">
        <Ionicons name="cloud-offline-outline" size={16} color={COLORS.textMedium} />
        <Text style={S.bannerTxt}>
          {t('animal.offlineData', 'Showing saved animals')} · {relativeTime(cachedAt)}
        </Text>
        <TouchableOpacity onPress={onRetry} hitSlop={8} accessibilityRole="button">
          <Text style={S.bannerAction}>{t('retry', 'Retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!error) return null;

  const isAuth  = error.code === ERROR_CODES.AUTH;
  const isRate  = error.code === ERROR_CODES.RATE_LIMIT;
  const isMaint = error.code === ERROR_CODES.MAINTENANCE;

  return (
    <View style={[S.banner, S.bannerError]} accessibilityRole="alert">
      <Ionicons
        name={error.code === ERROR_CODES.OFFLINE ? 'wifi-outline' : 'alert-circle-outline'}
        size={16}
        color={COLORS.error}
      />
      <Text style={[S.bannerTxt, { color: COLORS.error }]} numberOfLines={2}>{error.message}</Text>
      {isAuth ? (
        <TouchableOpacity onPress={onSignIn} hitSlop={8} accessibilityRole="button">
          <Text style={[S.bannerAction, { color: COLORS.error }]}>{t('signIn', 'Sign in')}</Text>
        </TouchableOpacity>
      ) : isRate || isMaint ? null : hasRadius ? (
        <TouchableOpacity onPress={onWidenRadius} hitSlop={8} accessibilityRole="button">
          <Text style={[S.bannerAction, { color: COLORS.error }]}>{t('animal.showAllAnimals')}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={onRetry} hitSlop={8} accessibilityRole="button">
          <Text style={[S.bannerAction, { color: COLORS.error }]}>{t('retry', 'Retry')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Enhanced empty state ────────────────────────────────────────────────────────
function EmptyAnimals({ t, hasRadius, hasFilters, hasSearch, onShowAll, onClearFilters, onPost }) {
  return (
    <View style={S.emptyWrap}>
      <View style={S.emptyArt}>
        <View style={S.emptyArtRingLg} />
        <View style={S.emptyArtRingSm} />
        <View style={S.emptyIconBg}>
          <AnimalIcon type="All" size={48} />
        </View>
        <View style={[S.emptyMini, S.emptyMiniTL]}><AnimalIcon type="Cow" size={26} /></View>
        <View style={[S.emptyMini, S.emptyMiniTR]}><AnimalIcon type="Goat" size={24} /></View>
        <View style={[S.emptyMini, S.emptyMiniBR]}><AnimalIcon type="Buffalo" size={24} /></View>
      </View>

      <Text style={S.emptyTitle}>{hasRadius ? t('animal.noAnimalsNearby') : t('animal.noAnimals')}</Text>
      {/* Tell them what to change, not just that there is nothing. */}
      <Text style={S.emptyTxt}>
        {hasRadius   ? t('animal.tryWiderRadius', 'Try a bigger distance, or remove some filters.')
          : hasFilters ? t('animal.tryFewerFilters', 'Try removing some filters.')
            : hasSearch  ? t('animal.tryOtherWords', 'Try a different word, or search by breed or village.')
              : t('animal.beFirstToList')}
      </Text>

      <View style={S.emptyChips}>
        <View style={S.emptyChip}>
          <Ionicons name="people-outline" size={13} color={GREEN} />
          <Text style={S.emptyChipTxt}>{t('animal.reachBuyers')}</Text>
        </View>
        <View style={S.emptyChip}>
          <Ionicons name="cash-outline" size={13} color={GREEN} />
          <Text style={S.emptyChipTxt}>{t('animal.freeToPost')}</Text>
        </View>
        <View style={S.emptyChip}>
          <Ionicons name="shield-checkmark-outline" size={13} color={GREEN} />
          <Text style={S.emptyChipTxt}>{t('animal.verifiedBadge')}</Text>
        </View>
      </View>

      <TouchableOpacity style={S.emptyCta} onPress={onPost} activeOpacity={0.85} accessibilityRole="button">
        <Ionicons name="add-circle" size={18} color={COLORS.white} />
        <Text style={S.emptyCtaTxt}>{t('animal.postAd')}</Text>
      </TouchableOpacity>

      {hasRadius ? (
        <TouchableOpacity style={S.expandBtn} onPress={onShowAll} accessibilityRole="button">
          <Text style={S.expandBtnTxt}>{t('animal.showAllAnimals')}</Text>
        </TouchableOpacity>
      ) : null}
      {hasFilters ? (
        <TouchableOpacity style={S.expandBtn} onPress={onClearFilters} accessibilityRole="button">
          <Text style={S.expandBtnTxt}>{t('animal.clearAll', 'Clear all')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AnimalTradeHome({ navigation, route }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const currentUserId = user?.id;
  const insets = useSafeAreaInsets();
  const { onScroll: hideOnScroll, headerAnimatedStyle, showTopBtn } = useScrollHeader(200);
  const listRef = useRef(null);

  const { coords, permissionGranted, permissionDenied, loading: gpsLoading, refresh: refreshGps } = useLocation();
  const gpsStatus = gpsLoading ? 'loading' : permissionGranted ? 'granted' : permissionDenied ? 'denied' : 'unknown';

  const [activeFilter, setActiveFilter] = useState('All');
  const [searchQuery,  setSearchQuery]  = useState('');
  const [sortBy,       setSortBy]       = useState('latest');
  const [distanceKm,   setDistanceKm]   = useState(null);
  const [sheetFilters, setSheetFilters] = useState(EMPTY_FILTERS);
  const [filterOpen,   setFilterOpen]   = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [manualLoc,    setManualLoc]    = useState(null);
  const [recent,       setRecent]       = useState([]);
  const [searchFocused, setSearchFocused] = useState(false);

  // Restore the saved manual place and recent searches once, on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [loc, rs] = await Promise.all([getManualLocation(), getRecentSearches()]);
      if (!alive) return;
      setManualLoc(loc);
      setRecent(rs);
    })();
    return () => { alive = false; };
  }, []);

  const filters = useMemo(() => ({
    ...sheetFilters,
    animal: activeFilter,
    search: searchQuery,
    sort: sortBy,
    radiusKm: distanceKm,
    // A hand-typed place filters server-side on the listing's location text.
    district: manualLoc?.label || null,
  }), [sheetFilters, activeFilter, searchQuery, sortBy, distanceKm, manualLoc]);

  const {
    items, total, hasMore, loading, loadingMore, refreshing,
    error, cachedAt, isStale, loadMore, refresh,
  } = useAnimalListings({ filters, coords });

  // Remember a search once it has actually been run (not on every keystroke).
  const lastRecorded = useRef('');
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2 || loading || q === lastRecorded.current) return;
    lastRecorded.current = q;
    pushRecentSearch(q).then(setRecent);
  }, [searchQuery, loading]);

  // Re-fetch when returning to this screen (e.g. after posting a new listing).
  // Gated: the hook already fetches on mount and on every filter change, so this
  // only covers changes made elsewhere.
  useFocusRefresh(() => refresh(), { key: 'animals', runOnFirstFocus: false });

  // AddAnimalListing navigates back with `freshListingId`. Reset the filters so
  // the new card is guaranteed to be in view, scroll to top, and clear the param
  // so a re-focus does not loop.
  useEffect(() => {
    const fresh = route?.params?.freshListingId;
    if (!fresh) return;
    setActiveFilter('All');
    setSearchQuery('');
    setDistanceKm(null);
    setSortBy('latest');
    setSheetFilters(EMPTY_FILTERS);
    setTimeout(() => listRef.current?.scrollToOffset?.({ offset: 0, animated: true }), 100);
    navigation.setParams({ freshListingId: undefined, ts: undefined });
  }, [route?.params?.freshListingId, route?.params?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnimalPress = useCallback(
    // Pass only the id plus a lightweight preview: the detail screen re-fetches
    // the authoritative row, so shipping the whole object through navigation
    // params only risked showing stale data (a listing marked sold minutes ago
    // still read "available").
    (item) => navigation.navigate('AnimalDetail', { listingId: item.id, preview: item }),
    [navigation],
  );

  const handleDistancePress = useCallback((km) => {
    // Asking for a radius with no location is the moment to explain WHY we want
    // it — not at app launch, where the prompt has no context.
    if (km !== null && !coords) { setLocationOpen(true); return; }
    setDistanceKm((prev) => (prev === km ? null : km));
  }, [coords]);

  const applyManualLocation = useCallback((loc) => {
    setManualLoc(loc);
    persistManualLocation(loc);
    // A typed place is a text filter, not coordinates, so a radius no longer
    // applies — clearing it avoids an impossible "within 10 km of a word".
    if (loc) setDistanceKm(null);
  }, []);

  const clearSearch = useCallback(() => setSearchQuery(''), []);
  const filterCount = activeFilterCount(sheetFilters);
  const showMilkFilter = MILCH_TYPES.has(activeFilter);
  const visibleSorts = SORTS.filter((s) => (
    s.needs === 'coords' ? !!coords : s.needs === 'search' ? searchQuery.trim().length >= 2 : true
  ));

  const locationLabel = manualLoc?.label
    || (gpsStatus === 'granted' ? t('animal.nearMe')
      : gpsStatus === 'loading' ? t('animal.locating')
        : t('animal.setLocation', 'Set location'));

  const renderItem = useCallback(({ item, index }) => (
    <AnimalCard
      item={item}
      onPress={handleAnimalPress}
      t={t}
      index={index}
      currentUserId={currentUserId}
    />
  ), [handleAnimalPress, t, currentUserId]);

  const keyExtractor = useCallback((item) => item.id, []);

  return (
    <AnimatedScreen>
      <View style={[S.root, { paddingTop: insets.top }]}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

        {/* ── Search + Filters (all collapse on scroll) ── */}
        <Animated.View style={[headerAnimatedStyle, { backgroundColor: COLORS.surface }]}>
          <View style={S.header}>
            <View style={S.topBar}>
              <View style={S.searchBar}>
                <Ionicons name="search-outline" size={16} color={COLORS.grayMedium} />
                <TextInput
                  style={S.searchInput}
                  placeholder={t('animal.searchPlaceholder')}
                  placeholderTextColor={COLORS.textLight}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  returnKeyType="search"
                  accessibilityLabel={t('animal.searchPlaceholder')}
                />
                {searchQuery.length > 0 ? (
                  <TouchableOpacity
                    onPress={clearSearch}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t('animal.clearSearch', 'Clear search')}
                  >
                    <Ionicons name="close-circle" size={18} color={COLORS.grayLightMid} />
                  </TouchableOpacity>
                ) : null}
              </View>
              <TouchableOpacity
                style={S.chatBtn}
                onPress={() => navigation.navigate('MyAnimalChats')}
                accessibilityRole="button"
                accessibilityLabel={t('chatWithSeller') || 'Chat with Seller'}
              >
                <Ionicons name="chatbubbles" size={22} color={COLORS.white} />
              </TouchableOpacity>
            </View>

            {/* Recent searches — only while the box is focused and empty, so it
                never covers the results the user is reading. */}
            {searchFocused && searchQuery.length === 0 && recent.length > 0 ? (
              <View style={S.recentWrap}>
                <View style={S.recentHead}>
                  <Text style={S.recentTitle}>{t('animal.recentSearches', 'Recent searches')}</Text>
                  <TouchableOpacity
                    onPress={() => clearRecentSearches().then(setRecent)}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <Text style={S.recentClear}>{t('animal.clearAll', 'Clear all')}</Text>
                  </TouchableOpacity>
                </View>
                <View style={S.recentRow}>
                  {recent.map((term) => (
                    <TouchableOpacity
                      key={term}
                      style={S.recentChip}
                      onPress={() => setSearchQuery(term)}
                      accessibilityRole="button"
                    >
                      <Ionicons name="time-outline" size={12} color={COLORS.textMedium} />
                      <Text style={S.recentChipTxt} numberOfLines={1}>{term}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}
          </View>

          {/* Category filters */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.catRow}>
            {ANIMAL_CATEGORIES.map((cat) => (
              <CategoryPill
                key={cat.key}
                item={cat}
                active={activeFilter === cat.key}
                onPress={setActiveFilter}
                t={t}
              />
            ))}
          </ScrollView>

          {/* Location + distance + the filter-sheet entry point */}
          <View style={S.distRow}>
            <TouchableOpacity
              style={S.locBtn}
              onPress={() => setLocationOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('animal.changeLocation', 'Change location')}
            >
              <Ionicons
                name={coords || manualLoc ? 'location' : 'location-outline'}
                size={14}
                color={coords || manualLoc ? GREEN : COLORS.grayMedium}
              />
              <Text style={[S.locTxt, (coords || manualLoc) && { color: GREEN }]} numberOfLines={1}>
                {locationLabel}
              </Text>
              <Ionicons name="chevron-down" size={12} color={COLORS.grayMedium} />
            </TouchableOpacity>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.distChips}>
              {DISTANCE_KEYS.map((km) => (
                <DistChip
                  key={String(km)}
                  km={km}
                  label={km === null ? t('all') : `${km} km`}
                  active={distanceKm === km}
                  onPress={handleDistancePress}
                />
              ))}
            </ScrollView>
          </View>
        </Animated.View>

        {/* ── Listings ── */}
        <FlatList
          ref={listRef}
          onScroll={hideOnScroll}
          scrollEventThrottle={16}
          data={items}
          numColumns={2}
          columnWrapperStyle={S.row}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={S.list}
          showsVerticalScrollIndicator={false}
          // Tuned for a mid-range Android: render a screen either side, recycle
          // the rest, and give the list a fixed row height estimate so it can
          // scroll to an offset without measuring every row first.
          windowSize={5}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews
          onEndReachedThreshold={0.6}
          onEndReached={loadMore}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              colors={[GREEN]}
              tintColor={GREEN}
            />
          }
          ListHeaderComponent={(
            <View style={S.listHeader}>
              <StatusStrip
                error={error}
                cachedAt={cachedAt}
                onRetry={refresh}
                onSignIn={() => navigation.navigate('Login')}
                onWidenRadius={() => setDistanceKm(null)}
                hasRadius={!!distanceKm}
                t={t}
              />
              <View style={S.sectionHeader}>
                <View style={S.sectionLeft}>
                  <View style={S.starBadge}>
                    <Ionicons name="star" size={11} color={COLORS.white} />
                  </View>
                  <Text style={S.sectionTitle}>{t('animal.allAnimals')}</Text>
                  <View style={S.countBadge}>
                    <Text style={S.countBadgeTxt}>{total}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[S.filterBtn, filterCount > 0 && S.filterBtnActive]}
                  onPress={() => setFilterOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t('animal.filters')}
                >
                  <Ionicons name="options-outline" size={15} color={filterCount ? COLORS.white : COLORS.textBody} />
                  <Text style={[S.filterBtnTxt, filterCount > 0 && { color: COLORS.white }]}>
                    {filterCount > 0 ? `${t('animal.filters')} · ${filterCount}` : t('animal.filters')}
                  </Text>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.sortRow}>
                {visibleSorts.map((s) => (
                  <SortChip
                    key={s.key}
                    label={t(s.tKey)}
                    active={sortBy === s.key}
                    onPress={() => setSortBy(s.key)}
                  />
                ))}
              </ScrollView>
            </View>
          )}
          ListEmptyComponent={
            loading ? (
              <AnimalCardSkeleton rows={4} />
            ) : (
              <EmptyAnimals
                t={t}
                hasRadius={!!distanceKm}
                hasFilters={filterCount > 0}
                hasSearch={searchQuery.trim().length >= 2}
                onShowAll={() => setDistanceKm(null)}
                onClearFilters={() => setSheetFilters(EMPTY_FILTERS)}
                onPost={() => navigation.navigate('AddAnimalListing')}
              />
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={S.footerLoad}>
                <ActivityIndicator color={GREEN} />
              </View>
            ) : !hasMore && items.length > 0 && !isStale ? (
              <Text style={S.footerEnd}>{t('animal.endOfList', 'That’s all for now')}</Text>
            ) : null
          }
        />

        {/* FAB */}
        <TouchableOpacity
          style={S.fab}
          onPress={() => navigation.navigate('AddAnimalListing')}
          accessibilityRole="button"
          accessibilityLabel={t('animal.postAd')}
        >
          <Ionicons name="add" size={20} color={COLORS.white} />
          <Text style={S.fabTxt}>{t('animal.postAd')}</Text>
        </TouchableOpacity>

        <ScrollToTopButton
          visible={showTopBtn}
          onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
        />

        <AnimalFilterSheet
          visible={filterOpen}
          filters={sheetFilters}
          showMilkYield={showMilkFilter}
          onApply={setSheetFilters}
          onClose={() => setFilterOpen(false)}
          t={t}
        />

        <LocationSheet
          visible={locationOpen}
          gpsStatus={gpsStatus}
          manualLocation={manualLoc}
          onUseGps={refreshGps}
          onManual={applyManualLocation}
          onClose={() => setLocationOpen(false)}
          t={t}
        />
      </View>
    </AnimatedScreen>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  header:   { backgroundColor: COLORS.surface, paddingTop: 8 },
  topBar:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 15, gap: 10 },
  chatBtn:  {
    width: 46, height: 46, borderRadius: 16, backgroundColor: GREEN,
    alignItems: 'center', justifyContent: 'center',
  },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.surfaceRaised, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 12,
    borderWidth: 1.5, borderColor: GREEN,
  },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.textDark, padding: 0, fontFamily: 'Inter_400Regular' },

  recentWrap:  { paddingHorizontal: 18, paddingBottom: 12, gap: 8 },
  recentHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recentTitle: { fontSize: 12.5, fontWeight: '700', color: COLORS.textMedium },
  recentClear: { fontSize: 12.5, fontWeight: '700', color: GREEN },
  recentRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recentChip:  {
    flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '48%',
    backgroundColor: COLORS.surfaceRaised, borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  recentChipTxt: { fontSize: 12.5, color: COLORS.textBody, fontWeight: '600', flexShrink: 1 },

  catRow:           { paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
  catWrap:          { alignItems: 'center', gap: 5, width: 64 },
  catImgWrap:       { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },
  catLabel:         { fontSize: 10, fontWeight: TYPE.weight.bold, color: COLORS.textMedium, textAlign: 'center', fontFamily: 'Inter_700Bold' },
  catLabelActive:   { color: GREEN },

  distRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 12, gap: 10 },
  locBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 130,
    paddingVertical: 8, paddingHorizontal: 10, borderRadius: 16,
    backgroundColor: COLORS.surfaceRaised,
  },
  locTxt: { fontSize: 12, fontWeight: TYPE.weight.bold, color: COLORS.textMedium, flexShrink: 1 },
  // paddingRight matches sortRow's: without it the last chip ('100 km') is
  // sliced mid-glyph at the viewport edge and reads as a wrong value ('10').
  distChips:        { gap: 7, flexDirection: 'row', paddingRight: 16 },
  distChip:         { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.surface, minHeight: 38, justifyContent: 'center' },
  distChipActive:   { backgroundColor: GREEN, borderColor: GREEN },
  distChipTxt:      { fontSize: 12, fontWeight: '600', color: COLORS.textBody },
  distChipTxtActive:{ color: COLORS.white },

  list: { padding: 14, paddingBottom: 100 },
  listHeader:    { marginBottom: 12, gap: 10 },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
  },
  bannerMuted:  { backgroundColor: COLORS.surfaceRaised },
  bannerError:  { backgroundColor: COLORS.error + '14' },
  bannerTxt:    { flex: 1, fontSize: 12.5, color: COLORS.textMedium, fontWeight: '600' },
  bannerAction: { fontSize: 12.5, fontWeight: '800', color: GREEN },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  },
  sectionLeft:   { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  starBadge:     { backgroundColor: GREEN, borderRadius: 6, width: 24, height: 24, justifyContent: 'center', alignItems: 'center' },
  sectionTitle:  { fontSize: 17, fontWeight: TYPE.weight.black, color: COLORS.textDark, letterSpacing: -0.2, flexShrink: 1, fontFamily: 'Inter_800ExtraBold' },
  countBadge:    { backgroundColor: GREEN, borderRadius: 12, minWidth: 24, height: 24, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center' },
  countBadgeTxt: { fontSize: 12, fontWeight: '700', color: COLORS.white, fontFamily: 'Inter_700Bold' },

  filterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 20,
    borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.surface,
    minHeight: 38,
  },
  filterBtnActive: { backgroundColor: GREEN, borderColor: GREEN },
  filterBtnTxt:    { fontSize: 12.5, fontWeight: '700', color: COLORS.textBody },

  sortRow:       { flexDirection: 'row', gap: 8, paddingRight: 16 },
  sortChip:      {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20,
    borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.surface,
    minHeight: 40, justifyContent: 'center',
  },
  sortChipActive:{ backgroundColor: GREEN, borderColor: GREEN },
  sortChipTxt:   { fontSize: 13, fontWeight: '600', color: COLORS.textBody, fontFamily: 'Inter_600SemiBold' },
  sortChipTxtActive: { color: COLORS.white },

  row: { gap: 10, marginBottom: 10 },

  card: {
    width: CARD_W, backgroundColor: COLORS.surface, borderRadius: 20, overflow: 'hidden',
    ...SHADOWS.small,
  },
  photoWrap:    { height: CARD_W * 0.85, position: 'relative' },
  photo:        { width: '100%', height: '100%' },
  photoFallback:{ backgroundColor: BG, justifyContent: 'center', alignItems: 'center' },
  photoGradient:{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%' },

  soldOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  soldTxt: { color: COLORS.white, fontSize: 15, fontWeight: '900', letterSpacing: 2 },

  distBadge: {
    position: 'absolute', bottom: 8, left: 8,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8,
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  distBadgeTxt: { color: COLORS.white, fontSize: 10, fontWeight: '700' },

  vaccBadge: {
    position: 'absolute', bottom: 8, right: 8,
    backgroundColor: GREEN, borderRadius: 10,
    width: 20, height: 20, justifyContent: 'center', alignItems: 'center',
  },

  cardBody:   { padding: 10 },
  animalName: { fontSize: 13.5, fontWeight: TYPE.weight.black, color: COLORS.textDark, marginBottom: 3, fontFamily: 'Inter_800ExtraBold' },
  price:      { fontSize: 15, fontWeight: '900', color: GREEN, marginBottom: 5, fontFamily: 'Inter_800ExtraBold' },
  metaRow:    { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 5 },
  metaTxt:    { fontSize: 11, color: COLORS.grayMid3, flex: 1 },
  statsRow:   { flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  statItem:   { flexDirection: 'row', alignItems: 'center', gap: 3 },
  statTxt:    { fontSize: 11, color: COLORS.grayMid3, fontWeight: '500' },

  bookBtn: {
    backgroundColor: GREEN, borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, gap: 5, minHeight: 40,
  },
  bookBtnTxt: { color: COLORS.white, fontSize: 12, fontWeight: '800', fontFamily: 'Inter_700Bold' },
  // "Your listing" variant — outlined instead of filled so it doesn't look like
  // a buy-side call-to-action; tap still navigates to detail where Edit lives.
  editBtn: {
    backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.primary,
  },
  ownBadge: {
    position: 'absolute', top: 8, left: 8,
    backgroundColor: COLORS.primary, borderRadius: 10,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  ownBadgeTxt: { color: COLORS.white, fontSize: 10, fontWeight: '700' },
  verifiedBadge: {
    position: 'absolute', top: 8, left: 8,
    backgroundColor: COLORS.success, borderRadius: 10,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 3,
  },

  footerLoad: { paddingVertical: 20, alignItems: 'center' },
  footerEnd:  { textAlign: 'center', paddingVertical: 20, fontSize: 12.5, color: COLORS.textLight, fontWeight: '600' },

  emptyWrap:    { alignItems: 'center', paddingTop: 48, paddingBottom: 40, paddingHorizontal: 24 },

  emptyArt:       { width: 160, height: 140, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  emptyArtRingLg: { position: 'absolute', width: 140, height: 140, borderRadius: 70, backgroundColor: GREEN + '0D' },
  emptyArtRingSm: { position: 'absolute', width: 104, height: 104, borderRadius: 52, backgroundColor: GREEN + '14' },
  emptyIconBg:    { width: 78, height: 78, borderRadius: 39, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center',
    shadowColor: GREEN, shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  emptyMini:      { position: 'absolute', width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.surface,
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
    shadowColor: COLORS.black, shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  emptyMiniTL:    { top: 6, left: 14 },
  emptyMiniTR:    { top: 18, right: 10 },
  emptyMiniBR:    { bottom: 8, right: 26 },

  emptyTitle:   { fontSize: 21, fontWeight: '900', color: COLORS.textDark, marginBottom: 6, textAlign: 'center', fontFamily: 'Inter_800ExtraBold' },
  emptyTxt:     { fontSize: 14, color: COLORS.textMedium, fontWeight: '500', textAlign: 'center', marginBottom: 16, lineHeight: 20 },

  emptyChips:   { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 22 },
  emptyChip:    { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: GREEN + '12', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  emptyChipTxt: { fontSize: 12, fontWeight: '700', color: COLORS.primaryDark || GREEN, fontFamily: 'Inter_600SemiBold' },

  emptyCta:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: GREEN, borderRadius: 26, paddingHorizontal: 28, paddingVertical: 14,
    shadowColor: GREEN, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 6 },
  emptyCtaTxt:  { color: COLORS.white, fontSize: 15, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },

  expandBtn:    { marginTop: 14, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: GREEN + '15', borderRadius: 20 },
  expandBtnTxt: { color: GREEN, fontWeight: '700', fontSize: 13 },

  fab: {
    position: 'absolute', bottom: 24, right: 20,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: GREEN, borderRadius: 30,
    paddingHorizontal: 20, paddingVertical: 14,
    shadowColor: GREEN, shadowOpacity: 0.40, shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 }, elevation: 8,
  },
  fabTxt: { color: COLORS.white, fontSize: 14, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
});

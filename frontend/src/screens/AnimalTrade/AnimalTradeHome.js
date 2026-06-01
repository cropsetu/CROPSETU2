/**
 * AnimalTradeHome — Pashushala-inspired Livestock Marketplace
 * Photo category filter + GPS distance filter + 2-column grid
 * Uses real API (/animals) — falls back to mock data if offline
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Pressable,
  TextInput, StatusBar, Image, ScrollView, Dimensions, Alert,
  RefreshControl,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '../../utils/haptics';
import { SPRINGS, AnimatedCard, enterAnimation } from '../../components/ui/motion';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useScrollHeader from '../../hooks/useScrollHeader';
import ScrollToTopButton from '../../components/ScrollToTopButton';
import { useLocation } from '../../context/LocationContext';
import api from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import { COLORS, TYPE, SHADOWS } from '../../constants/colors';
import AnimatedScreen from '../../components/ui/AnimatedScreen';
import TractorLoader from '../../components/ui/TractorLoader';
import AnimalIcon from '../../components/AnimalIcons';
import MockImagePlaceholder from '../../components/MockImagePlaceholder';

const { width: W } = Dimensions.get('window');
const CARD_W = (W - 14 * 2 - 10) / 2;

const GREEN = COLORS.primary;
const BG    = COLORS.background;

const ANIMAL_CATEGORIES = [
  { key: 'All',     tKey: 'all' },
  { key: 'Cow',     tKey: 'cow' },
  { key: 'Buffalo', tKey: 'buffalo' },
  { key: 'Goat',    tKey: 'goat' },
  { key: 'Bullock', tKey: 'bullock' },
  { key: 'Sheep',   tKey: 'sheep' },
];

const DISTANCE_KEYS = [null, 10, 25, 50, 100];

const SORT_KEYS = ['sortLatest', 'sortPriceLow', 'sortPriceHigh'];

// ── Haversine distance (km) ────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Category pill ─────────────────────────────────────────────────────────────
function CategoryPill({ item, active, onPress, t }) {
  const sc = useSharedValue(1);
  const scStyle = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  return (
    <Animated.View style={[S.catWrap, scStyle]}>
      <Pressable
        onPress={() => { Haptics.selection(); onPress(item.key); }}
        onPressIn={() => { sc.value = withSpring(0.9, SPRINGS.snappy); }}
        onPressOut={() => { sc.value = withSpring(1, SPRINGS.snappy); }}
      >
        <View style={[S.catImgWrap, active && S.catImgWrapActive]}>
          <AnimalIcon type={item.key} size={50} />
        </View>
        <Text style={[S.catLabel, active && S.catLabelActive]}>{t(item.tKey === 'all' ? 'all' : `animals.${item.tKey.toLowerCase()}`) || item.key.toUpperCase()}</Text>
      </Pressable>
    </Animated.View>
  );
}

// ── Animal Card ───────────────────────────────────────────────────────────────
function AnimalCard({ item, onPress, t, index = 0 }) {
  const imageUrl = item.images && item.images[0] ? item.images[0] : null;
  const milkStr  = item.milkYield && item.milkYield !== 'N/A' ? item.milkYield : null;
  const price    = item.price ? Number(item.price).toLocaleString() : '—';
  const city     = item.sellerLocation ? item.sellerLocation.split(',')[0] : '—';
  const dist     = item.distanceKm != null ? `${item.distanceKm} km`
                 : item._dist      != null ? `${Math.round(item._dist)} km`
                 : null;

  return (
    <AnimatedCard
      style={S.card}
      onPress={() => onPress(item)}
      index={index}
      scaleValue={0.96}
      accessibilityLabel={`${item.breed} ${item.animal} ${price} rupees`}
    >
      <View style={S.photoWrap}>
        {imageUrl
          ? <Image source={{ uri: imageUrl }} style={S.photo} resizeMode="cover" />
          : (
            <View style={[S.photo, S.photoFallback]}>
              <AnimalIcon type={item.animalType || item.category || 'Cow'} size={CARD_W - 20} />
            </View>
          )
        }
        {/* Gradient overlay on image */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.45)']}
          style={S.photoGradient}
          pointerEvents="none"
        />
        {item.isNew || item._isNew ? (
          <View style={S.badge}>
            <Text style={S.badgeTxt}>{t('animal.addedRecently')}</Text>
          </View>
        ) : null}
        {dist ? (
          <View style={S.distBadge}>
            <Ionicons name="location" size={9} color={COLORS.white} />
            <Text style={S.distBadgeTxt}>{dist}</Text>
          </View>
        ) : null}
        {item.vaccinated ? (
          <View style={S.vaccBadge}>
            <Ionicons name="shield-checkmark" size={10} color={COLORS.white} />
          </View>
        ) : null}
      </View>

      <View style={S.cardBody}>
        <Text style={S.animalName} numberOfLines={1}>{item.breed} {item.animal}</Text>
        <Text style={S.price}>₹{price}</Text>
        <View style={S.metaRow}>
          <Ionicons name="location-outline" size={11} color={COLORS.grayMedium} />
          <Text style={S.metaTxt} numberOfLines={1}>{city}</Text>
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
        <TouchableOpacity style={S.bookBtn} onPress={() => onPress(item)}>
          <Ionicons name="car-outline" size={13} color={COLORS.white} />
          <Text style={S.bookBtnTxt}>{t('animal.bookNow')}</Text>
        </TouchableOpacity>
      </View>
    </AnimatedCard>
  );
}

// ── Distance chip ─────────────────────────────────────────────────────────────
function DistChip({ km, label, active, disabled, onPress }) {
  const sc = useSharedValue(1);
  const scStyle = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  return (
    <Animated.View style={scStyle}>
      <Pressable
        style={[S.distChip, active && S.distChipActive, disabled && S.distChipDisabled]}
        onPress={() => { if (!disabled) { Haptics.selection(); onPress(km); } }}
        onPressIn={() => { if (!disabled) sc.value = withSpring(0.9, SPRINGS.snappy); }}
        onPressOut={() => { sc.value = withSpring(1, SPRINGS.snappy); }}
        disabled={disabled}
      >
        <Text style={[S.distChipTxt, active && S.distChipTxtActive, disabled && { color: COLORS.grayLightMid }]}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// ── Sort Chip (horizontal filter chip) ────────────────────────────────────────
function SortChip({ label, active, onPress }) {
  const sc = useSharedValue(1);
  const scStyle = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  return (
    <Animated.View style={scStyle}>
      <Pressable
        style={[S.sortChip, active && S.sortChipActive]}
        onPress={() => { Haptics.selection(); onPress(); }}
        onPressIn={() => { sc.value = withSpring(0.93, SPRINGS.snappy); }}
        onPressOut={() => { sc.value = withSpring(1, SPRINGS.snappy); }}
      >
        <Text style={[S.sortChipTxt, active && S.sortChipTxtActive]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

// ── List header ────────────────────────────────────────────────────────────────
function ListHeader({ count, sortBy, onSortChange, t }) {
  return (
    <View style={S.listHeader}>
      <View style={S.sectionHeader}>
        <View style={S.sectionLeft}>
          <View style={S.starBadge}>
            <Ionicons name="star" size={11} color={COLORS.white} />
          </View>
          <Text style={S.sectionTitle}>{t('animal.allAnimals')}</Text>
          <View style={S.countBadge}>
            <Text style={S.countBadgeTxt}>{count}</Text>
          </View>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.sortRow}>
        {SORT_KEYS.map(key => (
          <SortChip
            key={key}
            label={t(`animal.${key}`)}
            active={sortBy === key}
            onPress={() => onSortChange(key)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

// ── Row (2 cards) ──────────────────────────────────────────────────────────────
function CardRow({ pair, onPress, t, rowIndex = 0 }) {
  return (
    <View style={S.row}>
      <AnimalCard item={pair[0]} onPress={onPress} t={t} index={rowIndex * 2} />
      {pair[1]
        ? <AnimalCard item={pair[1]} onPress={onPress} t={t} index={rowIndex * 2 + 1} />
        : <View style={{ width: CARD_W }} />
      }
    </View>
  );
}

// ── Enhanced empty state ────────────────────────────────────────────────────────
function EmptyAnimals({ t, distanceKm, onShowAll, onPost }) {
  return (
    <View style={S.emptyWrap}>
      {/* Layered illustration with floating animal icons */}
      <View style={S.emptyArt}>
        <View style={S.emptyArtRingLg} />
        <View style={S.emptyArtRingSm} />
        <View style={S.emptyIconBg}>
          <Ionicons name="paw" size={40} color={GREEN} />
        </View>
        <View style={[S.emptyMini, S.emptyMiniTL]}><AnimalIcon type="Cow" size={26} /></View>
        <View style={[S.emptyMini, S.emptyMiniTR]}><AnimalIcon type="Goat" size={24} /></View>
        <View style={[S.emptyMini, S.emptyMiniBR]}><AnimalIcon type="Buffalo" size={24} /></View>
      </View>

      <Text style={S.emptyTitle}>{distanceKm ? t('animal.noAnimalsNearby') : t('animal.noAnimals')}</Text>
      <Text style={S.emptyTxt}>{t('animal.beFirstToList')}</Text>

      {/* Why list with us — quick reassurance chips */}
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

      <TouchableOpacity style={S.emptyCta} onPress={onPost} activeOpacity={0.85}>
        <Ionicons name="add-circle" size={18} color={COLORS.white} />
        <Text style={S.emptyCtaTxt}>{t('animal.postAd')}</Text>
      </TouchableOpacity>

      {distanceKm ? (
        <TouchableOpacity style={S.expandBtn} onPress={onShowAll}>
          <Text style={S.expandBtnTxt}>{t('animal.showAllAnimals')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AnimalTradeHome({ navigation, route }) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { onScroll: hideOnScroll, headerAnimatedStyle, showTopBtn } = useScrollHeader(200);
  const listRef = useRef(null);
  // ── Use global GPS from LocationContext (fetched once at app start) ─────────
  const { coords, permissionGranted, loading: gpsLoading } = useLocation();
  const userLocation = coords;
  const locStatus    = gpsLoading ? 'loading' : permissionGranted ? 'granted' : 'denied';

  const [activeFilter, setActiveFilter] = useState('All');
  const [searchQuery,  setSearchQuery]  = useState('');
  const [sortBy,       setSortBy]       = useState('sortLatest');
  const [distanceKm,   setDistanceKm]   = useState(null);
  const [listings,     setListings]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);

  // Fetch from API whenever filter/search/distance changes
  useEffect(() => {
    fetchListings();
  }, [activeFilter, searchQuery, distanceKm, userLocation, sortBy]);

  // Re-fetch when returning to this screen (e.g., after posting a new listing)
  useFocusEffect(
    useCallback(() => {
      fetchListings();
    }, [])
  );

  // When AddAnimalListing finishes successfully it navigates here with a
  // `freshListingId` param. Reset filters so the new card is guaranteed to be
  // in view, scroll to top, and clear the param so re-focus doesn't loop.
  useEffect(() => {
    const fresh = route?.params?.freshListingId;
    if (!fresh) return;
    setActiveFilter('All');
    setSearchQuery('');
    setDistanceKm(null);
    setSortBy('sortLatest');
    fetchListings();
    setTimeout(() => listRef.current?.scrollToOffset?.({ offset: 0, animated: true }), 100);
    navigation.setParams({ freshListingId: undefined, ts: undefined });
  }, [route?.params?.freshListingId, route?.params?.ts]);

  async function fetchListings(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const params = { limit: 50 };
      if (activeFilter !== 'All') params.animal  = activeFilter;
      if (searchQuery.trim())     params.search  = searchQuery.trim();
      if (distanceKm && userLocation) {
        params.lat    = userLocation.latitude;
        params.lng    = userLocation.longitude;
        params.radius = distanceKm;
      }

      const { data } = await api.get('/animals', { params });
      let results = data.data || [];

      // Client-side sort (server returns verified+createdAt order)
      if (sortBy === 'sortPriceLow') results = [...results].sort((a, b) => a.price - b.price);
      if (sortBy === 'sortPriceHigh') results = [...results].sort((a, b) => b.price - a.price);
      if (sortBy === 'sortLatest' && distanceKm && userLocation) {
        results = [...results].sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
      }

      setListings(results);
    } catch {
      // [FIX #23] Only use mock data in dev; show empty state in production
      if (__DEV__) {
        const { ANIMAL_LISTINGS } = require('../../constants/mockData');
        let results = ANIMAL_LISTINGS || [];
        if (activeFilter !== 'All') results = results.filter(a => a.animal === activeFilter);
        setListings(results);
      } else {
        setListings([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Build 2-col pairs
  const pairs = [];
  for (let i = 0; i < listings.length; i += 2) {
    pairs.push([listings[i], listings[i + 1] || null]);
  }

  const handleAnimalPress = useCallback(
    item => navigation.navigate('AnimalDetail', { listing: item }),
    [navigation]
  );

  const handleDistancePress = (km) => {
    if (km !== null && locStatus === 'denied') {
      Alert.alert(t('animal.locationRequired'), t('animal.locationRequiredMsg'));
      return;
    }
    setDistanceKm(prev => prev === km ? null : km);
  };

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
              />
              {searchQuery.length > 0 ? (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color={COLORS.grayLightMid} />
                </TouchableOpacity>
              ) : null}
            </View>
            {/* The "+" button used to live here, duplicating the bottom FAB.
                Replaced with the Chat inbox entry-point. */}
            <TouchableOpacity
              style={S.chatBtn}
              onPress={() => navigation.navigate('MyAnimalChats')}
              accessibilityLabel={t('chatWithSeller') || 'Chat with Seller'}
            >
              <Ionicons name="chatbubbles" size={22} color={COLORS.white} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Category + Distance filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.catRow}>
          {ANIMAL_CATEGORIES.map(cat => (
            <CategoryPill
              key={cat.key}
              item={cat}
              active={activeFilter === cat.key}
              onPress={setActiveFilter}
              t={t}
            />
          ))}
        </ScrollView>

        <View style={S.distRow}>
          <View style={S.distLabel}>
            <Ionicons
              name={locStatus === 'granted' ? 'location' : 'location-outline'}
              size={13}
              color={locStatus === 'granted' ? GREEN : COLORS.grayMedium}
            />
            <Text style={[S.distLabelTxt, locStatus === 'granted' && { color: GREEN }]}>
              {locStatus === 'granted'  ? t('animal.nearMe')
               : locStatus === 'loading' ? t('animal.locating')
               : t('animal.distance')}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.distChips}>
            {DISTANCE_KEYS.map(km => (
              <DistChip
                key={String(km)}
                km={km}
                label={km === null ? t('all') : `${km} km`}
                active={distanceKm === km}
                disabled={km !== null && locStatus === 'denied'}
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
        windowSize={5}
        maxToRenderPerBatch={10}
        removeClippedSubviews
        data={pairs}
        keyExtractor={(_, idx) => String(idx)}
        contentContainerStyle={S.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchListings(true)}
            colors={[GREEN]}
            tintColor={GREEN}
          />
        }
        ListHeaderComponent={
          <ListHeader count={listings.length} sortBy={sortBy} onSortChange={setSortBy} t={t} />
        }
        ListEmptyComponent={
          loading ? (
            <View style={S.emptyWrap}>
              <TractorLoader message="Loading animals" size="medium" fullScreen={false} />
            </View>
          ) : (
            <EmptyAnimals
              t={t}
              distanceKm={distanceKm}
              onShowAll={() => setDistanceKm(null)}
              onPost={() => navigation.navigate('AddAnimalListing')}
            />
          )
        }
        renderItem={({ item: pair, index }) => (
          <CardRow pair={pair} onPress={handleAnimalPress} t={t} rowIndex={index} />
        )}
      />

      {/* FAB */}
      <TouchableOpacity style={S.fab} onPress={() => navigation.navigate('AddAnimalListing')}>
        <Ionicons name="add" size={20} color={COLORS.white} />
        <Text style={S.fabTxt}>{t('animal.postAd')}</Text>
      </TouchableOpacity>

      <ScrollToTopButton visible={showTopBtn} onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })} />
    </View>
    </AnimatedScreen>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  header:   { backgroundColor: COLORS.surface, paddingTop: 8 },
  topBar:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 15, gap: 10 },
  // Inbox entry-point next to the search bar — opens MyAnimalChats.
  // Same chip dimensions as the old "+" button so the search bar layout
  // doesn't shift.
  chatBtn:  {
    width: 46, height: 46, borderRadius: 16, backgroundColor: GREEN,
    alignItems: 'center', justifyContent: 'center',
  },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.surfaceRaised, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 12,
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.textDark, padding: 0, fontFamily: 'Inter_400Regular' },

  catRow:           { paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
  catWrap:          { alignItems: 'center', gap: 5, width: 64 },
  catImgWrap:       { width: 54, height: 54, borderRadius: 27, overflow: 'hidden', borderWidth: 2.5, borderColor: COLORS.gray150,
                      shadowColor: COLORS.black, shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  catImgWrapActive: { borderColor: GREEN, shadowColor: GREEN, shadowOpacity: 0.35, elevation: 4 },
  catImg:           { width: '100%', height: '100%' },
  catLabel:         { fontSize: 10, fontWeight: TYPE.weight.bold, color: COLORS.textMedium, textAlign: 'center', fontFamily: 'Inter_700Bold' },
  catLabelActive:   { color: GREEN },

  distRow:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 12, gap: 10 },
  distLabel:        { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 80 },
  distLabelTxt:     { fontSize: 12, fontWeight: TYPE.weight.bold, color: COLORS.textMedium },
  distChips:        { gap: 7, flexDirection: 'row' },
  distChip:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  distChipActive:   { backgroundColor: GREEN, borderColor: GREEN },
  distChipDisabled: { backgroundColor: COLORS.nearWhite, borderColor: COLORS.lightGray2 },
  distChipTxt:      { fontSize: 12, fontWeight: '600', color: COLORS.textBody },
  distChipTxtActive:{ color: COLORS.white },

  list: { padding: 14, paddingBottom: 100 },
  listHeader:    { marginBottom: 12, gap: 10 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  sectionLeft:   { flexDirection: 'row', alignItems: 'center', gap: 7 },
  starBadge:     { backgroundColor: GREEN, borderRadius: 6, width: 24, height: 24, justifyContent: 'center', alignItems: 'center' },
  sectionTitle:  { fontSize: 17, fontWeight: TYPE.weight.black, color: COLORS.textDark, letterSpacing: -0.2, flex: 1, fontFamily: 'Inter_800ExtraBold' },
  countBadge:    { backgroundColor: GREEN, borderRadius: 12, width: 24, height: 24, justifyContent: 'center', alignItems: 'center' },
  countBadgeTxt: { fontSize: 12, fontWeight: '700', color: COLORS.white, fontFamily: 'Inter_700Bold' },

  sortRow:       { flexDirection: 'row', gap: 8, paddingRight: 16 },
  sortChip:      {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  sortChipActive:{ backgroundColor: GREEN, borderColor: GREEN },
  sortChipTxt:   { fontSize: 13, fontWeight: '600', color: COLORS.textBody, fontFamily: 'Inter_600SemiBold' },
  sortChipTxtActive: { color: COLORS.white },

  row: { flexDirection: 'row', gap: 10, marginBottom: 10 },

  card: {
    width: CARD_W, backgroundColor: COLORS.surface, borderRadius: 20, overflow: 'hidden',
    ...SHADOWS.small,
  },
  photoWrap:    { height: CARD_W * 0.85, position: 'relative' },
  photo:        { width: '100%', height: '100%' },
  photoFallback:{ backgroundColor: BG, justifyContent: 'center', alignItems: 'center' },
  photoGradient:{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%' },

  badge: {
    position: 'absolute', top: 8, left: 0,
    backgroundColor: COLORS.amberVivid, borderTopRightRadius: 6, borderBottomRightRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  badgeTxt: { color: COLORS.white, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.3 },

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
    paddingVertical: 8, gap: 5,
  },
  bookBtnTxt: { color: COLORS.white, fontSize: 12, fontWeight: '800', fontFamily: 'Inter_700Bold' },

  emptyWrap:    { alignItems: 'center', paddingTop: 48, paddingBottom: 40, paddingHorizontal: 24 },

  // Layered illustration
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

  expandBtn:    { marginTop: 14, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: GREEN + '15', borderRadius: 20 },
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

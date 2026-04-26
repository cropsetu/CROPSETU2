/**
 * RentHome — Machinery & Labour marketplace
 * • Graphical category filter chips (tractor, harvester, sprayer, …)
 * • Distance filter chips: 5 km, 10 km, 25 km, 50 km, Any
 * • User GPS fetched on mount — sends lat/lng/radius to API for proximity sort
 * • Distance badge ("3.2 km") on every card when GPS is available
 * • Machinery cards with ratings, price, availability badge
 * • Worker cards with booking calendar preview
 * • FAB to list your own machinery / register as worker
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Pressable,
  TextInput, StatusBar, Image, ScrollView,
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring,
  FadeIn, FadeInDown,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '../../utils/haptics';
import { SPRINGS, AppPressable, AnimatedCard, isReducedMotion, enterAnimation } from '../../components/ui/motion';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useScrollHeader from '../../hooks/useScrollHeader';
import ScrollToTopButton from '../../components/ScrollToTopButton';
import { useLocation } from '../../context/LocationContext';
import api from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import MockImagePlaceholder from '../../components/MockImagePlaceholder';
import { COLORS, TYPE, SHADOWS } from '../../constants/colors';
import AnimatedScreen from '../../components/ui/AnimatedScreen';
import TractorLoader from '../../components/ui/TractorLoader';
import { MachineryIcon } from '../../components/MachineryIcons';

const { width: W } = Dimensions.get('window');
const GREEN  = COLORS.primary;
const GREEN2 = COLORS.primaryMedium;
const BG     = COLORS.background;

// ── Machinery categories ───────────────────────────────────────────────────────
const MACH_CATS = [
  { key: 'all',          tKey: 'catAll',          icon: 'grid-outline',          color: COLORS.primary, bg: COLORS.primaryPale },
  { key: 'tractor',      tKey: 'catTractor',      icon: 'construct-outline',     color: COLORS.blue, bg: COLORS.blueBg },
  { key: 'harvester',    tKey: 'catHarvester',    icon: 'leaf-outline',          color: COLORS.purpleDark, bg: COLORS.purplePale },
  { key: 'sprayer',      tKey: 'catSprayer',      icon: 'water-outline',         color: COLORS.tealDarkAlt, bg: COLORS.tealPale2 },
  { key: 'rotavator',    tKey: 'catRotavator',    icon: 'refresh-circle-outline',color: COLORS.cta, bg: COLORS.sellerPrimaryPale },
  { key: 'thresher',     tKey: 'catThresher',     icon: 'aperture-outline',      color: COLORS.error, bg: COLORS.redPale },
  { key: 'transplanter', tKey: 'catTransplanter', icon: 'git-branch-outline',    color: COLORS.primaryLight, bg: COLORS.primaryPale },
  { key: 'truck',        tKey: 'catTruck',        icon: 'bus-outline',           color: COLORS.blueSteel, bg: COLORS.steelPale },
  { key: 'tempo',        tKey: 'catTempo',        icon: 'car-outline',           color: COLORS.brownAlt, bg: COLORS.brownPale },
  { key: 'other',        tKey: 'catOther',        icon: 'ellipsis-horizontal',   color: COLORS.grayMid, bg: COLORS.divider },
];

// ── Distance filter options ────────────────────────────────────────────────────
const DIST_OPTIONS = [
  { km: 5,    label: '5 km'  },
  { km: 10,   label: '10 km' },
  { km: 25,   label: '25 km' },
  { km: 50,   label: '50 km' },
  { km: null, tKey: 'distAny' },
];

// ── Category chip ──────────────────────────────────────────────────────────────
function CatChip({ cat, active, onPress }) {
  const { t } = useLanguage();
  const sc = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  return (
    <Animated.View style={animStyle}>
      <Pressable
        style={[S.catChip, active && { backgroundColor: cat.color, borderColor: cat.color }]}
        onPress={() => { Haptics.selection(); onPress(cat.key); }}
        onPressIn={() => { sc.value = withSpring(0.9, SPRINGS.snappy); }}
        onPressOut={() => { sc.value = withSpring(1, SPRINGS.snappy); }}
      >
        <View style={[S.catIconWrap, { backgroundColor: active ? 'rgba(255,255,255,0.2)' : cat.bg }]}>
          {cat.key !== 'all' && cat.key !== 'other' ? (
            <MachineryIcon type={cat.key} size={28} />
          ) : (
            <Ionicons name={cat.icon} size={18} color={active ? COLORS.white : cat.color} />
          )}
        </View>
        <Text style={[S.catLabel, active && { color: COLORS.white }]}>{t('rent.' + cat.tKey)}</Text>
      </Pressable>
    </Animated.View>
  );
}

// ── Distance badge ─────────────────────────────────────────────────────────────
function DistBadge({ km }) {
  if (km == null) return null;
  return (
    <View style={S.distBadge}>
      <Ionicons name="navigate-circle" size={11} color={COLORS.blue} />
      <Text style={S.distTxt}>{km} km</Text>
    </View>
  );
}

// ── Machinery card ─────────────────────────────────────────────────────────────
function MachineryCard({ item, onPress, index = 0 }) {
  const { t } = useLanguage();
  const catInfo = MACH_CATS.find(c => c.key === item.category) || MACH_CATS[MACH_CATS.length - 1];

  return (
    <AnimatedCard
      style={S.mCard}
      onPress={() => onPress(item)}
      index={index}
      scaleValue={0.97}
      accessibilityLabel={`${item.name} ${item.pricePerDay} per day`}
    >
      {/* Photo */}
      <View style={S.mPhotoWrap}>
        {item.images?.[0]
          ? <Image source={{ uri: item.images[0] }} style={S.mPhoto} resizeMode="cover" />
          : (
            <View style={[S.mPhoto, { backgroundColor: catInfo.bg, justifyContent: 'center', alignItems: 'center' }]}>
              <MockImagePlaceholder category={item.category || 'machinery'} size={140} />
            </View>
          )
        }
        {/* Gradient overlay */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.5)']}
          style={S.mPhotoGradient}
          pointerEvents="none"
        />
        {/* Availability badge */}
        <View style={[S.availBadge, { backgroundColor: item.available ? COLORS.primaryPale : COLORS.orangeWarm, borderColor: item.available ? GREEN : COLORS.cta }]}>
          <View style={[S.availDot, { backgroundColor: item.available ? GREEN : COLORS.cta }]} />
          <Text style={[S.availTxt, { color: item.available ? GREEN : COLORS.cta }]}>
            {item.available ? t('rent.listAvailable') : t('rent.listAdvanceBooking')}
          </Text>
        </View>
        {/* Category label */}
        <View style={[S.catTag, { backgroundColor: catInfo.color }]}>
          <Text style={S.catTagTxt}>{t('rent.' + catInfo.tKey)}</Text>
        </View>
        {/* Distance */}
        {item.distanceKm != null && (
          <View style={S.distOverlay}>
            <Ionicons name="navigate-circle" size={11} color={COLORS.blue} />
            <Text style={S.distOverlayTxt}>{item.distanceKm} km</Text>
          </View>
        )}
      </View>

      <View style={S.mBody}>
        <View style={S.mTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={S.mName} numberOfLines={1}>{item.name}</Text>
            {item.brand ? <Text style={S.mBrand}>{item.brand}{item.horsePower ? ` • ${item.horsePower}` : ''}</Text> : null}
          </View>
          <View style={S.mPriceCol}>
            <Text style={S.mPrice}>₹{item.pricePerHour?.toLocaleString()}/hr</Text>
            <Text style={S.mPriceDay}>₹{item.pricePerDay?.toLocaleString()}/day</Text>
          </View>
        </View>

        <View style={S.mMetaRow}>
          <View style={S.ratingPill}>
            <Ionicons name="star" size={11} color={COLORS.yellowDark2} />
            <Text style={S.ratingTxt}>{item.rating?.toFixed(1)} ({item.ratingCount})</Text>
          </View>
          {item.ageYears != null && (
            <View style={S.metaPill}>
              <Ionicons name="calendar-outline" size={11} color={COLORS.grayMedium} />
              <Text style={S.metaTxt}>{t('rent.yrOld', { count: item.ageYears })}</Text>
            </View>
          )}
          <View style={S.verifiedPill}>
            <Ionicons name="checkmark-circle" size={11} color={GREEN} />
            <Text style={[S.metaTxt, { color: GREEN }]}>{t('verified')}</Text>
          </View>
        </View>

        <View style={S.mLocRow}>
          <Ionicons name="location-outline" size={13} color={COLORS.grayMedium} />
          <Text style={S.mLocTxt} numberOfLines={1}>{item.location}</Text>
        </View>

        <TouchableOpacity style={S.bookBtn} onPress={() => onPress(item)}>
          <Ionicons name="calendar" size={14} color={COLORS.white} />
          <Text style={S.bookBtnTxt}>{t('bookNow')}</Text>
        </TouchableOpacity>
      </View>
    </AnimatedCard>
  );
}

// ── Worker card ────────────────────────────────────────────────────────────────
function WorkerCard({ item, onPress, index = 0 }) {
  const { t } = useLanguage();
  const initials = (item.leader || item.name || 'W')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const sc    = useSharedValue(1);
  const scStyle = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));

  return (
    <Animated.View entering={enterAnimation(index)} style={[S.wCard, scStyle]}>
    <Pressable
      style={{ flex: 1, flexDirection: 'row', gap: 12 }}
      onPress={() => { Haptics.light(); onPress(item); }}
      onPressIn={() => { sc.value = withSpring(0.97, SPRINGS.snappy); }}
      onPressOut={() => { sc.value = withSpring(1, SPRINGS.snappy); }}
    >
      {/* Avatar */}
      <View style={S.wAvatarWrap}>
        {item.image
          ? <Image source={{ uri: item.image }} style={S.wAvatar} />
          : (
            <View style={S.wAvatarPlaceholder}>
              <Text style={S.wInitials}>{initials}</Text>
            </View>
          )
        }
        <View style={[S.wAvailDot, { backgroundColor: item.available ? GREEN : COLORS.cta }]} />
      </View>

      <View style={S.wInfo}>
        <Text style={S.wName} numberOfLines={1}>{item.leader || item.name}</Text>
        <Text style={S.wGroup} numberOfLines={1}>{item.name}{item.groupSize > 1 ? ` • ${t('rent.workersCount', { count: item.groupSize })}` : ''}</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5, paddingTop: 4 }}>
          {(item.skills || []).slice(0, 3).map((s, i) => (
            <View key={i} style={S.skillTag}>
              <Text style={S.skillTagTxt}>{s}</Text>
            </View>
          ))}
        </ScrollView>

        {item.distanceKm != null && (
          <View style={[S.distBadge, { marginTop: 4, alignSelf: 'flex-start' }]}>
            <Ionicons name="navigate-circle" size={11} color={COLORS.blue} />
            <Text style={S.distTxt}>{item.distanceKm} {t('rent.kmAway')}</Text>
          </View>
        )}
      </View>

      <View style={S.wRight}>
        <View style={S.ratingPill}>
          <Ionicons name="star" size={11} color={COLORS.yellowDark2} />
          <Text style={S.ratingTxt}>{item.rating?.toFixed(1)}</Text>
        </View>
        <Text style={S.wPrice}>₹{item.pricePerDay}/day</Text>
        <TouchableOpacity style={S.callBtn} onPress={() => onPress(item)}>
          <Ionicons name="call-outline" size={13} color={GREEN} />
          <Text style={S.callBtnTxt}>{t('rent.call')}</Text>
        </TouchableOpacity>
      </View>
    </Pressable>
    </Animated.View>
  );
}

// ── Distance chip (Rent screen) ────────────────────────────────────────────────
function RentDistChip({ opt, active, disabled, onPress }) {
  const { t } = useLanguage();
  const sc = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  return (
    <Animated.View style={animStyle}>
      <Pressable
        style={[S.distChip, active && S.distChipActive, disabled && S.distChipDisabled]}
        onPress={() => { if (!disabled) { Haptics.selection(); onPress(opt.km); } }}
        onPressIn={() => { if (!disabled) sc.value = withSpring(0.88, SPRINGS.snappy); }}
        onPressOut={() => { sc.value = withSpring(1, SPRINGS.snappy); }}
        disabled={disabled}
      >
        <Text style={[S.distChipTxt, active && { color: COLORS.white }]}>{opt.tKey ? t('rent.' + opt.tKey) : opt.label}</Text>
      </Pressable>
    </Animated.View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────
export default function RentHome({ navigation }) {
  const { t }        = useLanguage();
  const { isLoggedIn } = useAuth();
  const insets       = useSafeAreaInsets();
  const { onScroll: hideOnScroll, headerAnimatedStyle, showTopBtn } = useScrollHeader(55);
  const scrollRef = useRef(null);

  // ── Global GPS from LocationContext (fetched once at app start) ───────────
  const { coords: gpsCoords, loading: gpsLoading } = useLocation();
  const userLat  = gpsCoords?.latitude  ?? null;
  const userLng  = gpsCoords?.longitude ?? null;
  const gpsReady = !gpsLoading;

  const [tab,       setTab]       = useState('machinery');
  const [category,  setCategory]  = useState('all');
  const [search,    setSearch]    = useState('');
  const [machinery, setMachinery] = useState([]);
  const [labour,    setLabour]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const [pendingCount, setPendingCount] = useState(0);
  const [hasListings,  setHasListings]  = useState(false);

  const [radiusKm, setRadiusKm] = useState(10); // default 10 km

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const params = {};
      if (userLat != null && userLng != null && radiusKm != null) {
        params.lat    = userLat;
        params.lng    = userLng;
        params.radius = radiusKm;
      }

      const [mRes, lRes] = await Promise.all([
        api.get('/rent/machinery', { params }).catch(() => null),
        api.get('/rent/labour',    { params }).catch(() => null),
      ]);
      setMachinery(mRes?.data?.data ?? []);
      setLabour(lRes?.data?.data ?? []);

      // Check if user has any listings → show/hide the bell icon
      if (isLoggedIn) {
        Promise.all([
          api.get('/rent/machinery/my').catch(() => null),
          api.get('/rent/labour/my').catch(() => null),
        ]).then(([mr, lr]) => {
          const count = (mr?.data?.data?.length || 0) + (lr?.data?.data?.length || 0);
          setHasListings(count > 0);
          if (count > 0) {
            api.get('/rent/bookings/received/pending-count')
               .then(r => setPendingCount(r.data?.data?.count ?? 0))
               .catch(() => {});
          }
        });
      }
    } catch {
      // [FIX #23] Only use mock data in dev — show error state in production
      if (__DEV__) {
        const { MACHINERY_LISTINGS, LABOUR_LISTINGS } = require('../../constants/mockData');
        setMachinery(MACHINERY_LISTINGS || []);
        setLabour(LABOUR_LISTINGS || []);
      } else {
        setMachinery([]);
        setLabour([]);
      }
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [userLat, userLng, radiusKm]);

  // Re-fetch when GPS is ready or radius changes
  useEffect(() => {
    if (gpsReady) fetchAll();
  }, [gpsReady, radiusKm]);

  useFocusEffect(useCallback(() => { if (gpsReady) fetchAll(); }, [fetchAll, gpsReady]));

  // ── Filters (client-side category/search) ─────────────────────────────────
  const q = search.toLowerCase();
  const filteredMachinery = machinery.filter(m => {
    if (category !== 'all' && m.category !== category) return false;
    if (!q) return true;
    return ((m.name || '') + (m.equipment || '') + (m.brand || '') + (m.location || '')).toLowerCase().includes(q);
  });
  const filteredLabour = labour.filter(l => {
    if (!q) return true;
    return ((l.name || '') + (l.leader || '') + (l.location || '') + (l.skills || []).join(' ')).toLowerCase().includes(q);
  });

  return (

    <AnimatedScreen>
    <View style={[S.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* [FIX #23] Error banner when API call fails */}
      {fetchError && !loading && (
        <TouchableOpacity
          style={{ backgroundColor: COLORS.error, paddingVertical: 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
          onPress={fetchAll}
        >
          <Ionicons name="cloud-offline-outline" size={16} color={COLORS.white} style={{ marginRight: 6 }} />
          <Text style={{ color: COLORS.white, fontSize: 13, fontWeight: '600' }}>
            {t('rent.fetchError') || 'Could not load listings. Tap to retry.'}
          </Text>
        </TouchableOpacity>
      )}

      {/* ── Header (collapses on scroll) ── */}
      <Animated.View style={headerAnimatedStyle}>
        <View style={S.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.charcoal} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={S.headerTitle}>{t('rentTitle')}</Text>
            <Text style={S.headerSub}>{t('rent.rentHomeSub')}</Text>
          </View>
          <View style={[S.gpsDot, { backgroundColor: userLat != null ? COLORS.sellerAccentLight : COLORS.cta }]} />
          {hasListings && (
            <TouchableOpacity style={S.bellBtn} onPress={() => navigation.navigate('RentBookings')}>
              <Ionicons name="notifications-outline" size={22} color={COLORS.charcoal} />
              {pendingCount > 0 && (
                <View style={S.bellBadge}>
                  <Text style={S.bellBadgeTxt}>{pendingCount > 9 ? '9+' : pendingCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      {/* ── Tabs (always visible) ── */}
      <View style={S.tabBar}>
        {[
          { key: 'machinery', tKey: 'machineryTab', icon: 'construct-outline' },
          { key: 'labour',    tKey: 'workersTab',   icon: 'people-outline'    },
        ].map(tb => (
          <TouchableOpacity
            key={tb.key}
            style={[S.tabItem, tab === tb.key && S.tabItemActive]}
            onPress={() => { setTab(tb.key); setCategory('all'); }}
          >
            <Ionicons name={tb.icon} size={16} color={tab === tb.key ? GREEN : COLORS.grayMedium} />
            <Text style={[S.tabTxt, tab === tb.key && S.tabTxtActive]}>{t('rent.' + tb.tKey)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} style={S.scroll} keyboardShouldPersistTaps="handled" onScroll={hideOnScroll} scrollEventThrottle={16}>

        {/* ── Search ── */}
        <View style={S.searchRow}>
          <View style={S.searchBar}>
            <Ionicons name="search-outline" size={16} color={COLORS.grayMedium} />
            <TextInput
              style={S.searchInput}
              placeholder={tab === 'machinery' ? t('machinerySearch') : t('labourSearch')}
              placeholderTextColor={COLORS.textLight}
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={17} color={COLORS.grayLightMid} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Distance filter ── */}
        <View style={S.distRow}>
          <Ionicons name="navigate-outline" size={15} color={userLat != null ? GREEN : COLORS.grayLightMid} />
          <Text style={[S.distLabel, userLat == null && { color: COLORS.grayLightMid }]}>
            {userLat != null ? t('rent.distNearby') : t('rent.distGpsOff')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingRight: 4 }}>
            {DIST_OPTIONS.map(opt => (
              <RentDistChip
                key={String(opt.km)}
                opt={opt}
                active={radiusKm === opt.km}
                disabled={userLat == null && opt.km != null}
                onPress={setRadiusKm}
              />
            ))}
          </ScrollView>
        </View>

        {/* ── Category filter (machinery only) ── */}
        {tab === 'machinery' && (
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={S.catRow}
          >
            {MACH_CATS.map(cat => (
              <CatChip
                key={cat.key}
                cat={cat}
                active={category === cat.key}
                onPress={setCategory}
              />
            ))}
          </ScrollView>
        )}

        {loading ? (
          <View style={S.loadWrap}>
            <TractorLoader
              message={tab === 'machinery' ? t('rent.loadingMachinery') : t('rent.loadingWorkers')}
              size="medium"
              fullScreen={false}
            />
          </View>
        ) : tab === 'machinery' ? (
          <>
            <View style={S.sectionHeader}>
              <Text style={S.sectionTitle}>
                {category === 'all' ? t('rent.availMachinery') : t('rent.' + (MACH_CATS.find(c => c.key === category)?.tKey))}
              </Text>
              <View style={S.countBadge}>
                <Text style={S.countTxt}>{filteredMachinery.length} {t('rent.found')}</Text>
              </View>
            </View>

            {filteredMachinery.length === 0 ? (
              <View style={S.emptyWrap}>
                <View style={S.emptyIconBg}>
                  <Ionicons name="construct-outline" size={36} color={GREEN} />
                </View>
                <Text style={S.emptyTitle}>{t('ai.comingSoon')}</Text>
                <Text style={S.emptyTxt}>{t('rent.noMachinery')}</Text>
                <Text style={S.emptyHint}>{t('rent.beFirstMachinery')}</Text>
                <TouchableOpacity style={S.addFirstBtn} onPress={() => navigation.navigate('AddMachinery')}>
                  <Ionicons name="add" size={16} color={GREEN} />
                  <Text style={S.addFirstTxt}>{t('rent.listYourMachinery')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              filteredMachinery.map((item, idx) => (
                <MachineryCard
                  key={item.id} item={item} index={idx}
                  onPress={i => navigation.navigate('MachineryDetail', { id: i.id, machinery: i })}
                />
              ))
            )}
          </>
        ) : (
          <>
            <View style={S.sectionHeader}>
              <Text style={S.sectionTitle}>{t('rent.workersSection')}</Text>
              <View style={S.countBadge}>
                <Text style={S.countTxt}>{filteredLabour.length} {t('rent.found')}</Text>
              </View>
            </View>

            {filteredLabour.length === 0 ? (
              <View style={S.emptyWrap}>
                <View style={S.emptyIconBg}>
                  <Ionicons name="people-outline" size={36} color={GREEN} />
                </View>
                <Text style={S.emptyTitle}>{t('ai.comingSoon')}</Text>
                <Text style={S.emptyTxt}>{t('rent.noWorkersFound')}</Text>
                <Text style={S.emptyHint}>{t('rent.beFirstWorker')}</Text>
                <TouchableOpacity style={S.addFirstBtn} onPress={() => navigation.navigate('AddWorker')}>
                  <Ionicons name="add" size={16} color={GREEN} />
                  <Text style={S.addFirstTxt}>{t('rent.registerAsWorker')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              filteredLabour.map((item, idx) => (
                <WorkerCard
                  key={item.id} item={item} index={idx}
                  onPress={i => navigation.navigate('LabourDetail', { id: i.id, labour: i })}
                />
              ))
            )}
          </>
        )}

        {/* ── List Your Equipment / Worker banner ── */}
        {!loading && (
          <TouchableOpacity
            style={S.listBanner}
            onPress={() => navigation.navigate(tab === 'machinery' ? 'AddMachinery' : 'AddWorker')}
            activeOpacity={0.9}
          >
            <View style={S.listBannerLeft}>
              <Ionicons
                name={tab === 'machinery' ? 'construct' : 'person-add'}
                size={28} color={GREEN}
              />
              <View style={{ flex: 1 }}>
                <Text style={S.listBannerTitle}>
                  {tab === 'machinery' ? t('rent.listYourMachinery') : t('rent.registerAsWorker')}
                </Text>
                <Text style={S.listBannerSub}>
                  {tab === 'machinery'
                    ? t('rent.bannerEarnMachinery')
                    : t('rent.findWageWork')}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={GREEN} />
          </TouchableOpacity>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>

      {/* ── FAB ── */}
      <TouchableOpacity
        style={S.fab}
        onPress={() => navigation.navigate(tab === 'machinery' ? 'AddMachinery' : 'AddWorker')}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color={COLORS.white} />
      </TouchableOpacity>
      <ScrollToTopButton visible={showTopBtn} onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })} />
    </View>
    </AnimatedScreen>
  );
}

const S = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  scroll: { flex: 1 },

  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 9, ...SHADOWS.small },
  backBtn:     { padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: TYPE.weight.black, color: COLORS.textDark, letterSpacing: -0.3 },
  headerSub:   { fontSize: 12, color: COLORS.textMedium, marginTop: 2 },
  gpsDot:      { width: 8, height: 8, borderRadius: 4 },
  bellBtn:     { padding: 4, position: 'relative' },
  bellBadge:   { position: 'absolute', top: 0, right: 0, backgroundColor: COLORS.error, borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 },
  bellBadgeTxt:{ color: COLORS.white, fontSize: 9, fontWeight: '800' },

  tabBar:       { flexDirection: 'row', backgroundColor: COLORS.surface, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tabItem:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  tabItemActive:{ borderBottomColor: GREEN },
  tabTxt:       { fontSize: 14, fontWeight: '600', color: COLORS.textLight },
  tabTxtActive: { color: GREEN, fontWeight: '800' },

  searchRow: { paddingHorizontal: 16, paddingTop: 16 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.small,
  },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.textDark, padding: 0 },

  // Distance filter row
  distRow:         { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },
  distLabel:       { fontSize: 12, fontWeight: '700', color: GREEN, flexShrink: 0 },
  distChip:        { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: COLORS.surface, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border },
  distChipActive:  { backgroundColor: GREEN, borderColor: GREEN },
  distChipDisabled:{ opacity: 0.4 },
  distChipTxt:     { fontSize: 12, fontWeight: '700', color: COLORS.grayMid2 },

  // Category chips
  catRow: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  catChip: {
    flexDirection: 'column', alignItems: 'center', gap: 4,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: COLORS.surface, borderRadius: 18, borderWidth: 1.5, borderColor: COLORS.border,
    minWidth: 68,
  },
  catIconWrap: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  catLabel:    { fontSize: 10, fontWeight: '700', color: COLORS.grayMid2, textAlign: 'center' },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10 },
  sectionTitle:  { fontSize: 18, fontWeight: TYPE.weight.black, color: COLORS.textDark, flex: 1, letterSpacing: -0.2 },
  countBadge:    { backgroundColor: GREEN + '15', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  countTxt:      { fontSize: 11, color: GREEN, fontWeight: '700' },

  // Distance badge (shared)
  distBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: COLORS.blueBg, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  distTxt:   { fontSize: 10, color: COLORS.blue, fontWeight: '700' },

  // Machinery card
  mCard: {
    marginHorizontal: 14, marginBottom: 16,
    backgroundColor: COLORS.surface, borderRadius: 22, overflow: 'hidden',
    ...SHADOWS.small,
  },
  mPhotoWrap:    { height: 190, position: 'relative' },
  mPhoto:        { width: '100%', height: '100%' },
  mPhotoGradient:{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%' },
  availBadge: {
    position: 'absolute', top: 10, right: 10,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: COLORS.white,
  },
  availDot: { width: 7, height: 7, borderRadius: 4 },
  availTxt: { fontSize: 11, fontWeight: '700' },
  catTag:   { position: 'absolute', top: 10, left: 10, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  catTagTxt:{ fontSize: 10, color: COLORS.white, fontWeight: '800' },
  distOverlay:    { position: 'absolute', bottom: 8, right: 10, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  distOverlayTxt: { fontSize: 11, color: COLORS.blue, fontWeight: '800' },
  mBody:    { padding: 14 },
  mTopRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 8 },
  mName:    { fontSize: 16, fontWeight: TYPE.weight.black, color: COLORS.textDark },
  mBrand:   { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  mPriceCol:{ alignItems: 'flex-end', flexShrink: 0 },
  mPrice:   { fontSize: 15, fontWeight: '900', color: GREEN },
  mPriceDay:{ fontSize: 11, color: COLORS.textLight, marginTop: 1 },
  mMetaRow: { flexDirection: 'row', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  ratingPill:   { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: COLORS.yellowAmber, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  ratingTxt:    { fontSize: 11, color: COLORS.amber, fontWeight: '700' },
  metaPill:     { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: COLORS.background, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  metaTxt:      { fontSize: 11, color: COLORS.textBody, fontWeight: '600' },
  verifiedPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: COLORS.primaryPale, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  mLocRow:  { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  mLocTxt:  { fontSize: 12, color: COLORS.textLight, flex: 1 },
  bookBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: GREEN, borderRadius: 12, paddingVertical: 12 },
  bookBtnTxt:{ color: COLORS.white, fontSize: 14, fontWeight: '800' },

  // Worker card
  wCard: {
    marginHorizontal: 14, marginBottom: 12,
    backgroundColor: COLORS.surface, borderRadius: 20, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    ...SHADOWS.small,
  },
  wAvatarWrap: { position: 'relative' },
  wAvatar:  { width: 56, height: 56, borderRadius: 28, borderWidth: 2.5, borderColor: GREEN + '40' },
  wAvatarPlaceholder: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: GREEN + '15',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: GREEN + '30',
  },
  wInitials:{ fontSize: 19, fontWeight: '800', color: GREEN },
  wAvailDot:{ position: 'absolute', bottom: 1, right: 1, width: 14, height: 14, borderRadius: 7, borderWidth: 2.5, borderColor: COLORS.white },
  wInfo:    { flex: 1 },
  wName:    { fontSize: 15, fontWeight: TYPE.weight.bold, color: COLORS.textDark },
  wGroup:   { fontSize: 12, color: COLORS.textLight, marginBottom: 2 },
  skillTag: { backgroundColor: GREEN + '12', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: GREEN + '25' },
  skillTagTxt: { fontSize: 10, color: GREEN, fontWeight: '700' },
  wRight:   { alignItems: 'flex-end', gap: 6 },
  wPrice:   { fontSize: 13, fontWeight: '700', color: COLORS.textDark },
  callBtn:   { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: GREEN, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  callBtnTxt:{ color: GREEN, fontSize: 12, fontWeight: '800' },

  loadWrap: { paddingVertical: 60, alignItems: 'center', gap: 10 },
  loadTxt:  { fontSize: 13, color: COLORS.textLight },
  emptyWrap:   { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emptyIconBg: { width: 80, height: 80, borderRadius: 40, backgroundColor: COLORS.primaryPale, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle:  { fontSize: 20, fontWeight: '900', color: COLORS.textDark, marginBottom: 6 },
  emptyTxt:    { fontSize: 14, color: COLORS.textMedium, fontWeight: '500', textAlign: 'center', marginBottom: 4 },
  emptyHint:   { fontSize: 12, color: COLORS.textLight, textAlign: 'center', marginBottom: 16 },
  addFirstBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: GREEN, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
  addFirstTxt: { color: GREEN, fontSize: 13, fontWeight: '700' },

  listBanner: {
    marginHorizontal: 14, marginVertical: 8,
    backgroundColor: COLORS.white, borderRadius: 16, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: GREEN + '30',
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  listBannerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  listBannerTitle: { fontSize: 15, fontWeight: '800', color: COLORS.textDark, marginBottom: 2 },
  listBannerSub:   { fontSize: 12, color: COLORS.textLight, lineHeight: 16 },

  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: GREEN, justifyContent: 'center', alignItems: 'center',
    shadowColor: GREEN, shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
});

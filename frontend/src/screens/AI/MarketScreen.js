import { COLORS } from '@krushisarva/shared/constants/colors';
import { useRef, useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, FlatList,
  Dimensions, Animated, StatusBar, Pressable,
  Modal, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location'; // reverseGeocodeAsync only
import { useLocation } from '../../context/LocationContext';
import { getMandiPrices } from '../../services/aiApi';
import { INDIA_STATES_LIST, STATE_GPS_MAP, getDistricts } from '@krushisarva/shared/constants/indiaLocations';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import PhotoIcon from '../../components/PhotoIcon';
import CropIcon from '@krushisarva/shared/components/CropIcons';
import AnimatedScreen from '@krushisarva/shared/components/ui/AnimatedScreen';
import { SkeletonBlock, SkeletonGroup } from '../../components/ui/Skeleton';
import {
  KHET, KSPACE, KGUTTER, KRADIUS, KICON, KBORDER, circle, withAlpha,
} from '@krushisarva/shared/constants/khetTheme';

const { width: W, height: H } = Dimensions.get('window');

// ── Design tokens ─────────────────────────────────────────────────────────────
// The PALETTE here is still colors.js, deliberately. Not one COLORS key this
// screen uses is equal to its nearest KHET role — COLORS.primary #176B43 vs
// KHET.primary #005f21, COLORS.background #F4F8F1 vs KHET.background #f9fdf6,
// COLORS.textDark #1C1917 (warm) vs KHET.foreground #06210d (green) — so
// swapping them would re-hue the whole screen, which is a restyle, not a
// migration. KHET appears below ONLY where a pairing failed WCAG AA and the fix
// needed a colour that carries a documented contrast guarantee.
//
// The four constants below are CATEGORICAL DATA (they identify a stat channel,
// not a semantic state) and stay out of KHET for the reason dataPalette.js
// states in its header. See the report for the proposed dataPalette entry.
const PURPLE = COLORS.sellerShipped;
const AMBER  = COLORS.amber;
// A11Y: was COLORS.error #EF4444 — 3.62:1 as the LOWEST stat value on the price
// hero and 2.92:1 as its label. destructiveInk is 6.36:1 on the same surface.
const RED    = KHET.destructiveInk;
const BLUE   = COLORS.blue;
const SLATE  = COLORS.textDark;

const CARD_MARGIN  = KGUTTER.base;
const DEFAULT_CROP = 'Tomato';
// ── All Indian crops by category ──────────────────────────────────────────────
const CROP_CATEGORIES = [
  {
    key: 'all', label: 'All', icon: 'apps', color: SLATE,
    crops: [],   // filled dynamically
  },
  {
    key: 'veg', label: 'Vegetables', icon: 'leaf', color: COLORS.greenBright,
    crops: [
      'Tomato','Onion','Potato','Brinjal','Cauliflower','Cabbage',
      'Okra','Bitter Gourd','Capsicum','Cucumber','Bottle Gourd',
      'Pumpkin','Carrot','Radish','Spinach','Green Chilli',
      'Garlic','Ginger','Coriander','Fenugreek','Sweet Potato','Peas',
    ],
  },
  {
    key: 'fruit', label: 'Fruits', icon: 'nutrition', color: COLORS.cta,
    crops: [
      'Mango','Banana','Grapes','Pomegranate','Guava','Papaya',
      'Watermelon','Muskmelon','Orange','Lemon','Apple','Sapota',
      'Pineapple','Litchi','Coconut',
    ],
  },
  {
    key: 'cereal', label: 'Cereals', icon: 'grid', color: COLORS.burnOrange,
    crops: ['Wheat','Rice','Maize','Bajra','Jowar','Barley','Ragi'],
  },
  {
    key: 'pulse', label: 'Pulses', icon: 'ellipse', color: COLORS.amberDark2,
    crops: ['Tur Dal','Gram','Moong','Urad','Masoor'],
  },
  {
    key: 'oil', label: 'Oilseeds', icon: 'water', color: COLORS.darkGold,
    crops: ['Soybean','Groundnut','Sunflower','Mustard','Sesame','Castor'],
  },
  {
    key: 'cash', label: 'Cash Crops', icon: 'cash', color: COLORS.sellerShipped,
    crops: ['Cotton','Sugarcane','Jute'],
  },
  {
    key: 'spice', label: 'Spices', icon: 'flame', color: COLORS.error,
    crops: ['Turmeric','Red Chilli','Cumin','Coriander Seeds','Cardamom','Black Pepper','Ajwain','Fennel'],
  },
];

// Flat list of all crops for search
const ALL_CROPS = CROP_CATEGORIES.filter(c => c.key !== 'all').flatMap(c => c.crops);
CROP_CATEGORIES[0].crops = ALL_CROPS;

// ── AnimCard ──────────────────────────────────────────────────────────────────
function AnimCard({ delay = 0, style, children }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 400, delay, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[style, {
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
    }]}>
      {children}
    </Animated.View>
  );
}

// ── LiveDot — pulsing dot for LIVE badge ─────────────────────────────────────
function LiveDot() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return <Animated.View style={[M.liveDot, { opacity: pulse }]} />;
}

// ── CropPickerModal ───────────────────────────────────────────────────────────
function CropPickerModal({ visible, selected, onSelect, onClose, t }) {
  const insets        = useSafeAreaInsets();
  const slideAnim     = useRef(new Animated.Value(H)).current;
  const backdropAnim  = useRef(new Animated.Value(0)).current;
  const [query, setQuery]   = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    if (visible) {
      setQuery('');
      setActiveCategory('all');
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: H, duration: 280, useNativeDriver: true }),
        Animated.timing(backdropAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const category = CROP_CATEGORIES.find(c => c.key === activeCategory) || CROP_CATEGORIES[0];
  const filtered = useMemo(() => {
    const base = category.crops;
    if (!query.trim()) return base;
    const q = query.toLowerCase();
    return base.filter(c => c.toLowerCase().includes(q));
  }, [query, activeCategory]);

  const renderCrop = ({ item }) => {
    const isSelected = item === selected;
    return (
      <Pressable
        style={[M.cropTile, isSelected && M.cropTileActive]}
        onPress={() => { onSelect(item); onClose(); }}
      >
        {isSelected && (
          <View style={M.cropTileCheck}>
            {/* GAP: KICON has no 9 step (xs is 12) — left raw so the 16px check
                puck keeps its glyph proportion. */}
            <Ionicons name="checkmark" size={9} color={COLORS.white} />
          </View>
        )}
        <PhotoIcon set="crop" name={item} size={60} radius={10}
                        fallback={<CropIcon crop={item} size={60} />} />
        <Text style={[M.cropTileText, isSelected && M.cropTileTextActive]} numberOfLines={2}>
          {item}
        </Text>
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      {/* Backdrop */}
      <Animated.View style={[M.modalBackdrop, { opacity: backdropAnim }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[M.modalSheet, { transform: [{ translateY: slideAnim }], paddingBottom: insets.bottom + KSPACE.s16 }]}
      >
        {/* Handle */}
        <View style={M.modalHandle} />

        {/* Title row */}
        <View style={M.modalTitleRow}>
          <Text style={M.modalTitle}>{t('market.selectCrop', 'Select Crop')}</Text>
          <Pressable style={M.modalClose} onPress={onClose}>
            <Ionicons name="close" size={KICON.md} color={SLATE} />
          </Pressable>
        </View>

        {/* Search input */}
        <View style={M.searchBox}>
          <Ionicons name="search" size={KICON.base} color={COLORS.textMedium} />
          <TextInput
            style={M.searchInput}
            placeholder={t('market.searchCrops', 'Search crops…')}
            // A11Y: was COLORS.textLight #A8A29E — 2.41:1 on the #F8FAFC search
            // field, the worst pairing on the screen. mutedForeground is 5.68:1.
            placeholderTextColor={KHET.mutedForeground}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={KICON.base} color={COLORS.textDisabled} />
            </Pressable>
          )}
        </View>

        {/* Category filter */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={M.catScroll}
          style={{ flexGrow: 0 }}
        >
          {CROP_CATEGORIES.map(cat => {
            const active = cat.key === activeCategory;
            return (
              <Pressable
                key={cat.key}
                style={[M.catChip, active && { backgroundColor: cat.color, borderColor: cat.color }]}
                onPress={() => setActiveCategory(cat.key)}
              >
                <Ionicons name={cat.icon + '-outline'} size={KICON.sm} color={active ? COLORS.white : COLORS.textMedium} />
                <Text style={[M.catChipText, active && { color: COLORS.white }]} numberOfLines={1}>{t('market.cat_' + cat.key, cat.label)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Results count */}
        <Text style={M.resultsCount}>{t('market.cropsCount', { count: filtered.length })}</Text>

        {/* Crop grid */}
        <FlatList
          windowSize={7}
          maxToRenderPerBatch={18}
          data={filtered}
          keyExtractor={item => item}
          renderItem={renderCrop}
          numColumns={3}
          columnWrapperStyle={{ gap: KSPACE.s10 }}
          contentContainerStyle={M.cropGrid}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: KSPACE.s40, gap: KSPACE.s8 }}>
              {/* GAP: KICON jumps 24 → 48, so this empty-state glyph stays raw. */}
              <Ionicons name="leaf-outline" size={36} color={COLORS.textDisabled} />
              <Text style={{ color: COLORS.textMedium, fontSize: 13 }}>{t('market.noCropsFound', 'No crops found')}</Text>
            </View>
          }
        />
      </Animated.View>
    </Modal>
  );
}

// ── StatPill ──────────────────────────────────────────────────────────────────
function StatPill({ label, value, color }) {
  return (
    <View style={[M.statPill, { borderColor: withAlpha(color, '30') }]}>
      <Text style={[M.statPillLabel, { color }]}>{label}</Text>
      <Text style={[M.statPillValue, { color }]}>{value}</Text>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function MarketScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { t, language }  = useLanguage();
  const { coords: gpsCoords } = useLocation();

  // ── Filters ──
  const [selectedCrop, setSelectedCrop]         = useState(DEFAULT_CROP);
  const [selectedState, setSelectedState]       = useState('Maharashtra');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [pickerVisible, setPickerVisible]       = useState(false);
  const [showStateMenu, setShowStateMenu]       = useState(false);

  // ── Districts dropdown ──
  const [districts, setDistricts]               = useState(() => getDistricts('Maharashtra'));
  const [showDistrictMenu, setShowDistrictMenu] = useState(false);

  // ── GPS location detection ──
  const [locationDetecting, setLocationDetecting] = useState(false);
  const [detectedCity, setDetectedCity]           = useState(null);

  // ── Real mandi prices (data.gov.in) ──
  const [mandiPrices, setMandiPrices]   = useState([]);
  const [mandiLoading, setMandiLoading] = useState(false);
  const [mandiError, setMandiError]     = useState(null);
  const [mandiStale, setMandiStale]     = useState(false);
  const [mandiUpdatedAt, setMandiUpdatedAt] = useState(null);

  const contentAnim = useRef(new Animated.Value(0)).current;

  // ── On mount: auto-detect location from global GPS context ──
  useEffect(() => {
    (async () => {
      setLocationDetecting(true);
      try {
        if (gpsCoords) {
          const geo = await Location.reverseGeocodeAsync(
            { latitude: gpsCoords.latitude, longitude: gpsCoords.longitude },
          );
          if (geo?.length) {
            const place = geo[0];
            const rawState    = place.region || '';
            const rawDistrict = place.subregion || place.city || '';
            const mappedState = STATE_GPS_MAP[rawState.trim()] || rawState.trim() || 'Maharashtra';
            const supportedState = INDIA_STATES_LIST.includes(mappedState) ? mappedState : 'Maharashtra';
            // Expo returns subregion as e.g. "Pune Division" / "Mumbai City District".
            // data.gov.in and our static district list use the bare name ("Pune").
            // Strip the administrative-tier suffix and only keep it if it matches a known district.
            const stripped = rawDistrict.replace(/\s+(Division|District|Taluka|Tehsil|Mandal)\s*$/i, '').trim();
            const supportedDistricts = getDistricts(supportedState);
            const matchedDistrict = supportedDistricts.find(d => d.toLowerCase() === stripped.toLowerCase()) || '';
            setSelectedState(supportedState);
            setSelectedDistrict(matchedDistrict);
            setDetectedCity(place.city || stripped || null);
            loadMandiPrices(DEFAULT_CROP, supportedState, matchedDistrict);
            return;
          }
        }
      } catch { /* fall through to default */ }
      finally { setLocationDetecting(false); }
      loadMandiPrices(DEFAULT_CROP, 'Maharashtra', '');
    })();
  }, [gpsCoords]);

  // ── Load districts whenever state changes — instant from static list ──
  useEffect(() => {
    setDistricts(getDistricts(selectedState));
    setSelectedDistrict('');
  }, [selectedState]);

  // ── Load real mandi prices from data.gov.in ──────────────────────────────
  const loadMandiPrices = async (crop = selectedCrop, state = selectedState, district = selectedDistrict) => {
    setMandiLoading(true);
    setMandiError(null);
    setMandiPrices([]);
    try {
      // getMandiPrices now returns { prices, isStale, fetchedAt, … } lifted off
      // the response META envelope. `result.stale` (no `is`) never existed on any
      // envelope level, so the staleness UI below has never once rendered.
      const result = await getMandiPrices(crop, state, district || null);
      const prices = Array.isArray(result?.prices) ? result.prices : [];
      const sorted = [...prices].sort((a, b) => (b.modalPrice || 0) - (a.modalPrice || 0));
      setMandiPrices(sorted);
      setMandiStale(result?.isStale === true);
      setMandiUpdatedAt(result?.fetchedAt || null);
      contentAnim.setValue(0);
      Animated.timing(contentAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    } catch (err) {
      if (err?.response?.status === 404) {
        // No data for this combination — show the "no mandi data" empty state, not an error banner
        setMandiPrices([]);
      } else {
        setMandiError(t('market.loadError', 'Failed to load mandi prices. Check your connection and try again.'));
      }
    } finally {
      setMandiLoading(false);
    }
  };

  // ── Crop change: reload mandi prices ──────────────────────────────────────
  const handleSelectCrop = (crop) => {
    setSelectedCrop(crop);
    loadMandiPrices(crop, selectedState, selectedDistrict);
  };

  // Derived stats from real mandi data
  const topPrice     = mandiPrices[0]?.modalPrice   || null;
  const lowestPrice  = mandiPrices.length ? mandiPrices[mandiPrices.length - 1]?.modalPrice : null;
  const avgModal     = mandiPrices.length
    ? Math.round(mandiPrices.reduce((s, r) => s + (r.modalPrice || 0), 0) / mandiPrices.length)
    : null;

  return (
    <AnimatedScreen>
    <View style={[M.root]}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.surface} />

      {/* ── Header ── */}
      <View style={[M.header, { paddingTop: insets.top + KSPACE.s8 }]}>
        <Pressable onPress={() => navigation.goBack()} style={M.backBtn}>
          <Ionicons name="chevron-back" size={KICON.xl} color={SLATE} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={M.headerTitle}>{t('market.title', 'Mandi Bhav')}</Text>
          {locationDetecting
            ? <Text style={M.headerSub}>{t('market.detectingLocation', 'Detecting location…')}</Text>
            : detectedCity
              ? <View style={M.locationRow}>
                  {/* GAP: KICON starts at 12 (xs); 10 left raw. */}
                  <Ionicons name="location" size={10} color={COLORS.primary} />
                  <Text style={M.locationText}>{t('market.near', { city: detectedCity })}</Text>
                </View>
              : <Text style={M.headerSub}>{t('market.realDataSource', 'Real data · data.gov.in')}</Text>
          }
        </View>
        {/* The pill must tell the truth about the data behind it. It used to
            render LIVE unconditionally, including over pre-seeded rows several
            days old, because the staleness flag never reached this screen. */}
        {mandiStale ? (
          <View style={M.cachedPill}>
            <Ionicons name="time-outline" size={KICON.xs} color={AMBER} />
            <Text style={M.cachedTxt}>{t('market.cached', 'CACHED')}</Text>
          </View>
        ) : (
          <View style={M.livePill}>
            <LiveDot />
            <Text style={M.liveTxt}>{t('market.live', 'LIVE')}</Text>
          </View>
        )}
      </View>

      {/* ── Crop selector ── */}
      <Pressable style={M.cropSelector} onPress={() => setPickerVisible(true)}>
        <View style={M.cropSelectorLeft}>
          <View style={M.cropSelectorIcon}>
            <CropIcon crop={selectedCrop} size={38} />
          </View>
          <View>
            <Text style={M.cropSelectorLabel}>{t('market.selectedCrop', 'Selected Crop')}</Text>
            <Text style={M.cropSelectorName}>{selectedCrop}</Text>
          </View>
        </View>
        <View style={M.cropSelectorRight}>
          <Text style={M.cropSelectorHint}>{t('market.tapToChange', 'Tap to change')}</Text>
          <View style={M.cropSelectorChevron}>
            <Ionicons name="chevron-down" size={KICON.sm} color={COLORS.primary} />
          </View>
        </View>
      </Pressable>

      {/* ── State + District filter row ── */}
      <View style={M.filterRow}>
        {/* State picker */}
        <Pressable style={M.stateBtn} onPress={() => { setShowStateMenu(v => !v); setShowDistrictMenu(false); }}>
          <Ionicons name="map-outline" size={KICON.xs} color={COLORS.primary} />
          <Text style={M.stateBtnTxt} numberOfLines={1}>{selectedState}</Text>
          <Ionicons name="chevron-down" size={KICON.xs} color={COLORS.textMedium} />
        </Pressable>

        {/* District dropdown button */}
        <Pressable
          style={M.districtBtn}
          onPress={() => { setShowDistrictMenu(v => !v); setShowStateMenu(false); }}
        >
            <Ionicons name="location-outline" size={KICON.xs} color={selectedDistrict ? COLORS.primary : COLORS.textMedium} />
          <Text
            style={[M.districtBtnTxt, selectedDistrict && { color: SLATE, fontWeight: '700' }]}
            numberOfLines={1}
          >
            {selectedDistrict || t('market.allDistricts', 'All Districts')}
          </Text>
          <View style={{ flexDirection: 'row', gap: KSPACE.s2 }}>
            {selectedDistrict.length > 0 && (
              <Pressable onPress={() => {
                setSelectedDistrict('');
                loadMandiPrices(selectedCrop, selectedState, '');
              }} hitSlop={8}>
                {/* GAP: 13 sits between KICON.xs (12) and sm (14). */}
                <Ionicons name="close-circle" size={13} color={COLORS.textDisabled} />
              </Pressable>
            )}
            <Ionicons name="chevron-down" size={KICON.xs} color={COLORS.textMedium} />
          </View>
        </Pressable>

        {/* Search / Predict button */}
        <Pressable
          style={({ pressed }) => [M.searchBtn, pressed && { opacity: 0.85 }]}
          onPress={() => {
            setShowStateMenu(false);
            setShowDistrictMenu(false);
            loadMandiPrices(selectedCrop, selectedState, selectedDistrict);
          }}
        >
          {/* GAP: 15 sits between KICON.sm (14) and base (16). */}
          <Ionicons name="analytics-outline" size={15} color={COLORS.white} />
        </Pressable>
      </View>

      {/* State dropdown */}
      {showStateMenu && (
        <View style={M.stateDropdown}>
          <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
            {STATES.map(s => (
              <Pressable
                key={s}
                style={M.stateItem}
                onPress={() => {
                  setSelectedState(s);
                  setSelectedDistrict('');
                  setShowStateMenu(false);
                  loadMandiPrices(selectedCrop, s, '');
                }}
              >
                <Text style={[M.stateItemTxt, s === selectedState && { color: COLORS.primary, fontWeight: '800' }]}>{s}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* District dropdown */}
      {showDistrictMenu && (
        <View style={M.stateDropdown}>
          <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
            {/* "All Districts" option */}
            <Pressable
              style={M.stateItem}
              onPress={() => {
                setSelectedDistrict('');
                setShowDistrictMenu(false);
                loadMandiPrices(selectedCrop, selectedState, '');
              }}
            >
              <Text style={[M.stateItemTxt, !selectedDistrict && { color: COLORS.primary, fontWeight: '800' }]}>
                {t('market.allDistricts', 'All Districts')}
              </Text>
            </Pressable>
            {districts.length > 0
              ? districts.map(d => (
                <Pressable
                  key={d}
                  style={M.stateItem}
                  onPress={() => {
                    setSelectedDistrict(d);
                    setShowDistrictMenu(false);
                    loadMandiPrices(selectedCrop, selectedState, d);
                  }}
                >
                  <Text style={[M.stateItemTxt, d === selectedDistrict && { color: COLORS.primary, fontWeight: '800' }]}>{d}</Text>
                </Pressable>
              ))
              : (
                <View style={{ padding: KSPACE.s12 }}>
                  <Text style={{ fontSize: 12, color: COLORS.textMedium, textAlign: 'center' }}>
                    {t('market.noDistricts', { state: selectedState })}
                  </Text>
                </View>
              )
            }
          </ScrollView>
        </View>
      )}

      {/* ── Main scroll ── */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={M.scrollContent}>

        {/* ── Loading real mandi prices ── */}
        {/* Shaped like the price hero + the mandi row card below it, so the
            layout is already the right size when data.gov.in answers. */}
        {mandiLoading && (
          <SkeletonGroup label={t('market.fetchingPrices', { crop: selectedCrop })} style={M.section}>
            <SkeletonBlock w="100%" h={210} r={24} />
            <SkeletonBlock w="45%" h={13} style={{ marginTop: KSPACE.s12, marginBottom: KSPACE.s10 }} />
            <View style={M.mandiCard}>
              {Array.from({ length: 5 }, (_, i) => (
                <View key={i}>
                  <View style={M.mandiRow}>
                    <View style={M.mandiLeft}>
                      <SkeletonBlock w="58%" h={13} />
                      <SkeletonBlock w="40%" h={10} style={{ marginTop: KSPACE.s6 }} />
                    </View>
                    <SkeletonBlock w={82} h={16} />
                  </View>
                  {i < 4 && <View style={M.mandiDiv} />}
                </View>
              ))}
            </View>
          </SkeletonGroup>
        )}

        {/* ── Mandi error ── */}
        {mandiError && !mandiLoading && (
          <View style={M.centered}>
            <View style={M.errorIcon}>
              {/* GAP: KICON jumps 24 → 48. */}
              <Ionicons name="cloud-offline-outline" size={36} color={COLORS.textDisabled} />
            </View>
            <Text style={M.errorTxt}>{mandiError}</Text>
            <Pressable onPress={() => loadMandiPrices()} style={M.retryBtn}>
              <Ionicons name="refresh" size={KICON.sm} color={COLORS.primary} />
              <Text style={M.retryTxt}>{t('market.tryAgain', 'Try Again')}</Text>
            </Pressable>
          </View>
        )}

        {!mandiLoading && !mandiError && mandiPrices.length > 0 && (
          <Animated.View style={{
            opacity: contentAnim,
            transform: [{ translateY: contentAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
          }}>

            {/* ── Stale data warning ── */}
            {mandiStale && (
              <View style={M.staleBar}>
                <Ionicons name="time-outline" size={KICON.xs} color={AMBER} />
                <Text style={M.staleTxt}>
                  {t('market.cachedData', 'Showing cached data (data.gov.in unavailable).')}
                  {mandiUpdatedAt ? ` ${t('market.lastUpdated', { date: new Date(mandiUpdatedAt).toLocaleDateString('en-IN') })}` : ''}
                </Text>
              </View>
            )}

            {/* ── Price summary hero ── */}
            <AnimCard delay={0}>
              <LinearGradient
                colors={[COLORS.greenMint, COLORS.successLight, COLORS.white]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={M.priceHero}
              >
                <View style={M.priceHeroTop}>
                  <View style={M.priceHeroCropBadge}>
                    {/* GAP: 11 sits between KICON.xs (12) and nothing below it. */}
                    <Ionicons name="leaf" size={11} color={COLORS.primary} />
                    <Text style={M.priceHeroCropName}>{selectedCrop}</Text>
                  </View>
                  <View style={M.realDataBadge}>
                    {/* A11Y: was COLORS.skyBright #0EA5E9 — 2.60:1 on #F0F9FF,
                        under the 3:1 floor for a meaningful glyph. Matches its
                        label, which had the same failure. */}
                    <Ionicons name="shield-checkmark" size={10} color={KHET.infoInk} />
                    <Text style={M.realDataBadgeTxt}>{t('market.realData', 'Real Data')}</Text>
                  </View>
                </View>

                <View style={M.priceHeroMid}>
                  <View>
                    <Text style={M.priceHeroRupee}>₹</Text>
                    <Text style={M.priceHeroValue}>{topPrice?.toLocaleString() || '—'}</Text>
                    <Text style={M.priceHeroUnit}>{t('market.topModalPrice', 'top modal price / quintal')}</Text>
                  </View>
                  <View style={M.priceRangeBox}>
                    <Text style={M.priceRangeLabel}>{t('market.rangeAcross', { count: mandiPrices.length })}</Text>
                    <Text style={M.priceRangeVal}>
                      ₹{lowestPrice?.toLocaleString()} – ₹{topPrice?.toLocaleString()}
                    </Text>
                    <Text style={[M.priceRangeAvg, { color: COLORS.primary }]}>
                      {t('market.avg', 'Avg')} ₹{avgModal?.toLocaleString()}
                    </Text>
                  </View>
                </View>

                <View style={M.weekStatRow}>
                  <StatPill label={t('market.highest', 'HIGHEST')} value={`₹${topPrice?.toLocaleString() || '—'}`} color={COLORS.primary} />
                  <View style={M.weekStatDiv} />
                  <StatPill label={t('market.average', 'AVERAGE')} value={`₹${avgModal?.toLocaleString() || '—'}`} color={BLUE} />
                  <View style={M.weekStatDiv} />
                  <StatPill label={t('market.lowest', 'LOWEST')} value={`₹${lowestPrice?.toLocaleString() || '—'}`} color={RED} />
                  <View style={M.weekStatDiv} />
                  <StatPill label={t('market.mandis', 'MANDIS')} value={`${mandiPrices.length}`} color={PURPLE} />
                </View>
              </LinearGradient>
            </AnimCard>

            {/* ── Real Mandi price cards ── */}
            <AnimCard delay={60} style={M.section}>
              <View style={M.sectionHeader}>
                <View style={[M.cardDot, { backgroundColor: BLUE }]} />
                <Text style={M.cardTitle}>{t('market.liveMandiPrices', 'Live Mandi Prices')}</Text>
                <View style={M.sourceBadge}>
                  <Text style={M.sourceBadgeText}>data.gov.in</Text>
                </View>
              </View>
              <View style={M.mandiCard}>
                {mandiPrices.map((item, i, arr) => {
                  const rawDate = item.arrivalDate || item.priceDate;
                  const reportDate = rawDate ? new Date(rawDate) : null;
                  const ageDays = reportDate
                    ? Math.floor((Date.now() - reportDate.getTime()) / (24 * 60 * 60 * 1000))
                    : null;
                  const isStaleRow = ageDays != null && ageDays >= 1;
                  let dateLabel = null;
                  if (reportDate) {
                    const dayMonth = reportDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                    if (ageDays <= 0)      dateLabel = dayMonth;
                    else if (ageDays === 1) dateLabel = `${t('market.yesterday', 'Yesterday')} · ${dayMonth}`;
                    else                    dateLabel = `${t('market.daysAgo', { count: ageDays })} · ${dayMonth}`;
                  }
                  return (
                    <View key={i}>
                      <View style={[M.mandiRow, i === 0 && M.mandiRowTop]}>
                        <View style={M.mandiLeft}>
                          <View style={M.mandiNameRow}>
                            <Text style={M.mandiName} numberOfLines={1}>{item.market || item.mandi}</Text>
                            {i === 0 && (
                              <View style={M.mandiNearestBadge}>
                                <Text style={M.mandiNearestText}>{t('market.highestBadge', 'Highest')}</Text>
                              </View>
                            )}
                          </View>
                          <Text style={M.mandiDist}>{item.district}{item.state ? `, ${item.state}` : ''}</Text>
                          {dateLabel ? (
                            <Text style={[M.mandiDist, { marginTop: KSPACE.s1 }, isStaleRow && { color: COLORS.textMedium, fontStyle: 'italic' }]}>
                              {dateLabel}
                            </Text>
                          ) : null}
                        </View>
                        <View style={M.mandiRight}>
                          <Text style={[M.mandiPrice, isStaleRow && { color: COLORS.textMedium }]}>
                            ₹{(item.modalPrice || item.price)?.toLocaleString()}
                          </Text>
                          {item.minPrice != null && item.maxPrice != null && (
                            <Text style={M.mandiRange}>
                              ₹{item.minPrice?.toLocaleString()} – ₹{item.maxPrice?.toLocaleString()}
                            </Text>
                          )}
                        </View>
                      </View>
                      {i < arr.length - 1 && <View style={M.mandiDiv} />}
                    </View>
                  );
                })}
              </View>
            </AnimCard>
          </Animated.View>
        )}

        {/* No mandi data */}
        {!mandiLoading && !mandiError && mandiPrices.length === 0 && (
          <View style={M.centered}>
            <Ionicons name="storefront-outline" size={KICON.hero} color={COLORS.textDisabled} />
            <Text style={[M.loadingTxt, { color: SLATE }]}>{t('market.noData', 'No mandi data found')}</Text>
            <Text style={[M.loadingTxt, { fontSize: 12 }]}>
              {t('market.tryDifferent', 'Try a different state or district.')}
            </Text>
            <Pressable onPress={() => loadMandiPrices()} style={M.retryBtn}>
              <Ionicons name="refresh" size={KICON.sm} color={COLORS.primary} />
              <Text style={M.retryTxt}>{t('market.refresh', 'Refresh')}</Text>
            </Pressable>
          </View>
        )}

        {/* ── Ask FarmMind ── */}
        {mandiPrices.length > 0 && (
          <View style={[M.section, { marginTop: KSPACE.s4 }]}>
            <Pressable
              style={({ pressed }) => [M.askBtn, pressed && { opacity: 0.88 }]}
              onPress={() => navigation.navigate('AIChat', {
                initialMessage: `What's the best time to sell my ${selectedCrop} in ${selectedState}?`,
              })}
            >
              <LinearGradient
                colors={[COLORS.primary, COLORS.greenDark2]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={M.askBtnGradient}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={KICON.md} color={COLORS.white} />
                <Text style={M.askBtnText}>{t('market.askKrushiAbout', { crop: selectedCrop })}</Text>
                <Ionicons name="arrow-forward" size={KICON.base} color={withAlpha(KHET.white, 0.7)} />
              </LinearGradient>
            </Pressable>
          </View>
        )}

      </ScrollView>

      {/* ── Crop Picker Modal ── */}
      <CropPickerModal
        visible={pickerVisible}
        selected={selectedCrop}
        onSelect={handleSelectCrop}
        onClose={() => setPickerVisible(false)}
        t={t}
      />
    </View>
    </AnimatedScreen>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
// State & district data — imported from global constants (src/constants/indiaLocations.js)
const STATES = INDIA_STATES_LIST; // alias for dropdown
// ── Styles ────────────────────────────────────────────────────────────────────
const M = StyleSheet.create({
  root:          { flex: 1, backgroundColor: COLORS.background },
  // GAP: 60 sits between KSPACE.s48 and s64.
  scrollContent: { paddingBottom: 60 },

  // ── Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s10,
    paddingHorizontal: KGUTTER.base, paddingBottom: KSPACE.s12,
    backgroundColor: COLORS.surface,
    borderBottomWidth: KBORDER.hairline, borderBottomColor: COLORS.border,
  },
  backBtn:     { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: SLATE },
  headerSub:   { fontSize: 10, color: COLORS.textMedium, marginTop: KSPACE.s1 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s3, marginTop: KSPACE.s2 },
  locationText:{ fontSize: 10, color: COLORS.primary, fontWeight: '600' },
  livePill:    {
    // GAP: gap/paddingVertical 5 sits between KSPACE.s4 and s6.
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.greenMint, borderRadius: KRADIUS.r20,
    paddingHorizontal: KSPACE.s10, paddingVertical: 5,
    borderWidth: KBORDER.hairline, borderColor: COLORS.greenMint300,
  },
  liveDot: { ...circle(6), backgroundColor: COLORS.primary },
  liveTxt: { fontSize: 10, fontWeight: '800', color: COLORS.primary },
  // Same geometry as livePill so the header doesn't reflow when the freshness
  // of the data changes; only the tint and the word differ.
  cachedPill:  {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.yellowPale, borderRadius: KRADIUS.r20,
    paddingHorizontal: KSPACE.s10, paddingVertical: 5,
    borderWidth: KBORDER.hairline, borderColor: COLORS.goldLight,
  },
  cachedTxt: { fontSize: 10, fontWeight: '800', color: COLORS.brownDeep },

  // ── Crop selector button
  cropSelector: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    marginHorizontal: KGUTTER.base, marginTop: KSPACE.s12, marginBottom: KSPACE.s4,
    borderRadius: KRADIUS.r16, padding: KSPACE.s14,
    borderWidth: KBORDER.hairline, borderColor: COLORS.border,
    // GAP: no KELEV tier matches. e1/e2 are #0e3a20 with a Y offset; this is
    // pure #000 with none. Swapping would recolour and shift every card shadow.
    shadowColor: COLORS.black, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  // RESPONSIVE: both halves of this space-between row were flexShrink 0 (RN's
  // default), so at ~130% OS text size the "Tap to change" side is pushed
  // outside the card. flexShrink only engages once content exceeds the box, so
  // this is a no-op at 100%.
  cropSelectorLeft:    { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s12, flexShrink: 1 },
  cropSelectorIcon:    { width: 46, height: 46, borderRadius: KRADIUS.r14, backgroundColor: COLORS.greenMint, justifyContent: 'center', alignItems: 'center', borderWidth: KBORDER.hairline, borderColor: COLORS.greenMint300, overflow: 'hidden' },
  cropSelectorLabel:   { fontSize: 10, color: COLORS.textMedium, fontWeight: '600', marginBottom: KSPACE.s2 },
  cropSelectorName:    { fontSize: 16, fontWeight: '800', color: SLATE },
  cropSelectorRight:   { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s6, flexShrink: 1 },
  cropSelectorHint:    { fontSize: 11, color: COLORS.textMedium },
  // GAP: radius 8 sits between KRADIUS.r4 and r10.
  cropSelectorChevron: { width: 28, height: 28, borderRadius: 8, backgroundColor: COLORS.greenMint, justifyContent: 'center', alignItems: 'center' },

  // ── Crop picker modal
  // GAP: pure-black scrim. withAlpha(KHET.foreground, 0.5) is rgba(6,33,13,.5),
  // a green-tinted scrim — not the same colour.
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet:    {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: COLORS.surface,
    // GAP: 24 sits between KRADIUS.r20 and r28.
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: H * 0.85,
    // GAP: no KELEV tier — and none casts upward. e3Up is the sheet tier but is
    // offset -6/opacity .14 plus a hairline top border, not this.
    shadowColor: COLORS.black, shadowOpacity: 0.2, shadowRadius: 20, elevation: 20,
  },
  // GAP: radius 2 is below KRADIUS.r4.
  modalHandle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.textDisabled, alignSelf: 'center', marginTop: KSPACE.s12, marginBottom: KSPACE.s4 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: KSPACE.s20, paddingVertical: KSPACE.s12 },
  modalTitle:    { fontSize: 17, fontWeight: '800', color: SLATE },
  modalClose:    { ...circle(32), backgroundColor: COLORS.slateBg, justifyContent: 'center', alignItems: 'center' },
  searchBox:     {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s10,
    marginHorizontal: KGUTTER.base, marginBottom: KSPACE.s12,
    backgroundColor: COLORS.slate50, borderRadius: KRADIUS.r14,
    // GAP: paddingVertical 11 sits between KSPACE.s10 and s12.
    paddingHorizontal: KSPACE.s14, paddingVertical: 11,
    borderWidth: KBORDER.chip, borderColor: COLORS.border,
  },
  searchInput:   { flex: 1, fontSize: 14, color: SLATE, padding: KSPACE.s0 },
  catScroll:     { paddingHorizontal: KGUTTER.base, gap: KSPACE.s8, paddingVertical: KSPACE.s6 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s6,
    paddingHorizontal: KSPACE.s14, paddingVertical: KSPACE.s8, minHeight: 34,
    // GAP: radius 17 sits between KRADIUS.r16 and r18.
    borderRadius: 17, borderWidth: KBORDER.hairline, borderColor: COLORS.border,
    backgroundColor: COLORS.slate50,
  },
  catChipText:   { fontSize: 13, color: COLORS.textMedium, fontWeight: '600' },
  resultsCount:  { fontSize: 11, color: COLORS.textMedium, paddingHorizontal: KSPACE.s20, marginTop: KSPACE.s8, marginBottom: KSPACE.s4, fontWeight: '600' },
  cropGrid:      { paddingHorizontal: KGUTTER.base, paddingTop: KSPACE.s6, paddingBottom: KSPACE.s20, gap: KSPACE.s10 },
  cropTile: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: KRADIUS.r16, borderWidth: KBORDER.hairline, borderColor: COLORS.border,
    paddingVertical: KSPACE.s12, paddingHorizontal: KSPACE.s6,
    minHeight: 114, gap: KSPACE.s6,
    // GAP: no KELEV tier matches.
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  cropTileActive: { backgroundColor: COLORS.greenMint, borderColor: COLORS.primary },
  cropTileText:   { fontSize: 12, color: SLATE, fontWeight: '600', textAlign: 'center' },
  cropTileTextActive: { color: COLORS.primary, fontWeight: '800' },
  // GAP: top/right 5 sits between KSPACE.s4 and s6.
  cropTileCheck:  { position: 'absolute', top: 5, right: 5, ...circle(16), backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },

  // ── Cards
  // NOT circle(): 7x7 with radius 4 is not w === h === 2r, so circle(7) would
  // round it to 3.5 and change the shape. Left exactly as authored.
  cardDot:        { width: 7, height: 7, borderRadius: KRADIUS.r4 },
  // RESPONSIVE: every child of `sectionHeader` was flexShrink 0, so the title
  // and the "data.gov.in" badge overflow the card at large text sizes.
  cardTitle:      { fontSize: 13, fontWeight: '700', color: SLATE, flexShrink: 1 },

  // ── Stale data warning bar
  staleBar: {
    // GAP: gap 7 sits between KSPACE.s6 and s8.
    flexDirection: 'row', alignItems: 'center', gap: 7,
    marginHorizontal: CARD_MARGIN, marginBottom: KSPACE.s8,
    backgroundColor: COLORS.yellowPale, borderRadius: KRADIUS.r10,
    borderWidth: KBORDER.hairline, borderColor: COLORS.goldLight, padding: KSPACE.s10,
  },
  staleTxt: { flex: 1, fontSize: 11, color: COLORS.brownDeep, lineHeight: 15 },

  // ── Real data badge + price range
  realDataBadge: {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s4,
    // GAP: radius 8.
    backgroundColor: COLORS.skyBg, borderRadius: 8,
    paddingHorizontal: KSPACE.s8, paddingVertical: KSPACE.s4,
    borderWidth: KBORDER.hairline, borderColor: COLORS.skyBorder,
  },
  // A11Y: was COLORS.skyBright #0EA5E9 on #F0F9FF — 2.60:1. infoInk is 5.41:1.
  realDataBadgeTxt: { fontSize: 9, fontWeight: '800', color: KHET.infoInk },

  // RESPONSIVE: `priceHeroMid` is space-between with both children at
  // flexShrink 0; at ~130% text the range column leaves the hero. The other
  // child is an unstyled inline <View>, so only this half can be fixed without
  // touching JSX — see the report.
  priceRangeBox:   { alignItems: 'flex-end', gap: KSPACE.s3, flexShrink: 1 },
  priceRangeLabel: { fontSize: 9, color: COLORS.textMedium, fontWeight: '600' },
  priceRangeVal:   { fontSize: 12, fontWeight: '800', color: SLATE },
  priceRangeAvg:   { fontSize: 11, fontWeight: '700' },

  // ── Price hero
  priceHero: {
    marginHorizontal: CARD_MARGIN, marginBottom: KSPACE.s12,
    // GAP: radius 24 sits between KRADIUS.r20 and r28.
    borderRadius: 24, padding: KSPACE.s20,
    borderWidth: KBORDER.hairline, borderColor: COLORS.border,
    // GAP: no KELEV tier matches.
    shadowColor: COLORS.black, shadowOpacity: 0.07, shadowRadius: 12, elevation: 3,
    gap: KSPACE.s16,
  },
  priceHeroTop:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // GAP: paddingVertical 5. The scrim IS exactly withAlpha(KHET.white, 0.7).
  priceHeroCropBadge:{ flexDirection: 'row', alignItems: 'center', gap: KSPACE.s6, backgroundColor: withAlpha(KHET.white, 0.7), borderRadius: KRADIUS.r10, paddingHorizontal: KSPACE.s10, paddingVertical: 5, borderWidth: KBORDER.hairline, borderColor: COLORS.greenMint300 },
  priceHeroCropName: { fontSize: 13, fontWeight: '700', color: SLATE },
  priceHeroMid:      { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  priceHeroRupee:    { fontSize: 16, fontWeight: '700', color: COLORS.textMedium, marginTop: KSPACE.s4 },
  priceHeroValue:    { fontSize: 44, fontWeight: '900', color: SLATE, letterSpacing: -1, lineHeight: 50 },
  priceHeroUnit:     { fontSize: 12, color: COLORS.textMedium, marginTop: KSPACE.s4 },

  // Week stats
  weekStatRow: { flexDirection: 'row', backgroundColor: withAlpha(KHET.white, 0.7), borderRadius: KRADIUS.r14, padding: KSPACE.s12, gap: KSPACE.s0 },
  weekStatDiv: { width: 1, backgroundColor: COLORS.border, marginVertical: KSPACE.s2 },
  statPill:    { flex: 1, alignItems: 'center', gap: KSPACE.s4, paddingHorizontal: KSPACE.s6, borderWidth: 0 },
  // A11Y: `opacity: 0.8` was the whole failure here — it dropped all four
  // labels below AA against the hero (HIGHEST 4.07:1, AVERAGE 3.78:1, LOWEST
  // 2.92:1, MANDIS 3.88:1). At full opacity they are 6.28 / 5.53 / 6.36 / 5.48.
  // RESPONSIVE: the pill is `alignItems: 'center'`, so a shrink-wrapped Text
  // holding an unbounded "₹1,23,456" bleeds past the pill into its neighbour at
  // 360dp. alignSelf 'stretch' makes the text box exactly the pill's inner
  // width so it wraps instead; textAlign keeps it centred, so nothing moves at
  // widths where it already fitted.
  statPillLabel:{ fontSize: 8, fontWeight: '700', letterSpacing: 0.5, alignSelf: 'stretch', textAlign: 'center' },
  statPillValue:{ fontSize: 13, fontWeight: '800', alignSelf: 'stretch', textAlign: 'center' },

  // ── Sections
  section:        { marginHorizontal: CARD_MARGIN, marginBottom: KSPACE.s12 },
  sectionHeader:  { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s8, marginBottom: KSPACE.s10 },
  // GAP: radius 6 and paddingHorizontal 7 have no step.
  sourceBadge:    { marginLeft: KSPACE.s4, backgroundColor: COLORS.slateBg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: KSPACE.s3 },
  // A11Y: was COLORS.textMedium #78716C on #F1F5F9 — 4.38:1. mutedForeground
  // is 5.43:1.
  sourceBadgeText:{ fontSize: 9, color: KHET.mutedForeground, fontWeight: '600' },

  // ── Mandi
  // GAP: no KELEV tier matches.
  mandiCard:       { backgroundColor: COLORS.surface, borderRadius: KRADIUS.r16, borderWidth: KBORDER.hairline, borderColor: COLORS.border, overflow: 'hidden', shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  mandiRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: KSPACE.s14 },
  mandiRowTop:     { backgroundColor: COLORS.mintWhite },
  mandiLeft:       { flex: 1 },
  mandiNameRow:    { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s6, marginBottom: KSPACE.s3 },
  mandiName:       { fontSize: 13, fontWeight: '700', color: SLATE, flexShrink: 1 },
  // GAP: radius 6.
  mandiNearestBadge:{ backgroundColor: COLORS.successLight, borderRadius: 6, paddingHorizontal: KSPACE.s6, paddingVertical: KSPACE.s2 },
  mandiNearestText: { fontSize: 8, fontWeight: '800', color: COLORS.primary },
  mandiDist:       { fontSize: 10, color: COLORS.textMedium },
  mandiRight:      { alignItems: 'flex-end', gap: KSPACE.s3 },
  mandiPrice:      { fontSize: 16, fontWeight: '900', color: SLATE },
  mandiRange:      { fontSize: 9, color: COLORS.textMedium },
  mandiDiv:        { height: 1, backgroundColor: COLORS.slateBg, marginHorizontal: KSPACE.s14 },

  // ── Ask button
  // GAP: no KELEV tier — and this shadow is tinted COLORS.primary at 0.3.
  askBtn:           { borderRadius: KRADIUS.r18, overflow: 'hidden', shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4 },
  askBtnGradient:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: KSPACE.s10, paddingVertical: KSPACE.s16, paddingHorizontal: KSPACE.s20 },
  askBtnText:       { fontSize: 14, fontWeight: '800', color: COLORS.white, flex: 1, textAlign: 'center' },

  // ── Filter row (state + district + search button)
  filterRow: {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s8,
    paddingHorizontal: KGUTTER.base, paddingVertical: KSPACE.s8,
    backgroundColor: COLORS.surface,
    borderBottomWidth: KBORDER.hairline, borderBottomColor: COLORS.border,
  },
  stateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s4,
    backgroundColor: COLORS.greenMint, borderRadius: KRADIUS.r10,
    // GAP: paddingVertical 9 sits between KSPACE.s8 and s10.
    paddingHorizontal: KSPACE.s10, paddingVertical: 9,
    borderWidth: KBORDER.hairline, borderColor: COLORS.greenMint300, maxWidth: 130,
  },
  stateBtnTxt: { fontSize: 12, fontWeight: '700', color: SLATE, flex: 1 },
  stateDropdown: {
    position: 'absolute', top: 130, left: KGUTTER.base, right: KGUTTER.base, zIndex: 99,
    backgroundColor: COLORS.surface, borderRadius: KRADIUS.r12,
    borderWidth: KBORDER.hairline, borderColor: COLORS.border,
    // GAP: no KELEV tier matches.
    shadowColor: COLORS.black, shadowOpacity: 0.12, shadowRadius: 10, elevation: 6,
  },
  stateItem: { paddingHorizontal: KSPACE.s16, paddingVertical: KSPACE.s12, borderBottomWidth: KBORDER.hairline, borderBottomColor: COLORS.border },
  stateItemTxt: { fontSize: 13, color: SLATE },
  districtBtn: {
    // GAP: gap 5 and paddingVertical 9.
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.slate50, borderRadius: KRADIUS.r10,
    paddingHorizontal: KSPACE.s10, paddingVertical: 9,
    borderWidth: KBORDER.hairline, borderColor: COLORS.border,
  },
  districtBtnTxt: { flex: 1, fontSize: 12, color: COLORS.textMedium },
  searchBtn: {
    width: 38, height: 38, borderRadius: KRADIUS.r10,
    backgroundColor: COLORS.skyBright,
    justifyContent: 'center', alignItems: 'center',
  },

  // ── States
  // GAP: paddingTop 80 sits between KSPACE.s64 and the tailTab role (100).
  centered:      { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: KSPACE.s14 },
  // A11Y: was COLORS.textMedium #78716C on the #F4F8F1 page — 4.46:1, just
  // under AA. mutedForeground is 5.53:1.
  loadingTxt:    { fontSize: 13, color: KHET.mutedForeground, textAlign: 'center', paddingHorizontal: KSPACE.s32 },
  errorIcon:     { ...circle(64), backgroundColor: COLORS.slate50, justifyContent: 'center', alignItems: 'center' },
  // A11Y: was COLORS.error #EF4444 on #F4F8F1 — 3.50:1. destructiveInk is 6.15:1.
  errorTxt:      { fontSize: 14, color: KHET.destructiveInk, textAlign: 'center', paddingHorizontal: KSPACE.s32 },
  retryBtn:      { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s6, backgroundColor: COLORS.greenMint, borderRadius: KRADIUS.r12, paddingHorizontal: KSPACE.s20, paddingVertical: KSPACE.s10, borderWidth: KBORDER.hairline, borderColor: COLORS.greenMint300 },
  retryTxt:      { fontSize: 13, fontWeight: '700', color: COLORS.primary },
});

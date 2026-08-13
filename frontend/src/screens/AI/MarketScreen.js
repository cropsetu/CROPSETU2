import { COLORS } from '@cropsetu/shared/constants/colors';
import { useRef, useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, FlatList,
  Dimensions, Animated, StatusBar, ActivityIndicator, Pressable,
  Modal, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location'; // reverseGeocodeAsync only
import { useLocation } from '../../context/LocationContext';
import { getMandiPrices } from '../../services/aiApi';
import { INDIA_STATES_LIST, INDIA_DISTRICTS, STATE_GPS_MAP, getDistricts } from '@cropsetu/shared/constants/indiaLocations';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import CropIcon from '@cropsetu/shared/components/CropIcons';
import AnimatedScreen from '@cropsetu/shared/components/ui/AnimatedScreen';
import {
  KHET, KFONT, KSPACE, KGUTTER, KRADIUS, KTYPE, KICON, KBORDER, noLead, circle, withAlpha,
} from '@cropsetu/shared/constants/khetTheme';

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
const GREEN_L= COLORS.mintGreen;
const PURPLE = COLORS.sellerShipped;
const AMBER  = COLORS.amber;
// A11Y: was COLORS.error #EF4444 — 3.62:1 as the LOWEST stat value on the price
// hero and 2.92:1 as its label. destructiveInk is 6.36:1 on the same surface.
const RED    = KHET.destructiveInk;
const BLUE   = COLORS.blue;
const SLATE  = COLORS.textDark;

const CARD_MARGIN  = KGUTTER.base;
const CARD_PADDING = KSPACE.s16;
const CHART_W      = W - CARD_MARGIN * 2 - CARD_PADDING * 2;

const DEFAULT_CROP = 'Tomato';
const PERIODS = [
  { key: '7d',  label: '7D'  },
  { key: '3m',  label: '3M'  },
  { key: '6m',  label: '6M'  },
  { key: '12m', label: '1Y'  },
];

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

// ── Mandi coordinates ─────────────────────────────────────────────────────────
const MANDI_COORDS = {
  'Nashik':                   { lat: 19.9975, lon: 73.7898 },
  'Pune':                     { lat: 18.5204, lon: 73.8567 },
  'Mumbai (Vashi)':           { lat: 19.0760, lon: 72.8777 },
  'Aurangabad':               { lat: 19.8762, lon: 75.3433 },
  'Kolhapur':                 { lat: 16.7050, lon: 74.2433 },
  'Ludhiana':                 { lat: 30.9010, lon: 75.8573 },
  'Amritsar':                 { lat: 31.6340, lon: 74.8723 },
  'Jalandhar':                { lat: 31.3260, lon: 75.5762 },
  'Patiala':                  { lat: 30.3398, lon: 76.3869 },
  'Bathinda':                 { lat: 30.2110, lon: 74.9455 },
  'Lucknow':                  { lat: 26.8467, lon: 80.9462 },
  'Agra':                     { lat: 27.1767, lon: 78.0081 },
  'Kanpur':                   { lat: 26.4499, lon: 80.3319 },
  'Varanasi':                 { lat: 25.3176, lon: 82.9739 },
  'Mathura':                  { lat: 27.4924, lon: 77.6737 },
  'Bangalore (Yeshwanthpur)': { lat: 13.0000, lon: 77.5500 },
  'Hubli':                    { lat: 15.3647, lon: 75.1240 },
  'Mysore':                   { lat: 12.2958, lon: 76.6394 },
  'Davangere':                { lat: 14.4644, lon: 75.9218 },
  'Kurnool':                  { lat: 15.8281, lon: 78.0373 },
  'Guntur':                   { lat: 16.3067, lon: 80.4365 },
  'Ahmedabad':                { lat: 23.0225, lon: 72.5714 },
  'Surat':                    { lat: 21.1702, lon: 72.8311 },
  'Jaipur':                   { lat: 26.9124, lon: 75.7873 },
  'Indore':                   { lat: 22.7196, lon: 75.8577 },
};

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function addDistances(prices, userLat, userLon) {
  return prices.map(p => {
    const name  = p.mandi?.split(' (')[0];
    const coord = MANDI_COORDS[name] || MANDI_COORDS[p.mandi];
    const dist  = coord && userLat ? `${distanceKm(userLat, userLon, coord.lat, coord.lon)} km` : null;
    return { ...p, dist };
  });
}

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
        <CropIcon crop={item} size={60} />
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
              <Text style={{ ...noLead(KTYPE.bodySm), color: COLORS.textMedium }}>{t('market.noCropsFound', 'No crops found')}</Text>
            </View>
          }
        />
      </Animated.View>
    </Modal>
  );
}

// ── SparkLine ─────────────────────────────────────────────────────────────────
function SparkLine({ data, color, days, width: cw = CHART_W, height: ch = 80 }) {
  const revealAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    revealAnim.setValue(0);
    Animated.timing(revealAnim, { toValue: 1, duration: 700, useNativeDriver: true }).start();
  }, [data]);

  if (!data?.length) return null;
  const min   = Math.min(...data);
  const max   = Math.max(...data);
  const range = max - min || 1;
  const pad   = 10;
  const plotH = ch - pad * 2 - 20; // 20 for day labels
  const pts   = data.map((v, i) => ({
    x: pad + (i / (data.length - 1)) * (cw - pad * 2),
    y: pad + (1 - (v - min) / range) * plotH,
  }));

  const maxIdx = data.indexOf(max);

  return (
    <Animated.View style={{ width: cw, height: ch, opacity: revealAnim }}>
      {/* Grid */}
      {[0.25, 0.5, 0.75].map((p, i) => (
        <View key={i} style={{
          position: 'absolute', left: pad, right: pad,
          top: pad + p * plotH, height: 1,
          backgroundColor: 'rgba(0,0,0,0.05)',
        }} />
      ))}
      {/* Line segments */}
      {pts.slice(0, -1).map((p, i) => {
        const next  = pts[i + 1];
        const len   = Math.hypot(next.x - p.x, next.y - p.y);
        const angle = Math.atan2(next.y - p.y, next.x - p.x) * (180 / Math.PI);
        return (
          <View key={i} style={{
            position: 'absolute',
            left: p.x, top: p.y - 1.5,
            width: len, height: 3,
            backgroundColor: color,
            transform: [{ rotate: `${angle}deg` }],
            transformOrigin: '0 50%',
            borderRadius: 2,
          }} />
        );
      })}
      {/* Dots */}
      {pts.map((p, i) => {
        const isBest = i === maxIdx;
        const size   = isBest ? 10 : 6;
        return (
          <View key={i} style={{
            position: 'absolute',
            left: p.x - size / 2, top: p.y - size / 2,
            width: size, height: size, borderRadius: size / 2,
            backgroundColor: isBest ? color : COLORS.surface,
            borderWidth: isBest ? 0 : 2,
            borderColor: color,
            shadowColor: isBest ? color : 'transparent',
            shadowOpacity: 0.4, shadowRadius: 4,
          }} />
        );
      })}
      {/* Peak label */}
      {pts[maxIdx] && (
        <View style={{
          position: 'absolute',
          left: pts[maxIdx].x - 22, top: pts[maxIdx].y - 24,
          backgroundColor: color,
          // GAP: radius 6 and padding 5 have no KRADIUS/KSPACE step.
          borderRadius: 6, paddingHorizontal: 5, paddingVertical: KSPACE.s2,
        }}>
          {/* GAP: KTYPE has no 8px role at any weight. */}
          <Text style={{ fontSize: 8, fontFamily: KFONT.sansExtra, color: COLORS.white }}>
            ₹{(max / 1000).toFixed(1)}k
          </Text>
        </View>
      )}
      {/* Day labels */}
      {(days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']).slice(0, data.length).map((d, i) => (
        // GAP: KTYPE's only 9px role is `badge` (ExtraBold); this is Semibold.
        <Text key={i} style={{
          position: 'absolute',
          left: pts[i].x - 12, top: ch - 16,
          fontSize: 9, fontFamily: KFONT.sansSemi, color: COLORS.textMedium, width: 26, textAlign: 'center',
        }}>{d}</Text>
      ))}
    </Animated.View>
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
      const result = await getMandiPrices(crop, state, district || null);
      const prices = Array.isArray(result) ? result : (result?.prices || result || []);
      const sorted = [...prices].sort((a, b) => (b.modalPrice || 0) - (a.modalPrice || 0));
      setMandiPrices(sorted);
      setMandiStale(result?.stale || false);
      setMandiUpdatedAt(result?.fetchedAt || result?.cachedAt || null);
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
        <View style={M.livePill}>
          <LiveDot />
          <Text style={M.liveTxt}>{t('market.live', 'LIVE')}</Text>
        </View>
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
            // fontWeight → fontFamily: the base style now names a family, and
            // family + fontWeight >= 700 makes Android drop the brand face back
            // to Roboto. sansBold IS the 700 face.
            style={[M.districtBtnTxt, selectedDistrict && { color: SLATE, fontFamily: KFONT.sansBold }]}
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
                <Text style={[M.stateItemTxt, s === selectedState && { color: COLORS.primary, fontFamily: KFONT.sansExtra }]}>{s}</Text>
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
              <Text style={[M.stateItemTxt, !selectedDistrict && { color: COLORS.primary, fontFamily: KFONT.sansExtra }]}>
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
                  <Text style={[M.stateItemTxt, d === selectedDistrict && { color: COLORS.primary, fontFamily: KFONT.sansExtra }]}>{d}</Text>
                </Pressable>
              ))
              : (
                <View style={{ padding: KSPACE.s12 }}>
                  {/* GAP: KTYPE's 12px roles are Medium (caption) and Bold
                      (captionBold); this is Regular. */}
                  <Text style={{ fontSize: 12, fontFamily: KFONT.sans, color: COLORS.textMedium, textAlign: 'center' }}>
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
        {mandiLoading && (
          <View style={M.centered}>
            <View style={M.loadingSpinner}>
              <ActivityIndicator color={COLORS.primary} size="large" />
            </View>
            <Text style={M.loadingTxt}>{t('market.fetchingPrices', { crop: selectedCrop })}</Text>
            <Text style={[M.loadingTxt, { fontSize: 11, marginTop: KSPACE.s4 }]}>{t('market.source', 'Source: data.gov.in')}</Text>
          </View>
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
// INDIA_STATES_LIST, INDIA_DISTRICTS, STATE_GPS_MAP, getDistricts are all available via imports at top of file.
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
  headerTitle: { ...noLead(KTYPE.heading), color: SLATE },
  // GAP: KTYPE's only 10px role is `micro` (Bold); this is Regular.
  headerSub:   { fontSize: 10, fontFamily: KFONT.sans, color: COLORS.textMedium, marginTop: KSPACE.s1 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s3, marginTop: KSPACE.s2 },
  // GAP: 10px Semibold — `micro` is the only 10px role and it is Bold.
  locationText:{ fontSize: 10, fontFamily: KFONT.sansSemi, color: COLORS.primary },
  livePill:    {
    // GAP: gap/paddingVertical 5 sits between KSPACE.s4 and s6.
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.greenMint, borderRadius: KRADIUS.r20,
    paddingHorizontal: KSPACE.s10, paddingVertical: 5,
    borderWidth: KBORDER.hairline, borderColor: COLORS.greenMint300,
  },
  liveDot: { ...circle(6), backgroundColor: COLORS.primary },
  // GAP: 10px ExtraBold — `micro` is Bold.
  liveTxt: { fontSize: 10, fontFamily: KFONT.sansExtra, color: COLORS.primary },

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
  cropSelectorLabel:   { fontSize: 10, fontFamily: KFONT.sansSemi, color: COLORS.textMedium, marginBottom: KSPACE.s2 },
  cropSelectorName:    { ...noLead(KTYPE.subheadingExtra), color: SLATE },
  cropSelectorRight:   { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s6, flexShrink: 1 },
  // GAP: KTYPE's only 11px Regular-weight neighbour is `meta` (Bold).
  cropSelectorHint:    { fontSize: 11, fontFamily: KFONT.sans, color: COLORS.textMedium },
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
  modalTitle:    { ...noLead(KTYPE.heading), color: SLATE },
  modalClose:    { ...circle(32), backgroundColor: COLORS.slateBg, justifyContent: 'center', alignItems: 'center' },
  searchBox:     {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s10,
    marginHorizontal: KGUTTER.base, marginBottom: KSPACE.s12,
    backgroundColor: COLORS.slate50, borderRadius: KRADIUS.r14,
    // GAP: paddingVertical 11 sits between KSPACE.s10 and s12.
    paddingHorizontal: KSPACE.s14, paddingVertical: 11,
    borderWidth: KBORDER.chip, borderColor: COLORS.border,
  },
  searchInput:   { flex: 1, ...noLead(KTYPE.body), color: SLATE, padding: KSPACE.s0 },
  catScroll:     { paddingHorizontal: KGUTTER.base, gap: KSPACE.s8, paddingVertical: KSPACE.s6 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s6,
    paddingHorizontal: KSPACE.s14, paddingVertical: KSPACE.s8, minHeight: 34,
    // GAP: radius 17 sits between KRADIUS.r16 and r18.
    borderRadius: 17, borderWidth: KBORDER.hairline, borderColor: COLORS.border,
    backgroundColor: COLORS.slate50,
  },
  catChipText:   { ...noLead(KTYPE.label), color: COLORS.textMedium },
  // GAP: 11px Semibold — `meta` is the 11px role and it is Bold.
  resultsCount:  { fontSize: 11, fontFamily: KFONT.sansSemi, color: COLORS.textMedium, paddingHorizontal: KSPACE.s20, marginTop: KSPACE.s8, marginBottom: KSPACE.s4 },
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
  // GAP: 12px Semibold — KTYPE runs `caption` (Medium) and `captionBold` (Bold).
  cropTileText:   { fontSize: 12, fontFamily: KFONT.sansSemi, color: SLATE, textAlign: 'center' },
  // fontWeight '800' → the ExtraBold FACE: this override lands on a block that
  // now names a family, and family + weight >= 700 is the Android fallback bug.
  cropTileTextActive: { color: COLORS.primary, fontFamily: KFONT.sansExtra },
  // GAP: top/right 5 sits between KSPACE.s4 and s6.
  cropTileCheck:  { position: 'absolute', top: 5, right: 5, ...circle(16), backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },

  // ── Cards
  card: {
    backgroundColor: COLORS.surface,
    marginHorizontal: CARD_MARGIN, marginBottom: KSPACE.s12,
    borderRadius: KRADIUS.r20, padding: CARD_PADDING,
    borderWidth: KBORDER.hairline, borderColor: COLORS.border,
    // GAP: no KELEV tier matches.
    shadowColor: COLORS.black, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  cardHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: KSPACE.s14 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s8 },
  // NOT circle(): 7x7 with radius 4 is not w === h === 2r, so circle(7) would
  // round it to 3.5 and change the shape. Left exactly as authored.
  cardDot:        { width: 7, height: 7, borderRadius: KRADIUS.r4 },
  // RESPONSIVE: every child of `sectionHeader` was flexShrink 0, so the title
  // and the "data.gov.in" badge overflow the card at large text sizes.
  cardTitle:      { ...noLead(KTYPE.labelBold), color: SLATE, flexShrink: 1 },
  // GAP: radius 8 sits between KRADIUS.r4 and r10.
  trendBadge:     { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s4, borderRadius: 8, borderWidth: KBORDER.hairline, paddingHorizontal: KSPACE.s8, paddingVertical: KSPACE.s4 },
  trendBadgeText: { ...noLead(KTYPE.micro) },

  // ── Stale data warning bar
  staleBar: {
    // GAP: gap 7 sits between KSPACE.s6 and s8.
    flexDirection: 'row', alignItems: 'center', gap: 7,
    marginHorizontal: CARD_MARGIN, marginBottom: KSPACE.s8,
    backgroundColor: COLORS.yellowPale, borderRadius: KRADIUS.r10,
    borderWidth: KBORDER.hairline, borderColor: COLORS.goldLight, padding: KSPACE.s10,
  },
  // GAP: 11px Regular. lineHeight was authored, so it is restated verbatim.
  staleTxt: { flex: 1, fontSize: 11, fontFamily: KFONT.sans, color: COLORS.brownDeep, lineHeight: 15 },

  // ── Real data badge + price range
  realDataBadge: {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s4,
    // GAP: radius 8.
    backgroundColor: COLORS.skyBg, borderRadius: 8,
    paddingHorizontal: KSPACE.s8, paddingVertical: KSPACE.s4,
    borderWidth: KBORDER.hairline, borderColor: COLORS.skyBorder,
  },
  // A11Y: was COLORS.skyBright #0EA5E9 on #F0F9FF — 2.60:1. infoInk is 5.41:1.
  realDataBadgeTxt: { ...noLead(KTYPE.badge), color: KHET.infoInk },

  // RESPONSIVE: `priceHeroMid` is space-between with both children at
  // flexShrink 0; at ~130% text the range column leaves the hero. The other
  // child is an unstyled inline <View>, so only this half can be fixed without
  // touching JSX — see the report.
  priceRangeBox:   { alignItems: 'flex-end', gap: KSPACE.s3, flexShrink: 1 },
  // GAP: KTYPE's only 9px role is `badge` (ExtraBold); this is Semibold.
  priceRangeLabel: { fontSize: 9, fontFamily: KFONT.sansSemi, color: COLORS.textMedium },
  // GAP: 12px ExtraBold — KTYPE stops at `captionBold` (Bold) at this size.
  priceRangeVal:   { fontSize: 12, fontFamily: KFONT.sansExtra, color: SLATE },
  priceRangeAvg:   { ...noLead(KTYPE.meta) },

  // ── Predict prompt button
  predictPromptBtn: {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s12,
    backgroundColor: COLORS.lavenderWhite, borderRadius: KRADIUS.r14,
    borderWidth: KBORDER.chip, borderColor: COLORS.lavender,
    padding: KSPACE.s14,
  },
  // GAP: 14px ExtraBold — `bodyBold` is the heaviest 14px role and it is Bold.
  predictPromptTitle: { fontSize: 14, fontFamily: KFONT.sansExtra, color: PURPLE },
  predictPromptSub:   { fontSize: 11, fontFamily: KFONT.sans, color: COLORS.textMedium, marginTop: KSPACE.s2, lineHeight: 15 },

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
  priceHeroCropName: { ...noLead(KTYPE.labelBold), color: SLATE },
  priceHeroDate:     { fontSize: 11, fontFamily: KFONT.sansSemi, color: COLORS.textMedium },
  priceHeroMid:      { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  priceHeroRupee:    { ...noLead(KTYPE.subheading), color: COLORS.textMedium, marginTop: KSPACE.s4 },
  // KTYPE.figureLg is the 44px role, but its leading (48) and tracking (-1.2)
  // are both authored differently here. Overriding two of a role's four
  // properties is worse than naming the face directly, so this is longhand —
  // same escape hatch DiagnosisResultScreen's `checkText` uses.
  priceHeroValue:    { fontSize: 44, fontFamily: KFONT.displayBold, color: SLATE, letterSpacing: -1, lineHeight: 50 },
  // GAP: 12px Regular — `caption` is Medium.
  priceHeroUnit:     { fontSize: 12, fontFamily: KFONT.sans, color: COLORS.textMedium, marginTop: KSPACE.s4 },
  changeBadge:       { borderRadius: KRADIUS.r16, borderWidth: KBORDER.hairline, padding: KSPACE.s12, alignItems: 'center', gap: KSPACE.s4 },
  // GAP: KTYPE's only 22px role is `displayMd`, a Fraunces SERIF editorial face.
  changePct:         { fontSize: 22, fontFamily: KFONT.sansExtra },
  changeCaption:     { fontSize: 9, fontFamily: KFONT.sansSemi, opacity: 0.8 },

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
  // GAP: KTYPE has no 8px role at any weight.
  statPillLabel:{ fontSize: 8, fontFamily: KFONT.sansBold, letterSpacing: 0.5, alignSelf: 'stretch', textAlign: 'center' },
  statPillValue:{ ...noLead(KTYPE.labelExtra), alignSelf: 'stretch', textAlign: 'center' },

  // ── Insight card
  // GAP: no KELEV tier — and this one is tinted AMBER, which no tier offers.
  insightCard:     { marginHorizontal: CARD_MARGIN, marginBottom: KSPACE.s12, borderRadius: KRADIUS.r18, overflow: 'hidden', borderWidth: KBORDER.hairline, borderColor: COLORS.goldLight, shadowColor: AMBER, shadowOpacity: 0.1, shadowRadius: 8, elevation: 2 },
  insightGradient: { flexDirection: 'row', alignItems: 'flex-start', gap: KSPACE.s12, padding: KSPACE.s16 },
  // GAP: rgba(217,119,6,0.12) is amber-600, which is not a KHET colour.
  insightIconWrap: { width: 36, height: 36, borderRadius: KRADIUS.r10, backgroundColor: 'rgba(217,119,6,0.12)', justifyContent: 'center', alignItems: 'center' },
  // GAP: 9px ExtraBold exists (`badge`) but carries letterSpacing 0.2 against
  // the 1.5 authored here, so the face is named longhand and tracking kept.
  insightLabel:    { fontSize: 9, fontFamily: KFONT.sansExtra, color: AMBER, letterSpacing: 1.5, marginBottom: 5 },
  insightText:     { ...noLead(KTYPE.bodySm), color: COLORS.brownDeep, lineHeight: 19 },

  // ── Sections
  section:        { marginHorizontal: CARD_MARGIN, marginBottom: KSPACE.s12 },
  sectionHeader:  { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s8, marginBottom: KSPACE.s10 },
  // GAP: radius 6 and paddingHorizontal 7 have no step.
  sourceBadge:    { marginLeft: KSPACE.s4, backgroundColor: COLORS.slateBg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: KSPACE.s3 },
  // A11Y: was COLORS.textMedium #78716C on #F1F5F9 — 4.38:1. mutedForeground
  // is 5.43:1.  GAP: 9px Semibold has no role.
  sourceBadgeText:{ fontSize: 9, fontFamily: KFONT.sansSemi, color: KHET.mutedForeground },
  aiBadge:        { marginLeft: KSPACE.s4, flexDirection: 'row', alignItems: 'center', gap: KSPACE.s4, backgroundColor: COLORS.violetPale, borderRadius: 6, paddingHorizontal: 7, paddingVertical: KSPACE.s3, borderWidth: KBORDER.hairline, borderColor: COLORS.lavender },
  // GAP: 9px Bold — `badge` is ExtraBold.
  aiBadgeText:    { fontSize: 9, fontFamily: KFONT.sansBold, color: PURPLE },

  // ── Mandi
  // GAP: no KELEV tier matches.
  mandiCard:       { backgroundColor: COLORS.surface, borderRadius: KRADIUS.r16, borderWidth: KBORDER.hairline, borderColor: COLORS.border, overflow: 'hidden', shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  mandiRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: KSPACE.s14 },
  mandiRowTop:     { backgroundColor: COLORS.mintWhite },
  mandiLeft:       { flex: 1 },
  mandiNameRow:    { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s6, marginBottom: KSPACE.s3 },
  mandiName:       { ...noLead(KTYPE.labelBold), color: SLATE, flexShrink: 1 },
  // GAP: radius 6.
  mandiNearestBadge:{ backgroundColor: COLORS.successLight, borderRadius: 6, paddingHorizontal: KSPACE.s6, paddingVertical: KSPACE.s2 },
  // GAP: KTYPE has no 8px role at any weight.
  mandiNearestText: { fontSize: 8, fontFamily: KFONT.sansExtra, color: COLORS.primary },
  mandiMeta:       { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s3 },
  // GAP: 10px Regular — `micro` is the only 10px role and it is Bold.
  // NOTE: a conditional `fontStyle: 'italic'` override rides on this for stale
  // rows and KFONT loads no italic face, so those rows fall back to the system
  // italic on Android. Flagged rather than reverted — the common case is upright.
  mandiDist:       { fontSize: 10, fontFamily: KFONT.sans, color: COLORS.textMedium },
  mandiRight:      { alignItems: 'flex-end', gap: KSPACE.s3 },
  mandiPrice:      { ...noLead(KTYPE.subheadingExtra), color: SLATE },
  // GAP: 9px Regular — `badge` is ExtraBold.
  mandiRange:      { fontSize: 9, fontFamily: KFONT.sans, color: COLORS.textMedium },
  mandiDiv:        { height: 1, backgroundColor: COLORS.slateBg, marginHorizontal: KSPACE.s14 },
  // GAP: marginTop 5.
  updatedAt:       { fontSize: 9, fontFamily: KFONT.sans, color: COLORS.textMedium, marginTop: 5, marginLeft: KSPACE.s2 },
  reportingNote:   { flexDirection: 'row', alignItems: 'flex-start', gap: KSPACE.s6, marginTop: KSPACE.s10, marginHorizontal: KSPACE.s14, padding: KSPACE.s10, backgroundColor: COLORS.slate50, borderRadius: 8, borderWidth: KBORDER.hairline, borderColor: COLORS.border },
  reportingNoteTxt:{ flex: 1, fontSize: 11, fontFamily: KFONT.sans, color: COLORS.textMedium, lineHeight: 16 },

  // ── Ask button
  // GAP: no KELEV tier — and this shadow is tinted COLORS.primary at 0.3.
  askBtn:           { borderRadius: KRADIUS.r18, overflow: 'hidden', shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4 },
  askBtnGradient:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: KSPACE.s10, paddingVertical: KSPACE.s16, paddingHorizontal: KSPACE.s20 },
  // GAP: 14px ExtraBold — `bodyBold` is the heaviest 14px role and it is Bold.
  askBtnText:       { fontSize: 14, fontFamily: KFONT.sansExtra, color: COLORS.white, flex: 1, textAlign: 'center' },

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
  stateBtnTxt: { ...noLead(KTYPE.captionBold), color: SLATE, flex: 1 },
  stateDropdown: {
    position: 'absolute', top: 130, left: KGUTTER.base, right: KGUTTER.base, zIndex: 99,
    backgroundColor: COLORS.surface, borderRadius: KRADIUS.r12,
    borderWidth: KBORDER.hairline, borderColor: COLORS.border,
    // GAP: no KELEV tier matches.
    shadowColor: COLORS.black, shadowOpacity: 0.12, shadowRadius: 10, elevation: 6,
  },
  stateItem: { paddingHorizontal: KSPACE.s16, paddingVertical: KSPACE.s12, borderBottomWidth: KBORDER.hairline, borderBottomColor: COLORS.border },
  stateItemTxt: { ...noLead(KTYPE.bodySm), color: SLATE },
  districtBtn: {
    // GAP: gap 5 and paddingVertical 9.
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.slate50, borderRadius: KRADIUS.r10,
    paddingHorizontal: KSPACE.s10, paddingVertical: 9,
    borderWidth: KBORDER.hairline, borderColor: COLORS.border,
  },
  // GAP: 12px Regular — `caption` is Medium.
  districtBtnTxt: { flex: 1, fontSize: 12, fontFamily: KFONT.sans, color: COLORS.textMedium },
  searchBtn: {
    width: 38, height: 38, borderRadius: KRADIUS.r10,
    backgroundColor: COLORS.skyBright,
    justifyContent: 'center', alignItems: 'center',
  },

  // ── AgriPredict section
  // NOTE: everything from `agriSyncMsg` to `agriNearbyTrend` is DEAD — the
  // AgriPredict feature was removed and nothing renders these. Migrated anyway
  // so the file holds ONE vocabulary; see the report before deleting them.
  agriSyncMsg:      { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s6, backgroundColor: COLORS.skyBg, borderRadius: KRADIUS.r10, borderWidth: KBORDER.hairline, borderColor: COLORS.skyBorder, padding: KSPACE.s10, marginBottom: KSPACE.s8 },
  agriSyncMsgText:  { flex: 1, fontSize: 12, fontFamily: KFONT.sans, color: COLORS.skyMid, lineHeight: 16 },
  agriErrorBox:     { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s6, backgroundColor: COLORS.blushPink, borderRadius: KRADIUS.r10, borderWidth: KBORDER.hairline, borderColor: COLORS.coralPink, padding: KSPACE.s10, marginBottom: KSPACE.s8 },
  agriErrorText:    { flex: 1, fontSize: 12, fontFamily: KFONT.sans, color: COLORS.crimsonAlt, lineHeight: 16 },
  agriLoadingRow:   { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s8, paddingVertical: KSPACE.s10 },
  agriLoadingTxt:   { fontSize: 12, fontFamily: KFONT.sans, color: COLORS.textMedium },

  agriSummaryRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.slate50, borderRadius: KRADIUS.r12, borderWidth: KBORDER.hairline, borderColor: COLORS.border, padding: KSPACE.s12, marginBottom: KSPACE.s10 },
  agriSummaryItem:  { flex: 1, alignItems: 'center', gap: KSPACE.s3 },
  // GAP: KTYPE has no 8px role at any weight.
  agriSummaryLabel: { fontSize: 8, fontFamily: KFONT.sansBold, color: COLORS.textMedium, letterSpacing: 0.3 },
  agriSummaryVal:   { ...noLead(KTYPE.labelExtra), color: SLATE },
  agriSummaryDiv:   { width: 1, height: 28, backgroundColor: COLORS.border },

  agriChartWrap:  { marginTop: KSPACE.s4, marginBottom: KSPACE.s8 },
  // GAP: `micro` is 10px Bold but tracks 0.4 against the 0.3 authored here.
  agriChartTitle: { fontSize: 10, fontFamily: KFONT.sansBold, color: COLORS.textMedium, marginBottom: KSPACE.s8, letterSpacing: 0.3 },

  // Prediction box
  agriPredBox:    { backgroundColor: COLORS.slate50, borderRadius: KRADIUS.r14, borderWidth: KBORDER.hairline, borderColor: COLORS.skyTint, padding: KSPACE.s14, gap: KSPACE.s10, marginTop: KSPACE.s8 },
  agriCachePill:  { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s4, alignSelf: 'flex-start', backgroundColor: COLORS.white, borderRadius: 8, paddingHorizontal: KSPACE.s8, paddingVertical: KSPACE.s4, borderWidth: KBORDER.hairline, borderColor: COLORS.border },
  // GAP: 9px Bold — `badge` is ExtraBold.
  agriCacheText:  { fontSize: 9, fontFamily: KFONT.sansBold },
  agriRangeRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: KRADIUS.r12, borderWidth: KBORDER.hairline, borderColor: COLORS.border, padding: KSPACE.s12 },
  agriRangeItem:  { flex: 1, alignItems: 'center', gap: KSPACE.s3 },
  agriRangeLabel: { fontSize: 8, fontFamily: KFONT.sansSemi, color: COLORS.textMedium },
  agriRangeVal:   { ...noLead(KTYPE.subheadExtra), color: SLATE },
  agriConfBadge:  { paddingHorizontal: KSPACE.s8, paddingVertical: KSPACE.s6, borderRadius: 8, borderWidth: KBORDER.hairline, alignItems: 'center', gap: KSPACE.s1 },
  // GAP: 11px ExtraBold exists (`eyebrow`) but tracks 1; this tracks none.
  agriConfText:   { fontSize: 11, fontFamily: KFONT.sansExtra },
  // GAP: KTYPE's smallest role is 9px (`badge`); there is no 7px step.
  agriConfSub:    { fontSize: 7, fontFamily: KFONT.sansBold },
  agriTrendRow:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  agriTrendText:  { ...noLead(KTYPE.labelBold) },
  agriInsightBox: { flexDirection: 'row', alignItems: 'flex-start', gap: KSPACE.s6, backgroundColor: COLORS.yellowPale, borderRadius: KRADIUS.r10, borderWidth: KBORDER.hairline, borderColor: COLORS.goldLight, padding: KSPACE.s10 },
  agriInsightText:{ flex: 1, fontSize: 12, fontFamily: KFONT.sans, color: COLORS.brownDeep, lineHeight: 17 },
  agriFactorChip: { backgroundColor: COLORS.skyBg, borderRadius: 8, paddingHorizontal: KSPACE.s8, paddingVertical: KSPACE.s4, borderWidth: KBORDER.hairline, borderColor: COLORS.skyBorder },
  agriFactorText: { fontSize: 10, fontFamily: KFONT.sansSemi, color: COLORS.skyMid },
  agriRecoBox:    { flexDirection: 'row', alignItems: 'flex-start', gap: KSPACE.s6, backgroundColor: COLORS.greenMint, borderRadius: KRADIUS.r10, borderWidth: KBORDER.hairline, borderColor: COLORS.greenMint300, padding: KSPACE.s10 },
  agriRecoText:   { flex: 1, fontSize: 12, fontFamily: KFONT.sansSemi, color: COLORS.darkGreen, lineHeight: 17 },

  // Nearby markets
  agriNearbyWrap:       { marginTop: KSPACE.s10 },
  agriNearbyTitle:      { ...noLead(KTYPE.meta), color: SLATE, marginBottom: KSPACE.s8 },
  agriNearbyRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: KSPACE.s8, gap: KSPACE.s8 },
  agriNearbyRowBorder:  { borderBottomWidth: KBORDER.hairline, borderBottomColor: COLORS.border },
  agriNearbyDistrict:   { flex: 1, ...noLead(KTYPE.label), color: SLATE },
  // GAP: 14px ExtraBold — `bodyBold` is the heaviest 14px role and it is Bold.
  agriNearbyPrice:      { fontSize: 14, fontFamily: KFONT.sansExtra, color: SLATE, marginRight: KSPACE.s6 },
  agriNearbyTrend:      { width: 26, height: 26, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },

  // ── States
  // GAP: paddingTop 80 sits between KSPACE.s64 and the tailTab role (100).
  centered:      { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: KSPACE.s14 },
  loadingSpinner:{ ...circle(64), backgroundColor: COLORS.greenMint, justifyContent: 'center', alignItems: 'center', marginBottom: KSPACE.s4 },
  // A11Y: was COLORS.textMedium #78716C on the #F4F8F1 page — 4.46:1, just
  // under AA. mutedForeground is 5.53:1.
  loadingTxt:    { ...noLead(KTYPE.bodySm), color: KHET.mutedForeground, textAlign: 'center', paddingHorizontal: KSPACE.s32 },
  errorIcon:     { ...circle(64), backgroundColor: COLORS.slate50, justifyContent: 'center', alignItems: 'center' },
  // A11Y: was COLORS.error #EF4444 on #F4F8F1 — 3.50:1. destructiveInk is 6.15:1.
  errorTxt:      { ...noLead(KTYPE.body), color: KHET.destructiveInk, textAlign: 'center', paddingHorizontal: KSPACE.s32 },
  retryBtn:      { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s6, backgroundColor: COLORS.greenMint, borderRadius: KRADIUS.r12, paddingHorizontal: KSPACE.s20, paddingVertical: KSPACE.s10, borderWidth: KBORDER.hairline, borderColor: COLORS.greenMint300 },
  retryTxt:      { ...noLead(KTYPE.labelBold), color: COLORS.primary },
});

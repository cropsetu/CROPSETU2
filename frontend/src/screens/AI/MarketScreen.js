import { COLORS } from '../../constants/colors';
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
import { INDIA_STATES_LIST, INDIA_DISTRICTS, STATE_GPS_MAP, getDistricts } from '../../constants/indiaLocations';
import { useLanguage } from '../../context/LanguageContext';
import CropIcon from '../../components/CropIcons';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const { width: W, height: H } = Dimensions.get('window');

// ── Design tokens ─────────────────────────────────────────────────────────────

const GREEN_L= COLORS.mintGreen;
const PURPLE = COLORS.sellerShipped;
const AMBER  = COLORS.amber;
const RED    = COLORS.error;
const BLUE   = COLORS.blue;
const SLATE  = COLORS.textDark;

const CARD_MARGIN  = 16;
const CARD_PADDING = 16;
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
    key: 'veg', label: 'Vegetables', icon: 'leaf', cropIcon: 'Tomato', color: COLORS.greenBright,
    crops: [
      'Tomato','Onion','Potato','Brinjal','Cauliflower','Cabbage',
      'Okra','Bitter Gourd','Capsicum','Cucumber','Bottle Gourd',
      'Pumpkin','Carrot','Radish','Spinach','Green Chilli',
      'Garlic','Ginger','Coriander','Fenugreek','Sweet Potato','Peas',
    ],
  },
  {
    key: 'fruit', label: 'Fruits', icon: 'nutrition', cropIcon: 'Mango', color: COLORS.cta,
    crops: [
      'Mango','Banana','Grapes','Pomegranate','Guava','Papaya',
      'Watermelon','Muskmelon','Orange','Lemon','Apple','Sapota',
      'Pineapple','Litchi','Coconut',
    ],
  },
  {
    key: 'cereal', label: 'Cereals', icon: 'grid', cropIcon: 'Wheat', color: COLORS.burnOrange,
    crops: ['Wheat','Rice','Maize','Bajra','Jowar','Barley','Ragi'],
  },
  {
    key: 'pulse', label: 'Pulses', icon: 'ellipse', cropIcon: 'Gram', color: COLORS.amberDark2,
    crops: ['Tur Dal','Gram','Moong','Urad','Masoor'],
  },
  {
    key: 'oil', label: 'Oilseeds', icon: 'water', cropIcon: 'Mustard', color: COLORS.darkGold,
    crops: ['Soybean','Groundnut','Sunflower','Mustard','Sesame','Castor'],
  },
  {
    key: 'cash', label: 'Cash Crops', icon: 'cash', cropIcon: 'Cotton', color: COLORS.sellerShipped,
    crops: ['Cotton','Sugarcane','Jute'],
  },
  {
    key: 'spice', label: 'Spices', icon: 'flame', cropIcon: 'Red Chilli', color: COLORS.error,
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
function CropPickerModal({ visible, selected, onSelect, onClose }) {
  const { t }         = useLanguage();
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
        style={[M.modalSheet, { transform: [{ translateY: slideAnim }], paddingBottom: insets.bottom + 16 }]}
      >
        {/* Handle */}
        <View style={M.modalHandle} />

        {/* Title row */}
        <View style={M.modalTitleRow}>
          <Text style={M.modalTitle}>{t('soilHealth.selectCrop')}</Text>
          <Pressable style={M.modalClose} onPress={onClose}>
            <Ionicons name="close" size={18} color={SLATE} />
          </Pressable>
        </View>

        {/* Search input */}
        <View style={M.searchBox}>
          <Ionicons name="search" size={16} color={COLORS.textMedium} />
          <TextInput
            style={M.searchInput}
            placeholder={t('market.searchCrops')}
            placeholderTextColor={COLORS.textLight}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={16} color={COLORS.textDisabled} />
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
                {cat.cropIcon
                  ? <CropIcon crop={cat.cropIcon} size={24} />
                  : <Ionicons name={cat.icon + '-outline'} size={14} color={active ? COLORS.white : COLORS.textMedium} />}
                <Text style={[M.catChipText, active && { color: COLORS.white }]} numberOfLines={1}>{cat.label}</Text>
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
          columnWrapperStyle={{ gap: 10 }}
          contentContainerStyle={M.cropGrid}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 40, gap: 8 }}>
              <CropIcon crop="Wheat" size={48} />
              <Text style={{ color: COLORS.textMedium, fontSize: 13 }}>{t('market.noCropsFound')}</Text>
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
          borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2,
        }}>
          <Text style={{ fontSize: 8, color: COLORS.white, fontWeight: '800' }}>
            ₹{(max / 1000).toFixed(1)}k
          </Text>
        </View>
      )}
      {/* Day labels */}
      {(days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']).slice(0, data.length).map((d, i) => (
        <Text key={i} style={{
          position: 'absolute',
          left: pts[i].x - 12, top: ch - 16,
          fontSize: 9, color: COLORS.textMedium, width: 26, textAlign: 'center', fontWeight: '600',
        }}>{d}</Text>
      ))}
    </Animated.View>
  );
}

// ── StatPill ──────────────────────────────────────────────────────────────────
function StatPill({ label, value, color }) {
  return (
    <View style={[M.statPill, { borderColor: `${color}30` }]}>
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
        setMandiError(t('market.loadError'));
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
      <View style={[M.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => navigation.goBack()} style={M.backBtn}>
          <Ionicons name="chevron-back" size={22} color={SLATE} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={M.headerTitle}>{t('mandiBhav.mandiBhav')}</Text>
          {locationDetecting
            ? <Text style={M.headerSub}>{t('weatherHome.detecting')}</Text>
            : detectedCity
              ? <View style={M.locationRow}>
                  <Ionicons name="location" size={10} color={COLORS.primary} />
                  <Text style={M.locationText}>{t('market.nearCity', { city: detectedCity })}</Text>
                </View>
              : <Text style={M.headerSub}>{t('market.realDataSource')}</Text>
          }
        </View>
        <View style={M.livePill}>
          <LiveDot />
          <Text style={M.liveTxt}>{t('market.live')}</Text>
        </View>
      </View>

      {/* ── Crop selector ── */}
      <Pressable style={M.cropSelector} onPress={() => setPickerVisible(true)}>
        <View style={M.cropSelectorLeft}>
          <View style={M.cropSelectorIcon}>
            <CropIcon crop={selectedCrop} size={38} />
          </View>
          <View>
            <Text style={M.cropSelectorLabel}>{t('market.selectedCrop')}</Text>
            <Text style={M.cropSelectorName}>{selectedCrop}</Text>
          </View>
        </View>
        <View style={M.cropSelectorRight}>
          <Text style={M.cropSelectorHint}>{t('market.tapToChange')}</Text>
          <View style={M.cropSelectorChevron}>
            <Ionicons name="chevron-down" size={14} color={COLORS.primary} />
          </View>
        </View>
      </Pressable>

      {/* ── State + District filter row ── */}
      <View style={M.filterRow}>
        {/* State picker */}
        <Pressable style={M.stateBtn} onPress={() => { setShowStateMenu(v => !v); setShowDistrictMenu(false); }}>
          <Ionicons name="map-outline" size={12} color={COLORS.primary} />
          <Text style={M.stateBtnTxt} numberOfLines={1}>{selectedState}</Text>
          <Ionicons name="chevron-down" size={12} color={COLORS.textMedium} />
        </Pressable>

        {/* District dropdown button */}
        <Pressable
          style={M.districtBtn}
          onPress={() => { setShowDistrictMenu(v => !v); setShowStateMenu(false); }}
        >
            <Ionicons name="location-outline" size={12} color={selectedDistrict ? COLORS.primary : COLORS.textMedium} />
          <Text
            style={[M.districtBtnTxt, selectedDistrict && { color: SLATE, fontWeight: '700' }]}
            numberOfLines={1}
          >
            {selectedDistrict || t('market.allDistricts')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {selectedDistrict.length > 0 && (
              <Pressable onPress={() => {
                setSelectedDistrict('');
                loadMandiPrices(selectedCrop, selectedState, '');
              }} hitSlop={8}>
                <Ionicons name="close-circle" size={13} color={COLORS.textDisabled} />
              </Pressable>
            )}
            <Ionicons name="chevron-down" size={12} color={COLORS.textMedium} />
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
                {t('market.allDistricts')}
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
                <View style={{ padding: 12 }}>
                  <Text style={{ fontSize: 12, color: COLORS.textMedium, textAlign: 'center' }}>
                    {t('market.noDistrictsFound', { state: selectedState })}
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
            <Text style={M.loadingTxt}>{t('market.fetchingFor', { crop: selectedCrop })}</Text>
            <Text style={[M.loadingTxt, { fontSize: 11, marginTop: 4 }]}>{t('market.sourceLabel')}</Text>
          </View>
        )}

        {/* ── Mandi error ── */}
        {mandiError && !mandiLoading && (
          <View style={M.centered}>
            <View style={M.errorIcon}>
              <Ionicons name="cloud-offline-outline" size={36} color={COLORS.textDisabled} />
            </View>
            <Text style={M.errorTxt}>{mandiError}</Text>
            <Pressable onPress={() => loadMandiPrices()} style={M.retryBtn}>
              <Ionicons name="refresh" size={14} color={COLORS.primary} />
              <Text style={M.retryTxt}>{t('cropScan.tryAgain')}</Text>
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
                <Ionicons name="time-outline" size={12} color={AMBER} />
                <Text style={M.staleTxt}>
                  {t('market.cachedDataNotice')}
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
                    <Ionicons name="leaf" size={11} color={COLORS.primary} />
                    <Text style={M.priceHeroCropName}>{selectedCrop}</Text>
                  </View>
                  <View style={M.realDataBadge}>
                    <Ionicons name="shield-checkmark" size={10} color={COLORS.skyBright} />
                    <Text style={M.realDataBadgeTxt}>{t('market.realData')}</Text>
                  </View>
                </View>

                <View style={M.priceHeroMid}>
                  <View>
                    <Text style={M.priceHeroRupee}>₹</Text>
                    <Text style={M.priceHeroValue}>{topPrice?.toLocaleString() || '—'}</Text>
                    <Text style={M.priceHeroUnit}>{t('market.topModalPrice')}</Text>
                  </View>
                  <View style={M.priceRangeBox}>
                    <Text style={M.priceRangeLabel}>{t('market.rangeAcrossMandis', { count: mandiPrices.length })}</Text>
                    <Text style={M.priceRangeVal}>
                      ₹{lowestPrice?.toLocaleString()} – ₹{topPrice?.toLocaleString()}
                    </Text>
                    <Text style={[M.priceRangeAvg, { color: COLORS.primary }]}>
                      {t('market.avgLabel')} ₹{avgModal?.toLocaleString()}
                    </Text>
                  </View>
                </View>

                <View style={M.weekStatRow}>
                  <StatPill label={t('market.statHighest')} value={`₹${topPrice?.toLocaleString() || '—'}`} color={COLORS.primary} />
                  <View style={M.weekStatDiv} />
                  <StatPill label={t('market.statAverage')} value={`₹${avgModal?.toLocaleString() || '—'}`} color={BLUE} />
                  <View style={M.weekStatDiv} />
                  <StatPill label={t('market.statLowest')} value={`₹${lowestPrice?.toLocaleString() || '—'}`} color={RED} />
                  <View style={M.weekStatDiv} />
                  <StatPill label={t('market.statMandis')} value={`${mandiPrices.length}`} color={PURPLE} />
                </View>
              </LinearGradient>
            </AnimCard>

            {/* ── Real Mandi price cards ── */}
            <AnimCard delay={60} style={M.section}>
              <View style={M.sectionHeader}>
                <View style={[M.cardDot, { backgroundColor: BLUE }]} />
                <Text style={M.cardTitle}>{t('aiHome.tools.mandi.desc')}</Text>
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
                    else if (ageDays === 1) dateLabel = t('market.yesterdayDate', { date: dayMonth });
                    else                    dateLabel = t('market.daysAgoDate', { count: ageDays, date: dayMonth });
                  }
                  return (
                    <View key={i}>
                      <View style={[M.mandiRow, i === 0 && M.mandiRowTop]}>
                        <View style={M.mandiLeft}>
                          <View style={M.mandiNameRow}>
                            <Text style={M.mandiName} numberOfLines={1}>{item.market || item.mandi}</Text>
                            {i === 0 && (
                              <View style={M.mandiNearestBadge}>
                                <Text style={M.mandiNearestText}>{t('market.highest')}</Text>
                              </View>
                            )}
                          </View>
                          <Text style={M.mandiDist}>{item.district}{item.state ? `, ${item.state}` : ''}</Text>
                          {dateLabel ? (
                            <Text style={[M.mandiDist, { marginTop: 1 }, isStaleRow && { color: COLORS.textMedium, fontStyle: 'italic' }]}>
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
            <Ionicons name="storefront-outline" size={48} color={COLORS.textDisabled} />
            <Text style={[M.loadingTxt, { color: SLATE }]}>{t('market.noMandiData')}</Text>
            <Text style={[M.loadingTxt, { fontSize: 12 }]}>
              {t('market.tryDifferentStateDistrict')}
            </Text>
            <Pressable onPress={() => loadMandiPrices()} style={M.retryBtn}>
              <Ionicons name="refresh" size={14} color={COLORS.primary} />
              <Text style={M.retryTxt}>{t('market.refresh')}</Text>
            </Pressable>
          </View>
        )}

        {/* ── Ask FarmMind ── */}
        {mandiPrices.length > 0 && (
          <View style={[M.section, { marginTop: 4 }]}>
            <Pressable
              style={({ pressed }) => [M.askBtn, pressed && { opacity: 0.88 }]}
              onPress={() => navigation.navigate('AIChat', {
                initialMessage: t('market.bestTimeToSellMsg', { crop: selectedCrop, state: selectedState }),
              })}
            >
              <LinearGradient
                colors={[COLORS.primary, COLORS.greenDark2]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={M.askBtnGradient}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.white} />
                <Text style={M.askBtnText}>{t('market.askFarmMind', { crop: selectedCrop })}</Text>
                <Ionicons name="arrow-forward" size={16} color="rgba(255,255,255,0.7)" />
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
  scrollContent: { paddingBottom: 60 },

  // ── Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn:     { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: SLATE },
  headerSub:   { fontSize: 10, color: COLORS.textMedium, marginTop: 1 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  locationText:{ fontSize: 10, color: COLORS.primary, fontWeight: '600' },
  livePill:    {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.greenMint, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: COLORS.greenMint300,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  liveTxt: { fontSize: 10, fontWeight: '800', color: COLORS.primary },

  // ── Crop selector button
  cropSelector: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  cropSelectorLeft:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cropSelectorIcon:    { width: 46, height: 46, borderRadius: 14, backgroundColor: COLORS.greenMint, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.greenMint300, overflow: 'hidden' },
  cropSelectorLabel:   { fontSize: 10, color: COLORS.textMedium, fontWeight: '600', marginBottom: 2 },
  cropSelectorName:    { fontSize: 16, fontWeight: '800', color: SLATE },
  cropSelectorRight:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cropSelectorHint:    { fontSize: 11, color: COLORS.textMedium },
  cropSelectorChevron: { width: 28, height: 28, borderRadius: 8, backgroundColor: COLORS.greenMint, justifyContent: 'center', alignItems: 'center' },

  // ── Crop picker modal
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet:    {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: H * 0.85,
    shadowColor: COLORS.black, shadowOpacity: 0.2, shadowRadius: 20, elevation: 20,
  },
  modalHandle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.textDisabled, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  modalTitle:    { fontSize: 17, fontWeight: '800', color: SLATE },
  modalClose:    { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.slateBg, justifyContent: 'center', alignItems: 'center' },
  searchBox:     {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: COLORS.slate50, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  searchInput:   { flex: 1, fontSize: 14, color: SLATE, padding: 0 },
  catScroll:     { paddingHorizontal: 16, gap: 8, paddingVertical: 6 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, minHeight: 34,
    borderRadius: 17, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.slate50,
  },
  catChipText:   { fontSize: 13, color: COLORS.textMedium, fontWeight: '600' },
  resultsCount:  { fontSize: 11, color: COLORS.textMedium, paddingHorizontal: 20, marginTop: 8, marginBottom: 4, fontWeight: '600' },
  cropGrid:      { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 20, gap: 10 },
  cropTile: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 16, borderWidth: 1, borderColor: COLORS.border,
    paddingVertical: 12, paddingHorizontal: 6,
    minHeight: 114, gap: 6,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  cropTileActive: { backgroundColor: COLORS.greenMint, borderColor: COLORS.primary },
  cropTileText:   { fontSize: 12, color: SLATE, fontWeight: '600', textAlign: 'center' },
  cropTileTextActive: { color: COLORS.primary, fontWeight: '800' },
  cropTileCheck:  { position: 'absolute', top: 5, right: 5, width: 16, height: 16, borderRadius: 8, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },

  // ── Cards
  card: {
    backgroundColor: COLORS.surface,
    marginHorizontal: CARD_MARGIN, marginBottom: 12,
    borderRadius: 20, padding: CARD_PADDING,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  cardHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardDot:        { width: 7, height: 7, borderRadius: 4 },
  cardTitle:      { fontSize: 13, fontWeight: '700', color: SLATE },
  trendBadge:     { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  trendBadgeText: { fontSize: 10, fontWeight: '700' },

  // ── Stale data warning bar
  staleBar: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    marginHorizontal: CARD_MARGIN, marginBottom: 8,
    backgroundColor: COLORS.yellowPale, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.goldLight, padding: 10,
  },
  staleTxt: { flex: 1, fontSize: 11, color: COLORS.brownDeep, lineHeight: 15 },

  // ── Real data badge + price range
  realDataBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.skyBg, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: COLORS.skyBorder,
  },
  realDataBadgeTxt: { fontSize: 9, fontWeight: '800', color: COLORS.skyBright },

  priceRangeBox:   { alignItems: 'flex-end', gap: 3 },
  priceRangeLabel: { fontSize: 9, color: COLORS.textMedium, fontWeight: '600' },
  priceRangeVal:   { fontSize: 12, fontWeight: '800', color: SLATE },
  priceRangeAvg:   { fontSize: 11, fontWeight: '700' },

  // ── Predict prompt button
  predictPromptBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.lavenderWhite, borderRadius: 14,
    borderWidth: 1.5, borderColor: COLORS.lavender,
    padding: 14,
  },
  predictPromptTitle: { fontSize: 14, fontWeight: '800', color: PURPLE },
  predictPromptSub:   { fontSize: 11, color: COLORS.textMedium, marginTop: 2, lineHeight: 15 },

  // ── Price hero
  priceHero: {
    marginHorizontal: CARD_MARGIN, marginBottom: 12,
    borderRadius: 24, padding: 20,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.07, shadowRadius: 12, elevation: 3,
    gap: 16,
  },
  priceHeroTop:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  priceHeroCropBadge:{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: COLORS.greenMint300 },
  priceHeroCropName: { fontSize: 13, fontWeight: '700', color: SLATE },
  priceHeroDate:     { fontSize: 11, color: COLORS.textMedium, fontWeight: '600' },
  priceHeroMid:      { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  priceHeroRupee:    { fontSize: 16, fontWeight: '700', color: COLORS.textMedium, marginTop: 4 },
  priceHeroValue:    { fontSize: 44, fontWeight: '900', color: SLATE, letterSpacing: -1, lineHeight: 50 },
  priceHeroUnit:     { fontSize: 12, color: COLORS.textMedium, marginTop: 4 },
  changeBadge:       { borderRadius: 16, borderWidth: 1, padding: 12, alignItems: 'center', gap: 4 },
  changePct:         { fontSize: 22, fontWeight: '900' },
  changeCaption:     { fontSize: 9, fontWeight: '600', opacity: 0.8 },

  // Week stats
  weekStatRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 14, padding: 12, gap: 0 },
  weekStatDiv: { width: 1, backgroundColor: COLORS.border, marginVertical: 2 },
  statPill:    { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 6, borderWidth: 0 },
  statPillLabel:{ fontSize: 8, fontWeight: '700', letterSpacing: 0.5, opacity: 0.8 },
  statPillValue:{ fontSize: 13, fontWeight: '800' },

  // ── Insight card
  insightCard:     { marginHorizontal: CARD_MARGIN, marginBottom: 12, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.goldLight, shadowColor: AMBER, shadowOpacity: 0.1, shadowRadius: 8, elevation: 2 },
  insightGradient: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16 },
  insightIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(217,119,6,0.12)', justifyContent: 'center', alignItems: 'center' },
  insightLabel:    { fontSize: 9, fontWeight: '900', color: AMBER, letterSpacing: 1.5, marginBottom: 5 },
  insightText:     { fontSize: 13, color: COLORS.brownDeep, lineHeight: 19 },

  // ── Sections
  section:        { marginHorizontal: CARD_MARGIN, marginBottom: 12 },
  sectionHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sourceBadge:    { marginLeft: 4, backgroundColor: COLORS.slateBg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  sourceBadgeText:{ fontSize: 9, color: COLORS.textMedium, fontWeight: '600' },
  aiBadge:        { marginLeft: 4, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.violetPale, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: COLORS.lavender },
  aiBadgeText:    { fontSize: 9, color: PURPLE, fontWeight: '700' },

  // ── Mandi
  mandiCard:       { backgroundColor: COLORS.surface, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  mandiRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  mandiRowTop:     { backgroundColor: COLORS.mintWhite },
  mandiLeft:       { flex: 1 },
  mandiNameRow:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  mandiName:       { fontSize: 13, fontWeight: '700', color: SLATE, flexShrink: 1 },
  mandiNearestBadge:{ backgroundColor: COLORS.successLight, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  mandiNearestText: { fontSize: 8, fontWeight: '800', color: COLORS.primary },
  mandiMeta:       { flexDirection: 'row', alignItems: 'center', gap: 3 },
  mandiDist:       { fontSize: 10, color: COLORS.textMedium },
  mandiRight:      { alignItems: 'flex-end', gap: 3 },
  mandiPrice:      { fontSize: 16, fontWeight: '900', color: SLATE },
  mandiRange:      { fontSize: 9, color: COLORS.textMedium },
  mandiDiv:        { height: 1, backgroundColor: COLORS.slateBg, marginHorizontal: 14 },
  updatedAt:       { fontSize: 9, color: COLORS.textMedium, marginTop: 5, marginLeft: 2 },
  reportingNote:   { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 10, marginHorizontal: 14, padding: 10, backgroundColor: COLORS.slate50, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border },
  reportingNoteTxt:{ flex: 1, fontSize: 11, color: COLORS.textMedium, lineHeight: 16 },

  // ── Ask button
  askBtn:           { borderRadius: 18, overflow: 'hidden', shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4 },
  askBtnGradient:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16, paddingHorizontal: 20 },
  askBtnText:       { fontSize: 14, fontWeight: '800', color: COLORS.white, flex: 1, textAlign: 'center' },

  // ── Filter row (state + district + search button)
  filterRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  stateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.greenMint, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 9,
    borderWidth: 1, borderColor: COLORS.greenMint300, maxWidth: 130,
  },
  stateBtnTxt: { fontSize: 12, fontWeight: '700', color: SLATE, flex: 1 },
  stateDropdown: {
    position: 'absolute', top: 130, left: 16, right: 16, zIndex: 99,
    backgroundColor: COLORS.surface, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.12, shadowRadius: 10, elevation: 6,
  },
  stateItem: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  stateItemTxt: { fontSize: 13, color: SLATE },
  districtBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.slate50, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 9,
    borderWidth: 1, borderColor: COLORS.border,
  },
  districtBtnTxt: { flex: 1, fontSize: 12, color: COLORS.textMedium },
  searchBtn: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: COLORS.skyBright,
    justifyContent: 'center', alignItems: 'center',
  },

  // ── AgriPredict section
  agriSyncMsg:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.skyBg, borderRadius: 10, borderWidth: 1, borderColor: COLORS.skyBorder, padding: 10, marginBottom: 8 },
  agriSyncMsgText:  { flex: 1, fontSize: 12, color: COLORS.skyMid, lineHeight: 16 },
  agriErrorBox:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.blushPink, borderRadius: 10, borderWidth: 1, borderColor: COLORS.coralPink, padding: 10, marginBottom: 8 },
  agriErrorText:    { flex: 1, fontSize: 12, color: COLORS.crimsonAlt, lineHeight: 16 },
  agriLoadingRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  agriLoadingTxt:   { fontSize: 12, color: COLORS.textMedium },

  agriSummaryRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.slate50, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 12, marginBottom: 10 },
  agriSummaryItem:  { flex: 1, alignItems: 'center', gap: 3 },
  agriSummaryLabel: { fontSize: 8, color: COLORS.textMedium, fontWeight: '700', letterSpacing: 0.3 },
  agriSummaryVal:   { fontSize: 13, fontWeight: '800', color: SLATE },
  agriSummaryDiv:   { width: 1, height: 28, backgroundColor: COLORS.border },

  agriChartWrap:  { marginTop: 4, marginBottom: 8 },
  agriChartTitle: { fontSize: 10, color: COLORS.textMedium, fontWeight: '700', marginBottom: 8, letterSpacing: 0.3 },

  // Prediction box
  agriPredBox:    { backgroundColor: COLORS.slate50, borderRadius: 14, borderWidth: 1, borderColor: COLORS.skyTint, padding: 14, gap: 10, marginTop: 8 },
  agriCachePill:  { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: COLORS.white, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: COLORS.border },
  agriCacheText:  { fontSize: 9, fontWeight: '700' },
  agriRangeRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 12 },
  agriRangeItem:  { flex: 1, alignItems: 'center', gap: 3 },
  agriRangeLabel: { fontSize: 8, color: COLORS.textMedium, fontWeight: '600' },
  agriRangeVal:   { fontSize: 15, fontWeight: '900', color: SLATE },
  agriConfBadge:  { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, borderWidth: 1, alignItems: 'center', gap: 1 },
  agriConfText:   { fontSize: 11, fontWeight: '900' },
  agriConfSub:    { fontSize: 7, fontWeight: '700' },
  agriTrendRow:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  agriTrendText:  { fontSize: 13, fontWeight: '700' },
  agriInsightBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: COLORS.yellowPale, borderRadius: 10, borderWidth: 1, borderColor: COLORS.goldLight, padding: 10 },
  agriInsightText:{ flex: 1, fontSize: 12, color: COLORS.brownDeep, lineHeight: 17 },
  agriFactorChip: { backgroundColor: COLORS.skyBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: COLORS.skyBorder },
  agriFactorText: { fontSize: 10, color: COLORS.skyMid, fontWeight: '600' },
  agriRecoBox:    { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: COLORS.greenMint, borderRadius: 10, borderWidth: 1, borderColor: COLORS.greenMint300, padding: 10 },
  agriRecoText:   { flex: 1, fontSize: 12, color: COLORS.darkGreen, lineHeight: 17, fontWeight: '600' },

  // Nearby markets
  agriNearbyWrap:       { marginTop: 10 },
  agriNearbyTitle:      { fontSize: 11, color: SLATE, fontWeight: '700', marginBottom: 8 },
  agriNearbyRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  agriNearbyRowBorder:  { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  agriNearbyDistrict:   { flex: 1, fontSize: 13, color: SLATE, fontWeight: '600' },
  agriNearbyPrice:      { fontSize: 14, fontWeight: '800', color: SLATE, marginRight: 6 },
  agriNearbyTrend:      { width: 26, height: 26, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },

  // ── States
  centered:      { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 14 },
  loadingSpinner:{ width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.greenMint, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  loadingTxt:    { fontSize: 13, color: COLORS.textMedium, textAlign: 'center', paddingHorizontal: 32 },
  errorIcon:     { width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.slate50, justifyContent: 'center', alignItems: 'center' },
  errorTxt:      { fontSize: 14, color: COLORS.error, textAlign: 'center', paddingHorizontal: 32 },
  retryBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.greenMint, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.greenMint300 },
  retryTxt:      { fontSize: 13, fontWeight: '700', color: COLORS.primary },
});

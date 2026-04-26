/**
 * MandiBhavScreen — Real mandi prices from data.gov.in
 *
 * Features:
 *  - Commodity chip selector
 *  - State / District filter
 *  - Price cards sorted by highest modal price
 *  - Refresh + loading states
 */
import { COLORS } from '../../constants/colors';
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl, StatusBar, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { getMandiPrices, getNearbyMandis } from '../../services/aiApi';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const COMMODITIES = [
  'Tomato','Onion','Potato','Wheat','Rice','Soybean','Cotton',
  'Maize','Gram','Tur','Sugarcane','Grapes','Pomegranate',
];

const STATES = ['Maharashtra','Punjab','Madhya Pradesh','Uttar Pradesh','Karnataka','Andhra Pradesh','Rajasthan'];

function PriceCard({ item }) {
  const pct = item.modalPrice && item.minPrice
    ? Math.round(((item.modalPrice - item.minPrice) / (item.maxPrice - item.minPrice || 1)) * 100)
    : 50;

  return (
    <View style={S.priceCard}>
      <View style={S.priceCardTop}>
        <View style={{ flex: 1 }}>
          <Text style={S.mandiName} numberOfLines={1}>{item.market || item.mandi}</Text>
          <Text style={S.districtName}>{item.district}, {item.state}</Text>
        </View>
        <View style={S.modalBadge}>
          <Text style={S.modalPrice}>₹{item.modalPrice}</Text>
          <Text style={S.modalUnit}>/q</Text>
        </View>
      </View>
      <View style={S.priceRow}>
        <View style={S.priceItem}>
          <Text style={S.priceLabel}>Min</Text>
          <Text style={S.priceVal}>₹{item.minPrice}</Text>
        </View>
        <View style={S.priceDivider} />
        <View style={S.priceItem}>
          <Text style={S.priceLabel}>Modal</Text>
          <Text style={[S.priceVal, { color: COLORS.primary }]}>₹{item.modalPrice}</Text>
        </View>
        <View style={S.priceDivider} />
        <View style={S.priceItem}>
          <Text style={S.priceLabel}>Max</Text>
          <Text style={S.priceVal}>₹{item.maxPrice}</Text>
        </View>
      </View>
      <View style={S.priceBar}>
        <View style={[S.priceBarFill, { width: `${pct}%` }]} />
      </View>
      {item.arrivalDate ? (
        <Text style={S.arrivalDate}>Arrival: {item.arrivalDate}</Text>
      ) : null}
    </View>
  );
}

export default function MandiBhavScreen({ navigation }) {
  const { user } = useAuth();
  const { t, language } = useLanguage();

  const [commodity, setCommodity]   = useState('Tomato');
  const [state, setState]           = useState(user?.state || 'Maharashtra');
  const [district, setDistrict]     = useState(user?.district || '');
  const [prices, setPrices]         = useState([]);
  const [loading, setLoading]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);
  const [showStateMenu, setShowStateMenu] = useState(false);

  const fetchPrices = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await getMandiPrices(commodity, state, district || null);
      const sorted = (result?.prices || result || []).sort((a, b) => b.modalPrice - a.modalPrice);
      setPrices(sorted);
    } catch (err) {
      setError(err?.response?.data?.error?.message || 'Failed to load prices');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [commodity, state, district]);

  useEffect(() => { fetchPrices(); }, [fetchPrices]);

  return (
    <AnimatedScreen style={S.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>{t('mandiBhav.mandiBhav')}</Text>
          <Text style={S.headerSub}>{t('mandiBhav.liveDatagovin')}</Text>
        </View>
        <View style={S.livePill}>
          <View style={S.liveDot} />
          <Text style={S.liveTxt}>LIVE</Text>
        </View>
      </View>

      {/* Commodity chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={S.chipScroll}
        contentContainerStyle={S.chipContent}
      >
        {COMMODITIES.map(c => (
          <TouchableOpacity
            key={c}
            style={[S.chip, commodity === c && S.chipActive]}
            onPress={() => setCommodity(c)}
          >
            <Text style={[S.chipTxt, commodity === c && S.chipTxtActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* State filter row */}
      <View style={S.filterRow}>
        <TouchableOpacity style={S.stateBtn} onPress={() => setShowStateMenu(!showStateMenu)}>
          <Ionicons name="location-outline" size={14} color={COLORS.primary} />
          <Text style={S.stateBtnTxt} numberOfLines={1}>{state}</Text>
          <Ionicons name="chevron-down" size={14} color={COLORS.textLight} />
        </TouchableOpacity>
        <TextInput
          style={S.districtInput}
          placeholder={t('mandiBhav.districtOptional')}
          placeholderTextColor={COLORS.textLight}
          value={district}
          onChangeText={setDistrict}
          onSubmitEditing={() => fetchPrices()}
        />
        <TouchableOpacity style={S.searchBtn} onPress={() => fetchPrices()}>
          <Ionicons name="search" size={18} color={COLORS.white} />
        </TouchableOpacity>
      </View>

      {/* State dropdown */}
      {showStateMenu && (
        <View style={S.stateDropdown}>
          {STATES.map(s => (
            <TouchableOpacity
              key={s}
              style={S.stateItem}
              onPress={() => { setState(s); setShowStateMenu(false); }}
            >
              <Text style={[S.stateItemTxt, s === state && { color: COLORS.primary }]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Content */}
      {loading ? (
        <View style={S.centered}>
          <ActivityIndicator color={COLORS.primary} size="large" />
          <Text style={S.loadingTxt}>{t('mandiBhav.loadingPrices')}</Text>
        </View>
      ) : error ? (
        <View style={S.centered}>
          <Ionicons name="cloud-offline-outline" size={48} color={COLORS.grayMid2} />
          <Text style={S.errorTxt}>{error}</Text>
          <TouchableOpacity style={S.retryBtn} onPress={() => fetchPrices()}>
            <Text style={S.retryTxt}>{t('mandiBhav.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={10}
          removeClippedSubviews
          data={prices}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => <PriceCard item={item} />}
          contentContainerStyle={S.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchPrices(true)} tintColor={COLORS.primary} />}
          ListEmptyComponent={
            <View style={S.centered}>
              <Ionicons name="storefront-outline" size={48} color={COLORS.grayMid2} />
              <Text style={S.emptyTxt}>{t('mandiBhav.noPricesFound')}</Text>
              <Text style={S.emptySub}>{t('mandiBhav.tryADifferentDistrictOrState')}</Text>
            </View>
          }
          ListHeaderComponent={prices.length > 0 ? (
            <Text style={S.resultCount}>
              {prices.length} {t('mandiBhav.mandis')} • {commodity}
            </Text>
          ) : null}
        />
      )}
    </AnimatedScreen>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 52, paddingHorizontal: 18, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textDark },
  headerSub:   { fontSize: 10, color: COLORS.textLight, marginTop: 1 },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(23,107,67,0.08)', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: COLORS.border,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  liveTxt: { fontSize: 10, fontWeight: '800', color: COLORS.primary },

  chipScroll:   { flexGrow: 0, maxHeight: 52 },
  chipContent:  { paddingHorizontal: 18, paddingVertical: 10, gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1,
    borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  chipActive:    { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipTxt:       { fontSize: 13, color: COLORS.textMedium, fontWeight: '600' },
  chipTxtActive: { color: COLORS.white },

  filterRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 18, paddingVertical: 10,
  },
  stateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.surface, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 9,
    borderWidth: 1, borderColor: COLORS.border, maxWidth: 140,
  },
  stateBtnTxt: { fontSize: 13, color: COLORS.textBody, fontWeight: '600', flex: 1 },
  districtInput: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: COLORS.border,
    color: COLORS.textBody, fontSize: 13,
  },
  searchBtn: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center',
  },

  stateDropdown: {
    marginHorizontal: 18, backgroundColor: COLORS.white,
    borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    overflow: 'hidden', zIndex: 99,
  },
  stateItem: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  stateItemTxt: { fontSize: 14, color: COLORS.textBody },

  listContent: { paddingHorizontal: 18, paddingBottom: 40, gap: 10 },
  resultCount:  { fontSize: 11, color: COLORS.textLight, fontWeight: '700', marginBottom: 4, marginTop: 8 },

  priceCard: {
    backgroundColor: COLORS.surface, borderRadius: 16,
    padding: 16, borderWidth: 1, borderColor: COLORS.border,
  },
  priceCardTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  mandiName:    { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  districtName: { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  modalBadge:   { flexDirection: 'row', alignItems: 'baseline', gap: 1 },
  modalPrice:   { fontSize: 22, fontWeight: '900', color: COLORS.primary },
  modalUnit:    { fontSize: 11, color: COLORS.textLight },

  priceRow: { flexDirection: 'row', marginBottom: 10 },
  priceItem: { flex: 1, alignItems: 'center' },
  priceLabel: { fontSize: 10, color: COLORS.textLight, fontWeight: '600', marginBottom: 2 },
  priceVal:   { fontSize: 14, fontWeight: '700', color: COLORS.textBody },
  priceDivider: { width: 1, backgroundColor: COLORS.border, marginVertical: 2 },

  priceBar:     { height: 4, backgroundColor: COLORS.surfaceSunkenAlt, borderRadius: 2, overflow: 'hidden' },
  priceBarFill: { height: 4, backgroundColor: COLORS.primary, borderRadius: 2 },
  arrivalDate:  { fontSize: 10, color: COLORS.textLight, marginTop: 8 },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  loadingTxt: { fontSize: 14, color: COLORS.textLight, marginTop: 8 },
  errorTxt: { fontSize: 14, color: COLORS.error, textAlign: 'center', paddingHorizontal: 32 },
  emptyTxt: { fontSize: 15, color: COLORS.textMedium, fontWeight: '700' },
  emptySub:  { fontSize: 12, color: COLORS.textLight, textAlign: 'center' },
  retryBtn: {
    marginTop: 8, backgroundColor: COLORS.primary, borderRadius: 10,
    paddingHorizontal: 24, paddingVertical: 10,
  },
  retryTxt: { fontSize: 14, fontWeight: '700', color: COLORS.white },
});

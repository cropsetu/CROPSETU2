/**
 * StateCropsScreen — Browse crops & farming types for any Indian state.
 * Auto-detects state from device location; user can tap to change state.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, FlatList, TouchableOpacity,
  Modal, StatusBar, Platform, ActivityIndicator, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location'; // reverseGeocodeAsync only
import { useLocation } from '../../context/LocationContext';
import { COLORS, SHADOWS } from '../../constants/colors';
import { useLanguage } from '../../context/LanguageContext';
import {
  STATE_CROPS, STATE_LIST, detectStateFromLocation,
} from '../../data/stateCrops';

// ── Palette ────────────────────────────────────────────────────────────────────
const SKY   = COLORS.skyDark;
const EARTH = COLORS.earthDark;

// ── Helpers ────────────────────────────────────────────────────────────────────
function stateSplitName(key) {
  return key.replace(/([A-Z])/g, ' $1').trim();
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function FarmingTypeChip({ item }) {
  return (
    <View style={[styles.ftChip, { backgroundColor: item.color + '18', borderColor: item.color + '60' }]}>
      <Text style={styles.ftIcon}>{item.icon}</Text>
      <Text style={[styles.ftLabel, { color: item.color }]}>{item.label}</Text>
    </View>
  );
}

function CropCard({ crop, onPress, t }) {
  return (
    <TouchableOpacity style={styles.cropCard} onPress={() => onPress(crop)} activeOpacity={0.88}>
      {/* Season badge */}
      <View style={[styles.seasonBadge, { backgroundColor: crop.season === 'Kharif' ? COLORS.primaryPale : crop.season === 'Rabi' ? COLORS.yellowWarm : crop.season === 'Perennial' ? COLORS.indigoPale2 : COLORS.tealPale }]}>
        <Text style={[styles.seasonText, { color: crop.season === 'Kharif' ? COLORS.primary : crop.season === 'Rabi' ? COLORS.cta : crop.season === 'Perennial' ? COLORS.indigoMid : COLORS.tealDeep }]}>
          {crop.season}
        </Text>
      </View>

      <View style={styles.cropCardTop}>
        <Text style={styles.cropEmoji}>{crop.icon}</Text>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.cropName}>{crop.name}</Text>
          <Text style={styles.cropNameHi}>{crop.nameHi}</Text>
          <Text style={styles.cropDesc} numberOfLines={2}>{crop.description}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
      </View>

      {/* Sow / Harvest / Duration row */}
      <View style={styles.cropMeta}>
        <View style={styles.cropMetaItem}>
          <Ionicons name="calendar-outline" size={13} color={COLORS.primary} />
          <Text style={styles.cropMetaLabel}>{t('stateCrops.sow')}</Text>
          <Text style={styles.cropMetaVal}>{crop.sowingMonth}</Text>
        </View>
        <View style={styles.cropMetaDivider} />
        <View style={styles.cropMetaItem}>
          <Ionicons name="time-outline" size={13} color={SKY} />
          <Text style={styles.cropMetaLabel}>{t('cropCalendar.duration')}</Text>
          <Text style={styles.cropMetaVal}>{crop.duration}</Text>
        </View>
        <View style={styles.cropMetaDivider} />
        <View style={styles.cropMetaItem}>
          <Ionicons name="cut-outline" size={13} color={EARTH} />
          <Text style={styles.cropMetaLabel}>{t('cropCalendar.harvest')}</Text>
          <Text style={styles.cropMetaVal}>{crop.harvestMonth}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// State picker modal
function StatePicker({ visible, selectedState, onSelect, onClose, t }) {
  const [query, setQuery] = useState('');
  const filtered = STATE_LIST.filter((s) =>
    !query || stateSplitName(s).toLowerCase().includes(query.toLowerCase()) ||
    (STATE_CROPS[s]?.nameHi || '').includes(query)
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.pickerOverlay}>
        <View style={styles.pickerSheet}>
          {/* Handle */}
          <View style={styles.pickerHandle} />
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>{t ? t('stateCrops.selectState') : 'Select State'}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={COLORS.textDark} />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.pickerSearch}>
            <Ionicons name="search-outline" size={16} color={COLORS.textLight} style={{ marginRight: 8 }} />
            <SearchInput
              value={query}
              onChangeText={setQuery}
              placeholder={t ? t('stateCrops.searchPlaceholder') : 'Search state…'}
            />
          </View>

          <FlatList
            windowSize={5}
            maxToRenderPerBatch={10}
            removeClippedSubviews
            data={filtered}
            keyExtractor={(item) => item}
            style={{ maxHeight: 420 }}
            renderItem={({ item }) => {
              const data = STATE_CROPS[item];
              const isSelected = item === selectedState;
              return (
                <TouchableOpacity
                  style={[styles.pickerItem, isSelected && styles.pickerItemActive]}
                  onPress={() => { onSelect(item); onClose(); setQuery(''); }}
                  activeOpacity={0.75}
                >
                  <Text style={styles.pickerItemIcon}>{data?.icon || '🌾'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.pickerItemName, isSelected && { color: COLORS.primary }]}>
                      {stateSplitName(item)}
                    </Text>
                    <Text style={styles.pickerItemHi}>{data?.nameHi}</Text>
                  </View>
                  {isSelected && <Ionicons name="checkmark" size={20} color={COLORS.primary} />}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

function SearchInput({ value, onChangeText, placeholder }) {
  return (
    <TextInput
      style={{ flex: 1, fontSize: 15, color: COLORS.textDark, padding: 0 }}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={COLORS.textLight}
      autoCorrect={false}
    />
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────
export default function StateCropsScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { coords: gpsCoords } = useLocation();
  // Accept pre-selected state from navigation params or weather page
  const initialState = route.params?.state || null;
  const [selectedState, setSelectedState] = useState(initialState || 'Maharashtra');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const stateData = STATE_CROPS[selectedState];

  const switchState = useCallback((newState) => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
    setSelectedState(newState);
  }, [fadeAnim]);

  const detectLocation = useCallback(async () => {
    try {
      setDetecting(true);
      if (!gpsCoords) return;
      const [place] = await Location.reverseGeocodeAsync({
        latitude: gpsCoords.latitude,
        longitude: gpsCoords.longitude,
      });
      // place.region = state name in India, subregion = district
      const locStr = [place?.region, place?.subregion, place?.city]
        .filter(Boolean).join(', ');
      const detected = detectStateFromLocation(locStr);
      if (detected) switchState(detected);
    } catch (e) {
      // reverseGeocode failed — keep current state
    } finally {
      setDetecting(false);
    }
  }, [switchState, gpsCoords]);

  // Auto-detect on first load only when no state was passed by caller
  useEffect(() => {
    if (!initialState) detectLocation();
  }, []);

  const openCropDetail = (crop) => {
    navigation.navigate('CropDetail', { crop, cropName: crop.name });
  };

  if (!stateData) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Text style={{ textAlign: 'center', marginTop: 60, color: COLORS.textMedium }}>
          {t('stateCrops.noData')}
        </Text>
      </SafeAreaView>
    );
  }

  const headerGradient = [COLORS.mediumGreen, COLORS.primary]; // forest green header

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={headerGradient[0]} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{t('stateCrops.title')}</Text>
          <Text style={styles.headerSub}>{t('stateCrops.subTitle')}</Text>
        </View>
        {detecting && <ActivityIndicator color={COLORS.white} size="small" style={{ marginRight: 8 }} />}
        <TouchableOpacity style={styles.locationBtn} onPress={detectLocation}>
          <Ionicons name="location-outline" size={20} color={COLORS.white} />
        </TouchableOpacity>
      </View>

      {/* State selector chip */}
      <TouchableOpacity style={styles.stateSelectorBar} onPress={() => setPickerVisible(true)} activeOpacity={0.8}>
        <Text style={styles.stateSelectorIcon}>{stateData.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.stateSelectorName}>{stateSplitName(selectedState)}</Text>
          <Text style={styles.stateSelectorHi}>{stateData.nameHi}</Text>
        </View>
        <View style={styles.changeBtn}>
          <Text style={styles.changeBtnText}>{t('stateCrops.change')}</Text>
          <Ionicons name="chevron-down" size={14} color={COLORS.primary} />
        </View>
      </TouchableOpacity>

      <Animated.ScrollView style={{ flex: 1, opacity: fadeAnim }} showsVerticalScrollIndicator={false}>

        {/* State Overview Card */}
        <View style={styles.overviewCard}>
          <View style={styles.overviewRow}>
            <View style={styles.overviewItem}>
              <Ionicons name="partly-sunny-outline" size={18} color={SKY} />
              <Text style={styles.overviewLabel}>{t('stateCrops.climate')}</Text>
              <Text style={styles.overviewVal}>{stateData.climate}</Text>
            </View>
            <View style={styles.overviewDivider} />
            <View style={styles.overviewItem}>
              <Ionicons name="star-outline" size={18} color={COLORS.gold} />
              <Text style={styles.overviewLabel}>{t('stateCrops.specialty')}</Text>
              <Text style={styles.overviewVal}>{stateData.specialty}</Text>
            </View>
          </View>

          {/* Soil types */}
          <View style={styles.overviewChipRow}>
            <Ionicons name="layers-outline" size={14} color={EARTH} style={{ marginRight: 6 }} />
            <Text style={styles.overviewChipHead}>{t('stateCrops.soilLabel')}</Text>
            <Text style={styles.overviewChipBody}>{stateData.soilTypes.join(' · ')}</Text>
          </View>

          {/* Water sources */}
          <View style={styles.overviewChipRow}>
            <Ionicons name="water-outline" size={14} color={SKY} style={{ marginRight: 6 }} />
            <Text style={styles.overviewChipHead}>{t('stateCrops.waterLabel')}</Text>
            <Text style={styles.overviewChipBody}>{stateData.waterSources.join(' · ')}</Text>
          </View>
        </View>

        {/* Farming Types */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('stateCrops.farmingTypes')}</Text>
          <View style={styles.ftRow}>
            {stateData.farmingTypes.map((ft) => (
              <FarmingTypeChip key={ft.id} item={ft} />
            ))}
          </View>
        </View>

        {/* Crops */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {stateData.crops.length} {t('stateCrops.keyCrops')}
          </Text>
          {stateData.crops.map((crop) => (
            <CropCard key={crop.id} crop={crop} onPress={openCropDetail} t={t} />
          ))}
        </View>

        {/* Quick state switcher chips (horizontal scroll) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('stateCrops.otherStates')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
            {STATE_LIST.filter((s) => s !== selectedState).map((s) => (
              <TouchableOpacity
                key={s}
                style={styles.quickStateChip}
                onPress={() => switchState(s)}
                activeOpacity={0.8}
              >
                <Text style={styles.quickStateIcon}>{STATE_CROPS[s]?.icon || '🌾'}</Text>
                <Text style={styles.quickStateName}>{stateSplitName(s)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={{ height: 30 }} />
      </Animated.ScrollView>

      <StatePicker
        visible={pickerVisible}
        selectedState={selectedState}
        onSelect={switchState}
        onClose={() => setPickerVisible(false)}
        t={t}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 14, gap: 10,
    backgroundColor: COLORS.mediumGreen,
  },
  backBtn:    { padding: 6 },
  headerTitle:{ fontSize: 18, fontWeight: '800', color: COLORS.white },
  headerSub:  { fontSize: 12, color: COLORS.paleGreen, marginTop: 2 },
  locationBtn:{ padding: 8, backgroundColor: 'rgba(255,255,255,0.13)', borderRadius: 20 },

  stateSelectorBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.white, marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, gap: 12,
    ...SHADOWS.small,
  },
  stateSelectorIcon: { fontSize: 32 },
  stateSelectorName: { fontSize: 17, fontWeight: '800', color: COLORS.textDark },
  stateSelectorHi:   { fontSize: 13, color: COLORS.textMedium, marginTop: 2 },
  changeBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primaryPale, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  changeBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.primary },

  overviewCard: {
    backgroundColor: COLORS.white, borderRadius: 16, marginHorizontal: 16, marginTop: 12,
    padding: 16, gap: 10, ...SHADOWS.small,
  },
  overviewRow: { flexDirection: 'row', gap: 8 },
  overviewItem: { flex: 1, gap: 4 },
  overviewLabel: { fontSize: 11, color: COLORS.textLight, fontWeight: '600', marginTop: 4 },
  overviewVal:   { fontSize: 13, color: COLORS.textDark, fontWeight: '700', lineHeight: 18 },
  overviewDivider: { width: 1, backgroundColor: COLORS.border },
  overviewChipRow: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap' },
  overviewChipHead: { fontSize: 12, fontWeight: '800', color: COLORS.textDark },
  overviewChipBody: { fontSize: 12, color: COLORS.textMedium, flex: 1, lineHeight: 18 },

  section: { paddingHorizontal: 16, paddingTop: 20 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: COLORS.textDark, marginBottom: 12 },

  ftRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  ftChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 8,
  },
  ftIcon:  { fontSize: 18 },
  ftLabel: { fontSize: 13, fontWeight: '700' },

  cropCard: {
    backgroundColor: COLORS.white, borderRadius: 16, marginBottom: 14,
    overflow: 'hidden', ...SHADOWS.small,
  },
  seasonBadge: { paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start', borderBottomRightRadius: 12 },
  seasonText: { fontSize: 11, fontWeight: '800' },
  cropCardTop: { flexDirection: 'row', alignItems: 'center', padding: 14, paddingTop: 10 },
  cropEmoji: { fontSize: 38 },
  cropName: { fontSize: 16, fontWeight: '800', color: COLORS.textDark },
  cropNameHi: { fontSize: 13, color: COLORS.textMedium, fontWeight: '600', marginTop: 2 },
  cropDesc: { fontSize: 12, color: COLORS.textLight, lineHeight: 17, marginTop: 4 },
  cropMeta: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: COLORS.divider },
  cropMetaItem: { flex: 1, paddingVertical: 10, alignItems: 'center', gap: 3 },
  cropMetaDivider: { width: 1, backgroundColor: COLORS.divider },
  cropMetaLabel: { fontSize: 10, color: COLORS.textLight, fontWeight: '600' },
  cropMetaVal: { fontSize: 11, color: COLORS.textDark, fontWeight: '700', textAlign: 'center' },

  quickStateChip: {
    backgroundColor: COLORS.white, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    alignItems: 'center', gap: 4, minWidth: 80, ...SHADOWS.xs,
  },
  quickStateIcon: { fontSize: 22 },
  quickStateName: { fontSize: 11, fontWeight: '700', color: COLORS.textDark, textAlign: 'center' },

  // Picker modal
  pickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.33)' },
  pickerSheet: {
    backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 36 : 16,
  },
  pickerHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.gray150, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  pickerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textDark },
  pickerSearch: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 8, backgroundColor: COLORS.background,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
  },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  pickerItemActive: { backgroundColor: COLORS.primaryPale },
  pickerItemIcon: { fontSize: 24 },
  pickerItemName: { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  pickerItemHi: { fontSize: 12, color: COLORS.textMedium, marginTop: 2 },
});

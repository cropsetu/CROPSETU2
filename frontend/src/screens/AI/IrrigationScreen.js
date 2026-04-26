/**
 * IrrigationScreen — Smart irrigation scheduling (FAO ET₀)
 *
 * Flow:
 *  1. User selects crop → fetch today's recommendation
 *  2. Hero card shows shouldIrrigate + reason + water amount
 *  3. User marks logId as 'irrigated' or 'skipped'
 *  4. 7-day strip forecast
 *
 * Backend:
 *  GET /irrigation/today?crop=Soybean&lat=18.52&lon=73.85  → { shouldIrrigate, reason, et0, kc, rainfall, waterAmount, weeklyForecast, id }
 *  POST /irrigation/log { logId, farmerAction }             → update existing log
 */
import { COLORS } from '../../constants/colors';
import { CropIcon } from '../../components/CropIcons';
import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, StatusBar, Modal, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { getIrrigationToday, logIrrigation, getCrops } from '../../services/aiApi';
import { useLocation } from '../../context/LocationContext';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export default function IrrigationScreen({ navigation }) {
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const { coords: gpsCoords } = useLocation();

  const [today, setToday]       = useState(null);
  const [logId, setLogId]       = useState(null);
  const [loggedAction, setLoggedAction] = useState(null); // 'irrigated' | 'skipped'
  const [weekly, setWeekly]     = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [crops, setCrops]       = useState([]);
  const [cropModal, setCropModal] = useState(false);
  const [selectedCrop, setSelectedCrop] = useState(user?.crops?.[0] || '');
  const [logging, setLogging]   = useState(false);

  const fetchRecommendation = useCallback(async (crop) => {
    if (!crop) {
      setCropModal(true);
      return;
    }
    setLoading(true);
    setError(null);
    setToday(null);
    setLogId(null);
    setLoggedAction(null);
    try {
      const lat = gpsCoords?.latitude  ?? 18.52;
      const lon = gpsCoords?.longitude ?? 73.85;

      const result = await getIrrigationToday({ crop, lat, lon });
      setToday(result);
      setLogId(result?.id || null);
      setWeekly(result?.weeklyForecast || []);
    } catch (err) {
      setError(err?.response?.data?.error?.message || t('irrigation.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [language]);

  // Load crops list lazily when modal opened
  const openCropModal = async () => {
    if (!crops.length) {
      getCrops().then(setCrops).catch(() => {});
    }
    setCropModal(true);
  };

  const selectCrop = (name) => {
    setSelectedCrop(name);
    setCropModal(false);
    fetchRecommendation(name);
  };

  const markAction = async (action) => {
    if (!logId) return;
    setLogging(true);
    try {
      await logIrrigation({ logId, farmerAction: action });
      setLoggedAction(action);
    } catch {}
    setLogging(false);
  };

  const shouldIrrigate = today?.shouldIrrigate;

  return (
    <AnimatedScreen style={S.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>{t('irrigation.title')}</Text>
          <Text style={S.headerSub}>FAO ET₀ · Open-Meteo</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={S.scroll}>

        {/* Crop selector */}
        <TouchableOpacity style={S.cropSelect} onPress={openCropModal}>
          <Ionicons name="leaf-outline" size={16} color={COLORS.primary} />
          <Text style={[S.cropSelectTxt, selectedCrop && { color: COLORS.textDark }]}>
            {selectedCrop || t('irrigation.selectCrop')}
          </Text>
          <Ionicons name="chevron-down" size={14} color={COLORS.oliveGreen} />
        </TouchableOpacity>

        {!selectedCrop && !loading && (
          <View style={S.promptCard}>
            <Ionicons name="water-outline" size={36} color={COLORS.oliveGreen} />
            <Text style={S.promptTxt}>
              {t('irrigation.prompt')}
            </Text>
          </View>
        )}

        {/* Loading */}
        {loading && (
          <View style={S.centered}>
            <ActivityIndicator color={COLORS.primary} size="large" />
            <Text style={S.loadingTxt}>{t('irrigation.computing')}</Text>
          </View>
        )}

        {/* Error */}
        {error && !loading && (
          <View style={S.centered}>
            <Ionicons name="cloud-offline-outline" size={48} color={COLORS.grayMid2} />
            <Text style={S.errorTxt}>{error}</Text>
            <TouchableOpacity style={S.retryBtn} onPress={() => fetchRecommendation(selectedCrop)}>
              <Text style={S.retryTxt}>{t('irrigation.retry')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Hero card */}
        {today && !loading && (
          <>
            <LinearGradient
              colors={shouldIrrigate ? [COLORS.darkForest, COLORS.forestDeep] : [COLORS.midnightBlue, COLORS.navyNight]}
              style={S.heroCard}
            >
              <View style={S.heroIcon}>
                <Ionicons
                  name={shouldIrrigate ? 'water' : 'checkmark-circle'}
                  size={40}
                  color={shouldIrrigate ? COLORS.blue : COLORS.primary}
                />
              </View>

              <Text style={[S.heroTitle, { color: shouldIrrigate ? COLORS.blue : COLORS.primary }]}>
                {shouldIrrigate
                  ? t('irrigation.irrigateToday')
                  : t('irrigation.noIrrigationNeeded')}
              </Text>

              {today.reason ? <Text style={S.heroReason}>{today.reason}</Text> : null}

              {today.waterAmount != null && (
                <View style={S.heroStat}>
                  <Ionicons name="water-outline" size={14} color={COLORS.blue} />
                  <Text style={S.heroStatTxt}>
                    {t('irrigation.waterRequired', { amount: today.waterAmount })}
                  </Text>
                </View>
              )}

              {/* ET0 / Kc / Rainfall stats */}
              <View style={S.heroGrid}>
                {today.et0    != null && <View style={S.heroGridItem}><Text style={S.heroGridVal}>{Number(today.et0).toFixed(1)}</Text><Text style={S.heroGridLabel}>ET₀ mm</Text></View>}
                {today.kc     != null && <View style={S.heroGridItem}><Text style={S.heroGridVal}>{today.kc}</Text><Text style={S.heroGridLabel}>Kc</Text></View>}
                {today.rainfall != null && <View style={S.heroGridItem}><Text style={S.heroGridVal}>{today.rainfall}</Text><Text style={S.heroGridLabel}>{t('irrigation.rainMm')}</Text></View>}
              </View>

              {/* Mark action */}
              {logId && !loggedAction && (
                <View style={S.actionRow}>
                  <TouchableOpacity
                    style={[S.actionBtn, { backgroundColor: 'rgba(52,152,219,0.20)', borderColor: 'rgba(52,152,219,0.25)' }]}
                    onPress={() => markAction('irrigated')}
                    disabled={logging}
                  >
                    <Ionicons name="water" size={16} color={COLORS.blue} />
                    <Text style={[S.actionTxt, { color: COLORS.blue }]}>
                      {t('irrigation.iIrrigated')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[S.actionBtn, { backgroundColor: 'rgba(107,114,128,0.15)', borderColor: 'rgba(107,114,128,0.25)' }]}
                    onPress={() => markAction('skipped')}
                    disabled={logging}
                  >
                    <Ionicons name="close-circle-outline" size={16} color={COLORS.gray550} />
                    <Text style={[S.actionTxt, { color: COLORS.textMedium }]}>
                      {t('irrigation.skipped')}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              {loggedAction && (
                <View style={S.loggedBadge}>
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.primary} />
                  <Text style={S.loggedTxt}>
                    {loggedAction === 'irrigated'
                      ? t('irrigation.loggedIrrigated')
                      : t('irrigation.loggedSkipped')}
                  </Text>
                </View>
              )}
            </LinearGradient>

            {/* 7-day forecast strip */}
            {weekly.length > 0 && (
              <>
                <Text style={S.sectionLabel}>
                  {t('irrigation.sevenDayForecast')}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.forecastContent}>
                  {weekly.map((day, i) => {
                    const d = new Date(day.date);
                    return (
                      <View key={i} style={[S.dayCard, day.shouldIrrigate && S.dayCardNeedsWater]}>
                        <Text style={S.dayLabel}>{WEEKDAYS[d.getDay()]}</Text>
                        <Text style={S.dayDate}>{d.getDate()}</Text>
                        <Ionicons
                          name={day.shouldIrrigate ? 'water' : 'checkmark-circle-outline'}
                          size={20}
                          color={day.shouldIrrigate ? COLORS.blue : COLORS.primary}
                        />
                        {day.rainfall > 0 && (
                          <View style={S.rainRow}>
                            <Ionicons name="rainy-outline" size={10} color={COLORS.blue} />
                            <Text style={S.rainTxt}>{day.rainfall}mm</Text>
                          </View>
                        )}
                        {day.et0 != null && <Text style={S.dayEt0}>ET₀ {Number(day.et0).toFixed(1)}</Text>}
                      </View>
                    );
                  })}
                </ScrollView>
              </>
            )}
          </>
        )}

        {/* Info card */}
        <View style={S.infoCard}>
          <Ionicons name="information-circle-outline" size={16} color={COLORS.primary} />
          <Text style={S.infoTxt}>
            {t('irrigation.infoNote')}
          </Text>
        </View>
      </ScrollView>

      {/* Crop picker modal */}
      <Modal visible={cropModal} transparent animationType="slide">
        <View style={S.modalOverlay}>
          <View style={S.modalSheet}>
            <Text style={S.modalTitle}>{t('irrigation.selectCropTitle')}</Text>
            {!crops.length ? (
              <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 20 }} />
            ) : (
              <FlatList
                windowSize={7}
                maxToRenderPerBatch={18}
                data={crops}
                keyExtractor={(item) => item.id || item.name}
                renderItem={({ item }) => (
                  <TouchableOpacity style={S.modalItem} onPress={() => selectCrop(item.name)}>
                    <CropIcon crop={item.name} size={32} />
                    <View style={{ flex: 1 }}>
                      <Text style={[S.modalItemTxt, item.name === selectedCrop && { color: COLORS.primary }]}>{item.name}</Text>
                      {item.nameHi ? <Text style={S.modalItemHi}>{item.nameHi}</Text> : null}
                    </View>
                  </TouchableOpacity>
                )}
              />
            )}
            <TouchableOpacity style={S.modalClose} onPress={() => setCropModal(false)}>
              <Text style={S.modalCloseTxt}>{t('irrigation.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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

  scroll: { paddingBottom: 40 },

  cropSelect: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 18, marginBottom: 12,
    backgroundColor: COLORS.surface, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 13,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cropSelectTxt: { flex: 1, fontSize: 14, color: COLORS.textMedium, fontWeight: '600' },

  promptCard: {
    marginHorizontal: 18, borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
    alignItems: 'center', gap: 12,
  },
  promptTxt: { fontSize: 13, color: COLORS.textLight, textAlign: 'center', lineHeight: 20 },

  heroCard: {
    margin: 18, marginTop: 4, borderRadius: 20, padding: 22,
    alignItems: 'center', gap: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  heroIcon: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: COLORS.surfaceSunkenAlt,
    justifyContent: 'center', alignItems: 'center',
  },
  heroTitle:  { fontSize: 20, fontWeight: '900', textAlign: 'center' },
  heroReason: { fontSize: 13, color: COLORS.textMedium, textAlign: 'center', lineHeight: 20 },
  heroStat: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(52,152,219,0.10)', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  heroStatTxt: { fontSize: 13, color: COLORS.blue, fontWeight: '700' },
  heroGrid: { flexDirection: 'row', gap: 24, marginTop: 4 },
  heroGridItem: { alignItems: 'center' },
  heroGridVal:   { fontSize: 16, fontWeight: '900', color: COLORS.textDark },
  heroGridLabel: { fontSize: 10, color: COLORS.textLight, marginTop: 2 },

  actionRow: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 4 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 12, paddingVertical: 11, borderWidth: 1,
  },
  actionTxt: { fontSize: 13, fontWeight: '700' },
  loggedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(23,107,67,0.08)', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  loggedTxt: { fontSize: 13, color: COLORS.primary, fontWeight: '700' },

  sectionLabel: {
    fontSize: 11, fontWeight: '900', color: COLORS.textMedium,
    letterSpacing: 1.2, textTransform: 'uppercase',
    marginHorizontal: 18, marginTop: 6, marginBottom: 10,
  },
  forecastContent: { paddingHorizontal: 18, gap: 8 },
  dayCard: {
    width: 66, backgroundColor: COLORS.surface, borderRadius: 14, padding: 10,
    alignItems: 'center', gap: 5, borderWidth: 1, borderColor: COLORS.border,
  },
  dayCardNeedsWater: { borderColor: 'rgba(52,152,219,0.40)' },
  dayLabel: { fontSize: 10, color: COLORS.textMedium, fontWeight: '700' },
  dayDate:  { fontSize: 14, color: COLORS.textDark, fontWeight: '800' },
  rainRow:  { flexDirection: 'row', alignItems: 'center', gap: 2 },
  rainTxt:  { fontSize: 9, color: COLORS.blue, fontWeight: '700' },
  dayEt0:   { fontSize: 9, color: COLORS.textLight },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginHorizontal: 18, marginTop: 16,
    backgroundColor: 'rgba(46,204,113,0.04)',
    borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  infoTxt: { flex: 1, fontSize: 12, color: COLORS.textLight, lineHeight: 18 },

  centered: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  loadingTxt: { fontSize: 14, color: COLORS.textLight },
  errorTxt:   { fontSize: 13, color: COLORS.error, textAlign: 'center', paddingHorizontal: 20 },
  retryBtn: { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  retryTxt: { fontSize: 14, fontWeight: '700', color: COLORS.white },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: COLORS.white, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '60%', padding: 18,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textDark, marginBottom: 14 },
  modalItem: {
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  modalItemTxt: { fontSize: 14, color: COLORS.textBody, fontWeight: '600' },
  modalItemHi:  { fontSize: 13, color: COLORS.textLight },
  modalClose: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  modalCloseTxt: { fontSize: 14, color: COLORS.error, fontWeight: '700' },
});

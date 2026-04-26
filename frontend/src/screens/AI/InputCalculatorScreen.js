/**
 * InputCalculatorScreen — Seed, fertilizer, labour & pesticide cost estimator
 *
 * Flow:
 *  - Select crop + enter area + unit
 *  - Tap Calculate → itemized cost list by category
 *  - Summary card: total cost, cost per acre, yield range
 */
import { COLORS } from '../../constants/colors';
import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, StatusBar, FlatList, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../../context/LanguageContext';
import { calculateInputs, getCrops } from '../../services/aiApi';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const CATEGORY_ICONS = {
  'Seed':        { icon: 'ellipse',           color: COLORS.freshGreen },
  'Fertilizer':  { icon: 'flask',             color: COLORS.amberDark },
  'Labour':      { icon: 'people',            color: COLORS.blue },
  'Pesticides':  { icon: 'bug',               color: COLORS.red },
  'Irrigation':  { icon: 'water',             color: COLORS.oceanBlue },
};

const UNITS = ['acre', 'hectare', 'bigha', 'guntha'];

function getCategoryConfig(category) {
  const key = Object.keys(CATEGORY_ICONS).find(k => category?.includes(k));
  return CATEGORY_ICONS[key] || { icon: 'cube', color: COLORS.textMedium };
}

function CostItem({ item }) {
  const cfg = getCategoryConfig(item.category);
  return (
    <View style={S.costItem}>
      <View style={[S.costIcon, { backgroundColor: cfg.color + '18' }]}>
        <Ionicons name={cfg.icon + '-outline'} size={18} color={cfg.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={S.itemCategory}>{item.category}</Text>
        <Text style={S.itemName} numberOfLines={1}>{item.name}</Text>
        {item.quantity != null && (
          <Text style={S.itemQty}>
            {item.quantity} {item.unit}
            {item.unitPrice ? ` · ${item.unitPrice}` : ''}
          </Text>
        )}
        {item.note ? <Text style={S.itemNote} numberOfLines={1}>{item.note}</Text> : null}
      </View>
      <Text style={[S.itemCost, { color: item.cost ? COLORS.parchment : COLORS.oliveGreen }]}>
        {item.cost != null ? `₹${item.cost.toLocaleString()}` : 'Market'}
      </Text>
    </View>
  );
}

export default function InputCalculatorScreen({ navigation }) {
  const { language, t } = useLanguage();
  const [crop, setCrop]         = useState('');
  const [area, setArea]         = useState('');
  const [unit, setUnit]         = useState('acre');
  const [organic, setOrganic]   = useState(false);
  const [result, setResult]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [crops, setCrops]       = useState([]);
  const [cropModal, setCropModal] = useState(false);
  const [unitModal, setUnitModal] = useState(false);

  useEffect(() => {
    getCrops().then(setCrops).catch(() => {});
  }, []);

  const handleCalculate = async () => {
    if (!crop) {
      setError(t('inputCalc.selectACrop'));
      return;
    }
    if (!area || isNaN(parseFloat(area)) || parseFloat(area) <= 0) {
      setError(t('inputCalc.enterAValidArea'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const data = await calculateInputs(crop, parseFloat(area), unit, organic);
      setResult(data);
    } catch (err) {
      setError(err?.response?.data?.error?.message || 'Calculation failed');
    } finally {
      setLoading(false);
    }
  };

  const BREAKDOWN_KEYS = [
    { key: 'seed',        label: t('inputCalc.seed'),       color: COLORS.freshGreen },
    { key: 'fertilizer',  label: t('inputCalc.fertilizer'), color: COLORS.amberDark },
    { key: 'labour',      label: t('inputCalc.labour'),   color: COLORS.blue },
    { key: 'pesticide',   label: t('inputCalc.pesticides'), color: COLORS.red },
    { key: 'irrigation',  label: t('inputCalc.irrigation'), color: COLORS.oceanBlue },
  ];

  return (
    <AnimatedScreen style={S.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>{t('inputCalc.inputCalculator')}</Text>
          <Text style={S.headerSub}>{t('inputCalc.seedFertilizerLabour')}</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={S.scroll}>

        {/* Crop selector */}
        <TouchableOpacity style={S.cropSelect} onPress={() => setCropModal(true)}>
          <Ionicons name="leaf-outline" size={16} color={COLORS.primary} />
          <Text style={[S.cropSelectTxt, crop && { color: COLORS.textDark }]}>
            {crop || (t('inputCalc.selectCrop'))}
          </Text>
          <Ionicons name="chevron-down" size={16} color={COLORS.oliveGreen} />
        </TouchableOpacity>

        {/* Area + unit */}
        <View style={S.areaRow}>
          <TextInput
            style={[S.input, { flex: 1 }]}
            placeholder={t('inputCalc.areaNumber')}
            placeholderTextColor={COLORS.textLight}
            keyboardType="decimal-pad"
            value={area}
            onChangeText={setArea}
          />
          <TouchableOpacity style={S.unitBtn} onPress={() => setUnitModal(true)}>
            <Text style={S.unitBtnTxt}>{unit}</Text>
            <Ionicons name="chevron-down" size={13} color={COLORS.oliveGreen} />
          </TouchableOpacity>
        </View>

        {/* Organic toggle */}
        <TouchableOpacity style={S.organicRow} onPress={() => setOrganic(o => !o)}>
          <View style={[S.toggle, organic && S.toggleActive]}>
            {organic && <Ionicons name="checkmark" size={12} color={COLORS.white} />}
          </View>
          <Text style={S.organicTxt}>{t('inputCalc.organicFarmingMode')}</Text>
        </TouchableOpacity>

        {error ? <Text style={S.errorTxt}>{error}</Text> : null}

        <TouchableOpacity style={[S.calcBtn, loading && { opacity: 0.6 }]} onPress={handleCalculate} disabled={loading}>
          {loading ? <ActivityIndicator color={COLORS.white} /> : (
            <Text style={S.calcTxt}>{t('inputCalc.calculateCost')}</Text>
          )}
        </TouchableOpacity>

        {/* Results */}
        {result && (
          <>
            {/* Summary */}
            <View style={S.summaryCard}>
              <Text style={S.summaryTitle}>
                {result.crop} · {result.areaAcres} {t('inputCalc.acres')}
              </Text>
              <Text style={S.totalCost}>₹{result.summary?.totalCost?.toLocaleString()}</Text>
              <Text style={S.perAcre}>
                ₹{result.summary?.costPerAcre?.toLocaleString()} {t('inputCalc.acre')}
              </Text>
              {result.summary?.yieldRange && typeof result.summary.yieldRange === 'object' && (
                <Text style={S.yieldRange}>
                  {t('inputCalc.yield')} {result.summary.yieldRange.min}–{result.summary.yieldRange.max} {result.summary.yieldRange.unit || 'q/acre'}
                </Text>
              )}
            </View>

            {/* Breakdown bars */}
            {result.costBreakdown && (
              <View style={S.breakdownCard}>
                <Text style={S.breakdownTitle}>{t('inputCalc.costBreakdown')}</Text>
                {BREAKDOWN_KEYS.map(({ key, label, color }) => {
                  const val = result.costBreakdown[key];
                  if (!val) return null;
                  const pct = Math.round((val / result.summary.totalCost) * 100);
                  return (
                    <View key={key} style={S.breakdownRow}>
                      <Text style={S.bdLabel}>{label}</Text>
                      <View style={S.bdBarTrack}>
                        <View style={[S.bdBarFill, { width: `${pct}%`, backgroundColor: color }]} />
                      </View>
                      <Text style={S.bdVal}>₹{val.toLocaleString()}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Item list */}
            <Text style={S.sectionLabel}>{t('inputCalc.itemizedDetails')}</Text>
            {result.items?.map((item, i) => <CostItem key={i} item={item} />)}

            <Text style={S.disclaimer}>{result.disclaimer}</Text>
          </>
        )}
      </ScrollView>

      {/* Crop picker modal */}
      <Modal visible={cropModal} transparent animationType="slide">
        <View style={S.modalOverlay}>
          <View style={S.modalSheet}>
            <Text style={S.modalTitle}>{t('inputCalc.selectCrop')}</Text>
            <FlatList
              windowSize={5}
              maxToRenderPerBatch={10}
              removeClippedSubviews
              data={crops}
              keyExtractor={(_, i) => String(i)}
              renderItem={({ item }) => (
                <TouchableOpacity style={S.modalItem} onPress={() => { setCrop(item.name); setCropModal(false); }}>
                  <Text style={S.modalItemTxt}>{item.name}</Text>
                  {item.nameHi ? <Text style={S.modalItemHi}>{item.nameHi}</Text> : null}
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={S.modalClose} onPress={() => setCropModal(false)}>
              <Text style={S.modalCloseTxt}>{t('inputCalc.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Unit picker modal */}
      <Modal visible={unitModal} transparent animationType="slide">
        <View style={S.modalOverlay}>
          <View style={S.modalSheet}>
            <Text style={S.modalTitle}>{t('inputCalc.selectUnit')}</Text>
            {UNITS.map(u => (
              <TouchableOpacity key={u} style={S.modalItem} onPress={() => { setUnit(u); setUnitModal(false); }}>
                <Text style={[S.modalItemTxt, u === unit && { color: COLORS.primary }]}>{u}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={S.modalClose} onPress={() => setUnitModal(false)}>
              <Text style={S.modalCloseTxt}>{t('inputCalc.cancel')}</Text>
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

  scroll: { padding: 18, paddingBottom: 40, gap: 12 },

  cropSelect: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cropSelectTxt: { flex: 1, fontSize: 14, color: COLORS.textMedium },

  areaRow: { flexDirection: 'row', gap: 10 },
  input: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: COLORS.border,
    color: COLORS.textBody, fontSize: 14,
  },
  unitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.surface, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: COLORS.border,
  },
  unitBtnTxt: { fontSize: 13, color: COLORS.textBody, fontWeight: '700' },

  organicRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toggle: {
    width: 24, height: 24, borderRadius: 6,
    borderWidth: 1.5, borderColor: COLORS.oliveGreen,
    justifyContent: 'center', alignItems: 'center',
  },
  toggleActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  organicTxt: { fontSize: 14, color: COLORS.textMedium, fontWeight: '600' },

  errorTxt: { fontSize: 13, color: COLORS.error },
  calcBtn: {
    backgroundColor: COLORS.primary, borderRadius: 14,
    paddingVertical: 15, alignItems: 'center',
  },
  calcTxt: { fontSize: 16, fontWeight: '800', color: COLORS.white },

  summaryCard: {
    backgroundColor: 'rgba(46,204,113,0.07)', borderRadius: 18,
    padding: 20, alignItems: 'center', borderWidth: 1, borderColor: COLORS.primary + '35',
    gap: 4,
  },
  summaryTitle: { fontSize: 13, color: COLORS.textLight, fontWeight: '700' },
  totalCost:  { fontSize: 32, fontWeight: '900', color: COLORS.primary },
  perAcre:    { fontSize: 13, color: COLORS.textMedium },
  yieldRange: { fontSize: 12, color: COLORS.textLight, marginTop: 4 },

  breakdownCard: {
    backgroundColor: COLORS.surface, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: COLORS.border, gap: 10,
  },
  breakdownTitle: { fontSize: 13, fontWeight: '800', color: COLORS.textDark, marginBottom: 4 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bdLabel: { width: 76, fontSize: 11, color: COLORS.textMedium, fontWeight: '600' },
  bdBarTrack: { flex: 1, height: 6, backgroundColor: COLORS.surfaceSunkenAlt, borderRadius: 3, overflow: 'hidden' },
  bdBarFill: { height: 6, borderRadius: 3 },
  bdVal: { width: 70, fontSize: 11, color: COLORS.textDark, fontWeight: '700', textAlign: 'right' },

  sectionLabel: {
    fontSize: 11, fontWeight: '900', color: COLORS.textMedium,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  costItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 13,
    borderWidth: 1, borderColor: COLORS.border,
  },
  costIcon: { width: 38, height: 38, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  itemCategory: { fontSize: 10, color: COLORS.textLight, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  itemName: { fontSize: 13, color: COLORS.textDark, fontWeight: '700', marginTop: 2 },
  itemQty:  { fontSize: 11, color: COLORS.textMedium, marginTop: 2 },
  itemNote: { fontSize: 10, color: COLORS.textLight, marginTop: 2 },
  itemCost: { fontSize: 15, fontWeight: '800', marginTop: 2 },

  disclaimer: { fontSize: 11, color: COLORS.textLight, lineHeight: 17, marginTop: 4 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '60%', padding: 18 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textDark, marginBottom: 14 },
  modalItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border, flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalItemTxt: { fontSize: 14, color: COLORS.textBody, fontWeight: '600', flex: 1 },
  modalItemHi:  { fontSize: 13, color: COLORS.textLight },
  modalClose: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  modalCloseTxt: { fontSize: 14, color: COLORS.error, fontWeight: '700' },
});

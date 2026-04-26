/**
 * SoilHealthScreen — Manual soil parameter entry + ICAR-based recommendations
 *
 * Backend field names:
 *   ph, nitrogen, phosphorus, potassium, organicCarbon, ec, zinc, boron, sulphur
 * Backend ratings shape:
 *   { rating, ratingHi, color, advice }
 * Recommendation endpoint:
 *   GET /soil/recommendation?soilId=xxx&crop=Wheat&area=1&unit=acre
 * Recommendation returns:
 *   { fertilizers: [{ name, qty, unit, adjustment }] }
 */
import { COLORS } from '../../constants/colors';
import { CropIcon } from '../../components/CropIcons';
import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, StatusBar, Modal, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../../context/LanguageContext';
import { submitSoilReport, getSoilReports, getCrops } from '../../services/aiApi';
import api from '../../services/api';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

// Backend field name → UI label mapping
const PARAM_FIELDS = [
  { key: 'ph',            label: 'pH',                hi: 'पीएच',            unit: '',        hint: '6.5–7.5', required: true },
  { key: 'nitrogen',      label: 'Nitrogen (N)',       hi: 'नाइट्रोजन',       unit: 'kg/ha',   hint: '>280',    required: true },
  { key: 'phosphorus',    label: 'Phosphorus (P)',     hi: 'फास्फोरस',        unit: 'kg/ha',   hint: '>20',     required: true },
  { key: 'potassium',     label: 'Potassium (K)',      hi: 'पोटाश',           unit: 'kg/ha',   hint: '>280',    required: true },
  { key: 'organicCarbon', label: 'Organic Carbon',    hi: 'जैव कार्बन',      unit: '%',       hint: '>0.75',   required: false },
  { key: 'ec',            label: 'EC',                hi: 'लवणता (EC)',       unit: 'dS/m',    hint: '<0.8',    required: false },
  { key: 'zinc',          label: 'Zinc (Zn)',          hi: 'जिंक',            unit: 'ppm',     hint: '>0.6',    required: false },
  { key: 'boron',         label: 'Boron (B)',          hi: 'बोरॉन',           unit: 'ppm',     hint: '>0.5',    required: false },
  { key: 'sulphur',       label: 'Sulphur (S)',        hi: 'सल्फर',           unit: 'ppm',     hint: '>10',     required: false },
];

// rating values from backend: optimal, low, medium, high, acidic, alkaline, slightly_acidic, slightly_alkaline, highly_alkaline, sufficient, low_ec
const RATING_COLORS = {
  optimal:           COLORS.primary,
  high:              COLORS.primary,
  sufficient:        COLORS.primary,
  low_ec:            COLORS.primary,
  medium:            COLORS.amberDark,
  slightly_acidic:   COLORS.amberDark,
  slightly_alkaline: COLORS.amberDark,
  low:               COLORS.red,
  acidic:            COLORS.red,
  alkaline:          COLORS.red,
  highly_alkaline:   COLORS.red,
};

function HealthBar({ ratingObj, param, language }) {
  if (!ratingObj) return null;
  const color = ratingObj.color || RATING_COLORS[ratingObj.rating] || COLORS.oliveGreen;
  const label = ratingObj[`rating_${language}`] || ratingObj.ratingHi && language === 'hi' ? ratingObj.ratingHi : ratingObj.rating;

  return (
    <View style={S.healthBarCard}>
      <View style={S.healthBarTop}>
        <Text style={S.healthBarLabel}>{param[language] || param.hi && language === 'hi' ? param.hi : param.label}</Text>
        <View style={[S.ratingBadge, { backgroundColor: color + '25' }]}>
          <Text style={[S.ratingTxt, { color }]}>{label?.toUpperCase()}</Text>
        </View>
      </View>
      {/* Visual bar — fill based on rating group */}
      <View style={S.barTrack}>
        <View style={[S.barFill, {
          width: ['optimal','high','sufficient','low_ec'].includes(ratingObj.rating) ? '80%'
               : ['medium','slightly_acidic','slightly_alkaline'].includes(ratingObj.rating) ? '50%' : '25%',
          backgroundColor: color,
        }]} />
      </View>
      {ratingObj.advice ? <Text style={S.adviceTxt} numberOfLines={2}>{ratingObj.advice}</Text> : null}
    </View>
  );
}

export default function SoilHealthScreen({ navigation }) {
  const { language, t } = useLanguage();
  const [tab, setTab]             = useState('form');
  const [formData, setFormData]   = useState({});
  const [fieldName, setFieldName] = useState('');
  const [targetCrop, setTargetCrop] = useState('');
  const [loading, setLoading]     = useState(false);
  const [report, setReport]       = useState(null);
  const [fertilizers, setFertilizers] = useState([]);
  const [history, setHistory]     = useState([]);
  const [crops, setCrops]         = useState([]);
  const [cropModal, setCropModal] = useState(false);
  const [error, setError]         = useState(null);

  useEffect(() => {
    getCrops().then(setCrops).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'history') {
      getSoilReports().then(setHistory).catch(() => {});
    }
  }, [tab]);

  const setField = (key, value) => setFormData(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    const required = ['ph', 'nitrogen', 'phosphorus', 'potassium'];
    for (const key of required) {
      if (!formData[key]) {
        setError(t('soilHealth.required') + ': ' + key);
        return;
      }
    }
    setError(null);
    setLoading(true);
    try {
      // Send with exact backend field names
      const payload = {
        fieldName: fieldName || 'My Field',
        ...formData,
      };
      const result = await submitSoilReport(payload);
      setReport(result);

      // Fetch recommendation if target crop is set
      if (targetCrop && result?.id) {
        try {
          const { data } = await api.get('/soil/recommendation', {
            params: { soilId: result.id, crop: targetCrop, area: 1, unit: 'acre' },
          });
          setFertilizers(data?.data?.fertilizers || []);
        } catch {}
      }

      setTab('report');
    } catch (err) {
      setError(err?.response?.data?.error?.message || 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  const loadRecommendation = async (rep, crop) => {
    if (!rep?.id || !crop) return;
    try {
      const { data } = await api.get('/soil/recommendation', {
        params: { soilId: rep.id, crop, area: 1, unit: 'acre' },
      });
      setFertilizers(data?.data?.fertilizers || []);
    } catch {}
  };

  return (
    <AnimatedScreen style={S.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>{t('soilHealth.soilHealth')}</Text>
          <Text style={S.headerSub}>ICAR Soil Health Card Norms</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={S.tabRow}>
        {['form','report','history'].map(tb => (
          <TouchableOpacity key={tb} style={[S.tabBtn, tab === tb && S.tabBtnActive]} onPress={() => setTab(tb)}>
            <Text style={[S.tabTxt, tab === tb && S.tabTxtActive]}>
              {tb === 'form'    ? t('soilHealth.newTest')
               : tb === 'report' ? t('soilHealth.report')
               :                   t('soilHealth.history')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'form' && (
        <ScrollView contentContainerStyle={S.formContent} keyboardShouldPersistTaps="handled">
          <TextInput
            style={S.fieldInput}
            placeholder={t('soilHealth.fieldNameOptional')}
            placeholderTextColor={COLORS.textLight}
            value={fieldName}
            onChangeText={setFieldName}
          />

          <Text style={S.sectionLabel}>{t('soilHealth.enterSoilParameters')}</Text>
          <Text style={S.requiredNote}>* {t('soilHealth.required')}</Text>

          {PARAM_FIELDS.map(f => (
            <View key={f.key} style={S.paramRow}>
              <Text style={S.paramLabel}>
                {f[language] || f.label}
                {f.required ? ' *' : ''}
              </Text>
              <TextInput
                style={S.paramInput}
                placeholder={f.hint}
                placeholderTextColor={COLORS.textLight}
                keyboardType="decimal-pad"
                value={formData[f.key] || ''}
                onChangeText={v => setField(f.key, v)}
              />
              {f.unit ? <Text style={S.paramUnit}>{f.unit}</Text> : <View style={{ width: 44 }} />}
            </View>
          ))}

          <Text style={S.sectionLabel}>{t('soilHealth.targetCropForRecommendations')}</Text>
          <TouchableOpacity style={S.cropSelect} onPress={() => setCropModal(true)}>
            <Ionicons name="leaf-outline" size={16} color={COLORS.primary} />
            <Text style={[S.cropSelectTxt, targetCrop && { color: COLORS.textDark }]}>
              {targetCrop || (t('soilHealth.selectCrop'))}
            </Text>
            <Ionicons name="chevron-down" size={16} color={COLORS.oliveGreen} />
          </TouchableOpacity>

          {error ? <Text style={S.errorTxt}>{error}</Text> : null}

          <TouchableOpacity style={[S.submitBtn, loading && { opacity: 0.6 }]} onPress={handleSubmit} disabled={loading}>
            {loading
              ? <ActivityIndicator color={COLORS.white} />
              : <Text style={S.submitTxt}>{t('soilHealth.analyzeSoil')}</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      )}

      {tab === 'report' && (
        <ScrollView contentContainerStyle={S.reportContent}>
          {!report ? (
            <View style={S.centered}>
              <Ionicons name="flask-outline" size={48} color={COLORS.oliveGreen} />
              <Text style={S.emptyTxt}>{t('soilHealth.submitASoilTestFirst')}</Text>
              <TouchableOpacity style={S.createBtnSmall} onPress={() => setTab('form')}>
                <Text style={S.createBtnSmallTxt}>{t('soilHealth.startTest')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={S.reportTitle}>{report.fieldName || 'My Field'}</Text>
              {report.healthScore != null && (
                <View style={S.healthScoreCard}>
                  <Text style={S.healthScoreLabel}>{t('soilHealth.soilHealthScore')}</Text>
                  <Text style={[S.healthScoreVal, { color: report.healthScore >= 60 ? COLORS.primary : COLORS.amberDark }]}>
                    {report.healthScore}%
                  </Text>
                </View>
              )}

              <Text style={S.sectionLabel}>{t('soilHealth.parameterRatings')}</Text>
              {PARAM_FIELDS.map(f => {
                const ratingObj = report.ratings?.[f.key];
                if (!ratingObj) return null;
                return <HealthBar key={f.key} ratingObj={ratingObj} param={f} language={language} />;
              })}

              {/* Crop selector for getting recommendations */}
              {!fertilizers.length && (
                <View style={S.recPromptCard}>
                  <Text style={S.recPromptTxt}>
                    {t('soilHealth.selectACropToGetFertilizerReco')}
                  </Text>
                  <TouchableOpacity style={S.cropSelect} onPress={() => setCropModal(true)}>
                    <Ionicons name="leaf-outline" size={16} color={COLORS.primary} />
                    <Text style={[S.cropSelectTxt, targetCrop && { color: COLORS.textDark }]}>
                      {targetCrop || (t('soilHealth.selectCrop'))}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={COLORS.oliveGreen} />
                  </TouchableOpacity>
                  {targetCrop ? (
                    <TouchableOpacity style={S.getRecBtn} onPress={() => loadRecommendation(report, targetCrop)}>
                      <Text style={S.getRecBtnTxt}>{t('soilHealth.getRecommendations')}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}

              {fertilizers.length > 0 && (
                <>
                  <Text style={S.sectionLabel}>
                    {t('soilHealth.fertilizerRecommendations')}
                    {targetCrop ? ` — ${targetCrop}` : ''}
                  </Text>
                  {fertilizers.map((f, i) => (
                    <View key={i} style={S.recCard}>
                      <View style={S.recIcon}>
                        <Ionicons name="flask" size={18} color={COLORS.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={S.recFertilizer}>{f.name}</Text>
                        <Text style={S.recDose}>{f.qty} {f.unit}</Text>
                        {f.adjustment ? <Text style={S.recTiming}>{f.adjustment}</Text> : null}
                      </View>
                    </View>
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>
      )}

      {tab === 'history' && (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={10}
          removeClippedSubviews
          data={history}
          keyExtractor={(item, index) => item.id || `soil-${index}`}
          contentContainerStyle={S.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={S.histCard}
              onPress={() => { setReport(item); setFertilizers([]); setTab('report'); }}
            >
              <View style={{ flex: 1 }}>
                <Text style={S.histField}>{item.fieldName || 'Field'}</Text>
                <Text style={S.histDate}>
                  {item.testDate ? new Date(item.testDate).toLocaleDateString() : new Date(item.createdAt).toLocaleDateString()}
                </Text>
                {item.ph != null && <Text style={S.histMeta}>pH {item.ph}</Text>}
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.oliveGreen} />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={S.centered}>
              <Ionicons name="document-outline" size={48} color={COLORS.oliveGreen} />
              <Text style={S.emptyTxt}>{t('soilHealth.noRecordsYet')}</Text>
            </View>
          }
        />
      )}

      {/* Crop picker modal */}
      <Modal visible={cropModal} transparent animationType="slide">
        <View style={S.modalOverlay}>
          <View style={S.modalSheet}>
            <Text style={S.modalTitle}>{t('soilHealth.selectCrop')}</Text>
            <FlatList
              windowSize={7}
              maxToRenderPerBatch={18}
              data={crops}
              keyExtractor={(item) => item.id || item.name}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={S.modalItem}
                  onPress={() => { setTargetCrop(item.name); setCropModal(false); }}
                >
                  <CropIcon crop={item.name} size={32} />
                  <View style={{ flex: 1 }}>
                    <Text style={S.modalItemTxt}>{item.name}</Text>
                    {item.nameHi ? <Text style={S.modalItemHi}>{item.nameHi}</Text> : null}
                  </View>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={S.modalClose} onPress={() => setCropModal(false)}>
              <Text style={S.modalCloseTxt}>{t('soilHealth.cancel')}</Text>
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

  tabRow: { flexDirection: 'row', padding: 12, gap: 8 },
  tabBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  tabBtnActive:   { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabTxt:         { fontSize: 13, fontWeight: '700', color: COLORS.textMedium },
  tabTxtActive:   { color: COLORS.white },

  formContent: { padding: 18, gap: 12, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 11, fontWeight: '900', color: COLORS.textMedium,
    letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 4,
  },
  requiredNote: { fontSize: 11, color: COLORS.textLight, marginTop: -6 },
  fieldInput: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: COLORS.border,
    color: COLORS.textBody, fontSize: 14,
  },
  paramRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  paramLabel: { flex: 1, fontSize: 13, color: COLORS.textMedium, fontWeight: '600' },
  paramInput: {
    width: 88, backgroundColor: COLORS.surface, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 9,
    borderWidth: 1, borderColor: COLORS.border,
    color: COLORS.textBody, fontSize: 14, textAlign: 'right',
  },
  paramUnit: { width: 44, fontSize: 10, color: COLORS.textLight, fontWeight: '600' },

  cropSelect: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cropSelectTxt: { flex: 1, fontSize: 14, color: COLORS.textMedium },

  errorTxt: { fontSize: 13, color: COLORS.error },
  submitBtn: {
    backgroundColor: COLORS.primary, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  submitTxt: { fontSize: 16, fontWeight: '800', color: COLORS.white },

  // Report
  reportContent: { padding: 18, gap: 12, paddingBottom: 40 },
  reportTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textDark },
  healthScoreCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  healthScoreLabel: { fontSize: 13, color: COLORS.textMedium, fontWeight: '600' },
  healthScoreVal:   { fontSize: 28, fontWeight: '900' },
  healthBarCard: {
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.border, gap: 6,
  },
  healthBarTop: { flexDirection: 'row', alignItems: 'center' },
  healthBarLabel: { flex: 1, fontSize: 13, color: COLORS.textBody, fontWeight: '600' },
  ratingBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  ratingTxt: { fontSize: 9, fontWeight: '900' },
  barTrack: { height: 5, backgroundColor: COLORS.surfaceSunkenAlt, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 5, borderRadius: 3 },
  adviceTxt: { fontSize: 11, color: COLORS.textLight, lineHeight: 16 },

  recPromptCard: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border, gap: 10,
  },
  recPromptTxt: { fontSize: 13, color: COLORS.textMedium },
  getRecBtn: {
    backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center',
  },
  getRecBtnTxt: { fontSize: 14, fontWeight: '700', color: COLORS.white },

  recCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  recIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(23,107,67,0.08)', justifyContent: 'center', alignItems: 'center',
  },
  recFertilizer: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  recDose:       { fontSize: 12, color: COLORS.primary, marginTop: 2 },
  recTiming:     { fontSize: 11, color: COLORS.textLight, marginTop: 2 },

  // History
  listContent: { padding: 18, gap: 10 },
  histCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  histField: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  histDate:  { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  histMeta:  { fontSize: 11, color: COLORS.textMedium, marginTop: 2 },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  emptyTxt: { fontSize: 15, color: COLORS.textMedium, fontWeight: '700', textAlign: 'center' },
  createBtnSmall: {
    marginTop: 8, backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10,
  },
  createBtnSmallTxt: { fontSize: 14, fontWeight: '700', color: COLORS.white },

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
  modalItemTxt: { fontSize: 14, color: COLORS.textBody, fontWeight: '600', flex: 1 },
  modalItemHi:  { fontSize: 13, color: COLORS.textLight },
  modalClose: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  modalCloseTxt: { fontSize: 14, color: COLORS.error, fontWeight: '700' },
});

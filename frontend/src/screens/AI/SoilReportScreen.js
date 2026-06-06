/**
 * SoilReportScreen — cosmic soil report + fertilizer recommendations + history.
 *
 * Shows the report passed via route.params.report (fresh from the form), or
 * loads the farmer's saved reports and shows the most recent. A "Past tests"
 * strip lets them switch between reports. A crop picker fetches ICAR-based
 * fertilizer doses, and an "Ask Soil AI Advisor" button deep-links into chat.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, StatusBar, Modal, FlatList,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  FlaskConical, Sparkles, Leaf, ChevronDown, FileText, Beaker, MessageSquare,
} from 'lucide-react-native';
import { useLanguage } from '../../context/LanguageContext';
import {
  getSoilReports, getSoilReportDetail, getSoilRecommendation, getCrops,
} from '../../services/aiApi';
import { CropIcon } from '../../components/CropIcons';
import {
  BG, BG_GRADIENT, PRIMARY, P_LIGHT, ACCENT, DANGER, TEXT, TEXT2, MUTED, SURFACE, BORDER,
  INTER_REG, INTER_SEMI, INTER_BOLD, INTER_EXTRA,
  CosmicHeader, PARAM_FIELDS, fieldLabel, ratingColor, ratingFillPct, soilHumanError,
} from './components/soilShared';
import { askSoilAdvisor } from './components/soilAdvisor';

const GOOD = ['optimal', 'high', 'sufficient', 'low_ec'];

function computeHealthScore(report) {
  if (report?.healthScore != null) return report.healthScore;
  const ratings = Object.values(report?.ratings || {}).filter(Boolean);
  if (!ratings.length) return null;
  const good = ratings.filter(r => GOOD.includes(r.rating)).length;
  return Math.round((good / ratings.length) * 100);
}

export default function SoilReportScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { t, language } = useLanguage();

  const [report, setReport]   = useState(route?.params?.report || null);
  const [history, setHistory] = useState([]);
  const [crops, setCrops]     = useState([]);
  const [cropModal, setCropModal] = useState(false);
  const [targetCrop, setTargetCrop] = useState('');
  const [fertilizers, setFertilizers] = useState([]);
  const [recAdvice, setRecAdvice] = useState([]);
  const [loadingRec, setLoadingRec] = useState(false);
  const [error, setError] = useState(null);

  // Load crops + history; if no report was passed, show the most recent.
  useEffect(() => {
    getCrops().then(setCrops).catch(() => {});
    getSoilReports().then(async (list) => {
      setHistory(Array.isArray(list) ? list : []);
      if (!route?.params?.report && list?.length) {
        try { setReport(await getSoilReportDetail(list[0].id)); }
        catch { setReport(list[0]); }
      }
    }).catch(() => {});
  }, []);

  const switchReport = useCallback(async (item) => {
    setFertilizers([]); setRecAdvice([]); setTargetCrop(''); setError(null);
    try { setReport(await getSoilReportDetail(item.id)); }
    catch { setReport(item); }
  }, []);

  const loadRecommendation = useCallback(async (crop) => {
    if (!report?.id || !crop) return;
    setLoadingRec(true); setError(null);
    try {
      const data = await getSoilRecommendation(report.id, crop, 1, 'acre');
      setFertilizers(data?.fertilizers || []);
      setRecAdvice(Array.isArray(data?.generalAdvice) ? data.generalAdvice : []);
    } catch (err) {
      setError(soilHumanError(err, t));
    } finally {
      setLoadingRec(false);
    }
  }, [report, t]);

  const score = computeHealthScore(report);
  const scoreColor = score == null ? MUTED : score >= 70 ? P_LIGHT : score >= 45 ? ACCENT : DANGER;

  return (
    <View style={S.root}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <LinearGradient colors={BG_GRADIENT} style={StyleSheet.absoluteFill} />

      <CosmicHeader
        title={t('soilHub.report.title', 'Soil report')}
        subtitle={t('soilHub.report.subtitle', 'ICAR Soil Health Card norms')}
        Icon={FlaskConical}
        onBack={() => navigation.goBack()}
        insetTop={insets.top}
      />

      {!report ? (
        <View style={S.empty}>
          <FileText size={46} color={MUTED} strokeWidth={1.6} />
          <Text style={S.emptyTxt}>{t('soilHub.report.empty', 'No soil test yet')}</Text>
          <TouchableOpacity style={S.emptyBtn} activeOpacity={0.9} onPress={() => navigation.navigate('SoilForm')}>
            <Text style={S.emptyBtnTxt}>{t('soilHub.report.startTest', 'Start a test')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[S.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
          {/* Title + score */}
          <View style={S.scoreCard}>
            <View style={{ flex: 1 }}>
              <Text style={S.reportField} numberOfLines={1}>{report.fieldName || t('soilHub.summary.myField', 'My field')}</Text>
              <Text style={S.reportDate}>
                {report.testDate
                  ? new Date(report.testDate).toLocaleDateString()
                  : report.createdAt ? new Date(report.createdAt).toLocaleDateString() : ''}
                {report.inputMethod === 'ocr' ? `  ·  ${t('soilHub.report.scanned', 'scanned card')}` : ''}
              </Text>
            </View>
            {score != null && (
              <View style={S.scoreBubble}>
                <Text style={[S.scoreVal, { color: scoreColor }]}>{score}%</Text>
                <Text style={S.scoreLabel}>{t('soilHub.report.health', 'health')}</Text>
              </View>
            )}
          </View>

          {/* Ask AI advisor */}
          <TouchableOpacity style={S.askBtn} activeOpacity={0.9} onPress={() => askSoilAdvisor(navigation, report, language, t)}>
            <Sparkles size={16} color={BG} strokeWidth={2.4} />
            <Text style={S.askBtnTxt}>{t('soilHub.report.askAdvisor', 'Ask Soil AI Advisor')}</Text>
          </TouchableOpacity>

          {/* Parameter ratings */}
          <Text style={S.sectionLabel}>{t('soilHub.report.ratings', 'PARAMETER RATINGS')}</Text>
          {PARAM_FIELDS.map(f => {
            const r = report.ratings?.[f.key];
            const val = report[f.key];
            if (!r && (val === null || val === undefined)) return null;
            return <HealthBar key={f.key} field={f} value={val} rating={r} language={language} t={t} />;
          })}

          {/* Fertilizer recommendation */}
          <Text style={S.sectionLabel}>{t('soilHub.report.fertilizer', 'FERTILIZER PLAN')}</Text>
          <TouchableOpacity style={S.cropSelect} activeOpacity={0.85} onPress={() => setCropModal(true)}>
            <Leaf size={16} color={P_LIGHT} />
            <Text style={[S.cropSelectTxt, targetCrop && { color: TEXT }]}>
              {targetCrop || t('soilHub.report.selectCrop', 'Select your crop')}
            </Text>
            <ChevronDown size={16} color={MUTED} />
          </TouchableOpacity>

          {loadingRec && <ActivityIndicator color={P_LIGHT} style={{ marginTop: 14 }} />}

          {recAdvice.map((line, i) => (
            <View key={`adv-${i}`} style={S.adviceRow}>
              <Text style={S.adviceTxt}>{line}</Text>
            </View>
          ))}

          {fertilizers.map((f, i) => (
            <View key={`fert-${i}`} style={S.fertCard}>
              <View style={S.fertIcon}><Beaker size={18} color={P_LIGHT} /></View>
              <View style={{ flex: 1 }}>
                <Text style={S.fertName}>{f.name}</Text>
                <Text style={S.fertDose}>{f.qty} {f.unit}</Text>
                {f.adjustment ? <Text style={S.fertAdj}>{f.adjustment}</Text> : null}
              </View>
            </View>
          ))}

          {error ? <Text style={S.errorTxt}>{error}</Text> : null}

          <Text style={S.disclaimer}>
            {t('soilHub.report.disclaimer', 'Guidance based on ICAR Soil Health Card norms. Please also consult your local agriculture officer.')}
          </Text>

          {/* History strip */}
          {history.length > 1 && (
            <>
              <Text style={S.sectionLabel}>{t('soilHub.report.past', 'PAST TESTS')}</Text>
              {history.map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={[S.histRow, item.id === report.id && S.histRowActive]}
                  activeOpacity={0.85}
                  onPress={() => switchReport(item)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={S.histField}>{item.fieldName || t('soilHub.summary.myField', 'My field')}</Text>
                    <Text style={S.histDate}>
                      {item.testDate ? new Date(item.testDate).toLocaleDateString()
                        : item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}
                      {item.ph != null ? `  ·  pH ${item.ph}` : ''}
                    </Text>
                  </View>
                  {item.id === report.id && <View style={S.histDot} />}
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* Crop picker modal */}
      <Modal visible={cropModal} transparent animationType="slide" onRequestClose={() => setCropModal(false)}>
        <View style={S.modalOverlay}>
          <View style={S.modalSheet}>
            <Text style={S.modalTitle}>{t('soilHub.report.selectCrop', 'Select your crop')}</Text>
            <FlatList
              data={crops}
              keyExtractor={(item) => item.id || item.name}
              windowSize={7}
              maxToRenderPerBatch={18}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={S.modalItem}
                  onPress={() => { setTargetCrop(item.name); setCropModal(false); loadRecommendation(item.name); }}
                >
                  <CropIcon crop={item.name} size={30} />
                  <Text style={S.modalItemTxt}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={S.modalClose} onPress={() => setCropModal(false)}>
              <Text style={S.modalCloseTxt}>{t('soilHub.report.cancel', 'Cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Per-parameter rating bar ─────────────────────────────────────────────────
function HealthBar({ field, value, rating, language, t }) {
  const color = ratingColor(rating?.rating);
  const ratingLabel = (language === 'hi' && rating?.ratingHi) ? rating.ratingHi : (rating?.rating || '');
  return (
    <View style={S.barCard}>
      <View style={S.barTop}>
        <Text style={S.barLabel}>
          {fieldLabel(field, language)}
          {value != null ? <Text style={S.barValue}>  {value}{field.unit ? ` ${field.unit}` : ''}</Text> : null}
        </Text>
        {ratingLabel ? (
          <View style={[S.barBadge, { backgroundColor: color + '26' }]}>
            <Text style={[S.barBadgeTxt, { color }]}>{String(ratingLabel).toUpperCase()}</Text>
          </View>
        ) : null}
      </View>
      <View style={S.barTrack}>
        <View style={[S.barFill, { width: ratingFillPct(rating?.rating), backgroundColor: color }]} />
      </View>
      {rating?.advice ? <Text style={S.barAdvice}>{rating.advice}</Text> : null}
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingBottom: 60 },
  emptyTxt: { fontSize: 15, color: TEXT2, fontWeight: '700', fontFamily: INTER_BOLD },
  emptyBtn: { backgroundColor: P_LIGHT, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 11 },
  emptyBtnTxt: { fontSize: 14, fontWeight: '800', color: BG, fontFamily: INTER_EXTRA },

  scoreCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: SURFACE, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: BORDER,
  },
  reportField: { fontSize: 18, fontWeight: '900', color: TEXT, fontFamily: INTER_EXTRA },
  reportDate: { fontSize: 11.5, color: MUTED, marginTop: 3, fontFamily: INTER_REG },
  scoreBubble: { alignItems: 'center' },
  scoreVal: { fontSize: 26, fontWeight: '900', fontFamily: INTER_EXTRA },
  scoreLabel: { fontSize: 9.5, color: MUTED, fontWeight: '700', fontFamily: INTER_BOLD },

  askBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 13,
  },
  askBtnTxt: { fontSize: 14.5, fontWeight: '900', color: BG, fontFamily: INTER_EXTRA },

  sectionLabel: { fontSize: 11, fontWeight: '900', color: TEXT2, letterSpacing: 1.2, marginTop: 8, fontFamily: INTER_BOLD },

  barCard: { backgroundColor: SURFACE, borderRadius: 13, padding: 13, borderWidth: 1, borderColor: BORDER, gap: 7 },
  barTop: { flexDirection: 'row', alignItems: 'center' },
  barLabel: { flex: 1, fontSize: 13, color: TEXT, fontWeight: '700', fontFamily: INTER_BOLD },
  barValue: { color: TEXT2, fontWeight: '600', fontFamily: INTER_SEMI },
  barBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  barBadgeTxt: { fontSize: 9, fontWeight: '900', fontFamily: INTER_EXTRA },
  barTrack: { height: 5, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 5, borderRadius: 3 },
  barAdvice: { fontSize: 11.5, color: MUTED, lineHeight: 16, fontFamily: INTER_REG },

  cropSelect: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: SURFACE, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 13,
    borderWidth: 1, borderColor: BORDER,
  },
  cropSelectTxt: { flex: 1, fontSize: 14, color: MUTED, fontFamily: INTER_SEMI },

  adviceRow: { backgroundColor: 'rgba(245,184,65,0.08)', borderRadius: 11, padding: 11, borderWidth: 1, borderColor: 'rgba(245,184,65,0.2)' },
  adviceTxt: { fontSize: 12.5, color: TEXT2, lineHeight: 18, fontFamily: INTER_REG },

  fertCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 11,
    backgroundColor: SURFACE, borderRadius: 13, padding: 13, borderWidth: 1, borderColor: BORDER,
  },
  fertIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(74,222,128,0.12)', justifyContent: 'center', alignItems: 'center' },
  fertName: { fontSize: 14, fontWeight: '800', color: TEXT, fontFamily: INTER_EXTRA },
  fertDose: { fontSize: 12.5, color: P_LIGHT, marginTop: 2, fontFamily: INTER_BOLD },
  fertAdj: { fontSize: 11, color: MUTED, marginTop: 2, fontFamily: INTER_REG },

  errorTxt: { fontSize: 13, color: DANGER, fontFamily: INTER_SEMI },
  disclaimer: { fontSize: 11, color: MUTED, lineHeight: 16, marginTop: 4, fontStyle: 'italic', fontFamily: INTER_REG },

  histRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: SURFACE, borderRadius: 12, padding: 13, borderWidth: 1, borderColor: BORDER,
  },
  histRowActive: { borderColor: 'rgba(74,222,128,0.4)' },
  histField: { fontSize: 13.5, fontWeight: '700', color: TEXT, fontFamily: INTER_BOLD },
  histDate: { fontSize: 11, color: MUTED, marginTop: 2, fontFamily: INTER_REG },
  histDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: P_LIGHT },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#0B1410', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '62%', padding: 18, borderWidth: 1, borderColor: BORDER },
  modalTitle: { fontSize: 16, fontWeight: '900', color: TEXT, marginBottom: 14, fontFamily: INTER_EXTRA },
  modalItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: BORDER },
  modalItemTxt: { fontSize: 14, color: TEXT, fontWeight: '600', fontFamily: INTER_SEMI },
  modalClose: { paddingVertical: 15, alignItems: 'center', marginTop: 6 },
  modalCloseTxt: { fontSize: 14, color: DANGER, fontWeight: '700', fontFamily: INTER_BOLD },
});

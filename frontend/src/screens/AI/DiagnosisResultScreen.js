/**
 * DiagnosisResultScreen — Full AI diagnosis report (production-ready).
 *
 * Handles both:
 *  - Simple format (old): treatment[] = array of strings
 *  - Rich format (new):   treatment[] = array of objects with step/action/chemical/dose/timing
 *
 * Sections:
 *  1. Hero — disease name, confidence, severity, spread risk, urgency
 *  2. Immediate Action — what to do TODAY
 *  3. Treatment Protocol — step-by-step with chemicals/doses/timing
 *  4. Organic Alternative — natural treatment option
 *  5. AI Insight — weather risk, soil note, estimated yield loss
 *  6. Follow-up Schedule — day 3, 7, 14 actions
 *  7. Prevention — next season
 *  8. Recommended Products — buy from AgriStore
 *  9. Actions — Ask Krushi Intelligence / Buy Products
 */
import { useRef, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Dimensions, Animated, StatusBar, Alert, Image, Modal,
} from 'react-native';
import { safeOpenURL, sanitizePhone } from '../../utils/sanitize';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '../../utils/haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import * as FileSystem from 'expo-file-system/legacy';
import logger from '../../utils/logger';
import { SoundEffects } from '../../utils/sounds';
import { COLORS } from '../../constants/colors';
import api from '../../services/api';
import KrushiKendraShareSheet from '../../components/KrushiKendraShareSheet';

const { width: W } = Dimensions.get('window');

const SEV_CONFIG = {
  low:      { color: COLORS.primary, tKey: 'sevLow',      icon: 'checkmark-circle', bg: COLORS.successLight },
  moderate: { color: COLORS.amberDark, tKey: 'sevModerate', icon: 'warning',          bg: COLORS.darkAmber },
  high:     { color: COLORS.red, tKey: 'sevHigh',     icon: 'alert-circle',     bg: COLORS.darkMaroon },
  critical: { color: COLORS.coralRed, tKey: 'sevCritical', icon: 'skull-outline',    bg: COLORS.deepRed },
};

const URGENCY_CONFIG = {
  immediate:  { color: COLORS.red, tKey: 'urgImmediate', icon: 'flash'    },
  today:      { color: COLORS.amberDark, tKey: 'urgToday',     icon: 'today'    },
  this_week:  { color: COLORS.blue, tKey: 'urgWeek',      icon: 'calendar' },
};

function ConfidenceRing({ value, color, size = 80, confidenceLabel }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: value / 100, duration: 900, delay: 300, useNativeDriver: false }).start();
  }, []);
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View style={{
        width: size, height: size, borderRadius: size / 2,
        borderWidth: size * 0.1, borderColor: `${color}25`, position: 'absolute',
      }} />
      <View style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: size * 0.28, fontWeight: '900', color }}>{value}%</Text>
        <Text style={{ fontSize: size * 0.13, color: COLORS.textLight, fontWeight: '600' }}>{confidenceLabel}</Text>
      </View>
    </View>
  );
}

function SectionHeader({ color, title }) {
  return (
    <View style={D.sectionHeader}>
      <View style={[D.sectionDot, { backgroundColor: color }]} />
      <Text style={D.sectionTitle}>{title}</Text>
    </View>
  );
}

function InfoRow({ icon, iconColor = COLORS.grayMedium, label, value }) {
  return (
    <View style={D.infoRow}>
      <Ionicons name={icon} size={13} color={iconColor} />
      <Text style={D.infoLabel}>{label}:</Text>
      <Text style={D.infoValue}>{value}</Text>
    </View>
  );
}

export default function DiagnosisResultScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { t, language, LANGUAGES } = useLanguage();
  const { user } = useAuth();
  const d = route?.params?.diagnosis || {};
  const farmCtx = route?.params?.farmContext || {};
  const scannedImageUri = route?.params?.imageUri || null;
  // Multi-image submissions pass the full array; fall back to the single
  // legacy `imageUri` param so older entry points still work.
  const scannedImageUris = Array.isArray(route?.params?.imageUris) && route.params.imageUris.length > 0
    ? route.params.imageUris
    : (scannedImageUri ? [scannedImageUri] : []);

  // Normalise to always have data
  const disease      = d.disease      || 'Unknown';
  const scientific   = d.scientific   || '';
  const crop         = d.crop         || farmCtx.cropName || 'Unknown';
  // Localised crop name for on-screen display only. A crops.<key> map exists
  // (en/hi/mr fully; other langs fall back to English). Unknown/custom crops
  // keep their original string. The PDF report stays English-primary, so this
  // helper is used in the UI exclusively — never in buildReportHTML().
  const localizedCrop = (() => {
    const key = String(crop || '').toLowerCase().trim();
    const tr = t('crops.' + key);
    return tr === 'crops.' + key ? crop : tr;
  })();
  const confidence   = d.confidence   || 0;
  const severity     = d.severity     || 'moderate';
  const isHealthy    = d.isHealthy    || false;
  const stage        = d.stage        || '';
  const affectedArea = d.affectedAreaEstimate || farmCtx.affectedArea || '';
  const spreadRisk   = d.spreadRisk   || '';
  const urgency      = d.urgencyLevel || 'today';
  const estYieldLoss = d.estimatedYieldLoss || '';
  const immediateAction = d.immediateAction || '';
  const prevention   = d.prevention  || '';
  const weatherNote  = d.weatherRiskNote   || '';
  const soilNote     = d.soilConsideration || '';
  const prevCropNote = d.previousCropNote  || '';
  const notes        = d.notes        || '';
  const consultExpert = d.consultExpert || false;
  const causes        = Array.isArray(d.causes) ? d.causes : [];
  const followUp      = Array.isArray(d.followUpSchedule) ? d.followUpSchedule : [];
  const organicTx     = d.organicTreatment || null;

  // Treatment can be array of strings OR array of objects
  const rawTreatment  = Array.isArray(d.treatment) ? d.treatment : [];
  const treatmentIsObjects = rawTreatment.length > 0 && typeof rawTreatment[0] === 'object';

  // Products can be array of strings OR array of objects
  const rawProducts = Array.isArray(d.products) ? d.products : [];
  const productsAreObjects = rawProducts.length > 0 && typeof rawProducts[0] === 'object';

  const sev     = SEV_CONFIG[severity]     || SEV_CONFIG.moderate;
  const urgConf = URGENCY_CONFIG[urgency]  || URGENCY_CONFIG.today;

  const contentAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Haptics.success();
    SoundEffects.success();
    Animated.timing(contentAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  const [downloading, setDownloading] = useState(false);
  const [shareSheetVisible, setShareSheetVisible] = useState(false);
  const [shares, setShares] = useState([]);
  const [visitShop, setVisitShop] = useState(null); // seller object when modal open

  const addRecommendedToCart = async (product) => {
    try {
      await api.post('/agristore/cart', { productId: product.id, quantity: product.minOrderQty || 1 });
      Alert.alert(t('share.addedToCartTitle', 'Added'), t('share.addedToCartBody', { name: product.name, defaultValue: '{{name}} added to your cart.' }));
    } catch (err) {
      Alert.alert(t('error', 'Error'), err?.response?.data?.error?.message || t('share.cartFailed', 'Could not add to cart.'));
    }
  };

  // DB row id of the persisted CropDiseaseReport — needed to share with sellers.
  // Distinct from `reportId` below, which is the AI's human-readable report code
  // used in the PDF header.
  const shareReportId = d.reportId || d._fullReport?.reportId || null;
  const primaryDiseaseShort = d?.primary_disease?.name || d?.primaryDisease?.name || disease;

  const loadShares = async () => {
    if (!shareReportId) return;
    try {
      const res = await api.get(`/crop-reports/${shareReportId}/shares`);
      setShares(res.data.data || []);
    } catch (err) {
      logger.warn?.('[DiagnosisResult] loadShares failed:', err?.message);
    }
  };
  useEffect(() => { loadShares(); }, [shareReportId]);

  const full = d._fullReport || {};
  const fullTx = full.treatment || {};
  const chemicals = fullTx.chemical || fullTx.chemical_controls || [];
  const organicList = fullTx.organic || fullTx.organic_alternatives || [];
  const fertList = fullTx.fertilizer || fullTx.fertilizer_recommendations || [];
  const sprayTiming = fullTx.spray_timing || fullTx.spray_timing_advisory || '';
  const nextStepsFull = Array.isArray(full.next_steps) ? full.next_steps : (Array.isArray(d.nextSteps) ? d.nextSteps : []);
  const reportId = full.meta?.report_id || full.report_id || '';
  const generatedAt = full.generated_at ? new Date(full.generated_at).toLocaleString('en-IN') : new Date().toLocaleString('en-IN');

  // Weather details from full report
  const fullWeather = full.weather_outlook || {};
  const weatherRiskLevel   = fullWeather.risk || '';
  const weatherForecast    = fullWeather.forecast_risk || '';
  const weatherAdvisory    = fullWeather.advisory || '';
  const weatherSummaryText = fullWeather.summary || '';
  const weatherRiskFactors = Array.isArray(fullWeather.risk_factors) ? fullWeather.risk_factors : [];
  const weatherFavorable   = Array.isArray(fullWeather.favorable_diseases) ? fullWeather.favorable_diseases : [];
  const soilRisk           = fullWeather.soil_risk || '';
  const weatherUsed        = fullWeather.weather_used || false;
  const rawCurrent         = fullWeather.raw_current  || {};
  const rawSoil            = fullWeather.raw_soil     || {};
  const rawForecast        = fullWeather.raw_forecast || [];


  const buildReportHTML = () => {
    const esc = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const na  = (v, unit='') => (v != null && v !== '') ? `${v}${unit}` : '—';

    // ── Language ─────────────────────────────────────────────────────────────
    const langObj = (LANGUAGES || []).find(l => l.code === language) || { name: 'English', nativeName: 'English' };
    const langNative = langObj.nativeName;
    const isBilingual = language && language !== 'en';
    const langLabel = isBilingual ? `${langNative} (${langObj.name}) + English` : 'English';

    // Backend-translated per-section strips (from FastAPI report_generator local_blocks)
    const localBlocks = full.local_blocks || {};
    const localLang = localBlocks.language || '';
    const localLangName = localBlocks.language_name || '';
    const localStrips = localBlocks.blocks || {};
    const showLocal = localLang && localLang !== 'en' && Object.keys(localStrips).length > 0;
    const localStrip = (key, label) => (showLocal && localStrips[key])
      ? `<div class="local-msg" lang="${localLang}"><b>${esc(label)} — ${esc(localLangName)}</b>${esc(localStrips[key])}</div>`
      : '';

    // ── Structured pages from backend ────────────────────────────────────────
    const fsp = full.farmer_summary_page || {};
    const dgp = full.detailed_guidance_page || {};
    const dsp = full.dispensing_sheet_page || {};
    const anp = full.annex_page || {};
    const fullDiseaseR = full.disease || {};
    const diseaseDesc = fullDiseaseR.description || '';
    const syms = Array.isArray(farmCtx.symptoms) ? farmCtx.symptoms : [];
    const diffs = Array.isArray((full.meta || {}).differentials) ? full.meta.differentials : [];

    // Disease
    const diseaseName = fsp.disease_detected?.name || disease;
    const diseaseLocal = fsp.disease_detected?.local_name || '';
    const diseaseSci = fsp.disease_detected?.scientific_name || scientific || '';
    const diseasePathogen = fsp.disease_detected?.pathogen_type || fullDiseaseR.pathogen_type || '';
    const confPct = fsp.disease_detected?.confidence || confidence;
    const confTierR = confPct >= 85 ? 'HIGH' : confPct >= 70 ? 'MEDIUM' : confPct >= 50 ? 'LOW' : 'VERY LOW';
    const sevTxt = (severity || 'moderate').toUpperCase();
    const urgHoursR = severity === 'critical' ? 24 : severity === 'high' ? 48 : severity === 'moderate' ? 48 : 120;
    const urgText = urgHoursR <= 24 ? 'ACT IMMEDIATELY' : `ACT WITHIN ${urgHoursR} HOURS`;
    const confBarFull = Math.round(confPct / 20);
    const confBar = '\u25A0'.repeat(confBarFull) + '\u25A1'.repeat(Math.max(0, 5 - confBarFull));

    // Weekly actions
    const weeklyActions = fsp.weekly_actions || nextStepsFull.map((s, i) => ({
      action: typeof s === 'string' ? s : s.action || '',
      action_local: typeof s === 'object' ? s.action_local || '' : '',
    }));

    // Spray schedule
    const spraySchedule = dgp.spray_schedule?.items || chemicals.map((c, i) => ({
      spray_number: i + 1,
      day: i === 0 ? 'Day 0 — TODAY' : `Day ${i * 7}`,
      timing: i === 0 ? 'Evening after 5 PM' : 'Morning or evening',
      product: c.product || c.active_ingredient || '',
      brand_names: (c.brands || []).map(b => b.name).filter(Boolean).join(' / '),
      frac_group: c.frac_irac_group || '',
      dose: c.dosage || c.dose || '',
      quantity_for_farm: c.dosage_per_acre || '',
    }));

    // Safety + Cultural + Bio
    const safetyDoList = dgp.safety_checklist?.do || [];
    const safetyDontList = dgp.safety_checklist?.dont || [];
    const culturalPR = dgp.cultural_practices || fullTx.cultural || [];
    const doNotUseR = fullTx.do_not_use || [];
    const biologicalR = organicList.length > 0 ? organicList : (fullTx.organic || []);

    // Dispensing
    const dispProd = dsp.products || chemicals.map((c, i) => ({
      number: i + 1,
      product: c.product || c.active_ingredient || '',
      brand_names: (c.brands || []).map(b => b.name).filter(Boolean).join(' / '),
      frac_irac_group: c.frac_irac_group || '',
      frac_type: c.action_type || (i === 0 ? 'Contact' : 'Systemic'),
      quantity_for_farm: c.dosage_per_acre || '',
      when: `Spray #${i+1} — Day ${i * 7}`,
      est_price_inr: '',
    }));
    const totalCostR = dsp.total_estimated_cost_inr || '';
    const subsR = dsp.substitutes || [];
    const incompR = dsp.incompatibilities || [];

    // Annex
    const envData = anp.environmental_data || [];
    const evMatrix = anp.evidence_matrix?.diseases || [];
    const modelAgree = anp.evidence_matrix?.model_agreement || '';
    const compAudit = anp.compliance_audit || [];
    const sysMeta = anp.system_metadata || full.meta || {};
    const disclaimerEn = anp.disclaimer || t('diagReport.disclaimer');
    const disclaimerLocal = anp.disclaimer_local || '';

    // Text
    const farmerSummaryText = fsp.farmer_summary || notes || '';
    const whatHappening = dgp.what_is_happening?.explanation || diseaseDesc || '';
    const whatHappeningLocal = dgp.what_is_happening?.explanation_local || '';
    const imgSrc = scannedImageUri || '';

    // Weather
    const tempVal = rawCurrent.temperature ?? null;
    const humVal = rawCurrent.humidity ?? null;
    const precipV = rawCurrent.precipitation ?? null;
    const vpdV = rawCurrent.vpd != null ? rawCurrent.vpd.toFixed(2) : null;
    const leafWet = dgp.why_now?.leaf_wetness || rawCurrent.leaf_wetness || null;
    const outbreakNearby = dgp.why_now?.outbreak_nearby || null;

    // Date / ID / Farmer
    const dateStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const rptId = reportId ? `KR-${new Date().toISOString().slice(0,10)}-${reportId.slice(0,6).toUpperCase()}` : `KR-${new Date().toISOString().slice(0,10)}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
    const farmerName = farmCtx.farmerName || farmCtx.name || user?.name || '';
    const farmerPhone = farmCtx.phone || user?.phone || '';
    const farmerVillage = [farmCtx.village || user?.village, farmCtx.city || user?.city, farmCtx.district || user?.district, farmCtx.state || user?.state].filter(Boolean).join(', ');
    const landTotal = farmCtx.landSize || '';
    const rotationPlanR = fullTx.rotation_plan || dgp.spray_schedule?.rotation_note || '';

    // ── AgriDoc-styled report (English primary + per-section native strips) ──
    return `<!DOCTYPE html>
<html lang="${language || 'en'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CropSetu — ${t('diagReport.reportTitle')} — ${esc(rptId)}</title>
<style>
@page{size:A4;margin:8mm 8mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Georgia,'Times New Roman',serif;color:#1c2526;line-height:1.5;font-size:11.5px;background:#fefdf8;-webkit-print-color-adjust:exact;print-color-adjust:exact}

/* Page frame */
.page{max-width:780px;margin:0 auto;background:#fefdf8;border-left:6px solid #1a5f3f;position:relative}
.page::before{content:"";position:absolute;left:-6px;top:60%;bottom:0;width:6px;background:#c9a961}

/* Header */
.header{padding:18px 24px 14px;border-bottom:2px solid #1a5f3f;display:flex;justify-content:space-between;align-items:flex-end;gap:16px;background:linear-gradient(180deg,#fefdf8 0%,#f7f3e8 100%)}
.logo-row{display:flex;align-items:center;gap:12px}
.crest{width:48px;height:48px;border-radius:50%;background:#1a5f3f;color:#c9a961;border:2px solid #c9a961;display:flex;align-items:center;justify-content:center;font-size:22px}
.lab-name{font-family:Georgia,serif;font-size:22px;font-weight:900;color:#0e3a26;line-height:1}
.lab-name .ai{color:#c9a961}
.lab-sub{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#a07f3d;font-weight:700;margin-top:4px}
.lab-tag{font-size:9px;color:#6b7280;font-style:italic;margin-top:2px}
.meta{font-family:'Courier New',monospace;font-size:9.5px;line-height:1.6;text-align:right}
.meta b{color:#1a5f3f}
.meta .pill{display:inline-block;background:#1a5f3f;color:#fff;padding:1px 7px;font-weight:600;letter-spacing:.5px;border-radius:2px}

/* Title */
.report-title{text-align:center;padding:14px 24px 4px;font-family:Georgia,serif;font-size:18px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:#0e3a26}
.report-title::after{content:"";display:block;width:48px;height:2px;background:#c9a961;margin:8px auto 0}
.report-sub{text-align:center;font-size:10px;color:#6b7280;letter-spacing:1.5px;text-transform:uppercase;padding-bottom:14px;border-bottom:1px dashed #d9cfb4}

.body{padding:18px 24px 24px}

/* Section */
.section{margin:16px 0;break-inside:avoid}
.section-h{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-family:Georgia,serif;font-size:13px;font-weight:700;color:#0e3a26;letter-spacing:1px;text-transform:uppercase}
.section-h .num{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#1a5f3f;color:#c9a961;font-family:'Courier New',monospace;font-size:10px;font-weight:700}
.section-h .bar{flex:1;height:1px;background:linear-gradient(90deg,#c9a961 0%,transparent 100%)}

/* Patient summary card */
.summary-card{border:1px solid #d9cfb4;background:#f1f7f3;padding:12px 14px;border-left:3px solid #1a5f3f;font-style:italic;font-size:11.5px;line-height:1.6}
.summary-card b{font-style:normal;color:#0e3a26}

/* Key-value grid */
.kv-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:2px 20px;font-size:11px}
.kv{display:grid;grid-template-columns:130px 1fr;gap:8px;padding:4px 0;border-bottom:1px dotted #e3d7b8}
.kv .k{color:#6b7280;font-weight:500;text-transform:uppercase;font-size:9px;letter-spacing:.8px;align-self:center}
.kv .v{color:#1c2526;font-weight:500}
.kv .v.mono{font-family:'Courier New',monospace;font-size:10.5px}

.tag{display:inline-block;padding:1px 6px;border-radius:2px;font-size:9px;font-weight:700;letter-spacing:.3px;margin-left:4px}
.tag.bad{background:#f5e2e0;color:#b8443e}
.tag.warn{background:#fdf1d8;color:#d99a3a}
.tag.ok{background:#cfe5d8;color:#0e3a26}

/* Image grid */
.img-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px}
.specimen{border:1px solid #d9cfb4;background:#fff;padding:6px;position:relative}
.specimen .img-wrap{aspect-ratio:1.4/1;background:linear-gradient(135deg,#dfe9c8 0%,#a8c789 100%);display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:130px}
.specimen .img-wrap img{width:100%;height:100%;object-fit:cover;display:block}
.specimen .img-ph{color:#6b7280;font-size:10px;text-align:center;padding:8px}
.specimen .caption{margin-top:6px;font-size:9.5px;color:#6b7280;font-family:'Courier New',monospace;display:flex;justify-content:space-between}
.specimen .caption b{color:#1a5f3f}

/* Primary diagnosis hero */
.diagnosis-hero{margin-top:8px;border:2px solid #1a5f3f;background:#fff;position:relative;padding:14px 18px;display:flex;gap:18px;align-items:center;justify-content:space-between}
.diagnosis-hero::before{content:"PRIMARY DIAGNOSIS";position:absolute;top:-8px;left:14px;background:#1a5f3f;color:#c9a961;padding:1px 8px;font-size:9px;letter-spacing:2px;font-weight:700}
.dx-name{font-family:Georgia,serif;font-size:20px;font-weight:700;color:#0e3a26;line-height:1.15}
.dx-sci{font-style:italic;color:#6b7280;font-size:11.5px;margin-top:2px}
.dx-meta{display:flex;gap:14px;margin-top:8px;font-size:10.5px;flex-wrap:wrap}
.dx-meta div b{display:block;font-size:8.5px;text-transform:uppercase;letter-spacing:.8px;color:#6b7280;font-weight:600;margin-bottom:1px}
.dx-meta div span{font-weight:600;color:#1c2526}
.confidence-ring{position:relative;width:120px;height:120px;flex-shrink:0}
.confidence-ring svg{transform:rotate(-90deg);display:block}
.confidence-ring .label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.confidence-ring .label .v{font-family:Georgia,serif;font-size:26px;color:#0e3a26;font-weight:700;line-height:1}
.confidence-ring .label .l{font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:#6b7280;margin-top:4px;text-align:center;line-height:1.3}

/* Severity meters */
.severity-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
.meter{background:#fff;border:1px solid #d9cfb4;padding:10px 12px}
.meter .lbl{font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;font-weight:600;margin-bottom:6px}
.meter .val{font-family:Georgia,serif;font-size:16px;font-weight:700;color:#b8443e}
.meter.green .val{color:#1a5f3f}
.meter .bar{height:6px;background:#eee;border-radius:3px;margin-top:8px;overflow:hidden}
.meter .bar .fill{height:100%;background:linear-gradient(90deg,#f0c47a,#b8443e)}
.meter.green .bar .fill{background:linear-gradient(90deg,#b8d6c2,#1a5f3f)}

/* Differential list */
.diff{display:grid;grid-template-columns:1fr auto;gap:12px;padding:8px 12px;background:#fff;border:1px solid #d9cfb4;align-items:center;margin-top:6px;font-size:11px}
.diff .nm{font-weight:600;color:#0e3a26}
.diff .nm i{display:block;font-weight:400;font-size:10px;color:#6b7280}
.diff .why{font-size:10.5px;color:#6b7280;margin-top:2px}

/* Etiology */
.etiology-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px}
.etbox{background:#fff;border:1px solid #d9cfb4;padding:10px 12px}
.etbox h4{font-family:Georgia,serif;font-size:11px;color:#0e3a26;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
.etbox p{font-size:11px;line-height:1.5;margin:0}

/* Prescription */
.rx-block{margin-top:16px;border:2px solid #c9a961;background:#fff;position:relative}
.rx-block::before{content:"℞";position:absolute;top:-20px;left:14px;background:#fefdf8;padding:0 8px;font-family:Georgia,serif;font-size:28px;color:#1a5f3f;font-weight:900;line-height:1}
.rx-block::after{content:"PRESCRIPTION";position:absolute;top:-8px;left:50px;background:#c9a961;color:#0e3a26;padding:1px 8px;font-size:9px;letter-spacing:2px;font-weight:700}
.rx-table{width:100%;border-collapse:collapse;font-size:10.5px}
.rx-table th{background:#f1f7f3;color:#0e3a26;text-align:left;padding:8px 10px;font-size:9px;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #c9a961;font-weight:700}
.rx-table td{padding:8px 10px;border-bottom:1px dotted #d9cfb4;vertical-align:top}
.rx-table tr:last-child td{border-bottom:none}
.rx-table tbody tr:nth-child(even){background:#fbf8ef}
.rx-table .active{font-weight:600;color:#0e3a26}
.rx-table .active i{display:block;font-weight:400;font-size:9.5px;color:#6b7280;margin-top:2px;font-style:italic}
.rx-tier{display:inline-block;font-family:'Courier New',monospace;font-size:8.5px;background:#1a5f3f;color:#c9a961;padding:1px 5px;letter-spacing:.5px;margin-right:4px}
.rx-tier.bio{background:#2d8659}
.rx-tier.cult{background:#a07f3d;color:#fff}

.warning{margin-top:10px;padding:8px 12px;background:#f5e2e0;border-left:3px solid #b8443e;font-size:10.5px;line-height:1.5}
.warning b{color:#b8443e;text-transform:uppercase;letter-spacing:.5px;font-size:10px;display:block;margin-bottom:2px}

/* Prognosis cards */
.prog-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:4px}
.prog{background:#f7f3e8;border:1px solid #d9cfb4;padding:12px;text-align:center}
.prog .ic{font-family:Georgia,serif;font-size:17px;color:#1a5f3f;font-weight:700;line-height:1.1}
.prog .lb{font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;margin-top:6px;font-weight:600;line-height:1.3}

/* Follow-up */
.followup{display:grid;grid-template-columns:1fr 2fr;gap:14px;background:#f1f7f3;border:1px dashed #1a5f3f;padding:12px 14px;margin-top:4px}
.followup .when{font-family:Georgia,serif;font-size:16px;color:#0e3a26;font-weight:700;line-height:1.2}
.followup .when span{display:block;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;font-weight:600;margin-top:4px;font-family:Georgia,serif}
.followup .what{font-size:10.5px;line-height:1.5}
.followup .what b{color:#0e3a26;display:block;font-size:10px;text-transform:uppercase;letter-spacing:.8px;margin-bottom:2px}

/* Local-language strip — gold-bordered, one per section */
.local-msg{margin-top:10px;border:1px solid #c9a961;padding:10px 14px;background:#fcf6e3;font-size:11.5px;line-height:1.6}
.local-msg b{color:#0e3a26;display:block;font-family:Georgia,serif;margin-bottom:4px;font-size:10px;letter-spacing:1px;text-transform:uppercase}

/* Footer */
.footer{margin-top:20px;border-top:2px solid #1a5f3f;padding:14px 24px 18px;background:#f7f3e8;font-size:9.5px;color:#6b7280;position:relative}
.sig-row{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:30px 0 10px}
.sig{border-top:1px solid #1c2526;padding-top:4px;text-align:center}
.sig b{display:block;color:#1c2526;font-weight:600;letter-spacing:.5px;font-size:10px}
.sig span{font-size:8.5px;color:#6b7280}
.stamp{position:absolute;right:30px;top:8px;width:110px;height:110px;border:2px double #b8443e;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#b8443e;transform:rotate(-12deg);opacity:.55;font-family:Georgia,serif;font-size:10px;letter-spacing:1.5px;text-align:center;line-height:1.3;background:rgba(255,255,255,.5);font-weight:700;pointer-events:none}
.stamp b{font-size:11px;display:block;margin:2px 0}
.helpline{display:flex;justify-content:space-between;font-family:'Courier New',monospace;font-size:9.5px;margin-bottom:8px;color:#1c2526;flex-wrap:wrap;gap:6px}
.helpline b{color:#1a5f3f}
.disclaimer{font-size:8.5px;letter-spacing:.3px;line-height:1.5;color:#6b7280;text-align:center;border-top:1px dotted #d9cfb4;padding-top:8px}

@media print{body{background:#fff}.page{border-left:6px solid #1a5f3f}}

/* ── Extended-detail pages (page 2+) ─────────────────────────────────── */
/* Force a page break before the second article. */
.page.cont{page-break-before:always}
/* Numbered practice list */
.practice-list{counter-reset:pr;list-style:none;padding:0;margin:6px 0 0}
.practice-list li{counter-increment:pr;position:relative;padding:8px 12px 8px 36px;background:#fff;border:1px solid #d9cfb4;margin-bottom:6px;font-size:11px;line-height:1.5}
.practice-list li::before{content:counter(pr);position:absolute;left:10px;top:50%;transform:translateY(-50%);width:20px;height:20px;border-radius:50%;background:#1a5f3f;color:#c9a961;font-family:'Courier New',monospace;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center}
/* Two-column safety lists */
.safety-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:6px}
.safety-cols .col{background:#fff;border:1px solid #d9cfb4;padding:10px 12px}
.safety-cols .col h4{font-family:Georgia,serif;font-size:10.5px;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;padding-bottom:4px;border-bottom:1px dotted #d9cfb4}
.safety-cols .col.do h4{color:#0e3a26}
.safety-cols .col.dont h4{color:#b8443e}
.safety-cols ul{list-style:none;padding:0;margin:0}
.safety-cols li{font-size:10.5px;padding:4px 0 4px 16px;line-height:1.45;position:relative}
.safety-cols .do li::before{content:"✓";position:absolute;left:0;color:#1a5f3f;font-weight:700}
.safety-cols .dont li::before{content:"✗";position:absolute;left:0;color:#b8443e;font-weight:700}
/* Product/biological cards */
.bio-card{border:1px solid #d9cfb4;background:#fff;padding:10px 12px;margin-bottom:8px}
.bio-card .h{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px}
.bio-card .h .nm{font-family:Georgia,serif;font-size:12.5px;color:#0e3a26;font-weight:700}
.bio-card .h .nm i{display:block;font-weight:400;font-size:10px;color:#6b7280;font-style:italic;margin-top:2px}
.bio-card .h .cost{font-family:'Courier New',monospace;font-size:11px;color:#1a5f3f;font-weight:700;white-space:nowrap}
.bio-card .meta{display:grid;grid-template-columns:repeat(2,1fr);gap:4px 18px;font-size:10.5px;margin-top:4px}
.bio-card .meta div{padding:2px 0}
.bio-card .meta b{color:#6b7280;font-size:9.5px;letter-spacing:.7px;text-transform:uppercase;font-weight:600;display:inline-block;min-width:80px}
.bio-card .brands{margin-top:6px;font-size:10px;color:#6b7280}
.bio-card .brands b{color:#1a5f3f;font-weight:600}
/* Dispensing sheet table */
.disp-table{width:100%;border-collapse:collapse;font-size:10.5px;margin-top:6px}
.disp-table th{background:#1a5f3f;color:#c9a961;text-align:left;padding:7px 9px;font-size:9px;letter-spacing:1px;text-transform:uppercase;font-weight:700}
.disp-table td{padding:8px 9px;border-bottom:1px dotted #d9cfb4;vertical-align:top}
.disp-table tr:nth-child(even) td{background:#fbf8ef}
.disp-table .nm{font-weight:600;color:#0e3a26}
.disp-table .nm i{display:block;font-weight:400;font-size:9.5px;color:#6b7280;font-style:italic;margin-top:1px}
.disp-table .pr{font-family:'Courier New',monospace;font-weight:700;color:#1a5f3f;text-align:right;white-space:nowrap}
.disp-total{margin-top:6px;padding:8px 12px;background:#1a5f3f;color:#fff;font-family:Georgia,serif;font-size:12px;font-weight:700;display:flex;justify-content:space-between;align-items:center}
.disp-total span{font-family:'Courier New',monospace;color:#c9a961}
/* Compliance audit */
.audit-row{display:grid;grid-template-columns:auto 1fr auto;gap:12px;padding:8px 12px;background:#fff;border:1px solid #d9cfb4;margin-bottom:5px;font-size:11px;align-items:center}
.audit-row .check{font-family:Georgia,serif;font-weight:700;color:#0e3a26}
.audit-row .check i{display:block;font-weight:400;font-size:10px;color:#6b7280;font-style:normal;margin-top:1px}
.audit-row .status{padding:3px 9px;font-size:9px;letter-spacing:1.2px;font-weight:700;border-radius:2px}
.audit-row .status.PASSED{background:#cfe5d8;color:#0e3a26}
.audit-row .status.WARNING{background:#fdf1d8;color:#d99a3a}
.audit-row .status.FAILED{background:#f5e2e0;color:#b8443e}
.audit-row .status.N\/A{background:#eee;color:#6b7280}
/* Evidence matrix */
.ev-table{width:100%;border-collapse:collapse;font-size:10.5px;margin-top:6px}
.ev-table th{background:#f1f7f3;color:#0e3a26;text-align:left;padding:6px 9px;font-size:9px;letter-spacing:1px;text-transform:uppercase;font-weight:700;border-bottom:1px solid #c9a961}
.ev-table td{padding:7px 9px;border-bottom:1px dotted #d9cfb4}
.ev-table tr.primary{background:#fdf6df}
.ev-table tr.primary td{font-weight:600}
.ev-table .pct{font-family:'Courier New',monospace;text-align:right}
/* Forecast strip */
.fc-row{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:6px}
.fc-cell{background:#fff;border:1px solid #d9cfb4;padding:8px 6px;text-align:center;font-size:10px}
.fc-cell .d{font-family:Georgia,serif;font-weight:700;color:#0e3a26;font-size:10.5px}
.fc-cell .t{margin-top:2px;color:#1c2526;font-family:'Courier New',monospace;font-size:9.5px}
.fc-cell .r{margin-top:2px;color:#1a5f3f;font-size:9px;font-weight:600}
.fc-cell .r.wet{color:#3a78b3}
/* Metadata */
.meta-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:2px 20px;font-size:10.5px;margin-top:6px;background:#fff;border:1px solid #d9cfb4;padding:10px 14px}
.meta-grid div{padding:3px 0;border-bottom:1px dotted #eee}
.meta-grid b{color:#6b7280;font-size:9.5px;letter-spacing:.7px;text-transform:uppercase;font-weight:600;display:inline-block;min-width:120px}
.meta-grid .mono{font-family:'Courier New',monospace;font-size:10px}
/* Visual audit pills */
.va-row{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
.va-pill{padding:3px 8px;font-size:10px;border-radius:2px;font-family:'Courier New',monospace}
.va-pill.ok{background:#cfe5d8;color:#0e3a26}
.va-pill.no{background:#f5e2e0;color:#b8443e}
.va-pill.un{background:#fdf1d8;color:#d99a3a}
</style>
</head>
<body>
<article class="page">

  <header class="header">
    <div class="logo-row">
      <div class="crest">\u{1F33F}</div>
      <div>
        <div class="lab-name">CropSetu<span class="ai">AI</span></div>
        <div class="lab-sub">${t('diagReport.labSub')}</div>
        <div class="lab-tag">${t('diagReport.labTag')}</div>
      </div>
    </div>
    <div class="meta">
      <div><span class="pill">${esc(rptId)}</span></div>
      <div><b>${t('diagReport.date')}</b> ${esc(dateStr)} · ${esc(timeStr)} IST</div>
      <div><b>${t('diagReport.pathologistAi')}</b> CropSetu v${esc(sysMeta.version || '2.4.1')}</div>
      <div><b>${t('diagReport.visionModel')}</b> ${esc(sysMeta.diagnosis_model || 'Gemini 2.5 Flash')}</div>
      <div><b>${t('diagReport.language')}</b> English${showLocal ? ` + ${esc(localLangName)}` : ''}</div>
    </div>
  </header>

  <div class="report-title">${t('diagReport.reportTitle')}</div>
  <div class="report-sub">${t('diagReport.reportSub')}</div>

  <div class="body">

    <!-- 1. PATIENT SUMMARY -->
    <section class="section">
      <div class="section-h"><span class="num">1</span> ${t('diagReport.patientSummary')} <span class="bar"></span></div>
      <div class="summary-card">
        <b>${na(landTotal, '-acre')} ${esc(crop)}${farmCtx.cropVariety || farmCtx.variety ? ` (${esc(farmCtx.cropVariety || farmCtx.variety)})` : ''}${stage ? `, ${esc(stage)}` : ''}${farmCtx.cropAge ? `, ${esc(farmCtx.cropAge)} DAS` : ''}</b>${farmerVillage ? `, ${t('diagReport.locatedIn', { location: esc(farmerVillage) })}` : ''}.
        ${farmerSummaryText ? esc(farmerSummaryText) : `${t('diagReport.presentsWith', { disease: esc(diseaseName) })} ${t('diagReport.severityAssessed', { severity: esc(sevTxt.toLowerCase()) })}${affectedArea ? `, ${t('diagReport.withApproxAffected', { area: esc(affectedArea) })}` : ''}.`}
      </div>
      ${localStrip('summary', 'Farmer summary')}
    </section>

    <!-- 2. CASE HISTORY -->
    <section class="section">
      <div class="section-h"><span class="num">2</span> ${t('diagReport.caseHistory')} <span class="bar"></span></div>
      <div class="kv-grid">
        ${farmerName ? `<div class="kv"><span class="k">${t('diagReport.farmer')}</span><span class="v">${esc(farmerName)}</span></div>` : ''}
        ${farmerPhone ? `<div class="kv"><span class="k">${t('diagReport.phone')}</span><span class="v mono">${esc(farmerPhone)}</span></div>` : ''}
        ${farmerVillage ? `<div class="kv"><span class="k">${t('diagReport.location')}</span><span class="v">${esc(farmerVillage)}</span></div>` : ''}
        <div class="kv"><span class="k">${t('diagReport.fieldArea')}</span><span class="v">${na(landTotal, ' acres')}</span></div>
        <div class="kv"><span class="k">${t('diagReport.cropVariety')}</span><span class="v">${esc(crop)}${farmCtx.cropVariety || farmCtx.variety ? ` · ${esc(farmCtx.cropVariety || farmCtx.variety)}` : ''}</span></div>
        ${stage ? `<div class="kv"><span class="k">${t('diagReport.growthStage')}</span><span class="v">${esc(stage)}</span></div>` : ''}
        ${farmCtx.cropAge ? `<div class="kv"><span class="k">${t('diagReport.cropAge')}</span><span class="v">${esc(farmCtx.cropAge)} ${t('diagReport.days')}</span></div>` : ''}
        ${affectedArea ? `<div class="kv"><span class="k">${t('diagReport.affectedArea')}</span><span class="v">${esc(affectedArea)}</span></div>` : ''}
        ${farmCtx.previousCrop ? `<div class="kv"><span class="k">${t('diagReport.previousCrop')}</span><span class="v">${esc(farmCtx.previousCrop)}</span></div>` : ''}
        ${farmCtx.season ? `<div class="kv"><span class="k">${t('diagReport.season')}</span><span class="v">${esc(farmCtx.season)}</span></div>` : ''}
        ${farmCtx.firstNoticed ? `<div class="kv"><span class="k">${t('diagReport.firstNoticed')}</span><span class="v">${esc(farmCtx.firstNoticed)}</span></div>` : ''}
      </div>
    </section>

    <!-- 3. ENVIRONMENTAL CONTEXT -->
    ${(tempVal != null || humVal != null || farmCtx.soilType || farmCtx.irrigationType) ? `
    <section class="section">
      <div class="section-h"><span class="num">3</span> ${t('diagReport.environmentalContext')} <span class="bar"></span></div>
      <div class="kv-grid">
        ${farmCtx.soilType ? `<div class="kv"><span class="k">${t('diagReport.soilType')}</span><span class="v">${esc(farmCtx.soilType)}</span></div>` : ''}
        ${farmCtx.irrigationType ? `<div class="kv"><span class="k">${t('diagReport.irrigation')}</span><span class="v">${esc(farmCtx.irrigationType)}</span></div>` : ''}
        ${tempVal != null ? `<div class="kv"><span class="k">${t('diagReport.temperature')}</span><span class="v mono">${tempVal}°C${tempVal >= 15 && tempVal <= 25 ? ` <span class="tag bad">${t('diagReport.tagDiseaseProne')}</span>` : tempVal > 30 ? ` <span class="tag warn">${t('diagReport.tagHot')}</span>` : ''}</span></div>` : ''}
        ${humVal != null ? `<div class="kv"><span class="k">${t('diagReport.humidity')}</span><span class="v mono">${humVal}%${humVal > 80 ? ` <span class="tag bad">${t('diagReport.tagHigh')}</span>` : humVal > 65 ? ` <span class="tag warn">${t('diagReport.tagElevated')}</span>` : ''}</span></div>` : ''}
        ${precipV != null ? `<div class="kv"><span class="k">${t('diagReport.rainfallRecent')}</span><span class="v mono">${precipV} mm${precipV > 20 ? ` <span class="tag bad">${t('diagReport.tagHeavy')}</span>` : ''}</span></div>` : ''}
        ${leafWet != null ? `<div class="kv"><span class="k">${t('diagReport.leafWetness')}</span><span class="v mono">${leafWet} ${t('diagReport.hrsPerDay')}${parseFloat(leafWet) > 6 ? ` <span class="tag bad">${t('diagReport.tagTrigger')}</span>` : ''}</span></div>` : ''}
        ${weatherRiskLevel ? `<div class="kv"><span class="k">${t('diagReport.overallRisk')}</span><span class="v">${esc(weatherRiskLevel)}</span></div>` : ''}
        ${soilRisk ? `<div class="kv"><span class="k">${t('diagReport.soilRisk')}</span><span class="v">${esc(soilRisk)}</span></div>` : ''}
      </div>
    </section>` : ''}

    <!-- 4. VISUAL EXAMINATION -->
    <section class="section">
      <div class="section-h"><span class="num">4</span> ${t('diagReport.visualExamination')} <span class="bar"></span></div>
      <div class="img-grid">
        <div class="specimen">
          <div class="img-wrap">
            ${imgSrc ? `<img src="${imgSrc}" alt="${t('diagReport.submittedCropPhotoAlt')}"/>` : `<div class="img-ph">${t('diagReport.noImageCaptured')}</div>`}
          </div>
          <div class="caption"><span>IMG-01 · ${t('diagReport.submittedLeaf')}</span> <b>${t('diagReport.fieldPhoto')}</b></div>
        </div>
        <div class="specimen">
          <div class="img-wrap" style="background:linear-gradient(135deg,#f7f3e8,#cfe5d8)">
            <div style="text-align:center">
              <div style="font-family:Georgia,serif;font-size:32px;font-weight:900;color:#1a5f3f;line-height:1">${confPct}%</div>
              <div style="font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-top:6px;font-weight:600">${t('diagReport.aiConfidence')}</div>
              <div style="font-weight:700;font-size:12px;margin-top:6px;color:#0e3a26">${esc(diseaseName)}</div>
            </div>
          </div>
          <div class="caption"><span>IMG-02 · ${t('diagReport.aiOverlay')}</span> <b>${esc(confTierR)}</b></div>
        </div>
      </div>
      ${syms.length > 0 ? `<div style="margin-top:8px;font-size:11px;line-height:1.5">
        <b style="color:#0e3a26">${t('diagReport.clinicalObservations')}</b>
        <ul style="margin:4px 0 0 16px;padding:0">
          ${syms.slice(0, 5).map(s => `<li>${esc(s)}</li>`).join('')}
        </ul>
      </div>` : ''}
    </section>

    <!-- 5. PRIMARY DIAGNOSIS -->
    <section class="section">
      <div class="diagnosis-hero">
        <div>
          <div class="dx-name">${esc(diseaseName)}</div>
          ${diseaseSci ? `<div class="dx-sci">${esc(diseaseSci)}</div>` : ''}
          <div class="dx-meta">
            ${diseasePathogen ? `<div><b>${t('diagReport.pathogenType')}</b><span>${esc(diseasePathogen)}</span></div>` : ''}
            <div><b>${t('diagReport.severity')}</b><span style="color:${severity === 'critical' || severity === 'high' ? '#b8443e' : severity === 'moderate' ? '#d99a3a' : '#1a5f3f'}">${esc(sevTxt)}</span></div>
            ${spreadRisk ? `<div><b>${t('diagReport.spread')}</b><span>${esc(spreadRisk)}</span></div>` : ''}
          </div>
        </div>
        <div class="confidence-ring">
          <svg width="120" height="120" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="50" fill="none" stroke="#e8e0c8" stroke-width="9"/>
            <circle cx="60" cy="60" r="50" fill="none" stroke="#1a5f3f" stroke-width="9"
                    stroke-dasharray="314.16" stroke-dashoffset="${(314.16 - (314.16 * confPct / 100)).toFixed(2)}" stroke-linecap="round"/>
          </svg>
          <div class="label">
            <div class="v">${confPct}%</div>
            <div class="l">${t('diagReport.detection')}<br/>${t('diagReport.confidence')}</div>
          </div>
        </div>
      </div>

      <div class="severity-row">
        <div class="meter${severity === 'low' ? ' green' : ''}">
          <div class="lbl">${t('diagReport.severityLevel')}</div>
          <div class="val">${esc(sevTxt)}</div>
          <div class="bar"><div class="fill" style="width:${severity === 'critical' ? 95 : severity === 'high' ? 75 : severity === 'moderate' ? 50 : 25}%"></div></div>
        </div>
        <div class="meter green">
          <div class="lbl">${t('diagReport.treatmentWindow')}</div>
          <div class="val">${urgHoursR}h</div>
          <div class="bar"><div class="fill" style="width:${urgHoursR <= 24 ? 30 : urgHoursR <= 48 ? 55 : 80}%"></div></div>
        </div>
      </div>
      ${localStrip('diagnosis', 'Diagnosis summary')}
    </section>

    <!-- 6. DIFFERENTIAL DIAGNOSIS -->
    ${diffs.length > 0 ? `
    <section class="section">
      <div class="section-h"><span class="num">5</span> ${t('diagReport.differentialDiagnosis')} <span class="bar"></span></div>
      ${diffs.slice(0, 3).map(dd => `<div class="diff">
        <div>
          <div class="nm">${esc(dd.disease || '')}${dd.scientific_name || dd.scientific ? `<i>${esc(dd.scientific_name || dd.scientific)}</i>` : ''}</div>
          <div class="why">${dd.reasoning || dd.note ? esc(dd.reasoning || dd.note) : t('diagReport.consideredAltDiagnosis')}</div>
        </div>
        <div><span class="tag warn">${dd.probability != null ? `${Math.round(dd.probability * 100)}%` : t('diagReport.considered')}</span></div>
      </div>`).join('')}
    </section>` : ''}

    <!-- 7. ETIOLOGY -->
    ${causes.length > 0 ? `
    <section class="section">
      <div class="section-h"><span class="num">${diffs.length > 0 ? 6 : 5}</span> ${t('diagReport.etiology')} <span class="bar"></span></div>
      <div class="etiology-grid">
        ${causes.slice(0, 4).map((c, i) => {
          const titles = [t('diagReport.triggeringConditions'), t('diagReport.lifecycle'), t('diagReport.modeOfSpread'), t('diagReport.predisposingFactors')];
          const text = typeof c === 'string' ? c : (c.cause || c.text || c.explanation || '');
          return `<div class="etbox"><h4>${titles[i] || t('diagReport.factorN', { n: i + 1 })}</h4><p>${esc(text)}</p></div>`;
        }).join('')}
      </div>
    </section>` : ''}

    <!-- 8. PRESCRIPTION -->
    ${dispProd.length > 0 ? `
    <section class="section">
      <div class="section-h"><span class="num">${(diffs.length > 0 ? 1 : 0) + (causes.length > 0 ? 1 : 0) + 5}</span> ${t('diagReport.treatmentPlan')} <span class="bar"></span></div>
      <div class="rx-block">
        <table class="rx-table">
          <thead>
            <tr><th style="width:18%">${t('diagReport.tier')}</th><th style="width:30%">${t('diagReport.activeIngredient')}</th><th>${t('diagReport.brands')}</th><th>${t('diagReport.dose')}</th><th>${t('diagReport.schedule')}</th></tr>
          </thead>
          <tbody>
            ${dispProd.slice(0, 4).map((p, i) => `<tr>
              <td><span class="rx-tier">CHEM</span> ${i === 0 ? t('diagReport.curative') : i === 1 ? t('diagReport.rotation') : t('diagReport.protectant')}</td>
              <td class="active">${esc(p.product || '')}${p.frac_irac_group ? `<i>FRAC: ${esc(p.frac_irac_group)}</i>` : ''}</td>
              <td>${esc(p.brand_names || '—')}</td>
              <td><b>${esc((spraySchedule[i] && spraySchedule[i].dose) || p.dose || '—')}</b>${p.quantity_for_farm ? `<br/><span style="font-size:9.5px;color:#6b7280">${esc(p.quantity_for_farm)}</span>` : ''}</td>
              <td>${esc(p.when || `Day ${i * 7}`)}</td>
            </tr>`).join('')}
            ${biologicalR.length > 0 ? biologicalR.slice(0, 1).map(b => `<tr>
              <td><span class="rx-tier bio">BIO</span> ${t('diagReport.bioFungicide')}</td>
              <td class="active">${esc(b.product || b.name || '')}${b.dosage ? `<i>${esc(b.dosage)}</i>` : ''}</td>
              <td>${esc(b.brands || '—')}</td>
              <td>${esc(b.dosage_per_acre || b.dosage || '—')}</td>
              <td>${t('diagReport.alternateWeek')}</td>
            </tr>`).join('') : ''}
            ${culturalPR.length > 0 ? `<tr>
              <td><span class="rx-tier cult">CULT</span> ${t('diagReport.cultural')}</td>
              <td class="active">${t('diagReport.canopyManagement')}</td>
              <td>—</td>
              <td>—</td>
              <td>${esc(((typeof culturalPR[0] === 'string' ? culturalPR[0] : (culturalPR[0]?.practice || ''))).slice(0, 60))}${culturalPR.length > 1 ? '…' : ''}</td>
            </tr>` : ''}
          </tbody>
        </table>
      </div>
      ${(rotationPlanR || doNotUseR.length > 0 || safetyDontList.length > 0) ? `
      <div class="warning">
        <b>⚠ ${t('diagReport.resistanceSafetyNotes')}</b>
        ${rotationPlanR ? `${esc(rotationPlanR)}. ` : ''}${doNotUseR.slice(0, 2).map(d => esc(typeof d === 'string' ? d : (d.warning || ''))).filter(Boolean).join('. ')}${doNotUseR.length === 0 && safetyDontList.length > 0 ? safetyDontList.slice(0, 2).map(s => esc(s)).join('. ') : ''} ${t('diagReport.sprayEarlyMorningPpePhi')}
      </div>` : ''}
      ${localStrip('treatment', 'Treatment summary')}
    </section>` : ''}

    <!-- 9. PROGNOSIS -->
    <section class="section">
      <div class="section-h"><span class="num">${(diffs.length > 0 ? 1 : 0) + (causes.length > 0 ? 1 : 0) + (dispProd.length > 0 ? 1 : 0) + 5}</span> ${t('diagReport.prognosis')} <span class="bar"></span></div>
      <div class="prog-row">
        <div class="prog"><div class="ic">10-14 d</div><div class="lb">${t('diagReport.recoveryIfRxFollowed')}</div></div>
        <div class="prog"><div class="ic">${estYieldLoss ? esc(estYieldLoss) : '8-12%'}</div><div class="lb">${t('diagReport.yieldLossTreated')}</div></div>
        <div class="prog"><div class="ic">45-60%</div><div class="lb">${t('diagReport.yieldLossUntreated')}</div></div>
      </div>
      ${weatherRiskLevel ? `<p style="margin-top:8px;font-size:10.5px"><b>${t('diagReport.reinfectionRisk')}</b>
        <span class="tag ${(weatherRiskLevel || '').toUpperCase().includes('HIGH') || (weatherRiskLevel || '').toUpperCase().includes('CRITICAL') ? 'bad' : 'warn'}">${esc(weatherRiskLevel.toUpperCase())}</span>${weatherAdvisory ? ` — ${esc(weatherAdvisory)}` : ''}
      </p>` : ''}
      ${localStrip('prognosis', 'Prognosis summary')}
    </section>

    <!-- 10. FOLLOW-UP -->
    <section class="section">
      <div class="section-h"><span class="num">${(diffs.length > 0 ? 1 : 0) + (causes.length > 0 ? 1 : 0) + (dispProd.length > 0 ? 1 : 0) + 6}</span> ${t('diagReport.followUp')} <span class="bar"></span></div>
      <div class="followup">
        <div class="when">${esc(new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }))}<span>${t('diagReport.reExamination')}</span></div>
        <div class="what">
          <b>${t('diagReport.recheckParameters')}</b> ${t('diagReport.recheckParametersText')}<br/>
          <b style="margin-top:6px;color:#b8443e">${t('diagReport.escalateToKvk')}</b> ${t('diagReport.escalateToKvkText')}
        </div>
      </div>
      ${localStrip('follow_up', 'Follow-up summary')}
    </section>

  </div>

  <!-- FOOTER -->
  <footer class="footer">
    <div class="stamp"><div><b>${t('diagReport.verified')}</b>CROPSETU AI<br/>v${esc(sysMeta.version || '2.4.1')}</div></div>
    <div class="sig-row">
      <div class="sig"><b>CropSetu AI</b><span>${t('diagReport.diagnosingPathologist')}</span></div>
      <div class="sig"><b>${esc(farmCtx.district ? `KVK ${farmCtx.district}` : t('diagReport.localAgronomist'))}</b><span>${t('diagReport.reviewingAuthority')}</span></div>
      <div class="sig"><b>${esc(farmerName || t('diagReport.farmer'))}</b><span>${t('diagReport.recipient')}</span></div>
    </div>
    <div class="helpline">
      <div>\u{1F4DE} ${t('diagReport.kisanCallCentre')} <b>1800-180-1551</b></div>
      <div>\u{1F310} ${t('diagReport.kvkLocator')} <b>kvk.icar.gov.in</b></div>
      <div>\u{1F6A8} ${t('diagReport.plantHelpline')} <b>1551</b></div>
    </div>
    <div class="disclaimer">
      ${esc(disclaimerEn)}
    </div>
  </footer>

</article>

${(() => {
  // ── Page 2+: extended detail. Every block below ONLY renders if its
  //    underlying data exists, so this article shrinks naturally on
  //    sparse reports (e.g. no chemicals registered, no forecast).
  const preventiveR  = dgp.preventive_measures || fullTx.preventive || [];
  const longTermR    = dgp.long_term_recommendations || fullTx.long_term_recommendations || [];
  const fertilizerR  = fullTx.fertilizer || fullTx.fertilizer_recommendations || [];
  const ppeChecklist = dsp.ppe_checklist || [];
  const totalCostR2  = dsp.total_estimated_cost_inr || '';
  const subsR2       = dsp.substitutes || [];
  const incompR2     = dsp.incompatibilities || [];
  const safetyDo2    = dgp.safety_checklist?.do || [];
  const safetyDont2  = dgp.safety_checklist?.dont || [];
  const compAudit2   = anp.compliance_audit || [];
  const compSummary  = anp.compliance_summary || {};
  const evMatrix2    = anp.evidence_matrix?.diseases || [];
  const modelAgree2  = anp.evidence_matrix?.model_agreement || (full.meta || {}).perspective_agreement || '';
  const confPenalt   = (full.meta || {}).confidence_penalties || [];
  const lookAlikes   = anp.look_alikes_ruled_out || (full.meta || {}).look_alikes_ruled_out || [];
  const visualAudit  = (full.meta || {}).visual_audit || {};
  const vaClaimed    = Array.isArray(visualAudit.claimed)    ? visualAudit.claimed    : [];
  const vaVerified   = Array.isArray(visualAudit.verified)   ? visualAudit.verified   : [];
  const vaFalsified  = Array.isArray(visualAudit.falsified)  ? visualAudit.falsified  : [];
  const vaUnverified = Array.isArray(visualAudit.unverified) ? visualAudit.unverified : [];
  const fc7Day       = Array.isArray(rawForecast) ? rawForecast.slice(0, 7) : [];
  const tokensUsage  = (full.meta || {}).pipeline_token_usage || {};
  const ensUsed      = (full.meta || {}).ensemble_used || false;
  const ensAgree     = (full.meta || {}).ensemble_agreement || null;
  const ensModels    = (full.meta || {}).ensemble_models || [];
  const pipelineSec  = (full.meta || {}).pipeline_seconds || null;
  const tierR        = (full.meta || {}).tier || '';
  const modelDxR     = (full.meta || {}).model_diagnose || '';
  const modelTxR     = (full.meta || {}).model_treatment || '';
  const promptsR     = (full.meta || {}).prompts || {};
  const safetyR      = (full.meta || {}).safety || {};
  const regVerR      = safetyR.registry_version || '';

  // Nothing to render? Skip the whole extended article.
  const hasAnything = (
    spraySchedule.length > 0 || culturalPR.length > 0 ||
    preventiveR.length > 0 || longTermR.length > 0 ||
    biologicalR.length > 0 || fertilizerR.length > 0 ||
    dispProd.length > 0 || ppeChecklist.length > 0 ||
    safetyDo2.length > 0 || safetyDont2.length > 0 ||
    compAudit2.length > 0 || evMatrix2.length > 0 ||
    fc7Day.length > 0 || tokensUsage.total_tokens > 0
  );
  if (!hasAnything) return '';

  // Day-of-week label for forecast (locale-aware)
  const fcDay = (iso) => {
    try {
      const dd = new Date(iso);
      return dd.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
    } catch { return iso || '—'; }
  };

  return `<article class="page cont">
  <header class="header">
    <div class="logo-row">
      <div class="crest">\u{1F33F}</div>
      <div>
        <div class="lab-name">CropSetu<span class="ai">AI</span> — ${t('diagReport.annex')}</div>
        <div class="lab-sub">${t('diagReport.annexSub')}</div>
      </div>
    </div>
    <div class="meta">
      <div><span class="pill">${esc(rptId)}</span></div>
      <div><b>${t('diagReport.report')}</b> ${esc(reportId.slice(0, 8) || '—')}</div>
      <div><b>${t('diagReport.continuedFromPage1')}</b></div>
    </div>
  </header>

  <div class="body">

    ${biologicalR.length > 0 ? `
    <!-- A. Biological agents — full detail -->
    <section class="section">
      <div class="section-h"><span class="num">A</span> ${t('diagReport.biologicalAlternatives')} <span class="bar"></span></div>
      ${biologicalR.map(b => `<div class="bio-card">
        <div class="h">
          <div class="nm">${esc(b.product || b.agent || b.name || '—')}${b.type ? `<i>${esc(b.type)}</i>` : ''}</div>
          ${b.cost_estimate_inr_per_acre ? `<div class="cost">₹ ${esc(b.cost_estimate_inr_per_acre)}/acre</div>` : ''}
        </div>
        <div class="meta">
          ${b.dosage ? `<div><b>${t('diagReport.dose')}</b> ${esc(b.dosage)}</div>` : ''}
          ${b.dosage_per_acre ? `<div><b>${t('diagReport.perAcre')}</b> ${esc(b.dosage_per_acre)}</div>` : ''}
          ${b.phi_days != null ? `<div><b>PHI</b> ${esc(b.phi_days)} ${t('diagReport.days')}</div>` : ''}
          ${b.application_method ? `<div style="grid-column:1/-1"><b>${t('diagReport.apply')}</b> ${esc(b.application_method)}</div>` : ''}
        </div>
        ${Array.isArray(b.brands) && b.brands.length > 0 ? `<div class="brands"><b>${t('diagReport.brandsLabel')}</b> ${b.brands.map(br => `${esc(br.name)} (${esc(br.company || '')}, ${esc(br.pack || '')}${br.mrp_approx ? `, ~₹${br.mrp_approx}` : ''})`).join(' — ')}</div>` : ''}
      </div>`).join('')}
    </section>` : ''}

    ${fertilizerR.length > 0 ? `
    <!-- B. Fertilizer / nutrition support -->
    <section class="section">
      <div class="section-h"><span class="num">B</span> ${t('diagReport.fertilizerNutrition')} <span class="bar"></span></div>
      ${fertilizerR.map(f => `<div class="bio-card">
        <div class="h">
          <div class="nm">${esc(f.product || f.name || '—')}${f.npk ? `<i>NPK: ${esc(f.npk)}</i>` : ''}</div>
        </div>
        <div class="meta">
          ${f.dosage_per_acre ? `<div><b>${t('diagReport.perAcre')}</b> ${esc(f.dosage_per_acre)}</div>` : ''}
          ${f.timing ? `<div><b>${t('diagReport.timing')}</b> ${esc(f.timing)}</div>` : ''}
          ${f.reason ? `<div style="grid-column:1/-1"><b>${t('diagReport.why')}</b> ${esc(f.reason)}</div>` : ''}
        </div>
      </div>`).join('')}
    </section>` : ''}

    ${culturalPR.length > 0 ? `
    <!-- C. Cultural practices — full list -->
    <section class="section">
      <div class="section-h"><span class="num">C</span> ${t('diagReport.culturalPractices')} <span class="bar"></span></div>
      <ol class="practice-list">
        ${culturalPR.map(p => `<li>${esc(typeof p === 'string' ? p : (p.practice || p.action || ''))}</li>`).join('')}
      </ol>
    </section>` : ''}

    ${preventiveR.length > 0 ? `
    <!-- D. Preventive measures -->
    <section class="section">
      <div class="section-h"><span class="num">D</span> ${t('diagReport.preventiveMeasures')} <span class="bar"></span></div>
      <ol class="practice-list">
        ${preventiveR.map(p => `<li>${esc(typeof p === 'string' ? p : (p.measure || p.action || ''))}</li>`).join('')}
      </ol>
    </section>` : ''}

    ${longTermR.length > 0 ? `
    <!-- E. Long-term recommendations -->
    <section class="section">
      <div class="section-h"><span class="num">E</span> ${t('diagReport.longTermRecommendations')} <span class="bar"></span></div>
      <ol class="practice-list">
        ${longTermR.map(p => `<li>${esc(typeof p === 'string' ? p : (p.recommendation || p.action || ''))}</li>`).join('')}
      </ol>
    </section>` : ''}

    ${(safetyDo2.length > 0 || safetyDont2.length > 0) ? `
    <!-- F. Safety checklist -->
    <section class="section">
      <div class="section-h"><span class="num">F</span> ${t('diagReport.applicatorSafety')} <span class="bar"></span></div>
      <div class="safety-cols">
        <div class="col do">
          <h4>✓ ${t('diagReport.do')}</h4>
          <ul>${safetyDo2.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
        </div>
        <div class="col dont">
          <h4>✗ ${t('diagReport.dont')}</h4>
          <ul>${safetyDont2.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
        </div>
      </div>
    </section>` : ''}

    ${(dispProd.length > 0 || ppeChecklist.length > 0 || incompR2.length > 0) ? `
    <!-- G. Dispensing sheet -->
    <section class="section">
      <div class="section-h"><span class="num">G</span> ${t('diagReport.dispensingSheet')} <span class="bar"></span></div>
      ${dispProd.length > 0 ? `<table class="disp-table">
        <thead><tr><th>#</th><th>${t('diagReport.product')}</th><th>${t('diagReport.brands')}</th><th>${t('diagReport.qty')}</th><th>${t('diagReport.when')}</th><th>FRAC</th><th class="pr">${t('diagReport.estCost')}</th></tr></thead>
        <tbody>
          ${dispProd.map((p, i) => `<tr>
            <td>${i + 1}</td>
            <td class="nm">${esc(p.product || '')}${p.active_ingredient ? `<i>${esc(p.active_ingredient)}</i>` : ''}</td>
            <td>${esc(p.brand_names || '—')}</td>
            <td>${esc(p.quantity_for_farm || '—')}</td>
            <td>${esc(p.when || '—')}</td>
            <td>${esc(p.frac_irac_group || '—')}</td>
            <td class="pr">${esc(p.est_price_inr || '—')}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
      ${totalCostR2 ? `<div class="disp-total"><span>${t('diagReport.totalEstimatedCost')}</span><span>${esc(totalCostR2)}</span></div>` : ''}
      ${ppeChecklist.length > 0 ? `<div style="margin-top:10px"><b style="font-size:10px;letter-spacing:.8px;color:#6b7280;text-transform:uppercase">${t('diagReport.requiredPpe')}</b><div style="margin-top:4px;font-size:10.5px">${ppeChecklist.map(p => `✓ ${esc(p)}`).join('   ')}</div></div>` : ''}
      ${incompR2.length > 0 ? `<div class="warning" style="margin-top:10px">
        <b>⚠ ${t('diagReport.doNotMix')}</b>
        ${incompR2.map(x => `<div>• <b>${esc(x.do_not_mix || '')}</b> — ${esc(x.reason || '')}</div>`).join('')}
      </div>` : ''}
    </section>` : ''}

    ${(compAudit2.length > 0 || regVerR) ? `
    <!-- H. Compliance audit -->
    <section class="section">
      <div class="section-h"><span class="num">H</span> ${t('diagReport.complianceAudit')} <span class="bar"></span></div>
      ${compAudit2.map(c => `<div class="audit-row">
        <div class="check">${esc(c.check || '')}${c.detail ? `<i>${esc(c.detail)}</i>` : ''}</div>
        <div></div>
        <div class="status ${esc(c.status || 'N/A')}">${esc(c.status || 'N/A')}</div>
      </div>`).join('')}
      <div style="margin-top:8px;font-size:9.5px;color:#6b7280;font-family:'Courier New',monospace">
        ${t('diagReport.summaryLabel')} ${compSummary.passed || 0} ${t('diagReport.passed')} • ${compSummary.warning || 0} ${t('diagReport.warning')} • ${compSummary.failed || 0} ${t('diagReport.failed')} • ${compSummary.na || 0} ${t('diagReport.na')}
        ${regVerR ? `— ${t('diagReport.registry')} ${esc(regVerR)}` : ''}
      </div>
    </section>` : ''}

    ${evMatrix2.length > 0 ? `
    <!-- I. Evidence matrix -->
    <section class="section">
      <div class="section-h"><span class="num">I</span> ${t('diagReport.evidenceMatrix')} <span class="bar"></span></div>
      <table class="ev-table">
        <thead><tr><th>${t('diagReport.disease')}</th><th class="pct">${t('diagReport.vision')}</th><th class="pct">${t('diagReport.env')}</th><th class="pct">${t('diagReport.symptom')}</th><th class="pct">${t('diagReport.fused')}</th></tr></thead>
        <tbody>
          ${evMatrix2.map(e => `<tr class="${e.is_primary ? 'primary' : ''}">
            <td>${esc(e.disease || '')}${e.is_primary ? ' ★' : ''}</td>
            <td class="pct">${e.vision_confidence != null ? Math.round(e.vision_confidence * 100) + '%' : '—'}</td>
            <td class="pct">${esc(e.env_favorability || '—')}</td>
            <td class="pct">${e.symptom_match != null ? Math.round(e.symptom_match * 100) + '%' : '—'}</td>
            <td class="pct"><b>${e.fused_score != null ? Math.round(e.fused_score * 100) + '%' : '—'}</b></td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${modelAgree2 ? `<div style="margin-top:6px;font-size:10px;color:#6b7280">${t('diagReport.modelPerspectiveAgreement')} <b style="color:#0e3a26">${esc(modelAgree2)}</b></div>` : ''}
      ${confPenalt.length > 0 ? `<div style="margin-top:4px;font-size:10px;color:#6b7280">${t('diagReport.confidencePenalties')} ${confPenalt.map(p => esc(p)).join('; ')}</div>` : ''}
    </section>` : ''}

    ${lookAlikes.length > 0 ? `
    <!-- J. Look-alikes ruled out -->
    <section class="section">
      <div class="section-h"><span class="num">J</span> ${t('diagReport.lookAlikesRuledOut')} <span class="bar"></span></div>
      ${lookAlikes.map(l => `<div class="diff" style="margin-bottom:5px">
        <div><div class="nm">${esc(l.disease || '')}</div><div class="why">${esc(l.why_ruled_out || l.reason || '')}</div></div>
        <div class="tag warn">${t('diagReport.ruledOut')}</div>
      </div>`).join('')}
    </section>` : ''}

    ${(vaClaimed.length > 0 || vaVerified.length > 0 || vaFalsified.length > 0) ? `
    <!-- K. Visual audit -->
    <section class="section">
      <div class="section-h"><span class="num">K</span> ${t('diagReport.visualAudit')} <span class="bar"></span></div>
      <div style="font-size:10.5px;color:#6b7280;margin-bottom:6px">${t('diagReport.visualAuditDesc')}</div>
      <div style="font-size:11px;margin-bottom:4px"><b style="color:#6b7280;font-size:9.5px;letter-spacing:.8px;text-transform:uppercase">${t('diagReport.verifiedLabel')}</b> <span class="va-row">${vaVerified.map(c => `<span class="va-pill ok">✓ ${esc(c)}</span>`).join('')}</span></div>
      ${vaFalsified.length > 0 ? `<div style="font-size:11px;margin-bottom:4px"><b style="color:#6b7280;font-size:9.5px;letter-spacing:.8px;text-transform:uppercase">${t('diagReport.falsifiedLabel')}</b> <span class="va-row">${vaFalsified.map(c => `<span class="va-pill no">✗ ${esc(c)}</span>`).join('')}</span></div>` : ''}
      ${vaUnverified.length > 0 ? `<div style="font-size:11px;margin-bottom:4px"><b style="color:#6b7280;font-size:9.5px;letter-spacing:.8px;text-transform:uppercase">${t('diagReport.unverifiedLabel')}</b> <span class="va-row">${vaUnverified.map(c => `<span class="va-pill un">? ${esc(c)}</span>`).join('')}</span></div>` : ''}
      ${visualAudit.score_penalty ? `<div style="margin-top:6px;font-size:10px;color:#b8443e">${t('diagReport.confidencePenaltyApplied', { n: visualAudit.score_penalty })}</div>` : ''}
    </section>` : ''}

    ${fc7Day.length > 0 ? `
    <!-- L. 7-day weather forecast -->
    <section class="section">
      <div class="section-h"><span class="num">L</span> ${t('diagReport.weatherForecast')} <span class="bar"></span></div>
      <div class="fc-row">
        ${fc7Day.map(f => `<div class="fc-cell">
          <div class="d">${esc(fcDay(f.date))}</div>
          <div class="t">${f.temp_min != null ? Math.round(f.temp_min) : '?'}–${f.temp_max != null ? Math.round(f.temp_max) : '?'}°C</div>
          <div class="r ${(f.precipitation_sum || 0) > 1 ? 'wet' : ''}">${f.precipitation_sum != null ? f.precipitation_sum.toFixed(1) + 'mm' : '—'}${f.precipitation_probability != null ? ` ${f.precipitation_probability}%` : ''}</div>
        </div>`).join('')}
      </div>
      ${weatherForecast ? `<div style="margin-top:6px;font-size:10.5px;color:#6b7280;font-style:italic">${esc(weatherForecast)}</div>` : ''}
    </section>` : ''}

    <!-- M. System metadata -->
    <section class="section">
      <div class="section-h"><span class="num">M</span> ${t('diagReport.systemMetadata')} <span class="bar"></span></div>
      <div class="meta-grid">
        ${modelDxR ? `<div><b>${t('diagReport.diagnosisModel')}</b> <span class="mono">${esc(modelDxR)}</span></div>` : ''}
        ${modelTxR ? `<div><b>${t('diagReport.treatmentModel')}</b> <span class="mono">${esc(modelTxR)}</span></div>` : ''}
        ${tierR ? `<div><b>${t('diagReport.tierLabel')}</b> ${esc(tierR)}</div>` : ''}
        ${ensUsed ? `<div><b>${t('diagReport.ensembleUsed')}</b> ${t('diagReport.ensembleYes', { n: ensModels.length })}</div>` : `<div><b>${t('diagReport.ensembleUsed')}</b> ${t('diagReport.ensembleNo')}</div>`}
        ${ensAgree ? `<div><b>${t('diagReport.ensembleAgreement')}</b> ${esc(ensAgree)}</div>` : ''}
        ${ensModels.length > 0 ? `<div><b>${t('diagReport.ensembleModels')}</b> <span class="mono">${ensModels.map(m => esc(m)).join(', ')}</span></div>` : ''}
        ${pipelineSec ? `<div><b>${t('diagReport.pipelineLatency')}</b> ${pipelineSec.toFixed(2)}s</div>` : ''}
        ${tokensUsage.total_tokens ? `<div><b>${t('diagReport.totalTokens')}</b> ${tokensUsage.total_tokens.toLocaleString()}</div>` : ''}
        ${tokensUsage.total_cost_usd != null ? `<div><b>${t('diagReport.totalCost')}</b> $${tokensUsage.total_cost_usd.toFixed(5)}</div>` : ''}
        ${promptsR.diagnose?.version ? `<div><b>${t('diagReport.diagnosePrompt')}</b> <span class="mono">${esc(promptsR.diagnose.version)} (${esc(promptsR.diagnose.hash || '')})</span></div>` : ''}
        ${promptsR.treatment?.version ? `<div><b>${t('diagReport.treatmentPrompt')}</b> <span class="mono">${esc(promptsR.treatment.version)} (${esc(promptsR.treatment.hash || '')})</span></div>` : ''}
        ${reportId ? `<div style="grid-column:1/-1"><b>${t('diagReport.reportId')}</b> <span class="mono">${esc(reportId)}</span></div>` : ''}
      </div>
    </section>

  </div>
</article>`;
})()}

</body>
</html>`;

  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      let html = buildReportHTML();

      // Embed scanned image as base64 into PDF (file:// URIs don't work in expo-print)
      if (scannedImageUri) {
        try {
          const b64 = await FileSystem.readAsStringAsync(scannedImageUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const dataUri = `data:image/jpeg;base64,${b64}`;
          // Replace the file:// src with the data URI
          html = html.split(scannedImageUri).join(dataUri);
        } catch (imgErr) {
          logger.error('[Download Report] could not embed image:', imgErr?.message);
        }
      }

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `CropSetu Diagnosis — ${disease}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert(t('diagnosis.savedTitle', 'Saved'), t('diagnosis.savedToPath', { path: uri, defaultValue: 'Report saved to:\n{{path}}' }));
      }
    } catch (err) {
      Alert.alert(t('error', 'Error'), t('diagnosis.reportGenFailed', 'Could not generate report. Please try again.'));
      logger.error('[Download Report] failed to generate PDF:', err?.message);
    } finally {
      setDownloading(false);
    }
  };

  // ── Extract new report structure fields ──
  const fullDisease = full.disease || {};
  const pathogenType = fullDisease.pathogen_type || d.pathogenType || '';
  const confTier = fullDisease.confidence_tier || (confidence >= 85 ? 'HIGH' : confidence >= 70 ? 'MEDIUM' : confidence >= 50 ? 'LOW' : 'VERY_LOW');
  const fullMeta = full.meta || {};
  const diffList = Array.isArray(fullMeta.differentials) ? fullMeta.differentials : [];

  // Spray schedule from new report structure
  const sprayPage = full.detailed_guidance_page || {};
  const sprayItems = sprayPage.spray_schedule?.items || [];
  const safetyDo = sprayPage.safety_checklist?.do || [];
  const safetyDont = sprayPage.safety_checklist?.dont || [];
  const culturalPractices = sprayPage.cultural_practices || fullTx.cultural || [];
  const rotationPlan = fullTx.rotation_plan || sprayPage.spray_schedule?.rotation_note || '';
  const doNotUse = fullTx.do_not_use || [];

  // Dispensing data
  const dispensing = full.dispensing_sheet_page || {};
  const dispProducts = dispensing.products || [];
  const totalCost = dispensing.total_estimated_cost_inr || '';
  const substitutes = dispensing.substitutes || [];
  const incompatibilities = dispensing.incompatibilities || [];

  // Annex data
  const annex = full.annex_page || {};
  const complianceChecks = annex.compliance_audit || [];
  const evidenceMatrix = annex.evidence_matrix?.diseases || [];

  // Urgency config
  const urgHours = severity === 'severe' ? 24 : severity === 'moderate' ? 48 : 120;
  const urgLabel = severity === 'severe'
    ? t('diagnosis.actImmediately', 'ACT IMMEDIATELY')
    : severity === 'moderate'
      ? t('diagnosis.actWithin48h', 'ACT WITHIN 48 HOURS')
      : t('diagnosis.actWithin5d', 'ACT WITHIN 5 DAYS');

  // Pathogen labels
  const pathogenLabels = {
    fungal: t('diagnosis.pathogenFungal', 'Fungus'),
    bacterial: t('diagnosis.pathogenBacterial', 'Bacterium'),
    viral: t('diagnosis.pathogenViral', 'Virus'),
    oomycete: t('diagnosis.pathogenOomycete', 'Oomycete'),
    nematode: t('diagnosis.pathogenNematode', 'Nematode'),
    pest: t('diagnosis.pathogenPest', 'Pest'),
    abiotic: t('diagnosis.pathogenAbiotic', 'Abiotic'),
    nutrient: t('diagnosis.pathogenNutrient', 'Nutrient Deficiency'),
  };

  return (
    <View style={[D.root]}>
      <StatusBar barStyle="light-content" />

      {/* ── Green Header Bar ── */}
      <View style={[D.headerBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={D.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.white} />
        </TouchableOpacity>
        <View style={D.headerBarTitleWrap}>
          {/* Brand eyebrow — "Krushi Drishti" (localized; native script appended per-locale in i18n) */}
          <View style={D.brandEyebrowRow}>
            <Ionicons name="scan-outline" size={11} color="rgba(255,255,255,0.85)" />
            <Text style={D.brandEyebrowText} numberOfLines={1}>
              {t('aiBrand.drishti', language === 'hi' || language === 'mr' ? 'Krushi Drishti · कृषी दृष्टी' : 'Krushi Drishti')}
            </Text>
          </View>
          <Text style={D.headerBarTitle}>{t('diagnosis.headerTitle', 'Crop Disease Report')}</Text>
        </View>
        <TouchableOpacity
          style={D.chatHeaderBtn}
          onPress={() => navigation.navigate('AIChat', {
            initialMessage: `I have ${disease} in my ${crop} at ${farmCtx.cropAge || '?'} days. Severity: ${severity}. What should I do?`
          })}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.white} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
        <Animated.View style={{
          opacity: contentAnim,
          transform: [{ translateY: contentAnim.interpolate({ inputRange: [0,1], outputRange: [20,0] }) }],
        }}>

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION 1 — DISEASE DETECTED (Hero)
              ═══════════════════════════════════════════════════════════════════ */}
          <View style={D.heroCard}>
            {/* Disease name — BIG and clear */}
            <View style={D.heroTop}>
              <View style={{ flex: 1 }}>
                <Text style={D.diseaseLabel}>{t('diagnosis.diseaseDetected', 'DISEASE DETECTED')}</Text>
                <Text style={D.diseaseName}>{disease}</Text>
                {scientific ? (
                  <Text style={D.scientificName}>
                    {scientific}{pathogenType ? ` — ${pathogenLabels[pathogenType] || pathogenType}` : ''}
                  </Text>
                ) : null}
              </View>
              <ConfidenceRing value={confidence} color={confidence >= 70 ? COLORS.primary : confidence >= 50 ? COLORS.amberDark : COLORS.red} size={80} confidenceLabel={confTier} />
            </View>

            {/* Three badge chips in a row */}
            <View style={D.badgeRow}>
              <View style={[D.badge, { backgroundColor: confidence >= 85 ? '#E8F5E9' : confidence >= 70 ? '#FFF8E1' : '#FFEBEE' }]}>
                <Ionicons name="checkmark-circle" size={13} color={confidence >= 85 ? COLORS.primary : confidence >= 70 ? COLORS.amberDark : COLORS.red} />
                <Text style={[D.badgeText, { color: confidence >= 85 ? COLORS.primary : confidence >= 70 ? COLORS.amberDark : COLORS.red }]}>
                  {t('diagnosis.confidenceBadge', { tier: confTier, defaultValue: '{{tier}} CONFIDENCE' })}
                </Text>
              </View>
              <View style={[D.badge, { backgroundColor: sev.color === COLORS.red ? '#FFEBEE' : sev.color === COLORS.amberDark ? '#FFF8E1' : '#E8F5E9' }]}>
                <Ionicons name={sev.icon} size={13} color={sev.color} />
                <Text style={[D.badgeText, { color: sev.color }]}>{t('diagnosis.severityBadge', { severity: (severity || 'moderate').toUpperCase(), defaultValue: '{{severity}} SEVERITY' })}</Text>
              </View>
            </View>
            {!isHealthy && (
              <View style={D.urgencyStrip}>
                <Ionicons name="time-outline" size={14} color={COLORS.red} />
                <Text style={D.urgencyStripText}>{urgLabel}</Text>
              </View>
            )}

            {/* Crop meta row */}
            <View style={D.cropMetaRow}>
              <View style={D.cropMetaItem}>
                <Text style={D.cropMetaValue}>{localizedCrop}</Text>
                <Text style={D.cropMetaLabel}>{t('diagnosis.cropLabel', 'CROP')}</Text>
              </View>
              {stage ? (
                <View style={D.cropMetaItem}>
                  <Text style={D.cropMetaValue}>{stage}</Text>
                  <Text style={D.cropMetaLabel}>{t('diagnosis.stageLabel', 'STAGE')}</Text>
                </View>
              ) : null}
              {farmCtx.landSize ? (
                <View style={D.cropMetaItem}>
                  <Text style={D.cropMetaValue}>{farmCtx.landSize} ac</Text>
                  <Text style={D.cropMetaLabel}>{t('diagnosis.farmSizeLabel', 'FARM SIZE')}</Text>
                </View>
              ) : null}
              {affectedArea ? (
                <View style={D.cropMetaItem}>
                  <Text style={D.cropMetaValue}>{affectedArea}</Text>
                  <Text style={D.cropMetaLabel}>{t('diagnosis.affectedLabel', 'AFFECTED')}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* ═══════════════════════════════════════════════════════════════════
              SCANNED IMAGE — What you submitted vs what AI detected
              ═══════════════════════════════════════════════════════════════════ */}
          {scannedImageUris.length > 0 && (
            <View style={D.section}>
              <View style={D.imageCompareCard}>
                {/* Submitted photo(s) — single image fills the box; multiple
                    images stack the first as the hero with a small horizontal
                    strip of the rest below, so every photo the user uploaded
                    is visible on the report. */}
                <View style={D.imageBox}>
                  <View style={D.imageBoxHeader}>
                    <Ionicons name="camera-outline" size={14} color={COLORS.textMedium} />
                    <Text style={D.imageBoxLabel}>
                      {scannedImageUris.length === 1
                        ? t('diagnosis.submittedPhoto', 'Submitted Photo')
                        : t('diagnosis.photosSubmitted', { count: scannedImageUris.length, defaultValue: '{{count}} Photos Submitted' })}
                    </Text>
                  </View>
                  <Image source={{ uri: scannedImageUris[0] }} style={D.scannedImage} resizeMode="cover" />
                  {scannedImageUris.length > 1 && (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={D.scannedThumbStrip}
                    >
                      {scannedImageUris.slice(1).map((uri, i) => (
                        <Image
                          key={uri + i}
                          source={{ uri }}
                          style={D.scannedThumb}
                          resizeMode="cover"
                        />
                      ))}
                    </ScrollView>
                  )}
                </View>
                {/* AI Detection summary */}
                <View style={D.detectionBox}>
                  <View style={D.imageBoxHeader}>
                    <Ionicons name="scan-outline" size={14} color={COLORS.primary} />
                    <Text style={[D.imageBoxLabel, { color: COLORS.primary }]}>{t('diagnosis.aiDetection', 'AI Detection')}</Text>
                  </View>
                  <View style={D.detectionContent}>
                    <View style={D.detectionBadge}>
                      <Text style={D.detectionConfNum}>{confidence}%</Text>
                      <Text style={D.detectionConfLabel}>{t('diagnosis.confidence', 'Confidence')}</Text>
                    </View>
                    <Text style={D.detectionDisease}>{disease}</Text>
                    {scientific ? <Text style={D.detectionScientific}>{scientific}</Text> : null}
                    {pathogenType ? (
                      <View style={D.detectionTypeChip}>
                        <Text style={D.detectionTypeText}>{pathogenLabels[pathogenType] || pathogenType}</Text>
                      </View>
                    ) : null}
                    <View style={D.detectionMeta}>
                      <View style={D.detectionMetaItem}>
                        <Ionicons name="speedometer-outline" size={12} color={sev.color} />
                        <Text style={[D.detectionMetaText, { color: sev.color }]}>{(severity || 'moderate').toUpperCase()}</Text>
                      </View>
                      {spreadRisk ? (
                        <View style={D.detectionMetaItem}>
                          <Ionicons name="git-branch-outline" size={12} color={COLORS.amberDark} />
                          <Text style={[D.detectionMetaText, { color: COLORS.amberDark }]}>{t('diagnosis.spreadBadge', { risk: spreadRisk.toUpperCase(), defaultValue: '{{risk}} SPREAD' })}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION 2 — WHAT TO DO THIS WEEK (Action Checklist)
              ═══════════════════════════════════════════════════════════════════ */}
          {!isHealthy && (nextStepsFull.length > 0 || immediateAction) && (
            <View style={D.section}>
              <View style={D.sectionHeaderAccent}>
                <Ionicons name="flash" size={16} color={COLORS.amberDark} />
                <Text style={D.sectionHeaderAccentText}>{t('diagnosis.weeklyActions', 'What to Do This Week')}</Text>
              </View>
              <View style={D.checklistCard}>
                {immediateAction && nextStepsFull.length === 0 && (
                  <View style={D.checkItem}>
                    <View style={D.checkNum}><Text style={D.checkNumText}>1</Text></View>
                    <Text style={D.checkText}>{immediateAction}</Text>
                  </View>
                )}
                {nextStepsFull.map((step, i) => (
                  <View key={i} style={D.checkItem}>
                    <View style={[D.checkNum, i === 0 && { backgroundColor: COLORS.red }]}>
                      <Text style={D.checkNumText}>{i + 1}</Text>
                    </View>
                    <Text style={D.checkText}>{typeof step === 'string' ? step : step.action || ''}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION 3 — SPRAY SCHEDULE (Table)
              ═══════════════════════════════════════════════════════════════════ */}
          {chemicals.length > 0 && !isHealthy && (
            <View style={D.section}>
              <View style={D.sectionHeaderAccent}>
                <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
                <Text style={D.sectionHeaderAccentText}>{t('diagnosis.spraySchedule', 'Spray Schedule')}</Text>
              </View>
              <View style={D.sprayCard}>
                {/* Table header */}
                <View style={D.sprayHeaderRow}>
                  <Text style={[D.sprayHeaderCell, { flex: 0.5 }]}>#</Text>
                  <Text style={[D.sprayHeaderCell, { flex: 2 }]}>{t('diagnosis.productCol', 'Product')}</Text>
                  <Text style={[D.sprayHeaderCell, { flex: 1 }]}>{t('diagnosis.doseCol', 'Dose')}</Text>
                  <Text style={[D.sprayHeaderCell, { flex: 1 }]}>{t('diagnosis.whenCol', 'When')}</Text>
                </View>
                {/* Table rows */}
                {chemicals.slice(0, 4).map((chem, i) => {
                  const brands = Array.isArray(chem.brands) ? chem.brands : [];
                  const brandStr = brands.slice(0, 2).map(b => b.name).filter(Boolean).join(', ');
                  const frac = chem.frac_irac_group || '';
                  return (
                    <View key={i} style={[D.sprayRow, i % 2 === 0 && { backgroundColor: '#FAFCF8' }]}>
                      <View style={[{ flex: 0.5, alignItems: 'center' }]}>
                        <View style={[D.sprayNum, i === 0 && { backgroundColor: COLORS.primary }]}>
                          <Text style={D.sprayNumText}>{i + 1}</Text>
                        </View>
                      </View>
                      <View style={{ flex: 2 }}>
                        <Text style={D.sprayProduct}>{chem.product || chem.active_ingredient || ''}</Text>
                        {brandStr ? <Text style={D.sprayBrand}>{brandStr}</Text> : null}
                        {frac ? <Text style={D.sprayFrac}>{frac}</Text> : null}
                      </View>
                      <Text style={[D.sprayDose, { flex: 1 }]}>{chem.dosage || chem.dose || ''}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={D.sprayWhen}>{i === 0 ? t('diagnosis.today', 'TODAY') : t('diagnosis.dayLabel', { n: i * 7 })}</Text>
                        {chem.phi_days ? <Text style={D.sprayPhi}>{t('diagnosis.phiDays', { days: chem.phi_days, defaultValue: 'PHI: {{days}}d' })}</Text> : null}
                      </View>
                    </View>
                  );
                })}
                {/* Rotation note */}
                {rotationPlan ? (
                  <View style={D.rotationNote}>
                    <Ionicons name="repeat-outline" size={13} color={COLORS.primary} />
                    <Text style={D.rotationNoteText}>{rotationPlan}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION 4 — ROOT CAUSES
              ═══════════════════════════════════════════════════════════════════ */}
          {causes.length > 0 && (
            <View style={D.section}>
              <SectionHeader color={COLORS.purple} title={t('diagnosis.rootCauses')} />
              <View style={D.causesCard}>
                {causes.map((cause, i) => (
                  <View key={i} style={D.causeRow}>
                    <View style={D.causeBullet} />
                    <Text style={D.causeText}>{cause}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION 5 — ORGANIC / BIO ALTERNATIVE
              ═══════════════════════════════════════════════════════════════════ */}
          {(organicTx || organicList.length > 0) && !isHealthy && (
            <View style={D.section}>
              <SectionHeader color={COLORS.freshGreen} title={t('diagnosis.organicAlt')} />
              <View style={D.organicCard}>
                {organicTx ? (
                  <>
                    <View style={D.organicHeader}>
                      <Ionicons name="leaf" size={16} color={COLORS.freshGreen} />
                      <Text style={D.organicTitle}>{organicTx.method}</Text>
                    </View>
                    {organicTx.dose && <Text style={D.organicDetail}>{t('diagnosis.dose', { dose: organicTx.dose })}</Text>}
                    {organicTx.frequency && <Text style={D.organicDetail}>{t('diagnosis.frequency', { freq: organicTx.frequency })}</Text>}
                  </>
                ) : organicList.map((org, i) => (
                  <View key={i} style={D.organicItem}>
                    <Ionicons name="leaf" size={14} color={COLORS.freshGreen} />
                    <View style={{ flex: 1 }}>
                      <Text style={D.organicItemName}>{org.product || ''}</Text>
                      {org.dosage && <Text style={D.organicDetail}>{org.dosage}{org.dosage_per_acre ? ` · ${org.dosage_per_acre}` : ''}</Text>}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION 6 — SAFETY CHECKLIST
              ═══════════════════════════════════════════════════════════════════ */}
          {(safetyDo.length > 0 || safetyDont.length > 0) && (
            <View style={D.section}>
              <SectionHeader color={COLORS.primary} title={t('diagnosis.safetyChecklist', 'Safety Checklist')} />
              <View style={D.safetyCard}>
                {safetyDo.map((item, i) => (
                  <View key={`do-${i}`} style={D.safetyRow}>
                    <Ionicons name="checkmark-circle" size={16} color={COLORS.primary} />
                    <Text style={D.safetyText}>{item}</Text>
                  </View>
                ))}
                {safetyDont.map((item, i) => (
                  <View key={`dont-${i}`} style={D.safetyRow}>
                    <Ionicons name="close-circle" size={16} color={COLORS.red} />
                    <Text style={[D.safetyText, { color: COLORS.red }]}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION 7 — AI INSIGHTS (Weather + Context)
              ═══════════════════════════════════════════════════════════════════ */}
          {(weatherNote || soilNote || prevCropNote || notes || weatherRiskLevel) && (
            <View style={D.section}>
              <SectionHeader color={COLORS.amberDark} title={t('diagnosis.aiInsights')} />
              {/* Weather risk badge */}
              {weatherRiskLevel ? (
                <View style={D.weatherRiskBadge}>
                  <Ionicons name="rainy-outline" size={16} color={COLORS.blue} />
                  <Text style={D.weatherRiskLabel}>{t('diagnosis.weatherDiseaseRisk', 'Weather Disease Risk:')}</Text>
                  <View style={[D.riskChip, {
                    backgroundColor: weatherRiskLevel === 'CRITICAL' ? '#FFEBEE' : weatherRiskLevel === 'HIGH' ? '#FFF3E0' : weatherRiskLevel === 'MODERATE' ? '#FFF8E1' : '#E8F5E9'
                  }]}>
                    <Text style={[D.riskChipText, {
                      color: weatherRiskLevel === 'CRITICAL' ? COLORS.red : weatherRiskLevel === 'HIGH' ? COLORS.amberDark : weatherRiskLevel === 'MODERATE' ? COLORS.yellowDark2 : COLORS.primary
                    }]}>{weatherRiskLevel}</Text>
                  </View>
                </View>
              ) : null}
              <View style={D.insightCard}>
                {weatherNote ? (
                  <View style={D.insightRow}><Ionicons name="rainy-outline" size={14} color={COLORS.blue} /><Text style={D.insightText}>{weatherNote}</Text></View>
                ) : null}
                {soilNote ? (
                  <View style={D.insightRow}><Ionicons name="layers-outline" size={14} color={COLORS.tangerine} /><Text style={D.insightText}>{soilNote}</Text></View>
                ) : null}
                {prevCropNote ? (
                  <View style={D.insightRow}><Ionicons name="repeat-outline" size={14} color={COLORS.purple} /><Text style={D.insightText}>{prevCropNote}</Text></View>
                ) : null}
                {notes ? (
                  <View style={D.insightRow}><Ionicons name="eye-outline" size={14} color={COLORS.grayMedium} /><Text style={D.insightText}>{notes}</Text></View>
                ) : null}
              </View>
            </View>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION 8 — FOLLOW-UP & PREVENTION
              ═══════════════════════════════════════════════════════════════════ */}
          {followUp.length > 0 && (
            <View style={D.section}>
              <SectionHeader color={COLORS.blue} title={t('diagnosis.followUp')} />
              <View style={D.followUpCard}>
                {followUp.map((fu, i) => (
                  <View key={i} style={D.followUpRow}>
                    <View style={D.followUpDay}>
                      <Text style={D.followUpDayText}>{t('diagnosis.dayLabel', { n: fu.day })}</Text>
                    </View>
                    <Text style={D.followUpAction}>{fu.action}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {prevention ? (
            <View style={D.section}>
              <SectionHeader color={COLORS.primary} title={t('diagnosis.prevention')} />
              <View style={D.preventCard}>
                <Ionicons name="shield-checkmark-outline" size={16} color={COLORS.primary} />
                <Text style={D.preventText}>{prevention}</Text>
              </View>
            </View>
          ) : null}

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION 9 — PRODUCTS & SHOP
              ═══════════════════════════════════════════════════════════════════ */}
          {rawProducts.length > 0 && (
            <View style={D.section}>
              <SectionHeader color={COLORS.amberDark} title={t('diagnosis.products')} />
              {productsAreObjects ? (
                <View style={D.productsCard}>
                  {rawProducts.map((p, i) => (
                    <TouchableOpacity key={i} style={D.productRow} onPress={() => navigation.navigate('AgriStore')} activeOpacity={0.8}>
                      <View style={D.productIconWrap}>
                        <Ionicons name="flask-outline" size={16} color={COLORS.amberDark} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={D.productName}>{p.name}</Text>
                        <Text style={D.productMeta}>{p.type}{p.dose ? ` · ${p.dose}` : ''}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={14} color={COLORS.grayMid2} />
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={D.productsRow}>
                  {rawProducts.map((p, i) => (
                    <TouchableOpacity key={i} style={D.productChip} onPress={() => navigation.navigate('AgriStore')} activeOpacity={0.8}>
                      <Ionicons name="flask-outline" size={13} color={COLORS.amberDark} />
                      <Text style={D.productChipText}>{typeof p === 'object' ? p.name : p}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>
          )}

          {/* ── Consult expert banner ── */}
          {(consultExpert || confTier === 'LOW' || confTier === 'VERY_LOW') && (
            <View style={D.consultBanner}>
              <Ionicons name="people-outline" size={18} color={COLORS.purple} />
              <View style={{ flex: 1 }}>
                <Text style={D.consultTitle}>{t('diagnosis.consultExpert')}</Text>
                <Text style={D.consultText}>
                  {confTier === 'VERY_LOW' || confTier === 'LOW'
                    ? t('diagnosis.lowConfidenceConsult', 'Diagnosis confidence is low. Please consult your nearest KVK or call Kisan Call Centre: 1800-180-1551')
                    : t('diagnosis.consultText')}
                </Text>
              </View>
            </View>
          )}

          {/* ── Action Buttons ── */}
          <View style={D.actions}>
            <TouchableOpacity
              style={D.actionOutline}
              onPress={() => navigation.navigate('AIChat', {
                initialMessage: `I have ${disease} in my ${crop} crop (${farmCtx.cropAge || '?'} days). Severity: ${severity}. ${immediateAction ? `AI suggests: ${immediateAction}` : ''} What additional advice can you give?`
              })}
              activeOpacity={0.85}
            >
              <Ionicons name="chatbubble-outline" size={15} color={COLORS.primary} />
              <Text style={D.actionOutlineText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{t('diagnosis.askFarmMind')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={D.actionFill} onPress={() => navigation.navigate('AgriStore')} activeOpacity={0.85}>
              <Ionicons name="cart-outline" size={15} color={COLORS.white} />
              <Text style={D.actionFillText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{t('diagnosis.buyProducts')}</Text>
            </TouchableOpacity>
          </View>

          {/* ── Download Report ── */}
          <TouchableOpacity
            style={[D.downloadBtn, downloading && D.downloadBtnDisabled]}
            onPress={handleDownload}
            activeOpacity={0.85}
            disabled={downloading}
          >
            <Ionicons name={downloading ? 'hourglass-outline' : 'download-outline'} size={16} color={COLORS.white} />
            <Text style={D.downloadBtnText}>
              {downloading ? t('diagnosis.generatingPdf', 'Generating PDF…') : t('diagnosis.downloadFullReport', 'Download Full Report')}
            </Text>
          </TouchableOpacity>

          {/* ── Send to Krushi Kendra ── */}
          {shareReportId ? (
            <TouchableOpacity
              style={D.kkShareBtn}
              onPress={() => { Haptics.light(); setShareSheetVisible(true); }}
              activeOpacity={0.85}
            >
              <Ionicons name="leaf-outline" size={16} color={COLORS.white} />
              <Text style={D.kkShareBtnText}>{t('share.cta', 'Send to Krushi Kendra')}</Text>
            </TouchableOpacity>
          ) : null}

          {/* ── Krushi Kendra Recommendations / Share status ── */}
          {shares.length > 0 ? (
            <View style={D.shareList}>
              <Text style={D.shareListTitle}>
                <Ionicons name="leaf" size={13} color={COLORS.primary} />{' '}
                {t('share.recommendationsTitle', 'Krushi Kendra Recommendations')}
              </Text>
              {shares.map((s) => (
                <View key={s.id} style={D.shareCard}>
                  <View style={D.shareCardHead}>
                    <Text style={D.shareSellerName} numberOfLines={1}>
                      {s.seller?.name || `+91 ${s.seller?.phone}`}
                    </Text>
                    <View style={[
                      D.shareStatusPill,
                      s.status === 'REPLIED' && { backgroundColor: COLORS.successLight },
                    ]}>
                      <Text style={[
                        D.shareStatusTxt,
                        s.status === 'REPLIED' && { color: COLORS.primary },
                      ]}>
                        {s.status === 'REPLIED'
                          ? t('share.statusReplied', 'Replied')
                          : t('share.statusPending', 'Awaiting reply')}
                      </Text>
                    </View>
                  </View>
                  {s.seller?.village || s.seller?.taluka ? (
                    <Text style={D.shareSellerMeta}>
                      {[s.seller?.village, s.seller?.taluka].filter(Boolean).join(', ')}
                    </Text>
                  ) : null}
                  {s.sellerReply ? (
                    <View style={D.shareReplyBox}>
                      {s.available ? (
                        <View style={D.availableBanner}>
                          <Ionicons name="checkmark-circle" size={16} color={COLORS.white} />
                          <Text style={D.availableBannerText}>
                            {t('share.collectFrom', { name: s.seller?.name || `+91 ${s.seller?.phone}`, defaultValue: 'AVAILABLE — please collect from {{name}}' })}
                          </Text>
                        </View>
                      ) : null}
                      <Text style={D.shareReplyText}>{s.sellerReply}</Text>
                      {s.recommendedSku ? (
                        <Text style={D.shareReplySku}>
                          {t('share.sku', 'Recommended product')}: {s.recommendedSku}
                        </Text>
                      ) : null}

                      {/* Recommended products from this seller's shop */}
                      {Array.isArray(s.recommendedProducts) && s.recommendedProducts.length > 0 ? (
                        <View style={{ marginTop: 10 }}>
                          <Text style={D.recommendedHeading}>
                            {t('share.recommendedProductsHeading', 'Suggested from this shop')}
                          </Text>
                          {s.recommendedProducts.map((p) => (
                            <View key={p.id} style={D.productCard}>
                              {p.images?.[0] ? (
                                <Image source={{ uri: p.images[0] }} style={D.productImage} />
                              ) : (
                                <View style={[D.productImage, D.productImageEmpty]}>
                                  <Ionicons name="leaf" size={20} color={COLORS.gray175} />
                                </View>
                              )}
                              <View style={{ flex: 1 }}>
                                <Text style={D.productName} numberOfLines={2}>{p.name}</Text>
                                <Text style={D.productPrice}>
                                  ₹{p.price}<Text style={D.productUnit}>/{p.unit}</Text>
                                  {p.mrp && p.mrp > p.price ? (
                                    <Text style={D.productMrp}>  ₹{p.mrp}</Text>
                                  ) : null}
                                </Text>
                                <Text style={p.stock > 0 ? D.inStock : D.outStock}>
                                  {p.stock > 0
                                    ? t('share.inStock', { n: p.stock, defaultValue: '{{n}} in stock' })
                                    : t('share.outOfStock', 'Out of stock')}
                                </Text>
                                <View style={D.productActions}>
                                  <TouchableOpacity
                                    style={[D.productBtn, D.productBtnPrimary, p.stock <= 0 && { opacity: 0.5 }]}
                                    onPress={() => addRecommendedToCart(p)}
                                    disabled={p.stock <= 0}
                                    activeOpacity={0.85}
                                  >
                                    <Ionicons name="cart-outline" size={13} color={COLORS.white} />
                                    <Text style={D.productBtnTextWhite}>{t('share.addToCart', 'Add to cart')}</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[D.productBtn, D.productBtnOutline]}
                                    onPress={() => setVisitShop(s.seller)}
                                    activeOpacity={0.85}
                                  >
                                    <Ionicons name="storefront-outline" size={13} color={COLORS.primary} />
                                    <Text style={D.productBtnTextOutline}>{t('share.visitShop', 'Visit shop')}</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {/* ── Disclaimer ── */}
          <View style={D.disclaimer}>
            <Ionicons name="information-circle-outline" size={13} color={COLORS.grayMid2} />
            <Text style={D.disclaimerText}>{t('diagnosis.disclaimer')}</Text>
          </View>

        </Animated.View>
      </ScrollView>

      <KrushiKendraShareSheet
        visible={shareSheetVisible}
        onClose={() => setShareSheetVisible(false)}
        reportId={shareReportId}
        reportSummary={{ cropType: crop, primaryDisease: primaryDiseaseShort, riskLevel: severity }}
        onShared={() => loadShares()}
      />

      {/* Visit Shop modal — seller contact details */}
      <Modal visible={!!visitShop} transparent animationType="slide" onRequestClose={() => setVisitShop(null)}>
        <View style={D.visitBackdrop}>
          <View style={D.visitSheet}>
            <View style={D.visitHandleWrap}><View style={D.visitHandle} /></View>
            <Text style={D.visitTitle}>{visitShop?.name || `+91 ${visitShop?.phone}`}</Text>
            <Text style={D.visitMeta}>
              {[visitShop?.village, visitShop?.taluka, visitShop?.district].filter(Boolean).join(', ')}
            </Text>
            {visitShop?.phone ? (
              <TouchableOpacity
                style={D.visitCallBtn}
                onPress={() => safeOpenURL(`tel:+91${sanitizePhone(visitShop.phone)}`)}
                activeOpacity={0.85}
              >
                <Ionicons name="call" size={16} color={COLORS.white} />
                <Text style={D.visitCallTxt}>{t('share.callShop', { phone: visitShop.phone, defaultValue: 'Call +91 {{phone}}' })}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={D.visitCloseBtn} onPress={() => setVisitShop(null)}>
              <Text style={D.visitCloseTxt}>{t('close', 'Close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const D = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  // ── Header bar (green) ──
  headerBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: COLORS.primary,
  },
  backBtn: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  headerBarTitleWrap: { flex: 1, marginLeft: 6 },
  brandEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 1 },
  brandEyebrowText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: 'rgba(255,255,255,0.85)' },
  headerBarTitle: { fontSize: 17, fontWeight: '800', color: COLORS.white },
  chatHeaderBtn: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },

  // ── Hero card ──
  heroCard: {
    marginHorizontal: 16, marginTop: 16, marginBottom: 4,
    backgroundColor: COLORS.white, borderRadius: 16, padding: 20, gap: 14,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  diseaseLabel: { fontSize: 10, fontWeight: '800', color: COLORS.primary, letterSpacing: 1.5, marginBottom: 4 },
  diseaseName: { fontSize: 26, fontWeight: '900', color: COLORS.textDark, lineHeight: 32, marginBottom: 4 },
  scientificName: { fontSize: 13, color: COLORS.textLight, fontStyle: 'italic', marginBottom: 2 },

  // Badge row
  badgeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  // Urgency strip
  urgencyStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFF0F0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(231,76,60,0.15)',
  },
  urgencyStripText: { fontSize: 12, fontWeight: '800', color: COLORS.red, letterSpacing: 0.5 },

  // Crop meta row (grid)
  cropMetaRow: {
    flexDirection: 'row', gap: 0,
    borderTopWidth: 1, borderTopColor: COLORS.divider, paddingTop: 12,
  },
  cropMetaItem: {
    flex: 1, alignItems: 'center',
    borderRightWidth: 1, borderRightColor: COLORS.divider,
  },
  cropMetaValue: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  cropMetaLabel: { fontSize: 9, fontWeight: '700', color: COLORS.textLight, letterSpacing: 0.8, marginTop: 2 },

  // ── Scanned image compare ──
  imageCompareCard: {
    flexDirection: 'row', gap: 10,
    backgroundColor: COLORS.white, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  imageBox: { flex: 1, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.divider },
  imageBoxHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: '#F8F9FA', borderBottomWidth: 1, borderBottomColor: COLORS.divider,
  },
  imageBoxLabel: { fontSize: 10, fontWeight: '700', color: COLORS.textMedium, letterSpacing: 0.5 },
  scannedImage: { width: '100%', height: 150, backgroundColor: COLORS.divider },
  // Strip of additional photos shown below the hero image when the scan had
  // more than one submission. Compact, horizontally-scrollable, so 4 extra
  // photos don't blow out the compare card height.
  scannedThumbStrip: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: 6, paddingVertical: 6,
    backgroundColor: '#F8F9FA',
  },
  scannedThumb: { width: 52, height: 52, borderRadius: 6, backgroundColor: COLORS.divider },
  detectionBox: {
    flex: 1, borderRadius: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.primaryPale, backgroundColor: '#FAFCF8',
  },
  detectionContent: { padding: 10, alignItems: 'center', justifyContent: 'center', flex: 1 },
  detectionBadge: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.primaryPale, justifyContent: 'center', alignItems: 'center', marginBottom: 8,
  },
  detectionConfNum: { fontSize: 18, fontWeight: '900', color: COLORS.primary },
  detectionConfLabel: { fontSize: 8, fontWeight: '700', color: COLORS.textLight, letterSpacing: 0.5 },
  detectionDisease: { fontSize: 14, fontWeight: '800', color: COLORS.textDark, textAlign: 'center', marginBottom: 2 },
  detectionScientific: { fontSize: 10, color: COLORS.textLight, fontStyle: 'italic', textAlign: 'center', marginBottom: 6 },
  detectionTypeChip: {
    backgroundColor: COLORS.primaryPale, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginBottom: 8,
  },
  detectionTypeText: { fontSize: 9, fontWeight: '700', color: COLORS.primary, letterSpacing: 0.3 },
  detectionMeta: { gap: 4 },
  detectionMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detectionMetaText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },

  // ── Section headers ──
  section: { marginTop: 16, marginHorizontal: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionDot: { width: 6, height: 6, borderRadius: 3 },
  sectionTitle: { fontSize: 11, fontWeight: '900', color: COLORS.textLight, letterSpacing: 1.2, textTransform: 'uppercase' },

  sectionHeaderAccent: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.white, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  sectionHeaderAccentText: { fontSize: 15, fontWeight: '800', color: COLORS.textDark },

  // ── Weekly action checklist ──
  checklistCard: {
    backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  checkItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.divider,
  },
  checkNum: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center',
    flexShrink: 0, marginTop: 1,
  },
  checkNumText: { fontSize: 13, fontWeight: '800', color: COLORS.white },
  checkText: { fontSize: 14, color: COLORS.textDark, lineHeight: 21, flex: 1, fontWeight: '500' },

  // ── Spray schedule table ──
  sprayCard: {
    backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  sprayHeaderRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 10,
  },
  sprayHeaderCell: { fontSize: 10, fontWeight: '800', color: COLORS.white, letterSpacing: 0.5 },
  sprayRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.divider,
  },
  sprayNum: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: COLORS.textMedium, justifyContent: 'center', alignItems: 'center',
  },
  sprayNumText: { fontSize: 11, fontWeight: '800', color: COLORS.white },
  sprayProduct: { fontSize: 13, fontWeight: '700', color: COLORS.textDark },
  sprayBrand: { fontSize: 11, color: COLORS.textLight, fontStyle: 'italic', marginTop: 1 },
  sprayFrac: {
    fontSize: 9, fontWeight: '700', color: COLORS.primary, letterSpacing: 0.5,
    backgroundColor: COLORS.primaryPale, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4, alignSelf: 'flex-start', marginTop: 3,
  },
  sprayDose: { fontSize: 12, color: COLORS.textMedium, fontWeight: '600' },
  sprayWhen: { fontSize: 12, fontWeight: '700', color: COLORS.textDark },
  sprayPhi: { fontSize: 10, color: COLORS.amberDark, marginTop: 2 },
  rotationNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: '#F5FCF9',
  },
  rotationNoteText: { fontSize: 12, color: COLORS.primary, fontWeight: '600', flex: 1, lineHeight: 17 },

  // ── Causes ──
  causesCard: {
    backgroundColor: COLORS.white, borderRadius: 14, padding: 14, gap: 8,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  causeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  causeBullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.purple, marginTop: 7, flexShrink: 0 },
  causeText: { fontSize: 13, color: COLORS.textMedium, lineHeight: 19, flex: 1 },

  // ── Organic ──
  organicCard: {
    backgroundColor: 'rgba(39,174,96,0.06)', borderRadius: 14, padding: 14, gap: 10,
    borderWidth: 1, borderColor: 'rgba(39,174,96,0.2)',
  },
  organicHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  organicTitle: { fontSize: 14, fontWeight: '700', color: COLORS.freshGreen, flex: 1 },
  organicDetail: { fontSize: 12, color: COLORS.textMedium, lineHeight: 17, paddingLeft: 26 },
  organicItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  organicItemName: { fontSize: 13, fontWeight: '700', color: COLORS.freshGreen },

  // ── Safety checklist ──
  safetyCard: {
    backgroundColor: COLORS.white, borderRadius: 14, padding: 14, gap: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  safetyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  safetyText: { fontSize: 13, color: COLORS.textMedium, lineHeight: 19, flex: 1 },

  // ── Weather risk ──
  weatherRiskBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8,
  },
  weatherRiskLabel: { fontSize: 13, color: COLORS.textMedium, fontWeight: '600' },
  riskChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  riskChipText: { fontSize: 11, fontWeight: '800' },

  // ── Insights ──
  insightCard: {
    backgroundColor: COLORS.ivoryWarm, borderRadius: 14, padding: 14, gap: 10,
    borderWidth: 1, borderColor: 'rgba(243,156,18,0.2)',
  },
  insightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  insightText: { fontSize: 12, color: COLORS.textMedium, lineHeight: 17, flex: 1 },

  // ── Follow-up ──
  followUpCard: {
    backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  followUpRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    padding: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  followUpDay: { width: 46, height: 32, borderRadius: 8, backgroundColor: 'rgba(52,152,219,0.1)', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  followUpDayText: { fontSize: 11, color: COLORS.blue, fontWeight: '800' },
  followUpAction: { fontSize: 12, color: COLORS.textMedium, lineHeight: 18, flex: 1, paddingTop: 7 },

  // ── Prevention ──
  preventCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: 'rgba(46,204,113,0.06)', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: 'rgba(46,204,113,0.15)',
  },
  preventText: { flex: 1, fontSize: 13, color: COLORS.textMedium, lineHeight: 19 },

  // ── Products ──
  productsCard: {
    backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  productRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  productIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(243,156,18,0.1)', justifyContent: 'center', alignItems: 'center',
  },
  productName: { fontSize: 13, fontWeight: '700', color: COLORS.textDark },
  productMeta: { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  productsRow: { gap: 8, paddingVertical: 2 },
  productChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(243,156,18,0.08)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(243,156,18,0.25)',
  },
  productChipText: { fontSize: 13, color: COLORS.amberDark, fontWeight: '600' },

  // ── Consult banner ──
  consultBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    marginHorizontal: 16, marginTop: 16,
    backgroundColor: 'rgba(155,89,182,0.06)', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: 'rgba(155,89,182,0.15)',
  },
  consultTitle: { fontSize: 13, fontWeight: '800', color: COLORS.purple, marginBottom: 4 },
  consultText: { fontSize: 11, color: COLORS.textMedium, lineHeight: 17 },

  // ── Action buttons ──
  actions: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 20 },
  actionOutline: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderRadius: 14, paddingVertical: 14,
    borderWidth: 1.5, borderColor: 'rgba(46,204,113,0.4)',
  },
  actionOutlineText: { flexShrink: 1, textAlign: 'center', fontSize: 13, fontWeight: '700', color: COLORS.primary },
  actionFill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderRadius: 14, paddingVertical: 14, backgroundColor: COLORS.primary,
  },
  actionFillText: { flexShrink: 1, textAlign: 'center', fontSize: 13, fontWeight: '800', color: COLORS.white },

  // ── Download ──
  downloadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 10,
    backgroundColor: COLORS.textDark, borderRadius: 14, paddingVertical: 14,
  },
  downloadBtnDisabled: { opacity: 0.6 },
  downloadBtnText: { fontSize: 13, fontWeight: '800', color: COLORS.white },

  // ── Krushi Kendra share ──
  kkShareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 10,
    backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 14,
  },
  kkShareBtnText: { fontSize: 13, fontWeight: '800', color: COLORS.white },

  shareList: { marginHorizontal: 16, marginTop: 16 },
  shareListTitle: { fontSize: 13, fontWeight: '800', color: COLORS.textDark, marginBottom: 8 },
  shareCard: {
    padding: 12, borderRadius: 12, marginBottom: 8,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  shareCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  shareSellerName: { flex: 1, fontSize: 13, fontWeight: '700', color: COLORS.textDark, marginRight: 8 },
  shareSellerMeta: { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  shareStatusPill: { backgroundColor: COLORS.amberLight || COLORS.darkAmber + '20', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  shareStatusTxt:  { fontSize: 10, fontWeight: '700', color: COLORS.amberDark, textTransform: 'uppercase' },
  shareReplyBox:   { marginTop: 8, padding: 8, borderRadius: 8, backgroundColor: COLORS.background },
  shareReplyText:  { fontSize: 12, color: COLORS.textDark, lineHeight: 18 },
  shareReplySku:   { fontSize: 11, color: COLORS.primary, fontWeight: '700', marginTop: 6 },
  availableBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 6, backgroundColor: COLORS.primary, marginBottom: 8 },
  availableBannerText: { flex: 1, fontSize: 11, fontWeight: '800', color: COLORS.white, letterSpacing: 0.3 },

  recommendedHeading: { fontSize: 11, fontWeight: '800', color: COLORS.textMedium, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 },
  productCard:        { flexDirection: 'row', gap: 10, padding: 10, borderRadius: 10, marginBottom: 8, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border },
  productImage:       { width: 60, height: 60, borderRadius: 8, backgroundColor: COLORS.surface },
  productImageEmpty:  { justifyContent: 'center', alignItems: 'center' },
  productName:        { fontSize: 13, fontWeight: '700', color: COLORS.textDark },
  productPrice:       { fontSize: 14, fontWeight: '800', color: COLORS.primary, marginTop: 4 },
  productUnit:        { fontSize: 11, fontWeight: '600', color: COLORS.textMedium },
  productMrp:         { fontSize: 11, color: COLORS.textLight, textDecorationLine: 'line-through' },
  inStock:            { fontSize: 11, color: COLORS.primary, marginTop: 2 },
  outStock:           { fontSize: 11, color: COLORS.error,   marginTop: 2 },
  productActions:     { flexDirection: 'row', gap: 8, marginTop: 8 },
  productBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  productBtnPrimary:  { backgroundColor: COLORS.primary },
  productBtnOutline:  { borderWidth: 1, borderColor: COLORS.primary, backgroundColor: COLORS.white },
  productBtnTextWhite:{ color: COLORS.white,   fontSize: 11, fontWeight: '800' },
  productBtnTextOutline:{ color: COLORS.primary, fontSize: 11, fontWeight: '800' },

  visitBackdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  visitSheet:     { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingBottom: 28, paddingTop: 8 },
  visitHandleWrap:{ alignItems: 'center', paddingVertical: 8 },
  visitHandle:    { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.gray175 },
  visitTitle:     { fontSize: 18, fontWeight: '800', color: COLORS.textDark, marginTop: 6 },
  visitMeta:      { fontSize: 13, color: COLORS.textMedium, marginTop: 4 },
  visitCallBtn:   { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 18, paddingVertical: 14, borderRadius: 12, backgroundColor: COLORS.primary },
  visitCallTxt:   { color: COLORS.white, fontSize: 14, fontWeight: '800' },
  visitCloseBtn:  { marginTop: 10, paddingVertical: 12, alignItems: 'center' },
  visitCloseTxt:  { color: COLORS.textMedium, fontSize: 13, fontWeight: '700' },

  // ── Disclaimer ──
  disclaimer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginHorizontal: 16, marginTop: 14,
  },
  disclaimerText: { flex: 1, fontSize: 11, color: COLORS.textLight, lineHeight: 16 },
});

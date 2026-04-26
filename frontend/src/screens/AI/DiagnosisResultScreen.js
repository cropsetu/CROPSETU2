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
 *  9. Actions — Ask FarmMind / Buy Products
 */
import { useRef, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Dimensions, Animated, StatusBar, Alert, Image, Modal, Linking,
} from 'react-native';
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

  // Normalise to always have data
  const disease      = d.disease      || 'Unknown';
  const scientific   = d.scientific   || '';
  const crop         = d.crop         || farmCtx.cropName || 'Unknown';
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
    const disclaimerEn = anp.disclaimer || 'This report is generated by an AI-assisted advisory system. It is a decision-support document, NOT a formal prescription. For severe, unusual, or persistent cases, please consult a certified agronomist or your nearest Krishi Vigyan Kendra (KVK). The recommended pesticides must be used strictly per CIB&RC-approved labels.';
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

    return `<!DOCTYPE html>
<html lang="${language || 'en'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CropSetu — Crop Disease Report — ${esc(rptId)}</title>
<style>
@page{size:A4;margin:6mm 6mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Roboto,-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.4;font-size:11.5px;background:#fff}
.page{max-width:780px;margin:0 auto;page-break-after:always}
.page:last-child{page-break-after:auto}

.mh{background:linear-gradient(135deg,#1B5E20,#2E7D32,#388E3C);color:#fff;padding:12px 16px;text-align:center}
.mh h1{font-size:18px;font-weight:900;letter-spacing:1px}.mh .sub{font-size:10px;opacity:.75;margin-top:1px}

.meta-bar{display:flex;flex-wrap:wrap;gap:2px 14px;background:#f5f5f5;border:1px solid #ddd;border-top:none;padding:5px 12px;font-size:10px}
.meta-bar .ml{color:#666;font-weight:600}.meta-bar .mv{font-weight:700;color:#1a1a1a}

.dv{border:none;border-top:1.5px solid #2E7D32;margin:8px 0}
.dv2{border:none;border-top:2px double #2E7D32;margin:10px 0}

.pt{background:#E8F5E9;border:1px solid #C8E6C9;border-radius:3px;padding:5px 12px;font-size:12px;font-weight:800;color:#1B5E20;margin:8px 0 6px}

.st{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:800;color:#2E7D32;margin:8px 0 4px;border-bottom:1px solid #C8E6C9;padding-bottom:3px}

.ir{display:flex;padding:2px 0;font-size:11px}.ir .lbl{min-width:150px;color:#666;font-weight:600}.ir .val{font-weight:700;flex:1}

table.dt{width:100%;border-collapse:collapse;margin:4px 0;font-size:11px}
table.dt th{background:#2E7D32;color:#fff;padding:4px 6px;text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.5px}
table.dt td{padding:4px 6px;border-bottom:1px solid #e0e0e0;vertical-align:top}
table.dt tr:nth-child(even){background:#fafafa}
table.dt2 th{background:#6A1B9A}
table.dt3 th{background:#37474F}

table.at{width:100%;border-collapse:collapse;margin:3px 0;font-size:10.5px}
table.at td{padding:3px 6px;border:1px solid #e0e0e0}
table.at .k{font-weight:700;background:#fafafa;width:30%;color:#333}

.cl{margin:2px 0 4px;padding:0;list-style:none}
.cl li{padding:4px 0;border-bottom:1px solid #f0f0f0;display:flex;gap:6px;font-size:11px;line-height:1.5}
.cl li:last-child{border-bottom:none}
.cl .num{width:22px;height:22px;border-radius:50%;background:#2E7D32;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;flex-shrink:0}
.cl .num.red{background:#C62828}
.cl .loc{color:#555;font-size:10px;display:block;margin-top:1px}

.sf{display:flex;align-items:flex-start;gap:5px;padding:2px 0;font-size:11px;line-height:1.4}
.sf .loc{color:#555;font-size:10px;display:block;margin-top:1px}
.sf-do{color:#1B5E20}.sf-no{color:#C62828}

.bx-green{background:#E8F5E9;border:1px solid #A5D6A7;border-radius:4px;padding:6px 10px;margin:4px 0;font-size:11px;line-height:1.5}
.bx-yellow{background:#FFF8E1;border:1px solid #FFD54F;border-radius:4px;padding:6px 10px;margin:4px 0;font-size:11px}
.bx-red{background:#FFEBEE;border:1.5px solid #EF9A9A;border-radius:4px;padding:6px 10px;margin:4px 0;font-size:11px}
.bx-blue{background:#E3F2FD;border:1px solid #90CAF9;border-radius:4px;padding:6px 10px;margin:4px 0;font-size:11px}
.bx-purple{background:#F3E5F5;border:1px solid #CE93D8;border-radius:4px;padding:6px 10px;margin:4px 0;font-size:11px}

/* disease box */
.disease-box{background:#FFF8E1;border:2px solid #FFC107;border-radius:6px;padding:10px 14px;margin:6px 0}
.disease-box .dn{font-size:20px;font-weight:900;color:#1a1a1a;line-height:1.2}
.disease-box .dl{font-size:13px;color:#555;margin-top:1px}
.disease-box .ds{font-size:11px;color:#888;font-style:italic;margin-top:1px}

/* badges */
.bg{display:inline-block;padding:3px 10px;border-radius:99px;font-size:9px;font-weight:800;letter-spacing:.3px;margin:1px 2px 1px 0}
.bg-g{background:#E8F5E9;color:#1B5E20}.bg-o{background:#FFF3E0;color:#E65100}.bg-r{background:#FFEBEE;color:#C62828}

/* image row */
.img-row{display:flex;gap:8px;margin:6px 0}
.img-card{flex:1;border:1px solid #ddd;border-radius:6px;overflow:hidden}
.img-card .hd{background:#f5f5f5;padding:4px 8px;font-size:9px;font-weight:700;color:#666;border-bottom:1px solid #ddd}
.img-card img{width:100%;height:150px;object-fit:cover;display:block}
.img-ph{width:100%;height:150px;background:#E8F5E9;display:flex;align-items:center;justify-content:center;color:#888;font-size:10px;text-align:center;padding:6px;flex-direction:column}

/* weather cards */
.wc-row{display:flex;gap:6px;margin:4px 0;flex-wrap:wrap}
.wc{flex:1;min-width:90px;border:1px solid #ddd;border-radius:6px;padding:6px;text-align:center}
.wc .wv{font-size:16px;font-weight:900;color:#1a1a1a}.wc .wl{font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888;font-weight:700;margin-top:1px}
.wc .ws{font-size:9px;font-weight:700;color:#E65100;margin-top:2px}

/* dispensing num */
.dn-num{width:24px;height:24px;border-radius:50%;background:#6A1B9A;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:11px}
.qty-hl{background:#FFF3E0;color:#E65100;font-weight:700;padding:2px 6px;border-radius:4px;font-size:11px}

/* dealer */
.dealer-box{border:1.5px dashed #666;border-radius:6px;padding:8px 12px;margin:6px 0}
.dealer-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-top:4px}
.dealer-field{border-bottom:1px solid #999;padding-bottom:4px;font-size:10px;color:#888}

/* footer */
.pf{background:#2E7D32;color:#fff;padding:4px 12px;display:flex;justify-content:space-between;font-size:8px;margin-top:6px}
.pf-purple{background:#6A1B9A}.pf-dark{background:#37474F}

/* compliance check */
.cc{font-size:11px;padding:2px 0;color:#1B5E20}

@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════════
     PAGE 1 — FARMER SUMMARY
     ═══════════════════════════════════════════════════════════════ -->
<div class="page">
<div class="mh">
  <h1>CROPSETU — CROP DISEASE REPORT</h1>
  <div class="sub">AI-Powered Crop Disease Advisory</div>
</div>
<div class="meta-bar">
  <span><span class="ml">Report ID:</span> <span class="mv">${esc(rptId)}</span></span>
  <span><span class="ml">Generated:</span> <span class="mv">${esc(dateStr)}, ${esc(timeStr)} IST</span></span>
  <span><span class="ml">Language:</span> <span class="mv">${esc(langLabel)}</span></span>
  <span><span class="ml">AI Confidence:</span> <span class="mv">${esc(confTierR)} ${confBar} (${confPct}%)</span></span>
</div>

<div class="pt">PAGE 1 — FARMER SUMMARY</div>

<div class="st">👤 FARMER${isBilingual ? ` | ${esc(t('farmerDetails') || langNative)}` : ''}</div>
<div class="ir"><span class="lbl">Name</span><span class="val">${esc(farmerName)}</span></div>
${farmerPhone ? `<div class="ir"><span class="lbl">Phone</span><span class="val">${esc(farmerPhone)}</span></div>` : ''}
<div class="ir"><span class="lbl">Village / Location</span><span class="val">${esc(farmerVillage) || '—'}</span></div>
<div class="ir"><span class="lbl">Farm size</span><span class="val">${na(landTotal, ' acres')}${affectedArea ? ` (affected area: ${esc(affectedArea)})` : ''}</span></div>

<div class="st">🌾 CROP${isBilingual ? ` | ${esc(t('cropDetails') || '')}` : ''}</div>
<div class="ir"><span class="lbl">Crop</span><span class="val">${esc(crop)}${farmCtx.cropVariety || farmCtx.variety ? ` — variety: ${esc(farmCtx.cropVariety || farmCtx.variety)}` : ''}</span></div>
<div class="ir"><span class="lbl">Stage</span><span class="val">${na(stage)}${farmCtx.cropAge ? ` | Days since sowing: ${farmCtx.cropAge}` : ''}</span></div>
${farmCtx.soilType ? `<div class="ir"><span class="lbl">Soil type</span><span class="val">${esc(farmCtx.soilType)}</span></div>` : ''}
${farmCtx.irrigationType ? `<div class="ir"><span class="lbl">Irrigation</span><span class="val">${esc(farmCtx.irrigationType)}</span></div>` : ''}
<div class="ir"><span class="lbl">Severity</span><span class="val">${esc(sevTxt)}</span></div>

<hr class="dv"/>

<div class="disease-box">
  <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:#E65100;margin-bottom:4px">🔬 DIAGNOSIS${isBilingual ? ` | ${esc(t('diagnosis.title') || '')}` : ''}</div>
  <div class="dn">${esc(diseaseName)}</div>
  ${diseaseLocal ? `<div class="dl">${esc(diseaseLocal)}</div>` : ''}
  ${diseaseSci ? `<div class="ds">${esc(diseaseSci)}${diseasePathogen ? ` — ${esc(diseasePathogen)}` : ''}</div>` : ''}
  <div style="margin-top:8px">
    <span class="bg ${confPct >= 85 ? 'bg-g' : confPct >= 70 ? 'bg-o' : 'bg-r'}">✓ ${esc(confTierR)} CONFIDENCE · ${confPct}%</span>
    <span class="bg ${severity === 'critical' || severity === 'high' ? 'bg-r' : severity === 'moderate' ? 'bg-o' : 'bg-g'}">${esc(sevTxt)} SEVERITY</span>
    <span class="bg bg-r">⚠ ${esc(urgText)}</span>
  </div>
</div>

<!-- Images -->
<div class="img-row">
  <div class="img-card">
    <div class="hd">📷 Submitted Leaf Photo</div>
    ${imgSrc ? `<img src="${imgSrc}" alt="Crop photo"/>` : '<div class="img-ph">Photo captured during scan</div>'}
  </div>
  <div class="img-card">
    <div class="hd">🔥 AI Analysis</div>
    <div class="img-ph" style="flex-direction:column">
      <div style="font-size:32px;font-weight:900;color:#2E7D32">${confPct}%</div>
      <div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:1px;margin:4px 0">AI Confidence</div>
      <div style="font-weight:700;font-size:13px">${esc(diseaseName)}</div>
      ${diseaseSci ? `<div style="font-size:10px;color:#888;font-style:italic">${esc(diseaseSci)}</div>` : ''}
    </div>
  </div>
</div>

<!-- What to do this week -->
<div class="st">✅ WHAT TO DO THIS WEEK${isBilingual ? ` | ${esc(t('diagnosis.weeklyActions') || '')}` : ''}</div>
<ul class="cl">
${weeklyActions.map((a, i) => `  <li>
    <span class="num${i === 0 ? ' red' : ''}">${i + 1}</span>
    <div>
      ${esc(a.action || a)}
      ${a.action_local ? `<span class="loc">${esc(a.action_local)}</span>` : ''}
    </div>
  </li>`).join('\n')}
</ul>

<div class="pf"><span>🌿 CropSetu · Report ${esc(rptId)}</span><span>Page 1 of 4 · Farmer Summary</span></div>
</div>

<!-- ═══════════════════════════════════════════════════════════════
     PAGE 2 — FARMER DETAIL (Bilingual)
     ═══════════════════════════════════════════════════════════════ -->
<div class="page">
<div class="pt" style="background:#C8E6C9;border-color:#A5D6A7">PAGE 2 — DETAILED GUIDANCE${isBilingual ? ` | ${esc(t('diagnosis.detailedGuidance') || '')}` : ''}</div>

<!-- What is happening -->
${whatHappening ? `
<div class="st">🌿 WHAT IS HAPPENING${isBilingual ? ` | ${esc(t('diagnosis.whatHappening') || '')}` : ''}</div>
<div class="bx-green">
  ${esc(whatHappening)}
  ${whatHappeningLocal ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #A5D6A7;color:#555;font-size:11px">${esc(whatHappeningLocal)}</div>` : ''}
</div>` : ''}

<!-- Why now -->
${(tempVal != null || humVal != null) ? `
<div class="st">🌡 WHY NOW${isBilingual ? ` | ${esc(t('diagnosis.whyNow') || '')}` : ''}</div>
<div class="wc-row">
  ${tempVal != null ? `<div class="wc"><div class="wv">${tempVal}°C</div><div class="wl">AVG TEMP (14D)</div><div class="ws">⚠ ${tempVal >= 15 && tempVal <= 25 ? 'Ideal for disease' : tempVal > 30 ? 'Hot — stress' : 'Cool conditions'}</div></div>` : ''}
  ${humVal != null ? `<div class="wc"><div class="wv">${humVal}%</div><div class="wl">HUMIDITY</div><div class="ws">⚠ ${humVal > 85 ? 'Very favorable' : humVal > 70 ? 'Favorable' : 'Moderate'}</div></div>` : ''}
  ${leafWet != null ? `<div class="wc"><div class="wv">${leafWet} hrs</div><div class="wl">LEAF WETNESS/DAY</div><div class="ws">⚠ ${parseFloat(leafWet) > 6 ? 'Above threshold' : 'Normal'}</div></div>` : ''}
  ${outbreakNearby != null ? `<div class="wc"><div class="wv">${outbreakNearby}</div><div class="wl">OUTBREAK NEARBY</div><div class="ws">⚠ Strong signal</div></div>` : ''}
</div>
` : ''}

<!-- Spray Instructions -->
${spraySchedule.length > 0 ? `
<div class="st">💊 SPRAY INSTRUCTIONS${isBilingual ? ` | ${esc(t('diagnosis.spraySchedule') || '')}` : ''}</div>
${spraySchedule.map((s, i) => `<div class="bx-${i === 0 ? 'yellow' : 'green'}" style="margin:6px 0">
  <div style="font-weight:800;font-size:12px;margin-bottom:4px">Spray #${s.spray_number || i+1}: ${esc(s.day || '')} — ${esc(s.product)}${s.brand_names ? ` (${esc(s.brand_names)})` : ''}</div>
  ${s.dose ? `<div style="font-size:11.5px;color:#333">Dose: ${esc(s.dose)}</div>` : ''}
  ${s.quantity_for_farm ? `<div style="font-size:11.5px;color:#333">Volume: ${esc(s.quantity_for_farm)} for ${na(landTotal, ' acres')}</div>` : ''}
  ${s.timing ? `<div style="font-size:11px;color:#666;margin-top:2px">Timing: ${esc(s.timing)}</div>` : ''}
  ${s.frac_group ? `<div style="font-size:10px;color:#2E7D32;font-weight:600;margin-top:2px">FRAC: ${esc(s.frac_group)}</div>` : ''}
</div>`).join('\n')}

${rotationPlanR ? `<div class="bx-yellow" style="font-weight:700;font-size:11.5px">🔄 <strong>IMPORTANT — Rotation:</strong> ${esc(rotationPlanR)}</div>` : ''}
` : ''}

<!-- Safety -->
${(safetyDoList.length > 0 || safetyDontList.length > 0) ? `
<div class="st">🛡 SAFETY${isBilingual ? ` | ${esc(t('diagnosis.safety') || '')}` : ''}</div>
${safetyDoList.map(s => `<div class="sf sf-do">✓ ${esc(s)}</div>`).join('\n')}
${safetyDontList.map(s => `<div class="sf sf-no">✗ ${esc(s)}</div>`).join('\n')}
` : ''}

<!-- Biological support -->
${biologicalR.length > 0 ? `
<div class="st">🌿 BIOLOGICAL SUPPORT${isBilingual ? ` | ${esc(t('diagnosis.bioSupport') || '')}` : ''}</div>
${biologicalR.map(b => `<div class="bx-green"><strong>${esc(b.product || b.name || '')}</strong>${b.dosage ? ` — ${esc(b.dosage)}` : ''}${b.dosage_per_acre ? ` (${esc(b.dosage_per_acre)})` : ''}</div>`).join('\n')}
` : ''}

<!-- Cultural Practices -->
${culturalPR.length > 0 ? `
<div class="st">🌾 CULTURAL PRACTICES${isBilingual ? ` | ${esc(t('diagnosis.cultural') || '')}` : ''}</div>
${culturalPR.map(c => `<div style="padding:2px 0;font-size:12px">• ${esc(typeof c === 'string' ? c : c.practice || '')}</div>`).join('\n')}
` : ''}

<!-- Do Not -->
${doNotUseR.length > 0 ? `
<div class="st" style="color:#C62828;border-color:#EF9A9A">🚫 DO NOT${isBilingual ? ` | ${esc(t('diagnosis.doNot') || '')}` : ''}</div>
${doNotUseR.map(d => `<div class="sf sf-no">✗ ${esc(typeof d === 'string' ? d : d.warning || '')}</div>`).join('\n')}
` : ''}

<!-- Follow-up -->
<div class="st">📅 FOLLOW-UP${isBilingual ? ` | ${esc(t('diagnosis.followUp') || '')}` : ''}</div>
<div class="ir"><span class="lbl">Send new photo on</span><span class="val">7 days from today</span></div>
<div class="ir"><span class="lbl">Next spray day</span><span class="val">${spraySchedule.length > 1 ? esc(spraySchedule[1].day || 'Day 7') : 'Day 7'}</span></div>
<div class="ir"><span class="lbl">If worsening</span><span class="val">Call nearest KVK${farmCtx.district ? ` (${esc(farmCtx.district)})` : ''}</span></div>
<div class="ir"><span class="lbl">Helpline (Toll-free)</span><span class="val">Kisan Call Centre — 1800-180-1551</span></div>

<div class="pf"><span>🌿 CropSetu · Report ${esc(rptId)}</span><span>Page 2 of 4 · Detailed Guidance</span></div>
</div>

<!-- ═══════════════════════════════════════════════════════════════
     PAGE 3 — DISPENSING SHEET
     ═══════════════════════════════════════════════════════════════ -->
<div class="page">
<div class="pt" style="background:#F3E5F5;border-color:#CE93D8;color:#4A148C">PAGE 3 — FOR INPUT DEALER${isBilingual ? ` | ${esc(t('diagnosis.forDealer') || '')}` : ''}</div>

<div style="font-size:13px;font-weight:800;margin:8px 0">DISPENSING SHEET — Report: ${esc(rptId)}</div>
<div class="ir"><span class="lbl">Farmer</span><span class="val">${esc(farmerName)} | Farm: ${na(landTotal, ' acres')} affected</span></div>
<div class="ir"><span class="lbl">Diagnosis</span><span class="val">${esc(diseaseName)}${diseaseSci ? ` (${esc(diseaseSci)})` : ''} on ${esc(crop)}</span></div>
<div class="ir"><span class="lbl">Recommendation</span><span class="val">${spraySchedule.length}-spray rotation (resistance management)</span></div>

<!-- Products table -->
${dispProd.length > 0 ? `
<table class="dt dt2" style="margin-top:6px">
  <thead><tr>
    <th style="width:30px">#</th>
    <th>Product (Active Ingredient)</th>
    <th>FRAC Group</th>
    <th>Qty for ${na(landTotal, ' acre')}</th>
    <th>Price (₹)</th>
  </tr></thead>
  <tbody>
    ${dispProd.map((p, i) => `<tr>
      <td style="text-align:center"><span class="dn-num">${p.number || i+1}</span></td>
      <td><strong>${esc(p.product)}</strong>${p.brand_names ? `<br><span style="font-size:10px;color:#888;font-style:italic">(${esc(p.brand_names)})</span>` : ''}<br><span style="font-size:10px;color:#666">${esc(p.when || '')}</span></td>
      <td style="text-align:center"><strong>${esc(p.frac_irac_group || '')}</strong><br><span style="font-size:10px;color:#888">${esc(p.frac_type || '')}</span></td>
      <td>${p.quantity_for_farm ? `<span class="qty-hl">${esc(p.quantity_for_farm)}</span>` : '—'}</td>
      <td style="font-weight:700;text-align:right">${esc(p.est_price_inr || '—')}</td>
    </tr>`).join('\n')}
  </tbody>
</table>
${totalCostR ? `<div style="background:#6A1B9A;color:#fff;padding:8px 14px;display:flex;justify-content:space-between;font-weight:800;font-size:12px;border-radius:0 0 6px 6px;margin-top:-1px"><span>ESTIMATED TOTAL (subject to local prices)</span><span>${esc(totalCostR)}</span></div>` : ''}
` : ''}

<!-- Substitutes -->
${subsR.length > 0 ? `
<div class="bx-blue" style="margin-top:6px">
  <div style="font-weight:800;color:#1565C0;margin-bottom:4px">🔄 SUBSTITUTES (if primary unavailable)</div>
  ${subsR.map(s => `<div style="font-size:11.5px;padding:2px 0">• ${esc(s.original || '')} → <strong>${esc(s.substitute || '')}</strong>${s.note ? ` (${esc(s.note)})` : ''}</div>`).join('\n')}
  <div style="font-size:10px;color:#666;margin-top:4px;font-style:italic">Note: If substituting, match FRAC group for resistance rotation.</div>
</div>` : ''}

<!-- Incompatibilities -->
${incompR.length > 0 ? `
<div class="bx-red">
  <div style="font-weight:800;color:#C62828;margin-bottom:4px">⚠ INCOMPATIBILITY WARNINGS — DO NOT MIX IN SAME TANK</div>
  ${incompR.map(ic => `<div style="padding:2px 0;font-size:11.5px"><span style="color:#C62828;font-weight:700">✗</span> ${esc(typeof ic === 'string' ? ic : ic.do_not_mix || '')} ${ic.reason ? `<span style="color:#888">(${esc(ic.reason)})</span>` : ''}</div>`).join('\n')}
</div>` : ''}

<!-- PPE -->
<div style="font-weight:800;font-size:12px;margin:10px 0 4px">PPE ITEMS TO SELL ALONGSIDE</div>
<div style="display:flex;gap:8px;flex-wrap:wrap">
  <span style="border:1px solid #ddd;border-radius:6px;padding:4px 10px;font-size:10px;font-weight:600">🧤 Gloves</span>
  <span style="border:1px solid #ddd;border-radius:6px;padding:4px 10px;font-size:10px;font-weight:600">😷 N95 mask</span>
  <span style="border:1px solid #ddd;border-radius:6px;padding:4px 10px;font-size:10px;font-weight:600">🥽 Goggles</span>
  <span style="border:1px solid #ddd;border-radius:6px;padding:4px 10px;font-size:10px;font-weight:600">👔 Apron</span>
  <span style="border:1px solid #ddd;border-radius:6px;padding:4px 10px;font-size:10px;font-weight:600">👢 Boots</span>
</div>

<!-- Compliance -->
${compAudit.length > 0 ? `
<div class="bx-green" style="margin-top:6px">
  <div style="font-weight:800;color:#1B5E20;margin-bottom:4px">✓ REGULATORY COMPLIANCE (verified by CropSetu AI)</div>
  ${compAudit.map(c => `<div class="cc">✓ ${esc(c.check || '')}: ${esc(c.status || 'PASSED')}${c.detail ? ` — ${esc(c.detail)}` : ''}</div>`).join('\n')}
</div>` : ''}

<!-- Dealer verification -->
<div class="dealer-box">
  <div style="font-weight:800;font-size:12px;margin-bottom:4px">🖊 DEALER VERIFICATION BLOCK</div>
  <div style="font-size:10px;color:#666;margin-bottom:8px">Verify report: ${esc(rptId)}</div>
  <div class="dealer-grid">
    <div class="dealer-field">Dealer name: ___________</div>
    <div class="dealer-field">Shop license #: ___________</div>
    <div class="dealer-field">Date dispensed: ___________</div>
    <div class="dealer-field">Signature: ___________</div>
  </div>
  <div style="margin-top:6px"><div class="dealer-field" style="width:100%">Batch numbers: ___________________________________________________</div></div>
</div>

<div class="pf pf-purple"><span>📋 CropSetu Dispensing · Report ${esc(rptId)}</span><span>Page 3 of 4 · For Input Dealer</span></div>
</div>

<!-- ═══════════════════════════════════════════════════════════════
     PAGE 4 — ANNEX
     ═══════════════════════════════════════════════════════════════ -->
<div class="page">
<div class="pt" style="background:#ECEFF1;border-color:#B0BEC5;color:#37474F">PAGE 4 — ANNEX: CAPTURED DATA & EVIDENCE</div>

<!-- A. Input Parameters -->
<div class="st" style="color:#37474F;border-color:#B0BEC5">📋 A. INPUT PARAMETERS CAPTURED</div>
<table class="at">
  <tr><td class="k">Image captured at</td><td>${esc(generatedAt)}</td><td class="k">Crop stage</td><td>${na(stage)}${farmCtx.cropAge ? `, day ${farmCtx.cropAge}` : ''}</td></tr>
  <tr><td class="k">Farm size (total)</td><td>${na(landTotal, ' acres')}</td><td class="k">Affected area</td><td>${na(affectedArea)}</td></tr>
  <tr><td class="k">Soil type</td><td>${na(farmCtx.soilType)}</td><td class="k">Irrigation</td><td>${na(farmCtx.irrigationType)}</td></tr>
  <tr><td class="k">Farmer description</td><td colspan="3">"${esc(syms.join(', ') || farmCtx.additionalSymptoms || '—')}"</td></tr>
  <tr><td class="k">First noticed</td><td>${na(farmCtx.firstNoticed)}</td><td class="k">Prior treatments</td><td>None reported</td></tr>
  <tr><td class="k">Season</td><td>${na(farmCtx.season)}</td><td class="k">Previous crop</td><td>${na(farmCtx.previousCrop)}</td></tr>
</table>

<!-- B. Environmental Data -->
${(envData.length > 0 || tempVal != null) ? `
<div class="st" style="color:#37474F;border-color:#B0BEC5">🌡 B. ENVIRONMENTAL DATA (last 14 days)</div>
<table class="dt dt3">
  <thead><tr><th>Parameter</th><th>Value</th><th>Favorable for ${esc(diseaseName)}?</th></tr></thead>
  <tbody>
    ${envData.length > 0 ? envData.map(e => `<tr><td><strong>${esc(e.parameter || '')}</strong></td><td>${esc(e.measured || e.value || '—')}</td><td style="color:${e.favorable ? '#C62828' : '#2E7D32'};font-weight:700">${e.favorable ? 'YES ⚠' : 'No'}</td></tr>`).join('\n') : `
    ${tempVal != null ? `<tr><td><strong>Avg Temperature</strong></td><td>${tempVal}°C</td><td style="color:${tempVal >= 15 && tempVal <= 25 ? '#C62828' : '#2E7D32'};font-weight:700">${tempVal >= 15 && tempVal <= 25 ? 'YES ⚠' : 'No'}</td></tr>` : ''}
    ${humVal != null ? `<tr><td><strong>Avg Relative Humidity</strong></td><td>${humVal}%</td><td style="color:${humVal > 80 ? '#C62828' : '#2E7D32'};font-weight:700">${humVal > 80 ? 'YES ⚠' : 'No'}</td></tr>` : ''}
    ${precipV != null ? `<tr><td><strong>Total Rainfall</strong></td><td>${precipV} mm</td><td style="color:${precipV > 20 ? '#C62828' : '#2E7D32'};font-weight:700">${precipV > 20 ? 'YES ⚠' : 'No'}</td></tr>` : ''}
    ${leafWet != null ? `<tr><td><strong>Leaf Wetness Hours</strong></td><td>${leafWet} hrs/day</td><td style="color:${parseFloat(leafWet) > 6 ? '#C62828' : '#2E7D32'};font-weight:700">${parseFloat(leafWet) > 6 ? 'YES ⚠' : 'No'}</td></tr>` : ''}
    ${outbreakNearby != null ? `<tr><td><strong>Regional Outbreak</strong></td><td>${outbreakNearby}</td><td style="color:#C62828;font-weight:700">STRONG signal</td></tr>` : ''}
    `}
  </tbody>
</table>` : ''}

<!-- C. Diagnostic Evidence Matrix -->
${(evMatrix.length > 0 || diffs.length > 0) ? `
<div class="st" style="color:#37474F;border-color:#B0BEC5">🔬 C. DIAGNOSTIC EVIDENCE MATRIX</div>
<table class="dt dt3">
  <thead><tr><th>Disease</th><th>Vision</th><th>Env Fav.</th><th>Symptom Match</th><th>Regional</th><th>FUSED</th></tr></thead>
  <tbody>
    ${evMatrix.length > 0 ? evMatrix.map(e => `<tr${e.is_primary ? ' style="background:#E8F5E9;font-weight:700"' : ''}>
      <td>${e.is_primary ? '✓ ' : ''}${esc(e.disease || '')}</td>
      <td>${e.vision_confidence != null ? e.vision_confidence.toFixed(2) : '—'}</td>
      <td>${esc(e.env_favorability || '—')}</td>
      <td>${e.symptom_match != null ? e.symptom_match.toFixed(2) : '—'}</td>
      <td>${esc(e.regional_signal || '—')}</td>
      <td style="font-weight:700">${e.fused_score != null ? e.fused_score.toFixed(2) : '—'}${e.is_primary ? ' ✓' : ''}</td>
    </tr>`).join('\n') : `
    <tr style="background:#E8F5E9;font-weight:700"><td>✓ ${esc(diseaseName)}</td><td>${(confPct/100).toFixed(2)}</td><td>—</td><td>—</td><td>—</td><td>${(confPct/100).toFixed(2)} ✓</td></tr>
    ${diffs.map(dd => `<tr><td>${esc(dd.disease || dd)}</td><td>${dd.probability != null ? dd.probability.toFixed(2) : '—'}</td><td>—</td><td>—</td><td>—</td><td>${dd.probability != null ? dd.probability.toFixed(2) : '—'}</td></tr>`).join('\n')}
    `}
  </tbody>
</table>
${modelAgree ? `<div style="font-size:11px;color:#555;margin-top:4px">🤖 Model agreement: ${esc(modelAgree)}</div>` : ''}
` : ''}

<!-- D. Compliance Audit -->
${compAudit.length > 0 ? `
<div class="st" style="color:#37474F;border-color:#B0BEC5">📋 D. COMPLIANCE AUDIT LOG</div>
${compAudit.map(c => `<div style="font-size:11px;padding:2px 0">[✓] <strong>${esc(c.check || '')}</strong> : ${esc(c.status || 'PASSED')}${c.detail ? ` (${esc(c.detail)})` : ''}</div>`).join('\n')}
` : ''}

<!-- E. System Metadata -->
<div class="st" style="color:#37474F;border-color:#B0BEC5">⚙ E. SYSTEM METADATA</div>
<div class="ir"><span class="lbl">CropSetu version</span><span class="val">${esc(sysMeta.version || '2.4.1')}</span></div>
<div class="ir"><span class="lbl">Vision models</span><span class="val">${esc(sysMeta.diagnosis_model || 'Gemini 2.5 Flash')}</span></div>
<div class="ir"><span class="lbl">Knowledge base</span><span class="val">${esc(sysMeta.knowledge_base || 'ICAR + CABI + EPPO')}</span></div>
<div class="ir"><span class="lbl">Weather API</span><span class="val">${esc(sysMeta.weather_api || 'Open-Meteo')}</span></div>
<div class="ir"><span class="lbl">Pipeline latency</span><span class="val">${esc(sysMeta.pipeline_latency || '—')}</span></div>

<hr class="dv"/>

<!-- Disclaimer -->
<div class="bx-yellow">
  <div style="font-weight:800;color:#E65100;margin-bottom:4px">⚖ DISCLAIMER</div>
  <div style="font-size:11px;color:#555;line-height:1.6">${esc(disclaimerEn)}</div>
  ${disclaimerLocal ? `<div style="font-size:10.5px;color:#666;margin-top:6px;padding-top:6px;border-top:1px dashed #FFD54F;line-height:1.6">${esc(disclaimerLocal)}</div>` : ''}
</div>

<hr class="dv2"/>
<div style="text-align:center;font-size:11px;color:#888;padding:8px 0;font-weight:700">END OF REPORT${isBilingual ? ` | ${esc(t('diagnosis.endOfReport') || '')}` : ''}</div>
<hr class="dv2"/>

<div class="pf pf-dark"><span>📊 CropSetu Annex · ${esc(rptId)}</span><span>Page 4 of 4 · End of Report</span></div>
</div>

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
        Alert.alert('Saved', `Report saved to:\n${uri}`);
      }
    } catch (err) {
      Alert.alert('Error', 'Could not generate report. Please try again.');
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
  const urgLabel = severity === 'severe' ? 'ACT IMMEDIATELY' : severity === 'moderate' ? 'ACT WITHIN 48 HOURS' : 'ACT WITHIN 5 DAYS';

  // Pathogen labels
  const pathogenLabels = {
    fungal: 'Fungus', bacterial: 'Bacterium', viral: 'Virus',
    oomycete: 'Oomycete', nematode: 'Nematode', pest: 'Pest',
    abiotic: 'Abiotic', nutrient: 'Nutrient Deficiency',
  };

  return (
    <View style={[D.root]}>
      <StatusBar barStyle="light-content" />

      {/* ── Green Header Bar ── */}
      <View style={[D.headerBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={D.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={D.headerBarTitle}>Crop Disease Report</Text>
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
                <Text style={D.diseaseLabel}>DISEASE DETECTED</Text>
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
                  {confTier} CONFIDENCE
                </Text>
              </View>
              <View style={[D.badge, { backgroundColor: sev.color === COLORS.red ? '#FFEBEE' : sev.color === COLORS.amberDark ? '#FFF8E1' : '#E8F5E9' }]}>
                <Ionicons name={sev.icon} size={13} color={sev.color} />
                <Text style={[D.badgeText, { color: sev.color }]}>{(severity || 'moderate').toUpperCase()} SEVERITY</Text>
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
                <Text style={D.cropMetaValue}>{crop}</Text>
                <Text style={D.cropMetaLabel}>CROP</Text>
              </View>
              {stage ? (
                <View style={D.cropMetaItem}>
                  <Text style={D.cropMetaValue}>{stage}</Text>
                  <Text style={D.cropMetaLabel}>STAGE</Text>
                </View>
              ) : null}
              {farmCtx.landSize ? (
                <View style={D.cropMetaItem}>
                  <Text style={D.cropMetaValue}>{farmCtx.landSize} ac</Text>
                  <Text style={D.cropMetaLabel}>FARM SIZE</Text>
                </View>
              ) : null}
              {affectedArea ? (
                <View style={D.cropMetaItem}>
                  <Text style={D.cropMetaValue}>{affectedArea}</Text>
                  <Text style={D.cropMetaLabel}>AFFECTED</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* ═══════════════════════════════════════════════════════════════════
              SCANNED IMAGE — What you submitted vs what AI detected
              ═══════════════════════════════════════════════════════════════════ */}
          {scannedImageUri && (
            <View style={D.section}>
              <View style={D.imageCompareCard}>
                {/* Submitted photo */}
                <View style={D.imageBox}>
                  <View style={D.imageBoxHeader}>
                    <Ionicons name="camera-outline" size={14} color={COLORS.textMedium} />
                    <Text style={D.imageBoxLabel}>Submitted Photo</Text>
                  </View>
                  <Image source={{ uri: scannedImageUri }} style={D.scannedImage} resizeMode="cover" />
                </View>
                {/* AI Detection summary */}
                <View style={D.detectionBox}>
                  <View style={D.imageBoxHeader}>
                    <Ionicons name="scan-outline" size={14} color={COLORS.primary} />
                    <Text style={[D.imageBoxLabel, { color: COLORS.primary }]}>AI Detection</Text>
                  </View>
                  <View style={D.detectionContent}>
                    <View style={D.detectionBadge}>
                      <Text style={D.detectionConfNum}>{confidence}%</Text>
                      <Text style={D.detectionConfLabel}>Confidence</Text>
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
                          <Text style={[D.detectionMetaText, { color: COLORS.amberDark }]}>{spreadRisk.toUpperCase()} SPREAD</Text>
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
                <Text style={D.sectionHeaderAccentText}>What to Do This Week</Text>
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
                <Text style={D.sectionHeaderAccentText}>Spray Schedule</Text>
              </View>
              <View style={D.sprayCard}>
                {/* Table header */}
                <View style={D.sprayHeaderRow}>
                  <Text style={[D.sprayHeaderCell, { flex: 0.5 }]}>#</Text>
                  <Text style={[D.sprayHeaderCell, { flex: 2 }]}>Product</Text>
                  <Text style={[D.sprayHeaderCell, { flex: 1 }]}>Dose</Text>
                  <Text style={[D.sprayHeaderCell, { flex: 1 }]}>When</Text>
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
                        <Text style={D.sprayWhen}>{i === 0 ? 'TODAY' : `Day ${i * 7}`}</Text>
                        {chem.phi_days ? <Text style={D.sprayPhi}>PHI: {chem.phi_days}d</Text> : null}
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
                    {organicTx.dose && <Text style={D.organicDetail}>Dose: {organicTx.dose}</Text>}
                    {organicTx.frequency && <Text style={D.organicDetail}>Frequency: {organicTx.frequency}</Text>}
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
              <SectionHeader color={COLORS.primary} title="Safety Checklist" />
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
                  <Text style={D.weatherRiskLabel}>Weather Disease Risk:</Text>
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
                    ? 'Diagnosis confidence is low. Please consult your nearest KVK or call Kisan Call Centre: 1800-180-1551'
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
              <Text style={D.actionOutlineText}>{t('diagnosis.askFarmMind')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={D.actionFill} onPress={() => navigation.navigate('AgriStore')} activeOpacity={0.85}>
              <Ionicons name="cart-outline" size={15} color={COLORS.white} />
              <Text style={D.actionFillText}>{t('diagnosis.buyProducts')}</Text>
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
              {downloading ? 'Generating PDF…' : 'Download Full Report'}
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
                onPress={() => Linking.openURL(`tel:+91${visitShop.phone}`)}
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
  headerBarTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: COLORS.white, marginLeft: 6 },
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
  actionOutlineText: { fontSize: 13, fontWeight: '700', color: COLORS.primary },
  actionFill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderRadius: 14, paddingVertical: 14, backgroundColor: COLORS.primary,
  },
  actionFillText: { fontSize: 13, fontWeight: '800', color: COLORS.white },

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

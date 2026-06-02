/**
 * PastReportScreen — read-only PDF-style viewer for a past CropDiseaseReport.
 *
 * Backend: GET /api/v1/crop-disease/reports/:id
 *
 * Renders directly from `CropDiseaseReport.fullReport` (the raw FastAPI
 * response) WITHOUT going through the live DiagnosisResultScreen's expected
 * flat shape — that's the source of the earlier crash. Past reports get their
 * own simpler layout focused on archival + share/download.
 */
import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { COLORS, SHADOWS, RADIUS } from '../../constants/colors';
import { useLanguage } from '../../context/LanguageContext';
import api, { safeErrorMessage } from '../../services/api';

const RISK_COLOR = {
  CRITICAL: COLORS.error,
  HIGH:     COLORS.error,
  MODERATE: COLORS.amberDark,
  MEDIUM:   COLORS.amberDark,
  LOW:      COLORS.primary,
  UNKNOWN:  COLORS.textMedium,
};

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Pull the diagnosis details from fullReport. Three possible shapes:
//   (1) Agentic pipeline   — `disease` is an object {name_common, name_scientific,
//       severity, confidence_pct, …}, `treatment` is an object with arrays for
//       chemical/organic/cultural/preventive/immediate.
//   (2) Legacy node format — `disease` is a string, `primary_disease` may exist
//       with `{name, scientific_name, severity, description}`, treatment is an
//       array of strings, pesticides is an array of objects.
//   (3) Empty / minimal   — fall back to the flat columns on the row.
function pickReportFields(row) {
  const full = row.fullReport || {};

  // Disease can be an object (agentic) or a string (legacy).
  const diseaseField = full.disease;
  const diseaseObj   = (diseaseField && typeof diseaseField === 'object') ? diseaseField : null;
  const legacyDis    = full.primary_disease || {};

  const diseaseName =
    (diseaseObj && (diseaseObj.name_common || diseaseObj.name_scientific)) ||
    (typeof diseaseField === 'string' ? diseaseField : null) ||
    legacyDis.name ||
    row.primaryDisease ||
    'Unknown';

  const scientific =
    (diseaseObj && diseaseObj.name_scientific) ||
    legacyDis.scientific_name ||
    full.scientific ||
    '';

  const confidencePct = Math.round(
    (diseaseObj && diseaseObj.confidence_pct != null && diseaseObj.confidence_pct) ||
    (full.confidence != null && full.confidence) ||
    ((full.confidence_score ?? row.confidenceScore) || 0) * 100
  );

  // Format a treatment product object into a readable line
  const fmtProduct = (p) => {
    if (!p || typeof p !== 'object') return String(p ?? '');
    const name = p.product || p.name || (Array.isArray(p.brands) ? p.brands[0]?.name : '') || '';
    const dose = p.dosage || p.dose || p.dose_per_acre || '';
    const freq = p.frequency || p.timing || '';
    const main = [name, dose && `— ${dose}`].filter(Boolean).join(' ');
    return freq ? `${main} (${freq})` : main;
  };
  const toStringList = (arr) =>
    Array.isArray(arr) ? arr.map(x => (typeof x === 'string' ? x : fmtProduct(x))).filter(Boolean) : [];

  // Treatment object (agentic) vs array (legacy)
  const tr = full.treatment;
  const trObj = (tr && typeof tr === 'object' && !Array.isArray(tr)) ? tr : null;

  const treatmentList =
    trObj ? toStringList(trObj.chemical)
          : Array.isArray(tr) ? toStringList(tr)
          : toStringList(full.pesticides);

  const organicList =
    trObj ? toStringList(trObj.organic)
          : toStringList(full.cultural_controls || full.organic);

  const culturalList = trObj ? toStringList(trObj.cultural) : [];

  const preventionList =
    trObj ? toStringList(trObj.preventive)
          : toStringList(full.preventive_measures);

  const immediateActions =
    trObj ? toStringList(trObj.immediate)
          : Array.isArray(full.next_steps) ? toStringList(full.next_steps)
          : toStringList(full.immediate_actions);

  // Summary: agentic uses farmer_summary (string), legacy uses farmer_friendly_summary
  const summary =
    (typeof full.farmer_summary === 'string' ? full.farmer_summary : '') ||
    full.farmer_friendly_summary ||
    (diseaseObj && diseaseObj.description) ||
    legacyDis.description ||
    '';

  const riskLevel = String(
    full.risk_level || row.riskLevel || 'UNKNOWN'
  ).toUpperCase();

  return {
    diseaseName,
    scientific,
    confidencePct,
    riskLevel,
    summary,
    treatmentList,
    organicList,
    culturalList,
    preventionList,
    immediateActions,
  };
}

function buildReportHTML(row, fields) {
  const generatedAt = formatDate(row.createdAt);
  const escape = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const li = arr => (arr || []).map(x => `<li>${escape(x)}</li>`).join('');
  return `
<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1F2937; padding: 28px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color: #6B7280; font-size: 12px; margin-bottom: 16px; }
  .hero { background: #F0FDF4; border-left: 4px solid #16A34A; padding: 14px; border-radius: 8px; margin-bottom: 16px; }
  .hero .disease { font-size: 18px; font-weight: 800; }
  .hero .sci { font-style: italic; color: #6B7280; font-size: 11px; }
  .hero .pills { margin-top: 8px; }
  .pill { display: inline-block; background: #fff; border: 1px solid #E5E7EB; border-radius: 999px; padding: 3px 8px; font-size: 10px; margin-right: 6px; }
  h2 { font-size: 14px; color: #16A34A; margin-top: 18px; margin-bottom: 6px; }
  ul { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.6; }
  .summary { font-size: 12px; line-height: 1.6; color: #374151; }
  .ctx { background: #F9FAFB; border-radius: 8px; padding: 10px 12px; font-size: 11px; color: #4B5563; margin-bottom: 16px; }
  .ctx span { margin-right: 12px; }
  footer { margin-top: 28px; font-size: 10px; color: #9CA3AF; border-top: 1px solid #E5E7EB; padding-top: 10px; }
</style></head><body>
  <h1>CropSetu — Crop Disease Report</h1>
  <div class="meta">Generated on ${escape(generatedAt)}</div>

  <div class="ctx">
    <span><b>Crop:</b> ${escape(row.cropType || '—')}</span>
    <span><b>Stage:</b> ${escape(row.growthStage || '—')}</span>
    ${row.variety ? `<span><b>Variety:</b> ${escape(row.variety)}</span>` : ''}
    ${row.pincode ? `<span><b>PIN:</b> ${escape(row.pincode)}</span>` : ''}
  </div>

  <div class="hero">
    <div class="disease">${escape(fields.diseaseName)}</div>
    ${fields.scientific ? `<div class="sci">${escape(fields.scientific)}</div>` : ''}
    <div class="pills">
      <span class="pill">Confidence ${fields.confidencePct}%</span>
      <span class="pill">Risk ${escape(fields.riskLevel)}</span>
    </div>
  </div>

  ${fields.summary ? `<h2>Summary</h2><p class="summary">${escape(fields.summary)}</p>` : ''}

  ${fields.immediateActions.length ? `<h2>Immediate actions</h2><ul>${li(fields.immediateActions)}</ul>` : ''}
  ${fields.treatmentList.length ? `<h2>Recommended treatment</h2><ul>${li(fields.treatmentList)}</ul>` : ''}
  ${fields.organicList.length ? `<h2>Organic treatment</h2><ul>${li(fields.organicList)}</ul>` : ''}
  ${fields.culturalList?.length ? `<h2>Cultural controls</h2><ul>${li(fields.culturalList)}</ul>` : ''}
  ${fields.preventionList.length ? `<h2>Prevention</h2><ul>${li(fields.preventionList)}</ul>` : ''}

  <footer>CropSetu AI Diagnosis · This report is for guidance only. Confirm with a local agronomist for critical decisions.</footer>
</body></html>`;
}

export default function PastReportScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const reportId = route.params?.reportId;

  const [row, setRow]         = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.get(`/crop-disease/reports/${reportId}`);
        if (active) setRow(res.data.data);
      } catch (e) {
        if (active) setError(safeErrorMessage(e, t('pastReport.loadFailed', 'Could not load report.')));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [reportId, t]);

  const handleDownload = async () => {
    if (!row) return;
    setDownloading(true);
    try {
      const fields = pickReportFields(row);
      const html = buildReportHTML(row, fields);
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `CropSetu Diagnosis — ${fields.diseaseName}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert(t('pastReport.saved', 'Saved'), uri);
      }
    } catch (e) {
      Alert.alert(t('pastReport.downloadFailed', 'Download failed'), e.message || '');
    } finally {
      setDownloading(false);
    }
  };

  const handleShare = async () => {
    if (!row) return;
    const fields = pickReportFields(row);
    const text =
      `CropSetu Diagnosis\n` +
      `Crop: ${row.cropType || '—'}\n` +
      `Disease: ${fields.diseaseName} (${fields.confidencePct}% confidence)\n` +
      `Risk: ${fields.riskLevel}\n` +
      (fields.summary ? `\n${fields.summary}\n` : '') +
      `\nGenerated: ${formatDate(row.createdAt)}`;
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        // Sharing.shareAsync expects a file URI; use a temp .txt for a clean
        // share sheet entry alongside the PDF flow.
        const FileSystem = await import('expo-file-system/legacy');
        const path = `${FileSystem.cacheDirectory}cropsetu-report-${row.id}.txt`;
        await FileSystem.writeAsStringAsync(path, text);
        await Sharing.shareAsync(path, {
          mimeType: 'text/plain',
          dialogTitle: `CropSetu Diagnosis — ${fields.diseaseName}`,
        });
      }
    } catch (e) {
      Alert.alert(t('pastReport.shareFailed', 'Share failed'), e.message || '');
    }
  };

  if (loading) {
    return (
      <View style={S.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
    );
  }
  if (error || !row) {
    return (
      <View style={S.safe}>
        <View style={[S.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
            <Ionicons name="chevron-back" size={22} color={COLORS.white} />
          </TouchableOpacity>
          <Text style={S.headerTitle}>{t('pastReport.title', 'Past Report')}</Text>
        </View>
        <View style={S.errorBox}>
          <Ionicons name="cloud-offline-outline" size={48} color={COLORS.gray175} />
          <Text style={S.errorTxt}>{error || t('pastReport.notFound', 'Report not found.')}</Text>
        </View>
      </View>
    );
  }

  const fields  = pickReportFields(row);
  const riskCol = RISK_COLOR[fields.riskLevel] || RISK_COLOR.UNKNOWN;

  return (
    <View style={S.safe}>
      {/* Header */}
      <View style={[S.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.white} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>{t('pastReport.title', 'Crop Disease Report')}</Text>
          <Text style={S.headerSub}>{t('pastReport.subtitle', 'Saved diagnosis')}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Hero */}
        <View style={S.hero}>
          <View style={S.heroTop}>
            <Text style={S.diseaseName} numberOfLines={2}>{fields.diseaseName}</Text>
            <View style={[S.riskPill, { backgroundColor: riskCol + '15' }]}>
              <Text style={[S.riskTxt, { color: riskCol }]}>{fields.riskLevel}</Text>
            </View>
          </View>
          {fields.scientific ? <Text style={S.scientific}>{fields.scientific}</Text> : null}
          <View style={S.heroPills}>
            <View style={S.pill}>
              <Ionicons name="checkmark-circle" size={11} color={COLORS.primary} />
              <Text style={S.pillTxt}>{fields.confidencePct}% confidence</Text>
            </View>
            <View style={S.pill}>
              <Ionicons name="time-outline" size={11} color={COLORS.textMedium} />
              <Text style={S.pillTxt}>{formatDate(row.createdAt)}</Text>
            </View>
          </View>
        </View>

        {/* Crop metadata */}
        <View style={S.metaCard}>
          <Text style={S.sectionTitle}>{t('pastReport.context', 'Crop context')}</Text>
          <View style={S.metaGrid}>
            <MetaItem label={t('pastReport.crop', 'Crop')} value={row.cropType} />
            <MetaItem label={t('pastReport.stage', 'Stage')} value={row.growthStage} />
            {row.variety   ? <MetaItem label={t('pastReport.variety', 'Variety')} value={row.variety} /> : null}
            {row.fieldArea ? <MetaItem label={t('pastReport.area', 'Area')} value={row.fieldArea} /> : null}
            {row.pincode   ? <MetaItem label={t('pastReport.pincode', 'PIN')} value={row.pincode} /> : null}
          </View>
        </View>

        {/* Summary */}
        {fields.summary ? (
          <View style={S.section}>
            <Text style={S.sectionTitle}>{t('pastReport.summary', 'Summary')}</Text>
            <Text style={S.bodyTxt}>{fields.summary}</Text>
          </View>
        ) : null}

        {/* Immediate actions */}
        {fields.immediateActions.length > 0 ? (
          <BulletList title={t('pastReport.immediateActions', 'Immediate actions')} items={fields.immediateActions} accent={COLORS.error} />
        ) : null}

        {/* Treatment */}
        {fields.treatmentList.length > 0 ? (
          <BulletList title={t('pastReport.treatment', 'Recommended treatment')} items={fields.treatmentList} accent={COLORS.primary} />
        ) : null}

        {/* Organic */}
        {fields.organicList.length > 0 ? (
          <BulletList title={t('pastReport.organic', 'Organic treatment')} items={fields.organicList} accent={COLORS.amberDark} />
        ) : null}

        {/* Cultural controls */}
        {fields.culturalList?.length > 0 ? (
          <BulletList title={t('pastReport.cultural', 'Cultural controls')} items={fields.culturalList} accent={COLORS.brownAlt} />
        ) : null}

        {/* Prevention */}
        {fields.preventionList.length > 0 ? (
          <BulletList title={t('pastReport.prevention', 'Prevention')} items={fields.preventionList} accent={COLORS.blue} />
        ) : null}
      </ScrollView>

      {/* Sticky action bar */}
      <View style={[S.actionBar, { paddingBottom: insets.bottom + 10 }]}>
        <TouchableOpacity style={S.actionBtnSecondary} onPress={handleShare} activeOpacity={0.85}>
          <Ionicons name="share-social-outline" size={18} color={COLORS.primary} />
          <Text style={S.actionBtnSecondaryTxt}>{t('pastReport.share', 'Share')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={S.actionBtnPrimary}
          onPress={handleDownload}
          activeOpacity={0.85}
          disabled={downloading}
        >
          {downloading
            ? <ActivityIndicator size="small" color={COLORS.white} />
            : <Ionicons name="download-outline" size={18} color={COLORS.white} />}
          <Text style={S.actionBtnPrimaryTxt}>
            {downloading ? t('pastReport.downloading', 'Preparing…') : t('pastReport.download', 'Download PDF')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MetaItem({ label, value }) {
  return (
    <View style={S.metaItem}>
      <Text style={S.metaLabel}>{label}</Text>
      <Text style={S.metaValue}>{value || '—'}</Text>
    </View>
  );
}

function BulletList({ title, items, accent }) {
  return (
    <View style={S.section}>
      <View style={S.sectionTitleRow}>
        <View style={[S.sectionDot, { backgroundColor: accent }]} />
        <Text style={S.sectionTitle}>{title}</Text>
      </View>
      {items.map((it, i) => (
        <View key={i} style={S.bullet}>
          <Ionicons name="ellipse" size={6} color={accent} style={{ marginTop: 6 }} />
          <Text style={S.bodyTxt}>{String(it)}</Text>
        </View>
      ))}
    </View>
  );
}

const S = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingBottom: 14,
    backgroundColor: COLORS.primary,
  },
  backBtn:     { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white },
  headerSub:   { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 1 },

  hero: {
    margin: 16, padding: 16,
    backgroundColor: COLORS.greenTint, borderRadius: RADIUS.lg,
    borderLeftWidth: 4, borderLeftColor: COLORS.primary,
  },
  heroTop:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4, gap: 10 },
  diseaseName: { flex: 1, fontSize: 18, fontWeight: '900', color: COLORS.textDark },
  scientific:  { fontSize: 11, fontStyle: 'italic', color: COLORS.textMedium, marginBottom: 8 },
  heroPills:   { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 6 },
  pill:        { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.white, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  pillTxt:     { fontSize: 10, fontWeight: '700', color: COLORS.textDark },
  riskPill:    { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  riskTxt:     { fontSize: 10, fontWeight: '900' },

  metaCard: {
    marginHorizontal: 16, marginBottom: 14, padding: 14,
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    ...SHADOWS.small,
  },
  metaGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 6 },
  metaItem:  { minWidth: 80 },
  metaLabel: { fontSize: 10, color: COLORS.textLight, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue: { fontSize: 13, color: COLORS.textDark, fontWeight: '700', marginTop: 2 },

  section: {
    marginHorizontal: 16, marginBottom: 14, padding: 14,
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    ...SHADOWS.small,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  sectionDot:      { width: 6, height: 6, borderRadius: 3 },
  sectionTitle:    { fontSize: 13, fontWeight: '800', color: COLORS.textDark, marginBottom: 6 },
  bodyTxt:         { fontSize: 13, color: COLORS.textDark, lineHeight: 20, flex: 1 },
  bullet:          { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },

  errorBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 10 },
  errorTxt: { fontSize: 14, color: COLORS.textDark, textAlign: 'center' },

  actionBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingTop: 10,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  actionBtnSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 12,
    backgroundColor: COLORS.primary + '15',
  },
  actionBtnSecondaryTxt: { fontSize: 14, fontWeight: '800', color: COLORS.primary },
  actionBtnPrimary: {
    flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  actionBtnPrimaryTxt: { fontSize: 14, fontWeight: '800', color: COLORS.white },
});

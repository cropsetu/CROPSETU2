/**
 * SoilFormScreen — enter (or review OCR-extracted) soil test values.
 *
 * Doubles as the OCR review step: when navigated to with route.params.prefill
 * (from SoilScan), the 12 fields come pre-filled with the AI-read values and a
 * "please verify" banner shows. Nothing is ever saved without the farmer's tap.
 */
import { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ClipboardList, Info, AlertTriangle } from 'lucide-react-native';
import { useLanguage } from '../../context/LanguageContext';
import { submitSoilReport } from '../../services/aiApi';
import {
  BG, BG_GRADIENT, P_LIGHT, ACCENT, DANGER, TEXT, TEXT2, MUTED, SURFACE, BORDER,
  INTER_REG, INTER_SEMI, INTER_BOLD, INTER_EXTRA,
  CosmicHeader, PARAM_FIELDS, REQUIRED_KEYS, fieldLabel, soilHumanError,
} from './components/soilShared';

// Initialize form state from an OCR prefill object ({key: number|null}).
function prefillToForm(prefill) {
  const out = {};
  if (prefill && typeof prefill === 'object') {
    for (const f of PARAM_FIELDS) {
      const v = prefill[f.key];
      if (v !== null && v !== undefined && v !== '') out[f.key] = String(v);
    }
  }
  return out;
}

export default function SoilFormScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { t, language } = useLanguage();

  const prefill = route?.params?.prefill;
  const inputMethod = route?.params?.inputMethod; // 'ocr' when handed off from scan
  const ocrNotes = route?.params?.notes;
  const fromOcr = inputMethod === 'ocr';

  const [formData, setFormData] = useState(() => prefillToForm(prefill));
  const [fieldName, setFieldName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const setField = (key, value) => setFormData(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    for (const key of REQUIRED_KEYS) {
      if (!formData[key]) {
        const f = PARAM_FIELDS.find(p => p.key === key);
        setError(t('soilHub.form.requiredField', 'Required: {name}').replace('{name}', fieldLabel(f, language)));
        return;
      }
    }
    setError(null);
    setLoading(true);
    try {
      const payload = {
        fieldName: fieldName.trim() || t('soilHub.form.defaultField', 'My field'),
        ...formData,
        ...(fromOcr ? { inputMethod: 'ocr' } : {}),
      };
      const result = await submitSoilReport(payload);
      navigation.replace('SoilReport', { report: result });
    } catch (err) {
      setError(soilHumanError(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={S.root}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <LinearGradient colors={BG_GRADIENT} style={StyleSheet.absoluteFill} />

      <CosmicHeader
        title={fromOcr ? t('soilHub.form.reviewTitle', 'Review values') : t('soilHub.form.title', 'Enter soil test')}
        subtitle={t('soilHub.form.subtitle', 'ICAR Soil Health Card norms')}
        Icon={ClipboardList}
        onBack={() => navigation.goBack()}
        insetTop={insets.top}
      />

      <ScrollView
        contentContainerStyle={[S.scroll, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* OCR verify banner */}
        {fromOcr && (
          <View style={S.ocrBanner}>
            <AlertTriangle size={16} color={ACCENT} strokeWidth={2.3} />
            <View style={{ flex: 1 }}>
              <Text style={S.ocrBannerTitle}>{t('soilHub.form.ocrBannerTitle', 'AI-read values — please verify')}</Text>
              <Text style={S.ocrBannerDesc}>
                {ocrNotes
                  ? ocrNotes
                  : t('soilHub.form.ocrBannerDesc', 'Check each number against your card and fix any mistakes before saving.')}
              </Text>
            </View>
          </View>
        )}

        {/* Field name */}
        <TextInput
          style={S.fieldNameInput}
          placeholder={t('soilHub.form.fieldNamePlaceholder', 'Field name (optional)')}
          placeholderTextColor={MUTED}
          value={fieldName}
          onChangeText={setFieldName}
        />

        <View style={S.sectionRow}>
          <Text style={S.sectionLabel}>{t('soilHub.form.params', 'SOIL PARAMETERS')}</Text>
          <Text style={S.requiredNote}>* {t('soilHub.form.required', 'required')}</Text>
        </View>

        {/* 12 parameter rows */}
        {PARAM_FIELDS.map(f => (
          <View key={f.key} style={S.paramRow}>
            <View style={{ flex: 1 }}>
              <Text style={S.paramLabel}>
                {fieldLabel(f, language)}{f.required ? <Text style={{ color: DANGER }}> *</Text> : null}
              </Text>
              <Text style={S.paramHint}>{t('soilHub.form.normal', 'normal')}: {f.hint}{f.unit ? ` ${f.unit}` : ''}</Text>
            </View>
            <TextInput
              style={S.paramInput}
              placeholder={f.hint}
              placeholderTextColor={MUTED}
              keyboardType="decimal-pad"
              value={formData[f.key] || ''}
              onChangeText={v => setField(f.key, v)}
            />
            <Text style={S.paramUnit}>{f.unit || '—'}</Text>
          </View>
        ))}

        <View style={S.infoNote}>
          <Info size={13} color={MUTED} />
          <Text style={S.infoNoteTxt}>
            {t('soilHub.form.partialOk', 'You can fill only what you have. The 4 starred fields are needed for a score.')}
          </Text>
        </View>

        {error ? <Text style={S.errorTxt}>{error}</Text> : null}

        <TouchableOpacity style={[S.submitBtn, loading && { opacity: 0.6 }]} onPress={handleSubmit} disabled={loading} activeOpacity={0.9}>
          {loading
            ? <ActivityIndicator color={BG} />
            : <Text style={S.submitTxt}>{t('soilHub.form.analyze', 'Analyze my soil')}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },

  ocrBanner: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: 'rgba(245,184,65,0.1)', borderRadius: 14, padding: 13,
    borderWidth: 1, borderColor: 'rgba(245,184,65,0.3)',
  },
  ocrBannerTitle: { fontSize: 13, fontWeight: '800', color: ACCENT, fontFamily: INTER_EXTRA },
  ocrBannerDesc: { fontSize: 12, color: TEXT2, marginTop: 3, lineHeight: 17, fontFamily: INTER_REG },

  fieldNameInput: {
    backgroundColor: SURFACE, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 13,
    borderWidth: 1, borderColor: BORDER, color: TEXT, fontSize: 14.5, fontFamily: INTER_SEMI,
  },

  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  sectionLabel: { fontSize: 11, fontWeight: '900', color: TEXT2, letterSpacing: 1.2, fontFamily: INTER_BOLD },
  requiredNote: { fontSize: 11, color: MUTED, fontFamily: INTER_REG },

  paramRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: SURFACE, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: BORDER,
  },
  paramLabel: { fontSize: 13.5, color: TEXT, fontWeight: '700', fontFamily: INTER_BOLD },
  paramHint: { fontSize: 10.5, color: MUTED, marginTop: 2, fontFamily: INTER_REG },
  paramInput: {
    width: 80, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 9, borderWidth: 1, borderColor: BORDER,
    color: TEXT, fontSize: 15, textAlign: 'right', fontFamily: INTER_BOLD,
  },
  paramUnit: { width: 38, fontSize: 10, color: MUTED, fontWeight: '700', fontFamily: INTER_SEMI },

  infoNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 4 },
  infoNoteTxt: { flex: 1, fontSize: 11.5, color: MUTED, lineHeight: 16, fontFamily: INTER_REG },

  errorTxt: { fontSize: 13, color: DANGER, fontFamily: INTER_SEMI },

  submitBtn: { backgroundColor: P_LIGHT, borderRadius: 15, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  submitTxt: { fontSize: 16, fontWeight: '900', color: BG, fontFamily: INTER_EXTRA },
});

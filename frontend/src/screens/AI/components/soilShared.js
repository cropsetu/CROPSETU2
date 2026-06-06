/**
 * soilShared — cosmic theme tokens + shared widgets for the Soil Hub.
 *
 * Mirrors the "cosmic chat companion" look of AIChatScreen (dark BG, leaf-green
 * primary, harvest-gold accent, frosted glass) so every Soil screen feels like
 * one product. Keeps the 12-parameter definition in ONE place so the form,
 * report, and OCR handoff stay in sync with the backend /soil/manual contract.
 */
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { ArrowLeft } from 'lucide-react-native';

// ── Cosmic theme tokens (match AIChatScreen) ─────────────────────────────────
export const BG       = '#050D08';
export const PRIMARY  = '#22C55E';
export const P_LIGHT  = '#4ADE80';
export const ACCENT   = '#F5B841';
export const BORDER   = 'rgba(255,255,255,0.1)';
export const SURFACE  = 'rgba(255,255,255,0.05)';
export const SURFACE2 = 'rgba(255,255,255,0.08)';
export const TEXT     = '#F0FDF4';
export const TEXT2    = 'rgba(255,255,255,0.75)';
export const MUTED    = 'rgba(255,255,255,0.55)';
export const DANGER   = '#F87171';

export const INTER_REG   = 'Inter_400Regular';
export const INTER_SEMI  = 'Inter_600SemiBold';
export const INTER_BOLD  = 'Inter_700Bold';
export const INTER_EXTRA = 'Inter_800ExtraBold';

// Cosmic background gradient — subtle green-tinted near-black.
export const BG_GRADIENT = ['#071611', '#050D08', '#04130C'];

// ── The 12 Soil Health Card parameters ───────────────────────────────────────
// Keys EXACTLY match backend /soil/manual fields (backend/src/routes/soil.routes.js)
// and the FastAPI OCR output keys (fastapi/services/soil_ocr_service.py).
export const PARAM_FIELDS = [
  { key: 'ph',            label: 'pH',            hi: 'पीएच',       unit: '',     hint: '6.5–7.5', required: true },
  { key: 'nitrogen',      label: 'Nitrogen (N)',  hi: 'नाइट्रोजन',  unit: 'kg/ha', hint: '>280',   required: true },
  { key: 'phosphorus',    label: 'Phosphorus (P)',hi: 'फास्फोरस',   unit: 'kg/ha', hint: '>22',    required: true },
  { key: 'potassium',     label: 'Potassium (K)', hi: 'पोटाश',      unit: 'kg/ha', hint: '>280',   required: true },
  { key: 'organicCarbon', label: 'Organic Carbon',hi: 'जैव कार्बन', unit: '%',     hint: '>0.75',  required: false },
  { key: 'ec',            label: 'EC (salinity)', hi: 'लवणता (EC)', unit: 'dS/m',  hint: '<1.0',   required: false },
  { key: 'sulphur',       label: 'Sulphur (S)',   hi: 'सल्फर',      unit: 'ppm',   hint: '>10',    required: false },
  { key: 'zinc',          label: 'Zinc (Zn)',     hi: 'जिंक',       unit: 'ppm',   hint: '>0.6',   required: false },
  { key: 'iron',          label: 'Iron (Fe)',     hi: 'लोहा',       unit: 'ppm',   hint: '>4.5',   required: false },
  { key: 'manganese',     label: 'Manganese (Mn)',hi: 'मैंगनीज',    unit: 'ppm',   hint: '>2.0',   required: false },
  { key: 'copper',        label: 'Copper (Cu)',   hi: 'तांबा',      unit: 'ppm',   hint: '>0.2',   required: false },
  { key: 'boron',         label: 'Boron (B)',     hi: 'बोरॉन',      unit: 'ppm',   hint: '>0.5',   required: false },
];

export const REQUIRED_KEYS = PARAM_FIELDS.filter(f => f.required).map(f => f.key);

// Rating buckets used by the backend rateSoilParam().
const GOOD_RATINGS = ['optimal', 'high', 'sufficient', 'low_ec'];
const MID_RATINGS  = ['medium', 'slightly_acidic', 'slightly_alkaline'];

/** Dark-theme color for a backend rating object. */
export function ratingColor(rating) {
  if (!rating) return MUTED;
  if (GOOD_RATINGS.includes(rating)) return P_LIGHT;
  if (MID_RATINGS.includes(rating))  return ACCENT;
  return DANGER; // low / acidic / alkaline / highly_alkaline
}

/** Bar fill width for a rating (good = full, mid = half, low = quarter). */
export function ratingFillPct(rating) {
  if (GOOD_RATINGS.includes(rating)) return '85%';
  if (MID_RATINGS.includes(rating))  return '52%';
  return '25%';
}

/** Localized label for a field, falling back to English. */
export function fieldLabel(field, language) {
  if (language === 'hi' && field.hi) return field.hi;
  return field.label;
}

/**
 * Map an API error to a short, farmer-friendly line. `t` is the i18n function;
 * every string has an inline English fallback so it works before translations land.
 */
export function soilHumanError(err, t) {
  const status = err?.response?.status ?? err?.status;
  const serverMsg = err?.response?.data?.error?.message;
  if (status === 429) return t('soilHub.err.rate', 'Too many requests — please wait a moment and try again.');
  if (status === 402) return t('soilHub.err.credits', 'You have used all your AI credits this month. They refill on the 1st.');
  if (status === 413) return t('soilHub.err.large', 'That photo was too large. Please try a smaller or clearer photo.');
  if (status === 504) return t('soilHub.err.timeout', 'Reading the card took too long. Please try again or enter values manually.');
  if (status === 503 || status === 500 || status === 502)
    return t('soilHub.err.down', 'The service is busy right now. Please try again in a moment.');
  if (err?.message === 'Network Error' || err?.code === 'ERR_NETWORK')
    return t('soilHub.err.network', 'No internet connection. Please check your network and retry.');
  return serverMsg || t('soilHub.err.generic', 'Something went wrong. Please try again.');
}

// ── Shared cosmic header (back button + gradient icon badge + titles) ─────────
export function CosmicHeader({ title, subtitle, onBack, Icon, right, insetTop = 0 }) {
  return (
    <BlurView intensity={30} tint="dark" style={[H.wrap, { paddingTop: insetTop + 10 }]}>
      <View style={H.row}>
        <TouchableOpacity onPress={onBack} style={H.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ArrowLeft size={22} color={TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={H.brand}>
          {Icon ? (
            <LinearGradient colors={[PRIMARY, ACCENT]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={H.badge}>
              <Icon size={16} color={BG} strokeWidth={2.4} />
            </LinearGradient>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={H.title} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text style={H.sub} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
        </View>
        {right ? <View style={H.right}>{right}</View> : <View style={{ width: 22 }} />}
      </View>
    </BlurView>
  );
}

const H = StyleSheet.create({
  wrap: {
    paddingHorizontal: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
    backgroundColor: 'rgba(5,13,8,0.6)',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: { width: 34, height: 34, justifyContent: 'center', alignItems: 'center' },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 32, height: 32, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: TEXT, fontFamily: INTER_EXTRA },
  sub:   { fontSize: 11, color: MUTED, marginTop: 1, fontFamily: INTER_REG },
  right: { minWidth: 22, alignItems: 'flex-end' },
});

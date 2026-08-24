/**
 * The filter sheet.
 *
 * Everything beyond animal type and distance lives here rather than on the
 * marketplace header. Eleven filter rows stacked above the grid would push the
 * first animal below the fold on a small phone — which is the screen a farmer
 * actually came for. The header keeps the two filters that get used constantly;
 * the rest are one tap away behind a button that shows how many are active.
 *
 * Edits are staged locally and only applied on "Show results", so the list does
 * not re-query on every slider nudge.
 */
import { useState, useEffect, memo } from 'react';
import {
  View, Text, StyleSheet, Modal, ScrollView, Pressable, TextInput,
  TouchableOpacity, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@krushisarva/shared/constants/colors';

const GREEN = COLORS.primary;

/** Filters this sheet owns. The header owns `animal`, `radiusKm` and `sort`. */
export const SHEET_FILTER_KEYS = [
  'breed', 'gender', 'minPrice', 'maxPrice',
  'minAgeMonths', 'maxAgeMonths', 'minMilk',
  'verified', 'vaccinated', 'healthCertificate',
];

/** How many of this sheet's filters are set — drives the badge on the button. */
export function activeFilterCount(filters = {}) {
  return SHEET_FILTER_KEYS.reduce((n, k) => {
    const v = filters[k];
    return n + (v === null || v === undefined || v === '' || v === false ? 0 : 1);
  }, 0);
}

const AGE_PRESETS = [
  { key: 'any',   label: 'Any age',   min: null, max: null },
  { key: 'young', label: 'Under 2 y', min: null, max: 24 },
  { key: 'prime', label: '2 – 5 y',   min: 24,   max: 60 },
  { key: 'older', label: 'Over 5 y',  min: 60,   max: null },
];

function Row({ label, hint, children }) {
  return (
    <View style={S.row}>
      <Text style={S.rowLabel}>{label}</Text>
      {hint ? <Text style={S.rowHint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

function Chip({ label, active, onPress, accessibilityLabel }) {
  return (
    <Pressable
      style={[S.chip, active && S.chipActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel || label}
      // 44pt minimum target — these are tapped with a thumb in a field.
      hitSlop={6}
    >
      <Text style={[S.chipTxt, active && S.chipTxtActive]}>{label}</Text>
    </Pressable>
  );
}

function ToggleRow({ label, hint, value, onValueChange }) {
  return (
    <View style={S.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={S.toggleLabel}>{label}</Text>
        {hint ? <Text style={S.toggleHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={!!value}
        onValueChange={onValueChange}
        trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
        thumbColor={value ? GREEN : COLORS.surface}
        accessibilityLabel={label}
      />
    </View>
  );
}

/**
 * @param {object}   p
 * @param {boolean}  p.visible
 * @param {object}   p.filters       currently applied filters
 * @param {boolean}  p.showMilkYield only for milk-producing animal types
 * @param {Function} p.onApply       (nextFilters) => void
 * @param {Function} p.onClose
 * @param {Function} p.t
 */
function AnimalFilterSheet({ visible, filters, showMilkYield, onApply, onClose, t }) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(filters);

  // Re-seed from the applied filters each time the sheet opens, so closing
  // without applying really does discard the edits.
  useEffect(() => { if (visible) setDraft(filters); }, [visible, filters]);

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const numeric = (v) => {
    const digits = String(v).replace(/[^\d]/g, '').slice(0, 9);
    return digits ? Number(digits) : null;
  };

  const agePreset = AGE_PRESETS.find(
    (p) => (p.min ?? null) === (draft.minAgeMonths ?? null) && (p.max ?? null) === (draft.maxAgeMonths ?? null),
  ) || AGE_PRESETS[0];

  const clearAll = () => {
    const cleared = { ...draft };
    for (const k of SHEET_FILTER_KEYS) cleared[k] = null;
    setDraft(cleared);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={S.backdrop}>
        <Pressable style={S.backdropTap} onPress={onClose} accessibilityLabel={t('common.close', 'Close')} />
        <View style={[S.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={S.grabber} />

          <View style={S.header}>
            <Text style={S.title}>{t('animal.filters')}</Text>
            <TouchableOpacity onPress={clearAll} hitSlop={10} accessibilityRole="button">
              <Text style={S.clearTxt}>{t('animal.clearAll', 'Clear all')}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={S.body} contentContainerStyle={S.bodyContent} keyboardShouldPersistTaps="handled">
            <Row label={t('animal.breedLabel', 'Breed')}>
              <TextInput
                style={S.input}
                value={draft.breed || ''}
                onChangeText={(v) => set('breed', v)}
                placeholder={t('animal.breedPlaceholder', 'e.g. Murrah, Gir')}
                placeholderTextColor={COLORS.textLight}
                accessibilityLabel={t('animal.breedLabel', 'Breed')}
              />
            </Row>

            <Row label={t('gender')}>
              <View style={S.chipRow}>
                <Chip label={t('all')} active={!draft.gender} onPress={() => set('gender', null)} />
                <Chip label={t('addAnimal.female')} active={draft.gender === 'FEMALE'} onPress={() => set('gender', 'FEMALE')} />
                <Chip label={t('addAnimal.male')} active={draft.gender === 'MALE'} onPress={() => set('gender', 'MALE')} />
              </View>
            </Row>

            <Row label={t('animal.priceRange', 'Price range (₹)')}>
              <View style={S.pairRow}>
                <TextInput
                  style={[S.input, S.inputHalf]}
                  value={draft.minPrice != null ? String(draft.minPrice) : ''}
                  onChangeText={(v) => set('minPrice', numeric(v))}
                  keyboardType="number-pad"
                  placeholder={t('animal.min', 'Min')}
                  placeholderTextColor={COLORS.textLight}
                  accessibilityLabel={t('animal.minPrice', 'Minimum price')}
                />
                <Text style={S.dash}>–</Text>
                <TextInput
                  style={[S.input, S.inputHalf]}
                  value={draft.maxPrice != null ? String(draft.maxPrice) : ''}
                  onChangeText={(v) => set('maxPrice', numeric(v))}
                  keyboardType="number-pad"
                  placeholder={t('animal.max', 'Max')}
                  placeholderTextColor={COLORS.textLight}
                  accessibilityLabel={t('animal.maxPrice', 'Maximum price')}
                />
              </View>
            </Row>

            <Row label={t('age')}>
              <View style={S.chipRow}>
                {AGE_PRESETS.map((p) => (
                  <Chip
                    key={p.key}
                    label={p.label}
                    active={agePreset.key === p.key}
                    onPress={() => { set('minAgeMonths', p.min); set('maxAgeMonths', p.max); }}
                  />
                ))}
              </View>
            </Row>

            {/* Only meaningful for milch animals — a bullock has no milk yield,
                so asking about one on a bullock search is noise. */}
            {showMilkYield ? (
              <Row label={t('milkYield')} hint={t('animal.milkHint', 'Litres per day, minimum')}>
                <View style={S.chipRow}>
                  {[null, 5, 10, 15].map((v) => (
                    <Chip
                      key={String(v)}
                      label={v == null ? t('all') : `${v}+ L`}
                      active={(draft.minMilk ?? null) === v}
                      onPress={() => set('minMilk', v)}
                    />
                  ))}
                </View>
              </Row>
            ) : null}

            <View style={S.divider} />

            <ToggleRow
              label={t('animal.verifiedOnly', 'Verified listings only')}
              hint={t('animal.verifiedHint', 'Checked by the KrushiSarva team')}
              value={draft.verified}
              onValueChange={(v) => set('verified', v || null)}
            />
            <ToggleRow
              label={t('vaccinated')}
              value={draft.vaccinated}
              onValueChange={(v) => set('vaccinated', v || null)}
            />
            <ToggleRow
              label={t('animal.healthCert', 'Health certificate available')}
              value={draft.healthCertificate}
              onValueChange={(v) => set('healthCertificate', v || null)}
            />
          </ScrollView>

          <View style={S.footer}>
            <TouchableOpacity
              style={S.applyBtn}
              onPress={() => { onApply(draft); onClose(); }}
              accessibilityRole="button"
            >
              <Text style={S.applyTxt}>{t('animal.showResults', 'Show results')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  backdropTap: { flex: 1 },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '85%', paddingTop: 8,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, marginBottom: 10 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.divider,
  },
  title:    { fontSize: 19, fontWeight: '800', color: COLORS.textDark, fontFamily: 'Inter_800ExtraBold' },
  clearTxt: { fontSize: 14, fontWeight: '700', color: GREEN },

  body:        { flexGrow: 0 },
  bodyContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },

  row:      { marginBottom: 20 },
  rowLabel: { fontSize: 15, fontWeight: '700', color: COLORS.textDark, marginBottom: 4 },
  rowHint:  { fontSize: 12.5, color: COLORS.textLight, marginBottom: 8 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.surface,
    minHeight: 42, justifyContent: 'center',
  },
  chipActive:   { backgroundColor: GREEN, borderColor: GREEN },
  chipTxt:      { fontSize: 14, fontWeight: '600', color: COLORS.textBody },
  chipTxtActive:{ color: COLORS.white },

  input: {
    backgroundColor: COLORS.inputBg, borderRadius: 12,
    borderWidth: 1.5, borderColor: COLORS.border,
    paddingHorizontal: 14, minHeight: 48,
    fontSize: 15, color: COLORS.textDark, marginTop: 8,
  },
  inputHalf: { flex: 1 },
  pairRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dash:      { fontSize: 16, color: COLORS.textLight, marginTop: 8 },

  divider: { height: 1, backgroundColor: COLORS.divider, marginBottom: 8 },

  toggleRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  toggleLabel: { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  toggleHint:  { fontSize: 12.5, color: COLORS.textLight, marginTop: 2 },

  footer: {
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: COLORS.divider,
  },
  applyBtn: {
    backgroundColor: GREEN, borderRadius: 14,
    minHeight: 52, alignItems: 'center', justifyContent: 'center',
  },
  applyTxt: { color: COLORS.white, fontSize: 16, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
});

export default memo(AnimalFilterSheet);

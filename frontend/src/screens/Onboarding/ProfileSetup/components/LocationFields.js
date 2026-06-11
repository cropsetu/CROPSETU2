// ─────────────────────────────────────────────────────────────────────────────
// <LocationFields/> — detect-or-type the farm address
// ─────────────────────────────────────────────────────────────────────────────
// A prominent "Use my current location" button requests permission (expo-
// location) and, on success, hands coordinates to the injected `onDetect` stub
// (geocoding is out of scope) which returns the address. Detected fields get an
// "Auto-filled" badge that clears the moment the user edits them. Permission
// denial degrades gracefully to manual entry — the user is never trapped.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, Modal, ActivityIndicator, ScrollView, StyleSheet,
} from 'react-native';
import * as Location from 'expo-location';
import {
  LocateFixed, TriangleAlert, ChevronDown, Check, Search, X, BadgeCheck,
} from 'lucide-react-native';
import { useOnbTheme } from '../theme';
import { useT } from '../strings';
import { Haptics } from '../../../../utils/haptics';
import { isValidPincode } from '../../../../utils/validators';
import { STATES } from '../options';
import { s, vs } from '../../../../utils/responsive';

/**
 * @param {object} props
 * @param {{village:string,district:string,state:string,pincode:string}} props.values
 * @param {(field:string, value:string)=>void} props.onChangeField
 * @param {(coords:object|null)=>Promise<object>} props.onDetect  Stub geocoder.
 */
export default function LocationFields({ values, onChangeField, onDetect }) {
  const theme = useOnbTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [detecting, setDetecting] = useState(false);
  const [denied, setDenied] = useState(false);
  const [detectError, setDetectError] = useState(null);
  const [autoFilled, setAutoFilled] = useState(() => new Set());
  const [statePicker, setStatePicker] = useState(false);

  const change = useCallback((field, value) => {
    // Manual edit removes the auto-filled badge for that field.
    setAutoFilled((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev); next.delete(field); return next;
    });
    onChangeField?.(field, value);
  }, [onChangeField]);

  const detect = useCallback(async () => {
    if (detecting) return;
    setDetectError(null); setDenied(false); setDetecting(true);
    Haptics.selection();
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm?.granted) { setDenied(true); return; }
      let coords = null;
      try { coords = (await Location.getCurrentPositionAsync({})).coords; } catch { /* GPS may be off */ }
      // TODO: parent's onDetectLocation(coords) reverse-geocodes → address.
      const addr = await onDetect?.(coords);
      if (addr) {
        const filled = new Set();
        ['village', 'district', 'state', 'pincode'].forEach((f) => {
          if (addr[f]) { onChangeField?.(f, String(addr[f])); filled.add(f); }
        });
        setAutoFilled(filled);
        Haptics.success();
      }
    } catch {
      setDetectError(t('onb.locationFailed'));
    } finally {
      setDetecting(false);
    }
  }, [detecting, onDetect, onChangeField, t]);

  const pincodeError =
    values.pincode && values.pincode.length === 6 && !isValidPincode(values.pincode)
      ? t('onb.invalidPincode')
      : null;

  return (
    <View>
      {/* ── Detect button ── */}
      <Pressable
        onPress={detect}
        disabled={detecting}
        style={[styles.detect, detecting && styles.detectBusy]}
        accessibilityRole="button"
        accessibilityLabel={t('onb.a11y.detect')}
        accessibilityState={{ busy: detecting, disabled: detecting }}
      >
        {detecting ? (
          <ActivityIndicator color={theme.primary} />
        ) : (
          <LocateFixed size={s(20)} color={theme.primary} strokeWidth={2.25} />
        )}
        <Text style={styles.detectText} numberOfLines={2} maxFontSizeMultiplier={1.4}>
          {detecting ? t('onb.detecting') : t('onb.detect')}
        </Text>
      </Pressable>

      {/* Permission-denied → graceful manual fallback note */}
      {denied ? (
        <View style={styles.note} accessibilityLiveRegion="assertive">
          <TriangleAlert size={s(16)} color={theme.warning} strokeWidth={2.25} />
          <Text style={styles.noteText}>{t('onb.permissionDenied')}</Text>
        </View>
      ) : null}
      {detectError ? (
        <View style={styles.note} accessibilityLiveRegion="assertive">
          <TriangleAlert size={s(16)} color={theme.error} strokeWidth={2.25} />
          <Text style={[styles.noteText, { color: theme.error }]}>{detectError}</Text>
        </View>
      ) : null}

      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.dividerText}>{t('onb.permissionHint')}</Text>
      </View>

      {/* ── Manual fields ── */}
      <Field
        label={t('onb.villageLabel')} value={values.village}
        onChangeText={(v) => change('village', v)} placeholder={t('onb.villagePlaceholder')}
        autoFilled={autoFilled.has('village')} theme={theme} styles={styles} t={t}
      />
      <Field
        label={t('onb.districtLabel')} value={values.district}
        onChangeText={(v) => change('district', v)} placeholder={t('onb.districtPlaceholder')}
        autoFilled={autoFilled.has('district')} theme={theme} styles={styles} t={t}
      />

      {/* State — select */}
      <View style={styles.fieldWrap}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>{t('onb.stateLabel')}</Text>
          {autoFilled.has('state') ? <AutoBadge theme={theme} styles={styles} t={t} /> : null}
        </View>
        <Pressable
          style={styles.select}
          onPress={() => setStatePicker(true)}
          accessibilityRole="button"
          accessibilityLabel={`${t('onb.stateLabel')}: ${values.state || t('onb.statePlaceholder')}`}
        >
          <Text style={[styles.selectText, !values.state && styles.placeholder]} numberOfLines={1}>
            {values.state || t('onb.statePlaceholder')}
          </Text>
          <ChevronDown size={s(20)} color={theme.textSecondary} />
        </Pressable>
      </View>

      {/* Pincode */}
      <Field
        label={t('onb.pincodeLabel')} value={values.pincode}
        onChangeText={(v) => change('pincode', v.replace(/\D/g, '').slice(0, 6))}
        placeholder={t('onb.pincodePlaceholder')} keyboardType="number-pad" maxLength={6}
        autoFilled={autoFilled.has('pincode')} error={pincodeError}
        theme={theme} styles={styles} t={t}
      />

      {/* ── State picker modal ── */}
      <StatePicker
        visible={statePicker}
        value={values.state}
        onSelect={(st) => { setStatePicker(false); change('state', st); }}
        onClose={() => setStatePicker(false)}
        theme={theme} styles={styles} t={t}
      />
    </View>
  );
}

// ── Labelled text field with optional auto-fill badge + inline error ─────────
function Field({ label, value, onChangeText, placeholder, keyboardType, maxLength, autoFilled, error, theme, styles, t }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {autoFilled ? <AutoBadge theme={theme} styles={styles} t={t} /> : null}
      </View>
      <TextInput
        style={[styles.input, focused && styles.inputFocused, error && styles.inputError]}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={theme.textPlaceholder}
        keyboardType={keyboardType}
        maxLength={maxLength}
        selectionColor={theme.primary}
        accessibilityLabel={label}
        maxFontSizeMultiplier={1.5}
      />
      {error ? (
        <View style={styles.errorRow} accessibilityLiveRegion="assertive">
          <TriangleAlert size={s(14)} color={theme.error} strokeWidth={2.25} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

function AutoBadge({ theme, styles, t }) {
  return (
    <View style={styles.autoBadge} accessibilityLabel={t('onb.autoFilled')}>
      <BadgeCheck size={s(12)} color={theme.autofillText} strokeWidth={2.5} />
      <Text style={styles.autoBadgeText}>{t('onb.autoFilled')}</Text>
    </View>
  );
}

function StatePicker({ visible, value, onSelect, onClose, theme, styles, t }) {
  const [query, setQuery] = useState('');
  const data = useMemo(
    () => STATES.filter((s2) => s2.label.toLowerCase().includes(query.toLowerCase())),
    [query],
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.pickerSheet}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>{t('onb.selectStateTitle')}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('onb.back')}>
              <X size={s(22)} color={theme.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.searchRow}>
            <Search size={s(18)} color={theme.textTertiary} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={t('onb.statePlaceholder')}
              placeholderTextColor={theme.textPlaceholder}
              autoFocus
              selectionColor={theme.primary}
            />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.pickerList}>
            {data.map((st) => {
              const sel = st.value === value;
              return (
                <Pressable
                  key={st.value}
                  style={styles.pickerRow}
                  onPress={() => { Haptics.selection(); onSelect(st.value); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: sel }}
                  accessibilityLabel={st.label}
                >
                  <Text style={[styles.pickerRowText, sel && { color: theme.primary }]}>{st.label}</Text>
                  {sel ? <Check size={s(18)} color={theme.primary} strokeWidth={2.5} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    detect: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: s(t.space.sm),
      minHeight: Math.max(vs(54), t.tap + 6),
      borderRadius: t.radius.lg,
      borderWidth: 1.5, borderColor: t.primary,
      backgroundColor: t.infoBg,
      paddingHorizontal: s(t.space.base), paddingVertical: vs(t.space.md),
    },
    detectBusy: { opacity: 0.85 },
    detectText: { ...t.text.bodyStrong, color: t.primary, flexShrink: 1, textAlign: 'center' },

    note: { flexDirection: 'row', alignItems: 'flex-start', gap: s(t.space.sm), marginTop: vs(t.space.md) },
    noteText: { flex: 1, ...t.text.helper, color: t.textSecondary },

    divider: { alignItems: 'center', marginVertical: vs(t.space.lg), gap: vs(t.space.sm) },
    line: { height: 1, alignSelf: 'stretch', backgroundColor: t.borderStrong },
    dividerText: { ...t.text.caption, color: t.textTertiary, textAlign: 'center' },

    fieldWrap: { marginBottom: vs(t.space.base) },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: s(t.space.sm), marginBottom: vs(t.space.sm) },
    label: { ...t.text.label, color: t.textSecondary },

    autoBadge: {
      flexDirection: 'row', alignItems: 'center', gap: s(t.space.xs),
      paddingHorizontal: s(t.space.sm), paddingVertical: 2,
      borderRadius: t.radius.pill,
      backgroundColor: t.autofillBg, borderWidth: 1, borderColor: t.autofillBorder,
    },
    autoBadgeText: { ...t.text.caption, color: t.autofillText },

    input: {
      ...t.text.body,
      color: t.textPrimary,
      minHeight: Math.max(vs(52), t.tap),
      borderWidth: 1.5, borderColor: t.border, borderRadius: t.radius.md,
      backgroundColor: t.surfaceAlt,
      paddingHorizontal: s(t.space.base), paddingVertical: vs(t.space.md),
    },
    inputFocused: { borderColor: t.borderFocus, backgroundColor: t.surfaceFocus },
    inputError: { borderColor: t.error },
    errorRow: { flexDirection: 'row', alignItems: 'center', gap: s(t.space.xs), marginTop: vs(t.space.sm) },
    errorText: { ...t.text.helper, color: t.error, flex: 1 },

    select: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      minHeight: Math.max(vs(52), t.tap),
      borderWidth: 1.5, borderColor: t.border, borderRadius: t.radius.md,
      backgroundColor: t.surfaceAlt,
      paddingHorizontal: s(t.space.base), paddingVertical: vs(t.space.md),
    },
    selectText: { ...t.text.body, color: t.textPrimary, flex: 1 },
    placeholder: { color: t.textPlaceholder },

    overlay: { flex: 1, backgroundColor: t.overlay, justifyContent: 'flex-end' },
    pickerSheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: t.radius.xxl, borderTopRightRadius: t.radius.xxl,
      paddingHorizontal: s(t.space.lg), paddingTop: vs(t.space.base),
      maxHeight: '78%',
    },
    pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: vs(t.space.md) },
    pickerTitle: { ...t.text.title, color: t.textPrimary },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: s(t.space.sm),
      borderWidth: 1.5, borderColor: t.border, borderRadius: t.radius.md,
      backgroundColor: t.surfaceAlt, paddingHorizontal: s(t.space.base),
      marginBottom: vs(t.space.md),
    },
    searchInput: { flex: 1, ...t.text.body, color: t.textPrimary, paddingVertical: vs(t.space.md) },
    pickerList: { marginBottom: vs(t.space.lg) },
    pickerRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      minHeight: t.tap, paddingVertical: vs(t.space.md),
      borderBottomWidth: 1, borderBottomColor: t.divider,
    },
    pickerRowText: { ...t.text.body, color: t.textPrimary },
  });
}

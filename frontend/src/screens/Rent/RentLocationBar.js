/**
 * RentLocationBar — the Rent tab's location control.
 *
 * The old UI was five distance chips and a label that flipped between "Nearby:"
 * and "GPS off —". It never said where "near" was measured from, and with GPS
 * denied every chip but "Any" was disabled with no way forward. This bar always
 * names the active source and always opens onto a way to change it:
 *
 *   Near me · 10 km          GPS is live
 *   Pune district            a district was chosen by hand
 *   Location off · showing all   neither
 *
 * Exports the bar, its picker sheet, the radius row (GPS only) and the sort row.
 */
import { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, ScrollView,
  Switch, ActivityIndicator, Linking, TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Haptics } from '@cropsetu/shared/utils/haptics';
import { SPRINGS, isReducedMotion } from '@cropsetu/shared/components/ui/motion';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import LocationPicker from '@cropsetu/shared/components/LocationPicker';
import { DISTRICT_LIST, getTalukas } from '@cropsetu/shared/constants/locations';
import { COLORS, TYPE, SPACE, RADIUS, SHADOWS } from '@cropsetu/shared/constants/colors';
import { SOURCE, RADIUS_OPTIONS } from './rentLocationPrefs';

// Every tappable target below clears 44px; chips reach it with padding + this.
const TAP = 44;

/** One-line summary of what the list is currently filtered to. */
export function locationSummary({ prefs, coords, t }) {
  if (prefs.source === SOURCE.GPS && coords) {
    const radius = prefs.radiusKm == null
      ? t('rent.distAny', 'Any')
      : t('rent.radiusKm', { km: prefs.radiusKm });
    return `${t('rent.srcNearMe', 'Near me')} · ${radius}`;
  }
  if (prefs.source === SOURCE.DISTRICT && prefs.district) {
    const base = t('rent.districtNamed', { district: prefs.district });
    return prefs.taluka ? `${base} · ${prefs.taluka}` : base;
  }
  return t('rent.srcOffShowingAll', 'Location off · showing all');
}

// ── The bar ──────────────────────────────────────────────────────────────────

export function RentLocationBar({ prefs, coords, onOpen, refreshing }) {
  const { t } = useLanguage();
  const live = prefs.source === SOURCE.GPS && !!coords;
  const manual = prefs.source === SOURCE.DISTRICT && !!prefs.district;
  const tint = live ? COLORS.primary : manual ? COLORS.blue : COLORS.grayMid;

  return (
    <Pressable
      style={S.bar}
      onPress={() => { Haptics.selection(); onOpen(); }}
      accessibilityRole="button"
      accessibilityLabel={t('rent.locChange', 'Change location')}
      accessibilityValue={{ text: locationSummary({ prefs, coords, t }) }}
    >
      <View style={[S.barIcon, { backgroundColor: tint + '18' }]}>
        {refreshing
          ? <ActivityIndicator size="small" color={tint} />
          : <Ionicons name={live ? 'navigate' : manual ? 'map-outline' : 'globe-outline'} size={16} color={tint} />}
      </View>
      <View style={S.barTextWrap}>
        <Text style={S.barLabel}>{t('rent.locShowing', 'Showing')}</Text>
        <Text style={[S.barValue, { color: tint }]} numberOfLines={2}>
          {locationSummary({ prefs, coords, t })}
        </Text>
      </View>
      <Ionicons name="chevron-down" size={18} color={COLORS.grayMid} />
    </Pressable>
  );
}

// ── Radius chips (GPS source only) ───────────────────────────────────────────

function Chip({ label, active, onPress, a11yLabel }) {
  const sc = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  const press = (to) => { if (!isReducedMotion()) sc.value = withSpring(to, SPRINGS.snappy); };
  return (
    <Animated.View style={animStyle}>
      <Pressable
        style={[S.chip, active && S.chipActive]}
        onPress={() => { Haptics.selection(); onPress(); }}
        onPressIn={() => press(0.9)}
        onPressOut={() => press(1)}
        accessibilityRole="radio"
        accessibilityState={{ selected: active, checked: active }}
        accessibilityLabel={a11yLabel || label}
      >
        <Text style={[S.chipTxt, active && S.chipTxtActive]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function RentRadiusRow({ prefs, coords, onChange }) {
  const { t } = useLanguage();
  // Radius only means anything measured from a point. With no GPS fix the row
  // would be five disabled chips, which is what made the old UI a dead end —
  // so it simply is not rendered, and the bar explains why.
  if (prefs.source !== SOURCE.GPS || !coords) return null;

  return (
    <View style={S.row} accessibilityRole="radiogroup">
      <Text style={S.rowLabel}>{t('rent.distWithin', 'Within')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.rowScroll}>
        {RADIUS_OPTIONS.map((km) => (
          <Chip
            key={String(km)}
            label={km == null ? t('rent.distAny', 'Any') : t('rent.radiusKm', { km })}
            active={prefs.radiusKm === km}
            onPress={() => onChange(km)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

// ── Source picker sheet ──────────────────────────────────────────────────────

function SourceRow({ icon, title, subtitle, selected, disabled, onPress, children }) {
  return (
    <View style={[S.srcRow, selected && S.srcRowActive, disabled && S.srcRowDisabled]}>
      <Pressable
        style={S.srcHead}
        onPress={disabled ? undefined : () => { Haptics.selection(); onPress(); }}
        disabled={disabled}
        accessibilityRole="radio"
        accessibilityState={{ selected, checked: selected, disabled: !!disabled }}
        accessibilityLabel={title}
        accessibilityHint={subtitle}
      >
        <View style={[S.srcIcon, selected && { backgroundColor: COLORS.primary }]}>
          <Ionicons name={icon} size={17} color={selected ? COLORS.white : COLORS.grayMid} />
        </View>
        <View style={S.srcTextWrap}>
          <Text style={[S.srcTitle, selected && { color: COLORS.primary }]}>{title}</Text>
          {!!subtitle && <Text style={S.srcSub}>{subtitle}</Text>}
        </View>
        <Ionicons
          name={selected ? 'radio-button-on' : 'radio-button-off'}
          size={20}
          color={selected ? COLORS.primary : COLORS.grayLightMid}
        />
      </Pressable>
      {selected && children ? <View style={S.srcBody}>{children}</View> : null}
    </View>
  );
}

export function RentLocationSheet({
  visible, onClose, prefs, setPrefs,
  coords, permissionDenied, locationError, refreshing, onRefreshGps,
  searchActive,
}) {
  const { t } = useLanguage();
  const talukas = useMemo(() => (prefs.district ? getTalukas(prefs.district) : []), [prefs.district]);

  const gpsSub = coords
    ? t('rent.srcGpsLive', 'Using your current position')
    : permissionDenied
      ? t('rent.srcGpsDenied', 'Location permission is off for CROPSETU')
      : locationError
        ? t('rent.srcGpsError', 'Could not get a fix — no signal or GPS is off')
        : t('rent.srcGpsWaiting', 'Getting your position…');

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isReducedMotion() ? 'fade' : 'slide'}
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={S.backdrop} />
      </TouchableWithoutFeedback>

      <View style={S.sheet}>
        <View style={S.handle} />
        <Text style={S.sheetTitle}>{t('rent.locSheetTitle', 'Where are you looking?')}</Text>

        <ScrollView style={S.sheetScroll} keyboardShouldPersistTaps="handled">
          {/* 1 ▸ GPS */}
          <SourceRow
            icon="navigate"
            title={t('rent.srcNearMe', 'Near me')}
            subtitle={gpsSub}
            selected={prefs.source === SOURCE.GPS}
            onPress={() => setPrefs({ source: SOURCE.GPS })}
          >
            <Pressable
              style={S.inlineBtn}
              onPress={onRefreshGps}
              disabled={refreshing}
              accessibilityRole="button"
              accessibilityLabel={t('rent.gpsRefresh', 'Update my location')}
              accessibilityState={{ disabled: !!refreshing }}
            >
              {refreshing
                ? <ActivityIndicator size="small" color={COLORS.primary} />
                : <Ionicons name="refresh" size={15} color={COLORS.primary} />}
              <Text style={S.inlineBtnTxt}>{t('rent.gpsRefresh', 'Update my location')}</Text>
            </Pressable>

            {/* Denied is recoverable but only from Settings — say so and go there,
                instead of greying the row out with no explanation. */}
            {permissionDenied && (
              <Pressable
                style={[S.inlineBtn, S.inlineBtnAlt]}
                onPress={() => Linking.openSettings?.()}
                accessibilityRole="button"
                accessibilityLabel={t('rent.openSettings', 'Open Settings')}
              >
                <Ionicons name="settings-outline" size={15} color={COLORS.cta} />
                <Text style={[S.inlineBtnTxt, { color: COLORS.cta }]}>
                  {t('rent.openSettings', 'Open Settings')}
                </Text>
              </Pressable>
            )}

            <View style={S.strictRow}>
              <View style={S.strictTextWrap}>
                <Text style={S.strictTitle}>
                  {t('rent.strictTitle', 'Only listings with a shared location')}
                </Text>
                <Text style={S.strictSub}>
                  {t(
                    'rent.strictHelp',
                    'Off: listings that never shared coordinates also appear, marked "Location not shared".',
                  )}
                </Text>
              </View>
              <Switch
                value={prefs.strictCoords}
                onValueChange={(v) => setPrefs({ strictCoords: v })}
                trackColor={{ false: COLORS.grayBorder, true: COLORS.primaryPale }}
                thumbColor={prefs.strictCoords ? COLORS.primary : COLORS.grayLightMid}
                accessibilityLabel={t('rent.strictTitle', 'Only listings with a shared location')}
              />
            </View>
          </SourceRow>

          {/* 2 ▸ District / taluka */}
          <SourceRow
            icon="map-outline"
            title={t('rent.srcDistrict', 'District / taluka')}
            subtitle={t('rent.srcDistrictSub', 'Pick a place — no GPS needed')}
            selected={prefs.source === SOURCE.DISTRICT}
            onPress={() => setPrefs({ source: SOURCE.DISTRICT })}
          >
            <Text style={S.fieldLabel}>{t('rent.districtLabel', 'District')}</Text>
            <LocationPicker
              title={t('rent.districtLabel', 'District')}
              items={DISTRICT_LIST}
              selected={prefs.district}
              onSelect={(d) => setPrefs({ district: d, taluka: null })}
              placeholder={t('rent.districtPickerPlaceholder', 'Select district')}
            />

            <Text style={[S.fieldLabel, { marginTop: SPACE[1.5] }]}>
              {t('rent.talukaLabel', 'Taluka (optional)')}
            </Text>
            <LocationPicker
              title={t('rent.talukaLabel', 'Taluka (optional)')}
              items={talukas}
              selected={prefs.taluka}
              onSelect={(v) => setPrefs({ taluka: v })}
              placeholder={t('rent.talukaPlaceholder', 'All talukas')}
              disabled={!prefs.district || searchActive}
            />
            {/* Taluka and the search box both narrow on free text, so only one can
                be in flight. The typed query wins — silently dropping it would be
                worse than pausing the taluka. */}
            {searchActive && !!prefs.taluka && (
              <Text style={S.noteTxt}>
                {t('rent.talukaPausedBySearch', 'Taluka is paused while you are searching.')}
              </Text>
            )}
            {!!prefs.district && (
              <Text style={S.noteTxt}>
                {t('rent.districtNoDistance', 'Distances are not shown for a district search.')}
              </Text>
            )}
          </SourceRow>

          {/* 3 ▸ Everywhere */}
          <SourceRow
            icon="globe-outline"
            title={t('rent.srcAll', 'All of Maharashtra')}
            subtitle={t('rent.srcAllSub', 'No location filter — distances unavailable')}
            selected={prefs.source === SOURCE.ALL}
            onPress={() => setPrefs({ source: SOURCE.ALL })}
          />
        </ScrollView>

        <Pressable style={S.doneBtn} onPress={onClose} accessibilityRole="button">
          <Text style={S.doneTxt}>{t('rent.done', 'Done')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  // Bar
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE[1.5],
    marginHorizontal: SPACE[2],
    marginTop: SPACE[1.5],
    minHeight: TAP + SPACE[1],
    paddingHorizontal: SPACE[1.5],
    paddingVertical: SPACE[1],
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.small,
  },
  barIcon: {
    width: 34, height: 34, borderRadius: RADIUS.full,
    justifyContent: 'center', alignItems: 'center',
  },
  barTextWrap: { flex: 1, minWidth: 0 },
  barLabel: { fontSize: 10, fontWeight: '700', color: COLORS.textLight, letterSpacing: 0.4, textTransform: 'uppercase' },
  barValue: { fontSize: 14, fontWeight: TYPE.weight.black, marginTop: 1 },

  // Chip rows (radius, sort)
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE[1],
    paddingHorizontal: SPACE[2],
    paddingTop: SPACE[1],
  },
  rowLabel: { fontSize: 12, fontWeight: '700', color: COLORS.textMedium, flexShrink: 0 },
  rowScroll: { gap: SPACE[0.5] + 3, paddingRight: SPACE[0.5], alignItems: 'center' },
  chip: {
    // Full 44px target even in the languages whose labels stay short.
    minHeight: TAP,
    justifyContent: 'center',
    paddingHorizontal: SPACE[1.5],
    paddingVertical: SPACE[1],
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipTxt: { fontSize: 12, fontWeight: '700', color: COLORS.grayMid2 },
  chipTxtActive: { color: COLORS.white },

  // Sheet
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingBottom: SPACE[2],
    maxHeight: '88%',
    ...SHADOWS.large,
  },
  handle: {
    width: 40, height: 4, borderRadius: RADIUS.xs,
    backgroundColor: COLORS.grayBorder, alignSelf: 'center',
    marginTop: SPACE[1], marginBottom: SPACE[0.5],
  },
  sheetTitle: {
    fontSize: 17, fontWeight: TYPE.weight.black, color: COLORS.textDark,
    textAlign: 'center', paddingVertical: SPACE[1.5],
    borderBottomWidth: 1, borderBottomColor: COLORS.divider,
  },
  sheetScroll: { paddingHorizontal: SPACE[2], paddingTop: SPACE[1.5] },

  srcRow: {
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.lg,
    marginBottom: SPACE[1.5], overflow: 'hidden', backgroundColor: COLORS.surface,
  },
  srcRowActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryPale + '55' },
  srcRowDisabled: { opacity: 0.5 },
  srcHead: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[1.5],
    minHeight: TAP + SPACE[1], paddingHorizontal: SPACE[1.5], paddingVertical: SPACE[1.5],
  },
  srcIcon: {
    width: 34, height: 34, borderRadius: RADIUS.full,
    backgroundColor: COLORS.grayBg, justifyContent: 'center', alignItems: 'center',
  },
  srcTextWrap: { flex: 1, minWidth: 0 },
  srcTitle: { fontSize: 15, fontWeight: '800', color: COLORS.textDark },
  srcSub: { fontSize: 12, color: COLORS.textMedium, marginTop: 2, lineHeight: 17 },
  srcBody: {
    paddingHorizontal: SPACE[1.5], paddingBottom: SPACE[1.5],
    gap: SPACE[1], borderTopWidth: 1, borderTopColor: COLORS.divider, paddingTop: SPACE[1.5],
  },

  inlineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE[1],
    minHeight: TAP, paddingHorizontal: SPACE[1.5],
    borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.primary,
  },
  inlineBtnAlt: { borderColor: COLORS.cta },
  inlineBtnTxt: { fontSize: 13, fontWeight: '800', color: COLORS.primary, flexShrink: 1 },

  strictRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[1.5],
    minHeight: TAP, paddingTop: SPACE[0.5],
  },
  strictTextWrap: { flex: 1, minWidth: 0 },
  strictTitle: { fontSize: 13, fontWeight: '800', color: COLORS.textDark },
  strictSub: { fontSize: 11, color: COLORS.textMedium, marginTop: 2, lineHeight: 16 },

  fieldLabel: { fontSize: 12, fontWeight: '700', color: COLORS.textMedium },
  noteTxt: { fontSize: 11, color: COLORS.textMedium, lineHeight: 16 },

  doneBtn: {
    marginHorizontal: SPACE[2], marginTop: SPACE[1],
    minHeight: TAP, justifyContent: 'center', alignItems: 'center',
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md,
  },
  doneTxt: { fontSize: 15, fontWeight: '800', color: COLORS.white },
});

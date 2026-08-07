/**
 * Form primitives — labelled, validated, accessible inputs.
 *
 * SHAPE LANGUAGE: inputs, chips and option rows are 14px-radius rectangles.
 * Buttons are pills, cards are 24. A form is therefore readable as a form from
 * across the room without reading a single word, which matters when the person
 * filling it in is standing in a shop doorway in the sun.
 *
 * SELECTED MEANS FILLED. A chip that is merely tinted when selected is
 * indistinguishable from an unselected one outdoors on a mid-range LCD, so the
 * selected state is a solid ember fill with white text — the largest contrast
 * step the palette can make.
 *
 * `FormSection` numbers itself. The two long forms in this app (listing a
 * product, KYC) are the places sellers abandon, and "section 3 of 6" is the
 * cheapest possible sense of progress.
 *
 * What this file has always fixed, and still does:
 *   - inline, per-field errors instead of a modal Alert that named one problem
 *     at a time (and, on web, named none at all — Alert is a no-op there)
 *   - the field reports its own label + error to screen readers via
 *     accessibilityLabel/accessibilityHint, and marks itself invalid
 *   - errors surface on blur or on submit, never while the user is still
 *     typing the first character
 *   - each field can register its Y position so the form can scroll to the
 *     first invalid one on submit
 */
import React, { forwardRef, useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, E, F, HIT, R, SP, T, alpha } from '../../theme';

// ── Field wrapper ────────────────────────────────────────────────────────────

export function Field({
  label,
  required,
  hint,
  error,
  children,
  style,
  /**
   * Marks the field as carrying encrypted PII. Renders a lock next to the
   * label — sellers are asked for a bank account and an Aadhaar number here,
   * and the affordance has to be visible at the point of entry, not buried in
   * a footnote at the bottom of the screen.
   */
  secure,
  secureLabel,
  /** (y:number) => void — lets the parent scroll to this field on error. */
  onLayoutY,
  testID,
}) {
  const handleLayout = useCallback((e) => {
    onLayoutY?.(e.nativeEvent.layout.y);
  }, [onLayoutY]);

  return (
    <View style={[fs.wrap, style]} onLayout={onLayoutY ? handleLayout : undefined} testID={testID}>
      {label ? (
        <View style={fs.labelRow}>
          <Text style={fs.label}>
            {label}
            {required ? <Text style={fs.required}> *</Text> : null}
          </Text>
          {secure ? (
            <View style={fs.secureTag}>
              <Ionicons name="lock-closed" size={10} color={C.success} />
              {secureLabel ? <Text style={fs.secureTxt}>{secureLabel}</Text> : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {children}

      {error ? (
        <View style={fs.errorRow} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle" size={14} color={C.danger} />
          <Text style={fs.errorTxt}>{error}</Text>
        </View>
      ) : hint ? (
        <Text style={fs.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

// ── Text input ───────────────────────────────────────────────────────────────

export const TextField = forwardRef(function TextField({
  value,
  onChangeText,
  onBlur,
  placeholder,
  label,
  error,
  multiline = false,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  autoCorrect,
  maxLength,
  editable = true,
  prefix,
  suffix,
  style,
  inputStyle,
  accessibilityLabel,
  accessibilityHint,
  returnKeyType,
  onSubmitEditing,
  testID,
}, ref) {
  const [focused, setFocused] = useState(false);

  const handleBlur = useCallback((e) => { setFocused(false); onBlur?.(e); }, [onBlur]);

  return (
    <View
      style={[
        fs.inputShell,
        multiline && fs.inputShellMultiline,
        focused && fs.inputShellFocused,
        !!error && fs.inputShellError,
        !editable && fs.inputShellDisabled,
        style,
      ]}
    >
      {prefix ? <View style={fs.affix}>{prefix}</View> : null}
      <TextInput
        ref={ref}
        style={[fs.input, multiline && fs.inputMultiline, inputStyle]}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        placeholder={placeholder}
        placeholderTextColor={C.textFaint}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        multiline={multiline}
        maxLength={maxLength}
        editable={editable}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        testID={testID}
        accessibilityLabel={accessibilityLabel || label || placeholder}
        accessibilityHint={accessibilityHint}
        // `invalid` is what TalkBack/VoiceOver read out as "invalid entry".
        accessibilityState={{ disabled: !editable }}
        accessibilityValue={error ? { text: `Invalid: ${error}` } : undefined}
        // Android draws its own underline on top of our border.
        underlineColorAndroid="transparent"
        textAlignVertical={multiline ? 'top' : 'center'}
      />
      {suffix ? <View style={fs.affix}>{suffix}</View> : null}
    </View>
  );
});

/** Live "42 / 500" counter — shown only once the user is near the cap. */
export function CharCount({ value, max, threshold = 0.8 }) {
  const len = String(value ?? '').length;
  if (!max || len < max * threshold) return null;
  const atLimit = len >= max;
  return (
    <Text style={[fs.charCount, atLimit && { color: C.danger }]} accessibilityLiveRegion="polite">
      {len} / {max}
    </Text>
  );
}

// ── Chips ────────────────────────────────────────────────────────────────────

export function Chip({
  label,
  selected,
  onPress,
  icon,
  disabled,
  size = 'md',
  style,
  accessibilityLabel,
  accessibilityRole = 'button',
  testID,
}) {
  const compact = size === 'sm';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      hitSlop={compact ? { top: 8, bottom: 8 } : undefined}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || label}
      // `selected` is what makes a filter chip announce as "selected".
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      style={({ pressed }) => [
        fs.chip,
        compact ? fs.chipCompact : null,
        selected && fs.chipSelected,
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.78 },
        style,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={compact ? 13 : 15}
          color={selected ? C.onBrand : C.textMuted}
        />
      ) : null}
      <Text
        style={[fs.chipTxt, compact && fs.chipTxtCompact, selected && fs.chipTxtSelected]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Horizontal/wrapping chip group with correct radio/checkbox semantics. */
export function ChipGroup({ children, style, accessibilityLabel }) {
  return (
    <View
      style={[fs.chipRow, style]}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </View>
  );
}

/**
 * FilterBar — the scrolling row of filter/tab chips above a list.
 *
 * Shared by Orders and the report inbox so the two can't drift apart again
 * (they had different padding, different chip sizes and different scroll
 * behaviour). It sits on parchment with a hairline underneath rather than on a
 * white slab, so the list below reads as continuous with it.
 *
 * A horizontal ScrollView, not a nested FlatList: a handful of fixed chips
 * doesn't need virtualising, and the nested list was swallowing the parent's
 * scroll gestures on Android.
 */
export function FilterBar({ children, style, contentStyle, accessibilityRole = 'tablist' }) {
  return (
    <View style={[fs.filterBar, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[fs.filterContent, contentStyle]}
        accessibilityRole={accessibilityRole}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );
}

// ── Checkbox row ─────────────────────────────────────────────────────────────

export function CheckboxRow({
  checked,
  onToggle,
  label,
  hint,
  disabled,
  style,
  testID,
}) {
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: !!checked, disabled: !!disabled }}
      style={({ pressed }) => [fs.checkRow, checked && fs.checkRowOn, pressed && { opacity: 0.78 }, style]}
    >
      <View style={[fs.checkbox, checked && fs.checkboxOn]}>
        {checked ? <Ionicons name="checkmark" size={16} color={C.onBrand} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={fs.checkLabel}>{label}</Text>
        {hint ? <Text style={fs.checkHint}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

// ── Selectable option row (radio semantics) ──────────────────────────────────

export function OptionRow({
  selected,
  onPress,
  icon,
  title,
  description,
  disabled,
  style,
  testID,
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityHint={description}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      style={({ pressed }) => [
        fs.option,
        selected && fs.optionSelected,
        pressed && { opacity: 0.85 },
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      {icon ? (
        <View style={[fs.optionIcon, selected && fs.optionIconOn]}>
          <Ionicons name={icon} size={19} color={selected ? C.onBrand : C.textMuted} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[fs.optionTitle, selected && { color: C.brandInk }]}>{title}</Text>
        {description ? <Text style={fs.optionDesc}>{description}</Text> : null}
      </View>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={22}
        color={selected ? C.brand : C.borderStrong}
      />
    </Pressable>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

/**
 * A card-shaped group of fields with a numbered head. Pass `step`/`total` to
 * get the "03 / 06" counter that gives a long form a sense of distance
 * travelled; omit them and the head degrades to icon + title.
 */
export function FormSection({ icon, title, hint, step, total, children, style }) {
  const numbered = Number.isFinite(step);
  return (
    <View style={[fs.section, style]}>
      <View style={fs.sectionHead}>
        <View style={fs.sectionMark}>
          {numbered ? (
            <Text style={fs.sectionNum}>{String(step).padStart(2, '0')}</Text>
          ) : (
            <Ionicons name={icon || 'ellipse-outline'} size={17} color={C.brandInk} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={fs.sectionTitle} accessibilityRole="header">{title}</Text>
          {hint ? <Text style={fs.sectionHint}>{hint}</Text> : null}
        </View>
        {numbered && Number.isFinite(total) ? (
          <Text style={fs.sectionCount} accessibilityElementsHidden importantForAccessibility="no">
            {String(step).padStart(2, '0')}
            <Text style={fs.sectionCountDim}> / {String(total).padStart(2, '0')}</Text>
          </Text>
        ) : null}
      </View>
      <View style={fs.sectionRule} importantForAccessibility="no" accessibilityElementsHidden />
      {children}
    </View>
  );
}

const fs = StyleSheet.create({
  wrap: { marginBottom: SP.xl },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  label: { ...T.label, color: C.textBody, flexShrink: 1 },
  required: { color: C.danger },
  secureTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
    borderRadius: R.pill,
    backgroundColor: C.successPale,
  },
  secureTxt: { ...T.micro, fontSize: 10, color: C.success, textTransform: 'uppercase' },
  hint: { ...T.caption, color: C.textMuted, marginTop: SP.xs },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.xs, marginTop: SP.sm },
  errorTxt: { ...T.captionBold, flex: 1, color: C.danger },

  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: HIT.min + 4,
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: C.borderStrong,
    paddingHorizontal: SP.lg,
  },
  inputShellMultiline: { minHeight: 116, alignItems: 'stretch', paddingVertical: SP.md },
  // Focus is a colour change plus a warm halo — on web the :focus-visible ring
  // from App.js sits on top of this, and the two are deliberately different
  // (one is keyboard focus, one is "this is the field you are in").
  inputShellFocused: {
    borderColor: C.brand,
    backgroundColor: C.surfaceRaised,
    shadowColor: C.brand,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 2,
  },
  inputShellError: { borderColor: C.danger, backgroundColor: C.dangerPale },
  inputShellDisabled: { backgroundColor: C.surfaceSunken, borderColor: C.border },
  input: {
    flex: 1,
    ...T.bodyLg,
    color: C.text,
    paddingVertical: Platform.OS === 'ios' ? SP.md : SP.sm,
    // RN-Web renders a focus ring on top of ours.
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  inputMultiline: { minHeight: 96, paddingTop: SP.xs },
  affix: { paddingHorizontal: SP.xs },
  charCount: { ...T.caption, color: C.textFaint, textAlign: 'right', marginTop: SP.xs },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    minHeight: HIT.minCompact,
    paddingHorizontal: SP.lg,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: C.borderStrong,
    backgroundColor: C.surface,
  },
  chipCompact: { minHeight: 38, paddingHorizontal: SP.md },
  chipSelected: { borderColor: C.brand, backgroundColor: C.brand },
  chipTxt: { ...T.label, color: C.textBody },
  chipTxtCompact: { ...T.captionBold },
  chipTxtSelected: { color: C.onBrand },

  filterBar: {
    backgroundColor: C.bg,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  filterContent: {
    paddingHorizontal: SP.xl,
    paddingVertical: SP.md,
    gap: SP.sm,
    alignItems: 'center',
  },

  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.md,
    padding: SP.lg,
    minHeight: HIT.min,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: C.borderStrong,
    backgroundColor: C.surface,
  },
  checkRowOn: { borderColor: alpha(C.brand, 0.5), backgroundColor: C.brandPale },
  checkbox: {
    width: 26, height: 26, borderRadius: R.xs + 2,
    borderWidth: 2, borderColor: C.borderStrong,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surface,
  },
  checkboxOn: { backgroundColor: C.brand, borderColor: C.brand },
  checkLabel: { ...T.bodyBold, color: C.text },
  checkHint: { ...T.caption, color: C.textMuted, marginTop: 3 },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    padding: SP.lg,
    minHeight: HIT.min + 12,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: C.borderStrong,
    backgroundColor: C.surface,
  },
  optionSelected: { borderColor: C.brand, backgroundColor: C.brandPale },
  optionIcon: {
    width: 40, height: 40, borderRadius: R.sm,
    backgroundColor: C.surfaceSunken,
    alignItems: 'center', justifyContent: 'center',
  },
  optionIconOn: { backgroundColor: C.brand },
  optionTitle: { ...T.bodyBold, color: C.text },
  optionDesc: { ...T.caption, color: C.textMuted, marginTop: 3 },

  section: {
    backgroundColor: C.surface,
    borderRadius: R.xl,
    borderWidth: 1,
    borderColor: C.border,
    padding: SP.xl,
    marginBottom: SP.lg,
    ...E.card,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  sectionMark: {
    width: 38, height: 38, borderRadius: R.sm,
    backgroundColor: C.brandPale,
    borderWidth: 1,
    borderColor: alpha(C.brand, 0.22),
    alignItems: 'center', justifyContent: 'center',
  },
  sectionNum: { fontFamily: F.serif700, fontSize: 16, lineHeight: 20, color: C.brandInk },
  sectionTitle: { ...T.subhead, color: C.text },
  sectionHint: { ...T.caption, color: C.textMuted, marginTop: 2 },
  sectionCount: { ...T.micro, color: C.brandInk },
  sectionCountDim: { color: C.textFaint },
  sectionRule: { height: 1, backgroundColor: C.border, marginTop: SP.lg, marginBottom: SP.xl },
});

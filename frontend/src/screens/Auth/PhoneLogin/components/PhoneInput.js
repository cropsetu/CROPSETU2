// ─────────────────────────────────────────────────────────────────────────────
// <PhoneInput/> — fixed +91 prefix · grouped 10-digit entry · animated focus
// ─────────────────────────────────────────────────────────────────────────────
// Parent owns the raw value (bare digits) and validation; this component owns
// presentation: the country chip, digit grouping ("98765 43210"), the animated
// focus ring (border colour + soft glow, ~180ms ease-out) and the inline,
// screen-reader-announced error row. Color is never the only error signal — an
// CircleAlert icon and plain-language text accompany it.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState, forwardRef } from 'react';
import { View, Text, TextInput, StyleSheet, AccessibilityInfo, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  interpolateColor,
  useReducedMotion,
  Easing,
} from 'react-native-reanimated';
import { CircleAlert } from 'lucide-react-native';
import { useAuthTheme } from '../theme';
import { useT } from '../strings';
import { Haptics } from '../../../../utils/haptics';
import { SFX } from '../../../../utils/authSound';
import { s, vs, fs } from '../../../../utils/responsive';

/** Bare digits → grouped display "XXXXX XXXXX" (Indian mobile grouping). */
function group(digits) {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

/**
 * @param {object}   props
 * @param {string}   props.value             Raw digits (max 10), owned by parent.
 * @param {(d:string)=>void} props.onChangeText  Receives raw digits.
 * @param {() => void} [props.onSubmitEditing]
 * @param {string|null} [props.error]         Inline error message, or null.
 * @param {boolean}  [props.editable=true]
 * @param {boolean}  [props.autoFocus]
 * @param {string}   [props.dialCode='+91']
 * @param {string}   [props.flag='🇮🇳']
 */
const PhoneInput = forwardRef(function PhoneInput(
  {
    value,
    onChangeText,
    onSubmitEditing,
    error = null,
    editable = true,
    autoFocus = false,
    dialCode = '+91',
    flag = '🇮🇳',
  },
  ref,
) {
  const theme = useAuthTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const reduceMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);

  // focus = 0 rest → 1 focused, drives an interpolated border colour + glow.
  // Reduce-motion snaps instantly instead of tweening.
  const focus = useSharedValue(0);
  useEffect(() => {
    focus.value = withTiming(focused ? 1 : 0, {
      duration: reduceMotion ? 0 : theme.motion.fast,
      easing: Easing.out(Easing.cubic),
    });
  }, [focused, focus, reduceMotion, theme.motion.fast]);

  // Short error shake on the field row — same values/pattern as OtpInput.
  const shakeX = useSharedValue(0);

  // On a new error: announce it, fire the error haptic + a quiet error blip, and
  // shake the row (shake is reduce-motion gated; the blip self-gates inside SFX).
  const prevError = useRef(null);
  useEffect(() => {
    if (error && error !== prevError.current) {
      AccessibilityInfo.announceForAccessibility?.(error);
      Haptics.error();
      SFX.play('error');
      if (!reduceMotion) {
        shakeX.value = withSequence(
          withTiming(-9, { duration: 45 }),
          withTiming(9, { duration: 45 }),
          withTiming(-7, { duration: 45 }),
          withTiming(7, { duration: 45 }),
          withTiming(0, { duration: 45 }),
        );
      }
    }
    prevError.current = error;
  }, [error, reduceMotion, shakeX]);

  const fieldStyle = useAnimatedStyle(() => {
    // Error wins over focus for the border; glow only on focus.
    const borderColor = error
      ? theme.error
      : interpolateColor(focus.value, [0, 1], [theme.border, theme.borderFocus]);
    return {
      borderColor,
      backgroundColor: interpolateColor(
        focus.value,
        [0, 1],
        [theme.surfaceAlt, theme.surfaceFocus],
      ),
      shadowOpacity: focus.value * (theme.mode === 'dark' ? 0.5 : 0.18),
      transform: [{ translateX: shakeX.value }],
    };
  });

  const handleChange = useCallback(
    (text) => {
      const digits = text.replace(/\D/g, '').slice(0, 10);
      onChangeText?.(digits);
    },
    [onChangeText],
  );

  return (
    <View>
      <Text style={styles.label} accessibilityRole="text">
        {t('auth.phoneLabel')}
      </Text>

      <Animated.View style={[styles.field, fieldStyle]}>
        {/* Country chip — fixed, non-editable */}
        <View
          style={styles.chip}
          accessible
          accessibilityRole="text"
          accessibilityLabel={`Country code ${dialCode}`}
        >
          <Text style={styles.flag} allowFontScaling={false}>
            {flag}
          </Text>
          <Text style={styles.dial} maxFontSizeMultiplier={1.4}>
            {dialCode}
          </Text>
        </View>
        <View style={styles.divider} />

        <TextInput
          ref={ref}
          style={styles.input}
          value={group(value)}
          onChangeText={handleChange}
          onFocus={() => { Haptics.selection(); setFocused(true); }}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          editable={editable}
          autoFocus={autoFocus}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete={Platform.OS === 'android' ? 'tel' : 'tel-device'}
          inputMode="numeric"
          returnKeyType="done"
          maxLength={11}               // 10 digits + 1 grouping space
          placeholder={t('auth.phonePlaceholder')}
          placeholderTextColor={theme.textPlaceholder}
          selectionColor={theme.primary}
          maxFontSizeMultiplier={1.5}
          accessibilityLabel={t('auth.a11yPhoneField')}
          accessibilityState={{ disabled: !editable }}
          // Surface the error to the field's a11y value without leaking it into
          // the visible input text.
          accessibilityHint={error || undefined}
        />
      </Animated.View>

      {/* Inline error row — icon + text, announced via live region */}
      {error ? (
        <View style={styles.errorRow} accessibilityLiveRegion="assertive">
          <CircleAlert size={s(16)} color={theme.error} strokeWidth={2.5} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
});

function makeStyles(t) {
  return StyleSheet.create({
    label: {
      ...t.text.label,
      color: t.textSecondary,
      marginBottom: vs(t.space.sm),
    },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: Math.max(vs(56), t.tap + 8),
      borderWidth: 1.5,
      borderRadius: t.radius.lg,
      paddingLeft: s(t.space.md),
      // Glow colour fixed; opacity animated in fieldStyle.
      shadowColor: t.focusGlow,
      shadowOffset: { width: 0, height: 0 },
      shadowRadius: 10,
      shadowOpacity: 0,
    },
    chip: { flexDirection: 'row', alignItems: 'center', gap: s(t.space.xs), paddingVertical: vs(t.space.md) },
    flag: { fontSize: fs(18) },
    dial: { ...t.text.dialCode, color: t.textPrimary },
    divider: {
      width: 1,
      alignSelf: 'stretch',
      marginVertical: vs(10),
      marginHorizontal: s(t.space.md),
      backgroundColor: t.border,
    },
    input: {
      flex: 1,
      ...t.text.phone,
      color: t.textPrimary,
      paddingVertical: vs(t.space.base),
      paddingRight: s(t.space.base),
    },
    errorRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: s(t.space.sm),
      marginTop: vs(t.space.sm),
      paddingHorizontal: s(t.space.xs),
    },
    errorText: {
      flex: 1,
      ...t.text.helper,
      color: t.mode === 'dark' ? t.onErrorBg : t.error,
    },
  });
}

export default PhoneInput;

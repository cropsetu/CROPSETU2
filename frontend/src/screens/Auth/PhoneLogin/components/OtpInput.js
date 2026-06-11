// ─────────────────────────────────────────────────────────────────────────────
// <OtpInput/> — 6 digit boxes backed by ONE hidden TextInput
// ─────────────────────────────────────────────────────────────────────────────
// Why one input instead of six: a single field gives us paste, iOS/Android
// SMS-autofill, backspace-to-previous and auto-advance *for free*, with no
// fragile cross-field focus juggling. The boxes are pure presentation of that
// one string. A transparent input sits on top to capture taps anywhere.
//
// States (driven by `status`): idle · verifying (locked + pulse) · success
// (green + check pop + success haptic) · error (red + reanimated shake + error
// haptic). No state changes a box's SIZE, so the layout never jumps.
// ─────────────────────────────────────────────────────────────────────────────
import React, {
  useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef,
} from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, AccessibilityInfo } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  withRepeat,
  cancelAnimation,
  useReducedMotion,
  Easing,
} from 'react-native-reanimated';
import { Check, CircleAlert } from 'lucide-react-native';
import { useAuthTheme } from '../theme';
import { useT } from '../strings';
import { Haptics } from '../../../../utils/haptics';
import { SFX } from '../../../../utils/authSound';
import { SPRINGS } from '../../../../components/ui/motion';
import { s, vs } from '../../../../utils/responsive';
import Shimmer from './Shimmer';
import ConfettiBurst from './ConfettiBurst';

/**
 * @param {object} props
 * @param {string} props.value                       Raw digits owned by parent.
 * @param {(d:string)=>void} props.onChangeText
 * @param {() => void} [props.onComplete]            Fires when all digits entered.
 * @param {number} [props.length=6]
 * @param {'idle'|'verifying'|'success'|'error'} [props.status='idle']
 * @param {string|null} [props.error]                Plain-language message row.
 * @param {boolean} [props.autoFocus]
 * @param {React.Ref} ref  Exposes { focus(), blur(), clear() }.
 */
const OtpInput = forwardRef(function OtpInput(
  { value, onChangeText, onComplete, length = 6, status = 'idle', error = null, autoFocus = false },
  ref,
) {
  const theme = useAuthTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const reduceMotion = useReducedMotion();

  const inputRef = useRef(null);
  const [focused, setFocused] = useState(false);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    blur: () => inputRef.current?.blur(),
    clear: () => onChangeText?.(''),
  }));

  const editable = status === 'idle' || status === 'error';
  const cells = Array.from({ length }, (_, i) => value[i] ?? '');
  const activeIndex = Math.min(value.length, length - 1);

  // ── Animations ────────────────────────────────────────────────────────────
  const shakeX = useSharedValue(0);
  const successScale = useSharedValue(0);   // check badge pop
  const rowScale = useSharedValue(1);       // subtle celebratory row scale
  const pulse = useSharedValue(1);          // verifying breathe
  const caret = useSharedValue(1);          // blinking caret in the active cell
  const errorGlow = useSharedValue(0);      // brief red halo on error

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }, { scale: rowScale.value }],
    opacity: pulse.value,
  }));
  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: successScale.value }],
    opacity: successScale.value,
  }));
  const caretStyle = useAnimatedStyle(() => ({ opacity: caret.value }));
  const errorGlowStyle = useAnimatedStyle(() => ({ opacity: errorGlow.value }));

  // Fire haptics + run the matching animation exactly once per status change.
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === status) return;
    prevStatus.current = status;

    // Stop the verifying pulse whenever we leave that state.
    if (status !== 'verifying') {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 150 });
    }

    if (status === 'error') {
      Haptics.error();
      SFX.play('error');                    // quiet error blip (self-gates on mute / RM)
      AccessibilityInfo.announceForAccessibility?.(error || t('auth.errWrongOtp'));
      if (!reduceMotion) {
        shakeX.value = withSequence(
          withTiming(-9, { duration: 45 }),
          withTiming(9, { duration: 45 }),
          withTiming(-7, { duration: 45 }),
          withTiming(7, { duration: 45 }),
          withTiming(0, { duration: 45 }),
        );
        // Brief red halo pulse on the row.
        errorGlow.value = withSequence(
          withTiming(0.18, { duration: 120, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 360, easing: Easing.in(Easing.quad) }),
        );
      }
    } else if (status === 'success') {
      Haptics.success();
      SFX.play('success');                  // short rising success chime
      AccessibilityInfo.announceForAccessibility?.(t('auth.verified'));
      if (reduceMotion) {
        successScale.value = 1;
      } else {
        successScale.value = withSpring(1, SPRINGS.bouncy);
        rowScale.value = withSequence(
          withTiming(1.03, { duration: 140, easing: Easing.out(Easing.quad) }),
          withSpring(1, SPRINGS.gentle),
        );
      }
    } else if (status === 'verifying' && !reduceMotion) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(0.55, { duration: 520, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 520, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      );
    }
    if (status === 'idle') successScale.value = 0;
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Blink the caret in the active cell while focused & editable.
  useEffect(() => {
    cancelAnimation(caret);
    if (focused && editable && !reduceMotion && value.length < length) {
      caret.value = withRepeat(
        withSequence(withTiming(0, { duration: 480 }), withTiming(1, { duration: 480 })),
        -1,
        true,
      );
    } else {
      caret.value = 1;
    }
  }, [focused, editable, reduceMotion, value.length, length, caret]);

  const handleChange = useCallback(
    (text) => {
      const digits = text.replace(/\D/g, '').slice(0, length);
      // A digit was added (vs. backspace / clear) → soft key tick (one per change,
      // so a paste doesn't fire a burst). Self-gates on mute / reduce-motion.
      if (digits.length > value.length) SFX.play('key');
      onChangeText?.(digits);
      if (digits.length === length) onComplete?.(digits);
    },
    [length, value.length, onChangeText, onComplete],
  );

  return (
    <View>
      <Text style={styles.label}>{t('auth.otpLabel')}</Text>

      <Pressable
        onPress={() => editable && inputRef.current?.focus()}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('auth.a11yOtpField')}
        accessibilityValue={{ text: value.split('').join(' ') }}
        accessibilityState={{ disabled: !editable }}
      >
        <Animated.View style={[styles.row, rowStyle]}>
          {/* Brief red halo behind the boxes on error (invisible at rest). */}
          <Animated.View pointerEvents="none" style={[styles.errorGlow, errorGlowStyle]} />

          {cells.map((digit, i) => {
            const isActive = focused && editable && i === activeIndex;
            const showCaret = isActive && digit === '';
            return (
              <Cell
                key={i}
                digit={digit}
                isActive={isActive}
                status={status}
                showCaret={showCaret}
                caretStyle={caretStyle}
                styles={styles}
                reduceMotion={reduceMotion}
              />
            );
          })}

          {/* Success check badge — pops over the row's trailing edge */}
          {status === 'success' ? (
            <Animated.View style={[styles.checkBadge, checkStyle]} pointerEvents="none">
              <Check size={s(16)} color={theme.surface} strokeWidth={3} />
            </Animated.View>
          ) : null}

          {/* Celebratory micro-burst from the check badge (reduce-motion: none) */}
          {status === 'success' ? <ConfettiBurst style={styles.confetti} /> : null}

          {/* The real, invisible input — captures every keystroke / paste / SMS */}
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={handleChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            editable={editable}
            autoFocus={autoFocus}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={length}
            textContentType="oneTimeCode"   // iOS SMS autofill
            autoComplete="sms-otp"           // Android SMS autofill
            importantForAutofill="yes"
            caretHidden
            selectionColor="transparent"
            style={styles.hiddenInput}
            // The Pressable already labels the group; keep the raw input quiet
            // so screen readers don't double-announce.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </Animated.View>
      </Pressable>

      {/* Indeterminate progress under the boxes while verifying. The slot height
          is always reserved so showing/hiding the bar never shifts the layout. */}
      <View style={styles.progressSlot}>
        {status === 'verifying' ? <Shimmer mode="bar" active /> : null}
      </View>

      {/* Status line: verifying / verified / error — paired icon + text */}
      {status === 'verifying' ? (
        <View style={styles.statusRow} accessibilityLiveRegion="polite">
          <Text style={[styles.statusText, { color: theme.textSecondary }]}>
            {t('auth.verifying')}
          </Text>
        </View>
      ) : null}

      {status === 'success' ? (
        <View style={styles.statusRow} accessibilityLiveRegion="polite">
          <Check size={s(15)} color={theme.success} strokeWidth={3} />
          <Text style={[styles.statusText, { color: theme.success }]}>{t('auth.verified')}</Text>
        </View>
      ) : null}

      {error && status !== 'success' ? (
        <View style={styles.statusRow} accessibilityLiveRegion="assertive">
          <CircleAlert size={s(15)} color={theme.error} strokeWidth={2.5} />
          <Text style={[styles.statusText, { color: theme.mode === 'dark' ? theme.onErrorBg : theme.error }]}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

// ── A single OTP box — owns its own fill "pop" so digits land with a tiny bounce.
function Cell({ digit, isActive, status, showCaret, caretStyle, styles, reduceMotion }) {
  const scale = useSharedValue(1);
  const filled = digit !== '';
  const prevFilled = useRef(filled);

  useEffect(() => {
    if (filled && !prevFilled.current && !reduceMotion) {
      scale.value = withSequence(
        withSpring(1.08, SPRINGS.snappy),
        withSpring(1, SPRINGS.snappy),
      );
    }
    prevFilled.current = filled;
  }, [filled, reduceMotion, scale]);

  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View
      style={[
        styles.cell,
        filled && styles.cellFilled,
        isActive && styles.cellActive,
        status === 'success' && styles.cellSuccess,
        status === 'error' && styles.cellError,
        aStyle,
      ]}
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={styles.digit} maxFontSizeMultiplier={1.4}>{digit}</Text>
      {showCaret ? <Animated.View style={[styles.caret, caretStyle]} /> : null}
    </Animated.View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    label: { ...t.text.label, color: t.textSecondary, marginBottom: vs(t.space.sm) },
    row: { flexDirection: 'row', gap: s(t.space.sm), position: 'relative' },
    // Red halo behind the boxes; opacity is animated (0 at rest).
    errorGlow: {
      position: 'absolute',
      top: -s(6), left: -s(6), right: -s(6), bottom: -s(6),
      borderRadius: t.radius.lg,
      backgroundColor: t.error,
    },
    // Burst origin — roughly the centre of the trailing-edge check badge.
    confetti: { position: 'absolute', top: s(5), right: s(7) },
    progressSlot: { height: vs(3), marginTop: vs(t.space.sm) },
    cell: {
      flex: 1,
      minHeight: Math.max(vs(58), t.tap + 10),
      borderRadius: t.radius.md,
      borderWidth: 1.5,
      borderColor: t.border,
      backgroundColor: t.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellFilled: { borderColor: t.borderStrong, backgroundColor: t.surfaceFocus },
    cellActive: {
      borderColor: t.borderFocus,
      borderWidth: 2,
      backgroundColor: t.surfaceFocus,
      shadowColor: t.focusGlow,
      shadowOffset: { width: 0, height: 0 },
      shadowRadius: 8,
      shadowOpacity: t.mode === 'dark' ? 0.55 : 0.25,
      elevation: 2,
    },
    cellSuccess: { borderColor: t.success, backgroundColor: t.successBg },
    cellError: { borderColor: t.error, backgroundColor: t.errorBg },
    digit: { ...t.text.otpDigit, color: t.textPrimary },
    caret: {
      position: 'absolute',
      width: 2,
      height: vs(26),
      borderRadius: 1,
      backgroundColor: t.primary,
    },
    checkBadge: {
      position: 'absolute',
      top: -s(8),
      right: -s(6),
      width: s(26),
      height: s(26),
      borderRadius: s(13),
      backgroundColor: t.success,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Fills the row; invisible but fully interactive.
    hiddenInput: {
      ...StyleSheet.absoluteFillObject,
      color: 'transparent',
      fontSize: 1,
      textAlign: 'center',
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(t.space.xs),
      marginTop: vs(t.space.md),
      minHeight: vs(20),
    },
    statusText: { ...t.text.helper },
  });
}

export default OtpInput;

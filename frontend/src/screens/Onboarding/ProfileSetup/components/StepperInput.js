// ─────────────────────────────────────────────────────────────────────────────
// <StepperInput/> — numeric stepper with a unit label
// ─────────────────────────────────────────────────────────────────────────────
// Big ±48dp +/− buttons for low-effort tapping, plus a direct-entry field for
// large values. Value is clamped to [min,max]; each step gives a selection
// haptic. The unit ("acres") is always visible so the number is never ambiguous.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Minus, Plus } from 'lucide-react-native';
import { useOnbTheme } from '../theme';
import { useT } from '../strings';
import { Haptics } from '../../../../utils/haptics';
import { s, vs } from '../../../../utils/responsive';

/** Trim float drift (0.1+0.2…) so steps stay clean. */
function clean(n, allowDecimal) {
  return allowDecimal ? Math.round(n * 100) / 100 : Math.round(n);
}
const display = (n) => String(n);

/**
 * @param {object} props
 * @param {number} props.value
 * @param {(n:number)=>void} props.onChange
 * @param {number} [props.min=0]
 * @param {number} [props.max=999]
 * @param {number} [props.step=1]
 * @param {string} props.unitLabel
 * @param {boolean} [props.allowDecimal=true]
 */
export default function StepperInput({
  value, onChange, min = 0, max = 999, step = 1, unitLabel, allowDecimal = true,
}) {
  const theme = useOnbTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [text, setText] = useState(display(value));

  const clamp = useCallback((n) => Math.min(max, Math.max(min, n)), [min, max]);

  const commit = useCallback((n) => {
    const next = clean(clamp(n), allowDecimal);
    setText(display(next));
    onChange?.(next);
  }, [clamp, allowDecimal, onChange]);

  const bump = useCallback((dir) => {
    Haptics.selection();
    commit((Number(value) || 0) + dir * step);
  }, [commit, value, step]);

  const onType = useCallback((raw) => {
    // Forgiving while typing; clamp on blur.
    const cleaned = raw.replace(allowDecimal ? /[^0-9.]/g : /[^0-9]/g, '');
    setText(cleaned);
    const parsed = parseFloat(cleaned);
    if (!Number.isNaN(parsed)) onChange?.(clean(clamp(parsed), allowDecimal));
  }, [allowDecimal, clamp, onChange]);

  const current = Number(value) || 0;

  return (
    <View
      style={styles.wrap}
      accessibilityRole="adjustable"
      accessibilityValue={{ text: `${display(value)} ${unitLabel}` }}
    >
      <StepBtn
        icon={Minus} disabled={current <= min} onPress={() => bump(-1)}
        label={t('onb.a11y.decrease')} theme={theme} styles={styles}
      />

      <View style={styles.center}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={onType}
          onBlur={() => commit(parseFloat(text) || min)}
          keyboardType={allowDecimal ? 'decimal-pad' : 'number-pad'}
          inputMode="decimal"
          maxLength={6}
          selectionColor={theme.primary}
          accessibilityLabel={unitLabel}
          maxFontSizeMultiplier={1.3}
        />
        <Text style={styles.unit} maxFontSizeMultiplier={1.3}>{unitLabel}</Text>
      </View>

      <StepBtn
        icon={Plus} disabled={current >= max} onPress={() => bump(1)}
        label={t('onb.a11y.increase')} theme={theme} styles={styles}
      />
    </View>
  );
}

function StepBtn({ icon: Icon, onPress, disabled, label, theme, styles }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, disabled && styles.btnDisabled]}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Icon size={s(22)} color={disabled ? theme.textTertiary : theme.primary} strokeWidth={2.5} />
    </Pressable>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      borderWidth: 1.5,
      borderColor: t.border,
      borderRadius: t.radius.pill,
      backgroundColor: t.surfaceAlt,
      padding: s(t.space.xs),
      gap: s(t.space.sm),
    },
    btn: {
      width: s(48), height: s(48), borderRadius: s(24),
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: t.surface,
      borderWidth: 1, borderColor: t.border,
    },
    btnDisabled: { backgroundColor: t.surfaceAlt, borderColor: t.borderStrong },
    center: { minWidth: s(96), alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: s(t.space.xs) },
    input: {
      ...t.text.title,
      color: t.textPrimary,
      textAlign: 'center',
      minWidth: s(44),
      paddingVertical: vs(t.space.xs),
    },
    unit: { ...t.text.body, color: t.textSecondary },
  });
}

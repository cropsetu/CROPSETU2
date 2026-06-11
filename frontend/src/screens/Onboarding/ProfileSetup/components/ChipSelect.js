// ─────────────────────────────────────────────────────────────────────────────
// <ChipSelect/> — single- or multi-select grid of icon cards
// ─────────────────────────────────────────────────────────────────────────────
// One component for crops (multi), soil (single) and water source (single). Cards
// wrap into a measured N-column grid (no overflow), each pairing the app's farm
// artwork with a label. Selected = colour + border + check (never colour alone);
// selecting gives a subtle scale + selection haptic. Multi mode announces the
// running selected-count to screen readers.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, useReducedMotion,
} from 'react-native-reanimated';
import { Check } from 'lucide-react-native';
import OptionIcon from './OptionIcon';
import { useOnbTheme } from '../theme';
import { useT } from '../strings';
import { Haptics } from '../../../../utils/haptics';
import { SPRINGS } from '../../../../components/ui/motion';
import { s, vs } from '../../../../utils/responsive';

/**
 * @param {object} props
 * @param {'single'|'multi'} props.mode
 * @param {Array<{value:string,labelKey:string,icon:object}>} props.options
 * @param {string|string[]} props.value     string (single) | string[] (multi)
 * @param {(next:string|string[])=>void} props.onChange
 * @param {number} [props.columns=3]
 * @param {boolean} [props.showCount]        Multi only — render a live count line.
 */
export default function ChipSelect({ mode, options, value, onChange, columns = 3, showCount = false }) {
  const theme = useOnbTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [gridW, setGridW] = useState(0);
  const gap = s(theme.space.sm);
  const cardW = gridW > 0 ? (gridW - gap * (columns - 1)) / columns : 0;

  const selectedSet = mode === 'multi' ? new Set(Array.isArray(value) ? value : []) : null;
  const isSelected = (v) => (mode === 'multi' ? selectedSet.has(v) : value === v);

  const toggle = useCallback(
    (v) => {
      if (mode === 'multi') {
        const set = new Set(Array.isArray(value) ? value : []);
        set.has(v) ? set.delete(v) : set.add(v);
        onChange?.([...set]);
      } else {
        onChange?.(value === v ? '' : v); // tap-again clears (forgiving)
      }
    },
    [mode, value, onChange],
  );

  const count = mode === 'multi' ? (Array.isArray(value) ? value.length : 0) : 0;

  return (
    <View>
      {showCount && mode === 'multi' ? (
        <Text style={styles.count} accessibilityLiveRegion="polite">
          {t('onb.selectedCount', { count })}
        </Text>
      ) : null}

      <View
        style={[styles.grid, { gap }]}
        onLayout={(e) => setGridW(e.nativeEvent.layout.width)}
        accessibilityRole={mode === 'multi' ? 'list' : 'radiogroup'}
      >
        {options.map((opt) => (
          <Card
            key={opt.value}
            opt={opt}
            label={t(opt.labelKey)}
            selected={isSelected(opt.value)}
            mode={mode}
            width={cardW || undefined}
            onPress={() => toggle(opt.value)}
            theme={theme}
            styles={styles}
          />
        ))}
      </View>
    </View>
  );
}

function Card({ opt, label, selected, mode, width, onPress, theme, styles }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const press = useCallback(() => {
    if (!reduceMotion) {
      scale.value = withSpring(0.94, SPRINGS.snappy, () => { scale.value = withSpring(1, SPRINGS.snappy); });
    }
    Haptics.selection();
    onPress?.();
  }, [reduceMotion, scale, onPress]);

  return (
    <Animated.View style={[{ width }, animStyle]}>
      <Pressable
        onPress={press}
        style={[styles.card, selected && styles.cardSelected]}
        accessibilityRole={mode === 'multi' ? 'checkbox' : 'radio'}
        accessibilityState={{ checked: selected, selected }}
        accessibilityLabel={label}
      >
        {selected ? (
          <View style={styles.cardCheck}>
            <Check size={s(12)} color={theme.surface} strokeWidth={3} />
          </View>
        ) : null}
        <OptionIcon icon={opt.icon} size={s(40)} color={selected ? theme.primary : theme.textSecondary} />
        <Text
          style={[styles.cardLabel, selected && styles.cardLabelSelected]}
          numberOfLines={2}
          maxFontSizeMultiplier={1.4}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    count: { ...t.text.helper, color: t.textSecondary, marginBottom: vs(t.space.md) },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    card: {
      minHeight: vs(100),
      borderRadius: t.radius.lg,
      borderWidth: 1.5,
      borderColor: t.chipBorder,
      backgroundColor: t.chipBg,
      alignItems: 'center',
      justifyContent: 'center',
      gap: vs(t.space.sm),
      paddingHorizontal: s(t.space.xs),
      paddingVertical: vs(t.space.md),
    },
    cardSelected: { borderColor: t.chipSelectedBorder, backgroundColor: t.chipSelectedBg, borderWidth: 2 },
    cardCheck: {
      position: 'absolute', top: s(6), right: s(6),
      width: s(20), height: s(20), borderRadius: s(10),
      backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center',
    },
    cardLabel: { ...t.text.label, color: t.chipText, textAlign: 'center' },
    cardLabelSelected: { color: t.chipSelectedText },
  });
}

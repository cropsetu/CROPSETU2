// ─────────────────────────────────────────────────────────────────────────────
// <LanguageSelect/> — visual single-select of app languages
// ─────────────────────────────────────────────────────────────────────────────
// Each language is shown LARGE and in its OWN script (हिन्दी, ಕನ್ನಡ…) so the
// choice is legible regardless of literacy. Rows are full-width, ≥48dp, with a
// check + colour + border on the selected one (never colour alone). Selecting
// gives a subtle scale + selection haptic.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, useReducedMotion,
} from 'react-native-reanimated';
import { Check } from 'lucide-react-native';
import { useOnbTheme } from '../theme';
import { Haptics } from '../../../../utils/haptics';
import { SPRINGS } from '../../../../components/ui/motion';
import { LANGUAGES } from '../options';
import { s, vs } from '../../../../utils/responsive';

/**
 * @param {object} props
 * @param {string} props.value           Selected language code.
 * @param {(code:string)=>void} props.onChange
 * @param {Array} [props.languages]      Defaults to the app's language table.
 */
export default function LanguageSelect({ value, onChange, languages = LANGUAGES }) {
  const theme = useOnbTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View accessibilityRole="radiogroup" style={styles.list}>
      {languages.map((lang) => (
        <LanguageRow
          key={lang.code}
          lang={lang}
          selected={value === lang.code}
          onSelect={onChange}
          theme={theme}
          styles={styles}
        />
      ))}
    </View>
  );
}

function LanguageRow({ lang, selected, onSelect, theme, styles }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const press = useCallback(() => {
    if (!reduceMotion) {
      scale.value = withSpring(0.97, SPRINGS.snappy, () => { scale.value = withSpring(1, SPRINGS.snappy); });
    }
    Haptics.selection();
    onSelect?.(lang.code);
  }, [reduceMotion, scale, onSelect, lang.code]);

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPress={press}
        style={[styles.row, selected && styles.rowSelected]}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${lang.nativeName}, ${lang.name}`}
      >
        <Text style={styles.flag} allowFontScaling={false}>{lang.flag}</Text>
        <View style={styles.texts}>
          <Text style={[styles.native, selected && styles.nativeSelected]} maxFontSizeMultiplier={1.5}>
            {lang.nativeName}
          </Text>
          <Text style={styles.meta} maxFontSizeMultiplier={1.4} numberOfLines={1}>
            {lang.name}{lang.region ? ` · ${lang.region}` : ''}
          </Text>
        </View>
        <View style={[styles.check, selected && styles.checkSelected]}>
          {selected ? <Check size={s(16)} color={theme.surface} strokeWidth={3} /> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    list: { gap: vs(t.space.sm) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(t.space.md),
      minHeight: Math.max(vs(64), t.tap + 16),
      paddingHorizontal: s(t.space.base),
      paddingVertical: vs(t.space.md),
      borderRadius: t.radius.lg,
      borderWidth: 1.5,
      borderColor: t.chipBorder,
      backgroundColor: t.chipBg,
    },
    rowSelected: { borderColor: t.chipSelectedBorder, backgroundColor: t.chipSelectedBg, borderWidth: 2 },
    flag: { fontSize: s(24) },
    texts: { flex: 1 },
    native: { ...t.text.bodyStrong, color: t.textPrimary, fontSize: s(18) },
    nativeSelected: { color: t.chipSelectedText },
    meta: { ...t.text.helper, color: t.textTertiary, marginTop: 2 },
    check: {
      width: s(26), height: s(26), borderRadius: s(13),
      borderWidth: 1.5, borderColor: t.border,
      alignItems: 'center', justifyContent: 'center',
    },
    checkSelected: { backgroundColor: t.primary, borderColor: t.primary },
  });
}

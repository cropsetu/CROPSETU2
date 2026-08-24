/**
 * Screen / AppHeader / ActionBar — page chrome.
 *
 * THE HEADER IS PARCHMENT, NOT A COLOURED BAR.
 * -------------------------------------------
 * Every screen used to open with the same saturated orange slab, which is the
 * single most generic move an app can make and left nothing to distinguish one
 * screen from another. The header is now the page: same parchment ground, a
 * Fraunces title, and one hairline rule to separate it from the content. The
 * brand orange is spent where it earns attention instead — the earnings panel,
 * the primary action, the live indicator — and never on decoration.
 *
 * Structurally this still replaces `SafeAreaView` from react-native, which the
 * screens all used and which:
 *   - is a no-op on Android (so content sat under the status bar and the
 *     gesture pill on every Android device)
 *   - can't be told which edges to inset, so a screen with a bottom action bar
 *     got double padding
 *
 * Screen also owns the offline banner and the wide-viewport clamp, so neither
 * has to be remembered per-screen.
 */
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import { C, HIT, R, SP, T, alpha, useResponsive } from '../../theme';
import { useNetwork } from '../../hooks/useNetwork';
import { IconButton } from './Button';

/**
 * Slim, non-blocking banner shown whenever the API is unreachable. Amber fill
 * with amber ink — it has to survive being read in sunlight, so it is a solid
 * tint rather than a tinted-transparent overlay whose contrast depends on
 * whatever it happens to be sitting on.
 */
export function OfflineBanner() {
  const { isOffline } = useNetwork();
  const { t } = useLanguage();
  if (!isOffline) return null;
  return (
    <View style={s.offline} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="cloud-offline" size={15} color={C.warning} />
      <Text style={s.offlineTxt} numberOfLines={2}>
        {t('common.offlineBanner', 'No internet connection. Showing the last saved data.')}
      </Text>
    </View>
  );
}

export default function Screen({
  children,
  style,
  contentStyle,
  /** Which edges to inset. Screens with a stack header pass ['bottom']. */
  edges = ['top', 'bottom', 'left', 'right'],
  background = C.bg,
  /** Clamp content width and centre it on tablets / desktop web. */
  constrain = false,
  showOfflineBanner = true,
  testID,
}) {
  const { contentMaxWidth } = useResponsive();

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: background }, style]} edges={edges} testID={testID}>
      {showOfflineBanner ? <OfflineBanner /> : null}
      <View
        style={[
          s.content,
          constrain && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' },
          contentStyle,
        ]}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

/**
 * AppHeader — the custom header used by screens that opt out of the stack
 * header. Title is Fraunces and allowed to run to two lines when a screen's
 * subject is a long disease or product name; the back control is a bordered
 * paper square so it reads as a control rather than as a glyph floating in
 * space, and it is 44dp before hitSlop.
 */
export function AppHeader({
  title,
  subtitle,
  onBack,
  right,
  /** Kept for API compatibility; the header ground is parchment by design. */
  gradientColors,
  style,
  titleNumberOfLines = 1,
}) {
  const { t } = useLanguage();
  return (
    <View style={[s.header, style]}>
      <View style={s.headerRow}>
        {onBack ? (
          <IconButton
            icon="arrow-back"
            size={20}
            color={C.text}
            background={C.surface}
            onPress={onBack}
            accessibilityLabel={t('back', 'Back')}
            buttonStyle={s.backBtn}
          />
        ) : null}
        <View style={s.headerText}>
          <Text
            style={s.headerTitle}
            numberOfLines={titleNumberOfLines}
            accessibilityRole="header"
          >
            {title}
          </Text>
          {subtitle ? <Text style={s.headerSub} numberOfLines={2}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </View>
  );
}

/**
 * Sticky bottom action bar (form save buttons) with correct safe-area inset.
 * The shadow points *up* — it is lifting off the content it covers, and a
 * downward shadow here reads as a rendering mistake.
 */
export function ActionBar({ children, style }) {
  return (
    <SafeAreaView edges={['bottom']} style={[s.actionBar, style]}>
      <View style={s.actionBarInner}>{children}</View>
    </SafeAreaView>
  );
}

/**
 * Ledger rule — the app's one decorative line. A short saturated segment
 * followed by a long faint one, which is what makes it read as a ruled ledger
 * rather than as a generic divider.
 */
export function Rule({ style, tone = C.brand }) {
  return (
    <View style={[s.rule, style]} importantForAccessibility="no" accessibilityElementsHidden>
      <View style={[s.ruleLead, { backgroundColor: tone }]} />
      <View style={s.ruleTail} />
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1 },

  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: SP.xl,
    paddingVertical: SP.sm,
    backgroundColor: C.warningPale,
    borderBottomWidth: 1,
    borderBottomColor: alpha(C.warning, 0.28),
  },
  offlineTxt: { ...T.captionBold, flex: 1, color: C.warning },

  header: {
    backgroundColor: C.bg,
    paddingHorizontal: SP.xl,
    paddingTop: SP.md,
    paddingBottom: SP.lg,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    minHeight: HIT.min,
  },
  backBtn: {
    width: HIT.minCompact,
    height: HIT.minCompact,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
  },
  headerText: { flex: 1 },
  headerTitle: { ...T.heading, color: C.text },
  headerSub: { ...T.caption, color: C.textMuted, marginTop: 2 },

  actionBar: {
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
    shadowColor: C.shadowTint,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.09,
    shadowRadius: 22,
    // Android draws elevation shadows downward only; the top border carries
    // the separation there.
    elevation: Platform.OS === 'android' ? 0 : 8,
  },
  actionBarInner: {
    paddingHorizontal: SP.xl,
    paddingTop: SP.md,
    paddingBottom: SP.md,
    minHeight: HIT.min + SP.xl,
    justifyContent: 'center',
  },

  rule: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, height: 3 },
  ruleLead: { width: 28, height: 3, borderRadius: R.pill },
  ruleTail: { flex: 1, height: 1, backgroundColor: C.border },
});

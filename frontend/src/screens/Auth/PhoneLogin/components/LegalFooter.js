// ─────────────────────────────────────────────────────────────────────────────
// <LegalFooter/> — the shared low-emphasis consent line (+ optional guest link)
// ─────────────────────────────────────────────────────────────────────────────
// Rendered over the hero gradient (so it uses `onHero` / `onHeroDim` colours) on
// both the Landing welcome screen and the Phone-entry step, keeping the consent
// wording and the "Continue as guest" affordance pixel-identical between them.
//
// Pass `onGuest` to include the guest link; omit it for just the legal line.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo } from 'react';
import { Text, Pressable, StyleSheet } from 'react-native';
import { UserRound } from 'lucide-react-native';
import { useAuthTheme } from '../theme';
import { useT } from '../strings';
import { s, vs } from '../../../../utils/responsive';

/**
 * @param {object} props
 * @param {() => void} [props.onTerms]
 * @param {() => void} [props.onPrivacy]
 * @param {() => void} [props.onGuest]   Provided → renders the guest link.
 */
export default function LegalFooter({ onTerms, onPrivacy, onGuest }) {
  const theme = useAuthTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <>
      <Text style={styles.legal}>
        {t('auth.legalPrefix')}{' '}
        <Text style={styles.legalLink} onPress={onTerms} accessibilityRole="link">
          {t('auth.terms')}
        </Text>{' '}
        {t('auth.and')}{' '}
        <Text style={styles.legalLink} onPress={onPrivacy} accessibilityRole="link">
          {t('auth.privacy')}
        </Text>
      </Text>

      {onGuest ? (
        <Pressable
          onPress={onGuest}
          style={styles.guestBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('auth.guest')}
        >
          <UserRound size={s(14)} color={styles.guestText.color} strokeWidth={2.25} />
          <Text style={styles.guestText}>{t('auth.guest')}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    legal: { ...t.text.caption, color: t.onHeroDim, textAlign: 'center', lineHeight: 18, maxWidth: s(320) },
    legalLink: { color: t.onHero, fontFamily: t.font.bold, textDecorationLine: 'underline' },
    guestBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(t.space.xs),
      marginTop: vs(t.space.base),
      paddingVertical: vs(t.space.sm),
      paddingHorizontal: s(t.space.base),
      minHeight: t.tap,
    },
    guestText: { ...t.text.label, color: t.onHeroDim, textDecorationLine: 'underline' },
  });
}

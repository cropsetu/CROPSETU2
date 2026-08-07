/**
 * States — the four things every data screen must be able to say.
 *
 * Before this, all four collapsed into one: a bare spinner while loading, and
 * on failure an empty array that rendered "No orders yet". A seller with a dead
 * connection was told, confidently and wrongly, that they had no business.
 *
 *   Skeleton    — structural placeholder during first load
 *   ErrorState  — something failed; distinguishes offline from server error,
 *                 and always offers a retry
 *   EmptyState  — genuinely nothing here (with a next action where one exists)
 *   ListFooter  — paging spinner, "load more failed → retry", end-of-list
 *
 * VISUAL NOTE: the empty/error figure is a "plate" — a soft parchment disc with
 * a ring, not a coloured circle. It is deliberately quiet. These states appear
 * when something has gone wrong or when a seller is new, and neither moment is
 * improved by a saturated graphic shouting at them. The one loud element is the
 * retry button, because that is the only thing to do here.
 */
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import { C, E, R, SP, T, alpha } from '../../theme';
import { useReducedMotion } from '../../hooks/useMotion';
import Button from './Button';

// ── Skeleton ─────────────────────────────────────────────────────────────────

/**
 * Shimmering placeholder block. Under Reduce Motion the shimmer is replaced by
 * a static tint — a pulsing rectangle is exactly the kind of motion that
 * setting exists to suppress.
 */
export function Skeleton({ width = '100%', height = 14, radius = R.sm, style }) {
  const reduced = useReducedMotion();
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 850, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 850, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, shimmer]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius, backgroundColor: C.surfaceSunken },
        !reduced && { opacity: shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
        style,
      ]}
    />
  );
}

/** Card-shaped skeleton used by the product / order / report lists. */
export function SkeletonCard({ lines = 3, thumb = true, style }) {
  return (
    <View style={[st.skelCard, style]}>
      <View style={st.skelRow}>
        {thumb ? <Skeleton width={72} height={72} radius={R.lg} /> : null}
        <View style={{ flex: 1, gap: SP.sm }}>
          <Skeleton width="70%" height={16} />
          {Array.from({ length: Math.max(0, lines - 1) }).map((_, i) => (
            <Skeleton key={i} width={i === lines - 2 ? '40%' : '90%'} height={11} />
          ))}
        </View>
      </View>
    </View>
  );
}

/** A whole list's worth of skeleton cards. */
export function SkeletonList({ count = 4, ...cardProps }) {
  return (
    <View
      style={st.skelList}
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} {...cardProps} />
      ))}
    </View>
  );
}

// ── Loading ──────────────────────────────────────────────────────────────────

export function LoadingState({ label, style }) {
  const { t } = useLanguage();
  return (
    <View
      style={[st.center, style]}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      accessibilityLabel={label || t('loading', 'Loading')}
    >
      <ActivityIndicator size="large" color={C.brand} />
      {label ? <Text style={st.loadingTxt}>{label}</Text> : null}
    </View>
  );
}

// ── Plate ────────────────────────────────────────────────────────────────────

/** The shared figure frame behind an empty/error glyph or illustration. */
function Plate({ tint = C.brand, compact, children }) {
  return (
    <View
      style={[
        st.plate,
        compact && st.plateCompact,
        { borderColor: alpha(tint, 0.22), backgroundColor: alpha(tint, 0.07) },
      ]}
      importantForAccessibility="no"
      accessibilityElementsHidden
    >
      {children}
    </View>
  );
}

// ── Error ────────────────────────────────────────────────────────────────────

/**
 * @param error  { message, isOffline, status } from useAsyncData / usePagedList
 */
export function ErrorState({ error, onRetry, compact = false, style }) {
  const { t } = useLanguage();
  if (!error) return null;

  const offline = error.isOffline;
  const forbidden = error.status === 403;

  const icon = offline ? 'cloud-offline' : forbidden ? 'lock-closed' : 'alert-circle';
  const tint = offline ? C.warning : C.danger;

  const title = offline
    ? t('common.offlineTitle', 'You are offline')
    : forbidden
      ? t('common.noAccessTitle', 'Access denied')
      : t('common.errorTitle', 'Something went wrong');

  const body = error.message || t('common.errorBody', 'Please try again in a moment.');

  return (
    <View style={[compact ? st.centerCompact : st.center, style]} accessibilityRole="alert">
      <Plate tint={tint} compact={compact}>
        <Ionicons name={icon} size={compact ? 24 : 32} color={tint} />
      </Plate>
      <Text style={st.stateTitle}>{title}</Text>
      <Text style={st.stateBody}>{body}</Text>
      {/* A 403 won't resolve by retrying — offering the button would just lie. */}
      {onRetry && !forbidden ? (
        <Button
          label={t('retry', 'Retry')}
          icon="refresh"
          variant="secondary"
          size="md"
          onPress={onRetry}
          style={{ marginTop: SP.xl }}
        />
      ) : null}
    </View>
  );
}

// ── Empty ────────────────────────────────────────────────────────────────────

export function EmptyState({
  icon = 'file-tray-outline',
  illustration,
  title,
  body,
  actionLabel,
  onAction,
  compact = false,
  style,
}) {
  return (
    <View style={[compact ? st.centerCompact : st.center, style]}>
      <Plate compact={compact}>
        {illustration || <Ionicons name={icon} size={compact ? 24 : 32} color={C.brandInk} />}
      </Plate>
      {title ? <Text style={st.stateTitle}>{title}</Text> : null}
      {body ? <Text style={st.stateBody}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          onPress={onAction}
          size="md"
          style={{ marginTop: SP.xl }}
        />
      ) : null}
    </View>
  );
}

// ── List footer ──────────────────────────────────────────────────────────────

export function ListFooter({ loading, error, onRetry, hasMore, itemCount = 0 }) {
  const { t } = useLanguage();

  if (loading) {
    return (
      <View style={st.footer} accessibilityRole="progressbar" accessibilityState={{ busy: true }}>
        <ActivityIndicator color={C.brand} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={st.footer}>
        <Text style={st.footerErr}>
          {error.message || t('common.loadMoreFailed', 'Could not load more.')}
        </Text>
        <Button label={t('retry', 'Retry')} variant="ghost" size="sm" onPress={onRetry} />
      </View>
    );
  }

  // Only worth saying once the list is long enough that the user wondered.
  // Set as a ruled end-mark rather than a floating sentence, so it reads as the
  // bottom of a page rather than as another row.
  if (!hasMore && itemCount > 8) {
    return (
      <View style={st.footerEndWrap}>
        <View style={st.footerEndRule} />
        <Text style={st.footerEnd}>{t('common.endOfList', "That's everything")}</Text>
        <View style={st.footerEndRule} />
      </View>
    );
  }

  return <View style={{ height: SP.lg }} />;
}

// ── Inline banner ────────────────────────────────────────────────────────────

/** Non-blocking notice inside a form or card (validation summary, hints). */
export function InlineNotice({ variant = 'info', icon, children, style }) {
  const tone =
    variant === 'error' ? { ink: C.danger, fill: C.dangerPale } :
    variant === 'warning' ? { ink: C.warning, fill: C.warningPale } :
    variant === 'success' ? { ink: C.success, fill: C.successPale } :
    { ink: C.info, fill: C.infoPale };

  const glyph = icon || (
    variant === 'error' ? 'alert-circle' :
    variant === 'warning' ? 'warning' :
    variant === 'success' ? 'checkmark-circle' : 'information-circle'
  );

  return (
    <View
      style={[
        st.notice,
        { backgroundColor: tone.fill, borderColor: alpha(tone.ink, 0.25) },
        style,
      ]}
      accessibilityRole={variant === 'error' ? 'alert' : 'text'}
      accessibilityLiveRegion={variant === 'error' ? 'polite' : 'none'}
    >
      <Ionicons name={glyph} size={17} color={tone.ink} style={{ marginTop: 1 }} />
      <Text style={[st.noticeTxt, { color: tone.ink }]}>{children}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.xxl,
    paddingVertical: SP.huge,
    gap: SP.sm,
  },
  centerCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.xl,
    paddingVertical: SP.xxl,
    gap: SP.xs,
  },
  plate: {
    width: 92, height: 92, borderRadius: 46,
    borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: SP.lg,
  },
  plateCompact: { width: 64, height: 64, borderRadius: 32, marginBottom: SP.md },

  stateTitle: { ...T.heading, color: C.text, textAlign: 'center' },
  stateBody: { ...T.body, color: C.textMuted, textAlign: 'center', maxWidth: 340 },
  loadingTxt: { ...T.body, color: C.textMuted, marginTop: SP.md },

  skelList: { padding: SP.xl, gap: SP.md },
  skelCard: {
    backgroundColor: C.surface,
    borderRadius: R.xl,
    borderWidth: 1,
    borderColor: C.border,
    padding: SP.xl,
    marginBottom: SP.md,
    ...E.card,
  },
  skelRow: { flexDirection: 'row', gap: SP.lg, alignItems: 'center' },

  footer: { paddingVertical: SP.xl, alignItems: 'center', gap: SP.sm },
  footerErr: { ...T.caption, color: C.textMuted, textAlign: 'center' },
  footerEndWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    paddingVertical: SP.xxl,
    paddingHorizontal: SP.lg,
  },
  footerEndRule: { flex: 1, height: 1, backgroundColor: C.border },
  footerEnd: { ...T.micro, color: C.textFaint, textTransform: 'uppercase' },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.md,
    padding: SP.lg,
    borderRadius: R.lg,
    borderWidth: 1,
  },
  noticeTxt: { ...T.caption, flex: 1, lineHeight: 18 },
});

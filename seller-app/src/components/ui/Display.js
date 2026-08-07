/**
 * Display primitives — the small presentational pieces every seller screen
 * repeated by hand: cards, status pills, avatars, progress bars, section
 * headings, key/value rows, the order lifecycle indicator.
 *
 * Consolidating them is what makes the app look like one product: a status
 * badge is now the same height, radius, family and colour wherever it appears,
 * instead of three near-miss variants across Dashboard, Orders and Inbox.
 *
 * TWO RULES THIS FILE ENFORCES FOR EVERY CONSUMER
 * -----------------------------------------------
 * 1. A card is paper: 24px corners, a warm hairline that does the edge
 *    definition, and a wide low-opacity brown shadow that does only the lift.
 *    No component here uses a grey `shadowOpacity` box.
 * 2. Status is never colour alone. `StatusPill`, `Badge` and `StatusSteps` all
 *    render an icon and/or a text label alongside the hue, because red/green
 *    and amber/green are the two pairs that vanish for ~8% of men.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  C, E, F, R, SP, T, alpha, initialsOf, orderStatusLabel, orderStatusMeta,
} from '../../theme';

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({ children, style, padded = true, accent, elevation = 'card', ...rest }) {
  return (
    <View
      // `rest` carries through accessibility props — a card that summarises a
      // record usually wants to be one announcement, not a pile of fragments.
      {...rest}
      style={[
        cs.card,
        E[elevation] || E.card,
        padded && { padding: SP.xl },
        style,
      ]}
    >
      {/* The accent is a floating rail rather than a `borderLeftWidth`, which
          at a 24px corner radius smears into a wedge at both ends. */}
      {accent ? (
        <View
          style={[cs.rail, { backgroundColor: accent }]}
          importantForAccessibility="no"
          accessibilityElementsHidden
        />
      ) : null}
      {children}
    </View>
  );
}

// ── Section heading ──────────────────────────────────────────────────────────

/**
 * Editorial eyebrow: a tracked, uppercase label followed by a rule that runs
 * to the action on the right. The rule is what makes a stack of sections read
 * as a printed page rather than as a list of bold sentences.
 */
export function SectionTitle({ children, action, style }) {
  return (
    <View style={[cs.sectionRow, style]}>
      <Text style={cs.sectionTitle} accessibilityRole="header">{children}</Text>
      <View style={cs.sectionRule} importantForAccessibility="no" accessibilityElementsHidden />
      {action}
    </View>
  );
}

// ── Status pill ──────────────────────────────────────────────────────────────

/**
 * Order status badge. Takes `t` so the label is localised — the previous
 * versions printed the raw enum ("SHIPPED") to users reading Marathi or Tamil.
 * The fill is a solid tint from the theme, not `alpha(colour)`, so its contrast
 * doesn't change with whatever surface it lands on.
 */
export function StatusPill({ status, t, size = 'md', showIcon = true, style }) {
  const meta = orderStatusMeta(status);
  const label = t ? orderStatusLabel(status, t) : (status || meta.fallback);
  const compact = size === 'sm';

  return (
    <View
      style={[
        cs.pill,
        compact && cs.pillCompact,
        { backgroundColor: meta.tint, borderColor: alpha(meta.color, 0.25) },
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Status: ${label}`}
    >
      {showIcon ? <Ionicons name={meta.icon} size={compact ? 11 : 13} color={meta.color} /> : null}
      <Text style={[cs.pillTxt, compact && cs.pillTxtCompact, { color: meta.color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Generic badge (verified / exempt / new / counts). */
export function Badge({ label, color = C.brandInk, filled = false, icon, style }) {
  return (
    <View
      style={[
        cs.badge,
        filled
          ? { backgroundColor: color, borderColor: color }
          : { backgroundColor: alpha(color, 0.1), borderColor: alpha(color, 0.3) },
        style,
      ]}
      accessibilityRole="text"
    >
      {icon ? <Ionicons name={icon} size={11} color={filled ? C.onBrand : color} /> : null}
      <Text style={[cs.badgeTxt, { color: filled ? C.onBrand : color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Unread-count bubble; clamps at 99+ so the layout can't be blown out. */
export function CountBadge({ count, color = C.dangerBold, textColor = C.onBrand, style }) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  return (
    <View
      style={[cs.countBadge, { backgroundColor: color }, style]}
      accessibilityRole="text"
      accessibilityLabel={`${n} unread`}
    >
      <Text style={[cs.countTxt, { color: textColor }]}>{n > 99 ? '99+' : n}</Text>
    </View>
  );
}

// ── Avatar ───────────────────────────────────────────────────────────────────

/**
 * Initials in Fraunces on a soft ember disc. It sits on parchment now rather
 * than on a coloured header, so the default is a tinted fill with a real
 * border instead of the old white-on-white-alpha, which was invisible the
 * moment the header behind it changed.
 */
export function Avatar({ name, size = 48, background = C.brandSoft, textColor = C.brandInk, style }) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background,
          borderWidth: 1.5,
          borderColor: alpha(C.brand, 0.28),
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
      accessibilityRole="image"
      accessibilityLabel={name ? `Profile: ${name}` : 'Profile'}
    >
      <Text style={{ fontFamily: F.serif700, fontSize: size * 0.36, color: textColor }}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

// ── Progress ─────────────────────────────────────────────────────────────────

export function ProgressBar({ value = 0, color = C.brand, height = 10, label, style }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <View
      style={[cs.progressTrack, { height, borderRadius: height / 2 }, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
    >
      <View
        style={{
          width: `${pct}%`,
          height,
          borderRadius: height / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

// ── Order lifecycle ──────────────────────────────────────────────────────────

/**
 * StatusSteps — Pending → Confirmed → Shipped → Delivered, as four connected
 * segments with the reached ones filled. Answers "where is this order?" at a
 * glance, which a single pill cannot: a pill tells you the state, this tells
 * you the state *and* how much of the journey is left.
 *
 * Terminal states (cancelled, refunded) have no position in the flow, so the
 * whole strip is suppressed rather than shown as a misleading empty track.
 */
export function StatusSteps({ status, t, style }) {
  const meta = orderStatusMeta(status);
  if (meta.step < 0) return null;

  const steps = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED'];
  const label = orderStatusLabel(status, t);

  return (
    <View
      style={[cs.steps, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: steps.length, now: meta.step + 1 }}
    >
      {steps.map((key, i) => {
        const reached = i <= meta.step;
        const current = i === meta.step;
        return (
          <View key={key} style={cs.stepCell}>
            <View
              style={[
                cs.stepBar,
                { backgroundColor: reached ? meta.color : C.surfaceSunken },
                current && cs.stepBarCurrent,
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

// ── Key/value row ────────────────────────────────────────────────────────────

export function KeyValue({ label, value, valueColor = C.text, style }) {
  return (
    <View style={[cs.kv, style]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={cs.kvLabel} numberOfLines={1}>{label}</Text>
      <Text style={[cs.kvValue, { color: valueColor }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/**
 * Three-up stat strip used inside order cards — a sunken well ruled into
 * columns, with the figures set in Fraunces. This is the "ledger" motif the
 * whole design leans on: numbers get the serif, words get the sans.
 */
export function MetricRow({ items, style }) {
  return (
    <View style={[cs.metricRow, style]}>
      {items.map((item, i) => (
        <React.Fragment key={item.label}>
          {i > 0 ? <View style={cs.metricDivider} /> : null}
          <View style={cs.metricItem} accessible accessibilityLabel={`${item.label}: ${item.value}`}>
            <Text style={cs.metricLabel} numberOfLines={1}>{item.label}</Text>
            {/* Three Fraunces figures across a 360px card is the tightest the
                app gets; shrinking beats clipping a rupee amount. */}
            <Text
              style={[cs.metricValue, item.color && { color: item.color }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {item.value}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const cs = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: R.xl,
    borderWidth: 1,
    borderColor: C.border,
    // Deliberately NOT `overflow: hidden`: on iOS that sets masksToBounds and
    // clips the card's own shadow away. Children that need clipping round
    // their own corners instead.
  },
  rail: {
    position: 'absolute',
    left: 0,
    top: SP.lg,
    bottom: SP.lg,
    width: 3,
    borderTopRightRadius: R.pill,
    borderBottomRightRadius: R.pill,
  },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SP.xxxl,
    marginBottom: SP.lg,
    gap: SP.md,
  },
  sectionTitle: { ...T.section, color: C.textMuted, textTransform: 'uppercase' },
  sectionRule: { flex: 1, height: 1, backgroundColor: C.border },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    borderRadius: R.pill,
    borderWidth: 1,
    paddingHorizontal: SP.md,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  pillCompact: { paddingHorizontal: SP.sm, paddingVertical: 3 },
  pillTxt: { ...T.micro, textTransform: 'uppercase' },
  pillTxtCompact: { fontSize: 10, letterSpacing: 0.4 },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    paddingHorizontal: SP.md,
    paddingVertical: 4,
    borderRadius: R.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeTxt: { ...T.micro, textTransform: 'uppercase' },

  countBadge: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 8,
    borderRadius: R.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countTxt: { ...T.micro, letterSpacing: 0 },

  progressTrack: { backgroundColor: C.surfaceSunken, overflow: 'hidden', width: '100%' },

  steps: { flexDirection: 'row', gap: SP.xs, width: '100%' },
  stepCell: { flex: 1 },
  stepBar: { height: 5, borderRadius: R.pill },
  // The active segment is taller as well as filled, so the current position is
  // legible without relying on the hue difference.
  stepBarCurrent: { height: 7, marginTop: -1 },

  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SP.md,
    paddingVertical: SP.xs,
  },
  kvLabel: { ...T.caption, color: C.textMuted, flexShrink: 1 },
  kvValue: { ...T.bodyBold, flexShrink: 1, textAlign: 'right' },

  metricRow: {
    flexDirection: 'row',
    backgroundColor: C.bg,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: SP.md,
  },
  metricItem: { flex: 1, alignItems: 'center', paddingHorizontal: SP.xs, gap: SP.xs },
  metricLabel: { ...T.micro, color: C.textMuted, textTransform: 'uppercase' },
  metricValue: { ...T.figureSm, color: C.text },
  metricDivider: { width: 1, backgroundColor: C.border },
});

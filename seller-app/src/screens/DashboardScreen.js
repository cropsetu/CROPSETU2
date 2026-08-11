/**
 * DashboardScreen — the seller's home.
 *
 * Business logic is unchanged: same three endpoints, same shapes, same routes.
 *
 * THE COMPOSITION
 * ---------------
 * The old screen opened with a full-bleed orange gradient bar and then dropped
 * into three identical white stat cards — the arrangement every admin template
 * ships with. This one is built around a single idea: **the ledger**.
 *
 *   1. A parchment hero. Greeting, shop name in Fraunces, a ruled line. No
 *      colour block. The page starts as paper.
 *   2. One deep-ember panel — the only saturated surface on the screen — that
 *      holds the money. Revenue is set enormous in Fraunces Black; units sold
 *      and listings sit beside it behind a hairline, the way figures sit in
 *      the columns of an account book. It reflows from stacked to a 3-column
 *      row via `useResponsive().statColumns`.
 *   3. Everything below is paper again: the report inbox, a quick-action grid,
 *      and recent orders as ruled rows inside one card rather than as five
 *      floating cards with five shadows.
 *
 * Concentrating the orange in the earnings panel is what makes it read as a
 * seller's app rather than as a generic dashboard: the brand colour marks the
 * thing the seller opened the app to see.
 *
 * WHAT THE BEHAVIOUR STILL GUARANTEES
 *   - The three requests used to be one `Promise.all` inside a try/catch that
 *     did `console.warn`. One failing endpoint blanked the other two, and the
 *     screen then rendered zeros as if they were real numbers. Each panel now
 *     loads and fails independently, and a failed panel says so.
 *   - The "live" dot ran an unbounded `Animated.loop` that kept ticking while
 *     the app was backgrounded. It stops on blur and under Reduce Motion.
 *   - The counters drove a JS-thread setState on every frame for 1.4s × 3.
 *   - The shared SVG icons self-animate; they are handed `animated={false}`
 *     whenever the screen is blurred or Reduce Motion is on, so nothing on
 *     this screen is running a loop the user cannot see.
 */
import React, { useCallback, useMemo } from 'react';
import { Animated, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useAuth } from '@cropsetu/shared/context/AuthContext';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import api from '@cropsetu/shared/services/api';
import DashboardStatIcon from '@cropsetu/shared/components/DashboardStatIcons';

import { C, E, GRAD, HIT, R, SP, T, alpha, formatCurrency, useResponsive } from '../theme';
import { useCountUp, usePulse, useEntrance, useReducedMotion } from '../hooks/useMotion';
import useAsyncData from '../hooks/useAsyncData';
import {
  Screen, Card, SectionTitle, Avatar, StatusPill, CountBadge, Rule,
  Button, PressableRow, EmptyState, ErrorState, Skeleton, SkeletonCard,
  useConfirm,
} from '../components/ui';

// ── Ledger cell ──────────────────────────────────────────────────────────────

/**
 * One figure in the earnings panel. `primary` is the revenue: same component,
 * one step up the type scale, so the hierarchy is a size relationship rather
 * than two separately-styled components that can drift apart.
 *
 * `grow` is passed rather than derived, because a cell is only allowed a flex
 * factor when its parent is a ROW. `flex: n` sets flexBasis to 0, and a
 * zero-basis child of an auto-height column collapses to zero height in Yoga —
 * which is exactly how the stacked (phone) layout would silently vanish.
 */
function LedgerCell({ label, value, sub, isCurrency, primary, loading, index, grow = 0 }) {
  const entrance = useEntrance({ index, distance: 10 });
  const animated = useCountUp(value ?? 0);
  const display = isCurrency
    ? formatCurrency(animated)
    : Math.round(animated).toLocaleString('en-IN');

  const box = [d.cell, grow > 0 && { flex: grow, minWidth: 0 }];

  if (loading) {
    return (
      <View style={box}>
        <Skeleton width={primary ? 96 : 64} height={11} style={d.skelOnEmber} />
        <Skeleton width={primary ? '78%' : '86%'} height={primary ? 34 : 24} style={d.skelOnEmber} />
      </View>
    );
  }

  return (
    <Animated.View
      style={[...box, entrance]}
      accessible
      accessibilityLabel={`${label}: ${display}${sub ? `. ${sub}` : ''}`}
    >
      <Text style={d.cellLabel} numberOfLines={1}>{label}</Text>
      <Text
        style={primary ? d.cellFigureLg : d.cellFigure}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {display}
      </Text>
      {sub ? <Text style={d.cellSub} numberOfLines={1}>{sub}</Text> : null}
    </Animated.View>
  );
}

// ── Quick action ─────────────────────────────────────────────────────────────

function QuickAction({ icon, label, onPress, index, width, animated }) {
  const entrance = useEntrance({ index, distance: 12, stagger: 40 });
  return (
    <PressableRow
      onPress={onPress}
      accessibilityLabel={label}
      style={[d.quickAction, { width }]}
    >
      <Animated.View style={[d.quickInner, entrance]}>
        <View style={d.qaIcon}>
          <DashboardStatIcon type={icon} size={38} animated={animated} />
        </View>
        <Text style={d.qaLabel} numberOfLines={2}>{label}</Text>
      </Animated.View>
    </PressableRow>
  );
}

// ── Recent order row ─────────────────────────────────────────────────────────

const OrderRow = React.memo(function OrderRow({ item, index, t, last }) {
  const entrance = useEntrance({ index, distance: 12, stagger: 45 });
  const buyer = item.order?.user?.name?.trim();
  const phone = item.order?.user?.phone;
  const qty = t('dash.qty', { n: item.quantity, unit: item.product?.unit || '' });
  const amount = formatCurrency(item.totalPrice);
  const name = item.product?.name || t('common.untitled', 'Untitled product');

  return (
    <Animated.View
      style={[d.orderRow, !last && d.orderRowRuled, entrance]}
      accessible
      accessibilityLabel={`${name}. ${qty}. ${amount}.`}
    >
      <View style={d.orderMain}>
        <Text style={d.orderProduct} numberOfLines={1}>{name}</Text>
        <Text style={d.orderBuyer} numberOfLines={1}>
          {[buyer, phone ? `+91 ${phone}` : null].filter(Boolean).join(' · ') || '—'}
        </Text>
        <Text style={d.orderQty} numberOfLines={1}>{qty}</Text>
      </View>
      <View style={d.orderSide}>
        <Text style={d.orderAmt} numberOfLines={1}>{amount}</Text>
        <StatusPill status={item.order?.status} t={t} size="sm" />
      </View>
    </Animated.View>
  );
});

// ── Screen ───────────────────────────────────────────────────────────────────

export default function DashboardScreen({ navigation }) {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const confirm = useConfirm();
  const { quickActionColumns, statColumns, gutter, isExpanded, contentMaxWidth } = useResponsive();

  const isFocused = useIsFocused();
  const reducedMotion = useReducedMotion();
  // The shared SVG icons run their own `Animated.loop`. Off-screen or under
  // Reduce Motion they must not.
  const iconsAnimated = isFocused && !reducedMotion;

  const livePulse = usePulse({ from: 1, to: 2.2, duration: 1200 });

  // Each panel owns its own request. A failing inbox count no longer wipes the
  // revenue figure — the old Promise.all rejected the whole batch.
  const stats = useAsyncData(
    useCallback(({ signal }) => api.get('/agristore/seller/stats', { signal }).then((r) => r.data.data), []),
    [],
    { errorFallback: t('dash.statsError', 'Could not load your performance figures.') },
  );

  const orders = useAsyncData(
    useCallback(
      ({ signal }) => api.get('/agristore/seller/orders?limit=5', { signal }).then((r) => r.data.data || []),
      [],
    ),
    [],
    { initialData: [], errorFallback: t('dash.ordersError', 'Could not load recent orders.') },
  );

  const inbox = useAsyncData(
    useCallback(
      ({ signal }) => api.get('/crop-reports/seller/inbox?limit=1', { signal })
        .then((r) => r.data?.meta?.unread || 0),
      [],
    ),
    [],
    { initialData: 0 },
  );

  const refreshing = stats.refreshing || orders.refreshing || inbox.refreshing;

  const onRefresh = useCallback(() => {
    stats.refresh();
    orders.refresh();
    inbox.refresh();
  }, [stats, orders, inbox]);

  const handleLogout = useCallback(async () => {
    const ok = await confirm({
      title: t('logout', 'Log out'),
      message: t('logoutConfirm', 'Are you sure you want to log out?'),
      confirmLabel: t('logout', 'Log out'),
      cancelLabel: t('cancel', 'Cancel'),
      destructive: true,
      icon: 'log-out-outline',
    });
    if (ok) logout();
  }, [confirm, logout, t]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return t('dash.goodMorning', 'Good morning');
    if (hour < 17) return t('dash.goodAfternoon', 'Good afternoon');
    return t('dash.goodEvening', 'Good evening');
  }, [t]);

  const qaWidth = quickActionColumns === 2
    ? '48%'
    : quickActionColumns === 3 ? '31.5%' : '23.5%';

  // Revenue leads; the other two are the supporting columns of the ledger.
  const ledgerCells = [
    {
      key: 'revenue',
      label: t('dash.totalRevenue', 'Total revenue'),
      value: stats.data?.totalRevenue ?? 0,
      isCurrency: true,
      primary: true,
    },
    {
      key: 'sold',
      label: t('dash.totalOrders', 'Total orders'),
      value: stats.data?.totalSold ?? 0,
      sub: t('dash.unitsSold', 'units sold'),
    },
    {
      key: 'products',
      label: t('dash.totalProducts', 'Listings'),
      value: stats.data?.totalProducts ?? 0,
      sub: t('dash.activeProducts', { count: stats.data?.activeProducts ?? 0 }),
    },
  ];

  const wideLedger = statColumns >= 3;
  const recent = orders.data || [];
  const constrain = isExpanded && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' };

  return (
    <Screen edges={['top', 'left', 'right']} showOfflineBanner>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: SP.huge }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.brand}
            colors={[C.brand]}
          />
        }
      >
        <View style={[{ paddingHorizontal: gutter }, constrain]}>
          {/* ── Hero ── */}
          <View style={d.hero}>
            <View style={d.heroTop}>
              <View style={{ flex: 1 }}>
                <Text style={d.greeting} numberOfLines={1}>{greeting}</Text>
                <Text
                  style={d.sellerName}
                  numberOfLines={2}
                  accessibilityRole="header"
                >
                  {user?.name?.trim() || t('seller', 'Seller')}
                </Text>
              </View>

              <PressableRow
                onPress={() => navigation.navigate('SellerProfile')}
                accessibilityLabel={t('dash.profile', 'Profile')}
                accessibilityHint={t('dash.openProfileHint', 'Opens your seller profile')}
                style={d.avatarHit}
              >
                <Avatar name={user?.name} size={52} />
              </PressableRow>
            </View>

            <Rule style={{ marginTop: SP.lg }} />

            <View style={d.heroFoot}>
              <View style={d.liveRow} accessible accessibilityLabel={t('dash.liveBanner', 'Your shop is live')}>
                <View style={d.liveDotWrap} importantForAccessibility="no">
                  {/* Halo only — the solid dot underneath keeps the indicator
                      legible when the pulse is suppressed for Reduce Motion. */}
                  <Animated.View style={[d.liveDotHalo, { transform: [{ scale: livePulse }] }]} />
                  <View style={d.liveDot} />
                </View>
                <Text style={d.liveTxt} numberOfLines={1}>{t('dash.liveBanner', 'Your shop is live')}</Text>
              </View>
              {user?.phone ? <Text style={d.sellerPhone} numberOfLines={1}>+91 {user.phone}</Text> : null}
            </View>
          </View>

          {/* ── The ledger ── */}
          {stats.error && !stats.data ? (
            <Card>
              <ErrorState error={stats.error} onRetry={stats.retry} compact />
            </Card>
          ) : (
            <LinearGradient
              colors={GRAD.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={d.ledger}
            >
              <View style={wideLedger ? d.ledgerRow : undefined}>
                <LedgerCell
                  {...ledgerCells[0]}
                  index={0}
                  grow={wideLedger ? 1.4 : 0}
                  loading={stats.isInitialLoading}
                />

                <View style={wideLedger ? d.dividerV : d.dividerH} />

                {/* Always a row, so its children may safely take a flex factor. */}
                <View style={[d.ledgerPair, wideLedger && { flex: 2 }]}>
                  <LedgerCell {...ledgerCells[1]} index={1} grow={1} loading={stats.isInitialLoading} />
                  <View style={d.dividerV} />
                  <LedgerCell {...ledgerCells[2]} index={2} grow={1} loading={stats.isInitialLoading} />
                </View>
              </View>
            </LinearGradient>
          )}

          {/* ── Received reports ── */}
          <PressableRow
            onPress={() => navigation.navigate('ReceivedReports')}
            accessibilityLabel={t('inbox.dashTitle', 'Received Crop Reports')}
            accessibilityHint={
              inbox.data > 0
                ? t('inbox.dashUnread', { count: inbox.data, defaultValue: '{{count}} new from farmers nearby' })
                : t('inbox.dashEmpty', 'AI diagnoses sent by nearby farmers')
            }
            style={d.inboxCard}
          >
            <View style={d.inboxRail} />
            <View style={d.inboxIcon}>
              <Ionicons name="leaf" size={20} color={C.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={d.inboxTitle} numberOfLines={1}>
                {t('inbox.dashTitle', 'Received Crop Reports')}
              </Text>
              <Text style={d.inboxSub} numberOfLines={2}>
                {inbox.data > 0
                  ? t('inbox.dashUnread', { count: inbox.data, defaultValue: '{{count}} new from farmers nearby' })
                  : t('inbox.dashEmpty', 'AI diagnoses sent by nearby farmers')}
              </Text>
            </View>
            {inbox.data > 0
              ? <CountBadge count={inbox.data} />
              : <Ionicons name="chevron-forward" size={20} color={C.textFaint} />}
          </PressableRow>

          {/* ── Quick actions ── */}
          <SectionTitle>{t('dash.quickActions', 'Quick actions')}</SectionTitle>
          <View style={d.quickGrid}>
            <QuickAction
              icon="addProduct" label={t('dash.addProduct', 'Add product')} width={qaWidth} index={0}
              animated={iconsAnimated}
              onPress={() => navigation.navigate('CatalogSearch')}
            />
            <QuickAction
              icon="products" label={t('dash.myProducts', 'My products')} width={qaWidth} index={1}
              animated={iconsAnimated}
              onPress={() => navigation.navigate('SellerMyProducts')}
            />
            <QuickAction
              icon="viewOrders" label={t('dash.orders', 'Orders')} width={qaWidth} index={2}
              animated={iconsAnimated}
              onPress={() => navigation.navigate('SellerOrders')}
            />
            <QuickAction
              icon="settings" label={t('dash.profile', 'Profile')} width={qaWidth} index={3}
              animated={iconsAnimated}
              onPress={() => navigation.navigate('SellerProfile')}
            />
          </View>

          {/* ── Recent orders ── */}
          <SectionTitle
            action={
              recent.length > 0 ? (
                <Button
                  label={t('common.viewAll', 'View all')}
                  variant="ghost"
                  size="sm"
                  iconRight="chevron-forward"
                  onPress={() => navigation.navigate('SellerOrders')}
                />
              ) : null
            }
          >
            {t('dash.recentOrders', 'Recent orders')}
          </SectionTitle>

          {orders.isInitialLoading ? (
            <>
              <SkeletonCard thumb={false} lines={3} />
              <SkeletonCard thumb={false} lines={3} />
            </>
          ) : orders.error && recent.length === 0 ? (
            <Card>
              <ErrorState error={orders.error} onRetry={orders.retry} compact />
            </Card>
          ) : recent.length === 0 ? (
            <Card>
              <EmptyState
                icon="receipt-outline"
                compact
                title={t('dash.noOrdersYet', 'No orders yet')}
                body={t('dash.noOrdersSub', 'Orders from farmers will appear here.')}
              />
            </Card>
          ) : (
            <Card padded={false}>
              {recent.map((item, i) => (
                <OrderRow
                  key={String(item.id ?? i)}
                  item={item}
                  index={i}
                  t={t}
                  last={i === recent.length - 1}
                />
              ))}
            </Card>
          )}

          {/* End session. The seller app is standalone — the dashboard is the
              root, so there is nothing to go "back" to; logging out is the only
              meaningful exit. */}
          <Button
            label={t('logout', 'Log out')}
            icon="log-out-outline"
            variant="dangerSoft"
            fullWidth
            haptic="warning"
            onPress={handleLogout}
            style={{ marginTop: SP.xxxl }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const d = StyleSheet.create({
  // ── Hero ──
  hero: { paddingTop: SP.lg, paddingBottom: SP.xxl },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.lg },
  greeting: { ...T.micro, color: C.brandInk, textTransform: 'uppercase' },
  sellerName: { ...T.title, color: C.text, marginTop: SP.xs },
  avatarHit: {
    minWidth: HIT.min, minHeight: HIT.min,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: R.pill,
  },

  heroFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    marginTop: SP.md,
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, flex: 1 },
  liveDotWrap: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
  liveDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: C.successBold },
  liveDotHalo: {
    position: 'absolute',
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: alpha(C.successBold, 0.35),
  },
  liveTxt: { ...T.caption, color: C.textMuted, flexShrink: 1 },
  sellerPhone: { ...T.caption, color: C.textFaint },

  // ── Ledger ──
  ledger: {
    borderRadius: R.xxl,
    padding: SP.xxl,
    ...E.raised,
  },
  ledgerRow: { flexDirection: 'row', alignItems: 'stretch' },
  ledgerPair: { flexDirection: 'row', alignItems: 'stretch' },
  cell: { justifyContent: 'center', gap: SP.xs },
  cellLabel: { ...T.micro, color: C.onBrandMuted, textTransform: 'uppercase' },
  cellFigure: { ...T.figureMd, color: C.onBrand },
  cellFigureLg: { ...T.figure, color: C.onBrand },
  cellSub: { ...T.caption, color: C.onBrandMuted },
  skelOnEmber: { backgroundColor: C.onBrandFaint },

  dividerH: { height: 1, backgroundColor: C.onBrandFaint, marginVertical: SP.xl },
  dividerV: { width: 1, backgroundColor: C.onBrandFaint, marginHorizontal: SP.lg },

  // ── Inbox ──
  inboxCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.lg,
    marginTop: SP.lg,
    paddingVertical: SP.lg,
    paddingLeft: SP.xl,
    paddingRight: SP.lg,
    minHeight: HIT.min + SP.lg,
    borderRadius: R.xl,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    ...E.card,
  },
  inboxRail: {
    position: 'absolute',
    left: 0, top: SP.lg, bottom: SP.lg,
    width: 3,
    borderTopRightRadius: R.pill,
    borderBottomRightRadius: R.pill,
    backgroundColor: C.accent,
  },
  inboxIcon: {
    width: 42, height: 42, borderRadius: R.sm,
    backgroundColor: C.accentPale,
    alignItems: 'center', justifyContent: 'center',
  },
  inboxTitle: { ...T.bodyBold, color: C.text },
  inboxSub: { ...T.caption, color: C.textMuted, marginTop: 2 },

  // ── Quick actions ──
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.md },
  quickAction: {
    backgroundColor: C.surface,
    borderRadius: R.xl,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: SP.xl,
    paddingHorizontal: SP.md,
    minHeight: 124,
    justifyContent: 'center',
    ...E.card,
  },
  quickInner: { alignItems: 'center' },
  qaIcon: {
    width: 52, height: 52,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: SP.sm,
  },
  qaLabel: { ...T.label, color: C.text, textAlign: 'center' },

  // ── Recent orders ──
  orderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.lg,
    paddingHorizontal: SP.xl,
    paddingVertical: SP.lg,
  },
  orderRowRuled: { borderBottomWidth: 1, borderBottomColor: C.divider },
  orderMain: { flex: 1, gap: 3 },
  orderProduct: { ...T.bodyBold, color: C.text },
  orderBuyer: { ...T.caption, color: C.textMuted },
  orderQty: { ...T.caption, color: C.textFaint },
  orderSide: { alignItems: 'flex-end', gap: SP.sm },
  orderAmt: { ...T.figureSm, color: C.accentInk },
});

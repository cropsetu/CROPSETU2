/**
 * OrdersScreen — incoming orders and their fulfilment status.
 *
 * Endpoints, status flow and payloads are unchanged.
 *
 * THE CARD IS A JOURNEY, NOT A BADGE
 * ----------------------------------
 * The old card told you an order's state with a single coloured pill, which
 * answers "what is it" but not "how far along is it" — the question a seller
 * actually has when they open this screen. Every card now carries the four-step
 * lifecycle as a segmented rail (Pending → Confirmed → Shipped → Delivered)
 * with the reached segments filled and the current one raised, plus a written
 * "step 2 of 4". A seller can read a whole screen of orders and see which ones
 * are stuck without reading a single label.
 *
 * The advance action is a filled primary button rather than the old outlined
 * one: it is the single thing this screen exists to let you do, and there is
 * exactly one of it per card. Cancel sits below it as a soft-danger button, so
 * the destructive option is reachable but never the one your thumb lands on.
 *
 * Terminal states (cancelled, refunded) render no rail at all — an empty
 * four-step track under a cancelled order would imply it is still going.
 *
 * BEHAVIOUR — unchanged and still guaranteed:
 *   - Errors are shown. The old `catch { console.warn }` meant a 500 or a lost
 *     connection rendered as "No orders found", which for a seller reads as
 *     "nobody bought anything" rather than "the app is broken".
 *   - Status labels are translated; the chips and badges printed the raw enum.
 *   - Advancing a status is optimistic with rollback, and confirmed through a
 *     dialog that actually renders on web.
 *   - Filtering is server-side via `?status=` ONLY. The old second, client-side
 *     pass silently hid rows between changing a filter and the response.
 *   - `hasMore` was `list.length === 20`, so a shop with exactly 20 orders
 *     paged forever against an empty page 2.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Animated, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import api, { safeErrorMessage } from '@krushisarva/shared/services/api';
import DashboardStatIcon from '@krushisarva/shared/components/DashboardStatIcons';

import {
  C, SP, T, formatCurrency, orderStatusLabel, orderStatusMeta, useResponsive,
} from '../theme';
import usePagedList from '../hooks/usePagedList';
import { useEntrance } from '../hooks/useMotion';
import { useNetwork } from '../hooks/useNetwork';
import {
  Screen, Card, Button, Chip, FilterBar, StatusPill, StatusSteps, MetricRow,
  EmptyState, ErrorState, ListFooter, SkeletonList, InlineNotice,
  useConfirm, useToast,
} from '../components/ui';

const STATUS_FLOW = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED'];
const FILTERS = ['All', 'PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
const PAGE_SIZE = 20;

/** Next status in the fulfilment flow, or null when the order is terminal. */
function nextStatusFor(status) {
  const i = STATUS_FLOW.indexOf(status);
  if (i === -1 || i >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[i + 1];
}

// ── Order card ───────────────────────────────────────────────────────────────

const OrderCard = React.memo(function OrderCard({ item, index, onUpdateStatus, busy, disabled }) {
  const { t } = useLanguage();
  const entrance = useEntrance({ index, distance: 16 });

  const status = item.order?.status;
  const meta = orderStatusMeta(status);
  const next = nextStatusFor(status);
  const canCancel = status === 'PENDING';
  const inFlow = meta.step >= 0;

  const address = item.order?.deliveryAddress;
  const addressLine = address
    ? [address.name, address.addressLine, address.city, address.pincode].filter(Boolean).join(', ')
    : null;

  const buyerName = item.order?.user?.name?.trim() || t('orders.buyerFallback', 'Farmer');
  const buyerPhone = item.order?.user?.phone;

  const createdAt = item.order?.createdAt ? new Date(item.order.createdAt) : null;
  const dateLabel = createdAt && !Number.isNaN(createdAt.getTime())
    ? createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  return (
    <Animated.View style={entrance}>
      <Card style={o.card} accent={meta.color}>
        {/* Date leads the card as an eyebrow. It used to be a stray line of
            grey text under the buttons, which is where nobody looks. */}
        <View style={o.head}>
          <Text style={o.date} numberOfLines={1}>{dateLabel}</Text>
          <StatusPill status={status} t={t} size="sm" />
        </View>

        <Text style={o.product} numberOfLines={2}>
          {item.product?.name || t('common.untitled', 'Untitled product')}
        </Text>
        <Text style={o.buyer} numberOfLines={1}>
          {[buyerName, buyerPhone ? `+91 ${buyerPhone}` : null].filter(Boolean).join(' · ')}
        </Text>

        {inFlow ? (
          <View style={o.flow}>
            <StatusSteps status={status} t={t} />
            <Text style={o.flowTxt} numberOfLines={1}>
              {t('orders.stepProgress', {
                n: meta.step + 1,
                total: STATUS_FLOW.length,
                defaultValue: 'Step {{n}} of {{total}}',
              })}
              {' · '}
              {orderStatusLabel(status, t)}
            </Text>
          </View>
        ) : null}

        <MetricRow
          items={[
            {
              label: t('orders.qty', 'Qty'),
              value: `${item.quantity ?? '—'} ${item.product?.unit || ''}`.trim(),
            },
            {
              label: t('orders.amount', 'Amount'),
              value: formatCurrency(item.totalPrice),
              color: C.accentInk,
            },
            {
              label: t('orders.payment', 'Payment'),
              value: item.order?.paymentMethod?.toUpperCase() || '—',
            },
          ]}
          style={{ marginTop: SP.lg }}
        />

        {addressLine ? (
          <View style={o.addrRow}>
            <Ionicons name="location-outline" size={15} color={C.textMuted} style={{ marginTop: 2 }} />
            <Text style={o.addrTxt} numberOfLines={3}>{addressLine}</Text>
          </View>
        ) : null}

        {next ? (
          <Button
            label={t('orders.markAs', { status: orderStatusLabel(next, t) })}
            iconRight="arrow-forward"
            size="md"
            fullWidth
            loading={busy}
            disabled={disabled}
            onPress={() => onUpdateStatus(item, next)}
            style={{ marginTop: SP.xl }}
          />
        ) : null}

        {canCancel ? (
          <Button
            label={t('orders.cancelOrder', 'Cancel order')}
            icon="close-circle-outline"
            variant="dangerSoft"
            size="md"
            fullWidth
            haptic="warning"
            disabled={disabled || busy}
            onPress={() => onUpdateStatus(item, 'CANCELLED')}
            style={{ marginTop: SP.sm }}
          />
        ) : null}
      </Card>
    </Animated.View>
  );
});

// ── Screen ───────────────────────────────────────────────────────────────────

export default function OrdersScreen() {
  const { t } = useLanguage();
  const confirm = useConfirm();
  const toast = useToast();
  const { isOffline } = useNetwork();
  const { gutter, isExpanded, contentMaxWidth } = useResponsive();

  const [filter, setFilter] = useState('All');
  const [busyIds, setBusyIds] = useState(() => new Set());

  const markBusy = useCallback((id, on) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const list = usePagedList({
    mode: 'page',
    limit: PAGE_SIZE,
    deps: [filter],
    refetchOnFocus: true,
    errorFallback: t('orders.loadError', 'Could not load your orders.'),
    fetchPage: useCallback(({ page, limit, signal }) => {
      const statusQ = filter !== 'All' ? `&status=${encodeURIComponent(filter)}` : '';
      return api.get(`/agristore/seller/orders?page=${page}&limit=${limit}${statusQ}`, { signal });
    }, [filter]),
  });

  const { items, setItems } = list;

  const handleUpdateStatus = useCallback(async (item, newStatus) => {
    const orderId = item.order?.id;
    if (!orderId) {
      toast.error(t('orders.updateStatusError', 'Could not update this order.'));
      return;
    }

    const label = orderStatusLabel(newStatus, t);
    const destructive = newStatus === 'CANCELLED';

    const ok = await confirm({
      title: destructive
        ? t('orders.cancelOrder', 'Cancel order')
        : t('orders.markAs', { status: label }),
      message: destructive
        ? t('orders.cancelMsg', { defaultValue: 'The buyer will be notified that this order is cancelled. This cannot be undone.' })
        : t('orders.markAsMsg', { status: label }),
      confirmLabel: destructive ? t('orders.cancelOrder', 'Cancel order') : t('orders.confirm', 'Confirm'),
      cancelLabel: t('cancel', 'Cancel'),
      destructive,
      icon: destructive ? 'close-circle-outline' : 'arrow-forward-circle-outline',
    });
    if (!ok) return;

    const previous = item.order?.status;
    markBusy(orderId, true);

    // Every line of the same order shares one status — update them together.
    const applyStatus = (status) => setItems((prev) => prev.map((row) => (
      row.order?.id === orderId ? { ...row, order: { ...row.order, status } } : row
    )));

    applyStatus(newStatus);

    try {
      await api.put(`/agristore/seller/orders/${orderId}/status`, { status: newStatus });
      toast.success(t('orders.statusUpdated', { status: label, defaultValue: `Order marked ${label}` }));

      // The row no longer matches the active filter — drop it so the list stays
      // truthful rather than showing a DELIVERED order under "Pending".
      if (filter !== 'All' && filter !== newStatus) {
        setItems((prev) => prev.filter((row) => row.order?.id !== orderId));
      }
    } catch (e) {
      applyStatus(previous);
      toast.error(safeErrorMessage(e, t('orders.updateStatusError', 'Could not update this order.')));
    } finally {
      markBusy(orderId, false);
    }
  }, [confirm, filter, markBusy, setItems, toast, t]);

  const renderItem = useCallback(({ item, index }) => (
    <OrderCard
      item={item}
      index={index}
      onUpdateStatus={handleUpdateStatus}
      busy={busyIds.has(item.order?.id)}
      disabled={isOffline}
    />
  ), [handleUpdateStatus, busyIds, isOffline]);

  const keyExtractor = useCallback(
    (item, index) => (item?.id != null ? String(item.id) : `order-${index}`),
    [],
  );

  const emptyBody = useMemo(() => (
    filter === 'All'
      ? t('orders.noOrdersAll', 'Orders from farmers will show up here.')
      : t('orders.noOrdersFilter', { status: orderStatusLabel(filter, t) })
  ), [filter, t]);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <FilterBar>
        {FILTERS.map((key) => (
          <Chip
            key={key}
            label={key === 'All' ? t('orders.filterAll', 'All') : orderStatusLabel(key, t)}
            selected={filter === key}
            onPress={() => setFilter(key)}
            size="sm"
          />
        ))}
      </FilterBar>

      {list.isInitialLoading ? (
        <SkeletonList count={4} thumb={false} />
      ) : list.error && items.length === 0 ? (
        <ErrorState error={list.error} onRetry={list.retry} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={[
            { padding: gutter, paddingBottom: SP.huge, flexGrow: 1 },
            isExpanded && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={list.refreshing}
              onRefresh={list.refresh}
              tintColor={C.brand}
              colors={[C.brand]}
            />
          }
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            list.error && items.length > 0 ? (
              <InlineNotice variant="warning" style={{ marginBottom: SP.lg }}>
                {t('common.staleData', 'Showing saved data — refresh failed.')}
              </InlineNotice>
            ) : null
          }
          ListFooterComponent={
            <ListFooter
              loading={list.loadingMore}
              error={list.moreError}
              onRetry={list.retryMore}
              hasMore={list.hasMore}
              itemCount={items.length}
            />
          }
          ListEmptyComponent={
            <EmptyState
              illustration={<DashboardStatIcon type="orders" size={60} animated={false} />}
              title={t('orders.noOrdersFound', 'No orders found')}
              body={emptyBody}
              actionLabel={filter !== 'All' ? t('orders.clearFilter', 'Show all orders') : undefined}
              onAction={filter !== 'All' ? () => setFilter('All') : undefined}
            />
          }
          initialNumToRender={5}
          maxToRenderPerBatch={7}
          windowSize={9}
          removeClippedSubviews={false}
        />
      )}
    </Screen>
  );
}

const o = StyleSheet.create({
  card: { marginBottom: SP.lg },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SP.md,
    marginBottom: SP.md,
  },
  date: { ...T.micro, color: C.textFaint, textTransform: 'uppercase', flexShrink: 1 },

  product: { ...T.subhead, color: C.text },
  buyer: { ...T.caption, color: C.textMuted, marginTop: SP.xs },

  flow: { marginTop: SP.lg, gap: SP.sm },
  flowTxt: { ...T.micro, color: C.textMuted, textTransform: 'uppercase' },

  addrRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginTop: SP.lg },
  addrTxt: { ...T.caption, flex: 1, color: C.textMuted, lineHeight: 18 },
});

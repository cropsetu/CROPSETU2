/**
 * MyProductsScreen — the seller's inventory.
 *
 * Same endpoints and same cursor pagination as before.
 *
 * THE ROW
 * -------
 * A listing has to answer four questions from a metre away: what is it, what
 * does it cost, how many are left, and is it visible to buyers. The redesigned
 * row gives each of those its own place instead of running them together in a
 * grey block of captions:
 *
 *   - the photo is a large square plate on the left, so a seller scanning for
 *     one product recognises it by picture rather than by reading
 *   - the price is a Fraunces figure — the same treatment money gets on the
 *     dashboard, so "a number that is rupees" looks the same everywhere
 *   - stock is a pill, and an out-of-stock pill carries an icon and a word, not
 *     just a red tint
 *   - visibility is the switch AND a "Live"/"Hidden" caption under it, because
 *     a switch's on/off position is a colour cue at a glance and this app is
 *     used outdoors
 *   - a hidden listing dims its photo and drops a "Hidden" badge into the row;
 *     the old version reduced the whole card's opacity, which also dimmed the
 *     controls needed to un-hide it
 *
 * BEHAVIOUR — unchanged and still guaranteed:
 *   - Failure is visible. `load()` used to `console.warn` and leave the screen
 *     showing "No products yet" — a seller with 40 listings and a dead network
 *     was told their shop was empty.
 *   - The active/inactive Switch applies optimistically and rolls back if the
 *     PUT fails, instead of freezing under the finger for a round trip.
 *   - Delete is a real confirmation dialog on every platform (Alert.alert is a
 *     no-op on web, so on the web build delete simply never happened).
 *   - Rows are memoised and keyed defensively; a null id used to crash FlatList.
 *   - The FAB's decorative pulse ring is gone rather than restyled: it was an
 *     unbounded `Animated.loop` whose only job was to draw attention to a
 *     56dp ember pill that already has the loudest shadow on the screen.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Animated, FlatList, Image, RefreshControl, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import api, { safeErrorMessage } from '@krushisarva/shared/services/api';
import StoreCategoryIcon from '@krushisarva/shared/components/StoreCategoryIcons';

import { C, HIT, R, SP, T, alpha, formatCurrency, useResponsive } from '../theme';
import usePagedList from '../hooks/usePagedList';
import { useEntrance } from '../hooks/useMotion';
import { useNetwork } from '../hooks/useNetwork';
import {
  Screen, Card, Button, PressableRow, Badge,
  EmptyState, ErrorState, ListFooter, SkeletonList, InlineNotice,
  useConfirm, useToast,
} from '../components/ui';

/**
 * Display abbreviations for the API's unit enum. This is a normalisation table
 * for server values (like the status enum), not user-authored copy — the units
 * themselves are the same symbols in every language this app ships in.
 */
const UNIT_LABELS = {
  kg: 'kg', g: 'g', gram: 'g', litre: 'L', ml: 'ml', piece: 'pc',
  bag: 'bag', packet: 'pkt', acre: 'acre', quintal: 'qtl', bundle: 'bdl', dozen: 'dz',
};

const PAGE_SIZE = 20;

// ── Product card ─────────────────────────────────────────────────────────────

const ProductCard = React.memo(function ProductCard({
  item, index, onEdit, onDelete, onToggle, busy, disabled,
}) {
  const { t } = useLanguage();
  const entrance = useEntrance({ index, distance: 16 });

  const image = item.images?.[0];
  const unit = UNIT_LABELS[item.unit] || item.unit || '';
  const outOfStock = Number(item.stock) === 0;
  const discounted = item.mrp && Number(item.mrp) > Number(item.price);
  const live = !!item.isActive;

  const statusLabel = live ? t('myProducts.live', 'Live') : t('myProducts.hidden', 'Hidden');
  const name = item.name || t('common.untitled', 'Untitled product');

  return (
    <Animated.View style={entrance}>
      <Card style={p.card} padded={false}>
        <View style={p.top}>
          <View style={p.thumbWrap}>
            {image ? (
              <Image
                source={{ uri: image }}
                style={[p.thumb, !live && p.thumbDim]}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
                // Decorative: the name below already conveys the product.
                accessible={false}
              />
            ) : (
              <View style={[p.thumb, p.thumbEmpty]}>
                <Ionicons name="image-outline" size={26} color={C.textFaint} />
              </View>
            )}
          </View>

          <View style={p.info}>
            <Text style={p.name} numberOfLines={2}>{name}</Text>
            {item.category?.name ? (
              <Text style={p.category} numberOfLines={1}>{item.category.name}</Text>
            ) : null}

            <View style={p.priceRow}>
              <Text style={p.price} numberOfLines={1}>
                {formatCurrency(item.price)}
              </Text>
              {unit ? <Text style={p.perUnit} numberOfLines={1}>/{unit}</Text> : null}
              {discounted ? (
                <Text style={p.mrp} numberOfLines={1}>{formatCurrency(item.mrp)}</Text>
              ) : null}
            </View>

            <View style={p.metaRow}>
              {outOfStock ? (
                <Badge
                  label={t('myProducts.outOfStock', 'Out of stock')}
                  color={C.danger}
                  icon="alert-circle"
                />
              ) : (
                <View style={p.stockPill}>
                  <Ionicons name="layers-outline" size={11} color={C.textMuted} />
                  <Text style={p.stockTxt} numberOfLines={1}>
                    {t('myProducts.stock', { n: item.stock, unit })}
                  </Text>
                </View>
              )}
              {!live ? (
                <Badge label={statusLabel} color={C.neutral} icon="eye-off-outline" />
              ) : null}
            </View>
          </View>

          {/* Visibility. `busy` keeps it inert during the round trip so a rapid
              double-flip can't fire two conflicting PUTs. The caption under it
              states the state in words — a switch position alone is a colour
              cue, and this screen is read in direct sunlight. */}
          <View style={p.switchCol}>
            <Switch
              value={live}
              onValueChange={() => onToggle(item)}
              disabled={busy || disabled}
              trackColor={{ false: C.surfaceSunken, true: alpha(C.brand, 0.45) }}
              thumbColor={live ? C.brand : C.surface}
              ios_backgroundColor={C.surfaceSunken}
              accessibilityLabel={t('myProducts.toggleVisibility', 'Product visible to buyers')}
              accessibilityHint={
                live
                  ? t('myProducts.toggleHideHint', 'Turn off to hide this product from buyers')
                  : t('myProducts.toggleShowHint', 'Turn on to show this product to buyers')
              }
              accessibilityState={{ checked: live, disabled: busy || disabled }}
            />
            <Text
              style={[p.switchTxt, live && { color: C.successDeep }]}
              numberOfLines={1}
              importantForAccessibility="no"
            >
              {statusLabel}
            </Text>
          </View>
        </View>

        <View style={p.actions}>
          <PressableRow
            onPress={() => onEdit(item)}
            disabled={disabled}
            accessibilityLabel={t('myProducts.editNamed', { name, defaultValue: `Edit ${name}` })}
            style={[p.actionBtn, p.actionBtnLeft]}
          >
            <Ionicons name="pencil" size={16} color={C.brandInk} />
            <Text style={[p.actionTxt, { color: C.brandInk }]}>{t('myProducts.edit', 'Edit')}</Text>
          </PressableRow>

          <View style={p.actionDivider} />

          <PressableRow
            onPress={() => onDelete(item)}
            disabled={disabled}
            haptic="warning"
            accessibilityLabel={t('myProducts.deleteNamed', { name, defaultValue: `Delete ${name}` })}
            style={[p.actionBtn, p.actionBtnRight]}
          >
            <Ionicons name="trash" size={16} color={C.danger} />
            <Text style={[p.actionTxt, { color: C.danger }]}>{t('myProducts.delete', 'Delete')}</Text>
          </PressableRow>
        </View>
      </Card>
    </Animated.View>
  );
});

// ── Screen ───────────────────────────────────────────────────────────────────

export default function MyProductsScreen({ navigation }) {
  const { t } = useLanguage();
  const confirm = useConfirm();
  const toast = useToast();
  const { isOffline } = useNetwork();
  const { gutter, isExpanded, contentMaxWidth } = useResponsive();

  // Ids with an in-flight mutation — used to keep their row's controls inert.
  const [busyIds, setBusyIds] = useState(() => new Set());
  const markBusy = useCallback((id, on) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  // mode 'page', not 'cursor'. This screen used to ask for cursor pagination —
  // `?paginate=cursor`, then `?cursor=…` — against a route that has only ever
  // implemented offset pagination. The server returns paginationMeta()
  // (`{page, limit, total, totalPages}`) and no `nextCursor`, so the hook's
  // cursor branch read `meta.nextCursor` as undefined, set hasMore=false, and
  // loadMore() returned early forever.
  //
  // The result was not a missing "load more" — it was a lie. A seller with 50
  // products saw the newest 20, onEndReached did nothing, pull-to-refresh
  // re-fetched the same page, and the footer rendered "That's everything"
  // underneath row 20. The other 30 could not be edited, re-priced, hidden or
  // deleted from the app at all.
  //
  // Neither half was wrong on its own, which is why it survived review: the
  // sibling /agristore/listings route really does speak cursor, so the client
  // was written against a contract this shim never had.
  //
  // Offset is the right answer here rather than teaching the shim cursors: a
  // seller's own catalogue is bounded by their own inventory, the route already
  // rides seller_listings_sellerId_createdAt_idx, and OrdersScreen already uses
  // exactly this shape against a route that returns the same meta.
  const list = usePagedList({
    mode: 'page',
    limit: PAGE_SIZE,
    refetchOnFocus: true,
    // The shim flattens a LISTING into the product shape, so `id` is the shared
    // catalog product id: two pack sizes of one product yield two rows with the
    // same `id`. The hook dedupes across pages by this key, so without
    // listingId the second pack size would vanish on whichever page it landed.
    keyOf: (it) => it?.listingId ?? it?.id,
    errorFallback: t('myProducts.loadError', 'Could not load your products.'),
    fetchPage: useCallback(({ page, limit, signal }) =>
      api.get(`/agristore/seller/products?page=${page}&limit=${limit}`, { signal }), []),
  });

  const { items, setItems } = list;

  // Editing goes straight to the OFFER, not to the shared catalog row. The list
  // is served by /agristore/seller/products, which is now a shim over
  // seller_listings and carries listingId + variantId on every item.
  const handleEdit = useCallback((item) => {
    navigation.navigate('AddProduct', {
      intent: 'attach',
      listingId: item.listingId,
      listing: {
        id: item.listingId,
        sellingPrice: item.price,
        mrp: item.mrp,
        stockQty: item.stock,
        minOrderQty: item.minOrderQty,
        dispatchSlaDays: item.dispatchSlaDays,
        sellScope: item.sellScope,
        district: item.district,
        taluka: item.taluka,
        village: item.village,
        state: item.state,
        harvestDate: item.harvestDate,
      },
      catalogProduct: {
        id: item.id, name: item.name, brand: item.brand,
        manufacturer: item.manufacturer, images: item.images,
        categoryId: item.categoryId, status: item.status,
      },
      variant: { id: item.variantId, unit: item.unit, packSize: item.unit },
      // Kept so the legacy shim path still works for a row with no listingId.
      product: item,
    });
  }, [navigation]);

  // Optimistic toggle: flip locally, then reconcile. On failure the row snaps
  // back and the seller is told why — previously a failed PUT left the UI
  // showing the OLD value with no explanation, so the product silently stayed
  // visible when they meant to hide it.
  const handleToggle = useCallback(async (item) => {
    if (busyIds.has(item.id)) return;
    const next = !item.isActive;

    markBusy(item.id, true);
    setItems((prev) => prev.map((p2) => (p2.id === item.id ? { ...p2, isActive: next } : p2)));

    try {
      // Pause/resume MY OFFER. This used to PUT isActive onto the PRODUCT row,
      // which post-split is shared — hiding your own stock would have hidden the
      // product for every other Kendra selling it too.
      const { data } = item.listingId
        ? await api.patch(`/agristore/listings/${item.listingId}`, { status: next ? 'ACTIVE' : 'INACTIVE' })
        : await api.put(`/agristore/seller/products/${item.id}`, { isActive: next });
      const payload = data?.data;
      const confirmed = payload?.status ? payload.status === 'ACTIVE' : payload?.isActive;
      if (typeof confirmed === 'boolean' && confirmed !== next) {
        setItems((prev) => prev.map((p2) => (p2.id === item.id ? { ...p2, isActive: confirmed } : p2)));
      }
    } catch (e) {
      setItems((prev) => prev.map((p2) => (p2.id === item.id ? { ...p2, isActive: item.isActive } : p2)));
      toast.error(safeErrorMessage(e, t('myProducts.updateStatusError', 'Could not update visibility.')));
    } finally {
      markBusy(item.id, false);
    }
  }, [busyIds, markBusy, setItems, toast, t]);

  const handleDelete = useCallback(async (item) => {
    const ok = await confirm({
      title: t('myProducts.deleteProduct', 'Delete product'),
      message: t('myProducts.deleteConfirm', { name: item.name }),
      confirmLabel: t('myProducts.delete', 'Delete'),
      cancelLabel: t('cancel', 'Cancel'),
      destructive: true,
      icon: 'trash-outline',
    });
    if (!ok) return;

    // Remove immediately so the list feels instant, and restore in place if the
    // server rejects it.
    const index = items.findIndex((p2) => p2.id === item.id);
    markBusy(item.id, true);
    setItems((prev) => prev.filter((p2) => p2.id !== item.id));

    try {
      // Removes MY OFFER only. The old DELETE soft-deleted the product AND ran
      // cartItem.deleteMany({ where: { productId } }) — wiping the product out of
      // every buyer's cart, including buyers who had chosen a different Kendra.
      if (item.listingId) await api.delete(`/agristore/listings/${item.listingId}`);
      else await api.delete(`/agristore/seller/products/${item.id}`);
      toast.success(t('myProducts.deleted', { name: item.name, defaultValue: `${item.name} deleted` }));
    } catch (e) {
      setItems((prev) => {
        if (prev.some((p2) => p2.id === item.id)) return prev;
        const restored = [...prev];
        restored.splice(Math.max(0, index), 0, item);
        return restored;
      });
      toast.error(safeErrorMessage(e, t('myProducts.deleteError', 'Could not delete this product.')));
    } finally {
      markBusy(item.id, false);
    }
  }, [confirm, items, markBusy, setItems, toast, t]);

  const renderItem = useCallback(({ item, index }) => (
    <ProductCard
      item={item}
      index={index}
      onEdit={handleEdit}
      onDelete={handleDelete}
      onToggle={handleToggle}
      busy={busyIds.has(item.id)}
      // Mutations need the network; showing them as tappable while offline
      // just produces a failure toast a second later.
      disabled={isOffline}
    />
  ), [handleEdit, handleDelete, handleToggle, busyIds, isOffline]);

  // FlatList requires a string key, and the API has been seen returning rows
  // with no id at all (soft-deleted joins). Fall back to the index.
  const keyExtractor = useCallback(
    (item, index) => (item?.id != null ? String(item.id) : `row-${index}`),
    [],
  );

  const listRef = useRef(null);

  const openAddProduct = useCallback(() => {
    navigation.navigate('CatalogSearch');
  }, [navigation]);

  // First load with nothing to show yet.
  if (list.isInitialLoading) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <SkeletonList count={5} />
      </Screen>
    );
  }

  // Hard failure with no cached rows — the whole screen is the error.
  if (list.error && items.length === 0) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <ErrorState error={list.error} onRetry={list.retry} />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={[
          { padding: gutter, paddingBottom: 132, flexGrow: 1 },
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
          // A stale-data warning belongs above the rows it applies to.
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
            illustration={<StoreCategoryIcon type="bag" size={60} animated={false} />}
            title={t('myProducts.noProducts', 'No products yet')}
            body={t('myProducts.noProductsSub', 'Add your first listing so farmers nearby can find it.')}
            actionLabel={t('dash.addProduct', 'Add product')}
            onAction={openAddProduct}
          />
        }
        // Windowing: these cards are tall, so a small window keeps memory flat
        // on a 500-product shop without blanking during a fast fling.
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={9}
        removeClippedSubviews={false}
      />

      {/* An extended FAB, not an icon-only circle: the audience for this app is
          low-literacy but not no-literacy, and a labelled pill is unambiguous
          where a bare "+" is a guess. */}
      <Button
        label={t('dash.addProduct', 'Add product')}
        icon="add"
        size="lg"
        onPress={openAddProduct}
        accessibilityLabel={t('dash.addProduct', 'Add product')}
        style={p.fab}
      />
    </Screen>
  );
}

const p = StyleSheet.create({
  card: { marginBottom: SP.lg },

  top: { flexDirection: 'row', padding: SP.lg, alignItems: 'flex-start', gap: SP.lg },
  thumbWrap: {
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceSunken,
    overflow: 'hidden',
  },
  thumb: { width: 84, height: 84 },
  thumbDim: { opacity: 0.45 },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },

  info: { flex: 1, gap: SP.xs },
  name: { ...T.bodyBold, color: C.text },
  category: { ...T.caption, color: C.textMuted },

  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: SP.xs, marginTop: SP.xs, flexWrap: 'wrap' },
  price: { ...T.figureSm, color: C.brandInk },
  perUnit: { ...T.caption, color: C.textMuted },
  mrp: { ...T.caption, color: C.textFaint, textDecorationLine: 'line-through', marginLeft: SP.xs },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.xs, flexWrap: 'wrap' },
  stockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    paddingHorizontal: SP.md,
    paddingVertical: 4,
    borderRadius: R.pill,
    backgroundColor: C.surfaceSunken,
  },
  stockTxt: { ...T.micro, color: C.textMuted, textTransform: 'uppercase' },

  switchCol: { alignItems: 'center', gap: SP.xs, minWidth: 52 },
  switchTxt: { ...T.micro, color: C.textFaint, textTransform: 'uppercase' },

  actions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.divider },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    minHeight: HIT.min,
  },
  // Match the card's corner so a press tint can't paint over the rounded edge.
  actionBtnLeft: { borderBottomLeftRadius: R.xl },
  actionBtnRight: { borderBottomRightRadius: R.xl },
  actionTxt: { ...T.labelBold },
  actionDivider: { width: 1, backgroundColor: C.divider },

  // No shadow here: `Button`'s primary variant already carries `E.brand`, and
  // stacking a second one on the wrapper doubles the opacity into a smudge.
  fab: {
    position: 'absolute',
    right: SP.xl,
    bottom: SP.xxl,
  },
});

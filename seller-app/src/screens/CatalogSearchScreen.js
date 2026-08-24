/**
 * CatalogSearchScreen — step 1 of adding a product.
 *
 * WHY THIS SCREEN EXISTS
 * Before the catalog split, "Add product" went straight to a 30-field form, and
 * every seller who filled it in created a NEW product row. Three Krushi Seva
 * Kendras selling the same Mahyco seed produced three product rows and three
 * separate buyer-facing pages, because `products` fused catalog identity with
 * one seller's offer and had no unique constraint of any kind.
 *
 * The form is now the LAST resort, not the first step. A seller searches the
 * catalogue first; if the product is already there they supply only price, stock
 * and delivery details, and no `products` row is created at all.
 *
 * Three outcomes, in the order they should be preferred:
 *   1. Found + I already sell it   → go straight to editing that offer
 *   2. Found                       → "Sell this" → AddProduct { intent: 'attach' }
 *   3. Genuinely not in the catalogue → "Add a new product" → AddProduct { intent: 'create' }
 *
 * The escape hatch is deliberately present but quiet. Making it prominent turns
 * every search into a create, which is the behaviour this screen exists to stop.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import api, { safeErrorMessage } from '@krushisarva/shared/services/api';

import { C, R, SP, T, HIT, alpha, useResponsive } from '../theme';
import { useNetwork } from '../hooks/useNetwork';
import {
  Screen, AppHeader, Button, Field, TextField, Card,
  EmptyState, ErrorState, SkeletonList, InlineNotice, SelectSheet,
} from '../components/ui';

const MIN_QUERY = 3;
const DEBOUNCE_MS = 350;

const money = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

/** One catalogue hit, with the thing a seller actually needs to decide: who else sells it and for how much. */
function CatalogHit({ product, onAttach, onEditMine, t }) {
  const cover = product.images?.[0];
  const variants = product.variants || [];

  return (
    <Card style={s.hit}>
      <View style={s.hitTop}>
        {cover
          ? <Image source={{ uri: cover }} style={s.hitImg} resizeMode="cover" accessibilityIgnoresInvertColors />
          : <View style={[s.hitImg, s.hitImgEmpty]}><Ionicons name="leaf-outline" size={22} color={C.textMuted} /></View>}

        <View style={s.hitMeta}>
          <Text style={s.hitName} numberOfLines={2}>{product.name}</Text>
          {product.brand || product.manufacturer ? (
            <Text style={s.hitBrand} numberOfLines={1}>
              {[product.brand, product.manufacturer].filter(Boolean).join(' · ')}
            </Text>
          ) : null}

          <Text style={s.hitStat} numberOfLines={1}>
            {product.offerCount > 0
              ? t('catalogSearch.offerSummary', {
                  count: product.offerCount,
                  price: money(product.lowestPrice),
                  defaultValue: `${product.offerCount} seller(s) already, from ${money(product.lowestPrice)}`,
                })
              : t('catalogSearch.noOffersYet', 'No one is selling this yet — you would be first.')}
          </Text>

          {product.status === 'PENDING_QC' ? (
            <Text style={s.hitPending}>
              {t('catalogSearch.pendingQc', 'Awaiting KrushiSarva review')}
            </Text>
          ) : null}
        </View>
      </View>

      {/* One row per pack size. Pack size IS the variant axis for agri-inputs, so
          the seller picks WHICH pack they stock, not just "this product". */}
      <View style={s.packs}>
        {variants.map((v) => {
          const packLabel = v.attributes?.packSize || v.unit;
          const mine = v.myListing;
          return (
            <Pressable
              key={v.id}
              onPress={() => (mine ? onEditMine(product, v, mine) : onAttach(product, v))}
              hitSlop={HIT}
              style={({ pressed }) => [s.pack, pressed && { backgroundColor: alpha(C.brand, 0.06) }]}
              accessibilityRole="button"
              accessibilityLabel={
                mine
                  ? t('catalogSearch.editMineA11y', { pack: packLabel, defaultValue: `Edit your ${packLabel} offer` })
                  : t('catalogSearch.sellThisA11y', { pack: packLabel, defaultValue: `Sell the ${packLabel} pack` })
              }
            >
              <View style={s.packLeft}>
                <Text style={s.packSize}>{packLabel}</Text>
                <Text style={s.packSub} numberOfLines={1}>
                  {v.offerCount > 0
                    ? t('catalogSearch.packFrom', { price: money(v.lowestPrice), count: v.offerCount, defaultValue: `from ${money(v.lowestPrice)} · ${v.offerCount} seller(s)` })
                    : t('catalogSearch.packNoOffers', 'no offers yet')}
                </Text>
              </View>

              {mine ? (
                <View style={s.packMine}>
                  <Ionicons name="checkmark-circle" size={16} color={C.brand} />
                  <Text style={s.packMineTxt}>
                    {t('catalogSearch.yours', { price: money(mine.sellingPrice), defaultValue: `Yours · ${money(mine.sellingPrice)}` })}
                  </Text>
                </View>
              ) : (
                <View style={s.packCta}>
                  <Text style={s.packCtaTxt}>{t('catalogSearch.sellThis', 'Sell this')}</Text>
                  <Ionicons name="chevron-forward" size={16} color={C.brand} />
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

export default function CatalogSearchScreen({ navigation }) {
  const { t } = useLanguage();
  const { isOffline } = useNetwork();
  const { gutter, contentMaxWidth } = useResponsive();

  const [q, setQ] = useState('');
  const [gtin, setGtin] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [categories, setCategories] = useState([]);

  const [state, setState] = useState({ status: 'idle', results: [], matchType: 'none', error: null });
  const reqId = useRef(0);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    api.get('/agristore/categories')
      .then(({ data }) => { if (alive) setCategories(data?.data || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const runSearch = useCallback(async (term, barcode, cat) => {
    const trimmed = (term || '').trim();
    const code = (barcode || '').trim();
    if (trimmed.length < MIN_QUERY && !code) {
      setState({ status: 'idle', results: [], matchType: 'none', error: null });
      return;
    }
    if (isOffline) {
      setState({ status: 'error', results: [], matchType: 'none', error: t('common.offline', 'You are offline.') });
      return;
    }

    const id = ++reqId.current;
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const params = new URLSearchParams();
      if (trimmed) params.set('q', trimmed);
      if (code) params.set('gtin', code);
      if (cat) params.set('categoryId', cat);
      const { data } = await api.get(`/agristore/catalog/search?${params.toString()}`);
      // Ignore a response that a newer keystroke has already superseded.
      if (id !== reqId.current) return;
      setState({
        status: 'done',
        results: data?.data?.results || [],
        matchType: data?.data?.matchType || 'none',
        error: null,
      });
    } catch (e) {
      if (id !== reqId.current) return;
      setState({ status: 'error', results: [], matchType: 'none', error: safeErrorMessage(e, t('catalogSearch.error', 'Could not search the catalogue.')) });
    }
  }, [isOffline, t]);

  // Debounced so a seller typing "Mahyco Bt Cotton" does not fire eight trigram
  // scans; the last keystroke wins via reqId.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(q, gtin, categoryId), DEBOUNCE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, gtin, categoryId, runSearch]);

  const goAttach = useCallback((product, variant) => {
    navigation.navigate('AddProduct', {
      intent: 'attach',
      catalogProduct: {
        id: product.id, name: product.name, brand: product.brand,
        manufacturer: product.manufacturer, images: product.images,
        categoryId: product.categoryId, status: product.status,
      },
      variant: {
        id: variant.id,
        unit: variant.unit,
        packSize: variant.attributes?.packSize || null,
        lowestPrice: variant.lowestPrice,
        offerCount: variant.offerCount,
      },
    });
  }, [navigation]);

  const goEditMine = useCallback((product, variant, listing) => {
    navigation.navigate('AddProduct', {
      intent: 'attach',
      listingId: listing.id,
      catalogProduct: {
        id: product.id, name: product.name, brand: product.brand,
        manufacturer: product.manufacturer, images: product.images,
        categoryId: product.categoryId, status: product.status,
      },
      variant: {
        id: variant.id, unit: variant.unit,
        packSize: variant.attributes?.packSize || null,
        lowestPrice: variant.lowestPrice, offerCount: variant.offerCount,
      },
      listing,
    });
  }, [navigation]);

  const goCreate = useCallback(() => {
    navigation.navigate('AddProduct', {
      intent: 'create',
      prefill: { name: q.trim(), categoryId, gtin: gtin.trim() },
    });
  }, [navigation, q, categoryId, gtin]);

  const categoryOptions = useMemo(
    () => [{ value: '', label: t('catalogSearch.allCategories', 'All categories') },
           ...categories.map((c) => ({ value: c.id, label: c.name }))],
    [categories, t],
  );
  const categoryLabel = categoryOptions.find((o) => o.value === categoryId)?.label || '';

  const searched = q.trim().length >= MIN_QUERY || gtin.trim().length > 0;

  return (
    <Screen>
      <AppHeader
        title={t('catalogSearch.title', 'Find your product')}
        subtitle={t('catalogSearch.subtitle', 'Search first — most products are already listed')}
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[s.body, { paddingHorizontal: gutter, maxWidth: contentMaxWidth, alignSelf: 'center', width: '100%' }]}
      >
        <InlineNotice variant="info" icon="information-circle">
          {t(
            'catalogSearch.why',
            'If your product is already here, add only your price and stock. Buyers then see one page with every Kendra’s offer — including yours.',
          )}
        </InlineNotice>

        <Field label={t('catalogSearch.nameLabel', 'Product name or brand')}>
          <TextField
            value={q}
            onChangeText={setQ}
            placeholder={t('catalogSearch.namePlaceholder', 'e.g. Mahyco Bt Cotton Seed')}
            autoCapitalize="words"
            returnKeyType="search"
            accessibilityLabel={t('catalogSearch.nameLabel', 'Product name or brand')}
          />
        </Field>

        <Field
          label={t('catalogSearch.gtinLabel', 'Barcode (optional)')}
          hint={t('catalogSearch.gtinHint', 'Most seed and fertiliser packs have none — leave it blank.')}
        >
          <TextField
            value={gtin}
            onChangeText={setGtin}
            placeholder="8901234567895"
            keyboardType="number-pad"
            accessibilityLabel={t('catalogSearch.gtinLabel', 'Barcode (optional)')}
          />
        </Field>

        <Field label={t('catalogSearch.categoryLabel', 'Category')}>
          <SelectSheet
            title={t('catalogSearch.categoryLabel', 'Category')}
            placeholder={t('catalogSearch.allCategories', 'All categories')}
            items={categoryOptions}
            value={categoryId}
            onChange={setCategoryId}
            clearLabel={t('catalogSearch.allCategories', 'All categories')}
            accessibilityLabel={t('catalogSearch.categoryLabel', 'Category')}
          />
        </Field>

        {state.status === 'loading' ? <SkeletonList count={3} /> : null}

        {state.status === 'error' ? (
          <ErrorState
            error={{ message: state.error, isOffline }}
            onRetry={() => runSearch(q, gtin, categoryId)}
          />
        ) : null}

        {state.status === 'done' && state.results.length > 0 ? (
          <>
            <Text style={s.resultHead}>
              {state.matchType === 'gtin'
                ? t('catalogSearch.exactBarcode', 'Exact barcode match')
                : t('catalogSearch.matches', { count: state.results.length, defaultValue: `${state.results.length} match(es) in the catalogue` })}
            </Text>
            {state.results.map((p) => (
              <CatalogHit key={p.id} product={p} onAttach={goAttach} onEditMine={goEditMine} t={t} />
            ))}
          </>
        ) : null}

        {state.status === 'done' && searched && state.results.length === 0 ? (
          <EmptyState
            icon="search-outline"
            title={t('catalogSearch.noneTitle', 'Not in the catalogue yet')}
            body={t('catalogSearch.noneMsg', 'Add it as a new product. KrushiSarva will review it before it goes live to buyers.')}
          />
        ) : null}

        {searched && state.status !== 'loading' ? (
          <View style={s.escape}>
            <Text style={s.escapeHint}>
              {state.results.length
                ? t('catalogSearch.escapeHintFound', 'None of these is your product?')
                : t('catalogSearch.escapeHintNone', 'Ready to add it?')}
            </Text>
            <Button
              variant={state.results.length ? 'ghost' : 'primary'}
              icon="add-circle-outline"
              onPress={goCreate}
              label={t('catalogSearch.createNew', 'Add a new product')}
            />
          </View>
        ) : null}

        {!searched ? (
          <EmptyState
            icon="cube-outline"
            title={t('catalogSearch.startTitle', 'Start typing')}
            body={t('catalogSearch.startMsg', 'Enter at least 3 letters of the product name or brand.')}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { paddingVertical: SP.lg, gap: SP.md, paddingBottom: SP.xxl },

  resultHead: { ...T.label, color: C.textMuted, marginTop: SP.sm },

  hit: { padding: 0, overflow: 'hidden' },
  hitTop: { flexDirection: 'row', gap: SP.md, padding: SP.md },
  hitImg: { width: 56, height: 56, borderRadius: R.sm, backgroundColor: C.surfaceAlt },
  hitImgEmpty: { alignItems: 'center', justifyContent: 'center' },
  hitMeta: { flex: 1, gap: 2 },
  hitName: { ...T.bodyStrong, color: C.text },
  hitBrand: { ...T.caption, color: C.textMuted },
  hitStat: { ...T.caption, color: C.brand, marginTop: 2 },
  hitPending: { ...T.caption, color: C.warningBold ?? C.textMuted, marginTop: 2 },

  packs: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  pack: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingVertical: SP.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border,
  },
  packLeft: { flex: 1, gap: 1 },
  packSize: { ...T.bodyStrong, color: C.text },
  packSub: { ...T.caption, color: C.textMuted },
  packCta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  packCtaTxt: { ...T.labelStrong, color: C.brand },
  packMine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  packMineTxt: { ...T.label, color: C.brand },

  escape: { gap: SP.xs, marginTop: SP.md, alignItems: 'stretch' },
  escapeHint: { ...T.caption, color: C.textMuted, textAlign: 'center' },
});

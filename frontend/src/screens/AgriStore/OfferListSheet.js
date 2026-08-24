/**
 * OfferListSheet — every Krushi Seva Kendra selling this pack, buy-box order.
 *
 * WHY THIS IS ENTIRELY NEW UI, NOT A REFACTOR
 * There was no seller in the buyer app at all. The product page rendered a
 * hard-coded i18n string — "KrushiSarva Direct" — and no seller name, id, rating,
 * location or fulfilment data existed anywhere in `frontend/`. That was
 * truthful before the split, because a `products` row WAS one seller's offer and
 * there was nothing to choose between. Now three Kendras can sell the same seed
 * at three prices, so the buyer needs to see them and pick one.
 *
 * Ordering is the server's buy-box score, not price — the winner may be the
 * second-cheapest offer if it ships in a day instead of five. The list shows the
 * price difference against the winner so that is legible rather than mysterious.
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOWS } from '@cropsetu/shared/constants/colors';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import api from '@cropsetu/shared/services/api';
import { SkeletonList } from '../../components/ui/Skeleton';
import { fs } from '../../utils/responsive';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

function OfferRow({ offer, isWinner, winnerPrice, selected, onSelect, onAdd, adding, t }) {
  const delta = winnerPrice != null ? Number(offer.price) - Number(winnerPrice) : 0;

  return (
    <Pressable
      onPress={() => onSelect(offer)}
      style={({ pressed }) => [
        S.row,
        selected && S.rowSelected,
        pressed && { opacity: 0.85 },
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={t('offers.rowA11y', {
        seller: offer.sellerName,
        price: inr(offer.price),
        defaultValue: `${offer.sellerName}, ${inr(offer.price)}`,
      })}
    >
      <View style={S.rowRadio}>
        <Ionicons
          name={selected ? 'radio-button-on' : 'radio-button-off'}
          size={20}
          color={selected ? COLORS.primary : COLORS.textLight}
        />
      </View>

      <View style={S.rowMain}>
        <View style={S.rowTop}>
          <Text style={S.rowSeller} numberOfLines={1}>{offer.sellerName || t('offers.unnamedSeller', 'Krushi Seva Kendra')}</Text>
          {isWinner ? (
            <View style={S.winnerPill}>
              <Ionicons name="ribbon-outline" size={10} color={COLORS.white} />
              <Text style={S.winnerPillTxt}>{t('offers.featured', 'Featured')}</Text>
            </View>
          ) : null}
        </View>

        <View style={S.rowMeta}>
          {offer.sellerRatingCount > 0 ? (
            <View style={S.metaChip}>
              <Ionicons name="star" size={10} color={COLORS.amber ?? '#F5A623'} />
              <Text style={S.metaTxt}>{Number(offer.sellerRating).toFixed(1)}</Text>
            </View>
          ) : (
            <Text style={S.metaTxtMuted}>{t('offers.newSeller', 'New seller')}</Text>
          )}
          {offer.district ? (
            <Text style={S.metaTxtMuted} numberOfLines={1}>· {offer.district}</Text>
          ) : null}
          <Text style={S.metaTxtMuted}>
            · {t('offers.dispatchDays', { count: offer.dispatchSlaDays, defaultValue: `dispatch in ${offer.dispatchSlaDays}d` })}
          </Text>
        </View>

        {offer.stock <= 5 ? (
          <Text style={S.rowLowStock}>
            {t('offers.onlyLeft', { count: offer.stock, defaultValue: `Only ${offer.stock} left` })}
          </Text>
        ) : null}
      </View>

      <View style={S.rowRight}>
        <Text style={S.rowPrice}>{inr(offer.price)}</Text>
        {offer.mrp && Number(offer.mrp) > Number(offer.price) ? (
          <Text style={S.rowMrp}>{inr(offer.mrp)}</Text>
        ) : null}
        {delta > 0 ? (
          <Text style={S.rowDelta}>+{inr(delta)}</Text>
        ) : null}

        <Pressable
          onPress={() => onAdd(offer)}
          disabled={adding}
          style={({ pressed }) => [S.rowAdd, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
          accessibilityLabel={t('offers.addFromA11y', {
            seller: offer.sellerName,
            defaultValue: `Add to cart from ${offer.sellerName}`,
          })}
        >
          {adding
            ? <ActivityIndicator size="small" color={COLORS.primary} />
            : <Text style={S.rowAddTxt}>{t('offers.add', 'Add')}</Text>}
        </Pressable>
      </View>
    </Pressable>
  );
}

/**
 * @param productId   CATALOG product id — never a listing id
 * @param variantId   restrict to one pack size (optional)
 * @param district    the buyer's district; geography GATES eligibility, so the
 *                    same product genuinely has a different offer list per district
 */
export default function OfferListSheet({
  visible, onClose, productId, variantId, district,
  selectedListingId, onSelectOffer, onAddToCart, addingListingId,
}) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState({ loading: true, groups: [], error: null });

  useEffect(() => {
    if (!visible || !productId) return;
    let alive = true;
    setState({ loading: true, groups: [], error: null });

    const qs = new URLSearchParams();
    if (variantId) qs.set('variantId', variantId);
    if (district) qs.set('district', district);

    api.get(`/agristore/products/${productId}/offers?${qs.toString()}`)
      .then((res) => {
        if (!alive) return;
        setState({ loading: false, groups: res.data?.data?.variants || [], error: null });
      })
      .catch((err) => {
        if (!alive) return;
        setState({
          loading: false, groups: [],
          error: err?.response?.data?.error?.message || t('offers.loadError', 'Could not load the other sellers.'),
        });
      });

    return () => { alive = false; };
  }, [visible, productId, variantId, district, t]);

  const rows = state.groups.flatMap((g) => g.offers.map((o) => ({ ...o, _group: g })));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={S.backdrop} onPress={onClose} accessibilityLabel={t('close', 'Close')} />
      <View style={[S.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={S.grabber} />
        <View style={S.head}>
          <Text style={S.headTitle}>{t('offers.title', 'Choose a seller')}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('close', 'Close')}>
            <Ionicons name="close" size={22} color={COLORS.textDark} />
          </Pressable>
        </View>
        <Text style={S.headSub}>
          {t('offers.subtitle', 'Same product, different Kendras. Sorted by price, delivery speed and seller rating.')}
        </Text>

        {state.loading ? (
          // The sheet opens on nothing, so the offer rows are placeheld rather
          // than spun for — the list is the reason the sheet was opened.
          <SkeletonList rows={3} thumb="none" label={t('loading')} />
        ) : state.error ? (
          <View style={S.center}><Text style={S.errorTxt}>{state.error}</Text></View>
        ) : !rows.length ? (
          <View style={S.center}>
            <Text style={S.errorTxt}>
              {t('offers.noneInArea', 'No seller can deliver this to your area yet.')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(o) => o.listingId}
            renderItem={({ item, index }) => (
              <OfferRow
                offer={item}
                isWinner={item.listingId === item._group.winnerListingId}
                winnerPrice={index === 0 ? null : rows[0].price}
                selected={item.listingId === selectedListingId}
                onSelect={onSelectOffer}
                onAdd={onAddToCart}
                adding={addingListingId === item.listingId}
                t={t}
              />
            )}
            ItemSeparatorComponent={() => <View style={S.sep} />}
            contentContainerStyle={{ paddingBottom: 8 }}
          />
        )}
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '78%', backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 16, paddingTop: 8, ...SHADOWS.lg,
  },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: COLORS.border, marginBottom: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headTitle: { fontSize: fs(17), fontWeight: '800', color: COLORS.textDark },
  headSub: { fontSize: fs(11.5), color: COLORS.textLight, marginTop: 2, marginBottom: 10 },

  center: { paddingVertical: 36, alignItems: 'center' },
  errorTxt: { fontSize: fs(13), color: COLORS.textLight, textAlign: 'center' },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  rowSelected: { backgroundColor: COLORS.primaryPale ?? 'rgba(23,107,67,0.06)', borderRadius: 12, paddingHorizontal: 8 },
  rowRadio: { width: 28, alignItems: 'center' },
  rowMain: { flex: 1, paddingRight: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowSeller: { fontSize: fs(13.5), fontWeight: '700', color: COLORS.textDark, flexShrink: 1 },
  winnerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
  },
  winnerPillTxt: { fontSize: fs(9), fontWeight: '800', color: COLORS.white },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, flexWrap: 'wrap' },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  metaTxt: { fontSize: fs(11), fontWeight: '700', color: COLORS.textDark },
  metaTxtMuted: { fontSize: fs(11), color: COLORS.textLight },
  rowLowStock: { fontSize: fs(10.5), color: COLORS.danger ?? '#C62828', marginTop: 3, fontWeight: '700' },

  rowRight: { alignItems: 'flex-end', minWidth: 92 },
  rowPrice: { fontSize: fs(15), fontWeight: '800', color: COLORS.textDark },
  rowMrp: { fontSize: fs(11), color: COLORS.textLight, textDecorationLine: 'line-through' },
  rowDelta: { fontSize: fs(10.5), color: COLORS.textLight, marginTop: 1 },
  rowAdd: {
    marginTop: 6, borderWidth: 1.2, borderColor: COLORS.primary,
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 5, minWidth: 62, alignItems: 'center',
  },
  rowAddTxt: { fontSize: fs(12), fontWeight: '800', color: COLORS.primary },

  sep: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border },
});

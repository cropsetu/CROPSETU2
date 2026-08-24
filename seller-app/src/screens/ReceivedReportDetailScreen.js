/**
 * ReceivedReportDetailScreen — one shared AI crop report, plus the seller's
 * reply recommending products.
 *
 * Endpoints unchanged:
 *   GET  /api/v1/crop-reports/seller/inbox/:shareId
 *   POST /api/v1/crop-reports/seller/inbox/:shareId/reply
 *
 * THE SCREEN IS A CASE FILE THAT ENDS IN AN ACTION
 * ------------------------------------------------
 * It reads top to bottom as: what the farmer photographed → who they are →
 * what the AI concluded → what you can sell them → what you want to say. The
 * old version buried the evidence entirely and opened on a wall of grey metric
 * text.
 *
 *   - The scanned photos now lead the screen. `report.imageUrls` was ALREADY
 *     in this endpoint's payload (the route does `include: { report: true }`)
 *     and was simply never rendered — a seller was being asked to diagnose a
 *     crop problem from prose while the actual photographs sat unused in the
 *     response. No API change was needed to fix that.
 *   - Severity is a panel, not a caption: risk as an icon-bearing pill, the
 *     model's confidence as a Fraunces figure over a bar. Risk never relies on
 *     colour — HIGH and LOW are the red/green pair.
 *   - Every section uses the same `FormSection` shell as the two long forms,
 *     so a card of AI findings and a card of input fields are visibly the same
 *     kind of object.
 *   - The picker's cap is stated as "3 / 10" in the same figure style used for
 *     money, and the counter turns amber at the limit before the toast fires.
 *
 * BEHAVIOUR — unchanged and still guaranteed:
 *   - The "call farmer" button had an empty handler with a TODO. It places the
 *     call (and says so when the device can't).
 *   - The product picker is searchable and the 10-product limit the hint
 *     promises is actually enforced; the API was previously sent unbounded
 *     arrays.
 *   - The reply's 4-character minimum is explained rather than expressed only
 *     as a disabled button.
 *   - Draft replies survive a failed send instead of being at the mercy of a
 *     `load()` that overwrote them.
 *   - `shareId` is validated; arriving with no params used to fire
 *     `GET .../inbox/undefined`.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image, KeyboardAvoidingView, Linking, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import api, { safeErrorMessage } from '@krushisarva/shared/services/api';

import { C, E, HIT, R, SP, T, alpha, formatCurrency, riskMeta, useResponsive } from '../theme';
import useAsyncData from '../hooks/useAsyncData';
import { useNetwork } from '../hooks/useNetwork';
import {
  Screen, AppHeader, Card, Button, IconButton, PressableRow, Badge, FormSection,
  TextField, Field, CharCount, InlineNotice, ProgressBar, MetricRow,
  LoadingState, ErrorState, EmptyState,
  useToast,
} from '../components/ui';

const MAX_RECOMMENDED = 10;
const MIN_REPLY = 4;
const MAX_REPLY = 2000;
const MAX_SKU = 120;

// ── Building blocks ──────────────────────────────────────────────────────────

/** A finding. The marker is a small ember square, not a "•" glyph whose
 *  baseline shifts between fonts and platforms. */
function Bullet({ children }) {
  return (
    <View style={rd.bulletRow}>
      <View style={rd.bulletMark} />
      <Text style={rd.bulletTxt}>{children}</Text>
    </View>
  );
}

/** Normalises the several shapes the AI pipeline emits for a treatment entry. */
function treatmentLabel(entry) {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return '';
  const name = entry.name || entry.chemical || entry.method || '';
  const dose = entry.dose ? ` — ${entry.dose}` : '';
  const timing = entry.timing ? ` (${entry.timing})` : '';
  return `${name}${dose}${timing}`.trim();
}

// ── Product picker row ───────────────────────────────────────────────────────

const ProductPickRow = React.memo(function ProductPickRow({ product, checked, onToggle, disabled, t }) {
  const outOfStock = Number(product.stock) === 0;
  return (
    <PressableRow
      onPress={() => onToggle(product.id)}
      disabled={disabled && !checked}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: disabled && !checked }}
      accessibilityLabel={`${product.name}. ${formatCurrency(product.price)} per ${product.unit}. ${
        outOfStock ? t('share.outOfStock', 'out of stock') : `${product.stock} in stock`
      }`}
      style={[rd.productRow, checked && rd.productRowActive, disabled && !checked && { opacity: 0.45 }]}
    >
      <View style={[rd.checkbox, checked && rd.checkboxOn]}>
        {checked ? <Ionicons name="checkmark" size={15} color={C.onBrand} /> : null}
      </View>

      {product.images?.[0] ? (
        <Image
          source={{ uri: product.images[0] }}
          style={rd.productThumb}
          accessibilityIgnoresInvertColors
          accessible={false}
        />
      ) : (
        <View style={[rd.productThumb, rd.productThumbEmpty]}>
          <Ionicons name="leaf" size={18} color={C.textFaint} />
        </View>
      )}

      <View style={{ flex: 1 }}>
        <Text style={rd.productName} numberOfLines={1}>{product.name}</Text>
        <Text style={[rd.productMeta, outOfStock && { color: C.danger }]} numberOfLines={1}>
          {formatCurrency(product.price)}/{product.unit}
          {outOfStock
            ? ` · ${t('share.outOfStock', 'out of stock')}`
            : ` · ${t('myProducts.stock', { n: product.stock, unit: product.unit })}`}
        </Text>
      </View>
    </PressableRow>
  );
});

// ── Evidence strip ───────────────────────────────────────────────────────────

/**
 * The photographs the diagnosis was made from. First one large, the rest as a
 * scrolling row — a seller decides "is this the blight I think it is" from the
 * picture long before they read the confidence score.
 */
function EvidenceStrip({ urls, t, onOpen }) {
  if (!Array.isArray(urls) || urls.length === 0) return null;
  const [lead, ...rest] = urls;

  return (
    <View style={rd.evidence}>
      <Pressable
        onPress={() => onOpen(lead)}
        accessibilityRole="imagebutton"
        accessibilityLabel={t('share.cropPhoto', 'Crop photo from the farmer')}
        accessibilityHint={t('share.cropPhotoHint', 'Opens the full-size photo')}
        style={({ pressed }) => [rd.evidenceLeadWrap, pressed && { opacity: 0.85 }]}
      >
        <Image
          source={{ uri: lead }}
          style={rd.evidenceLead}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          accessible={false}
        />
      </Pressable>

      {rest.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={rd.evidenceRow}
        >
          {rest.map((uri, i) => (
            <Pressable
              key={`${uri}-${i}`}
              onPress={() => onOpen(uri)}
              accessibilityRole="imagebutton"
              accessibilityLabel={t('share.cropPhotoN', {
                n: i + 2,
                defaultValue: 'Crop photo {{n}}',
              })}
              style={({ pressed }) => [rd.evidenceThumbWrap, pressed && { opacity: 0.85 }]}
            >
              <Image
                source={{ uri }}
                style={rd.evidenceThumb}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
                accessible={false}
              />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function ReceivedReportDetailScreen({ route, navigation }) {
  const shareId = route.params?.shareId;
  const { t } = useLanguage();
  const toast = useToast();
  const { isOffline } = useNetwork();
  const { gutter, isExpanded, contentMaxWidth } = useResponsive();

  const [reply, setReply] = useState('');
  const [sku, setSku] = useState('');
  const [available, setAvailable] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyTouched, setReplyTouched] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Once the seller starts typing, a background refetch must not clobber the
  // draft. The old `load()` after a send did exactly that.
  const [draftDirty, setDraftDirty] = useState(false);

  const share = useAsyncData(
    useCallback(({ signal }) => {
      if (!shareId) throw Object.assign(new Error('Missing shareId'), { response: { status: 404 } });
      return api.get(`/crop-reports/seller/inbox/${shareId}`, { signal }).then((res) => res.data.data);
    }, [shareId]),
    [shareId],
    { enabled: true },
  );

  // Seed the reply form from the server exactly once, and never over a draft.
  useEffect(() => {
    const data = share.data;
    if (!data || draftDirty) return;
    if (data.sellerReply) setReply(data.sellerReply);
    if (data.recommendedSku) setSku(data.recommendedSku);
    if (data.available != null) setAvailable(!!data.available);
    if (Array.isArray(data.recommendedProductIds)) {
      setSelectedIds(new Set(data.recommendedProductIds));
    }
  }, [share.data, draftDirty]);

  const products = useAsyncData(
    useCallback(
      ({ signal }) => api.get('/agristore/seller/products?limit=50', { signal })
        .then((res) => res.data.data || []),
      [],
    ),
    [],
    { initialData: [] },
  );

  const productList = products.data || [];
  const atLimit = selectedIds.size >= MAX_RECOMMENDED;

  const toggleProduct = useCallback((id) => {
    setDraftDirty(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        // The hint promised "up to 10"; enforce it rather than silently sending
        // an unbounded array the backend may reject.
        if (next.size >= MAX_RECOMMENDED) {
          toast.warning(t('share.pickLimit', {
            n: MAX_RECOMMENDED,
            defaultValue: 'You can recommend up to {{n}} products.',
          }));
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  }, [toast, t]);

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return productList;
    return productList.filter((p) => String(p.name || '').toLowerCase().includes(q));
  }, [productList, productQuery]);

  const trimmedReply = reply.trim();
  const replyError = replyTouched && trimmedReply.length > 0 && trimmedReply.length < MIN_REPLY
    ? t('share.replyTooShortMsg', 'Please write at least a few words.')
    : null;

  const canSend = trimmedReply.length >= MIN_REPLY && !sending && !isOffline;

  const openLink = useCallback(async (url, failMsg) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('unsupported');
      await Linking.openURL(url);
    } catch {
      toast.error(failMsg);
    }
  }, [toast]);

  const callFarmer = useCallback((phone) => {
    const url = `tel:${String(phone).replace(/[^\d+]/g, '')}`;
    return openLink(url, t('share.callFailed', 'This device cannot place calls.'));
  }, [openLink, t]);

  const openPhoto = useCallback((url) => (
    openLink(url, t('common.linkFailed', 'Could not open the link on this device.'))
  ), [openLink, t]);

  const handleSend = useCallback(async () => {
    if (trimmedReply.length < MIN_REPLY) {
      setReplyTouched(true);
      toast.error(t('share.replyTooShortMsg', 'Please write at least a few words.'));
      return;
    }
    if (isOffline) {
      toast.warning(t('common.offlineAction', 'You are offline. Reconnect to save this.'));
      return;
    }

    setSending(true);
    try {
      await api.post(`/crop-reports/seller/inbox/${shareId}/reply`, {
        reply: trimmedReply,
        recommendedSku: sku.trim() || undefined,
        recommendedProductIds: Array.from(selectedIds),
        available,
      });
      toast.success(t('share.replySentMsg', 'The farmer will be notified of your recommendation.'));
      // The draft is now what the server holds, so refetching is safe.
      setDraftDirty(false);
      share.refresh();
    } catch (e) {
      toast.error(safeErrorMessage(e, t('share.replyFailed', 'Could not send')));
    } finally {
      setSending(false);
    }
  }, [trimmedReply, isOffline, shareId, sku, selectedIds, available, toast, t, share]);

  // ── Loading / error ────────────────────────────────────────────────────────
  if (share.isInitialLoading) {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <AppHeader title={t('share.loadingReport', 'Loading report')} onBack={() => navigation.goBack()} />
        <LoadingState />
      </Screen>
    );
  }

  if (share.error || !share.data) {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <AppHeader title={t('share.notFound', 'Report not found')} onBack={() => navigation.goBack()} />
        <ErrorState
          error={share.error || { message: t('share.notFound', 'Report not found'), status: 404 }}
          onRetry={shareId ? share.retry : undefined}
        />
      </Screen>
    );
  }

  // ── Derived report data ────────────────────────────────────────────────────
  const data = share.data;
  const report = data.report || {};
  const farmer = data.farmer || {};
  const full = report.fullReport || {};
  const treatment = full.treatment || {};

  const chemicals = treatment.chemical || treatment.chemical_controls || [];
  const organic = treatment.organic || treatment.organic_alternatives || [];
  const symptoms = Array.isArray(report.symptoms) ? report.symptoms : [];
  const weather = report.weatherSnapshot?.current || {};

  const alreadyReplied = data.status === 'REPLIED';
  const risk = riskMeta(report.riskLevel);
  const riskIsHigh = report.riskLevel === 'HIGH';
  const confidence = Math.round(report.confidenceScore || 0);

  const farmerLocation = [farmer.village, farmer.taluka, farmer.district].filter(Boolean).join(', ')
    || (farmer.phone ? `+91 ${farmer.phone}` : '—');

  const secondaryMetrics = [
    report.fieldArea ? { label: t('share.fieldArea', 'Field'), value: String(report.fieldArea) } : null,
    report.pincode ? { label: t('share.pincode', 'Pincode'), value: String(report.pincode) } : null,
    report.growthStage ? { label: t('share.stage', 'Stage'), value: String(report.growthStage) } : null,
  ].filter(Boolean);

  return (
    <Screen edges={['top', 'left', 'right']}>
      <AppHeader
        title={report.primaryDisease || t('share.unknownDisease', 'Unknown disease')}
        subtitle={[report.cropType, report.growthStage].filter(Boolean).join(' · ')}
        onBack={() => navigation.goBack()}
        titleNumberOfLines={2}
        right={
          <Badge
            label={alreadyReplied
              ? t('share.statusReplied', 'Replied')
              : t('share.statusPending', 'Pending')}
            color={alreadyReplied ? C.success : C.warning}
            icon={alreadyReplied ? 'checkmark-done' : 'hourglass-outline'}
          />
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView
          contentContainerStyle={[
            { padding: gutter, paddingBottom: SP.huge },
            isExpanded && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* ── The evidence ── */}
          <EvidenceStrip urls={report.imageUrls} t={t} onOpen={openPhoto} />

          {/* ── Farmer ── */}
          <Card style={rd.farmerCard}>
            <View style={rd.farmerAvatar}>
              <Ionicons name="person" size={20} color={C.brandInk} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={rd.farmerName} numberOfLines={1}>
                {farmer.name || (farmer.phone ? `+91 ${farmer.phone}` : t('orders.buyerFallback', 'Farmer'))}
              </Text>
              <Text style={rd.farmerMeta} numberOfLines={2}>{farmerLocation}</Text>
            </View>
            {farmer.phone ? (
              <IconButton
                icon="call"
                size={19}
                color={C.onBrand}
                background={C.brand}
                onPress={() => callFarmer(farmer.phone)}
                accessibilityLabel={t('share.callFarmer', 'Call farmer')}
                buttonStyle={rd.callBtn}
              />
            ) : null}
          </Card>

          {riskIsHigh ? (
            <InlineNotice variant="error" style={{ marginBottom: SP.lg }}>
              {t('share.highRiskNote', 'High risk — the farmer needs a fast, specific recommendation.')}
            </InlineNotice>
          ) : null}

          {/* ── Severity ── */}
          <FormSection icon="pulse-outline" title={t('share.summarySection', 'Diagnosis Summary')}>
            <View style={rd.severityRow}>
              <View style={[rd.riskPill, { backgroundColor: risk.tint, borderColor: alpha(risk.color, 0.3) }]}>
                <Ionicons name={risk.icon} size={15} color={risk.color} />
                <Text style={[rd.riskTxt, { color: risk.color }]} numberOfLines={1}>
                  {report.riskLevel
                    ? `${t('share.risk', 'Risk')}: ${report.riskLevel}`
                    : t('common.unknown', 'Unknown')}
                </Text>
              </View>
              <View style={rd.confidence}>
                <Text style={rd.confidenceLabel}>{t('share.confidence', 'Confidence')}</Text>
                <Text style={rd.confidenceFig}>{confidence}%</Text>
              </View>
            </View>

            <ProgressBar
              value={confidence}
              color={risk.color}
              label={t('share.confidence', 'Confidence')}
              style={{ marginTop: SP.lg }}
            />

            {secondaryMetrics.length > 0 ? (
              <MetricRow items={secondaryMetrics} style={{ marginTop: SP.xl }} />
            ) : null}
          </FormSection>

          {symptoms.length > 0 ? (
            <FormSection icon="medical-outline" title={t('share.symptomsSection', 'Symptoms reported')}>
              {symptoms.map((sym, i) => <Bullet key={`sym-${i}`}>{sym}</Bullet>)}
            </FormSection>
          ) : null}

          {data.message ? (
            <FormSection icon="chatbubble-outline" title={t('share.messageSection', "Farmer's note")}>
              <Text style={rd.quote}>{data.message}</Text>
            </FormSection>
          ) : null}

          {chemicals.length > 0 ? (
            <FormSection icon="flask-outline" title={t('share.aiChemicalSection', 'AI-suggested chemicals')}>
              {chemicals.slice(0, 6).map((c, i) => (
                <Bullet key={`chem-${i}`}>{treatmentLabel(c)}</Bullet>
              ))}
            </FormSection>
          ) : null}

          {organic.length > 0 ? (
            <FormSection icon="leaf-outline" title={t('share.organicSection', 'Organic alternatives')}>
              {organic.slice(0, 5).map((c, i) => (
                <Bullet key={`org-${i}`}>{treatmentLabel(c)}</Bullet>
              ))}
            </FormSection>
          ) : null}

          {weather.temp != null ? (
            <FormSection icon="cloud-outline" title={t('share.weatherSection', 'Weather at scan time')}>
              <Text style={rd.bulletTxt}>
                {weather.temp}°C, {weather.humidity}% {t('share.humidity', 'humidity')}
                {weather.weatherDesc ? ` — ${weather.weatherDesc}` : ''}
              </Text>
            </FormSection>
          ) : null}

          {/* ── Product picker ── */}
          <FormSection
            icon="cube-outline"
            title={t('share.productPickerSection', 'Suggest products from your shop')}
            hint={productList.length > 0
              ? t('share.productPickerHint', 'Select up to 10 products to recommend. The farmer can add them to cart or come collect.')
              : undefined}
          >
            {products.isInitialLoading ? (
              <LoadingState />
            ) : products.error && productList.length === 0 ? (
              <ErrorState error={products.error} onRetry={products.retry} compact />
            ) : productList.length === 0 ? (
              <EmptyState
                icon="cube-outline"
                compact
                title={t('share.noProductsTitle', 'No products yet')}
                body={t('share.noProductsYet', 'You haven\'t added any products yet. Tap "Add Product" on your dashboard first.')}
                actionLabel={t('dash.addProduct', 'Add product')}
                onAction={() => navigation.navigate('CatalogSearch')}
              />
            ) : (
              <>
                <View style={rd.pickerMeta}>
                  <Text
                    style={[rd.pickerCount, atLimit && { color: C.warning }]}
                    accessibilityLabel={t('share.selectedCount', {
                      n: selectedIds.size,
                      max: MAX_RECOMMENDED,
                      defaultValue: '{{n}} of {{max}} selected',
                    })}
                  >
                    {selectedIds.size}
                    <Text style={rd.pickerCountDim}> / {MAX_RECOMMENDED}</Text>
                  </Text>
                  {/* The figure already carries the full sentence as its
                      accessibility label; this word is the visual gloss only. */}
                  <Text
                    style={rd.pickerCountLabel}
                    numberOfLines={1}
                    importantForAccessibility="no"
                    accessibilityElementsHidden
                  >
                    {t('share.selectedLabel', 'selected')}
                  </Text>
                  {selectedIds.size > 0 ? (
                    <Button
                      label={t('common.clear', 'Clear')}
                      variant="ghost"
                      size="sm"
                      onPress={() => { setDraftDirty(true); setSelectedIds(new Set()); }}
                    />
                  ) : null}
                </View>

                {/* Search appears only when the list is long enough to need it. */}
                {productList.length > 6 ? (
                  <TextField
                    value={productQuery}
                    onChangeText={setProductQuery}
                    placeholder={t('share.searchProducts', 'Search your products…')}
                    label={t('share.searchProducts', 'Search your products')}
                    autoCapitalize="none"
                    autoCorrect={false}
                    prefix={<Ionicons name="search" size={16} color={C.textFaint} />}
                    style={{ marginBottom: SP.lg }}
                  />
                ) : null}

                {filteredProducts.length === 0 ? (
                  <Text style={rd.pickerHint}>
                    {t('locationPicker.noResults', { query: productQuery, defaultValue: 'No matches.' })}
                  </Text>
                ) : (
                  filteredProducts.map((p) => (
                    <ProductPickRow
                      key={String(p.id)}
                      product={p}
                      checked={selectedIds.has(p.id)}
                      onToggle={toggleProduct}
                      disabled={atLimit}
                      t={t}
                    />
                  ))
                )}
              </>
            )}
          </FormSection>

          {/* ── Reply ── */}
          <FormSection
            icon="create-outline"
            title={alreadyReplied
              ? t('share.editReplySection', 'Update your recommendation')
              : t('share.replySection', 'Your recommendation')}
          >
            <Field
              label={t('share.replyLabel', 'Recommended pesticide / fungicide / dose')}
              required
              error={replyError}
            >
              <TextField
                value={reply}
                onChangeText={(v) => { setReply(v); setDraftDirty(true); }}
                onBlur={() => setReplyTouched(true)}
                placeholder={t('share.replyPlaceholder', 'e.g. Spray Mancozeb 75% WP @ 2g/L water at 7-day interval. 2 sprays.')}
                label={t('share.replyLabel', 'Recommendation')}
                multiline
                maxLength={MAX_REPLY}
                error={replyError}
              />
              <CharCount value={reply} max={MAX_REPLY} />
            </Field>

            <Field label={t('share.skuLabel', 'Product SKU / name in your shop (optional)')}>
              <TextField
                value={sku}
                onChangeText={(v) => { setSku(v); setDraftDirty(true); }}
                placeholder={t('share.skuPlaceholder', 'e.g. Indofil M-45 500g')}
                label={t('share.skuLabel', 'Product SKU')}
                maxLength={MAX_SKU}
              />
            </Field>

            <View style={rd.availableRow}>
              <View style={{ flex: 1 }}>
                <Text style={rd.availableTitle}>{t('share.availableTitle', 'I have this in stock')}</Text>
                <Text style={rd.availableSub}>
                  {t('share.availableSub', 'The farmer will get a notification asking them to come collect it.')}
                </Text>
              </View>
              <Switch
                value={available}
                onValueChange={(v) => { setAvailable(v); setDraftDirty(true); }}
                trackColor={{ false: C.surfaceSunken, true: alpha(C.brand, 0.5) }}
                thumbColor={available ? C.brand : C.surface}
                ios_backgroundColor={C.surfaceSunken}
                accessibilityLabel={t('share.availableTitle', 'I have this in stock')}
                accessibilityState={{ checked: available }}
              />
            </View>

            {/* Say WHY the button is unavailable rather than just greying it. */}
            {trimmedReply.length < MIN_REPLY ? (
              <InlineNotice variant="info" style={{ marginTop: SP.lg }}>
                {t('share.replyRequiredHint', 'Write your recommendation above to send it.')}
              </InlineNotice>
            ) : isOffline ? (
              <InlineNotice variant="warning" style={{ marginTop: SP.lg }}>
                {t('common.offlineAction', 'You are offline. Reconnect to save this.')}
              </InlineNotice>
            ) : null}

            <Button
              label={alreadyReplied
                ? t('share.updateCta', 'Update recommendation')
                : t('share.sendReplyCta', 'Send recommendation')}
              icon="paper-plane"
              size="lg"
              fullWidth
              loading={sending}
              disabled={!canSend}
              onPress={handleSend}
              style={{ marginTop: SP.xl }}
            />
          </FormSection>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const rd = StyleSheet.create({
  // ── Evidence ──
  evidence: { marginBottom: SP.lg, gap: SP.sm },
  evidenceLeadWrap: {
    borderRadius: R.xl,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceSunken,
    overflow: 'hidden',
    ...E.card,
  },
  evidenceLead: { width: '100%', height: 200 },
  evidenceRow: { flexDirection: 'row', gap: SP.sm, paddingVertical: SP.xs },
  evidenceThumbWrap: {
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceSunken,
    overflow: 'hidden',
  },
  evidenceThumb: { width: 68, height: 68 },

  // ── Farmer ──
  farmerCard: { flexDirection: 'row', alignItems: 'center', gap: SP.lg, marginBottom: SP.lg },
  farmerAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.brandPale,
    borderWidth: 1,
    borderColor: alpha(C.brand, 0.25),
    alignItems: 'center', justifyContent: 'center',
  },
  farmerName: { ...T.bodyBold, color: C.text },
  farmerMeta: { ...T.caption, color: C.textMuted, marginTop: 2 },
  callBtn: {
    width: HIT.minCompact,
    height: HIT.minCompact,
    borderRadius: HIT.minCompact / 2,
    ...E.brand,
  },

  // ── Severity ──
  severityRow: { flexDirection: 'row', alignItems: 'center', gap: SP.lg },
  riskPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    borderRadius: R.pill,
    borderWidth: 1,
    paddingHorizontal: SP.lg,
    paddingVertical: SP.sm,
    flexShrink: 1,
  },
  riskTxt: { ...T.micro, textTransform: 'uppercase' },
  confidence: { marginLeft: 'auto', alignItems: 'flex-end' },
  confidenceLabel: { ...T.micro, color: C.textMuted, textTransform: 'uppercase' },
  confidenceFig: { ...T.figureMd, color: C.text },

  // ── Findings ──
  bulletRow: { flexDirection: 'row', gap: SP.md, marginBottom: SP.md, alignItems: 'flex-start' },
  bulletMark: {
    width: 6, height: 6, borderRadius: 2,
    backgroundColor: C.brand,
    marginTop: 8,
  },
  bulletTxt: { ...T.body, flex: 1, color: C.textBody },
  quote: { ...T.body, color: C.textBody, fontStyle: 'italic' },

  // ── Picker ──
  pickerHint: { ...T.caption, color: C.textMuted, marginBottom: SP.md },
  pickerMeta: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginBottom: SP.lg },
  pickerCount: { ...T.figureSm, color: C.text },
  pickerCountDim: { color: C.textFaint },
  pickerCountLabel: { ...T.caption, color: C.textMuted, flex: 1 },

  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    padding: SP.md,
    minHeight: HIT.min + 8,
    borderRadius: R.md,
    marginBottom: SP.sm,
    borderWidth: 1.5,
    borderColor: C.borderStrong,
    backgroundColor: C.surface,
  },
  productRowActive: { borderColor: C.brand, backgroundColor: C.brandPale },
  checkbox: {
    width: 24, height: 24, borderRadius: R.xs,
    borderWidth: 2, borderColor: C.borderStrong,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surface,
  },
  checkboxOn: { backgroundColor: C.brand, borderColor: C.brand },
  productThumb: { width: 44, height: 44, borderRadius: R.sm, backgroundColor: C.surfaceSunken },
  productThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  productName: { ...T.label, color: C.text },
  productMeta: { ...T.caption, color: C.textMuted, marginTop: 2 },

  // ── Availability ──
  availableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.lg,
    marginTop: SP.sm,
    padding: SP.lg,
    borderRadius: R.md,
    backgroundColor: C.brandPale,
    borderWidth: 1.5,
    borderColor: alpha(C.brand, 0.28),
  },
  availableTitle: { ...T.bodyBold, color: C.brandInk },
  availableSub: { ...T.caption, color: C.textMuted, marginTop: 3 },
});

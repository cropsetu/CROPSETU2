/**
 * ReceivedReportDetailScreen — Seller view of one shared AI crop report
 * with a reply box to recommend pesticides/fungicides to the farmer.
 *
 * Uses:
 *   GET  /api/v1/crop-reports/seller/inbox/:shareId
 *   POST /api/v1/crop-reports/seller/inbox/:shareId/reply
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, SafeAreaView, Alert, KeyboardAvoidingView, Platform, Switch, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOWS, RADIUS } from '../../constants/colors';
import { useLanguage } from '../../context/LanguageContext';
import api, { safeErrorMessage } from '../../services/api';

function Section({ icon, title, children }) {
  return (
    <View style={S.section}>
      <View style={S.sectionHead}>
        <Ionicons name={icon} size={16} color={COLORS.sellerPrimary} />
        <Text style={S.sectionTitle}>{title}</Text>
      </View>
      <View>{children}</View>
    </View>
  );
}

function Bullet({ children }) {
  return (
    <View style={S.bulletRow}>
      <Text style={S.bulletDot}>•</Text>
      <Text style={S.bulletTxt}>{children}</Text>
    </View>
  );
}

export default function ReceivedReportDetailScreen({ route, navigation }) {
  const { shareId } = route.params || {};
  const { t } = useLanguage();
  const [share, setShare]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [reply, setReply]     = useState('');
  const [sku, setSku]         = useState('');
  const [available, setAvailable] = useState(false);
  const [sending, setSending] = useState(false);

  // Product picker state
  const [myProducts, setMyProducts]   = useState([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState(new Set());
  const toggleProduct = (id) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get(`/crop-reports/seller/inbox/${shareId}`);
      const data = res.data.data;
      setShare(data);
      if (data?.sellerReply)    setReply(data.sellerReply);
      if (data?.recommendedSku) setSku(data.recommendedSku);
      if (data?.available != null) setAvailable(!!data.available);
      if (Array.isArray(data?.recommendedProductIds)) {
        setSelectedProductIds(new Set(data.recommendedProductIds));
      }
    } catch (e) {
      setError(safeErrorMessage(e));
    }
  }, [shareId]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  // Load the seller's own products once for the recommendation picker.
  useEffect(() => {
    let cancelled = false;
    api.get('/agristore/seller/products?limit=50')
      .then((res) => {
        if (cancelled) return;
        setMyProducts(res.data.data || []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setProductsLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const handleSend = async () => {
    if (reply.trim().length < 4) {
      Alert.alert(t('share.replyTooShort', 'Reply too short'), t('share.replyTooShortMsg', 'Please write at least a few words.'));
      return;
    }
    setSending(true);
    try {
      await api.post(`/crop-reports/seller/inbox/${shareId}/reply`, {
        reply: reply.trim(),
        recommendedSku: sku.trim() || undefined,
        recommendedProductIds: Array.from(selectedProductIds),
        available,
      });
      Alert.alert(t('share.replySent', 'Recommendation sent'), t('share.replySentMsg', 'The farmer will be notified of your recommendation.'));
      load();
    } catch (e) {
      Alert.alert(t('share.replyFailed', 'Could not send'), safeErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={S.center}>
        <ActivityIndicator size="large" color={COLORS.sellerPrimary} />
      </SafeAreaView>
    );
  }

  if (error || !share) {
    return (
      <SafeAreaView style={S.center}>
        <Ionicons name="alert-circle-outline" size={48} color={COLORS.error} />
        <Text style={S.errTxt}>{error || t('share.notFound', 'Report not found')}</Text>
        <TouchableOpacity style={S.retryBtn} onPress={() => navigation.goBack()}>
          <Text style={S.retryTxt}>{t('back', 'Back')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const r = share.report || {};
  const farmer = share.farmer || {};
  const full = r.fullReport || {};
  const treatment = full.treatment || {};
  const chemicals = treatment.chemical || treatment.chemical_controls || [];
  const organic   = treatment.organic  || treatment.organic_alternatives || [];
  const followUp  = full.follow_up_schedule || full.followUpSchedule || [];
  const symptoms  = Array.isArray(r.symptoms) ? r.symptoms : [];
  const weatherSnapshot = r.weatherSnapshot || {};
  const weather = weatherSnapshot.current || {};

  const alreadyReplied = share.status === 'REPLIED';

  return (
    <SafeAreaView style={S.safe}>
      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.white} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle} numberOfLines={1}>{r.primaryDisease || t('share.unknownDisease', 'Unknown disease')}</Text>
          <Text style={S.headerSub}>{r.cropType}{r.growthStage ? ` · ${r.growthStage}` : ''}</Text>
        </View>
        <View style={[S.statusBadge, alreadyReplied && S.statusBadgeReplied]}>
          <Text style={[S.statusBadgeTxt, alreadyReplied && { color: COLORS.primary }]}>
            {alreadyReplied ? t('share.statusReplied', 'Replied') : t('share.statusPending', 'Pending')}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>

          {/* Farmer card */}
          <View style={S.farmerCard}>
            <View style={S.avatar}><Ionicons name="person" size={20} color={COLORS.white} /></View>
            <View style={{ flex: 1 }}>
              <Text style={S.farmerName}>{farmer.name || `+91 ${farmer.phone}`}</Text>
              <Text style={S.farmerMeta}>
                {[farmer.village, farmer.taluka, farmer.district].filter(Boolean).join(', ') || `+91 ${farmer.phone}`}
              </Text>
            </View>
            {farmer.phone ? (
              <TouchableOpacity style={S.phoneBtn} onPress={() => {/* tel: link could go here */}}>
                <Ionicons name="call-outline" size={18} color={COLORS.sellerPrimary} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Disease summary */}
          <Section icon="bug-outline" title={t('share.summarySection', 'Diagnosis Summary')}>
            <Text style={S.metric}>
              {t('share.confidence', 'Confidence')}: <Text style={S.metricVal}>{Math.round(r.confidenceScore || 0)}%</Text>
            </Text>
            <Text style={S.metric}>
              {t('share.risk', 'Risk')}: <Text style={[S.metricVal, { color: r.riskLevel === 'HIGH' ? COLORS.error : COLORS.amberDark }]}>{r.riskLevel}</Text>
            </Text>
            {r.fieldArea ? (
              <Text style={S.metric}>
                {t('share.fieldArea', 'Field')}: <Text style={S.metricVal}>{r.fieldArea}</Text>
              </Text>
            ) : null}
            {r.pincode ? (
              <Text style={S.metric}>
                {t('share.pincode', 'Pincode')}: <Text style={S.metricVal}>{r.pincode}</Text>
              </Text>
            ) : null}
          </Section>

          {/* Symptoms */}
          {symptoms.length > 0 ? (
            <Section icon="medical-outline" title={t('share.symptomsSection', 'Symptoms reported')}>
              {symptoms.map((s, i) => <Bullet key={i}>{s}</Bullet>)}
            </Section>
          ) : null}

          {/* Farmer message */}
          {share.message ? (
            <Section icon="chatbubble-outline" title={t('share.messageSection', "Farmer's note")}>
              <Text style={S.bulletTxt}>{share.message}</Text>
            </Section>
          ) : null}

          {/* AI suggested chemicals */}
          {chemicals.length > 0 ? (
            <Section icon="flask-outline" title={t('share.aiChemicalSection', 'AI-suggested chemicals')}>
              {chemicals.slice(0, 6).map((c, i) => (
                <Bullet key={i}>
                  {typeof c === 'string'
                    ? c
                    : `${c.name || c.chemical || ''}${c.dose ? ` — ${c.dose}` : ''}${c.timing ? ` (${c.timing})` : ''}`}
                </Bullet>
              ))}
            </Section>
          ) : null}

          {/* Organic alternatives */}
          {organic.length > 0 ? (
            <Section icon="leaf-outline" title={t('share.organicSection', 'Organic alternatives')}>
              {organic.slice(0, 5).map((c, i) => (
                <Bullet key={i}>{typeof c === 'string' ? c : (c.name || c.method || '')}</Bullet>
              ))}
            </Section>
          ) : null}

          {/* Weather snapshot */}
          {weather.temp != null ? (
            <Section icon="cloud-outline" title={t('share.weatherSection', 'Weather at scan time')}>
              <Text style={S.bulletTxt}>
                {weather.temp}°C, {weather.humidity}% {t('share.humidity', 'humidity')}
                {weather.weatherDesc ? ` — ${weather.weatherDesc}` : ''}
              </Text>
            </Section>
          ) : null}

          {/* Product recommendation — pick from this seller's inventory */}
          <Section icon="cube-outline" title={t('share.productPickerSection', 'Suggest products from your shop')}>
            {!productsLoaded ? (
              <ActivityIndicator color={COLORS.sellerPrimary} />
            ) : myProducts.length === 0 ? (
              <Text style={S.bulletTxt}>
                {t('share.noProductsYet', 'You haven\'t added any products yet. Tap "Add Product" on your dashboard first.')}
              </Text>
            ) : (
              <>
                <Text style={S.label}>
                  {t('share.productPickerHint', 'Select up to 10 products to recommend. The farmer can add them to cart or come collect.')}
                </Text>
                {myProducts.map((p) => {
                  const checked = selectedProductIds.has(p.id);
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[S.productRow, checked && S.productRowActive]}
                      onPress={() => toggleProduct(p.id)}
                      activeOpacity={0.85}
                    >
                      <View style={[S.checkbox, checked && S.checkboxActive]}>
                        {checked ? <Ionicons name="checkmark" size={14} color={COLORS.white} /> : null}
                      </View>
                      {p.images?.[0] ? (
                        <Image source={{ uri: p.images[0] }} style={S.productThumb} />
                      ) : (
                        <View style={[S.productThumb, S.productThumbEmpty]}>
                          <Ionicons name="leaf" size={18} color={COLORS.gray175} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={S.productName} numberOfLines={1}>{p.name}</Text>
                        <Text style={S.productMeta} numberOfLines={1}>
                          ₹{p.price}/{p.unit}{p.stock > 0 ? ` · ${p.stock} in stock` : ` · ${t('share.outOfStock', 'out of stock')}`}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </Section>

          {/* Reply form */}
          <Section icon="create-outline" title={alreadyReplied ? t('share.editReplySection', 'Update your recommendation') : t('share.replySection', 'Your recommendation')}>
            <Text style={S.label}>{t('share.replyLabel', 'Recommended pesticide / fungicide / dose')}</Text>
            <TextInput
              style={S.replyInput}
              value={reply}
              onChangeText={setReply}
              placeholder={t('share.replyPlaceholder', 'e.g. Spray Mancozeb 75% WP @ 2g/L water at 7-day interval. 2 sprays.')}
              placeholderTextColor={COLORS.textLight}
              multiline
              maxLength={2000}
            />
            <Text style={S.label}>{t('share.skuLabel', 'Product SKU / name in your shop (optional)')}</Text>
            <TextInput
              style={S.skuInput}
              value={sku}
              onChangeText={setSku}
              placeholder={t('share.skuPlaceholder', 'e.g. Indofil M-45 500g')}
              placeholderTextColor={COLORS.textLight}
              maxLength={120}
            />

            <View style={S.availableRow}>
              <View style={{ flex: 1 }}>
                <Text style={S.availableTitle}>{t('share.availableTitle', 'I have this in stock')}</Text>
                <Text style={S.availableSub}>
                  {t('share.availableSub', 'The farmer will get a notification asking them to come collect it.')}
                </Text>
              </View>
              <Switch
                value={available}
                onValueChange={setAvailable}
                trackColor={{ false: COLORS.gray175, true: COLORS.sellerPrimary }}
                thumbColor={COLORS.white}
              />
            </View>

            <TouchableOpacity
              style={[S.sendBtn, (sending || reply.trim().length < 4) && S.sendBtnDisabled]}
              onPress={handleSend}
              disabled={sending || reply.trim().length < 4}
              activeOpacity={0.85}
            >
              {sending ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <>
                  <Ionicons name="paper-plane" size={16} color={COLORS.white} />
                  <Text style={S.sendBtnTxt}>
                    {alreadyReplied ? t('share.updateCta', 'Update recommendation') : t('share.sendReplyCta', 'Send recommendation')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </Section>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.sellerBg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.sellerBg, gap: 12 },
  errTxt: { fontSize: 14, color: COLORS.textMedium, textAlign: 'center', paddingHorizontal: 24 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: COLORS.sellerPrimary + '15' },
  retryTxt: { color: COLORS.sellerPrimary, fontWeight: '700' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 14,
    backgroundColor: COLORS.cta,
  },
  backBtn:     { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: COLORS.white },
  headerSub:   { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 1 },
  statusBadge: { backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeReplied: { backgroundColor: COLORS.successLight },
  statusBadgeTxt: { fontSize: 10, fontWeight: '800', color: COLORS.white, textTransform: 'uppercase' },

  farmerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg, marginBottom: 14, ...SHADOWS.small,
  },
  avatar:     { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.sellerPrimary, justifyContent: 'center', alignItems: 'center' },
  farmerName: { fontSize: 15, fontWeight: '800', color: COLORS.textDark },
  farmerMeta: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  phoneBtn:   { padding: 8, borderRadius: 20, backgroundColor: COLORS.sellerPrimary + '12' },

  section: { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: 14, marginBottom: 12, ...SHADOWS.small },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: COLORS.textDark, textTransform: 'uppercase' },

  metric:    { fontSize: 13, color: COLORS.textMedium, marginBottom: 4 },
  metricVal: { fontWeight: '800', color: COLORS.textDark },
  bulletRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  bulletDot: { color: COLORS.sellerPrimary, fontWeight: '900' },
  bulletTxt: { flex: 1, fontSize: 13, color: COLORS.textDark, lineHeight: 19 },

  label:     { fontSize: 12, fontWeight: '700', color: COLORS.textMedium, marginBottom: 6, marginTop: 8 },
  replyInput:{ borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: 10, fontSize: 14, color: COLORS.textDark, minHeight: 96, textAlignVertical: 'top' },
  skuInput:  { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: 10, fontSize: 14, color: COLORS.textDark },

  availableRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, padding: 12, borderRadius: RADIUS.md, backgroundColor: COLORS.sellerPrimary + '08', borderWidth: 1, borderColor: COLORS.sellerPrimary + '30' },
  availableTitle: { fontSize: 13, fontWeight: '800', color: COLORS.sellerPrimary },
  availableSub:   { fontSize: 11, color: COLORS.textMedium, marginTop: 2, lineHeight: 15 },

  productRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 8, marginBottom: 6, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white },
  productRowActive: { borderColor: COLORS.sellerPrimary, backgroundColor: COLORS.sellerPrimary + '08' },
  checkbox:         { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: COLORS.gray175, justifyContent: 'center', alignItems: 'center' },
  checkboxActive:   { backgroundColor: COLORS.sellerPrimary, borderColor: COLORS.sellerPrimary },
  productThumb:     { width: 40, height: 40, borderRadius: 6, backgroundColor: COLORS.surface },
  productThumbEmpty:{ justifyContent: 'center', alignItems: 'center' },
  productName:      { fontSize: 13, fontWeight: '700', color: COLORS.textDark },
  productMeta:      { fontSize: 11, color: COLORS.textMedium, marginTop: 1 },

  sendBtn:        { marginTop: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: COLORS.sellerPrimary, paddingVertical: 14, borderRadius: RADIUS.md },
  sendBtnDisabled:{ backgroundColor: COLORS.gray175 },
  sendBtnTxt:     { color: COLORS.white, fontSize: 14, fontWeight: '800' },
});

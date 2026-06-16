/**
 * KrushiKendraShareSheet — bottom-sheet modal for sending an AI crop report
 * to a nearby Krushi Kendra (agri-input shop) seller.
 *
 * Props:
 *   visible    : boolean
 *   onClose    : () => void
 *   reportId   : string  (CropDiseaseReport.id, returned by /predict)
 *   reportSummary : { cropType, primaryDisease, riskLevel } — shown in confirm step
 *   onShared   : (share) => void   (optional — fired after a successful share)
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, TextInput, StyleSheet, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SHADOWS } from '../constants/colors';
import { useLanguage } from '../context/LanguageContext';
import api, { safeErrorMessage } from '../services/api';

const PROXIMITY_LABELS = {
  gps:      { tKey: 'gpsNear',      color: COLORS.primary },
  taluka:   { tKey: 'sameTaluka',   color: COLORS.primary },
  district: { tKey: 'sameDistrict', color: COLORS.amberDark },
};

function formatDistance(km, t) {
  if (km == null) return null;
  if (km < 1) return t('share.metersAway', { n: Math.round(km * 1000), defaultValue: '{{n}} m away' });
  return t('share.kmAway', { n: km < 10 ? km.toFixed(1) : Math.round(km), defaultValue: '{{n}} km away' });
}

export default function KrushiKendraShareSheet({
  visible, onClose, reportId, reportSummary = {}, onShared,
}) {
  const { t } = useLanguage();
  const [loading, setLoading]   = useState(false);
  const [sending, setSending]   = useState(false);
  const [sellers, setSellers]   = useState([]);
  const [meta, setMeta]         = useState(null);
  const [selected, setSelected] = useState(null);
  const [message, setMessage]   = useState('');
  const [error, setError]       = useState(null);

  const fetchSellers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/crop-reports/sellers/nearby');
      setSellers(res.data.data || []);
      setMeta(res.data.meta || null);
    } catch (e) {
      setError(safeErrorMessage(e, t('share.loadFailed', 'Could not load nearby sellers.')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (visible) {
      setSelected(null);
      setMessage('');
      fetchSellers();
    }
  }, [visible, fetchSellers]);

  const handleSend = async () => {
    if (!selected || !reportId) return;
    setSending(true);
    try {
      const res = await api.post(`/crop-reports/${reportId}/share`, {
        sellerId: selected.id,
        message:  message.trim() || undefined,
      });
      const share = res.data.data;
      onShared?.(share);
      Alert.alert(
        t('share.sentTitle', 'Sent'),
        t('share.sentBody', { name: selected.name || selected.phone, defaultValue: 'Report sent to {{name}}. They will be notified.' }),
        [{ text: t('ok', 'OK'), onPress: onClose }],
      );
    } catch (e) {
      Alert.alert(t('share.sendFailed', 'Could not send'), safeErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={S.backdrop}>
        <View style={S.sheet}>
          {/* Handle */}
          <View style={S.handleWrap}><View style={S.handle} /></View>

          {/* Header */}
          <View style={S.header}>
            <View style={{ flex: 1 }}>
              <Text style={S.title}>{t('share.title', 'Send to Krushi Kendra')}</Text>
              {reportSummary?.primaryDisease ? (
                <Text style={S.subtitle} numberOfLines={1}>
                  {reportSummary.cropType ? `${reportSummary.cropType} · ` : ''}{reportSummary.primaryDisease}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close" size={24} color={COLORS.textMedium} />
            </TouchableOpacity>
          </View>

          {/* Body */}
          {loading ? (
            <View style={S.loadingBox}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={S.loadingText}>{t('share.loading', 'Finding nearby Krushi Kendra…')}</Text>
            </View>
          ) : error ? (
            <View style={S.emptyBox}>
              <Ionicons name="cloud-offline-outline" size={42} color={COLORS.textLight} />
              <Text style={S.emptyTitle}>{error}</Text>
              <TouchableOpacity style={S.retryBtn} onPress={fetchSellers}>
                <Text style={S.retryText}>{t('retry', 'Retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : sellers.length === 0 ? (
            <View style={S.emptyBox}>
              <Ionicons name="leaf-outline" size={42} color={COLORS.textLight} />
              <Text style={S.emptyTitle}>{t('share.emptyTitle', 'No Krushi Kendra found nearby')}</Text>
              <Text style={S.emptyText}>
                {t('share.emptyText', 'No registered Krushi Kendra in your district yet. Try again later.')}
              </Text>
            </View>
          ) : (
            <>
              {meta?.farmerDistrict ? (
                <Text style={S.locationHint}>
                  <Ionicons name="location" size={12} color={COLORS.textLight} />{' '}
                  {meta.farmerTaluka ? `${meta.farmerTaluka}, ` : ''}{meta.farmerDistrict}
                </Text>
              ) : null}

              <ScrollView style={S.list} showsVerticalScrollIndicator={false}>
                {sellers.map((seller) => {
                  const isActive = selected?.id === seller.id;
                  const proxConf = PROXIMITY_LABELS[seller.proximity] || PROXIMITY_LABELS.district;
                  const distLabel = formatDistance(seller.distanceKm, t);
                  return (
                    <TouchableOpacity
                      key={seller.id}
                      style={[S.sellerCard, isActive && S.sellerCardActive]}
                      onPress={() => setSelected(seller)}
                      activeOpacity={0.85}
                    >
                      <View style={[S.sellerIcon, { backgroundColor: COLORS.primary + '15' }]}>
                        <Ionicons name="storefront" size={20} color={COLORS.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={S.sellerName} numberOfLines={1}>{seller.name || `+91 ${seller.phone}`}</Text>
                          {distLabel ? (
                            <View style={S.distancePill}>
                              <Ionicons name="navigate" size={10} color={COLORS.primary} />
                              <Text style={S.distanceTxt}>{distLabel}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={S.sellerMeta} numberOfLines={1}>
                          {[seller.village, seller.taluka].filter(Boolean).join(', ')}
                        </Text>
                        <View style={S.sellerBadges}>
                          <View style={[S.badge, { backgroundColor: proxConf.color + '18' }]}>
                            <Text style={[S.badgeTxt, { color: proxConf.color }]}>{t(`share.${proxConf.tKey}`, proxConf.tKey)}</Text>
                          </View>
                          {seller.productCount > 0 ? (
                            <View style={[S.badge, { backgroundColor: COLORS.textLight + '20' }]}>
                              <Text style={[S.badgeTxt, { color: COLORS.textMedium }]}>
                                {t('share.productCount', { count: seller.productCount, defaultValue: '{{count}} products' })}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      {isActive ? (
                        <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />
                      ) : (
                        <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {selected ? (
                <View style={S.composeBox}>
                  <Text style={S.composeLabel}>{t('share.messageLabel', 'Add a note (optional)')}</Text>
                  <TextInput
                    style={S.input}
                    value={message}
                    onChangeText={setMessage}
                    placeholder={t('share.messagePlaceholder', 'Mention specific concerns or budget…')}
                    placeholderTextColor={COLORS.textLight}
                    multiline
                    maxLength={500}
                  />
                </View>
              ) : null}

              <TouchableOpacity
                style={[S.sendBtn, (!selected || sending) && S.sendBtnDisabled]}
                onPress={handleSend}
                disabled={!selected || sending}
                activeOpacity={0.85}
              >
                {sending ? (
                  <ActivityIndicator color={COLORS.white} size="small" />
                ) : (
                  <>
                    <Ionicons name="paper-plane" size={16} color={COLORS.white} />
                    <Text style={S.sendBtnText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                      {selected
                        ? t('share.sendCta', { name: selected.name || `+91 ${selected.phone}`, defaultValue: 'Send to {{name}}' })
                        : t('share.pickFirst', 'Pick a Krushi Kendra')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: 18, paddingBottom: Platform.OS === 'ios' ? 32 : 18,
    maxHeight: '88%',
  },
  handleWrap: { alignItems: 'center', paddingVertical: 10 },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.gray175 },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title: { fontSize: 18, fontWeight: '800', color: COLORS.textDark },
  subtitle: { fontSize: 13, color: COLORS.textMedium, marginTop: 2 },
  locationHint: { fontSize: 12, color: COLORS.textLight, marginTop: 10, marginBottom: 6 },
  list: { maxHeight: 360, marginTop: 6 },

  sellerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, borderRadius: RADIUS.md, marginBottom: 8,
    borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white,
  },
  sellerCardActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '08' },
  sellerIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  sellerName: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  sellerMeta: { fontSize: 12, color: COLORS.textMedium, marginTop: 1 },
  sellerBadges: { flexDirection: 'row', gap: 6, marginTop: 6 },
  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  badgeTxt: { fontSize: 10, fontWeight: '700' },
  distancePill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: COLORS.primary + '15', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  distanceTxt:  { fontSize: 10, fontWeight: '800', color: COLORS.primary },

  composeBox: { marginTop: 12 },
  composeLabel: { fontSize: 12, color: COLORS.textMedium, fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    padding: 10, fontSize: 14, color: COLORS.textDark, minHeight: 56, textAlignVertical: 'top',
  },

  sendBtn: {
    marginTop: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.primary, paddingVertical: 14, borderRadius: RADIUS.md,
    ...SHADOWS.small,
  },
  sendBtnDisabled: { backgroundColor: COLORS.gray175 },
  sendBtnText: { flexShrink: 1, textAlign: 'center', color: COLORS.white, fontSize: 15, fontWeight: '700' },

  loadingBox: { paddingVertical: 50, alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 13, color: COLORS.textMedium },
  emptyBox: { paddingVertical: 50, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textDark, textAlign: 'center', paddingHorizontal: 16 },
  emptyText: { fontSize: 12, color: COLORS.textLight, textAlign: 'center', paddingHorizontal: 24 },
  retryBtn: { marginTop: 8, paddingHorizontal: 18, paddingVertical: 8, borderRadius: RADIUS.sm, backgroundColor: COLORS.primary + '15' },
  retryText: { color: COLORS.primary, fontWeight: '700' },
});

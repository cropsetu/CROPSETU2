/**
 * MSPTrackerScreen — Official MSP vs current mandi comparison
 *
 * Tabs:
 *  - MSP Rates list (all crops, kharif/rabi)
 *  - MSP vs Mandi comparison for a selected crop
 */
import { COLORS } from '../../constants/colors';
import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, StatusBar, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { getMSPRates, getMSPComparison } from '../../services/aiApi';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const SIGNAL_CONFIG = {
  ABOVE_MSP: { color: COLORS.primary, bg: 'rgba(46,204,113,0.12)', icon: 'trending-up',   label: 'Above MSP' },
  AT_MSP:    { color: COLORS.amberDark, bg: 'rgba(243,156,18,0.12)', icon: 'remove',         label: 'At MSP'    },
  BELOW_MSP: { color: COLORS.red, bg: 'rgba(231,76,60,0.12)',  icon: 'trending-down',  label: 'Below MSP' },
};

function MSPRateCard({ item, onCompare, language }) {
  return (
    <View style={S.rateCard}>
      <View style={S.rateCardTop}>
        <View style={{ flex: 1 }}>
          <Text style={S.cropName}>{item.commodity}</Text>
          {item.commodityHi ? <Text style={S.cropHi}>{item.commodityHi}</Text> : null}
        </View>
        <View>
          <Text style={S.mspValue}>₹{item.mspPrice?.toLocaleString()}</Text>
          <Text style={S.mspUnit}>/quintal</Text>
        </View>
      </View>
      <View style={S.rateCardMeta}>
        <View style={S.seasonBadge}>
          <Text style={S.seasonTxt}>{item.season}</Text>
        </View>
        <Text style={S.yearTxt}>{item.year}</Text>
        {item.increasePercent != null && (
          <View style={S.hikeBadge}>
            <Ionicons name="arrow-up" size={10} color={COLORS.primary} />
            <Text style={S.hikeTxt}>{item.increasePercent}%</Text>
          </View>
        )}
      </View>
      <TouchableOpacity style={S.compareBtn} onPress={() => onCompare(item)}>
        <Ionicons name="swap-horizontal-outline" size={13} color={COLORS.primary} />
        <Text style={S.compareTxt}>{t('mspTracker.compareWithMandi')}{/* TODO: needs t() from parent */}</Text>
      </TouchableOpacity>
    </View>
  );
}

function ComparisonView({ item, state, language, onBack }) {
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMSPComparison(item.commodity, state)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [item.commodity, state]);

  if (loading) {
    return (
      <View style={S.centered}>
        <ActivityIndicator color={COLORS.primary} size="large" />
        <Text style={S.loadingTxt}>{t('mspTracker.loadingComparison')}</Text>
      </View>
    );
  }

  const sig = data?.signal ? SIGNAL_CONFIG[data.signal] || SIGNAL_CONFIG.AT_MSP : null;
  const suggestion = data?.signalHi || data?.suggestion || null;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 18, gap: 14 }}>
      <TouchableOpacity onPress={onBack} style={S.backLink}>
        <Ionicons name="chevron-back" size={16} color={COLORS.primary} />
        <Text style={S.backLinkTxt}>{t('mspTracker.back')}</Text>
      </TouchableOpacity>

      <Text style={S.compTitle}>{item.commodity} — MSP vs Mandi</Text>

      {sig && (
        <View style={[S.signalCard, { backgroundColor: sig.bg, borderColor: sig.color + '40' }]}>
          <Ionicons name={sig.icon} size={28} color={sig.color} />
          <View style={{ flex: 1 }}>
            <Text style={[S.signalLabel, { color: sig.color }]}>{sig.label}</Text>
            {suggestion ? <Text style={S.signalDesc}>{suggestion}</Text> : null}
          </View>
        </View>
      )}

      <View style={S.compGrid}>
        <View style={[S.compBox, { borderColor: 'rgba(23,107,67,0.25)' }]}>
          <Text style={S.compBoxLabel}>{t('mspTracker.govtMsp')}</Text>
          <Text style={[S.compBoxVal, { color: COLORS.primary }]}>
            ₹{data?.msp?.price?.toLocaleString() || item.mspPrice?.toLocaleString()}
          </Text>
          <Text style={S.compBoxUnit}>/quintal</Text>
        </View>
        <View style={[S.compBox, { borderColor: 'rgba(243,156,18,0.25)' }]}>
          <Text style={S.compBoxLabel}>{t('mspTracker.mandiPrice')}</Text>
          <Text style={[S.compBoxVal, { color: COLORS.amberDark }]}>
            ₹{data?.mandi?.modalPrice?.toLocaleString() || '—'}
          </Text>
          <Text style={S.compBoxUnit}>/quintal</Text>
        </View>
      </View>

      {data?.mandi && (
        <>
          <Text style={S.sectionLabel}>{t('mspTracker.mandiPrice')}</Text>
          <View style={S.mandiRow}>
            <View style={{ flex: 1 }}>
              <Text style={S.mandiRowName}>{data.mandi.market}</Text>
              <Text style={S.mandiRowDist}>{data.mandi.district}</Text>
            </View>
            <Text style={S.mandiRowPrice}>₹{data.mandi.modalPrice}</Text>
            {data.signal ? (
              <View style={[S.miniSignal, { backgroundColor: SIGNAL_CONFIG[data.signal]?.bg }]}>
                <Ionicons name={SIGNAL_CONFIG[data.signal]?.icon} size={12} color={SIGNAL_CONFIG[data.signal]?.color} />
              </View>
            ) : null}
          </View>
          {data.priceDiffFromMSP != null && (
            <Text style={{ fontSize: 12, color: COLORS.textLight, marginTop: 4 }}>
              {data.priceDiffFromMSP >= 0 ? '+' : ''}₹{data.priceDiffFromMSP} {t('mspTracker.fromMsp')}
              {data.priceDiffPercent != null ? ` (${data.priceDiffPercent > 0 ? '+' : ''}${data.priceDiffPercent}%)` : ''}
            </Text>
          )}
        </>
      )}

      {!data && (
        <Text style={S.errorTxt}>{t('mspTracker.comparisonNotAvailable')}</Text>
      )}
    </ScrollView>
  );
}

export default function MSPTrackerScreen({ navigation }) {
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const [rates, setRates]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [season, setSeason]     = useState('kharif');
  const [comparing, setComparing] = useState(null);

  useEffect(() => {
    setLoading(true);
    getMSPRates(null, season)
      .then(d => setRates(Array.isArray(d) ? d : (d?.rates || [])))
      .catch(() => setRates([]))
      .finally(() => setLoading(false));
  }, [season]);

  return (
    <AnimatedScreen style={S.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <View style={S.header}>
        <TouchableOpacity onPress={() => { comparing ? setComparing(null) : navigation.goBack(); }} style={S.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>{t('mspTracker.mspTracker')}</Text>
          <Text style={S.headerSub}>{t('mspTracker.cacpGoi202526')}</Text>
        </View>
      </View>

      {!comparing && (
        <View style={S.seasonRow}>
          {['kharif', 'rabi'].map(s => (
            <TouchableOpacity
              key={s}
              style={[S.seasonTab, season === s && S.seasonTabActive]}
              onPress={() => setSeason(s)}
            >
              <Text style={[S.seasonTabTxt, season === s && S.seasonTabTxtActive]}>
                {s === 'kharif' ? (t('mspTracker.kharif')) : (t('mspTracker.rabi'))}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {comparing ? (
        <ComparisonView
          item={comparing}
          state={user?.state || 'Maharashtra'}
          language={language}
          onBack={() => setComparing(null)}
        />
      ) : loading ? (
        <View style={S.centered}>
          <ActivityIndicator color={COLORS.primary} size="large" />
          <Text style={S.loadingTxt}>{t('mspTracker.loading')}</Text>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={10}
          removeClippedSubviews
          data={rates}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => (
            <MSPRateCard item={item} language={language} onCompare={setComparing} />
          )}
          contentContainerStyle={S.listContent}
          ListEmptyComponent={
            <Text style={S.emptyTxt}>{t('mspTracker.noMspRatesFound')}</Text>
          }
          ListHeaderComponent={
            <Text style={S.infoTxt}>
              {t('mspTracker.mspInfo')}
            </Text>
          }
        />
      )}
    </AnimatedScreen>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 52, paddingHorizontal: 18, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textDark },
  headerSub:   { fontSize: 10, color: COLORS.textLight, marginTop: 1 },

  seasonRow: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 18, paddingVertical: 12,
  },
  seasonTab: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, alignItems: 'center',
  },
  seasonTabActive:    { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  seasonTabTxt:       { fontSize: 14, fontWeight: '700', color: COLORS.textMedium },
  seasonTabTxtActive: { color: COLORS.white },

  listContent: { paddingHorizontal: 18, paddingBottom: 40, gap: 10 },
  infoTxt: {
    fontSize: 12, color: COLORS.textLight, marginBottom: 8, marginTop: 4,
    lineHeight: 18, paddingHorizontal: 4,
  },

  rateCard: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: COLORS.border, gap: 10,
  },
  rateCardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  cropName:    { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  cropHi:      { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  mspValue:    { fontSize: 20, fontWeight: '900', color: COLORS.primary, textAlign: 'right' },
  mspUnit:     { fontSize: 10, color: COLORS.textLight, textAlign: 'right' },
  rateCardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seasonBadge: {
    backgroundColor: 'rgba(23,107,67,0.08)', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  seasonTxt: { fontSize: 10, fontWeight: '700', color: COLORS.primary, textTransform: 'capitalize' },
  yearTxt:   { fontSize: 11, color: COLORS.textLight, flex: 1 },
  hikeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: 'rgba(46,204,113,0.08)', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 3,
  },
  hikeTxt: { fontSize: 10, color: COLORS.primary, fontWeight: '700' },
  compareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10, marginTop: 2,
  },
  compareTxt: { fontSize: 12, color: COLORS.primary, fontWeight: '700' },

  // Comparison view
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backLinkTxt: { fontSize: 14, color: COLORS.primary, fontWeight: '600' },
  compTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textDark },
  signalCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, padding: 16, borderWidth: 1,
  },
  signalLabel: { fontSize: 16, fontWeight: '800' },
  signalDesc:  { fontSize: 12, color: COLORS.textMedium, marginTop: 2 },
  compGrid: { flexDirection: 'row', gap: 12 },
  compBox: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 14,
    padding: 14, borderWidth: 1, alignItems: 'center',
  },
  compBoxLabel: { fontSize: 11, color: COLORS.textMedium, fontWeight: '600', marginBottom: 6 },
  compBoxVal:   { fontSize: 22, fontWeight: '900' },
  compBoxUnit:  { fontSize: 10, color: COLORS.textLight, marginTop: 2 },
  sectionLabel: { fontSize: 11, fontWeight: '900', color: COLORS.textMedium, letterSpacing: 1.2, textTransform: 'uppercase' },
  mandiRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  mandiRowName:  { fontSize: 13, fontWeight: '700', color: COLORS.textDark },
  mandiRowDist:  { fontSize: 11, color: COLORS.textLight },
  mandiRowPrice: { fontSize: 15, fontWeight: '800', color: COLORS.amberDark },
  miniSignal: { width: 26, height: 26, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  loadingTxt: { fontSize: 14, color: COLORS.textLight, marginTop: 8 },
  errorTxt: { fontSize: 14, color: COLORS.error, textAlign: 'center' },
  emptyTxt: { fontSize: 15, color: COLORS.textMedium, fontWeight: '700', textAlign: 'center', paddingTop: 40 },
});

/**
 * LoanCalculatorScreen — KCC eligibility + EMI calculator + bank comparison
 *
 * Three tabs:
 *  1. KCC Eligibility — crop, area, state → NABARD scale of finance
 *  2. EMI Calculator — principal, rate, tenure → reducing balance EMI
 *  3. Bank Comparison — list of banks with KCC rates
 */
import { COLORS } from '../../constants/colors';
import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, StatusBar, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { calculateLoanKCC, calculateLoanEMI, getLoanBankComparison } from '../../services/aiApi';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const STATES = ['Maharashtra','Punjab','Madhya Pradesh','Uttar Pradesh','Karnataka','Andhra Pradesh','Rajasthan','Gujarat','Tamil Nadu'];

export default function LoanCalculatorScreen({ navigation }) {
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const [tab, setTab] = useState('kcc');

  // KCC form
  const [kccCrop, setKccCrop]     = useState('');
  const [kccArea, setKccArea]     = useState('');
  const [kccState, setKccState]   = useState(user?.state || 'Maharashtra');
  const [kccResult, setKccResult] = useState(null);
  const [kccLoading, setKccLoading] = useState(false);
  const [kccError, setKccError]   = useState(null);

  // EMI form
  const [principal, setPrincipal] = useState('');
  const [rate, setRate]           = useState('4');
  const [tenure, setTenure]       = useState('12');
  const [emiResult, setEmiResult] = useState(null);
  const [emiLoading, setEmiLoading] = useState(false);

  // Banks
  const [banks, setBanks]         = useState([]);
  const [banksLoading, setBanksLoading] = useState(false);

  useEffect(() => {
    if (tab === 'banks' && banks.length === 0) {
      setBanksLoading(true);
      getLoanBankComparison()
        .then(d => setBanks(d?.banks || d || []))
        .catch(() => setBanks([]))
        .finally(() => setBanksLoading(false));
    }
  }, [tab]);

  const calcKCC = async () => {
    if (!kccCrop || !kccArea) {
      setKccError(t('loanCalc.cropAndAreaAreRequired'));
      return;
    }
    setKccError(null);
    setKccLoading(true);
    try {
      const result = await calculateLoanKCC({ crop: kccCrop, area: parseFloat(kccArea), unit: 'acre', state: kccState });
      setKccResult(result);
    } catch (err) {
      setKccError(err?.response?.data?.error?.message || 'Calculation failed');
    } finally {
      setKccLoading(false);
    }
  };

  const calcEMI = async () => {
    if (!principal) return;
    setEmiLoading(true);
    try {
      const result = await calculateLoanEMI({
        principal: parseFloat(principal),
        annualRate: parseFloat(rate),
        tenureMonths: parseInt(tenure),
      });
      setEmiResult(result);
    } catch {
      setEmiResult(null);
    } finally {
      setEmiLoading(false);
    }
  };

  const TABS = [
    { key: 'kcc',   label: t('loanCalc.kccEligibility') },
    { key: 'emi',   label: t('loanCalc.emiCalc') },
    { key: 'banks', label: t('loanCalc.banks') },
  ];

  return (
    <AnimatedScreen style={S.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>{t('loanCalc.loanCalculator')}</Text>
          <Text style={S.headerSub}>KCC · EMI · {t('loanCalc.bankCompare')}</Text>
        </View>
      </View>

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.tabScroll} contentContainerStyle={S.tabContent}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[S.tabBtn, tab === t.key && S.tabBtnActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[S.tabTxt, tab === t.key && S.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* KCC Tab */}
      {tab === 'kcc' && (
        <ScrollView contentContainerStyle={S.formContent}>
          <Text style={S.sectionLabel}>{t('loanCalc.cropDetails')}</Text>

          <TextInput
            style={S.input}
            placeholder={t('loanCalc.cropNameEgWheatCotton')}
            placeholderTextColor={COLORS.textLight}
            value={kccCrop}
            onChangeText={setKccCrop}
          />
          <View style={S.rowInputs}>
            <TextInput
              style={[S.input, { flex: 1 }]}
              placeholder={t('loanCalc.areaAcres')}
              placeholderTextColor={COLORS.textLight}
              keyboardType="decimal-pad"
              value={kccArea}
              onChangeText={setKccArea}
            />
            <View style={[S.input, { width: 130, justifyContent: 'center' }]}>
              <Text style={{ color: COLORS.textMedium, fontSize: 13 }}>{kccState}</Text>
            </View>
          </View>

          {kccError ? <Text style={S.errorTxt}>{kccError}</Text> : null}

          <TouchableOpacity style={[S.calcBtn, kccLoading && { opacity: 0.6 }]} onPress={calcKCC} disabled={kccLoading}>
            {kccLoading ? <ActivityIndicator color={COLORS.white} /> : (
              <Text style={S.calcTxt}>{t('loanCalc.checkEligibility')}</Text>
            )}
          </TouchableOpacity>

          {kccResult && (
            <>
              <View style={S.resultCard}>
                <Text style={S.resultLabel}>{t('loanCalc.kccLimit')}</Text>
                <Text style={S.resultBig}>₹{kccResult.kccLimit?.toLocaleString()}</Text>
                <Text style={S.resultSub}>{t('loanCalc.estimatedCreditLimit')}</Text>
              </View>

              {kccResult.breakdown && (
                <View style={S.breakdownCard}>
                  {Object.entries(kccResult.breakdown).map(([k, v]) => (
                    <View key={k} style={S.breakdownRow}>
                      <Text style={S.breakdownLabel}>{k}</Text>
                      <Text style={S.breakdownVal}>₹{typeof v === 'number' ? v.toLocaleString() : v}</Text>
                    </View>
                  ))}
                </View>
              )}

              {kccResult.eligibility === false && (
                <View style={S.ineligibleCard}>
                  <Ionicons name="close-circle-outline" size={20} color={COLORS.red} />
                  <Text style={S.ineligibleTxt}>{kccResult.reason || 'Not eligible for KCC'}</Text>
                </View>
              )}

              {kccResult.note ? <Text style={S.noteTxt}>* {kccResult.note}</Text> : null}
            </>
          )}
        </ScrollView>
      )}

      {/* EMI Tab */}
      {tab === 'emi' && (
        <ScrollView contentContainerStyle={S.formContent}>
          <Text style={S.sectionLabel}>{t('loanCalc.loanDetails')}</Text>

          <View style={S.fieldWrap}>
            <Text style={S.fieldLabel}>{t('loanCalc.loanAmount')}</Text>
            <TextInput
              style={S.input}
              placeholder="e.g. 100000"
              placeholderTextColor={COLORS.textLight}
              keyboardType="numeric"
              value={principal}
              onChangeText={setPrincipal}
            />
          </View>
          <View style={S.fieldWrap}>
            <Text style={S.fieldLabel}>{t('loanCalc.interestRatePa')}</Text>
            <TextInput
              style={S.input}
              placeholder="e.g. 4 (KCC rate)"
              placeholderTextColor={COLORS.textLight}
              keyboardType="decimal-pad"
              value={rate}
              onChangeText={setRate}
            />
          </View>
          <View style={S.fieldWrap}>
            <Text style={S.fieldLabel}>{t('loanCalc.tenureMonths')}</Text>
            <TextInput
              style={S.input}
              placeholder="e.g. 12"
              placeholderTextColor={COLORS.textLight}
              keyboardType="numeric"
              value={tenure}
              onChangeText={setTenure}
            />
          </View>

          <TouchableOpacity style={[S.calcBtn, emiLoading && { opacity: 0.6 }]} onPress={calcEMI} disabled={emiLoading}>
            {emiLoading ? <ActivityIndicator color={COLORS.white} /> : (
              <Text style={S.calcTxt}>{t('loanCalc.calculateEmi')}</Text>
            )}
          </TouchableOpacity>

          {emiResult && (
            <View style={S.emiResultGrid}>
              {[
                { label: t('loanCalc.monthlyEmi'), val: `₹${emiResult.emi?.toLocaleString()}`, highlight: true },
                { label: t('loanCalc.totalAmount'), val: `₹${emiResult.totalAmount?.toLocaleString()}` },
                { label: t('loanCalc.totalInterest'), val: `₹${emiResult.totalInterest?.toLocaleString()}` },
                { label: t('loanCalc.interest'), val: `${emiResult.interestPercentage}%` },
              ].map((item, i) => (
                <View key={i} style={[S.emiBox, item.highlight && { borderColor: COLORS.primary + '60' }]}>
                  <Text style={S.emiBoxLabel}>{item.label}</Text>
                  <Text style={[S.emiBoxVal, item.highlight && { color: COLORS.primary }]}>{item.val}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={S.kccInfoCard}>
            <Ionicons name="information-circle-outline" size={16} color={COLORS.primary} />
            <Text style={S.kccInfoTxt}>
              {t('loanCalc.kccInfo')}
            </Text>
          </View>
        </ScrollView>
      )}

      {/* Banks Tab */}
      {tab === 'banks' && (
        banksLoading ? (
          <View style={S.centered}>
            <ActivityIndicator color={COLORS.primary} size="large" />
          </View>
        ) : (
          <FlatList
            windowSize={5}
            maxToRenderPerBatch={10}
            removeClippedSubviews
            data={banks}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={S.listContent}
            renderItem={({ item }) => (
              <View style={S.bankCard}>
                <View style={{ flex: 1 }}>
                  <Text style={S.bankName}>{item.bank}</Text>
                  <Text style={S.bankType}>{item.type}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={S.bankRate}>{item.kccRate}%</Text>
                  <Text style={S.bankRateLabel}>{t('loanCalc.kccRate')}</Text>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <Text style={S.emptyTxt}>{t('loanCalc.bankDataNotAvailable')}</Text>
            }
          />
        )
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

  tabScroll:  { flexGrow: 0 },
  tabContent: { paddingHorizontal: 18, paddingVertical: 12, gap: 8 },
  tabBtn: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  tabBtnActive:   { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabTxt:         { fontSize: 13, fontWeight: '700', color: COLORS.textMedium },
  tabTxtActive:   { color: COLORS.white },

  formContent: { padding: 18, gap: 12 },
  sectionLabel: { fontSize: 11, fontWeight: '900', color: COLORS.textMedium, letterSpacing: 1.2, textTransform: 'uppercase' },
  input: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: COLORS.border,
    color: COLORS.textBody, fontSize: 14,
  },
  rowInputs: { flexDirection: 'row', gap: 10 },
  fieldWrap: { gap: 6 },
  fieldLabel: { fontSize: 13, color: COLORS.textMedium, fontWeight: '600' },
  errorTxt: { fontSize: 13, color: COLORS.error },
  calcBtn: {
    backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4,
  },
  calcTxt: { fontSize: 16, fontWeight: '800', color: COLORS.white },

  resultCard: {
    backgroundColor: 'rgba(46,204,113,0.08)', borderRadius: 16,
    padding: 20, alignItems: 'center', borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  resultLabel: { fontSize: 12, color: COLORS.textLight, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  resultBig:   { fontSize: 32, fontWeight: '900', color: COLORS.primary, marginTop: 4 },
  resultSub:   { fontSize: 12, color: COLORS.textLight, marginTop: 2 },

  breakdownCard: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border, gap: 8,
  },
  breakdownRow:  { flexDirection: 'row', justifyContent: 'space-between' },
  breakdownLabel:{ fontSize: 13, color: COLORS.textMedium },
  breakdownVal:  { fontSize: 13, color: COLORS.textDark, fontWeight: '700' },

  ineligibleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(231,76,60,0.10)', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(231,76,60,0.25)',
  },
  ineligibleTxt: { flex: 1, fontSize: 13, color: COLORS.error },
  noteTxt: { fontSize: 11, color: COLORS.textLight, lineHeight: 16 },

  emiResultGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  emiBox: {
    width: '47%', backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  emiBoxLabel: { fontSize: 11, color: COLORS.textLight, fontWeight: '700', marginBottom: 4 },
  emiBoxVal:   { fontSize: 18, fontWeight: '900', color: COLORS.textDark },

  kccInfoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(23,107,67,0.06)', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  kccInfoTxt: { flex: 1, fontSize: 12, color: COLORS.textLight, lineHeight: 18 },

  listContent: { padding: 18, paddingBottom: 40, gap: 10 },
  bankCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  bankName: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  bankType: { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  bankRate: { fontSize: 20, fontWeight: '900', color: COLORS.primary },
  bankRateLabel: { fontSize: 10, color: COLORS.textLight },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTxt: { fontSize: 15, color: COLORS.textMedium, textAlign: 'center', paddingTop: 40 },
});

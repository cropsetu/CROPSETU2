import { useRef, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Dimensions, Animated, StatusBar, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../../context/LanguageContext';
import { COLORS } from '../../constants/colors';

const { width: W } = Dimensions.get('window');

const SCHEMES = [
  {
    id: 1,
    name: 'PM-KISAN',
    fullName: 'Pradhan Mantri Kisan Samman Nidhi',
    benefit: '₹6,000/year',
    benefitType: 'Cash Transfer',
    status: 'eligible',
    icon: 'cash-outline',
    color: COLORS.primary,
    desc: 'Direct income support of ₹6,000/year to small & marginal farmers in 3 installments of ₹2,000.',
    eligibility: ['Land holding < 2 hectares', 'Valid Aadhaar', 'Registered bank account'],
    howToApply: 'Apply via PM-KISAN portal or nearest CSC centre.',
    deadline: 'Rolling — apply anytime',
  },
  {
    id: 2,
    name: 'PMFBY',
    fullName: 'Pradhan Mantri Fasal Bima Yojana',
    benefit: 'Up to ₹50,000 coverage',
    benefitType: 'Crop Insurance',
    status: 'eligible',
    icon: 'shield-checkmark-outline',
    color: COLORS.blue,
    desc: 'Comprehensive crop insurance at low premium rates. Covers yield losses due to weather, pests & diseases.',
    eligibility: ['Cultivating notified crops', 'Premium: 2% for Kharif, 1.5% for Rabi'],
    howToApply: 'Apply via bank where Kisan Credit Card is held, or Common Service Centre.',
    deadline: 'Before sowing — check district office',
  },
  {
    id: 3,
    name: 'KCC',
    fullName: 'Kisan Credit Card',
    benefit: 'Loan up to ₹3 lakh @ 4%',
    benefitType: 'Credit',
    status: 'eligible',
    icon: 'card-outline',
    color: COLORS.purple,
    desc: 'Short-term crop loans at 4% interest rate (after government subvention). Covers cultivation + household needs.',
    eligibility: ['Land holding owner/tenant', 'Age 18–75 years'],
    howToApply: 'Apply at nearest bank branch. Documents: Aadhaar, land records, passport photo.',
    deadline: 'Rolling — apply at any bank',
  },
  {
    id: 4,
    name: 'Soil Health Card',
    fullName: 'Soil Health Card Scheme',
    benefit: 'Free soil testing',
    benefitType: 'Advisory',
    status: 'check',
    icon: 'earth-outline',
    color: COLORS.tangerine,
    desc: 'Free soil testing every 2 years with nutrient recommendations to reduce fertilizer costs by 20–30%.',
    eligibility: ['Any farmer with agricultural land'],
    howToApply: 'Visit nearest Krishi Vigyan Kendra or apply online at soilhealth.dac.gov.in',
    deadline: 'Rolling — check camp schedule',
  },
  {
    id: 5,
    name: 'PKVY',
    fullName: 'Paramparagat Krishi Vikas Yojana',
    benefit: '₹50,000/hectare for 3 yrs',
    benefitType: 'Organic Farming',
    status: 'check',
    icon: 'leaf-outline',
    color: COLORS.primary,
    desc: 'Promotes organic farming through cluster-based approach. Covers certification, inputs, and marketing support.',
    eligibility: ['Cluster of 50 farmers', 'Minimum 50 acres contiguous land', 'Organic farming commitment'],
    howToApply: 'Form a cluster with neighbouring farmers. Apply via District Agriculture Office.',
    deadline: 'Check state agriculture dept',
  },
];

const STATUS_CONFIG = {
  eligible: { color: COLORS.primary, tKey: 'statusEligible', icon: 'checkmark-circle' },
  check:    { color: COLORS.amberDark, tKey: 'statusCheck',    icon: 'help-circle' },
  applied:  { color: COLORS.blue, tKey: 'statusApplied',  icon: 'time' },
};

function SchemeCard({ scheme, onExpand, expanded, t }) {
  const sc = STATUS_CONFIG[scheme.status];
  const heightAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(heightAnim, {
      toValue: expanded ? 1 : 0, duration: 300, useNativeDriver: false,
    }).start();
  }, [expanded]);

  return (
    <TouchableOpacity style={SC.card} onPress={onExpand} activeOpacity={0.85}>
      <View style={SC.cardTop}>
        <View style={[SC.iconWrap, { backgroundColor: `${scheme.color}15` }]}>
          <Ionicons name={scheme.icon} size={20} color={scheme.color} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={SC.nameRow}>
            <Text style={SC.name}>{scheme.name}</Text>
            <View style={[SC.statusBadge, { backgroundColor: `${sc.color}12` }]}>
              <Ionicons name={sc.icon} size={10} color={sc.color} />
              <Text style={[SC.statusText, { color: sc.color }]}>{t(`scheme.${sc.tKey}`)}</Text>
            </View>
          </View>
          <Text style={SC.fullName} numberOfLines={1}>{scheme.fullName}</Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textMedium} />
      </View>

      <View style={SC.benefitRow}>
        <View style={SC.benefit}>
          <Text style={SC.benefitValue}>{scheme.benefit}</Text>
          <Text style={SC.benefitType}>{scheme.benefitType}</Text>
        </View>
      </View>

      {expanded && (
        <View style={SC.expandedBody}>
          <View style={SC.divider} />
          <Text style={SC.desc}>{scheme.desc}</Text>

          <Text style={SC.subLabel}>{t('scheme.eligibilitySection')}</Text>
          {scheme.eligibility.map((e, i) => (
            <View key={i} style={SC.listRow}>
              <View style={[SC.listDot, { backgroundColor: scheme.color }]} />
              <Text style={SC.listText}>{e}</Text>
            </View>
          ))}

          <Text style={SC.subLabel}>{t('scheme.howToApply')}</Text>
          <Text style={SC.applyText}>{scheme.howToApply}</Text>

          <View style={SC.deadlineRow}>
            <Ionicons name="calendar-outline" size={12} color={COLORS.grayMedium} />
            <Text style={SC.deadlineText}>{scheme.deadline}</Text>
          </View>

          <TouchableOpacity style={[SC.applyBtn, { backgroundColor: scheme.color }]} activeOpacity={0.85}>
            <Text style={SC.applyBtnText}>{t('scheme.applyNow')}</Text>
            <Ionicons name="arrow-forward" size={14} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function SchemeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState('');

  const filtered = SCHEMES.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.fullName.toLowerCase().includes(search.toLowerCase()) ||
    s.benefitType.toLowerCase().includes(search.toLowerCase())
  );

  const eligible = filtered.filter(s => s.status === 'eligible').length;

  return (
    <View style={SC.root}>
      <StatusBar barStyle="dark-content" />

      {/* ── Header ── */}
      <View style={[SC.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={SC.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
        </TouchableOpacity>
        <View>
          <Text style={SC.headerTitle}>{t('scheme.title')}</Text>
          <Text style={SC.headerSub}>{t('scheme.subtitle')}</Text>
        </View>
        <View style={SC.eligibleBadge}>
          <Text style={SC.eligibleCount}>{eligible}</Text>
          <Text style={SC.eligibleLabel}>{t('scheme.eligible')}</Text>
        </View>
      </View>

      {/* ── Search ── */}
      <View style={SC.searchRow}>
        <Ionicons name="search-outline" size={16} color={COLORS.gray350} />
        <TextInput
          style={SC.searchInput}
          placeholder={t('scheme.searchPlaceholder')}
          placeholderTextColor={COLORS.gray350}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* ── Summary chips ── */}
      <View style={SC.summaryRow}>
        <View style={SC.summaryChip}>
          <Text style={SC.summaryValue}>{SCHEMES.filter(s => s.status === 'eligible').length}</Text>
          <Text style={SC.summaryLabel}>{t('scheme.eligible')}</Text>
        </View>
        <View style={SC.summaryChipDiv} />
        <View style={SC.summaryChip}>
          <Text style={[SC.summaryValue, { color: COLORS.amberDark }]}>₹59,000</Text>
          <Text style={SC.summaryLabel}>{t('scheme.maxAnnualBenefit')}</Text>
        </View>
        <View style={SC.summaryChipDiv} />
        <View style={SC.summaryChip}>
          <Text style={[SC.summaryValue, { color: COLORS.blue }]}>{SCHEMES.length}</Text>
          <Text style={SC.summaryLabel}>{t('scheme.totalSchemes')}</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={SC.list}>
        {filtered.map(scheme => (
          <SchemeCard
            key={scheme.id}
            scheme={scheme}
            expanded={expanded === scheme.id}
            onExpand={() => setExpanded(expanded === scheme.id ? null : scheme.id)}
            t={t}
          />
        ))}

        {filtered.length === 0 && (
          <View style={SC.emptyState}>
            <Ionicons name="search" size={40} color={COLORS.textDark} />
            <Text style={SC.emptyText}>{t('scheme.noSchemesFound', { search })}</Text>
          </View>
        )}

        <TouchableOpacity style={SC.askBtn} onPress={() => navigation.navigate('AIChat', { initialMessage: 'Which government schemes am I eligible for?' })} activeOpacity={0.8}>
          <Ionicons name="sparkles-outline" size={16} color={COLORS.white} />
          <Text style={SC.askBtnText}>{t('scheme.askAI')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const SC = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 18, paddingBottom: 12,
  },
  backBtn:      { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  headerTitle:  { fontSize: 18, fontWeight: '900', color: COLORS.slate800 },
  headerSub:    { fontSize: 10, color: COLORS.gray350, marginTop: 1 },
  eligibleBadge:{ marginLeft: 'auto', alignItems: 'center' },
  eligibleCount:{ fontSize: 22, fontWeight: '900', color: COLORS.primary, lineHeight: 24 },
  eligibleLabel:{ fontSize: 10, color: COLORS.gray350 },

  // Search
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 18, marginBottom: 12,
    backgroundColor: COLORS.white,
    borderRadius: 12, paddingHorizontal: 14, height: 44,
    borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.slate800 },

  // Summary
  summaryRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 18, marginBottom: 14,
    backgroundColor: COLORS.white,
    borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  summaryChip:    { flex: 1, alignItems: 'center', gap: 2 },
  summaryValue:   { fontSize: 18, fontWeight: '900', color: COLORS.primary },
  summaryLabel:   { fontSize: 9, color: COLORS.gray350, fontWeight: '600', textAlign: 'center' },
  summaryChipDiv: { width: 1, height: 28, backgroundColor: 'rgba(0,0,0,0.06)' },

  // Scheme card
  list: { paddingHorizontal: 18, paddingBottom: 48, gap: 10 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16, padding: 16, gap: 12,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  cardTop:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap:   { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  nameRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name:       { fontSize: 15, fontWeight: '800', color: COLORS.slate800 },
  fullName:   { fontSize: 11, color: COLORS.gray350, marginTop: 2 },
  statusBadge:{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: '700' },
  benefitRow: { flexDirection: 'row' },
  benefit:    {
    backgroundColor: COLORS.background, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    gap: 2,
  },
  benefitValue:{ fontSize: 16, fontWeight: '900', color: COLORS.slate800 },
  benefitType: { fontSize: 10, color: COLORS.gray350, fontWeight: '600' },

  // Expanded
  expandedBody: { gap: 10 },
  divider:     { height: 1, backgroundColor: 'rgba(0,0,0,0.06)' },
  desc:        { fontSize: 13, color: COLORS.textMedium, lineHeight: 19 },
  subLabel:    { fontSize: 10, fontWeight: '800', color: COLORS.gray350, letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 },
  listRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  listDot:     { width: 6, height: 6, borderRadius: 3, marginTop: 6, flexShrink: 0 },
  listText:    { fontSize: 13, color: COLORS.textMedium, lineHeight: 19, flex: 1 },
  applyText:   { fontSize: 13, color: COLORS.textMedium, lineHeight: 19 },
  deadlineRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  deadlineText:{ fontSize: 11, color: COLORS.gray350 },
  applyBtn:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 10, paddingVertical: 11, marginTop: 4,
  },
  applyBtnText:{ fontSize: 13, fontWeight: '800', color: COLORS.white },

  // Empty
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText:  { fontSize: 14, color: COLORS.gray350, textAlign: 'center' },

  // Ask button
  askBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.primary, borderRadius: 16, paddingVertical: 15, marginTop: 8,
  },
  askBtnText: { fontSize: 14, fontWeight: '800', color: COLORS.white },
});

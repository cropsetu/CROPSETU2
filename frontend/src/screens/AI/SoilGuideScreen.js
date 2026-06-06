/**
 * SoilGuideScreen — "How to get your soil tested" under the govt scheme.
 *
 * This is the answer to the core problem: farmers don't know HOW to get tested.
 * Plain-language steps (who to approach, cost, documents, timeline) plus a
 * correct sample-collection guide, and a one-tap "find a lab" CTA.
 * All copy is i18n with English fallbacks so it degrades gracefully.
 */
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BookOpen, MapPin, Coins, FileText, Clock, RefreshCw,
  Check, X as XIcon, Sprout, ClipboardList,
} from 'lucide-react-native';
import { useLanguage } from '../../context/LanguageContext';
import {
  BG, BG_GRADIENT, P_LIGHT, ACCENT, DANGER, TEXT, TEXT2, MUTED, SURFACE, BORDER,
  INTER_REG, INTER_SEMI, INTER_BOLD, INTER_EXTRA, CosmicHeader,
} from './components/soilShared';
import { openSoilLabFinder } from './components/soilLab';

export default function SoilGuideScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  const steps = [
    { n: '1', title: t('soilHub.guide.s1t', 'Reach out'), desc: t('soilHub.guide.s1d', 'Contact your Block Agriculture Officer, nearest Krishi Vigyan Kendra (KVK), a Soil Testing Lab, or a Krishi Sakhi / Village Level Entrepreneur (CSC).') },
    { n: '2', title: t('soilHub.guide.s2t', 'Give a soil sample'), desc: t('soilHub.guide.s2d', 'They collect a sample from your field (or you bring one) and tag its location. See the sampling guide below.') },
    { n: '3', title: t('soilHub.guide.s3t', 'Lab testing'), desc: t('soilHub.guide.s3d', 'The lab tests your soil on 12 parameters — N, P, K, pH, organic carbon, micronutrients and more.') },
    { n: '4', title: t('soilHub.guide.s4t', 'Get your card'), desc: t('soilHub.guide.s4d', 'You receive a Soil Health Card with results and crop-wise fertilizer advice — usually within about 30 days.') },
  ];

  const facts = [
    { Icon: Coins, color: ACCENT, label: t('soilHub.guide.cost', 'Cost'), value: t('soilHub.guide.costV', '~₹40 / sample (often free)') },
    { Icon: FileText, color: '#60A5FA', label: t('soilHub.guide.docs', 'Documents'), value: t('soilHub.guide.docsV', 'Aadhaar, land record, mobile no.') },
    { Icon: Clock, color: P_LIGHT, label: t('soilHub.guide.time', 'Time'), value: t('soilHub.guide.timeV', '~30 days for the card') },
    { Icon: RefreshCw, color: '#A78BFA', label: t('soilHub.guide.retest', 'Re-test'), value: t('soilHub.guide.retestV', 'Every 2–3 years') },
  ];

  const dos = [
    t('soilHub.guide.do1', 'Sample after harvest, before the next sowing'),
    t('soilHub.guide.do2', 'Dig 0–15 cm deep at 8–10 spots in a “W” / zig-zag'),
    t('soilHub.guide.do3', 'Mix all the soil, then keep about ½ kg (500 g)'),
    t('soilHub.guide.do4', 'Dry it in shade — never in direct sun'),
    t('soilHub.guide.do5', 'Label it with your name, village & survey number'),
  ];
  const donts = [
    t('soilHub.guide.dont1', 'Bunds, field edges, wet patches and tree shade'),
    t('soilHub.guide.dont2', 'Spots where fertilizer or manure was just applied'),
    t('soilHub.guide.dont3', 'Compost heaps and waterlogged areas'),
  ];

  return (
    <View style={S.root}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <LinearGradient colors={BG_GRADIENT} style={StyleSheet.absoluteFill} />

      <CosmicHeader
        title={t('soilHub.guide.title', 'Get your soil tested')}
        subtitle={t('soilHub.guide.subtitle', 'Govt Soil Health Card scheme')}
        Icon={BookOpen}
        onBack={() => navigation.goBack()}
        insetTop={insets.top}
      />

      <ScrollView contentContainerStyle={[S.scroll, { paddingBottom: insets.bottom + 36 }]} showsVerticalScrollIndicator={false}>
        {/* Why */}
        <View style={S.why}>
          <Sprout size={18} color={P_LIGHT} strokeWidth={2.2} />
          <Text style={S.whyTxt}>
            {t('soilHub.guide.why', 'A soil test tells you exactly what your land needs — so you apply the right fertilizer, save money, and grow more.')}
          </Text>
        </View>

        {/* Quick facts */}
        <View style={S.facts}>
          {facts.map((f, i) => (
            <View key={i} style={S.factCard}>
              <f.Icon size={17} color={f.color} strokeWidth={2.2} />
              <Text style={S.factLabel}>{f.label}</Text>
              <Text style={S.factValue}>{f.value}</Text>
            </View>
          ))}
        </View>

        {/* Steps */}
        <Text style={S.sectionLabel}>{t('soilHub.guide.howTo', 'HOW TO GET TESTED')}</Text>
        {steps.map(s => (
          <View key={s.n} style={S.stepRow}>
            <View style={S.stepNum}><Text style={S.stepNumTxt}>{s.n}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={S.stepTitle}>{s.title}</Text>
              <Text style={S.stepDesc}>{s.desc}</Text>
            </View>
          </View>
        ))}

        {/* Find a lab CTA */}
        <TouchableOpacity style={S.labBtn} activeOpacity={0.9} onPress={() => openSoilLabFinder(t)}>
          <MapPin size={17} color={BG} strokeWidth={2.4} />
          <Text style={S.labBtnTxt}>{t('soilHub.guide.findLab', 'Find a soil testing lab near me')}</Text>
        </TouchableOpacity>

        {/* Sample collection */}
        <Text style={S.sectionLabel}>{t('soilHub.guide.sampling', 'HOW TO COLLECT A SAMPLE')}</Text>
        <View style={S.sampleCard}>
          <View style={S.sampleHead}>
            <ClipboardList size={15} color={P_LIGHT} />
            <Text style={[S.sampleHeadTxt, { color: P_LIGHT }]}>{t('soilHub.guide.doTitle', 'Do')}</Text>
          </View>
          {dos.map((d, i) => (
            <View key={i} style={S.listRow}>
              <Check size={14} color={P_LIGHT} strokeWidth={2.6} />
              <Text style={S.listTxt}>{d}</Text>
            </View>
          ))}
        </View>
        <View style={S.sampleCard}>
          <View style={S.sampleHead}>
            <XIcon size={15} color={DANGER} />
            <Text style={[S.sampleHeadTxt, { color: DANGER }]}>{t('soilHub.guide.avoidTitle', 'Avoid')}</Text>
          </View>
          {donts.map((d, i) => (
            <View key={i} style={S.listRow}>
              <XIcon size={14} color={DANGER} strokeWidth={2.6} />
              <Text style={S.listTxt}>{d}</Text>
            </View>
          ))}
        </View>

        {/* Next step */}
        <View style={S.nextRow}>
          <TouchableOpacity style={[S.nextBtn, S.nextGhost]} activeOpacity={0.9} onPress={() => navigation.navigate('SoilScan')}>
            <Text style={S.nextGhostTxt}>{t('soilHub.guide.haveCard', 'I have a card →')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[S.nextBtn, S.nextSolid]} activeOpacity={0.9} onPress={() => navigation.navigate('SoilForm')}>
            <Text style={S.nextSolidTxt}>{t('soilHub.guide.enterValues', 'Enter values')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },

  why: {
    flexDirection: 'row', gap: 11, alignItems: 'flex-start',
    backgroundColor: 'rgba(74,222,128,0.08)', borderRadius: 16, padding: 15,
    borderWidth: 1, borderColor: 'rgba(74,222,128,0.22)',
  },
  whyTxt: { flex: 1, fontSize: 13.5, color: TEXT2, lineHeight: 20, fontFamily: INTER_SEMI },

  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  factCard: { width: '47.8%', flexGrow: 1, backgroundColor: SURFACE, borderRadius: 14, padding: 13, borderWidth: 1, borderColor: BORDER, gap: 5 },
  factLabel: { fontSize: 10, color: MUTED, fontWeight: '800', letterSpacing: 0.6, marginTop: 4, fontFamily: INTER_BOLD },
  factValue: { fontSize: 12.5, color: TEXT, fontWeight: '700', lineHeight: 17, fontFamily: INTER_BOLD },

  sectionLabel: { fontSize: 11, fontWeight: '900', color: TEXT2, letterSpacing: 1.2, marginTop: 10, fontFamily: INTER_BOLD },

  stepRow: { flexDirection: 'row', gap: 12, backgroundColor: SURFACE, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(74,222,128,0.15)', justifyContent: 'center', alignItems: 'center' },
  stepNumTxt: { fontSize: 14, fontWeight: '900', color: P_LIGHT, fontFamily: INTER_EXTRA },
  stepTitle: { fontSize: 14, fontWeight: '800', color: TEXT, fontFamily: INTER_EXTRA },
  stepDesc: { fontSize: 12.5, color: TEXT2, marginTop: 3, lineHeight: 18, fontFamily: INTER_REG },

  labBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 14, marginTop: 4 },
  labBtnTxt: { fontSize: 14.5, fontWeight: '900', color: BG, fontFamily: INTER_EXTRA },

  sampleCard: { backgroundColor: SURFACE, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER, gap: 9 },
  sampleHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 2 },
  sampleHeadTxt: { fontSize: 12, fontWeight: '900', letterSpacing: 0.8, fontFamily: INTER_EXTRA },
  listRow: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  listTxt: { flex: 1, fontSize: 12.5, color: TEXT2, lineHeight: 18, fontFamily: INTER_REG },

  nextRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  nextBtn: { flex: 1, borderRadius: 13, paddingVertical: 13, alignItems: 'center' },
  nextGhost: { backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
  nextGhostTxt: { fontSize: 13.5, fontWeight: '800', color: TEXT, fontFamily: INTER_EXTRA },
  nextSolid: { backgroundColor: P_LIGHT },
  nextSolidTxt: { fontSize: 13.5, fontWeight: '900', color: BG, fontFamily: INTER_EXTRA },
});

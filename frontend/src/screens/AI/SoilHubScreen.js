/**
 * SoilHubScreen — cosmic entry point for everything soil.
 *
 * Solves the real farmer problem: most haven't tested their soil and don't know
 * how. So the hub leads with "Get tested" + "Find a lab" guidance, then the
 * tools to scan a card, enter values, view results, and ask the AI advisor.
 */
import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  Sprout, BookOpen, ScanLine, ClipboardList, MessageSquare, MapPin,
  FlaskConical, ChevronRight, Sparkles, Leaf,
} from 'lucide-react-native';
import { useLanguage } from '../../context/LanguageContext';
import { getSoilReports } from '../../services/aiApi';
import {
  BG, BG_GRADIENT, PRIMARY, P_LIGHT, ACCENT, TEXT, TEXT2, MUTED, SURFACE, BORDER,
  INTER_REG, INTER_SEMI, INTER_BOLD, INTER_EXTRA, CosmicHeader, ratingColor,
} from './components/soilShared';
import { askSoilAdvisor } from './components/soilAdvisor';
import { openSoilLabFinder } from './components/soilLab';

const { width: W } = Dimensions.get('window');
const TILE_W = (W - 40 - 12) / 2;

export default function SoilHubScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { t, language } = useLanguage();
  const [latest, setLatest] = useState(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    getSoilReports().then(list => {
      if (alive && Array.isArray(list) && list.length) setLatest(list[0]);
    }).catch(() => {});
    return () => { alive = false; };
  }, []));

  const TILES = [
    {
      id: 'guide', color: P_LIGHT, Icon: BookOpen,
      title: t('soilHub.tiles.guide.title', 'Get tested'),
      desc: t('soilHub.tiles.guide.desc', 'Govt scheme, fees & how-to'),
      onPress: () => navigation.navigate('SoilGuide'),
    },
    {
      id: 'scan', color: ACCENT, Icon: ScanLine,
      title: t('soilHub.tiles.scan.title', 'Scan card'),
      desc: t('soilHub.tiles.scan.desc', 'Photo → AI fills values'),
      onPress: () => navigation.navigate('SoilScan'),
    },
    {
      id: 'enter', color: '#60A5FA', Icon: ClipboardList,
      title: t('soilHub.tiles.enter.title', 'Enter values'),
      desc: t('soilHub.tiles.enter.desc', 'Type your test results'),
      onPress: () => navigation.navigate('SoilForm'),
    },
    {
      id: 'advisor', color: '#A78BFA', Icon: MessageSquare,
      title: t('soilHub.tiles.advisor.title', 'Ask Soil AI'),
      desc: t('soilHub.tiles.advisor.desc', 'Advice in your language'),
      onPress: () => askSoilAdvisor(navigation, latest || {}, language, t),
    },
    {
      id: 'lab', color: '#F472B6', Icon: MapPin,
      title: t('soilHub.tiles.lab.title', 'Find a lab'),
      desc: t('soilHub.tiles.lab.desc', 'Nearest testing centre'),
      onPress: () => openSoilLabFinder(t),
    },
    {
      id: 'report', color: PRIMARY, Icon: FlaskConical,
      title: t('soilHub.tiles.report.title', 'My reports'),
      desc: t('soilHub.tiles.report.desc', 'Results & history'),
      onPress: () => navigation.navigate('SoilReport'),
    },
  ];

  return (
    <View style={S.root}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <LinearGradient colors={BG_GRADIENT} style={StyleSheet.absoluteFill} />

      <CosmicHeader
        title={t('soilHub.title', 'Soil Health')}
        subtitle={t('soilHub.subtitle', 'Know your soil. Grow more.')}
        Icon={Sprout}
        onBack={() => navigation.goBack()}
        insetTop={insets.top}
      />

      <ScrollView contentContainerStyle={[S.scroll, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        {/* Hero line */}
        <Text style={S.hero}>
          {t('soilHub.hero', 'Healthy soil = better yield + lower fertilizer cost. Test it, understand it, act on it.')}
        </Text>

        {/* Latest report summary (if any) */}
        {latest ? (
          <SummaryCard report={latest} t={t} language={language} navigation={navigation} />
        ) : (
          <NoReportCard t={t} navigation={navigation} />
        )}

        {/* Tile grid */}
        <View style={S.grid}>
          {TILES.map(tile => (
            <TouchableOpacity key={tile.id} style={S.tile} activeOpacity={0.85} onPress={tile.onPress}>
              <View style={[S.tileIcon, { backgroundColor: tile.color + '22' }]}>
                <tile.Icon size={22} color={tile.color} strokeWidth={2.2} />
              </View>
              <Text style={S.tileTitle}>{tile.title}</Text>
              <Text style={S.tileDesc}>{tile.desc}</Text>
              <ChevronRight size={15} color={MUTED} style={S.tileArrow} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ── Latest report summary glass card ─────────────────────────────────────────
function SummaryCard({ report, t, language, navigation }) {
  const ratings = report.ratings || {};
  const lowParams = Object.entries(ratings)
    .filter(([, r]) => r && ['low', 'acidic', 'alkaline', 'highly_alkaline'].includes(r.rating))
    .map(([k]) => k);

  return (
    <View style={S.summary}>
      <View style={S.summaryTop}>
        <View style={{ flex: 1 }}>
          <Text style={S.summaryLabel}>{t('soilHub.summary.latest', 'YOUR LATEST TEST')}</Text>
          <Text style={S.summaryField} numberOfLines={1}>{report.fieldName || t('soilHub.summary.myField', 'My field')}</Text>
        </View>
        {report.ph != null && (
          <View style={S.phPill}>
            <Text style={S.phPillLabel}>pH</Text>
            <Text style={[S.phPillVal, { color: ratingColor(ratings.ph?.rating) }]}>{report.ph}</Text>
          </View>
        )}
      </View>

      <View style={S.summaryMeta}>
        <Leaf size={13} color={lowParams.length ? ACCENT : P_LIGHT} />
        <Text style={S.summaryMetaTxt}>
          {lowParams.length
            ? t('soilHub.summary.deficient', '{count} nutrient(s) need attention').replace('{count}', String(lowParams.length))
            : t('soilHub.summary.healthy', 'Balanced — looking good')}
        </Text>
      </View>

      <View style={S.summaryBtns}>
        <TouchableOpacity style={[S.summaryBtn, S.summaryBtnGhost]} activeOpacity={0.85} onPress={() => navigation.navigate('SoilReport', { report })}>
          <Text style={S.summaryBtnGhostTxt}>{t('soilHub.summary.view', 'View report')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[S.summaryBtn, S.summaryBtnSolid]} activeOpacity={0.85} onPress={() => askSoilAdvisor(navigation, report, language, t)}>
          <Sparkles size={14} color={BG} strokeWidth={2.4} />
          <Text style={S.summaryBtnSolidTxt}>{t('soilHub.summary.ask', 'Ask AI')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── First-time prompt (no test yet) ──────────────────────────────────────────
function NoReportCard({ t, navigation }) {
  return (
    <TouchableOpacity style={S.noReport} activeOpacity={0.9} onPress={() => navigation.navigate('SoilGuide')}>
      <View style={S.noReportIcon}>
        <BookOpen size={20} color={P_LIGHT} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={S.noReportTitle}>{t('soilHub.noReport.title', "Haven't tested your soil yet?")}</Text>
        <Text style={S.noReportDesc}>{t('soilHub.noReport.desc', 'Learn how to get it tested under the govt scheme — it costs about ₹40.')}</Text>
      </View>
      <ChevronRight size={18} color={MUTED} />
    </TouchableOpacity>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 20, paddingTop: 16 },

  hero: { fontSize: 13.5, color: TEXT2, lineHeight: 20, marginBottom: 16, fontFamily: INTER_REG },

  // Summary card
  summary: {
    backgroundColor: SURFACE, borderRadius: 20, padding: 16,
    borderWidth: 1, borderColor: BORDER, marginBottom: 18,
  },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryLabel: { fontSize: 10, fontWeight: '800', color: MUTED, letterSpacing: 1.1, fontFamily: INTER_BOLD },
  summaryField: { fontSize: 18, fontWeight: '800', color: TEXT, marginTop: 3, fontFamily: INTER_EXTRA },
  phPill: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: BORDER },
  phPillLabel: { fontSize: 9, color: MUTED, fontWeight: '700', fontFamily: INTER_BOLD },
  phPillVal: { fontSize: 18, fontWeight: '900', fontFamily: INTER_EXTRA },
  summaryMeta: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12 },
  summaryMetaTxt: { fontSize: 12.5, color: TEXT2, fontFamily: INTER_SEMI },
  summaryBtns: { flexDirection: 'row', gap: 10, marginTop: 16 },
  summaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 13, paddingVertical: 11 },
  summaryBtnGhost: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: BORDER },
  summaryBtnGhostTxt: { fontSize: 13.5, fontWeight: '700', color: TEXT, fontFamily: INTER_BOLD },
  summaryBtnSolid: { backgroundColor: P_LIGHT },
  summaryBtnSolidTxt: { fontSize: 13.5, fontWeight: '800', color: BG, fontFamily: INTER_EXTRA },

  // No-report prompt
  noReport: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(74,222,128,0.08)', borderRadius: 18, padding: 15,
    borderWidth: 1, borderColor: 'rgba(74,222,128,0.25)', marginBottom: 18,
  },
  noReportIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(74,222,128,0.15)', justifyContent: 'center', alignItems: 'center' },
  noReportTitle: { fontSize: 14.5, fontWeight: '800', color: TEXT, fontFamily: INTER_EXTRA },
  noReportDesc: { fontSize: 12, color: TEXT2, marginTop: 3, lineHeight: 17, fontFamily: INTER_REG },

  // Tile grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    width: TILE_W, minHeight: 128, backgroundColor: SURFACE, borderRadius: 20, padding: 15,
    borderWidth: 1, borderColor: BORDER,
  },
  tileIcon: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  tileTitle: { fontSize: 14.5, fontWeight: '800', color: TEXT, marginBottom: 4, fontFamily: INTER_EXTRA },
  tileDesc: { fontSize: 11.5, color: MUTED, lineHeight: 16, fontFamily: INTER_REG },
  tileArrow: { position: 'absolute', bottom: 13, right: 13 },
});

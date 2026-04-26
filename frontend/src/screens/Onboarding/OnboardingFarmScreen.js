/**
 * OnboardingFarmScreen — Step 4/5: Land size + Soil type (square cards in grid)
 * Irrigation moved to OnboardingIrrigationScreen (step 4b within same screen via local state)
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import SoilIcon from '../../components/SoilIcons';
import IrrigationIcon from '../../components/IrrigationIcons';
import { EntrySlide } from '../../components/ui/ImmersiveKit';
import { useLanguage } from '../../context/LanguageContext';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../../constants/colors';
import { s, vs, fs, ms } from '../../utils/responsive';

const SOILS = [
  { key: 'BLACK_COTTON', label: 'Black Cotton', labelMr: 'काळी माती', sk: 'black', bg: ['#3E3631', '#1A1512'] },
  { key: 'RED', label: 'Red Laterite', labelMr: 'लाल माती', sk: 'red', bg: ['#C45A3C', '#8B3626'] },
  { key: 'ALLUVIAL', label: 'Alluvial', labelMr: 'गाळाची', sk: 'alluvial', bg: ['#D4A76A', '#B8935A'] },
  { key: 'SANDY', label: 'Sandy', labelMr: 'वाळूमिश्र', sk: 'sandy', bg: ['#E8D5A3', '#C9B07A'] },
  { key: 'CLAY_LOAM', label: 'Clay Loam', labelMr: 'चिकणमाती', sk: 'clay', bg: ['#8B7D6B', '#6B5D4B'] },
  { key: 'LATERITE', label: 'Laterite', labelMr: 'जांभा', sk: 'laterite', bg: ['#CD7F32', '#A0522D'] },
  { key: 'UNKNOWN', label: 'Not Sure', labelMr: 'माहीत नाही', sk: null, bg: ['#9E9E9E', '#757575'] },
];

const IRRS = [
  { key: 'DRIP', label: 'Drip', labelMr: 'ठिबक', ik: 'drip', color: '#2196F3', bg: '#E3F2FD' },
  { key: 'SPRINKLER', label: 'Sprinkler', labelMr: 'तुषार', ik: 'sprinkler', color: '#00BCD4', bg: '#E0F7FA' },
  { key: 'FLOOD', label: 'Flood', labelMr: 'पाट', ik: 'flood', color: '#4CAF50', bg: '#E8F5E9' },
  { key: 'RAINFED', label: 'Rainfed', labelMr: 'कोरडवाहू', ik: 'rainfed', color: '#FF9800', bg: '#FFF3E0' },
  { key: 'MIXED', label: 'Mixed', labelMr: 'मिश्र', ik: null, color: '#9C27B0', bg: '#F3E5F5' },
];

export default function OnboardingFarmScreen({ navigation, route }) {
  const { t } = useLanguage();
  const prev = route.params || {};
  const [page, setPage] = useState(1); // 1 = land+soil, 2 = irrigation
  const [landSize, setLandSize] = useState('');
  const [soilType, setSoilType] = useState('');
  const [irrigation, setIrrigation] = useState('');

  // Page 1: land size required. Page 2: irrigation required.
  const canProceed = page === 1
    ? (landSize.trim().length > 0 && parseFloat(landSize) > 0 && soilType.length > 0)
    : (irrigation.length > 0);

  const handleNext = () => {
    if (!canProceed) return;
    if (page === 1) { setPage(2); return; }
    navigation.navigate('OnboardingCrops', {
      ...prev,
      landSizeAcres: landSize ? parseFloat(landSize) : null,
      soilType: soilType || 'UNKNOWN',
      irrigationType: irrigation || 'RAINFED',
    });
  };

  return (
    <View style={sty.safe}>
      <View style={[sty.bg, { backgroundColor: COLORS.pineGreen }]}>
        <ScrollView contentContainerStyle={sty.inner} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Header */}
          <View style={sty.headerRow}>
            <TouchableOpacity onPress={() => page === 2 ? setPage(1) : navigation.goBack()} style={sty.backBtn}>
              <Ionicons name="arrow-back" size={22} color="#FFF" />
            </TouchableOpacity>
            <View style={sty.progressRow}>
              {[1, 2, 3, 4, 5].map(i => <View key={i} style={[sty.pDot, i <= 4 && sty.pDotActive]} />)}
              <Text style={sty.pText}>Step 4 of 5</Text>
            </View>
          </View>

          {page === 1 ? (
            <EntrySlide delay={0} fromY={20}>
              <View style={sty.logoArea}>
                <View style={sty.logoCircle}><Ionicons name="earth-outline" size={ms(28)} color="#FFF" /></View>
                <Text style={sty.title}>{t('onboarding.farmTitle') || 'Tell us about your farm'}</Text>
              </View>

              <View style={sty.card}>
                <Text style={sty.label}>{t('onboarding.landSize') || 'Total Land (acres)'}</Text>
                <TextInput style={sty.landInput} value={landSize} onChangeText={setLandSize} placeholder={t('farmProfile.landSizePlaceholder')} keyboardType="decimal-pad" placeholderTextColor={COLORS.textLight} />

                <Text style={sty.label}>{t('onboarding.selectSoil') || 'Select Soil Type'}</Text>
                <View style={sty.soilGrid}>
                  {SOILS.map(soil => {
                    const sel = soilType === soil.key;
                    return (
                      <TouchableOpacity key={soil.key} style={sty.soilCard} onPress={() => setSoilType(soil.key)} activeOpacity={0.8}>
                        <LinearGradient colors={soil.bg} style={[sty.soilSquare, sel && sty.soilSquareSel]}>
                          {soil.sk ? <SoilIcon type={soil.sk} size={32} /> : <Ionicons name="help-circle-outline" size={28} color="#FFF" />}
                          {sel && <View style={sty.soilCheck}><Ionicons name="checkmark" size={12} color="#FFF" /></View>}
                        </LinearGradient>
                        <Text style={[sty.soilLabel, sel && { color: COLORS.primary, fontWeight: '700' }]}>{soil.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </EntrySlide>
          ) : (
            <EntrySlide delay={0} fromY={20}>
              <View style={sty.logoArea}>
                <View style={sty.logoCircle}><Ionicons name="water-outline" size={ms(28)} color="#FFF" /></View>
                <Text style={sty.title}>{t('onboarding.selectIrrigation') || 'Irrigation Method'}</Text>
                <Text style={sty.subtitle}>{t('onboarding.irrigationQuestion')}</Text>
              </View>

              <View style={sty.card}>
                <View style={sty.irrGrid}>
                  {IRRS.map(irr => {
                    const sel = irrigation === irr.key;
                    return (
                      <TouchableOpacity key={irr.key} style={[sty.irrCard, sel && { borderColor: irr.color, borderWidth: 3 }]} onPress={() => setIrrigation(irr.key)} activeOpacity={0.8}>
                        <View style={[sty.irrIconWrap, { backgroundColor: irr.bg }]}>
                          {irr.ik ? <IrrigationIcon type={irr.ik} size={40} /> : <Ionicons name="options-outline" size={32} color={irr.color} />}
                        </View>
                        <Text style={[sty.irrLabel, sel && { color: irr.color, fontWeight: '800' }]}>{irr.label}</Text>
                        <Text style={sty.irrLabelMr}>{irr.labelMr}</Text>
                        {sel && <View style={[sty.irrCheck, { backgroundColor: irr.color }]}><Ionicons name="checkmark" size={12} color="#FFF" /></View>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </EntrySlide>
          )}

        </ScrollView>

        {/* Bottom button */}
        <View style={sty.bottomBar}>
          <TouchableOpacity style={[sty.btn, !canProceed && { opacity: 0.4 }]} onPress={handleNext} disabled={!canProceed} activeOpacity={0.8}>
            <LinearGradient colors={canProceed ? [COLORS.cta || '#E65100', '#FF6D00'] : ['#CCC', '#AAA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={sty.btnGrad}>
              <Text style={sty.btnTxt}>{t('next')}</Text>
              <Ionicons name="arrow-forward" size={18} color="#FFF" />
            </LinearGradient>
          </TouchableOpacity>
          {!canProceed && <Text style={sty.hint}>{page === 1 ? 'Enter land size & select soil type' : 'Select irrigation method'}</Text>}
        </View>
      </View>
    </View>
  );
}

const sty = StyleSheet.create({
  safe: { flex: 1 },
  bg: { flex: 1 },
  inner: { paddingHorizontal: s(20), paddingTop: vs(50), paddingBottom: vs(20) },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: s(12), marginBottom: vs(12) },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: s(5) },
  pDot: { width: s(18), height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  pDotActive: { backgroundColor: '#FFF', width: s(24) },
  pText: { fontSize: fs(11), color: 'rgba(255,255,255,0.5)', marginLeft: s(6) },
  logoArea: { alignItems: 'center', marginBottom: vs(16) },
  logoCircle: { width: ms(52), height: ms(52), borderRadius: ms(16), backgroundColor: 'rgba(255,255,255,0.14)', justifyContent: 'center', alignItems: 'center', marginBottom: vs(8), borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  title: { fontSize: fs(20), fontWeight: TYPE.weight.black || '900', color: '#FFF', textAlign: 'center' },
  subtitle: { fontSize: fs(13), color: 'rgba(255,255,255,0.6)', marginTop: vs(4), textAlign: 'center' },
  card: { backgroundColor: COLORS.surface || '#FFF', borderRadius: s(22), padding: s(18), ...SHADOWS.large },
  label: { fontSize: fs(14), fontWeight: '700', color: COLORS.textDark, marginTop: vs(8), marginBottom: vs(8) },
  landInput: { borderWidth: 1.5, borderColor: COLORS.border || '#E0E0E0', borderRadius: s(14), paddingHorizontal: s(16), paddingVertical: vs(14), fontSize: fs(22), fontWeight: '800', color: COLORS.textDark, backgroundColor: COLORS.inputBg || '#FAFAFA', textAlign: 'center' },

  // Soil — square grid (4 columns)
  soilGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: s(8), marginTop: vs(4) },
  soilCard: { width: '22%', alignItems: 'center' },
  soilSquare: { width: '100%', aspectRatio: 1, borderRadius: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'transparent' },
  soilSquareSel: { borderColor: '#FFF', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 },
  soilCheck: { position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
  soilLabel: { fontSize: fs(9), color: '#666', marginTop: vs(3), textAlign: 'center' },

  // Irrigation — larger cards with bilingual labels
  irrGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: s(10) },
  irrCard: { width: '47%', backgroundColor: '#FAFAFA', borderRadius: 16, padding: s(14), alignItems: 'center', borderWidth: 2, borderColor: '#E8E8E8', position: 'relative' },
  irrIconWrap: { width: s(60), height: s(60), borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: vs(8) },
  irrLabel: { fontSize: fs(14), fontWeight: '600', color: '#333' },
  irrLabelMr: { fontSize: fs(11), color: '#999', marginTop: vs(1) },
  irrCheck: { position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },

  // Bottom
  bottomBar: { paddingHorizontal: s(20), paddingBottom: vs(30), paddingTop: vs(10) },
  btn: { borderRadius: RADIUS.full || 28, overflow: 'hidden' },
  btnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: s(8), paddingVertical: vs(16) },
  btnTxt: { color: '#FFF', fontSize: fs(16), fontWeight: TYPE.weight.bold || '700' },
  hint: { fontSize: fs(12), color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: vs(6) },
});

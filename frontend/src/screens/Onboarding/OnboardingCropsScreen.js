/**
 * OnboardingCropsScreen — Step 4/4: Select crops with visual grid.
 * Final step — calls POST /onboarding/complete.
 * Matches app's card design.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import CropIcon from '../../components/CropIcons';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { completeOnboarding, skipOnboarding } from '../../services/farmApi';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../../constants/colors';
import { s, vs, fs, ms } from '../../utils/responsive';

const CROPS = [
  'Soybean', 'Cotton', 'Rice', 'Wheat', 'Maize', 'Sugarcane',
  'Onion', 'Tomato', 'Chilli', 'Potato', 'Groundnut', 'Jowar',
  'Bajra', 'Turmeric', 'Pomegranate', 'Grape', 'Mango', 'Banana',
  'Brinjal', 'Okra', 'Cauliflower', 'Cabbage', 'Sunflower', 'Ginger',
];

export default function OnboardingCropsScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { updateUser } = useAuth();
  const prev = route.params || {};
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);

  const toggle = (crop) => setSelected(p => { const n = new Set(p); n.has(crop) ? n.delete(crop) : n.add(crop); return n; });

  const handleComplete = async () => {
    setSaving(true);
    try {
      const result = await completeOnboarding({
        firstName: prev.firstName || '', lastName: prev.lastName || '',
        district: prev.district || '', taluka: prev.taluka || '', village: prev.village || '',
        pincode: prev.pincode || '', latitude: prev.latitude || null, longitude: prev.longitude || null,
        landSizeAcres: prev.landSizeAcres || null, soilType: prev.soilType || 'UNKNOWN',
        irrigationType: prev.irrigationType || 'RAINFED', cropTypes: Array.from(selected),
      });
      updateUser({ name: result.user?.name, onboardingStep: 'COMPLETE', district: prev.district, totalFarms: 1 });
    } catch (err) {
      Alert.alert(t('login.error'), err.response?.data?.error?.message || err.message || t('onboarding.failedTryAgain'));
    } finally { setSaving(false); }
  };

  const handleSkip = async () => {
    setSaving(true);
    try { await skipOnboarding(); updateUser({ onboardingStep: 'COMPLETE' }); }
    catch { Alert.alert(t('login.error'), t('onboarding.failedToSkip')); }
    finally { setSaving(false); }
  };

  return (
    <View style={sty.safe}>
      <View style={[sty.bg, { backgroundColor: COLORS.pineGreen }]}>

        {/* Header */}
        <View style={sty.headerArea}>
          <View style={sty.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={sty.backBtn}>
              <Ionicons name="arrow-back" size={22} color="#FFF" />
            </TouchableOpacity>
            <View style={sty.progressRow}>
              {[1, 2, 3, 4, 5].map(i => <View key={i} style={[sty.pDot, sty.pDotActive]} />)}
              <Text style={sty.pText}>Step 5 of 5</Text>
            </View>
          </View>
          <Text style={sty.title}>{t('onboarding.cropsTitle') || 'What crops do you grow?'}</Text>
          <Text style={sty.subtitle}>{t('onboarding.cropsSub') || 'Select your current or planned crops'}</Text>
          {selected.size > 0 && (
            <View style={sty.countBadge}><Text style={sty.countText}>{selected.size} selected</Text></View>
          )}
        </View>

        {/* Crop Grid inside card */}
        <View style={sty.cardWrap}>
          <View style={sty.card}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={sty.grid}>
              {CROPS.map(crop => {
                const sel = selected.has(crop);
                return (
                  <TouchableOpacity key={crop} style={[sty.cropCard, sel && sty.cropSel]} onPress={() => toggle(crop)} activeOpacity={0.7}>
                    <CropIcon crop={crop} size={40} />
                    <Text style={[sty.cropName, sel && { color: COLORS.primary, fontWeight: '700' }]} numberOfLines={1}>{t('crops.' + crop.toLowerCase()) || crop}</Text>
                    {sel && <Ionicons name="checkmark-circle" size={16} color={COLORS.primary} style={{ position: 'absolute', top: 3, right: 3 }} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>

        {/* Footer buttons */}
        <View style={sty.footer}>
          <TouchableOpacity style={sty.skipBtn} onPress={handleSkip} disabled={saving} activeOpacity={0.7}>
            <Text style={sty.skipTxt}>{t('onboarding.skip') || 'Skip'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[sty.completeBtn, selected.size === 0 && { opacity: 0.4 }]}
            onPress={handleComplete}
            disabled={saving || selected.size === 0}
            activeOpacity={0.8}
          >
            <LinearGradient colors={selected.size > 0 ? [COLORS.cta || '#E65100', '#FF6D00'] : ['#CCC', '#AAA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={sty.completeBtnGrad}>
              {saving ? <ActivityIndicator color="#FFF" /> : <>
                <Text style={sty.completeTxt}>{selected.size > 0 ? (t('onboarding.completeSetup') || 'Complete Setup') : 'Select at least 1 crop'}</Text>
                {selected.size > 0 && <Ionicons name="checkmark" size={18} color="#FFF" />}
              </>}
            </LinearGradient>
          </TouchableOpacity>
        </View>

      </View>
    </View>
  );
}

const sty = StyleSheet.create({
  safe: { flex: 1 },
  bg: { flex: 1 },
  headerArea: { paddingHorizontal: s(24), paddingTop: vs(50) },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: s(12), marginBottom: vs(12) },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: s(5) },
  pDot: { width: s(20), height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  pDotActive: { backgroundColor: '#FFF', width: s(26) },
  pText: { fontSize: fs(11), color: 'rgba(255,255,255,0.5)', marginLeft: s(6) },
  title: { fontSize: fs(22), fontWeight: TYPE.weight.black || '900', color: '#FFF', textAlign: 'center' },
  subtitle: { fontSize: fs(13), color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: vs(4) },
  countBadge: { alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: s(12), paddingVertical: vs(3), borderRadius: 12, marginTop: vs(8) },
  countText: { color: '#FFF', fontSize: fs(12), fontWeight: '700' },

  cardWrap: { flex: 1, paddingHorizontal: s(16), paddingTop: vs(14) },
  card: { flex: 1, backgroundColor: COLORS.surface || '#FFF', borderRadius: s(24), padding: s(12), ...SHADOWS.large },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: s(8), paddingBottom: vs(10) },
  cropCard: { width: '22%', backgroundColor: '#FAFAFA', borderRadius: 12, padding: s(6), alignItems: 'center', borderWidth: 1.5, borderColor: '#E8E8E8', position: 'relative' },
  cropSel: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '08' },
  cropName: { fontSize: fs(9), color: '#333', textAlign: 'center', marginTop: vs(2) },

  footer: { flexDirection: 'row', gap: s(10), paddingHorizontal: s(20), paddingVertical: vs(14), paddingBottom: vs(30) },
  skipBtn: { paddingVertical: vs(14), paddingHorizontal: s(20), borderRadius: RADIUS.full || 28, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' },
  skipTxt: { fontSize: fs(14), color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  completeBtn: { flex: 1, borderRadius: RADIUS.full || 28, overflow: 'hidden' },
  completeBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: s(8), paddingVertical: vs(14) },
  completeTxt: { color: '#FFF', fontSize: fs(15), fontWeight: TYPE.weight.bold || '700' },
});

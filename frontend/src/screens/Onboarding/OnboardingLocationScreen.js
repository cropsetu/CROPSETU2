/**
 * OnboardingLocationScreen — Step 2/4: Farm location
 * Cascading District → Taluka → Village. Matches app's card design.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import LocationPicker from '../../components/LocationPicker';
import { STATE_LIST, getDistrictsForState, getTalukas } from '../../constants/locations';
import { useLanguage } from '../../context/LanguageContext';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../../constants/colors';
import { s, vs, fs, ms } from '../../utils/responsive';

export default function OnboardingLocationScreen({ navigation, route }) {
  const { t } = useLanguage();
  const prev = route.params || {};
  const [state, setState] = useState('Maharashtra');
  const [district, setDistrict] = useState('');
  const [taluka, setTaluka] = useState('');
  const [village, setVillage] = useState('');
  const [pincode, setPincode] = useState('');
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  const canProceed = state.trim().length > 0 && district.trim().length > 0;

  const captureGPS = async () => {
    setGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert(t('onboarding.permissionTitle'), t('onboarding.enableLocation')); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLat(loc.coords.latitude); setLng(loc.coords.longitude);
    } catch { Alert.alert(t('farmProfile.gpsErrorTitle'), t('farmProfile.gpsErrorMsg')); }
    finally { setGpsLoading(false); }
  };

  return (
    <View style={sty.safe}>
      <View style={[sty.bg, { backgroundColor: COLORS.pineGreen }]}>
        <ScrollView contentContainerStyle={sty.inner} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Header */}
          <View style={sty.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={sty.backBtn}>
              <Ionicons name="arrow-back" size={22} color="#FFF" />
            </TouchableOpacity>
            <View style={sty.progressRow}>
              {[1, 2, 3, 4, 5].map(i => <View key={i} style={[sty.pDot, i <= 3 && sty.pDotActive]} />)}
              <Text style={sty.pText}>Step 3 of 5</Text>
            </View>
          </View>

          <View style={sty.logoArea}>
            <View style={sty.logoCircle}><Ionicons name="location-outline" size={ms(32)} color="#FFF" /></View>
            <Text style={sty.title}>{t('onboarding.locationTitle') || 'Where is your farm?'}</Text>
          </View>

          {/* Card */}
          <View style={sty.card}>
            <Text style={sty.label}>State *</Text>
            <LocationPicker title={t('farmProfile.selectState')} items={STATE_LIST} selected={state} onSelect={v => { setState(v); setDistrict(''); setTaluka(''); }} placeholder={t('farmProfile.selectStatePlaceholder')} />

            <Text style={sty.label}>{t('onboarding.selectDistrict') || 'District'} *</Text>
            <LocationPicker title={t('onboarding.selectDistrict')} items={getDistrictsForState(state)} selected={district} onSelect={v => { setDistrict(v); setTaluka(''); }} placeholder={t('onboarding.selectDistrictPlaceholder')} disabled={!state} />

            <Text style={sty.label}>{t('onboarding.selectTaluka') || 'Taluka'}</Text>
            {state === 'Maharashtra' ? (
              <LocationPicker title={t('onboarding.selectTaluka')} items={getTalukas(district)} selected={taluka} onSelect={setTaluka} placeholder={t('onboarding.selectTalukaPlaceholder')} disabled={!district} />
            ) : (
              <TextInput style={sty.input} value={taluka} onChangeText={setTaluka} placeholder={t('onboarding.talukaPlaceholder')} placeholderTextColor={COLORS.textLight} />
            )}

            <Text style={sty.label}>{t('onboarding.enterVillage') || 'Village'}</Text>
            <TextInput style={sty.input} value={village} onChangeText={setVillage} placeholder={t('onboarding.enterVillage')} placeholderTextColor={COLORS.textLight} />

            <Text style={sty.label}>{t('farmProfile.pincode') || 'Pincode'}</Text>
            <TextInput style={sty.input} value={pincode} onChangeText={setPincode} placeholder={t('onboarding.pincodePlaceholder')} keyboardType="numeric" maxLength={6} placeholderTextColor={COLORS.textLight} />

            {/* GPS */}
            <TouchableOpacity style={sty.gpsBtn} onPress={captureGPS} disabled={gpsLoading}>
              <Ionicons name={lat ? 'checkmark-circle' : 'navigate-outline'} size={18} color={lat ? '#4CAF50' : COLORS.primary} />
              <Text style={sty.gpsTxt}>
                {gpsLoading ? 'Getting location...' : lat ? `GPS: ${lat.toFixed(4)}, ${lng.toFixed(4)}` : (t('onboarding.detectLocation') || 'Auto-detect from GPS')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[sty.btn, !canProceed && { opacity: 0.5 }]}
              onPress={() => canProceed && navigation.navigate('OnboardingFarm', { ...prev, state, district, taluka, village, pincode, latitude: lat, longitude: lng })}
              disabled={!canProceed}
            >
              <LinearGradient colors={[COLORS.primary, COLORS.primaryMedium || '#2D9B63']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={sty.btnGrad}>
                <Text style={sty.btnTxt}>{t('next')}</Text>
                <Ionicons name="arrow-forward" size={18} color="#FFF" />
              </LinearGradient>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </View>
    </View>
  );
}

const sty = StyleSheet.create({
  safe: { flex: 1 },
  bg: { flex: 1 },
  inner: { paddingHorizontal: s(24), paddingTop: vs(50), paddingBottom: vs(40) },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: s(12), marginBottom: vs(16) },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: s(5) },
  pDot: { width: s(20), height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  pDotActive: { backgroundColor: '#FFF', width: s(26) },
  pText: { fontSize: fs(11), color: 'rgba(255,255,255,0.5)', marginLeft: s(6) },
  logoArea: { alignItems: 'center', marginBottom: vs(20) },
  logoCircle: { width: ms(60), height: ms(60), borderRadius: ms(18), backgroundColor: 'rgba(255,255,255,0.14)', justifyContent: 'center', alignItems: 'center', marginBottom: vs(10), borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  title: { fontSize: fs(22), fontWeight: TYPE.weight.black || '900', color: '#FFF', textAlign: 'center' },
  card: { backgroundColor: COLORS.surface || '#FFF', borderRadius: s(24), padding: s(22), borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', ...SHADOWS.large },
  label: { fontSize: fs(13), fontWeight: '600', color: COLORS.textDark, marginTop: vs(14), marginBottom: vs(4) },
  input: { borderWidth: 1.5, borderColor: COLORS.border || '#E0E0E0', borderRadius: s(14), paddingHorizontal: s(14), paddingVertical: vs(13), fontSize: fs(15), color: COLORS.textDark, backgroundColor: COLORS.inputBg || '#FAFAFA' },
  gpsBtn: { flexDirection: 'row', alignItems: 'center', gap: s(8), marginTop: vs(14), paddingVertical: vs(12), paddingHorizontal: s(14), borderWidth: 1.5, borderColor: COLORS.primary + '30', borderRadius: s(14), borderStyle: 'dashed', backgroundColor: COLORS.primary + '05' },
  gpsTxt: { fontSize: fs(13), color: COLORS.primary, fontWeight: '600' },
  btn: { marginTop: vs(18), borderRadius: RADIUS.full || 28, overflow: 'hidden' },
  btnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: s(8), paddingVertical: vs(16), ...SHADOWS.greenGlow },
  btnTxt: { color: '#FFF', fontSize: fs(16), fontWeight: TYPE.weight.bold || '700' },
});

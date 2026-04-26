/**
 * OnboardingProfileScreen — Screen 2/2: Farm profile setup.
 * White background, single scrollable form with profile photo, name,
 * location, farm details, and crops. Syncs all fields to user profile.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView,
  Platform, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import LocationPicker from '../../components/LocationPicker';
import SoilIcon from '../../components/SoilIcons';
import IrrigationIcon from '../../components/IrrigationIcons';
import CropIcon from '../../components/CropIcons';
import { STATE_LIST, getDistrictsForState, getTalukas } from '../../constants/locations';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { completeOnboarding, skipOnboarding } from '../../services/farmApi';
import { compressImage } from '../../utils/mediaCompressor';
import api from '../../services/api';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../../constants/colors';
import { s, vs, fs, ms } from '../../utils/responsive';

const SOILS = [
  { key: 'BLACK_COTTON', label: 'Black Cotton', sk: 'black', bg: ['#3E3631', '#1A1512'] },
  { key: 'RED', label: 'Red', sk: 'red', bg: ['#C45A3C', '#8B3626'] },
  { key: 'ALLUVIAL', label: 'Alluvial', sk: 'alluvial', bg: ['#D4A76A', '#B8935A'] },
  { key: 'SANDY', label: 'Sandy', sk: 'sandy', bg: ['#E8D5A3', '#C9B07A'] },
  { key: 'CLAY_LOAM', label: 'Clay Loam', sk: 'clay', bg: ['#8B7D6B', '#6B5D4B'] },
  { key: 'LATERITE', label: 'Laterite', sk: 'laterite', bg: ['#CD7F32', '#A0522D'] },
  { key: 'UNKNOWN', label: 'Not Sure', sk: null, bg: ['#9E9E9E', '#757575'] },
];

const IRRS = [
  { key: 'DRIP', label: 'Drip', ik: 'drip', color: '#2196F3', bg: '#E3F2FD' },
  { key: 'SPRINKLER', label: 'Sprinkler', ik: 'sprinkler', color: '#00BCD4', bg: '#E0F7FA' },
  { key: 'FLOOD', label: 'Flood', ik: 'flood', color: '#4CAF50', bg: '#E8F5E9' },
  { key: 'RAINFED', label: 'Rainfed', ik: 'rainfed', color: '#FF9800', bg: '#FFF3E0' },
  { key: 'MIXED', label: 'Mixed', ik: null, color: '#9C27B0', bg: '#F3E5F5' },
];

const CROPS = [
  'Soybean', 'Cotton', 'Rice', 'Wheat', 'Maize', 'Sugarcane',
  'Onion', 'Tomato', 'Chilli', 'Potato', 'Groundnut', 'Jowar',
  'Bajra', 'Turmeric', 'Pomegranate', 'Grape', 'Mango', 'Banana',
  'Brinjal', 'Okra', 'Cauliflower', 'Cabbage', 'Sunflower', 'Ginger',
];

export default function OnboardingProfileScreen({ navigation }) {
  const { t } = useLanguage();
  const { updateUser } = useAuth();

  // Profile photo
  const [avatarUri, setAvatarUri] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Name
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  // Location
  const [state, setState] = useState('Maharashtra');
  const [district, setDistrict] = useState('');
  const [taluka, setTaluka] = useState('');
  const [village, setVillage] = useState('');
  const [pincode, setPincode] = useState('');
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  // Farm
  const [farmName, setFarmName] = useState('');
  const [landSize, setLandSize] = useState('');
  const [soilType, setSoilType] = useState('');
  const [irrigation, setIrrigation] = useState('');

  // Crops
  const [selectedCrops, setSelectedCrops] = useState(new Set());

  // UI
  const [saving, setSaving] = useState(false);

  const canSubmit = firstName.trim().length >= 1 && district.trim().length > 0;

  const toggleCrop = (crop) => setSelectedCrops(p => {
    const n = new Set(p); n.has(crop) ? n.delete(crop) : n.add(crop); return n;
  });

  // ── Profile Photo ─────────────────────────────────────────────────────────
  const handlePickPhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('onboarding.permissionTitle'), t('profile.photoPermission'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    // Validate using MIME type — Android gallery URIs often lack a file extension
    const mime = (asset.mimeType || asset.type || '').toLowerCase();
    const ext  = (asset.uri.split('.').pop() || '').toLowerCase();
    const isValidType = ['jpg', 'jpeg', 'png', 'webp'].includes(ext)
      || mime.includes('jpeg') || mime.includes('png') || mime.includes('webp');
    if (!isValidType) {
      Alert.alert(t('profile.invalidFileType'), t('profile.invalidFileMsg'));
      return;
    }

    setUploadingPhoto(true);
    try {
      const { uri: compressedUri } = await compressImage(asset.uri);
      setAvatarUri(compressedUri);
      const formData = new FormData();
      formData.append('file', {
        uri: Platform.OS === 'android' ? compressedUri : compressedUri.replace('file://', ''),
        name: 'avatar.jpg',
        type: 'image/jpeg',
      });
      const { data } = await api.put('/users/me', formData);
      updateUser({ avatar: data.data.avatar });
      setAvatarUri(data.data.avatar || compressedUri);
    } catch {
      Alert.alert(t('profile.uploadFailed'), t('profile.uploadFailedMsg'));
      setAvatarUri(null);
    } finally {
      setUploadingPhoto(false);
    }
  }, [updateUser]);

  // ── GPS ────────────────────────────────────────────────────────────────────
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

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleComplete = async () => {
    setSaving(true);
    try {
      const result = await completeOnboarding({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        farmName: farmName.trim() || `${firstName.trim()}'s Farm`,
        state, district, taluka, village, pincode,
        latitude: lat, longitude: lng,
        landSizeAcres: landSize ? parseFloat(landSize) : null,
        soilType: soilType || 'UNKNOWN',
        irrigationType: irrigation || 'RAINFED',
        cropTypes: Array.from(selectedCrops),
      });
      // Sync ALL profile fields so Profile tab shows them immediately
      updateUser({
        name: result.user?.name,
        onboardingStep: 'COMPLETE',
        state: result.user?.state || state,
        district: result.user?.district || district,
        taluka: result.user?.taluka || taluka,
        village: result.user?.village || village,
        pincode: result.user?.pincode || pincode,
        totalFarms: 1,
      });
    } catch (err) {
      Alert.alert(t('login.error'), err.response?.data?.error?.message || err.message || t('onboarding.failedTryAgain'));
    } finally { setSaving(false); }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      await skipOnboarding();
      updateUser({ onboardingStep: 'COMPLETE' });
    } catch { Alert.alert(t('login.error'), t('onboarding.failedToSkip')); }
    finally { setSaving(false); }
  };

  // ── Progress ───────────────────────────────────────────────────────────────
  const filledSections = [
    firstName.trim().length > 0,
    district.trim().length > 0,
    landSize.trim().length > 0 && soilType.length > 0,
    selectedCrops.size > 0,
  ].filter(Boolean).length;

  const initials = firstName ? firstName[0].toUpperCase() : '?';

  return (
    <View style={sty.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={sty.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ── Header with back ─────────────────────────────────────────── */}
          <View style={sty.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={sty.backBtn} activeOpacity={0.7}>
              <Ionicons name="arrow-back" size={20} color={COLORS.textDark} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={sty.headerTitle}>{t('onboarding.profileTitle')}</Text>
              <Text style={sty.headerSub}>{t('onboarding.nameSub')}</Text>
            </View>
          </View>

          {/* Progress bar */}
          <View style={sty.progressBar}>
            <View style={[sty.progressFill, { width: `${Math.max(8, (filledSections / 4) * 100)}%` }]} />
          </View>

          {/* ── Profile Photo ────────────────────────────────────────────── */}
          <View style={sty.photoSection}>
            <TouchableOpacity style={sty.avatarWrap} onPress={handlePickPhoto} activeOpacity={0.8}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={sty.avatarImg} />
              ) : (
                <View style={sty.avatarPlaceholder}>
                  <Text style={sty.avatarInitial}>{initials}</Text>
                </View>
              )}
              <View style={sty.cameraBtn}>
                {uploadingPhoto
                  ? <ActivityIndicator size="small" color="#FFF" />
                  : <Ionicons name="camera" size={14} color="#FFF" />}
              </View>
            </TouchableOpacity>
            <Text style={sty.photoHint}>{t('onboarding.tapAddPhoto')}</Text>
          </View>

          {/* ── 1. Your Name ─────────────────────────────────────────────── */}
          <View style={sty.section}>
            <View style={sty.sectionHeader}>
              <View style={[sty.sectionIcon, { backgroundColor: '#E3F2FD' }]}>
                <Ionicons name="person-outline" size={16} color="#1976D2" />
              </View>
              <Text style={sty.sectionTitle}>{t('onboarding.yourName')}</Text>
              <Text style={sty.required}>*</Text>
            </View>
            <View style={sty.row}>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={sty.input}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder={t('onboarding.firstName')}
                  placeholderTextColor={COLORS.textLight}
                  maxLength={50}
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={sty.input}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder={t('onboarding.lastName')}
                  placeholderTextColor={COLORS.textLight}
                  maxLength={50}
                />
              </View>
            </View>
          </View>

          {/* ── 2. Farm Location ──────────────────────────────────────────── */}
          <View style={sty.section}>
            <View style={sty.sectionHeader}>
              <View style={[sty.sectionIcon, { backgroundColor: '#E8F5E9' }]}>
                <Ionicons name="location-outline" size={16} color="#388E3C" />
              </View>
              <Text style={sty.sectionTitle}>{t('farmProfile.farmLocation')}</Text>
              <Text style={sty.required}>*</Text>
            </View>

            <Text style={sty.fieldLabel}>{t('farmProfile.selectState')}</Text>
            <LocationPicker
              title={t('farmProfile.selectState')}
              items={STATE_LIST}
              selected={state}
              onSelect={v => { setState(v); setDistrict(''); setTaluka(''); }}
              placeholder={t('farmProfile.selectStatePlaceholder')}
            />

            <Text style={sty.fieldLabel}>{t('onboarding.selectDistrict')} *</Text>
            <LocationPicker
              title={t('onboarding.selectDistrict')}
              items={getDistrictsForState(state)}
              selected={district}
              onSelect={v => { setDistrict(v); setTaluka(''); }}
              placeholder={t('onboarding.selectDistrictPlaceholder')}
              disabled={!state}
            />

            <Text style={sty.fieldLabel}>{t('farmProfile.taluka')}</Text>
            {state === 'Maharashtra' ? (
              <LocationPicker
                title={t('onboarding.selectTaluka')}
                items={getTalukas(district)}
                selected={taluka}
                onSelect={setTaluka}
                placeholder={t('onboarding.selectTalukaPlaceholder')}
                disabled={!district}
              />
            ) : (
              <TextInput style={sty.input} value={taluka} onChangeText={setTaluka} placeholder={t('onboarding.talukaPlaceholder')} placeholderTextColor={COLORS.textLight} />
            )}

            <View style={sty.row}>
              <View style={{ flex: 1 }}>
                <Text style={sty.fieldLabel}>{t('farmProfile.village')}</Text>
                <TextInput style={sty.input} value={village} onChangeText={setVillage} placeholder={t('onboarding.enterVillage')} placeholderTextColor={COLORS.textLight} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={sty.fieldLabel}>{t('farmProfile.pincode')}</Text>
                <TextInput style={sty.input} value={pincode} onChangeText={setPincode} placeholder={t('onboarding.pincodePlaceholder')} keyboardType="numeric" maxLength={6} placeholderTextColor={COLORS.textLight} />
              </View>
            </View>

            <TouchableOpacity style={sty.gpsBtn} onPress={captureGPS} disabled={gpsLoading}>
              <Ionicons name={lat ? 'checkmark-circle' : 'navigate-outline'} size={16} color={lat ? '#4CAF50' : COLORS.primary} />
              <Text style={sty.gpsTxt}>
                {gpsLoading ? 'Getting location...' : lat ? `GPS captured (${lat.toFixed(4)}, ${lng.toFixed(4)})` : 'Auto-detect from GPS'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── 3. Farm Details ───────────────────────────────────────────── */}
          <View style={sty.section}>
            <View style={sty.sectionHeader}>
              <View style={[sty.sectionIcon, { backgroundColor: '#FFF3E0' }]}>
                <Ionicons name="earth-outline" size={16} color="#E65100" />
              </View>
              <Text style={sty.sectionTitle}>{t('farmDetails')}</Text>
            </View>

            <Text style={sty.fieldLabel}>{t('farmProfile.farmName')}</Text>
            <TextInput
              style={sty.input}
              value={farmName}
              onChangeText={setFarmName}
              placeholder={`${firstName.trim() || 'My'}'s Farm`}
              placeholderTextColor={COLORS.textLight}
              maxLength={60}
            />

            <Text style={[sty.fieldLabel, { marginTop: vs(14) }]}>Total Land (acres)</Text>
            <TextInput
              style={[sty.input, { textAlign: 'center', fontSize: fs(18), fontWeight: '700' }]}
              value={landSize}
              onChangeText={setLandSize}
              placeholder={t('farmProfile.landSizePlaceholder')}
              keyboardType="decimal-pad"
              placeholderTextColor={COLORS.textLight}
            />

            <Text style={[sty.fieldLabel, { marginTop: vs(14) }]}>{t('farmProfile.soilType')}</Text>
            <View style={sty.soilGrid}>
              {SOILS.map(soil => {
                const sel = soilType === soil.key;
                return (
                  <TouchableOpacity key={soil.key} style={sty.soilCard} onPress={() => setSoilType(soil.key)} activeOpacity={0.8}>
                    <LinearGradient colors={soil.bg} style={[sty.soilSquare, sel && sty.soilSquareSel]}>
                      {soil.sk ? <SoilIcon type={soil.sk} size={24} /> : <Ionicons name="help-circle-outline" size={22} color="#FFF" />}
                      {sel && <View style={sty.soilCheck}><Ionicons name="checkmark" size={10} color="#FFF" /></View>}
                    </LinearGradient>
                    <Text style={[sty.soilLabel, sel && { color: COLORS.primary, fontWeight: '700' }]}>{soil.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[sty.fieldLabel, { marginTop: vs(14) }]}>{t('farmProfile.irrigationLabel')}</Text>
            <View style={sty.irrRow}>
              {IRRS.map(irr => {
                const sel = irrigation === irr.key;
                return (
                  <TouchableOpacity key={irr.key} style={[sty.irrChip, sel && { borderColor: irr.color, backgroundColor: irr.bg }]} onPress={() => setIrrigation(irr.key)} activeOpacity={0.7}>
                    <View style={[sty.irrIconSmall, { backgroundColor: irr.bg }]}>
                      {irr.ik ? <IrrigationIcon type={irr.ik} size={20} /> : <Ionicons name="options-outline" size={16} color={irr.color} />}
                    </View>
                    <Text style={[sty.irrLabel, sel && { color: irr.color, fontWeight: '700' }]}>{irr.label}</Text>
                    {sel && <Ionicons name="checkmark-circle" size={14} color={irr.color} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ── 4. Crops ──────────────────────────────────────────────────── */}
          <View style={sty.section}>
            <View style={sty.sectionHeader}>
              <View style={[sty.sectionIcon, { backgroundColor: '#E8F5E9' }]}>
                <Ionicons name="leaf-outline" size={16} color="#2E7D32" />
              </View>
              <Text style={sty.sectionTitle}>{t('onboarding.cropsTitle')}</Text>
              {selectedCrops.size > 0 && (
                <View style={sty.cropBadge}><Text style={sty.cropBadgeText}>{selectedCrops.size}</Text></View>
              )}
            </View>
            <View style={sty.cropGrid}>
              {CROPS.map(crop => {
                const sel = selectedCrops.has(crop);
                return (
                  <TouchableOpacity key={crop} style={[sty.cropCard, sel && sty.cropCardSel]} onPress={() => toggleCrop(crop)} activeOpacity={0.7}>
                    <CropIcon crop={crop} size={28} />
                    <Text style={[sty.cropName, sel && { color: COLORS.primary, fontWeight: '700' }]} numberOfLines={1}>{crop}</Text>
                    {sel && <Ionicons name="checkmark-circle" size={12} color={COLORS.primary} style={{ position: 'absolute', top: 2, right: 2 }} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={{ height: vs(100) }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Fixed Bottom Bar ──────────────────────────────────────────── */}
      <View style={sty.bottomBar}>
        <TouchableOpacity style={sty.skipBtn} onPress={handleSkip} disabled={saving} activeOpacity={0.7}>
          <Text style={sty.skipTxt}>{t('onboarding.skip')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[sty.submitBtn, !canSubmit && { opacity: 0.45 }]}
          onPress={handleComplete}
          disabled={saving || !canSubmit}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={canSubmit ? [COLORS.primary, COLORS.primaryMedium || '#21865A'] : ['#CCC', '#AAA']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={sty.submitGrad}
          >
            {saving ? <ActivityIndicator color="#FFF" /> : (
              <>
                <Text style={sty.submitTxt}>
                  {canSubmit ? 'Complete Setup' : 'Fill name & district'}
                </Text>
                {canSubmit && <Ionicons name="checkmark-circle" size={18} color="#FFF" />}
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const sty = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { paddingHorizontal: s(20), paddingTop: vs(54) },

  // Header
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: s(12), marginBottom: vs(12) },
  backBtn: {
    width: s(40), height: s(40), borderRadius: s(12),
    backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { fontSize: fs(20), fontWeight: TYPE.weight.black || '900', color: COLORS.textDark },
  headerSub: { fontSize: fs(12), color: COLORS.textMedium, marginTop: vs(2) },

  // Progress
  progressBar: { height: 5, borderRadius: 3, backgroundColor: '#F0F0F0', overflow: 'hidden', marginBottom: vs(20) },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: COLORS.primary },

  // Photo
  photoSection: { alignItems: 'center', marginBottom: vs(20) },
  avatarWrap: { position: 'relative' },
  avatarImg: { width: ms(90), height: ms(90), borderRadius: ms(30), backgroundColor: '#F0F0F0' },
  avatarPlaceholder: {
    width: ms(90), height: ms(90), borderRadius: ms(30),
    backgroundColor: COLORS.primary + '15', justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: COLORS.primary + '30', borderStyle: 'dashed',
  },
  avatarInitial: { fontSize: fs(32), fontWeight: '800', color: COLORS.primary },
  cameraBtn: {
    position: 'absolute', bottom: 0, right: 0,
    width: ms(30), height: ms(30), borderRadius: ms(15),
    backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#FFFFFF',
  },
  photoHint: { fontSize: fs(12), color: COLORS.textLight, marginTop: vs(8) },

  // Sections
  section: {
    backgroundColor: '#FFFFFF', borderRadius: s(16),
    padding: s(16), marginBottom: vs(12),
    borderWidth: 1, borderColor: '#F0F0F0',
    ...SHADOWS.small,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: s(8), marginBottom: vs(12) },
  sectionIcon: {
    width: s(30), height: s(30), borderRadius: s(8),
    justifyContent: 'center', alignItems: 'center',
  },
  sectionTitle: { fontSize: fs(16), fontWeight: TYPE.weight.bold || '700', color: COLORS.textDark, flex: 1 },
  required: { fontSize: fs(14), color: COLORS.error || '#EF4444', fontWeight: '700' },

  // Inputs
  row: { flexDirection: 'row', gap: s(10) },
  input: {
    borderWidth: 1.5, borderColor: '#E8E8E8', borderRadius: s(12),
    paddingHorizontal: s(14), paddingVertical: vs(12),
    fontSize: fs(15), color: COLORS.textDark, backgroundColor: '#FAFAFA',
  },
  fieldLabel: { fontSize: fs(13), fontWeight: '600', color: COLORS.textBody || '#44403C', marginBottom: vs(6), marginTop: vs(8) },

  // GPS
  gpsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: s(8),
    marginTop: vs(12), paddingVertical: vs(10), paddingHorizontal: s(12),
    borderWidth: 1.5, borderColor: COLORS.primary + '25', borderRadius: s(12),
    borderStyle: 'dashed', backgroundColor: COLORS.primary + '04',
  },
  gpsTxt: { fontSize: fs(13), color: COLORS.primary, fontWeight: '600' },

  // Soil grid
  soilGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: s(8) },
  soilCard: { width: '13%', alignItems: 'center' },
  soilSquare: {
    width: '100%', aspectRatio: 1, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  soilSquareSel: { borderColor: '#FFF', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3 },
  soilCheck: { position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
  soilLabel: { fontSize: fs(8), color: '#666', marginTop: vs(2), textAlign: 'center' },

  // Irrigation chips
  irrRow: { flexDirection: 'row', flexWrap: 'wrap', gap: s(8) },
  irrChip: {
    flexDirection: 'row', alignItems: 'center', gap: s(6),
    paddingVertical: vs(8), paddingHorizontal: s(10),
    borderRadius: s(12), borderWidth: 1.5, borderColor: '#E8E8E8', backgroundColor: '#FAFAFA',
  },
  irrIconSmall: { width: s(28), height: s(28), borderRadius: s(8), justifyContent: 'center', alignItems: 'center' },
  irrLabel: { fontSize: fs(12), fontWeight: '600', color: '#555' },

  // Crops
  cropBadge: { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: s(8), paddingVertical: vs(2) },
  cropBadgeText: { color: '#FFF', fontSize: fs(11), fontWeight: '700' },
  cropGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: s(6) },
  cropCard: {
    width: '22%', backgroundColor: '#FAFAFA', borderRadius: 10,
    padding: s(6), alignItems: 'center',
    borderWidth: 1.5, borderColor: '#E8E8E8', position: 'relative',
  },
  cropCardSel: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '06' },
  cropName: { fontSize: fs(9), color: '#444', textAlign: 'center', marginTop: vs(2) },

  // Bottom bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: s(10),
    paddingHorizontal: s(20), paddingTop: vs(12), paddingBottom: vs(34),
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1, borderTopColor: '#F0F0F0',
    ...SHADOWS.medium,
  },
  skipBtn: {
    paddingVertical: vs(14), paddingHorizontal: s(18),
    borderRadius: RADIUS.full || 28,
    borderWidth: 1.5, borderColor: '#E0E0E0', justifyContent: 'center',
  },
  skipTxt: { fontSize: fs(14), color: COLORS.textMedium, fontWeight: '600' },
  submitBtn: { flex: 1, borderRadius: RADIUS.full || 28, overflow: 'hidden' },
  submitGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: s(8), paddingVertical: vs(14), ...SHADOWS.greenGlow,
  },
  submitTxt: { color: '#FFF', fontSize: fs(15), fontWeight: TYPE.weight.bold || '700' },
});

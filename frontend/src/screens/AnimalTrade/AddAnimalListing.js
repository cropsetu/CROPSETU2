import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, SafeAreaView, Alert, Switch, ActivityIndicator, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocation } from '../../context/LocationContext';
import { COLORS, SHADOWS } from '../../constants/colors';
import { useLanguage } from '../../context/LanguageContext';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { compressImage } from '../../utils/mediaCompressor';

const ANIMAL_TYPE_KEYS = ['animalCow', 'animalBuffalo', 'animalGoat', 'animalBullock', 'animalSheep', 'animalPig', 'animalHorse', 'animalCamel'];
// English values used for form submission (backend expects English)
const ANIMAL_TYPE_VALUES = ['Cow', 'Buffalo', 'Goat', 'Bullock', 'Sheep', 'Pig', 'Horse', 'Camel'];

function SelectChip({ label, selected, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[styles.chipText, selected && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function InputField({ label, placeholder, value, onChangeText, keyboardType = 'default', multiline = false }) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.textArea]}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textLight}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={multiline ? 4 : 1}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  );
}

export default function AddAnimalListing({ navigation }) {
  const { t } = useLanguage();
  const { coords } = useLocation();
  const { user } = useAuth();
  const defaultLocation = [user?.village, user?.taluka, user?.district].filter(Boolean).join(', ') || '';
  const [form, setForm] = useState({
    animal: '', breed: '', age: '', gender: 'Female', weight: '',
    milkYield: '', price: '', description: '', location: defaultLocation, vaccinated: false,
  });
  const [photos,   setPhotos]   = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [gpsState, setGpsState] = useState('idle');

  const update = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const pickPhoto = async () => {
    if (photos.length >= 4) {
      Alert.alert(t('addAnimal.limitReached'), t('addAnimal.maxPhotos'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true, aspect: [4, 3], quality: 0.7,
    });
    if (!result.canceled) {
      setPhotos(p => [...p, result.assets[0]]);
    }
  };

  const handleSubmit = async () => {
    // Frontend must match backend required fields — age, weight, breed, price, location, animal
    if (!form.animal || !form.breed || !form.age || !form.weight || !form.price || !form.location) {
      Alert.alert(t('addAnimal.missingInfo'), t('addAnimal.missingInfoMsg'));
      return;
    }

    // Price sanity: must parse to a positive float (backend is strict here)
    const priceNum = parseFloat(form.price);
    if (Number.isNaN(priceNum) || priceNum <= 0) {
      Alert.alert(t('addAnimal.missingInfo'), t('addAnimal.invalidPrice'));
      return;
    }

    setLoading(true);

    // ── Use GPS coordinates from global LocationContext ──────────────────────
    const lat = coords?.latitude  ?? null;
    const lng = coords?.longitude ?? null;
    setGpsState(lat != null ? 'done' : 'denied');

    // ── Build FormData ───────────────────────────────────────────────────────
    try {
      const formData = new FormData();
      formData.append('animal',         form.animal);
      formData.append('breed',          form.breed);
      formData.append('age',            form.age);
      formData.append('gender',         form.gender === 'Male' ? 'MALE' : 'FEMALE');
      formData.append('weight',         form.weight);
      formData.append('price',          String(priceNum));
      formData.append('sellerLocation', form.location);
      if (form.milkYield)   formData.append('milkYield',   form.milkYield + ' Litre/Day');
      if (form.description) formData.append('description', form.description);
      if (lat != null)      formData.append('lat', String(lat));
      if (lng != null)      formData.append('lng', String(lng));
      if (form.vaccinated) formData.append('tags', 'Vaccinated');

      let uploadedCount = 0;
      for (const photo of photos) {
        try {
          const { uri: compressedUri } = await compressImage(photo.uri, { needBase64: false });
          formData.append('images', {
            uri: compressedUri,
            name: `animal_${Date.now()}_${uploadedCount}.jpg`,
            type: 'image/jpeg',
          });
          uploadedCount++;
        } catch (imgErr) {
          console.warn('[AddAnimalListing] image compress failed:', imgErr?.message);
        }
      }

      if (uploadedCount === 0 && photos.length > 0) {
        // All compressions failed — try uploading originals as-is
        for (const photo of photos) {
          formData.append('images', {
            uri: photo.uri,
            name: `animal_raw_${Date.now()}.jpg`,
            type: 'image/jpeg',
          });
        }
      }

      await api.post('/animals', formData, {
        timeout: 90000,
      });

      Alert.alert(t('listingPosted'), t('listingPostedMsg'), [
        { text: t('ok'), onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      // Surface the ACTUAL backend validation error so users can self-diagnose
      const details   = err?.response?.data?.error?.details;
      const firstDetail = Array.isArray(details) && details.length
        ? `${details[0].path || details[0].param}: ${details[0].msg}`
        : null;
      const msg = firstDetail
        || err?.response?.data?.error?.message
        || err?.message
        || t('addAnimal.failedToPost');
      Alert.alert(t('product.error'), msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* Photo Upload */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addAnimal.addPhotosTitle', { count: photos.length })}</Text>
          <Text style={styles.sectionSub}>{t('addAnimal.goodPhotos')}</Text>
          <View style={styles.photoRow}>
            {photos.map((photo, i) => (
              <View key={i} style={styles.photoThumb}>
                <Image source={{ uri: photo.uri }} style={styles.photoImg} />
                <TouchableOpacity
                  style={styles.photoRemove}
                  onPress={() => setPhotos(p => p.filter((_, pi) => pi !== i))}
                >
                  <Ionicons name="close-circle" size={20} color={COLORS.error} />
                </TouchableOpacity>
              </View>
            ))}
            {photos.length < 4 && (
              <TouchableOpacity style={styles.photoAdd} onPress={pickPhoto}>
                <Ionicons name="camera-outline" size={32} color={COLORS.primary} />
                <Text style={styles.photoAddText}>{t('addAnimal.addPhoto')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Animal Type */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addAnimal.animalTypeSection')}</Text>
          <View style={styles.chipGrid}>
            {ANIMAL_TYPE_KEYS.map((tKey, idx) => (
              <SelectChip key={tKey} label={t('addAnimal.' + tKey)} selected={form.animal === ANIMAL_TYPE_VALUES[idx]} onPress={() => update('animal', ANIMAL_TYPE_VALUES[idx])} />
            ))}
          </View>
        </View>

        {/* Basic Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addAnimal.basicDetails')}</Text>
          <InputField label={t('addAnimal.breedRequired')} placeholder={t('addAnimal.breedPlaceholder')} value={form.breed} onChangeText={v => update('breed', v)} />
          <InputField label={t('age')} placeholder={t('addAnimal.agePlaceholder')} value={form.age} onChangeText={v => update('age', v)} />

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{t('addAnimal.genderLabel')}</Text>
            <View style={styles.genderRow}>
              {['Male', 'Female'].map(g => (
                <TouchableOpacity
                  key={g}
                  style={[styles.genderBtn, form.gender === g && styles.genderBtnActive]}
                  onPress={() => update('gender', g)}
                >
                  <Ionicons name={g === 'Male' ? 'male' : 'female'} size={18} color={form.gender === g ? COLORS.textWhite : COLORS.primary} />
                  <Text style={[styles.genderText, form.gender === g && styles.genderTextActive]}>
                    {g === 'Male' ? t('addAnimal.male') : t('addAnimal.female')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <InputField label={t('addAnimal.weightKg')} placeholder={t('addAnimal.weightPlaceholder')} value={form.weight} onChangeText={v => update('weight', v)} keyboardType="numeric" />
          {(form.animal === 'Cow' || form.animal === 'Buffalo' || form.gender === 'Female') && (
            <InputField label={t('dailyMilk')} placeholder={t('addAnimal.milkPlaceholder')} value={form.milkYield} onChangeText={v => update('milkYield', v)} keyboardType="numeric" />
          )}
        </View>

        {/* Pricing */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addAnimal.pricingSection')}</Text>
          <InputField label={t('askingPrice')} placeholder={t('addAnimal.pricePlaceholder')} value={form.price} onChangeText={v => update('price', v)} keyboardType="numeric" />
          <Text style={styles.priceHint}>{t('addAnimal.priceHint')}</Text>
        </View>

        {/* Health */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addAnimal.healthInfo')}</Text>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>{t('addAnimal.vaccinated')}</Text>
              <Text style={styles.switchSub}>{t('addAnimal.vaccinatedSub')}</Text>
            </View>
            <Switch
              value={form.vaccinated}
              onValueChange={v => update('vaccinated', v)}
              trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
              thumbColor={form.vaccinated ? COLORS.primary : COLORS.surface}
            />
          </View>
        </View>

        {/* Description */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addAnimal.descriptionSection')}</Text>
          <InputField
            label={t('addAnimal.descLabel')}
            placeholder={t('addAnimal.descPlaceholder')}
            value={form.description}
            onChangeText={v => update('description', v)}
            multiline
          />
        </View>

        {/* Location */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addAnimal.locationSection')}</Text>
          <InputField
            label={t('addAnimal.locationLabel')}
            placeholder={t('addAnimal.locationPlaceholder')}
            value={form.location}
            onChangeText={v => update('location', v)}
          />
          {/* GPS note */}
          <View style={styles.gpsNote}>
            <Ionicons
              name={gpsState === 'done' ? 'location' : 'location-outline'}
              size={13}
              color={gpsState === 'done' ? COLORS.primary : gpsState === 'denied' ? COLORS.error : COLORS.grayMedium}
            />
            <Text style={[
              styles.gpsNoteTxt,
              gpsState === 'done'   && { color: COLORS.primary },
              gpsState === 'denied' && { color: COLORS.error },
            ]}>
              {gpsState === 'done'    ? t('addAnimal.gpsCoordsSaved')
               : gpsState === 'denied' ? t('addAnimal.gpsAccessDenied')
               : gpsState === 'loading' ? t('addAnimal.gpsLoading')
               : t('addAnimal.gpsAutoSave')}
            </Text>
          </View>
        </View>

      </ScrollView>

      {/* Submit Button */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.submitBtn, loading && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={loading}
        >
          <View style={[styles.submitInner, { backgroundColor: COLORS.primary }]}>
            {loading
              ? <ActivityIndicator color={COLORS.white} />
              : <>
                  <Ionicons name="checkmark-circle" size={22} color={COLORS.white} />
                  <Text style={styles.submitText}>{t('postFreeListing')}</Text>
                </>
            }
          </View>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { padding: 16, paddingBottom: 30 },

  section:      { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 16, ...SHADOWS.small },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textDark, marginBottom: 4, fontFamily: 'Inter_800ExtraBold' },
  sectionSub:   { fontSize: 13, color: COLORS.textLight, marginBottom: 14, fontFamily: 'Inter_400Regular' },

  photoRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  photoThumb:   { width: 80, height: 80, borderRadius: 12, backgroundColor: COLORS.divider, justifyContent: 'center', alignItems: 'center', position: 'relative', overflow: 'hidden' },
  photoImg:     { width: '100%', height: '100%' },
  photoRemove:  { position: 'absolute', top: -8, right: -8 },
  photoAdd:     { width: 80, height: 80, borderRadius: 12, borderWidth: 2, borderColor: COLORS.primary, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', gap: 4 },
  photoAddText: { fontSize: 11, color: COLORS.primary, fontWeight: '600' },

  chipGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  chip:          { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.background },
  chipActive:    { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText:      { fontSize: 14, fontWeight: '600', color: COLORS.textMedium },
  chipTextActive:{ color: COLORS.textWhite },

  inputGroup: { marginBottom: 14 },
  inputLabel: { fontSize: 14, fontWeight: '700', color: COLORS.textDark, marginBottom: 8, fontFamily: 'Inter_700Bold' },
  input:      { backgroundColor: COLORS.inputBg, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: COLORS.textDark, fontFamily: 'Inter_400Regular' },
  textArea:   { height: 100, textAlignVertical: 'top' },

  genderRow:       { flexDirection: 'row', gap: 12 },
  genderBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 2, borderColor: COLORS.primary },
  genderBtnActive: { backgroundColor: COLORS.primary },
  genderText:      { fontSize: 15, fontWeight: '700', color: COLORS.primary },
  genderTextActive:{ color: COLORS.textWhite },

  priceHint: { fontSize: 13, color: COLORS.textLight, marginTop: 4, fontStyle: 'italic' },

  switchRow:   { flexDirection: 'row', alignItems: 'center', paddingTop: 8 },
  switchLabel: { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  switchSub:   { fontSize: 13, color: COLORS.textLight, marginTop: 2 },

  gpsNote:    { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 10, padding: 10, backgroundColor: COLORS.greenBreeze, borderRadius: 8 },
  gpsNoteTxt: { flex: 1, fontSize: 12, color: COLORS.textLight, lineHeight: 17 },

  bottomBar:   { padding: 16, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  submitBtn:   { borderRadius: 14, overflow: 'hidden' },
  submitInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16, borderRadius: 14 },
  submitText:  { fontSize: 17, fontWeight: '800', color: COLORS.white, fontFamily: 'Inter_800ExtraBold' },
});

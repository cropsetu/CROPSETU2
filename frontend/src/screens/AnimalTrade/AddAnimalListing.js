import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, SafeAreaView, Alert, Switch, ActivityIndicator, Image,
  Platform, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocation } from '../../context/LocationContext';
import { COLORS, SHADOWS } from '../../constants/colors';
import { useLanguage } from '../../context/LanguageContext';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { prepareImageForFormData } from '../../utils/mediaCompressor';
import AnimalIcon from '../../components/AnimalIcons';

const ANIMAL_TYPE_KEYS = ['animalCow', 'animalBuffalo', 'animalGoat', 'animalBullock', 'animalSheep', 'animalPig', 'animalHorse', 'animalCamel'];
// English values used for form submission (backend expects English)
const ANIMAL_TYPE_VALUES = ['Cow', 'Buffalo', 'Goat', 'Bullock', 'Sheep', 'Pig', 'Horse', 'Camel'];

function SelectChip({ label, selected, onPress, iconType }) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {iconType ? (
        <View style={styles.chipIcon}>
          <AnimalIcon type={iconType} size={22} />
        </View>
      ) : null}
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

export default function AddAnimalListing({ navigation, route }) {
  const { t } = useLanguage();
  const { coords } = useLocation();
  const { user } = useAuth();

  // Edit mode: a `listing` object passed via route.params turns this screen
  // into an Update form. POST → PUT, existing fields are prefilled, existing
  // images stay attached unless removed.
  const editing = route?.params?.listing || null;

  const defaultLocation = editing?.sellerLocation
    || [user?.village, user?.taluka, user?.district, user?.city, user?.state].filter(Boolean).join('');

  // Extract numeric milk yield ("12 Litre/Day" → "12") for editing.
  const parseMilkYield = (s) => (s ? String(s).replace(/[^\d.]/g, '') : '');

  const [form, setForm] = useState(() => editing ? {
    animal: editing.animal || '',
    breed: editing.breed || '',
    age: editing.age || '',
    gender: editing.gender === 'MALE' ? 'Male' : 'Female',
    weight: editing.weight || '',
    milkYield: parseMilkYield(editing.milkYield),
    price: editing.price != null ? String(editing.price) : '',
    description: editing.description || '',
    location: editing.sellerLocation || defaultLocation,
    vaccinated: Array.isArray(editing.tags) && editing.tags.includes('Vaccinated'),
  } : {
    animal: '', breed: '', age: '', gender: 'Female', weight: '',
    milkYield: '', price: '', description: '', location: defaultLocation, vaccinated: false,
  });
  // Existing remote image URLs (only meaningful in edit mode).
  const [existingImages, setExistingImages] = useState(editing?.images || []);
  const [photos,   setPhotos]   = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [gpsState, setGpsState] = useState('idle');
  // Success popup state: { animal, breed, id } when shown, null when hidden.
  const [success,  setSuccess]  = useState(null);

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
    // Required fields — location is optional client-side; backend falls back
    // to the user's profile (district/state) when blank.
    if (!form.animal || !form.breed || !form.age || !form.weight || !form.price) {
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
      if (form.location?.trim()) formData.append('sellerLocation', form.location.trim());
      if (form.milkYield)   formData.append('milkYield',   form.milkYield + ' Litre/Day');
      if (form.description) formData.append('description', form.description);
      if (lat != null)      formData.append('lat', String(lat));
      if (lng != null)      formData.append('lng', String(lng));
      if (form.vaccinated) formData.append('tags', 'Vaccinated');

      // Edit mode: tell backend which already-uploaded image URLs to keep.
      // Sending the field (even empty) signals "replace images list".
      if (editing) {
        if (existingImages.length === 0) {
          formData.append('existingImages', '');
        } else {
          for (const url of existingImages) formData.append('existingImages', url);
        }
      }

      let uploadedCount = 0;
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        try {
          const filePart = await prepareImageForFormData(photo.uri, `animal_${i}`);
          if (Platform.OS === 'web') {
            // Web's FormData needs a real Blob/File — the {uri,name,type}
            // shorthand only works on native (iOS/Android). Fetch the URI
            // (blob: or data: URL produced by ImageManipulator) into a Blob.
            const resp = await fetch(filePart.uri);
            const blob = await resp.blob();
            formData.append('images', blob, filePart.name);
          } else {
            formData.append('images', filePart);
          }
          uploadedCount++;
        } catch (imgErr) {
          console.warn('[AddAnimalListing] image prep failed:', imgErr?.message);
        }
      }
      console.log('[AddAnimalListing] uploading', uploadedCount, 'of', photos.length, 'photos on', Platform.OS);

      if (editing) {
        const { data } = await api.put(`/animals/${editing.id}`, formData, { timeout: 90000 });
        setSuccess({
          mode: 'update',
          id: data?.data?.id || editing.id,
          animal: form.animal,
          breed: form.breed,
        });
      } else {
        const { data } = await api.post('/animals', formData, { timeout: 90000 });
        setSuccess({
          mode: 'create',
          id: data?.data?.id,
          animal: form.animal,
          breed: form.breed,
        });
      }
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
            {/* Already-uploaded photos (edit mode) */}
            {existingImages.map((url, i) => (
              <View key={`existing-${i}`} style={styles.photoThumb}>
                <Image source={{ uri: url }} style={styles.photoImg} />
                <TouchableOpacity
                  style={styles.photoRemove}
                  onPress={() => setExistingImages(arr => arr.filter((_, pi) => pi !== i))}
                >
                  <Ionicons name="close-circle" size={20} color={COLORS.error} />
                </TouchableOpacity>
              </View>
            ))}
            {/* Newly-picked photos */}
            {photos.map((photo, i) => (
              <View key={`new-${i}`} style={styles.photoThumb}>
                <Image source={{ uri: photo.uri }} style={styles.photoImg} />
                <TouchableOpacity
                  style={styles.photoRemove}
                  onPress={() => setPhotos(p => p.filter((_, pi) => pi !== i))}
                >
                  <Ionicons name="close-circle" size={20} color={COLORS.error} />
                </TouchableOpacity>
              </View>
            ))}
            {existingImages.length + photos.length < 4 && (
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
              <SelectChip key={tKey} label={t('addAnimal.' + tKey)} iconType={ANIMAL_TYPE_VALUES[idx]} selected={form.animal === ANIMAL_TYPE_VALUES[idx]} onPress={() => update('animal', ANIMAL_TYPE_VALUES[idx])} />
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

      {/* Success Popup — shown after a successful POST or PUT */}
      <Modal
        visible={!!success}
        transparent
        animationType="fade"
        onRequestClose={() => setSuccess(null)}
      >
        <View style={styles.successBackdrop}>
          <View style={styles.successCard}>
            <View style={styles.successIconCircle}>
              <Ionicons name="checkmark" size={42} color={COLORS.white} />
            </View>
            <Text style={styles.successTitle}>
              {success?.mode === 'update' ? t('addAnimal.listingUpdated') : t('listingPosted') || 'Listing Posted!'}
            </Text>
            <Text style={styles.successBody}>
              {success?.mode === 'update'
                ? t('addAnimal.changesSaved')
                : (t('listingPostedMsg') || 'Your animal listing is now live. Buyers can contact you shortly.')}
            </Text>
            {success?.animal ? (
              <View style={styles.successPill}>
                <Ionicons name="paw" size={14} color={COLORS.primary} />
                <Text style={styles.successPillTxt} numberOfLines={1}>
                  {success.animal}{success.breed ? ` · ${success.breed}` : ''}
                </Text>
              </View>
            ) : null}
            <View style={styles.successBtnRow}>
              <TouchableOpacity
                style={[styles.successBtn, styles.successBtnSecondary]}
                onPress={() => {
                  setSuccess(null);
                  navigation.goBack();
                }}
              >
                <Text style={styles.successBtnTextSecondary}>{t('addAnimal.close')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.successBtn, styles.successBtnPrimary]}
                onPress={() => {
                  const id = success?.id;
                  setSuccess(null);
                  navigation.navigate('AnimalTradeHome', { freshListingId: id, ts: Date.now() });
                }}
              >
                <Text style={styles.successBtnTextPrimary}>{t('addAnimal.viewAnimals')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  chip:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.background },
  chipIcon:      { marginRight: 7 },
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

  successBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  successCard: {
    width: '100%', maxWidth: 380, backgroundColor: COLORS.surface,
    borderRadius: 20, padding: 24, alignItems: 'center',
    ...SHADOWS.small,
  },
  successIconCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  successTitle: {
    fontSize: 20, fontWeight: '800', color: COLORS.textDark,
    textAlign: 'center', marginBottom: 8,
  },
  successBody: {
    fontSize: 14, color: COLORS.textMedium, textAlign: 'center',
    lineHeight: 20, marginBottom: 14,
  },
  successPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: COLORS.greenBreeze, borderRadius: 999,
    marginBottom: 18, maxWidth: '100%',
  },
  successPillTxt: { fontSize: 13, fontWeight: '700', color: COLORS.primary },
  successBtnRow: { flexDirection: 'row', gap: 10, width: '100%' },
  successBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  successBtnSecondary: { backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border },
  successBtnPrimary:   { backgroundColor: COLORS.primary },
  successBtnTextSecondary: { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  successBtnTextPrimary:   { fontSize: 15, fontWeight: '800', color: COLORS.white },
});

/**
 * AddAnimalListing — post or edit an animal advertisement.
 *
 * The layout is unchanged (one scroll, the same green sections) because it
 * works and farmers know it. What changed is everything that used to lose a
 * farmer's work or duplicate it:
 *
 *   • The form autosaves. Losing signal mid-upload, a phone call, or the OS
 *     killing the app used to mean re-typing the whole ad and re-picking every
 *     photo. The draft is restored on the next visit.
 *   • Publish is guarded twice — a ref (not just the `loading` state, which
 *     lags a fast double-tap by a render) and a per-attempt Idempotency-Key so
 *     even a retried request creates one listing.
 *   • Validation is per-field and inline. A single "Missing info" alert made
 *     the farmer hunt for which box was wrong.
 *   • Breeds come from the server (GET /animals/meta), so adding one is an
 *     admin edit rather than a Play Store release, and milk-yield is only asked
 *     for animals that give milk.
 *   • Preview before publish, because a listing is public the moment it lands.
 *
 * Photos are compressed with ImageManipulator, which re-encodes to JPEG and
 * therefore DROPS EXIF — including the GPS tag that would otherwise publish the
 * farmer's exact yard coordinates inside the image file.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, SafeAreaView, Alert, Switch, ActivityIndicator, Image,
  Platform, Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocation } from '../../context/LocationContext';
import { COLORS, SHADOWS } from '@krushisarva/shared/constants/colors';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import api from '@krushisarva/shared/services/api';
import { useAuth } from '@krushisarva/shared/context/AuthContext';
import { prepareImageForFormData } from '@krushisarva/shared/utils/mediaCompressor';
import { formatLocation } from '../../utils/location';
import { invalidateFocusData } from '../../hooks/useFocusRefresh';
import { classifyError } from '../../utils/apiError';

/** Server allows 6; the picker enforces the same number so the cap is obvious. */
const MAX_PHOTOS = 6;
const DRAFT_KEY = '@animals:draft';
/** Fallback types when /animals/meta is unreachable (first run, offline). */
const FALLBACK_TYPES = [
  { key: 'Cow', milch: true }, { key: 'Buffalo', milch: true }, { key: 'Goat', milch: true },
  { key: 'Bullock', milch: false }, { key: 'Sheep', milch: false }, { key: 'Pig', milch: false },
  { key: 'Horse', milch: false }, { key: 'Camel', milch: true },
];

function SelectChip({ label, selected, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Text style={[styles.chipText, selected && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function InputField({
  label, placeholder, value, onChangeText, keyboardType = 'default',
  multiline = false, error, hint,
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.textArea, error && styles.inputError]}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textLight}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={multiline ? 4 : 1}
        textAlignVertical={multiline ? 'top' : 'center'}
        accessibilityLabel={label}
        // Screen readers announce the problem with the field it belongs to
        // instead of a detached alert the user has already dismissed.
        accessibilityHint={error || hint}
      />
      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={13} color={COLORS.error} />
          <Text style={styles.errorTxt}>{error}</Text>
        </View>
      ) : hint ? (
        <Text style={styles.hintTxt}>{hint}</Text>
      ) : null}
    </View>
  );
}

function ToggleRow({ label, sub, value, onValueChange }) {
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.switchLabel}>{label}</Text>
        {sub ? <Text style={styles.switchSub}>{sub}</Text> : null}
      </View>
      <Switch
        value={!!value}
        onValueChange={onValueChange}
        trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
        thumbColor={value ? COLORS.primary : COLORS.surface}
        accessibilityLabel={label}
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

  const defaultLocation = formatLocation(editing?.sellerLocation)
    || [user?.village, user?.taluka, user?.district, user?.city, user?.state].filter(Boolean).join(', ');

  // Extract numeric milk yield ("12 Litre/Day" → "12") for editing.
  const parseMilkYield = (s) => (s ? String(s).replace(/[^\d.]/g, '') : '');

  const [form, setForm] = useState(() => (editing ? {
    animal: editing.animal || '',
    breed: editing.breed || '',
    age: editing.age || '',
    gender: editing.gender === 'MALE' ? 'Male' : 'Female',
    weight: editing.weight || '',
    milkYield: parseMilkYield(editing.milkYield),
    price: editing.price != null ? String(editing.price) : '',
    description: editing.description || '',
    location: formatLocation(editing.sellerLocation) || defaultLocation,
    vaccinated: editing.vaccinated ?? (Array.isArray(editing.tags) && editing.tags.includes('Vaccinated')),
    healthCertificate: !!editing.healthCertificate,
    negotiable: !!editing.negotiable,
  } : {
    animal: '', breed: '', age: '', gender: 'Female', weight: '',
    milkYield: '', price: '', description: '', location: defaultLocation,
    vaccinated: false, healthCertificate: false, negotiable: false,
  }));

  const [existingImages, setExistingImages] = useState(editing?.images || []);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total } while preparing photos
  const [errors, setErrors] = useState({});
  const [success, setSuccess] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [master, setMaster] = useState(null);

  // A ref, not the `loading` state: setState is async, so two taps inside the
  // same frame both see loading === false and both fire the request.
  const submittingRef = useRef(false);
  // One key per publish ATTEMPT, reused across the axios 401-replay so the
  // backend's idempotency middleware collapses the retry.
  const idemKeyRef = useRef(null);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const update = useCallback((key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    // Clear the field's error the moment the user starts fixing it.
    setErrors((e) => (e[key] ? { ...e, [key]: null } : e));
  }, []);

  // ── Master data: animal types, breeds, which fields to ask for ─────────────
  useEffect(() => {
    let alive = true;
    api.get('/animals/meta')
      .then(({ data }) => { if (alive && data?.data?.types) setMaster(data.data); })
      .catch(() => { /* the fallback list keeps the form usable */ });
    return () => { alive = false; };
  }, []);

  const types = master?.types || FALLBACK_TYPES;
  const selectedType = types.find((ty) => ty.key === form.animal) || null;
  // Only ask for milk yield on animals that give milk. A bullock has none, and
  // an empty "litres per day" box on a bullock ad is pure confusion.
  const showMilk = selectedType ? selectedType.milch !== false : false;
  const breedOptions = selectedType?.breeds || [];

  // ── Draft: restore once, then autosave ─────────────────────────────────────
  useEffect(() => {
    if (editing) return; // editing an existing ad has its own source of truth
    let alive = true;
    AsyncStorage.getItem(DRAFT_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        const draft = JSON.parse(raw);
        if (!draft?.form) return;
        // Only restore something the farmer actually started.
        const meaningful = draft.form.animal || draft.form.breed || draft.form.price;
        if (!meaningful) return;
        setForm((f) => ({ ...f, ...draft.form }));
        setDraftRestored(true);
      })
      .catch(() => { /* no draft is the normal case */ });
    return () => { alive = false; };
  }, [editing]);

  useEffect(() => {
    if (editing || success) return undefined;
    // Debounced so typing does not hit the disk on every character.
    const id = setTimeout(() => {
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ form, at: Date.now() })).catch(() => {});
    }, 800);
    return () => clearTimeout(id);
  }, [form, editing, success]);

  const discardDraft = useCallback(() => {
    AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
    setForm({
      animal: '', breed: '', age: '', gender: 'Female', weight: '',
      milkYield: '', price: '', description: '', location: defaultLocation,
      vaccinated: false, healthCertificate: false, negotiable: false,
    });
    setDraftRestored(false);
  }, [defaultLocation]);

  // ── Photos ─────────────────────────────────────────────────────────────────
  const totalPhotos = existingImages.length + photos.length;

  const pickPhoto = async () => {
    const remaining = MAX_PHOTOS - totalPhotos;
    if (remaining <= 0) {
      Alert.alert(t('addAnimal.limitReached'), t('addAnimal.maxPhotos'));
      return;
    }
    // Multi-select: allowsEditing is mutually exclusive with
    // allowsMultipleSelection, so we drop the crop/aspect step here.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.7,
    });
    if (!result.canceled && Array.isArray(result.assets)) {
      setPhotos((p) => [...p, ...result.assets].slice(0, p.length + remaining));
      setErrors((e) => ({ ...e, photos: null }));
    }
  };

  // ── Validation (client side; the server validates independently) ───────────
  const validate = useCallback(() => {
    const e = {};
    if (!form.animal) e.animal = t('addAnimal.errAnimal', 'Choose the type of animal.');
    if (!form.breed?.trim()) e.breed = t('addAnimal.errBreed', 'Enter the breed.');
    if (!form.age?.trim()) e.age = t('addAnimal.errAge', 'Enter the age.');
    if (!form.weight?.trim()) e.weight = t('addAnimal.errWeight', 'Enter the weight in kg.');

    const price = parseFloat(form.price);
    if (!form.price?.trim()) e.price = t('addAnimal.errPrice', 'Enter your asking price.');
    else if (Number.isNaN(price) || price <= 0) e.price = t('addAnimal.invalidPrice');
    else if (price > 100_000_000) e.price = t('addAnimal.errPriceHigh', 'That price looks too high.');

    if (showMilk && form.milkYield) {
      const m = parseFloat(form.milkYield);
      if (Number.isNaN(m) || m <= 0 || m > 100) {
        e.milkYield = t('addAnimal.errMilk', 'Enter litres per day between 1 and 100.');
      }
    }
    const w = parseFloat(form.weight);
    if (form.weight?.trim() && (Number.isNaN(w) || w <= 0 || w > 5000)) {
      e.weight = t('addAnimal.errWeightRange', 'Enter a weight between 1 and 5000 kg.');
    }
    if (totalPhotos === 0) e.photos = t('addAnimal.errPhotos', 'Add at least one photo of the animal.');

    setErrors(e);
    return Object.keys(e).length === 0;
  }, [form, showMilk, totalPhotos, t]);

  const openPreview = () => {
    if (!validate()) {
      Alert.alert(t('addAnimal.missingInfo'), t('addAnimal.checkFields', 'Please check the highlighted fields.'));
      return;
    }
    setPreviewOpen(true);
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (submittingRef.current) return;   // double-tap guard (see the ref's note)
    if (!validate()) return;
    submittingRef.current = true;
    setPreviewOpen(false);
    setLoading(true);

    // One key per attempt — reused by the interceptor's 401 replay.
    idemKeyRef.current = idemKeyRef.current
      || `animal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    const lat = coords?.latitude ?? null;
    const lng = coords?.longitude ?? null;

    try {
      const priceNum = parseFloat(form.price);
      const formData = new FormData();
      formData.append('animal', form.animal);
      formData.append('breed', form.breed.trim());
      formData.append('age', form.age.trim());
      formData.append('gender', form.gender === 'Male' ? 'MALE' : 'FEMALE');
      formData.append('weight', form.weight.trim());
      formData.append('price', String(priceNum));
      if (form.location?.trim()) formData.append('sellerLocation', form.location.trim());
      if (showMilk && form.milkYield) formData.append('milkYield', `${form.milkYield} Litre/Day`);
      if (form.description) formData.append('description', form.description);
      if (lat != null) formData.append('lat', String(lat));
      if (lng != null) formData.append('lng', String(lng));

      // Structured flags drive the marketplace filters. The legacy `tags` entry
      // is still sent so an older backend (or an un-migrated row) keeps showing
      // the vaccinated badge.
      formData.append('vaccinated', String(!!form.vaccinated));
      formData.append('healthCertificate', String(!!form.healthCertificate));
      formData.append('negotiable', String(!!form.negotiable));
      if (form.vaccinated) formData.append('tags', 'Vaccinated');

      // Edit mode: tell backend which already-uploaded image URLs to keep.
      // Sending the field (even empty) signals "replace images list".
      if (editing) {
        if (existingImages.length === 0) formData.append('existingImages', '');
        else for (const url of existingImages) formData.append('existingImages', url);
      }

      // Compress on a per-photo basis with visible progress. A 12 MP phone photo
      // takes a second or two to re-encode; without this the screen looked hung.
      const failedPhotos = [];
      setProgress({ done: 0, total: photos.length });
      for (let i = 0; i < photos.length; i++) {
        try {
          const filePart = await prepareImageForFormData(photos[i].uri, `animal_${i}`);
          if (Platform.OS === 'web') {
            // Web's FormData needs a real Blob/File — the {uri,name,type}
            // shorthand only works on native (iOS/Android).
            const resp = await fetch(filePart.uri);
            formData.append('images', await resp.blob(), filePart.name);
          } else {
            formData.append('images', filePart);
          }
        } catch (imgErr) {
          // One unreadable photo must not sink the whole ad.
          failedPhotos.push(i + 1);
        }
        if (aliveRef.current) setProgress({ done: i + 1, total: photos.length });
      }
      if (failedPhotos.length === photos.length && photos.length > 0 && existingImages.length === 0) {
        throw Object.assign(new Error(t('addAnimal.allPhotosFailed', 'None of the photos could be prepared. Please pick different photos.')), { expose: true });
      }

      const config = { timeout: 90_000, headers: { 'Idempotency-Key': idemKeyRef.current } };
      const { data } = editing
        ? await api.put(`/animals/${editing.id}`, formData, config)
        : await api.post('/animals', formData, config);

      if (!aliveRef.current) return;
      // A published ad is no longer a draft.
      AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
      setSuccess({
        mode: editing ? 'update' : 'create',
        id: data?.data?.id || editing?.id,
        animal: form.animal,
        breed: form.breed,
        partialPhotos: failedPhotos.length ? failedPhotos.length : 0,
      });

      // The marketplace and the profile counts are now wrong; make the next
      // focus of either reload instead of waiting out its freshness window.
      invalidateFocusData('animals');
      invalidateFocusData('profile');
    } catch (err) {
      if (!aliveRef.current) return;
      const classified = classifyError(err, t('addAnimal.failedToPost'));
      // Server-side field errors land next to the field they belong to.
      if (classified.details?.length) {
        const fieldErrors = {};
        for (const d of classified.details) {
          const field = d.path || d.param;
          if (field) fieldErrors[field] = d.msg;
        }
        setErrors((e) => ({ ...e, ...fieldErrors }));
      }
      Alert.alert(t('product.error'), err?.expose ? err.message : classified.message);
      // Allow a deliberate retry — but keep the SAME idempotency key so a
      // request that actually succeeded server-side is not duplicated.
      submittingRef.current = false;
    } finally {
      if (aliveRef.current) {
        setLoading(false);
        setProgress(null);
      }
    }
  };

  const previewRows = useMemo(() => ([
    [t('addAnimal.animalTypeSection'), form.animal],
    [t('addAnimal.breedRequired'), form.breed],
    [t('age'), form.age],
    [t('addAnimal.genderLabel'), form.gender],
    [t('addAnimal.weightKg'), form.weight],
    ...(showMilk && form.milkYield ? [[t('dailyMilk'), `${form.milkYield} L/day`]] : []),
    [t('askingPrice'), `₹${Number(form.price || 0).toLocaleString('en-IN')}${form.negotiable ? ` (${t('animal.negotiable', 'Negotiable')})` : ''}`],
    [t('addAnimal.locationLabel'), form.location || '—'],
    [t('vaccinated'), form.vaccinated ? t('yes') : t('no')],
    [t('animal.healthCert', 'Health certificate'), form.healthCertificate ? t('yes') : t('no')],
  ]), [form, showMilk, t]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

        {draftRestored ? (
          <View style={styles.draftBanner}>
            <Ionicons name="document-text-outline" size={16} color={COLORS.primary} />
            <Text style={styles.draftTxt}>{t('addAnimal.draftRestored', 'We restored your unfinished ad.')}</Text>
            <TouchableOpacity onPress={discardDraft} hitSlop={8} accessibilityRole="button">
              <Text style={styles.draftAction}>{t('addAnimal.startFresh', 'Start fresh')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Photo Upload */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addAnimal.addPhotosTitle', { count: totalPhotos })}</Text>
          <Text style={styles.sectionSub}>
            {t('addAnimal.goodPhotos')} · {t('addAnimal.upToN', 'Up to {{n}} photos').replace('{{n}}', MAX_PHOTOS)}
          </Text>
          <View style={styles.photoRow}>
            {/* Already-uploaded photos (edit mode) */}
            {existingImages.map((url, i) => (
              <View key={`existing-${url}`} style={styles.photoThumb}>
                <Image source={{ uri: url }} style={styles.photoImg} />
                <TouchableOpacity
                  style={styles.photoRemove}
                  onPress={() => setExistingImages((arr) => arr.filter((_, pi) => pi !== i))}
                  accessibilityRole="button"
                  accessibilityLabel={t('addAnimal.removePhoto', 'Remove photo')}
                  hitSlop={8}
                >
                  <Ionicons name="close-circle" size={20} color={COLORS.error} />
                </TouchableOpacity>
              </View>
            ))}
            {/* Newly-picked photos */}
            {photos.map((photo, i) => (
              <View key={`new-${photo.uri}`} style={styles.photoThumb}>
                <Image source={{ uri: photo.uri }} style={styles.photoImg} />
                <TouchableOpacity
                  style={styles.photoRemove}
                  onPress={() => setPhotos((p) => p.filter((_, pi) => pi !== i))}
                  accessibilityRole="button"
                  accessibilityLabel={t('addAnimal.removePhoto', 'Remove photo')}
                  hitSlop={8}
                >
                  <Ionicons name="close-circle" size={20} color={COLORS.error} />
                </TouchableOpacity>
              </View>
            ))}
            {totalPhotos < MAX_PHOTOS && (
              <TouchableOpacity
                style={[styles.photoAdd, errors.photos && { borderColor: COLORS.error }]}
                onPress={pickPhoto}
                accessibilityRole="button"
                accessibilityLabel={t('addAnimal.addPhoto')}
              >
                <Ionicons name="camera-outline" size={32} color={COLORS.primary} />
                <Text style={styles.photoAddText}>{t('addAnimal.addPhoto')}</Text>
              </TouchableOpacity>
            )}
          </View>
          {errors.photos ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={13} color={COLORS.error} />
              <Text style={styles.errorTxt}>{errors.photos}</Text>
            </View>
          ) : null}
        </View>

        {/* Animal Type */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addAnimal.animalTypeSection')}</Text>
          <View style={styles.chipGrid}>
            {types.map((ty) => (
              <SelectChip
                key={ty.key}
                label={ty.mr && /[ऀ-ॿ]/.test(ty.mr) ? `${ty.key}` : ty.key}
                selected={form.animal === ty.key}
                onPress={() => update('animal', ty.key)}
              />
            ))}
          </View>
          {errors.animal ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={13} color={COLORS.error} />
              <Text style={styles.errorTxt}>{errors.animal}</Text>
            </View>
          ) : null}
        </View>

        {/* Basic Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addAnimal.basicDetails')}</Text>
          <InputField
            label={t('addAnimal.breedRequired')}
            placeholder={t('addAnimal.breedPlaceholder')}
            value={form.breed}
            onChangeText={(v) => update('breed', v)}
            error={errors.breed}
          />
          {/* Server-driven breed suggestions for the chosen type. Tapping one
              fills the field; typing a breed that is not listed still works. */}
          {breedOptions.length > 0 && !form.breed ? (
            <View style={styles.suggestRow}>
              {breedOptions.slice(0, 8).map((b) => (
                <TouchableOpacity
                  key={b}
                  style={styles.suggestChip}
                  onPress={() => update('breed', b)}
                  accessibilityRole="button"
                >
                  <Text style={styles.suggestTxt}>{b}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <InputField
            label={t('age')}
            placeholder={t('addAnimal.agePlaceholder')}
            value={form.age}
            onChangeText={(v) => update('age', v)}
            error={errors.age}
            hint={t('addAnimal.ageHint', 'For example: 3 years, or 18 months')}
          />

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{t('addAnimal.genderLabel')}</Text>
            <View style={styles.genderRow}>
              {['Male', 'Female'].map((g) => (
                <TouchableOpacity
                  key={g}
                  style={[styles.genderBtn, form.gender === g && styles.genderBtnActive]}
                  onPress={() => update('gender', g)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: form.gender === g }}
                >
                  <Ionicons name={g === 'Male' ? 'male' : 'female'} size={18} color={form.gender === g ? COLORS.textWhite : COLORS.primary} />
                  <Text style={[styles.genderText, form.gender === g && styles.genderTextActive]}>
                    {g === 'Male' ? t('addAnimal.male') : t('addAnimal.female')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <InputField
            label={t('addAnimal.weightKg')}
            placeholder={t('addAnimal.weightPlaceholder')}
            value={form.weight}
            onChangeText={(v) => update('weight', v)}
            keyboardType="numeric"
            error={errors.weight}
          />
          {showMilk && (
            <InputField
              label={t('dailyMilk')}
              placeholder={t('addAnimal.milkPlaceholder')}
              value={form.milkYield}
              onChangeText={(v) => update('milkYield', v)}
              keyboardType="numeric"
              error={errors.milkYield}
              hint={t('addAnimal.milkUnitHint', 'Litres per day')}
            />
          )}
        </View>

        {/* Pricing */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addAnimal.pricingSection')}</Text>
          <InputField
            label={t('askingPrice')}
            placeholder={t('addAnimal.pricePlaceholder')}
            value={form.price}
            onChangeText={(v) => update('price', v)}
            keyboardType="numeric"
            error={errors.price}
          />
          <ToggleRow
            label={t('animal.negotiable', 'Price is negotiable')}
            value={form.negotiable}
            onValueChange={(v) => update('negotiable', v)}
          />
          <Text style={styles.priceHint}>{t('addAnimal.priceHint')}</Text>
        </View>

        {/* Health */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addAnimal.healthInfo')}</Text>
          <ToggleRow
            label={t('addAnimal.vaccinated')}
            sub={t('addAnimal.vaccinatedSub')}
            value={form.vaccinated}
            onValueChange={(v) => update('vaccinated', v)}
          />
          <ToggleRow
            label={t('animal.healthCert', 'Health certificate available')}
            sub={t('addAnimal.healthCertSub', 'A vet has issued a certificate for this animal')}
            value={form.healthCertificate}
            onValueChange={(v) => update('healthCertificate', v)}
          />
        </View>

        {/* Description */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addAnimal.descriptionSection')}</Text>
          <InputField
            label={t('addAnimal.descLabel')}
            placeholder={t('addAnimal.descPlaceholder')}
            value={form.description}
            onChangeText={(v) => update('description', v)}
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
            onChangeText={(v) => update('location', v)}
          />
          <View style={styles.gpsNote}>
            <Ionicons
              name={coords ? 'location' : 'location-outline'}
              size={13}
              color={coords ? COLORS.primary : COLORS.grayMedium}
            />
            {/* Say plainly what is stored and what buyers see — the coordinates
                drive the distance badge and are never shown to anyone. */}
            <Text style={[styles.gpsNoteTxt, coords && { color: COLORS.primary }]}>
              {coords
                ? t('addAnimal.gpsSavedPrivate', 'Buyers will see roughly how far away you are, never your exact location.')
                : t('addAnimal.gpsAutoSave')}
            </Text>
          </View>
        </View>

      </ScrollView>

      {/* Submit */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.submitBtn, loading && { opacity: 0.6 }]}
          onPress={openPreview}
          disabled={loading}
          accessibilityRole="button"
          accessibilityState={{ disabled: loading, busy: loading }}
        >
          <View style={[styles.submitInner, { backgroundColor: COLORS.primary }]}>
            {loading
              ? (
                <>
                  <ActivityIndicator color={COLORS.white} />
                  <Text style={styles.submitText}>
                    {progress && progress.total > 0
                      ? t('addAnimal.uploadingN', 'Preparing photo {{i}} of {{n}}…')
                        .replace('{{i}}', progress.done).replace('{{n}}', progress.total)
                      : t('addAnimal.publishing', 'Publishing…')}
                  </Text>
                </>
              )
              : (
                <>
                  <Ionicons name="eye-outline" size={22} color={COLORS.white} />
                  <Text style={styles.submitText}>{t('addAnimal.previewPublish', 'Preview & publish')}</Text>
                </>
              )}
          </View>
        </TouchableOpacity>
      </View>

      {/* Preview before publish — a listing is public the moment it lands. */}
      <Modal visible={previewOpen} transparent animationType="slide" onRequestClose={() => setPreviewOpen(false)}>
        <View style={styles.successBackdrop}>
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>{t('addAnimal.previewTitle', 'Check your ad')}</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {totalPhotos > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.previewPhotos}>
                  {[...existingImages, ...photos.map((p) => p.uri)].map((uri) => (
                    <Image key={uri} source={{ uri }} style={styles.previewPhoto} />
                  ))}
                </ScrollView>
              ) : null}
              {previewRows.map(([label, value]) => (
                <View key={label} style={styles.previewRow}>
                  <Text style={styles.previewLabel}>{label}</Text>
                  <Text style={styles.previewValue} numberOfLines={2}>{String(value || '—')}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={styles.successBtnRow}>
              <TouchableOpacity
                style={[styles.successBtn, styles.successBtnSecondary]}
                onPress={() => setPreviewOpen(false)}
                accessibilityRole="button"
              >
                <Text style={styles.successBtnTextSecondary}>{t('addAnimal.keepEditing', 'Keep editing')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.successBtn, styles.successBtnPrimary]}
                onPress={handleSubmit}
                accessibilityRole="button"
              >
                <Text style={styles.successBtnTextPrimary}>{t('postFreeListing')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
              {success?.mode === 'update'
                ? t('addAnimal.listingUpdated', 'Listing updated!')
                : t('listingPosted', 'Listing posted!')}
            </Text>
            <Text style={styles.successBody}>
              {success?.mode === 'update'
                ? t('addAnimal.changesSaved', 'Your changes have been saved.')
                : t('listingPostedMsg', 'Your animal listing is now live. Buyers can contact you shortly.')}
            </Text>
            {success?.partialPhotos ? (
              <Text style={styles.successWarn}>
                {t('addAnimal.somePhotosSkipped', '{{n}} photo could not be uploaded. You can add it later by editing the ad.')
                  .replace('{{n}}', success.partialPhotos)}
              </Text>
            ) : null}
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
                onPress={() => { setSuccess(null); navigation.goBack(); }}
                accessibilityRole="button"
              >
                <Text style={styles.successBtnTextSecondary}>{t('close', 'Close')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.successBtn, styles.successBtnPrimary]}
                onPress={() => {
                  const id = success?.id;
                  setSuccess(null);
                  navigation.navigate('AnimalTradeHome', { freshListingId: id, ts: Date.now() });
                }}
                accessibilityRole="button"
              >
                <Text style={styles.successBtnTextPrimary}>{t('addAnimal.viewAnimals', 'View animals')}</Text>
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

  draftBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.greenBreeze, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14,
  },
  draftTxt:    { flex: 1, fontSize: 12.5, color: COLORS.textMedium, fontWeight: '600' },
  draftAction: { fontSize: 12.5, fontWeight: '800', color: COLORS.primary },

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
  chip:          { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.background, minHeight: 42, justifyContent: 'center' },
  chipActive:    { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText:      { fontSize: 14, fontWeight: '600', color: COLORS.textMedium },
  chipTextActive:{ color: COLORS.textWhite },

  suggestRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -6, marginBottom: 14 },
  suggestChip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, backgroundColor: COLORS.greenBreeze },
  suggestTxt:  { fontSize: 12.5, color: COLORS.primary, fontWeight: '700' },

  inputGroup: { marginBottom: 14 },
  inputLabel: { fontSize: 14, fontWeight: '700', color: COLORS.textDark, marginBottom: 8, fontFamily: 'Inter_700Bold' },
  input:      { backgroundColor: COLORS.inputBg, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: COLORS.textDark, fontFamily: 'Inter_400Regular', minHeight: 48 },
  inputError: { borderColor: COLORS.error },
  textArea:   { height: 100, textAlignVertical: 'top' },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  errorTxt: { flex: 1, fontSize: 12.5, color: COLORS.error, fontWeight: '600' },
  hintTxt:  { fontSize: 12, color: COLORS.textLight, marginTop: 6 },

  genderRow:       { flexDirection: 'row', gap: 12 },
  genderBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 12, borderWidth: 2, borderColor: COLORS.primary, minHeight: 50 },
  genderBtnActive: { backgroundColor: COLORS.primary },
  genderText:      { fontSize: 15, fontWeight: '700', color: COLORS.primary },
  genderTextActive:{ color: COLORS.textWhite },

  priceHint: { fontSize: 13, color: COLORS.textLight, marginTop: 4, fontStyle: 'italic' },

  switchRow:   { flexDirection: 'row', alignItems: 'center', paddingTop: 8, gap: 12 },
  switchLabel: { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  switchSub:   { fontSize: 13, color: COLORS.textLight, marginTop: 2 },

  gpsNote:    { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 10, padding: 10, backgroundColor: COLORS.greenBreeze, borderRadius: 8 },
  gpsNoteTxt: { flex: 1, fontSize: 12, color: COLORS.textLight, lineHeight: 17 },

  bottomBar:   { padding: 16, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  submitBtn:   { borderRadius: 14, overflow: 'hidden' },
  submitInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16, borderRadius: 14, minHeight: 56 },
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
  successTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textDark, textAlign: 'center', marginBottom: 8 },
  successBody:  { fontSize: 14, color: COLORS.textMedium, textAlign: 'center', lineHeight: 20, marginBottom: 14 },
  successWarn:  { fontSize: 13, color: COLORS.warning, textAlign: 'center', marginBottom: 12, fontWeight: '600' },
  successPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: COLORS.greenBreeze, borderRadius: 999,
    marginBottom: 18, maxWidth: '100%',
  },
  successPillTxt: { fontSize: 13, fontWeight: '700', color: COLORS.primary },
  successBtnRow: { flexDirection: 'row', gap: 10, width: '100%' },
  successBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', minHeight: 50,
  },
  successBtnSecondary: { backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border },
  successBtnPrimary:   { backgroundColor: COLORS.primary },
  successBtnTextSecondary: { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  successBtnTextPrimary:   { fontSize: 15, fontWeight: '800', color: COLORS.white },

  previewCard: {
    width: '100%', maxWidth: 400, backgroundColor: COLORS.surface,
    borderRadius: 20, padding: 20, ...SHADOWS.small,
  },
  previewTitle:  { fontSize: 19, fontWeight: '800', color: COLORS.textDark, marginBottom: 14 },
  previewPhotos: { gap: 8, paddingBottom: 12 },
  previewPhoto:  { width: 72, height: 72, borderRadius: 10, backgroundColor: COLORS.divider },
  previewRow: {
    flexDirection: 'row', justifyContent: 'space-between', gap: 12,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.divider,
  },
  previewLabel: { fontSize: 13.5, color: COLORS.textLight, flexShrink: 0 },
  previewValue: { fontSize: 14, color: COLORS.textDark, fontWeight: '700', flex: 1, textAlign: 'right' },
});

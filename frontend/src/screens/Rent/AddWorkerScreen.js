/**
 * AddWorkerScreen — Register yourself/your group as available for farm work.
 * Collects: name, type (individual/group), leader, skills, experience,
 *           languages, pricing, availability dates, location, photo + video.
 * Uploads media to Cloudinary, then creates listing via POST /rent/labour.
 */
import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Image, StatusBar,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import api from '../../services/api';
import { compressImage, compressVideo } from '../../utils/mediaCompressor';
import { useLanguage } from '../../context/LanguageContext';
import { useLocation } from '../../context/LocationContext';
import { COLORS } from '../../constants/colors';


const SKILL_KEYS = [
  'weeding', 'harvesting', 'planting', 'irrigation', 'spraying',
  'pruning', 'threshing', 'loading', 'transplanting', 'tractorOperation',
  'fruitPicking', 'cottonPicking', 'sugarcaneCutting', 'landPreparation',
];

const LANGUAGE_KEYS = ['marathi', 'hindi', 'english', 'kannada', 'telugu', 'gujarati'];

function SectionLabel({ children }) {
  return <Text style={S.sectionLabel}>{children}</Text>;
}

function FieldInput({ label, value, onChangeText, placeholder, keyboardType, multiline, required }) {
  return (
    <View style={S.field}>
      <Text style={S.label}>{label}{required && <Text style={S.req}> *</Text>}</Text>
      <TextInput
        style={[S.input, multiline && S.inputMulti]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.grayLightMid}
        keyboardType={keyboardType || 'default'}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
      />
    </View>
  );
}

export default function AddWorkerScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { t }         = useLanguage();
  const { coords: gpsCoords } = useLocation();

  const [workerType,    setWorkerType]    = useState('individual'); // individual | group
  const [name,          setName]          = useState('');
  const [leader,        setLeader]        = useState('');
  const [groupName,     setGroupName]     = useState('');
  const [groupSize,     setGroupSize]     = useState('1');
  const [skills,        setSkills]        = useState([]);
  const [experience,    setExperience]    = useState('');
  const [description,   setDescription]  = useState('');
  const [languages,     setLanguages]     = useState([]);
  const [pricePerDay,   setPricePerDay]   = useState('');
  const [pricePerHour,  setPricePerHour]  = useState('');
  const [phone,         setPhone]         = useState('');
  const [availableFrom, setAvailableFrom] = useState('');
  const [availableTo,   setAvailableTo]   = useState('');
  const [location,      setLocation]      = useState('');
  const [district,      setDistrict]      = useState('');
  const [photo,         setPhoto]         = useState(null); // { uri, url }
  const [images,        setImages]        = useState([]);   // { uri, url }
  const [video,         setVideo]         = useState(null); // { uri, url }
  const [lat,           setLat]           = useState(null);
  const [lng,           setLng]           = useState(null);
  const gpsLoading = false; // GPS fetched globally at app start
  const [uploading,     setUploading]     = useState(false);
  const [submitting,    setSubmitting]    = useState(false);

  // ── Use global GPS from LocationContext ──────────────────────────────────
  const fetchGPS = () => {
    if (gpsCoords) {
      setLat(gpsCoords.latitude);
      setLng(gpsCoords.longitude);
    } else {
      Alert.alert(t('rent.permissionDenied'), t('rent.locationPermission'));
    }
  };

  const toggleSkill    = (s) => setSkills(arr    => arr.includes(s)    ? arr.filter(x => x !== s)    : [...arr, s]);
  const toggleLanguage = (l) => setLanguages(arr => arr.includes(l)    ? arr.filter(x => x !== l)    : [...arr, l]);

  // ── Upload helpers ────────────────────────────────────────────────────────
  const uploadImage = async (uri) => {
    const { base64 } = await compressImage(uri);
    const res = await api.post('/upload/image', { base64 }, { timeout: 60000 });
    return res.data.data.url;
  };

  const uploadVideo = async (rawUri) => {
    const uri      = await compressVideo(rawUri);
    const fileName = uri.split('/').pop();
    const ext      = fileName.split('.').pop()?.toLowerCase() || 'mp4';
    const mimeMap  = { mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo' };
    const mime     = mimeMap[ext] || 'video/mp4';
    const formData = new FormData();
    formData.append('video', { uri, name: fileName, type: mime });
    const res = await api.post('/upload/video', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
    return res.data.data.url;
  };

  // ── Pickers ────────────────────────────────────────────────────────────────
  const pickPhoto = async (fromCamera = false) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') { Alert.alert(t('ai.permissionRequired')); return; }

    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.75 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.75 });
    if (res.canceled || !res.assets?.[0]) return;
    setPhoto({ uri: res.assets[0].uri, url: null });
  };

  const pickAdditionalImages = async () => {
    if (images.length >= 4) { Alert.alert(t('products.limitMsg')); return; }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert(t('ai.permissionRequired')); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images', quality: 0.75, allowsMultipleSelection: true,
    });
    if (res.canceled || !res.assets?.length) return;
    const toAdd = res.assets.slice(0, 4 - images.length);
    setImages(prev => [...prev, ...toAdd.map(a => ({ uri: a.uri, url: null }))]);
  };

  const pickVideo = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert(t('ai.permissionRequired')); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'videos', quality: 0.8 });
    if (res.canceled || !res.assets?.[0]) return;
    setVideo({ uri: res.assets[0].uri, url: null });
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!name.trim())     { Alert.alert(t('rent.required'), t('rent.yourName')); return; }
    if (skills.length === 0) { Alert.alert(t('rent.required'), t('rent.skillsRequired')); return; }
    if (!pricePerDay)     { Alert.alert(t('rent.required'), t('rent.enterPriceDay')); return; }
    if (!location.trim()) { Alert.alert(t('rent.required'), t('rent.enterLocation')); return; }
    if (!district.trim()) { Alert.alert(t('rent.required'), t('rent.enterDistrict')); return; }

    setUploading(true);
    let photoUrl   = null;
    let imageUrls  = [];
    let videoUrl   = null;

    try {
      if (photo && !photo.url)   photoUrl = await uploadImage(photo.uri);
      else if (photo?.url)       photoUrl = photo.url;

      for (const img of images) {
        if (img.url) { imageUrls.push(img.url); continue; }
        imageUrls.push(await uploadImage(img.uri));
      }

      if (video && !video.url)   videoUrl  = await uploadVideo(video.uri);
      else if (video?.url)       videoUrl  = video.url;
    } catch {
      setUploading(false);
      Alert.alert(t('rent.uploadFailed'), t('rent.uploadFailedMsg'));
      return;
    }
    setUploading(false);
    setSubmitting(true);

    try {
      await api.post('/rent/labour', {
        name:         name.trim(),
        leader:       workerType === 'group' ? (leader.trim() || name.trim()) : name.trim(),
        groupName:    workerType === 'group' ? groupName.trim() : null,
        skills,
        experience:   experience.trim() || null,
        description:  description.trim() || null,
        languages,
        pricePerDay,
        pricePerHour: pricePerHour || null,
        groupSize:    workerType === 'group' ? parseInt(groupSize) || 1 : 1,
        image:        photoUrl,
        images:       imageUrls,
        videos:       videoUrl ? [videoUrl] : [],
        phone:        phone.trim() || null,
        location:     location.trim(),
        district:     district.trim(),
        availableFrom: availableFrom || null,
        availableTo:  availableTo   || null,
        lat:          lat  ?? null,
        lng:          lng  ?? null,
      });

      Alert.alert(t('rent.registeredTitle'), t('rent.registeredMsg'), [
        { text: t('rent.done'), onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      const msg = err.response?.data?.error?.message || t('rent.error');
      Alert.alert(t('rent.error'), msg);
    } finally {
      setSubmitting(false);
    }
  };

  const loading = uploading || submitting;

  return (
    <View style={[S.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />

      {/* ── Header ── */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.charcoal} />
        </TouchableOpacity>
        <View>
          <Text style={S.headerTitle}>{t('rent.registerAsWorker')}</Text>
          <Text style={S.headerSub}>{t('rent.findWageWork')}</Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={S.scrollContent}>

          {/* ── Worker type ── */}
          <SectionLabel>{t('rent.workerTypeLabel')}</SectionLabel>
          <View style={S.typeRow}>
            {[
              { key: 'individual', labelKey: 'individual', icon: 'person-outline'  },
              { key: 'group',      labelKey: 'groupSangha', icon: 'people-outline'  },
            ].map(wt => (
              <TouchableOpacity
                key={wt.key}
                style={[S.typeCard, workerType === wt.key && S.typeCardActive]}
                onPress={() => setWorkerType(wt.key)}
              >
                <Ionicons name={wt.icon} size={22} color={workerType === wt.key ? COLORS.primary : COLORS.grayMedium} />
                <Text style={[S.typeLabel, workerType === wt.key && { color: COLORS.primary }]}>{t('rent.' + wt.labelKey)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Identity ── */}
          <SectionLabel>{t('rent.yourDetails')}</SectionLabel>
          <FieldInput
            label={workerType === 'individual' ? t('rent.yourName') : t('rent.leaderName')}
            value={name} onChangeText={setName}
            placeholder={t('rent.fullName')} required
          />
          {workerType === 'group' && (
            <>
              <FieldInput label={t('rent.groupName')} value={groupName} onChangeText={setGroupName} placeholder={t('rent.groupNamePlaceholder')} />
              <FieldInput label={t('rent.groupSizeLabel')} value={groupSize} onChangeText={setGroupSize} placeholder={t('rent.groupSizePlaceholder')} keyboardType="numeric" />
            </>
          )}
          <FieldInput label={t('rent.phoneNumber')} value={phone} onChangeText={setPhone} placeholder={t('rent.phonePlaceholder')} keyboardType="phone-pad" required />

          {/* ── Skills ── */}
          <SectionLabel>{t('rent.skillsRequired')} *</SectionLabel>
          <View style={S.chipGroup}>
            {SKILL_KEYS.map(sk => {
              const active = skills.includes(sk);
              return (
                <TouchableOpacity
                  key={sk}
                  style={[S.chip, active && S.chipActive]}
                  onPress={() => toggleSkill(sk)}
                >
                  {active && <Ionicons name="checkmark" size={12} color={COLORS.white} />}
                  <Text style={[S.chipTxt, active && { color: COLORS.white }]}>{t('skills.' + sk)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Languages ── */}
          <SectionLabel>{t('rent.languagesSpoken')}</SectionLabel>
          <View style={S.chipGroup}>
            {LANGUAGE_KEYS.map(lang => {
              const active = languages.includes(lang);
              return (
                <TouchableOpacity
                  key={lang}
                  style={[S.chip, active && S.chipActive]}
                  onPress={() => toggleLanguage(lang)}
                >
                  <Text style={[S.chipTxt, active && { color: COLORS.white }]}>{t('languages.' + lang)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Experience ── */}
          <SectionLabel>{t('rent.experienceDesc')}</SectionLabel>
          <FieldInput label={t('rent.experience')} value={experience} onChangeText={setExperience} placeholder={t('rent.experiencePlaceholder')} />
          <FieldInput label={t('rent.aboutSection')} value={description} onChangeText={setDescription} placeholder={t('rent.aboutPlaceholder')} multiline />

          {/* ── Pricing ── */}
          <SectionLabel>{t('rent.dailyRates')}</SectionLabel>
          <View style={S.row}>
            <View style={{ flex: 1 }}>
              <FieldInput label={t('rent.pricePerDay')} value={pricePerDay} onChangeText={setPricePerDay} placeholder={t('rent.priceDayPlaceholder')} keyboardType="numeric" required />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <FieldInput label={t('rent.pricePerHour')} value={pricePerHour} onChangeText={setPricePerHour} placeholder={t('rent.priceHourPlaceholder')} keyboardType="numeric" />
            </View>
          </View>

          {/* ── Availability ── */}
          <SectionLabel>{t('rent.availabilityDates')}</SectionLabel>
          <View style={S.row}>
            <View style={{ flex: 1 }}>
              <FieldInput label={t('rent.fromDate')} value={availableFrom} onChangeText={setAvailableFrom} placeholder="YYYY-MM-DD" />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <FieldInput label={t('rent.toDate')} value={availableTo} onChangeText={setAvailableTo} placeholder="YYYY-MM-DD" />
            </View>
          </View>

          {/* ── Location ── */}
          <SectionLabel>{t('rent.location')}</SectionLabel>
          <View style={S.row}>
            <View style={{ flex: 1 }}>
              <FieldInput label={t('rent.villageCityLabel')} value={location} onChangeText={setLocation} placeholder={t('rent.villagePlaceholder')} required />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <FieldInput label={t('rent.districtLabel')} value={district} onChangeText={setDistrict} placeholder={t('rent.districtPlaceholder')} required />
            </View>
          </View>

          {/* GPS auto-fill */}
          <TouchableOpacity
            style={[S.gpsBtnRow, lat != null && S.gpsBtnRowDone]}
            onPress={fetchGPS}
            disabled={gpsLoading}
          >
            {gpsLoading
              ? <ActivityIndicator size="small" color={COLORS.primary} />
              : <Ionicons name={lat != null ? 'location' : 'location-outline'} size={18} color={lat != null ? COLORS.white : COLORS.primary} />
            }
            <Text style={[S.gpsBtnTxt, lat != null && { color: COLORS.white }]}>
              {gpsLoading
                ? t('rent.fetchingGps')
                : lat != null
                  ? `${t('rent.gpsSaved')}  (${lat.toFixed(4)}, ${lng.toFixed(4)})`
                  : t('rent.useGps')}
            </Text>
          </TouchableOpacity>

          {/* ── Profile Photo ── */}
          <SectionLabel>{t('rent.profilePhoto')}</SectionLabel>
          <View style={S.photoRow}>
            {photo
              ? (
                <View style={S.photoPreviewWrap}>
                  <Image source={{ uri: photo.uri }} style={S.photoPreview} />
                  <TouchableOpacity style={S.removePhotoBtn} onPress={() => setPhoto(null)}>
                    <Ionicons name="close-circle" size={22} color={COLORS.error} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={S.photoPickers}>
                  <TouchableOpacity style={S.photoPickBtn} onPress={() => pickPhoto(false)}>
                    <Ionicons name="images-outline" size={22} color={COLORS.primary} />
                    <Text style={S.photoPickTxt}>{t('rent.gallery')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={S.photoPickBtn} onPress={() => pickPhoto(true)}>
                    <Ionicons name="camera-outline" size={22} color={COLORS.primary} />
                    <Text style={S.photoPickTxt}>{t('rent.camera')}</Text>
                  </TouchableOpacity>
                </View>
              )
            }
          </View>

          {/* ── Additional Images ── */}
          <SectionLabel>{t('rent.additionalPhotos')}</SectionLabel>
          <View style={S.mediaRow}>
            {images.map((img, i) => (
              <View key={i} style={S.mediaThumb}>
                <Image source={{ uri: img.uri }} style={S.thumbImg} />
                <TouchableOpacity style={S.removeBtn} onPress={() => setImages(arr => arr.filter((_, j) => j !== i))}>
                  <Ionicons name="close-circle" size={20} color={COLORS.error} />
                </TouchableOpacity>
              </View>
            ))}
            {images.length < 4 && (
              <TouchableOpacity style={S.addMediaBtn} onPress={pickAdditionalImages}>
                <Ionicons name="add" size={24} color={COLORS.primary} />
              </TouchableOpacity>
            )}
          </View>

          {/* ── Video ── */}
          <SectionLabel>{t('rent.workVideo')}</SectionLabel>
          {video ? (
            <View style={S.videoWrap}>
              <Ionicons name="videocam" size={26} color={COLORS.primary} />
              <Text style={S.videoName} numberOfLines={1}>{video.uri.split('/').pop()}</Text>
              <TouchableOpacity onPress={() => setVideo(null)} style={{ padding: 6 }}>
                <Ionicons name="trash-outline" size={18} color={COLORS.error} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={S.videoPickBtn} onPress={pickVideo}>
              <Ionicons name="cloud-upload-outline" size={22} color={COLORS.primary} />
              <Text style={S.videoPickTxt}>{t('rent.chooseWorkVideo')}</Text>
            </TouchableOpacity>
          )}

          <View style={{ height: 20 }} />

          {/* ── Submit ── */}
          <TouchableOpacity
            style={[S.submitBtn, loading && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color={COLORS.white} />
              : <>
                  <Ionicons name="checkmark-circle" size={20} color={COLORS.white} />
                  <Text style={S.submitTxt}>
                    {uploading ? t('rent.uploadingMedia') : t('rent.registerGoLive')}
                  </Text>
                </>
            }
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const S = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.lightGray2 },
  backBtn:{ padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: COLORS.textDark },
  headerSub:   { fontSize: 12, color: COLORS.textLight },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16 },

  sectionLabel: { fontSize: 15, fontWeight: '800', color: COLORS.textDark, marginTop: 16, marginBottom: 10 },
  label:        { fontSize: 13, fontWeight: '600', color: COLORS.grayDark2, marginBottom: 6 },
  req:          { color: COLORS.error },
  field:        { marginBottom: 12 },
  input:        { backgroundColor: COLORS.white, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.gray100alt, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: COLORS.textDark },
  inputMulti:   { minHeight: 80, textAlignVertical: 'top' },
  row:          { flexDirection: 'row', alignItems: 'flex-end' },

  typeRow:       { flexDirection: 'row', gap: 12, marginBottom: 4 },
  typeCard:      { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.white, borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.gray150, paddingVertical: 14, paddingHorizontal: 16 },
  typeCardActive:{ borderColor: COLORS.primary, backgroundColor: COLORS.primaryPale },
  typeLabel:     { fontSize: 14, fontWeight: '700', color: COLORS.textLight },

  chipGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: COLORS.white, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.gray150 },
  chipActive:{ backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipTxt:   { fontSize: 12, fontWeight: '700', color: COLORS.grayMid2 },

  photoRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  photoPreviewWrap:{ position: 'relative' },
  photoPreview:    { width: 90, height: 90, borderRadius: 45 },
  removePhotoBtn:  { position: 'absolute', top: -4, right: -4 },
  photoPickers:    { flexDirection: 'row', gap: 10 },
  photoPickBtn:    { width: 90, height: 90, borderRadius: 16, backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.gray150, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', gap: 4 },
  photoPickTxt:    { fontSize: 10, color: COLORS.primary, fontWeight: '700' },

  mediaRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  mediaThumb:    { width: 76, height: 76, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  thumbImg:      { width: '100%', height: '100%' },
  removeBtn:     { position: 'absolute', top: 2, right: 2 },
  addMediaBtn:   { width: 76, height: 76, borderRadius: 10, backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.gray150, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },

  videoWrap:    { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.white, borderRadius: 12, padding: 14, borderWidth: 1.5, borderColor: COLORS.primary + '40', marginBottom: 4 },
  videoName:    { flex: 1, fontSize: 13, color: COLORS.grayDark2 },
  videoPickBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.white, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.gray150, borderStyle: 'dashed', padding: 16, justifyContent: 'center', marginBottom: 4 },
  videoPickTxt: { fontSize: 14, color: COLORS.primary, fontWeight: '700' },

  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: 16, paddingVertical: 16 },
  submitTxt: { color: COLORS.white, fontSize: 16, fontWeight: '800' },

  gpsBtnRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12, backgroundColor: COLORS.white },
  gpsBtnRowDone: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  gpsBtnTxt:     { fontSize: 13, fontWeight: '700', color: COLORS.primary, flex: 1 },
});

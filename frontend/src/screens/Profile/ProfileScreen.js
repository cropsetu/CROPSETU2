import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Switch, Alert, Modal, TextInput, Linking,
  Image, ActivityIndicator, Platform, Animated, ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useLanguage } from '../../context/LanguageContext';
import { getStatesByRegion, REGION_ORDER } from '../../i18n/stateMappings';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { compressImage } from '../../utils/mediaCompressor';
import { EntrySlide, D } from '../../components/ui/ImmersiveKit';
import { COLORS } from '../../constants/colors';
import AnimatedScreen from '../../components/ui/AnimatedScreen';
import { MapPin, Pencil, Sprout, Store } from 'lucide-react-native';
import {
  BRAND as C, SERIF, NeuralLeaf, BrandPill, CANVAS, CARD_SHADOW, withAlpha,
} from '../../components/ui/brandKit';

// The hero now sits on the shared brand canvas (soft field-green + NeuralLeaf),
// so the old dark-hero white-glow decoration is no longer needed.

function SectionCard({ children, style, delay = 0 }) {
  return (
    <EntrySlide delay={delay} fromY={16}>
      <View style={[S.sectionCard, style]}>
        {children}
      </View>
    </EntrySlide>
  );
}

function SectionHeader({ title, icon, iconColor }) {
  const color = iconColor || COLORS.primary;
  return (
    <View style={S.sectionHeader}>
      <View style={[S.sectionIconWrap, { backgroundColor: color + '12' }]}>
        <Ionicons name={icon || 'ellipse'} size={icon ? 14 : 6} color={color} />
      </View>
      <Text style={S.sectionTitle}>{title}</Text>
    </View>
  );
}

function RowItem({ icon, iconColor, label, subtitle, onPress, showArrow = true, rightElement, isLast }) {
  const color = iconColor || COLORS.primary;
  return (
    <TouchableOpacity
      style={[S.rowItem, isLast && { borderBottomWidth: 0 }]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <View style={[S.rowIcon, { backgroundColor: color + '14' }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={S.rowLabel}>{label}</Text>
        {subtitle ? <Text style={S.rowSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {rightElement || (showArrow && (
        <Ionicons name="chevron-forward" size={18} color={D.textFaint} />
      ))}
    </TouchableOpacity>
  );
}

function QuickTile({ icon, label, color, onPress, index = 0 }) {
  return (
    <EntrySlide delay={index * 80} fromY={20} style={{ flex: 1 }}>
      <TouchableOpacity style={S.quickTile} onPress={onPress} activeOpacity={0.7}>
        <View style={[S.quickIcon, { backgroundColor: color + '14' }]}>
          <Ionicons name={icon} size={24} color={color} />
        </View>
        <Text style={S.quickLabel} numberOfLines={2}>{label}</Text>
      </TouchableOpacity>
    </EntrySlide>
  );
}

function EditProfileModal({ visible, user, onClose, onSaved }) {
  const { t } = useLanguage();
  const [name,        setName]        = useState('');
  const [statusQuote, setStatusQuote] = useState('');
  const [district,    setDistrict]    = useState('');
  const [city,        setCity]        = useState('');
  const [pincode,     setPincode]     = useState('');
  const [saving,      setSaving]      = useState(false);

  // The modal stays mounted (only `visible` toggles), so seeding state via
  // useState initialisers would freeze the fields at first-mount values and
  // show stale data on reopen. Re-sync from the latest `user` each time it opens.
  useEffect(() => {
    if (!visible) return;
    setName(user?.name || '');
    setStatusQuote(user?.statusQuote || '');
    setDistrict(user?.district || '');
    setCity(user?.city || '');
    setPincode(user?.pincode || '');
  }, [visible, user]);

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert(t('product.error'), t('profile.nameEmpty')); return; }
    setSaving(true);
    try {
      const { data } = await api.put('/users/me', { name, statusQuote, district, city, pincode });
      onSaved(data.data);
    } catch (e) {
      Alert.alert(t('product.error'), e?.response?.data?.error?.message || t('profile.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  const FIELDS = [
    { key: 'name',     label: t('profile.fullName', 'Full name'),        icon: 'person-outline',              color: COLORS.primary, value: name,        setter: setName,        placeholder: t('profile.fullNamePlaceholder'), maxLen: 80  },
    { key: 'quote',    label: t('profile.statusQuote', 'Status / bio'),  icon: 'chatbubble-ellipses-outline', color: D.cyan,         value: statusQuote, setter: setStatusQuote, placeholder: t('profile.statusPlaceholder'),   maxLen: 200 },
    { key: 'district', label: t('profile.district'),                     icon: 'business-outline',            color: D.green,        value: district,    setter: setDistrict,    placeholder: t('profile.districtPlaceholder'), maxLen: 100 },
    { key: 'city',     label: t('profile.cityTown'),                     icon: 'location-outline',            color: D.amber,        value: city,        setter: setCity,        placeholder: t('profile.cityPlaceholder'),     maxLen: 100 },
    { key: 'pincode',  label: t('profile.pincode'),                      icon: 'pin-outline',                 color: D.gold,         value: pincode,     setter: setPincode,     placeholder: t('profile.pincodePlaceholder'),  maxLen: 6, keyboard: 'number-pad' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={S.editKav}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={S.editSheet}>
          <View style={S.sheetHandle} />
          <View style={S.editHeader}>
            <Text style={S.sheetTitle}>{t('editProfile')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={D.textDim} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={S.editScroll}
            contentContainerStyle={{ paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {FIELDS.map((f) => (
              <View key={f.key} style={S.fieldGroup}>
                <Text style={S.fieldLabel}>{f.label}</Text>
                <View style={S.fieldRow}>
                  <View style={[S.fieldIconWrap, { backgroundColor: f.color + '12' }]}>
                    <Ionicons name={f.icon} size={16} color={f.color} />
                  </View>
                  <TextInput
                    style={S.fieldInput}
                    value={f.value}
                    onChangeText={f.setter}
                    placeholder={f.placeholder}
                    placeholderTextColor={D.textFaint}
                    maxLength={f.maxLen}
                    keyboardType={f.keyboard || 'default'}
                  />
                </View>
              </View>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={[S.saveBtn, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={[C.greenBright, C.greenInk]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={S.saveBtnGrad}
            >
              {saving
                ? <ActivityIndicator color={COLORS.white} />
                : <Text style={S.saveBtnTxt}>{t('profile.saveChanges')}</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const STAT_CONFIGS = [
  { key: 'animalListings', labelKey: 'profile.animals', icon: 'paw-outline',       color: D.amber },
  { key: 'orders',         labelKey: 'profile.orders',  icon: 'cart-outline',      color: D.green },
  // Rentals = machinery + labour listings the user has created (value computed in render)
  { key: 'rentListings',   labelKey: 'profile.rentals', icon: 'construct-outline', color: D.cyan },
];

export default function ProfileScreen({ navigation }) {
  const { user, updateUser, logout, refreshUser } = useAuth();
  const { t, language, setLanguage, setLanguageByState, selectedState, LANGUAGES } = useLanguage();

  // Live rental-listing count, fetched from the same endpoints My Rent Listings uses
  // (authoritative — always matches what the user sees on that screen).
  const [rentCount, setRentCount] = useState(null);

  // Refresh profile (and the activity counts) every time this screen is focused,
  // so newly added/removed rental & animal listings reflect immediately.
  useFocusEffect(useCallback(() => {
    refreshUser?.();
    let cancelled = false;
    (async () => {
      const [mRes, lRes] = await Promise.allSettled([
        api.get('/rent/machinery/my', { params: { limit: 1 } }),
        api.get('/rent/labour/my',    { params: { limit: 1 } }),
      ]);
      if (cancelled) return;
      const totalOf = (r) =>
        r.status === 'fulfilled'
          ? (r.value.data?.meta?.total ?? (r.value.data?.data?.length || 0))
          : 0;
      // Only update if at least one call succeeded; otherwise leave the _count fallback.
      if (mRes.status === 'fulfilled' || lRes.status === 'fulfilled') {
        setRentCount(totalOf(mRes) + totalOf(lRes));
      }
    })();
    return () => { cancelled = true; };
  }, [refreshUser]));

  const [notifications,   setNotifications]  = useState(true);
  const [showLangModal,   setShowLangModal]  = useState(false);
  const [showStateModal,  setShowStateModal] = useState(false);
  const [showEditModal,   setShowEditModal]  = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [uploadingPhoto, setUploadingPhoto]  = useState(false);
  // Bumped after each avatar upload to cache-bust the <Image> — RN otherwise
  // keeps showing the cached photo until the component is remounted.
  const [avatarBust, setAvatarBust] = useState(0);
  const scrollY = useRef(new Animated.Value(0)).current;

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  // Role is the source of truth — backend flips FARMER → SELLER on first BusinessProfile save.
  // Fall back to legacy field checks for accounts that filled the form before the role flip existed.
  const isSeller = (
    user?.role === 'SELLER' ||
    user?.role === 'VERIFIED_FARMER' ||
    user?.role === 'ADMIN' ||
    !!user?.sellerProfile?.bankAccountNumber ||
    !!user?.gstNumber ||
    !!user?.businessType
  );

  const heroScale   = scrollY.interpolate({ inputRange: [0, 180], outputRange: [1, 0.92], extrapolate: 'clamp' });
  const heroOpacity = scrollY.interpolate({ inputRange: [0, 140], outputRange: [1, 0.7],  extrapolate: 'clamp' });

  const handlePhotoPress = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('profile.permissionNeeded'), t('profile.photoPermission'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    const uri   = asset.uri;

    // Validate image type using MIME from the picker (not file extension — Android
    // gallery URIs often have no extension or a numeric filename like "1000000033")
    const mime = (asset.mimeType || asset.type || '').toLowerCase();
    const ext  = (uri.split('.').pop() || '').toLowerCase();
    const isValidType = ['jpg', 'jpeg', 'png', 'webp'].includes(ext)
      || mime.includes('jpeg') || mime.includes('png') || mime.includes('webp') || mime.includes('jpg');

    if (!isValidType) {
      Alert.alert(t('profile.invalidFileType') || 'Invalid File', t('profile.invalidFileMsg') || 'Please select a JPG, PNG, or WebP image.');
      return;
    }
    setUploadingPhoto(true);
    try {
      const { uri: compressedUri } = await compressImage(uri);

      const formData = new FormData();
      if (Platform.OS === 'web') {
        // On web, RN's { uri, name, type } object is NOT a real file — it
        // serialises to a string and the backend receives no file (→ 400).
        // Fetch the compressed image into a Blob and append that instead.
        const blob = await (await fetch(compressedUri)).blob();
        formData.append('file', blob, 'avatar.jpg');
      } else {
        formData.append('file', {
          uri: Platform.OS === 'android' ? compressedUri : compressedUri.replace('file://', ''),
          name: 'avatar.jpg',
          type: 'image/jpeg',
        });
      }

      const { data } = await api.put('/users/me', formData);

      if (data.data?.avatar) {
        updateUser({ avatar: data.data.avatar });
        setAvatarBust((n) => n + 1);   // force the <Image> to reload immediately
      } else {
        // Response lacked the URL — re-sync from the server so it still updates.
        await refreshUser?.();
      }
    } catch (err) {
      // Log the server's real reason (not just axios's "status code 400").
      if (__DEV__) console.warn('[Profile] Upload error:', err.response?.data?.error?.message || err.message, err.response?.status);
      const msg = err.response?.data?.error?.message || t('profile.uploadFailedMsg') || 'Upload failed. Try again.';
      Alert.alert(t('profile.uploadFailed') || 'Upload Failed', msg);
    } finally {
      setUploadingPhoto(false);
    }
  }, [updateUser, refreshUser]);

  const handleLogout = () => setShowLogoutConfirm(true);

  const confirmLogout = () => {
    setShowLogoutConfirm(false);
    logout();
  };

  const counts      = user?._count || {};
  // Prefer the live fetched total; fall back to the backend _count if not loaded yet.
  const rentListingCount = rentCount ?? ((counts.machineryListings || 0) + (counts.labourListings || 0));
  const currentLang = LANGUAGES.find((l) => l.code === language);

  return (
    <AnimatedScreen style={[S.root]}>
      {/* Soft field-green canvas + decorative neural leaf (shared brand surface) */}
      <LinearGradient
        colors={CANVAS}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <NeuralLeaf />

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
      >
        <Animated.View style={{ transform: [{ perspective: 1200 }, { scale: heroScale }], opacity: heroOpacity }}>
          <View style={S.hero}>
            <View style={S.heroContent}>
              <TouchableOpacity style={S.avatarWrap} onPress={handlePhotoPress} activeOpacity={0.8}>
                <View style={S.avatarRing}>
                  {user?.avatar ? (
                    <Image
                      source={{ uri: avatarBust ? `${user.avatar}${user.avatar.includes('?') ? '&' : '?'}v=${avatarBust}` : user.avatar }}
                      style={S.avatarImg}
                    />
                  ) : (
                    <LinearGradient
                      colors={[C.greenBright, C.greenInk]}
                      style={S.avatar}
                    >
                      <Text style={S.avatarTxt}>{initials}</Text>
                    </LinearGradient>
                  )}
                </View>
                <View style={S.cameraBtn}>
                  {uploadingPhoto
                    ? <ActivityIndicator size="small" color={COLORS.white} />
                    : <Ionicons name="camera" size={12} color={COLORS.white} />}
                </View>
              </TouchableOpacity>

              <BrandPill
                icon={isSeller ? Store : Sprout}
                label={isSeller ? t('profile.sellerBadge', 'Seller') : t('profile.farmerBadge', 'Farmer')}
                style={S.heroPillCenter}
              />

              <Text style={S.heroName} maxFontSizeMultiplier={1.3}>{user?.name || t('profile.defaultName', 'Farmer')}</Text>
              {user?.phone && <Text style={S.heroPhone}>{user.phone}</Text>}
              {(user?.city || user?.district) && (
                <BrandPill
                  icon={MapPin}
                  label={[user?.city, user?.district].filter(Boolean).join(', ')}
                  style={S.heroPillCenter}
                />
              )}
              {user?.statusQuote ? (
                <View style={S.quoteWrap}>
                  <Text style={S.heroQuote}>"{user.statusQuote}"</Text>
                </View>
              ) : null}

              <View style={S.heroActions}>
                <TouchableOpacity style={S.editBtn} onPress={() => setShowEditModal(true)} activeOpacity={0.8}>
                  <Pencil size={14} color={C.white} strokeWidth={2.4} />
                  <Text style={S.editBtnTxt}>{t('editProfile')}</Text>
                </TouchableOpacity>
                <Text style={S.memberSince}>
                  {t('memberSince')} {user?.createdAt ? new Date(user.createdAt).getFullYear() : '—'}
                </Text>
              </View>
            </View>
          </View>
        </Animated.View>

        <View style={S.body}>
          <EntrySlide delay={0} fromY={20}>
            <View style={S.statsCard}>
              {STAT_CONFIGS.map((stat, i) => (
                <View key={stat.key} style={[S.statCell, i < STAT_CONFIGS.length - 1 && S.statCellBorder]}>
                  <View style={[S.statIcon, { backgroundColor: stat.color + '16' }]}>
                    <Ionicons name={stat.icon} size={20} color={stat.color} />
                  </View>
                  <Text style={S.statValue}>{stat.key === 'rentListings' ? rentListingCount : (counts[stat.key] ?? 0)}</Text>
                  <Text style={S.statLabel}>{t(stat.labelKey)}</Text>
                </View>
              ))}
            </View>
          </EntrySlide>

          <SectionCard delay={60}>
            <SectionHeader title={t('profile.quickActions')} icon="flash-outline" iconColor={D.gold} />
            <View style={S.quickGrid}>
              <QuickTile index={0} icon="leaf"     label="My Farms"               color={COLORS.primary} onPress={() => navigation.navigate('FarmList')} />
              <QuickTile index={1} icon="cart"     label={t('myOrders')}          color={D.green}  onPress={() => navigation.navigate('MyOrders')} />
              <QuickTile index={2} icon="bookmark" label={t('savedPosts')}        color={D.gold}   onPress={() => navigation.navigate('SavedPosts')} />
              <QuickTile index={3} icon="paw"      label={t('profile.myListings')} color={D.amber}  onPress={() => navigation.navigate('MyAnimalListings')} />
            </View>
          </SectionCard>

          <SectionCard delay={120}>
            <SectionHeader title={t('profile.accountSettings')} icon="settings-outline" iconColor={D.cyan} />
            {/* "Edit Profile" lives in the hero header — no duplicate row here. */}
            <RowItem icon="location-outline"      iconColor={D.green}  label={t('profile.savedAddresses')}   subtitle={user?.city ? `${[user.city, user.district].filter(Boolean).join(', ')}` : t('profile.addAddress')} onPress={() => setShowEditModal(true)} />
            <RowItem
              icon="globe-outline" iconColor={D.cyan}
              label={t('profile.selectState')}
              subtitle={selectedState ? `${selectedState} · ${currentLang?.nativeName || 'English'}` : currentLang?.nativeName || 'English'}
              onPress={() => setShowStateModal(true)}
            />
            <RowItem
              icon="notifications-outline" iconColor={D.blue}
              label={t('profile.notificationSettings')} subtitle={t('profile.notificationSub')}
              showArrow={false}
              rightElement={
                <Switch
                  value={notifications}
                  onValueChange={setNotifications}
                  trackColor={{ false: COLORS.slateLight, true: COLORS.primary + '70' }}
                  thumbColor={notifications ? COLORS.primary : COLORS.textDisabled}
                />
              }
            />
            <RowItem icon="shield-checkmark-outline" iconColor={D.purple} label={t('profile.privacyCenter')} subtitle={t('profile.privacySub')} onPress={() => Alert.alert(t('profile.privacyCenter'), 'Your data is securely stored and never shared with third parties. We follow industry-standard encryption and privacy practices.')} isLast />
          </SectionCard>

          <SectionCard delay={180}>
            <SectionHeader title={t('personalInfo')} icon="person-outline" iconColor={D.blue} />
            <RowItem icon="call-outline"     iconColor={D.green}  label={t('profile.mobileNumber')} subtitle={user?.phone || '—'}                                  showArrow={false} />
            <RowItem icon="mail-outline"     iconColor={D.blue}   label={t('profile.email')}         subtitle={t('profile.notAddedYet')}                            showArrow={false} />
            <RowItem icon="business-outline" iconColor={D.cyan}   label={t('profile.district')}      subtitle={user?.district || '—'}                               showArrow={false} />
            <RowItem icon="home-outline"     iconColor={D.green}  label="Village"                    subtitle={user?.village || '—'}                                showArrow={false} />
            <RowItem icon="location-outline" iconColor={D.amber}  label={t('profile.cityTown')}      subtitle={user?.city || '—'}                                   showArrow={false} />
            <RowItem icon="map-outline"      iconColor={D.indigo} label={t('profile.state')}         subtitle={user?.state || '—'}                                  showArrow={false} />
            <RowItem icon="pin-outline"      iconColor={D.gold}   label={t('profile.pincode')}       subtitle={user?.pincode || '—'}                                showArrow={false} isLast />
          </SectionCard>

          <SectionCard delay={240}>
            <SectionHeader title={t('myActivity')} icon="trending-up-outline" iconColor={D.amber} />
            <RowItem icon="paw-outline"       iconColor={D.amber} label={t('myAnimalListings')}          subtitle={t('profile.listingsCount', { count: counts.animalListings || 0 })}   onPress={() => navigation.navigate('MyAnimalListings')} />
            <RowItem icon="construct-outline" iconColor={D.cyan}  label={t('myRentListings')}            subtitle={t('profile.listingsCount', { count: rentListingCount })} onPress={() => navigation.navigate('MyRentListings')} isLast />
          </SectionCard>

          {user?.farmDetail && (
            <SectionCard delay={300}>
              <SectionHeader title={t('farmDetails')} icon="leaf-outline" iconColor={D.green} />
              <RowItem icon="resize-outline" iconColor={D.green}  label={t('profile.totalLand')}  subtitle={user.farmDetail.landAcres ? t('profile.landAcres', { acres: user.farmDetail.landAcres }) : '—'} showArrow={false} />
              <RowItem icon="layers-outline" iconColor={D.amber}  label={t('profile.soilType')}   subtitle={user.farmDetail.soilType || '—'}       showArrow={false} />
              <RowItem icon="water-outline"  iconColor={D.cyan}   label={t('profile.irrigation')} subtitle={user.farmDetail.irrigationType || '—'} showArrow={false} />
              <RowItem icon="flower-outline" iconColor={COLORS.primary}   label={t('profile.mainCrops')}  subtitle={(user.farmDetail.cropTypes || []).join(', ') || '—'} showArrow={false} isLast />
            </SectionCard>
          )}

          <EntrySlide delay={360} fromY={16}>
            <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate('AIAssistant', { screen: 'Scheme' })}>
              <LinearGradient
                colors={[C.greenBright, C.greenInk]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={S.schemeBanner}
              >
                <View style={S.schemeIconWrap}>
                  <Ionicons name="ribbon" size={22} color={COLORS.white} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.schemesTitle}>{t('profile.schemesTitle')}</Text>
                  <Text style={S.schemesSub}>{t('profile.schemesSub')}</Text>
                </View>
                <View style={S.bannerArrow}>
                  <Ionicons name="arrow-forward" size={16} color={COLORS.white} />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </EntrySlide>

          <SectionCard delay={420}>
            <SectionHeader title={t('profile.feedbackInfo')} icon="chatbubbles-outline" iconColor={D.gold} />
            <RowItem icon="star-outline"              iconColor={D.gold}   label={t('rate')}                        subtitle={t('profile.rateStar')}          onPress={() => Alert.alert(t('profile.thankYou'), t('profile.thankYouMsg'))} />
            <RowItem icon="help-circle-outline"       iconColor={D.blue}   label={t('help')}                        subtitle={t('helpSub')}                   onPress={() => Alert.alert(t('profile.support'), t('profile.callUs'))} />
            <RowItem icon="document-text-outline"     iconColor={D.purple} label={t('profile.termsLabel')}                                                    onPress={() => Linking.openURL('https://cropsetu.app/terms')} />
            <RowItem icon="chatbubble-ellipses-outline" iconColor={D.cyan} label={t('profile.browseFAQs')}          subtitle={t('profile.faqsSub')}           onPress={() => Linking.openURL('https://cropsetu.app/faqs')} isLast />
          </SectionCard>

          <EntrySlide delay={480} fromY={16}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => navigation.navigate('SellerPortal', isSeller ? undefined : { screen: 'BusinessProfile' })}
            >
              <LinearGradient
                colors={['#E65100', '#F57C00', '#FF9800']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={S.sellerBanner}
              >
                <View style={S.sellerIconWrap}>
                  <Ionicons name={isSeller ? 'storefront' : 'add-circle'} size={24} color={COLORS.white} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.sellerTitle}>
                    {isSeller
                      ? t('profile.sellerDashboardTitle', 'Seller Dashboard')
                      : t('profile.becomeSellerTitle', 'Become a Seller')}
                  </Text>
                  <Text style={S.sellerSub}>
                    {isSeller
                      ? t('profile.sellerDashboardSub', 'Manage products, orders & earnings')
                      : t('profile.becomeSellerSub', 'Set up your shop & start selling on CropSetu')}
                  </Text>
                </View>
                <View style={S.bannerArrow}>
                  <Ionicons name="arrow-forward" size={16} color={COLORS.white} />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </EntrySlide>

          <EntrySlide delay={540} fromY={16}>
            <TouchableOpacity style={S.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
              <View style={S.logoutIconWrap}>
                <Ionicons name="log-out-outline" size={18} color={D.red} />
              </View>
              <Text style={S.logoutLabel}>{t('logout')}</Text>
              <Ionicons name="chevron-forward" size={16} color={D.red + '80'} />
            </TouchableOpacity>
          </EntrySlide>

          <Text style={S.version}>{t('profile.versionText')}</Text>
          <View style={{ height: 40 }} />
        </View>
      </Animated.ScrollView>

      <EditProfileModal
        visible={showEditModal}
        user={user}
        onClose={() => setShowEditModal(false)}
        onSaved={(updated) => { updateUser(updated); setShowEditModal(false); }}
      />

      {/* Logout confirmation — custom in-app popup (not a native Alert). */}
      <Modal visible={showLogoutConfirm} transparent animationType="fade" onRequestClose={() => setShowLogoutConfirm(false)}>
        <TouchableOpacity style={S.confirmBackdrop} activeOpacity={1} onPress={() => setShowLogoutConfirm(false)}>
          <TouchableOpacity style={S.confirmCard} activeOpacity={1} onPress={() => {}}>
            <View style={S.confirmIconWrap}>
              <Ionicons name="log-out-outline" size={26} color={D.red} />
            </View>
            <Text style={S.confirmTitle}>{t('logout')}</Text>
            <Text style={S.confirmMsg}>{t('logoutConfirm')}</Text>
            <View style={S.confirmBtnRow}>
              <TouchableOpacity style={[S.confirmBtn, S.confirmCancel]} onPress={() => setShowLogoutConfirm(false)} activeOpacity={0.8}>
                <Text style={S.confirmCancelTxt}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.confirmBtn, S.confirmDanger]} onPress={confirmLogout} activeOpacity={0.85}>
                <Text style={S.confirmDangerTxt}>{t('logout')}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showStateModal} transparent animationType="slide" onRequestClose={() => setShowStateModal(false)}>
        <View style={S.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowStateModal(false)} />
          <View style={S.stateSheet}>
            <View style={S.sheetHandle} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4, paddingHorizontal: 4 }}>
              <Ionicons name="globe-outline" size={22} color={COLORS.primary} />
              <Text style={{ fontSize: 16, fontWeight: '800', color: D.text, flex: 1 }}>
                {t('profile.selectState')}
              </Text>
              <TouchableOpacity onPress={() => { setShowStateModal(false); setShowLangModal(true); }}>
                <Text style={{ fontSize: 12, color: D.cyan, fontWeight: '600' }}>{t('profile.manualLang')}</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12, color: D.textDim, marginBottom: 16, paddingHorizontal: 4 }}>
              {t('profile.stateLangHint')}
            </Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              {REGION_ORDER.map((region) => {
                const states = getStatesByRegion()[region];
                if (!states || states.length === 0) return null;
                return (
                  <View key={region}>
                    <Text style={S.regionHeader}>{region}</Text>
                    {states.map((state) => {
                      const isSelected = selectedState === state.name;
                      return (
                        <TouchableOpacity
                          key={state.name}
                          style={[S.stateOption, isSelected && { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '10' }]}
                          onPress={() => { setLanguageByState(state.name); setShowStateModal(false); }}
                          activeOpacity={0.75}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={[S.stateName, isSelected && { color: COLORS.primary }]}>{state.name}</Text>
                            {state.nativeName ? (
                              <Text style={S.stateNative}>{state.nativeName}</Text>
                            ) : null}
                          </View>
                          <Text style={S.stateLangBadge}>{state.lang.toUpperCase()}</Text>
                          {isSelected && <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} style={{ marginLeft: 6 }} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showLangModal} transparent animationType="slide" onRequestClose={() => setShowLangModal(false)}>
        <TouchableOpacity style={S.modalOverlay} activeOpacity={1} onPress={() => setShowLangModal(false)}>
          <View style={S.langSheet}>
            <View style={S.sheetHandle} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <Ionicons name="language" size={22} color={COLORS.primary} />
              <Text style={{ fontSize: 13, fontWeight: '700', color: D.text, flex: 1 }}>
                Choose Language / भाषा चुनें / भाषा निवडा
              </Text>
            </View>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[S.langOption, language === lang.code && { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '10' }]}
                onPress={() => { setLanguage(lang.code); setShowLangModal(false); }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 28 }}>{lang.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[{ fontSize: 16, fontWeight: '700', color: D.text }, language === lang.code && { color: COLORS.primary }]}>
                    {lang.name}
                  </Text>
                  <Text style={{ fontSize: 13, color: D.textFaint, marginTop: 2 }}>{lang.nativeName}{lang.region ? `  ·  ${lang.region}` : ''}</Text>
                </View>
                {language === lang.code && <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </AnimatedScreen>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bgTop },

  // Hero now sits on the soft field-green canvas (no dark gradient block).
  hero: {
    paddingTop: 52,
    paddingBottom: 22, paddingHorizontal: 24,
  },
  heroContent: { alignItems: 'center' },

  avatarWrap: { position: 'relative', marginBottom: 14 },
  avatarRing: {
    width: 96, height: 96, borderRadius: 48,
    borderWidth: 4, borderColor: C.white, backgroundColor: C.white,
    overflow: 'hidden',
    shadowColor: C.shadowGreen, shadowOpacity: 0.20, shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  avatar: {
    width: '100%', height: '100%',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarTxt: { fontSize: 34, fontWeight: '900', color: COLORS.white },
  cameraBtn: {
    position: 'absolute', bottom: 2, right: 2,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.green,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2.5, borderColor: COLORS.white,
    shadowColor: C.shadowGreen, shadowOpacity: 0.25, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },

  // Centres a BrandPill within the centred hero column.
  heroPillCenter: { alignSelf: 'center', marginBottom: 8, maxWidth: '92%' },

  heroName: {
    fontFamily: SERIF, fontWeight: '700',
    fontSize: 26, lineHeight: 32, color: C.headingDark,
    textAlign: 'center', marginTop: 2, marginBottom: 4,
  },
  heroPhone: {
    fontSize: 14, color: C.textBody, fontWeight: '500',
    marginBottom: 8, textAlign: 'center',
  },
  quoteWrap: {
    backgroundColor: C.pill,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 7,
    marginBottom: 2, marginTop: 2, maxWidth: '90%',
  },
  heroQuote: { fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: C.greenDeep, textAlign: 'center' },
  heroActions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', marginTop: 16,
  },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.green,
    borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9,
    shadowColor: C.shadowGreen, shadowOpacity: 0.20, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  editBtnTxt: { fontSize: 13, fontWeight: '700', color: COLORS.white },
  memberSince: { fontSize: 12, color: C.textHint, fontStyle: 'italic' },

  body: { paddingHorizontal: 16, marginTop: 6 },

  statsCard: {
    flexDirection: 'row', backgroundColor: C.white,
    borderRadius: 20, paddingVertical: 20, paddingHorizontal: 8,
    borderWidth: 1, borderColor: C.inputBorder,
    marginBottom: 16,
    ...CARD_SHADOW,
  },
  statCell: { flex: 1, alignItems: 'center', gap: 6 },
  statCellBorder: { borderRightWidth: 1, borderRightColor: withAlpha(C.green, 0.10) },
  statIcon: {
    width: 44, height: 44, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center', marginBottom: 2,
  },
  statValue: { fontSize: 22, fontWeight: '900', color: C.headingDark },
  statLabel: { fontSize: 11, color: C.textBody, fontWeight: '600' },

  sectionCard: {
    backgroundColor: C.white, borderRadius: 18,
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4,
    marginBottom: 12,
    borderWidth: 1, borderColor: C.inputBorder,
    shadowColor: C.shadowGreen, shadowOpacity: 0.06, shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 6, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: withAlpha(C.green, 0.08),
  },
  sectionIconWrap: {
    width: 26, height: 26, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 12.5, fontWeight: '800', color: C.greenDeep,
    letterSpacing: 0.6, textTransform: 'uppercase',
  },

  rowItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: withAlpha(C.green, 0.07),
    gap: 14,
  },
  rowIcon: {
    width: 38, height: 38, borderRadius: 19,
    justifyContent: 'center', alignItems: 'center',
  },
  rowLabel: { fontSize: 14.5, fontWeight: '600', color: C.headingDark },
  rowSubtitle: { fontSize: 12, color: C.textBody, marginTop: 2 },

  quickGrid: { flexDirection: 'row', paddingBottom: 4 },
  quickTile: {
    alignItems: 'center', paddingVertical: 8, gap: 8,
    flex: 1,
  },
  quickIcon: {
    width: 52, height: 52, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  quickLabel: { fontSize: 11, fontWeight: '600', color: C.textBody, textAlign: 'center', lineHeight: 15 },

  schemeBanner: {
    flexDirection: 'row', alignItems: 'center',
    gap: 14, paddingHorizontal: 20, paddingVertical: 18,
    borderRadius: 20, marginBottom: 14,
    shadowColor: C.shadowGreen, shadowOpacity: 0.20, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  schemeIconWrap: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  schemesTitle: { fontSize: 15, fontWeight: '800', color: COLORS.white },
  schemesSub: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 3 },

  sellerBanner: {
    flexDirection: 'row', alignItems: 'center',
    gap: 14, paddingHorizontal: 20, paddingVertical: 18,
    borderRadius: 20, marginBottom: 14,
    shadowColor: COLORS.cta, shadowOpacity: 0.18, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  sellerIconWrap: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  sellerTitle: { fontSize: 15, fontWeight: '800', color: COLORS.white },
  sellerSub: { fontSize: 12, color: 'rgba(255,255,255,0.9)', marginTop: 3 },
  bannerArrow: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },

  logoutBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.white, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 16,
    gap: 12, marginBottom: 8,
    borderWidth: 1.5, borderColor: withAlpha(D.red, 0.15),
    shadowColor: D.red, shadowOpacity: 0.06, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  logoutIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: withAlpha(D.red, 0.10),
    justifyContent: 'center', alignItems: 'center',
  },
  logoutLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: D.red },

  version: { textAlign: 'center', fontSize: 12, color: C.textHint, marginTop: 12, marginBottom: 8 },

  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },

  // Centered confirmation popup (logout, etc.)
  confirmBackdrop: {
    flex: 1, backgroundColor: C.overlay,
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  confirmCard: {
    width: '100%', maxWidth: 360,
    backgroundColor: C.white, borderRadius: 24,
    paddingHorizontal: 24, paddingTop: 24, paddingBottom: 20,
    alignItems: 'center',
    shadowColor: C.shadowGreen, shadowOpacity: 0.18, shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  confirmIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: withAlpha(D.red, 0.12),
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  confirmTitle: { fontSize: 19, fontWeight: '800', color: C.headingDark, marginBottom: 6, textAlign: 'center' },
  confirmMsg: { fontSize: 14, color: C.textBody, textAlign: 'center', lineHeight: 20, marginBottom: 22 },
  confirmBtnRow: { flexDirection: 'row', gap: 12, width: '100%' },
  confirmBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  confirmCancel: { backgroundColor: C.chipBg },
  confirmCancelTxt: { fontSize: 15, fontWeight: '700', color: C.headingDark },
  confirmDanger: { backgroundColor: D.red },
  confirmDangerTxt: { fontSize: 15, fontWeight: '800', color: COLORS.white },
  editKav: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  editSheet: {
    backgroundColor: C.white,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 22, paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 22,
    maxHeight: '88%',
  },
  editHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  editScroll: { flexGrow: 0 },
  sheetHandle: {
    width: 40, height: 4, backgroundColor: C.borderMed,
    borderRadius: 2, alignSelf: 'center', marginBottom: 14,
  },
  sheetTitle: { fontSize: 19, fontWeight: '800', color: C.headingDark },
  fieldGroup: { marginBottom: 14 },
  fieldLabel: { fontSize: 12.5, fontWeight: '700', color: C.textBody, marginBottom: 6, marginLeft: 2 },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: C.inputBorder,
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: C.inputBg,
    gap: 10,
  },
  fieldIconWrap: {
    width: 32, height: 32, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  fieldInput: { flex: 1, fontSize: 15, color: C.headingDark, padding: 0 },
  saveBtn: { borderRadius: 16, overflow: 'hidden', marginTop: 12 },
  saveBtnGrad: { paddingVertical: 16, alignItems: 'center', borderRadius: 16 },
  saveBtnTxt: { color: COLORS.white, fontSize: 16, fontWeight: '800' },

  langSheet: {
    backgroundColor: C.white,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, paddingBottom: 40,
  },
  langOption: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16,
    borderRadius: 14, marginBottom: 10,
    backgroundColor: C.inputBg, borderWidth: 1.5, borderColor: C.inputBorder,
  },

  stateSheet: {
    backgroundColor: C.white,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '85%',
  },
  regionHeader: {
    fontSize: 11, fontWeight: '700', color: C.textBody,
    letterSpacing: 0.8, textTransform: 'uppercase',
    paddingHorizontal: 4, paddingTop: 14, paddingBottom: 6,
  },
  stateOption: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 14, marginBottom: 6,
    backgroundColor: C.inputBg, borderWidth: 1.5, borderColor: C.inputBorder,
  },
  stateName: { fontSize: 15, fontWeight: '600', color: C.headingDark },
  stateNative: { fontSize: 12, color: C.textHint, marginTop: 1 },
  stateLangBadge: {
    fontSize: 11, fontWeight: '700', color: C.textBody,
    backgroundColor: withAlpha(C.green, 0.06), borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
  },
});

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Switch, Alert, Modal, TextInput, Linking,
  Image, ImageBackground, ActivityIndicator, Platform, Animated, ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import { useLanguage } from '../../context/LanguageContext';
import { getStatesByRegion, REGION_ORDER } from '../../i18n/stateMappings';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { compressImage } from '../../utils/mediaCompressor';
import { safeOpenURL } from '../../utils/sanitize';
import { API_BASE_URL } from '../../constants/config';
import { EntrySlide, D } from '../../components/ui/ImmersiveKit';
import { COLORS } from '../../constants/colors';
import { KHET, KFONT, KSHADOW } from '../../constants/khetTheme';
import AnimatedScreen from '../../components/ui/AnimatedScreen';
import Svg, { Circle, Defs, RadialGradient as SvgRadialGradient, Stop, Path } from 'react-native-svg';

// Same hero artwork the Login screen uses — rendered blurred behind the profile
// body (everything below the edit-profile hero) for a cohesive branded backdrop.
const HERO = require('../../../assets/khet/welcome-hero.jpg');

// The dedicated Krushi Seva Kendra onboarding website is served same-origin by
// the backend at /kendra. Derive it from the API base (strip the /api/v1 suffix)
// so it always points at whichever backend this build talks to.
const KENDRA_PORTAL_URL = API_BASE_URL.replace(/\/api\/v1\/?$/, '') + '/kendra';

function HeroBgDecoration() {
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      <Svg width="100%" height="100%" style={{ position: 'absolute' }}>
        <Defs>
          <SvgRadialGradient id="glow1" cx="80%" cy="20%" r="50%">
            <Stop offset="0%" stopColor="#fff" stopOpacity="0.12" />
            <Stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </SvgRadialGradient>
          <SvgRadialGradient id="glow2" cx="20%" cy="80%" r="40%">
            <Stop offset="0%" stopColor="#fff" stopOpacity="0.08" />
            <Stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </SvgRadialGradient>
        </Defs>
        <Circle cx="85%" cy="15%" r="80" fill="url(#glow1)" />
        <Circle cx="15%" cy="85%" r="60" fill="url(#glow2)" />
        <Circle cx="50%" cy="50%" r="120" fill="rgba(255,255,255,0.03)" />
        <Path d="M0,120 Q60,80 120,120 T240,120" stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none" />
        <Path d="M40,60 Q100,20 160,60 T280,60" stroke="rgba(255,255,255,0.04)" strokeWidth="1" fill="none" />
      </Svg>
    </View>
  );
}

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
  const color = iconColor || KHET.primary;
  return (
    <View style={S.sectionHeader}>
      <View style={[S.sectionIconWrap, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon || 'ellipse'} size={icon ? 14 : 6} color={color} />
      </View>
      <Text style={S.sectionTitle}>{title}</Text>
    </View>
  );
}

function RowItem({ icon, iconColor, label, subtitle, onPress, showArrow = true, rightElement, isLast }) {
  const color = iconColor || KHET.primary;
  return (
    <TouchableOpacity
      style={[S.rowItem, isLast && { borderBottomWidth: 0 }]}
      onPress={onPress}
      activeOpacity={0.6}
      disabled={!onPress}
      // Only collapse into a single a11y node for interactive rows; display rows
      // (and rows hosting a Switch) stay un-grouped so their controls/text remain
      // independently reachable by screen readers.
      accessible={onPress ? true : undefined}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? [label, subtitle].filter(Boolean).join(', ') : undefined}
    >
      <View style={[S.rowIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={S.rowLabel}>{label}</Text>
        {subtitle ? <Text style={S.rowSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {rightElement || (showArrow && (
        <Ionicons name="chevron-forward" size={18} color={KHET.mutedForeground} />
      ))}
    </TouchableOpacity>
  );
}

function QuickTile({ icon, label, color, onPress, index = 0 }) {
  return (
    <EntrySlide delay={index * 80} fromY={20} style={{ flex: 1 }}>
      <TouchableOpacity style={S.quickTile} onPress={onPress} activeOpacity={0.7}>
        <View style={[S.quickIcon, { backgroundColor: color + '18' }]}>
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
  const [email,       setEmail]       = useState('');
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
    setEmail(user?.email || '');
    setStatusQuote(user?.statusQuote || '');
    setDistrict(user?.district || '');
    setCity(user?.city || '');
    setPincode(user?.pincode || '');
  }, [visible, user]);

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert(t('product.error'), t('profile.nameEmpty')); return; }
    // Email is optional; only validate format when the user actually typed one.
    // Empty string is sent through to clear it server-side (stored as NULL).
    const emailTrim = email.trim();
    if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      Alert.alert(t('product.error'), t('profile.emailInvalid', 'Enter a valid email address'));
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.put('/users/me', { name, email: emailTrim, statusQuote, district, city, pincode });
      onSaved(data.data);
    } catch (e) {
      Alert.alert(t('product.error'), e?.response?.data?.error?.message || t('profile.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  const FIELDS = [
    { key: 'name',     label: t('profile.fullName', 'Full name'),        icon: 'person-outline',              color: KHET.primary, value: name,        setter: setName,        placeholder: t('profile.fullNamePlaceholder'), maxLen: 80  },
    { key: 'email',    label: t('profile.email'),                        icon: 'mail-outline',                color: D.blue,         value: email,       setter: setEmail,       placeholder: t('profile.emailPlaceholder', 'you@example.com'), maxLen: 200, keyboard: 'email-address', autoCap: 'none' },
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
              <Ionicons name="close" size={22} color={KHET.mutedForeground} />
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
                  <View style={[S.fieldIconWrap, { backgroundColor: f.color + '18' }]}>
                    <Ionicons name={f.icon} size={16} color={f.color} />
                  </View>
                  <TextInput
                    style={S.fieldInput}
                    value={f.value}
                    onChangeText={f.setter}
                    placeholder={f.placeholder}
                    placeholderTextColor={KHET.mutedForeground}
                    maxLength={f.maxLen}
                    keyboardType={f.keyboard || 'default'}
                    autoCapitalize={f.autoCap || 'sentences'}
                    autoCorrect={f.autoCap !== 'none'}
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
              colors={KHET.gradPrimary}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={S.saveBtnGrad}
            >
              {saving
                ? <ActivityIndicator color={KHET.primaryForeground} />
                : <Text style={S.saveBtnTxt}>{t('profile.saveChanges')}</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const STAT_CONFIGS = [
  // `route` makes each cell tappable; `ctaKey` is the friendly call-to-action
  // label shown (in place of the plain count label) when the stat is still zero.
  { key: 'animalListings', labelKey: 'profile.animals', icon: 'paw-outline',       color: D.amber, route: 'MyAnimalListings', ctaKey: 'profile.statListAnimals' },
  { key: 'orders',         labelKey: 'profile.orders',  icon: 'cart-outline',      color: D.green, route: 'MyOrders',          ctaKey: 'profile.statShopNow' },
  // Rentals = machinery + labour listings the user has created (value computed in render)
  { key: 'rentListings',   labelKey: 'profile.rentals', icon: 'construct-outline', color: D.cyan,  route: 'MyRentListings',    ctaKey: 'profile.statListRentals' },
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

  // ── Trust / verification badges (derived from existing role + KYC data) ──────
  const kycVerified = user?.kycStatus === 'VERIFIED' || !!user?.sellerProfile?.kycVerifiedAt;
  const trustBadges = [];
  if (kycVerified) {
    trustBadges.push({ key: 'verified', icon: 'shield-checkmark', label: t('profile.badgeVerified', 'Verified'), verified: true });
  } else if (isSeller && user?.kycStatus === 'PENDING') {
    trustBadges.push({ key: 'kyc', icon: 'time-outline', label: t('profile.badgeKycPending', 'KYC pending') });
  }
  trustBadges.push(
    isSeller
      ? { key: 'seller', icon: 'storefront', label: t('profile.badgeSeller', 'Seller') }
      : { key: 'farmer', icon: 'leaf',       label: t('profile.badgeFarmer', 'Farmer') }
  );

  return (
    <AnimatedScreen style={[S.root]}>
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
            {/* Same welcome-hero artwork the Login screen uses, with the shared
                gradHero scrim (transparent → deep green) so the white hero text
                stays legible over the photo. */}
            <Image source={HERO} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <LinearGradient
              colors={KHET.gradHero}
              locations={KHET.gradHeroLocs}
              start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <HeroBgDecoration />

            <View style={S.heroContent}>
              <TouchableOpacity
                style={S.avatarWrap}
                onPress={handlePhotoPress}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('profile.a11yChangePhoto', 'Change profile photo')}
                accessibilityHint={t('profile.a11yChangePhotoHint', 'Opens your photo library')}
              >
                <View style={S.avatarHalo}>
                  <View style={S.avatarRing}>
                    {user?.avatar ? (
                      <Image
                        source={{ uri: avatarBust ? `${user.avatar}${user.avatar.includes('?') ? '&' : '?'}v=${avatarBust}` : user.avatar }}
                        style={S.avatarImg}
                      />
                    ) : (
                      <LinearGradient
                        colors={['rgba(255,255,255,0.35)', 'rgba(255,255,255,0.15)']}
                        style={S.avatar}
                      >
                        <Text style={S.avatarTxt}>{initials}</Text>
                      </LinearGradient>
                    )}
                  </View>
                </View>
                <View style={S.cameraBtn}>
                  {uploadingPhoto
                    ? <ActivityIndicator size="small" color={KHET.white} />
                    : <Ionicons name="camera" size={12} color={KHET.white} />}
                </View>
              </TouchableOpacity>

              <Text style={S.heroName}>{user?.name || 'Farmer'}</Text>

              {trustBadges.length > 0 && (
                <View style={S.heroBadgeRow}>
                  {trustBadges.map((b) => (
                    <View
                      key={b.key}
                      style={[S.heroBadge, b.verified && S.heroBadgeVerified]}
                      accessible
                      accessibilityRole="text"
                      accessibilityLabel={b.label}
                    >
                      <Ionicons name={b.icon} size={11} color={b.verified ? KHET.primary : KHET.white} />
                      <Text style={[S.heroBadgeTxt, b.verified && S.heroBadgeTxtVerified]}>{b.label}</Text>
                    </View>
                  ))}
                </View>
              )}

              {(user?.phone || user?.city || user?.district) && (
                <View style={S.heroMetaRow}>
                  {user?.phone && (
                    <View style={S.heroMetaPill}>
                      <Ionicons name="call" size={11} color="rgba(255,255,255,0.9)" />
                      <Text style={S.heroMetaTxt}>{user.phone}</Text>
                    </View>
                  )}
                  {(user?.city || user?.district) && (
                    <View style={S.heroMetaPill}>
                      <Ionicons name="location" size={11} color="rgba(255,255,255,0.9)" />
                      <Text style={S.heroMetaTxt} numberOfLines={1}>{[user?.city, user?.district].filter(Boolean).join(', ')}</Text>
                    </View>
                  )}
                </View>
              )}
              {user?.statusQuote ? (
                <View style={S.quoteWrap}>
                  <Text style={S.heroQuote}>"{user.statusQuote}"</Text>
                </View>
              ) : null}

              <View style={S.heroActions}>
                <TouchableOpacity
                  style={S.editBtn}
                  onPress={() => setShowEditModal(true)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={t('editProfile')}
                >
                  <Ionicons name="create-outline" size={14} color={KHET.white} />
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
          {/* Login-screen hero artwork, blurred, behind the body content.
              Subtle overlay keeps the foreground cards/text readable. */}
          <View style={S.bodyBg} pointerEvents="none">
            <ImageBackground source={HERO} style={StyleSheet.absoluteFill} resizeMode="cover">
              <BlurView intensity={50} tint="light" style={StyleSheet.absoluteFill} />
              <View style={S.bodyBgOverlay} />
            </ImageBackground>
          </View>

          <View style={S.bodyContent}>
          <EntrySlide delay={0} fromY={20}>
            <View style={S.statsCard}>
              {STAT_CONFIGS.map((stat, i) => {
                const value  = stat.key === 'rentListings' ? rentListingCount : (counts[stat.key] ?? 0);
                const isZero = value === 0;
                return (
                  <TouchableOpacity
                    key={stat.key}
                    style={[S.statCell, i < STAT_CONFIGS.length - 1 && S.statCellBorder]}
                    onPress={() => navigation.navigate(stat.route)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`${value} ${t(stat.labelKey)}`}
                  >
                    <View style={[S.statIcon, { backgroundColor: stat.color + '16' }]}>
                      <Ionicons name={stat.icon} size={20} color={stat.color} />
                    </View>
                    <Text style={S.statValue}>{value}</Text>
                    {/* Zero → a friendly CTA in place of the plain count label. */}
                    <Text style={[S.statLabel, isZero && S.statLabelCta]} numberOfLines={1}>
                      {isZero ? t(stat.ctaKey) : t(stat.labelKey)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </EntrySlide>

          <SectionCard delay={60}>
            <SectionHeader title={t('profile.quickActions')} icon="flash-outline" iconColor={D.gold} />
            <View style={S.quickGrid}>
              <QuickTile index={0} icon="leaf"     label="My Farms"               color={COLORS.primary} onPress={() => navigation.navigate('FarmList')} />
              <QuickTile index={1} icon="cart"     label={t('myOrders')}          color={D.green}  onPress={() => navigation.navigate('MyOrders')} />
              <QuickTile index={2} icon="paw"      label={t('profile.myListings')} color={D.amber}  onPress={() => navigation.navigate('MyAnimalListings')} />
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
                  trackColor={{ false: KHET.border, true: KHET.primary + '70' }}
                  thumbColor={notifications ? KHET.primary : KHET.white}
                />
              }
            />
            <RowItem icon="shield-checkmark-outline" iconColor={D.purple} label={t('profile.privacyCenter')} subtitle={t('profile.privacySub')} onPress={() => Alert.alert(t('profile.privacyCenter'), 'Your data is securely stored and never shared with third parties. We follow industry-standard encryption and privacy practices.')} isLast />
          </SectionCard>

          <SectionCard delay={180}>
            <SectionHeader title={t('personalInfo')} icon="person-outline" iconColor={D.blue} />
            <RowItem icon="call-outline"     iconColor={D.green}  label={t('profile.mobileNumber')} subtitle={user?.phone || '—'}                                  showArrow={false} />
            <RowItem icon="mail-outline"     iconColor={D.blue}   label={t('profile.email')}         subtitle={user?.email || t('profile.notAddedYet')}             onPress={() => setShowEditModal(true)} />
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

          {user?.farmDetail ? (
            <SectionCard delay={300}>
              <SectionHeader title={t('farmDetails')} icon="leaf-outline" iconColor={D.green} />
              <RowItem icon="resize-outline" iconColor={D.green}  label={t('profile.totalLand')}  subtitle={user.farmDetail.landAcres ? t('profile.landAcres', { acres: user.farmDetail.landAcres }) : '—'} showArrow={false} />
              <RowItem icon="layers-outline" iconColor={D.amber}  label={t('profile.soilType')}   subtitle={user.farmDetail.soilType || '—'}       showArrow={false} />
              <RowItem icon="water-outline"  iconColor={D.cyan}   label={t('profile.irrigation')} subtitle={user.farmDetail.irrigationType || '—'} showArrow={false} />
              <RowItem icon="flower-outline" iconColor={COLORS.primary}   label={t('profile.mainCrops')}  subtitle={(user.farmDetail.cropTypes || []).join(', ') || '—'} showArrow={false} isLast />
            </SectionCard>
          ) : (
            <SectionCard delay={300}>
              <SectionHeader title={t('farmDetails')} icon="leaf-outline" iconColor={D.green} />
              <RowItem
                icon="add-circle-outline" iconColor={D.green}
                label={t('profile.addFarmDetails', 'Add your farm details')}
                subtitle={t('profile.addFarmDetailsSub', 'Tell us about your land & crops')}
                onPress={() => navigation.navigate('FarmList')}
                isLast
              />
            </SectionCard>
          )}

          <EntrySlide delay={360} fromY={16}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => navigation.navigate('AIAssistant', { screen: 'Scheme' })}
              accessibilityRole="button"
              accessibilityLabel={`${t('profile.schemesTitle')}. ${t('profile.schemesSub')}`}
            >
              <LinearGradient
                colors={KHET.gradPrimary}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={S.schemeBanner}
              >
                <View style={S.schemeIconWrap}>
                  <Ionicons name="ribbon" size={22} color={KHET.white} />
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
              accessibilityRole="button"
              accessibilityLabel={isSeller
                ? t('profile.sellerDashboardTitle', 'Seller Dashboard')
                : t('profile.becomeSellerTitle', 'Become a Seller')}
            >
              <LinearGradient
                colors={['#E65100', '#F57C00', '#FF9800']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={S.sellerBanner}
              >
                <View style={S.sellerIconWrap}>
                  <Ionicons name={isSeller ? 'storefront' : 'add-circle'} size={22} color={COLORS.white} />
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

          {/* Krushi Seva Kendra portal — opens the dedicated onboarding website.
              Farmers forward this to their local agri-input dealer (Kendra), who
              registers there with a licence and then receives crop reports. */}
          <EntrySlide delay={510} fromY={16}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => safeOpenURL(KENDRA_PORTAL_URL)}
              accessibilityRole="button"
              accessibilityLabel={t('profile.kendraPortalTitle', 'Are you a Krushi Seva Kendra?')}
            >
              <LinearGradient
                colors={['#14532d', '#15803d', '#22c55e']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={S.sellerBanner}
              >
                <View style={S.sellerIconWrap}>
                  <Ionicons name="leaf" size={22} color={COLORS.white} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.sellerTitle}>{t('profile.kendraPortalTitle', 'Are you a Krushi Seva Kendra?')}</Text>
                  <Text style={S.sellerSub}>{t('profile.kendraPortalSub', 'Register your shop to receive farmers’ crop reports')}</Text>
                </View>
                <View style={S.bannerArrow}>
                  <Ionicons name="open-outline" size={16} color={COLORS.white} />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </EntrySlide>

          <EntrySlide delay={540} fromY={16}>
            <TouchableOpacity
              style={S.logoutBtn}
              onPress={handleLogout}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('logout')}
            >
              <View style={S.logoutIconWrap}>
                <Ionicons name="log-out-outline" size={18} color={KHET.destructive} />
              </View>
              <Text style={S.logoutLabel}>{t('logout')}</Text>
              <Ionicons name="chevron-forward" size={16} color={KHET.destructive + '80'} />
            </TouchableOpacity>
          </EntrySlide>

          <Text style={S.version}>{t('profile.versionText')}</Text>
          <View style={{ height: 40 }} />
          </View>
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
              <Ionicons name="globe-outline" size={22} color={KHET.primary} />
              <Text style={{ fontSize: 17, fontFamily: KFONT.displaySemi, color: KHET.foreground, flex: 1, letterSpacing: -0.3 }}>
                {t('profile.selectState')}
              </Text>
              <TouchableOpacity onPress={() => { setShowStateModal(false); setShowLangModal(true); }}>
                <Text style={{ fontSize: 12, color: KHET.primary, fontFamily: KFONT.sansSemi }}>{t('profile.manualLang')}</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12, color: KHET.mutedForeground, fontFamily: KFONT.sans, marginBottom: 16, paddingHorizontal: 4 }}>
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
                          style={[S.stateOption, isSelected && { borderColor: KHET.primary, backgroundColor: KHET.accent }]}
                          onPress={() => { setLanguageByState(state.name); setShowStateModal(false); }}
                          activeOpacity={0.75}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={[S.stateName, isSelected && { color: KHET.primary }]}>{state.name}</Text>
                            {state.nativeName ? (
                              <Text style={S.stateNative}>{state.nativeName}</Text>
                            ) : null}
                          </View>
                          <Text style={S.stateLangBadge}>{state.lang.toUpperCase()}</Text>
                          {isSelected && <Ionicons name="checkmark-circle" size={20} color={KHET.primary} style={{ marginLeft: 6 }} />}
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
              <Ionicons name="language" size={22} color={KHET.primary} />
              <Text style={{ fontSize: 15, fontFamily: KFONT.displaySemi, color: KHET.foreground, flex: 1, letterSpacing: -0.3 }}>
                Choose Language / भाषा चुनें / भाषा निवडा
              </Text>
            </View>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[S.langOption, language === lang.code && { borderColor: KHET.primary, backgroundColor: KHET.accent }]}
                onPress={() => { setLanguage(lang.code); setShowLangModal(false); }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 28 }}>{lang.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[{ fontSize: 16, fontFamily: KFONT.sansSemi, color: KHET.foreground }, language === lang.code && { color: KHET.primary }]}>
                    {lang.name}
                  </Text>
                  <Text style={{ fontSize: 13, color: KHET.mutedForeground, fontFamily: KFONT.sans, marginTop: 2 }}>{lang.nativeName}{lang.region ? `  ·  ${lang.region}` : ''}</Text>
                </View>
                {language === lang.code && <Ionicons name="checkmark-circle" size={22} color={KHET.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </AnimatedScreen>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: KHET.background },

  hero: {
    paddingTop: Platform.OS === 'android' ? 52 : 52,
    paddingBottom: 30, paddingHorizontal: 24, overflow: 'hidden',
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    // Deep-green fallback shown until the hero photo finishes loading.
    backgroundColor: KHET.primary,
  },
  heroContent: {
    alignItems: 'center', position: 'relative', zIndex: 1,
  },

  avatarWrap: { position: 'relative', marginBottom: 16 },
  // Soft outer halo gives the avatar a premium double-ring without a new asset.
  avatarHalo: {
    width: 112, height: 112, borderRadius: 56, padding: 5,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarRing: {
    width: 98, height: 98, borderRadius: 49,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.65)',
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  avatar: {
    width: '100%', height: '100%',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarTxt: { fontSize: 34, fontFamily: KFONT.displayBold, color: KHET.white },
  cameraBtn: {
    position: 'absolute', bottom: 6, right: 6,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: KHET.primaryGlow,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2.5, borderColor: KHET.white,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },

  heroName: {
    fontSize: 25, fontFamily: KFONT.displayBold, color: KHET.primaryForeground,
    textAlign: 'center', marginBottom: 2, letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.2)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },

  // Phone + location as matching frosted pills on one centered row.
  heroMetaRow: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
    gap: 6, marginTop: 4, marginBottom: 6,
  },
  heroMetaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12,
    paddingHorizontal: 11, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
    maxWidth: '80%',
  },
  heroMetaTxt: { fontSize: 12, color: 'rgba(255,255,255,0.92)', fontFamily: KFONT.sansMed },

  quoteWrap: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 7,
    marginBottom: 4, marginTop: 4, maxWidth: '92%',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  heroQuote: { fontSize: 13, color: 'rgba(255,255,255,0.92)', fontFamily: KFONT.displayItalic, fontStyle: 'italic', textAlign: 'center', lineHeight: 18 },
  heroActions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', marginTop: 16,
  },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  editBtnTxt: { fontSize: 13, fontFamily: KFONT.sansSemi, color: KHET.white },
  memberSince: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontFamily: KFONT.displayItalic, fontStyle: 'italic' },

  // Trust / verification badges below the hero name. Translucent white pills keep
  // them readable on the green gradient; the "verified" chip flips to a solid
  // light fill with green text so it reads as the primary trust signal.
  heroBadgeRow: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
    gap: 6, marginTop: 6, marginBottom: 8,
  },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 11, paddingHorizontal: 9, paddingVertical: 3.5,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
  },
  heroBadgeTxt: { fontSize: 11, color: KHET.white, fontFamily: KFONT.sansSemi, letterSpacing: 0.2 },
  heroBadgeVerified: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderColor: 'rgba(255,255,255,0.95)',
  },
  heroBadgeTxtVerified: { color: KHET.primary, fontFamily: KFONT.sansBold },

  body: { marginTop: -12, position: 'relative' },
  // Blurred Login hero artwork behind the body; absolute so it fills the
  // full width edge-to-edge regardless of the content's horizontal padding.
  bodyBg: { ...StyleSheet.absoluteFillObject },
  // Soft scrim so the (light-tinted blurred) image keeps cards/text readable.
  bodyBgOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: KHET.background + 'CC' },
  bodyContent: { paddingHorizontal: 16 },

  statsCard: {
    flexDirection: 'row', backgroundColor: KHET.card,
    borderRadius: 20, paddingVertical: 20, paddingHorizontal: 8,
    borderWidth: 1, borderColor: KHET.border,
    ...KSHADOW.soft,
    marginBottom: 16,
  },
  statCell: { flex: 1, alignItems: 'center', gap: 6 },
  statCellBorder: { borderRightWidth: 1, borderRightColor: KHET.border },
  statIcon: {
    width: 44, height: 44, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center', marginBottom: 2,
  },
  statValue: { fontSize: 22, fontFamily: KFONT.displayBold, color: KHET.foreground },
  statLabel: { fontSize: 11, color: KHET.mutedForeground, fontFamily: KFONT.sansSemi },
  // Zero-state CTA colour for a stat label (e.g. "List animals" instead of "Animals").
  statLabelCta: { color: KHET.primary, fontFamily: KFONT.sansBold },

  sectionCard: {
    backgroundColor: KHET.card, borderRadius: 20,
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4,
    marginBottom: 12,
    borderWidth: 1, borderColor: KHET.border,
    ...KSHADOW.soft,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 6, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: KHET.border,
  },
  sectionIconWrap: {
    width: 26, height: 26, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 12.5, fontFamily: KFONT.sansBold, color: KHET.mutedForeground,
    letterSpacing: 0.8, textTransform: 'uppercase',
  },

  rowItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: KHET.border,
    gap: 14,
  },
  rowIcon: {
    width: 38, height: 38, borderRadius: 19,
    justifyContent: 'center', alignItems: 'center',
  },
  rowLabel: { fontSize: 14.5, fontFamily: KFONT.sansSemi, color: KHET.foreground },
  rowSubtitle: { fontSize: 12, color: KHET.mutedForeground, fontFamily: KFONT.sans, marginTop: 2 },

  quickGrid: { flexDirection: 'row', paddingBottom: 4 },
  quickTile: {
    alignItems: 'center', paddingVertical: 8, gap: 8,
    flex: 1,
  },
  quickIcon: {
    width: 52, height: 52, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  quickLabel: { fontSize: 11, fontFamily: KFONT.sansMed, color: KHET.foreground, textAlign: 'center', lineHeight: 15 },

  schemeBanner: {
    flexDirection: 'row', alignItems: 'center',
    gap: 14, paddingHorizontal: 20, paddingVertical: 18,
    borderRadius: 20, marginBottom: 14,
    ...KSHADOW.elegant,
  },
  schemeIconWrap: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  schemesTitle: { fontSize: 16, fontFamily: KFONT.displaySemi, color: KHET.white, letterSpacing: -0.3 },
  schemesSub: { fontSize: 12, color: 'rgba(255,255,255,0.85)', fontFamily: KFONT.sans, marginTop: 3 },

  // Mirrors schemeBanner exactly (same metrics + shadow) so the two banners
  // read as the same size; only the gradient colour differs.
  sellerBanner: {
    flexDirection: 'row', alignItems: 'center',
    gap: 14, paddingHorizontal: 20, paddingVertical: 18,
    borderRadius: 20, marginBottom: 14,
    ...KSHADOW.elegant,
  },
  sellerIconWrap: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  sellerTitle: { fontSize: 16, fontFamily: KFONT.displaySemi, color: KHET.white, letterSpacing: -0.3 },
  sellerSub: { fontSize: 12, color: 'rgba(255,255,255,0.85)', fontFamily: KFONT.sans, marginTop: 3 },
  bannerArrow: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },

  logoutBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: KHET.card, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 16,
    gap: 12, marginBottom: 8,
    borderWidth: 1, borderColor: KHET.destructive + '33',
    ...KSHADOW.soft,
  },
  logoutIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: KHET.destructive + '14',
    justifyContent: 'center', alignItems: 'center',
  },
  logoutLabel: { flex: 1, fontSize: 15, fontFamily: KFONT.sansBold, color: KHET.destructive },

  version: { textAlign: 'center', fontSize: 12, color: KHET.mutedForeground, fontFamily: KFONT.sans, marginTop: 12, marginBottom: 8 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },

  // Centered confirmation popup (logout, etc.)
  confirmBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  confirmCard: {
    width: '100%', maxWidth: 360,
    backgroundColor: KHET.card, borderRadius: 24,
    paddingHorizontal: 24, paddingTop: 24, paddingBottom: 20,
    alignItems: 'center',
    borderWidth: 1, borderColor: KHET.border,
    ...KSHADOW.elegant,
  },
  confirmIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: KHET.destructive + '14',
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  confirmTitle: { fontSize: 20, fontFamily: KFONT.displaySemi, color: KHET.foreground, marginBottom: 6, textAlign: 'center', letterSpacing: -0.3 },
  confirmMsg: { fontSize: 14, color: KHET.mutedForeground, fontFamily: KFONT.sans, textAlign: 'center', lineHeight: 20, marginBottom: 22 },
  confirmBtnRow: { flexDirection: 'row', gap: 12, width: '100%' },
  confirmBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  confirmCancel: { backgroundColor: KHET.muted, borderWidth: 1, borderColor: KHET.border },
  confirmCancelTxt: { fontSize: 15, fontFamily: KFONT.sansSemi, color: KHET.foreground },
  confirmDanger: { backgroundColor: KHET.destructive },
  confirmDangerTxt: { fontSize: 15, fontFamily: KFONT.sansBold, color: KHET.white },
  editKav: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  editSheet: {
    backgroundColor: KHET.card,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 22, paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 22,
    maxHeight: '88%',
  },
  editHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  editScroll: { flexGrow: 0 },
  sheetHandle: {
    width: 40, height: 4, backgroundColor: KHET.border,
    borderRadius: 2, alignSelf: 'center', marginBottom: 14,
  },
  sheetTitle: { fontSize: 20, fontFamily: KFONT.displaySemi, color: KHET.foreground, letterSpacing: -0.3 },
  fieldGroup: { marginBottom: 14 },
  fieldLabel: { fontSize: 11, fontFamily: KFONT.sansBold, color: KHET.mutedForeground, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginLeft: 2 },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: KHET.border,
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: KHET.card,
    gap: 10,
    ...KSHADOW.soft,
  },
  fieldIconWrap: {
    width: 32, height: 32, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  fieldInput: { flex: 1, fontSize: 15, color: KHET.foreground, fontFamily: KFONT.sansMed, padding: 0 },
  saveBtn: { borderRadius: 16, overflow: 'hidden', marginTop: 12, ...KSHADOW.elegant },
  saveBtnGrad: { paddingVertical: 16, alignItems: 'center', borderRadius: 16 },
  saveBtnTxt: { color: KHET.primaryForeground, fontSize: 16, fontFamily: KFONT.sansSemi },

  langSheet: {
    backgroundColor: KHET.card,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, paddingBottom: 40,
  },
  langOption: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16,
    borderRadius: 16, marginBottom: 10,
    backgroundColor: KHET.card, borderWidth: 1, borderColor: KHET.border,
    ...KSHADOW.soft,
  },

  stateSheet: {
    backgroundColor: KHET.card,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '85%',
  },
  regionHeader: {
    fontSize: 11, fontFamily: KFONT.sansBold, color: KHET.mutedForeground,
    letterSpacing: 1, textTransform: 'uppercase',
    paddingHorizontal: 4, paddingTop: 14, paddingBottom: 6,
  },
  stateOption: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 16, marginBottom: 6,
    backgroundColor: KHET.card, borderWidth: 1, borderColor: KHET.border,
    ...KSHADOW.soft,
  },
  stateName: { fontSize: 15, fontFamily: KFONT.sansSemi, color: KHET.foreground },
  stateNative: { fontSize: 12, color: KHET.mutedForeground, fontFamily: KFONT.sans, marginTop: 1 },
  stateLangBadge: {
    fontSize: 11, fontFamily: KFONT.sansBold, color: KHET.accentForeground,
    backgroundColor: KHET.accent, borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
  },
});

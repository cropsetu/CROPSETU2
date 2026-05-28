import { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Switch, Alert, Modal, TextInput, Linking,
  Image, ActivityIndicator, Platform, Animated, ScrollView,
} from 'react-native';
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
import Svg, { Circle, Defs, RadialGradient as SvgRadialGradient, Stop, Path } from 'react-native-svg';

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
      style={[S.rowItem, isLast && { borderBottomWidth: 0, marginBottom: 0, paddingBottom: 4 }]}
      onPress={onPress}
      activeOpacity={0.65}
    >
      <LinearGradient
        colors={[color + '14', color + '08']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={S.rowIcon}
      >
        <Ionicons name={icon} size={19} color={color} />
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <Text style={S.rowLabel}>{label}</Text>
        {subtitle ? <Text style={S.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {rightElement || (showArrow && (
        <View style={S.rowArrow}>
          <Ionicons name="chevron-forward" size={16} color={D.textFaint} />
        </View>
      ))}
    </TouchableOpacity>
  );
}

function QuickTile({ icon, label, color, onPress, index = 0 }) {
  return (
    <EntrySlide delay={index * 80} fromY={20} style={{ flex: 1 }}>
      <TouchableOpacity style={S.quickTile} onPress={onPress} activeOpacity={0.7}>
        <LinearGradient
          colors={[color + '18', color + '0A']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={S.quickIcon}
        >
          <Ionicons name={icon} size={24} color={color} />
        </LinearGradient>
        <Text style={S.quickLabel} numberOfLines={2}>{label}</Text>
      </TouchableOpacity>
    </EntrySlide>
  );
}

function EditProfileModal({ visible, user, onClose, onSaved }) {
  const { t } = useLanguage();
  const [name,        setName]        = useState(user?.name || '');
  const [statusQuote, setStatusQuote] = useState(user?.statusQuote || '');
  const [district,    setDistrict]    = useState(user?.district || '');
  const [city,        setCity]        = useState(user?.city || '');
  const [pincode,     setPincode]     = useState(user?.pincode || '');
  const [saving,      setSaving]      = useState(false);

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
    { icon: 'person-outline',             color: COLORS.primary,   value: name,        setter: setName,        placeholder: t('profile.fullNamePlaceholder'), maxLen: 80  },
    { icon: 'chatbubble-ellipses-outline', color: D.cyan,  value: statusQuote, setter: setStatusQuote, placeholder: t('profile.statusPlaceholder'),   maxLen: 200 },
    { icon: 'business-outline',           color: D.green,  value: district,    setter: setDistrict,    placeholder: t('profile.districtPlaceholder'), maxLen: 100 },
    { icon: 'location-outline',           color: D.amber,  value: city,        setter: setCity,        placeholder: t('profile.cityPlaceholder'),     maxLen: 100 },
    { icon: 'pin-outline',                color: D.gold,   value: pincode,     setter: setPincode,     placeholder: t('profile.pincodePlaceholder'),  maxLen: 6, keyboard: 'numeric' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={S.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={S.editSheet}>
          <View style={S.sheetHandle} />
          <Text style={S.sheetTitle}>{t('editProfile')}</Text>
          {FIELDS.map((f) => (
            <View key={f.placeholder} style={S.fieldRow}>
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
          ))}
          <TouchableOpacity
            style={[S.saveBtn, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <LinearGradient
              colors={[COLORS.primary, COLORS.primaryMedium]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={S.saveBtnGrad}
            >
              {saving
                ? <ActivityIndicator color={COLORS.white} />
                : <Text style={S.saveBtnTxt}>{t('profile.saveChanges')}</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const STAT_CONFIGS = [
  { key: 'animalListings', labelKey: 'profile.animals', icon: 'paw-outline',       color: D.amber },
  { key: 'orders',         labelKey: 'profile.orders',  icon: 'cart-outline',      color: D.green },
  { key: 'bookings',       labelKey: 'profile.rentals', icon: 'construct-outline', color: D.cyan },
];

export default function ProfileScreen({ navigation }) {
  const { user, updateUser, logout } = useAuth();
  const { t, language, setLanguage, setLanguageByState, selectedState, LANGUAGES } = useLanguage();

  const [notifications,   setNotifications]  = useState(true);
  const [showLangModal,   setShowLangModal]  = useState(false);
  const [showStateModal,  setShowStateModal] = useState(false);
  const [showEditModal,   setShowEditModal]  = useState(false);
  const [uploadingPhoto, setUploadingPhoto]  = useState(false);
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
      formData.append('file', {
        uri: Platform.OS === 'android' ? compressedUri : compressedUri.replace('file://', ''),
        name: 'avatar.jpg',
        type: 'image/jpeg',
      });

      const { data } = await api.put('/users/me', formData);

      if (data.data?.avatar) {
        updateUser({ avatar: data.data.avatar });
      } else {
        Alert.alert(t('profile.uploadFailed'), 'Server did not return an avatar URL. Please try again.');
      }
    } catch (err) {
      if (__DEV__) console.warn('[Profile] Upload error:', err.message, err.response?.status);
      const msg = err.response?.data?.error?.message || t('profile.uploadFailedMsg') || 'Upload failed. Try again.';
      Alert.alert(t('profile.uploadFailed') || 'Upload Failed', msg);
    } finally {
      setUploadingPhoto(false);
    }
  }, [updateUser]);

  const handleLogout = () => {
    Alert.alert(t('logout'), t('logoutConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('logout'), style: 'destructive', onPress: logout },
    ]);
  };

  const counts      = user?._count || {};
  const currentLang = LANGUAGES.find((l) => l.code === language);

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
          <LinearGradient
            colors={['#0A3D26', COLORS.primary, '#2D9B63', '#3DAA74']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={S.hero}
          >
            <HeroBgDecoration />

            <View style={S.heroContent}>
              <TouchableOpacity style={S.avatarWrap} onPress={handlePhotoPress} activeOpacity={0.8}>
                <View style={S.avatarRing}>
                  {user?.avatar ? (
                    <Image source={{ uri: user.avatar }} style={S.avatarImg} />
                  ) : (
                    <LinearGradient
                      colors={['rgba(255,255,255,0.35)', 'rgba(255,255,255,0.15)']}
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

              <Text style={S.heroName}>{user?.name || 'Farmer'}</Text>
              {user?.phone && <Text style={S.heroPhone}>{user.phone}</Text>}
              {(user?.city || user?.district) && (
                <View style={S.locRow}>
                  <Ionicons name="location" size={12} color="rgba(255,255,255,0.85)" />
                  <Text style={S.heroLoc}>{[user?.city, user?.district].filter(Boolean).join(', ')}</Text>
                </View>
              )}
              {user?.statusQuote ? (
                <View style={S.quoteWrap}>
                  <Text style={S.heroQuote}>"{user.statusQuote}"</Text>
                </View>
              ) : null}

              <View style={S.heroActions}>
                <TouchableOpacity style={S.editBtn} onPress={() => setShowEditModal(true)} activeOpacity={0.75}>
                  <Ionicons name="create-outline" size={14} color={COLORS.white} />
                  <Text style={S.editBtnTxt}>{t('editProfile')}</Text>
                </TouchableOpacity>
                <Text style={S.memberSince}>
                  {t('memberSince')} {user?.createdAt ? new Date(user.createdAt).getFullYear() : '—'}
                </Text>
              </View>
            </View>
          </LinearGradient>
        </Animated.View>

        <View style={S.body}>
          <EntrySlide delay={0} fromY={20}>
            <View style={S.statsCard}>
              {STAT_CONFIGS.map((stat, i) => (
                <View key={stat.key} style={[S.statCell, i < STAT_CONFIGS.length - 1 && S.statCellBorder]}>
                  <LinearGradient
                    colors={[stat.color + '20', stat.color + '08']}
                    style={S.statIcon}
                  >
                    <Ionicons name={stat.icon} size={20} color={stat.color} />
                  </LinearGradient>
                  <Text style={S.statValue}>{counts[stat.key] ?? 0}</Text>
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
            <RowItem icon="person-circle-outline" iconColor={COLORS.primary}   label={t('editProfile')}              subtitle={t('profile.nameQuoteAddress')}                                  onPress={() => setShowEditModal(true)} />
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
            <RowItem icon="construct-outline" iconColor={D.cyan}  label={t('myRentListings')}            subtitle={t('profile.bookingsCount', { count: counts.bookings || 0 })}         onPress={() => navigation.navigate('MyRentListings')} isLast />
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
                colors={[COLORS.primary, COLORS.primaryMedium, COLORS.primaryLight]}
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
  root: { flex: 1, backgroundColor: '#F0F4ED' },

  hero: {
    paddingTop: Platform.OS === 'android' ? 52 : 52,
    paddingBottom: 32, paddingHorizontal: 24, overflow: 'hidden',
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
  },
  heroContent: {
    alignItems: 'center', position: 'relative', zIndex: 1,
  },

  avatarWrap: { position: 'relative', marginBottom: 14 },
  avatarRing: {
    width: 96, height: 96, borderRadius: 48,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.5)',
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 8,
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
    backgroundColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2.5, borderColor: COLORS.white,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },

  heroName: {
    fontSize: 22, fontWeight: '900', color: COLORS.white,
    textAlign: 'center', marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.2)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  heroPhone: {
    fontSize: 14, color: 'rgba(255,255,255,0.9)', fontWeight: '500',
    marginBottom: 6, textAlign: 'center',
  },
  locRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6,
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  heroLoc: { fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: '500' },
  quoteWrap: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6,
    marginBottom: 4, marginTop: 2,
  },
  heroQuote: { fontSize: 12, color: 'rgba(255,255,255,0.85)', fontStyle: 'italic', textAlign: 'center' },
  heroActions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', marginTop: 14,
  },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  editBtnTxt: { fontSize: 13, fontWeight: '700', color: COLORS.white },
  memberSince: { fontSize: 12, color: 'rgba(255,255,255,0.65)', fontStyle: 'italic' },

  body: { paddingHorizontal: 16, marginTop: -12 },

  statsCard: {
    flexDirection: 'row', backgroundColor: COLORS.white,
    borderRadius: 20, paddingVertical: 20, paddingHorizontal: 8,
    shadowColor: COLORS.primary, shadowOpacity: 0.08, shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
    marginBottom: 16,
  },
  statCell: { flex: 1, alignItems: 'center', gap: 6 },
  statCellBorder: { borderRightWidth: 1, borderRightColor: 'rgba(0,0,0,0.06)' },
  statIcon: {
    width: 44, height: 44, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center', marginBottom: 2,
  },
  statValue: { fontSize: 22, fontWeight: '900', color: D.text },
  statLabel: { fontSize: 11, color: D.textDim, fontWeight: '600' },

  sectionCard: {
    backgroundColor: COLORS.white, borderRadius: 20,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
    marginBottom: 14,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.04)',
  },
  sectionIconWrap: {
    width: 28, height: 28, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 13, fontWeight: '800', color: D.textDim,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },

  rowItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.04)',
    gap: 12, marginBottom: 2,
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  rowLabel: { fontSize: 15, fontWeight: '600', color: D.text },
  rowSubtitle: { fontSize: 12, color: D.textDim, marginTop: 2 },
  rowArrow: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.03)',
    justifyContent: 'center', alignItems: 'center',
  },

  quickGrid: { flexDirection: 'row', paddingBottom: 4 },
  quickTile: {
    alignItems: 'center', paddingVertical: 8, gap: 8,
    flex: 1,
  },
  quickIcon: {
    width: 52, height: 52, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  quickLabel: { fontSize: 11, fontWeight: '600', color: D.textDim, textAlign: 'center', lineHeight: 15 },

  schemeBanner: {
    flexDirection: 'row', alignItems: 'center',
    gap: 14, paddingHorizontal: 20, paddingVertical: 18,
    borderRadius: 20, marginBottom: 14,
    shadowColor: COLORS.primary, shadowOpacity: 0.15, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
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
    shadowColor: '#E65100', shadowOpacity: 0.15, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
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
    backgroundColor: COLORS.white, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 16,
    gap: 12, marginBottom: 8,
    borderWidth: 1.5, borderColor: D.red + '15',
    shadowColor: D.red, shadowOpacity: 0.06, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  logoutIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: D.red + '10',
    justifyContent: 'center', alignItems: 'center',
  },
  logoutLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: D.red },

  version: { textAlign: 'center', fontSize: 12, color: D.textFaint, marginTop: 12, marginBottom: 8 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  editSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  sheetHandle: {
    width: 40, height: 4, backgroundColor: COLORS.slateLight,
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: D.text, marginBottom: 20, textAlign: 'center' },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12,
    marginBottom: 10, backgroundColor: '#F8FAF7',
    gap: 10,
  },
  fieldIconWrap: {
    width: 32, height: 32, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  fieldInput: { flex: 1, fontSize: 15, color: D.text },
  saveBtn: { borderRadius: 16, overflow: 'hidden', marginTop: 8 },
  saveBtnGrad: { paddingVertical: 16, alignItems: 'center', borderRadius: 16 },
  saveBtnTxt: { color: COLORS.white, fontSize: 16, fontWeight: '800' },

  langSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, paddingBottom: 40,
  },
  langOption: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16,
    borderRadius: 14, marginBottom: 10,
    backgroundColor: '#F8FAF7', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.06)',
  },

  stateSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '85%',
  },
  regionHeader: {
    fontSize: 11, fontWeight: '700', color: D.textDim,
    letterSpacing: 0.8, textTransform: 'uppercase',
    paddingHorizontal: 4, paddingTop: 14, paddingBottom: 6,
  },
  stateOption: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 14, marginBottom: 6,
    backgroundColor: '#F8FAF7', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  stateName: { fontSize: 15, fontWeight: '600', color: D.text },
  stateNative: { fontSize: 12, color: D.textFaint, marginTop: 1 },
  stateLangBadge: {
    fontSize: 11, fontWeight: '700', color: D.textFaint,
    backgroundColor: 'rgba(0,0,0,0.04)', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
  },
});

import React, { useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, Linking, Alert, Image, Animated, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SHADOWS } from '../../constants/colors';
import { useLanguage } from '../../context/LanguageContext';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const { width: W } = Dimensions.get('window');
const HERO_H = 300;

function InfoRow({ icon, label, value }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={18} color={COLORS.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

export default function AnimalDetail({ route, navigation }) {
  const { listing } = route.params;
  const { t } = useLanguage();
  const scrollY   = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;

  const imageUrl = listing.images && listing.images[0] ? listing.images[0] : null;

  useEffect(() => {
    Animated.timing(contentAnim, {
      toValue: 1, duration: 450, delay: 120, useNativeDriver: true,
    }).start();
  }, []);

  const contentOpacity = contentAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const contentY       = contentAnim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] });

  // Hero parallax
  const heroScale = scrollY.interpolate({ inputRange: [-60, 0, HERO_H], outputRange: [1.2, 1, 0.88], extrapolate: 'clamp' });

  const handleCall = () => {
    Linking.openURL(`tel:${listing.sellerPhone}`).catch(() =>
      Alert.alert(t('product.error'), t('animalDetail.phoneError'))
    );
  };

  const handleChat = () => {
    navigation.navigate('Chat', {
      listingId: listing.id,
      sellerName: listing.sellerName,
      sellerId: listing.id,
    });
  };

  return (
    <AnimatedScreen>
    <View style={styles.container}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      >

        {/* Hero Image */}
        <View style={styles.heroWrap}>
          <Animated.View style={[styles.heroInner, { transform: [{ scale: heroScale }] }]}>
            {imageUrl
              ? <Image source={{ uri: imageUrl }} style={styles.heroImg} resizeMode="cover" />
              : (
                <View style={[styles.heroImg, styles.heroFallback]}>
                  <Ionicons name="paw" size={90} color={COLORS.primary + '60'} />
                </View>
              )
            }
          </Animated.View>

          {/* Gradient overlay */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.55)']}
            style={styles.heroGradient}
            pointerEvents="none"
          />

          {/* Top nav */}
          <SafeAreaView style={styles.heroNav}>
            <TouchableOpacity style={styles.navBtn} onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={22} color={COLORS.white} />
            </TouchableOpacity>
            <View style={styles.navRight}>
              <TouchableOpacity style={styles.navBtn}>
                <Ionicons name="heart-outline" size={22} color={COLORS.white} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.navBtn}>
                <Ionicons name="share-social-outline" size={22} color={COLORS.white} />
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          {/* Bottom badges on image */}
          <View style={styles.heroBadges}>
            {listing.verified && (
              <View style={styles.verifiedBadge}>
                <Ionicons name="shield-checkmark" size={12} color={COLORS.white} />
                <Text style={styles.verifiedText}>{t('animalDetail.sellerVerified')}</Text>
              </View>
            )}
          </View>
        </View>

        <Animated.View style={[styles.content, { opacity: contentOpacity, transform: [{ translateY: contentY }] }]}>
          {/* Title & Price */}
          <View style={styles.titleRow}>
            <View>
              <Text style={styles.animalName}>{listing.animal} - {listing.breed}</Text>
              <Text style={styles.animalNameHi}>{listing.animalHi}</Text>
            </View>
            <Text style={styles.price}>₹{listing.price.toLocaleString()}</Text>
          </View>

          {/* Tags */}
          <View style={styles.tagsRow}>
            {listing.tags.map((tag, i) => (
              <View key={i} style={styles.tag}>
                <Ionicons name="checkmark-circle" size={12} color={COLORS.primary} />
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>

          {/* Animal Details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('animalDetail.animalDetails')}</Text>
            <View style={styles.detailsGrid}>
              <InfoRow icon="male-female" label={t('gender')} value={listing.gender} />
              <InfoRow icon="time" label={t('age')} value={listing.age} />
              <InfoRow icon="barbell" label={t('weight')} value={listing.weight} />
              {listing.milkYield !== 'N/A' && (
                <InfoRow icon="water" label={t('milkYield')} value={listing.milkYield} />
              )}
              <InfoRow icon="medkit" label={t('vaccinated')} value={listing.vaccinated ? t('animalDetail.yes') : t('animalDetail.notMentioned')} />
            </View>
          </View>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('product.productDescription')}</Text>
            <Text style={styles.description}>{listing.description}</Text>
          </View>

          {/* Seller Info */}
          <View style={styles.sellerCard}>
            <Text style={styles.sectionTitle}>{t('animalDetail.sellerInfo')}</Text>
            <View style={styles.sellerInfo}>
              <View style={styles.sellerAvatar}>
                <Text style={styles.sellerAvatarText}>{listing.sellerAvatar}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sellerName}>{listing.sellerName}</Text>
                <View style={styles.locationRow}>
                  <Ionicons name="location" size={14} color={COLORS.textLight} />
                  <Text style={styles.locationText}>{listing.sellerLocation}</Text>
                </View>
                <Text style={styles.postedDate}>{t('animalDetail.postedDate', { date: listing.postedDate })}</Text>
              </View>
              {listing.verified && (
                <View style={styles.verifiedSmall}>
                  <Ionicons name="shield-checkmark" size={16} color={COLORS.success} />
                </View>
              )}
            </View>
          </View>

          {/* Safety Tips */}
          <View style={styles.tipsCard}>
            <Ionicons name="warning" size={18} color={COLORS.warning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.tipsTitle}>{t('safetyTips')}</Text>
              <Text style={styles.tipsText}>{t('animalDetail.safetyTipsText')}</Text>
            </View>
          </View>
        </Animated.View>
      </Animated.ScrollView>

      {/* Bottom Action Buttons */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.callBtn} onPress={handleCall}>
          <Ionicons name="call" size={20} color={COLORS.primary} />
          <Text style={styles.callBtnText}>{t('callSeller')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.chatBtn} onPress={handleChat}>
          <LinearGradient colors={[COLORS.primary, COLORS.greenDeep]} style={styles.chatGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
            <Ionicons name="chatbubbles" size={20} color={COLORS.white} />
            <Text style={styles.chatBtnText}>{t('chatWithSeller')}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
    </AnimatedScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  // ── Hero ──
  heroWrap:    { height: HERO_H, position: 'relative', overflow: 'hidden' },
  heroInner:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  heroImg:     { width: '100%', height: '100%' },
  heroFallback:{ backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' },
  heroGradient:{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '70%' },

  heroNav: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8,
  },
  navRight: { flexDirection: 'row', gap: 8 },
  navBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center', alignItems: 'center',
  },
  heroBadges: { position: 'absolute', bottom: 16, left: 16, flexDirection: 'row', gap: 8 },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.success, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  verifiedText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },

  content: { padding: 20, backgroundColor: COLORS.background, marginTop: -20, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  animalName: { fontSize: 22, fontWeight: '800', color: COLORS.textDark },
  animalNameHi: { fontSize: 16, color: COLORS.textMedium, fontWeight: '600', marginTop: 4 },
  price: { fontSize: 24, fontWeight: '900', color: COLORS.primary },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.primaryPale, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  tagText: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },

  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: COLORS.textDark, marginBottom: 14 },
  detailsGrid: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 4, ...SHADOWS.small },
  infoRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  infoIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: COLORS.primaryPale, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  infoLabel: { fontSize: 12, color: COLORS.textLight, fontWeight: '500' },
  infoValue: { fontSize: 15, color: COLORS.textDark, fontWeight: '700', marginTop: 2 },

  description: { fontSize: 15, color: COLORS.textMedium, lineHeight: 24 },

  sellerCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 16, ...SHADOWS.small },
  sellerInfo: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  sellerAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
  sellerAvatarText: { fontSize: 18, fontWeight: '800', color: COLORS.textWhite },
  sellerName: { fontSize: 17, fontWeight: '700', color: COLORS.textDark },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  locationText: { fontSize: 13, color: COLORS.textLight },
  postedDate: { fontSize: 12, color: COLORS.textLight, marginTop: 4 },
  verifiedSmall: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.greenPale, justifyContent: 'center', alignItems: 'center' },

  tipsCard: { flexDirection: 'row', gap: 12, backgroundColor: COLORS.yellowWarm, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.warning + '60' },
  tipsTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textDark, marginBottom: 8 },
  tipsText: { fontSize: 13, color: COLORS.textMedium, lineHeight: 22 },

  bottomBar: {
    flexDirection: 'row', padding: 16, gap: 12,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1, borderTopColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.06, shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 }, elevation: 6,
  },
  callBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderWidth: 2, borderColor: COLORS.primary, borderRadius: 14, paddingVertical: 14,
  },
  callBtnText: { fontSize: 15, fontWeight: '700', color: COLORS.primary },
  chatBtn: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  chatGradient: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 14,
  },
  chatBtnText: { fontSize: 15, fontWeight: '700', color: COLORS.white },
});

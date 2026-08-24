/**
 * AnimalDetail — one listing.
 *
 * The screen used to render whatever object the list handed it through
 * navigation params and never contact the server again, so it could show a
 * listing that had been marked sold or edited minutes earlier, and its "Call
 * Seller" button read `listing.sellerPhone` — a field the list endpoint has
 * never returned, so the call silently failed.
 *
 * Now the params carry an id plus an optional lightweight preview: the preview
 * paints the screen instantly (no spinner on a field connection) and the
 * authoritative row replaces it as soon as it arrives. The phone number is not
 * in that row at all — it comes from an explicit, authenticated reveal, so a
 * seller's number is only handed out when a buyer deliberately asks for it.
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, Alert, Image, Animated, Dimensions, Share,
  ActivityIndicator, Modal, Pressable,
} from 'react-native';
import { safeOpenURL, sanitizePhone } from '../../utils/sanitize';
import { fs } from '../../utils/responsive';
import { formatLocation } from '../../utils/location';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SHADOWS } from '@krushisarva/shared/constants/colors';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import { useAuth } from '@krushisarva/shared/context/AuthContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AnimatedScreen from '@krushisarva/shared/components/ui/AnimatedScreen';
import PhotoIcon from '../../components/PhotoIcon';
import AnimalIcon from '../../components/AnimalIcons';
import { SkeletonDetail } from '../../components/ui/Skeleton';
import api from '@krushisarva/shared/services/api';
import { useLocation } from '../../context/LocationContext';
import { classifyError, ERROR_CODES } from '../../utils/apiError';
import { invalidateFocusData } from '../../hooks/useFocusRefresh';

const { width: W } = Dimensions.get('window');
const HERO_H = 300;

const REPORT_REASONS = [
  { key: 'ALREADY_SOLD',  tKey: 'animal.reportSold',    fallback: 'Already sold' },
  { key: 'FRAUD',         tKey: 'animal.reportFraud',   fallback: 'Looks like a scam' },
  { key: 'WRONG_DETAILS', tKey: 'animal.reportWrong',   fallback: 'Wrong details or photos' },
  { key: 'ABUSIVE',       tKey: 'animal.reportAbusive', fallback: 'Rude or abusive seller' },
  { key: 'SPAM',          tKey: 'animal.reportSpam',    fallback: 'Spam' },
  { key: 'OTHER',         tKey: 'animal.reportOther',   fallback: 'Something else' },
];

/**
 * A relative "posted 3 days ago" label. Mock listings ship a ready-made
 * `postedDate`; API listings carry an ISO `createdAt`.
 */
function formatPostedDate(listing) {
  if (listing.postedDate) return listing.postedDate;
  const iso = listing.createdAt || listing.updatedAt;
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1)  return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7)  return `${days} days ago`;
  if (days < 30) { const w = Math.floor(days / 7); return `${w} week${w > 1 ? 's' : ''} ago`; }
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function InfoRow({ icon, label, value, last }) {
  return (
    <View style={[styles.infoRow, last && { borderBottomWidth: 0 }]}>
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

// Hero image with a graceful fallback: when a (valid) URL fails to load at
// runtime — CDN unreachable, stale asset, flaky network — RN's <Image> renders
// an empty/blank box and never recovers. We track onError per-slide and swap in
// the AnimalIcon placeholder so the hero is never a silent white screen.
function HeroImage({ uri, fallbackType, scale }) {
  const [failed, setFailed] = useState(false);
  return (
    <Animated.View style={[styles.heroInner, scale ? { transform: [{ scale }] } : null]}>
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={styles.heroImg}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={[styles.heroImg, styles.heroFallback]}>
          <PhotoIcon set="animal" name={fallbackType || 'Cow'} size={140} radius={0}
            fallback={<AnimalIcon type={fallbackType || 'Cow'} size={140} />} />
        </View>
      )}
    </Animated.View>
  );
}

// Compact stat card for the key-highlights strip under the title.
function HighlightCard({ icon, label, value }) {
  return (
    <View style={styles.hlCard}>
      <View style={styles.hlIcon}>
        <Ionicons name={icon} size={18} color={COLORS.primary} />
      </View>
      <Text style={styles.hlValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.hlLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/** Status pill: available / sold / expired. */
function StatusPill({ status, expired, t }) {
  if (expired) {
    return (
      <View style={[styles.statusPill, { backgroundColor: COLORS.warning }]}>
        <Text style={styles.statusPillTxt}>{t('animal.expired', 'Expired')}</Text>
      </View>
    );
  }
  if (status === 'SOLD') {
    return (
      <View style={[styles.statusPill, { backgroundColor: COLORS.error }]}>
        <Text style={styles.statusPillTxt}>{t('animal.sold', 'SOLD')}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.statusPill, { backgroundColor: COLORS.success }]}>
      <Text style={styles.statusPillTxt}>{t('animal.available', 'Available')}</Text>
    </View>
  );
}

export default function AnimalDetail({ route, navigation }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { coords } = useLocation();
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;

  // Accept both shapes: the new { listingId, preview } and the legacy
  // { listing } that older screens (and any queued deep link) still send.
  const params = route.params || {};
  const listingId = params.listingId || params.listing?.id || null;
  const [listing, setListing] = useState(params.preview || params.listing || null);
  const [loading, setLoading] = useState(!listing);
  const [error, setError] = useState(null);
  const [similar, setSimilar] = useState([]);

  // Contact reveal
  const [contact, setContact] = useState(null);
  const [revealing, setRevealing] = useState(false);

  // Report / block
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState(false);

  const [galIdx, setGalIdx] = useState(0);
  const [favourite, setFavourite] = useState(false);

  const isOwner = !!(user?.id && listing?.sellerId && user.id === listing.sellerId);

  // ── Load the authoritative row ──────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!listingId) { setLoading(false); return; }
    setError(null);
    try {
      const { data } = await api.get(`/animals/${listingId}`, {
        // Distance is computed server-side from these and returned coarsened;
        // the seller's own coordinates never come back.
        params: coords ? { lat: coords.latitude, lng: coords.longitude } : undefined,
      });
      setListing(data?.data || null);
    } catch (e) {
      const classified = classifyError(e, t('animalDetail.loadFailed', 'Could not load this listing.'));
      if (classified.code === ERROR_CODES.CANCELED) return;
      // A preview is already on screen — keep it and show the problem quietly
      // instead of replacing a readable listing with an error page.
      setError(classified);
    } finally {
      setLoading(false);
    }
  }, [listingId, coords, t]);

  useEffect(() => { load(); }, [load]);

  // Similar nearby animals — best effort, never blocks the screen.
  useEffect(() => {
    if (!listingId) return undefined;
    let alive = true;
    api.get(`/animals/${listingId}/similar`, {
      params: { limit: 6, ...(coords ? { lat: coords.latitude, lng: coords.longitude } : {}) },
    })
      .then(({ data }) => { if (alive) setSimilar(data?.data || []); })
      .catch(() => { /* the section just does not render */ });
    return () => { alive = false; };
  }, [listingId, coords?.latitude, coords?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Animated.timing(contentAnim, {
      toValue: 1, duration: 450, delay: 120, useNativeDriver: true,
    }).start();
  }, [contentAnim]);

  if (loading && !listing) {
    // Only reached with no preview in the params; the hero height is pinned to
    // the real one so the photo does not jump when the row lands.
    return (
      <View style={styles.container}>
        <SkeletonDetail heroH={HERO_H} chips={3} paragraphs={4} label={t('loading')} />
      </View>
    );
  }

  if (!listing) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="alert-circle-outline" size={48} color={COLORS.error} />
        <Text style={styles.errorTxt}>{error?.message || t('animalDetail.notFound', 'This listing is no longer available.')}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => navigation.goBack()} accessibilityRole="button">
          <Text style={styles.retryTxt}>{t('back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Normalise to a clean array of real remote URLs; guard against null / stray
  // non-URL entries so a bad value can't blank the hero.
  const images = Array.isArray(listing.images)
    ? listing.images.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    : [];
  const fallbackType = listing.animal || listing.animalType || listing.category || 'Cow';
  const postedLabel = formatPostedDate(listing);
  const sellerLocation = formatLocation(listing.sellerLocation);
  const hasMilk = listing.milkYield && listing.milkYield !== 'N/A';
  const expired = !!(listing.expiresAt && new Date(listing.expiresAt) < new Date());

  const sellerName = listing.seller?.name || listing.sellerName || t('animalDetail.seller', 'Seller');
  const sellerAvatarRaw = listing.seller?.avatar || listing.sellerAvatarUrl || null;
  const sellerAvatarUri = typeof sellerAvatarRaw === 'string' && /^https?:\/\//i.test(sellerAvatarRaw) ? sellerAvatarRaw : null;
  const sellerInitials = (!sellerAvatarUri && listing.sellerAvatar)
    ? listing.sellerAvatar
    : (sellerName.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'S');

  // Verification comes from the SERVER's `verification` block, never from a
  // client-set flag. `verified` alone is kept for pre-upgrade payloads.
  const verification = listing.verification || { listingVerified: !!listing.verified, level: listing.verified ? 'VERIFIED' : 'UNVERIFIED' };

  const highlights = [
    listing.age    ? { icon: 'time-outline',        label: t('age'),       value: listing.age }       : null,
    listing.weight ? { icon: 'barbell-outline',     label: t('weight'),    value: listing.weight }    : null,
    hasMilk        ? { icon: 'water-outline',       label: t('milkYield'), value: listing.milkYield } : null,
    listing.gender ? { icon: 'male-female-outline', label: t('gender'),    value: listing.gender }    : null,
  ].filter(Boolean).slice(0, 3);

  const contentOpacity = contentAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const contentY       = contentAnim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] });
  const heroScale = scrollY.interpolate({ inputRange: [-60, 0, HERO_H], outputRange: [1.2, 1, 0.88], extrapolate: 'clamp' });

  /**
   * Fetch the seller's number, then dial. Two steps on purpose: the number is
   * not in the listing payload at all, so it cannot be scraped — it is released
   * per-buyer, rate limited, and audited.
   */
  const handleCall = async () => {
    if (revealing) return;
    if (!user?.id) {
      Alert.alert(t('animalDetail.signInTitle', 'Sign in to call'),
        t('animalDetail.signInToCall', 'Please sign in so the seller knows who is calling.'));
      return;
    }
    setRevealing(true);
    try {
      const phone = contact?.phone || (await api.get(`/animals/${listing.id}/contact`)).data?.data?.phone;
      if (!phone) throw new Error('no phone');
      setContact({ phone });
      const ok = await safeOpenURL(`tel:${sanitizePhone(phone)}`);
      if (!ok) Alert.alert(t('product.error'), t('animalDetail.phoneError'));
    } catch (e) {
      const classified = classifyError(e, t('animalDetail.phoneError'));
      Alert.alert(t('product.error'), classified.message);
    } finally {
      setRevealing(false);
    }
  };

  const handleShare = async () => {
    const title = `${listing.animal || ''}${listing.breed ? ' - ' + listing.breed : ''}`.trim() || t('animalDetail.seller', 'Listing');
    const priceLabel = listing.price ? `₹${Number(listing.price).toLocaleString('en-IN')}` : '';
    const message = [title, priceLabel && `Price: ${priceLabel}`, sellerLocation && `Location: ${sellerLocation}`]
      .filter(Boolean)
      .join('\n');
    try {
      await Share.share({ title, message });
    } catch (e) {
      Alert.alert(t('product.error'), String(e?.message || e));
    }
  };

  const handleChat = () => {
    const listingTitle = `${listing.animal || ''}${listing.breed ? ' · ' + listing.breed : ''}`.trim() || null;
    navigation.navigate('Chat', {
      listingId: listing.id,
      peerName: listing.seller?.name || listing.sellerName || null,
      peerAvatar: sellerAvatarUri,
      peerId: listing.sellerId || listing.seller?.id,
      // Deliberately NOT passing a phone number: chat does not need one, and
      // the reveal is a separate, audited action.
      peerRole: 'seller',
      listingTitle,
    });
  };

  const handleEdit = () => navigation.navigate('AddAnimalListing', { listing });
  const handleViewInbox = () => navigation.navigate('MyAnimalChats');

  const submitReport = async (reason) => {
    setReporting(true);
    try {
      await api.post(`/animals/${listing.id}/report`, { reason });
      setReportOpen(false);
      Alert.alert(
        t('animal.reportThanksTitle', 'Thank you'),
        t('animal.reportThanks', 'Our team will look at this listing.'),
      );
    } catch (e) {
      Alert.alert(t('product.error'), classifyError(e, t('animal.reportFailed', 'Could not send the report.')).message);
    } finally {
      setReporting(false);
    }
  };

  const confirmBlock = () => {
    Alert.alert(
      t('animal.blockTitle', 'Block this seller?'),
      t('animal.blockBody', 'You will not see their animals or be able to message each other. You can undo this later.'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('animal.block', 'Block'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.post(`/animals/sellers/${listing.sellerId}/block`, {});
              invalidateFocusData('animals');
              navigation.goBack();
            } catch (e) {
              Alert.alert(t('product.error'), classifyError(e, t('animal.blockFailed', 'Could not block.')).message);
            }
          },
        },
      ],
    );
  };

  return (
    <AnimatedScreen>
      <View style={styles.container}>
        <Animated.ScrollView
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        >

          {/* Hero — swipeable gallery when >1 photo, otherwise a parallax hero. */}
          <View style={styles.heroWrap}>
            {images.length > 1 ? (
              <>
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(e) => setGalIdx(Math.round(e.nativeEvent.contentOffset.x / W))}
                >
                  {images.map((uri, i) => (
                    <View key={uri} style={{ width: W, height: HERO_H }}>
                      <HeroImage uri={uri} fallbackType={fallbackType} />
                    </View>
                  ))}
                </ScrollView>
                {/* Counter as well as dots: past ~6 photos the dots stop being
                    countable, and "3 / 9" is legible at any length. */}
                <View style={styles.heroCounter}>
                  <Ionicons name="images-outline" size={12} color={COLORS.white} />
                  <Text style={styles.heroCounterTxt}>{galIdx + 1} / {images.length}</Text>
                </View>
                <View style={styles.heroDots}>
                  {images.map((uri, i) => (
                    <View key={uri} style={[styles.heroDot, i === galIdx && styles.heroDotActive]} />
                  ))}
                </View>
              </>
            ) : (
              <HeroImage uri={images[0] || null} fallbackType={fallbackType} scale={heroScale} />
            )}

            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.55)']}
              style={styles.heroGradient}
              pointerEvents="none"
            />

            <SafeAreaView style={styles.heroNav}>
              <View style={styles.navRight}>
                <TouchableOpacity
                  style={styles.navBtn}
                  onPress={() => setFavourite((f) => !f)}
                  accessibilityRole="button"
                  accessibilityLabel={favourite ? t('animal.unfavourite', 'Remove from favourites') : t('animal.favourite', 'Add to favourites')}
                  accessibilityState={{ selected: favourite }}
                >
                  <Ionicons name={favourite ? 'heart' : 'heart-outline'} size={22} color={favourite ? COLORS.error : COLORS.white} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.navBtn}
                  onPress={handleShare}
                  accessibilityRole="button"
                  accessibilityLabel={t('share', 'Share')}
                >
                  <Ionicons name="share-social-outline" size={22} color={COLORS.white} />
                </TouchableOpacity>
              </View>
            </SafeAreaView>

            <View style={styles.heroBadges}>
              <StatusPill status={listing.status} expired={expired} t={t} />
              {verification.listingVerified && (
                <View style={styles.verifiedBadge}>
                  <Ionicons name="shield-checkmark" size={12} color={COLORS.white} />
                  <Text style={styles.verifiedText}>{t('animalDetail.sellerVerified')}</Text>
                </View>
              )}
            </View>
          </View>

          <Animated.View style={[styles.content, { opacity: contentOpacity, transform: [{ translateY: contentY }] }]}>
            {/* A background refresh failed but we still have something to show. */}
            {error ? (
              <View style={styles.staleBanner}>
                <Ionicons name="cloud-offline-outline" size={15} color={COLORS.textMedium} />
                <Text style={styles.staleTxt}>{error.message}</Text>
                <TouchableOpacity onPress={load} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.staleAction}>{t('retry', 'Retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Title & Price */}
            <View style={styles.titleRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.animalName}>{listing.animal}{listing.breed ? ` - ${listing.breed}` : ''}</Text>
                {listing.animalHi ? <Text style={styles.animalNameHi}>{listing.animalHi}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.price}>₹{Number(listing.price || 0).toLocaleString('en-IN')}</Text>
                {listing.negotiable ? (
                  <Text style={styles.negotiable}>{t('animal.negotiable', 'Negotiable')}</Text>
                ) : null}
              </View>
            </View>

            {/* Distance + posted-on strip */}
            <View style={styles.metaStrip}>
              {listing.distanceKm != null ? (
                <View style={styles.metaChip}>
                  <Ionicons name="navigate-outline" size={12} color={COLORS.primary} />
                  <Text style={styles.metaChipTxt}>
                    {t('animal.approxAway', '~{{km}} km away').replace('{{km}}', listing.distanceKm)}
                  </Text>
                </View>
              ) : null}
              {postedLabel ? (
                <View style={styles.metaChip}>
                  <Ionicons name="time-outline" size={12} color={COLORS.textMedium} />
                  <Text style={styles.metaChipTxt}>{t('animalDetail.postedDate', { date: postedLabel })}</Text>
                </View>
              ) : null}
            </View>

            {/* Key highlights */}
            {highlights.length > 0 && (
              <View style={styles.hlRow}>
                {highlights.map((h) => (
                  <HighlightCard key={h.label} icon={h.icon} label={h.label} value={h.value} />
                ))}
              </View>
            )}

            {/* Tags */}
            {listing.tags && listing.tags.length > 0 ? (
              <View style={styles.tagsRow}>
                {listing.tags.map((tag) => (
                  <View key={tag} style={styles.tag}>
                    <Ionicons name="checkmark-circle" size={12} color={COLORS.primary} />
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Animal Details */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('animalDetail.animalDetails')}</Text>
              <View style={styles.detailsGrid}>
                <InfoRow icon="male-female" label={t('gender')} value={listing.gender || t('animalDetail.notMentioned')} />
                <InfoRow icon="time" label={t('age')} value={listing.age || t('animalDetail.notMentioned')} />
                <InfoRow icon="barbell" label={t('weight')} value={listing.weight || t('animalDetail.notMentioned')} />
                {hasMilk && <InfoRow icon="water" label={t('milkYield')} value={listing.milkYield} />}
                {listing.pregnant != null && (
                  <InfoRow icon="heart-circle" label={t('animal.pregnant', 'Pregnant')} value={listing.pregnant ? t('animalDetail.yes') : t('no')} />
                )}
                {listing.lactating != null && (
                  <InfoRow icon="water-outline" label={t('animal.lactating', 'Lactating')} value={listing.lactating ? t('animalDetail.yes') : t('no')} />
                )}
                <InfoRow
                  icon="medkit"
                  label={t('vaccinated')}
                  value={listing.vaccinated ? t('animalDetail.yes') : t('animalDetail.notMentioned')}
                />
                <InfoRow
                  icon="document-text"
                  label={t('animal.healthCert', 'Health certificate')}
                  value={listing.healthCertificate ? t('animalDetail.yes') : t('animalDetail.notMentioned')}
                  last
                />
              </View>
            </View>

            {/* Description */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('product.productDescription')}</Text>
              <Text style={[styles.description, !listing.description && { fontStyle: 'italic', color: COLORS.textLight }]}>
                {listing.description || t('animalDetail.noDescription', 'The seller has not added a description yet.')}
              </Text>
            </View>

            {/* Seller Info */}
            <View style={styles.sellerCard}>
              <Text style={styles.sectionTitle}>{t('animalDetail.sellerInfo')}</Text>
              <View style={styles.sellerInfo}>
                <View style={styles.sellerAvatar}>
                  {sellerAvatarUri ? (
                    <Image source={{ uri: sellerAvatarUri }} style={styles.sellerAvatarImg} accessibilityLabel={sellerName} />
                  ) : (
                    <Text style={styles.sellerAvatarText}>{sellerInitials}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sellerName} numberOfLines={1}>{sellerName}</Text>
                  {sellerLocation ? (
                    <View style={styles.locationRow}>
                      <Ionicons name="location" size={13} color={COLORS.primary} />
                      <Text style={styles.locationText} numberOfLines={2}>{sellerLocation}</Text>
                    </View>
                  ) : null}
                  {listing.sellerListingCount != null ? (
                    <Text style={styles.sellerMeta}>
                      {t('animal.sellerListings', '{{n}} animals listed').replace('{{n}}', listing.sellerListingCount)}
                    </Text>
                  ) : null}
                </View>
                {verification.level !== 'UNVERIFIED' && (
                  <View style={styles.verifiedSmall} accessibilityLabel={t('animalDetail.sellerVerified')}>
                    <Ionicons name="shield-checkmark" size={16} color={COLORS.success} />
                  </View>
                )}
              </View>
            </View>

            {/* Similar nearby animals */}
            {similar.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('animal.similarNearby', 'Similar animals nearby')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.similarRow}>
                  {similar.map((s) => {
                    const thumb = (s.thumbnails?.[0]) || (s.images?.[0]) || null;
                    return (
                      <TouchableOpacity
                        key={s.id}
                        style={styles.similarCard}
                        onPress={() => navigation.push('AnimalDetail', { listingId: s.id, preview: s })}
                        accessibilityRole="button"
                        accessibilityLabel={`${s.breed} ${s.animal}, ₹${Number(s.price).toLocaleString('en-IN')}`}
                      >
                        {thumb
                          ? <Image source={{ uri: thumb }} style={styles.similarImg} />
                          : <View style={[styles.similarImg, styles.heroFallback]}><PhotoIcon set="animal" name={s.animal} size={60} radius={0} fallback={<AnimalIcon type={s.animal} size={60} />} /></View>}
                        <Text style={styles.similarName} numberOfLines={1}>{s.breed} {s.animal}</Text>
                        <Text style={styles.similarPrice}>₹{Number(s.price || 0).toLocaleString('en-IN')}</Text>
                        {s.distanceKm != null ? (
                          <Text style={styles.similarDist}>{s.distanceKm} km</Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            {/* Safety Tips */}
            <View style={styles.tipsCard}>
              <Ionicons name="warning" size={18} color={COLORS.warning} />
              <View style={{ flex: 1 }}>
                <Text style={styles.tipsTitle}>{t('safetyTips')}</Text>
                <Text style={styles.tipsText}>{t('animalDetail.safetyTipsText')}</Text>
              </View>
            </View>

            {/* Report / block — quiet, at the bottom, never competing with the
                primary actions, but always reachable. */}
            {!isOwner ? (
              <View style={styles.reportRow}>
                <TouchableOpacity style={styles.reportBtn} onPress={() => setReportOpen(true)} accessibilityRole="button">
                  <Ionicons name="flag-outline" size={15} color={COLORS.textMedium} />
                  <Text style={styles.reportTxt}>{t('animal.reportListing', 'Report listing')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.reportBtn} onPress={confirmBlock} accessibilityRole="button">
                  <Ionicons name="ban-outline" size={15} color={COLORS.textMedium} />
                  <Text style={styles.reportTxt}>{t('animal.blockSeller', 'Block seller')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Listing id + last update — what a farmer quotes to support. */}
            <Text style={styles.listingId}>
              {t('animal.listingId', 'Listing ID')}: {String(listing.id).slice(0, 8).toUpperCase()}
              {listing.updatedAt ? ` · ${t('animal.updated', 'Updated')} ${formatPostedDate({ createdAt: listing.updatedAt })}` : ''}
            </Text>
          </Animated.View>
        </Animated.ScrollView>

        {/* Bottom Action Buttons — owner sees Edit / Inbox; everyone else sees
            Call / Chat. Sold and expired listings offer neither. */}
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {isOwner ? (
            <>
              <TouchableOpacity style={styles.callBtn} onPress={handleEdit} accessibilityRole="button">
                <Ionicons name="create-outline" size={20} color={COLORS.primary} />
                <Text style={styles.callBtnText} numberOfLines={1}>{t('rent.editListing')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.chatBtn} onPress={handleViewInbox} accessibilityRole="button">
                <LinearGradient colors={[COLORS.primary, COLORS.greenDeep]} style={styles.chatGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  <Ionicons name="chatbubbles" size={20} color={COLORS.white} />
                  <Text style={styles.chatBtnText} numberOfLines={1}>{t('animalDetail.viewInbox')}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </>
          ) : listing.status === 'SOLD' || expired ? (
            <View style={styles.closedBar}>
              <Ionicons name="information-circle-outline" size={18} color={COLORS.textMedium} />
              <Text style={styles.closedTxt}>
                {listing.status === 'SOLD'
                  ? t('animal.soldNotice', 'This animal has been sold.')
                  : t('animal.expiredNotice', 'This listing has expired.')}
              </Text>
            </View>
          ) : (
            <>
              <TouchableOpacity style={styles.callBtn} onPress={handleCall} disabled={revealing} accessibilityRole="button">
                {revealing
                  ? <ActivityIndicator color={COLORS.primary} size="small" />
                  : <Ionicons name="call" size={20} color={COLORS.primary} />}
                <Text style={styles.callBtnText} numberOfLines={1}>{t('callSeller')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.chatBtn} onPress={handleChat} accessibilityRole="button">
                <LinearGradient colors={[COLORS.primary, COLORS.greenDeep]} style={styles.chatGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  <Ionicons name="chatbubbles" size={20} color={COLORS.white} />
                  <Text style={styles.chatBtnText} numberOfLines={1}>{t('chatWithSeller')}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Report reasons */}
        <Modal visible={reportOpen} transparent animationType="slide" onRequestClose={() => setReportOpen(false)}>
          <View style={styles.modalBackdrop}>
            <Pressable style={{ flex: 1 }} onPress={() => setReportOpen(false)} accessibilityLabel={t('cancel')} />
            <View style={[styles.reportSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <View style={styles.grabber} />
              <Text style={styles.reportTitle}>{t('animal.reportListing', 'Report listing')}</Text>
              <Text style={styles.reportSub}>{t('animal.reportSub', 'What is wrong with this listing?')}</Text>
              {REPORT_REASONS.map((r) => (
                <TouchableOpacity
                  key={r.key}
                  style={styles.reasonRow}
                  onPress={() => submitReport(r.key)}
                  disabled={reporting}
                  accessibilityRole="button"
                >
                  <Text style={styles.reasonTxt}>{t(r.tKey, r.fallback)}</Text>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textLight} />
                </TouchableOpacity>
              ))}
              {reporting ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 12 }} /> : null}
            </View>
          </View>
        </Modal>
      </View>
    </AnimatedScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center:    { justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  errorTxt:  { fontSize: 14, color: COLORS.error, textAlign: 'center' },
  retryBtn:  { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  retryTxt:  { color: COLORS.white, fontWeight: '700', fontSize: 15 },

  // ── Hero ──
  heroWrap:    { height: HERO_H, position: 'relative', overflow: 'hidden' },
  heroInner:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  heroImg:     { width: '100%', height: '100%' },
  heroFallback:{ backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' },
  heroGradient:{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '70%' },

  heroNav: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8,
  },
  navRight: { flexDirection: 'row', gap: 8 },
  navBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center', alignItems: 'center',
  },
  heroCounter: {
    position: 'absolute', top: 16, left: 16,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12,
    paddingHorizontal: 9, paddingVertical: 4,
  },
  heroCounterTxt: { color: COLORS.white, fontSize: 11.5, fontWeight: '700' },
  heroDots:     { position: 'absolute', bottom: 14, width: '100%', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  heroDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  heroDotActive:{ backgroundColor: COLORS.white, width: 20 },
  heroBadges:   { position: 'absolute', bottom: 16, left: 16, flexDirection: 'row', gap: 8, alignItems: 'center' },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.success, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  verifiedText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  statusPill:   { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  statusPillTxt:{ color: COLORS.white, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4 },

  content: { padding: 20, backgroundColor: COLORS.background, marginTop: -20, borderTopLeftRadius: 20, borderTopRightRadius: 20 },

  staleBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.surfaceRaised, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14,
  },
  staleTxt:    { flex: 1, fontSize: 12.5, color: COLORS.textMedium, fontWeight: '600' },
  staleAction: { fontSize: 12.5, fontWeight: '800', color: COLORS.primary },

  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  animalName: { fontSize: 22, fontWeight: '800', color: COLORS.textDark },
  animalNameHi: { fontSize: 16, color: COLORS.textMedium, fontWeight: '600', marginTop: 4 },
  price: { fontSize: 24, fontWeight: '900', color: COLORS.primary },
  negotiable: { fontSize: 12, color: COLORS.textMedium, fontWeight: '600', marginTop: 2 },

  metaStrip:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  metaChip:    { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  metaChipTxt: { fontSize: 12, color: COLORS.textMedium, fontWeight: '600' },

  hlRow:   { flexDirection: 'row', gap: 10, marginBottom: 20 },
  hlCard:  { flex: 1, backgroundColor: COLORS.surface, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center', gap: 6, ...SHADOWS.small },
  hlIcon:  { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primaryPale, justifyContent: 'center', alignItems: 'center' },
  hlValue: { fontSize: 14, fontWeight: '800', color: COLORS.textDark, textAlign: 'center' },
  hlLabel: { fontSize: 11, color: COLORS.textLight, fontWeight: '600', textAlign: 'center' },

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
  sellerInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  sellerAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  sellerAvatarImg: { width: 52, height: 52, borderRadius: 26 },
  sellerAvatarText: { fontSize: 18, fontWeight: '800', color: COLORS.textWhite },
  sellerName: { fontSize: 17, fontWeight: '700', color: COLORS.textDark },
  sellerMeta: { fontSize: 12.5, color: COLORS.textLight, marginTop: 6 },
  locationRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, alignSelf: 'flex-start',
    backgroundColor: COLORS.greenPale, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8,
  },
  locationText: { flexShrink: 1, fontSize: 13, color: COLORS.textMedium, fontWeight: '600' },
  verifiedSmall: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.greenPale, justifyContent: 'center', alignItems: 'center' },

  similarRow:   { gap: 12, paddingRight: 8 },
  similarCard:  { width: 132, backgroundColor: COLORS.surface, borderRadius: 14, padding: 8, gap: 3, ...SHADOWS.small },
  similarImg:   { width: '100%', height: 92, borderRadius: 10, backgroundColor: COLORS.divider },
  similarName:  { fontSize: 12.5, fontWeight: '700', color: COLORS.textDark, marginTop: 4 },
  similarPrice: { fontSize: 13, fontWeight: '800', color: COLORS.primary },
  similarDist:  { fontSize: 11, color: COLORS.textLight },

  tipsCard: { flexDirection: 'row', gap: 12, backgroundColor: COLORS.yellowWarm, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.warning + '60' },
  tipsTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textDark, marginBottom: 8 },
  tipsText: { fontSize: 13, color: COLORS.textMedium, lineHeight: 22 },

  reportRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  reportBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 12, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border, minHeight: 46,
  },
  reportTxt: { fontSize: 13, fontWeight: '700', color: COLORS.textMedium },

  listingId: { marginTop: 16, fontSize: 11.5, color: COLORS.textLight, textAlign: 'center' },

  bottomBar: {
    flexDirection: 'row', padding: 16, gap: 12,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1, borderTopColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.06, shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 }, elevation: 6,
  },
  callBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderWidth: 2, borderColor: COLORS.primary, borderRadius: 14, paddingVertical: 12, minHeight: 50,
  },
  callBtnText: { fontSize: fs(15), fontWeight: '700', color: COLORS.primary, flexShrink: 1 },
  chatBtn: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  chatGradient: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 14, borderRadius: 14, minHeight: 50,
  },
  chatBtnText: { fontSize: fs(15), fontWeight: '700', color: COLORS.white, flexShrink: 1 },
  closedBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 50, paddingHorizontal: 12,
  },
  closedTxt: { fontSize: 14, color: COLORS.textMedium, fontWeight: '600', flexShrink: 1 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  reportSheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 8,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, marginBottom: 14 },
  reportTitle: { fontSize: 19, fontWeight: '800', color: COLORS.textDark },
  reportSub:   { fontSize: 13.5, color: COLORS.textMedium, marginTop: 4, marginBottom: 12 },
  reasonRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.divider,
  },
  reasonTxt: { fontSize: 15, color: COLORS.textDark, fontWeight: '600' },
});

/**
 * LabourDetail — Worker/group profile.
 * Shows: photo gallery, skills, experience, languages, pricing, location.
 * Primary action: Call the worker directly. No booking flow.
 */
import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Dimensions, StatusBar,
} from 'react-native';
import { safeOpenURL, sanitizePhone } from '../../utils/sanitize';
import useContactReveal from '../../hooks/useContactReveal';
import { fs } from '../../utils/responsive';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '@cropsetu/shared/services/api';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import { useAuth } from '@cropsetu/shared/context/AuthContext';
import { COLORS } from '@cropsetu/shared/constants/colors';
import AnimatedScreen from '@cropsetu/shared/components/ui/AnimatedScreen';
import { SkeletonDetail } from '../../components/ui/Skeleton';

const { width: W } = Dimensions.get('window');

// Section header with a small accent bar for visual rhythm.
function SectionTitle({ children }) {
  return (
    <View style={D.sectionTitleRow}>
      <View style={D.sectionAccent} />
      <Text style={D.sectionTitle}>{children}</Text>
    </View>
  );
}

// Labelled detail row (icon chip + label + value) for the Worker Details card.
function DetailRow({ icon, label, value, color = COLORS.primary }) {
  if (!value) return null;
  return (
    <View style={D.detailRow}>
      <View style={[D.detailIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={D.detailLabel}>{label}</Text>
        <Text style={D.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

// Gallery image slide with a graceful fallback. A valid-but-unreachable URL
// makes RN's <Image> render a blank box with no recovery — onError swaps in a
// gradient + worker initials so the slide is never a silent white screen.
function GalleryImage({ uri, initials }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <LinearGradient
        colors={[COLORS.primary, COLORS.greenDeep]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[D.galImg, { height: 280, justifyContent: 'center', alignItems: 'center' }]}
      >
        <View style={D.bigAvatar}>
          <Text style={D.bigAvatarTxt}>{initials}</Text>
        </View>
      </LinearGradient>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={[D.galImg, { height: 280 }]}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

export default function LabourDetail({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { id, labour: passedData } = route.params;

  // Reveal-then-dial: the provider's number is fetched from an authenticated,
  // rate-limited, audited endpoint at the moment the farmer taps Call, rather
  // than being shipped to every browser of the listing.
  const { call: callProvider, revealing, phone: revealedPhone } = useContactReveal(
    id ? `/rent/labour/${id}/contact` : null,
    { t, signedIn: !!user },
  );

  const [data,        setData]        = useState(passedData || null);
  const [galIdx,      setGalIdx]      = useState(0);
  const [loadingData, setLoadingData] = useState(!passedData);

  const listingId = id || passedData?.id;

  useEffect(() => {
    if (!listingId) return;
    (async () => {
      try {
        const res = await api.get(`/rent/labour/${listingId}`);
        setData(res.data.data);
      } catch { /* keep passedData */ }
      finally { setLoadingData(false); }
    })();
  }, [listingId]);

  if (loadingData || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.white }}>
        {/* heroH matches the 280pt gallery / avatar header below. */}
        <SkeletonDetail heroH={280} label={t('loading')} />
      </View>
    );
  }

  const l = data;
  // A provider viewing their own worker listing can't hire themselves — show
  // owner controls (Edit) instead of the Call/Hire actions.
  const isOwner = !!user && (user.id === l.provider?.id || user.id === l.providerId);
  // The number is fetched on demand rather than shipped with the listing —
  // see useContactReveal. `phone` is null until the farmer actually taps Call,
  // so the button no longer advertises a stranger's number on screen.
  const phone = revealedPhone;
  const allMedia = [
    ...(l.image  ? [l.image]    : []),
    ...(l.images || []),
    ...(l.videos || []),
  ];
  const initials = (l.leader || l.name || 'W').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  // Availability is two facts that used to be rendered independently and could
  // contradict each other: the provider's `available` toggle, and the date
  // window. A listing whose window had already closed still showed a green
  // "Available" badge. Resolve them into one state and drive both the badge and
  // the window card from it.
  //   'open'     — available now (no window, or today falls inside it)
  //   'upcoming' — window starts in the future
  //   'ended'    — window closed
  //   'busy'     — provider toggled themselves off
  const avail = (() => {
    const from = l.availableFrom ? new Date(l.availableFrom) : null;
    const to   = l.availableTo   ? new Date(l.availableTo)   : null;
    // Compare on date, not timestamp: a window ending "today" is still open.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (to && to < today) return 'ended';
    if (!l.available) return 'busy';
    if (from && from > today) return 'upcoming';
    return 'open';
  })();

  const AVAIL_UI = {
    open:     { bg: COLORS.primaryPale, fg: COLORS.primary,   label: t('rent.listAvailable') },
    upcoming: { bg: COLORS.yellowAmber, fg: COLORS.amber,     label: t('rent.listAvailable') },
    busy:     { bg: COLORS.orangeWarm,  fg: COLORS.cta,       label: t('rent.busy') },
    ended:    { bg: COLORS.lightGray2,  fg: COLORS.grayMid2,  label: t('rent.busy') },
  }[avail];

  // DD/MM/YYYY built by hand. `toLocaleDateString('en-IN')` was hardcoded to one
  // locale in a 10-language app, and Hermes ships without full ICU, so passing
  // the user's locale instead would silently fall back (or throw) on device.
  const fmtDate = (d) => {
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return '';
    return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
  };

  // reveal-then-dial; the hook alerts on failure and caches the number.
  const handleCall = callProvider;

  return (
    <AnimatedScreen>
    <View style={D.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }}>

        {/* ── Gallery ── */}
        {allMedia.length > 0 ? (
          <View style={{ height: 280, position: 'relative' }}>
            <ScrollView
              horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={e => setGalIdx(Math.round(e.nativeEvent.contentOffset.x / W))}
            >
              {allMedia.map((uri, i) => {
                const isVideo = l.videos?.includes(uri);
                return (
                  <View key={i} style={{ width: W, height: 280 }}>
                    {isVideo
                      ? <Video
                          source={{ uri }}
                          style={[D.galImg, { height: 280 }]}
                          resizeMode={ResizeMode.COVER}
                          useNativeControls
                          shouldPlay={false}
                          isLooping={false}
                        />
                      : <GalleryImage uri={uri} initials={initials} />
                    }
                  </View>
                );
              })}
            </ScrollView>
            {/* Gradient overlay */}
            <LinearGradient
              colors={['rgba(0,0,0,0.35)', 'transparent', 'rgba(0,0,0,0.45)']}
              locations={[0, 0.45, 1]}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              pointerEvents="none"
            />
            {/* Back only. The sticky bottom bar is always on screen — including
                at scroll-top — so a third call button here was redundant and sat
                a thumb's width from Back. */}
            <View style={[D.galleryNav, { paddingTop: insets.top + 8 }]}>
              <TouchableOpacity onPress={() => navigation.goBack()} style={D.navBtn}>
                <Ionicons name="arrow-back" size={22} color={COLORS.white} />
              </TouchableOpacity>
            </View>
            {allMedia.length > 1 && (
              <View style={D.dots}>
                {allMedia.map((_, i) => <View key={i} style={[D.dot, i === galIdx && D.dotActive]} />)}
              </View>
            )}
          </View>
        ) : (
          <LinearGradient
            colors={[COLORS.primary, COLORS.greenDeep]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            // Unlike the gallery path there is no photo to bleed under the
            // status bar, so the avatar must start BELOW the notch and the nav
            // row. A static paddingTop put its top edge under the status bar on
            // any device with a non-zero top inset.
            style={[D.avatarHero, { paddingTop: insets.top + 56 }]}
          >
            {/* Back button for no-media path */}
            <View style={[D.galleryNav, { paddingTop: insets.top + 8 }]}>
              <TouchableOpacity onPress={() => navigation.goBack()} style={D.navBtn}>
                <Ionicons name="arrow-back" size={22} color={COLORS.white} />
              </TouchableOpacity>
            </View>
            <View style={D.bigAvatar}>
              <Text style={D.bigAvatarTxt}>{initials}</Text>
            </View>
          </LinearGradient>
        )}

        <View style={D.content}>

          {/* ── Name + Availability ── */}
          <View style={D.nameRow}>
            <View style={{ flex: 1 }}>
              <Text style={D.name}>{l.leader || l.name}</Text>
              {l.name && l.leader && <Text style={D.groupName}>{l.name}</Text>}
              {l.groupSize > 1 && (
                <View style={D.groupBadge}>
                  <Ionicons name="people" size={13} color={COLORS.primary} />
                  <Text style={D.groupBadgeTxt}>{t('rent.workersAvailable', { count: l.groupSize })}</Text>
                </View>
              )}
            </View>
            <View style={[D.availBadge, { backgroundColor: AVAIL_UI.bg }]}>
              <View style={[D.availDot, { backgroundColor: AVAIL_UI.fg }]} />
              <Text style={[D.availTxt, { color: AVAIL_UI.fg }]}>{AVAIL_UI.label}</Text>
            </View>
          </View>

          {/* ── Pricing ── */}
          <View style={D.priceRow}>
            <View style={D.priceCard}>
              <Text style={D.priceAmt}>₹{l.pricePerDay?.toLocaleString()}</Text>
              <Text style={D.priceLbl}>{t('rent.perDayShort')}</Text>
            </View>
            {l.pricePerHour ? (
              <View style={[D.priceCard, { backgroundColor: COLORS.lavenderPale }]}>
                <Text style={[D.priceAmt, { color: COLORS.purpleDark }]}>₹{l.pricePerHour?.toLocaleString()}</Text>
                <Text style={D.priceLbl}>{t('rent.perHourShort')}</Text>
              </View>
            ) : null}
            {l.rating > 0 && (
              <View style={D.ratingCard}>
                <View style={{ flexDirection: 'row', gap: 2 }}>
                  {[1,2,3,4,5].map(s => (
                    <Ionicons key={s} name={s <= Math.round(l.rating) ? 'star' : 'star-outline'} size={12} color={COLORS.yellowDark2} />
                  ))}
                </View>
                <Text style={D.ratingTxt}>{l.rating?.toFixed(1)} ({l.ratingCount})</Text>
              </View>
            )}
          </View>

          {/* ── Owner notice / Call CTA Card ── */}
          {isOwner ? (
            <View style={D.ownerNotice}>
              <Ionicons name="information-circle" size={22} color={COLORS.primary} />
              <Text style={D.ownerNoticeTxt}>
                {t('rent.ownListingMsg', "This is your own listing — you can't hire it.")}
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[D.callCard, !phone && { opacity: 0.4 }]}
              onPress={handleCall}
              disabled={revealing}
              activeOpacity={0.85}
            >
              <View style={D.callCardIcon}>
                <Ionicons name="call" size={26} color={COLORS.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={D.callCardTitle}>{t('rent.callToHire')}</Text>
                <Text style={D.callCardSub}>
                  {revealing ? t('loading') : phone || t('rent.tapToSeeNumber', 'Tap to see the number')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
            </TouchableOpacity>
          )}

          {/* ── Skills ── */}
          {(l.skills || []).length > 0 && (
            <>
              <SectionTitle>{t('rent.skillsExpertise')}</SectionTitle>
              <View style={D.skillsWrap}>
                {l.skills.map((s, i) => (
                  <View key={i} style={D.skillChip}>
                    <Ionicons name="checkmark-circle" size={14} color={COLORS.primary} />
                    <Text style={D.skillTxt}>{s}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* ── Worker details (experience, languages, location) ── */}
          {(l.experience || l.languages?.length > 0 || l.location) ? (
            <>
              <SectionTitle>{t('rent.workerDetails', 'Worker Details')}</SectionTitle>
              <View style={D.detailCard}>
                <DetailRow
                  icon="ribbon-outline"
                  label={t('rent.experienceLabel', 'Experience')}
                  value={l.experience}
                  color={COLORS.primary}
                />
                <DetailRow
                  icon="chatbubbles-outline"
                  label={t('rent.languagesLabel', 'Languages')}
                  value={l.languages?.length > 0 ? l.languages.join(', ') : null}
                  color={COLORS.purpleDark}
                />
                <DetailRow
                  icon="location-outline"
                  label={t('rent.locationLabel', 'Location')}
                  value={l.location ? `${l.location}${l.district ? `, ${l.district}` : ''}` : null}
                  color={COLORS.cta}
                />
              </View>
            </>
          ) : null}

          {/* ── Description ── */}
          {l.description ? (
            <>
              <SectionTitle>{t('rent.aboutSection')}</SectionTitle>
              <Text style={D.descTxt}>{l.description}</Text>
            </>
          ) : null}

          {/* ── Availability window ──
              Colour tracks the resolved state, so a window that has closed no
              longer renders green, and one that has not opened yet reads amber.
              The text is a real translated sentence — it used to concatenate the
              badge word "Available" with a date, which is broken word order in
              every Indian language. */}
          {(l.availableFrom || l.availableTo) ? (
            <View style={[D.availWindowCard, { backgroundColor: AVAIL_UI.bg }]}>
              <Ionicons
                name={avail === 'ended' ? 'calendar-clear-outline' : 'calendar-outline'}
                size={16}
                color={AVAIL_UI.fg}
              />
              <Text style={[D.availWindowTxt, { color: AVAIL_UI.fg }]}>
                {avail === 'ended'
                  ? t('rent.availEnded', 'Availability ended {{date}}', { date: fmtDate(l.availableTo) })
                  : l.availableFrom && l.availableTo
                    ? t('rent.availWindow', 'Available {{from}} – {{to}}', { from: fmtDate(l.availableFrom), to: fmtDate(l.availableTo) })
                    : l.availableFrom
                      ? t('rent.availFrom', 'Available from {{date}}', { date: fmtDate(l.availableFrom) })
                      : t('rent.availUntil', 'Available until {{date}}', { date: fmtDate(l.availableTo) })}
              </Text>
            </View>
          ) : null}

        </View>
      </ScrollView>

      {/* ── Bottom action — owner edits; everyone else calls ── */}
      <View style={[D.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {isOwner ? (
          <View style={[D.bottomCallBtn, D.bottomOwnerBtn]}>
            <Ionicons name="person-circle-outline" size={22} color={COLORS.primary} />
            <Text style={[D.bottomCallTxt, { color: COLORS.primary }]} numberOfLines={1}>{t('rent.ownListingTitle', 'Your Listing')}</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[D.bottomCallBtn, revealing && { opacity: 0.6 }]}
            onPress={handleCall}
            disabled={revealing}
            accessibilityRole="button"
          >
            {revealing
              ? <ActivityIndicator size="small" color={COLORS.white} />
              : <Ionicons name="call" size={22} color={COLORS.white} />}
            <Text style={D.bottomCallTxt} numberOfLines={1}>
              {phone ? `${t('rent.callNow')}  •  ${phone}` : t('rent.callNow')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
    </AnimatedScreen>
  );
}

const D = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.background },

  // Gallery nav overlay
  galleryNav:  { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  navBtn:      { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' },

  galImg:   { width: W },
  dots:     { position: 'absolute', bottom: 28, width: '100%', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive:{ backgroundColor: COLORS.white, width: 20 },

  // paddingTop is applied inline from the safe-area inset — see the render.
  avatarHero:    { paddingBottom: 48, alignItems: 'center', position: 'relative' },
  bigAvatar:     { width: 104, height: 104, borderRadius: 52, backgroundColor: 'rgba(255,255,255,0.18)', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.5)' },
  bigAvatarTxt:  { fontSize: 38, fontWeight: '800', color: COLORS.white },

  // Content sits as a rounded sheet pulled up over the gallery / avatar header.
  content: { padding: 16, backgroundColor: COLORS.background, marginTop: -20, borderTopLeftRadius: 22, borderTopRightRadius: 22 },

  nameRow:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, gap: 10 },
  name:       { fontSize: 20, fontWeight: '800', color: COLORS.textDark },
  groupName:  { fontSize: 13, color: COLORS.textLight, marginTop: 2 },
  groupBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  groupBadgeTxt: { fontSize: 12, color: COLORS.primary, fontWeight: '700' },
  availBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, flexShrink: 0 },
  availDot:   { width: 7, height: 7, borderRadius: 4 },
  availTxt:   { fontSize: 11, fontWeight: '700' },

  priceRow:  { flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  priceCard: { backgroundColor: COLORS.primaryPale, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', minWidth: 90 },
  priceAmt:  { fontSize: 20, fontWeight: '900', color: COLORS.primary },
  priceLbl:  { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  ratingCard:{ backgroundColor: COLORS.yellowAmber, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  ratingTxt: { fontSize: 11, color: COLORS.amber, fontWeight: '700', marginTop: 4 },

  // Owner notice (shown instead of the call CTA on your own listing)
  ownerNotice:    { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.primaryPale, borderRadius: 16, padding: 14, marginBottom: 20, borderWidth: 1.5, borderColor: COLORS.primary + '40' },
  ownerNoticeTxt: { flex: 1, fontSize: 13, color: COLORS.primary, fontWeight: '700', lineHeight: 19 },

  // Call CTA card
  callCard:     { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: COLORS.primaryPale, borderRadius: 16, padding: 14, marginBottom: 20, borderWidth: 1.5, borderColor: COLORS.primary + '40', shadowColor: COLORS.black, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  callCardIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
  callCardTitle:{ fontSize: 16, fontWeight: '800', color: COLORS.textDark },
  callCardSub:  { fontSize: 13, color: COLORS.primary, fontWeight: '600', marginTop: 2 },

  // Accented section header
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginTop: 6 },
  sectionAccent:   { width: 3.5, height: 16, borderRadius: 2, backgroundColor: COLORS.primary },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textDark },

  skillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  skillChip:  { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.primaryPale, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  skillTxt:   { fontSize: 12, color: COLORS.primary, fontWeight: '700' },

  // Worker details card
  detailCard:  { backgroundColor: COLORS.white, borderRadius: 18, padding: 4, marginBottom: 16, shadowColor: COLORS.black, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  detailRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 10 },
  detailIcon:  { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  detailLabel: { fontSize: 11, color: COLORS.textLight, fontWeight: '600' },
  detailValue: { fontSize: 14, color: COLORS.textDark, fontWeight: '700', marginTop: 1 },

  descTxt: { fontSize: 14, color: COLORS.grayMid2, lineHeight: 22, marginBottom: 16 },

  // backgroundColor / color come from AVAIL_UI at render time.
  availWindowCard: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14 },
  availWindowTxt:  { fontSize: 13, fontWeight: '700', flex: 1 },

  bottomBar:     { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, backgroundColor: COLORS.white, borderTopWidth: 1, borderTopColor: COLORS.lightGray2 },
  // gap:8 + paddingHorizontal keeps the icon and (possibly long) "Call • phone"
  // label comfortable; flexShrink + numberOfLines=1 prevent overflow on narrow
  // phones (e.g. Samsung S24). minHeight keeps a solid touch target.
  bottomCallBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: 16, paddingVertical: 15, paddingHorizontal: 12, minHeight: 50 },
  bottomOwnerBtn:{ backgroundColor: COLORS.primaryPale, borderWidth: 1.5, borderColor: COLORS.primary + '40' },
  bottomCallTxt: { fontSize: fs(15), fontWeight: '800', color: COLORS.white, flexShrink: 1 },
});

/**
 * GrowthStoryScreen — the visual "growth story" of a crop cycle, by the days spent.
 *
 * The farmer watches their crop progress day-by-day / stage-by-stage. Each of the eight
 * GrowthStage milestones is drawn as a themed "field scene" (a sky→soil gradient that
 * shifts from bare brown earth at land-prep to lush green at vegetative to golden at
 * maturity), with the crop's own illustration growing larger as the season advances, the
 * day-after-sowing (DAS) counter, and what the farmer actually did at that stage.
 *
 * Image sourcing (best → fallback), so the story always renders something real:
 *   1. the farmer's OWN field photos logged against the cycle (activity.photoUrl / cycle.photos)
 *   2. an AI-generated per-crop-per-stage image  (runtime endpoint — see docs/screens/my-farm/09)
 *   3. the crop's bundled illustration (CropIcon) on a themed stage scene  ← always available
 *
 * Styled to the KhetAI / Login design system (Fraunces serif captions, gradient overlays,
 * forest-green / gold palette).
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, Image, ScrollView, StyleSheet, ActivityIndicator, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import CosmicScreen from './ui/CosmicScreen';
import CosmicHeader from './ui/CosmicHeader';
import GlassCard from './ui/GlassCard';
import CropIcon from '../../components/CropIcons';
import * as farmApi from '../../services/farmApi';
import { COSMIC, CR, CS, CT } from './theme/cosmicTheme';

// ──────────────────────────────────────────────────────────────────────────────
// Stage scenes — generic DAS anchors + a sky/soil gradient + icon scale per stage.
// DAS anchors are approximate (a mid-duration crop); the real reached-date is used
// when known. The point is a believable visual progression, not agronomic precision.
// ──────────────────────────────────────────────────────────────────────────────
const STAGES = [
  { key: 'PLANNING',   label: 'Planning',   short: 'Plan',    icon: 'clipboard-outline',  das: null, scale: 0.34, sky: ['#EAF2FB', '#CFE0C4'], soil: '#9C7A55' },
  { key: 'LAND_PREP',  label: 'Field prep', short: 'Prep',    icon: 'trail-sign-outline', das: 0,    scale: 0.36, sky: ['#EAF2FB', '#D8C3A2'], soil: '#7E5A3C' },
  { key: 'SOWING',     label: 'Sowing',     short: 'Sow',     icon: 'leaf-outline',       das: 0,    scale: 0.40, sky: ['#E9F3FB', '#C7DDAE'], soil: '#6B4A30' },
  { key: 'VEGETATIVE', label: 'Growing',    short: 'Grow',    icon: 'leaf',               das: 18,   scale: 0.58, sky: ['#E4F2F8', '#9CC97E'], soil: '#5C7C3A' },
  { key: 'FLOWERING',  label: 'Flowering',  short: 'Flower',  icon: 'flower-outline',     das: 48,   scale: 0.74, sky: ['#EAF4EE', '#86BE6A'], soil: '#4F7A34' },
  { key: 'FRUITING',   label: 'Fruiting',   short: 'Fruit',   icon: 'nutrition-outline',  das: 78,   scale: 0.84, sky: ['#EFF4E6', '#7FB45F'], soil: '#4A722F' },
  { key: 'MATURITY',   label: 'Maturity',   short: 'Mature',  icon: 'sunny-outline',      das: 110,  scale: 0.92, sky: ['#FBF3DC', '#D9C36A'], soil: '#9C7E2E' },
  { key: 'HARVESTED',  label: 'Harvested',  short: 'Harvest', icon: 'basket-outline',     das: 140,  scale: 0.78, sky: ['#FBF1D2', '#C9B25A'], soil: '#B79237' },
];
const STAGE_IDX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

function dasFrom(sowingDate) {
  if (!sowingDate) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(sowingDate).getTime()) / 86400000));
}

// Gather the farmer's own photos from the cycle (activities + cycle photos + events).
function collectPhotos(cycle) {
  if (!cycle) return [];
  const urls = [];
  (cycle.photos || []).forEach((u) => u && urls.push(u));
  (cycle.activities || []).forEach((a) => a?.photoUrl && urls.push(a.photoUrl));
  (cycle.observedEvents || []).forEach((e) => e?.photoUrl && urls.push(e.photoUrl));
  return Array.from(new Set(urls));
}

export default function GrowthStoryScreen({ navigation, route }) {
  const { cycleId } = route.params || {};
  const [cycle, setCycle] = useState(route.params?.cycle || null);
  const [loading, setLoading] = useState(!route.params?.cycle);

  const load = useCallback(async () => {
    if (!cycleId) { setLoading(false); return; }
    try {
      const c = await farmApi.getCropCycle(cycleId);
      setCycle(c);
    } catch {
      // keep whatever we have
    } finally {
      setLoading(false);
    }
  }, [cycleId]);

  useEffect(() => { load(); }, [load]);

  const das = useMemo(() => dasFrom(cycle?.sowingDate), [cycle]);
  const photos = useMemo(() => collectPhotos(cycle), [cycle]);
  const currentIdx = cycle ? (STAGE_IDX[cycle.growthStage] ?? 0) : 0;

  if (loading) {
    return (
      <CosmicScreen>
        <CosmicHeader title="Growth story" />
        <View style={styles.center}><ActivityIndicator size="large" color={COSMIC.PRIMARY} /></View>
      </CosmicScreen>
    );
  }
  if (!cycle) {
    return (
      <CosmicScreen>
        <CosmicHeader title="Growth story" />
        <View style={styles.center}><Text style={styles.muted}>Cycle not found.</Text></View>
      </CosmicScreen>
    );
  }

  const cropName = cycle.cropName || 'Crop';
  const hero = STAGES[currentIdx];
  // The farmer's most recent photo headlines the hero when present.
  const heroPhoto = photos[photos.length - 1] || null;

  return (
    <CosmicScreen edges={{ top: false, bottom: false }} scroll>
      <CosmicHeader title="Growth story" subtitle={`${cropName}${cycle.variety ? ` · ${cycle.variety}` : ''}`} />

      {/* ── Hero: the crop "today" ───────────────────────────── */}
      <View style={styles.heroWrap}>
        <StageScene stage={hero} cropName={cropName} photo={heroPhoto} height={210} />
        <LinearGradient
          colors={['rgba(0,36,3,0)', 'rgba(0,28,3,0.82)']}
          style={styles.heroOverlay}
        >
          <View style={styles.heroStagePill}>
            <View style={styles.heroDot} />
            <Text style={styles.heroStageTxt}>{hero.label}</Text>
          </View>
          <Text style={styles.heroTitle} numberOfLines={1}>
            {das != null ? `Day ${das}` : 'Not sown yet'}
          </Text>
          <Text style={styles.heroSub} numberOfLines={1}>
            {das != null ? `${cropName} · ${cycle.season || ''} ${cycle.year || ''}`.trim() : `${cropName} · planning stage`}
          </Text>
        </LinearGradient>
      </View>

      {/* ── Your field photos ────────────────────────────────── */}
      <SectionLabel title="Your field photos" />
      {photos.length === 0 ? (
        <GlassCard style={styles.section}>
          <View style={styles.photoEmpty}>
            <View style={styles.photoBubble}>
              <Ionicons name="camera-outline" size={18} color={COSMIC.PRIMARY} />
            </View>
            <Text style={styles.photoEmptyTxt}>
              Add a photo when you log an activity and it will appear here, building a real picture story of your crop's season.
            </Text>
          </View>
        </GlassCard>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRail}>
          {photos.map((u, i) => (
            <Image key={`${u}-${i}`} source={{ uri: u }} style={styles.photoThumb} />
          ))}
        </ScrollView>
      )}

      {/* ── Stage filmstrip ──────────────────────────────────── */}
      <SectionLabel title="Season timeline" />
      <View style={styles.section}>
        {STAGES.map((s, i) => {
          const status = i < currentIdx ? 'done' : i === currentIdx ? 'now' : 'upcoming';
          const reachedDas = s.das;
          return (
            <View key={s.key} style={styles.tlRow}>
              <View style={styles.tlRail}>
                <View style={[
                  styles.tlDot,
                  status === 'done' && { backgroundColor: COSMIC.PRIMARY, borderColor: COSMIC.PRIMARY },
                  status === 'now' && { backgroundColor: COSMIC.ACCENT, borderColor: COSMIC.ACCENT_DK, width: 16, height: 16, borderRadius: 8 },
                ]}>
                  {status === 'done' && <Ionicons name="checkmark" size={10} color="#FFFFFF" />}
                </View>
                {i < STAGES.length - 1 && <View style={[styles.tlLine, i < currentIdx && { backgroundColor: COSMIC.PRIMARY }]} />}
              </View>

              <View style={[styles.tlCard, status === 'now' && styles.tlCardNow, status === 'upcoming' && { opacity: 0.7 }]}>
                <StageScene stage={s} cropName={cropName} height={64} width={64} rounded />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={styles.tlTitleRow}>
                    <Text style={styles.tlTitle}>{s.label}</Text>
                    <StatusPill status={status} />
                  </View>
                  <Text style={styles.tlMeta} numberOfLines={1}>
                    {reachedDas != null ? `around day ${reachedDas}` : 'before sowing'}
                    {status === 'now' && das != null ? ` · you're on day ${das}` : ''}
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>

      {/* ── Honest note on realistic imagery ─────────────────── */}
      <GlassCard style={[styles.section, { marginTop: CS.sm }]}>
        <View style={styles.noteRow}>
          <Ionicons name="sparkles-outline" size={15} color={COSMIC.PRIMARY} />
          <Text style={styles.noteTxt}>
            Each scene is illustrated from your crop and stage. As you log activities with photos, your own
            field pictures take over the story. Photorealistic AI stage images are on the way.
          </Text>
        </View>
      </GlassCard>

      <Pressable onPress={() => navigation.goBack()} style={({ pressed }) => [styles.backLink, pressed && { opacity: 0.7 }]}>
        <Ionicons name="arrow-back" size={15} color={COSMIC.PRIMARY} />
        <Text style={styles.backLinkTxt}>Back to cycle</Text>
      </Pressable>

      <View style={{ height: 24 }} />
    </CosmicScreen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// A themed "field scene": sky→soil gradient with the crop illustration (or a photo).
// ──────────────────────────────────────────────────────────────────────────────
function StageScene({ stage, cropName, photo, height = 200, width, rounded = false }) {
  if (photo) {
    return (
      <Image
        source={{ uri: photo }}
        style={[{ height, width: width || '100%', borderRadius: rounded ? CR.md : 0 }]}
        resizeMode="cover"
      />
    );
  }
  const iconSize = Math.round(height * stage.scale);
  return (
    <LinearGradient
      colors={stage.sky}
      style={[
        styles.scene,
        { height, width: width || '100%', borderRadius: rounded ? CR.md : 0 },
      ]}
    >
      {/* soil band */}
      <View style={[styles.soil, { backgroundColor: stage.soil, height: Math.max(12, height * 0.22) }]} />
      <View style={styles.sceneIconWrap}>
        <CropIcon crop={cropName.charAt(0).toUpperCase() + cropName.slice(1)} size={iconSize} />
      </View>
    </LinearGradient>
  );
}

function SectionLabel({ title }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function StatusPill({ status }) {
  const map = {
    done:     { txt: 'Done',     bg: COSMIC.PRIMARY_SOFT, fg: COSMIC.PRIMARY },
    now:      { txt: 'Now',      bg: COSMIC.ACCENT_SOFT,  fg: COSMIC.ACCENT_DK },
    upcoming: { txt: 'Upcoming', bg: COSMIC.SURFACE_HI,   fg: COSMIC.TEXT_3 },
  }[status];
  return (
    <View style={[styles.statusPill, { backgroundColor: map.bg }]}>
      <Text style={[styles.statusTxt, { color: map.fg }]}>{map.txt}</Text>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { fontSize: 13, color: COSMIC.TEXT_2, fontFamily: CT.family.regular },

  // Hero
  heroWrap: {
    marginHorizontal: CS.base,
    marginTop: CS.sm,
    borderRadius: CR.xl,
    overflow: 'hidden',
    ...({ shadowColor: '#0E3A20', shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 }),
  },
  heroOverlay: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 28,
    paddingBottom: 16,
  },
  heroStagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: CR.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
  },
  heroDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' },
  heroStageTxt: { color: '#FFFFFF', fontSize: 11, fontFamily: CT.family.bold, letterSpacing: 0.4, textTransform: 'capitalize' },
  heroTitle: { color: '#FFFFFF', fontSize: 30, fontFamily: 'Fraunces_700Bold', letterSpacing: -0.5 },
  heroSub: { color: 'rgba(255,255,255,0.86)', fontSize: 13, fontFamily: CT.family.medium, marginTop: 2, textTransform: 'capitalize' },

  // Scene
  scene: { overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end' },
  soil: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sceneIconWrap: { alignItems: 'center', justifyContent: 'flex-end', marginBottom: 6 },

  // Section labels
  sectionLabel: { paddingHorizontal: CS.base, paddingTop: CS.lg, paddingBottom: 8 },
  sectionTitle: { fontSize: 13, color: COSMIC.TEXT_2, fontFamily: CT.family.bold, textTransform: 'uppercase', letterSpacing: 0.6 },
  section: { marginHorizontal: CS.base },

  // Photos
  photoRail: { paddingHorizontal: CS.base, gap: 10, paddingBottom: 2 },
  photoThumb: { width: 120, height: 120, borderRadius: CR.md, backgroundColor: COSMIC.SURFACE_HI, marginRight: 10 },
  photoEmpty: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photoBubble: { width: 40, height: 40, borderRadius: 20, backgroundColor: COSMIC.PRIMARY_SOFT, alignItems: 'center', justifyContent: 'center' },
  photoEmptyTxt: { flex: 1, fontSize: 12.5, color: COSMIC.TEXT_2, lineHeight: 18, fontFamily: CT.family.regular },

  // Timeline
  tlRow: { flexDirection: 'row', gap: 12 },
  tlRail: { width: 18, alignItems: 'center' },
  tlDot: {
    width: 12, height: 12, borderRadius: 6, marginTop: 28,
    backgroundColor: COSMIC.SURFACE, borderWidth: 2, borderColor: COSMIC.BORDER_HI,
    alignItems: 'center', justifyContent: 'center',
  },
  tlLine: { flex: 1, width: 2, backgroundColor: COSMIC.BORDER, marginTop: 4, marginBottom: 2, borderRadius: 1 },
  tlCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', marginBottom: 12,
    backgroundColor: COSMIC.SURFACE, borderRadius: CR.lg, borderWidth: 1, borderColor: COSMIC.BORDER,
    padding: 8,
  },
  tlCardNow: { borderColor: COSMIC.ACCENT, borderWidth: 1.5, backgroundColor: '#FFFDF6' },
  tlTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  tlTitle: { fontSize: 15, color: COSMIC.TEXT, fontFamily: 'Fraunces_600SemiBold' },
  tlMeta: { fontSize: 11.5, color: COSMIC.TEXT_3, fontFamily: CT.family.medium, marginTop: 3, textTransform: 'capitalize' },

  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: CR.pill },
  statusTxt: { fontSize: 10, fontFamily: CT.family.bold, letterSpacing: 0.4, textTransform: 'uppercase' },

  // Note
  noteRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  noteTxt: { flex: 1, fontSize: 12.5, color: COSMIC.TEXT_2, lineHeight: 18, fontFamily: CT.family.regular },

  backLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: CS.md },
  backLinkTxt: { fontSize: 13, color: COSMIC.PRIMARY, fontFamily: CT.family.bold },
});

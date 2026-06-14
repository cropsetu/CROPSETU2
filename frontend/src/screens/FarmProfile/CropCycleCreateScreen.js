/**
 * CropCycleCreateScreen — the guided "Crop Plan" a farmer fills in BEFORE sowing.
 *
 * This is the pre-seeding process that was previously missing: the old screen jumped
 * straight to crop + seed and created the cycle. Now we walk the real-world sequence an
 * Indian farmer follows before the seed ever touches soil, and capture every detail:
 *
 *   1. Which crop            (illustrated picker, fuzzy search)
 *   2. Season                (Kharif / Rabi / Zaid)
 *   3. Area allocated        (acres)
 *   4. Variety & type        (variety name · Hybrid / Desi · Organic)
 *   5. Field history         (previous crop / rotation — "how it was cultivated before")
 *   6. Field preparation     (ploughing, harrowing, levelling, FYM, bunds … — multi)
 *   7. Water source          (canal / borewell / well / rainfed / drip / pond)
 *   8. Seed details          (brand, source, seed rate, treatment + product, cost)
 *
 * Styled to the KhetAI / Login design system (Fraunces serif title with an italic
 * second line, accent pill, progress bar, gradient "Start" button).
 *
 * Persists via farmApi.createCropCycle — the backend create service now also stores
 * seedTreatment / seedTreatmentProduct and a composed `notes` line (previous crop +
 * field-prep plan + water source) so nothing the farmer enters is lost. The cycle is
 * created in PLANNING stage; the farmer then logs land-prep & sowing to advance it.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import CosmicScreen from './ui/CosmicScreen';
import CosmicHeader from './ui/CosmicHeader';
import GlassCard    from './ui/GlassCard';
import GlowButton   from './ui/GlowButton';
import CropIcon     from '../../components/CropIcons';
import { useLanguage } from '../../context/LanguageContext';
import { createCropCycle } from '../../services/farmApi';
import { COSMIC, CR, CS, CT, GRADIENT } from './theme/cosmicTheme';
import { Haptics } from '../../utils/haptics';

// Crop keys aligned with translations.js crops.* and the CropIcon name lookup.
const CROP_KEYS = [
  'soybean', 'cotton', 'rice', 'wheat', 'maize', 'sugarcane',
  'onion', 'tomato', 'chilli', 'potato', 'groundnut', 'jowar',
  'bajra', 'turmeric', 'pomegranate', 'grape', 'mango', 'banana',
  'brinjal', 'okra', 'sunflower',
];

// Fuzzy-match synonyms: bhendi = okra = bhindi = ladyfinger, etc.
const CROP_SYNONYMS = {
  okra:     ['okra', 'bhendi', 'bhindi', 'ladyfinger', 'vendakkai'],
  brinjal:  ['brinjal', 'eggplant', 'baingan', 'baigan'],
  tomato:   ['tomato', 'tamatar'],
  onion:    ['onion', 'pyaaz', 'kanda'],
  potato:   ['potato', 'aloo', 'batata'],
  chilli:   ['chilli', 'chili', 'mirch', 'mirchi'],
  soybean:  ['soybean', 'soya'],
  cotton:   ['cotton', 'kapas', 'kapashi'],
  groundnut:['groundnut', 'peanut', 'moongphali', 'shengdana'],
  turmeric: ['turmeric', 'haldi'],
  jowar:    ['jowar', 'sorghum'],
  bajra:    ['bajra', 'pearl millet'],
  sugarcane:['sugarcane', 'ganna', 'us'],
  sunflower:['sunflower', 'surajmukhi'],
};

const SEASONS = [
  { key: 'KHARIF', label: 'Kharif', icon: 'rainy', color: COSMIC.IRRIGATION, hint: 'Jun–Oct · monsoon' },
  { key: 'RABI',   label: 'Rabi',   icon: 'snow',  color: '#5B8FF0',         hint: 'Nov–Mar · winter' },
  { key: 'ZAID',   label: 'Zaid',   icon: 'sunny', color: COSMIC.ACCENT,     hint: 'Mar–Jun · summer' },
];

const SEED_TYPES = [
  { key: 'hybrid', label: 'Hybrid / Bt', icon: 'flash-outline' },
  { key: 'desi',   label: 'Desi / local', icon: 'leaf-outline' },
];

// Common previous crops for the rotation chooser (plus "Fallow / first time").
const PREV_CROPS = ['Soybean', 'Cotton', 'Wheat', 'Rice', 'Maize', 'Onion', 'Tur/Gram', 'Sugarcane'];

const FIELD_PREP = [
  { key: 'ploughing',  label: 'Ploughing',      icon: 'swap-horizontal-outline' },
  { key: 'harrowing',  label: 'Harrowing',      icon: 'grid-outline' },
  { key: 'levelling',  label: 'Levelling',      icon: 'remove-outline' },
  { key: 'fym',        label: 'FYM / compost',  icon: 'nutrition-outline' },
  { key: 'bunds',      label: 'Bunds / ridges', icon: 'analytics-outline' },
  { key: 'summer',     label: 'Summer plough',  icon: 'sunny-outline' },
];

const WATER_SOURCES = [
  { key: 'canal',     label: 'Canal',     icon: 'git-merge-outline' },
  { key: 'borewell',  label: 'Borewell',  icon: 'water-outline' },
  { key: 'well',      label: 'Open well', icon: 'ellipse-outline' },
  { key: 'rainfed',   label: 'Rainfed',   icon: 'rainy-outline' },
  { key: 'drip',      label: 'Drip',      icon: 'pulse-outline' },
  { key: 'pond',      label: 'Farm pond', icon: 'disc-outline' },
];

const SEED_SOURCES = [
  { key: 'dealer', label: 'Dealer / agro-shop' },
  { key: 'own',    label: 'Own / saved seed' },
  { key: 'coop',   label: 'Coop / FPO' },
  { key: 'govt',   label: 'Govt / KVK' },
];

const TREATMENT_PRODUCTS = ['Trichoderma', 'Carbendazim', 'Imidacloprid', 'Rhizobium / PSB', 'Thiram'];

const labelOf = (list, key) => list.find((x) => x.key === key)?.label || key;

export default function CropCycleCreateScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { farmId } = route.params;

  const [crop, setCrop]               = useState('');
  const [query, setQuery]             = useState('');
  const [season, setSeason]           = useState('');
  const [area, setArea]               = useState('');
  const [variety, setVariety]         = useState('');
  const [seedType, setSeedType]       = useState(null);   // hybrid | desi
  const [organic, setOrganic]         = useState(false);

  const [prevCrop, setPrevCrop]       = useState('');     // free text or chip
  const [fieldPrep, setFieldPrep]     = useState([]);     // multi-select keys
  const [waterSource, setWaterSource] = useState(null);

  const [seedBrand, setSeedBrand]     = useState('');
  const [seedSource, setSeedSource]   = useState(null);
  const [seedRate, setSeedRate]       = useState('');
  const [treated, setTreated]         = useState(null);   // treated | untreated
  const [treatProduct, setTreatProduct] = useState('');
  const [seedCost, setSeedCost]       = useState('');

  const [saving, setSaving]           = useState(false);

  // ── Crop search (with fuzzy synonyms) ───────────────────────────────────
  const filteredCrops = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CROP_KEYS;
    return CROP_KEYS.filter((k) => {
      const list = CROP_SYNONYMS[k] || [k];
      if (list.some((s) => s.toLowerCase().includes(q))) return true;
      try {
        const loc = t('crops.' + k) || '';
        if (loc.toLowerCase().includes(q)) return true;
      } catch {}
      return false;
    });
  }, [query, t]);

  const cropLabel = crop ? (t('crops.' + crop) || crop) : '';
  // A crop the farmer typed that isn't in our list — fully supported, just no preset icon.
  const isCustomCrop = !!crop && !CROP_KEYS.includes(crop);

  // Progress: the 3 required fields drive the Login-style progress bar.
  const requiredDone = [crop, season, area].filter(Boolean).length;
  const progress = requiredDone / 3;

  const togglePrep = (key) => {
    Haptics.selection?.();
    setFieldPrep((cur) => (cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]));
  };

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!crop || !season || !area) {
      Haptics.error?.();
      Alert.alert(
        t('farmProfile.requiredTitle') || 'Missing info',
        t('farmProfile.cropCycleRequiredMsg') || 'Please pick a crop, season, and area.',
      );
      return;
    }
    setSaving(true);
    try {
      // Compose the field-history note from the structured pre-seeding inputs.
      const noteParts = [];
      if (prevCrop) noteParts.push(`Previous crop: ${prevCrop}`);
      if (fieldPrep.length) noteParts.push(`Field prep: ${fieldPrep.map((k) => labelOf(FIELD_PREP, k)).join(', ')}`);
      if (waterSource) noteParts.push(`Water: ${labelOf(WATER_SOURCES, waterSource)}`);
      const notes = noteParts.join(' · ') || null;

      const cycle = await createCropCycle(farmId, {
        cropName: crop.charAt(0).toUpperCase() + crop.slice(1),
        variety: variety || null,
        season,
        year: new Date().getFullYear(),
        areaAllocatedAcres: parseFloat(area),
        isHybrid: seedType === 'hybrid',
        isOrganic: !!organic,
        seedName: variety || null,
        seedBrand: seedBrand || null,
        seedSource: seedSource ? labelOf(SEED_SOURCES, seedSource) : null,
        seedQuantityKg: seedRate ? parseFloat(seedRate) : null,
        seedTotalCostInr: seedCost ? parseFloat(seedCost) : null,
        seedTreatment: treated || null,
        seedTreatmentProduct: treated === 'treated' ? (treatProduct || null) : null,
        notes,
      });
      Haptics.success?.();
      // Continue straight into the new cycle (replace so Back doesn't reopen the form).
      const id = cycle?.id;
      if (id && navigation.replace) navigation.replace('CropCycleDetail', { cycleId: id });
      else navigation.goBack();
    } catch (e) {
      Haptics.error?.();
      const msg = e.response?.data?.error?.message
        || e.userMessage
        || (t('farmProfile.saveFailed') || 'Save failed.');
      Alert.alert(t('login.error') || 'Error', msg);
    } finally {
      setSaving(false);
    }
  }, [crop, variety, season, area, seedType, organic, prevCrop, fieldPrep, waterSource,
      seedBrand, seedSource, seedRate, treated, treatProduct, seedCost, farmId, navigation, t]);

  return (
    <CosmicScreen edges={{ top: false, bottom: false }}>
      <CosmicHeader
        title={t('nav.newCropCycle') || 'Plan a crop cycle'}
        subtitle={cropLabel ? `${cropLabel}${area ? ` · ${area} ac` : ''}` : 'Set up before you sow'}
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Intro (Login-style accent pill + serif title) ── */}
          <View style={styles.accentPill}>
            <Ionicons name="sparkles" size={11} color={COSMIC.PRIMARY} />
            <Text style={styles.accentPillTxt}>Plan before you sow</Text>
          </View>
          <Text style={styles.heroTitle}>
            Let's plan this{'\n'}
            <Text style={styles.heroTitleItalic}>season's crop.</Text>
          </Text>
          <Text style={styles.heroSub}>
            Capture the field's history, preparation and seed — before the first seed goes in. You can log
            land-prep, sowing and every activity afterwards.
          </Text>

          {/* progress bar */}
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <LinearGradient
                colors={GRADIENT.primary}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={[styles.progressFill, { width: `${Math.max(8, progress * 100)}%` }]}
              />
            </View>
            <Text style={styles.progressTxt}>{requiredDone}/3 basics</Text>
          </View>

          {/* ── 1 · Crop picker ─────────────────────────────── */}
          <SectionHeader n="1" tint={COSMIC.PRIMARY} title="Which crop?" />
          <GlassCard variant="plain" style={styles.section}>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={COSMIC.MUTED} />
              <TextInput
                placeholder="Search: bhendi, kapas, soya…"
                placeholderTextColor={COSMIC.MUTED}
                value={query}
                onChangeText={setQuery}
                style={styles.searchInput}
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery('')} hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}>
                  <Ionicons name="close-circle" size={18} color={COSMIC.MUTED} />
                </Pressable>
              )}
            </View>

            <View style={styles.cropGrid}>
              {filteredCrops.map((k) => {
                const sel = crop === k;
                const label = t('crops.' + k) || k;
                return (
                  <Pressable
                    key={k}
                    onPress={() => { Haptics.selection?.(); setCrop(k); }}
                    style={({ pressed }) => [
                      styles.cropCard,
                      sel && styles.cropCardSel,
                      pressed && { transform: [{ scale: 0.96 }] },
                    ]}
                  >
                    <View style={styles.cropIconWrap}>
                      <CropIcon crop={k.charAt(0).toUpperCase() + k.slice(1)} size={40} />
                    </View>
                    <Text
                      style={[styles.cropLabel, sel && { color: COSMIC.PRIMARY, fontFamily: CT.family.bold }]}
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                    {sel && (
                      <View style={styles.cropCheck}>
                        <Ionicons name="checkmark-circle" size={16} color={COSMIC.PRIMARY} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
              {filteredCrops.length === 0 && (
                <View style={styles.cropEmpty}>
                  <Text style={styles.mutedText}>No crop matches "{query}".</Text>
                  {query.trim().length > 1 && (
                    <Pressable
                      onPress={() => { Haptics.selection?.(); setCrop(query.trim()); setQuery(''); }}
                      style={styles.addCustomBtn}
                    >
                      <Ionicons name="add-circle" size={16} color={COSMIC.PRIMARY} />
                      <Text style={styles.addCustomTxt}>Add "{query.trim()}" as my crop</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>

            {/* Custom crop the farmer typed (not in the preset list) */}
            {isCustomCrop && (
              <View style={styles.customSelected}>
                <Ionicons name="leaf" size={16} color={COSMIC.PRIMARY} />
                <Text style={styles.customSelectedTxt} numberOfLines={1}>{cropLabel} · custom crop</Text>
                <Pressable onPress={() => setCrop('')} hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}>
                  <Ionicons name="close-circle" size={18} color={COSMIC.MUTED} />
                </Pressable>
              </View>
            )}
          </GlassCard>

          {/* ── 2 · Season ──────────────────────────────────── */}
          <SectionHeader n="2" tint={COSMIC.IRRIGATION} title="Season" />
          <View style={[styles.section, styles.seasonGrid]}>
            {SEASONS.map((s) => {
              const sel = season === s.key;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => { Haptics.selection?.(); setSeason(s.key); }}
                  style={({ pressed }) => [
                    styles.seasonCard,
                    { borderColor: sel ? s.color : COSMIC.BORDER, backgroundColor: sel ? s.color + '1F' : COSMIC.SURFACE },
                    pressed && { transform: [{ scale: 0.97 }] },
                  ]}
                >
                  <View style={[styles.seasonIcon, { backgroundColor: s.color + '24', borderColor: s.color + '55' }]}>
                    <Ionicons name={s.icon} size={22} color={s.color} />
                  </View>
                  <Text style={[styles.seasonLabel, sel && { color: s.color, fontFamily: CT.family.bold }]}>
                    {s.label}
                  </Text>
                  <Text style={styles.seasonHint} numberOfLines={1}>{s.hint}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── 3 · Area ────────────────────────────────────── */}
          <SectionHeader n="3" tint={COSMIC.ACCENT_DK} title="Area allocated" />
          <GlassCard variant="plain" style={styles.section}>
            <View style={styles.areaRow}>
              <TextInput
                value={area}
                onChangeText={setArea}
                placeholder="2.5"
                placeholderTextColor={COSMIC.MUTED}
                keyboardType="decimal-pad"
                style={styles.areaInput}
              />
              <View style={styles.areaUnitPill}>
                <Text style={styles.areaUnitText}>ACRES</Text>
              </View>
            </View>
            <Text style={styles.mutedText}>Regional units (bigha, guntha) coming soon.</Text>
          </GlassCard>

          {/* ── 4 · Variety & type ──────────────────────────── */}
          <SectionHeader n="4" tint={COSMIC.PRIMARY} title="Variety & type" optional />
          <GlassCard variant="plain" style={styles.section}>
            <TextInput
              value={variety}
              onChangeText={setVariety}
              placeholder={t('farmProfile.varietyPlaceholder') || 'e.g. Rasi 659 Bt, JS-335'}
              placeholderTextColor={COSMIC.MUTED}
              style={styles.input}
              autoCapitalize="words"
            />
            <View style={styles.chipWrap}>
              {SEED_TYPES.map((s) => (
                <Chip
                  key={s.key}
                  icon={s.icon}
                  label={s.label}
                  selected={seedType === s.key}
                  onPress={() => { Haptics.selection?.(); setSeedType(seedType === s.key ? null : s.key); }}
                />
              ))}
              <Chip
                icon="nutrition-outline"
                label="Organic"
                tint={COSMIC.SOWING}
                selected={organic}
                onPress={() => { Haptics.selection?.(); setOrganic((o) => !o); }}
              />
            </View>
          </GlassCard>

          {/* ── 5 · Field history (previous crop) ───────────── */}
          <SectionHeader n="5" tint={COSMIC.LAND_PREP} title="How was this field cultivated before?" optional />
          <GlassCard variant="plain" style={styles.section}>
            <Text style={styles.helpText}>Last season's crop helps plan rotation, nutrients and pest risk.</Text>
            <View style={styles.chipWrap}>
              {PREV_CROPS.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  tint={COSMIC.LAND_PREP}
                  selected={prevCrop === c}
                  onPress={() => { Haptics.selection?.(); setPrevCrop(prevCrop === c ? '' : c); }}
                />
              ))}
              <Chip
                label="Fallow / first time"
                tint={COSMIC.LAND_PREP}
                selected={prevCrop === 'Fallow / first time'}
                onPress={() => { Haptics.selection?.(); setPrevCrop(prevCrop === 'Fallow / first time' ? '' : 'Fallow / first time'); }}
              />
            </View>
            <TextInput
              value={PREV_CROPS.includes(prevCrop) || prevCrop === 'Fallow / first time' ? '' : prevCrop}
              onChangeText={setPrevCrop}
              placeholder="…or type the previous crop"
              placeholderTextColor={COSMIC.MUTED}
              style={[styles.input, { marginTop: 10 }]}
              autoCapitalize="words"
            />
          </GlassCard>

          {/* ── 6 · Field preparation ───────────────────────── */}
          <SectionHeader n="6" tint={COSMIC.LAND_PREP} title="Field preparation" optional />
          <GlassCard variant="plain" style={styles.section}>
            <Text style={styles.helpText}>What's done or planned to ready the field (tap all that apply).</Text>
            <View style={styles.chipWrap}>
              {FIELD_PREP.map((p) => (
                <Chip
                  key={p.key}
                  icon={p.icon}
                  label={p.label}
                  tint={COSMIC.LAND_PREP}
                  selected={fieldPrep.includes(p.key)}
                  onPress={() => togglePrep(p.key)}
                />
              ))}
            </View>
          </GlassCard>

          {/* ── 7 · Water source ────────────────────────────── */}
          <SectionHeader n="7" tint={COSMIC.IRRIGATION} title="Water source" optional />
          <GlassCard variant="plain" style={styles.section}>
            <View style={styles.chipWrap}>
              {WATER_SOURCES.map((w) => (
                <Chip
                  key={w.key}
                  icon={w.icon}
                  label={w.label}
                  tint={COSMIC.IRRIGATION}
                  selected={waterSource === w.key}
                  onPress={() => { Haptics.selection?.(); setWaterSource(waterSource === w.key ? null : w.key); }}
                />
              ))}
            </View>
          </GlassCard>

          {/* ── 8 · Seed details ────────────────────────────── */}
          <SectionHeader n="8" tint={COSMIC.ACCENT_DK} title="Seed details" optional />
          <GlassCard variant="plain" style={styles.section}>
            <TextInput
              value={seedBrand}
              onChangeText={setSeedBrand}
              placeholder={t('farmProfile.seedBrandPlaceholder') || 'Seed brand / company'}
              placeholderTextColor={COSMIC.MUTED}
              style={[styles.input, { marginBottom: 10 }]}
              autoCapitalize="words"
            />
            <Text style={styles.subLabel}>SEED SOURCE</Text>
            <View style={styles.chipWrap}>
              {SEED_SOURCES.map((s) => (
                <Chip
                  key={s.key}
                  label={s.label}
                  tint={COSMIC.ACCENT_DK}
                  selected={seedSource === s.key}
                  onPress={() => { Haptics.selection?.(); setSeedSource(seedSource === s.key ? null : s.key); }}
                />
              ))}
            </View>

            <View style={[styles.row2, { marginTop: 12 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.subLabel}>SEED RATE (KG)</Text>
                <TextInput
                  value={seedRate}
                  onChangeText={setSeedRate}
                  placeholder="e.g. 30"
                  placeholderTextColor={COSMIC.MUTED}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.subLabel}>SEED COST (₹)</Text>
                <TextInput
                  value={seedCost}
                  onChangeText={setSeedCost}
                  placeholder="e.g. 3200"
                  placeholderTextColor={COSMIC.MUTED}
                  keyboardType="numeric"
                  style={styles.input}
                />
              </View>
            </View>

            <Text style={[styles.subLabel, { marginTop: 12 }]}>SEED TREATMENT</Text>
            <View style={styles.chipWrap}>
              <Chip
                icon="shield-checkmark-outline"
                label="Treated"
                tint={COSMIC.FERTILIZER}
                selected={treated === 'treated'}
                onPress={() => { Haptics.selection?.(); setTreated(treated === 'treated' ? null : 'treated'); }}
              />
              <Chip
                icon="close-circle-outline"
                label="Not treated"
                selected={treated === 'untreated'}
                onPress={() => { Haptics.selection?.(); setTreated(treated === 'untreated' ? null : 'untreated'); }}
              />
            </View>
            {treated === 'treated' && (
              <>
                <View style={[styles.chipWrap, { marginTop: 10 }]}>
                  {TREATMENT_PRODUCTS.map((p) => (
                    <Chip
                      key={p}
                      label={p}
                      tint={COSMIC.FERTILIZER}
                      selected={treatProduct === p}
                      onPress={() => { Haptics.selection?.(); setTreatProduct(treatProduct === p ? '' : p); }}
                    />
                  ))}
                </View>
                <TextInput
                  value={TREATMENT_PRODUCTS.includes(treatProduct) ? '' : treatProduct}
                  onChangeText={setTreatProduct}
                  placeholder="…or type the treatment product"
                  placeholderTextColor={COSMIC.MUTED}
                  style={[styles.input, { marginTop: 10 }]}
                />
              </>
            )}
          </GlassCard>

          {/* ── Plan summary ────────────────────────────────── */}
          {!!crop && (
            <View style={styles.summaryCard}>
              <View style={styles.summaryHead}>
                <View style={styles.summaryIcon}>
                  {isCustomCrop
                    ? <Ionicons name="leaf" size={26} color={COSMIC.PRIMARY} />
                    : <CropIcon crop={crop.charAt(0).toUpperCase() + crop.slice(1)} size={30} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryTitle} numberOfLines={1}>
                    {cropLabel}{variety ? ` · ${variety}` : ''}
                  </Text>
                  <Text style={styles.summaryMeta} numberOfLines={1}>
                    {[season, area ? `${area} ac` : null, prevCrop ? `after ${prevCrop}` : null].filter(Boolean).join(' · ') || 'Pick season & area'}
                  </Text>
                </View>
              </View>
            </View>
          )}

          <View style={{ height: 12 }} />
        </ScrollView>

        {/* ── Footer (gradient Start button) ───────────────── */}
        <View style={styles.footer}>
          <GlowButton
            label={saving ? 'Starting…' : (t('farmProfile.startCropCycle') || 'Start crop cycle')}
            iconRight="arrow-forward"
            variant="primary"
            size="lg"
            loading={saving}
            full
            onPress={handleCreate}
          />
        </View>
      </KeyboardAvoidingView>
    </CosmicScreen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────────
function SectionHeader({ n, tint, title, optional }) {
  return (
    <View style={styles.secHeader}>
      <View style={[styles.secNum, { backgroundColor: tint }]}>
        <Text style={styles.secNumTxt}>{n}</Text>
      </View>
      <Text style={styles.secTitle} numberOfLines={2}>{title}</Text>
      {optional && <Text style={styles.optional}>Optional</Text>}
    </View>
  );
}

function Chip({ icon, label, selected, onPress, tint = COSMIC.PRIMARY }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? tint + '18' : COSMIC.SURFACE, borderColor: selected ? tint : COSMIC.BORDER }]}
    >
      {icon && <Ionicons name={icon} size={14} color={selected ? tint : COSMIC.TEXT_3} />}
      <Text style={[styles.chipTxt, selected && { color: tint, fontFamily: CT.family.bold }]}>{label}</Text>
    </Pressable>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: CS.base,
    paddingTop: CS.sm,
    paddingBottom: 110,
  },

  // Intro
  accentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: COSMIC.PRIMARY_SOFT,
    borderWidth: 1,
    borderColor: 'rgba(0,95,33,0.18)',
    borderRadius: CR.pill,
    paddingHorizontal: 11,
    paddingVertical: 5,
    marginTop: 4,
  },
  accentPillTxt: { color: COSMIC.PRIMARY, fontSize: 11, fontFamily: CT.family.semibold, letterSpacing: 0.3 },
  heroTitle: {
    color: COSMIC.TEXT,
    fontSize: 30,
    lineHeight: 34,
    fontFamily: CT.family.display,
    letterSpacing: -0.5,
    marginTop: 12,
  },
  heroTitleItalic: { color: COSMIC.PRIMARY, fontFamily: CT.family.displayItalic, fontStyle: 'italic' },
  heroSub: {
    color: COSMIC.TEXT_3,
    fontSize: 13.5,
    lineHeight: 20,
    fontFamily: CT.family.regular,
    marginTop: 10,
  },

  // Progress
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 2 },
  progressTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: COSMIC.BORDER, overflow: 'hidden' },
  progressFill: { height: 5, borderRadius: 3 },
  progressTxt: { fontSize: 11, color: COSMIC.TEXT_3, fontFamily: CT.family.semibold },

  // Section headers
  secHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: CS.lg,
    marginBottom: 8,
  },
  secNum: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secNumTxt: { color: '#FFFFFF', fontSize: 12, fontFamily: CT.family.extra },
  secTitle: { fontSize: 15, color: COSMIC.TEXT, fontFamily: CT.family.bold, flex: 1, letterSpacing: -0.2 },
  optional: {
    fontSize: 10,
    color: COSMIC.TEXT_3,
    fontFamily: CT.family.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  section: { marginBottom: 2 },

  input: {
    borderWidth: 1.2,
    borderColor: COSMIC.BORDER_HI,
    borderRadius: CR.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 9,
    fontSize: 14,
    color: COSMIC.TEXT,
    backgroundColor: COSMIC.SURFACE,
    fontFamily: CT.family.medium,
    minHeight: 46,
  },
  row2: { flexDirection: 'row', gap: 10 },
  subLabel: {
    fontSize: 11,
    color: COSMIC.TEXT_3,
    fontFamily: CT.family.bold,
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  helpText: {
    fontSize: 12,
    color: COSMIC.TEXT_3,
    fontFamily: CT.family.regular,
    lineHeight: 17,
    marginBottom: 10,
  },

  // Search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: CR.md,
    backgroundColor: COSMIC.SURFACE_HI,
    borderWidth: 1,
    borderColor: COSMIC.BORDER,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 13, color: COSMIC.TEXT, padding: 0, fontFamily: CT.family.medium },

  // Crop grid
  cropGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cropCard: {
    width: '22%',
    aspectRatio: 1,
    borderRadius: CR.md,
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.2,
    borderColor: COSMIC.BORDER,
    backgroundColor: COSMIC.SURFACE,
    position: 'relative',
  },
  cropCardSel: { borderColor: COSMIC.PRIMARY, backgroundColor: COSMIC.PRIMARY_SOFT },
  cropIconWrap: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  cropLabel: {
    fontSize: 9,
    color: COSMIC.TEXT_2,
    textAlign: 'center',
    marginTop: 2,
    fontFamily: CT.family.semibold,
  },
  cropCheck: { position: 'absolute', top: 2, right: 2 },
  cropEmpty: { padding: 16, alignItems: 'center', width: '100%', gap: 10 },
  addCustomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: CR.pill,
    backgroundColor: COSMIC.PRIMARY_SOFT,
    borderWidth: 1,
    borderColor: 'rgba(0,95,33,0.2)',
  },
  addCustomTxt: { fontSize: 12.5, color: COSMIC.PRIMARY, fontFamily: CT.family.bold },
  customSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: CR.md,
    backgroundColor: COSMIC.PRIMARY_SOFT,
    borderWidth: 1,
    borderColor: 'rgba(0,95,33,0.2)',
  },
  customSelectedTxt: { flex: 1, fontSize: 13, color: COSMIC.TEXT, fontFamily: CT.family.semibold },
  mutedText: {
    fontSize: 11,
    color: COSMIC.TEXT_3,
    marginTop: 6,
    fontFamily: CT.family.regular,
  },

  // Chips
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: CR.pill,
    borderWidth: 1.2,
    minHeight: 38,
  },
  chipTxt: { fontSize: 12.5, color: COSMIC.TEXT_2, fontFamily: CT.family.semibold },

  // Season tiles
  seasonGrid: { flexDirection: 'row', gap: 8 },
  seasonCard: {
    flex: 1,
    minHeight: 84,
    borderRadius: CR.lg,
    borderWidth: 1.4,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  seasonIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  seasonLabel: { fontSize: 13.5, color: COSMIC.TEXT, fontFamily: CT.family.semibold },
  seasonHint: { fontSize: 10, color: COSMIC.TEXT_3, textAlign: 'center', fontFamily: CT.family.regular },

  // Area
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  areaInput: {
    flex: 1,
    borderWidth: 1.2,
    borderColor: COSMIC.ACCENT + '50',
    backgroundColor: COSMIC.ACCENT_SOFT,
    borderRadius: CR.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 24,
    color: COSMIC.TEXT,
    fontFamily: CT.family.extra,
    textAlign: 'center',
    letterSpacing: 0.6,
  },
  areaUnitPill: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: CR.md,
    backgroundColor: COSMIC.SURFACE_HI,
    borderWidth: 1,
    borderColor: COSMIC.BORDER_HI,
  },
  areaUnitText: { fontSize: 11, color: COSMIC.TEXT_2, fontFamily: CT.family.bold, letterSpacing: 0.6 },

  // Summary
  summaryCard: {
    marginTop: CS.lg,
    borderRadius: CR.lg,
    padding: 14,
    backgroundColor: COSMIC.PRIMARY_SOFT,
    borderWidth: 1,
    borderColor: 'rgba(0,95,33,0.18)',
  },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  summaryIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  summaryTitle: { fontSize: 15, color: COSMIC.TEXT, fontFamily: CT.family.bold, letterSpacing: -0.2 },
  summaryMeta: { fontSize: 12, color: COSMIC.PRIMARY, fontFamily: CT.family.semibold, marginTop: 2, textTransform: 'capitalize' },

  // Footer
  footer: {
    paddingHorizontal: CS.base,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 26 : 16,
    backgroundColor: COSMIC.BG,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COSMIC.BORDER,
  },
});

/**
 * CropCycleCreateScreen — visual crop picker + season + area + seed info.
 *
 * Design goals (spec Part 1–7):
 *   • Pick a crop by illustration, not text list
 *   • Season as 3-tile chooser (Kharif / Rabi / Zaid) with weather icons
 *   • Area input large enough for the farmer's finger
 *   • Seed info collapsible / optional — don't block the "Start" action
 *
 * Preserves the existing farmApi.createCropCycle contract so the backend
 * and downstream screens (CropCycleDetail, MyFarmHome) keep working.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import CosmicScreen from './ui/CosmicScreen';
import CosmicHeader from './ui/CosmicHeader';
import GlassCard    from './ui/GlassCard';
import GlowButton   from './ui/GlowButton';
import CropIcon     from '../../components/CropIcons';
import { useLanguage } from '../../context/LanguageContext';
import { createCropCycle } from '../../services/farmApi';
import { COSMIC, CR, CS, CT, GLOW } from './theme/cosmicTheme';
import { Haptics } from '../../utils/haptics';

// Crop keys aligned with translations.js crops.* and the CropIcon name lookup.
// (CropIcon does its own Title-case mapping, so `soybean` -> Soybean.)
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
  { key: 'KHARIF', label: 'Kharif', icon: 'rainy',        color: COSMIC.INFO,     hint: 'Jun–Oct · monsoon' },
  { key: 'RABI',   label: 'Rabi',   icon: 'snow',         color: '#93C5FD',       hint: 'Nov–Mar · winter' },
  { key: 'ZAID',   label: 'Zaid',   icon: 'sunny',        color: COSMIC.ACCENT,   hint: 'Mar–Jun · summer' },
];

export default function CropCycleCreateScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { farmId } = route.params;

  const [crop, setCrop]         = useState('');
  const [variety, setVariety]   = useState('');
  const [season, setSeason]     = useState('');
  const [area, setArea]         = useState('');
  const [seedBrand, setSeedBrand] = useState('');
  const [seedQty, setSeedQty]   = useState('');
  const [seedCost, setSeedCost] = useState('');
  const [query, setQuery]       = useState('');
  const [saving, setSaving]     = useState(false);

  // ── Crop search (with fuzzy synonyms) ───────────────────────────────────
  const filteredCrops = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CROP_KEYS;
    return CROP_KEYS.filter((k) => {
      const list = CROP_SYNONYMS[k] || [k];
      if (list.some((s) => s.toLowerCase().includes(q))) return true;
      // Also allow matching on the localized label:
      try {
        const loc = t('crops.' + k) || '';
        if (loc.toLowerCase().includes(q)) return true;
      } catch {}
      return false;
    });
  }, [query, t]);

  const cropLabel = crop ? (t('crops.' + crop) || crop) : '';

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
      await createCropCycle(farmId, {
        cropName: crop.charAt(0).toUpperCase() + crop.slice(1),
        variety,
        season,
        year: new Date().getFullYear(),
        areaAllocatedAcres: parseFloat(area),
        seedBrand: seedBrand || null,
        seedQuantityKg: seedQty ? parseFloat(seedQty) : null,
        seedTotalCostInr: seedCost ? parseFloat(seedCost) : null,
      });
      Haptics.success?.();
      navigation.goBack();
    } catch (e) {
      Haptics.error?.();
      // Prefer the server's actual reason (e.g. "Area 2.5 exceeds farm size 2 acres"
      // or a validation message) over axios's opaque "Request failed with status code 400".
      const msg = e.response?.data?.error?.message
        || e.userMessage
        || (t('farmProfile.saveFailed') || 'Save failed.');
      Alert.alert(t('login.error') || 'Error', msg);
    } finally {
      setSaving(false);
    }
  }, [crop, variety, season, area, seedBrand, seedQty, seedCost, farmId, navigation, t]);

  return (
    <CosmicScreen edges={{ top: false, bottom: false }}>
      <CosmicHeader
        title={t('nav.newCropCycle') || 'Start crop cycle'}
        subtitle={cropLabel ? `${cropLabel}${area ? ` · ${area} ac` : ''}` : 'Pick crop, season, area'}
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Crop picker ─────────────────────────────────── */}
          <SectionHeader icon="leaf-outline" tint={COSMIC.PRIMARY_LT} title="Which crop?" />
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
                      style={[styles.cropLabel, sel && { color: COSMIC.PRIMARY_LT, fontFamily: 'Inter_700Bold' }]}
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                    {sel && (
                      <View style={styles.cropCheck}>
                        <Ionicons name="checkmark-circle" size={16} color={COSMIC.PRIMARY_LT} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
              {filteredCrops.length === 0 && (
                <View style={styles.cropEmpty}>
                  <Text style={styles.mutedText}>No crops match "{query}". Tell CropSetu AI and we'll add it.</Text>
                </View>
              )}
            </View>
          </GlassCard>

          {/* ── Season ──────────────────────────────────────── */}
          <SectionHeader icon="calendar-outline" tint={COSMIC.INFO} title="Season" />
          <View style={[styles.section, styles.seasonGrid]}>
            {SEASONS.map((s) => {
              const sel = season === s.key;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => { Haptics.selection?.(); setSeason(s.key); }}
                  style={({ pressed }) => [
                    styles.seasonCard,
                    { borderColor: sel ? s.color : COSMIC.BORDER, backgroundColor: sel ? s.color + '22' : COSMIC.SURFACE },
                    pressed && { transform: [{ scale: 0.97 }] },
                  ]}
                >
                  <View style={[styles.seasonIcon, { backgroundColor: s.color + '28', borderColor: s.color + '55' }]}>
                    <Ionicons name={s.icon} size={22} color={s.color} />
                  </View>
                  <Text style={[styles.seasonLabel, sel && { color: s.color, fontFamily: 'Inter_700Bold' }]}>
                    {s.label}
                  </Text>
                  <Text style={styles.seasonHint} numberOfLines={1}>{s.hint}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── Area ────────────────────────────────────────── */}
          <SectionHeader icon="resize-outline" tint={COSMIC.ACCENT} title="Area allocated" />
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

          {/* ── Variety ─────────────────────────────────────── */}
          <SectionHeader icon="flag-outline" tint={COSMIC.PRIMARY_LT} title="Variety" optional />
          <GlassCard variant="plain" style={styles.section}>
            <TextInput
              value={variety}
              onChangeText={setVariety}
              placeholder={t('farmProfile.varietyPlaceholder') || 'e.g. Rasi 659 Bt'}
              placeholderTextColor={COSMIC.MUTED}
              style={styles.input}
              autoCapitalize="words"
            />
          </GlassCard>

          {/* ── Seed info ───────────────────────────────────── */}
          <SectionHeader icon="pricetag-outline" tint={COSMIC.ACCENT} title="Seed details" optional />
          <GlassCard variant="plain" style={styles.section}>
            <TextInput
              value={seedBrand}
              onChangeText={setSeedBrand}
              placeholder={t('farmProfile.seedBrandPlaceholder') || 'Seed brand / source'}
              placeholderTextColor={COSMIC.MUTED}
              style={[styles.input, { marginBottom: 10 }]}
            />
            <View style={styles.row2}>
              <TextInput
                value={seedQty}
                onChangeText={setSeedQty}
                placeholder={t('farmProfile.seedQtyPlaceholder') || 'Qty (kg)'}
                placeholderTextColor={COSMIC.MUTED}
                keyboardType="decimal-pad"
                style={[styles.input, { flex: 1 }]}
              />
              <TextInput
                value={seedCost}
                onChangeText={setSeedCost}
                placeholder={t('farmProfile.seedCostPlaceholder') || 'Cost (₹)'}
                placeholderTextColor={COSMIC.MUTED}
                keyboardType="numeric"
                style={[styles.input, { flex: 1 }]}
              />
            </View>
          </GlassCard>

          <View style={{ height: 12 }} />
        </ScrollView>

        {/* ── Footer ─────────────────────────────────────── */}
        <View style={styles.footer}>
          <GlowButton
            label={saving ? 'Starting…' : (t('farmProfile.startCropCycle') || 'Start cycle')}
            icon="play-circle-outline"
            variant="primary"
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
// Section header
// ──────────────────────────────────────────────────────────────────────────────
function SectionHeader({ icon, tint, title, optional }) {
  return (
    <View style={styles.secHeader}>
      <View style={[styles.secIcon, { backgroundColor: tint + '28', borderColor: tint + '55' }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text style={styles.secTitle}>{title}</Text>
      {optional && <Text style={styles.optional}>Optional</Text>}
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: CS.base,
    paddingTop: CS.sm,
    paddingBottom: 100,
  },

  secHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: CS.base,
    marginBottom: 6,
  },
  secIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secTitle: {
    fontSize: 14,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_700Bold',
    flex: 1,
  },
  optional: {
    fontSize: 10,
    color: COSMIC.TEXT_3,
    fontFamily: 'Inter_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  section: { marginBottom: 2 },

  input: {
    borderWidth: 1.2,
    borderColor: COSMIC.BORDER_HI,
    borderRadius: CR.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    fontSize: 14,
    color: COSMIC.TEXT,
    backgroundColor: COSMIC.SURFACE,
    fontFamily: 'Inter_500Medium',
    minHeight: 44,
  },
  row2: { flexDirection: 'row', gap: 10 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: CR.md,
    backgroundColor: COSMIC.SURFACE_HI,
    borderWidth: 1,
    borderColor: COSMIC.BORDER,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: COSMIC.TEXT,
    padding: 0,
    fontFamily: 'Inter_500Medium',
  },

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
  cropCardSel: {
    borderColor: COSMIC.PRIMARY,
    backgroundColor: COSMIC.PRIMARY_SOFT,
  },
  cropIconWrap: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cropLabel: {
    fontSize: 9,
    color: COSMIC.TEXT_2,
    textAlign: 'center',
    marginTop: 2,
    fontFamily: 'Inter_600SemiBold',
  },
  cropCheck: { position: 'absolute', top: 2, right: 2 },
  cropEmpty: { padding: 16, alignItems: 'center', width: '100%' },
  mutedText: {
    fontSize: 11,
    color: COSMIC.TEXT_3,
    marginTop: 6,
    textAlign: 'center',
    fontFamily: 'Inter_400Regular',
  },

  // Season tiles
  seasonGrid: { flexDirection: 'row', gap: 8 },
  seasonCard: {
    flex: 1,
    minHeight: 78,
    borderRadius: CR.md,
    borderWidth: 1.2,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  seasonIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  seasonLabel: { fontSize: 13, color: COSMIC.TEXT, fontFamily: 'Inter_600SemiBold' },
  seasonHint: { fontSize: 10, color: COSMIC.TEXT_3, textAlign: 'center', fontFamily: 'Inter_400Regular' },

  // Area
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  areaInput: {
    flex: 1,
    borderWidth: 1.2,
    borderColor: COSMIC.ACCENT + '40',
    backgroundColor: COSMIC.ACCENT_SOFT,
    borderRadius: CR.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 22,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_800ExtraBold',
    textAlign: 'center',
    letterSpacing: 0.6,
  },
  areaUnitPill: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: CR.md,
    backgroundColor: COSMIC.SURFACE_HI,
    borderWidth: 1,
    borderColor: COSMIC.BORDER_HI,
  },
  areaUnitText: {
    fontSize: 11,
    color: COSMIC.TEXT_2,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.6,
  },

  // Footer
  footer: {
    paddingHorizontal: CS.base,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
    backgroundColor: COSMIC.BG,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COSMIC.BORDER,
  },
});

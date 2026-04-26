/**
 * FarmAddEditScreen — progressive add/edit form (cosmic theme).
 *
 * Sections:
 *   1. Identity  — farm name (the only "write" field; rest are pickers / taps)
 *   2. Location  — state / district / taluka / village / pincode / GPS
 *   3. Land & soil — size input + horizontal soil swatches
 *   4. Water   — 4-tile irrigation method picker
 *
 * Design goals from spec Part 10:
 *   • Day 1 asks the 5 critical fields; extras remain optional
 *   • Every concept has a visual representation before any word
 *   • Regional-unit-aware (default acre; room for bigha/guntha in v2)
 *   • Save button anchored at bottom, 56dp+, gradient + glow
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
// LinearGradient still used for the soil swatch tiles

import CosmicScreen from './ui/CosmicScreen';
import CosmicHeader from './ui/CosmicHeader';
import CosmicPicker from './ui/CosmicPicker';
import GlassCard    from './ui/GlassCard';
import GlowButton   from './ui/GlowButton';
import { STATE_LIST, getDistrictsForState, getTalukas } from '../../constants/locations';
import SoilIcon       from '../../components/SoilIcons';
import IrrigationIcon from '../../components/IrrigationIcons';
import { useMultiFarm } from '../../context/MultiFarmContext';
import { useLanguage }  from '../../context/LanguageContext';
import { COSMIC, CR, CS, CT, GLOW, GRADIENT } from './theme/cosmicTheme';
import { Haptics } from '../../utils/haptics';

// Soil swatches — earth gradients keyed to the Prisma SoilType enum.
const SOILS = [
  { key: 'BLACK_COTTON', label: 'Black cotton', sk: 'black',    bg: ['#4B3B32', '#1E1611'] },
  { key: 'RED',          label: 'Red',          sk: 'red',      bg: ['#D66842', '#8B3520'] },
  { key: 'ALLUVIAL',     label: 'Alluvial',     sk: 'alluvial', bg: ['#E2B576', '#B8935A'] },
  { key: 'SANDY',        label: 'Sandy',        sk: 'sandy',    bg: ['#F1D69F', '#C9B07A'] },
  { key: 'CLAY_LOAM',    label: 'Clay loam',    sk: 'clay',     bg: ['#A38E7A', '#6B5D4B'] },
  { key: 'LATERITE',     label: 'Laterite',     sk: 'laterite', bg: ['#E08A3C', '#A0522D'] },
  { key: 'UNKNOWN',      label: 'Not sure',     sk: null,       bg: ['#4B4A47', '#2A2927'] },
];

const IRRS = [
  { key: 'DRIP',      label: 'Drip',      ik: 'drip',      color: '#60A5FA' },
  { key: 'SPRINKLER', label: 'Sprinkler', ik: 'sprinkler', color: '#38BDF8' },
  { key: 'FLOOD',     label: 'Flood',     ik: 'flood',     color: '#A7E4F1' },
  { key: 'RAINFED',   label: 'Rainfed',   ik: 'rainfed',   color: '#F5B841' },
];

export default function FarmAddEditScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { addFarm, editFarm } = useMultiFarm();
  const existing = route.params?.farm;
  const isEdit = !!existing;

  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    farmName:         existing?.farmName         || '',
    state:            existing?.state            || 'Maharashtra',
    district:         existing?.district         || '',
    taluka:           existing?.taluka           || '',
    village:          existing?.village          || '',
    pincode:          existing?.pincode          || '',
    latitude:         existing?.latitude         || null,
    longitude:        existing?.longitude        || null,
    landSizeAcres:    existing?.landSizeAcres?.toString() || '',
    soilType:         existing?.soilType         || 'UNKNOWN',
    irrigationSystem: existing?.irrigationSystem || 'RAINFED',
  });

  const u = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // ── GPS capture ─────────────────────────────────────────────────────────
  const captureGPS = useCallback(async () => {
    Haptics.light?.();
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('farmProfile.gpsErrorTitle') || 'Location permission', 'Please enable location to drop your farm pin.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      u('latitude',  loc.coords.latitude);
      u('longitude', loc.coords.longitude);
      Haptics.success?.();
    } catch {
      Alert.alert(t('farmProfile.gpsErrorTitle') || 'GPS error', t('farmProfile.gpsErrorMsg') || 'Could not read location. Try again outdoors.');
    }
  }, [t]);

  // ── Save ────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!form.landSizeAcres || parseFloat(form.landSizeAcres) <= 0) {
      Haptics.error?.();
      Alert.alert(t('farmProfile.requiredTitle') || 'Land size required', t('farmProfile.landRequired') || 'Please enter the total land size in acres.');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) await editFarm(existing.id, form);
      else        await addFarm(form);
      Haptics.success?.();
      navigation.goBack();
    } catch (e) {
      Haptics.error?.();
      Alert.alert(t('login.error') || 'Error', e.message || (t('farmProfile.saveFailed') || 'Save failed.'));
    } finally {
      setSaving(false);
    }
  }, [form, isEdit, existing, addFarm, editFarm, navigation, t]);

  return (
    <CosmicScreen backgroundVariant="default" edges={{ top: false, bottom: false }}>
      <CosmicHeader
        title={isEdit ? (t('nav.editFarm') || 'Edit farm') : (t('nav.addFarm') || 'Add farm')}
        subtitle={isEdit ? 'Update farm details' : 'Takes under 3 minutes'}
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── 1. Identity ─────────────────────────────────────────────── */}
          <SectionCard icon="leaf-outline" iconTint={COSMIC.PRIMARY_LT} title="Farm identity">
            <Field label="Farm nickname">
              <CosmicInput
                value={form.farmName}
                onChangeText={(v) => u('farmName', v)}
                placeholder={t('farmProfile.farmNamePlaceholder') || 'e.g. Gavran shet, Road-side plot'}
                autoCapitalize="words"
              />
            </Field>
          </SectionCard>

          {/* ── 2. Location ─────────────────────────────────────────────── */}
          <SectionCard icon="location-outline" iconTint={COSMIC.INFO} title="Location">
            <Field label={t('farmProfile.state') || 'State'}>
              <CosmicPicker
                title={t('farmProfile.selectState') || 'Select state'}
                items={STATE_LIST}
                selected={form.state}
                onSelect={(v) => { u('state', v); u('district', ''); u('taluka', ''); }}
                placeholder={t('farmProfile.selectStatePlaceholder') || 'Choose state'}
              />
            </Field>

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Field label={t('farmProfile.district') || 'District'}>
                  <CosmicPicker
                    title={t('farmProfile.districtTitle') || 'District'}
                    items={getDistrictsForState(form.state)}
                    selected={form.district}
                    onSelect={(v) => { u('district', v); u('taluka', ''); }}
                    placeholder={t('farmProfile.selectPlaceholder') || 'Choose'}
                    disabled={!form.state}
                  />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label={t('farmProfile.taluka') || 'Taluka'}>
                  <CosmicPicker
                    title={t('farmProfile.taluka') || 'Taluka'}
                    items={form.state === 'Maharashtra' ? getTalukas(form.district) : []}
                    selected={form.taluka}
                    onSelect={(v) => u('taluka', v)}
                    placeholder={form.state === 'Maharashtra'
                      ? (t('farmProfile.selectPlaceholder') || 'Choose')
                      : (t('farmProfile.typeBelow') || 'Type below')}
                    disabled={form.state === 'Maharashtra' ? !form.district : true}
                  />
                </Field>
              </View>
            </View>

            {form.state !== 'Maharashtra' && (
              <Field label={t('farmProfile.taluka') || 'Taluka'}>
                <CosmicInput
                  value={form.taluka}
                  onChangeText={(v) => u('taluka', v)}
                  placeholder={t('farmProfile.talukaPlaceholder') || 'Type taluka'}
                />
              </Field>
            )}

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Field label={t('farmProfile.village') || 'Village'}>
                  <CosmicInput
                    value={form.village}
                    onChangeText={(v) => u('village', v)}
                    placeholder={t('farmProfile.villagePlaceholder') || 'Village name'}
                    autoCapitalize="words"
                  />
                </Field>
              </View>
              <View style={{ width: 120 }}>
                <Field label={t('farmProfile.pincode') || 'Pincode'}>
                  <CosmicInput
                    value={form.pincode}
                    onChangeText={(v) => u('pincode', v)}
                    placeholder={t('farmProfile.pincodePlaceholder') || '6-digit'}
                    keyboardType="numeric"
                    maxLength={6}
                  />
                </Field>
              </View>
            </View>

            <Pressable
              onPress={captureGPS}
              style={({ pressed }) => [
                styles.gpsBtn,
                form.latitude != null && styles.gpsBtnActive,
                pressed && { opacity: 0.8 },
              ]}
            >
              <Ionicons
                name={form.latitude != null ? 'checkmark-circle' : 'navigate'}
                size={18}
                color={form.latitude != null ? COSMIC.PRIMARY_LT : COSMIC.ACCENT}
              />
              <Text style={styles.gpsText} numberOfLines={1}>
                {form.latitude != null
                  ? `Pin set · ${form.latitude.toFixed(4)}, ${form.longitude.toFixed(4)}`
                  : (t('farmProfile.captureGps') || 'Drop a GPS pin on this farm')}
              </Text>
            </Pressable>
          </SectionCard>

          {/* ── 3. Land & soil ──────────────────────────────────────────── */}
          <SectionCard icon="layers-outline" iconTint={COSMIC.ACCENT} title="Land & soil">
            <Field label={t('farmProfile.landSizeLabel') || 'Total land size (acres)'}>
              <CosmicInput
                value={form.landSizeAcres}
                onChangeText={(v) => u('landSizeAcres', v)}
                placeholder={t('farmProfile.landSizePlaceholder') || '2.5'}
                keyboardType="decimal-pad"
                style={styles.landInput}
              />
            </Field>

            <Text style={styles.subLabel}>Soil type</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.soilRail}
            >
              {SOILS.map((soil) => {
                const selected = form.soilType === soil.key;
                return (
                  <Pressable
                    key={soil.key}
                    onPress={() => { Haptics.selection?.(); u('soilType', soil.key); }}
                    style={styles.soilCol}
                  >
                    <View style={[styles.soilTile, selected && styles.soilTileSel]}>
                      <LinearGradient
                        colors={soil.bg}
                        start={GRADIENT.start}
                        end={GRADIENT.end}
                        style={StyleSheet.absoluteFill}
                      />
                      <View style={styles.soilIconWrap}>
                        {soil.sk ? <SoilIcon type={soil.sk} size={36} /> : <Ionicons name="help" size={28} color="#FFF" />}
                      </View>
                      {selected && (
                        <View style={styles.soilCheck}>
                          <Ionicons name="checkmark-circle" size={18} color={COSMIC.INVERSE} />
                        </View>
                      )}
                    </View>
                    <Text style={[styles.soilLabel, selected && { color: COSMIC.PRIMARY_LT, fontFamily: 'Inter_700Bold' }]} numberOfLines={2}>
                      {soil.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </SectionCard>

          {/* ── 4. Water ────────────────────────────────────────────────── */}
          <SectionCard icon="water-outline" iconTint={COSMIC.INFO} title="Water source">
            <View style={styles.irrGrid}>
              {IRRS.map((irr) => {
                const selected = form.irrigationSystem === irr.key;
                return (
                  <Pressable
                    key={irr.key}
                    onPress={() => { Haptics.selection?.(); u('irrigationSystem', irr.key); }}
                    style={({ pressed }) => [
                      styles.irrCard,
                      { borderColor: selected ? irr.color : COSMIC.BORDER, backgroundColor: selected ? irr.color + '22' : COSMIC.SURFACE },
                      pressed && { transform: [{ scale: 0.97 }] },
                    ]}
                  >
                    <View style={[styles.irrIconWrap, { backgroundColor: irr.color + '28' }]}>
                      {irr.ik
                        ? <IrrigationIcon type={irr.ik} size={30} />
                        : <Ionicons name="options" size={22} color={irr.color} />}
                    </View>
                    <Text style={[styles.irrLabel, selected && { color: irr.color, fontFamily: 'Inter_700Bold' }]}>
                      {irr.label}
                    </Text>
                    {selected && (
                      <View style={[styles.irrCheck, { backgroundColor: irr.color }]}>
                        <Ionicons name="checkmark" size={12} color={COSMIC.INVERSE} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </SectionCard>

          <View style={{ height: 12 }} />
        </ScrollView>

        {/* ── Save footer ────────────────────────────────────────────── */}
        <View style={styles.footer}>
          <GlowButton
            label={saving ? 'Saving…' : (isEdit ? (t('farmProfile.updateFarm') || 'Update farm') : (t('farmProfile.saveFarm') || 'Save farm'))}
            icon={isEdit ? 'checkmark' : 'add-circle-outline'}
            variant="primary"
            loading={saving}
            full
            onPress={handleSave}
          />
        </View>
      </KeyboardAvoidingView>
    </CosmicScreen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Building blocks
// ──────────────────────────────────────────────────────────────────────────────

function SectionCard({ icon, iconTint, title, children }) {
  return (
    <GlassCard variant="plain" style={styles.section}>
      <View style={styles.secHeader}>
        <View style={[styles.secIcon, { backgroundColor: iconTint + '28', borderColor: iconTint + '55' }]}>
          <Ionicons name={icon} size={16} color={iconTint} />
        </View>
        <Text style={styles.secTitle}>{title}</Text>
      </View>
      {children}
    </GlassCard>
  );
}

function Field({ label, children }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function CosmicInput({ style, ...props }) {
  return (
    <TextInput
      placeholderTextColor={COSMIC.MUTED}
      {...props}
      style={[styles.input, style]}
    />
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

  section: { marginBottom: 10 },
  secHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  secIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secTitle: { fontSize: 14, color: COSMIC.TEXT, fontFamily: 'Inter_700Bold' },

  // Inputs
  label: {
    fontSize: 11,
    color: COSMIC.TEXT_2,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 4,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  subLabel: {
    fontSize: 11,
    color: COSMIC.TEXT_2,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 10,
    marginBottom: 6,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
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
  landInput: {
    fontSize: 18,
    fontFamily: 'Inter_800ExtraBold',
    textAlign: 'center',
    letterSpacing: 0.4,
  },
  row2: { flexDirection: 'row', gap: 10 },

  // GPS
  gpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: CR.md,
    borderWidth: 1.2,
    borderColor: COSMIC.ACCENT + '55',
    borderStyle: 'dashed',
    backgroundColor: COSMIC.ACCENT_SOFT,
  },
  gpsBtnActive: {
    borderColor: COSMIC.PRIMARY + '55',
    backgroundColor: COSMIC.PRIMARY_SOFT,
    borderStyle: 'solid',
  },
  gpsText: { fontSize: 12, color: COSMIC.TEXT, fontFamily: 'Inter_600SemiBold', flex: 1 },

  // Soil
  soilRail: { paddingVertical: 2, gap: 8 },
  soilCol: { alignItems: 'center', width: 64 },
  soilTile: {
    width: 56,
    height: 56,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COSMIC.BORDER_HI,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soilTileSel: {
    borderWidth: 2,
    borderColor: COSMIC.PRIMARY,
  },
  soilIconWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  soilCheck: { position: 'absolute', top: 2, right: 2 },
  soilLabel: {
    fontSize: 10,
    color: COSMIC.TEXT_2,
    textAlign: 'center',
    marginTop: 4,
    fontFamily: 'Inter_600SemiBold',
  },

  // Irrigation
  irrGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  irrCard: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 78,
    borderRadius: CR.md,
    borderWidth: 1.2,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    position: 'relative',
  },
  irrIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  irrLabel: { fontSize: 12, color: COSMIC.TEXT, fontFamily: 'Inter_600SemiBold' },
  irrCheck: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
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

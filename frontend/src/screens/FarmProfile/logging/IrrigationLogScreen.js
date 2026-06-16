/**
 * IrrigationLogScreen — 3-field irrigation log.
 *
 * Fields (following spec Part 5.2 §C):
 *   • Method — Drip / Sprinkler / Flood / Rain gun  (tile picker)
 *   • Duration (h)  OR  Volume (L) — farmer picks whichever is easier
 *   • Water source — Borewell / Open well / Canal / Pond / Tanker (chip)
 *   • Soil moisture before — Dry / Moist / Wet (stoplight)
 *
 * The "same as yesterday" one-tap sits under the method picker, mimicking
 * Part 7 #2 (one-tap repeat — most activities repeat).
 *
 * Persistence: calls farmApi.addIrrigationLog against the current cycle so
 * this screen works with today's backend. When v2 lands, swap to
 * POST /plots/:plotId/activities with type=IRRIGATION.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import CosmicScreen from '../ui/CosmicScreen';
import CosmicHeader from '../ui/CosmicHeader';
import GlassCard    from '../ui/GlassCard';
import GlowButton   from '../ui/GlowButton';
import CelebrationSheet from '../ui/CelebrationSheet';
import IrrigationIcon from '../../../components/IrrigationIcons';
import * as farmApi from '../../../services/farmApi';
import { useLanguage } from '../../../context/LanguageContext';
import { useMultiFarm } from '../../../context/MultiFarmContext';
import { COSMIC, CR, CS, CT, GLOW, GRADIENT } from '../theme/cosmicTheme';
import { Haptics } from '../../../utils/haptics';

const METHODS = [
  { key: 'DRIP',       icon: 'drip',       color: COSMIC.IRRIGATION },
  { key: 'SPRINKLER',  icon: 'sprinkler',  color: '#38BDF8' },
  { key: 'FLOOD',      icon: 'flood',      color: '#93C5FD' },
  { key: 'RAIN_GUN',   icon: 'sprinkler',  color: '#A7E4F1' },
];

const SOURCES = [
  { key: 'BOREWELL',  icon: 'water-outline' },
  { key: 'OPEN_WELL', icon: 'ellipse-outline' },
  { key: 'CANAL',     icon: 'remove-outline' },
  { key: 'POND',      icon: 'water' },
  { key: 'TANKER',    icon: 'car-outline' },
];

const MOISTURES = [
  { key: 'DRY',   color: COSMIC.DANGER },
  { key: 'MOIST', color: COSMIC.ACCENT },
  { key: 'WET',   color: COSMIC.PRIMARY_LT },
];

export default function IrrigationLogScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { activeFarm } = useMultiFarm();
  const { farmId, cycleId } = route.params || {};

  const [method, setMethod]         = useState(null);
  const [durationHours, setDur]     = useState('');
  const [volumeLitres, setVol]      = useState('');
  const [entryMode, setEntryMode]   = useState('duration'); // 'duration' | 'volume'
  const [waterSource, setSource]    = useState(null);
  const [moistureBefore, setMoist]  = useState(null);
  const [fertigation, setFertigation] = useState(false);
  const [notes, setNotes]           = useState('');
  const [saving, setSaving]         = useState(false);
  const [celebrate, setCelebrate]   = useState(false);

  const methods   = METHODS.map((m) => ({ ...m, label: t(`irrigationLog.method_${m.key}`) }));
  const sources   = SOURCES.map((s) => ({ ...s, label: t(`irrigationLog.source_${s.key}`) }));
  const moistures = MOISTURES.map((m) => ({ ...m, label: t(`irrigationLog.moisture_${m.key}`) }));

  const canSave = useMemo(() => {
    if (!method) return false;
    if (entryMode === 'duration' && !durationHours) return false;
    if (entryMode === 'volume' && !volumeLitres) return false;
    return true;
  }, [method, entryMode, durationHours, volumeLitres]);

  // ── Save handler ────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!canSave) {
      Haptics.error?.();
      Alert.alert(t('irrigationLog.missingInfoTitle'), t('irrigationLog.missingInfoBody'));
      return;
    }
    if (!cycleId) {
      // v2 backend accepts plotId alone; legacy backend requires cycleId.
      Alert.alert(t('irrigationLog.pickCycleTitle'), t('irrigationLog.pickCycleBody'));
      return;
    }
    setSaving(true);
    try {
      await farmApi.addIrrigationLog(cycleId, {
        method: method.key,
        durationHours: entryMode === 'duration' ? parseFloat(durationHours) : null,
        volumeLitres:  entryMode === 'volume'   ? parseFloat(volumeLitres)  : null,
        waterSource:   waterSource?.key || null,
        soilMoistureBefore: moistureBefore?.key || null,
        fertigationDone: fertigation,
        notes: notes || null,
        date: new Date().toISOString(),
      });
      Haptics.success?.();
      setCelebrate(true);
    } catch (e) {
      Haptics.error?.();
      Alert.alert(t('login.error') || t('irrigationLog.errorTitle'), e.message || t('irrigationLog.couldNotSave'));
    } finally {
      setSaving(false);
    }
  }, [canSave, cycleId, method, entryMode, durationHours, volumeLitres, waterSource, moistureBefore, fertigation, notes, t]);

  const subtitle = activeFarm
    ? `${activeFarm.farmName || activeFarm.farmAlias || t('irrigationLog.farmFallback')}${cycleId ? ` · ${t('irrigationLog.activeCycle')}` : ''}`
    : undefined;

  return (
    <CosmicScreen edges={{ top: false, bottom: false }}>
      <CosmicHeader title={t('irrigationLog.title')} subtitle={subtitle} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── 1. Method ───────────────────────────────────── */}
          <SectionHeader icon="water-outline" tint={COSMIC.IRRIGATION} title={t('irrigationLog.sectionMethod')} />
          <View style={styles.methodGrid}>
            {methods.map((m) => {
              const sel = method?.key === m.key;
              return (
                <Pressable
                  key={m.key}
                  onPress={() => { Haptics.selection?.(); setMethod(m); }}
                  style={({ pressed }) => [
                    styles.methodCard,
                    {
                      borderColor: sel ? m.color : COSMIC.BORDER,
                      backgroundColor: sel ? m.color + '22' : COSMIC.SURFACE,
                    },
                    pressed && { transform: [{ scale: 0.97 }] },
                  ]}
                >
                  <View style={[styles.methodIcon, { backgroundColor: m.color + '33', borderColor: m.color + '55' }]}>
                    <IrrigationIcon type={m.icon} size={32} />
                  </View>
                  <Text style={[styles.methodLabel, sel && { color: m.color, fontFamily: 'Inter_700Bold' }]}>
                    {m.label}
                  </Text>
                  {sel && (
                    <View style={[styles.methodCheck, { backgroundColor: m.color }]}>
                      <Ionicons name="checkmark" size={12} color={COSMIC.INVERSE} />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>

          {/* ── 2. Duration or Volume ───────────────────────── */}
          <SectionHeader icon="time-outline" tint={COSMIC.ACCENT} title={t('irrigationLog.sectionHowMuch')} />
          <GlassCard variant="plain" style={styles.section}>
            <View style={styles.toggleRow}>
              <Pressable
                onPress={() => { Haptics.selection?.(); setEntryMode('duration'); }}
                style={[styles.toggleBtn, entryMode === 'duration' && styles.toggleBtnActive]}
              >
                <Ionicons name="time-outline" size={16} color={entryMode === 'duration' ? COSMIC.INVERSE : COSMIC.TEXT_2} />
                <Text style={[styles.toggleText, entryMode === 'duration' && styles.toggleTextActive]}>{t('irrigationLog.unitHours')}</Text>
              </Pressable>
              <Pressable
                onPress={() => { Haptics.selection?.(); setEntryMode('volume'); }}
                style={[styles.toggleBtn, entryMode === 'volume' && styles.toggleBtnActive]}
              >
                <Ionicons name="beaker-outline" size={16} color={entryMode === 'volume' ? COSMIC.INVERSE : COSMIC.TEXT_2} />
                <Text style={[styles.toggleText, entryMode === 'volume' && styles.toggleTextActive]}>{t('irrigationLog.unitLitres')}</Text>
              </Pressable>
            </View>

            <View style={styles.bigInputRow}>
              <TextInput
                value={entryMode === 'duration' ? durationHours : volumeLitres}
                onChangeText={entryMode === 'duration' ? setDur : setVol}
                placeholder={entryMode === 'duration' ? '3.5' : '1200'}
                placeholderTextColor={COSMIC.MUTED}
                keyboardType="decimal-pad"
                style={styles.bigInput}
              />
              <View style={styles.unitPill}>
                <Text style={styles.unitText}>{entryMode === 'duration' ? t('irrigationLog.unitHoursUpper') : t('irrigationLog.unitLitresUpper')}</Text>
              </View>
            </View>
          </GlassCard>

          {/* ── 3. Water source ─────────────────────────────── */}
          <SectionHeader icon="leaf-outline" tint={COSMIC.INFO} title={t('irrigationLog.sectionSource')} optional optionalLabel={t('irrigationLog.optional')} />
          <View style={[styles.section, styles.chipRow]}>
            {sources.map((s) => {
              const sel = waterSource?.key === s.key;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => { Haptics.selection?.(); setSource(sel ? null : s); }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: sel ? COSMIC.INFO_SOFT : COSMIC.SURFACE,
                      borderColor:     sel ? COSMIC.INFO : COSMIC.BORDER,
                    },
                  ]}
                >
                  <Ionicons name={s.icon} size={16} color={sel ? COSMIC.INFO : COSMIC.TEXT_2} />
                  <Text style={[styles.chipText, sel && { color: COSMIC.INFO, fontFamily: 'Inter_700Bold' }]}>
                    {s.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── 4. Moisture before ──────────────────────────── */}
          <SectionHeader icon="analytics-outline" tint={COSMIC.PRIMARY_LT} title={t('irrigationLog.sectionMoisture')} optional optionalLabel={t('irrigationLog.optional')} />
          <View style={[styles.section, styles.moistRow]}>
            {moistures.map((m) => {
              const sel = moistureBefore?.key === m.key;
              return (
                <Pressable
                  key={m.key}
                  onPress={() => { Haptics.selection?.(); setMoist(sel ? null : m); }}
                  style={[
                    styles.moistCard,
                    {
                      borderColor: sel ? m.color : COSMIC.BORDER,
                      backgroundColor: sel ? m.color + '22' : COSMIC.SURFACE,
                    },
                  ]}
                >
                  <View style={[styles.moistDot, { backgroundColor: m.color }]} />
                  <Text style={[styles.moistLabel, sel && { color: m.color, fontFamily: 'Inter_700Bold' }]}>
                    {m.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── 5. Fertigation + notes ─────────────────────── */}
          <SectionHeader icon="flask-outline" tint={COSMIC.FERTILIZER} title={t('irrigationLog.sectionExtras')} optional optionalLabel={t('irrigationLog.optional')} />
          <GlassCard variant="plain" style={styles.section}>
            <Pressable
              onPress={() => { Haptics.selection?.(); setFertigation((v) => !v); }}
              style={styles.fertRow}
            >
              <View style={[styles.checkbox, fertigation && styles.checkboxChecked]}>
                {fertigation && <Ionicons name="checkmark" size={14} color={COSMIC.INVERSE} />}
              </View>
              <Text style={styles.fertText}>{t('irrigationLog.fertigationLabel')}</Text>
            </Pressable>

            <Text style={styles.subLabel}>{t('irrigationLog.notes')}</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder={t('irrigationLog.notesPlaceholder')}
              placeholderTextColor={COSMIC.MUTED}
              style={[styles.input, { minHeight: 88, textAlignVertical: 'top' }]}
              multiline
            />
          </GlassCard>

          <View style={{ height: 12 }} />
        </ScrollView>

        <View style={styles.footer}>
          <GlowButton
            label={saving ? t('irrigationLog.saving') : t('irrigationLog.title')}
            icon="water"
            variant="primary"
            full
            loading={saving}
            disabled={!canSave}
            onPress={handleSave}
          />
        </View>
      </KeyboardAvoidingView>

      <CelebrationSheet
        visible={celebrate}
        title={t('irrigationLog.celebrateTitle')}
        subtitle={t('irrigationLog.celebrateSubtitle')}
        streakDays={1}
        onClose={() => { setCelebrate(false); navigation.goBack(); }}
      />
    </CosmicScreen>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared bits
// ──────────────────────────────────────────────────────────────────────────────
function SectionHeader({ icon, tint, title, optional, optionalLabel }) {
  return (
    <View style={styles.secHeader}>
      <View style={[styles.secIcon, { backgroundColor: tint + '28', borderColor: tint + '55' }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text style={styles.secTitle}>{title}</Text>
      {optional && <Text style={styles.optional}>{optionalLabel || 'Optional'}</Text>}
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
  secTitle: { fontSize: 14, color: COSMIC.TEXT, fontFamily: 'Inter_700Bold', flex: 1 },
  optional: {
    fontSize: 10,
    color: COSMIC.TEXT_3,
    fontFamily: 'Inter_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  section: { marginBottom: 2 },

  // Method tiles
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodCard: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 88,
    borderRadius: CR.md,
    borderWidth: 1.2,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    position: 'relative',
  },
  methodIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodLabel: { fontSize: 13, color: COSMIC.TEXT, fontFamily: 'Inter_600SemiBold' },
  methodCheck: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Toggle
  toggleRow: {
    flexDirection: 'row',
    gap: 6,
    padding: 3,
    borderRadius: CR.md,
    backgroundColor: COSMIC.SURFACE_HI,
    borderWidth: 1,
    borderColor: COSMIC.BORDER,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: CR.sm,
  },
  toggleBtnActive: { backgroundColor: COSMIC.PRIMARY },
  toggleText: { fontSize: 12, color: COSMIC.TEXT_2, fontFamily: 'Inter_600SemiBold' },
  toggleTextActive: { color: COSMIC.INVERSE, fontFamily: 'Inter_700Bold' },

  // Big input
  bigInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  bigInput: {
    flex: 1,
    borderWidth: 1.2,
    borderColor: COSMIC.IRRIGATION + '40',
    backgroundColor: COSMIC.INFO_SOFT,
    borderRadius: CR.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 24,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_800ExtraBold',
    textAlign: 'center',
    letterSpacing: 0.6,
  },
  unitPill: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: CR.md,
    backgroundColor: COSMIC.SURFACE_HI,
    borderWidth: 1,
    borderColor: COSMIC.BORDER_HI,
  },
  unitText: {
    fontSize: 11,
    color: COSMIC.TEXT_2,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.6,
  },

  // Chip row
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: CR.pill,
    borderWidth: 1.2,
    minHeight: 32,
  },
  chipText: { fontSize: 12, color: COSMIC.TEXT, fontFamily: 'Inter_600SemiBold' },

  // Moisture stoplight
  moistRow: { flexDirection: 'row', gap: 8 },
  moistCard: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: CR.md,
    borderWidth: 1.2,
    alignItems: 'center',
    gap: 4,
    minHeight: 52,
    justifyContent: 'center',
  },
  moistDot: { width: 10, height: 10, borderRadius: 5 },
  moistLabel: { fontSize: 12, color: COSMIC.TEXT, fontFamily: 'Inter_600SemiBold' },

  // Fertigation row
  fertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    marginBottom: 2,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: COSMIC.BORDER_HI,
    backgroundColor: COSMIC.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: COSMIC.PRIMARY, borderColor: COSMIC.PRIMARY },
  fertText: { fontSize: 13, color: COSMIC.TEXT, flex: 1, fontFamily: 'Inter_400Regular' },

  // Notes
  subLabel: {
    fontSize: 11,
    color: COSMIC.TEXT_2,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 10,
    marginBottom: 4,
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

  // Footer
  footer: {
    paddingHorizontal: CS.base,
    paddingTop: CS.base,
    paddingBottom: Platform.OS === 'ios' ? 32 : 20,
  },
});

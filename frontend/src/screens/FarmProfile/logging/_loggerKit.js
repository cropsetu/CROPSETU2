/**
 * _loggerKit.js — shared scaffold + form primitives for the MyFarm activity
 * loggers, distilled from IrrigationLogScreen so every logger looks and behaves
 * identically (cosmic styling, haptics, validation footer, celebration).
 *
 * Each logger screen composes <LoggerScaffold> + a few primitives:
 *   <LoggerScaffold title footer canSave onSave celebrate ...>
 *     <SectionHeader .../>
 *     <TileGrid items value onChange/>
 *     <ChipRow .../>  <BigNumberInput .../>  <LabeledInput .../>  <NotesField .../>
 *   </LoggerScaffold>
 */
import React from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import CosmicScreen from '../ui/CosmicScreen';
import CosmicHeader from '../ui/CosmicHeader';
import GlassCard from '../ui/GlassCard';
import GlowButton from '../ui/GlowButton';
import CelebrationSheet from '../ui/CelebrationSheet';
import { COSMIC, CR, CS } from '../theme/cosmicTheme';
import { Haptics } from '../../../utils/haptics';

export function SectionHeader({ icon, tint = COSMIC.PRIMARY, title, optional }) {
  return (
    <View style={k.secHeader}>
      <View style={[k.secIcon, { backgroundColor: tint + '28', borderColor: tint + '55' }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text style={k.secTitle}>{title}</Text>
      {optional && <Text style={k.optional}>Optional</Text>}
    </View>
  );
}

/** Single-select tile grid. items: [{key,label,icon,color}] */
export function TileGrid({ items, value, onChange, columns = 2 }) {
  const basis = columns === 3 ? '31%' : '47%';
  return (
    <View style={k.tileGrid}>
      {items.map((it) => {
        const sel = value === it.key;
        const color = it.color || COSMIC.PRIMARY;
        return (
          <Pressable
            key={it.key}
            onPress={() => { Haptics.selection?.(); onChange(sel ? null : it.key); }}
            style={({ pressed }) => [
              k.tile,
              { flexBasis: basis, borderColor: sel ? color : COSMIC.BORDER, backgroundColor: sel ? color + '22' : COSMIC.SURFACE },
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
          >
            <View style={[k.tileIcon, { backgroundColor: color + '33', borderColor: color + '55' }]}>
              <Ionicons name={it.icon || 'ellipse-outline'} size={22} color={color} />
            </View>
            <Text style={[k.tileLabel, sel && { color, fontFamily: 'PlusJakartaSans_700Bold' }]} numberOfLines={1}>{it.label}</Text>
            {sel && (
              <View style={[k.tileCheck, { backgroundColor: color }]}>
                <Ionicons name="checkmark" size={12} color={COSMIC.INVERSE} />
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Chip row. multi=false → single-select; multi=true → value is an array. */
export function ChipRow({ items, value, onChange, multi = false, tint = COSMIC.INFO }) {
  const isSel = (key) => (multi ? Array.isArray(value) && value.includes(key) : value === key);
  const toggle = (key) => {
    Haptics.selection?.();
    if (multi) {
      const cur = Array.isArray(value) ? value : [];
      onChange(cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]);
    } else {
      onChange(value === key ? null : key);
    }
  };
  return (
    <View style={k.chipRow}>
      {items.map((it) => {
        const sel = isSel(it.key);
        return (
          <Pressable
            key={it.key}
            onPress={() => toggle(it.key)}
            style={[k.chip, { backgroundColor: sel ? tint + '1A' : COSMIC.SURFACE, borderColor: sel ? tint : COSMIC.BORDER }]}
          >
            {it.icon && <Ionicons name={it.icon} size={15} color={sel ? tint : COSMIC.TEXT_2} />}
            <Text style={[k.chipText, sel && { color: tint, fontFamily: 'PlusJakartaSans_700Bold' }]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Large centred numeric field with a unit pill (cost ₹, kg, hours…). */
export function BigNumberInput({ value, onChange, unit = '₹', placeholder = '0', tint = COSMIC.PRIMARY, keyboardType = 'decimal-pad' }) {
  return (
    <View style={k.bigRow}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COSMIC.MUTED}
        keyboardType={keyboardType}
        style={[k.bigInput, { borderColor: tint + '40', backgroundColor: tint + '12' }]}
      />
      <View style={k.unitPill}><Text style={k.unitText}>{unit}</Text></View>
    </View>
  );
}

export function LabeledInput({ label, ...props }) {
  return (
    <>
      {!!label && <Text style={k.subLabel}>{label}</Text>}
      <TextInput placeholderTextColor={COSMIC.MUTED} style={k.input} {...props} />
    </>
  );
}

export function NotesField({ value, onChange, placeholder = 'Any observation…' }) {
  return (
    <>
      <Text style={k.subLabel}>Notes</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COSMIC.MUTED}
        style={[k.input, { minHeight: 80, textAlignVertical: 'top' }]}
        multiline
      />
    </>
  );
}

export function Card({ children, style }) {
  return <GlassCard variant="plain" style={[k.section, style]}>{children}</GlassCard>;
}

/**
 * Full-screen scaffold: cosmic canvas + header + scrollable body + sticky
 * footer save button + celebration sheet (which navigates back on close).
 */
export function LoggerScaffold({
  title, subtitle, footerLabel, footerIcon = 'checkmark-circle', saving, canSave, onSave,
  celebrate, celebrateTitle, celebrateSubtitle, onCelebrateClose, children,
}) {
  return (
    <CosmicScreen edges={{ top: false, bottom: false }}>
      <CosmicHeader title={title} subtitle={subtitle} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={k.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
          <View style={{ height: 12 }} />
        </ScrollView>
        <View style={k.footer}>
          <GlowButton
            label={saving ? 'Saving…' : footerLabel}
            icon={footerIcon}
            variant="primary"
            full
            loading={saving}
            disabled={!canSave}
            onPress={onSave}
          />
        </View>
      </KeyboardAvoidingView>
      <CelebrationSheet
        visible={!!celebrate}
        title={celebrateTitle}
        subtitle={celebrateSubtitle}
        streakDays={1}
        onClose={onCelebrateClose}
      />
    </CosmicScreen>
  );
}

export const k = StyleSheet.create({
  scroll: { paddingHorizontal: CS.base, paddingTop: CS.sm, paddingBottom: 100 },

  secHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: CS.base, marginBottom: 6 },
  secIcon: { width: 26, height: 26, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  secTitle: { fontSize: 14, color: COSMIC.TEXT, fontFamily: 'PlusJakartaSans_700Bold', flex: 1 },
  optional: { fontSize: 10, color: COSMIC.TEXT_3, fontFamily: 'PlusJakartaSans_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 },

  section: { marginBottom: 2 },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, minHeight: 84, borderRadius: CR.md, borderWidth: 1.2, padding: 10, alignItems: 'center', justifyContent: 'center', gap: 6, position: 'relative' },
  tileIcon: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 13, color: COSMIC.TEXT, fontFamily: 'PlusJakartaSans_600SemiBold' },
  tileCheck: { position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 11, paddingVertical: 7, borderRadius: CR.pill, borderWidth: 1.2, minHeight: 34 },
  chipText: { fontSize: 12, color: COSMIC.TEXT, fontFamily: 'PlusJakartaSans_600SemiBold' },

  bigRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bigInput: { flex: 1, borderWidth: 1.2, borderRadius: CR.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 24, color: COSMIC.TEXT, fontFamily: 'PlusJakartaSans_800ExtraBold', textAlign: 'center', letterSpacing: 0.6 },
  unitPill: { paddingHorizontal: 12, paddingVertical: 12, borderRadius: CR.md, backgroundColor: COSMIC.SURFACE_HI, borderWidth: 1, borderColor: COSMIC.BORDER_HI },
  unitText: { fontSize: 12, color: COSMIC.TEXT_2, fontFamily: 'PlusJakartaSans_700Bold', letterSpacing: 0.6 },

  subLabel: { fontSize: 11, color: COSMIC.TEXT_2, fontFamily: 'PlusJakartaSans_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1.2, borderColor: COSMIC.BORDER_HI, borderRadius: CR.md, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 11 : 8, fontSize: 14, color: COSMIC.TEXT, backgroundColor: COSMIC.SURFACE, fontFamily: 'PlusJakartaSans_500Medium', minHeight: 44 },

  footer: { paddingHorizontal: CS.base, paddingTop: CS.base, paddingBottom: Platform.OS === 'ios' ? 32 : 20 },
});

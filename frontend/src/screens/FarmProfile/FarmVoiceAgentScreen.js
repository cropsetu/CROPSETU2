/**
 * FarmVoiceAgentScreen — MyFarm's voice setup, the first "Hey Krushi" domain.
 *
 * Thin wrapper over the reusable <VoiceAgentEngine>. All it supplies is the
 * 'farm' domain, a draft→createFarm mapper (persisted through MultiFarmContext so
 * the new farm appears optimistically + survives offline via the writeQueue), and
 * a labelled draft panel. Adding animal-posting / rental later = another wrapper
 * like this one, no engine changes.
 *
 * route params: { farmId? }  — farmId reserved for voice EDIT mode (Phase 2+).
 */
import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import VoiceAgentEngine from '../AI/VoiceAgentEngine';
import { useMultiFarm } from '../../context/MultiFarmContext';
import { useLanguage } from '../../context/LanguageContext';

const { width: W } = Dimensions.get('window');

// Fields createFarm() accepts (backend/src/services/farm.service.js whitelists these).
const FARM_FIELDS = [
  'farmName', 'farmNameMr', 'farmNameHi', 'village', 'taluka', 'district', 'state',
  'pincode', 'landSizeAcres', 'landOwnership', 'soilType', 'soilColor',
  'irrigationSystem', 'waterSources',
];

function mapDraftToFarm(draft) {
  const out = {};
  for (const k of FARM_FIELDS) {
    const v = draft?.[k];
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

// Prettify an enum token for the on-screen chip (BLACK_COTTON → "Black cotton").
function pretty(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

export default function FarmVoiceAgentScreen({ navigation, route }) {
  const { addFarm } = useMultiFarm();
  const { t } = useLanguage();
  const farmId = route?.params?.farmId || null;

  const onSave = useCallback(async (draft) => {
    const payload = mapDraftToFarm(draft);
    if (!payload.landSizeAcres) throw new Error('Land size is required');
    // Phase 1 = create. (farmId-based voice edit comes in a later phase.)
    await addFarm(payload);
  }, [addFarm]);

  const renderDraft = useCallback((draft) => {
    const rows = [
      [t('farmProfile.farmNickname', 'Farm name'), draft.farmName],
      [t('farmProfile.landSizeLabel', 'Land (acres)'), draft.landSizeAcres != null ? `${draft.landSizeAcres}` : ''],
      [t('farmProfile.soilType', 'Soil'), pretty(draft.soilType)],
      [t('farmProfile.waterSource', 'Irrigation'), pretty(draft.irrigationSystem)],
      [t('farmProfile.village', 'Village'), draft.village],
      [t('farmProfile.district', 'District'), draft.district],
      ['Ownership', pretty(draft.landOwnership)],
      ['Water sources', Array.isArray(draft.waterSources) ? draft.waterSources.join(', ') : ''],
    ].filter(([, v]) => v !== '' && v !== null && v !== undefined);

    if (!rows.length) return null;
    return (
      <View style={styles.chipsWrap}>
        {rows.map(([label, val]) => (
          <View key={label} style={styles.chip}>
            <Text style={styles.chipKey}>{label}</Text>
            <Text style={styles.chipVal} numberOfLines={1}>{val}</Text>
          </View>
        ))}
      </View>
    );
  }, [t]);

  return (
    <VoiceAgentEngine
      domain="farm"
      title={t('voiceAgent.farmTitle', 'Set up your farm')}
      subtitle={t('voiceAgent.farmSubtitle', 'Tell me about your farm — land, soil, water, crops')}
      context={farmId ? { farmId } : null}
      onSave={onSave}
      renderDraft={renderDraft}
      onClose={() => navigation.goBack()}
    />
  );
}

const styles = StyleSheet.create({
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  chip: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(52,211,153,0.25)', maxWidth: W - 60 },
  chipKey: { color: '#7FB893', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  chipVal: { color: '#EAFBEF', fontSize: 15, fontWeight: '600', marginTop: 2 },
});

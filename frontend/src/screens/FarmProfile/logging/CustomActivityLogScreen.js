/**
 * CustomActivityLogScreen — log a CUSTOM activity the farmer defines themselves,
 * for anything the preset 12 don't cover (e.g. "mulching", "bird scaring",
 * "staking", "mandi visit"). Saved as a generic OTHER activity so it still shows
 * in the cycle's timeline; an optional cost feeds the cycle P&L.
 */
import React, { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import {
  LoggerScaffold, SectionHeader, ChipRow, BigNumberInput, LabeledInput, NotesField, Card,
} from './_loggerKit';
import * as farmApi from '../../../services/farmApi';
import { useLanguage } from '../../../context/LanguageContext';
import { useMultiFarm } from '../../../context/MultiFarmContext';
import { COSMIC } from '../theme/cosmicTheme';
import { Haptics } from '../../../utils/haptics';

// A few common "other" activities as quick suggestions; the farmer can type any name.
const SUGGESTIONS = [
  { key: 'mulching',     label: 'Mulching' },
  { key: 'staking',      label: 'Staking / training' },
  { key: 'bird_scaring', label: 'Bird scaring' },
  { key: 'thinning',     label: 'Thinning' },
  { key: 'gap_filling',  label: 'Gap filling' },
  { key: 'mandi_visit',  label: 'Mandi visit' },
];

export default function CustomActivityLogScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { activeFarm } = useMultiFarm();
  const { cycleId } = route.params || {};

  const [name, setName]       = useState('');
  const [cost, setCost]       = useState('');
  const [notes, setNotes]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const canSave = name.trim().length > 0;

  const handleSave = useCallback(async () => {
    if (!canSave) { Haptics.error?.(); Alert.alert('Name it', 'Give this activity a short name.'); return; }
    if (!cycleId) { Alert.alert('Pick a crop cycle', 'Start a crop cycle first to log against it.'); return; }
    setSaving(true);
    try {
      await farmApi.addActivity(cycleId, {
        type: 'OTHER',
        title: name.trim(),
        notes: notes || null,
        fields: { custom: true },
      });
      if (cost && parseFloat(cost) > 0) {
        await farmApi.addExpenseLog(cycleId, { category: name.trim(), amountInr: parseFloat(cost) });
      }
      Haptics.success?.();
      setCelebrate(true);
    } catch (e) {
      Haptics.error?.();
      Alert.alert(t('login.error') || 'Error', e.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }, [canSave, cycleId, name, cost, notes, t]);

  const subtitle = activeFarm
    ? `${activeFarm.farmName || activeFarm.farmAlias || 'Farm'}${cycleId ? ' · active cycle' : ''}`
    : undefined;

  return (
    <LoggerScaffold
      title="Custom activity" subtitle={subtitle}
      footerLabel="Log activity" footerIcon="sparkles-outline"
      saving={saving} canSave={canSave} onSave={handleSave}
      celebrate={celebrate}
      celebrateTitle="Activity logged ✓"
      celebrateSubtitle="Added to this cycle's timeline."
      onCelebrateClose={() => { setCelebrate(false); navigation.goBack(); }}
    >
      <SectionHeader icon="create-outline" tint={COSMIC.PRIMARY} title="What did you do?" />
      <Card>
        <LabeledInput
          label="Activity name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Mulching, bird scaring…"
          autoCapitalize="sentences"
        />
      </Card>

      <SectionHeader icon="flash-outline" tint={COSMIC.PRIMARY_LT} title="Quick pick" optional />
      <ChipRow
        items={SUGGESTIONS}
        value={null}
        onChange={(k) => { const s = SUGGESTIONS.find((x) => x.key === k); if (s) setName(s.label); }}
        tint={COSMIC.PRIMARY}
      />

      <SectionHeader icon="cash-outline" tint={COSMIC.EXPENSE} title="Cost (₹)" optional />
      <Card><BigNumberInput value={cost} onChange={setCost} unit="₹" keyboardType="decimal-pad" tint={COSMIC.EXPENSE} /></Card>

      <SectionHeader icon="document-text-outline" tint={COSMIC.TEXT_3} title="Notes" optional />
      <Card><NotesField value={notes} onChange={setNotes} /></Card>
    </LoggerScaffold>
  );
}

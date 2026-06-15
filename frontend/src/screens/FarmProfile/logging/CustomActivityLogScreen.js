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
  { key: 'mulching',     labelKey: 'customActivity.suggestMulching' },
  { key: 'staking',      labelKey: 'customActivity.suggestStaking' },
  { key: 'bird_scaring', labelKey: 'customActivity.suggestBirdScaring' },
  { key: 'thinning',     labelKey: 'customActivity.suggestThinning' },
  { key: 'gap_filling',  labelKey: 'customActivity.suggestGapFilling' },
  { key: 'mandi_visit',  labelKey: 'customActivity.suggestMandiVisit' },
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
    if (!canSave) { Haptics.error?.(); Alert.alert(t('customActivity.nameItTitle'), t('customActivity.nameItMsg')); return; }
    if (!cycleId) { Alert.alert(t('customActivity.pickCycleTitle'), t('customActivity.pickCycleMsg')); return; }
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
      Alert.alert(t('login.error') || 'Error', e.message || t('customActivity.couldNotSave'));
    } finally {
      setSaving(false);
    }
  }, [canSave, cycleId, name, cost, notes, t]);

  const subtitle = activeFarm
    ? `${activeFarm.farmName || activeFarm.farmAlias || t('customActivity.farmFallback')}${cycleId ? t('customActivity.activeCycleSuffix') : ''}`
    : undefined;

  return (
    <LoggerScaffold
      title={t('customActivity.screenTitle')} subtitle={subtitle}
      footerLabel={t('customActivity.logActivity')} footerIcon="sparkles-outline"
      saving={saving} canSave={canSave} onSave={handleSave}
      celebrate={celebrate}
      celebrateTitle={t('customActivity.celebrateTitle')}
      celebrateSubtitle={t('customActivity.celebrateSubtitle')}
      onCelebrateClose={() => { setCelebrate(false); navigation.goBack(); }}
    >
      <SectionHeader icon="create-outline" tint={COSMIC.PRIMARY} title={t('customActivity.whatDidYouDo')} />
      <Card>
        <LabeledInput
          label={t('customActivity.activityName')}
          value={name}
          onChangeText={setName}
          placeholder={t('customActivity.activityNamePlaceholder')}
          autoCapitalize="sentences"
        />
      </Card>

      <SectionHeader icon="flash-outline" tint={COSMIC.PRIMARY_LT} title={t('customActivity.quickPick')} optional />
      <ChipRow
        items={SUGGESTIONS.map((s) => ({ key: s.key, label: t(s.labelKey) }))}
        value={null}
        onChange={(k) => { const s = SUGGESTIONS.find((x) => x.key === k); if (s) setName(t(s.labelKey)); }}
        tint={COSMIC.PRIMARY}
      />

      <SectionHeader icon="cash-outline" tint={COSMIC.EXPENSE} title={t('customActivity.costRupees')} optional />
      <Card><BigNumberInput value={cost} onChange={setCost} unit="₹" keyboardType="decimal-pad" tint={COSMIC.EXPENSE} /></Card>

      <SectionHeader icon="document-text-outline" tint={COSMIC.TEXT_3} title={t('customActivity.notes')} optional />
      <Card><NotesField value={notes} onChange={setNotes} /></Card>
    </LoggerScaffold>
  );
}

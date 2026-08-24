/**
 * WeedingLogScreen — log a weeding pass against a crop cycle (manual,
 * mechanical, or herbicide). Feeds the unified activity feed via
 * farmApi.addActivity and, when a labour cost is entered, the cycle's
 * itemised P&L via farmApi.addLaborLog.
 */
import React, { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import {
  LoggerScaffold, SectionHeader, TileGrid, BigNumberInput, LabeledInput, NotesField, Card, useLoggerSave,
} from './_loggerKit';
import * as farmApi from '../../../services/farmApi';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import { useMultiFarm } from '../../../context/MultiFarmContext';
import { COSMIC } from '../theme/cosmicTheme';
import { Haptics } from '@krushisarva/shared/utils/haptics';

const METHODS = [
  { key: 'manual',     label: 'Manual',     icon: 'hand-left-outline',    color: COSMIC.WEEDING },
  { key: 'mechanical', label: 'Mechanical', icon: 'construct-outline',    color: COSMIC.WEEDING },
  { key: 'herbicide',  label: 'Herbicide',  icon: 'color-filter-outline', color: COSMIC.WEEDING },
];

export default function WeedingLogScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { activeFarm } = useMultiFarm();
  const { cycleId } = route.params || {};

  const [method, setMethod] = useState(null);
  const [labour, setLabour] = useState('');
  const [notes, setNotes]   = useState('');

  const canSave = !!method;

  const methods = METHODS.map((m) => ({ ...m, label: t(`weedingLog.method_${m.key}`) }));

  // The required write decides success; the follow-ups are best effort, so a
  // failure there no longer pushes the farmer into a retry that double-logs.
  const { saving, save, celebrate, setCelebrate } = useLoggerSave({
    t,
    failMessage: t('weedingLog.couldNotSave'),
    primary: useCallback(() => farmApi.addActivity(cycleId, { type: 'WEEDING', title: method, notes: notes || null, fields: { method } }), [cycleId, method, labour, notes]),
    secondary: useCallback(() => (labour && parseFloat(labour) > 0
      ? farmApi.addLaborLog(cycleId, { task: 'Weeding', amountInr: parseFloat(labour) })
      : Promise.resolve()), [cycleId, method, labour, notes]),
  });

  const handleSave = useCallback(() => {
    if (!canSave) { Haptics.error?.(); Alert.alert(t('weedingLog.missingInfo'), t('weedingLog.pickMethodMsg')); return; }
    if (!cycleId) { Alert.alert(t('weedingLog.pickCycle'), t('weedingLog.pickCycleMsg')); return; }
    save();
  }, [canSave, cycleId, save, t]);

  const subtitle = activeFarm
    ? `${activeFarm.farmName || activeFarm.farmAlias || t('weedingLog.farm')}${cycleId ? ` · ${t('weedingLog.activeCycle')}` : ''}`
    : undefined;

  return (
    <LoggerScaffold
      title={t('weedingLog.title')} subtitle={subtitle}
      footerLabel={t('weedingLog.title')} footerIcon="cut-outline"
      saving={saving} canSave={canSave} onSave={handleSave}
      celebrate={celebrate}
      celebrateTitle={t('weedingLog.celebrateTitle')}
      celebrateSubtitle={t('weedingLog.celebrateSubtitle')}
      onCelebrateClose={() => { setCelebrate(false); navigation.goBack(); }}
    >
      <SectionHeader icon="cut-outline" tint={COSMIC.WEEDING} title={t('weedingLog.method')} />
      <TileGrid items={methods} value={method} onChange={(v) => setMethod(v)} columns={3} />

      <SectionHeader icon="cash-outline" tint={COSMIC.WEEDING} title={t('weedingLog.labourCost')} optional />
      <Card><BigNumberInput value={labour} onChange={setLabour} unit="₹" tint={COSMIC.WEEDING} /></Card>

      <SectionHeader icon="create-outline" tint={COSMIC.TEXT_3} title={t('weedingLog.notes')} optional />
      <Card><NotesField value={notes} onChange={setNotes} /></Card>
    </LoggerScaffold>
  );
}

/**
 * PruningLogScreen — log a pruning / trimming operation against a crop cycle
 * (tips, suckers, canopy, deadwood). Feeds the unified activity feed via
 * farmApi.addActivity and, when a labour cost is entered, the cycle's P&L via
 * farmApi.addLaborLog.
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

const PARTS = [
  { key: 'tips',     labelKey: 'pruningLog.partTips',     icon: 'cut-outline',       color: COSMIC.PRUNING },
  { key: 'suckers',  labelKey: 'pruningLog.partSuckers',  icon: 'git-branch-outline', color: COSMIC.PRUNING },
  { key: 'canopy',   labelKey: 'pruningLog.partCanopy',   icon: 'leaf-outline',      color: COSMIC.PRUNING },
  { key: 'deadwood', labelKey: 'pruningLog.partDeadwood', icon: 'trash-outline',     color: COSMIC.PRUNING },
];

export default function PruningLogScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { activeFarm } = useMultiFarm();
  const { cycleId } = route.params || {};

  const [part, setPart]     = useState(null);
  const [labour, setLabour] = useState('');
  const [notes, setNotes]   = useState('');

  const partItems = PARTS.map((p) => ({ ...p, label: t(p.labelKey) }));

  const canSave = !!part;

  // The required write decides success; the follow-ups are best effort, so a
  // failure there no longer pushes the farmer into a retry that double-logs.
  const { saving, save, celebrate, setCelebrate } = useLoggerSave({
    t,
    failMessage: t('pruningLog.couldNotSave'),
    primary: useCallback(() => farmApi.addActivity(cycleId, { type: 'PRUNING', title: part, notes: notes || null, fields: { part } }), [cycleId, part, labour, notes]),
    secondary: useCallback(() => (labour && parseFloat(labour) > 0
      ? farmApi.addLaborLog(cycleId, { task: 'Pruning', amountInr: parseFloat(labour) })
      : Promise.resolve()), [cycleId, part, labour, notes]),
  });

  const handleSave = useCallback(() => {
    if (!canSave) { Haptics.error?.(); Alert.alert(t('pruningLog.missingInfoTitle'), t('pruningLog.missingInfoMsg')); return; }
    if (!cycleId) { Alert.alert(t('pruningLog.pickCycleTitle'), t('pruningLog.pickCycleMsg')); return; }
    save();
  }, [canSave, cycleId, save, t]);

  const subtitle = activeFarm
    ? `${activeFarm.farmName || activeFarm.farmAlias || t('pruningLog.farmFallback')}${cycleId ? t('pruningLog.activeCycleSuffix') : ''}`
    : undefined;

  return (
    <LoggerScaffold
      title={t('pruningLog.title')} subtitle={subtitle}
      footerLabel={t('pruningLog.title')} footerIcon="git-branch-outline"
      saving={saving} canSave={canSave} onSave={handleSave}
      celebrate={celebrate}
      celebrateTitle={t('pruningLog.celebrateTitle')}
      celebrateSubtitle={t('pruningLog.celebrateSubtitle')}
      onCelebrateClose={() => { setCelebrate(false); navigation.goBack(); }}
    >
      <SectionHeader icon="cut-outline" tint={COSMIC.PRUNING} title={t('pruningLog.whatWasPruned')} />
      <TileGrid items={partItems} value={part} onChange={setPart} columns={2} />

      <SectionHeader icon="people-outline" tint={COSMIC.PRUNING} title={t('pruningLog.labourCost')} optional />
      <Card><BigNumberInput value={labour} onChange={setLabour} unit="₹" tint={COSMIC.PRUNING} /></Card>

      <SectionHeader icon="create-outline" tint={COSMIC.TEXT_3} title={t('pruningLog.notes')} optional />
      <Card><NotesField value={notes} onChange={setNotes} /></Card>
    </LoggerScaffold>
  );
}

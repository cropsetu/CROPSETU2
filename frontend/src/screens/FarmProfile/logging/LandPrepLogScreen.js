/**
 * LandPrepLogScreen — log a land-preparation operation against a crop cycle
 * (ploughing, harrowing, levelling, bund work). Feeds the unified activity
 * feed via farmApi.addActivity (type LAND_PREP) and, when costs are entered,
 * the cycle's P&L via addLaborLog (labour) and addExpenseLog (machinery).
 */
import React, { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import {
  LoggerScaffold, SectionHeader, TileGrid, ChipRow, BigNumberInput, NotesField, Card, useLoggerSave,
} from './_loggerKit';
import * as farmApi from '../../../services/farmApi';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import { useMultiFarm } from '../../../context/MultiFarmContext';
import { COSMIC } from '../theme/cosmicTheme';
import { Haptics } from '@cropsetu/shared/utils/haptics';

const OPERATIONS = [
  { key: 'ploughing', icon: 'swap-horizontal-outline', color: COSMIC.LAND_PREP },
  { key: 'harrowing', icon: 'grid-outline',            color: COSMIC.LAND_PREP },
  { key: 'levelling', icon: 'remove-outline',          color: COSMIC.LAND_PREP },
  { key: 'bund',      icon: 'ellipse-outline',         color: COSMIC.LAND_PREP },
];

const IMPLEMENTS = [
  { key: 'tractor',      icon: 'car-outline' },
  { key: 'bullock',      icon: 'paw-outline' },
  { key: 'power_tiller', icon: 'cog-outline' },
  { key: 'manual',       icon: 'hand-left-outline' },
];

export default function LandPrepLogScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { activeFarm } = useMultiFarm();
  const { cycleId } = route.params || {};

  const [operation, setOperation]   = useState(null);
  const [implement, setImplement]   = useState(null);
  const [labour, setLabour]         = useState('');
  const [machinery, setMachinery]   = useState('');
  const [notes, setNotes]           = useState('');

  const canSave = !!operation;

  const operations = OPERATIONS.map((o) => ({ ...o, label: t(`landPrepLog.op_${o.key}`) }));
  const implements_ = IMPLEMENTS.map((i) => ({ ...i, label: t(`landPrepLog.impl_${i.key}`) }));

  // The required write decides success; the follow-ups are best effort, so a
  // failure there no longer pushes the farmer into a retry that double-logs.
  const { saving, save, celebrate, setCelebrate } = useLoggerSave({
    t,
    failMessage: t('landPrepLog.couldNotSave'),
    primary: useCallback(() => farmApi.addActivity(cycleId, { type: 'LAND_PREP', title: operation, notes: notes || null, fields: { operation, implement } }), [cycleId, operation, implement, labour, machinery, notes]),
    secondary: useCallback(async () => {
      if (labour && parseFloat(labour) > 0) await farmApi.addLaborLog(cycleId, { task: 'Land prep', amountInr: parseFloat(labour) });
      if (machinery && parseFloat(machinery) > 0) await farmApi.addExpenseLog(cycleId, { category: 'machinery', amountInr: parseFloat(machinery) });
    }, [cycleId, operation, implement, labour, machinery, notes]),
  });

  const handleSave = useCallback(() => {
    if (!canSave) { Haptics.error?.(); Alert.alert(t('landPrepLog.missingInfoTitle'), t('landPrepLog.missingInfoBody')); return; }
    if (!cycleId) { Alert.alert(t('landPrepLog.pickCycleTitle'), t('landPrepLog.pickCycleBody')); return; }
    save();
  }, [canSave, cycleId, save, t]);

  const subtitle = activeFarm
    ? `${activeFarm.farmName || activeFarm.farmAlias || t('landPrepLog.farmFallback')}${cycleId ? ` · ${t('landPrepLog.activeCycle')}` : ''}`
    : undefined;

  return (
    <LoggerScaffold
      title={t('landPrepLog.title')} subtitle={subtitle}
      footerLabel={t('landPrepLog.footerLabel')} footerIcon="trail-sign-outline"
      saving={saving} canSave={canSave} onSave={handleSave}
      celebrate={celebrate}
      celebrateTitle={t('landPrepLog.celebrateTitle')}
      celebrateSubtitle={t('landPrepLog.celebrateSubtitle')}
      onCelebrateClose={() => { setCelebrate(false); navigation.goBack(); }}
    >
      <SectionHeader icon="trail-sign-outline" tint={COSMIC.LAND_PREP} title={t('landPrepLog.sectionOperation')} />
      <TileGrid items={operations} value={operation} onChange={(v) => setOperation(v)} columns={2} photoSet="ops" />

      <SectionHeader icon="build-outline" tint={COSMIC.LAND_PREP} title={t('landPrepLog.sectionImplement')} optional />
      <ChipRow items={implements_} value={implement} onChange={setImplement} tint={COSMIC.LAND_PREP} />

      <SectionHeader icon="people-outline" tint={COSMIC.LAND_PREP} title={t('landPrepLog.sectionLabourCost')} optional />
      <Card><BigNumberInput value={labour} onChange={setLabour} unit="₹" tint={COSMIC.LAND_PREP} /></Card>

      <SectionHeader icon="construct-outline" tint={COSMIC.INFO} title={t('landPrepLog.sectionMachineryCost')} optional />
      <Card><BigNumberInput value={machinery} onChange={setMachinery} unit="₹" tint={COSMIC.INFO} /></Card>

      <SectionHeader icon="create-outline" tint={COSMIC.TEXT_3} title={t('landPrepLog.sectionNotes')} optional />
      <Card><NotesField value={notes} onChange={setNotes} /></Card>
    </LoggerScaffold>
  );
}

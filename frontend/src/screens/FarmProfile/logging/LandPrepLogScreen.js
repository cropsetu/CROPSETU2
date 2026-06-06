/**
 * LandPrepLogScreen — log a land-preparation operation against a crop cycle
 * (ploughing, harrowing, levelling, bund work). Feeds the unified activity
 * feed via farmApi.addActivity (type LAND_PREP) and, when costs are entered,
 * the cycle's P&L via addLaborLog (labour) and addExpenseLog (machinery).
 */
import React, { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import {
  LoggerScaffold, SectionHeader, TileGrid, ChipRow, BigNumberInput, NotesField, Card,
} from './_loggerKit';
import * as farmApi from '../../../services/farmApi';
import { useLanguage } from '../../../context/LanguageContext';
import { useMultiFarm } from '../../../context/MultiFarmContext';
import { COSMIC } from '../theme/cosmicTheme';
import { Haptics } from '../../../utils/haptics';

const OPERATIONS = [
  { key: 'ploughing', label: 'Ploughing', icon: 'swap-horizontal-outline', color: COSMIC.LAND_PREP },
  { key: 'harrowing', label: 'Harrowing', icon: 'grid-outline',            color: COSMIC.LAND_PREP },
  { key: 'levelling', label: 'Levelling', icon: 'remove-outline',          color: COSMIC.LAND_PREP },
  { key: 'bund',      label: 'Bund',      icon: 'ellipse-outline',         color: COSMIC.LAND_PREP },
];

const IMPLEMENTS = [
  { key: 'tractor',      label: 'Tractor',      icon: 'car-outline' },
  { key: 'bullock',      label: 'Bullock',      icon: 'paw-outline' },
  { key: 'power_tiller', label: 'Power tiller', icon: 'cog-outline' },
  { key: 'manual',       label: 'Manual',       icon: 'hand-left-outline' },
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
  const [saving, setSaving]         = useState(false);
  const [celebrate, setCelebrate]   = useState(false);

  const canSave = !!operation;

  const handleSave = useCallback(async () => {
    if (!canSave) { Haptics.error?.(); Alert.alert('Missing info', 'Pick an operation.'); return; }
    if (!cycleId) { Alert.alert('Pick a crop cycle', 'Start a crop cycle first to log against it.'); return; }
    setSaving(true);
    try {
      await farmApi.addActivity(cycleId, { type: 'LAND_PREP', title: operation, notes: notes || null, fields: { operation, implement } });
      if (labour && parseFloat(labour) > 0) {
        await farmApi.addLaborLog(cycleId, { task: 'Land prep', amountInr: parseFloat(labour) });
      }
      if (machinery && parseFloat(machinery) > 0) {
        await farmApi.addExpenseLog(cycleId, { category: 'machinery', amountInr: parseFloat(machinery) });
      }
      Haptics.success?.();
      setCelebrate(true);
    } catch (e) {
      Haptics.error?.();
      Alert.alert(t('login.error') || 'Error', e.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }, [canSave, cycleId, operation, implement, labour, machinery, notes, t]);

  const subtitle = activeFarm
    ? `${activeFarm.farmName || activeFarm.farmAlias || 'Farm'}${cycleId ? ' · active cycle' : ''}`
    : undefined;

  return (
    <LoggerScaffold
      title="Log land prep" subtitle={subtitle}
      footerLabel="Log land prep" footerIcon="trail-sign-outline"
      saving={saving} canSave={canSave} onSave={handleSave}
      celebrate={celebrate}
      celebrateTitle="Land prep logged ✓"
      celebrateSubtitle="Tracked against this cycle's activity feed."
      onCelebrateClose={() => { setCelebrate(false); navigation.goBack(); }}
    >
      <SectionHeader icon="trail-sign-outline" tint={COSMIC.LAND_PREP} title="Operation" />
      <TileGrid items={OPERATIONS} value={operation} onChange={(v) => setOperation(v)} columns={2} />

      <SectionHeader icon="build-outline" tint={COSMIC.LAND_PREP} title="Implement" optional />
      <ChipRow items={IMPLEMENTS} value={implement} onChange={setImplement} tint={COSMIC.LAND_PREP} />

      <SectionHeader icon="people-outline" tint={COSMIC.LAND_PREP} title="Labour cost" optional />
      <Card><BigNumberInput value={labour} onChange={setLabour} unit="₹" tint={COSMIC.LAND_PREP} /></Card>

      <SectionHeader icon="construct-outline" tint={COSMIC.INFO} title="Diesel / Machinery cost" optional />
      <Card><BigNumberInput value={machinery} onChange={setMachinery} unit="₹" tint={COSMIC.INFO} /></Card>

      <SectionHeader icon="create-outline" tint={COSMIC.TEXT_3} title="Notes" optional />
      <Card><NotesField value={notes} onChange={setNotes} /></Card>
    </LoggerScaffold>
  );
}

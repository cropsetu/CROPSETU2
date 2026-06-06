/**
 * WeedingLogScreen — log a weeding pass against a crop cycle (manual,
 * mechanical, or herbicide). Feeds the unified activity feed via
 * farmApi.addActivity and, when a labour cost is entered, the cycle's
 * itemised P&L via farmApi.addLaborLog.
 */
import React, { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import {
  LoggerScaffold, SectionHeader, TileGrid, BigNumberInput, LabeledInput, NotesField, Card,
} from './_loggerKit';
import * as farmApi from '../../../services/farmApi';
import { useLanguage } from '../../../context/LanguageContext';
import { useMultiFarm } from '../../../context/MultiFarmContext';
import { COSMIC } from '../theme/cosmicTheme';
import { Haptics } from '../../../utils/haptics';

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
  const [saving, setSaving] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const canSave = !!method;

  const handleSave = useCallback(async () => {
    if (!canSave) { Haptics.error?.(); Alert.alert('Missing info', 'Pick a weeding method.'); return; }
    if (!cycleId) { Alert.alert('Pick a crop cycle', 'Start a crop cycle first to log against it.'); return; }
    setSaving(true);
    try {
      await farmApi.addActivity(cycleId, { type: 'WEEDING', title: method, notes: notes || null, fields: { method } });
      if (labour && parseFloat(labour) > 0) {
        await farmApi.addLaborLog(cycleId, { task: 'Weeding', amountInr: parseFloat(labour) });
      }
      Haptics.success?.();
      setCelebrate(true);
    } catch (e) {
      Haptics.error?.();
      Alert.alert(t('login.error') || 'Error', e.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }, [canSave, cycleId, method, labour, notes, t]);

  const subtitle = activeFarm
    ? `${activeFarm.farmName || activeFarm.farmAlias || 'Farm'}${cycleId ? ' · active cycle' : ''}`
    : undefined;

  return (
    <LoggerScaffold
      title="Log weeding" subtitle={subtitle}
      footerLabel="Log weeding" footerIcon="cut-outline"
      saving={saving} canSave={canSave} onSave={handleSave}
      celebrate={celebrate}
      celebrateTitle="Weeding logged ✓"
      celebrateSubtitle="Tracked against this cycle's activity feed."
      onCelebrateClose={() => { setCelebrate(false); navigation.goBack(); }}
    >
      <SectionHeader icon="cut-outline" tint={COSMIC.WEEDING} title="Method" />
      <TileGrid items={METHODS} value={method} onChange={(v) => setMethod(v)} columns={3} />

      <SectionHeader icon="cash-outline" tint={COSMIC.WEEDING} title="Labour cost" optional />
      <Card><BigNumberInput value={labour} onChange={setLabour} unit="₹" tint={COSMIC.WEEDING} /></Card>

      <SectionHeader icon="create-outline" tint={COSMIC.TEXT_3} title="Notes" optional />
      <Card><NotesField value={notes} onChange={setNotes} /></Card>
    </LoggerScaffold>
  );
}

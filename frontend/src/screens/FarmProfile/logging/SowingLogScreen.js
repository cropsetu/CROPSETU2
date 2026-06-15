/**
 * SowingLogScreen — log a sowing / planting event against a crop cycle and
 * advance the cycle to the SOWING stage. Records the method, seed used and
 * any sowing labour cost via farmApi.addActivity (+ advanceStage / addLaborLog).
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
  { key: 'broadcasting', label: 'Broadcasting', icon: 'grid-outline',    color: COSMIC.SOWING },
  { key: 'line_sowing',  label: 'Line sowing',  icon: 'remove-outline',  color: COSMIC.SOWING },
  { key: 'dibbling',     label: 'Dibbling',     icon: 'ellipse-outline', color: COSMIC.SOWING },
  { key: 'transplant',   label: 'Transplant',   icon: 'leaf-outline',    color: COSMIC.SOWING },
];

export default function SowingLogScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { activeFarm } = useMultiFarm();
  const { cycleId } = route.params || {};

  const methodItems = METHODS.map((m) => ({ ...m, label: t(`sowingLog.method_${m.key}`) }));

  const [method, setMethod]   = useState(null);
  const [seedKg, setSeedKg]   = useState('');
  const [labour, setLabour]   = useState('');
  const [notes, setNotes]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const canSave = !!method;

  const handleSave = useCallback(async () => {
    if (!canSave) { Haptics.error?.(); Alert.alert(t('sowingLog.missingInfoTitle'), t('sowingLog.missingInfoBody')); return; }
    if (!cycleId) { Alert.alert(t('sowingLog.pickCycleTitle'), t('sowingLog.pickCycleBody')); return; }
    setSaving(true);
    try {
      await farmApi.addActivity(cycleId, {
        type: 'SOWING',
        title: method,
        notes: notes || null,
        fields: { method, seedKg: seedKg ? parseFloat(seedKg) : null },
      });
      await farmApi.advanceStage(cycleId, 'SOWING');
      // Stamp the sowing date so the cycle's DAS / growth-story clock starts ticking.
      // (Nothing else in the flow sets sowingDate, so without this DAS stays null.)
      await farmApi.updateCropCycle(cycleId, { sowingDate: new Date().toISOString() });
      if (labour && parseFloat(labour) > 0) {
        await farmApi.addLaborLog(cycleId, { task: 'Sowing', amountInr: parseFloat(labour) });
      }
      Haptics.success?.();
      setCelebrate(true);
    } catch (e) {
      Haptics.error?.();
      Alert.alert(t('login.error') || 'Error', e.message || t('sowingLog.couldNotSave'));
    } finally {
      setSaving(false);
    }
  }, [canSave, cycleId, method, seedKg, labour, notes, t]);

  const subtitle = activeFarm
    ? `${activeFarm.farmName || activeFarm.farmAlias || t('nav.farm')}${cycleId ? ` · ${t('sowingLog.activeCycle')}` : ''}`
    : undefined;

  return (
    <LoggerScaffold
      title={t('sowingLog.title')} subtitle={subtitle}
      footerLabel={t('sowingLog.title')} footerIcon="leaf-outline"
      saving={saving} canSave={canSave} onSave={handleSave}
      celebrate={celebrate}
      celebrateTitle={t('sowingLog.celebrateTitle')}
      celebrateSubtitle={t('sowingLog.celebrateSubtitle')}
      onCelebrateClose={() => { setCelebrate(false); navigation.goBack(); }}
    >
      <SectionHeader icon="leaf-outline" tint={COSMIC.SOWING} title={t('sowingLog.sectionMethod')} />
      <TileGrid items={methodItems} value={method} onChange={setMethod} columns={2} />

      <SectionHeader icon="nutrition-outline" tint={COSMIC.SOWING} title={t('sowingLog.sectionSeedUsed')} optional />
      <Card><BigNumberInput value={seedKg} onChange={setSeedKg} unit="KG" keyboardType="decimal-pad" tint={COSMIC.SOWING} /></Card>

      <SectionHeader icon="people-outline" tint={COSMIC.EXPENSE} title={t('sowingLog.sectionLabourCost')} optional />
      <Card><BigNumberInput value={labour} onChange={setLabour} unit="₹" keyboardType="decimal-pad" tint={COSMIC.EXPENSE} /></Card>

      <SectionHeader icon="create-outline" tint={COSMIC.TEXT_3} title={t('sowingLog.sectionNotes')} optional />
      <Card><NotesField value={notes} onChange={setNotes} /></Card>
    </LoggerScaffold>
  );
}

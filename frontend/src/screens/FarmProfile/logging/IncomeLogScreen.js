import React, { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import {
  LoggerScaffold, SectionHeader, TileGrid, BigNumberInput, NotesField, Card, useLoggerSave,
} from './_loggerKit';
import * as farmApi from '../../../services/farmApi';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import { useMultiFarm } from '../../../context/MultiFarmContext';
import { COSMIC } from '../theme/cosmicTheme';
import { Haptics } from '@cropsetu/shared/utils/haptics';

export default function IncomeLogScreen({ navigation, route }) {
  const { t } = useLanguage();
  const SOURCES = [
    { key:'intercrop', label:t('incomeLog.sourceIntercrop'), icon:'leaf-outline', color: COSMIC.INCOME },
    { key:'residue', label:t('incomeLog.sourceResidue'), icon:'layers-outline', color: COSMIC.INCOME },
    { key:'subsidy', label:t('incomeLog.sourceSubsidy'), icon:'ribbon-outline', color: COSMIC.INCOME },
    { key:'rental', label:t('incomeLog.sourceRental'), icon:'home-outline', color: COSMIC.INCOME },
    { key:'other', label:t('incomeLog.sourceOther'), icon:'ellipsis-horizontal', color: COSMIC.INCOME },
  ];
  const { activeFarm } = useMultiFarm();
  const { cycleId } = route.params || {};
  const [source, setSource] = useState('other');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const canSave = !!amount && parseFloat(amount) > 0;
  // The required write decides success; the follow-ups are best effort, so a
  // failure there no longer pushes the farmer into a retry that double-logs.
  const { saving, save, celebrate, setCelebrate } = useLoggerSave({
    t,
    failMessage: t('incomeLog.saveFailed'),
    primary: useCallback(() => farmApi.addIncomeLog(cycleId, { source, amountInr: parseFloat(amount), notes: notes || null }), [cycleId, source, amount, notes]),
    secondary: useCallback(() => farmApi.addActivity(cycleId, { type: 'INCOME', title: `${source} ₹${amount}`, notes: notes || null, fields: { source, amountInr: parseFloat(amount) } }), [cycleId, source, amount, notes]),
  });

  const handleSave = useCallback(() => {
    if (!canSave) { Haptics.error?.(); Alert.alert(t('incomeLog.missingInfoTitle'), t('incomeLog.missingInfoMsg')); return; }
    if (!cycleId) { Alert.alert(t('incomeLog.noCycleTitle'), t('incomeLog.noCycleMsg')); return; }
    save();
  }, [canSave, cycleId, save, t]);
  const subtitle = activeFarm ? `${activeFarm.farmName || activeFarm.farmAlias || t('nav.farm')}${cycleId ? t('incomeLog.activeCycleSuffix') : ''}` : undefined;
  return (
    <LoggerScaffold title={t('incomeLog.title')} subtitle={subtitle} footerLabel={t('incomeLog.title')} footerIcon="cash-outline"
      saving={saving} canSave={canSave} onSave={handleSave} celebrate={celebrate}
      celebrateTitle={t('incomeLog.celebrateTitle')} celebrateSubtitle={t('incomeLog.celebrateSubtitle')}
      onCelebrateClose={() => { setCelebrate(false); navigation.goBack(); }}>
      <SectionHeader icon="pricetags-outline" tint={COSMIC.INCOME} title={t('incomeLog.sourceSection')} />
      <TileGrid items={SOURCES} value={source} onChange={(v)=>setSource(v||'other')} columns={3} />
      <SectionHeader icon="cash-outline" tint={COSMIC.INCOME} title={t('orders.amount')} />
      <Card><BigNumberInput value={amount} onChange={setAmount} unit="₹" tint={COSMIC.INCOME} /></Card>
      <SectionHeader icon="create-outline" tint={COSMIC.TEXT_3} title={t('incomeLog.notes')} optional />
      <Card><NotesField value={notes} onChange={setNotes} /></Card>
    </LoggerScaffold>
  );
}

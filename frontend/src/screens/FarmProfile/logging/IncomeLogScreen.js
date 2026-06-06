import React, { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { LoggerScaffold, SectionHeader, TileGrid, BigNumberInput, NotesField, Card } from './_loggerKit';
import * as farmApi from '../../../services/farmApi';
import { useLanguage } from '../../../context/LanguageContext';
import { useMultiFarm } from '../../../context/MultiFarmContext';
import { COSMIC } from '../theme/cosmicTheme';
import { Haptics } from '../../../utils/haptics';

const SOURCES = [
  { key:'intercrop', label:'Intercrop', icon:'leaf-outline', color: COSMIC.INCOME },
  { key:'residue', label:'Residue', icon:'layers-outline', color: COSMIC.INCOME },
  { key:'subsidy', label:'Subsidy', icon:'ribbon-outline', color: COSMIC.INCOME },
  { key:'rental', label:'Rental', icon:'home-outline', color: COSMIC.INCOME },
  { key:'other', label:'Other', icon:'ellipsis-horizontal', color: COSMIC.INCOME },
];

export default function IncomeLogScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { activeFarm } = useMultiFarm();
  const { cycleId } = route.params || {};
  const [source, setSource] = useState('other');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const canSave = !!amount && parseFloat(amount) > 0;
  const handleSave = useCallback(async () => {
    if (!canSave) { Haptics.error?.(); Alert.alert('Missing info', 'Enter an amount.'); return; }
    if (!cycleId) { Alert.alert('Pick a crop cycle', 'Start a crop cycle first to log against it.'); return; }
    setSaving(true);
    try {
      const amt = parseFloat(amount);
      await farmApi.addIncomeLog(cycleId, { source, amountInr: amt, notes: notes||null });
      await farmApi.addActivity(cycleId, { type:'INCOME', title: `${source} ₹${amount}`, notes: notes||null, fields:{ source, amountInr: amt } });
      Haptics.success?.(); setCelebrate(true);
    } catch (e) { Haptics.error?.(); Alert.alert(t('login.error')||'Error', e.message||'Could not save.'); }
    finally { setSaving(false); }
  }, [canSave, cycleId, source, amount, notes, t]);
  const subtitle = activeFarm ? `${activeFarm.farmName || activeFarm.farmAlias || 'Farm'}${cycleId ? ' · active cycle' : ''}` : undefined;
  return (
    <LoggerScaffold title="Log income" subtitle={subtitle} footerLabel="Log income" footerIcon="cash-outline"
      saving={saving} canSave={canSave} onSave={handleSave} celebrate={celebrate}
      celebrateTitle="Income logged ✓" celebrateSubtitle="Tracked against this cycle's P&L."
      onCelebrateClose={() => { setCelebrate(false); navigation.goBack(); }}>
      <SectionHeader icon="pricetags-outline" tint={COSMIC.INCOME} title="Source" />
      <TileGrid items={SOURCES} value={source} onChange={(v)=>setSource(v||'other')} columns={3} />
      <SectionHeader icon="cash-outline" tint={COSMIC.INCOME} title="Amount" />
      <Card><BigNumberInput value={amount} onChange={setAmount} unit="₹" tint={COSMIC.INCOME} /></Card>
      <SectionHeader icon="create-outline" tint={COSMIC.TEXT_3} title="Notes" optional />
      <Card><NotesField value={notes} onChange={setNotes} /></Card>
    </LoggerScaffold>
  );
}

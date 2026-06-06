/**
 * ExpenseLogScreen — log a miscellaneous cash expense against a crop cycle
 * (diesel, machinery hire, transport, electricity, tools…). Feeds the cycle's
 * itemised P&L via farmApi.addExpenseLog + a generic EXPENSE activity entry.
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

const CATEGORIES = [
  { key: 'diesel',      label: 'Diesel',        icon: 'flame-outline',     color: COSMIC.EXPENSE },
  { key: 'machinery',   label: 'Machinery hire', icon: 'construct-outline', color: COSMIC.LAND_PREP },
  { key: 'transport',   label: 'Transport',     icon: 'car-outline',       color: COSMIC.INFO },
  { key: 'electricity', label: 'Electricity',   icon: 'flash-outline',     color: COSMIC.HARVEST },
  { key: 'tools',       label: 'Tools',         icon: 'hammer-outline',    color: COSMIC.SPRAY },
  { key: 'other',       label: 'Other',         icon: 'ellipsis-horizontal', color: COSMIC.TEXT_3 },
];

export default function ExpenseLogScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { activeFarm } = useMultiFarm();
  const { cycleId } = route.params || {};

  const [category, setCategory] = useState('other');
  const [amount, setAmount]     = useState('');
  const [vendor, setVendor]     = useState('');
  const [notes, setNotes]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const canSave = !!amount && parseFloat(amount) > 0;

  const handleSave = useCallback(async () => {
    if (!canSave) { Haptics.error?.(); Alert.alert('Missing info', 'Enter an amount.'); return; }
    if (!cycleId) { Alert.alert('Pick a crop cycle', 'Start a crop cycle first to log against it.'); return; }
    setSaving(true);
    try {
      const amt = parseFloat(amount);
      await farmApi.addExpenseLog(cycleId, { category, amountInr: amt, vendor: vendor || null, notes: notes || null });
      await farmApi.addActivity(cycleId, { type: 'EXPENSE', title: `${category} ₹${amount}`, notes: notes || null, fields: { category, amountInr: amt, vendor } });
      Haptics.success?.();
      setCelebrate(true);
    } catch (e) {
      Haptics.error?.();
      Alert.alert(t('login.error') || 'Error', e.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }, [canSave, cycleId, category, amount, vendor, notes, t]);

  const subtitle = activeFarm
    ? `${activeFarm.farmName || activeFarm.farmAlias || 'Farm'}${cycleId ? ' · active cycle' : ''}`
    : undefined;

  return (
    <LoggerScaffold
      title="Log expense" subtitle={subtitle}
      footerLabel="Log expense" footerIcon="cash-outline"
      saving={saving} canSave={canSave} onSave={handleSave}
      celebrate={celebrate}
      celebrateTitle="Expense logged ✓"
      celebrateSubtitle="Tracked against this cycle's profit & loss."
      onCelebrateClose={() => { setCelebrate(false); navigation.goBack(); }}
    >
      <SectionHeader icon="pricetags-outline" tint={COSMIC.EXPENSE} title="Category" />
      <TileGrid items={CATEGORIES} value={category} onChange={(v) => setCategory(v || 'other')} columns={3} />

      <SectionHeader icon="cash-outline" tint={COSMIC.EXPENSE} title="Amount" />
      <Card><BigNumberInput value={amount} onChange={setAmount} unit="₹" tint={COSMIC.EXPENSE} /></Card>

      <SectionHeader icon="storefront-outline" tint={COSMIC.INFO} title="Vendor" optional />
      <Card><LabeledInput value={vendor} onChangeText={setVendor} placeholder="e.g. Krishi Kendra" /></Card>

      <SectionHeader icon="create-outline" tint={COSMIC.TEXT_3} title="Notes" optional />
      <Card><NotesField value={notes} onChange={setNotes} /></Card>
    </LoggerScaffold>
  );
}

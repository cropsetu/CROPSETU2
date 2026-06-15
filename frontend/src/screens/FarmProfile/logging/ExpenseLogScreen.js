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
  { key: 'diesel',      labelKey: 'rent.fuelDiesel',         icon: 'flame-outline',     color: COSMIC.EXPENSE },
  { key: 'machinery',   labelKey: 'expenseLog.catMachinery', icon: 'construct-outline', color: COSMIC.LAND_PREP },
  { key: 'transport',   labelKey: 'expenseLog.catTransport', icon: 'car-outline',       color: COSMIC.INFO },
  { key: 'electricity', labelKey: 'expenseLog.catElectricity', icon: 'flash-outline',   color: COSMIC.HARVEST },
  { key: 'tools',       labelKey: 'expenseLog.catTools',     icon: 'hammer-outline',    color: COSMIC.SPRAY },
  { key: 'other',       labelKey: 'cropScan.other',          icon: 'ellipsis-horizontal', color: COSMIC.TEXT_3 },
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

  const categories = CATEGORIES.map((c) => ({ ...c, label: t(c.labelKey) }));

  const handleSave = useCallback(async () => {
    if (!canSave) { Haptics.error?.(); Alert.alert(t('expenseLog.missingInfoTitle'), t('expenseLog.missingInfoMsg')); return; }
    if (!cycleId) { Alert.alert(t('expenseLog.noCycleTitle'), t('expenseLog.noCycleMsg')); return; }
    setSaving(true);
    try {
      const amt = parseFloat(amount);
      await farmApi.addExpenseLog(cycleId, { category, amountInr: amt, vendor: vendor || null, notes: notes || null });
      await farmApi.addActivity(cycleId, { type: 'EXPENSE', title: `${category} ₹${amount}`, notes: notes || null, fields: { category, amountInr: amt, vendor } });
      Haptics.success?.();
      setCelebrate(true);
    } catch (e) {
      Haptics.error?.();
      Alert.alert(t('login.error') || 'Error', e.message || t('expenseLog.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [canSave, cycleId, category, amount, vendor, notes, t]);

  const subtitle = activeFarm
    ? `${activeFarm.farmName || activeFarm.farmAlias || t('nav.farm')}${cycleId ? t('expenseLog.activeCycleSuffix') : ''}`
    : undefined;

  return (
    <LoggerScaffold
      title={t('expenseLog.title')} subtitle={subtitle}
      footerLabel={t('expenseLog.title')} footerIcon="cash-outline"
      saving={saving} canSave={canSave} onSave={handleSave}
      celebrate={celebrate}
      celebrateTitle={t('expenseLog.celebrateTitle')}
      celebrateSubtitle={t('expenseLog.celebrateSubtitle')}
      onCelebrateClose={() => { setCelebrate(false); navigation.goBack(); }}
    >
      <SectionHeader icon="pricetags-outline" tint={COSMIC.EXPENSE} title={t('products.category')} />
      <TileGrid items={categories} value={category} onChange={(v) => setCategory(v || 'other')} columns={3} />

      <SectionHeader icon="cash-outline" tint={COSMIC.EXPENSE} title={t('orders.amount')} />
      <Card><BigNumberInput value={amount} onChange={setAmount} unit="₹" tint={COSMIC.EXPENSE} /></Card>

      <SectionHeader icon="storefront-outline" tint={COSMIC.INFO} title={t('expenseLog.vendor')} optional />
      <Card><LabeledInput value={vendor} onChangeText={setVendor} placeholder={t('expenseLog.vendorPlaceholder')} /></Card>

      <SectionHeader icon="create-outline" tint={COSMIC.TEXT_3} title={t('expenseLog.notes')} optional />
      <Card><NotesField value={notes} onChange={setNotes} /></Card>
    </LoggerScaffold>
  );
}

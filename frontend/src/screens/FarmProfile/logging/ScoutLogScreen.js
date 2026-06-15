/**
 * ScoutLogScreen — record a field-scouting observation (pest, disease, weed,
 * deficiency or "all healthy") against a crop cycle. Non-healthy findings are
 * also written as an observed event so FarmMind can factor prior issues into
 * advice, alongside the unified SCOUT activity entry.
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

const ISSUE_TYPES = [
  { key: 'pest',       label: 'Pest',       icon: 'bug-outline',               color: COSMIC.SCOUT },
  { key: 'disease',    label: 'Disease',    icon: 'medkit-outline',            color: COSMIC.DANGER },
  { key: 'weed',       label: 'Weed',       icon: 'leaf-outline',              color: COSMIC.WEEDING },
  { key: 'deficiency', label: 'Deficiency', icon: 'flask-outline',             color: COSMIC.WARN },
  { key: 'healthy',    label: 'Healthy',    icon: 'checkmark-circle-outline',  color: COSMIC.SUCCESS },
];

const SEVERITIES = [
  { key: 'low',      label: 'Low',      icon: 'remove-outline',  color: COSMIC.SEV_LOW },
  { key: 'moderate', label: 'Moderate', icon: 'alert-outline',   color: COSMIC.SEV_MODERATE },
  { key: 'high',     label: 'High',     icon: 'warning-outline', color: COSMIC.SEV_HIGH },
  { key: 'critical', label: 'Critical', icon: 'skull-outline',   color: COSMIC.SEV_CRITICAL },
];

export default function ScoutLogScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { activeFarm } = useMultiFarm();
  const { cycleId } = route.params || {};

  const [issueType, setIssueType] = useState('');
  const [target, setTarget]       = useState('');
  const [severity, setSeverity]   = useState('moderate');
  const [affected, setAffected]   = useState('');
  const [notes, setNotes]         = useState('');
  const [saving, setSaving]       = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const canSave = !!issueType;

  const handleSave = useCallback(async () => {
    if (!canSave) { Haptics.error?.(); Alert.alert('Missing info', 'Pick what you saw.'); return; }
    if (!cycleId) { Alert.alert('Pick a crop cycle', 'Start a crop cycle first to log against it.'); return; }
    setSaving(true);
    try {
      const affectedPct = affected ? parseFloat(affected) : null;
      if (issueType !== 'healthy') {
        await farmApi.addObservedEvent(cycleId, {
          type: target || issueType,
          severity,
          damageEstimatePct: affectedPct,
          notes: notes || null,
        });
      }
      await farmApi.addActivity(cycleId, {
        type: 'SCOUT',
        title: target || issueType,
        notes: notes || null,
        fields: { issueType, target, severity, affectedPct },
      });
      Haptics.success?.();
      setCelebrate(true);
    } catch (e) {
      Haptics.error?.();
      Alert.alert(t('login.error') || 'Error', e.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }, [canSave, cycleId, issueType, target, severity, affected, notes, t]);

  const subtitle = activeFarm
    ? `${activeFarm.farmName || activeFarm.farmAlias || 'Farm'}${cycleId ? ' · active cycle' : ''}`
    : undefined;

  return (
    <LoggerScaffold
      title="Field scouting" subtitle={subtitle}
      footerLabel="Field scouting" footerIcon="search-outline"
      saving={saving} canSave={canSave} onSave={handleSave}
      celebrate={celebrate}
      celebrateTitle="Scouting logged ✓"
      celebrateSubtitle="CropSetu AI will factor this into advice."
      onCelebrateClose={() => { setCelebrate(false); navigation.goBack(); }}
    >
      <SectionHeader icon="eye-outline" tint={COSMIC.SCOUT} title="What did you see?" />
      <TileGrid items={ISSUE_TYPES} value={issueType} onChange={(v) => setIssueType(v || '')} columns={3} />

      <SectionHeader icon="pricetag-outline" tint={COSMIC.SCOUT} title="Name / target" optional />
      <Card><LabeledInput value={target} onChangeText={setTarget} placeholder="e.g. Aphids, Leaf curl" /></Card>

      <SectionHeader icon="speedometer-outline" tint={COSMIC.SCOUT} title="Severity" />
      <TileGrid items={SEVERITIES} value={severity} onChange={(v) => setSeverity(v || 'moderate')} columns={2} />

      <SectionHeader icon="pie-chart-outline" tint={COSMIC.SCOUT} title="Affected %" optional />
      <Card><BigNumberInput value={affected} onChange={setAffected} unit="%" tint={COSMIC.SCOUT} /></Card>

      <SectionHeader icon="create-outline" tint={COSMIC.TEXT_3} title="Notes" optional />
      <Card><NotesField value={notes} onChange={setNotes} /></Card>
    </LoggerScaffold>
  );
}

/**
 * RentVoiceAgentScreen — "Hey Krushi" voice flow for listing machinery OR labour.
 * Thin wrapper over <VoiceAgentEngine>. route.params.kind ('machinery' | 'labour')
 * picks the domain + the POST /rent/* endpoint (same payloads as AddMachinery/AddWorker).
 */
import React, { useCallback } from 'react';
import VoiceAgentEngine from '../AI/VoiceAgentEngine';
import { useLanguage } from '../../context/LanguageContext';
import api from '../../services/api';

const MACHINERY_FIELDS = ['name', 'category', 'brand', 'horsePower', 'fuelType', 'ageYears',
  'mileageHours', 'pricePerDay', 'pricePerHour', 'pricePerAcre', 'features', 'description', 'location', 'district'];
const LABOUR_FIELDS = ['name', 'leader', 'groupName', 'groupSize', 'skills', 'languages',
  'experience', 'pricePerDay', 'pricePerHour', 'phone', 'description', 'location', 'district'];

function pick(draft, fields) {
  const out = {};
  for (const k of fields) {
    const v = draft?.[k];
    if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) out[k] = v;
  }
  return out;
}

export default function RentVoiceAgentScreen({ navigation, route }) {
  const { t } = useLanguage();
  const kind = route?.params?.kind === 'labour' ? 'labour' : 'machinery';
  const domain = kind === 'labour' ? 'rent_labour' : 'rent_machinery';

  const onSave = useCallback(async (draft) => {
    if (!draft?.pricePerDay) throw new Error('Price per day is required');
    if (kind === 'labour') {
      await api.post('/rent/labour', pick(draft, LABOUR_FIELDS), { timeout: 30000 });
    } else {
      await api.post('/rent/machinery', pick(draft, MACHINERY_FIELDS), { timeout: 30000 });
    }
  }, [kind]);

  const title = kind === 'labour'
    ? t('voiceAgent.labourTitle', 'List farm labour')
    : t('voiceAgent.machineryTitle', 'Rent out machinery');
  const subtitle = kind === 'labour'
    ? t('voiceAgent.labourSubtitle', 'Name, skills, daily wage, location')
    : t('voiceAgent.machinerySubtitle', 'Machine, type, daily rent, location');

  return (
    <VoiceAgentEngine
      domain={domain}
      title={title}
      subtitle={subtitle}
      onSave={onSave}
      onClose={() => navigation.goBack()}
    />
  );
}

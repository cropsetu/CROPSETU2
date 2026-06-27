/**
 * AnimalVoiceAgentScreen — "Hey Krushi" voice flow for posting an animal for sale.
 * Thin wrapper over <VoiceAgentEngine> (domain 'animal_post'). Maps the captured
 * draft to the existing POST /animals multipart contract (same as AddAnimalListing).
 */
import React, { useCallback } from 'react';
import VoiceAgentEngine from '../AI/VoiceAgentEngine';
import { useLanguage } from '../../context/LanguageContext';
import api from '../../services/api';

// Text fields POST /animals accepts (images are added later via the normal form).
const ANIMAL_TEXT_FIELDS = ['animal', 'breed', 'age', 'gender', 'weight', 'price', 'milkYield', 'description', 'sellerLocation'];

function buildAnimalForm(draft) {
  const fd = new FormData();
  for (const k of ANIMAL_TEXT_FIELDS) {
    const v = draft?.[k];
    if (v !== null && v !== undefined && v !== '') fd.append(k, String(v));
  }
  // Frontend stores "vaccinated" as a tag (matches AddAnimalListing).
  if (draft?.vaccinated === true) fd.append('tags', 'Vaccinated');
  return fd;
}

export default function AnimalVoiceAgentScreen({ navigation }) {
  const { t } = useLanguage();

  const onSave = useCallback(async (draft) => {
    if (!draft?.price) throw new Error('Price is required');
    const fd = buildAnimalForm(draft);
    // No explicit Content-Type — RN sets the multipart boundary (mirrors AddAnimalListing).
    await api.post('/animals', fd, { timeout: 90000 });
  }, []);

  return (
    <VoiceAgentEngine
      domain="animal_post"
      title={t('voiceAgent.animalTitle', 'Sell an animal')}
      subtitle={t('voiceAgent.animalSubtitle', 'Type, breed, age, gender, weight, price')}
      onSave={onSave}
      onClose={() => navigation.goBack()}
    />
  );
}

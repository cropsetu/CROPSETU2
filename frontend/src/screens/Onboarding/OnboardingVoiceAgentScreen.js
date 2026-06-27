/**
 * OnboardingVoiceAgentScreen — "Hey Krushi" voice flow for first-time setup.
 * Thin wrapper over <VoiceAgentEngine> (domain 'onboarding'). Collects the farmer's
 * basics + first farm in one conversation, calls POST /onboarding/complete, then
 * refreshes the user so the app's onboarding gate flips to the main app.
 */
import React, { useCallback } from 'react';
import VoiceAgentEngine from '../AI/VoiceAgentEngine';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { completeOnboarding } from '../../services/farmApi';

const ONBOARDING_FIELDS = ['firstName', 'lastName', 'state', 'district', 'taluka', 'village',
  'pincode', 'farmName', 'landSizeAcres', 'soilType', 'irrigationType', 'cropTypes'];

export default function OnboardingVoiceAgentScreen({ navigation }) {
  const { t } = useLanguage();
  const { refreshUser } = useAuth();

  const onSave = useCallback(async (draft) => {
    const payload = {};
    for (const k of ONBOARDING_FIELDS) {
      const v = draft?.[k];
      if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) payload[k] = v;
    }
    if (!payload.firstName || !payload.district) throw new Error('Name and district are required');
    await completeOnboarding(payload);
    // Flip onboardingStep → COMPLETE so the root gate shows the main app.
    await refreshUser();
  }, [refreshUser]);

  return (
    <VoiceAgentEngine
      domain="onboarding"
      title={t('voiceAgent.onboardingTitle', 'Let’s get you set up')}
      subtitle={t('voiceAgent.onboardingSubtitle', 'Your name, district, and farm — just speak')}
      onSave={onSave}
      onClose={() => { if (navigation.canGoBack && navigation.canGoBack()) navigation.goBack(); }}
    />
  );
}

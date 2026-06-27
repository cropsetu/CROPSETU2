/**
 * ProfileVoiceAgentScreen — "Hey Krushi" voice flow for editing the user's profile.
 * Thin wrapper over <VoiceAgentEngine> (domain 'profile', a partial edit). Maps the
 * captured draft to PUT /users/me and syncs AuthContext so the change shows at once.
 */
import React, { useCallback } from 'react';
import VoiceAgentEngine from '../AI/VoiceAgentEngine';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

const PROFILE_FIELDS = ['name', 'statusQuote', 'village', 'taluka', 'district', 'city', 'state',
  'pincode', 'language', 'gender', 'education', 'farmingExperienceYrs'];

export default function ProfileVoiceAgentScreen({ navigation }) {
  const { t, setLanguage } = useLanguage();
  const { updateUser, refreshUser } = useAuth();

  const onSave = useCallback(async (draft) => {
    const payload = {};
    for (const k of PROFILE_FIELDS) {
      const v = draft?.[k];
      if (v !== null && v !== undefined && v !== '') payload[k] = v;
    }
    if (Object.keys(payload).length === 0) throw new Error('Nothing to update');
    const { data } = await api.put('/users/me', payload);
    if (data?.data) updateUser(data.data); else await refreshUser();
    // Keep the app UI language in sync if the farmer changed it by voice.
    if (payload.language) { try { setLanguage(payload.language); } catch { /* ignore */ } }
  }, [updateUser, refreshUser, setLanguage]);

  return (
    <VoiceAgentEngine
      domain="profile"
      title={t('voiceAgent.profileTitle', 'Edit profile by voice')}
      subtitle={t('voiceAgent.profileSubtitle', 'Say what to change — name, village, language…')}
      onSave={onSave}
      onClose={() => navigation.goBack()}
    />
  );
}

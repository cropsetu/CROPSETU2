/**
 * KrushiAssistantContext — the global "Hey Krushi" voice assistant.
 *
 * No buttons. The farmer says "Hey Krushi" (native wake word, see services/wakeWord.js);
 * this provider opens a full-screen assistant overlay with the animated edge glow,
 * picks the right DOMAIN from whatever screen they're on, runs the multi-turn voice
 * form, and saves through the correct API. It lives at the app root (inside Auth /
 * MultiFarm / Language providers) so one place holds every domain's save path.
 *
 * Domain is chosen by context:
 *   Animal tab → animal_post · Rent tab → rent_machinery · Profile → profile ·
 *   Farm/Crop → farm · new user mid-onboarding → onboarding · else → farm.
 *
 * openAssistant(domain?) can also be called directly (e.g. a future header entry).
 */
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Modal } from 'react-native';
import VoiceAgentEngine from '../screens/AI/VoiceAgentEngine';
import { useMultiFarm } from './MultiFarmContext';
import { useAuth } from './AuthContext';
import { useLanguage } from './LanguageContext';
import api from '../services/api';
import { completeOnboarding } from '../services/farmApi';
import { getActiveRoute } from '../navigation/navigationRef';
import { startWakeWord, stopWakeWord, pauseWakeWord, resumeWakeWord, isWakeWordAvailable } from '../services/wakeWord';

const KrushiAssistantContext = createContext(null);

// ── Field whitelists per domain (mirror the backend save contracts) ───────────
const FARM_FIELDS = ['farmName', 'farmNameMr', 'farmNameHi', 'village', 'taluka', 'district', 'state', 'pincode', 'landSizeAcres', 'landOwnership', 'soilType', 'soilColor', 'irrigationSystem', 'waterSources'];
const ANIMAL_FIELDS = ['animal', 'breed', 'age', 'gender', 'weight', 'price', 'milkYield', 'description', 'sellerLocation'];
const MACHINERY_FIELDS = ['name', 'category', 'brand', 'horsePower', 'fuelType', 'ageYears', 'mileageHours', 'pricePerDay', 'pricePerHour', 'pricePerAcre', 'features', 'description', 'location', 'district'];
const LABOUR_FIELDS = ['name', 'leader', 'groupName', 'groupSize', 'skills', 'languages', 'experience', 'pricePerDay', 'pricePerHour', 'phone', 'description', 'location', 'district'];
const PROFILE_FIELDS = ['name', 'statusQuote', 'village', 'taluka', 'district', 'city', 'state', 'pincode', 'language', 'gender', 'education', 'farmingExperienceYrs'];
const ONBOARDING_FIELDS = ['firstName', 'lastName', 'state', 'district', 'taluka', 'village', 'pincode', 'farmName', 'landSizeAcres', 'soilType', 'irrigationType', 'cropTypes'];

function pick(draft, fields) {
  const out = {};
  for (const k of fields) {
    const v = draft?.[k];
    if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) out[k] = v;
  }
  return out;
}

function deriveDomain(user) {
  if (user?.onboardingStep === 'BASIC' && !user?.totalFarms) return 'onboarding';
  const name = (getActiveRoute()?.name || '').toLowerCase();
  if (name.includes('animal')) return 'animal_post';
  if (name.includes('rent') || name.includes('machinery') || name.includes('labour')) return 'rent_machinery';
  if (name.includes('profile') || name.includes('account') || name.includes('seller')) return 'profile';
  if (name.includes('farm') || name.includes('crop')) return 'farm';
  return 'farm';
}

export function KrushiAssistantProvider({ children }) {
  const { isLoggedIn, user, updateUser, refreshUser } = useAuth();
  const { addFarm } = useMultiFarm();
  const { t, setLanguage } = useLanguage();
  const [active, setActive] = useState(false);
  const [domain, setDomain] = useState('farm');

  const openAssistant = useCallback((d) => {
    setDomain(d || deriveDomain(user));
    setActive(true);
    pauseWakeWord(); // release the mic so the assistant can record
  }, [user]);

  const closeAssistant = useCallback(() => {
    setActive(false);
    resumeWakeWord();
  }, []);

  // Start/stop the wake word with the session. Inert (no-op) until the native
  // build + Picovoice key + "Hey Krushi" model are in place — never crashes Expo Go.
  useEffect(() => {
    if (!isLoggedIn) return undefined;
    let mounted = true;
    startWakeWord(() => { if (mounted) openAssistant(); });
    return () => { mounted = false; stopWakeWord(); };
  }, [isLoggedIn, openAssistant]);

  const onSave = useCallback(async (draft) => {
    switch (domain) {
      case 'animal_post': {
        const fd = new FormData();
        for (const k of ANIMAL_FIELDS) {
          const v = draft?.[k];
          if (v !== null && v !== undefined && v !== '') fd.append(k, String(v));
        }
        if (draft?.vaccinated === true) fd.append('tags', 'Vaccinated');
        if (!draft?.price) throw new Error('Price is required');
        await api.post('/animals', fd, { timeout: 90000 });
        break;
      }
      case 'rent_machinery':
        if (!draft?.pricePerDay) throw new Error('Price per day is required');
        await api.post('/rent/machinery', pick(draft, MACHINERY_FIELDS), { timeout: 30000 });
        break;
      case 'rent_labour':
        if (!draft?.pricePerDay) throw new Error('Price per day is required');
        await api.post('/rent/labour', pick(draft, LABOUR_FIELDS), { timeout: 30000 });
        break;
      case 'profile': {
        const payload = pick(draft, PROFILE_FIELDS);
        if (!Object.keys(payload).length) throw new Error('Nothing to update');
        const { data } = await api.put('/users/me', payload);
        if (data?.data) updateUser(data.data); else await refreshUser();
        if (payload.language) { try { setLanguage(payload.language); } catch { /* ignore */ } }
        break;
      }
      case 'onboarding': {
        const payload = pick(draft, ONBOARDING_FIELDS);
        if (!payload.firstName || !payload.district) throw new Error('Name and district are required');
        await completeOnboarding(payload);
        await refreshUser();
        break;
      }
      case 'farm':
      default: {
        const payload = pick(draft, FARM_FIELDS);
        if (!payload.landSizeAcres) throw new Error('Land size is required');
        await addFarm(payload);
        break;
      }
    }
  }, [domain, addFarm, updateUser, refreshUser, setLanguage]);

  const TITLES = {
    farm:           [t('voiceAgent.farmTitle', 'Set up your farm'), t('voiceAgent.farmSubtitle', 'Land, soil, water, crops')],
    animal_post:    [t('voiceAgent.animalTitle', 'Sell an animal'), t('voiceAgent.animalSubtitle', 'Type, breed, age, price')],
    rent_machinery: [t('voiceAgent.machineryTitle', 'Rent out machinery'), t('voiceAgent.machinerySubtitle', 'Machine, type, daily rent, location')],
    rent_labour:    [t('voiceAgent.labourTitle', 'List farm labour'), t('voiceAgent.labourSubtitle', 'Name, skills, daily wage, location')],
    profile:        [t('voiceAgent.profileTitle', 'Edit profile by voice'), t('voiceAgent.profileSubtitle', 'Say what to change')],
    onboarding:     [t('voiceAgent.onboardingTitle', 'Let’s get you set up'), t('voiceAgent.onboardingSubtitle', 'Name, district, and farm')],
  };
  const [title, subtitle] = TITLES[domain] || TITLES.farm;

  return (
    <KrushiAssistantContext.Provider value={{ openAssistant, closeAssistant, active, domain, wakeWordAvailable: isWakeWordAvailable() }}>
      {children}
      <Modal visible={active} animationType="fade" onRequestClose={closeAssistant} statusBarTranslucent>
        {active && (
          <VoiceAgentEngine
            domain={domain}
            title={title}
            subtitle={subtitle}
            autoStart
            onSave={onSave}
            onClose={closeAssistant}
          />
        )}
      </Modal>
    </KrushiAssistantContext.Provider>
  );
}

export function useKrushiAssistant() {
  const ctx = useContext(KrushiAssistantContext);
  if (!ctx) throw new Error('useKrushiAssistant must be inside <KrushiAssistantProvider>');
  return ctx;
}

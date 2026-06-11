// ─────────────────────────────────────────────────────────────────────────────
// <ProfileSetupFlow/> — the 4-step wizard assembled, with handler stubs
// ─────────────────────────────────────────────────────────────────────────────
// Shown once, right after OTP (isNewUser). Owns ALL wizard state (preserved
// across Back/Next), local validation (only `name` is required), and the step
// transitions. Persistence is delegated to STUBS — onUploadPhoto, onDetectLocation,
// onSaveProfile, onSaveFarm, onSkip, onComplete — each overridable via props and
// defaulting to a simulated, demo-able implementation. See the `// TODO:` markers.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useMemo, useState } from 'react';
import OnboardingLayout from './components/OnboardingLayout';
import StepIdentity from './steps/StepIdentity';
import StepLanguage from './steps/StepLanguage';
import StepLocation from './steps/StepLocation';
import StepFarm from './steps/StepFarm';
import StepSuccess from './steps/StepSuccess';
import { OnbStringsProvider, createT } from './strings';
import { AuthThemeProvider } from './theme';
import { LAND } from './options';

const STEP_COUNT = 4;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nameIsValid = (n) => n.trim().length >= 2;

// ── Default (simulated) stubs — replace each body with a real call ───────────
async function defaultUploadPhoto(asset, onProgress) {
  // TODO: upload `asset` to Cloudinary and report real progress.
  return new Promise((resolve) => {
    let p = 0;
    const id = setInterval(() => {
      p += 0.18;
      onProgress(Math.min(p, 0.95));
      if (p >= 0.95) { clearInterval(id); setTimeout(() => resolve({ url: asset.uri }), 300); }
    }, 180);
  });
}
async function defaultDetectLocation(/* coords */) {
  // TODO: reverse-geocode the coordinates → address.
  await wait(1200);
  return { village: 'Shivpur', district: 'Nashik', state: 'Maharashtra', pincode: '422001' };
}
async function defaultSave() {
  // TODO: PATCH /me (profile) and POST /farm.
  await wait(1100);
}

/**
 * @param {object} props
 * @param {(asset:object,onProgress:(p:number)=>void)=>Promise<{url:string}>} [props.onUploadPhoto]
 * @param {(coords:object|null)=>Promise<object>} [props.onDetectLocation]
 * @param {(profile:object)=>Promise<void>} [props.onSaveProfile]
 * @param {(farm:object)=>Promise<void>} [props.onSaveFarm]
 * @param {() => void} [props.onSkip]
 * @param {() => void} [props.onComplete]
 * @param {'light'|'dark'} [props.forceScheme]
 * @param {(key:string,vars?:object)=>string} [props.t]  Inject the app's translator.
 */
export default function ProfileSetupFlow({
  onUploadPhoto = defaultUploadPhoto,
  onDetectLocation = defaultDetectLocation,
  onSaveProfile = defaultSave,
  onSaveFarm = defaultSave,
  onSkip,
  onComplete,
  forceScheme,
  t: injectedT,
}) {
  // ── State (preserved across steps) ──
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [done, setDone] = useState(false);

  const [photo, setPhoto] = useState({ uri: null, uploading: false, progress: 0, error: false });
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState(null);
  const [language, setLanguage] = useState('en');
  const [location, setLocation] = useState({ village: '', district: '', state: '', pincode: '' });
  const [farm, setFarm] = useState({
    landAcres: LAND.default, cropTypes: [], soilType: '', irrigationType: '',
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Demo translator: when no real `t` is injected, drive the bundled strings and
  // let the Step-2 language choice flip the UI live (en/hi are bundled).
  const uiLang = injectedT ? undefined : (['en', 'hi'].includes(language) ? language : 'en');
  const tForErrors = useMemo(() => injectedT || createT(uiLang || 'en'), [injectedT, uiLang]);

  // ── Photo ──
  const handlePickPhoto = useCallback(async (asset) => {
    setPhoto({ uri: asset.uri, uploading: true, progress: 0, error: false });
    try {
      const res = await onUploadPhoto(asset, (p) => setPhoto((prev) => ({ ...prev, progress: p })));
      setPhoto({ uri: res?.url || asset.uri, uploading: false, progress: 1, error: false });
    } catch {
      setPhoto((prev) => ({ ...prev, uploading: false, error: true }));
    }
  }, [onUploadPhoto]);

  const handleRemovePhoto = useCallback(() => {
    setPhoto({ uri: null, uploading: false, progress: 0, error: false });
  }, []);

  // ── Name ──
  const handleChangeName = useCallback((v) => {
    if (nameError) setNameError(null);   // forgiving: clear as they type
    setName(v);
  }, [nameError]);

  // ── Location / farm setters ──
  const handleLocationField = useCallback((field, value) => {
    setLocation((prev) => ({ ...prev, [field]: value }));
  }, []);
  const setFarmField = useCallback((field, value) => {
    setFarm((prev) => ({ ...prev, [field]: value }));
  }, []);

  // ── Navigation ──
  const goNext = useCallback(() => { setDirection(1); setStep((s) => s + 1); }, []);
  const goBack = useCallback(() => { setDirection(-1); setStep((s) => s - 1); }, []);

  const finish = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // TODO: persist profile + farm via the real handlers.
      await onSaveProfile({ name: name.trim(), photoUrl: photo.uri, language });
      await onSaveFarm({ ...location, ...farm });
      setSaving(false);
      setDone(true);
    } catch (err) {
      const code = err?.code || err?.name;
      setSaveError(code === 'NETWORK' ? tForErrors('onb.errNetwork') : tForErrors('onb.errSave'));
      setSaving(false);
    }
  }, [onSaveProfile, onSaveFarm, name, photo.uri, language, location, farm, tForErrors]);

  const handleNext = useCallback(() => {
    if (step === 0 && !nameIsValid(name)) {
      setNameError(name.trim().length === 0 ? tForErrors('onb.nameRequired') : tForErrors('onb.nameTooShort'));
      return;
    }
    if (step === STEP_COUNT - 1) { finish(); return; }
    goNext();
  }, [step, name, finish, goNext, tForErrors]);

  const handleSkip = useCallback(() => {
    // Leave the wizard now; nothing past the name is mandatory.
    // TODO: persist whatever has been entered, if desired.
    (onSkip || onComplete)?.();
  }, [onSkip, onComplete]);

  // ── Per-step config ──
  const isLast = step === STEP_COUNT - 1;
  const t = tForErrors;
  const STEP = [
    {
      key: 'identity',
      title: t('onb.identityTitle'), subtitle: t('onb.identitySubtitle'),
      nextDisabled: !nameIsValid(name),
      body: (
        <StepIdentity
          photo={photo} onPickPhoto={handlePickPhoto} onRemovePhoto={handleRemovePhoto}
          name={name} onChangeName={handleChangeName} nameError={nameError}
        />
      ),
    },
    {
      key: 'language',
      title: t('onb.languageTitle'), subtitle: t('onb.languageSubtitle'),
      body: <StepLanguage language={language} onChangeLanguage={setLanguage} />,
    },
    {
      key: 'location',
      title: t('onb.locationTitle'), subtitle: t('onb.locationSubtitle'),
      body: <StepLocation location={location} onChangeField={handleLocationField} onDetect={onDetectLocation} />,
    },
    {
      key: 'farm',
      title: t('onb.farmTitle'), subtitle: t('onb.farmSubtitle'),
      body: (
        <StepFarm
          landAcres={farm.landAcres} onChangeLand={(v) => setFarmField('landAcres', v)}
          cropTypes={farm.cropTypes} onChangeCrops={(v) => setFarmField('cropTypes', v)}
          soilType={farm.soilType} onChangeSoil={(v) => setFarmField('soilType', v)}
          irrigationType={farm.irrigationType} onChangeIrrigation={(v) => setFarmField('irrigationType', v)}
        />
      ),
    },
  ][step];

  const content = done ? (
    <StepSuccess onComplete={onComplete} />
  ) : (
    <OnboardingLayout
      stepIndex={step}
      stepCount={STEP_COUNT}
      stepKey={STEP.key}
      direction={direction}
      title={STEP.title}
      subtitle={STEP.subtitle}
      onBack={step > 0 ? goBack : undefined}
      onSkip={step >= 1 ? handleSkip : undefined}        // name (step 0) is required
      nextLabel={isLast ? (saveError ? t('onb.retry') : t('onb.finish')) : t('onb.next')}
      nextLoadingLabel={t('onb.saving')}
      nextLoading={saving}
      nextDisabled={STEP.nextDisabled || saving}
      onNext={handleNext}
      footerError={isLast ? saveError : null}
    >
      {STEP.body}
    </OnboardingLayout>
  );

  return (
    <AuthThemeProvider scheme={forceScheme || null}>
      <OnbStringsProvider t={injectedT} lang={uiLang}>
        {content}
      </OnbStringsProvider>
    </AuthThemeProvider>
  );
}

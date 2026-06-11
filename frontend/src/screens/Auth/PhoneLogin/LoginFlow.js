// ─────────────────────────────────────────────────────────────────────────────
// <LoginFlow/> — the two screens assembled, with handler stubs
// ─────────────────────────────────────────────────────────────────────────────
// This is the deliverable wiring AND a self-contained, runnable demo. It owns
// the step + phone state shared across screens and supplies `onSendOtp`,
// `onVerifyOtp`, `onResendOtp` as STUBS (simulated latency, no real network).
// Pass your own implementations as props to plug in the real auth backend —
// see the `// TODO:` markers below.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useMemo, useState } from 'react';
import LandingScreen from '../Landing/LandingScreen';
import PhoneEntryScreen from './PhoneEntryScreen';
import OtpVerificationScreen from './OtpVerificationScreen';
import { AuthStringsProvider } from './strings';
import { AuthThemeProvider } from './theme';

// LANDING (welcome) → PHONE (number) → OTP (verify).
const STEP = { LANDING: 'landing', PHONE: 'phone', OTP: 'otp' };

/** Resolve after `ms`, simulating a slow rural-network round-trip. */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} props
 * @param {(phone:string)=>Promise<void>} [props.onSendOtp]    Defaults to a stub.
 * @param {(phone:string, otp:string)=>Promise<void>} [props.onVerifyOtp]
 * @param {(phone:string)=>Promise<void>} [props.onResendOtp]
 * @param {() => void} [props.onComplete]   Fired after a verified login.
 * @param {() => void} [props.onGuest]
 * @param {'light'|'dark'} [props.forceScheme]   Force a theme (else follow OS).
 * @param {(key:string,vars?:object)=>string} [props.t]   Inject the app's translator.
 */
export default function LoginFlow({
  onSendOtp,
  onVerifyOtp,
  onResendOtp,
  onComplete,
  onGuest,
  forceScheme,
  t: injectedT,
}) {
  const [step, setStep] = useState(STEP.LANDING);
  const [phone, setPhone] = useState('');
  // Bundled-stub language toggle is only meaningful when no real `t` is injected.
  const [lang, setLang] = useState('en');

  // ── Handler stubs ──────────────────────────────────────────────────────────
  // Replace each body with a real API call. They intentionally model latency so
  // the loading / slow-network states are visible during development.
  const sendOtp = useCallback(
    async (num) => {
      if (onSendOtp) return onSendOtp(num);
      // TODO: await api.post('/auth/otp/send', { phone: num })
      await wait(1200);
    },
    [onSendOtp],
  );

  const verifyOtp = useCallback(
    async (otp) => {
      if (onVerifyOtp) return onVerifyOtp(phone, otp);
      // TODO: await api.post('/auth/otp/verify', { phone, otp }) → store token
      await wait(1100);
      // Demo: only "123456" is accepted, so the error/shake state is reachable.
      if (otp !== '123456') {
        const err = new Error('Invalid OTP');
        err.code = 'WRONG_OTP';
        throw err;
      }
    },
    [onVerifyOtp, phone],
  );

  const resendOtp = useCallback(
    async () => {
      if (onResendOtp) return onResendOtp(phone);
      // TODO: await api.post('/auth/otp/resend', { phone })
      await wait(900);
    },
    [onResendOtp, phone],
  );

  // ── Navigation between the two steps ────────────────────────────────────────
  const goToOtp = useCallback(async (num) => {
    await sendOtp(num);          // rejects → PhoneEntryScreen surfaces the error
    setStep(STEP.OTP);           // only advance on success
  }, [sendOtp]);

  const verified = useCallback(() => {
    // TODO: route into the app / onboarding once the token is persisted.
    onComplete?.();
  }, [onComplete]);

  // Only expose the bundled-stub language toggle when the app isn't driving i18n.
  const onToggleLanguage = injectedT ? undefined : () => setLang((l) => (l === 'en' ? 'hi' : 'en'));
  const languageCode = lang.toUpperCase();

  const content = useMemo(() => {
    if (step === STEP.OTP) {
      return (
        <OtpVerificationScreen
          phone={phone}
          onVerifyOtp={verifyOtp}
          onResendOtp={resendOtp}
          onEditNumber={() => setStep(STEP.PHONE)}
          onVerified={verified}
          resendCooldown={30}
        />
      );
    }
    if (step === STEP.PHONE) {
      return (
        <PhoneEntryScreen
          phone={phone}
          onChangePhone={setPhone}
          onSendOtp={goToOtp}
          onGuest={onGuest}
          languageCode={languageCode}
          onToggleLanguage={onToggleLanguage}
          onTerms={() => { /* TODO: open Terms of Use */ }}
          onPrivacy={() => { /* TODO: open Privacy Policy */ }}
        />
      );
    }
    // STEP.LANDING — the welcome screen; "Get started" advances into the flow.
    return (
      <LandingScreen
        onGetStarted={() => setStep(STEP.PHONE)}
        onGuest={onGuest}
        languageCode={languageCode}
        onToggleLanguage={onToggleLanguage}
        onTerms={() => { /* TODO: open Terms of Use */ }}
        onPrivacy={() => { /* TODO: open Privacy Policy */ }}
      />
    );
  }, [step, phone, verifyOtp, resendOtp, verified, goToOtp, onGuest, languageCode, onToggleLanguage]);

  return (
    <AuthThemeProvider scheme={forceScheme || null}>
      <AuthStringsProvider t={injectedT} lang={lang}>
        {content}
      </AuthStringsProvider>
    </AuthThemeProvider>
  );
}

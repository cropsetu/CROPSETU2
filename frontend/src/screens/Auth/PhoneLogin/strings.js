// ─────────────────────────────────────────────────────────────────────────────
// CropSetu · Auth Copy + t() stub
// ─────────────────────────────────────────────────────────────────────────────
// EVERY user-facing string in this module is listed once, here, keyed under
// `auth.*`. Components only ever call `t('auth.someKey')` — never a literal — so
// localisation is a matter of adding language tables below.
//
// `en` is the source of truth. `hi` is included specifically to pressure-test
// layout against longer Devanagari strings (the brief asks for ~1.6x). To wire
// this module to the app's real i18n, pass the app's `t` into
// <AuthStringsProvider t={appT}> — the bundled stub is only the default.
// ─────────────────────────────────────────────────────────────────────────────
import React, { createContext, useContext, useMemo } from 'react';

export const STRINGS = {
  en: {
    auth: {
      appName: 'CropSetu',
      tagline: 'Kisan Ki Awaaz · किसान की आवाज़',

      // ── Phone entry ──
      phoneTitle: 'Enter your mobile number',
      phoneSubtitle: "We'll send a 6-digit code to verify it's you.",
      phoneLabel: 'Mobile number',
      phonePlaceholder: '00000 00000',
      getOtp: 'Get OTP',
      sending: 'Sending…',
      trustLine: 'Your number is safe. We never share it or spam you.',

      // ── OTP verification ──
      otpTitle: 'Enter the 6-digit code',
      otpSentTo: 'Sent to {{phone}}',
      otpLabel: 'One-time password',
      editNumber: 'Edit number',
      verify: 'Verify & continue',
      verifying: 'Verifying…',
      verified: 'Verified!',
      resendIn: 'Resend code in {{time}}',
      resend: 'Resend code',
      resending: 'Sending a new code…',

      // ── Errors (plain language — never a raw code) ──
      errInvalidPhone: 'Please enter a valid 10-digit mobile number.',
      errInvalidOtp: 'That code looks incomplete. Enter all 6 digits.',
      errWrongOtp: 'That code is incorrect. Please check and try again.',
      errNetwork: 'No internet. Check your connection and try again.',
      errSendFailed: "We couldn't send the code. Please try again.",
      errTooMany: 'Too many attempts. Please wait a moment and retry.',

      // ── Secondary / legal ──
      guest: 'Continue as guest',
      language: 'Language',
      legalPrefix: 'By continuing, you agree to our',
      terms: 'Terms of Use',
      and: 'and',
      privacy: 'Privacy Policy',

      // ── Accessibility-only labels ──
      a11yBack: 'Go back to mobile number entry',
      a11yPhoneField: 'Mobile number, 10 digits, country code plus 91',
      a11yOtpField: 'One-time password, 6 digits',
      a11yLanguage: 'Change language',
    },
  },

  // Devanagari sample — intentionally verbose to stress long-string layout.
  hi: {
    auth: {
      appName: 'क्रॉपसेतु',
      tagline: 'किसान की आवाज़',

      phoneTitle: 'अपना मोबाइल नंबर दर्ज करें',
      phoneSubtitle: 'पुष्टि के लिए हम आपको 6 अंकों का कोड भेजेंगे।',
      phoneLabel: 'मोबाइल नंबर',
      phonePlaceholder: '00000 00000',
      getOtp: 'ओटीपी भेजें',
      sending: 'भेजा जा रहा है…',
      trustLine: 'आपका नंबर सुरक्षित है। हम इसे कभी साझा नहीं करते।',

      otpTitle: '6 अंकों का कोड दर्ज करें',
      otpSentTo: '{{phone}} पर भेजा गया',
      otpLabel: 'एक-बार उपयोग होने वाला पासवर्ड',
      editNumber: 'नंबर बदलें',
      verify: 'सत्यापित करें और आगे बढ़ें',
      verifying: 'सत्यापित किया जा रहा है…',
      verified: 'सत्यापित!',
      resendIn: '{{time}} में कोड फिर भेजें',
      resend: 'कोड फिर भेजें',
      resending: 'नया कोड भेजा जा रहा है…',

      errInvalidPhone: 'कृपया एक मान्य 10 अंकों का मोबाइल नंबर दर्ज करें।',
      errInvalidOtp: 'कोड अधूरा लगता है। सभी 6 अंक दर्ज करें।',
      errWrongOtp: 'यह कोड गलत है। कृपया जाँचें और पुनः प्रयास करें।',
      errNetwork: 'इंटरनेट नहीं है। कनेक्शन जाँचें और पुनः प्रयास करें।',
      errSendFailed: 'हम कोड नहीं भेज सके। कृपया पुनः प्रयास करें।',
      errTooMany: 'बहुत अधिक प्रयास। कृपया थोड़ी देर रुकें और पुनः प्रयास करें।',

      guest: 'अतिथि के रूप में जारी रखें',
      language: 'भाषा',
      legalPrefix: 'जारी रखते हुए, आप हमारी',
      terms: 'उपयोग की शर्तें',
      and: 'और',
      privacy: 'गोपनीयता नीति',

      a11yBack: 'मोबाइल नंबर वाली स्क्रीन पर वापस जाएँ',
      a11yPhoneField: 'मोबाइल नंबर, 10 अंक, देश कोड प्लस 91',
      a11yOtpField: 'एक-बार उपयोग होने वाला पासवर्ड, 6 अंक',
      a11yLanguage: 'भाषा बदलें',
    },
  },
};

/**
 * createT — builds a `t(key, vars)` stub bound to a language. Mirrors the app's
 * LanguageContext contract: dot-notation keys + `{{var}}` interpolation, with a
 * graceful fallback to English then to the key itself.
 *
 * @param {'en'|'hi'|string} lang
 * @returns {(key: string, vars?: Record<string, string|number>) => string}
 */
export function createT(lang = 'en') {
  const lookup = (dict, key) =>
    key.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), dict);

  return (key, vars) => {
    const raw = lookup(STRINGS[lang], key) ?? lookup(STRINGS.en, key);
    const value = typeof raw === 'string' ? raw : key; // never crash on a bad key
    if (!vars) return value;
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
      vars[k] != null ? String(vars[k]) : `{{${k}}}`,
    );
  };
}

// ── Provider so the host app can inject its own t() ─────────────────────────
const AuthStringsContext = createContext(createT('en'));

/**
 * AuthStringsProvider — supplies the `t` used by every auth component.
 *   • Pass `t` to inject the app's real translator (e.g. useLanguage().t).
 *   • Or pass `lang` to use the bundled stub in that language (demo / Storybook).
 */
export function AuthStringsProvider({ t, lang = 'en', children }) {
  const value = useMemo(() => t || createT(lang), [t, lang]);
  return <AuthStringsContext.Provider value={value}>{children}</AuthStringsContext.Provider>;
}

/** useT — the single hook every auth component uses to read copy. */
export function useT() {
  return useContext(AuthStringsContext);
}

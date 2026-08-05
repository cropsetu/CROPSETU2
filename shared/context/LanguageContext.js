/**
 * LanguageContext — provides `t()` translation helper and language switching.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { translations, LANGUAGES } from '../i18n/translations';
import { getItem, setItem } from '../utils/storage';

const LANG_KEY      = 'farmeasy_language';
const CHAT_LANG_KEY = 'farmeasy_chat_language';   // 'auto' | language code
const RESP_LEN_KEY  = 'farmeasy_response_length'; // 'short' | 'medium' | 'long' | 'extra_long'
const DEFAULT_LANG  = 'en';
const RESP_LENGTHS  = ['short', 'medium', 'long', 'extra_long'];
const DEFAULT_RESP_LEN = 'short';

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguageState]         = useState(DEFAULT_LANG);
  // Chat-specific language preference. 'auto' means detect-per-message from
  // the user's message script. Distinct from `language` so picking auto in
  // the chat header doesn't switch the entire UI to an untranslated state.
  const [chatLanguage, setChatLanguageState] = useState(DEFAULT_LANG);
  // Chat reply length preference. Mirrors chatLanguage: persisted separately so
  // the farmer's pick (Short/Medium/Long/Extra Long) survives app restarts.
  const [responseLength, setResponseLengthState] = useState(DEFAULT_RESP_LEN);
  const [ready, setReady] = useState(false);

  // Load saved language preferences
  useEffect(() => {
    (async () => {
      try {
        const [savedApp, savedChat, savedRespLen] = await Promise.all([
          getItem(LANG_KEY),
          getItem(CHAT_LANG_KEY),
          getItem(RESP_LEN_KEY),
        ]);
        const appLang = savedApp && translations[savedApp] ? savedApp : DEFAULT_LANG;
        setLanguageState(appLang);
        // Chat language defaults to the app language unless the user has
        // explicitly opted into 'auto' or a different code in the past.
        if (savedChat && (savedChat === 'auto' || translations[savedChat])) {
          setChatLanguageState(savedChat);
        } else {
          setChatLanguageState(appLang);
        }
        if (savedRespLen && RESP_LENGTHS.includes(savedRespLen)) {
          setResponseLengthState(savedRespLen);
        }
      } catch {
        // ignore
      }
      setReady(true);
    })();
  }, []);

  const setLanguage = useCallback(async (lang) => {
    if (translations[lang]) {
      setLanguageState(lang);
      await setItem(LANG_KEY, lang);
    }
  }, []);

  // Accepts 'auto' or any code present in `translations`. Persists separately
  // from `language` so the UI can stay in (e.g.) Marathi while chat replies
  // detect-per-message.
  const setChatLanguage = useCallback(async (lang) => {
    if (lang !== 'auto' && !translations[lang]) return;
    setChatLanguageState(lang);
    await setItem(CHAT_LANG_KEY, lang);
  }, []);

  // Persist the chat reply-length preference (Short/Medium/Long/Extra Long).
  const setResponseLength = useCallback(async (len) => {
    if (!RESP_LENGTHS.includes(len)) return;
    setResponseLengthState(len);
    await setItem(RESP_LEN_KEY, len);
  }, []);

  const t = useCallback(
    (key, fallbackOrVars) => {
      // Second arg can be:
      //   - string → fallback value if key not found
      //   - object → interpolation vars (e.g. { phone: '9876543210' } replaces {{phone}})
      const isVarsObject =
        fallbackOrVars && typeof fallbackOrVars === 'object' && !Array.isArray(fallbackOrVars);
      const vars = isVarsObject ? fallbackOrVars : null;
      const fallback = isVarsObject ? undefined : fallbackOrVars;

      // Resolve dot-notation paths: 'login.enterPhone' -> dict.login.enterPhone.
      // Fall back to flat-key lookup first for back-compat.
      const lookup = (dict) => {
        if (!dict || typeof key !== 'string') return undefined;
        if (typeof dict[key] === 'string') return dict[key];
        return key.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), dict);
      };
      const raw = lookup(translations[language]) ?? lookup(translations[DEFAULT_LANG]);
      const value = typeof raw === 'string' ? raw : (fallback ?? key);

      // Replace {{placeholder}} tokens with vars.
      if (!vars) return value;
      return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
        vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : `{{${k}}}`
      );
    },
    [language],
  );

  // Memoize the context value so consumers don't re-render on every
  // LanguageProvider render. All callbacks are already stable (useCallback);
  // this only changes identity when the underlying state actually changes.
  const value = useMemo(
    () => ({ language, setLanguage, chatLanguage, setChatLanguage, responseLength, setResponseLength, t, LANGUAGES }),
    [language, setLanguage, chatLanguage, setChatLanguage, responseLength, setResponseLength, t],
  );

  if (!ready) return null;

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}

export default LanguageContext;

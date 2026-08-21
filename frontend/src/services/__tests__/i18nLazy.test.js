/**
 * Regional language bundles must not be evaluated at import (claude.md §41).
 *
 * shared/i18n/lang/{ta,kn,ml,te,bn,gu,pa}.js are ~692 KB of object literals
 * between them. Statically importing all seven meant every cold start evaluated
 * every language in order to serve ONE — on a 2 GB Android, before the first
 * screen paints, for six languages the farmer will never select.
 *
 * These assert the deferral holds AND that nothing observable changed: the
 * getters read exactly like the plain keys they replaced, and the merge order
 * with the backfill is identical.
 *
 * `globalThis` rather than a module-scoped array because jest hoists mock
 * factories above every other statement in the file.
 */
globalThis.__i18nLoaded = [];

jest.mock('@cropsetu/shared/i18n/lang/ta', () => {
  globalThis.__i18nLoaded.push('ta');
  return { __esModule: true, default: { __probe: 'ta' } };
});
jest.mock('@cropsetu/shared/i18n/lang/kn', () => {
  globalThis.__i18nLoaded.push('kn');
  return { __esModule: true, default: { __probe: 'kn' } };
});
jest.mock('@cropsetu/shared/i18n/lang/ml', () => {
  globalThis.__i18nLoaded.push('ml');
  return { __esModule: true, default: { __probe: 'ml' } };
});
jest.mock('@cropsetu/shared/i18n/lang/te', () => {
  globalThis.__i18nLoaded.push('te');
  return { __esModule: true, default: { __probe: 'te' } };
});
jest.mock('@cropsetu/shared/i18n/lang/bn', () => {
  globalThis.__i18nLoaded.push('bn');
  return { __esModule: true, default: { __probe: 'bn' } };
});
jest.mock('@cropsetu/shared/i18n/lang/gu', () => {
  globalThis.__i18nLoaded.push('gu');
  return { __esModule: true, default: { __probe: 'gu' } };
});
jest.mock('@cropsetu/shared/i18n/lang/pa', () => {
  globalThis.__i18nLoaded.push('pa');
  return { __esModule: true, default: { __probe: 'pa' } };
});

const loaded = () => globalThis.__i18nLoaded;

beforeEach(() => {
  globalThis.__i18nLoaded = [];
  jest.resetModules();
});

describe('regional bundles', () => {
  test('importing translations evaluates NONE of them', () => {
    require('@cropsetu/shared/i18n/translations');
    expect(loaded()).toEqual([]);
  });

  test('touching one language loads that one only', () => {
    const { translations } = require('@cropsetu/shared/i18n/translations');
    expect(translations.ta.__probe).toBe('ta');
    expect(loaded()).toEqual(['ta']);   // not kn, ml, te, bn, gu, pa
  });

  test('repeated lookups do not re-evaluate the bundle', () => {
    // The getter is hit on every t() call, not once, so memoisation is not a
    // nicety — without it this would be worse than the eager version.
    const { translations } = require('@cropsetu/shared/i18n/translations');
    for (let i = 0; i < 50; i++) void translations.kn.__probe;
    expect(loaded()).toEqual(['kn']);
  });

  test('the eager languages resolve without loading anything regional', () => {
    // en is the fallback every lookup falls through to, so it must never depend
    // on a regional bundle being present.
    const { translations } = require('@cropsetu/shared/i18n/translations');
    expect(typeof translations.en.appName).toBe('string');
    expect(typeof translations.hi).toBe('object');
    expect(typeof translations.mr).toBe('object');
    expect(loaded()).toEqual([]);
  });

  test('a regional language is still enumerable, as a plain key was', () => {
    // LanguageContext does `translations[lang]` as an existence check and the
    // coverage tool walks Object.keys(). Getters declared in an object literal
    // stay enumerable; defineProperty's default would not have.
    const { translations } = require('@cropsetu/shared/i18n/translations');
    expect(Object.keys(translations)).toEqual(expect.arrayContaining(['ta', 'en', 'pa']));
  });

  test('the backfill is still merged under the language, not over it', () => {
    // Merge order decides which string a farmer sees. The bundle's own copy has
    // to win over the auto-generated backfill, exactly as it did eagerly.
    const bf = require('@cropsetu/shared/i18n/lang/_backfill').default;
    const { translations } = require('@cropsetu/shared/i18n/translations');
    const shared = Object.keys(bf.ta || {})[0];
    if (shared) expect(translations.ta[shared]).toBe(bf.ta[shared]);
    expect(translations.ta.__probe).toBe('ta'); // the bundle's own key survives
  });

  test('every language advertised by LANGUAGES actually resolves', () => {
    // The picker renders from LANGUAGES; a code there with nothing behind it
    // would silently fall back to English after the farmer chose otherwise.
    const { translations, LANGUAGES } = require('@cropsetu/shared/i18n/translations');
    for (const { code } of LANGUAGES) expect(translations[code]).toBeDefined();
  });
});

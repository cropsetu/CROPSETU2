/**
 * The backfill must not construct all ten languages at import (claude.md §40/§41).
 *
 * lang/_backfill.js used to be one 690 KB file holding ten flat dictionaries of
 * 861 keys each. translations.js imports it at module scope and LanguageProvider
 * mounts at the root of both apps, so every cold start built all ten — on a
 * phone that will only ever display one.
 *
 * The seven regional bundles were already made lazy in translations.js
 * (_regionalBundle), but that laziness bought nothing for this half: the object
 * those getters read FROM was still constructed eagerly. This is the other half.
 *
 * Measured on node v24 / V8: 4.34 ms of eval and 1,199 KB retained before,
 * 1.35 ms and 355 KB after. The retained heap is the number that matters on the
 * low-end Android §40 targets.
 *
 * `globalThis` rather than a module-scoped array because jest hoists mock
 * factories above every other statement in the file — the same reason the
 * sibling i18nLazy suite does it.
 */
globalThis.__bfLoaded = [];

// Written out one by one rather than through a helper: jest requires the mock
// factory to be an INLINE function literal, because it hoists these calls above
// everything else in the file.
jest.mock('@cropsetu/shared/i18n/lang/backfill/ta', () => {
  globalThis.__bfLoaded.push('ta');
  return { __esModule: true, default: { __probe_ta: 'ta' } };
});
jest.mock('@cropsetu/shared/i18n/lang/backfill/kn', () => {
  globalThis.__bfLoaded.push('kn');
  return { __esModule: true, default: { __probe_kn: 'kn' } };
});
jest.mock('@cropsetu/shared/i18n/lang/backfill/ml', () => {
  globalThis.__bfLoaded.push('ml');
  return { __esModule: true, default: { __probe_ml: 'ml' } };
});
jest.mock('@cropsetu/shared/i18n/lang/backfill/te', () => {
  globalThis.__bfLoaded.push('te');
  return { __esModule: true, default: { __probe_te: 'te' } };
});
jest.mock('@cropsetu/shared/i18n/lang/backfill/bn', () => {
  globalThis.__bfLoaded.push('bn');
  return { __esModule: true, default: { __probe_bn: 'bn' } };
});
jest.mock('@cropsetu/shared/i18n/lang/backfill/gu', () => {
  globalThis.__bfLoaded.push('gu');
  return { __esModule: true, default: { __probe_gu: 'gu' } };
});
jest.mock('@cropsetu/shared/i18n/lang/backfill/pa', () => {
  globalThis.__bfLoaded.push('pa');
  return { __esModule: true, default: { __probe_pa: 'pa' } };
});

const bf = require('@cropsetu/shared/i18n/lang/_backfill').default;

const REGIONAL = ['ta', 'kn', 'ml', 'te', 'bn', 'gu', 'pa'];

describe('backfill laziness', () => {
  it('evaluates none of the seven regional slices at import', () => {
    // The whole point. Importing the module must cost only en/hi/mr.
    expect(globalThis.__bfLoaded).toEqual([]);
  });

  it('evaluates a slice on first access, and only that one', () => {
    expect(bf.ta.__probe_ta).toBe('ta');
    expect(globalThis.__bfLoaded).toEqual(['ta']);
    expect(bf.bn.__probe_bn).toBe('bn');
    expect(globalThis.__bfLoaded).toEqual(['ta', 'bn']);
  });

  it('memoises, so repeated lookups do not re-run the module factory', () => {
    // _regionalBundle reads its language on every lookup. Without memoisation
    // this would be worse than eager, not better.
    const before = globalThis.__bfLoaded.length;
    for (let i = 0; i < 25; i++) void bf.ta.__probe_ta;
    expect(globalThis.__bfLoaded.length).toBe(before);
  });

  it('returns the identical object each time, so spread order is stable', () => {
    expect(bf.kn).toBe(bf.kn);
  });

  it('keeps en, hi and mr eager', () => {
    // Not laziness for its own sake: `en` is the fallback for every missed
    // lookup in every language, and hi/mr are spread into plain object literals
    // in translations.js. Deferring them would mean turning ~2,100 lines of
    // inline literal into getters — deliberately out of scope.
    for (const code of ['en', 'hi', 'mr']) {
      expect(Object.getOwnPropertyDescriptor(bf, code).get).toBeUndefined();
      expect(Object.keys(bf[code]).length).toBeGreaterThan(800);
    }
  });

  it('reads exactly like the plain object it replaced', () => {
    // Enumerable getters: `bf[code]`, Object.keys and spread must all behave as
    // before, or translations.js's `{ ...bf[code] }` silently yields nothing.
    expect(Object.keys(bf).sort()).toEqual(
      ['en', 'hi', 'mr', ...REGIONAL].sort(),
    );
    for (const code of REGIONAL) {
      expect(Object.getOwnPropertyDescriptor(bf, code).enumerable).toBe(true);
    }
    expect({ ...bf.ta }).toEqual({ __probe_ta: 'ta' });
  });
});

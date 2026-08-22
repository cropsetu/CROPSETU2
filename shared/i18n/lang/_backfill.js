/**
 * i18n backfill — keys referenced in code but missing from the merged
 * translations. Spread FIRST in translations.js, so a language's own keys
 * always win.
 *
 * This module used to be one 690 KB file holding all ten languages as plain
 * object literals — 861 keys each. translations.js imports it at module scope
 * and LanguageProvider mounts at the root of both apps, so every cold start
 * constructed all ten, on a phone that will only ever display one.
 *
 * Only three can actually be needed at import time: `en` (the fallback every
 * t() falls through to) and `hi`/`mr`, which are spread into plain object
 * literals inside translations.js. The other seven feed `_regionalBundle()`,
 * which is already lazy — but the object it read from was being built eagerly
 * regardless, so the laziness bought nothing for this half.
 *
 * Measured on node v24 / V8, importing and then touching `en`:
 *
 *   before   7.18 ms eval,  5,136 KB heapUsed   (one 690,975-byte module)
 *   after    4.27 ms eval,  3,939 KB heapUsed   (177,188 bytes eager,
 *                                                501,998 bytes deferred — 73%)
 *
 * The ~1.2 MB of heap is the number that matters on the low-end Android
 * CLAUDE.md §40 targets, not the milliseconds. On Hermes the shape of the win
 * differs — bytecode is compiled lazily there, so the saving is object
 * construction and retention rather than parse — and it is NOT measured. Do not
 * quote the millisecond figure as a device number.
 *
 * The module path is unchanged, so no consumer needed touching: translations.js
 * still does `import bf from './lang/_backfill'` and reads `bf[code]`.
 *
 * Two details this leans on, both already proven by the regional-bundle getters
 * in translations.js that it mirrors:
 *   - literal require paths, so Metro still bundles every language statically;
 *     only EVALUATION defers. No dynamic import, no async, no split bundle.
 *   - memoisation, because `_regionalBundle` reads its language on every lookup
 *     and re-running the module factory each time would be worse than eager.
 */
import en from './backfill/en';
import hi from './backfill/hi';
import mr from './backfill/mr';

// Lazy: the seven regional languages, reached only through _regionalBundle().
const _lazy = {
  ta: () => require('./backfill/ta').default,
  kn: () => require('./backfill/kn').default,
  ml: () => require('./backfill/ml').default,
  te: () => require('./backfill/te').default,
  bn: () => require('./backfill/bn').default,
  gu: () => require('./backfill/gu').default,
  pa: () => require('./backfill/pa').default,
};

const _memo = {};
function _slice(code) {
  if (!_memo[code]) _memo[code] = _lazy[code]();
  return _memo[code];
}

// Getters, not values. Enumerable and readable exactly like the plain keys they
// replaced — `bf.ta`, `bf[code]` and Object.keys(bf) all behave the same — but
// nothing is evaluated until a lookup asks for it.
//
// en/hi/mr are listed as plain properties here rather than spread in from an
// object, and that is NOT cosmetic. Babel compiles a literal that mixes a
// spread with getter definitions through its `_objectSpread` helper, which
// READS every property while assembling the result — invoking the getters and
// flattening them to plain values. The module would still work and every test
// of its contents would still pass; it would simply have loaded all ten
// languages at import, which is the entire thing this file exists to avoid.
// Caught by the "evaluates none at import" test below. Do not reintroduce a
// spread here.
//
// They stay eager on purpose: `en` is the fallback for every missed lookup in
// every language, and hi/mr are spread into plain object literals inside
// translations.js. Deferring those would mean turning ~2,100 lines of inline
// literal into getters — a much larger, riskier diff for the two languages most
// likely to be in use anyway. Deliberately out of scope; see PERF-020.
export default {
  en,
  hi,
  mr,
  get ta() { return _slice('ta'); },
  get kn() { return _slice('kn'); },
  get ml() { return _slice('ml'); },
  get te() { return _slice('te'); },
  get bn() { return _slice('bn'); },
  get gu() { return _slice('gu'); },
  get pa() { return _slice('pa'); },
};

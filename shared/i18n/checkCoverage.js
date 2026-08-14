#!/usr/bin/env node
/**
 * i18n coverage gate for the AI (Krushi) surface.
 *
 *   node shared/i18n/checkCoverage.js            # gate — exits non-zero on a regression
 *   node shared/i18n/checkCoverage.js --list     # every key still needing native copy
 *   node shared/i18n/checkCoverage.js --list ta  # …for one language
 *   node shared/i18n/checkCoverage.js --update   # re-record the baseline after translations land
 *
 * WHY THIS EXISTS
 * ---------------
 * `t()` (shared/context/LanguageContext.js) falls back to the English bundle
 * when a key is missing, so a missing translation is INVISIBLE: the screen
 * renders correct English and nothing anywhere reports it. That is why 993 keys
 * went missing in each of ta/kn/ml/te/bn/gu/pa without anyone noticing, and why
 * hi/mr — at 42 and 52 missing — made the gap invisible to anyone testing in
 * Devanagari.
 *
 * WHAT IT CHECKS
 * --------------
 *   1. HARD — every literal key passed to `t('…')` anywhere under
 *      frontend/src/screens/AI/ (and the AI api client) exists in the English
 *      bundle. A key with no English entry renders the raw key string on screen
 *      to a farmer the moment someone forgets the second argument.
 *   2. HARD — no AI-namespace key is missing from a language unless that exact
 *      (language, key) pair is already recorded in aiTranslationGaps.json.
 *      New gaps fail; known gaps do not.
 *   3. HARD — the baseline contains no key that is now translated (a stale
 *      baseline silently re-opens the hole it was recording).
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not accept an English string sitting in a non-English bundle as
 * "covered". Agronomy copy in a farmer's language needs a native speaker;
 * pasting English into ml.js would turn this gate green while changing nothing
 * on screen. The baseline file IS the work order for translators.
 */
const fs = require('fs');
const path = require('path');
const { loadTranslations, flatten } = require('./loadBundles');

const BASELINE_PATH = path.join(__dirname, 'aiTranslationGaps.json');
const REPO_ROOT = path.join(__dirname, '..', '..');

// Top-level namespaces that make up the AI / Krushi tab. Scoped deliberately:
// the other ~778 missing keys belong to the marketplace, animal-trade and
// onboarding surfaces and are somebody else's work order.
const AI_NAMESPACES = [
  'ai', 'aiBrand', 'aiChat', 'aiCredits', 'aiHome', 'aiHub', 'aiVoice',
  'cropScan', 'diagReport', 'diagnosis', 'market', 'pastReport', 'pastReportPdf',
  'planner', 'scanHistory', 'scheme', 'voiceChat', 'voiceHistory',
];

// Source roots whose `t()` calls must resolve. Kept narrow so this gate is
// about the AI surface and cannot be broken by unrelated screens.
const SOURCE_ROOTS = [
  path.join(REPO_ROOT, 'frontend', 'src', 'screens', 'AI'),
];
const EXTRA_SOURCE_FILES = [
  path.join(REPO_ROOT, 'frontend', 'src', 'services', 'aiApi.js'),
];

// Only WHOLE literal keys. Two runtime-computed forms must not be reported as
// bogus keys: template literals (`t(\`cropScan.${o.tKey}\`)`) are excluded by
// requiring a quote, and concatenations (`t('market.cat_' + cat.key)`) by the
// lookahead — without it, the literal prefix `market.cat_` reads as a real key.
const T_CALL = /\bt\(\s*(['"])([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)\1\s*(?=[,)])/g;

const isAiKey = (key) => AI_NAMESPACES.includes(key.split('.')[0]);

function walkJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(p, out);
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function collectSourceFiles() {
  const files = SOURCE_ROOTS.flatMap((d) => walkJs(d));
  return files.concat(EXTRA_SOURCE_FILES.filter((f) => fs.existsSync(f)));
}

/** @returns {Map<string, string[]>} literal t() key → source files using it */
function collectUsedKeys() {
  const used = new Map();
  for (const file of collectSourceFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    let m;
    T_CALL.lastIndex = 0;
    while ((m = T_CALL.exec(src)) !== null) {
      const key = m[2];
      if (!used.has(key)) used.set(key, []);
      const rel = path.relative(REPO_ROOT, file);
      if (!used.get(key).includes(rel)) used.get(key).push(rel);
    }
  }
  return used;
}

/** @returns {{[lang: string]: string[]}} AI-namespace English keys absent from each bundle */
function computeGaps(translations) {
  const en = flatten(translations.en);
  const aiKeys = Object.keys(en).filter(isAiKey).sort();
  const gaps = {};
  for (const lang of Object.keys(translations)) {
    if (lang === 'en') continue;
    const bundle = flatten(translations[lang]);
    const missing = aiKeys.filter((k) => !(k in bundle));
    if (missing.length) gaps[lang] = missing;
  }
  return gaps;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { gaps: {} };
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function writeBaseline(gaps, aiKeyCount) {
  const payload = {
    _readme:
      'Keys on the AI surface that have an English string but NO native translation. ' +
      'Regenerate with `node shared/i18n/checkCoverage.js --update` AFTER a native ' +
      'speaker adds copy — never by pasting English into a non-English bundle. ' +
      'checkCoverage.js fails CI on any gap not listed here.',
    generatedFrom: 'shared/i18n/translations.js + shared/i18n/lang/*.js',
    aiNamespaces: AI_NAMESPACES,
    aiKeyCount,
    totalGaps: Object.values(gaps).reduce((n, a) => n + a.length, 0),
    gaps,
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

function main() {
  const args = process.argv.slice(2);
  const translations = loadTranslations();
  const en = flatten(translations.en);
  const aiKeyCount = Object.keys(en).filter(isAiKey).length;
  const gaps = computeGaps(translations);

  if (args[0] === '--update') {
    const written = writeBaseline(gaps, aiKeyCount);
    console.log(`Baseline updated: ${written.totalGaps} gaps across ${Object.keys(gaps).length} languages.`);
    return 0;
  }

  if (args[0] === '--list') {
    const only = args[1];
    for (const [lang, keys] of Object.entries(gaps)) {
      if (only && lang !== only) continue;
      console.log(`\n# ${lang} — ${keys.length} keys need native copy`);
      for (const k of keys) console.log(`${k}\t${JSON.stringify(en[k])}`);
    }
    return 0;
  }

  let failed = false;

  // ── 1. Every literal t() key on the AI surface has an English string ───────
  const used = collectUsedKeys();
  const unknown = [...used.entries()].filter(([k]) => !(k in en));
  if (unknown.length) {
    failed = true;
    console.error(`\n✗ ${unknown.length} t() key(s) have no English string — these render the raw key on screen:`);
    for (const [k, files] of unknown.sort()) console.error(`    ${k}   (${files.join(', ')})`);
  }

  // ── 2/3. Gaps must match the recorded baseline exactly ────────────────────
  const baseline = readBaseline().gaps || {};
  const langs = [...new Set([...Object.keys(gaps), ...Object.keys(baseline)])].sort();
  for (const lang of langs) {
    const now = new Set(gaps[lang] || []);
    const known = new Set(baseline[lang] || []);
    const regressions = [...now].filter((k) => !known.has(k)).sort();
    const fixed = [...known].filter((k) => !now.has(k)).sort();
    if (regressions.length) {
      failed = true;
      console.error(`\n✗ ${lang}: ${regressions.length} NEW untranslated AI key(s).`);
      console.error('  Add native copy, or record the gap with --update if a translator is queued:');
      for (const k of regressions) console.error(`    ${k}`);
    }
    if (fixed.length) {
      failed = true;
      console.error(`\n✗ ${lang}: ${fixed.length} baseline key(s) are now translated — run --update:`);
      for (const k of fixed) console.error(`    ${k}`);
    }
  }

  const total = Object.values(gaps).reduce((n, a) => n + a.length, 0);
  if (failed) {
    console.error('\ni18n coverage check FAILED.\n');
    return 1;
  }
  console.log(
    `i18n coverage OK — ${aiKeyCount} AI keys, ${used.size} literal t() call sites resolved, ` +
    `${total} known gaps awaiting native copy (see aiTranslationGaps.json).`,
  );
  return 0;
}

process.exit(main());

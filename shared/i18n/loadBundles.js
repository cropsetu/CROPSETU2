/**
 * Load the i18n bundles from plain Node, without a bundler.
 *
 * `translations.js` and `lang/*.js` are ES modules with extensionless relative
 * imports, so `node` cannot require them and `node --experimental-*` cannot
 * import them either. They are also pure data — no React Native, no Expo — so
 * transpiling ONLY the module syntax is enough to read them from a CLI script.
 *
 * Deliberately does NOT use the app's babel config: `babel-preset-expo` pulls in
 * @babel/plugin-transform-runtime, whose helper requires resolve against
 * shared/node_modules (which does not exist). Module-syntax transform only, no
 * helpers, no runtime.
 *
 * CommonJS on purpose so `node shared/i18n/checkCoverage.js` just works.
 */
const fs = require('fs');
const path = require('path');

// @babel/core lives in the app workspaces, not in shared/. Try each in turn so
// the script runs from a checkout where only one app's deps are installed.
const CANDIDATE_ROOTS = [
  path.join(__dirname, '..', '..', 'frontend'),
  path.join(__dirname, '..', '..', 'seller-app'),
  path.join(__dirname, '..', '..'),
];

function resolveFrom(id) {
  for (const root of CANDIDATE_ROOTS) {
    try {
      return require.resolve(id, { paths: [root] });
    } catch { /* try the next workspace */ }
  }
  throw new Error(
    `i18n tooling needs "${id}". Install one app workspace's dependencies first ` +
    `(e.g. \`cd frontend && npm install\`).`,
  );
}

const babel = require(resolveFrom('@babel/core'));
const commonjsPlugin = resolveFrom('@babel/plugin-transform-modules-commonjs');

const cache = new Map();

function loadModule(absPath) {
  if (cache.has(absPath)) return cache.get(absPath);

  const src = fs.readFileSync(absPath, 'utf8');
  const { code } = babel.transformSync(src, {
    filename: absPath,
    babelrc: false,
    configFile: false,
    presets: [],
    plugins: [commonjsPlugin],
    parserOpts: { sourceType: 'module' },
  });

  const module = { exports: {} };
  cache.set(absPath, module.exports);

  // Only relative requires are expected (the bundles import each other and
  // nothing else). Anything else is a real dependency the caller must handle.
  const localRequire = (id) => {
    if (!id.startsWith('.')) throw new Error(`unexpected non-relative import "${id}" in ${absPath}`);
    const base = path.resolve(path.dirname(absPath), id);
    const target = fs.existsSync(base) && fs.statSync(base).isFile()
      ? base
      : fs.existsSync(`${base}.js`) ? `${base}.js` : path.join(base, 'index.js');
    return loadModule(target);
  };

  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', '__filename', '__dirname', code)(
    localRequire, module, module.exports, absPath, path.dirname(absPath),
  );

  cache.set(absPath, module.exports);
  return module.exports;
}

/** @returns {{[lang: string]: object}} the merged bundle map, exactly as the app sees it. */
function loadTranslations() {
  const mod = loadModule(path.join(__dirname, 'translations.js'));
  return mod.translations || (mod.default && mod.default.translations) || {};
}

/**
 * Flatten a bundle to dotted keys.
 *
 * Handles BOTH shapes the bundles use: nested objects (`aiChat: { send: '…' }`
 * in translations.js) and already-flat dotted keys (`"aiChat.attachHint": '…'`
 * in lang/_backfill.js). Both resolve identically through LanguageContext's
 * `t()`, so both must count as present here.
 */
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
  }
  return out;
}

module.exports = { loadTranslations, flatten };

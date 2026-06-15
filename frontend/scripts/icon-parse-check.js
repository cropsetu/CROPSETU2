#!/usr/bin/env node
/**
 * icon-parse-check.js — quick JSX/syntax check for the icon-upgrade work.
 * Usage:  node frontend/scripts/icon-parse-check.js <file1> <file2> ...
 * Exits non-zero and prints FAIL lines if any file does not parse.
 * Resolves @babel/core and babel-preset-expo from frontend/node_modules
 * (this script lives in frontend/scripts so Node finds them automatically).
 */
const babel = require('@babel/core');
const fs = require('fs');

// Resolve the preset to an absolute path from THIS script's node_modules so the
// check works no matter what cwd the caller runs it from.
const EXPO_PRESET = require.resolve('babel-preset-expo');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('no files given');
  process.exit(2);
}

let ok = true;
for (const p of files) {
  try {
    babel.parseSync(fs.readFileSync(p, 'utf8'), {
      filename: p,
      presets: [EXPO_PRESET],
    });
    console.log('PASS  ' + p);
  } catch (e) {
    ok = false;
    console.log('FAIL  ' + p + ' :: ' + String(e.message).split('\n')[0]);
  }
}
process.exit(ok ? 0 : 1);

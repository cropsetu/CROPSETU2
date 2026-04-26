#!/usr/bin/env node
/**
 * check-console-logs.js
 *
 * Security lint script — fails if any JS/TS source file contains:
 *   1. A console.log call that logs sensitive data (diagnosis, tokens, PII), OR
 *   2. A bare console.* call (in the Node.js backend — use logger instead)
 *
 * Usage:
 *   node scripts/check-console-logs.js          (scans src/ by default)
 *   npm run lint:console
 *
 * Exit codes:
 *   0 — no violations found
 *   1 — violations found (list printed to stderr)
 */
import fs   from 'fs';
import path from 'path';

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(process.cwd());

// Which directories to scan (relative to project root)
const SCAN_DIRS = ['src'];

// These console.log patterns leak sensitive data regardless of context
const SENSITIVE_PATTERNS = [
  /console\.log.*diagnos/i,
  /console\.log.*disease/i,
  /console\.log.*treatment/i,
  /console\.log.*chemical/i,
  /console\.log.*token/i,
  /console\.log.*password/i,
  /console\.log.*otp/i,
  /console\.log.*phone/i,
  /console\.log.*aadhaar/i,
  /console\.log.*aadhar/i,
  /console\.log.*bank/i,
  /console\.log.*pan\b/i,
  /console\.log.*report.*data/i,
  /console\.log.*_fullReport/i,
  /console\.log.*refreshToken/i,
  /console\.log.*accessToken/i,
  /console\.log.*apikey/i,
];

// Any bare console call (for backend src/ — use logger utility instead)
const BARE_CONSOLE_PATTERN = /(?<!\/\/\s*)(console\.(log|warn|error|info|debug))\s*\(/;

// Files / dirs to skip
const IGNORE_PATTERNS = [
  /node_modules/,
  /\.test\.(js|ts)x?$/,
  /scripts\//,
  /utils\/logger\.js$/,
  /utils\/logger\.ts$/,
];

const EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']);

// ── Scanner ───────────────────────────────────────────────────────────────────

function shouldIgnore(filePath) {
  const relative = path.relative(ROOT, filePath).replace(/\\/g, '/');
  return IGNORE_PATTERNS.some((p) => p.test(relative));
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!shouldIgnore(full)) yield* walk(full);
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      if (!shouldIgnore(full)) yield full;
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const sensitiveViolations = [];
const bareConsoleViolations = [];

for (const scanDir of SCAN_DIRS) {
  const dir = path.join(ROOT, scanDir);
  if (!fs.existsSync(dir)) continue;

  for (const file of walk(dir)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const rel   = path.relative(ROOT, file);

    lines.forEach((line, idx) => {
      const loc = `${rel}:${idx + 1}`;
      const snippet = line.trim().slice(0, 120);

      // Check for sensitive-data leakage
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(line)) {
          sensitiveViolations.push({ loc, snippet });
          break;
        }
      }

      // Check for bare console calls (backend only)
      if (BARE_CONSOLE_PATTERN.test(line)) {
        bareConsoleViolations.push({ loc, snippet });
      }
    });
  }
}

let exitCode = 0;

if (sensitiveViolations.length > 0) {
  console.error(`\n❌ Found ${sensitiveViolations.length} console.log call(s) leaking sensitive data:\n`);
  sensitiveViolations.forEach(({ loc, snippet }) => console.error(`  ${loc}  ${snippet}`));
  exitCode = 1;
}

if (bareConsoleViolations.length > 0) {
  console.error(`\n⚠  Found ${bareConsoleViolations.length} bare console call(s) — use logger from src/utils/logger.js instead:\n`);
  bareConsoleViolations.forEach(({ loc, snippet }) => console.error(`  ${loc}  ${snippet}`));
  exitCode = 1;
}

if (exitCode === 0) {
  console.log('[lint:console] ✓ No sensitive data in console calls. No bare console usage in backend.');
}

process.exit(exitCode);

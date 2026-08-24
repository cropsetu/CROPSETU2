#!/usr/bin/env node
/**
 * postprocess.mjs — turn a picked master image into every shipped file.
 *
 *   node postprocess.mjs IMG-BRAND-001 [--key]
 *   node postprocess.mjs --all
 *
 * Reads  docs/branding/masters/<ID>.png
 * Writes wherever manifest.mjs says, and FAILS if an output breaches its byte cap.
 * Masters are never modified.
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS as BRAND_ASSETS, MANUAL } from './manifest.mjs';
import { BATCH1 } from './batch1.mjs';
import { BATCH2 } from './batch2.mjs';
import { BATCH3 } from './batch3.mjs';
import { BATCH4 } from './batch4.mjs';
import { BATCH5 } from './batch5.mjs';
import { BATCH6 } from './batch6.mjs';

// batch1 is an array keyed by .id; manifest.mjs is an object. Merge into one map.
const ASSETS = { ...Object.fromEntries([...BATCH1, ...BATCH2, ...BATCH3, ...BATCH4, ...BATCH5, ...BATCH6].map(a => [a.id, a])), ...BRAND_ASSETS };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const MASTERS = path.join(REPO, 'docs/branding/masters');

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('sharp is not installed.\n  cd scripts/brand-assets && npm install\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const KEY = args.includes('--key');
const ALL = args.includes('--all');
const FORCE = args.includes('--force');
const DRY = args.includes('--dry');
const ids = args.filter(a => !a.startsWith('--'));

const hex = h => {
  const n = parseInt(h.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

/** Replace a flat chroma-key field (default magenta) with transparency. */
async function dropKey(buf, key = '#FF00FF', tol = 60) {
  const { r, g, b } = hex(key);
  const img = sharp(buf).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  let cleared = 0;
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.hypot(data[i] - r, data[i + 1] - g, data[i + 2] - b);
    if (d < tol) { data[i + 3] = 0; cleared++; }
    else if (d < tol * 2) { data[i + 3] = Math.min(data[i + 3], Math.round(255 * (d - tol) / tol)); }
  }
  if (!cleared) console.warn('    ! --key found no magenta pixels; is the background actually keyed?');
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/** Recolour every visible pixel to one flat colour, preserving alpha (Android mask icons). */
async function monochrome(buf, colour) {
  const { r, g, b } = hex(colour);
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/**
 * Trim a flat studio backdrop and re-centre the subject with a fixed margin.
 *
 * Gemini frames far looser than OpenAI — the subject can sit small and off-centre in a
 * sea of near-white. Rendered into a square tile that reads as a mostly-empty box with
 * the object shoved into one corner. Trimming to content and re-padding normalises the
 * framing across every asset regardless of which provider made it.
 */
async function recentre(buf, marginPct = 0.08) {
  const trimmed = await sharp(buf).trim({ threshold: 12 }).toBuffer().catch(() => null);
  if (!trimmed) return buf;                       // uniform image; nothing to trim
  const m = await sharp(trimmed).metadata();
  const side = Math.max(m.width, m.height);
  const canvas = Math.round(side * (1 + marginPct * 2));
  // Padding must match what the source actually is. This originally always sampled a
  // corner and padded opaque — written when Gemini forced a near-white backdrop. Once
  // transparent backgrounds came back that silently flattened every cut-out asset onto
  // a solid colour, which is how the animals ended up with backgrounds.
  const meta = await sharp(buf).metadata();
  let bg = { r: 0, g: 0, b: 0, alpha: 0 };
  if (!meta.hasAlpha) {
    const { data } = await sharp(buf).extract({ left: 2, top: 2, width: 4, height: 4 })
      .raw().toBuffer({ resolveWithObject: true });
    bg = { r: data[0], g: data[1], b: data[2], alpha: 1 };
  }
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: bg } })
    .composite([{ input: trimmed, gravity: 'center' }]).png().toBuffer();
}

/** Centre-crop to an aspect ratio expressed as "w:h" or a decimal "2.048:1". */
async function cropTo(buf, ratio) {
  const [rw, rh] = ratio.split(':').map(Number);
  const target = rw / rh;
  const { width, height } = await sharp(buf).metadata();
  const cur = width / height;
  const box = cur > target
    ? { width: Math.round(height * target), height, left: Math.round((width - height * target) / 2), top: 0 }
    : { width, height: Math.round(width / target), left: 0, top: Math.round((height - width / target) / 2) };
  return sharp(buf).extract(box).png().toBuffer();
}

async function emit(outPath, buf, cap) {
  const abs = path.join(REPO, outPath);
  // Several outputs land on paths that already hold real art (icon.png, favicon.png).
  // Refuse to clobber them unless asked. Learned the hard way.
  if (existsSync(abs) && !FORCE) {
    console.log(`    · ${outPath}  EXISTS, skipped (pass --force to overwrite)`);
    return [];
  }
  if (DRY) {
    console.log(`    · ${outPath}  ${(buf.length / 1024).toFixed(1)} KB (dry run, not written)`);
    return cap && buf.length > cap ? [`${outPath} would be over its ${(cap / 1024).toFixed(0)} KB cap`] : [];
  }
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  const { size } = await stat(abs);
  // A cap-only check treats a truncated or zero-byte write as "under budget". That is how
  // an empty sprinkler.webp passed validation and then broke Metro at bundle time.
  if (size < 256) {
    console.log(`    ✗ ${outPath}  ${size} bytes — TRUNCATED`);
    return [`${outPath} is only ${size} bytes (truncated write)`];
  }
  const over = cap && size > cap;
  console.log(`    ${over ? '✗' : '✓'} ${outPath}  ${(size / 1024).toFixed(1)} KB${cap ? ` / ${(cap / 1024).toFixed(0)} KB cap` : ''}`);
  return over ? [`${outPath} is ${(size / 1024).toFixed(1)} KB, over its ${(cap / 1024).toFixed(0)} KB cap`] : [];
}

/** master → N launcher/icon files, each a scaled mark centred on its own canvas. */
async function deriveAll(master, spec) {
  // Trim the transparent margin so markScale means "of the canvas", not "of whatever the model framed".
  const mark = await sharp(master).ensureAlpha().trim({ threshold: 8 }).png().toBuffer();
  const problems = [];
  for (const d of spec.derive) {
    const inner = Math.round(d.size * d.markScale);
    let m = await sharp(mark).resize(inner, inner, { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
    if (d.mono) m = await monochrome(m, d.mono);
    const canvas = sharp({
      create: {
        width: d.size, height: d.size, channels: 4,
        background: d.bg ? { ...hex(d.bg), alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });
    let out = canvas.composite([{ input: m, gravity: 'center' }]);
    if (d.bg) out = out.flatten({ background: hex(d.bg) });
    problems.push(...await emit(d.path, await out.png({ compressionLevel: 9, palette: true, colours: 64, effort: 10 }).toBuffer(), d.cap));
  }
  return problems;
}

/** master → resized/encoded runtime assets, with @2x/@3x density buckets. */
async function outputAll(master, spec) {
  let base = master;
  // Square icon-style assets get normalised framing; wide scenes are compositions and
  // must not be trimmed, or the deliberately-empty centre would be cropped away.
  if (!spec.crop) base = await recentre(base);
  if (spec.crop) base = await cropTo(base, spec.crop);
  const problems = [];
  for (const o of spec.outputs) {
    const widths = spec.density ?? [o.w];
    for (let i = 0; i < widths.length; i++) {
      const w = widths[i];
      const suffix = spec.density && i > 0 ? `@${i + 1}x` : '';
      const ext = path.extname(o.path);
      const target = o.path.replace(new RegExp(`${ext}$`), `${suffix}${ext}`);
      let p = sharp(base).resize({ width: w, kernel: 'lanczos3', withoutEnlargement: true });
      if (o.flatten) p = p.flatten({ background: hex(o.flatten) });
      const buf = o.fmt === 'webp'
        ? await p.webp({ quality: o.q ?? 90 }).toBuffer()
        : await p.png({ compressionLevel: 9 }).toBuffer();
      // Only the largest density carries the byte cap; smaller ones are strictly smaller.
      problems.push(...await emit(target, buf, i === widths.length - 1 ? o.cap : null));
    }
  }
  return problems;
}

async function run(id) {
  const spec = ASSETS[id];
  if (!spec) { console.error(`  unknown id: ${id}`); return [`unknown id ${id}`]; }
  const src = path.join(MASTERS, `${id}.png`);
  if (!existsSync(src)) { console.log(`  – ${id}: no master at docs/branding/masters/${id}.png, skipping`); return []; }
  console.log(`  ${id}`);
  let master = await readFile(src);
  if (KEY) master = await dropKey(master);
  return spec.kind === 'master' ? deriveAll(master, spec) : outputAll(master, spec);
}

const todo = ALL ? Object.keys(ASSETS) : ids;
if (!todo.length) {
  console.log('usage: node postprocess.mjs <IMG-ID> [--key] [--dry] [--force]  |  --all');
  console.log('       --dry    compute everything, write nothing');
  console.log('       --force  overwrite outputs that already exist (default: skip)');
  console.log(`manual, not automated: ${MANUAL.join(', ')}`);
  process.exit(0);
}

const problems = (await Promise.all(todo.map(run))).flat();
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  problems.forEach(p => console.error(`  ✗ ${p}`));
  process.exit(1);
}
console.log('\nok');

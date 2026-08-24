/**
 * upload.mjs — push the CDN-bound asset sets to Cloudinary.
 *
 * IMAGE_PROCESS.md §4: crops (66), animals (16), store categories (22), machinery
 * (10), schemes (9), order status (6) and notification types (8) are browse
 * surfaces that already need a network to show listings at all. Bundling them
 * costs ~1.4 MB of APK against a low-end-Android target for no offline benefit —
 * the SVG kit is the offline fallback either way.
 *
 *   node --env-file=../../backend/.env upload.mjs [--dry]
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const REPO = path.resolve(import.meta.dirname, '../..');
const SETS = (process.argv.find(a=>a.startsWith('--sets='))||'').split('=')[1]?.split(',') || ['crop','animal','cat','mach','scheme','order','notif'];
const FOLDER = 'krushisarva/ui';
const DRY = process.argv.includes('--dry');

const { CLOUDINARY_CLOUD_NAME: CLOUD, CLOUDINARY_API_KEY: KEY, CLOUDINARY_API_SECRET: SECRET } = process.env;
if (!CLOUD || !KEY || !SECRET) { console.error('Cloudinary env not set'); process.exit(1); }

/** Cloudinary signs the alphabetically-sorted params, secret appended, SHA-1. */
function sign(params) {
  const q = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  return createHash('sha1').update(q + SECRET).digest('hex');
}

const manifest = {};
let n = 0, bytes = 0;

for (const set of SETS) {
  const dir = path.join(REPO, 'frontend/assets', set);
  let files;
  try { files = (await readdir(dir)).filter(f => f.endsWith('@2x.webp')); } catch { continue; }
  for (const f of files) {
    const key = f.replace('@2x.webp', '');
    const public_id = `${FOLDER}/${set}/${key}`;
    const buf = await readFile(path.join(dir, f));
    bytes += buf.length;
    if (DRY) { console.log(`  · ${public_id}  ${(buf.length / 1024).toFixed(1)} KB`); n++; manifest[`${set}/${key}`] = public_id; continue; }

    const timestamp = Math.floor(Date.now() / 1000);
    const params = { folder: '', overwrite: 'true', public_id, timestamp };
    delete params.folder;
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'image/webp' }), f);
    fd.append('api_key', KEY);
    fd.append('timestamp', String(timestamp));
    fd.append('public_id', public_id);
    fd.append('overwrite', 'true');
    fd.append('signature', sign({ overwrite: 'true', public_id, timestamp }));

    const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, { method: 'POST', body: fd });
    if (!r.ok) { console.log(`  ✗ ${public_id}  HTTP ${r.status}`); console.error('    ' + (await r.text()).slice(0, 160)); continue; }
    const j = await r.json();
    manifest[`${set}/${key}`] = j.public_id;
    n++;
    if (n % 20 === 0) process.stdout.write(`${n} `);
  }
}

console.log(`\n${n} images  ${(bytes / 1024).toFixed(0)} KB${DRY ? ' (dry run)' : ' uploaded'}`);
if (!DRY) {
  await writeFile(path.join(REPO, 'docs/branding/cdn-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('manifest → docs/branding/cdn-manifest.json');
}

#!/usr/bin/env node
/**
 * generate.mjs — call the OpenAI images API for one asset, one set, or a whole batch.
 *
 *   node --env-file=.env generate.mjs --set symptoms
 *   node --env-file=.env generate.mjs SYMPTOM-yellow_leaves
 *   node generate.mjs --set soil --dry          # print prompts, call nothing
 *
 * Writes  docs/branding/masters/<ID>-<n>.png   (n = candidate index)
 * Appends docs/branding/masters/generated.json (provenance, IMAGE_PROCESS.md §8)
 *
 * Resumable: an ID whose candidates already exist is skipped unless --redo.
 * The key is read from the environment. It is never logged and never written to disk.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BATCH1 } from './batch1.mjs';
import { BATCH2 } from './batch2.mjs';
import { BATCH3 } from './batch3.mjs';
import { BATCH4 } from './batch4.mjs';
import { BATCH5 } from './batch5.mjs';
import { BATCH6 } from './batch6.mjs';
import { BATCH7 } from './batch7.mjs';
import { composePrompt, paramsFor } from './families.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const MASTERS = path.join(REPO, 'docs/branding/masters');
const LEDGER = path.join(MASTERS, 'generated.json');

const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const val = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const DRY = flag('dry'), REDO = flag('redo');
// IMAGE_ASSETS.md §6.1 — the only place a model is named. Override per run with
// --model / --quality so a cheaper combination can be A/B'd before committing to it.
const MODEL = val('model') ?? 'gpt-image-1';
const N = Number(val('n') ?? 3);
const setName = val('set');
const ids = args.filter(a => !a.startsWith('--') && !/^\d+$/.test(a) && a !== setName);

const ASSETS = [...BATCH1, ...BATCH2, ...BATCH3, ...BATCH4, ...BATCH5, ...BATCH6, ...BATCH7];
let todo = setName ? ASSETS.filter(a => a.set === setName)
         : ids.length ? ASSETS.filter(a => ids.includes(a.id))
         : null;

if (!todo || !todo.length) {
  console.log(`usage: node --env-file=.env generate.mjs --set <name> [--n 3] [--dry] [--redo]`);
  console.log(`       node --env-file=.env generate.mjs <ASSET-ID> ...`);
  console.log(`\nsets available: ${[...new Set(ASSETS.map(a => a.set))].join(', ')}`);
  console.log(`assets: ${ASSETS.length}`);
  process.exit(todo ? 1 : 0);
}

const KEY = process.env.OPENAI_API_KEY;
// Gemini reuses the key this app already runs on — no separate account, no top-up.
let GKEY = process.env.GEMINI_API_KEY;
if (!GKEY) {
  try {
    GKEY = (await readFile(path.join(REPO, 'backend/.env'), 'utf8'))
      .split('\n').find(l => l.startsWith('GEMINI_API_KEY='))
      ?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  } catch { /* leave undefined; only fatal if a gemini asset is actually requested */ }
}
const GEMINI_MODEL = val('gmodel') ?? 'gemini-3.1-flash-image';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function generate(asset) {
  const prompt = composePrompt(asset);
  const p = paramsFor(asset);
  const qOverride = val('quality');
  if (qOverride) p.quality = qOverride;
  const first = path.join(MASTERS, `${asset.id}-1.png`);

  if (!REDO && existsSync(first)) { console.log(`  – ${asset.id}  already generated, skipping`); return null; }

  if (DRY) {
    console.log(`\n${'═'.repeat(70)}\n${asset.id}   ${p.size} ${p.quality} bg:${p.background} n:${N}`);
    console.log(`${'─'.repeat(70)}\n${prompt}`);
    return null;
  }

  // Provider routing: Gemini renders more realistically and runs on the key this app
  // already has. OpenAI is kept only for assets that need TRUE transparency, which
  // the Gemini image API cannot produce (no background parameter).
  const provider = val('provider') ?? asset.provider ?? 'gemini';
  process.stdout.write(`  · ${asset.id} [${provider}] … `);

  if (provider === 'gemini') {
    if (!GKEY) { console.log('no GEMINI_API_KEY'); return { id: asset.id, error: 'no key' }; }
    const files = [];
    for (let c = 0; c < N; c++) {
      let gr;
      // Gemini rate-limits hard on sustained batches. Without backoff every 429 silently
      // dropped an asset — 125 of 137 lost on the first full run. Retry, don't skip.
      for (let attempt = 1; attempt <= 6; attempt++) {
        gr = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GKEY}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
                                   generationConfig: { responseModalities: ['IMAGE'] } }) });
        if (gr.status !== 429 && gr.status < 500) break;
        const body = await gr.clone().text();
        if (/quota|billing|exceeded your current quota/i.test(body) && attempt >= 2) {
          console.log('QUOTA EXHAUSTED'); console.error('    ' + body.slice(0, 200)); process.exit(2);
        }
        const wait = Math.min(60000, 2 ** attempt * 2000);
        process.stdout.write(`${gr.status}:${wait / 1000}s `);
        await sleep(wait);
      }
      if (!gr.ok) { console.log(`HTTP ${gr.status}`); console.error('    ' + (await gr.text()).slice(0, 220)); break; }
      const gj = await gr.json();
      const part = gj.candidates?.[0]?.content?.parts?.find(x => x.inlineData);
      if (!part) {
        // Don't swallow the reason. Gemini reports finishReason + safety ratings;
        // guessing at "probably a safety filter" wasted a retry cycle once already.
        const cand = gj.candidates?.[0];
        const why = cand?.finishReason || gj.promptFeedback?.blockReason || 'unknown';
        const safety = (cand?.safetyRatings || []).filter(r => r.blocked || r.probability !== 'NEGLIGIBLE')
          .map(r => `${r.category}=${r.probability}`).join(' ');
        console.log(`no image (${why}${safety ? '; ' + safety : ''})`);
        break;
      }
      await mkdir(MASTERS, { recursive: true });
      const f = path.join(MASTERS, `${asset.id}-${c + 1}.png`);
      await writeFile(f, Buffer.from(part.inlineData.data, 'base64'));
      files.push(path.basename(f));
      await sleep(400);
    }
    console.log(files.length ? `${files.length} candidate${files.length === 1 ? '' : 's'}` : 'NOTHING WRITTEN');
    if (!files.length) return { id: asset.id, error: 'no files' };
    return { id: asset.id, set: asset.set, model: GEMINI_MODEL, provider: 'gemini',
             n: N, role: asset.role ?? null,
             prompt_sha256: createHash('sha256').update(prompt).digest('hex'), files };
  }

  const body = { model: MODEL, prompt, n: N, size: p.size, quality: p.quality,
                 background: p.background, output_format: 'png' };

  let res, lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify(body),
      });
      // A 429 can mean "slow down" OR "you are out of credits". Only the first is
      // worth retrying — retrying a quota error just burns four backoffs per asset.
      if (res.status === 429) {
        const peek = (await res.clone().text()).slice(0, 300);
        if (/insufficient_quota|credit_balance_exhausted|billing/i.test(peek)) {
          console.log('OUT OF CREDITS');
          console.error('    top up at https://platform.openai.com/settings/organization/billing/');
          process.exit(2);
        }
      }
      if (res.status === 429 || res.status >= 500) {
        const wait = 2 ** attempt * 1500;
        process.stdout.write(`${res.status}, retry in ${wait / 1000}s … `);
        await sleep(wait); continue;
      }
      break;
    } catch (e) { lastErr = e; await sleep(2 ** attempt * 1000); }
  }
  if (!res) throw lastErr ?? new Error('no response');

  if (!res.ok) {
    const txt = await res.text();
    // Never echo the key; the API never returns it, but be explicit about that.
    console.log(`FAILED ${res.status}`);
    console.error(`    ${txt.slice(0, 400)}`);
    return { id: asset.id, error: `${res.status}` };
  }

  const json = await res.json();
  await mkdir(MASTERS, { recursive: true });
  const files = [];
  for (const [i, d] of (json.data ?? []).entries()) {
    if (!d.b64_json) continue;                       // gpt-image-1 returns base64, never a url
    const tag = (val('model') || val('quality')) ? `-${MODEL.replace('gpt-image-','m')}${p.quality[0]}` : '';
    const f = path.join(MASTERS, `${asset.id}${tag}-${i + 1}.png`);
    await writeFile(f, Buffer.from(d.b64_json, 'base64'));
    files.push(path.basename(f));
  }
  console.log(`${files.length} candidate${files.length === 1 ? '' : 's'}`);
  return {
    id: asset.id, set: asset.set, model: MODEL, ...p, n: N,
    role: asset.role ?? null,
    prompt_sha256: createHash('sha256').update(prompt).digest('hex'),
    files, usage: json.usage ?? null,
  };
}

console.log(`${DRY ? 'DRY RUN — ' : ''}${todo.length} asset(s)${setName ? ` in set "${setName}"` : ''}\n`);

const records = [];
for (const a of todo) {
  try { const r = await generate(a); if (r) records.push(r); }
  catch (e) { console.log(`FAILED`); console.error(`    ${e.message}`); }
  if (!DRY) await sleep(Number(val('pace') ?? 2500)); // pacing; raise with --pace on sustained runs
}

if (records.length) {
  let ledger = [];
  if (existsSync(LEDGER)) { try { ledger = JSON.parse(await readFile(LEDGER, 'utf8')); } catch {} }
  ledger.push(...records.map(r => ({ ...r, generated_at: new Date().toISOString() })));
  await writeFile(LEDGER, JSON.stringify(ledger, null, 2));
  const ok = records.filter(r => !r.error && r.files?.length).length;
  const bad = todo.length - ok;
  console.log(`\n${ok}/${todo.length} generated → docs/branding/masters/${bad ? `   (${bad} FAILED)` : ''}`);
  console.log(`provenance → docs/branding/masters/generated.json`);
  console.log(`\nnext: review, pick one candidate per ID, rename it <ID>.png, then`);
  console.log(`      node postprocess.mjs --all`);
}

/**
 * wordmark.mjs — build the KrushiSarva wordmark.
 *
 * The type is TYPESET, never generated: image models render brand names as
 * plausible-looking garbage letterforms (IMAGE_ASSETS.md §2.2). We composite
 * real Fraunces 700 + Plus Jakarta Sans 600 beside the generated mark.
 *
 *   node wordmark.mjs
 */
import sharp from 'sharp';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../..');
const FONTS = path.join(REPO, 'frontend/node_modules/@expo-google-fonts');
const MARK = path.join(REPO, 'docs/branding/masters/IMG-BRAND-001.png');

const GREEN = '#005f21', GOLD = '#e0af3b';

const b64 = async p => (await readFile(p)).toString('base64');

async function build({ out, W, H, markPx, size, tagSize, tagline, aspect }) {
  const fraunces = await b64(path.join(FONTS, 'fraunces/700Bold/Fraunces_700Bold.ttf'));
  const jakarta  = await b64(path.join(FONTS, 'plus-jakarta-sans/600SemiBold/PlusJakartaSans_600SemiBold.ttf'));
  const textX = markPx + Math.round(markPx * 0.18);
  const baseY = tagline ? H * 0.52 : H * 0.62;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><style>
      .n { font-family:'Fraunces'; font-size:${size}px; fill:${GREEN}; }
      .t { font-family:'Plus Jakarta Sans'; font-size:${tagSize}px; fill:${GOLD};
           letter-spacing:${(tagSize * 0.22).toFixed(2)}px; }
    </style></defs>
    <text x="${textX}" y="${baseY}" class="n" dominant-baseline="middle">KrushiSarva</text>
    ${tagline ? `<text x="${textX + 3}" y="${H * 0.80}" class="t">${tagline}</text>` : ''}
  </svg>`;

  const mark = await sharp(MARK).resize(markPx, markPx, { fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();

  await mkdir(path.dirname(out), { recursive: true });
  const composed = await sharp({ create: { width: W, height: H, channels: 4,
                          background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: mark, left: 0, top: Math.round((H - markPx) / 2) },
      { input: Buffer.from(svg), left: 0, top: 0 },
    ]).png().toBuffer();
  // trim to ink, then re-pad a small even margin so the lockup has breathing room
  const trimmed = await sharp(composed).trim({ threshold: 1 }).toBuffer();
  const tm = await sharp(trimmed).metadata();
  const m = Math.round(tm.height * 0.08);                 // even breathing room
  let cw = tm.width + m * 2, ch = tm.height + m * 2;
  if (aspect) {                                            // grow the short edge only
    if (cw / ch > aspect) ch = Math.round(cw / aspect);
    else cw = Math.round(ch * aspect);
  }
  await sharp({ create: { width: cw, height: ch, channels: 4,
                          background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: trimmed, left: Math.round((cw - tm.width) / 2),
                                  top:  Math.round((ch - tm.height) / 2) }])
    .png({ compressionLevel: 9, palette: true, colours: 64 })
    .toFile(out);
  const { size: bytes } = await import('node:fs').then(m => m.promises.stat(out));
  console.log(`  ✓ ${path.relative(REPO, out)}  ${W}×${H}  ${(bytes / 1024).toFixed(1)} KB`);
}

// Full lockup with tagline — replaces frontend/assets/cropsetu-wordmark.png
await build({ out: path.join(REPO, 'frontend/assets/krushisarva-wordmark.png'),
  W: 1600, H: 300, markPx: 300, size: 104, tagSize: 26, tagline: 'SMART FARMING', aspect: 2.55 });
// @2x
await build({ out: path.join(REPO, 'frontend/assets/krushisarva-wordmark@2x.png'),
  W: 3200, H: 600, markPx: 600, size: 208, tagSize: 52, tagline: 'SMART FARMING', aspect: 2.55 });
// Compact, no tagline — toolbars and cards
await build({ out: path.join(REPO, 'frontend/assets/krushisarva-lockup.png'),
  W: 1500, H: 220, markPx: 220, size: 92, tagSize: 0, tagline: null, aspect: 3.4 });
// Header variant: name only, matched to the 112x44 store-header slot. The tagline
// is dropped deliberately — at 44dp it renders ~4px tall and reads as grey mush.
await build({ out: path.join(REPO, 'frontend/assets/krushisarva-header.png'),
  W: 1500, H: 300, markPx: 300, size: 132, tagSize: 0, tagline: null, aspect: 2.55 });

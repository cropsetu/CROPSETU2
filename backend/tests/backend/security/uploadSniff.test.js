/**
 * Upload content-type enforcement.
 *
 * The finding: POST /upload/image decided "is this an image?" from the `data:`
 * URI prefix — a string the caller writes — and skipped even that check when the
 * payload arrived with no prefix, which the surrounding code explicitly handles.
 * Any bytes could be stored as an image.
 *
 * Cloudinary re-encoding was the only thing standing behind it, and the
 * `!CLOUDINARY_CLOUD_NAME` branch returns a placeholder BEFORE any upload, so
 * that mitigation vanishes on any deploy without the credentials. These tests
 * therefore assert the rejection happens in the route, not at the CDN.
 */
import request from 'supertest';
import { getApp, createTestUser, cleanupTestData } from '../../fixtures/setup.js';
import { sniffImageType, assertUploadableImage } from '../../../src/utils/imageSniff.js';

let app; let user; let cloudName;

beforeAll(async () => {
  // Run against the UNCONFIGURED branch on purpose. Two reasons: it is the exact
  // deployment shape in which Cloudinary re-encoding — the only thing that stood
  // behind the old check — does not happen, so it is where the route's own
  // validation has to hold on its own; and it keeps the suite from uploading test
  // payloads to a real CDN account on every run.
  const { ENV } = await import('../../../src/config/env.js');
  cloudName = ENV.CLOUDINARY_CLOUD_NAME;
  ENV.CLOUDINARY_CLOUD_NAME = '';

  app = await getApp();
  user = await createTestUser();
}, 30000); // cold app boot exceeds jest's 5s default on a first-in-worker suite

afterAll(async () => {
  const { ENV } = await import('../../../src/config/env.js');
  ENV.CLOUDINARY_CLOUD_NAME = cloudName;
  await cleanupTestData();
});

// ── Real signatures, kept as bytes rather than fixtures ──────────────────────
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([0x1a, 0x00, 0x00, 0x00]), Buffer.from('WEBPVP8 '),
]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = Buffer.from('<!doctype html><script>fetch("/api/v1/users/me")</script>');
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);

const post = (body) => request(app).post('/api/v1/upload/image').set(user.headers).send(body);
const dataUri = (buf, declared = 'image/png') => `data:${declared};base64,${buf.toString('base64')}`;

describe('sniffImageType — the bytes, not the label', () => {
  test.each([
    ['JPEG', JPEG, 'jpeg'],
    ['PNG', PNG, 'png'],
    ['WebP', WEBP, 'webp'],
    ['SVG', SVG, 'svg'],
  ])('identifies %s', (_name, buf, expected) => {
    expect(sniffImageType(buf)).toBe(expected);
  });

  test('an XML-declared SVG is still an SVG', () => {
    expect(sniffImageType(Buffer.from('<?xml version="1.0"?>\n<svg onload="alert(1)"/>'))).toBe('svg');
  });

  test('RIFF alone is not WebP — a WAV shares the container', () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt ')]);
    expect(sniffImageType(wav)).toBeNull();
  });

  test('unrecognised bytes return null rather than a guess', () => {
    expect(sniffImageType(ELF)).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageType('not a buffer')).toBeNull();
  });

  test('SVG is refused by name, so the reason is actionable', () => {
    expect(() => assertUploadableImage(SVG)).toThrow(/SVG images are not accepted/i);
  });
});

describe('POST /upload/image — the declared content type is not trusted', () => {
  test('accepts a real JPEG', async () => {
    const res = await post({ base64: dataUri(JPEG, 'image/jpeg') });
    expect(res.status).toBe(200);
  });

  test('accepts a real PNG sent with NO data: prefix at all', async () => {
    // The un-prefixed payload is the path the old check skipped entirely.
    const res = await post({ base64: PNG.toString('base64') });
    expect(res.status).toBe(200);
  });

  test('accepts a real WebP', async () => {
    const res = await post({ base64: dataUri(WEBP, 'image/webp') });
    expect(res.status).toBe(200);
  });

  test('400 — arbitrary bytes wearing an image/png label', async () => {
    // The exact attack: the prefix says PNG, the bytes are an executable.
    const res = await post({ base64: dataUri(ELF, 'image/png') });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not a valid image/i);
  });

  test('400 — HTML with a script tag, declared as image/jpeg', async () => {
    const res = await post({ base64: dataUri(HTML, 'image/jpeg') });
    expect(res.status).toBe(400);
  });

  test('400 — SVG is rejected explicitly, not silently stored', async () => {
    // A stored-XSS vector the moment anything serves the asset inline.
    const res = await post({ base64: dataUri(SVG, 'image/svg+xml') });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/SVG/i);
  });

  test('400 — raw base64 junk with no prefix, the check that used to be skipped', async () => {
    const res = await post({ base64: Buffer.from('totally not an image').toString('base64') });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not a valid image/i);
  });

  test('400 — GIF is outside the allowlist and says so', async () => {
    const res = await post({ base64: dataUri(Buffer.from('GIF89a\x01\x00\x01\x00'), 'image/gif') });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/GIF/i);
  });

  test('401 — upload is not public', async () => {
    const res = await request(app).post('/api/v1/upload/image').send({ base64: dataUri(JPEG) });
    expect(res.status).toBe(401);
  });
});

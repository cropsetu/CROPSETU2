/**
 * manifest.mjs — executable copy of the asset specs in docs/branding/IMAGE_ASSETS.md.
 *
 * The markdown is the HUMAN source of truth. When the two disagree, the markdown wins
 * and this file is corrected (IMAGE_ASSETS.md §6.4).
 *
 * Paths are repo-relative. `cap` is a hard byte budget — postprocess.mjs fails on breach.
 */

const KB = 1024;

/** A "master" is one generated image that several shipped files are derived from. */
export const ASSETS = {
  // ── B1 · Identity ─────────────────────────────────────────────────────────
  'IMG-BRAND-001': {
    lane: 'V',
    kind: 'master',
    note: 'One generation → six launcher files. IMAGE_ASSETS.md §5.1 / §5.2.',
    derive: [
      { id: 'IMG-LAUNCH-001', path: 'frontend/assets/icon.png',
        size: 1024, bg: '#005f21', markScale: 0.62, cap: 120 * KB },
      { id: 'IMG-LAUNCH-002', path: 'frontend/assets/adaptive-icon-foreground.png',
        size: 1024, bg: null, markScale: 0.50, cap: 120 * KB },
      { id: 'IMG-LAUNCH-003', path: 'frontend/assets/adaptive-icon-monochrome.png',
        size: 1024, bg: null, mono: '#ffffff', markScale: 0.50, cap: 60 * KB },
      { id: 'IMG-LAUNCH-004', path: 'frontend/assets/notification-icon.png',
        size: 96, bg: null, mono: '#ffffff', markScale: 0.75, cap: 8 * KB },
      { id: 'IMG-LAUNCH-005', path: 'frontend/assets/splash-mark.png',
        size: 1024, bg: null, markScale: 1.00, cap: 120 * KB },
      { id: 'IMG-LAUNCH-006', path: 'frontend/assets/favicon.png',
        size: 64, bg: '#005f21', markScale: 0.62, cap: 8 * KB },
      { id: 'IMG-PLAY-001',   path: 'docs/branding/store/play-icon-512.png',
        size: 512, bg: '#005f21', markScale: 0.62, cap: 120 * KB },
      { id: 'IMG-WEB-001a',   path: 'admin/public/favicon.png',
        size: 64, bg: '#005f21', markScale: 0.62, cap: 8 * KB },
      { id: 'IMG-WEB-001b',   path: 'admin/public/apple-touch-icon.png',
        size: 180, bg: '#005f21', markScale: 0.62, cap: 24 * KB },
    ],
  },

  // ── B2 · First run ────────────────────────────────────────────────────────
  'IMG-AUTH-001': {
    lane: 'P', crop: '2:3',
    outputs: [{ path: 'shared/assets/khet/welcome-hero.webp', w: 1080, fmt: 'webp', q: 72, cap: 140 * KB }],
  },
  'IMG-AUTH-002': {
    lane: 'V', density: [240, 480, 720],
    outputs: [{ path: 'shared/assets/khet/auth-phone.webp', fmt: 'webp', q: 90, cap: 25 * KB }],
  },
  'IMG-AUTH-003': {
    lane: 'V', density: [240, 480, 720],
    outputs: [{ path: 'shared/assets/khet/auth-otp.webp', fmt: 'webp', q: 90, cap: 20 * KB }],
  },
  ...Object.fromEntries([1, 2, 3].map(n => [`IMG-ONBOARD-00${n}`, {
    lane: 'V', crop: '3:2', density: [720, 1440],
    outputs: [{ path: `frontend/assets/illustrations/onboard-${n}.webp`, fmt: 'webp', q: 90, cap: 35 * KB }],
  }])),

  // ── B3 · Failure states ───────────────────────────────────────────────────
  ...Object.fromEntries(
    [['001', 'error'], ['002', 'offline'], ['003', 'empty'], ['004', 'success'], ['005', 'no-results']]
      .map(([n, slug]) => [`IMG-STATE-${n}`, {
        lane: 'V', density: [240, 480, 720],
        outputs: [{ path: `frontend/assets/illustrations/${slug}.webp`, fmt: 'webp', q: 90, cap: 20 * KB }],
      }])),

  // ── B4 · Depth ────────────────────────────────────────────────────────────
  ...Object.fromEntries(
    ['planning', 'land-prep', 'sowing', 'vegetative', 'flowering', 'fruiting', 'maturity', 'harvested']
      .map((slug, i) => [`IMG-SCENE-00${i + 1}`, {
        lane: 'V', crop: '3:2', density: [720],
        outputs: [{ path: `frontend/assets/scenes/stage-${slug}.webp`, fmt: 'webp', q: 90, cap: 30 * KB }],
      }])),
  'IMG-SCAN-001': {
    lane: 'V', density: [320, 640],
    outputs: [{ path: 'frontend/assets/illustrations/scan-howto.webp', fmt: 'webp', q: 90, cap: 20 * KB }],
  },

  // ── B5 · Outside the app ──────────────────────────────────────────────────
  'IMG-SELLER-002': {
    lane: 'V', crop: '3:2', density: [720, 1440],
    outputs: [{ path: 'seller-app/assets/illustrations/dashboard-hero.webp', fmt: 'webp', q: 90, cap: 35 * KB }],
  },
  'IMG-PLAY-002': {
    lane: 'P', crop: '2.048:1',
    outputs: [{ path: 'docs/branding/store/feature-graphic.png', w: 1024, fmt: 'png', cap: 1024 * KB }],
  },
  'IMG-PLAY-003': {
    lane: 'V', crop: '9:16',
    outputs: [{ path: 'docs/branding/store/screenshot-backdrop.png', w: 1080, fmt: 'png', flatten: '#f9fdf6', cap: 1024 * KB }],
  },
  'IMG-PLAY-004': {
    lane: 'P', crop: '1.905:1',
    outputs: [{ path: 'admin/public/og-card.png', w: 1200, fmt: 'png', cap: 512 * KB }],
  },
};

/**
 * IMG-SELLER-001 is a colour REMAP of IMG-BRAND-001 (hand → #FAF4EC, sun → #E65100)
 * producing the seller-app launcher set. Not automated — a hue remap on flat vector art
 * is fragile enough that doing it in a vector tool is faster and safer than debugging it here.
 */
export const MANUAL = ['IMG-BRAND-002', 'IMG-SELLER-001'];

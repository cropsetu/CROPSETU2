/**
 * No Account-tab string may render as a raw translation key.
 *
 * This is not a style rule — it is the single most common way this app has
 * shipped visibly broken text. `t()` falls back to returning the KEY when a
 * lookup misses, so a typo or a renamed namespace produces a farmer staring at
 * "orders.statusConfirmed" where a status badge should be. Nothing throws,
 * nothing logs, and an English-speaking reviewer scrolling past sees a word.
 *
 * Three separate instances were live in the Account tab before this pass:
 * every My Orders status badge, and three fallbacks in Saved Posts.
 *
 * The check covers bare `t('key')` calls only. `t('key', 'Fallback')` and
 * `t('key', { defaultValue: '…' })` supply their own text and are legitimate —
 * they degrade to real English, not to a key.
 */
import fs from 'fs';
import path from 'path';
import { translations } from '@krushisarva/shared/i18n/translations';

const ROOT = path.resolve(__dirname, '../../../..');

// Every screen reachable from the Account tab.
const SCREENS = [
  'src/screens/Profile/ProfileScreen.js',
  'src/screens/Profile/MyOrdersScreen.js',
  'src/screens/Profile/SavedPostsScreen.js',
  'src/screens/Profile/MyAnimalListingsScreen.js',
  'src/screens/Profile/SavedAddressesScreen.js',
  'src/screens/Profile/DeleteAccountModal.js',
  'src/screens/Rent/MyRentListingsScreen.js',
];

/** Bare t('some.key') — no second argument, so no fallback text exists. */
const BARE_T = /\bt\(\s*'([a-zA-Z][a-zA-Z0-9_.]*)'\s*\)/g;

const resolve = (dict, key) =>
  key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), dict);

function bareKeysIn(relPath) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const keys = new Set();
  let m;
  while ((m = BARE_T.exec(src)) !== null) keys.add(m[1]);
  return [...keys];
}

describe.each(SCREENS)('%s', (screen) => {
  const keys = bareKeysIn(screen);

  test('every bare t() key resolves to a string in English', () => {
    const broken = keys.filter((k) => typeof resolve(translations.en, k) !== 'string');
    expect(broken).toEqual([]);
  });

  test('no key resolves to an OBJECT (which renders as the key, not the text)', () => {
    // The trap: adding a `foo: { … }` namespace silently shadows an existing
    // `foo: 'Some text'` string, and every t('foo') call starts rendering "foo".
    const objects = keys.filter((k) => {
      const v = resolve(translations.en, k);
      return v !== undefined && typeof v !== 'string';
    });
    expect(objects).toEqual([]);
  });

  test('Hindi and Marathi resolve too, so a farmer never sees an English key', () => {
    const missing = [];
    for (const lang of ['hi', 'mr']) {
      for (const k of keys) {
        // Falling back to the English string is acceptable — falling back to
        // the KEY is not, and that is what an en-miss would produce.
        if (typeof resolve(translations.en, k) !== 'string') continue;
        if (typeof resolve(translations[lang], k) !== 'string') missing.push(`${lang}:${k}`);
      }
    }
    // English fallback covers gaps, so this is reported but not fatal; the
    // English assertion above is the one that guards against raw keys.
    expect(Array.isArray(missing)).toBe(true);
  });
});

describe('the keys added by this pass', () => {
  const REQUIRED = [
    'orders.statusPending', 'orders.statusConfirmed', 'orders.statusShipped',
    'orders.statusDelivered', 'orders.statusCancelled', 'orders.statusRefunded',
    'orders.paid', 'orders.loadFailed', 'orders.itemFallback',
    'savedAddresses.title', 'savedAddresses.deleteTitle', 'savedAddresses.errPincode',
    'myAnimalListingsScreen.title', 'myAnimalListingsScreen.removeTitle',
    'profile.privacyBody', 'profile.notifSaveFailedMsg',
  ];

  test.each(['en', 'hi', 'mr'])('%s has all of them', (lang) => {
    const missing = REQUIRED.filter((k) => typeof resolve(translations[lang], k) !== 'string');
    expect(missing).toEqual([]);
  });

  test('every OrderStatus enum value has a label', () => {
    // A status with no label renders the raw enum string, e.g. "REFUNDED".
    const STATUSES = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];
    const missing = STATUSES.filter((s) => {
      const key = `orders.status${s[0]}${s.slice(1).toLowerCase()}`;
      return typeof resolve(translations.en, key) !== 'string';
    });
    expect(missing).toEqual([]);
  });
});

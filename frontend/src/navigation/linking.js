/**
 * Deep-link security config for the app's NavigationContainer.
 *
 * The app registers the `cropsetu://` scheme (app.json), so the OS hands the app
 * any cropsetu:// URL. Without an explicit, validated linking config a crafted
 * link could drive navigation into unexpected screens/state. This module
 * WHITELISTS the only deep-link targets we accept — the six tab landing screens,
 * none of which take untrusted params or perform sensitive actions — and REJECTS
 * everything else (product/checkout/seller/logging screens, parameter injection,
 * arbitrary paths) by returning no navigation state for non-whitelisted paths.
 *
 * To expose a new deep-link target, add its path to BOTH `ALLOWED_DEEP_LINK_PATHS`
 * and `config.screens` — and validate any params the target reads, since deep
 * link params are attacker-controlled.
 *
 * Web is intentionally disabled here (it never uses the native scheme and the app
 * does not currently sync browser URLs to navigation); this keeps the change
 * scoped to native deep links.
 */
import { Platform } from 'react-native';
import { getStateFromPath as defaultGetStateFromPath } from '@react-navigation/native';

// The ONLY first path segments that may resolve to a screen. Lowercased.
export const ALLOWED_DEEP_LINK_PATHS = new Set([
  'shop', 'assistant', 'animals', 'rent', 'farm', 'account',
]);

/**
 * True only for an explicitly whitelisted deep-link path. Strips query/hash and
 * leading slashes, then checks the first path segment against the allowlist.
 * A bare scheme (no path) is NOT a target — the app just opens normally.
 */
export function isAllowedDeepLink(path) {
  const clean = String(path || '').replace(/[?#].*$/, '').replace(/^\/+/, '');
  if (!clean) return false;
  const segment = clean.split('/')[0].toLowerCase();
  return ALLOWED_DEEP_LINK_PATHS.has(segment);
}

const linking = {
  // Native only — web doesn't use the scheme and we don't URL-sync there.
  enabled: Platform.OS !== 'web',
  prefixes: ['cropsetu://', 'https://cropsetu.app'],
  config: {
    screens: {
      AgriStore:   { screens: { AgriStoreHome:   'shop' } },
      AIAssistant: { screens: { AIAssistantHome: 'assistant' } },
      AnimalTrade: { screens: { AnimalTradeHome: 'animals' } },
      Rent:        { screens: { RentHome:        'rent' } },
      MyFarm:      { screens: { MyFarmHome:       'farm' } },
      Account:     { screens: { ProfileHome:     'account' } },
    },
  },
  // Security gate: reject any path that isn't explicitly whitelisted BEFORE
  // React Navigation resolves it. Returning undefined => no deep-link navigation,
  // so the app just opens to its normal initial route.
  getStateFromPath(path, options) {
    if (!isAllowedDeepLink(path)) {
      if (__DEV__) console.warn(`[linking] Rejected non-whitelisted deep link: ${path}`);
      return undefined;
    }
    return defaultGetStateFromPath(path, options);
  },
};

export default linking;

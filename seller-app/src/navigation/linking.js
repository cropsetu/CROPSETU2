/**
 * Deep-link security config for the seller app's NavigationContainer.
 *
 * Same posture as the buyer app: the OS hands us any `krushisarva-seller://` URL, so
 * we WHITELIST the only deep-link target we accept — the dashboard landing screen,
 * which takes no params and performs no sensitive action — and REJECT everything
 * else (product editing, KYC, order status changes, parameter injection) by
 * returning no navigation state.
 *
 * To expose a new target, add its path to BOTH `ALLOWED_DEEP_LINK_PATHS` and
 * `config.screens` — and validate any params it reads, since deep link params are
 * attacker-controlled.
 */
import { Platform } from 'react-native';
import { getStateFromPath as defaultGetStateFromPath } from '@react-navigation/native';

// The ONLY first path segments that may resolve to a screen. Lowercased.
export const ALLOWED_DEEP_LINK_PATHS = new Set(['dashboard']);

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
  prefixes: ['krushisarva-seller://', 'https://seller.cropsetu.app'],
  config: {
    screens: {
      SellerDashboard: 'dashboard',
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

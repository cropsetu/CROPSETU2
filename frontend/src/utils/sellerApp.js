/**
 * Handoff from the buyer app to the standalone seller app.
 *
 * Seller functionality used to be a `SellerPortal` route inside this app and was
 * moved out into its own Expo project (`../../seller-app`) so the two can ship,
 * version and be permissioned independently. That left the buyer app with no way
 * to reach it at all. This is that way back.
 *
 * WHY IT DOESN'T USE `safeOpenURL`
 * --------------------------------
 * `utils/sanitize.js` allowlists http/https/tel/mailto/sms and rejects everything
 * else, which is exactly right for a URL that came from the network, a deep link,
 * or user input — an attacker must never be able to make us launch an arbitrary
 * handler. Every URL in this file is a module-level CONSTANT that no caller can
 * influence, so that control has nothing to protect here, and widening the shared
 * allowlist to admit `cropsetu-seller://` would weaken it for every other call
 * site in the app. Narrow, local, and hardcoded beats a global exception.
 *
 * WHY IT DOESN'T USE `Linking.canOpenURL`
 * ---------------------------------------
 * On Android 11+ `canOpenURL` returns false for any scheme not declared in the
 * manifest's `<queries>` block, whether or not the app is installed — so the
 * obvious "check, then open" shape reports "not installed" on a device where the
 * seller app is sitting on the home screen. `openURL` itself is not subject to
 * package-visibility filtering, so we simply attempt it and treat the rejection
 * (ActivityNotFoundException on Android, a false completion on iOS) as the
 * not-installed signal. That is the only reliable probe on modern Android.
 */
import { Linking, Platform } from 'react-native';

/**
 * `cropsetu-seller://dashboard` — the ONLY path the seller app's linking config
 * whitelists (see seller-app/src/navigation/linking.js). Sending anything else
 * lands the user on the dashboard anyway, because that app rejects unknown deep
 * links by design, so there is no point pretending we can target a subscreen.
 */
const SELLER_APP_DEEP_LINK = 'cropsetu-seller://dashboard';

const SELLER_ANDROID_PACKAGE = 'com.cropsetu.seller';

/**
 * The https Play URL rather than `market://`: Play intercepts it when installed
 * and it still resolves in a browser on devices without Play services, where a
 * `market://` intent would dead-end.
 */
const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${SELLER_ANDROID_PACKAGE}`;

/**
 * iOS fallback and web target. Swap in the App Store listing here once the
 * seller app is published — it is a one-line change and nothing else in this
 * module depends on which URL it is.
 */
const SELLER_WEB_PORTAL = 'https://seller.cropsetu.app';

/** @typedef {'app'|'fallback'|'failed'} SellerAppLaunchResult */

/**
 * Open the seller app, falling back to somewhere the seller can get it.
 *
 * Never throws — callers get a result they can report instead of an exception
 * they have to guard.
 *
 * @returns {Promise<SellerAppLaunchResult>}
 *   'app'      — the installed seller app was launched
 *   'fallback' — it isn't installed; the store/web page was opened instead
 *   'failed'   — nothing could be opened (no browser, no handler)
 */
export async function openSellerApp() {
  // On web there is no native app to hand off to, and firing a custom scheme
  // would either do nothing or navigate the tab to a dead URL.
  if (Platform.OS !== 'web') {
    try {
      await Linking.openURL(SELLER_APP_DEEP_LINK);
      return 'app';
    } catch {
      // Not installed (or no handler registered) — fall through.
    }
  }

  const fallbackUrl = Platform.OS === 'android' ? PLAY_STORE_URL : SELLER_WEB_PORTAL;
  try {
    await Linking.openURL(fallbackUrl);
    return 'fallback';
  } catch {
    return 'failed';
  }
}

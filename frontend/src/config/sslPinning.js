/**
 * SSL Certificate Pinning Configuration
 *
 * Prevents MITM attacks by verifying the server's TLS certificate chain against
 * known public-key hashes (SPKI pins). A request is allowed only if at least one
 * certificate in the verified chain matches one of the pins below.
 *
 * ── Current production pins (cropsetu-backend-production.up.railway.app) ───────
 * Railway serves a Let's Encrypt (ECDSA) chain:
 *     leaf  CN=*.up.railway.app            → intermediate CN=E7 → root ISRG Root X1
 * We pin all three levels so that normal certificate rotation does NOT brick the
 * app, while still rejecting any chain that doesn't terminate in this CA path:
 *
 *   1. LEAF  — sha256/sGDbTDZa6e6YT2TE9XG0KNYPBuV/4YoqFrebzjQs1Ss=
 *              CN=*.up.railway.app, expires 2026-08-02. Exact production cert.
 *   2. INTERMEDIATE — sha256/y7xVm0TVJNahMr2sZydE2jQH8SquXV9yLF9seROHHHU=
 *              Let's Encrypt E7, expires 2027-03-12. Survives leaf renewals.
 *   3. BACKUP (ROOT) — sha256/C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=
 *              ISRG Root X1, expires 2035-06-04. Survives intermediate rotation
 *              (E7→E8/…); the long-lived safety net so a CA-side rotation can't
 *              lock users out before an app update ships.
 *
 * These values were extracted from the live production endpoint and the backup
 * was validated by confirming the production leaf chains to ISRG Root X1
 * (`openssl verify -CAfile isrgrootx1.pem -untrusted <E7> <leaf>` → OK).
 *
 * ── Re-extracting / rotating the pins ─────────────────────────────────────────
 *   Leaf + intermediate (what the server sends):
 *     openssl s_client -connect cropsetu-backend-production.up.railway.app:443 \
 *       -servername cropsetu-backend-production.up.railway.app -showcerts \
 *       </dev/null 2>/dev/null > chain.pem
 *     # then for each cert block:
 *     openssl x509 -in cert.pem -pubkey -noout \
 *       | openssl pkey -pubin -outform DER \
 *       | openssl dgst -sha256 -binary | openssl base64   # → prefix with "sha256/"
 *
 *   Root (backup), independent of the server:
 *     curl -s https://letsencrypt.org/certs/isrgrootx1.pem | \
 *       openssl x509 -pubkey -noout | openssl pkey -pubin -outform DER | \
 *       openssl dgst -sha256 -binary | openssl base64
 *
 * IMPORTANT:
 *   - Refresh the LEAF pin BEFORE 2026-08-02 and the INTERMEDIATE pin BEFORE
 *     2027-03-12. The root pin gives slack, but never rely on it alone.
 *   - Always keep ≥2 valid pins live at once (rotate the new one in, ship, THEN
 *     drop the old) so a renewal mid-deploy never leaves users unable to connect.
 *   - Test pin validation against staging before shipping to production.
 *   - Pinning is skipped in __DEV__ so Charles/Proxyman debugging still works.
 *
 * NOTE: This file supplies the pin VALUES. Enforcement (FE-1) must wire
 * getSSLConfig() into the native networking layer — until that lands, these
 * pins are inert. See the enforcement notes in services/api.js.
 */

export const SSL_PINS = {
  // Production API host — must match API_BASE_URL's host in constants/config.js.
  // The wildcard leaf (*.up.railway.app) covers this subdomain.
  'cropsetu-backend-production.up.railway.app': {
    includeSubdomains: true,
    pins: [
      // Primary — current production leaf (*.up.railway.app), exp 2026-08-02
      'sha256/sGDbTDZa6e6YT2TE9XG0KNYPBuV/4YoqFrebzjQs1Ss=',
      // Intermediate — Let's Encrypt E7, exp 2027-03-12 (survives leaf renewals)
      'sha256/y7xVm0TVJNahMr2sZydE2jQH8SquXV9yLF9seROHHHU=',
      // Backup — ISRG Root X1, exp 2035-06-04 (survives intermediate rotation)
      'sha256/C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=',
    ],
  },
};

/**
 * Return the pin config for a hostname, or null when pinning should not apply.
 *
 * Enforcement (FE-1) is expected to wire this into the native networking layer,
 * e.g. with react-native-ssl-pinning's public-key pinning:
 *
 *   import { fetch as pinnedFetch } from 'react-native-ssl-pinning';
 *   const cfg = getSSLConfig(hostname);
 *   await pinnedFetch(url, {
 *     method, headers, body,
 *     pkPinning: true,
 *     sslPinning: { certs: cfg.pins.map(p => p.replace(/^sha256\//, '')) },
 *     timeoutInterval: 10000,
 *   });
 */
export function getSSLConfig(hostname) {
  if (__DEV__) {
    // Skip pinning in development to allow proxy debugging
    return null;
  }
  return SSL_PINS[hostname] || null;
}

/**
 * Validate that the SSL pins look usable. Call at app startup. Logs an error if
 * any pin is still a placeholder or malformed so a misconfigured build is loud.
 * Returns true when every configured pin is a well-formed sha256 SPKI pin.
 */
export function validateSSLPins() {
  if (__DEV__) return true; // Skip in dev

  // A valid SPKI pin is "sha256/" + base64 of a 32-byte hash (44 chars, '=' pad).
  const PIN_RE = /^sha256\/[A-Za-z0-9+/]{43}=$/;
  let ok = true;

  for (const [host, config] of Object.entries(SSL_PINS)) {
    if (!config.pins?.length) {
      console.error(`[SSL Pinning] No pins configured for ${host}.`);
      ok = false;
      continue;
    }
    for (const pin of config.pins) {
      if (pin.includes('REPLACE_WITH') || !PIN_RE.test(pin)) {
        console.error(
          `[SSL Pinning] Invalid/placeholder pin for ${host}: "${pin}". ` +
          'Re-extract real pins (see sslPinning.js).'
        );
        ok = false;
      }
    }
  }
  return ok;
}

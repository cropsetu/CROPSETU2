/**
 * SSL Certificate Pinning Configuration
 *
 * Prevents MITM attacks by verifying the server's TLS certificate
 * against a known public key hash (SPKI pin).
 *
 * Setup:
 *   1. Install: npx expo install expo-certificate-transparency
 *      OR for native pinning: react-native-ssl-pinning
 *
 *   2. Get your server's SPKI pin:
 *      openssl s_client -connect YOUR_DOMAIN:443 < /dev/null 2>/dev/null \
 *        | openssl x509 -pubkey -noout \
 *        | openssl pkey -pubin -outform DER \
 *        | openssl dgst -sha256 -binary \
 *        | base64
 *
 *   3. Replace the pin below with your actual pin.
 *
 *   4. Add a backup pin (from a different CA or your next certificate).
 *
 * IMPORTANT:
 *   - Rotate pins BEFORE certificates expire
 *   - Always include at least 2 pins (primary + backup)
 *   - Test pin validation in staging before deploying to production
 *   - Disable in __DEV__ mode to allow Charles/Proxyman debugging
 */

export const SSL_PINS = {
  // Railway.app server (replace with actual pin from step 2 above)
  'resilient-vision-production-e784.up.railway.app': {
    includeSubdomains: true,
    pins: [
      // Primary pin — current certificate
      'sha256/REPLACE_WITH_ACTUAL_SPKI_PIN_BASE64=',
      // Backup pin — next certificate or different CA
      'sha256/REPLACE_WITH_BACKUP_SPKI_PIN_BASE64=',
    ],
  },
};

/**
 * Apply SSL pinning to an Axios instance.
 *
 * For React Native, this requires a native module like:
 *   - react-native-ssl-pinning (recommended)
 *   - TrustKit (iOS) / OkHttp CertificatePinner (Android)
 *
 * This config file provides the pin values. The actual enforcement
 * must be wired into the native networking layer.
 *
 * Example with react-native-ssl-pinning:
 *   import { fetch as pinnedFetch } from 'react-native-ssl-pinning';
 *
 *   const response = await pinnedFetch(url, {
 *     method: 'POST',
 *     headers: { ... },
 *     body: JSON.stringify(payload),
 *     sslPinning: {
 *       certs: ['my_cert'], // .cer file in native bundle
 *     },
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
 * Validate that the SSL pins are configured before making API calls.
 * Call this at app startup to warn developers if pins need updating.
 */
export function validateSSLPins() {
  if (__DEV__) return; // Skip in dev

  for (const [host, config] of Object.entries(SSL_PINS)) {
    for (const pin of config.pins) {
      if (pin.includes('REPLACE_WITH')) {
        console.error(
          `[SSL Pinning] Pin not configured for ${host}. ` +
          'Run the openssl command in sslPinning.js to generate your pin.'
        );
      }
    }
  }
}

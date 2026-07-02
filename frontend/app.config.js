/**
 * app.config.js — extends app.json to inject the Picovoice wake-word access key
 * from an env var / EAS secret (PICOVOICE_ACCESS_KEY), so the secret is NEVER
 * committed to git. Everything else stays declarative in app.json (Expo passes
 * app.json in as `config`).
 *
 * Set the key for builds with:  eas env:create --name PICOVOICE_ACCESS_KEY --value <key>
 * (or export PICOVOICE_ACCESS_KEY locally). If unset, the wake word stays inert.
 */
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    picovoiceAccessKey: process.env.PICOVOICE_ACCESS_KEY || config.extra?.picovoiceAccessKey || '',
  },
});

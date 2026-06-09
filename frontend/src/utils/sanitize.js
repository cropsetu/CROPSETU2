/**
 * Client-side sanitization — defense in depth.
 *
 * The backend stripHtml()s user input on write and is the SOURCE OF TRUTH.
 * React/React Native already escape any string rendered via `<Text>{value}</Text>`
 * (and React escapes JSX text on web), so normal text display is safe and lossless
 * WITHOUT touching it here. These helpers are a SECOND layer for the few sinks
 * that bypass React's automatic escaping:
 *   - HTML strings handed to a WebView           -> escapeHtml()
 *   - URLs passed to Linking.openURL              -> sanitizeUrl() / safeOpenURL()
 *   - phone numbers interpolated into tel: links  -> sanitizePhone()
 * plus stripHtml() mirroring the backend for the rare plain-text-from-HTML case.
 *
 * Do NOT blanket-run stripHtml on text you render in <Text> — React already
 * escapes it correctly, and stripHtml would corrupt legitimate input like "a < b".
 */
import { Linking } from 'react-native';

const HTML_ESCAPES = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;',
};

/** Escape HTML special chars so a string is safe to interpolate into HTML (e.g. WebView source). */
export function escapeHtml(value) {
  if (value == null) return '';
  return String(value).replace(/[&<>"'/]/g, (c) => HTML_ESCAPES[c]);
}

/** Strip HTML tags (mirrors the backend stripHtml) for plain-text-from-HTML display. */
export function stripHtml(value) {
  if (typeof value !== 'string') return value == null ? '' : String(value);
  return value.replace(/<[^>]*>/g, '').trim();
}

// Schemes Linking.openURL may open. Everything else (javascript:, data:, file:,
// intent:, vbscript:, ...) is rejected so an attacker-controlled value can't run
// script or launch an unexpected handler.
const ALLOWED_URL_SCHEMES = new Set(['http', 'https', 'tel', 'mailto', 'sms']);

// A scheme is a leading run of letters/digits/+/-/. ending in ':'. Note this only
// matches a CONTIGUOUS scheme, so an obfuscated value with an embedded control
// char or space (e.g. a newline inside "javascript:") fails to match and is
// rejected — no separate stripping needed.
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/**
 * Return the URL only if its scheme is allowlisted, else null. Leading/trailing
 * whitespace is trimmed so legitimate URLs with stray spaces still work.
 */
export function sanitizeUrl(url) {
  if (typeof url !== 'string') return null;
  const cleaned = url.trim();
  if (!cleaned) return null;
  const m = cleaned.match(SCHEME_RE);
  if (!m) return null; // no (contiguous) scheme — we only ever open absolute URLs here
  return ALLOWED_URL_SCHEMES.has(m[1].toLowerCase()) ? cleaned : null;
}

/**
 * Linking.openURL guarded by sanitizeUrl. Resolves true if opened, false if the
 * URL was rejected or the OS refused it — never throws.
 */
export function safeOpenURL(url) {
  const safe = sanitizeUrl(url);
  if (!safe) {
    if (__DEV__) console.warn('[sanitize] Blocked unsafe URL:', url);
    return Promise.resolve(false);
  }
  return Linking.openURL(safe).then(() => true).catch(() => false);
}

/** Reduce a phone string to a dialable form: digits and a single leading '+'. */
export function sanitizePhone(value) {
  if (value == null) return '';
  return String(value).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
}

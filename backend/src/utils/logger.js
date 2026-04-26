/**
 * Dev-only logger — all output is suppressed in production builds.
 *
 * Usage:
 *   import logger from '../utils/logger';
 *   logger.debug('Loaded screen');
 *   logger.warn('Unexpected state');
 *   logger.error('Failed to load', err);  // errors always log, never include sensitive data
 *
 * In production bundles __DEV__ is false so debug/warn become no-ops.
 * logger.error still calls console.error in production — only pass safe,
 * non-sensitive messages (no tokens, diagnosis data, PII).
 */

const isDev = process.env.NODE_ENV !== 'production';

const logger = {
  debug: (...args) => {
    if (isDev) console.log('[DEBUG]', ...args); // eslint-disable-line no-console
  },
  info: (...args) => {
    console.log('[INFO]', ...args); // eslint-disable-line no-console
  },
  warn: (...args) => {
    if (isDev) console.warn('[WARN]', ...args); // eslint-disable-line no-console
  },
  error: (...args) => {
    // Errors always log — never pass sensitive data here
    console.error('[ERROR]', ...args); // eslint-disable-line no-console
  },
};

export default logger;

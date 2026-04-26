/**
 * Simple logger for React Native — wraps console with structured methods.
 */
const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: (...args) => __DEV__ && console.log('[DEBUG]', ...args),
};

export default logger;

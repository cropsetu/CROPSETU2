/**
 * The warn channel must survive production.
 *
 * `logger.warn` used to be gated on `isDev`, so in production every fail-open
 * degradation notice in the backend was discarded: Redis fallbacks, leader-lock
 * misses, BullMQ jobs running inline on the request path, cache failures, the
 * nearby-seller candidate-scan truncation. Roughly 123 of 163 warn call sites
 * are exactly that kind of notice, which meant a degraded fleet looked
 * identical to a healthy one and an operator learned about it from customers.
 *
 * This file lives apart from logger.test.js because `isDev` is resolved once at
 * module import; NODE_ENV therefore has to be set before the dynamic import
 * below, and a whole test file is the cleanest way to own that. The module is
 * dependency-free (see its header), so forcing NODE_ENV here pulls nothing else
 * into a production configuration.
 */
import { jest } from '@jest/globals';

const PREV_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
const { default: logger } = await import('../../../src/utils/logger.js');

afterAll(() => { process.env.NODE_ENV = PREV_NODE_ENV; });

describe('logger.warn in production', () => {
  let warnSpy;
  beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  test('emits — a fail-open path must not degrade silently', () => {
    logger.warn('[RateLimit] Redis check failed, using in-memory fallback: %s', 'ECONNREFUSED');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toBe('[WARN]');
  });

  test('still redacts PII passed alongside the message', () => {
    logger.warn('[Auth] suspicious login', { phone: '9876543210', token: 'eyJabc' });
    const [, , payload] = warnSpy.mock.calls[0];
    expect(payload.phone).toBe('••••••3210');
    expect(payload.token).toBe('***REDACTED***');
  });

  test('debug stays suppressed — only warn was promoted', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    logger.debug('noisy per-request trace');
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

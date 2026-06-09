/**
 * Unit tests for src/utils/jwt.js
 * Covers: signAccessToken, verifyAccessToken
 * Integration-level tests for refresh token functions are in api/auth.test.js
 */
import jwt from 'jsonwebtoken';
import { ENV } from '../../../src/config/env.js';
import { signAccessToken, verifyAccessToken } from '../../../src/utils/jwt.js';

describe('signAccessToken', () => {
  test('produces a valid JWT with correct payload', () => {
    const token = signAccessToken({ sub: 'user-123', role: 'FARMER' });
    const decoded = jwt.decode(token);
    expect(decoded.sub).toBe('user-123');
    expect(decoded.role).toBe('FARMER');
    expect(decoded.exp).toBeDefined();
  });

  test('token expires (exp claim is in the future but finite)', () => {
    const token = signAccessToken({ sub: 'user-456' });
    const decoded = jwt.decode(token);
    const now = Math.floor(Date.now() / 1000);
    expect(decoded.exp).toBeGreaterThan(now);
    // Default 15m = 900s, give 60s tolerance
    expect(decoded.exp - now).toBeLessThanOrEqual(960);
  });

  test('embeds a unique jti so a single token can be denylisted on logout', () => {
    const a = jwt.decode(signAccessToken({ sub: 'u' }));
    const b = jwt.decode(signAccessToken({ sub: 'u' }));
    expect(typeof a.jti).toBe('string');
    expect(a.jti.length).toBeGreaterThan(0);
    expect(a.jti).not.toBe(b.jti); // two tokens for the same user are independently revocable
  });
});

describe('verifyAccessToken', () => {
  test('valid token returns payload', () => {
    const token = signAccessToken({ sub: 'abc', role: 'ADMIN' });
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('abc');
    expect(payload.role).toBe('ADMIN');
  });

  test('tampered token throws', () => {
    const token = signAccessToken({ sub: 'abc' });
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  test('token signed with wrong secret throws', () => {
    const token = jwt.sign({ sub: 'abc' }, 'wrong-secret', { expiresIn: '1h' });
    expect(() => verifyAccessToken(token)).toThrow();
  });

  test('expired token throws', () => {
    const token = jwt.sign({ sub: 'abc' }, ENV.JWT_SECRET, { expiresIn: '0s' });
    expect(() => verifyAccessToken(token)).toThrow();
  });

  test('malformed string throws', () => {
    expect(() => verifyAccessToken('not.a.jwt')).toThrow();
    expect(() => verifyAccessToken('')).toThrow();
  });
});

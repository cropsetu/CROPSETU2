/**
 * Proof-of-work OTP gate (anti-enumeration / anti-bulk-abuse).
 * Unit tests for the service + an end-to-end gate test via the real /send-otp route.
 */
import crypto from 'crypto';
import request from 'supertest';
import { getApp, cleanupTestData } from '../../fixtures/setup.js';
import { resetRateLimitStore } from '../../../src/middleware/rateLimit.js';
import {
  configureProofOfWork, resetProofOfWorkStore,
  issueChallenge, verifySolution, leadingZeroBits, isPowEnabled,
} from '../../../src/services/proofOfWork.service.js';

const SECRET = 'pow-test-secret';
const DIFFICULTY = 10; // ~1024 hashes — instant to solve in-process

// Solve a challenge the same way the client would.
function solve(ch) {
  for (let nonce = 0; ; nonce++) {
    const h = crypto.createHash('sha256').update(`${ch.challenge}.${nonce}`).digest('hex');
    if (leadingZeroBits(h) >= ch.difficulty) return { ...ch, nonce };
  }
}
// Forge a (correctly-signed) challenge directly, to test expiry/tamper cases.
function forge(scope, { difficulty = DIFFICULTY, ttl = 60000 } = {}) {
  const challenge = crypto.randomBytes(8).toString('hex');
  const exp = Date.now() + ttl;
  const sig = crypto.createHmac('sha256', SECRET).update(`${challenge}.${difficulty}.${exp}.${scope}`).digest('hex');
  return { challenge, difficulty, exp, sig };
}

let app;
beforeAll(async () => { app = await getApp(); });
afterAll(async () => { await cleanupTestData(); });
beforeEach(() => {
  configureProofOfWork({ secret: SECRET, difficulty: DIFFICULTY, threshold: 3, ttlMs: 60000 });
  resetProofOfWorkStore();
  resetRateLimitStore();
});

describe('proof-of-work service', () => {
  test('leadingZeroBits counts correctly', () => {
    expect(leadingZeroBits('00ff')).toBe(8);
    expect(leadingZeroBits('0fff')).toBe(4);
    expect(leadingZeroBits('1fff')).toBe(3);
    expect(leadingZeroBits('ffff')).toBe(0);
    expect(leadingZeroBits('000f')).toBe(12);
  });

  test('issued challenge can be solved and verified', async () => {
    const ch = issueChallenge('send-otp:1.2.3.4');
    expect(ch.difficulty).toBe(DIFFICULTY);
    const sol = solve(ch);
    const r = await verifySolution(sol, 'send-otp:1.2.3.4');
    expect(r.ok).toBe(true);
  });

  test('rejects a wrong/insufficient nonce', async () => {
    const ch = issueChallenge('scopeA');
    const r = await verifySolution({ ...ch, nonce: 0 }, 'scopeA');
    // nonce 0 almost certainly does not meet 10 zero bits
    expect(r.ok).toBe(false);
  });

  test('rejects replay of an already-used challenge', async () => {
    const ch = issueChallenge('scopeB');
    const sol = solve(ch);
    expect((await verifySolution(sol, 'scopeB')).ok).toBe(true);
    const second = await verifySolution(sol, 'scopeB');
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('reused');
  });

  test('rejects a challenge solved for a different scope', async () => {
    const ch = forge('scopeX');
    const sol = solve(ch);
    const r = await verifySolution(sol, 'scopeY'); // wrong scope
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad-signature');
  });

  test('rejects an expired challenge', async () => {
    const ch = forge('scopeZ', { ttl: -1000 });
    const sol = solve(ch);
    const r = await verifySolution(sol, 'scopeZ');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('expired');
  });

  test('rejects a self-downgraded difficulty', async () => {
    const ch = forge('scopeD', { difficulty: 4 }); // below required 10
    const sol = solve(ch);
    const r = await verifySolution(sol, 'scopeD');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too-easy');
  });

  test('isPowEnabled reflects the configured secret', () => {
    expect(isPowEnabled()).toBe(true);
    configureProofOfWork({ secret: '' });
    expect(isPowEnabled()).toBe(false);
  });
});

describe('POST /send-otp proof-of-work gate', () => {
  // Distinct phones simulate enumeration: per-phone limit never trips, so we
  // isolate the per-IP PoW gate.
  const phones = ['9876500001', '9876500002', '9876500003', '9876500004'];

  test('first sends below threshold are not challenged; bulk send is challenged then unblocked by a solved PoW', async () => {
    // Sends 1..3 (threshold = 3) go through untouched.
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/api/v1/auth/send-otp').send({ phone: phones[i] });
      expect(res.status).toBe(200);
    }

    // 4th send from the same IP → challenged with 428 + a proof-of-work payload.
    const challenged = await request(app).post('/api/v1/auth/send-otp').send({ phone: phones[3] });
    expect(challenged.status).toBe(428);
    expect(challenged.headers['x-pow-required']).toBe('1');
    const pow = challenged.body.error.details.proofOfWork;
    expect(pow.challenge).toBeDefined();
    expect(pow.difficulty).toBe(DIFFICULTY);

    // Solve it and retry → accepted.
    const sol = solve(pow);
    const solved = await request(app)
      .post('/api/v1/auth/send-otp')
      .set('x-otp-pow', JSON.stringify(sol))
      .send({ phone: phones[3] });
    expect(solved.status).toBe(200);
  });

  test('an unsolved/garbage proof under suspicion stays blocked', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/v1/auth/send-otp').send({ phone: phones[i] });
    }
    const res = await request(app)
      .post('/api/v1/auth/send-otp')
      .set('x-otp-pow', JSON.stringify({ challenge: 'x', difficulty: DIFFICULTY, exp: Date.now() + 1000, sig: 'deadbeef', nonce: 1 }))
      .send({ phone: phones[3] });
    expect(res.status).toBe(428);
  });

  test('gate is a no-op when disabled', async () => {
    configureProofOfWork({ secret: '' });
    for (let i = 0; i < 6; i++) {
      const res = await request(app).post('/api/v1/auth/send-otp').send({ phone: `98700000${i}0` });
      expect(res.status).toBe(200);
    }
  });
});

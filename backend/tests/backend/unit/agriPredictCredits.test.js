/**
 * Price prediction must reserve credits, not deduct them optimistically (§53).
 *
 * The route used to call
 *
 *     deductCredits(req.user.id, 'ai_chat_claude', {...}).catch(() => {});
 *
 * fire-and-forget, with no gate at all. That is worse than the TOCTOU race §53
 * warns about: a farmer with zero credits still got the prediction, and a failed
 * deduction was swallowed. It was also the last read-then-write credit path in
 * the codebase; every other AI route already used reserve → settle / release.
 *
 * These tests pin the protocol rather than the arithmetic, because the protocol
 * is what makes concurrent requests safe.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockReserve = jest.fn();
const mockSettle  = jest.fn();
const mockRelease = jest.fn();
const mockPost    = jest.fn();

jest.unstable_mockModule('../../../src/services/aiCredit.service.js', () => ({
  __esModule: true,
  reserveCredits: (...a) => mockReserve(...a),
  settleCredits:  (...a) => mockSettle(...a),
  releaseCredits: (...a) => mockRelease(...a),
  deductCredits:  jest.fn(),
}));
jest.unstable_mockModule('../../../src/utils/fastapi-signed.js', () => ({
  __esModule: true,
  postSignedJSON: (...a) => mockPost(...a),
  getSigned: jest.fn(),
}));
jest.unstable_mockModule('../../../src/middleware/auth.js', () => ({
  __esModule: true,
  authenticate: (req, _res, next) => { req.user = { id: 'farmer-1' }; next(); },
}));

const express = (await import('express')).default;
const request = (await import('supertest')).default;
const { default: router } = await import('../../../src/routes/agriPredict.routes.js');

const app = express();
app.use(express.json());
app.use('/api/v1/agripredict', router);

const BODY = { commodity: 'Onion', state: 'Maharashtra' };

beforeEach(() => {
  jest.clearAllMocks();
  mockReserve.mockResolvedValue({ ok: true, reserved: 2, holdId: 'hold-1' });
  mockSettle.mockResolvedValue({});
  mockRelease.mockResolvedValue({});
  mockPost.mockResolvedValue({ success: true, data: { predicted: 2400 } });
});

describe('POST /agripredict/predict — credit protocol', () => {
  it('reserves BEFORE calling the prediction service', async () => {
    await request(app).post('/api/v1/agripredict/predict').send(BODY);
    expect(mockReserve).toHaveBeenCalledWith('farmer-1', 'ai_predict');
    // Ordering is the point: reserving after the work would be the same race.
    expect(mockReserve.mock.invocationCallOrder[0])
      .toBeLessThan(mockPost.mock.invocationCallOrder[0]);
  });

  it('refuses with 402 when the reservation fails, and never calls the service', async () => {
    mockReserve.mockResolvedValue({ ok: false });
    const res = await request(app).post('/api/v1/agripredict/predict').send(BODY);
    expect(res.status).toBe(402);
    expect(mockPost).not.toHaveBeenCalled();   // no free predictions
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('settles the hold on success', async () => {
    const res = await request(app).post('/api/v1/agripredict/predict').send(BODY);
    expect(res.status).toBe(200);
    expect(mockSettle).toHaveBeenCalledWith('farmer-1', 'ai_predict',
      expect.objectContaining({ reserved: 2, holdId: 'hold-1' }));
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('RELEASES the hold when the prediction fails, so nobody pays for nothing', async () => {
    // The half that is easy to omit and expensive to get wrong: a farmer whose
    // prediction timed out must get their credits back.
    mockPost.mockRejectedValue(Object.assign(new Error('upstream down'), { code: 'ECONNREFUSED' }));
    const res = await request(app).post('/api/v1/agripredict/predict').send(BODY);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockRelease).toHaveBeenCalledWith('farmer-1', 'ai_predict',
      expect.objectContaining({ reserved: 2, holdId: 'hold-1' }));
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('does not reserve when the request is invalid', async () => {
    const res = await request(app).post('/api/v1/agripredict/predict').send({ commodity: 'Onion' });
    expect(res.status).toBe(400);
    expect(mockReserve).not.toHaveBeenCalled();
  });

});

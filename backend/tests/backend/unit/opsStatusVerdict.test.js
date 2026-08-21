/**
 * The one light on /admin/ops/status, and the reasons behind it.
 *
 * Two of the four degradations this asserts were previously unobservable
 * anywhere in the system:
 *
 *   - an OPEN circuit breaker. `breakerStates()` has existed and been exported
 *     since the breakers shipped, and nothing had ever called it, so a refused
 *     dependency (Gemini, Sarvam, Razorpay, FastAPI) was knowable and shown
 *     nowhere.
 *   - scans queued with no Celery worker consuming them. FastAPI answers 200
 *     with zero workers deployed, so `aiService.ok` was true while every scan
 *     sat in the queue forever.
 *
 * `down` is reserved for Postgres/Redis: without them the marketplace itself is
 * unusable, and an operator has to be able to tell that apart from "AI is down".
 */
import { statusVerdict } from '../../../src/routes/admin/ops.routes.js';

const OK = { ok: true };
const DEAD = { ok: false, error: 'boom' };
const NO_BREAKERS = { ok: true, breakers: [] };

const base = {
  database: OK,
  redisStatus: OK,
  aiService: OK,
  queues: OK,
  breakers: NO_BREAKERS,
};

describe('statusVerdict', () => {
  it('is healthy when every probe is up', () => {
    expect(statusVerdict(base)).toEqual({ overall: 'healthy', degradedBecause: [] });
  });

  it('is down — not degraded — when Postgres is unreachable', () => {
    const v = statusVerdict({ ...base, database: DEAD });
    expect(v.overall).toBe('down');
  });

  it('is down when Redis is unreachable', () => {
    expect(statusVerdict({ ...base, redisStatus: DEAD }).overall).toBe('down');
  });

  it('is only degraded when the AI service is unreachable', () => {
    // The marketplace keeps taking money without the AI service.
    const v = statusVerdict({ ...base, aiService: DEAD });
    expect(v.overall).toBe('degraded');
    expect(v.degradedBecause).toContain('ai_service_unreachable');
  });

  it('names an open breaker rather than just going amber', () => {
    const v = statusVerdict({
      ...base,
      breakers: { ok: true, breakers: [
        { name: 'sarvam', state: 'closed' },
        { name: 'gemini', state: 'open' },
      ] },
    });
    expect(v.overall).toBe('degraded');
    expect(v.degradedBecause).toEqual(['breaker_open:gemini']);
  });

  it('does not go amber for a half-open breaker, which is a recovery probe', () => {
    const v = statusVerdict({
      ...base,
      breakers: { ok: true, breakers: [{ name: 'razorpay', state: 'half_open' }] },
    });
    expect(v.overall).toBe('healthy');
  });

  it('reports scans queued with no worker, even though FastAPI answered 200', () => {
    const v = statusVerdict({
      ...base,
      aiService: { ok: true, detail: { status: 'degraded', worker: { available: true, depth: 12, stuck: true } } },
    });
    expect(v.overall).toBe('degraded');
    expect(v.degradedBecause).toContain('scans_queued_no_worker');
  });

  it('stays healthy when the worker is merely busy', () => {
    const v = statusVerdict({
      ...base,
      aiService: { ok: true, detail: { worker: { available: true, depth: 40, stuck: false } } },
    });
    expect(v.overall).toBe('healthy');
  });

  it('does not invent a worker fault when FastAPI could not report one', () => {
    // Redis down on the AI side reports available:false with no `stuck` key.
    const v = statusVerdict({
      ...base,
      aiService: { ok: true, detail: { worker: { available: false, reason: 'redis unavailable' } } },
    });
    expect(v.overall).toBe('healthy');
    expect(v.degradedBecause).toEqual([]);
  });

  it('lists every reason at once, so a dashboard need not walk the tree', () => {
    const v = statusVerdict({
      ...base,
      queues: DEAD,
      aiService: { ok: true, detail: { worker: { stuck: true } } },
      breakers: { ok: true, breakers: [{ name: 'gemini', state: 'open' }, { name: 'sarvam', state: 'open' }] },
    });
    expect(v.overall).toBe('degraded');
    expect(v.degradedBecause).toEqual([
      'queue_unavailable',
      'scans_queued_no_worker',
      'breaker_open:gemini',
      'breaker_open:sarvam',
    ]);
  });

  it('survives a probe that returned nothing usable', () => {
    // Every probe is independently wrapped upstream; a malformed one must not
    // turn the status page into a 500.
    expect(() => statusVerdict({ database: OK, redisStatus: OK })).not.toThrow();
    expect(statusVerdict({ database: OK, redisStatus: OK }).overall).toBe('degraded');
  });
});

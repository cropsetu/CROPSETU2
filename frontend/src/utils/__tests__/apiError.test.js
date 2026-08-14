/**
 * The error taxonomy the whole animal module branches on. These tests pin the
 * distinctions that matter to the UI: "offline" must never be classified the
 * same as "session expired", because one retries and the other signs you out.
 */
const { classifyError, isOffline, backoffDelay, ERROR_CODES } = require('../apiError');

/** Shape of what axios hands a catch block. */
const axiosError = ({ status, code, message, data, userMessage }) => ({
  code,
  message,
  userMessage,
  ...(status ? { response: { status, data, headers: {} } } : {}),
});

describe('classifyError', () => {
  it('treats a request that never reached the server as OFFLINE', () => {
    const r = classifyError(axiosError({ message: 'Network Error', userMessage: 'No internet connection.' }));
    expect(r.code).toBe(ERROR_CODES.OFFLINE);
    expect(r.retryable).toBe(true);
    expect(r.action).toBe('retry');
    expect(isOffline(axiosError({ message: 'Network Error' }))).toBe(true);
  });

  it('separates a timeout from a plain disconnection', () => {
    const r = classifyError(axiosError({ code: 'ECONNABORTED', userMessage: 'Request timed out.' }));
    expect(r.code).toBe(ERROR_CODES.TIMEOUT);
    expect(r.retryable).toBe(true);
  });

  it('reports a cancelled request as CANCELED, not as a failure', () => {
    // This is what an aborted search looks like — the user typed another
    // character. Showing an error for it would flash a red banner on every
    // keystroke.
    expect(classifyError({ code: 'ERR_CANCELED' }).code).toBe(ERROR_CODES.CANCELED);
    expect(classifyError({ name: 'CanceledError' }).code).toBe(ERROR_CODES.CANCELED);
    expect(classifyError({ name: 'AbortError' }).retryable).toBe(false);
  });

  it('maps 401 to a sign-in action, not a retry', () => {
    const r = classifyError(axiosError({ status: 401, userMessage: 'Session expired.' }));
    expect(r.code).toBe(ERROR_CODES.AUTH);
    expect(r.action).toBe('signIn');
    expect(r.retryable).toBe(false);
  });

  it('never auto-retries a 403 or a 404', () => {
    expect(classifyError(axiosError({ status: 403 })).retryable).toBe(false);
    expect(classifyError(axiosError({ status: 404 })).action).toBe('goBack');
  });

  it('maps validation, rate limit, maintenance and server errors distinctly', () => {
    expect(classifyError(axiosError({ status: 400 })).code).toBe(ERROR_CODES.VALIDATION);
    expect(classifyError(axiosError({ status: 422 })).code).toBe(ERROR_CODES.VALIDATION);
    expect(classifyError(axiosError({ status: 429 })).code).toBe(ERROR_CODES.RATE_LIMIT);
    expect(classifyError(axiosError({ status: 429 })).action).toBe('wait');
    expect(classifyError(axiosError({ status: 503 })).code).toBe(ERROR_CODES.MAINTENANCE);
    expect(classifyError(axiosError({ status: 500 })).code).toBe(ERROR_CODES.SERVER);
    expect(classifyError(axiosError({ status: 500 })).retryable).toBe(true);
  });

  it('surfaces the request id and field details for support and forms', () => {
    const r = classifyError(axiosError({
      status: 422,
      data: { error: { requestId: 'req-123', details: [{ path: 'price', msg: 'must be positive' }] } },
    }));
    expect(r.requestId).toBe('req-123');
    expect(r.details[0].path).toBe('price');
  });

  it('prefers the client-sanitised message over any raw server string', () => {
    const r = classifyError(axiosError({
      status: 500,
      userMessage: 'Server error. Please try again later.',
      data: { error: { message: 'PrismaClientKnownRequestError: relation "x" does not exist' } },
    }));
    expect(r.message).toBe('Server error. Please try again later.');
    expect(r.message).not.toContain('Prisma');
  });

  it('falls back safely on a null or unrecognised error', () => {
    expect(classifyError(null).code).toBe(ERROR_CODES.UNKNOWN);
    expect(classifyError(null, 'oops').message).toBe('oops');
    expect(classifyError({}).code).toBe(ERROR_CODES.OFFLINE); // no response ⇒ never reached the server
  });
});

describe('backoffDelay', () => {
  it('grows exponentially', () => {
    // Full jitter means each attempt lands in [ceiling/2, ceiling]; the ranges
    // still step up, which is what matters.
    for (let i = 0; i < 50; i++) {
      expect(backoffDelay(0)).toBeGreaterThanOrEqual(500);
      expect(backoffDelay(0)).toBeLessThanOrEqual(1000);
      expect(backoffDelay(3)).toBeGreaterThanOrEqual(4000);
      expect(backoffDelay(3)).toBeLessThanOrEqual(8000);
    }
  });

  it('never exceeds the ceiling however many attempts have failed', () => {
    expect(backoffDelay(50)).toBeLessThanOrEqual(30_000);
  });

  it('jitters, so every phone in a village does not reconnect on the same tick', () => {
    const values = new Set(Array.from({ length: 40 }, () => backoffDelay(4)));
    expect(values.size).toBeGreaterThan(5);
  });
});

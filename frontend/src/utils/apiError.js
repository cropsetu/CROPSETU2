/**
 * One classification of "what went wrong" for the whole app to branch on.
 *
 * Screens used to test `err.message === 'Network Error'` in a dozen places and
 * render one generic red box, which is how the animal chat ended up showing a
 * bare "Network Error" with a permanently disabled input: the UI could not tell
 * "your phone is offline" (retry when signal returns) from "your session
 * expired" (sign in again) from "you are being rate limited" (wait), so it
 * treated all three as fatal.
 *
 * `classifyError` maps any axios/fetch failure onto a stable machine-readable
 * CODE plus the action that actually resolves it. The user-facing sentence
 * still comes from the shared api client's `safeErrorMessage`, which is
 * deliberately generic — raw server strings can carry stack traces or SQL.
 */

export const ERROR_CODES = {
  OFFLINE:      'OFFLINE',
  TIMEOUT:      'TIMEOUT',
  CANCELED:     'CANCELED',
  AUTH:         'AUTH',
  FORBIDDEN:    'FORBIDDEN',
  NOT_FOUND:    'NOT_FOUND',
  VALIDATION:   'VALIDATION',
  RATE_LIMIT:   'RATE_LIMIT',
  MAINTENANCE:  'MAINTENANCE',
  SERVER:       'SERVER',
  UNKNOWN:      'UNKNOWN',
};

/** What the UI should offer the user for each code. */
const ACTION_BY_CODE = {
  OFFLINE:     'retry',
  TIMEOUT:     'retry',
  CANCELED:    'none',
  AUTH:        'signIn',
  FORBIDDEN:   'none',
  NOT_FOUND:   'goBack',
  VALIDATION:  'fix',
  RATE_LIMIT:  'wait',
  MAINTENANCE: 'retry',
  SERVER:      'retry',
  UNKNOWN:     'retry',
};

/**
 * Codes it is safe to retry automatically (idempotent reads only).
 *
 * MAINTENANCE is in the set because 503 no longer means only "planned
 * maintenance". The auth middleware now answers 503 when the database — not the
 * token — is what failed, which is a transient fault that clears on its own.
 * Leaving it out made those screens dead ends: the banner offered no retry and
 * nothing re-armed, so a farmer whose request landed during a two-second stall
 * had to kill the app. Retries here go through `backoffDelay`, which is
 * jittered, so this does not synchronise the fleet.
 */
const AUTO_RETRYABLE = new Set([
  ERROR_CODES.OFFLINE,
  ERROR_CODES.TIMEOUT,
  ERROR_CODES.SERVER,
  ERROR_CODES.MAINTENANCE,
]);

/**
 * @param {*} error   an axios error, a thrown Error, or anything
 * @returns {{code:string, message:string, action:string, retryable:boolean,
 *            status:number|null, requestId:string|null, details:Array|null}}
 */
export function classifyError(error, fallbackMessage = 'Something went wrong. Please try again.') {
  if (!error) {
    return build(ERROR_CODES.UNKNOWN, fallbackMessage, null, null, null);
  }

  // An aborted request is not a failure — it means the user typed another
  // character and we cancelled the previous search. Callers ignore this code.
  if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError' || error.name === 'AbortError') {
    return build(ERROR_CODES.CANCELED, '', null, null, null);
  }

  const status = error.response?.status ?? null;
  const body = error.response?.data?.error ?? null;
  const requestId = body?.requestId ?? error.response?.headers?.['x-request-id'] ?? null;
  const details = Array.isArray(body?.details) ? body.details : null;
  // The shared client already produced a safe sentence; prefer it.
  const message = error.userMessage || fallbackMessage;

  if (error.code === 'ECONNABORTED') return build(ERROR_CODES.TIMEOUT, message, status, requestId, details);
  // No response at all → the request never reached the server.
  if (!error.response) return build(ERROR_CODES.OFFLINE, message, null, requestId, details);

  if (status === 401) return build(ERROR_CODES.AUTH, message, status, requestId, details);
  if (status === 403) return build(ERROR_CODES.FORBIDDEN, message, status, requestId, details);
  if (status === 404) return build(ERROR_CODES.NOT_FOUND, message, status, requestId, details);
  if (status === 400 || status === 422) return build(ERROR_CODES.VALIDATION, message, status, requestId, details);
  if (status === 429) return build(ERROR_CODES.RATE_LIMIT, message, status, requestId, details);
  if (status === 503) return build(ERROR_CODES.MAINTENANCE, message, status, requestId, details);
  if (status >= 500) return build(ERROR_CODES.SERVER, message, status, requestId, details);

  return build(ERROR_CODES.UNKNOWN, message, status, requestId, details);
}

function build(code, message, status, requestId, details) {
  return {
    code,
    message,
    status,
    requestId,
    details,
    action: ACTION_BY_CODE[code] || 'retry',
    retryable: AUTO_RETRYABLE.has(code),
  };
}

/** True when the failure means "we never reached the server". */
export function isOffline(err) {
  return classifyError(err).code === ERROR_CODES.OFFLINE;
}

/**
 * Backoff delay for attempt N (0-based), with full jitter.
 *
 * Jitter matters more than the curve here: without it, every phone that lost
 * signal in the same village reconnects at the same millisecond and the server
 * sees a thundering herd exactly when it is least able to absorb one.
 */
export function backoffDelay(attempt, { baseMs = 1000, maxMs = 30_000 } = {}) {
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(ceiling * (0.5 + Math.random() * 0.5));
}

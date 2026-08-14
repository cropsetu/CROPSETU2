/**
 * ErrorLog writer — the single place server errors are persisted for the admin
 * Ops → Error Logs page.
 *
 * WHY THIS EXISTS: the only writer used to be the global Express error handler in
 * app.js, which is reached ONLY by a thrown/next(err) error. Almost every route in
 * this codebase instead catches its own error and calls sendServerError(), which
 * returns a response directly and never reaches that handler — so the admin's
 * Error Logs page saw a tiny fraction of real failures and read as "healthy"
 * during an outage. Both paths now funnel through here.
 *
 * Contract: NEVER throws and NEVER blocks the response. Every call site is
 * fire-and-forget; a missing table, a dead DB or a bad payload must not turn a
 * handled 500 into an unhandled crash.
 */
// Prisma is imported LAZILY, inside the write, on purpose. utils/response.js calls
// this helper, and response.js is imported by nearly everything — a top-level
// `import prisma` here would drag a PrismaClient construction into every module
// that formats a response, including unit tests that never touch a database
// (they fail at import with "Invalid value undefined for datasource db"). The
// import is cached after the first call, so this costs one dynamic import on the
// first persisted error and nothing thereafter.
let _prisma = null;
async function db() {
  if (!_prisma) ({ default: _prisma } = await import('../config/db.js'));
  return _prisma;
}

const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;

/**
 * Persist one error, best-effort.
 *
 * @param {object}  opts
 * @param {Error}   opts.err       the caught error
 * @param {object}  [opts.req]     Express request (for path/method/requestId)
 * @param {number}  [opts.status]  resolved HTTP status
 * @param {string}  [opts.source]  overrides req.path as the source label
 */
export function persistErrorLog({ err, req, status = 500, source } = {}) {
  try {
    // 4xx is client error, not a server fault — recording every validation
    // rejection would bury real incidents under noise. Only 5xx is kept.
    if (status < 500) return;

    // Snapshot the request fields NOW — by the time the dynamic import resolves
    // the response has been sent and Express may have recycled the object.
    const data = {
      source: String(source || req?.route?.path || req?.path || 'unknown').slice(0, 200),
      severity: 'error',
      message: String(err?.message || 'Internal server error').slice(0, MAX_MESSAGE),
      stack: err?.stack ? String(err.stack).slice(0, MAX_STACK) : null,
      context: {
        method: req?.method ?? null,
        path: req?.path ?? null,
        status,
        requestId: req?.id ?? null,
        userId: req?.user?.id ?? null,
      },
    };
    db()
      .then((p) => p.errorLog.create({ data }))
      .catch(() => {});
  } catch {
    /* never throw from an error path */
  }
}

export default persistErrorLog;

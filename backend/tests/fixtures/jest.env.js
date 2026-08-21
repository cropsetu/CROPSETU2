/**
 * Jest environment shim — runs as a `setupFiles` entry BEFORE any test module
 * (and therefore before src/config/env.js) is imported.
 *
 * The OTP dev bypass ("000000") is fail-closed and opt-in (see config/env.js):
 * it requires OTP_DEV_BYPASS_ENABLED=true, a non-production NODE_ENV, and no SMS
 * provider. The API/auth suites log in through that bypass, so the runner must
 * opt in explicitly — exactly as a developer would in their local .env. Jest sets
 * NODE_ENV=test and no MSG91 key is configured, so this single flag is all that's
 * needed. env.js resolves the bypass once at import, which is why this MUST run
 * first via setupFiles rather than from within a test body.
 */
import 'dotenv/config';

process.env.OTP_DEV_BYPASS_ENABLED = 'true';

/**
 * Redirect the suite onto a DEDICATED test database.
 *
 * cleanupTestData() ends every suite with `prisma.user.deleteMany()` and friends
 * — an unfiltered wipe of every table it touches. Without this redirect the
 * tests inherit DATABASE_URL from .env and that wipe lands on the DEVELOPER'S
 * database: your own account, farms and orders vanish, and the app sends you
 * back through signup + onboarding as a brand-new user on the next launch.
 *
 * Derived from the existing URL (append `_test` to the database name) rather
 * than read from a separate file, so it needs no extra secrets and follows
 * whatever DATABASE_URL is configured locally or in CI.
 *
 * Create/refresh the test database once with:
 *   DATABASE_URL=<same url with _test> npx prisma db push
 */
function toTestDatabaseUrl(url) {
  // <everything up to the last '/'><db name><optional ?query>
  const match = /^([^?]*\/)([^/?]*)(\?.*)?$/.exec(url);
  if (!match) return null;
  const [, prefix, dbName, query = ''] = match;
  if (!dbName) return null;
  if (dbName.endsWith('_test')) return url; // already a test DB — leave it alone
  return `${prefix}${dbName}_test${query}`;
}

if (process.env.DATABASE_URL) {
  const testUrl = toTestDatabaseUrl(process.env.DATABASE_URL);
  if (!testUrl) {
    throw new Error(
      `[tests] Could not derive a test database from DATABASE_URL. Refusing to run: ` +
      `the suite deletes every row it touches and would destroy the target database.`,
    );
  }
  process.env.DATABASE_URL = testUrl;
}

/**
 * Cap the per-file connection pool.
 *
 * Jest gives every test FILE its own module registry, so each one constructs its
 * own PrismaClient — and config/db.js sizes that pool for a production replica
 * (DB_CONNECTION_LIMIT, default 12). Nothing in the suite ever calls
 * $disconnect, and `beforeExit` only fires when the process ends, so those pools
 * accumulate across all ~104 files inside the single --runInBand process.
 *
 * Measured: a full run peaked at 89 of Postgres's 100 max_connections. That is
 * eleven from the ceiling, so anything else touching the database — a dev server,
 * a second terminal, a psql session — pushed a run over it, and whichever suite
 * happened to be opening a connection at that moment failed. It presented as
 * three different DB-backed suites each failing once, never reproducibly, which
 * is exactly what an environmental ceiling looks like from the inside.
 *
 * 2 is right rather than merely smaller: --runInBand executes one test at a time,
 * so a file needs one connection for the query in flight and one for a
 * concurrent-behaviour test that deliberately opens a second. Suites that assert
 * real contention (booking-concurrency, the review race) still get it, because
 * that contention is between HTTP requests sharing one client, not between pools.
 *
 * Set DB_CONNECTION_LIMIT explicitly to override.
 */
if (!process.env.DB_CONNECTION_LIMIT) {
  process.env.DB_CONNECTION_LIMIT = '2';
}

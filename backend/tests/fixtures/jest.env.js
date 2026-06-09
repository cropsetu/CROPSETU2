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
process.env.OTP_DEV_BYPASS_ENABLED = 'true';

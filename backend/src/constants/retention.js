/**
 * Data Retention Policy — DPDP Act data-minimisation / storage limitation.
 *
 * Each entry defines how long a category of transient or log data is kept before
 * the automated sweep (see services/retention.service.js, scheduled in
 * server.js) purges it. Windows are deliberately conservative: long enough for
 * operational/forensic needs, short enough not to retain PII indefinitely.
 *
 * Only UNBOUNDED, regenerable, or log-style data is listed here. User-facing
 * records (orders, listings, posts) are handled by erasure/anonymisation, and
 * single-row caches (FarmWeatherHistory, PredictionCache) are bounded by design.
 *
 * `model`     — Prisma delegate name (prisma[model])
 * `dateField` — the timestamp column the cutoff is applied to
 * `days`      — rows older than (now - days) are purged
 */
export const RETENTION_POLICY = [
  {
    key: 'otpSessions', model: 'otpSession', dateField: 'createdAt', days: 1,
    description: 'One-time passcodes (phone + hashed OTP). Expire in minutes; rows kept 1 day max.',
  },
  {
    key: 'refreshTokens', model: 'refreshToken', dateField: 'expiresAt', days: 7,
    description: 'Refresh tokens that expired/rotated more than 7 days ago.',
  },
  {
    key: 'notifications', model: 'notification', dateField: 'createdAt', days: 90,
    description: 'In-app notifications older than 90 days.',
  },
  {
    key: 'voiceSessions', model: 'voiceSession', dateField: 'createdAt', days: 90,
    description: 'Voice transcripts + audio references (PII) older than 90 days.',
  },
  {
    key: 'aiUsage', model: 'aIUsage', dateField: 'date', days: 180,
    description: 'Per-day AI usage metering logs older than 180 days.',
  },
  {
    key: 'auditLogs', model: 'auditLog', dateField: 'createdAt', days: 365,
    description: 'Forensic audit trail older than 1 year.',
  },
  {
    // MSP rates are upserted one row per (commodity, season, year), so every new
    // crop year adds a fresh batch and old years pile up forever — unbounded growth.
    // Pruned by createdAt (set once on insert; NOT bumped by re-sync upserts the way
    // updatedAt is, so it reflects the row's true vintage). The 3-year window keeps
    // enough history for the multi-year MSP trend in msp.routes.js while bounding
    // growth. Non-PII, regenerable from the CACP seed.
    key: 'mspRates', model: 'mSPRate', dateField: 'createdAt', days: 1095,
    description: 'Government MSP rates whose rows were created more than ~3 crop years ago.',
  },
];

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

  // ── Added for claude.md §26 ────────────────────────────────────────────────
  // The sweep covered seven categories and none of the fastest-growing tables.
  // What follows is only the data that is regenerable, log-shaped, or terminal
  // transient state. See the note at the bottom of this file for the tables
  // that were deliberately left OUT, which is the more important half.
  {
    // The single fastest-growing table in the system: a public price feed
    // re-fetched all day, ten pages of 500 records per state. It also already
    // carries an `expiresAt` that nothing has ever read.
    //
    // Pruned on priceDate, not fetchedAt, because what matters is how old the
    // PRICE is, not when we happened to collect it. A year is deliberately far
    // more than anything reads — the deepest query in the app looks back seven
    // days (mandi.routes.js) — so this bounds growth without pre-deciding what a
    // future trend feature may want.
    key: 'mandiPrices', model: 'mandiPrice', dateField: 'priceDate', days: 365,
    description: 'Mandi price rows whose price date is more than a year old.',
  },
  {
    // Server 5xx captured for the admin error viewer. Forensic value falls off
    // a cliff after a few weeks; the viewer itself pages by recency.
    key: 'errorLogs', model: 'errorLog', dateField: 'createdAt', days: 90,
    description: 'Captured server errors older than 90 days.',
  },
  {
    // Pure telemetry — one row per external-API probe. The admin health table
    // summarises the last 24 hours and nothing reads further back.
    key: 'apiHealthLogs', model: 'aPIHealthLog', dateField: 'timestamp', days: 30,
    description: 'External-API health probe rows older than 30 days.',
  },
  {
    // TERMINAL reservations only. A HELD row is live inventory — units removed
    // from a shelf that nobody has returned — and deleting one loses stock with
    // no trace. The order it belonged to is a separate row and is untouched.
    key: 'stockReservations', model: 'stockReservation', dateField: 'createdAt', days: 90,
    extraWhere: { status: { in: ['CONSUMED', 'RELEASED', 'EXPIRED'] } },
    description: 'Settled stock reservations older than 90 days. Never HELD.',
  },
];

/**
 * Deliberately NOT swept, and why.
 *
 * claude.md §26 lists these as unbounded, and they are. Adding a TTL to them is
 * a product or legal decision, not an engineering one, and §26 says as much:
 * never delete legally or financially important records without an explicit
 * policy. Recording the reasoning here so the omission reads as a decision
 * rather than an oversight.
 *
 *   chat_messages,          A farmer's conversation with a seller is THEIR
 *   group_messages,         content and often their only record of what was
 *   direct_messages,        agreed about a price or a delivery. Deleting it on a
 *   ai_messages,            timer is a product promise being quietly withdrawn.
 *   voice_messages          All are already hard-deleted on DPDP erasure.
 *
 *   orders, payments,       Financial records. Retention here is a statutory
 *   settlements             question (books of account), not a storage one.
 *
 *   ai_scan_diagnoses       FastAPI-owned, created outside Prisma, so this sweep
 *                           cannot see it at all. Tracked separately.
 *
 * chat_messages is the one to revisit first if growth becomes a problem — but as
 * archival to object storage, not deletion.
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

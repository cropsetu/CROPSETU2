import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { ENV } from './config/env.js';
import { sendError } from './utils/response.js';
import logger from './utils/logger.js';
import prisma from './config/db.js';
import redis, { getRedisHealth, getRedisMemoryMetrics } from './config/redis.js';
import { getCacheMetrics } from './utils/cacheMetrics.js';
import { rateLimiter, clientIp } from './middleware/rateLimit.js';
import { csrfProtection } from './middleware/csrf.js';

// Routes
import authRoutes          from './routes/auth.routes.js';
import userRoutes          from './routes/user.routes.js';
import agriStoreRoutes     from './routes/agristore.routes.js';
import animalTradeRoutes   from './routes/animaltrade.routes.js';
import communityRoutes     from './routes/community.routes.js';
import cropDiseaseRoutes   from './routes/cropdisease.routes.js';
import cropReportShareRoutes from './routes/cropReportShare.routes.js';
import kendraRoutes        from './routes/kendra.routes.js';
import groupsRoutes        from './routes/groups.routes.js';
import messagesRoutes      from './routes/messages.routes.js';
import uploadRoutes        from './routes/upload.routes.js';
// FarmMind AI + Weather
import aiRoutes            from './routes/ai.routes.js';
import weatherRoutes       from './routes/weather.routes.js';
import marketRoutes        from './routes/market.routes.js';
import plannerRoutes       from './routes/planner.routes.js';
import schemesRoutes       from './routes/schemes.routes.js';
// Rent marketplace
import rentRoutes          from './routes/rent.routes.js';
// Saved delivery addresses
import addressesRoutes     from './routes/addresses.routes.js';
import consentRoutes       from './routes/consent.routes.js';
import incidentRoutes      from './routes/incident.routes.js';
import fraudRoutes         from './routes/fraud.routes.js';
import moderationRoutes    from './routes/moderation.routes.js';
// Admin panel API (users, KYC, catalog, orders, listings, community, AI, CMS,
// broadcast, ops, compliance) — ADMIN-gated + audited (routes/admin/index.js).
import adminRoutes         from './routes/admin/index.js';
import telemetryRoutes     from './routes/telemetry.routes.js';
// ── New AI Services (Phase 1-4) ───────────────────────────────────────────────
import mandiRoutes         from './routes/mandi.routes.js';
import mspRoutes           from './routes/msp.routes.js';
import soilRoutes          from './routes/soil.routes.js';
import loanRoutes          from './routes/loan.routes.js';
import calendarRoutes      from './routes/calendar.routes.js';
import irrigationRoutes    from './routes/irrigation.routes.js';
import inputsRoutes        from './routes/inputs.routes.js';
import cropsRoutes         from './routes/crops.routes.js';
import featuresRoutes      from './routes/features.routes.js';
import agriPredictRoutes   from './routes/agriPredict.routes.js';
// ── Farmer Profile & Multi-Farm Module ────────────────────────────────────────
import onboardingRoutes    from './routes/onboarding.routes.js';
import farmRoutes          from './routes/farm.routes.js';
import farmCropCycleRoutes from './routes/farmCropCycle.routes.js';

const app = express();

// JSON APIs don't benefit from conditional GET; the 304 + empty body trips
// browser-side axios (default validateStatus rejects 3xx) and stale-data bugs.
app.disable('etag');

// ── Trust the reverse proxy ───────────────────────────────────────────────────
// Railway (and any LB) terminate TLS and forward the client via X-Forwarded-For.
// Without this, req.ip is the proxy's address and every client behind it shares
// one rate-limit bucket. With it, Express resolves req.ip from the right-most
// untrusted XFF hop — an address the client CANNOT spoof — so the global per-IP
// limiter actually keys per client and can't be bypassed by forging XFF. Hop
// count is bounded by ENV.TRUST_PROXY (default 1 in prod). MUST be set before the
// rate limiter (and any req.ip consumer) is mounted.
app.set('trust proxy', ENV.TRUST_PROXY);

// ── Request ID for tracing (attach before any other middleware) ───────────────
app.use((req, res, _next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  _next();
});

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────────
// [H1] Never reflect arbitrary origins in production.
// Mobile apps (React Native on device) send no Origin header → always allowed.
// Browser-based clients (admin panel, web) must be listed in ALLOWED_ORIGINS.
// In development with no list set, all origins are allowed for convenience.
//
// The admin SPA is served SAME-ORIGIN from this backend. Its asset requests (Vite
// marks bundles `crossorigin`, so they send an Origin header) and its API calls
// carry THIS service's own origin — which must always be allowed, or the allowlist
// below rejects them with a 500 and the panel white-screens. Railway exposes the
// public host via RAILWAY_PUBLIC_DOMAIN / RAILWAY_STATIC_URL.
const SELF_ORIGINS = new Set(
  [process.env.RAILWAY_PUBLIC_DOMAIN, process.env.RAILWAY_STATIC_URL]
    .filter(Boolean)
    .map((d) => `https://${d}`),
);

app.use(cors({
  origin: (incomingOrigin, callback) => {
    // No Origin header → mobile app / curl / Postman → always allow
    if (!incomingOrigin) return callback(null, true);

    // Same-origin (this service's own public origin) → always allow.
    if (SELF_ORIGINS.has(incomingOrigin)) return callback(null, true);

    // Dev convenience: always allow loopback origins (localhost / 127.0.0.1, any
    // port) so the admin SPA (:5180), Expo web (:8081/:19006) and other local
    // clients work without having to keep ALLOWED_ORIGINS in sync during local
    // dev. Loopback-only + IS_DEV-only, so production is unaffected.
    if (ENV.IS_DEV && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(incomingOrigin)) {
      return callback(null, true);
    }

    if (ENV.ALLOWED_ORIGINS.length) {
      // Explicit allowlist configured — enforce it in all environments
      return ENV.ALLOWED_ORIGINS.includes(incomingOrigin)
        ? callback(null, true)
        : callback(new Error(`CORS: origin "${incomingOrigin}" not allowed`));
    }

    // No allowlist: allow in dev, block browser origins in production
    if (ENV.IS_DEV) return callback(null, true);

    // Production without ALLOWED_ORIGINS set — log warning and block
    logger.warn(`[CORS] Blocked browser origin "${incomingOrigin}" — set ALLOWED_ORIGINS in .env`);
    callback(new Error('CORS: no allowed origins configured'));
  },
  credentials: true,
  // Cache the preflight (Access-Control-Max-Age) so browsers skip the extra
  // OPTIONS round-trip on subsequent cross-origin requests. See ENV.CORS_MAX_AGE.
  maxAge: ENV.CORS_MAX_AGE,
}));

// ── Compression ───────────────────────────────────────────────────────────────
app.use(compression());

// ── Logging ───────────────────────────────────────────────────────────────────
// Morgan MUST be registered BEFORE body parsers.
// body-parser calls next(err) on 413/400, which jumps straight to error
// middleware — skipping every non-error middleware that hasn't run yet.
// If morgan is after body parsers it never registers its res.finish listener
// and multipart requests that are rejected by body-parser appear nowhere in logs.
if (ENV.IS_DEV) app.use(morgan('dev'));
else            app.use(morgan('tiny'));

// ── Body parsing ──────────────────────────────────────────────────────────────
// [H4] Upload route needs up to ~10 MB for base64-encoded images.
//      All other routes only need a few KB — cap tightly to prevent DoS.
//
// IMPORTANT: skip JSON/urlencoded parsing for multipart/form-data requests.
// Those routes use multer, which reads the raw stream itself.  If body-parser
// runs first on a multipart request it may reject with 413 (body > limit)
// before the request reaches the route handler or Morgan.
function skipMultipart(middleware) {
  return (req, res, next) => {
    if ((req.headers['content-type'] || '').startsWith('multipart/')) return next();
    return middleware(req, res, next);
  };
}

const API = ENV.API_PREFIX;
app.use(`${API}/upload`, skipMultipart(express.json({ limit: '10mb' })));
// Multi-image crop scan JSON payload (up to 5 × ~8 MB base64-encoded images).
app.use(`${API}/ai/scan/submit`, skipMultipart(express.json({ limit: '50mb' })));
// In-chat image attach: a single compressed base64 image (~<1 MB). 12mb headroom
// so an attached photo doesn't 413 against the tight global cap below.
app.use(`${API}/ai/chat`, skipMultipart(express.json({ limit: '12mb' })));
// Soil Health Card OCR: a single compressed base64 card photo (~<1 MB). 12mb
// headroom so the image doesn't 413 against the tight global cap below.
app.use(`${API}/ai/soil-card-ocr`, skipMultipart(express.json({ limit: '12mb' })));
app.use(skipMultipart(express.json({ limit: '100kb' })));
app.use(skipMultipart(express.urlencoded({ extended: true, limit: '100kb' })));

// ── Health probes ─────────────────────────────────────────────────────────────
// /healthz — liveness. Returns 200 as long as the process is alive.
//            Does NOT touch any dependency. Configure as Kubernetes
//            livenessProbe / Railway healthcheck-restart-on-fail target.
// /readyz  — readiness. Checks DB (required) and Redis (optional). Returns
//            503 when degraded so the LB can stop routing traffic to this
//            instance until it recovers.
// /health  — kept as an alias of /healthz for backward compatibility with the
//            existing Railway healthcheck path; remove once the Railway
//            config has been migrated.
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
app.get('/health',  (_req, res) => res.json({ status: 'ok' }));

app.get('/readyz', async (_req, res) => {
  const checks = {};
  let ready = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = 'ok';
  } catch (err) {
    checks.db = 'down';
    ready = false;
    logger.warn({ err: err?.message }, '[readyz] DB check failed');
  }

  // Redis is OPTIONAL for readiness: a Redis outage must NOT pull every instance
  // out of the load balancer (that would turn a cache outage into a full outage).
  // We surface its REAL health (CACHE-9) so monitoring/alerting can act on it,
  // without flipping `ready` to false. The healthy→down transition already fires a
  // loud [ALERT][Redis] log from the client wrapper (see config/redis.js).
  const rh = getRedisHealth();
  try {
    if (rh.healthy) {
      await redis.ping();
      checks.redis = 'ok';
    } else {
      // Distinguish "down" (was connected, now lost) from "connecting"/"not yet
      // up" so dashboards can tell a real outage from a cold start.
      checks.redis = rh.everReady ? 'down' : 'connecting';
    }
  } catch {
    checks.redis = 'down';
  }

  // Expose health + cache + memory as lightweight metrics for scrapers/alerting
  // (dashboards show hit rate and memory; OPS-4 alerts on low hit rate / high
  // memory). NOTE: /readyz is public (mounted before auth) — only non-sensitive
  // numbers here; the raw Redis error string is kept server-side (the [ALERT][Redis]
  // log). Memory comes from a throttled snapshot, so this never issues an INFO per
  // healthcheck; cache counters are in-process and free to read.
  const mem = getRedisMemoryMetrics();
  const cache = getCacheMetrics();
  const metrics = {
    redis_healthy:               rh.healthy ? 1 : 0,
    redis_down_ms:               rh.downForMs ?? 0,
    redis_status:                rh.status,
    redis_used_memory_bytes:     mem.used_memory ?? 0,
    redis_used_memory_rss_bytes: mem.used_memory_rss ?? 0,
    redis_maxmemory_bytes:       mem.maxmemory ?? 0,
    redis_used_memory_pct:       mem.used_memory_pct ?? 0,
    redis_mem_fragmentation:     mem.frag_ratio ?? 0,
    cache_hits:                  cache.hits,
    cache_misses:                cache.misses,
    cache_hit_rate:              cache.hitRate ?? 0,
  };

  res.status(ready ? 200 : 503).json({ ready, checks, metrics, cacheBySource: cache.bySource });
});

// ── Admin SPA (same-origin) ───────────────────────────────────────────────────
// When the built admin panel (admin/dist) is present, serve it at /admin from the
// SAME origin as the API. Same-origin keeps the auth cookies (httpOnly refresh +
// CSRF, both SameSite=Lax) first-party, so login + silent refresh "just work" with
// no CORS and no SameSite=None weakening — the admin client calls /api/v1/* here.
//
// Mounted BEFORE the rate limiter / body parser / CSRF guard: these are static GET
// asset loads (a page pulls many hashed files) that must not be throttled or parsed.
// The /admin path is disjoint from the /api/v1/admin API mounted below — no overlap.
// Skipped entirely when the dist folder is absent (e.g. local dev, where the admin
// runs on its own Vite server) so the API boots normally without it.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_DIST_DIR = process.env.ADMIN_DIST_DIR
  ? path.resolve(process.env.ADMIN_DIST_DIR)
  : path.resolve(__dirname, '../../admin/dist');

if (fs.existsSync(path.join(ADMIN_DIST_DIR, 'index.html'))) {
  const sendAdminIndex = (_req, res) => {
    res.set('Cache-Control', 'no-cache'); // always revalidate the HTML shell
    res.sendFile(path.join(ADMIN_DIST_DIR, 'index.html'));
  };
  // Hashed asset files (immutable) → long cache; index.html → no-cache (handled above).
  app.use('/admin', express.static(ADMIN_DIST_DIR, { index: false, maxAge: '1y' }));
  // SPA fallback: client-side routes (e.g. /admin/users) resolve to the shell.
  app.get('/admin', sendAdminIndex);
  app.get('/admin/*', sendAdminIndex);
  logger.info('[Admin] Serving admin SPA from %s at /admin', ADMIN_DIST_DIR);
}

// ── Kendra SPA (same-origin) ──────────────────────────────────────────────────
// The dedicated Krushi Seva Kendra onboarding website (kendra/dist) is served at
// /kendra from the SAME origin as the API — same rationale as the admin SPA above
// (first-party auth cookies, no CORS). The /kendra path is disjoint from the
// /api/v1/kendra API mounted below. Skipped when the dist folder is absent (local
// dev runs the Kendra app on its own Vite server at :5181).
const KENDRA_DIST_DIR = process.env.KENDRA_DIST_DIR
  ? path.resolve(process.env.KENDRA_DIST_DIR)
  : path.resolve(__dirname, '../../kendra/dist');

if (fs.existsSync(path.join(KENDRA_DIST_DIR, 'index.html'))) {
  const sendKendraIndex = (_req, res) => {
    res.set('Cache-Control', 'no-cache'); // always revalidate the HTML shell
    res.sendFile(path.join(KENDRA_DIST_DIR, 'index.html'));
  };
  app.use('/kendra', express.static(KENDRA_DIST_DIR, { index: false, maxAge: '1y' }));
  app.get('/kendra', sendKendraIndex);
  app.get('/kendra/*', sendKendraIndex);
  logger.info('[Kendra] Serving Kendra SPA from %s at /kendra', KENDRA_DIST_DIR);
}

// ── Global per-IP rate limit ──────────────────────────────────────────────────
// Baseline brute-force / DDoS protection for every API route. Mounted AFTER the
// health probes (so LB liveness/readiness checks are never throttled) and BEFORE
// the routers. Redis-backed sliding window, shared across instances, with an
// in-memory fallback when Redis is down. Stricter per-route limiters (e.g. the
// OTP send limits in auth.routes.js) stack on top of this baseline.
if (ENV.RATE_LIMIT_ENABLED) {
  app.use(rateLimiter({
    windowMs: ENV.RATE_LIMIT_WINDOW_MS,
    max:      ENV.RATE_LIMIT_MAX,
    prefix:   'global:ip',
    key:      clientIp,
    message:  'Too many requests. Please slow down and try again shortly.',
  }));
  logger.info('[RateLimit] Global per-IP limiter enabled — %d req / %d s',
    ENV.RATE_LIMIT_MAX, Math.round(ENV.RATE_LIMIT_WINDOW_MS / 1000));
}

// ── CSRF protection ───────────────────────────────────────────────────────────
// Double-submit guard for cookie-authenticated mutations (web). No-op for
// Bearer / mobile / pre-auth requests. See middleware/csrf.js.
app.use(csrfProtection);

// ── API Routes ────────────────────────────────────────────────────────────────
app.use(`${API}/auth`,         authRoutes);
app.use(`${API}/users`,        userRoutes);
app.use(`${API}/agristore`,    agriStoreRoutes);
app.use(`${API}/animals`,      animalTradeRoutes);
app.use(`${API}/community`,    communityRoutes);
app.use(`${API}/crop-disease`, cropDiseaseRoutes);
app.use(`${API}/crop-reports`, cropReportShareRoutes);
app.use(`${API}/kendra`,       kendraRoutes);
app.use(`${API}/groups`,       groupsRoutes);
app.use(`${API}/messages`,     messagesRoutes);
app.use(`${API}/upload`,       uploadRoutes);
app.use(`${API}/rent`,         rentRoutes);
// FarmMind AI + Weather
app.use(`${API}/ai`,           aiRoutes);
app.use(`${API}/weather`,      weatherRoutes);
app.use(`${API}/market`,       marketRoutes);
app.use(`${API}/planner`,      plannerRoutes);
app.use(`${API}/schemes`,      schemesRoutes);
app.use(`${API}/addresses`,    addressesRoutes);
app.use(`${API}/consent`,      consentRoutes);
app.use(`${API}/admin/incidents`, incidentRoutes);
app.use(`${API}/admin/fraud`,  fraudRoutes);
app.use(`${API}/admin/moderation`, moderationRoutes);
app.use(`${API}/telemetry`,    telemetryRoutes);

// ── New AI Services ───────────────────────────────────────────────────────────
app.use(`${API}/mandi`,      mandiRoutes);
app.use(`${API}/msp`,        mspRoutes);
app.use(`${API}/soil`,       soilRoutes);
app.use(`${API}/loan`,       loanRoutes);
app.use(`${API}/calendar`,   calendarRoutes);
app.use(`${API}/irrigation`, irrigationRoutes);
app.use(`${API}/inputs`,     inputsRoutes);
app.use(`${API}/crops`,      cropsRoutes);
app.use(`${API}/admin`,      featuresRoutes);
// Mounted AFTER the specific admin routers (incidents/fraud/moderation/features)
// so their paths win; this fills the rest of /admin/* (disjoint sub-paths).
app.use(`${API}/admin`,      adminRoutes);
app.use(`${API}/agripredict`, agriPredictRoutes);

// ── Farmer Profile & Multi-Farm Module ───────────────────────────────────────
app.use(`${API}/onboarding`, onboardingRoutes);
app.use(`${API}/farms`,      farmRoutes);
app.use(`${API}`,            farmCropCycleRoutes);  // mounts /farms/:farmId/cycles + /cycles/:cycleId

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => sendError(res, `Route ${req.method} ${req.path} not found`, 404));

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  logger.error({ err, requestId: req.id, path: req.path }, '[Server Error]');
  // [FIX #22] Never leak internal error details (Prisma, SQL, etc.) even in dev.
  // err.message may contain DB schema info, query details, or stack traces.
  const safeMessage = err.expose ? err.message : 'Internal server error';
  sendError(res, safeMessage, err.status || 500);

  // BEST-EFFORT: persist the error to ErrorLog for the admin Ops viewer. This runs
  // AFTER the response is sent and is fully wrapped — a failed insert (table
  // missing, DB down, bad payload) must never throw or block the response.
  try {
    prisma.errorLog
      .create({
        data: {
          source: req.path || 'unknown',
          severity: (err.status || 500) >= 500 ? 'error' : 'warn',
          message: String(err?.message || 'Internal server error').slice(0, 2000),
          stack: err?.stack ? String(err.stack).slice(0, 8000) : null,
          context: { method: req.method, status: err.status || 500, requestId: req.id ?? null },
        },
      })
      .catch(() => {});
  } catch {
    /* never throw from the error handler */
  }
});

export default app;
// dev reload trigger — picks up RATE_LIMIT_ENABLED=false from .env on restart

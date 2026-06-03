import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import crypto from 'crypto';

import { ENV } from './config/env.js';
import { sendError } from './utils/response.js';
import logger from './utils/logger.js';
import prisma from './config/db.js';
import redis from './config/redis.js';
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
app.use(cors({
  origin: (incomingOrigin, callback) => {
    // No Origin header → mobile app / curl / Postman → always allow
    if (!incomingOrigin) return callback(null, true);

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

  try {
    if (redis?.status === 'ready') {
      await redis.ping();
      checks.redis = 'ok';
    } else {
      // Redis is optional in dev; don't fail readiness if it just isn't
      // connected yet.
      checks.redis = 'degraded';
    }
  } catch {
    checks.redis = 'down';
    // Redis being down is degraded but not unready — features that depend
    // on Redis (cross-instance rate limit, Socket.IO adapter) will fall
    // back to in-memory mode.
  }

  res.status(ready ? 200 : 503).json({ ready, checks });
});

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
});

export default app;

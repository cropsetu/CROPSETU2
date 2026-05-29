import 'dotenv/config';
import http from 'http';
import cron from 'node-cron';
import { Server as SocketIO } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

import app from './app.js';
import { ENV } from './config/env.js';
import prisma from './config/db.js';
import redis from './config/redis.js';
import { registerChatSocket } from './socket/chat.socket.js';
import { seedDefaultFlags } from './services/featureFlag.service.js';
import logger from './utils/logger.js';

// ── Startup config validation ─────────────────────────────────────────────────
const OPTIONAL_KEYS = [
  ['MSG91_AUTH_KEY',       'OTP delivery via MSG91'],
  ['CLOUDINARY_CLOUD_NAME','Image uploads'],
  ['GEMINI_API_KEY',       'AI crop diagnosis (Gemini)'],
  ['GROQ_API_KEY',         'FarmMind chat + treatment (Groq)'],
  ['SARVAM_API_KEY',       'Voice / multilingual (Sarvam)'],
  ['DATA_GOV_API_KEY',     'Mandi market prices'],
];
for (const [key, feature] of OPTIONAL_KEYS) {
  if (!process.env[key]) {
    logger.warn('[Config] %s not set — %s will be disabled', key, feature);
  }
}

const httpServer = http.createServer(app);

// ── HTTP server timeouts ──────────────────────────────────────────────────────
// Default Node has no timeout (0) which lets Slowloris and stuck downstreams
// pile up open connections. keepAlive must exceed the LB's idle timeout
// (Railway: 60 s) to avoid 502s under keepalive races; headersTimeout must
// exceed keepAliveTimeout per Node docs.
httpServer.timeout          = 30_000;
httpServer.keepAliveTimeout = 65_000;
httpServer.headersTimeout   = 70_000;

// ── Socket.io ─────────────────────────────────────────────────────────────────
// Mobile (RN) clients send no Origin header → always allowed.
// Browser clients must be in ENV.ALLOWED_ORIGINS. The `*` + credentials
// combination is forbidden by spec, so we never reflect a wildcard here.
const io = new SocketIO(httpServer, {
  cors: {
    origin: (incomingOrigin, callback) => {
      if (!incomingOrigin) return callback(null, true);          // mobile / curl
      if (ENV.ALLOWED_ORIGINS.length) {
        return ENV.ALLOWED_ORIGINS.includes(incomingOrigin)
          ? callback(null, true)
          : callback(new Error(`Socket.IO CORS: origin "${incomingOrigin}" not allowed`));
      }
      if (ENV.IS_DEV) return callback(null, true);                // dev permissive
      logger.warn(`[Socket.IO CORS] Blocked origin "${incomingOrigin}" — set ALLOWED_ORIGINS`);
      callback(new Error('Socket.IO CORS: no allowed origins configured'));
    },
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// ── Redis Pub/Sub adapter (enables multi-instance scaling + reliable delivery)
// Falls back to in-memory adapter automatically if Redis is unavailable.
// For single-instance demo deployments, Redis is not required.
try {
  const pubClient = new Redis(ENV.REDIS_URL, { lazyConnect: true, retryStrategy: () => null });
  const subClient = pubClient.duplicate();
  pubClient.on('error', () => {});
  subClient.on('error', () => {});
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  logger.info('[Socket.IO] Redis adapter attached');
} catch {
  logger.warn('[Socket.IO] Redis unavailable — using in-memory adapter (single-instance mode)');
}

registerChatSocket(io);

// Expose io to Express route handlers via `req.app.get('io')` so HTTP-sent
// chat messages can be broadcast on the socket bus for real-time delivery.
app.set('io', io);

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await prisma.$connect();
    logger.info('[DB] PostgreSQL connected');

    // Seed default feature flags (no-op if already seeded)
    await seedDefaultFlags().catch(e => logger.warn('[FeatureFlags] Seed skipped: %s', e.message));

    try {
      await redis.connect();
      logger.info('[Redis] Connected');
    } catch {
      logger.warn('[Redis] Not available — continuing without cache (dev mode)');
    }

    httpServer.listen(ENV.PORT, () => {
      logger.info('[Server] FarmEasy API running on http://localhost:%d%s', ENV.PORT, ENV.API_PREFIX);
      logger.info('[Server] Environment: %s', ENV.NODE_ENV);
    });

    // ── AgriPredict cron jobs ───────────────────────────────────────────────
    const AI_BASE = ENV.AI_BACKEND_URL || 'http://localhost:8001';

    // Helper: fire a single sync trigger (non-blocking)
    async function triggerMandiSync(commodity, state, maxPages = 3) {
      return fetch(`${AI_BASE}/agripredict/sync/trigger`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ commodity, state, district: null, max_pages: maxPages }),
        signal:  AbortSignal.timeout(8_000),
      }).catch(e => logger.warn('[AgriPredict] Sync trigger %s/%s failed: %s', commodity, state, e.message));
    }

    // ── Startup auto-seed: if mandi_prices table is empty, seed top combos ──
    const mandiCount = await prisma.mandiPrice.count().catch(() => 0);
    if (mandiCount === 0) {
      logger.info('[AgriPredict] DB empty — seeding top commodity/state combos at startup');
      const SEED_COMBOS = [
        ...['Tomato','Onion','Potato'].flatMap(c =>
          ['Maharashtra','Madhya Pradesh','Karnataka','Andhra Pradesh','Uttar Pradesh'].map(s => ({ commodity: c, state: s }))
        ),
        ...['Wheat','Bajra'].flatMap(c =>
          ['Punjab','Haryana','Uttar Pradesh','Rajasthan','Madhya Pradesh'].map(s => ({ commodity: c, state: s }))
        ),
        ...['Soyabean','Cotton'].flatMap(c =>
          ['Maharashtra','Madhya Pradesh','Gujarat','Rajasthan','Telangana'].map(s => ({ commodity: c, state: s }))
        ),
        ...['Rice'].flatMap(c =>
          ['West Bengal','Andhra Pradesh','Tamil Nadu','Punjab','Uttar Pradesh'].map(s => ({ commodity: c, state: s }))
        ),
        ...['Maize','Gram','Arhar/Tur'].flatMap(c =>
          ['Karnataka','Madhya Pradesh','Maharashtra','Uttar Pradesh'].map(s => ({ commodity: c, state: s }))
        ),
      ];
      // Fire in parallel batches of 10 (avoid overwhelming FastAPI with 50+ concurrent requests)
      const BATCH_SIZE = 10;
      for (let i = 0; i < SEED_COMBOS.length; i += BATCH_SIZE) {
        const batch = SEED_COMBOS.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(batch.map(({ commodity, state }) => triggerMandiSync(commodity, state, 5)));
      }
      logger.info('[AgriPredict] Startup seed: %d sync jobs queued', SEED_COMBOS.length);
    } else {
      logger.info('[AgriPredict] DB has %d mandi price records — skipping startup seed', mandiCount);
    }

    // Daily at 6:00 AM IST (00:30 UTC) — refresh all 15 agricultural states × top 5 crops
    cron.schedule('30 0 * * *', async () => {
      logger.info('[AgriPredict] Daily sync started → FastAPI');
      const DAILY_COMBOS = [
        ...['Tomato','Onion','Potato','Wheat','Soyabean'].flatMap(c =>
          ['Maharashtra','Punjab','Madhya Pradesh','Uttar Pradesh','Karnataka',
           'Andhra Pradesh','Rajasthan','Gujarat','Telangana','Tamil Nadu',
           'Bihar','West Bengal','Haryana','Odisha','Chhattisgarh'].map(s => ({ commodity: c, state: s }))
        ),
      ];
      // Batch to avoid flooding FastAPI
      const BATCH_SIZE = 10;
      for (let i = 0; i < DAILY_COMBOS.length; i += BATCH_SIZE) {
        const batch = DAILY_COMBOS.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(batch.map(({ commodity, state }) => triggerMandiSync(commodity, state, 2)));
      }
      logger.info('[AgriPredict] Daily sync: %d triggers sent to FastAPI', DAILY_COMBOS.length);
    });

    // 1st of every month at 1:00 AM UTC — purge expired prediction caches
    cron.schedule('0 1 1 * *', async () => {
      logger.info('[AgriPredict] Monthly cache expiry check');
      const expired = await prisma.predictionCache.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      logger.info('[AgriPredict] Deleted %d expired prediction caches', expired.count);
    });

    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error('[Server] Port %d already in use. Run: kill -9 $(lsof -ti :%d)', ENV.PORT, ENV.PORT);
        process.exit(1);
      } else {
        throw err;
      }
    });
  } catch (err) {
    logger.error({ err }, '[Server] Startup failed');
    process.exit(1);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info('[Server] %s received — shutting down gracefully', signal);

  // Force exit after 10s if cleanup hangs (e.g. stuck DB connection)
  const forceTimer = setTimeout(() => {
    logger.error('[Server] Shutdown timed out after 10s — forcing exit');
    process.exit(1);
  }, 10_000).unref();

  httpServer.close(async () => {
    await Promise.allSettled([
      prisma.$disconnect(),
      redis.quit().catch(() => {}),
    ]);
    clearTimeout(forceTimer);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Prevent unhandled async errors from crashing the process.
// Express 4 cannot catch async errors in route handlers that lack try/catch.
// This is the safety net — individual handlers should still use try/catch.
process.on('unhandledRejection', (reason, promise) => {
  logger.error('[Server] Unhandled promise rejection — %s', reason?.message || reason);
  logger.error({ reason }, '[Server] Stack:');
  // Do NOT exit — keep the server running to serve other requests
});

start();

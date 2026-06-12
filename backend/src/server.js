import 'dotenv/config';
import http from 'http';
import cron from 'node-cron';
import { Server as SocketIO } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

import app from './app.js';
import { ENV } from './config/env.js';
import prisma from './config/db.js';
import redis, { beginRedisShutdown, getRedisMemoryMetrics } from './config/redis.js';
import { registerChatSocket } from './socket/chat.socket.js';
import { seedDefaultFlags, initFlagInvalidationSubscriber, stopFlagInvalidationSubscriber } from './services/featureFlag.service.js';
import { warmAllCaches } from './services/cacheWarmer.service.js';
import { checkCacheAlerts } from './utils/cacheMetrics.js';
import { runRetentionSweep } from './services/retention.service.js';
import { refreshActiveSellerStats } from './services/sellerStats.service.js';
import { withLeaderLock } from './utils/leaderLock.js';
import { startWorkers, stopWorkers } from './queue/worker.js';
import { closeQueues } from './queue/jobQueue.js';
import { closeProducerConnection } from './queue/connection.js';
import logger from './utils/logger.js';

// ── Startup config validation ─────────────────────────────────────────────────
const OPTIONAL_KEYS = [
  ['MSG91_AUTH_KEY',       'OTP delivery via MSG91'],
  ['CLOUDINARY_CLOUD_NAME','Image uploads'],
  ['GEMINI_API_KEY',       'All LLM features: crop diagnosis, chat, alerts, pest (Gemini)'],
  ['SARVAM_API_KEY',       'Voice STT/TTS + multilingual (Sarvam)'],
  ['DATA_GOV_API_KEY',     'Mandi market prices'],
];
for (const [key, feature] of OPTIONAL_KEYS) {
  if (!process.env[key]) {
    logger.warn('[Config] %s not set — %s will be disabled', key, feature);
  }
}

const httpServer = http.createServer(app);

// In-process BullMQ workers (started after listen; closed on shutdown). Empty
// when QUEUE_INPROCESS_WORKER=false — jobs are then handled by `npm run worker`.
let inProcessWorkers = [];

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
let pubClient, subClient;
try {
  // family: 0 → resolve IPv6 too (Railway private networking is IPv6-only).
  pubClient = new Redis(ENV.REDIS_URL, { lazyConnect: true, retryStrategy: () => null, connectTimeout: 5000, family: 0 });
  subClient = pubClient.duplicate();
  pubClient.on('error', () => {});
  subClient.on('error', () => {});
  // Hard cap the connect. This is a TOP-LEVEL await: if it hangs (e.g. Redis not
  // reachable at boot) it blocks the whole ESM module from finishing, so
  // httpServer.listen never runs and the deploy healthcheck fails with no logs.
  // The race guarantees we always fall through to the in-memory adapter.
  await Promise.race([
    Promise.all([pubClient.connect(), subClient.connect()]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('connect timed out')), 5000)),
  ]);
  io.adapter(createAdapter(pubClient, subClient));
  logger.info('[Socket.IO] Redis adapter attached');
} catch (err) {
  pubClient?.disconnect();
  subClient?.disconnect();
  // logger.warn is suppressed in production here (see config/redis.js), so log at
  // info to keep the fallback visible in prod logs.
  logger.info('[Socket.IO] Redis adapter unavailable — using in-memory adapter (%s)', err?.message || 'no redis');
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

    // Connect the shared cache client in the BACKGROUND. Redis is optional for
    // liveness (commands fail-open while it's down) and the client retries forever
    // via its retryStrategy, so we must NOT await it here — a slow/unreachable
    // Redis at boot would otherwise block httpServer.listen and fail the deploy
    // healthcheck. It logs once it connects (or keeps retrying quietly).
    redis.connect()
      .then(() => logger.info('[Redis] Connected'))
      .catch((e) => logger.info('[Redis] Not available at boot — retrying in background (%s)', e?.message || e));

    // Subscribe for cross-instance feature-flag invalidations (no-op if Redis is
    // down — flags then converge via the in-process TTL). Not awaited for the same
    // reason: its subscriber connection retries forever and must not gate startup.
    initFlagInvalidationSubscriber();

    httpServer.listen(ENV.PORT, () => {
      logger.info('[Server] FarmEasy API running on http://localhost:%d%s', ENV.PORT, ENV.API_PREFIX);
      logger.info('[Server] Environment: %s', ENV.NODE_ENV);
    });

    // ── Job queue workers (in-process) ──────────────────────────────────────
    // Process queued heavy work (notification delivery, etc.) in this process so
    // a single-service deploy needs no extra infra. Disable with
    // QUEUE_INPROCESS_WORKER=false and run `npm run worker` to scale separately.
    if (ENV.QUEUE_ENABLED && ENV.QUEUE_INPROCESS_WORKER) {
      inProcessWorkers = startWorkers();
    }

    // ── Cache warming ───────────────────────────────────────────────────────
    // Preload the hottest mandi-price keys so the first post-deploy user hits a
    // warm cache instead of paying the cold Groq latency. Fired right after
    // listen and NON-BLOCKING so it never delays readiness; warming completes
    // within seconds, and the single-flight guard means a user racing in during
    // the warm window still triggers only one recompute. A scheduled re-warm
    // (just under the 30-min cache TTL) keeps hot keys from lapsing to cold
    // during quiet periods.
    if (ENV.CACHE_WARMING_ENABLED) {
      warmAllCaches().catch(e => logger.warn('[CacheWarm] startup warm failed: %s', e.message));
      cron.schedule('*/25 * * * *', () => {
        warmAllCaches().catch(e => logger.warn('[CacheWarm] scheduled warm failed: %s', e.message));
      });
    }

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
    // Leader-locked so that when several instances boot against an empty DB only
    // ONE fires the seed sync triggers (others would each fan out 50 requests to
    // FastAPI on the same empty table). Short TTL — this is a one-shot boot job.
    const mandiCount = await prisma.mandiPrice.count().catch(() => 0);
    if (mandiCount === 0) {
      await withLeaderLock('mandi-startup-seed', async () => {
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
      }, { ttlMs: 10 * 60 * 1000 });
    } else {
      logger.info('[AgriPredict] DB has %d mandi price records — skipping startup seed', mandiCount);
    }

    // Daily at 6:00 AM IST (00:30 UTC) — refresh all 15 agricultural states × top 5 crops.
    // Leader-locked: only one instance fans the ~75 sync triggers out to FastAPI per day.
    cron.schedule('30 0 * * *', () => withLeaderLock('mandi-daily-sync', async () => {
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
    }));

    // 1st of every month at 1:00 AM UTC — purge expired prediction caches.
    // Leader-locked so a single instance issues the DELETE (others would race the same rows).
    cron.schedule('0 1 1 * *', () => withLeaderLock('prediction-cache-purge', async () => {
      logger.info('[AgriPredict] Monthly cache expiry check');
      const expired = await prisma.predictionCache.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      logger.info('[AgriPredict] Deleted %d expired prediction caches', expired.count);
    }));

    // ── Cache observability alerting ────────────────────────────────────────
    // Every 5 min, evaluate the windowed cache hit rate + Redis memory and emit a
    // loud [ALERT] log if either breaches its threshold (see utils/cacheMetrics.js).
    // Metrics themselves are scraped from /readyz; this is the alerting half.
    cron.schedule('*/5 * * * *', () => {
      try {
        checkCacheAlerts({
          hitRateFloor: ENV.CACHE_HIT_RATE_ALERT_THRESHOLD,
          memPctCeil:   ENV.REDIS_MEMORY_ALERT_PCT,
          memPct:       getRedisMemoryMetrics().used_memory_pct,
        });
      } catch (err) { logger.warn('[CacheMetrics] alert check failed: %s', err.message); }
    });

    // ── Seller dashboard stats rollup refresh (CACHE-6) ─────────────────────
    // Every 5 min, re-warm the precomputed seller-stats rollups for sellers who
    // recently loaded their dashboard, so those reads keep hitting precomputed
    // aggregates instead of re-running the ever-growing revenue SUM per load.
    // Leader-locked so a single instance does the recompute fan-out per tick;
    // refreshing slightly more often than the 10-min cache TTL keeps entries warm.
    cron.schedule('*/5 * * * *', () => withLeaderLock('seller-stats-refresh', async () => {
      try {
        const result = await refreshActiveSellerStats();
        if (result.refreshed) logger.info({ ...result }, '[SellerStats] rollup refresh complete');
      } catch (err) { logger.warn('[SellerStats] rollup refresh failed: %s', err.message); }
    }));

    // ── Data-retention sweep (DPDP minimisation) ────────────────────────────
    // Daily at 2:30 AM UTC — purge transient/log data past its retention window
    // (OTP sessions, expired tokens, old notifications, voice transcripts, AI
    // usage logs, aged audit logs). See constants/retention.js for the policy.
    // Leader-locked so a single instance runs the cross-table purge per day
    // (the deletes are idempotent, but coordinating avoids N instances racing them).
    cron.schedule('30 2 * * *', () => withLeaderLock('retention-sweep', async () => {
      try {
        const purged = await runRetentionSweep();
        logger.info({ purged }, '[Retention] Daily sweep complete');
      } catch (err) {
        logger.error({ err }, '[Retention] Daily sweep failed');
      }
    }));

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
    // Drain in-flight jobs and close queue connections before the shared client.
    await stopWorkers(inProcessWorkers);
    await closeQueues();
    await closeProducerConnection();
    beginRedisShutdown(); // suppress the close/end outage alert for this intentional quit
    await Promise.allSettled([
      stopFlagInvalidationSubscriber(),
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

/**
 * Admin dashboard metrics — KPI roll-ups + daily time-series.
 *
 * All figures are READ-ONLY aggregates over existing models (no new tables).
 * Heavy sums use Prisma aggregate/groupBy; the time-series use a single
 * date_trunc GROUP BY each (index-assisted by the createdAt indexes), bounded by
 * the requested window so the dashboard stays cheap on large tables.
 */
import prisma from '../config/db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function sinceDays(days) {
  const n = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30;
  return new Date(Date.now() - n * DAY_MS);
}

/** KPI snapshot for the dashboard cards. `days` scopes the "new/active/window" figures. */
export async function getDashboardMetrics({ days = 30 } = {}) {
  const since = sinceDays(days);

  const [
    usersTotal, usersActive, usersNew, usersByRole, usersByKyc,
    ordersAgg, ordersWindowAgg, ordersByStatus,
    bookingsTotal, bookingsByStatus,
    aiAgg, reportsTotal,
    moderationPending, incidentsOpen, breachOverdue,
    apiHealth,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { lastActiveAt: { gte: since } } }),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    prisma.user.groupBy({ by: ['kycStatus'], _count: { _all: true } }),
    prisma.order.aggregate({
      _count: { _all: true },
      _sum: { totalAmount: true },
      where: { status: { notIn: ['CANCELLED', 'REFUNDED'] } },
    }),
    prisma.order.aggregate({
      _count: { _all: true },
      _sum: { totalAmount: true },
      where: { createdAt: { gte: since }, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
    }),
    prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.booking.count(),
    prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.aIUsage.aggregate({
      _sum: { scanCount: true, chatCount: true, totalTokens: true, totalCostUsd: true },
      where: { date: { gte: since } },
    }),
    prisma.cropDiseaseReport.count({ where: { createdAt: { gte: since } } }),
    prisma.contentFlag.count({ where: { status: 'PENDING' } }),
    prisma.securityIncident.count({ where: { status: { in: ['OPEN', 'INVESTIGATING', 'CONTAINED'] } } }),
    prisma.securityIncident.count({
      where: { notificationRequired: true, boardNotifiedAt: null, notifyDueAt: { lt: new Date() } },
    }),
    apiHealthSummary(24),
  ]);

  return {
    windowDays: Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30,
    users: {
      total: usersTotal,
      active: usersActive,
      new: usersNew,
      byRole: countMap(usersByRole, 'role'),
      byKyc: countMap(usersByKyc, 'kycStatus'),
    },
    orders: {
      total: ordersAgg._count._all,
      gmv: ordersAgg._sum.totalAmount ?? 0,
      newInWindow: ordersWindowAgg._count._all,
      gmvInWindow: ordersWindowAgg._sum.totalAmount ?? 0,
      byStatus: countMap(ordersByStatus, 'status'),
    },
    bookings: { total: bookingsTotal, byStatus: countMap(bookingsByStatus, 'status') },
    ai: {
      scans: aiAgg._sum.scanCount ?? 0,
      chats: aiAgg._sum.chatCount ?? 0,
      tokens: aiAgg._sum.totalTokens ?? 0,
      costUsd: aiAgg._sum.totalCostUsd ?? 0,
      reports: reportsTotal,
    },
    trustSafety: {
      moderationPending,
      incidentsOpen,
      breachOverdue,
    },
    apiHealth,
  };
}

function countMap(rows, key) {
  const out = {};
  for (const r of rows) out[r[key]] = r._count._all;
  return out;
}

/** Daily time-series for a single whitelisted metric over `days`. */
export async function getTimeseries({ metric = 'signups', days = 30 } = {}) {
  const since = sinceDays(days);
  switch (metric) {
    case 'signups': {
      const rows = await prisma.$queryRaw`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date, COUNT(*)::int AS value
        FROM "users" WHERE "createdAt" >= ${since}
        GROUP BY 1 ORDER BY 1`;
      return rows.map((r) => ({ date: r.date, value: Number(r.value) }));
    }
    case 'gmv': {
      const rows = await prisma.$queryRaw`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
               COALESCE(SUM("totalAmount"), 0)::float AS value
        FROM "orders"
        WHERE "createdAt" >= ${since} AND "status" NOT IN ('CANCELLED','REFUNDED')
        GROUP BY 1 ORDER BY 1`;
      return rows.map((r) => ({ date: r.date, value: Number(r.value) }));
    }
    case 'ai_tokens': {
      const rows = await prisma.$queryRaw`
        SELECT to_char("date", 'YYYY-MM-DD') AS date, COALESCE(SUM("totalTokens"), 0)::int AS value
        FROM "ai_usage" WHERE "date" >= ${since}
        GROUP BY 1 ORDER BY 1`;
      return rows.map((r) => ({ date: r.date, value: Number(r.value) }));
    }
    case 'ai_cost': {
      const rows = await prisma.$queryRaw`
        SELECT to_char("date", 'YYYY-MM-DD') AS date, COALESCE(SUM("totalCostUsd"), 0)::float AS value
        FROM "ai_usage" WHERE "date" >= ${since}
        GROUP BY 1 ORDER BY 1`;
      return rows.map((r) => ({ date: r.date, value: Number(r.value) }));
    }
    default:
      throw Object.assign(new Error(`Unknown metric "${metric}"`), { statusCode: 400, expose: true });
  }
}

/** Summarise APIHealthLog by source over the last `hours`. Mirrors features.routes. */
export async function apiHealthSummary(hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const logs = await prisma.aPIHealthLog.findMany({
    where: { timestamp: { gte: since } },
    orderBy: { timestamp: 'desc' },
    take: 1000,
    select: { source: true, status: true, responseTimeMs: true },
  });
  const summary = {};
  for (const log of logs) {
    const s = (summary[log.source] ??= { success: 0, failure: 0, timeout: 0, rate_limited: 0, total: 0, _ms: 0 });
    s[log.status] = (s[log.status] || 0) + 1;
    s.total++;
    if (log.responseTimeMs) s._ms += log.responseTimeMs;
  }
  for (const s of Object.values(summary)) {
    s.avgMs = s.total ? Math.round(s._ms / s.total) : 0;
    s.successRate = s.total ? Math.round((s.success / s.total) * 100) : 0;
    delete s._ms;
  }
  return summary;
}

/**
 * System Status — the "is everything healthy RIGHT NOW" page.
 *
 * Every other admin surface is historical: the dashboard is a 30-day roll-up, API
 * Health is a 24h table, AI usage is 7/30/90-day. None of them answer the question
 * you actually have during an incident, and none of them could even tell you
 * whether the AI service was reachable.
 *
 * Backed by GET /admin/ops/status, which probes Postgres, Redis, the FastAPI AI
 * service (via its signed /health/details), the job queues, month-to-date AI spend
 * and the 15-minute error count — each independently wrapped, so one dead
 * dependency shows as a red light instead of blanking the page.
 *
 * Polls every 10s AND keeps polling on a background tab (refetchIntervalInBackground),
 * because a status board left on a second monitor that silently freezes is worse
 * than no status board. The "updated Ns ago" stamp makes staleness visible either way.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, errorMessage } from '../lib/api';
import { PageHeader, Card, Badge, Spinner, ErrorState } from '../components/ui';
import { formatDateTime } from '../lib/format';

interface Check {
  name: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
  status?: string;
  detail?: Record<string, unknown>;
  queues?: Record<string, { available: boolean; waiting: number; active: number; failed: number; completed: number }>;
  last15m?: number;
  last24h?: number;
  disabled?: { featureKey: string; disabledReason: string | null }[];
  monthlyBudgetUsdCap?: number;
  month?: { tokens: number; costUsd: number };
  today?: { tokens: number; costUsd: number };
  usagePct?: number | null;
  overCap?: boolean;
}

interface StatusPayload {
  overall: 'healthy' | 'degraded' | 'down';
  checkedAt: string;
  checks: Record<string, Check>;
}

const OVERALL_TONE = { healthy: 'green', degraded: 'amber', down: 'red' } as const;
const LABELS: Record<string, string> = {
  database: 'PostgreSQL',
  redis: 'Redis',
  aiService: 'AI service (FastAPI)',
  queues: 'Job queues',
  budget: 'AI spend',
  errors: 'Errors',
  flags: 'Feature flags',
};

function Light({ ok }: { ok: boolean }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />;
}

/** Seconds since the last successful poll — makes a frozen tab obvious. */
function useAgo(iso?: string) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
}

export function SystemStatusPage() {
  const q = useQuery({
    queryKey: ['ops-status'],
    queryFn: () => apiGet<StatusPayload>('/admin/ops/status').then((r) => r.data),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
  const ago = useAgo(q.data?.checkedAt);

  if (q.isLoading) return <div className="p-8"><Spinner /></div>;
  if (q.error) return <ErrorState message={errorMessage(q.error)} />;

  const d = q.data!;
  const c = d.checks;
  const budget = c.budget ?? ({} as Check);
  const errors = c.errors ?? ({} as Check);
  const disabled = c.flags?.disabled ?? [];
  const money = (n?: number) => `$${(n ?? 0).toFixed(4)}`;

  return (
    <div>
      <PageHeader
        title="System Status"
        subtitle="Live health of every dependency. Refreshes every 10 seconds, including on a background tab."
      />

      <div className="mb-4 flex items-center gap-3">
        <Badge tone={OVERALL_TONE[d.overall]}>{d.overall.toUpperCase()}</Badge>
        <span className="text-sm text-slate-500">
          checked {ago === null ? '—' : `${ago}s ago`} · {formatDateTime(d.checkedAt)}
        </span>
      </div>

      {/* Traffic lights */}
      <Card className="mb-4">
        <div className="divide-y divide-slate-100">
          {Object.entries(c).map(([key, check]) => (
            <div key={key} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex items-center gap-3">
                <Light ok={check.ok} />
                <span className="font-medium">{LABELS[key] ?? key}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-500">
                {check.error && <span className="max-w-md truncate text-red-600" title={check.error}>{check.error}</span>}
                <span className="tabular-nums">{check.latencyMs}ms</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* The four numbers worth watching */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">AI spend today</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{money(budget.today?.costUsd)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">AI spend this month</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{money(budget.month?.costUsd)}</div>
          <div className="mt-1 text-xs text-slate-500">
            {budget.monthlyBudgetUsdCap
              ? `${budget.usagePct ?? 0}% of $${budget.monthlyBudgetUsdCap} target`
              : 'no monthly target set'}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Errors (15 min)</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${(errors.last15m ?? 0) > 0 ? 'text-red-600' : ''}`}>
            {errors.last15m ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-500">{errors.last24h ?? 0} in 24h</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Disabled features</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${disabled.length ? 'text-amber-600' : ''}`}>
            {disabled.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">{disabled.length ? 'kill switches active' : 'all features live'}</div>
        </Card>
      </div>

      {/* Anything an operator turned off is the first thing to see on this page —
          a "down" report is usually a switch someone flipped and forgot. */}
      {disabled.length > 0 && (
        <Card className="mb-4 p-4">
          <div className="mb-2 text-sm font-semibold">Currently disabled</div>
          <div className="flex flex-wrap gap-2">
            {disabled.map((f) => (
              <Badge key={f.featureKey} tone="amber">
                {f.featureKey}{f.disabledReason ? ` — ${f.disabledReason}` : ''}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {/* Queue depth: a backlog here is the earliest warning of a stuck worker. */}
      {c.queues?.queues && (
        <Card className="mb-4 p-4">
          <div className="mb-2 text-sm font-semibold">Queues</div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr><th className="py-1 pr-6">Queue</th><th className="py-1 pr-6">Waiting</th><th className="py-1 pr-6">Active</th><th className="py-1 pr-6">Failed</th><th className="py-1">Completed</th></tr>
              </thead>
              <tbody>
                {Object.entries(c.queues.queues).map(([name, s]) => (
                  <tr key={name} className="border-t border-slate-100">
                    <td className="py-1 pr-6 font-medium">{name}</td>
                    <td className="py-1 pr-6 tabular-nums">{s.waiting}</td>
                    <td className="py-1 pr-6 tabular-nums">{s.active}</td>
                    <td className={`py-1 pr-6 tabular-nums ${s.failed > 0 ? 'text-red-600' : ''}`}>{s.failed}</td>
                    <td className="py-1 tabular-nums">{s.completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Raw FastAPI detail — prompt versions and model chains live here, which is
          also how you confirm a model change actually reached the AI service. */}
      {c.aiService?.detail && (
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold">AI service detail</div>
          <pre className="max-h-80 overflow-auto rounded bg-slate-50 p-3 text-xs">
            {JSON.stringify(c.aiService.detail, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
}

export default SystemStatusPage;

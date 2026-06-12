import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, errorMessage } from '../lib/api';
import { PageHeader, Card, Button, Badge, Spinner, ErrorState } from '../components/ui';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { formatDateTime } from '../lib/format';

// ── Feature flags ─────────────────────────────────────────────────────────────
interface Flag { id: string; featureKey: string; isEnabled: boolean; disabledReason: string | null; updatedAt: string }

export function FlagsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['flags'], queryFn: () => apiGet<{ items: Flag[] }>('/admin/flags').then((r) => r.data.items) });
  const toggle = useMutation({
    mutationFn: (vars: { key: string; isEnabled: boolean; reason?: string }) => apiPatch(`/admin/flags/${vars.key}`, { isEnabled: vars.isEnabled, disabledReason: vars.reason }),
    onSuccess: () => { toast.success('Flag updated'); qc.invalidateQueries({ queryKey: ['flags'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onToggle = async (f: Flag) => {
    if (f.isEnabled) {
      const { confirmed, reason } = await confirm({ title: `Disable "${f.featureKey}"?`, tone: 'danger', requireReason: true, reasonLabel: 'Reason for disabling', confirmLabel: 'Disable' });
      if (confirmed) toggle.mutate({ key: f.featureKey, isEnabled: false, reason });
    } else {
      toggle.mutate({ key: f.featureKey, isEnabled: true });
    }
  };

  return (
    <div>
      <PageHeader title="Feature flags" subtitle="Toggle features platform-wide (audited + cache-invalidated)." />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : q.error ? <ErrorState message="Failed to load flags." /> : (
        <Card className="overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="table-th">Feature</th><th className="table-th">State</th><th className="table-th">Reason</th><th className="table-th">Updated</th><th className="table-th"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(q.data ?? []).map((f) => (
                <tr key={f.id}>
                  <td className="table-td font-mono text-xs">{f.featureKey}</td>
                  <td className="table-td"><Badge tone={f.isEnabled ? 'green' : 'red'}>{f.isEnabled ? 'Enabled' : 'Disabled'}</Badge></td>
                  <td className="table-td text-slate-500">{f.disabledReason || '—'}</td>
                  <td className="table-td text-xs text-slate-400">{formatDateTime(f.updatedAt)}</td>
                  <td className="table-td text-right"><Button variant={f.isEnabled ? 'secondary' : 'primary'} onClick={() => onToggle(f)}>{f.isEnabled ? 'Disable' : 'Enable'}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {(q.data ?? []).length === 0 && <p className="py-10 text-center text-sm text-slate-400">No feature flags defined.</p>}
        </Card>
      )}
    </div>
  );
}

// ── API health ────────────────────────────────────────────────────────────────
interface HealthData { hours: number; summary: Record<string, { total: number; successRate: number; avgMs: number; failure?: number; timeout?: number }>; recentLogs: { id: string; source: string; endpoint: string; status: string; responseTimeMs: number | null; timestamp: string }[] }

export function HealthPage() {
  const q = useQuery({ queryKey: ['health'], queryFn: () => apiGet<HealthData>('/admin/health', { hours: 24 }).then((r) => r.data) });
  const d = q.data;
  return (
    <div>
      <PageHeader title="External API health" subtitle="Upstream provider health over the last 24h." />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : q.error ? <ErrorState message="Failed to load health." /> : d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Object.entries(d.summary).map(([source, s]) => (
              <Card key={source} className="p-4">
                <div className="truncate text-xs font-medium text-slate-500">{source}</div>
                <div className={`mt-1 text-2xl font-semibold ${s.successRate >= 95 ? 'text-green-600' : s.successRate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{s.successRate}%</div>
                <div className="text-xs text-slate-400">{s.avgMs}ms · {s.total} calls</div>
              </Card>
            ))}
            {Object.keys(d.summary).length === 0 && <span className="text-sm text-slate-400">No health data in window.</span>}
          </div>
          <Card className="overflow-hidden">
            <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">Recent calls</h3>
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50"><tr><th className="table-th">Source</th><th className="table-th">Endpoint</th><th className="table-th">Status</th><th className="table-th">Latency</th><th className="table-th">When</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.recentLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="table-td">{l.source}</td>
                    <td className="table-td font-mono text-xs text-slate-500">{l.endpoint}</td>
                    <td className="table-td"><Badge tone={l.status === 'success' ? 'green' : 'red'}>{l.status}</Badge></td>
                    <td className="table-td">{l.responseTimeMs != null ? `${l.responseTimeMs}ms` : '—'}</td>
                    <td className="table-td text-xs text-slate-400">{formatDateTime(l.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.recentLogs.length === 0 && <p className="py-8 text-center text-sm text-slate-400">No recent calls.</p>}
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Queues ────────────────────────────────────────────────────────────────────
type QueueStat = { available: boolean; waiting?: number; active?: number; completed?: number; failed?: number; delayed?: number; paused?: number };

export function QueuesPage() {
  const q = useQuery({ queryKey: ['queues'], queryFn: () => apiGet<{ queues: Record<string, QueueStat> }>('/admin/queues').then((r) => r.data.queues), refetchInterval: 10_000 });
  return (
    <div>
      <PageHeader title="Queues" subtitle="BullMQ background-job counts (auto-refreshing)." />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : q.error ? <ErrorState message="Failed to load queues." /> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(q.data ?? {}).map(([name, s]) => (
            <Card key={name} className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-medium text-slate-800">{name}</h3>
                <Badge tone={s.available ? 'green' : 'slate'}>{s.available ? 'live' : 'inline / down'}</Badge>
              </div>
              {s.available ? (
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  {(['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'] as const).map((k) => (
                    <div key={k} className="rounded-lg bg-slate-50 px-2 py-2">
                      <div className={`text-lg font-semibold ${k === 'failed' && (s[k] ?? 0) > 0 ? 'text-red-600' : 'text-slate-800'}`}>{s[k] ?? 0}</div>
                      <div className="text-[11px] capitalize text-slate-400">{k}</div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-400">Queue layer unavailable — jobs run inline.</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

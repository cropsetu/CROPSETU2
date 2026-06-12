import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Users, ShoppingCart, Cpu, CalendarCheck, Flag, ShieldAlert, AlertTriangle } from 'lucide-react';
import { apiGet } from '../lib/api';
import { Card, PageHeader, Spinner, ErrorState } from '../components/ui';
import { formatINR, formatNumber, formatUsd } from '../lib/format';

interface Metrics {
  users: { total: number; active: number; new: number; byRole: Record<string, number>; byKyc: Record<string, number> };
  orders: { total: number; gmv: number; newInWindow: number; gmvInWindow: number; byStatus: Record<string, number> };
  bookings: { total: number };
  ai: { scans: number; chats: number; tokens: number; costUsd: number; reports: number };
  trustSafety: { moderationPending: number; incidentsOpen: number; breachOverdue: number };
  apiHealth: Record<string, { total: number; successRate: number; avgMs: number }>;
}
interface Series { metric: string; series: { date: string; value: number }[] }

function Kpi({ icon: Icon, label, value, sub, to }: { icon: typeof Users; label: string; value: string; sub?: string; to?: string }) {
  const body = (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{label}</span>
        <Icon className="h-4 w-4 text-brand-600" />
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </Card>
  );
  return to ? <Link to={to} className="block transition hover:opacity-90">{body}</Link> : body;
}

function Chart({ title, q }: { title: string; q: ReturnType<typeof useQuery<Series>> }) {
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-medium text-slate-700">{title}</h3>
      <div className="h-56">
        {q.isLoading ? (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={q.data?.series ?? []} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
              <YAxis tick={{ fontSize: 11 }} width={48} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#15803d" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const metrics = useQuery({ queryKey: ['metrics'], queryFn: () => apiGet<Metrics>('/admin/metrics').then((r) => r.data) });
  const signups = useQuery({ queryKey: ['ts', 'signups'], queryFn: () => apiGet<Series>('/admin/metrics/timeseries', { metric: 'signups', days: 30 }).then((r) => r.data) });
  const gmv = useQuery({ queryKey: ['ts', 'gmv'], queryFn: () => apiGet<Series>('/admin/metrics/timeseries', { metric: 'gmv', days: 30 }).then((r) => r.data) });
  const tokens = useQuery({ queryKey: ['ts', 'ai_tokens'], queryFn: () => apiGet<Series>('/admin/metrics/timeseries', { metric: 'ai_tokens', days: 30 }).then((r) => r.data) });

  const m = metrics.data;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Platform health at a glance — last 30 days" />

      {metrics.isLoading && <div className="flex justify-center py-10"><Spinner /></div>}
      {metrics.error != null && <ErrorState message="Failed to load metrics." />}

      {m && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={Users} label="Users" value={formatNumber(m.users.total)} sub={`${formatNumber(m.users.active)} active · ${formatNumber(m.users.new)} new`} to="/users" />
            <Kpi icon={ShoppingCart} label="GMV (lifetime)" value={formatINR(m.orders.gmv)} sub={`${formatNumber(m.orders.total)} orders`} to="/orders" />
            <Kpi icon={CalendarCheck} label="Bookings" value={formatNumber(m.bookings.total)} to="/bookings" />
            <Kpi icon={Cpu} label="AI tokens (30d)" value={formatNumber(m.ai.tokens)} sub={`${formatUsd(m.ai.costUsd)} · ${formatNumber(m.ai.scans)} scans`} to="/ai/usage" />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Kpi icon={Flag} label="Pending moderation" value={formatNumber(m.trustSafety.moderationPending)} to="/moderation" />
            <Kpi icon={ShieldAlert} label="Open incidents" value={formatNumber(m.trustSafety.incidentsOpen)} to="/incidents" />
            <Kpi icon={AlertTriangle} label="Breach SLA overdue" value={formatNumber(m.trustSafety.breachOverdue)} sub="DPDP notification due" to="/incidents" />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Chart title="New signups" q={signups} />
            <Chart title="GMV (₹)" q={gmv} />
            <Chart title="AI tokens" q={tokens} />
          </div>

          <div className="mt-6">
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-medium text-slate-700">External API health (24h)</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {Object.entries(m.apiHealth).length === 0 && <span className="text-sm text-slate-400">No health data yet.</span>}
                {Object.entries(m.apiHealth).map(([source, s]) => (
                  <div key={source} className="rounded-lg border border-slate-100 p-3">
                    <div className="truncate text-xs font-medium text-slate-500">{source}</div>
                    <div className={`mt-1 text-lg font-semibold ${s.successRate >= 95 ? 'text-green-600' : s.successRate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{s.successRate}%</div>
                    <div className="text-xs text-slate-400">{s.avgMs}ms · {s.total} calls</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { apiGet, apiPatch, apiPost, errorMessage } from '../lib/api';
import { useKeyset } from '../lib/useKeyset';
import { useInvalidateList } from '../lib/hooks';
import { PageHeader, Card, Button, Badge, StatusBadge, Spinner, ErrorState, Field, Input } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Toolbar, FilterSelect } from '../components/filters';
import { Modal } from '../components/Modal';
import { useToast } from '../lib/toast';
import { formatNumber, formatUsd, formatDateTime } from '../lib/format';

// ── Usage ─────────────────────────────────────────────────────────────────────
interface UsageRow { userId: string; name: string | null; phone: string | null; tokens: number; costUsd: number; scans: number; chats: number }

export function AiUsagePage() {
  const [days, setDays] = useState('30');
  const q = useQuery({ queryKey: ['ai-usage', days], queryFn: () => apiGet<{ items: UsageRow[] }>('/admin/ai/usage', { days, limit: 50 }).then((r) => r.data) });

  const columns: Column<UsageRow>[] = [
    { key: 'name', header: 'User', render: (u) => u.name || '—', csv: (u) => u.name || '' },
    { key: 'phone', header: 'Phone', render: (u) => <span className="font-mono text-xs">{u.phone || '—'}</span>, csv: (u) => u.phone || '' },
    { key: 'tokens', header: 'Tokens', render: (u) => formatNumber(u.tokens), csv: (u) => String(u.tokens) },
    { key: 'costUsd', header: 'Cost', render: (u) => formatUsd(u.costUsd, 4), csv: (u) => String(u.costUsd) },
    { key: 'scans', header: 'Scans', render: (u) => formatNumber(u.scans), csv: (u) => String(u.scans) },
    { key: 'chats', header: 'Chats', render: (u) => formatNumber(u.chats), csv: (u) => String(u.chats) },
  ];

  return (
    <div>
      <PageHeader title="AI usage & cost" subtitle="Top token/cost spenders." />
      <Toolbar><FilterSelect label="Window" value={days} onChange={setDays} options={[{ label: '7 days', value: '7' }, { label: '30 days', value: '30' }, { label: '90 days', value: '90' }]} allLabel="30 days" /></Toolbar>
      <DataTable columns={columns} items={q.data?.items ?? []} rowKey={(u) => u.userId} isLoading={q.isLoading} error={q.error} exportName="ai-usage" emptyMessage="No AI usage in this window." />
    </div>
  );
}

// ── Credits ───────────────────────────────────────────────────────────────────
interface CreditSummary {
  balance: number; tier: string; tierLabel: string; monthlyAllowance: number; lifetimeEarned: number; lifetimeSpent: number; todaySpent: number;
  recentTransactions: { id: string; amount: number; balanceAfter: number; type: string; description: string | null; date: string }[];
}

export function AiCreditsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [input, setInput] = useState('');
  const [userId, setUserId] = useState('');
  const [adjustOpen, setAdjustOpen] = useState(false);

  const q = useQuery({ queryKey: ['credits', userId], queryFn: () => apiGet<CreditSummary>(`/admin/ai/credits/${userId}`).then((r) => r.data), enabled: !!userId });
  const s = q.data;

  return (
    <div>
      <PageHeader title="AI credits" subtitle="Inspect a user's credit ledger and grant/deduct credits." />
      <Card className="mb-4 p-4">
        <div className="flex items-end gap-2">
          <div className="flex-1"><Field label="User ID"><Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="UUID of the user" /></Field></div>
          <Button variant="primary" onClick={() => setUserId(input.trim())} disabled={!input.trim()}>Load ledger</Button>
        </div>
      </Card>

      {userId && q.isLoading && <div className="flex justify-center py-10"><Spinner /></div>}
      {userId && q.error != null && <ErrorState message={errorMessage(q.error, 'Could not load credit ledger.')} />}
      {s && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4"><div className="text-xs text-slate-400">Balance</div><div className="text-2xl font-semibold">{formatNumber(s.balance)}</div></Card>
            <Card className="p-4"><div className="text-xs text-slate-400">Tier</div><div className="text-2xl font-semibold">{s.tierLabel}</div></Card>
            <Card className="p-4"><div className="text-xs text-slate-400">Lifetime spent</div><div className="text-2xl font-semibold">{formatNumber(s.lifetimeSpent)}</div></Card>
            <Card className="p-4"><div className="text-xs text-slate-400">Spent today</div><div className="text-2xl font-semibold">{formatNumber(s.todaySpent)}</div></Card>
          </div>
          <div className="flex justify-end"><Button variant="primary" onClick={() => setAdjustOpen(true)}>Adjust credits</Button></div>
          <Card className="overflow-hidden">
            <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">Recent transactions</h3>
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50"><tr><th className="table-th">Type</th><th className="table-th">Amount</th><th className="table-th">Balance</th><th className="table-th">Description</th><th className="table-th">When</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {s.recentTransactions.map((t) => (
                  <tr key={t.id}>
                    <td className="table-td"><Badge>{t.type}</Badge></td>
                    <td className={`table-td font-medium ${t.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>{t.amount > 0 ? '+' : ''}{t.amount}</td>
                    <td className="table-td">{t.balanceAfter}</td>
                    <td className="table-td text-slate-500">{t.description || '—'}</td>
                    <td className="table-td text-xs text-slate-400">{formatDateTime(t.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.recentTransactions.length === 0 && <p className="py-8 text-center text-sm text-slate-400">No transactions.</p>}
          </Card>
        </div>
      )}

      {adjustOpen && <AdjustModal userId={userId} onClose={() => setAdjustOpen(false)} onDone={() => { setAdjustOpen(false); qc.invalidateQueries({ queryKey: ['credits', userId] }); toast.success('Credits adjusted'); }} />}
    </div>
  );
}

function AdjustModal({ userId, onClose, onDone }: { userId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => apiPost(`/admin/ai/credits/${userId}/adjust`, { amount: Number(amount), reason }),
    onSuccess: onDone,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const n = Number(amount);
  const valid = Number.isInteger(n) && n !== 0 && reason.trim().length >= 3;
  return (
    <Modal open onClose={onClose} title="Adjust credits" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Apply</Button></>}>
      <div className="space-y-3">
        <Field label="Amount" hint="Positive grants, negative deducts (non-zero integer)."><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 50 or -20" /></Field>
        <Field label="Reason (audited)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this adjustment?" /></Field>
      </div>
    </Modal>
  );
}

// ── Retrain queue ─────────────────────────────────────────────────────────────
interface Feedback { id: string; predictedDisease: string; confirmedDisease: string | null; farmerAgreed: boolean; usedForRetrain: boolean; createdAt: string; user?: { name: string | null }; report?: { cropType: string; primaryDisease: string; riskLevel: string } }

export function FeedbackPage() {
  const toast = useToast();
  const invalidate = useInvalidateList();
  const [used, setUsed] = useState('');
  const params = useMemo(() => (used ? { usedForRetrain: used } : {}), [used]);
  const list = useKeyset<Feedback>('/admin/ai/feedback', params);
  const patch = useMutation({ mutationFn: (vars: { id: string; usedForRetrain: boolean }) => apiPatch(`/admin/ai/feedback/${vars.id}`, { usedForRetrain: vars.usedForRetrain }), onSuccess: () => { toast.success('Updated'); invalidate('/admin/ai/feedback'); }, onError: (e) => toast.error(errorMessage(e)) });

  const columns: Column<Feedback>[] = [
    { key: 'crop', header: 'Crop', render: (f) => f.report?.cropType || '—', csv: (f) => f.report?.cropType || '' },
    { key: 'predicted', header: 'Predicted', render: (f) => f.predictedDisease, csv: (f) => f.predictedDisease },
    { key: 'confirmed', header: 'Confirmed', render: (f) => f.confirmedDisease || '—', csv: (f) => f.confirmedDisease || '' },
    { key: 'agreed', header: 'Farmer agreed', render: (f) => <Badge tone={f.farmerAgreed ? 'green' : 'red'}>{f.farmerAgreed ? 'Yes' : 'No'}</Badge>, csv: (f) => String(f.farmerAgreed) },
    { key: 'retrain', header: 'Retrain', render: (f) => <Badge tone={f.usedForRetrain ? 'green' : 'slate'}>{f.usedForRetrain ? 'Queued' : '—'}</Badge>, csv: (f) => String(f.usedForRetrain) },
    { key: 'actions', header: '', render: (f) => <Button variant="ghost" onClick={() => patch.mutate({ id: f.id, usedForRetrain: !f.usedForRetrain })}>{f.usedForRetrain ? 'Unqueue' : 'Mark for retrain'}</Button> },
  ];

  return (
    <div>
      <PageHeader title="Disease feedback — retrain queue" subtitle="Curate the dataset used to retrain the disease model." />
      <Toolbar><FilterSelect label="Retrain" value={used} onChange={setUsed} options={[{ label: 'Queued', value: 'true' }, { label: 'Not queued', value: 'false' }]} /></Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(f) => f.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} />
    </div>
  );
}

// ── Reports analytics ─────────────────────────────────────────────────────────
interface ReportAnalytics { windowDays: number; total: number; byRisk: { riskLevel: string; count: number }[]; byCrop: { cropType: string; count: number }[]; recent: { id: string; cropType: string; primaryDisease: string; riskLevel: string; confidenceScore: number; createdAt: string }[] }

export function ReportsPage() {
  const [days, setDays] = useState('30');
  const q = useQuery({ queryKey: ['ai-reports', days], queryFn: () => apiGet<ReportAnalytics>('/admin/ai/reports', { days }).then((r) => r.data) });
  const d = q.data;
  return (
    <div>
      <PageHeader title="Disease reports" subtitle="Crop-diagnosis volume and risk mix." />
      <Toolbar><FilterSelect label="Window" value={days} onChange={setDays} options={[{ label: '7 days', value: '7' }, { label: '30 days', value: '30' }, { label: '90 days', value: '90' }]} allLabel="30 days" /></Toolbar>
      {q.isLoading && <div className="flex justify-center py-10"><Spinner /></div>}
      {q.error != null && <ErrorState message="Failed to load analytics." />}
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4"><div className="text-xs text-slate-400">Total scans</div><div className="text-2xl font-semibold">{formatNumber(d.total)}</div></Card>
            {d.byRisk.map((r) => <Card key={r.riskLevel} className="p-4"><div className="text-xs text-slate-400">{r.riskLevel} risk</div><div className="text-2xl font-semibold">{formatNumber(r.count)}</div></Card>)}
          </div>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-medium text-slate-700">Top crops scanned</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.byCrop} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="cropType" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11 }} width={40} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#15803d" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="overflow-hidden">
            <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">Recent reports</h3>
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50"><tr><th className="table-th">Crop</th><th className="table-th">Disease</th><th className="table-th">Risk</th><th className="table-th">Confidence</th><th className="table-th">When</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.recent.map((r) => (
                  <tr key={r.id}><td className="table-td">{r.cropType}</td><td className="table-td">{r.primaryDisease}</td><td className="table-td"><StatusBadge value={r.riskLevel.toUpperCase()} /></td><td className="table-td">{Math.round((r.confidenceScore ?? 0) * 100)}%</td><td className="table-td text-xs text-slate-400">{formatDateTime(r.createdAt)}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

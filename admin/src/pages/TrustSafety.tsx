import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { apiGet, apiPost, errorMessage } from '../lib/api';
import { PageHeader, Card, Button, Badge, StatusBadge, Spinner, ErrorState, Field, Textarea, Select } from '../components/ui';
import { Toolbar, FilterSelect, DescList } from '../components/filters';
import { Drawer } from '../components/Modal';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { formatDateTime, relativeTime } from '../lib/format';

// ── Moderation ────────────────────────────────────────────────────────────────
interface Flag { id: string; entityType: string; entityId: string; reasons: string[]; score: number; status: string; createdAt: string; resolution?: string | null }

export function ModerationPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [status, setStatus] = useState('PENDING');
  const [entityType, setEntityType] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const q = useQuery({ queryKey: ['moderation', status, entityType], queryFn: () => apiGet<{ flags: Flag[] }>('/admin/moderation', { status: status || undefined, entityType: entityType || undefined, limit: 100 }).then((r) => r.data.flags) });
  const detail = useQuery({ queryKey: ['flag', openId], queryFn: () => apiGet<{ flag: Flag; entity: any }>(`/admin/moderation/${openId}`).then((r) => r.data), enabled: !!openId });

  const resolve = useMutation({
    mutationFn: (vars: { status: 'APPROVED' | 'REJECTED'; note: string }) => apiPost(`/admin/moderation/${openId}/resolve`, vars),
    onSuccess: () => { toast.success('Flag resolved'); setOpenId(null); qc.invalidateQueries({ queryKey: ['moderation'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const onResolve = async (decision: 'APPROVED' | 'REJECTED') => {
    const { confirmed, reason } = await confirm({
      title: decision === 'APPROVED' ? 'Approve (keep) content?' : 'Reject (remove) content?',
      tone: decision === 'REJECTED' ? 'danger' : 'default',
      reasonLabel: 'Moderator note (optional)',
      confirmLabel: decision === 'APPROVED' ? 'Approve' : 'Reject',
    });
    if (confirmed) resolve.mutate({ status: decision, note: reason });
  };

  return (
    <div>
      <PageHeader title="Moderation queue" subtitle="Review content flagged by the fraud/abuse signals." />
      <Toolbar>
        <FilterSelect label="Status" value={status} onChange={setStatus} options={['PENDING', 'APPROVED', 'REJECTED'].map((s) => ({ label: s, value: s }))} allLabel="All" />
        <FilterSelect label="Type" value={entityType} onChange={setEntityType} options={[{ label: 'Review', value: 'Review' }, { label: 'Product', value: 'Product' }]} />
      </Toolbar>
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : q.error ? <ErrorState message="Failed to load queue." /> : (
        <Card className="overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="table-th">Type</th><th className="table-th">Reasons</th><th className="table-th">Score</th><th className="table-th">Status</th><th className="table-th">Flagged</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(q.data ?? []).map((f) => (
                <tr key={f.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(f.id)}>
                  <td className="table-td"><Badge>{f.entityType}</Badge></td>
                  <td className="table-td">{f.reasons.map((r) => <Badge key={r} tone="amber" className="mr-1">{r}</Badge>)}</td>
                  <td className="table-td font-medium">{f.score}</td>
                  <td className="table-td"><StatusBadge value={f.status} /></td>
                  <td className="table-td text-xs text-slate-400">{relativeTime(f.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(q.data ?? []).length === 0 && <p className="py-10 text-center text-sm text-slate-400">Queue is clear.</p>}
        </Card>
      )}

      <Drawer open={!!openId} onClose={() => setOpenId(null)} title="Flagged content">
        {detail.isLoading && <div className="flex justify-center py-8"><Spinner /></div>}
        {detail.data && (
          <div className="space-y-4">
            <DescList items={[
              { label: 'Entity', value: <Badge>{detail.data.flag.entityType}</Badge> },
              { label: 'Score', value: detail.data.flag.score },
              { label: 'Reasons', value: detail.data.flag.reasons.join(', ') },
              { label: 'Status', value: <StatusBadge value={detail.data.flag.status} /> },
            ]} />
            <Card className="bg-slate-50 p-3 text-sm">
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-600">{JSON.stringify(detail.data.entity, null, 2)}</pre>
            </Card>
            {detail.data.flag.status === 'PENDING' && (
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" onClick={() => onResolve('APPROVED')} loading={resolve.isPending}><Check className="h-4 w-4" /> Approve</Button>
                <Button variant="danger" className="flex-1" onClick={() => onResolve('REJECTED')} loading={resolve.isPending}><X className="h-4 w-4" /> Reject</Button>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

// ── Fraud clusters ────────────────────────────────────────────────────────────
interface Cluster { fingerprint: string; accountCount: number; accounts: { userId: string; lastSeenAt: string; seenCount: number; lastContext: string | null }[] }

export function FraudPage() {
  const [days, setDays] = useState('30');
  const [min, setMin] = useState('3');
  const [expanded, setExpanded] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['fraud', days, min], queryFn: () => apiGet<{ clusters: Cluster[] }>('/admin/fraud/device-clusters', { days, minAccounts: min, limit: 100 }).then((r) => r.data.clusters) });

  return (
    <div>
      <PageHeader title="Fraud — device clusters" subtitle="Devices backing many accounts (multi-account signal)." />
      <Toolbar>
        <FilterSelect label="Window" value={days} onChange={setDays} options={[{ label: '7 days', value: '7' }, { label: '30 days', value: '30' }, { label: '90 days', value: '90' }]} allLabel="30 days" />
        <FilterSelect label="Min accounts" value={min} onChange={setMin} options={[{ label: '2+', value: '2' }, { label: '3+', value: '3' }, { label: '5+', value: '5' }]} allLabel="3+" />
      </Toolbar>
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : q.error ? <ErrorState message="Failed to load clusters." /> : (
        <div className="space-y-2">
          {(q.data ?? []).map((c) => (
            <Card key={c.fingerprint} className="overflow-hidden">
              <button className="flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => setExpanded(expanded === c.fingerprint ? null : c.fingerprint)}>
                <div className="flex items-center gap-3">
                  {expanded === c.fingerprint ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="font-mono text-xs text-slate-500">{c.fingerprint}</span>
                </div>
                <Badge tone={c.accountCount >= 5 ? 'red' : 'amber'}>{c.accountCount} accounts</Badge>
              </button>
              {expanded === c.fingerprint && (
                <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm">
                  {c.accounts.map((a) => (
                    <li key={a.userId} className="flex items-center justify-between px-4 py-2">
                      <span className="font-mono text-xs">{a.userId}</span>
                      <span className="text-slate-400">{a.lastContext} · {a.seenCount}× · {relativeTime(a.lastSeenAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
          {(q.data ?? []).length === 0 && <p className="py-10 text-center text-sm text-slate-400">No clusters above the threshold.</p>}
        </div>
      )}
    </div>
  );
}

// ── Incidents ─────────────────────────────────────────────────────────────────
interface Incident {
  id: string; reference: string; title: string; category: string; severity: string; status: string; createdAt: string;
  notificationRequired: boolean; notifyDueAt: string | null; boardNotifiedAt: string | null; usersNotifiedAt: string | null;
  description?: string | null; affectedUserCount?: number | null; updates?: { id: string; note: string; statusTo: string | null; createdAt: string }[];
}
const INC_STATUS = ['OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED'];

export function IncidentsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [statusTo, setStatusTo] = useState('');

  const q = useQuery({ queryKey: ['incidents', status, overdue], queryFn: () => apiGet<{ incidents: Incident[] }>('/admin/incidents', { status: status || undefined, overdue: overdue || undefined }).then((r) => r.data.incidents) });
  const detail = useQuery({ queryKey: ['incident', openId], queryFn: () => apiGet<Incident>(`/admin/incidents/${openId}`).then((r) => r.data), enabled: !!openId });

  const refresh = () => { qc.invalidateQueries({ queryKey: ['incidents'] }); qc.invalidateQueries({ queryKey: ['incident', openId] }); };
  const addUpdate = useMutation({ mutationFn: () => apiPost(`/admin/incidents/${openId}/updates`, { note, statusTo: statusTo || undefined }), onSuccess: () => { toast.success('Update added'); setNote(''); setStatusTo(''); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const notify = useMutation({ mutationFn: (target: 'board' | 'users') => apiPost(`/admin/incidents/${openId}/notify`, { target }), onSuccess: () => { toast.success('Notification recorded'); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });

  const isOverdue = (i: Incident) => i.notificationRequired && !i.boardNotifiedAt && i.notifyDueAt && new Date(i.notifyDueAt) < new Date();

  return (
    <div>
      <PageHeader title="Security incidents" subtitle="Incident manager with DPDP breach-notification SLA tracking." />
      <Toolbar>
        <FilterSelect label="Status" value={status} onChange={setStatus} options={INC_STATUS.map((s) => ({ label: s, value: s }))} />
        <FilterSelect label="SLA" value={overdue} onChange={setOverdue} options={[{ label: 'Overdue only', value: 'true' }]} allLabel="All" />
      </Toolbar>
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : q.error ? <ErrorState message="Failed to load incidents." /> : (
        <Card className="overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="table-th">Ref</th><th className="table-th">Title</th><th className="table-th">Severity</th><th className="table-th">Status</th><th className="table-th">Breach SLA</th><th className="table-th">Opened</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(q.data ?? []).map((i) => (
                <tr key={i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(i.id)}>
                  <td className="table-td font-mono text-xs">{i.reference}</td>
                  <td className="table-td font-medium">{i.title}</td>
                  <td className="table-td"><StatusBadge value={i.severity} /></td>
                  <td className="table-td"><StatusBadge value={i.status} /></td>
                  <td className="table-td">{i.notificationRequired ? (isOverdue(i) ? <Badge tone="red"><AlertTriangle className="mr-1 inline h-3 w-3" />Overdue</Badge> : i.boardNotifiedAt ? <Badge tone="green">Notified</Badge> : <Badge tone="amber">Due {relativeTime(i.notifyDueAt)}</Badge>) : <span className="text-slate-300">—</span>}</td>
                  <td className="table-td text-xs text-slate-400">{relativeTime(i.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(q.data ?? []).length === 0 && <p className="py-10 text-center text-sm text-slate-400">No incidents.</p>}
        </Card>
      )}

      <Drawer open={!!openId} onClose={() => setOpenId(null)} title={detail.data?.reference || 'Incident'} width="max-w-2xl">
        {detail.isLoading && <div className="flex justify-center py-8"><Spinner /></div>}
        {detail.data && (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold">{detail.data.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{detail.data.description || 'No description.'}</p>
            </div>
            <DescList items={[
              { label: 'Severity', value: <StatusBadge value={detail.data.severity} /> },
              { label: 'Status', value: <StatusBadge value={detail.data.status} /> },
              { label: 'Category', value: detail.data.category },
              { label: 'Affected users', value: detail.data.affectedUserCount ?? '—' },
              { label: 'Notify due', value: detail.data.notifyDueAt ? formatDateTime(detail.data.notifyDueAt) : '—' },
              { label: 'Board notified', value: detail.data.boardNotifiedAt ? formatDateTime(detail.data.boardNotifiedAt) : 'No' },
            ]} />

            {detail.data.notificationRequired && (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => notify.mutate('board')} disabled={!!detail.data.boardNotifiedAt}>Notify Board</Button>
                <Button variant="secondary" onClick={() => notify.mutate('users')} disabled={!!detail.data.usersNotifiedAt}>Notify users</Button>
              </div>
            )}

            <div>
              <h4 className="mb-2 text-sm font-medium text-slate-700">Timeline</h4>
              <ul className="space-y-2 border-l-2 border-slate-100 pl-4 text-sm">
                {(detail.data.updates ?? []).map((u) => (
                  <li key={u.id}>
                    <div className="flex items-center gap-2">
                      {u.statusTo && <StatusBadge value={u.statusTo} />}
                      <span className="text-xs text-slate-400">{formatDateTime(u.createdAt)}</span>
                    </div>
                    <p className="text-slate-600">{u.note}</p>
                  </li>
                ))}
                {(detail.data.updates ?? []).length === 0 && <li className="text-slate-400">No updates yet.</li>}
              </ul>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <Field label="Add timeline note"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed?" /></Field>
              <div className="flex items-center gap-2">
                <Select value={statusTo} onChange={(e) => setStatusTo(e.target.value)} className="flex-1"><option value="">Keep status</option>{INC_STATUS.map((s) => <option key={s} value={s}>Set: {s}</option>)}</Select>
                <Button variant="primary" disabled={!note.trim()} loading={addUpdate.isPending} onClick={() => addUpdate.mutate()}>Add</Button>
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

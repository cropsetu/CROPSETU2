import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiPost, errorMessage } from '../lib/api';
import { useKeyset } from '../lib/useKeyset';
import { PageHeader, Card, Button, Badge, Field, Input } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Toolbar, FilterSelect, SearchInput } from '../components/filters';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { formatDateTime, titleCase } from '../lib/format';

const PURPOSES = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'DATA_PROCESSING', 'AI_PROCESSING', 'LOCATION', 'MARKETING', 'GUARDIAN_CONSENT', 'SELLER_ONBOARDING'];

// ── Consents ──────────────────────────────────────────────────────────────────
interface Consent { id: string; userId: string; purpose: string; granted: boolean; policyVersion: string; method: string | null; ip: string | null; createdAt: string }

export function ConsentsPage() {
  const [purpose, setPurpose] = useState('');
  const [granted, setGranted] = useState('');
  const params = useMemo(() => { const p: Record<string, unknown> = {}; if (purpose) p.purpose = purpose; if (granted) p.granted = granted; return p; }, [purpose, granted]);
  const list = useKeyset<Consent>('/admin/consents', params);

  const columns: Column<Consent>[] = [
    { key: 'userId', header: 'User', render: (c) => <span className="font-mono text-xs">{c.userId.slice(0, 8)}</span>, csv: (c) => c.userId },
    { key: 'purpose', header: 'Purpose', render: (c) => titleCase(c.purpose), csv: (c) => c.purpose },
    { key: 'granted', header: 'State', render: (c) => <Badge tone={c.granted ? 'green' : 'red'}>{c.granted ? 'Granted' : 'Withdrawn'}</Badge>, csv: (c) => String(c.granted) },
    { key: 'policyVersion', header: 'Policy', render: (c) => c.policyVersion, csv: (c) => c.policyVersion },
    { key: 'method', header: 'Method', render: (c) => c.method || '—', csv: (c) => c.method || '' },
    { key: 'createdAt', header: 'When', render: (c) => formatDateTime(c.createdAt), csv: (c) => c.createdAt },
  ];

  return (
    <div>
      <PageHeader title="Consents" subtitle="DPDP §5 consent records (append-only proof trail)." />
      <Toolbar>
        <FilterSelect label="Purpose" value={purpose} onChange={setPurpose} options={PURPOSES.map((p) => ({ label: titleCase(p), value: p }))} />
        <FilterSelect label="State" value={granted} onChange={setGranted} options={[{ label: 'Granted', value: 'true' }, { label: 'Withdrawn', value: 'false' }]} />
      </Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(c) => c.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} exportName="consents" />
    </div>
  );
}

// ── Erasure ───────────────────────────────────────────────────────────────────
interface ErasureLog { id: string; userId: string; entityId: string; ip: string | null; metadata: string | null; createdAt: string }

export function ErasurePage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [userId, setUserId] = useState('');
  const list = useKeyset<ErasureLog>('/admin/erasure-requests', {});

  const process = useMutation({
    mutationFn: (vars: { userId: string; reason: string }) => apiPost(`/admin/erasure-requests/${vars.userId}/process`, { reason: vars.reason }),
    onSuccess: () => { toast.success('Account erased'); setUserId(''); list.refetch(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onProcess = async () => {
    const { confirmed, reason } = await confirm({
      title: 'Erase this account?',
      tone: 'danger',
      message: 'This is IRREVERSIBLE (DPDP §8). Personal data is deleted, shared records anonymised, and media purged.',
      requireReason: true,
      typeToConfirm: 'ERASE',
      confirmLabel: 'Erase account',
    });
    if (confirmed) process.mutate({ userId: userId.trim(), reason });
  };

  const columns: Column<ErasureLog>[] = [
    { key: 'entityId', header: 'Erased user', render: (e) => <span className="font-mono text-xs">{e.entityId}</span>, csv: (e) => e.entityId },
    { key: 'userId', header: 'By admin', render: (e) => <span className="font-mono text-xs">{e.userId.slice(0, 8)}</span>, csv: (e) => e.userId },
    { key: 'ip', header: 'IP', render: (e) => e.ip || '—', csv: (e) => e.ip || '' },
    { key: 'createdAt', header: 'When', render: (e) => formatDateTime(e.createdAt), csv: (e) => e.createdAt },
  ];

  return (
    <div>
      <PageHeader title="Erasure requests" subtitle="Process DPDP right-to-erasure and review the audited history." />
      <Card className="mb-4 p-4">
        <div className="flex items-end gap-2">
          <div className="flex-1"><Field label="User ID to erase"><Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="UUID of the user" /></Field></div>
          <Button variant="danger" disabled={!userId.trim()} loading={process.isPending} onClick={onProcess}>Process erasure</Button>
        </div>
      </Card>
      <h3 className="mb-2 text-sm font-medium text-slate-600">Processed erasures</h3>
      <DataTable columns={columns} items={list.items} rowKey={(e) => e.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} emptyMessage="No erasures processed yet." />
    </div>
  );
}

// ── Audit log ─────────────────────────────────────────────────────────────────
interface Audit { id: string; userId: string; action: string; entity: string; entityId: string; ip: string | null; createdAt: string }

export function AuditPage() {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const params = useMemo(() => { const p: Record<string, unknown> = {}; if (action) p.action = action; if (entity) p.entity = entity; return p; }, [action, entity]);
  const list = useKeyset<Audit>('/admin/audit', params);

  const columns: Column<Audit>[] = [
    { key: 'createdAt', header: 'When', render: (a) => formatDateTime(a.createdAt), csv: (a) => a.createdAt },
    { key: 'action', header: 'Action', render: (a) => <span className="font-mono text-xs">{a.action}</span>, csv: (a) => a.action },
    { key: 'entity', header: 'Entity', render: (a) => a.entity, csv: (a) => a.entity },
    { key: 'entityId', header: 'Entity ID', render: (a) => <span className="font-mono text-xs">{a.entityId?.slice(0, 12)}</span>, csv: (a) => a.entityId },
    { key: 'userId', header: 'Actor', render: (a) => <span className="font-mono text-xs">{a.userId?.slice(0, 8)}</span>, csv: (a) => a.userId },
    { key: 'ip', header: 'IP', render: (a) => a.ip || '—', csv: (a) => a.ip || '' },
  ];

  return (
    <div>
      <PageHeader title="Audit log" subtitle="Read-only forensic trail of every sensitive operation." />
      <Toolbar>
        <SearchInput value={action} onChange={setAction} placeholder="Exact action (e.g. ADMIN_PII_REVEAL)" />
        <SearchInput value={entity} onChange={setEntity} placeholder="Entity (e.g. User)" />
      </Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(a) => a.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} exportName="audit-log" />
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiPost, apiPatch, errorMessage } from '../lib/api';
import { useKeyset } from '../lib/useKeyset';
import { useInvalidateList } from '../lib/hooks';
import { useAdminMe } from '../lib/scopes';
import { PageHeader, Button, Badge, BoolBadge, Field, Input } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { formatDateTime } from '../lib/format';

interface AdminRow {
  id: string;
  name: string | null;
  phone: string | null;
  adminScopes: string[];
  isActive: boolean;
  lastActiveAt: string | null;
  createdAt: string;
}

function ScopeChecklist({ all, selected, onToggle }: { all: string[]; selected: string[]; onToggle: (s: string) => void }) {
  const normal = all.filter((s) => s !== 'SUPER_ADMIN');
  return (
    <div className="grid grid-cols-2 gap-2">
      {normal.map((s) => (
        <label key={s} className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={selected.includes(s)} onChange={() => onToggle(s)} />
          {s}
        </label>
      ))}
      {all.includes('SUPER_ADMIN') && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={selected.includes('SUPER_ADMIN')} onChange={() => onToggle('SUPER_ADMIN')} />
          <span className="font-medium text-violet-700">SUPER_ADMIN</span>
        </label>
      )}
    </div>
  );
}

function InviteModal({ open, onClose, allScopes, onDone }: { open: boolean; onClose: () => void; allScopes: string[]; onDone: () => void }) {
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const toggle = (s: string) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const save = useMutation({
    mutationFn: () => apiPost('/admin/team/invite', { phone: phone.trim(), scopes }),
    onSuccess: () => { toast.success('Admin invited'); setPhone(''); setScopes([]); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite admin"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!phone.trim()} loading={save.isPending} onClick={() => save.mutate()}>Promote to admin</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Phone" hint="The user must already have a CropSetu account.">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9876543210" />
        </Field>
        <Field label="Scopes" hint="Leave everything unchecked for full SUPER_ADMIN access.">
          <ScopeChecklist all={allScopes} selected={scopes} onToggle={toggle} />
        </Field>
      </div>
    </Modal>
  );
}

function ScopesModal({ admin, onClose, allScopes, onDone, onRevoke }: { admin: AdminRow | null; onClose: () => void; allScopes: string[]; onDone: () => void; onRevoke: (a: AdminRow) => void }) {
  const toast = useToast();
  const [scopes, setScopes] = useState<string[]>([]);
  useEffect(() => { setScopes(admin?.adminScopes ?? []); }, [admin]);
  const toggle = (s: string) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const save = useMutation({
    mutationFn: () => apiPatch(`/admin/team/${admin!.id}/scopes`, { scopes }),
    onSuccess: () => { toast.success('Scopes updated'); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open={!!admin}
      onClose={onClose}
      title={admin ? `${admin.name || 'Admin'} — scopes` : 'Scopes'}
      footer={
        admin ? (
          <>
            <Button variant="danger" onClick={() => onRevoke(admin)}>Revoke access</Button>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save scopes</Button>
          </>
        ) : null
      }
    >
      {admin && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">Leave everything unchecked for full SUPER_ADMIN access.</p>
          <ScopeChecklist all={allScopes} selected={scopes} onToggle={toggle} />
        </div>
      )}
    </Modal>
  );
}

export default function TeamPage() {
  const me = useAdminMe();
  const allScopes = me.data?.allScopes ?? [];
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateList();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);

  const params = useMemo(() => ({}), []);
  const list = useKeyset<AdminRow>('/admin/team', params);

  const revoke = useMutation({
    mutationFn: (vars: { id: string; reason: string }) => apiPost(`/admin/team/${vars.id}/revoke`, { reason: vars.reason }),
    onSuccess: () => { toast.success('Admin access revoked'); setEditing(null); invalidate('/admin/team'); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onRevoke = async (a: AdminRow) => {
    const { confirmed, reason } = await confirm({
      title: `Revoke ${a.name || 'admin'}?`,
      message: 'Demotes them to a regular user, clears all scopes, and logs them out everywhere.',
      tone: 'danger', requireReason: true, confirmLabel: 'Revoke access',
    });
    if (confirmed) revoke.mutate({ id: a.id, reason });
  };

  const columns: Column<AdminRow>[] = [
    { key: 'name', header: 'Name', render: (a) => a.name || '—', csv: (a) => a.name || '' },
    { key: 'phone', header: 'Phone', render: (a) => a.phone || '—', csv: (a) => a.phone || '' },
    {
      key: 'adminScopes', header: 'Scopes',
      render: (a) =>
        a.adminScopes.length === 0 ? (
          <Badge tone="violet">SUPER_ADMIN (all)</Badge>
        ) : (
          <div className="flex flex-wrap gap-1">{a.adminScopes.map((s) => <Badge key={s} tone="blue">{s}</Badge>)}</div>
        ),
      csv: (a) => (a.adminScopes.length ? a.adminScopes.join('|') : 'SUPER_ADMIN'),
    },
    { key: 'isActive', header: 'Active', render: (a) => <BoolBadge value={a.isActive} />, csv: (a) => String(a.isActive) },
    { key: 'createdAt', header: 'Admin since', render: (a) => formatDateTime(a.createdAt), csv: (a) => a.createdAt },
  ];

  return (
    <div>
      <PageHeader
        title="Team & Access"
        subtitle="Admins and their RBAC scopes. An admin with no scopes has full (SUPER_ADMIN) access."
        actions={<Button variant="primary" onClick={() => setInviteOpen(true)}>Invite admin</Button>}
      />
      <DataTable
        columns={columns}
        items={list.items}
        rowKey={(a) => a.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        onRowClick={(a) => setEditing(a)}
        page={list.page}
        canPrev={list.canPrev}
        canNext={list.canNext}
        onPrev={list.prev}
        onNext={list.next}
        exportName="admins"
        emptyMessage="No admins yet."
      />
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} allScopes={allScopes} onDone={() => { setInviteOpen(false); invalidate('/admin/team'); }} />
      <ScopesModal admin={editing} onClose={() => setEditing(null)} allScopes={allScopes} onDone={() => { setEditing(null); invalidate('/admin/team'); }} onRevoke={onRevoke} />
    </div>
  );
}

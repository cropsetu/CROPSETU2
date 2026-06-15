import { useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, EyeOff, LogOut, ScanEye, UserCog } from 'lucide-react';
import { apiGet, apiPatch, apiPost, errorMessage } from '../lib/api';
import { useKeyset } from '../lib/useKeyset';
import { PageHeader, Card, Button, StatusBadge, Badge, Spinner, ErrorState, Select } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Toolbar, SearchInput, FilterSelect, DescList } from '../components/filters';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { useViewAs, type ActiveViewAs } from '../lib/viewAs';
import { formatDate, formatDateTime, relativeTime, titleCase } from '../lib/format';

const ROLES = ['FARMER', 'VERIFIED_FARMER', 'LABOUR_PROVIDER', 'MACHINERY_OWNER', 'SELLER', 'ADMIN'];
const KYC = ['PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED'];

interface UserRow {
  id: string; phone: string; name: string | null; role: string; kycStatus: string;
  isActive: boolean; isMinor: boolean; district: string | null; state: string | null;
  lastActiveAt: string | null; createdAt: string;
}

// ── List ──────────────────────────────────────────────────────────────────────
export function UsersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [kyc, setKyc] = useState('');
  const [active, setActive] = useState('');

  const params = useMemo(() => {
    const p: Record<string, unknown> = {};
    if (search) p.search = search;
    if (role) p.role = role;
    if (kyc) p.kyc = kyc;
    if (active) p.isActive = active;
    return p;
  }, [search, role, kyc, active]);

  const list = useKeyset<UserRow>('/admin/users', params);

  const columns: Column<UserRow>[] = [
    { key: 'phone', header: 'Phone', render: (u) => <span className="font-mono text-xs">{u.phone}</span>, csv: (u) => u.phone },
    { key: 'name', header: 'Name', render: (u) => u.name || '—', csv: (u) => u.name || '' },
    { key: 'role', header: 'Role', render: (u) => <Badge tone={u.role === 'ADMIN' ? 'violet' : 'slate'}>{titleCase(u.role)}</Badge>, csv: (u) => u.role },
    { key: 'kycStatus', header: 'KYC', render: (u) => <StatusBadge value={u.kycStatus} />, csv: (u) => u.kycStatus },
    { key: 'district', header: 'District', render: (u) => u.district || '—', csv: (u) => u.district || '' },
    { key: 'isActive', header: 'Active', render: (u) => <StatusBadge value={u.isActive ? 'ACTIVE' : 'INACTIVE'} />, csv: (u) => String(u.isActive) },
    { key: 'lastActiveAt', header: 'Last active', render: (u) => relativeTime(u.lastActiveAt), csv: (u) => u.lastActiveAt || '' },
  ];

  return (
    <div>
      <PageHeader title="Users" subtitle="Search and manage every account. PII is masked until an audited reveal." />
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Phone, name or district…" />
        <FilterSelect label="Role" value={role} onChange={setRole} options={ROLES.map((r) => ({ label: titleCase(r), value: r }))} />
        <FilterSelect label="KYC" value={kyc} onChange={setKyc} options={KYC.map((k) => ({ label: k, value: k }))} />
        <FilterSelect label="Status" value={active} onChange={setActive} options={[{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }]} />
      </Toolbar>
      <DataTable
        columns={columns}
        items={list.items}
        rowKey={(u) => u.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        onRowClick={(u) => navigate(`/users/${u.id}`)}
        page={list.page}
        canPrev={list.canPrev}
        canNext={list.canNext}
        onPrev={list.prev}
        onNext={list.next}
        exportName="users"
        emptyMessage="No users match these filters."
      />
    </div>
  );
}

// ── Detail ────────────────────────────────────────────────────────────────────
interface UserDetail {
  user: Record<string, unknown> & { id: string; phone: string; name: string | null; role: string; kycStatus: string; isActive: boolean; piiRevealed: boolean };
  counts: Record<string, number>;
  recent: { orders: any[]; conversations: any[]; audit: any[] };
}

export function UserDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const viewAs = useViewAs();
  const [reveal, setReveal] = useState<{ on: boolean; reason: string }>({ on: false, reason: '' });
  const [newRole, setNewRole] = useState('');

  // While a READ-ONLY view-as session is active for THIS user, every write
  // control is hidden — the page becomes a faithful read-only view of their data.
  // (The backend never minted a user token; this is purely UI suppression on top
  // of the admin's own read-scoped session.)
  const readOnly = viewAs.isReadOnly;

  const detailKey = ['user', id, reveal.on, reveal.reason];
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: () => apiGet<UserDetail>(`/admin/users/${id}`, reveal.on ? { reveal: true, reason: reveal.reason } : {}).then((r) => r.data),
  });
  const consents = useQuery({ queryKey: ['user-consents', id], queryFn: () => apiGet<{ effective: Record<string, any>; history: any[] }>(`/admin/users/${id}/consents`).then((r) => r.data) });
  const audit = useQuery({ queryKey: ['user-audit', id], queryFn: () => apiGet<{ items: any[] }>(`/admin/users/${id}/audit`, { limit: 20 }).then((r) => r.data) });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['user', id] }); qc.invalidateQueries({ queryKey: ['user-audit', id] }); };

  const setActive = useMutation({
    mutationFn: (vars: { isActive: boolean; reason: string }) => apiPatch(`/admin/users/${id}`, vars),
    onSuccess: () => { toast.success('User updated'); invalidate(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const changeRole = useMutation({
    mutationFn: (vars: { role: string; reason: string }) => apiPatch(`/admin/users/${id}`, vars),
    onSuccess: () => { toast.success('Role changed'); setNewRole(''); invalidate(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const forceLogout = useMutation({
    mutationFn: (vars: { reason: string }) => apiPost(`/admin/users/${id}/force-logout`, vars),
    onSuccess: () => { toast.success('Sessions revoked'); invalidate(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  // "View as user" — issues a READ-ONLY view-as context (no user token minted).
  const impersonate = useMutation({
    mutationFn: (vars: { reason: string }) => apiPost<ActiveViewAs>(`/admin/users/${id}/impersonate`, vars),
    onSuccess: (session) => { viewAs.start(session); toast.success('Viewing as user — read only'); invalidate(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onReveal = async () => {
    if (reveal.on) { setReveal({ on: false, reason: '' }); return; }
    const { confirmed, reason } = await confirm({ title: 'Reveal PII', message: 'Decrypted phone, location and income will be shown and this access will be written to the audit log.', requireReason: true, confirmLabel: 'Reveal' });
    if (confirmed) setReveal({ on: true, reason });
  };
  const onDeactivate = async () => {
    const isActive = u?.isActive;
    const { confirmed, reason } = await confirm({ title: isActive ? 'Deactivate account?' : 'Reactivate account?', tone: isActive ? 'danger' : 'default', requireReason: true, confirmLabel: isActive ? 'Deactivate' : 'Reactivate' });
    if (confirmed) setActive.mutate({ isActive: !isActive, reason });
  };
  const onChangeRole = async () => {
    if (!newRole) return;
    const { confirmed, reason } = await confirm({ title: `Change role to ${titleCase(newRole)}?`, message: 'The user re-authenticates silently on their next request to pick up the new role.', requireReason: true, confirmLabel: 'Change role' });
    if (confirmed) changeRole.mutate({ role: newRole, reason });
  };
  const onForceLogout = async () => {
    const { confirmed, reason } = await confirm({ title: 'Force logout?', tone: 'danger', message: 'Revokes all refresh tokens and bumps the token version — the user is signed out everywhere.', requireReason: true, confirmLabel: 'Force logout' });
    if (confirmed) forceLogout.mutate({ reason });
  };
  const onViewAs = async () => {
    const { confirmed, reason } = await confirm({
      title: 'View as this user?',
      message: 'Opens a READ-ONLY view of this user’s data. No write actions are possible while viewing as them, and this access is written to the audit log.',
      requireReason: true,
      confirmLabel: 'View as user',
    });
    if (confirmed) impersonate.mutate({ reason });
  };

  if (detail.isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (detail.error != null || !detail.data) return <ErrorState message={errorMessage(detail.error, 'User not found.')} />;

  const u = detail.data.user;
  const counts = detail.data.counts;

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/users')} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="h-4 w-4" /> Back to users</button>
      <PageHeader
        title={u.name || 'Unnamed user'}
        subtitle={`${u.role} · joined ${formatDate(u.createdAt as string)}`}
        actions={
          <>
            <Button variant="secondary" onClick={onReveal}>{reveal.on ? <><EyeOff className="h-4 w-4" /> Hide PII</> : <><Eye className="h-4 w-4" /> Reveal PII</>}</Button>
            {!readOnly && (
              <>
                <Button variant="secondary" onClick={onViewAs} loading={impersonate.isPending}><ScanEye className="h-4 w-4" /> View as user</Button>
                <Button variant={u.isActive ? 'danger' : 'primary'} onClick={onDeactivate} loading={setActive.isPending}>{u.isActive ? 'Deactivate' : 'Reactivate'}</Button>
              </>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-700">Profile {reveal.on && <Badge tone="amber" className="ml-2">PII revealed (audited)</Badge>}</h3>
          </div>
          <DescList items={[
            { label: 'Phone', value: <span className="font-mono">{String(u.phone)}</span> },
            { label: 'Role', value: <Badge tone={u.role === 'ADMIN' ? 'violet' : 'slate'}>{titleCase(u.role)}</Badge> },
            { label: 'KYC status', value: <StatusBadge value={u.kycStatus} /> },
            { label: 'Active', value: <StatusBadge value={u.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
            { label: 'Minor', value: u.isMinor ? <Badge tone="amber">Minor</Badge> : 'No' },
            { label: 'Language', value: String(u.language ?? '—') },
            { label: 'District', value: String(u.district ?? '—') },
            { label: 'State', value: String(u.state ?? '—') },
            { label: 'Lat/Lng', value: reveal.on ? `${u.lat ?? '—'}, ${u.lng ?? '—'}` : (u.hasLocation ? '•• hidden ••' : '—') },
            { label: 'Household income', value: reveal.on ? (u.annualHouseholdIncome ?? '—') as any : (u.hasIncome ? '•• hidden ••' : '—') },
            { label: 'Aadhaar', value: String(u.aadhaarLast4 ?? '—') },
            { label: 'Last active', value: relativeTime(u.lastActiveAt as string) },
          ]} />
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-medium text-slate-700">Activity counts</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {Object.entries(counts).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-lg font-semibold text-slate-800">{v}</div>
                  <div className="text-xs capitalize text-slate-500">{k}</div>
                </div>
              ))}
            </div>
          </Card>

          {readOnly ? (
            <Card className="p-5">
              <h3 className="mb-2 text-sm font-medium text-slate-700">Account actions</h3>
              <p className="text-sm text-slate-400">Hidden while viewing as this user — the session is read-only.</p>
            </Card>
          ) : (
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-medium text-slate-700">Account actions</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="flex-1">
                    <option value="">Change role…</option>
                    {ROLES.filter((r) => r !== u.role).map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                  </Select>
                  <Button variant="secondary" onClick={onChangeRole} disabled={!newRole} loading={changeRole.isPending}><UserCog className="h-4 w-4" /></Button>
                </div>
                <Button variant="danger" className="w-full" onClick={onForceLogout} loading={forceLogout.isPending}><LogOut className="h-4 w-4" /> Force logout</Button>
              </div>
            </Card>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-medium text-slate-700">Recent orders</h3>
          {detail.data.recent.orders.length === 0 ? <p className="text-sm text-slate-400">No orders.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {detail.data.recent.orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between py-2">
                  <span className="font-mono text-xs text-slate-500">{o.id.slice(0, 8)}</span>
                  <StatusBadge value={o.status} />
                  <span>{formatDate(o.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-medium text-slate-700">Consents (DPDP)</h3>
          {consents.isLoading ? <Spinner /> : (
            <ul className="space-y-1.5 text-sm">
              {Object.values(consents.data?.effective ?? {}).map((c: any, i: number) => (
                <li key={i} className="flex items-center justify-between">
                  <span className="text-slate-600">{titleCase(c.purpose)}</span>
                  <Badge tone={c.granted ? 'green' : 'red'}>{c.granted ? 'Granted' : 'Withdrawn'}</Badge>
                </li>
              ))}
              {Object.keys(consents.data?.effective ?? {}).length === 0 && <li className="text-slate-400">No consent records.</li>}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="mb-3 text-sm font-medium text-slate-700">Audit trail</h3>
        {audit.isLoading ? <Spinner /> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {(audit.data?.items ?? []).map((a: any) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <span className="font-mono text-xs text-slate-700">{a.action}</span>
                <span className="text-slate-500">{a.entity}</span>
                <span className="text-xs text-slate-400">{formatDateTime(a.createdAt)}</span>
              </li>
            ))}
            {(audit.data?.items ?? []).length === 0 && <li className="py-2 text-slate-400">No audit entries.</li>}
          </ul>
        )}
        <div className="mt-2 text-right">
          <Link to="/audit" className="text-xs text-brand-700 hover:underline">Open full audit log →</Link>
        </div>
      </Card>
    </div>
  );
}

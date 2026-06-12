import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '../lib/api';
import { useKeyset } from '../lib/useKeyset';
import { useInvalidateList } from '../lib/hooks';
import { PageHeader, Card, Button, Badge, BoolBadge, StatusBadge, Spinner, Field, Input, Textarea, Select } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Toolbar, SearchInput, FilterSelect } from '../components/filters';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { formatINR, formatDate, formatDateTime } from '../lib/format';

// ── Schemes (react-hook-form + zod) ──────────────────────────────────────────
interface Scheme { id: string; schemeCode: string; schemeName: string; schemeNameHi?: string | null; schemeNameMr?: string | null; type: string; state?: string | null; description: string; benefitsSummary: string; benefitType: string; benefitAmount?: number | null; isActive: boolean }

const schemeSchema = z.object({
  schemeCode: z.string().min(2, 'Required').max(60),
  schemeName: z.string().min(2, 'Required').max(200),
  schemeNameHi: z.string().max(200).optional(),
  schemeNameMr: z.string().max(200).optional(),
  type: z.string().min(2, 'Required').max(60),
  state: z.string().max(60).optional(),
  benefitType: z.string().min(1, 'Required').max(60),
  benefitAmount: z.coerce.number().min(0).optional(),
  description: z.string().min(2, 'Required').max(5000),
  benefitsSummary: z.string().min(2, 'Required').max(2000),
  isActive: z.boolean(),
});
type SchemeForm = z.infer<typeof schemeSchema>;

export function SchemesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateList();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<Scheme | null>(null);
  const [creating, setCreating] = useState(false);

  const params = useMemo(() => { const p: Record<string, unknown> = {}; if (search) p.search = search; if (active) p.isActive = active; return p; }, [search, active]);
  const list = useKeyset<Scheme>('/admin/schemes', params);

  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/admin/schemes/${id}`), onSuccess: () => { toast.success('Scheme deactivated'); invalidate('/admin/schemes'); }, onError: (e) => toast.error(errorMessage(e)) });
  const onDelete = async (s: Scheme) => { const { confirmed } = await confirm({ title: `Deactivate "${s.schemeName}"?`, tone: 'danger', confirmLabel: 'Deactivate' }); if (confirmed) remove.mutate(s.id); };

  const columns: Column<Scheme>[] = [
    { key: 'schemeName', header: 'Scheme', render: (s) => <span className="font-medium">{s.schemeName}</span>, csv: (s) => s.schemeName },
    { key: 'schemeCode', header: 'Code', render: (s) => <span className="font-mono text-xs">{s.schemeCode}</span>, csv: (s) => s.schemeCode },
    { key: 'type', header: 'Type', render: (s) => <Badge>{s.type}</Badge>, csv: (s) => s.type },
    { key: 'benefitAmount', header: 'Benefit', render: (s) => s.benefitAmount ? formatINR(s.benefitAmount) : s.benefitType, csv: (s) => String(s.benefitAmount ?? s.benefitType) },
    { key: 'isActive', header: 'Active', render: (s) => <BoolBadge value={s.isActive} />, csv: (s) => String(s.isActive) },
    { key: 'actions', header: '', render: (s) => <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}><Button variant="ghost" onClick={() => setEditing(s)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" onClick={() => onDelete(s)}><Trash2 className="h-4 w-4 text-red-500" /></Button></div> },
  ];

  return (
    <div>
      <PageHeader title="Government schemes" subtitle="Multilingual scheme content." actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New scheme</Button>} />
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Scheme name…" />
        <FilterSelect label="Active" value={active} onChange={setActive} options={[{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }]} />
      </Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(s) => s.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} />
      {(creating || editing) && <SchemeForm scheme={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { setCreating(false); setEditing(null); invalidate('/admin/schemes'); }} />}
    </div>
  );
}

function SchemeForm({ scheme, onClose, onSaved }: { scheme: Scheme | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { register, handleSubmit, formState: { errors } } = useForm<SchemeForm>({
    resolver: zodResolver(schemeSchema),
    defaultValues: scheme
      ? { ...scheme, schemeNameHi: scheme.schemeNameHi ?? '', schemeNameMr: scheme.schemeNameMr ?? '', state: scheme.state ?? '', benefitAmount: scheme.benefitAmount ?? undefined }
      : { isActive: true } as Partial<SchemeForm> as SchemeForm,
  });
  const save = useMutation({
    mutationFn: (data: SchemeForm) => (scheme ? apiPatch(`/admin/schemes/${scheme.id}`, data) : apiPost('/admin/schemes', { ...data, eligibility: {} })),
    onSuccess: () => { toast.success(scheme ? 'Scheme updated' : 'Scheme created'); onSaved(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Modal open onClose={onClose} size="lg" title={scheme ? 'Edit scheme' : 'New scheme'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={handleSubmit((d) => save.mutate(d))}>Save</Button></>}>
      <form className="space-y-3" onSubmit={handleSubmit((d) => save.mutate(d))}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Scheme code" error={errors.schemeCode?.message}><Input {...register('schemeCode')} disabled={!!scheme} /></Field>
          <Field label="Type" error={errors.type?.message}><Input {...register('type')} placeholder="central | state | loan" /></Field>
        </div>
        <Field label="Name (English)" error={errors.schemeName?.message}><Input {...register('schemeName')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name (Hindi)"><Input {...register('schemeNameHi')} /></Field>
          <Field label="Name (Marathi)"><Input {...register('schemeNameMr')} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="State"><Input {...register('state')} placeholder="All / Maharashtra…" /></Field>
          <Field label="Benefit type" error={errors.benefitType?.message}><Input {...register('benefitType')} placeholder="subsidy | loan…" /></Field>
          <Field label="Benefit amount (₹)"><Input type="number" step="0.01" {...register('benefitAmount')} /></Field>
        </div>
        <Field label="Benefits summary" error={errors.benefitsSummary?.message}><Textarea rows={2} {...register('benefitsSummary')} /></Field>
        <Field label="Description" error={errors.description?.message}><Textarea rows={4} {...register('description')} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('isActive')} /> Active</label>
      </form>
    </Modal>
  );
}

// ── MSP ───────────────────────────────────────────────────────────────────────
interface Msp { id: string; commodity: string; commodityHi?: string | null; season: string; year: string; mspPrice: number; previousYearMSP?: number | null; procurementAgency?: string | null }

export function MspPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateList();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Msp | null>(null);
  const [creating, setCreating] = useState(false);
  const params = useMemo(() => (search ? { search } : {}), [search]);
  const list = useKeyset<Msp>('/admin/msp', params);

  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/admin/msp/${id}`), onSuccess: () => { toast.success('MSP rate deleted'); invalidate('/admin/msp'); }, onError: (e) => toast.error(errorMessage(e)) });
  const onDelete = async (m: Msp) => { const { confirmed } = await confirm({ title: `Delete MSP for ${m.commodity}?`, tone: 'danger', confirmLabel: 'Delete' }); if (confirmed) remove.mutate(m.id); };

  const columns: Column<Msp>[] = [
    { key: 'commodity', header: 'Commodity', render: (m) => <span className="font-medium">{m.commodity}</span>, csv: (m) => m.commodity },
    { key: 'season', header: 'Season', render: (m) => m.season, csv: (m) => m.season },
    { key: 'year', header: 'Year', render: (m) => m.year, csv: (m) => m.year },
    { key: 'mspPrice', header: 'MSP', render: (m) => formatINR(m.mspPrice), csv: (m) => String(m.mspPrice) },
    { key: 'actions', header: '', render: (m) => <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}><Button variant="ghost" onClick={() => setEditing(m)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" onClick={() => onDelete(m)}><Trash2 className="h-4 w-4 text-red-500" /></Button></div> },
  ];

  return (
    <div>
      <PageHeader title="MSP rates" subtitle="Minimum support prices." actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New rate</Button>} />
      <Toolbar><SearchInput value={search} onChange={setSearch} placeholder="Commodity…" /></Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(m) => m.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} exportName="msp" />
      {(creating || editing) && <MspForm msp={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { setCreating(false); setEditing(null); invalidate('/admin/msp'); }} />}
    </div>
  );
}

function MspForm({ msp, onClose, onSaved }: { msp: Msp | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Partial<Msp>>(msp ?? { season: 'Kharif', year: String(new Date().getFullYear()) });
  const set = (k: keyof Msp, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => (msp ? apiPatch(`/admin/msp/${msp.id}`, f) : apiPost('/admin/msp', f)),
    onSuccess: () => { toast.success('Saved'); onSaved(); }, onError: (e) => toast.error(errorMessage(e)),
  });
  const valid = f.commodity && f.season && f.year && f.mspPrice != null && Number(f.mspPrice) >= 0;
  return (
    <Modal open onClose={onClose} title={msp ? 'Edit MSP rate' : 'New MSP rate'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Commodity"><Input value={f.commodity ?? ''} onChange={(e) => set('commodity', e.target.value)} disabled={!!msp} /></Field>
          <Field label="Commodity (Hindi)"><Input value={f.commodityHi ?? ''} onChange={(e) => set('commodityHi', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Season"><Select value={f.season ?? ''} onChange={(e) => set('season', e.target.value)} disabled={!!msp}><option>Kharif</option><option>Rabi</option><option>Other</option></Select></Field>
          <Field label="Year"><Input value={f.year ?? ''} onChange={(e) => set('year', e.target.value)} disabled={!!msp} /></Field>
          <Field label="MSP price (₹)"><Input type="number" value={f.mspPrice ?? ''} onChange={(e) => set('mspPrice', Number(e.target.value))} /></Field>
        </div>
        <Field label="Procurement agency"><Input value={f.procurementAgency ?? ''} onChange={(e) => set('procurementAgency', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// ── Crop master ───────────────────────────────────────────────────────────────
interface Crop { id: string; name: string; nameHi: string; nameMr?: string | null; category: string; maturityDays: number; seasons: string[]; mspCommodityCode?: string | null }

export function CropMasterPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateList();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Crop | null>(null);
  const [creating, setCreating] = useState(false);
  const params = useMemo(() => (search ? { search } : {}), [search]);
  const list = useKeyset<Crop>('/admin/crop-master', params);

  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/admin/crop-master/${id}`), onSuccess: () => { toast.success('Crop deleted'); invalidate('/admin/crop-master'); }, onError: (e) => toast.error(errorMessage(e)) });
  const onDelete = async (c: Crop) => { const { confirmed } = await confirm({ title: `Delete "${c.name}"?`, tone: 'danger', confirmLabel: 'Delete' }); if (confirmed) remove.mutate(c.id); };

  const columns: Column<Crop>[] = [
    { key: 'name', header: 'Crop', render: (c) => <span className="font-medium">{c.name}</span>, csv: (c) => c.name },
    { key: 'nameHi', header: 'Hindi', render: (c) => c.nameHi, csv: (c) => c.nameHi },
    { key: 'category', header: 'Category', render: (c) => <Badge>{c.category}</Badge>, csv: (c) => c.category },
    { key: 'maturityDays', header: 'Maturity (d)', render: (c) => c.maturityDays, csv: (c) => String(c.maturityDays) },
    { key: 'seasons', header: 'Seasons', render: (c) => (c.seasons || []).join(', ') || '—', csv: (c) => (c.seasons || []).join('|') },
    { key: 'actions', header: '', render: (c) => <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}><Button variant="ghost" onClick={() => setEditing(c)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" onClick={() => onDelete(c)}><Trash2 className="h-4 w-4 text-red-500" /></Button></div> },
  ];

  return (
    <div>
      <PageHeader title="Crop master" subtitle="Crop reference data." actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New crop</Button>} />
      <Toolbar><SearchInput value={search} onChange={setSearch} placeholder="Crop name…" /></Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(c) => c.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} />
      {(creating || editing) && <CropForm crop={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { setCreating(false); setEditing(null); invalidate('/admin/crop-master'); }} />}
    </div>
  );
}

function CropForm({ crop, onClose, onSaved }: { crop: Crop | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Record<string, unknown>>(crop ? { ...crop, seasons: (crop.seasons || []).join(', ') } : { category: 'Cereal', maturityDays: 120, seasons: '' });
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const payload = { ...f, seasons: String(f.seasons || '').split(',').map((s) => s.trim()).filter(Boolean), maturityDays: Number(f.maturityDays) };
      return crop ? apiPatch(`/admin/crop-master/${crop.id}`, payload) : apiPost('/admin/crop-master', payload);
    },
    onSuccess: () => { toast.success('Saved'); onSaved(); }, onError: (e) => toast.error(errorMessage(e)),
  });
  const valid = f.name && f.nameHi && f.category;
  return (
    <Modal open onClose={onClose} title={crop ? 'Edit crop' : 'New crop'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name (English)"><Input value={(f.name as string) ?? ''} onChange={(e) => set('name', e.target.value)} disabled={!!crop} /></Field>
          <Field label="Name (Hindi)"><Input value={(f.nameHi as string) ?? ''} onChange={(e) => set('nameHi', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Category"><Input value={(f.category as string) ?? ''} onChange={(e) => set('category', e.target.value)} /></Field>
          <Field label="Maturity (days)"><Input type="number" value={(f.maturityDays as number) ?? 120} onChange={(e) => set('maturityDays', e.target.value)} /></Field>
          <Field label="MSP code"><Input value={(f.mspCommodityCode as string) ?? ''} onChange={(e) => set('mspCommodityCode', e.target.value)} /></Field>
        </div>
        <Field label="Seasons (comma-separated)"><Input value={(f.seasons as string) ?? ''} onChange={(e) => set('seasons', e.target.value)} placeholder="Kharif, Rabi" /></Field>
      </div>
    </Modal>
  );
}

// ── Pest alerts ───────────────────────────────────────────────────────────────
interface Pest { id: string; pest: string; severity: string; state: string; districts: string[]; affectedCrops: string[]; isActive: boolean; validUntil: string }

export function PestAlertsPage() {
  const toast = useToast();
  const invalidate = useInvalidateList();
  const [state, setState] = useState('');
  const [creating, setCreating] = useState(false);
  const params = useMemo(() => (state ? { state } : {}), [state]);
  const list = useKeyset<Pest>('/admin/pest-alerts', params);
  const patch = useMutation({ mutationFn: (vars: { id: string; isActive: boolean }) => apiPatch(`/admin/pest-alerts/${vars.id}`, { isActive: vars.isActive }), onSuccess: () => { toast.success('Updated'); invalidate('/admin/pest-alerts'); }, onError: (e) => toast.error(errorMessage(e)) });

  const columns: Column<Pest>[] = [
    { key: 'pest', header: 'Pest', render: (p) => <span className="font-medium">{p.pest}</span>, csv: (p) => p.pest },
    { key: 'severity', header: 'Severity', render: (p) => <StatusBadge value={p.severity.toUpperCase()} />, csv: (p) => p.severity },
    { key: 'state', header: 'State', render: (p) => p.state, csv: (p) => p.state },
    { key: 'districts', header: 'Districts', render: (p) => (p.districts || []).join(', ') || 'All', csv: (p) => (p.districts || []).join('|') },
    { key: 'validUntil', header: 'Valid until', render: (p) => formatDate(p.validUntil), csv: (p) => p.validUntil },
    { key: 'isActive', header: 'Active', render: (p) => <BoolBadge value={p.isActive} />, csv: (p) => String(p.isActive) },
    { key: 'actions', header: '', render: (p) => <Button variant="ghost" onClick={() => patch.mutate({ id: p.id, isActive: !p.isActive })}>{p.isActive ? 'Disable' : 'Enable'}</Button> },
  ];

  return (
    <div>
      <PageHeader title="Pest alerts" subtitle="Create regional pest alerts and broadcast them." actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New alert</Button>} />
      <Toolbar><SearchInput value={state} onChange={setState} placeholder="Filter by state…" /></Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(p) => p.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} />
      {creating && <PestForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); invalidate('/admin/pest-alerts'); }} />}
    </div>
  );
}

function PestForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Record<string, unknown>>({ severity: 'medium', broadcast: false });
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => apiPost('/admin/pest-alerts', {
      pest: f.pest, pestHi: f.pestHi, severity: f.severity, state: f.state,
      districts: String(f.districts || '').split(',').map((s) => s.trim()).filter(Boolean),
      affectedCrops: String(f.affectedCrops || '').split(',').map((s) => s.trim()).filter(Boolean),
      validUntil: f.validUntil ? new Date(f.validUntil as string).toISOString() : undefined,
      broadcast: !!f.broadcast,
    }),
    onSuccess: (res: any) => { toast.success(res?.broadcast ? `Alert created · ${res.broadcast.sent} notified` : 'Alert created'); onSaved(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const valid = f.pest && f.state && f.severity && f.validUntil;
  return (
    <Modal open onClose={onClose} title="New pest alert" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Create</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pest"><Input value={(f.pest as string) ?? ''} onChange={(e) => set('pest', e.target.value)} /></Field>
          <Field label="Pest (Hindi)"><Input value={(f.pestHi as string) ?? ''} onChange={(e) => set('pestHi', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Severity"><Select value={(f.severity as string) ?? 'medium'} onChange={(e) => set('severity', e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></Select></Field>
          <Field label="State"><Input value={(f.state as string) ?? ''} onChange={(e) => set('state', e.target.value)} /></Field>
          <Field label="Valid until"><Input type="date" value={(f.validUntil as string) ?? ''} onChange={(e) => set('validUntil', e.target.value)} /></Field>
        </div>
        <Field label="Districts (comma-separated)" hint="Leave empty for the whole state."><Input value={(f.districts as string) ?? ''} onChange={(e) => set('districts', e.target.value)} /></Field>
        <Field label="Affected crops (comma-separated)"><Input value={(f.affectedCrops as string) ?? ''} onChange={(e) => set('affectedCrops', e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.broadcast} onChange={(e) => set('broadcast', e.target.checked)} /> Broadcast a notification to farmers in the region</label>
      </div>
    </Modal>
  );
}

// ── Mandi sync ────────────────────────────────────────────────────────────────
interface SyncRow { id: string; syncType: string; state: string | null; commodity: string | null; status: string; recordsFetched: number; startedAt: string; completedAt: string | null }

export function MandiSyncPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mandi-sync'], queryFn: () => apiGet<{ items: SyncRow[] }>('/admin/mandi/sync').then((r) => r.data.items) });
  const trigger = useMutation({ mutationFn: () => apiPost('/admin/mandi/sync', {}), onSuccess: () => { toast.success('Sync queued'); qc.invalidateQueries({ queryKey: ['mandi-sync'] }); }, onError: (e) => toast.error(errorMessage(e)) });

  return (
    <div>
      <PageHeader title="Mandi price sync" subtitle="Trigger and monitor data.gov.in mandi-price syncs." actions={<Button variant="primary" loading={trigger.isPending} onClick={() => trigger.mutate()}><RefreshCw className="h-4 w-4" /> Trigger sync</Button>} />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Card className="overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="table-th">Type</th><th className="table-th">State</th><th className="table-th">Commodity</th><th className="table-th">Status</th><th className="table-th">Records</th><th className="table-th">Started</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(q.data ?? []).map((s) => (
                <tr key={s.id}><td className="table-td">{s.syncType}</td><td className="table-td">{s.state || '—'}</td><td className="table-td">{s.commodity || '—'}</td><td className="table-td"><StatusBadge value={s.status} /></td><td className="table-td">{s.recordsFetched}</td><td className="table-td text-xs text-slate-400">{formatDateTime(s.startedAt)}</td></tr>
              ))}
            </tbody>
          </table>
          {(q.data ?? []).length === 0 && <p className="py-10 text-center text-sm text-slate-400">No sync runs yet.</p>}
        </Card>
      )}
    </div>
  );
}

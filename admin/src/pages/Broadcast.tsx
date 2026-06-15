import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Megaphone, Users, Plus, Pencil, Trash2 } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete, errorMessage } from '../lib/api';
import { useKeyset } from '../lib/useKeyset';
import { useInvalidateList } from '../lib/hooks';
import { PageHeader, Card, Button, Field, Input, Textarea, Select, Badge, BoolBadge } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Toolbar, FilterSelect } from '../components/filters';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { titleCase, formatNumber, formatDateTime } from '../lib/format';

const ROLES = ['FARMER', 'VERIFIED_FARMER', 'LABOUR_PROVIDER', 'MACHINERY_OWNER', 'SELLER'];

// The 9 supported app languages (en is the canonical fallback). Mirrors the
// backend SUPPORTED_LANGS / the Category 9-language column pattern.
const LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिंदी (Hindi)' },
  { code: 'mr', label: 'मराठी (Marathi)' },
  { code: 'ta', label: 'தமிழ் (Tamil)' },
  { code: 'kn', label: 'ಕನ್ನಡ (Kannada)' },
  { code: 'ml', label: 'മലയാളം (Malayalam)' },
  { code: 'te', label: 'తెలుగు (Telugu)' },
  { code: 'bn', label: 'বাংলা (Bengali)' },
  { code: 'gu', label: 'ગુજરાતી (Gujarati)' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ (Punjabi)' },
];

type LangMap = Record<string, string>;
interface Template { id: string; key: string; titleI18n: LangMap; bodyI18n: LangMap; category: string; isActive: boolean; createdAt: string }
interface BroadcastRow { id: string; title: string; body: string; templateKey: string | null; filters: Record<string, string>; estimated: number; sent: number; failed: number; createdAt: string }

type Tab = 'compose' | 'templates' | 'history';

export default function BroadcastPage() {
  const [tab, setTab] = useState<Tab>('compose');
  return (
    <div>
      <PageHeader title="Broadcast" subtitle="Compose targeted push notifications, manage multilingual templates, and review delivery history." />
      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {([['compose', 'Compose'], ['templates', 'Templates'], ['history', 'History']] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'compose' && <ComposeTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}

// ── Compose ───────────────────────────────────────────────────────────────────
function ComposeTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({ title: '', body: '', district: '', state: '', role: '', crop: '' });
  const [templateKey, setTemplateKey] = useState('');
  const [lang, setLang] = useState('en');
  const [estimate, setEstimate] = useState<number | null>(null);
  const set = (k: keyof typeof form, v: string) => { setForm((f) => ({ ...f, [k]: v })); setEstimate(null); };

  // Active templates to pick from.
  const templates = useQuery({
    queryKey: ['notif-templates-active'],
    queryFn: () => apiGet<{ items: Template[] }>('/admin/notification-templates', { isActive: 'true', limit: 100 }).then((r) => r.data.items),
  });

  const filters = () => ({ district: form.district || undefined, state: form.state || undefined, role: form.role || undefined, crop: form.crop || undefined });

  const applyTemplate = (key: string, langCode = lang) => {
    setTemplateKey(key);
    const tpl = (templates.data ?? []).find((t) => t.key === key);
    if (tpl) {
      setForm((f) => ({ ...f, title: tpl.titleI18n[langCode] ?? tpl.titleI18n.en ?? '', body: tpl.bodyI18n[langCode] ?? tpl.bodyI18n.en ?? '' }));
      setEstimate(null);
    }
  };

  const preview = useMutation({
    mutationFn: () => apiGet<{ estimated: number }>('/admin/notifications/preview', filters()).then((r) => r.data),
    onSuccess: (d) => setEstimate(d.estimated),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const send = useMutation({
    mutationFn: () => apiPost<{ sent: number; failed: number; estimated: number; capped: boolean }>('/admin/notifications', { ...form, ...filters(), templateKey: templateKey || undefined, lang }),
    onSuccess: (d) => { toast.success(`Sent to ${d.sent} recipients${d.failed ? ` · ${d.failed} failed` : ''}${d.capped ? ' (capped)' : ''}`); setForm({ title: '', body: '', district: '', state: '', role: '', crop: '' }); setTemplateKey(''); setEstimate(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onSend = async () => {
    const est = estimate ?? (await preview.mutateAsync().catch(() => null))?.estimated ?? null;
    const { confirmed } = await confirm({ title: 'Send broadcast?', message: <span>This notification will be delivered to approximately <strong>{est ?? '—'}</strong> users. This cannot be undone.</span>, confirmLabel: 'Send now' });
    if (confirmed) send.mutate();
  };

  const valid = form.title.trim().length >= 2 && form.body.trim().length >= 2;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <Card className="space-y-3 p-5 lg:col-span-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Template (optional)" hint="Fill title & body from a saved template.">
            <Select value={templateKey} onChange={(e) => (e.target.value ? applyTemplate(e.target.value) : setTemplateKey(''))}>
              <option value="">No template</option>
              {(templates.data ?? []).map((t) => <option key={t.id} value={t.key}>{t.key}</option>)}
            </Select>
          </Field>
          <Field label="Language" hint="Multi-language audiences default to English on the server.">
            <Select value={lang} onChange={(e) => { setLang(e.target.value); if (templateKey) applyTemplate(templateKey, e.target.value); }}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Title"><Input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={120} placeholder="Short headline" /></Field>
        <Field label="Message"><Textarea rows={4} value={form.body} onChange={(e) => set('body', e.target.value)} maxLength={1000} placeholder="Notification body" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="State"><Input value={form.state} onChange={(e) => set('state', e.target.value)} placeholder="e.g. Maharashtra" /></Field>
          <Field label="District"><Input value={form.district} onChange={(e) => set('district', e.target.value)} placeholder="e.g. Pune" /></Field>
          <Field label="Role"><Select value={form.role} onChange={(e) => set('role', e.target.value)}><option value="">Any role</option>{ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}</Select></Field>
          <Field label="Crop (grown)"><Input value={form.crop} onChange={(e) => set('crop', e.target.value)} placeholder="e.g. Wheat" /></Field>
        </div>
      </Card>

      <Card className="flex flex-col p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700"><Users className="h-4 w-4" /> Audience</h3>
        <Button variant="secondary" onClick={() => preview.mutate()} loading={preview.isPending}>Estimate recipients</Button>
        {estimate !== null && (
          <div className="mt-4 rounded-lg bg-brand-50 p-4 text-center">
            <div className="text-3xl font-semibold text-brand-800">{estimate}</div>
            <div className="text-xs text-brand-700">active users match</div>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          {Object.entries(filters()).filter(([, v]) => v).map(([k, v]) => <Badge key={k}>{k}: {String(v)}</Badge>)}
          {Object.values(filters()).every((v) => !v) && <span className="text-xs text-slate-400">No filters — all active users.</span>}
        </div>
        <div className="mt-auto pt-4">
          <Button variant="primary" className="w-full" disabled={!valid} loading={send.isPending} onClick={onSend}><Megaphone className="h-4 w-4" /> Send broadcast</Button>
        </div>
      </Card>
    </div>
  );
}

// ── Templates ─────────────────────────────────────────────────────────────────
function TemplatesTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateList();
  const [category, setCategory] = useState('');
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);

  const params = useMemo(() => { const p: Record<string, unknown> = {}; if (category) p.category = category; if (active) p.isActive = active; return p; }, [category, active]);
  const list = useKeyset<Template>('/admin/notification-templates', params);

  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/admin/notification-templates/${id}`), onSuccess: () => { toast.success('Template deactivated'); invalidate('/admin/notification-templates'); }, onError: (e) => toast.error(errorMessage(e)) });
  const onDelete = async (t: Template) => { const { confirmed } = await confirm({ title: `Deactivate "${t.key}"?`, tone: 'danger', confirmLabel: 'Deactivate' }); if (confirmed) remove.mutate(t.id); };

  const columns: Column<Template>[] = [
    { key: 'key', header: 'Key', render: (t) => <span className="font-mono text-xs font-medium">{t.key}</span>, csv: (t) => t.key },
    { key: 'title', header: 'Title (en)', render: (t) => <span className="font-medium">{t.titleI18n?.en ?? '—'}</span>, csv: (t) => t.titleI18n?.en ?? '' },
    { key: 'langs', header: 'Languages', render: (t) => <Badge>{Object.keys(t.titleI18n ?? {}).length} langs</Badge>, csv: (t) => Object.keys(t.titleI18n ?? {}).join('|') },
    { key: 'category', header: 'Category', render: (t) => <Badge>{t.category}</Badge>, csv: (t) => t.category },
    { key: 'isActive', header: 'Active', render: (t) => <BoolBadge value={t.isActive} />, csv: (t) => String(t.isActive) },
    { key: 'actions', header: '', render: (t) => <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}><Button variant="ghost" onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" onClick={() => onDelete(t)}><Trash2 className="h-4 w-4 text-red-500" /></Button></div> },
  ];

  return (
    <div>
      <Toolbar>
        <Input className="w-44" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category…" />
        <FilterSelect label="Active" value={active} onChange={setActive} options={[{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }]} />
        <div className="ml-auto"><Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New template</Button></div>
      </Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(t) => t.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} emptyMessage="No notification templates yet." />
      {(creating || editing) && <TemplateForm template={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { setCreating(false); setEditing(null); invalidate('/admin/notification-templates'); }} />}
    </div>
  );
}

function TemplateForm({ template, onClose, onSaved }: { template: Template | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState(template?.key ?? '');
  const [category, setCategory] = useState(template?.category ?? 'general');
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const [title, setTitle] = useState<LangMap>(template?.titleI18n ?? {});
  const [body, setBody] = useState<LangMap>(template?.bodyI18n ?? {});

  const setT = (code: string, v: string) => setTitle((m) => ({ ...m, [code]: v }));
  const setB = (code: string, v: string) => setBody((m) => ({ ...m, [code]: v }));

  // Drop empty entries; only send languages that actually have text.
  const clean = (m: LangMap): LangMap => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));

  const save = useMutation({
    mutationFn: () => {
      const titleI18n = clean(title);
      const bodyI18n = clean(body);
      const payload = { titleI18n, bodyI18n, category: category.trim() || 'general', isActive };
      return template
        ? apiPatch(`/admin/notification-templates/${template.id}`, payload)
        : apiPost('/admin/notification-templates', { ...payload, key: key.trim() });
    },
    onSuccess: () => { toast.success(template ? 'Template updated' : 'Template created'); onSaved(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const valid = (template || /^[a-z0-9._-]{2,80}$/i.test(key.trim())) && !!title.en?.trim() && !!body.en?.trim();

  return (
    <Modal open onClose={onClose} size="lg" title={template ? `Edit template · ${template.key}` : 'New template'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Key" hint="Immutable lookup handle, e.g. weather.alert">
            <Input value={key} onChange={(e) => setKey(e.target.value)} disabled={!!template} placeholder="e.g. season.kharif" />
          </Field>
          <Field label="Category"><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="general" /></Field>
        </div>
        <p className="text-xs text-slate-500">English (en) is required; other languages are optional and fall back to English when missing.</p>
        <div className="space-y-3">
          {LANGS.map((l) => (
            <div key={l.code} className="rounded-lg border border-slate-100 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{l.label}{l.code === 'en' && ' *'}</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input value={title[l.code] ?? ''} onChange={(e) => setT(l.code, e.target.value)} maxLength={120} placeholder="Title" />
                <Textarea rows={2} value={body[l.code] ?? ''} onChange={(e) => setB(l.code, e.target.value)} maxLength={1000} placeholder="Body" />
              </div>
            </div>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active</label>
      </div>
    </Modal>
  );
}

// ── History ───────────────────────────────────────────────────────────────────
function HistoryTab() {
  const list = useKeyset<BroadcastRow>('/admin/notifications/history', {});

  const targetSummary = (f: Record<string, string>) => {
    const parts = Object.entries(f || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    return parts.length ? parts.join(', ') : 'All active users';
  };

  const columns: Column<BroadcastRow>[] = [
    { key: 'createdAt', header: 'Sent', render: (b) => <span className="text-xs text-slate-500">{formatDateTime(b.createdAt)}</span>, csv: (b) => b.createdAt },
    { key: 'title', header: 'Title', render: (b) => <span className="font-medium">{b.title}</span>, csv: (b) => b.title },
    { key: 'templateKey', header: 'Template', render: (b) => b.templateKey ? <Badge>{b.templateKey}</Badge> : <span className="text-slate-400">—</span>, csv: (b) => b.templateKey ?? '' },
    { key: 'target', header: 'Target', render: (b) => <span className="text-xs text-slate-600">{targetSummary(b.filters)}</span>, csv: (b) => targetSummary(b.filters) },
    { key: 'estimated', header: 'Estimated', render: (b) => formatNumber(b.estimated), csv: (b) => String(b.estimated) },
    { key: 'sent', header: 'Sent', render: (b) => <span className="font-medium text-green-700">{formatNumber(b.sent)}</span>, csv: (b) => String(b.sent) },
    { key: 'failed', header: 'Failed', render: (b) => b.failed ? <span className="font-medium text-red-600">{formatNumber(b.failed)}</span> : <span className="text-slate-400">0</span>, csv: (b) => String(b.failed) },
  ];

  return (
    <DataTable columns={columns} items={list.items} rowKey={(b) => b.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
      page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} exportName="broadcast-history" emptyMessage="No broadcasts sent yet." />
  );
}

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Megaphone, Users } from 'lucide-react';
import { apiGet, apiPost, errorMessage } from '../lib/api';
import { PageHeader, Card, Button, Field, Input, Textarea, Select, Badge } from '../components/ui';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { titleCase } from '../lib/format';

const ROLES = ['FARMER', 'VERIFIED_FARMER', 'LABOUR_PROVIDER', 'MACHINERY_OWNER', 'SELLER'];

export default function BroadcastPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({ title: '', body: '', district: '', state: '', role: '', crop: '' });
  const [estimate, setEstimate] = useState<number | null>(null);
  const set = (k: keyof typeof form, v: string) => { setForm((f) => ({ ...f, [k]: v })); setEstimate(null); };

  const filters = () => ({ district: form.district || undefined, state: form.state || undefined, role: form.role || undefined, crop: form.crop || undefined });

  const preview = useMutation({
    mutationFn: () => apiGet<{ estimated: number }>('/admin/notifications/preview', filters()).then((r) => r.data),
    onSuccess: (d) => setEstimate(d.estimated),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const send = useMutation({
    mutationFn: () => apiPost<{ sent: number; estimated: number; capped: boolean }>('/admin/notifications', { ...form, ...filters() }),
    onSuccess: (d) => { toast.success(`Sent to ${d.sent} recipients${d.capped ? ' (capped)' : ''}`); setForm({ title: '', body: '', district: '', state: '', role: '', crop: '' }); setEstimate(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onSend = async () => {
    const est = estimate ?? (await preview.mutateAsync().catch(() => null))?.estimated ?? null;
    const { confirmed } = await confirm({ title: 'Send broadcast?', message: <span>This notification will be delivered to approximately <strong>{est ?? '—'}</strong> users. This cannot be undone.</span>, confirmLabel: 'Send now' });
    if (confirmed) send.mutate();
  };

  const valid = form.title.trim().length >= 2 && form.body.trim().length >= 2;

  return (
    <div>
      <PageHeader title="Broadcast" subtitle="Compose a targeted push notification and preview the audience before sending." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="space-y-3 p-5 lg:col-span-2">
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
    </div>
  );
}

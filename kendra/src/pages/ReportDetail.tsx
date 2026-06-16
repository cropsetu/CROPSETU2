import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Phone, CheckCircle2, Stethoscope } from 'lucide-react';
import { apiGet, apiPost, errorMessage } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { useToast } from '../lib/toast';
import { Layout } from '../components/Layout';
import { Badge, Button, Card, Input, Spinner, Textarea } from '../components/ui';
import type { Share } from '../lib/types';

export default function ReportDetailPage() {
  const { shareId } = useParams<{ shareId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const { data: share, isLoading, isError } = useQuery({
    queryKey: ['share', shareId],
    queryFn: async () => (await apiGet<Share>(`/crop-reports/seller/inbox/${shareId}`)).data,
    enabled: !!shareId,
  });

  const [reply, setReply] = useState('');
  const [sku, setSku] = useState('');
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Prefill from an existing reply (the seller can edit & resend).
  useEffect(() => {
    if (share) {
      setReply(share.sellerReply || '');
      setSku(share.recommendedSku || '');
      setAvailable(!!share.available);
    }
  }, [share]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (reply.trim().length < 4) { setErr('Please write a short recommendation (at least 4 characters).'); return; }
    setBusy(true);
    try {
      await apiPost(`/crop-reports/seller/inbox/${shareId}/reply`, {
        reply: reply.trim(),
        recommendedSku: sku.trim() || undefined,
        available,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['share', shareId] }),
        queryClient.invalidateQueries({ queryKey: ['inbox'] }),
      ]);
      toast.success(available ? 'Reply sent — farmer notified the medicine is in stock.' : 'Reply sent to the farmer.');
      navigate('/');
    } catch (e2) {
      setErr(errorMessage(e2, 'Could not send your reply. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Layout><Spinner label="Loading report…" /></Layout>;
  if (isError || !share) {
    return (
      <Layout>
        <BackLink onClick={() => navigate('/')} />
        <Card className="p-6 text-center text-sm text-slate-500">Could not load this report.</Card>
      </Layout>
    );
  }

  const r = share.report;
  const f = share.farmer;
  const symptoms = r?.symptoms || [];

  return (
    <Layout subtitle="Review & respond">
      <BackLink onClick={() => navigate('/')} />

      {/* Diagnosis */}
      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Stethoscope className="h-5 w-5 text-brand-700" />
          <h1 className="text-lg font-semibold text-slate-900">{r?.primaryDisease || 'Crop diagnosis'}</h1>
          {r?.riskLevel && <Badge tone={r.riskLevel.toLowerCase()}>{r.riskLevel} risk</Badge>}
          {share.status === 'REPLIED' && <Badge tone="slate">You replied</Badge>}
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Row label="Crop" value={r?.cropType} />
          <Row label="Growth stage" value={r?.growthStage} />
          {typeof r?.confidenceScore === 'number' && <Row label="Confidence" value={`${Math.round(r.confidenceScore * 100)}%`} />}
          {typeof r?.overallRisk === 'number' && <Row label="Overall risk" value={`${r.overallRisk}/100`} />}
        </dl>
        {symptoms.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Symptoms reported</p>
            <div className="flex flex-wrap gap-1.5">
              {symptoms.map((s, i) => <Badge key={i} tone="slate">{s}</Badge>)}
            </div>
          </div>
        )}
        {share.message && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Farmer's note</p>
            {share.message}
          </div>
        )}
      </Card>

      {/* Farmer */}
      <Card className="mb-4 flex items-center justify-between p-4">
        <div>
          <p className="text-sm font-medium text-slate-900">{f?.name || 'Farmer'}</p>
          <p className="text-xs text-slate-500">{[f?.village, f?.taluka, f?.district].filter(Boolean).join(', ') || '—'}</p>
        </div>
        {f?.phone && (
          <a href={`tel:${f.phone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            <Phone className="h-4 w-4" /> {f.phone}
          </a>
        )}
      </Card>

      {/* Response */}
      <Card className="p-5">
        <h2 className="mb-1 text-base font-semibold text-slate-900">Your response</h2>
        <p className="mb-4 text-sm text-slate-500">Confirm whether you stock the recommended medicine and add any guidance for the farmer.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
              <CheckCircle2 className={`h-4 w-4 ${available ? 'text-brand-600' : 'text-slate-300'}`} />
              Yes, we have this medicine / product in stock
            </span>
          </label>
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Medicine / product name (SKU)</span>
            <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. Indofil M-45 (Mancozeb 75% WP)" />
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Recommendation / dosage notes</span>
            <Textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="e.g. Spray Mancozeb 75% WP @ 2g/litre, repeat after 10 days. Available for pickup." maxLength={2000} />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={busy}>{share.status === 'REPLIED' ? 'Update reply' : 'Send reply to farmer'}</Button>
          </div>
        </form>
      </Card>
    </Layout>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
      <ArrowLeft className="h-4 w-4" /> Back to inbox
    </button>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 py-0.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{value}</dd>
    </div>
  );
}

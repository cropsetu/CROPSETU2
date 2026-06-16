import { useState } from 'react';
import { Clock, RefreshCw, Upload } from 'lucide-react';
import { apiUploadFiles, errorMessage } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { KENDRA_ME_KEY } from '../lib/useKendra';
import { useToast } from '../lib/toast';
import { Layout } from '../components/Layout';
import { Button, Card } from '../components/ui';
import type { KendraStatus } from '../lib/types';

export default function PendingPage({ status }: { status: KendraStatus }) {
  const toast = useToast();
  const lic = status.licence;
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      await queryClient.invalidateQueries({ queryKey: KENDRA_ME_KEY });
      toast.success('Status refreshed');
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      await apiUploadFiles('/users/me/licence-documents', Array.from(files), 'images');
      await queryClient.invalidateQueries({ queryKey: KENDRA_ME_KEY });
      toast.success('Licence document(s) uploaded.');
    } catch (e) {
      toast.error(errorMessage(e, 'Upload failed. Please try again.'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Layout subtitle="Verification in progress">
      <div className="space-y-6">
        <Card className="flex items-start gap-3 border-amber-200 bg-amber-50 p-5">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <h2 className="text-base font-semibold text-amber-900">Your Kendra is awaiting verification</h2>
            <p className="mt-1 text-sm text-amber-800">
              Our team is reviewing your dealer licence. Once approved, your Kendra will appear to nearby farmers and you'll start
              receiving their crop-diagnosis reports here. This usually takes 1–2 business days.
            </p>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Submitted details</h3>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Kendra name" value={status.name} />
            <Row label="Business type" value={prettyType(status.businessType)} />
            <Row label="District" value={status.location.district} />
            <Row label="Taluka" value={status.location.taluka} />
            <Row label="Licence number" value={lic?.number} />
            <Row label="Licence type" value={lic?.type} />
            <Row label="Issuing authority" value={lic?.issuingState} />
            <Row label="Expiry" value={lic?.expiry ? new Date(lic.expiry).toLocaleDateString() : null} />
          </dl>
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Licence documents ({lic?.documentCount || 0})</h3>
          {lic?.documents?.length ? (
            <div className="flex flex-wrap gap-3">
              {lic.documents.map((d, i) => (
                d.url
                  ? <a key={i} href={d.url} target="_blank" rel="noreferrer" className="block">
                      <img src={d.url} alt={`Licence document ${i + 1}`} className="h-28 w-28 rounded-lg border border-slate-200 object-cover" />
                    </a>
                  : <div key={i} className="flex h-28 w-28 items-center justify-center rounded-lg border border-slate-200 text-xs text-slate-400">Doc {i + 1}</div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No documents uploaded yet.</p>
          )}

          <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Add / replace document'}
            <input type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={(e) => onUpload(e.target.files)} />
          </label>
        </Card>

        <div className="flex justify-end">
          <Button variant="secondary" loading={busy} onClick={refresh}><RefreshCw className="h-4 w-4" /> Refresh status</Button>
        </div>
      </div>
    </Layout>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1 sm:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{value || '—'}</dd>
    </div>
  );
}

function prettyType(t?: string | null) {
  if (!t) return null;
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

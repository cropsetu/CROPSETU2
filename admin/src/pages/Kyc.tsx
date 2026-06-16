import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Eye, EyeOff, FileText, X } from 'lucide-react';
import { apiGet, apiPost, errorMessage } from '../lib/api';
import { useKeyset } from '../lib/useKeyset';
import { PageHeader, Card, Button, StatusBadge, Badge, Spinner, ErrorState } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Toolbar, FilterSelect, DescList } from '../components/filters';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { formatDate } from '../lib/format';

const KYC = ['PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED'];

interface KycRow {
  id: string; userId: string; createdAt: string; kycVerifiedAt: string | null; kycRejectedReason: string | null;
  documentCount: number; isKendra?: boolean; licenceNumber?: string | null; licenceDocCount?: number;
  user: { id: string; name: string | null; phone: string; kycStatus: string; role: string; district: string | null } | null;
}

export function KycPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('SUBMITTED');
  const params = useMemo(() => (status ? { status } : {}), [status]);
  const list = useKeyset<KycRow>('/admin/kyc', params);

  const columns: Column<KycRow>[] = [
    { key: 'name', header: 'Seller', render: (r) => r.user?.name || '—', csv: (r) => r.user?.name || '' },
    { key: 'phone', header: 'Phone', render: (r) => <span className="font-mono text-xs">{r.user?.phone}</span>, csv: (r) => r.user?.phone || '' },
    { key: 'type', header: 'Type', render: (r) => (r.isKendra ? <Badge tone="green">Kendra</Badge> : <span className="text-xs text-slate-400">Seller</span>), csv: (r) => (r.isKendra ? 'Kendra' : 'Seller') },
    { key: 'kyc', header: 'KYC', render: (r) => <StatusBadge value={r.user?.kycStatus} />, csv: (r) => r.user?.kycStatus || '' },
    { key: 'documentCount', header: 'Docs', render: (r) => r.isKendra ? `${r.documentCount} + ${r.licenceDocCount ?? 0} lic.` : r.documentCount, csv: (r) => String(r.documentCount) },
    { key: 'district', header: 'District', render: (r) => r.user?.district || '—', csv: (r) => r.user?.district || '' },
    { key: 'createdAt', header: 'Submitted', render: (r) => formatDate(r.createdAt), csv: (r) => r.createdAt },
  ];

  return (
    <div>
      <PageHeader title="KYC / Sellers" subtitle="Review seller verification. Document access and PII reveals are audited." />
      <Toolbar>
        <FilterSelect label="Status" value={status} onChange={setStatus} options={KYC.map((k) => ({ label: k, value: k }))} allLabel="All" />
      </Toolbar>
      <DataTable
        columns={columns}
        items={list.items}
        rowKey={(r) => r.userId}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        onRowClick={(r) => navigate(`/kyc/${r.userId}`)}
        page={list.page}
        canPrev={list.canPrev}
        canNext={list.canNext}
        onPrev={list.prev}
        onNext={list.next}
        emptyMessage="No sellers in this queue."
      />
    </div>
  );
}

interface KycDetail {
  userId: string; piiRevealed: boolean;
  user: { id: string; name: string | null; phone: string; kycStatus: string; role: string; district: string | null; state: string | null; businessType?: string | null } | null;
  kycVerifiedAt: string | null; kycRejectedReason: string | null;
  bank: Record<string, string | null>;
  documents: { index: number; publicId: string; url: string | null }[];
  isKendra?: boolean;
  licence?: {
    number: string | null; type: string | null; issuingState: string | null;
    expiry: string | null; verifiedAt: string | null;
    documents: { index: number; publicId: string; url: string | null }[];
  };
}

export function KycDetailPage() {
  const { userId = '' } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const [reveal, setReveal] = useState<{ on: boolean; reason: string }>({ on: false, reason: '' });

  const detail = useQuery({
    queryKey: ['kyc', userId, reveal.on, reveal.reason],
    queryFn: () => apiGet<KycDetail>(`/admin/kyc/${userId}`, reveal.on ? { reveal: true, reason: reveal.reason } : {}).then((r) => r.data),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['kyc', userId] });
  const verify = useMutation({
    mutationFn: (note: string) => apiPost(`/admin/kyc/${userId}/verify`, { note }),
    onSuccess: () => { toast.success('KYC verified — role set to SELLER'); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: (reason: string) => apiPost(`/admin/kyc/${userId}/reject`, { reason }),
    onSuccess: () => { toast.success('KYC rejected'); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onReveal = async () => {
    if (reveal.on) { setReveal({ on: false, reason: '' }); return; }
    const { confirmed, reason } = await confirm({ title: 'Reveal bank & ID details', message: 'Decrypted bank account, Aadhaar and PAN will be shown and this access is audited.', requireReason: true, confirmLabel: 'Reveal' });
    if (confirmed) setReveal({ on: true, reason });
  };
  const onVerify = async () => {
    const { confirmed, reason } = await confirm({ title: 'Verify this seller?', message: 'Sets KYC to VERIFIED and promotes the user to the SELLER role.', confirmLabel: 'Verify' });
    if (confirmed) verify.mutate(reason);
  };
  const onReject = async () => {
    const { confirmed, reason } = await confirm({ title: 'Reject KYC', tone: 'danger', requireReason: true, reasonLabel: 'Rejection reason (shown to the seller)', confirmLabel: 'Reject' });
    if (confirmed) reject.mutate(reason);
  };

  if (detail.isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (detail.error != null || !detail.data) return <ErrorState message={errorMessage(detail.error, 'Seller profile not found.')} />;
  const d = detail.data;

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/kyc')} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="h-4 w-4" /> Back to KYC queue</button>
      <PageHeader
        title={d.user?.name || 'Seller'}
        subtitle={`${d.user?.district ?? ''} ${d.user?.state ?? ''} · KYC ${d.user?.kycStatus}`}
        actions={
          <>
            <Button variant="secondary" onClick={onReveal}>{reveal.on ? <><EyeOff className="h-4 w-4" /> Hide</> : <><Eye className="h-4 w-4" /> Reveal details</>}</Button>
            <Button variant="danger" onClick={onReject} loading={reject.isPending}><X className="h-4 w-4" /> Reject</Button>
            <Button variant="primary" onClick={onVerify} loading={verify.isPending}><Check className="h-4 w-4" /> Verify</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-medium text-slate-700">Bank & identity {reveal.on && <Badge tone="amber" className="ml-2">revealed (audited)</Badge>}</h3>
          <DescList items={[
            { label: 'Account holder', value: d.bank.bankHolderName || '—' },
            { label: 'Bank', value: d.bank.bankName || '—' },
            { label: 'Account number', value: <span className="font-mono">{d.bank.bankAccountNumber || '—'}</span> },
            { label: 'IFSC', value: <span className="font-mono">{d.bank.bankIfsc || '—'}</span> },
            { label: 'Aadhaar', value: <span className="font-mono">{d.bank.aadharNumber || '—'}</span> },
            { label: 'PAN', value: <span className="font-mono">{d.bank.panNumber || '—'}</span> },
          ]} />
          {d.kycRejectedReason && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Last rejection: {d.kycRejectedReason}</p>}
          {d.kycVerifiedAt && <p className="mt-4 text-sm text-green-700">Verified on {formatDate(d.kycVerifiedAt)}</p>}
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-medium text-slate-700">KYC documents ({d.documents.length})</h3>
          {d.documents.length === 0 ? <p className="text-sm text-slate-400">No documents uploaded.</p> : (
            <ul className="space-y-2">
              {d.documents.map((doc) => (
                <li key={doc.index}>
                  {doc.url ? (
                    <a href={doc.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-brand-700 hover:bg-slate-50">
                      <FileText className="h-4 w-4" /> Document {doc.index + 1} <span className="ml-auto text-xs text-slate-400">(signed link, ~5 min)</span>
                    </a>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-400"><FileText className="h-4 w-4" /> Document {doc.index + 1} (link unavailable)</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {(d.isKendra || d.licence?.number) && (
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-medium text-slate-700">
            Krushi Seva Kendra licence
            {d.licence?.verifiedAt && <Badge tone="green" className="ml-2">verified</Badge>}
          </h3>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <DescList items={[
              { label: 'Licence number', value: <span className="font-mono">{d.licence?.number || '—'}</span> },
              { label: 'Licence type', value: d.licence?.type || '—' },
              { label: 'Issuing authority / state', value: d.licence?.issuingState || '—' },
              { label: 'Expiry', value: d.licence?.expiry ? formatDate(d.licence.expiry) : '—' },
            ]} />
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Licence documents ({d.licence?.documents?.length ?? 0})</p>
              {(!d.licence?.documents || d.licence.documents.length === 0) ? (
                <p className="text-sm text-slate-400">No licence documents uploaded.</p>
              ) : (
                <ul className="space-y-2">
                  {d.licence.documents.map((doc) => (
                    <li key={doc.index}>
                      {doc.url ? (
                        <a href={doc.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-brand-700 hover:bg-slate-50">
                          <FileText className="h-4 w-4" /> Licence {doc.index + 1} <span className="ml-auto text-xs text-slate-400">(signed link, ~5 min)</span>
                        </a>
                      ) : (
                        <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-400"><FileText className="h-4 w-4" /> Licence {doc.index + 1} (link unavailable)</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

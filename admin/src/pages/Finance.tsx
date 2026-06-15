import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, errorMessage } from '../lib/api';
import { useKeyset } from '../lib/useKeyset';
import { useInvalidateList } from '../lib/hooks';
import { PageHeader, Button, StatusBadge, Badge, Spinner, ErrorState, Field, Input } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Toolbar, FilterSelect, SearchInput, DescList } from '../components/filters';
import { Modal, Drawer } from '../components/Modal';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { formatINR, formatDate, formatDateTime } from '../lib/format';

const STATUSES = ['PENDING', 'PROCESSING', 'PAID', 'FAILED'];

interface PayoutRow {
  id: string;
  sellerId: string;
  amount: number;
  status: string;
  method: string | null;
  reference: string | null;
  periodFrom: string;
  periodTo: string;
  createdAt: string;
}

interface LedgerEntry {
  id: string;
  sellerId: string;
  type: string;
  amount: number;
  orderId: string | null;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
}

interface LedgerResponse {
  items: LedgerEntry[];
  sellerId: string;
  balance: number;
  commissionRatePct: number;
}

const TYPE_TONE: Record<string, 'green' | 'red' | 'amber' | 'blue' | 'slate' | 'violet'> = {
  SALE: 'green', COMMISSION: 'amber', REFUND: 'red', PAYOUT: 'violet', ADJUSTMENT: 'blue',
};

// ── Create-payout modal ─────────────────────────────────────────────────────────
function CreatePayoutModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [sellerId, setSellerId] = useState('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');

  const save = useMutation({
    mutationFn: () =>
      apiPost('/admin/payouts', {
        sellerId: sellerId.trim(),
        periodFrom: new Date(periodFrom).toISOString(),
        periodTo: new Date(periodTo).toISOString(),
      }),
    onSuccess: () => { toast.success('Payout generated'); setSellerId(''); setPeriodFrom(''); setPeriodTo(''); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const valid = sellerId.trim() && periodFrom && periodTo && periodFrom <= periodTo;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate payout"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Generate</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Seller ID" hint="The seller's user id (sales − commission − refunds − prior payouts over the period).">
          <Input value={sellerId} onChange={(e) => setSellerId(e.target.value)} placeholder="uuid" className="font-mono" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Period from">
            <Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
          </Field>
          <Field label="Period to">
            <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ── Manual adjustment modal ──────────────────────────────────────────────────────
function AdjustModal({ sellerId, onClose, onDone }: { sellerId: string | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const save = useMutation({
    mutationFn: () => apiPost(`/admin/sellers/${sellerId}/ledger`, { amount: Number(amount), note: note.trim() }),
    onSuccess: () => { toast.success('Adjustment recorded'); setAmount(''); setNote(''); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const valid = sellerId && amount && Number(amount) !== 0 && note.trim().length >= 3;

  return (
    <Modal
      open={!!sellerId}
      onClose={onClose}
      title="Manual ledger adjustment"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Record adjustment</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-500">Signed correction to the seller's balance. Positive credits the seller, negative debits.</p>
        <Field label="Amount (₹)" hint="Non-zero. Use a negative value to debit.">
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. -250.00" />
        </Field>
        <Field label="Note" hint="Recorded in the audit log (min 3 chars).">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this adjustment?" />
        </Field>
      </div>
    </Modal>
  );
}

// ── Per-seller ledger drawer ─────────────────────────────────────────────────────
function LedgerDrawer({ sellerId, onClose, onAdjust }: { sellerId: string | null; onClose: () => void; onAdjust: (id: string) => void }) {
  const q = useQuery({
    queryKey: ['seller-ledger', sellerId],
    queryFn: () => apiGet<LedgerResponse>(`/admin/sellers/${sellerId}/ledger`, { limit: 50 }).then((r) => r.data),
    enabled: !!sellerId,
  });
  const d = q.data;

  return (
    <Drawer open={!!sellerId} onClose={onClose} title={sellerId ? `Ledger · ${sellerId.slice(0, 8)}` : 'Ledger'} width="max-w-2xl">
      {q.isLoading && <div className="flex justify-center py-8"><Spinner /></div>}
      {q.error != null && <ErrorState message={errorMessage(q.error)} />}
      {d && (
        <div className="space-y-5">
          <DescList items={[
            { label: 'Seller ID', value: <span className="font-mono text-xs">{d.sellerId}</span> },
            { label: 'Net balance', value: <span className="font-semibold">{formatINR(d.balance)}</span> },
            { label: 'Commission rate', value: `${d.commissionRatePct}%` },
            { label: 'Entries shown', value: d.items.length },
          ]} />

          {sellerId && <Button variant="secondary" onClick={() => onAdjust(sellerId)}>Add manual adjustment</Button>}

          <div>
            <h4 className="mb-2 text-sm font-medium text-slate-700">Ledger (newest first)</h4>
            {d.items.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">No ledger entries yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 text-sm">
                {d.items.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <Badge tone={TYPE_TONE[e.type] ?? 'slate'}>{e.type}</Badge>
                      <span className="ml-2 text-xs text-slate-500">{formatDateTime(e.createdAt)}</span>
                      {e.note && <p className="truncate text-xs text-slate-500">{e.note}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={e.amount < 0 ? 'text-red-600' : 'text-green-700'}>{formatINR(e.amount)}</div>
                      <div className="text-xs text-slate-400">bal {formatINR(e.balanceAfter)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

export default function FinancePage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const invalidate = useInvalidateList();
  const [status, setStatus] = useState('');
  const [sellerFilter, setSellerFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [ledgerSeller, setLedgerSeller] = useState<string | null>(null);
  const [adjustSeller, setAdjustSeller] = useState<string | null>(null);

  const params = useMemo(() => {
    const p: Record<string, unknown> = {};
    if (status) p.status = status;
    if (sellerFilter.trim()) p.sellerId = sellerFilter.trim();
    return p;
  }, [status, sellerFilter]);
  const list = useKeyset<PayoutRow>('/admin/payouts', params);

  const refreshLedger = (sellerId: string | null) => {
    if (sellerId) qc.invalidateQueries({ queryKey: ['seller-ledger', sellerId] });
  };

  const patch = useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) => apiPatch(`/admin/payouts/${vars.id}`, vars.data),
    onSuccess: () => { toast.success('Payout updated'); invalidate('/admin/payouts'); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onMark = async (p: PayoutRow, next: 'PAID' | 'FAILED') => {
    const { confirmed, reason } = await confirm({
      title: next === 'PAID' ? 'Mark payout as paid?' : 'Mark payout as failed?',
      message: next === 'PAID'
        ? `Confirms ${formatINR(p.amount)} was settled. Enter the bank/UTR reference.`
        : `Marks ${formatINR(p.amount)} as failed. Enter the reason/reference.`,
      tone: next === 'FAILED' ? 'danger' : 'default',
      requireReason: true,
      reasonLabel: next === 'PAID' ? 'Reference (UTR / bank ref)' : 'Failure reason / reference',
      confirmLabel: next === 'PAID' ? 'Mark paid' : 'Mark failed',
    });
    if (confirmed) {
      patch.mutate({
        id: p.id,
        data: { status: next, reference: reason, ...(next === 'PAID' ? { method: 'bank_transfer' } : {}) },
      });
    }
  };

  const columns: Column<PayoutRow>[] = [
    { key: 'id', header: 'Payout', render: (p) => <span className="font-mono text-xs">{p.id.slice(0, 8)}</span>, csv: (p) => p.id },
    {
      key: 'sellerId', header: 'Seller',
      render: (p) => (
        <button className="font-mono text-xs text-brand-600 hover:underline" onClick={(e) => { e.stopPropagation(); setLedgerSeller(p.sellerId); }}>
          {p.sellerId.slice(0, 8)}
        </button>
      ),
      csv: (p) => p.sellerId,
    },
    { key: 'amount', header: 'Amount', render: (p) => formatINR(p.amount), csv: (p) => String(p.amount) },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge value={p.status} />, csv: (p) => p.status },
    { key: 'period', header: 'Period', render: (p) => `${formatDate(p.periodFrom)} → ${formatDate(p.periodTo)}`, csv: (p) => `${p.periodFrom}..${p.periodTo}` },
    { key: 'reference', header: 'Reference', render: (p) => p.reference || '—', csv: (p) => p.reference || '' },
    { key: 'createdAt', header: 'Created', render: (p) => formatDateTime(p.createdAt), csv: (p) => p.createdAt },
    {
      key: 'actions', header: '',
      render: (p) => (
        p.status === 'PENDING' || p.status === 'PROCESSING' ? (
          <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button variant="secondary" onClick={() => onMark(p, 'PAID')}>Paid</Button>
            <Button variant="danger" onClick={() => onMark(p, 'FAILED')}>Failed</Button>
          </div>
        ) : <span className="text-slate-400">—</span>
      ),
      csv: () => '',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Finance"
        subtitle="Seller settlement ledgers and the payout queue."
        actions={<Button variant="primary" onClick={() => setCreateOpen(true)}>Generate payout</Button>}
      />
      <Toolbar>
        <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUSES.map((s) => ({ label: s, value: s }))} />
        <SearchInput value={sellerFilter} onChange={setSellerFilter} placeholder="Filter by seller id…" />
      </Toolbar>
      <DataTable
        columns={columns}
        items={list.items}
        rowKey={(p) => p.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        onRowClick={(p) => setLedgerSeller(p.sellerId)}
        page={list.page}
        canPrev={list.canPrev}
        canNext={list.canNext}
        onPrev={list.prev}
        onNext={list.next}
        exportName="payouts"
        emptyMessage="No payouts yet."
      />

      <CreatePayoutModal open={createOpen} onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); invalidate('/admin/payouts'); }} />
      <LedgerDrawer sellerId={ledgerSeller} onClose={() => setLedgerSeller(null)} onAdjust={(id) => setAdjustSeller(id)} />
      <AdjustModal
        sellerId={adjustSeller}
        onClose={() => setAdjustSeller(null)}
        onDone={() => { refreshLedger(adjustSeller); setAdjustSeller(null); invalidate('/admin/payouts'); }}
      />
    </div>
  );
}

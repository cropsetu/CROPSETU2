import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, errorMessage } from '../lib/api';
import { useKeyset } from '../lib/useKeyset';
import { useInvalidateList } from '../lib/hooks';
import { PageHeader, Button, StatusBadge, Spinner, ErrorState, Field, Input } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Toolbar, FilterSelect, DescList } from '../components/filters';
import { Drawer } from '../components/Modal';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { formatINR, formatDateTime } from '../lib/format';

const STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED', 'COMPLETED'];

interface ReturnRow {
  id: string;
  orderId: string;
  orderItemId: string | null;
  userId: string;
  reason: string;
  status: string;
  refundAmount: number | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OrderContext {
  id: string;
  status: string;
  paymentStatus: string;
  totalAmount: number;
  deliveryAddress: Record<string, unknown> | null;
  user?: { name: string | null; phone: string; district: string | null } | null;
  items: { id: string; quantity: number; totalPrice: number; product?: { name: string } }[];
}

interface ReturnDetail extends ReturnRow { order: OrderContext | null }

export default function ReturnsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const invalidate = useInvalidateList();
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const params = useMemo(() => { const p: Record<string, unknown> = {}; if (status) p.status = status; return p; }, [status]);
  const list = useKeyset<ReturnRow>('/admin/returns', params);
  const detail = useQuery({ queryKey: ['return', openId], queryFn: () => apiGet<ReturnDetail>(`/admin/returns/${openId}`).then((r) => r.data), enabled: !!openId });

  const patch = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPatch(`/admin/returns/${openId}`, data),
    onSuccess: () => { toast.success('Return updated'); qc.invalidateQueries({ queryKey: ['return', openId] }); invalidate('/admin/returns'); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onApprove = async () => {
    const { confirmed, reason } = await confirm({ title: 'Approve this return?', message: 'Marks the return APPROVED (no money moves yet).', confirmLabel: 'Approve', requireReason: true });
    if (confirmed) patch.mutate({ status: 'APPROVED', reason });
  };
  const onReject = async () => {
    const { confirmed, reason } = await confirm({ title: 'Reject this return?', tone: 'danger', message: 'Marks the return REJECTED.', confirmLabel: 'Reject', requireReason: true });
    if (confirmed) patch.mutate({ status: 'REJECTED', reason });
  };
  const onRefund = async () => {
    const total = detail.data?.order?.totalAmount;
    const { confirmed, reason } = await confirm({
      title: 'Refund this return?',
      tone: 'danger',
      message: `Sets the return REFUNDED and flips the linked order to REFUNDED / refunded.${total != null ? ` Order total ${formatINR(total)}.` : ''} Leave the amount blank to refund the full order total.`,
      confirmLabel: 'Refund',
      requireReason: true,
    });
    if (!confirmed) return;
    const data: Record<string, unknown> = { status: 'REFUNDED', reason };
    if (refundAmount.trim() !== '') data.refundAmount = Number(refundAmount);
    patch.mutate(data);
  };

  const [refundAmount, setRefundAmount] = useState('');

  const columns: Column<ReturnRow>[] = [
    { key: 'id', header: 'Return', render: (r) => <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>, csv: (r) => r.id },
    { key: 'orderId', header: 'Order', render: (r) => <span className="font-mono text-xs">{r.orderId.slice(0, 8)}</span>, csv: (r) => r.orderId },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} />, csv: (r) => r.status },
    { key: 'refundAmount', header: 'Refund', render: (r) => (r.refundAmount != null ? formatINR(r.refundAmount) : '—'), csv: (r) => (r.refundAmount != null ? String(r.refundAmount) : '') },
    { key: 'reason', header: 'Reason', render: (r) => <span className="line-clamp-1 max-w-xs text-slate-600">{r.reason}</span>, csv: (r) => r.reason },
    { key: 'createdAt', header: 'Requested', render: (r) => formatDateTime(r.createdAt), csv: (r) => r.createdAt },
  ];

  const d = detail.data;
  const resolved = d && d.status !== 'REQUESTED' && d.status !== 'APPROVED';
  return (
    <div>
      <PageHeader title="Returns / RMA" subtitle="Approve, reject and refund buyer return requests." />
      <Toolbar>
        <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUSES.map((s) => ({ label: s, value: s }))} />
      </Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(r) => r.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        onRowClick={(r) => { setOpenId(r.id); setRefundAmount(''); }} page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} exportName="returns" emptyMessage="No return requests." />

      <Drawer open={!!openId} onClose={() => setOpenId(null)} title={openId ? `Return ${openId.slice(0, 8)}` : 'Return'}>
        {detail.isLoading && <div className="flex justify-center py-8"><Spinner /></div>}
        {detail.error != null && <ErrorState message={errorMessage(detail.error)} />}
        {d && (
          <div className="space-y-5">
            <DescList items={[
              { label: 'Status', value: <StatusBadge value={d.status} /> },
              { label: 'Refund amount', value: d.refundAmount != null ? formatINR(d.refundAmount) : '—' },
              { label: 'Buyer', value: d.order?.user?.name || '—' },
              { label: 'Phone', value: <span className="font-mono">{d.order?.user?.phone || '—'}</span> },
              { label: 'Order total', value: d.order ? formatINR(d.order.totalAmount) : '—' },
              { label: 'Requested', value: formatDateTime(d.createdAt) },
            ]} />

            <div>
              <h4 className="mb-1 text-sm font-medium text-slate-700">Reason</h4>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{d.reason}</p>
            </div>

            {d.order && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-slate-700">Order items</h4>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 text-sm">
                  {d.order.items.map((it) => (
                    <li key={it.id} className="flex items-center justify-between px-3 py-2">
                      <span>{it.product?.name || 'Product'} × {it.quantity}</span>
                      <span>{formatINR(it.totalPrice)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!resolved && (
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <h4 className="text-sm font-medium text-slate-700">Resolve</h4>
                <Field label="Refund amount (optional — blank refunds the full order total)">
                  <Input type="number" min={0} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder={d.order ? String(d.order.totalAmount) : '0'} />
                </Field>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" className="flex-1" onClick={onApprove} loading={patch.isPending} disabled={d.status !== 'REQUESTED'}>Approve</Button>
                  <Button variant="secondary" className="flex-1" onClick={onReject} loading={patch.isPending} disabled={d.status !== 'REQUESTED'}>Reject</Button>
                </div>
                <Button variant="danger" className="w-full" onClick={onRefund} loading={patch.isPending}>Refund</Button>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

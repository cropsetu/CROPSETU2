import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, errorMessage } from '../lib/api';
import { useKeyset } from '../lib/useKeyset';
import { useInvalidateList } from '../lib/hooks';
import { PageHeader, Button, StatusBadge, Spinner, ErrorState, Select } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Toolbar, FilterSelect, DescList } from '../components/filters';
import { Drawer } from '../components/Modal';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { formatINR, formatDateTime } from '../lib/format';

const STATUSES = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];
const PAYMENTS = ['pending', 'paid', 'failed', 'refunded'];

interface OrderRow { id: string; status: string; paymentStatus: string; totalAmount: number; createdAt: string; user?: { name: string | null }; _count?: { items: number } }
interface OrderDetail extends OrderRow { deliveryAddress: Record<string, unknown> | null; items: { id: string; quantity: number; unitPrice: number; totalPrice: number; product?: { name: string } }[]; user?: { name: string | null; phone: string; district: string | null } }
interface TimelineEntry { id: string; action: string; after?: { status?: string; paymentStatus?: string } | null; metadata?: { reason?: string | null; refundAmount?: number | null } | null; createdAt: string }

export default function OrdersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const invalidate = useInvalidateList();
  const [status, setStatus] = useState('');
  const [payment, setPayment] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const params = useMemo(() => { const p: Record<string, unknown> = {}; if (status) p.status = status; if (payment) p.paymentStatus = payment; return p; }, [status, payment]);
  const list = useKeyset<OrderRow>('/admin/orders', params);
  const detail = useQuery({ queryKey: ['order', openId], queryFn: () => apiGet<OrderDetail>(`/admin/orders/${openId}`).then((r) => r.data), enabled: !!openId });
  const timeline = useQuery({ queryKey: ['order-timeline', openId], queryFn: () => apiGet<{ items: TimelineEntry[] }>(`/admin/orders/${openId}/timeline`).then((r) => r.data.items), enabled: !!openId });

  const patch = useMutation({
    mutationFn: (vars: { data: Record<string, unknown> }) => apiPatch(`/admin/orders/${openId}`, vars.data),
    onSuccess: () => { toast.success('Order updated'); qc.invalidateQueries({ queryKey: ['order', openId] }); qc.invalidateQueries({ queryKey: ['order-timeline', openId] }); invalidate('/admin/orders'); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onRefund = async () => {
    const { confirmed, reason } = await confirm({ title: 'Refund this order?', tone: 'danger', message: 'Sets the order to REFUNDED and payment to refunded.', requireReason: true, confirmLabel: 'Refund' });
    if (confirmed) patch.mutate({ data: { refund: true, reason } });
  };

  const columns: Column<OrderRow>[] = [
    { key: 'id', header: 'Order', render: (o) => <span className="font-mono text-xs">{o.id.slice(0, 8)}</span>, csv: (o) => o.id },
    { key: 'user', header: 'Buyer', render: (o) => o.user?.name || '—', csv: (o) => o.user?.name || '' },
    { key: 'status', header: 'Status', render: (o) => <StatusBadge value={o.status} />, csv: (o) => o.status },
    { key: 'paymentStatus', header: 'Payment', render: (o) => <StatusBadge value={o.paymentStatus} />, csv: (o) => o.paymentStatus },
    { key: 'totalAmount', header: 'Total', render: (o) => formatINR(o.totalAmount), csv: (o) => String(o.totalAmount) },
    { key: 'items', header: 'Items', render: (o) => o._count?.items ?? '—', csv: (o) => String(o._count?.items ?? '') },
    { key: 'createdAt', header: 'Placed', render: (o) => formatDateTime(o.createdAt), csv: (o) => o.createdAt },
  ];

  const d = detail.data;
  return (
    <div>
      <PageHeader title="Orders" subtitle="Order status, payments and refunds." />
      <Toolbar>
        <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUSES.map((s) => ({ label: s, value: s }))} />
        <FilterSelect label="Payment" value={payment} onChange={setPayment} options={PAYMENTS.map((s) => ({ label: s, value: s }))} />
      </Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(o) => o.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        onRowClick={(o) => setOpenId(o.id)} page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} exportName="orders" />

      <Drawer open={!!openId} onClose={() => setOpenId(null)} title={openId ? `Order ${openId.slice(0, 8)}` : 'Order'}>
        {detail.isLoading && <div className="flex justify-center py-8"><Spinner /></div>}
        {detail.error != null && <ErrorState message={errorMessage(detail.error)} />}
        {d && (
          <div className="space-y-5">
            <DescList items={[
              { label: 'Buyer', value: d.user?.name || '—' },
              { label: 'Phone', value: <span className="font-mono">{d.user?.phone}</span> },
              { label: 'Status', value: <StatusBadge value={d.status} /> },
              { label: 'Payment', value: <StatusBadge value={d.paymentStatus} /> },
              { label: 'Total', value: formatINR(d.totalAmount) },
              { label: 'Placed', value: formatDateTime(d.createdAt) },
            ]} />

            <div>
              <h4 className="mb-2 text-sm font-medium text-slate-700">Items</h4>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 text-sm">
                {d.items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between px-3 py-2">
                    <span>{it.product?.name || 'Product'} × {it.quantity}</span>
                    <span>{formatINR(it.totalPrice)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {d.deliveryAddress && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-slate-700">Delivery (phone masked)</h4>
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {[d.deliveryAddress.name, d.deliveryAddress.street, d.deliveryAddress.city, d.deliveryAddress.state, d.deliveryAddress.pincode].filter(Boolean).join(', ')}
                  {d.deliveryAddress.phone ? ` · ${String(d.deliveryAddress.phone)}` : ''}
                </p>
              </div>
            )}

            <div className="space-y-3 border-t border-slate-100 pt-4">
              <h4 className="text-sm font-medium text-slate-700">Update</h4>
              <div className="flex items-center gap-2">
                <Select defaultValue={d.status} onChange={(e) => patch.mutate({ data: { status: e.target.value } })} className="flex-1">
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
                <Select defaultValue={d.paymentStatus} onChange={(e) => patch.mutate({ data: { paymentStatus: e.target.value } })} className="flex-1">
                  {PAYMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
              <Button variant="danger" className="w-full" onClick={onRefund} disabled={d.status === 'REFUNDED'} loading={patch.isPending}>Refund order</Button>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <h4 className="mb-2 text-sm font-medium text-slate-700">Status timeline</h4>
              {timeline.isLoading && <div className="flex justify-center py-3"><Spinner /></div>}
              {!timeline.isLoading && (timeline.data?.length ?? 0) === 0 && <p className="text-sm text-slate-400">No recorded changes.</p>}
              <ol className="space-y-2">
                {timeline.data?.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {t.after?.status && <StatusBadge value={t.after.status} />}
                      {t.after?.paymentStatus && <StatusBadge value={t.after.paymentStatus} />}
                      {t.metadata?.reason && <span className="text-slate-500">· {t.metadata.reason}</span>}
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{formatDateTime(t.createdAt)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

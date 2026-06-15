/**
 * Disputes — resolution queue for Animal-Trade / Rent-booking / Order disputes.
 *
 * List + type/status filters → detail drawer that resolves the linked context
 * (chat thread / booking / order, PII masked) and offers assign + status +
 * resolution actions (reason captured via useConfirm, recorded in the audit log).
 * A minimal "New dispute" modal lets support open a case until a user-facing
 * raise-dispute flow exists.
 *
 * Gated behind the CONTENT_MODERATOR admin scope (nav + server).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { apiGet, apiPatch, apiPost, errorMessage } from '../lib/api';
import { useKeyset } from '../lib/useKeyset';
import { useInvalidateList } from '../lib/hooks';
import { PageHeader, Card, Button, Badge, StatusBadge, Spinner, ErrorState, Field, Input, Textarea, Select } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Toolbar, FilterSelect, DescList } from '../components/filters';
import { Drawer, Modal } from '../components/Modal';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { formatINR, formatDate, formatDateTime, titleCase } from '../lib/format';

const TYPES = ['ANIMAL_TRADE', 'RENT_BOOKING', 'ORDER'];
const STATUSES = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED'];
const TYPE_LABEL: Record<string, string> = { ANIMAL_TRADE: 'Animal trade', RENT_BOOKING: 'Rent booking', ORDER: 'Order' };

interface Dispute {
  id: string; type: string; refId: string; raisedBy: string; againstUser: string | null;
  reason: string; status: string; resolution: string | null; assignedTo: string | null;
  createdAt: string; updatedAt: string;
}

// ── Linked-context shapes (PII already masked server-side) ───────────────────
interface UserLite { id: string; name: string | null; phone?: string | null }
interface ChatMsg { id: string; senderId: string; text: string | null; imageUrl: string | null; createdAt: string }
interface ChatCtx { id: string; listingId: string; listing: { animal: string; breed: string; price: number; status: string } | null; buyer: UserLite | null; seller: UserLite | null; messages: ChatMsg[] }
interface ListingCtx { id: string; animal: string; breed: string; price: number; status: string; sellerLocation: string; seller: UserLite | null }
interface BookingCtx { id: string; status: string; totalAmount: number; startDate: string; endDate: string; user: UserLite | null; machineryListing: { name: string; owner: UserLite | null } | null; labourListing: { groupName: string | null; name: string; provider: UserLite | null } | null }
interface OrderItemCtx { id: string; quantity: number; unitPrice: number; totalPrice: number; product: { name: string } | null }
interface OrderCtx { id: string; status: string; paymentStatus: string; totalAmount: number; createdAt: string; user: UserLite | null; items: OrderItemCtx[] }
type Context =
  | { kind: 'chat'; chat: ChatCtx }
  | { kind: 'listing'; listing: ListingCtx }
  | { kind: 'booking'; booking: BookingCtx }
  | { kind: 'order'; order: OrderCtx }
  | { kind: 'unknown'; refId: string };

function userLabel(u?: UserLite | null) {
  if (!u) return '—';
  return `${u.name || 'User'}${u.phone ? ` · ${u.phone}` : ''}`;
}

// ── Linked-context renderer ──────────────────────────────────────────────────
function ContextView({ ctx }: { ctx: Context }) {
  if (ctx.kind === 'chat') {
    const c = ctx.chat;
    return (
      <div className="space-y-3">
        <DescList items={[
          { label: 'Listing', value: c.listing ? `${c.listing.animal} · ${c.listing.breed}` : '—' },
          { label: 'Price', value: c.listing ? formatINR(c.listing.price) : '—' },
          { label: 'Buyer', value: userLabel(c.buyer) },
          { label: 'Seller', value: userLabel(c.seller) },
        ]} />
        <div>
          <h4 className="mb-2 text-sm font-medium text-slate-700">Recent messages</h4>
          <ul className="space-y-1.5 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
            {c.messages.map((m) => (
              <li key={m.id} className="flex flex-col">
                <span className="text-[11px] text-slate-400">{m.senderId === c.buyer?.id ? 'Buyer' : m.senderId === c.seller?.id ? 'Seller' : 'User'} · {formatDateTime(m.createdAt)}</span>
                <span className="text-slate-700">{m.text || (m.imageUrl ? '[image]' : '—')}</span>
              </li>
            ))}
            {c.messages.length === 0 && <li className="text-slate-400">No messages.</li>}
          </ul>
        </div>
      </div>
    );
  }
  if (ctx.kind === 'listing') {
    const l = ctx.listing;
    return (
      <DescList items={[
        { label: 'Animal', value: `${l.animal} · ${l.breed}` },
        { label: 'Price', value: formatINR(l.price) },
        { label: 'Status', value: <StatusBadge value={l.status} /> },
        { label: 'Location', value: l.sellerLocation },
        { label: 'Seller', value: userLabel(l.seller) },
      ]} />
    );
  }
  if (ctx.kind === 'booking') {
    const b = ctx.booking;
    const provider = b.machineryListing?.owner || b.labourListing?.provider;
    return (
      <DescList items={[
        { label: 'For', value: b.machineryListing?.name || b.labourListing?.groupName || b.labourListing?.name || '—' },
        { label: 'Status', value: <StatusBadge value={b.status} /> },
        { label: 'Amount', value: formatINR(b.totalAmount) },
        { label: 'Dates', value: `${formatDate(b.startDate)} → ${formatDate(b.endDate)}` },
        { label: 'Booked by', value: userLabel(b.user) },
        { label: 'Provider', value: userLabel(provider) },
      ]} />
    );
  }
  if (ctx.kind === 'order') {
    const o = ctx.order;
    return (
      <div className="space-y-3">
        <DescList items={[
          { label: 'Order', value: <span className="font-mono text-xs">{o.id.slice(0, 8)}</span> },
          { label: 'Status', value: <StatusBadge value={o.status} /> },
          { label: 'Payment', value: <StatusBadge value={o.paymentStatus} /> },
          { label: 'Total', value: formatINR(o.totalAmount) },
          { label: 'Buyer', value: userLabel(o.user) },
          { label: 'Placed', value: formatDate(o.createdAt) },
        ]} />
        <div>
          <h4 className="mb-2 text-sm font-medium text-slate-700">Items</h4>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 text-sm">
            {o.items.map((it) => (
              <li key={it.id} className="flex items-center justify-between px-3 py-1.5">
                <span className="text-slate-700">{it.product?.name || '—'} × {it.quantity}</span>
                <span className="text-slate-500">{formatINR(it.totalPrice)}</span>
              </li>
            ))}
            {o.items.length === 0 && <li className="px-3 py-2 text-slate-400">No items.</li>}
          </ul>
        </div>
      </div>
    );
  }
  return <p className="text-sm text-slate-400">Linked record not found (ref {ctx.refId}).</p>;
}

// ── Create-dispute modal ─────────────────────────────────────────────────────
function NewDisputeModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [type, setType] = useState('ORDER');
  const [refId, setRefId] = useState('');
  const [reason, setReason] = useState('');
  const [againstUser, setAgainstUser] = useState('');

  const create = useMutation({
    mutationFn: () => apiPost('/admin/disputes', {
      type, refId: refId.trim(), reason: reason.trim(),
      ...(againstUser.trim() ? { againstUser: againstUser.trim() } : {}),
    }),
    onSuccess: () => { toast.success('Dispute created'); reset(); onCreated(); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const reset = () => { setType('ORDER'); setRefId(''); setReason(''); setAgainstUser(''); };
  const canSubmit = refId.trim().length > 0 && reason.trim().length >= 3;

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="New dispute"
      footer={<>
        <Button variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button>
        <Button variant="primary" disabled={!canSubmit} loading={create.isPending} onClick={() => create.mutate()}>Create</Button>
      </>}
    >
      <div className="space-y-3">
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label="Reference ID" hint="Chat id (animal trade), Booking id (rent), or Order id.">
          <Input value={refId} onChange={(e) => setRefId(e.target.value)} placeholder="uuid of the linked record" />
        </Field>
        <Field label="Against user (optional)" hint="User id the dispute is raised against.">
          <Input value={againstUser} onChange={(e) => setAgainstUser(e.target.value)} placeholder="uuid (optional)" />
        </Field>
        <Field label="Reason">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What is the dispute about?" />
        </Field>
      </div>
    </Modal>
  );
}

export default function DisputesPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const invalidate = useInvalidateList();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [assignTo, setAssignTo] = useState('');

  const params = useMemo(() => {
    const p: Record<string, unknown> = {};
    if (type) p.type = type;
    if (status) p.status = status;
    return p;
  }, [type, status]);
  const list = useKeyset<Dispute>('/admin/disputes', params);

  const detail = useQuery({
    queryKey: ['dispute', openId],
    queryFn: () => apiGet<{ dispute: Dispute; context: Context }>(`/admin/disputes/${openId}`).then((r) => r.data),
    enabled: !!openId,
  });

  const refresh = () => { invalidate('/admin/disputes'); qc.invalidateQueries({ queryKey: ['dispute', openId] }); };

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPatch(`/admin/disputes/${openId}`, body),
    onSuccess: () => { toast.success('Dispute updated'); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onSetStatus = async (next: string) => {
    const resolving = next === 'RESOLVED' || next === 'CLOSED';
    const { confirmed, reason } = await confirm({
      title: `Set status to ${next}?`,
      tone: next === 'CLOSED' ? 'danger' : 'default',
      requireReason: resolving,
      reasonLabel: resolving ? 'Resolution (recorded in the audit log)' : 'Reason (optional)',
      confirmLabel: `Set ${next}`,
    });
    if (!confirmed) return;
    patch.mutate({ status: next, ...(resolving ? { resolution: reason } : reason ? { reason } : {}) });
  };

  const onAssign = () => {
    if (!assignTo.trim()) return;
    patch.mutate({ assignedTo: assignTo.trim() });
    setAssignTo('');
  };

  const columns: Column<Dispute>[] = [
    { key: 'id', header: 'Dispute', render: (d) => <span className="font-mono text-xs">{d.id.slice(0, 8)}</span>, csv: (d) => d.id },
    { key: 'type', header: 'Type', render: (d) => <Badge tone="blue">{TYPE_LABEL[d.type] ?? titleCase(d.type)}</Badge>, csv: (d) => d.type },
    { key: 'reason', header: 'Reason', render: (d) => <span className="line-clamp-1 max-w-xs text-slate-600">{d.reason}</span>, csv: (d) => d.reason },
    { key: 'status', header: 'Status', render: (d) => <StatusBadge value={d.status} />, csv: (d) => d.status },
    { key: 'assignedTo', header: 'Assigned', render: (d) => d.assignedTo ? <span className="font-mono text-xs">{d.assignedTo.slice(0, 8)}</span> : <span className="text-slate-300">—</span>, csv: (d) => d.assignedTo ?? '' },
    { key: 'createdAt', header: 'Opened', render: (d) => <span className="text-xs text-slate-400">{formatDate(d.createdAt)}</span>, csv: (d) => d.createdAt },
  ];

  return (
    <div>
      <PageHeader
        title="Disputes"
        subtitle="Resolution queue for animal-trade, rent-booking and order disputes."
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="h-4 w-4" /> New dispute</Button>}
      />
      <Toolbar>
        <FilterSelect label="Type" value={type} onChange={setType} options={TYPES.map((t) => ({ label: TYPE_LABEL[t], value: t }))} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUSES.map((s) => ({ label: s, value: s }))} />
      </Toolbar>

      <DataTable
        columns={columns} items={list.items} rowKey={(d) => d.id} onRowClick={(d) => setOpenId(d.id)}
        isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next}
        exportName="disputes" emptyMessage="No disputes in the queue."
      />

      <NewDisputeModal open={showNew} onClose={() => setShowNew(false)} onCreated={() => invalidate('/admin/disputes')} />

      <Drawer open={!!openId} onClose={() => setOpenId(null)} title="Dispute" width="max-w-2xl">
        {detail.isLoading && <div className="flex justify-center py-8"><Spinner /></div>}
        {detail.error && <ErrorState message={errorMessage(detail.error)} />}
        {detail.data && (
          <div className="space-y-5">
            <DescList items={[
              { label: 'Type', value: <Badge tone="blue">{TYPE_LABEL[detail.data.dispute.type] ?? titleCase(detail.data.dispute.type)}</Badge> },
              { label: 'Status', value: <StatusBadge value={detail.data.dispute.status} /> },
              { label: 'Raised by', value: <span className="font-mono text-xs">{detail.data.dispute.raisedBy.slice(0, 8)}</span> },
              { label: 'Against', value: detail.data.dispute.againstUser ? <span className="font-mono text-xs">{detail.data.dispute.againstUser.slice(0, 8)}</span> : '—' },
              { label: 'Assigned to', value: detail.data.dispute.assignedTo ? <span className="font-mono text-xs">{detail.data.dispute.assignedTo.slice(0, 8)}</span> : '—' },
              { label: 'Opened', value: formatDateTime(detail.data.dispute.createdAt) },
            ]} />

            <div>
              <h4 className="mb-1 text-sm font-medium text-slate-700">Reason</h4>
              <p className="text-sm text-slate-600">{detail.data.dispute.reason}</p>
            </div>

            {detail.data.dispute.resolution && (
              <div>
                <h4 className="mb-1 text-sm font-medium text-slate-700">Resolution</h4>
                <p className="text-sm text-slate-600">{detail.data.dispute.resolution}</p>
              </div>
            )}

            <Card className="bg-slate-50 p-3">
              <h4 className="mb-2 text-sm font-medium text-slate-700">Linked context</h4>
              <ContextView ctx={detail.data.context} />
            </Card>

            {/* Actions */}
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <Field label="Assign to (admin user id)">
                <div className="flex items-center gap-2">
                  <Input value={assignTo} onChange={(e) => setAssignTo(e.target.value)} placeholder="uuid" className="flex-1" />
                  <Button variant="secondary" disabled={!assignTo.trim()} loading={patch.isPending} onClick={onAssign}>Assign</Button>
                </div>
              </Field>
              <div>
                <span className="label">Change status</span>
                <div className="flex flex-wrap gap-2">
                  {STATUSES.filter((s) => s !== detail.data!.dispute.status).map((s) => (
                    <Button key={s} variant={s === 'CLOSED' ? 'danger' : s === 'RESOLVED' ? 'primary' : 'secondary'} loading={patch.isPending} onClick={() => onSetStatus(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

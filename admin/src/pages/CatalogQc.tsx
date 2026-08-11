/**
 * Catalog QC — approve / reject seller-proposed catalog entries, and merge
 * duplicates (CATALOG-SPLIT §7).
 *
 * WHY THIS IS A SEPARATE PAGE FROM Products
 * `products` used to be one seller's offer, so "review a product" and "edit the
 * catalogue" were the same act. They are not any more: a catalog row is now
 * SHARED by every Kendra selling that product, so approving one is a decision
 * about what the whole marketplace sees, and merging two silently redirects one
 * product's traffic — and its sellers' offers — into another.
 *
 * SCOPE: CONTENT_MODERATOR, matching the server. Product authoring stays
 * CMS_EDITOR. See backend/src/routes/admin/catalogQc.routes.js for why.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, GitMerge, X, AlertTriangle } from 'lucide-react';
import { apiGet, apiPost, errorMessage } from '../lib/api';
import { PageHeader, Card, Button, Badge, Spinner, ErrorState, Field, Input, Textarea } from '../components/ui';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { formatDate } from '../lib/format';

// ── Types ─────────────────────────────────────────────────────────────────────
interface QcVariant {
  id: string; unit: string; gtin?: string | null; sku?: string | null;
  attributes?: Record<string, unknown> | null;
  _count?: { listings: number };
}
interface QcProduct {
  id: string; name: string; nameHi?: string | null; nameMr?: string | null;
  brand?: string | null; manufacturer?: string | null; modelNumber?: string | null;
  description?: string | null; images: string[]; status: string;
  createdAt: string; normalizedKey: string;
  category?: { id: string; name: string } | null;
  variants: QcVariant[];
  proposedBy?: { id: string; name: string | null; phone: string; kycStatus: string; district?: string | null } | null;
}
interface NearMiss {
  id: string; kind: string; leftId: string; rightId?: string | null;
  similarity?: number | null; leftLabel?: string | null; rightLabel?: string | null; note?: string | null;
}
interface LiveDupe {
  leftId: string; rightId: string; similarity: number;
  leftLabel: string; leftBrand?: string | null;
  rightLabel: string; rightBrand?: string | null;
}

const KIND_TONE: Record<string, 'amber' | 'red' | 'slate' | 'blue'> = {
  SELLER_DUPLICATE: 'amber',
  TRIGRAM_NEIGHBOUR: 'slate',
  NULL_PRICE: 'red',
  CART_ORPHAN: 'red',
  MULTI_VARIANT: 'blue',
  MERGE_CONFLICT: 'amber',
};

// ── QC queue ──────────────────────────────────────────────────────────────────
function QcQueue() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<QcProduct | null>(null);
  const [reason, setReason] = useState('');

  const queue = useQuery({
    queryKey: ['catalog-qc-queue'],
    queryFn: () => apiGet<{ items: QcProduct[] }>('/admin/products/qc/queue', { limit: 50 }).then((r) => r.data.items),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['catalog-qc-queue'] });
    // An approval makes the product visible on the storefront, so the products
    // list is stale too.
    qc.invalidateQueries({ queryKey: ['products'] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => apiPost(`/admin/products/qc/${id}/approve`, {}),
    onSuccess: (res: any) => {
      toast.success(res?.offersActivated ? `Approved — ${res.offersActivated} offer(s) went live` : 'Approved');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiPost(`/admin/products/qc/${id}/reject`, { reason }),
    onSuccess: () => { toast.success('Rejected'); setRejecting(null); setReason(''); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onApprove = async (p: QcProduct) => {
    const { confirmed } = await confirm({
      title: `Approve "${p.name}"?`,
      message: 'Every seller of this product will share this name, description and imagery. Any draft offers already attached to it go live immediately.',
      confirmLabel: 'Approve',
    });
    if (confirmed) approve.mutate(p.id);
  };

  if (queue.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (queue.error) return <ErrorState message="Failed to load the QC queue." />;

  const items = queue.data ?? [];
  if (!items.length) {
    return (
      <Card className="p-8 text-center text-slate-500">
        <Check className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
        Nothing waiting for review.
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-4">
        {items.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex gap-4">
              {p.images?.[0]
                ? <img src={p.images[0]} alt="" className="h-20 w-20 rounded-lg object-cover" />
                : <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">No image</div>}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate font-semibold text-slate-900">{p.name}</h3>
                  <Badge tone="amber">Pending QC</Badge>
                  {p.category ? <Badge>{p.category.name}</Badge> : null}
                </div>

                <p className="mt-0.5 text-sm text-slate-500">
                  {[p.brand, p.manufacturer, p.modelNumber].filter(Boolean).join(' · ') || 'No brand given'}
                </p>
                {p.nameHi || p.nameMr ? (
                  <p className="mt-0.5 text-sm text-slate-500">{[p.nameHi, p.nameMr].filter(Boolean).join(' / ')}</p>
                ) : null}

                {p.description ? (
                  <p className="mt-2 line-clamp-2 text-sm text-slate-600">{p.description}</p>
                ) : null}

                {/* Pack sizes. A catalog entry with no variant can never be sold —
                    no seller has anything to attach an offer to. */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.variants.length ? p.variants.map((v) => (
                    <span key={v.id} className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600">
                      {String((v.attributes as any)?.packSize ?? v.unit)}
                      {v.gtin ? ` · ${v.gtin}` : ''}
                      {v._count?.listings ? ` · ${v._count.listings} offer(s)` : ''}
                    </span>
                  )) : (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                      <AlertTriangle className="h-3 w-3" /> No pack size — nothing can be sold against this
                    </span>
                  )}
                </div>

                <p className="mt-2 text-xs text-slate-400">
                  Proposed by {p.proposedBy?.name || p.proposedBy?.phone || 'unknown'}
                  {p.proposedBy?.district ? ` · ${p.proposedBy.district}` : ''}
                  {p.proposedBy?.kycStatus ? ` · KYC ${p.proposedBy.kycStatus}` : ''}
                  {' · '}{formatDate(p.createdAt)}
                </p>
                <p className="mt-1 truncate font-mono text-[11px] text-slate-300" title={p.normalizedKey}>
                  key: {p.normalizedKey}
                </p>
              </div>

              <div className="flex shrink-0 flex-col gap-2">
                <Button variant="primary" onClick={() => onApprove(p)} disabled={approve.isPending}>
                  <Check className="h-4 w-4" /> Approve
                </Button>
                <Button variant="ghost" onClick={() => { setRejecting(p); setReason(''); }}>
                  <X className="h-4 w-4 text-red-500" /> Reject
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title={`Reject "${rejecting?.name ?? ''}"`}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            The seller sees this reason. Their offers on this product are deactivated and it is removed from every cart.
          </p>
          <Field label="Reason">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="e.g. Duplicate of an existing product / not an agri-input / misleading name" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3 || reject.isPending}
              onClick={() => rejecting && reject.mutate({ id: rejecting.id, reason: reason.trim() })}
            >
              Reject
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ── Duplicates + merge ────────────────────────────────────────────────────────
function DuplicateTools() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [fromId, setFromId] = useState('');
  const [intoId, setIntoId] = useState('');
  const [reason, setReason] = useState('');

  const dupes = useQuery({
    queryKey: ['catalog-duplicates'],
    queryFn: () => apiGet<{ backfillReport: NearMiss[]; liveScan: LiveDupe[] }>('/admin/products/duplicates', { limit: 100 }).then((r) => r.data),
  });

  const merge = useMutation({
    mutationFn: (body: { fromId: string; intoId: string; reason?: string }) => apiPost<any>('/admin/products/merge', body),
    onSuccess: (res: any) => {
      const conflicts = res?.conflicts?.length ?? 0;
      toast.success(conflicts
        ? `Merged — ${conflicts} offer(s) conflicted and were deactivated for review`
        : 'Merged');
      setFromId(''); setIntoId(''); setReason('');
      qc.invalidateQueries({ queryKey: ['catalog-duplicates'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const resolve = useMutation({
    mutationFn: (id: string) => apiPost(`/admin/products/duplicates/${id}/resolve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalog-duplicates'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onMerge = async () => {
    const { confirmed } = await confirm({
      title: 'Merge these products?',
      message:
        'Every offer on the source moves to the target, reviews are repointed, and the source becomes a redirect. '
        + 'A seller who already has an offer on BOTH keeps their duplicate — it is deactivated, not deleted, and shows up here as a conflict. '
        + 'This is not automatically reversible.',
      tone: 'danger',
      confirmLabel: 'Merge',
    });
    if (confirmed) merge.mutate({ fromId: fromId.trim(), intoId: intoId.trim(), reason: reason.trim() || undefined });
  };

  const canMerge = /^[0-9a-f-]{36}$/i.test(fromId.trim()) && /^[0-9a-f-]{36}$/i.test(intoId.trim()) && fromId.trim() !== intoId.trim();

  const report = dupes.data?.backfillReport ?? [];
  const live = dupes.data?.liveScan ?? [];

  const byKind = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of report) m.set(r.kind, (m.get(r.kind) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [report]);

  return (
    <div className="space-y-6">
      {/* Merge tool */}
      <Card className="p-4">
        <h3 className="mb-1 font-semibold text-slate-900">Merge duplicates</h3>
        <p className="mb-4 text-sm text-slate-500">
          Fold one catalog entry into another. Paste the two product ids — pick the surviving one as the target.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Source (becomes a redirect)">
            <Input value={fromId} onChange={(e) => setFromId(e.target.value)} placeholder="product id to merge away" />
          </Field>
          <Field label="Target (survives)">
            <Input value={intoId} onChange={(e) => setIntoId(e.target.value)} placeholder="product id to keep" />
          </Field>
        </div>
        <Field label="Reason (audited)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. same SKU, different pack wording" />
        </Field>
        <div className="mt-3 flex justify-end">
          <Button variant="danger" disabled={!canMerge || merge.isPending} onClick={onMerge}>
            <GitMerge className="h-4 w-4" /> Merge
          </Button>
        </div>
      </Card>

      {dupes.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : dupes.error ? (
        <ErrorState message="Failed to load duplicate candidates." />
      ) : (
        <>
          {/* Migration report */}
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-slate-900">Migration report</h3>
              <span className="text-sm text-slate-500">
                what the catalog-split backfill refused to merge automatically
              </span>
              {byKind.map(([kind, n]) => (
                <Badge key={kind} tone={KIND_TONE[kind] ?? 'default'}>{kind} · {n}</Badge>
              ))}
            </div>

            {!report.length ? (
              <p className="py-6 text-center text-sm text-slate-500">
                Nothing outstanding. (This is also what you see before the backfill has been run.)
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="table-th">Kind</th>
                      <th className="table-th">Left</th>
                      <th className="table-th">Right</th>
                      <th className="table-th">Sim</th>
                      <th className="table-th">Why it was not merged</th>
                      <th className="table-th"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.map((r) => (
                      <tr key={r.id}>
                        <td className="table-td"><Badge tone={KIND_TONE[r.kind] ?? 'default'}>{r.kind}</Badge></td>
                        <td className="table-td">
                          <div className="max-w-[220px] truncate">{r.leftLabel || '—'}</div>
                          <button className="font-mono text-[11px] text-slate-400 hover:text-slate-600"
                            onClick={() => setFromId(r.leftId)} title="Use as merge source">{r.leftId.slice(0, 8)}…</button>
                        </td>
                        <td className="table-td">
                          <div className="max-w-[220px] truncate">{r.rightLabel || '—'}</div>
                          {r.rightId ? (
                            <button className="font-mono text-[11px] text-slate-400 hover:text-slate-600"
                              onClick={() => setIntoId(r.rightId!)} title="Use as merge target">{r.rightId.slice(0, 8)}…</button>
                          ) : null}
                        </td>
                        <td className="table-td">{r.similarity != null ? r.similarity.toFixed(2) : '—'}</td>
                        <td className="table-td max-w-[380px] text-xs text-slate-500">{r.note}</td>
                        <td className="table-td text-right">
                          <Button variant="ghost" onClick={() => resolve.mutate(r.id)}>Dismiss</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Live scan */}
          <Card className="p-4">
            <h3 className="mb-1 font-semibold text-slate-900">Similar names, different products</h3>
            <p className="mb-3 text-sm text-slate-500">
              Live trigram scan over the current catalogue. These pairs sit between the suggest and block
              thresholds, so the duplicate gate let them through — usually a different brand, or a pack size
              baked into the name.
            </p>
            {!live.length ? (
              <p className="py-6 text-center text-sm text-slate-500">No near-duplicates above the threshold.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="table-th">Similarity</th>
                      <th className="table-th">Product A</th>
                      <th className="table-th">Product B</th>
                      <th className="table-th"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {live.map((d) => (
                      <tr key={`${d.leftId}-${d.rightId}`}>
                        <td className="table-td font-medium">{d.similarity.toFixed(2)}</td>
                        <td className="table-td">
                          <div className="max-w-[240px] truncate">{d.leftLabel}</div>
                          <div className="text-xs text-slate-400">{d.leftBrand || 'no brand'}</div>
                        </td>
                        <td className="table-td">
                          <div className="max-w-[240px] truncate">{d.rightLabel}</div>
                          <div className="text-xs text-slate-400">{d.rightBrand || 'no brand'}</div>
                        </td>
                        <td className="table-td text-right">
                          <Button variant="ghost" onClick={() => { setFromId(d.leftId); setIntoId(d.rightId); }}>
                            <GitMerge className="h-4 w-4" /> Load into merge
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function CatalogQcPage() {
  const [tab, setTab] = useState<'queue' | 'dupes'>('queue');

  return (
    <div>
      <PageHeader
        title="Catalog QC"
        subtitle="Approve seller-proposed catalog entries and merge duplicates. A catalog entry is shared by every seller of that product."
      />
      <div className="mb-4 flex gap-2">
        <Button variant={tab === 'queue' ? 'primary' : 'ghost'} onClick={() => setTab('queue')}>Review queue</Button>
        <Button variant={tab === 'dupes' ? 'primary' : 'ghost'} onClick={() => setTab('dupes')}>
          <GitMerge className="h-4 w-4" /> Duplicates
        </Button>
      </div>
      {tab === 'queue' ? <QcQueue /> : <DuplicateTools />}
    </div>
  );
}

export default CatalogQcPage;

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Star, StarOff, Power, Download, Upload, AlertTriangle } from 'lucide-react';
import { apiDelete, apiDownload, apiGet, apiPatch, apiPost, apiUpload, errorMessage } from '../lib/api';
import { useKeyset } from '../lib/useKeyset';
import { useInvalidateList } from '../lib/hooks';
import { PageHeader, Card, Button, Badge, BoolBadge, Spinner, ErrorState, Field, Input, Select } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Toolbar, SearchInput, FilterSelect } from '../components/filters';
import { Modal, Drawer } from '../components/Modal';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { formatINR, formatDate } from '../lib/format';

// ── Categories ────────────────────────────────────────────────────────────────
interface Category { id: string; name: string; nameHi?: string | null; nameMr?: string | null; nameTa?: string | null; nameBn?: string | null; icon?: string | null; color?: string | null; sortOrder: number; isActive: boolean }
const CAT_LANGS: { key: keyof Category; label: string }[] = [
  { key: 'nameHi', label: 'Name (Hindi)' }, { key: 'nameMr', label: 'Name (Marathi)' },
  { key: 'nameTa', label: 'Name (Tamil)' }, { key: 'nameBn', label: 'Name (Bengali)' },
];

export function CategoriesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useQuery({ queryKey: ['categories'], queryFn: () => apiGet<{ items: Category[] }>('/admin/categories').then((r) => r.data.items) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['categories'] });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/admin/categories/${id}`),
    onSuccess: () => { toast.success('Category deleted'); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const onDelete = async (c: Category) => {
    const { confirmed } = await confirm({ title: `Delete "${c.name}"?`, tone: 'danger', confirmLabel: 'Delete' });
    if (confirmed) remove.mutate(c.id);
  };

  return (
    <div>
      <PageHeader title="Categories" subtitle="Marketplace categories — multilingual." actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New category</Button>} />
      {list.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : list.error ? <ErrorState message="Failed to load categories." /> : (
        <Card className="overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="table-th">Name</th><th className="table-th">Hindi</th><th className="table-th">Color</th><th className="table-th">Order</th><th className="table-th">Active</th><th className="table-th"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(list.data ?? []).map((c) => (
                <tr key={c.id}>
                  <td className="table-td font-medium">{c.icon} {c.name}</td>
                  <td className="table-td">{c.nameHi || '—'}</td>
                  <td className="table-td">{c.color ? <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-full" style={{ background: c.color }} />{c.color}</span> : '—'}</td>
                  <td className="table-td">{c.sortOrder}</td>
                  <td className="table-td"><BoolBadge value={c.isActive} trueLabel="Active" falseLabel="Hidden" /></td>
                  <td className="table-td text-right">
                    <Button variant="ghost" onClick={() => setEditing(c)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" onClick={() => onDelete(c)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(list.data ?? []).length === 0 && <p className="py-10 text-center text-sm text-slate-400">No categories yet.</p>}
        </Card>
      )}

      {(creating || editing) && (
        <CategoryForm category={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { setCreating(false); setEditing(null); refresh(); }} />
      )}
    </div>
  );
}

function CategoryForm({ category, onClose, onSaved }: { category: Category | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<Partial<Category>>(category ?? { name: '', sortOrder: 0, isActive: true });
  const set = (k: keyof Category, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => (category ? apiPatch(`/admin/categories/${category.id}`, form) : apiPost('/admin/categories', form)),
    onSuccess: () => { toast.success(category ? 'Category updated' : 'Category created'); onSaved(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Modal open onClose={onClose} title={category ? 'Edit category' : 'New category'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!form.name} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Name (English)"><Input value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          {CAT_LANGS.map((l) => <Field key={l.key} label={l.label}><Input value={(form[l.key] as string) ?? ''} onChange={(e) => set(l.key, e.target.value)} /></Field>)}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Icon (emoji/name)"><Input value={form.icon ?? ''} onChange={(e) => set('icon', e.target.value)} /></Field>
          <Field label="Color (hex)"><Input value={form.color ?? ''} onChange={(e) => set('color', e.target.value)} placeholder="#16a34a" /></Field>
          <Field label="Sort order"><Input type="number" value={form.sortOrder ?? 0} onChange={(e) => set('sortOrder', Number(e.target.value))} /></Field>
        </div>
        <Field label="Status"><Select value={form.isActive ? 'true' : 'false'} onChange={(e) => set('isActive', e.target.value === 'true')}><option value="true">Active</option><option value="false">Hidden</option></Select></Field>
      </div>
    </Modal>
  );
}

// ── Products ──────────────────────────────────────────────────────────────────
interface Product { id: string; name: string; price: number; stock: number; isActive: boolean; isFeatured: boolean; district: string | null; category?: { name: string }; seller?: { name: string | null }; images: string[]; createdAt: string }

export function ProductsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateList();
  const [search, setSearch] = useState('');
  const [activeF, setActiveF] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const params = useMemo(() => { const p: Record<string, unknown> = {}; if (search) p.search = search; if (activeF) p.isActive = activeF; return p; }, [search, activeF]);
  const list = useKeyset<Product>('/admin/products', params);

  // Export the CURRENTLY-FILTERED products (server streams a bounded CSV).
  const onExport = async () => {
    setExporting(true);
    try {
      await apiDownload('/admin/products/export', params, 'products.csv');
    } catch {
      toast.error('Failed to export products');
    } finally {
      setExporting(false);
    }
  };

  const patch = useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) => apiPatch(`/admin/products/${vars.id}`, vars.data),
    onSuccess: () => { toast.success('Product updated'); invalidate('/admin/products'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (vars: { id: string; reason: string }) => apiDelete(`/admin/products/${vars.id}`, { reason: vars.reason }),
    onSuccess: () => { toast.success('Product removed'); setSelected(null); invalidate('/admin/products'); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<Product>[] = [
    { key: 'name', header: 'Product', render: (p) => <span className="font-medium">{p.name}</span>, csv: (p) => p.name },
    { key: 'category', header: 'Category', render: (p) => p.category?.name || '—', csv: (p) => p.category?.name || '' },
    { key: 'price', header: 'Price', render: (p) => formatINR(p.price), csv: (p) => String(p.price) },
    { key: 'stock', header: 'Stock', render: (p) => p.stock, csv: (p) => String(p.stock) },
    { key: 'isActive', header: 'Active', render: (p) => <BoolBadge value={p.isActive} />, csv: (p) => String(p.isActive) },
    { key: 'isFeatured', header: 'Featured', render: (p) => <BoolBadge value={p.isFeatured} />, csv: (p) => String(p.isFeatured) },
  ];

  const onRemove = async (p: Product) => {
    const { confirmed, reason } = await confirm({ title: `Remove "${p.name}"?`, tone: 'danger', message: 'The product is deactivated (soft removal).', requireReason: true, confirmLabel: 'Remove' });
    if (confirmed) remove.mutate({ id: p.id, reason });
  };

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Approve, feature, restock or remove catalogue items."
        actions={
          <>
            <Button variant="secondary" onClick={onExport} loading={exporting}><Download className="h-4 w-4" /> Export CSV</Button>
            <Button variant="primary" onClick={() => setImporting(true)}><Upload className="h-4 w-4" /> Import CSV</Button>
          </>
        }
      />
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Product name…" />
        <FilterSelect label="Active" value={activeF} onChange={setActiveF} options={[{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }]} />
      </Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(p) => p.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        onRowClick={(p) => setSelected(p)} page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} exportName="products" />

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.name || 'Product'}>
        {selected && (
          <div className="space-y-4">
            {selected.images?.[0] && <img src={selected.images[0]} alt="" className="h-40 w-full rounded-lg object-cover" />}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-slate-400">Price</span><div>{formatINR(selected.price)}</div></div>
              <div><span className="text-slate-400">Stock</span><div>{selected.stock}</div></div>
              <div><span className="text-slate-400">Seller</span><div>{selected.seller?.name || '—'}</div></div>
              <div><span className="text-slate-400">Added</span><div>{formatDate(selected.createdAt)}</div></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => patch.mutate({ id: selected.id, data: { isActive: !selected.isActive } })}><Power className="h-4 w-4" /> {selected.isActive ? 'Deactivate' : 'Activate'}</Button>
              <Button variant="secondary" onClick={() => patch.mutate({ id: selected.id, data: { isFeatured: !selected.isFeatured } })}>{selected.isFeatured ? <><StarOff className="h-4 w-4" /> Unfeature</> : <><Star className="h-4 w-4" /> Feature</>}</Button>
              <Button variant="danger" onClick={() => onRemove(selected)} loading={remove.isPending}><Trash2 className="h-4 w-4" /> Remove</Button>
            </div>
          </div>
        )}
      </Drawer>

      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onCommitted={() => { setImporting(false); invalidate('/admin/products'); }}
        />
      )}
    </div>
  );
}

// ── CSV import (dry-run preview → confirm → commit) ─────────────────────────────
interface RowError { row: number; errors: string[] }
interface ImportResult { commit: boolean; applied: boolean; totalRows: number; created: number; updated: number; errored: number; rowErrors: RowError[] }

function ImportModal({ onClose, onCommitted }: { onClose: () => void; onCommitted: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Dry-run: upload, validate, report — writes nothing.
  const dryRun = useMutation({
    mutationFn: (f: File) => apiUpload<ImportResult>('/admin/products/import', f),
    onSuccess: (r) => setPreview(r),
    onError: (e) => toast.error(errorMessage(e)),
  });
  // Commit: re-upload with ?commit=true to apply in a transaction.
  const commit = useMutation({
    mutationFn: (f: File) => apiUpload<ImportResult>('/admin/products/import?commit=true', f),
    onSuccess: (r) => { toast.success(`Imported — ${r.created} created, ${r.updated} updated${r.errored ? `, ${r.errored} skipped` : ''}`); onCommitted(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onPick = (f: File | null) => { setFile(f); setPreview(null); };
  const valid = preview ? preview.created + preview.updated : 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="Import products (CSV)"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {!preview
            ? <Button variant="primary" disabled={!file} loading={dryRun.isPending} onClick={() => file && dryRun.mutate(file)}>Preview</Button>
            : <Button variant="primary" disabled={!file || valid === 0} loading={commit.isPending} onClick={() => file && commit.mutate(file)}>
                Confirm import ({valid} {valid === 1 ? 'row' : 'rows'})
              </Button>}
        </>
      }
    >
      <div className="space-y-4">
        <Field label="CSV file" hint="Columns: id (blank = create), name, nameHi, nameMr, price, mrp, unit, stock, categoryId (id or category name), isActive, isFeatured. Export first to get the exact format.">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="input"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
        </Field>

        {preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="slate">{preview.totalRows} rows</Badge>
              <Badge tone="green">{preview.created} create</Badge>
              <Badge tone="blue">{preview.updated} update</Badge>
              <Badge tone={preview.errored ? 'red' : 'slate'}>{preview.errored} errored</Badge>
              <Badge tone="amber">Dry-run — nothing written yet</Badge>
            </div>
            {preview.rowErrors.length > 0 && (
              <Card className="max-h-64 overflow-y-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50"><tr><th className="table-th">Row</th><th className="table-th">Errors</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.rowErrors.map((re) => (
                      <tr key={re.row}>
                        <td className="table-td font-medium">{re.row}</td>
                        <td className="table-td text-red-600">{re.errors.join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
            {valid === 0 && <ErrorState message="No valid rows to import. Fix the errors above and preview again." />}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Low-stock alerts ───────────────────────────────────────────────────────────
interface LowStockProduct { id: string; name: string; stock: number; isActive: boolean; category?: { name: string } | null; seller?: { id: string; name: string | null } | null }

export function LowStockPage() {
  const [threshold, setThreshold] = useState('');
  const params = useMemo(() => { const p: Record<string, unknown> = {}; if (threshold !== '') p.threshold = threshold; return p; }, [threshold]);
  const list = useKeyset<LowStockProduct>('/admin/inventory/alerts', params);

  const columns: Column<LowStockProduct>[] = [
    { key: 'name', header: 'Product', render: (p) => <span className="font-medium">{p.name}</span>, csv: (p) => p.name },
    { key: 'category', header: 'Category', render: (p) => p.category?.name || '—', csv: (p) => p.category?.name || '' },
    { key: 'seller', header: 'Seller', render: (p) => p.seller?.name || '—', csv: (p) => p.seller?.name || '' },
    { key: 'stock', header: 'Stock', render: (p) => <Badge tone={p.stock <= 0 ? 'red' : 'amber'}>{p.stock}</Badge>, csv: (p) => String(p.stock) },
    { key: 'isActive', header: 'Active', render: (p) => <BoolBadge value={p.isActive} />, csv: (p) => String(p.isActive) },
  ];

  return (
    <div>
      <PageHeader title="Low-stock alerts" subtitle="Active products at or below the low-stock threshold." />
      <Toolbar>
        <Field label="Threshold (override)">
          <Input type="number" min={0} value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="default" className="w-32" />
        </Field>
        {list.items.length > 0 && (
          <span className="inline-flex items-center gap-1 self-end text-sm text-amber-600">
            <AlertTriangle className="h-4 w-4" /> {list.items.length}{list.canNext ? '+' : ''} low-stock on this page
          </span>
        )}
      </Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(p) => p.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} exportName="low-stock" emptyMessage="No low-stock products." />
    </div>
  );
}

// ── Reviews ───────────────────────────────────────────────────────────────────
interface Review { id: string; rating: number; comment: string | null; createdAt: string; user?: { name: string | null }; product?: { name: string } }

export function ReviewsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateList();
  const list = useKeyset<Review>('/admin/reviews', {});

  const remove = useMutation({
    mutationFn: (vars: { id: string; reason: string }) => apiDelete(`/admin/reviews/${vars.id}`, { reason: vars.reason }),
    onSuccess: () => { toast.success('Review deleted'); invalidate('/admin/reviews'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const onDelete = async (r: Review) => {
    const { confirmed, reason } = await confirm({ title: 'Delete review?', tone: 'danger', requireReason: true, confirmLabel: 'Delete' });
    if (confirmed) remove.mutate({ id: r.id, reason });
  };

  const columns: Column<Review>[] = [
    { key: 'product', header: 'Product', render: (r) => r.product?.name || '—', csv: (r) => r.product?.name || '' },
    { key: 'user', header: 'Author', render: (r) => r.user?.name || '—', csv: (r) => r.user?.name || '' },
    { key: 'rating', header: 'Rating', render: (r) => <Badge tone={r.rating >= 3 ? 'green' : 'red'}>{r.rating}★</Badge>, csv: (r) => String(r.rating) },
    { key: 'comment', header: 'Comment', render: (r) => <span className="line-clamp-2 max-w-md">{r.comment || '—'}</span>, csv: (r) => r.comment || '' },
    { key: 'createdAt', header: 'Posted', render: (r) => formatDate(r.createdAt), csv: (r) => r.createdAt },
    { key: 'actions', header: '', render: (r) => <Button variant="ghost" onClick={(e) => { e.stopPropagation(); onDelete(r); }}><Trash2 className="h-4 w-4 text-red-500" /></Button> },
  ];

  return (
    <div>
      <PageHeader title="Reviews" subtitle="Remove abusive or fraudulent reviews." />
      <DataTable columns={columns} items={list.items} rowKey={(r) => r.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} />
    </div>
  );
}

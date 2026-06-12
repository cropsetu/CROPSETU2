import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BadgeCheck, BadgeX } from 'lucide-react';
import { apiPatch, errorMessage } from '../lib/api';
import { useKeyset } from '../lib/useKeyset';
import { useInvalidateList } from '../lib/hooks';
import { PageHeader, Button, StatusBadge, BoolBadge, Select } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Toolbar, SearchInput, FilterSelect } from '../components/filters';
import { useToast } from '../lib/toast';
import { formatINR, formatDate } from '../lib/format';

const LISTING_STATUSES = ['ACTIVE', 'SOLD', 'RENTED', 'INACTIVE'];
const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

function StatusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select className="w-auto py-1 text-xs" value={value} onClick={(e) => e.stopPropagation()} onChange={(e) => onChange(e.target.value)}>
      {LISTING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
    </Select>
  );
}

// ── Animals ───────────────────────────────────────────────────────────────────
interface Animal { id: string; animal: string; breed: string; price: number; verified: boolean; status: string; sellerLocation: string; seller?: { name: string | null }; createdAt: string }

export function AnimalsPage() {
  const toast = useToast();
  const invalidate = useInvalidateList();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const params = useMemo(() => { const p: Record<string, unknown> = {}; if (search) p.search = search; if (status) p.status = status; return p; }, [search, status]);
  const list = useKeyset<Animal>('/admin/animals', params);

  const patch = useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) => apiPatch(`/admin/animals/${vars.id}`, vars.data),
    onSuccess: () => { toast.success('Listing updated'); invalidate('/admin/animals'); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<Animal>[] = [
    { key: 'animal', header: 'Animal', render: (a) => <span className="font-medium">{a.animal}</span>, csv: (a) => a.animal },
    { key: 'breed', header: 'Breed', render: (a) => a.breed, csv: (a) => a.breed },
    { key: 'price', header: 'Price', render: (a) => formatINR(a.price), csv: (a) => String(a.price) },
    { key: 'seller', header: 'Seller', render: (a) => a.seller?.name || '—', csv: (a) => a.seller?.name || '' },
    { key: 'verified', header: 'Verified', render: (a) => <BoolBadge value={a.verified} />, csv: (a) => String(a.verified) },
    { key: 'status', header: 'Status', render: (a) => <StatusSelect value={a.status} onChange={(v) => patch.mutate({ id: a.id, data: { status: v } })} /> },
    { key: 'actions', header: '', render: (a) => (
      <Button variant="ghost" onClick={(e) => { e.stopPropagation(); patch.mutate({ id: a.id, data: { verified: !a.verified } }); }}>
        {a.verified ? <BadgeX className="h-4 w-4 text-slate-400" /> : <BadgeCheck className="h-4 w-4 text-green-600" />}
      </Button>
    )},
  ];

  return (
    <div>
      <PageHeader title="Animal listings" subtitle="Verify and moderate farmer-to-farmer animal trade." />
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Animal, breed or location…" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={LISTING_STATUSES.map((s) => ({ label: s, value: s }))} />
      </Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(a) => a.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} exportName="animals" />
    </div>
  );
}

// ── Machinery / Labour (shared) ──────────────────────────────────────────────
interface OwnerListing { id: string; name: string; status: string; available: boolean; district: string; pricePerDay: number; category?: string; groupName?: string | null; owner?: { name: string | null }; provider?: { name: string | null } }

function OwnerListingPage({ endpoint, title, subtitle, ownerLabel }: { endpoint: string; title: string; subtitle: string; ownerLabel: string }) {
  const toast = useToast();
  const invalidate = useInvalidateList();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const params = useMemo(() => { const p: Record<string, unknown> = {}; if (search) p.search = search; if (status) p.status = status; return p; }, [search, status]);
  const list = useKeyset<OwnerListing>(endpoint, params);

  const patch = useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) => apiPatch(`${endpoint}/${vars.id}`, vars.data),
    onSuccess: () => { toast.success('Listing updated'); invalidate(endpoint); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<OwnerListing>[] = [
    { key: 'name', header: 'Name', render: (l) => <span className="font-medium">{l.groupName || l.name}</span>, csv: (l) => l.groupName || l.name },
    { key: 'owner', header: ownerLabel, render: (l) => l.owner?.name || l.provider?.name || '—', csv: (l) => l.owner?.name || l.provider?.name || '' },
    { key: 'district', header: 'District', render: (l) => l.district, csv: (l) => l.district },
    { key: 'pricePerDay', header: 'Per day', render: (l) => formatINR(l.pricePerDay), csv: (l) => String(l.pricePerDay) },
    { key: 'available', header: 'Available', render: (l) => <BoolBadge value={l.available} />, csv: (l) => String(l.available) },
    { key: 'status', header: 'Status', render: (l) => <StatusSelect value={l.status} onChange={(v) => patch.mutate({ id: l.id, data: { status: v } })} /> },
    { key: 'actions', header: '', render: (l) => <Button variant="ghost" onClick={(e) => { e.stopPropagation(); patch.mutate({ id: l.id, data: { available: !l.available } }); }}>{l.available ? 'Disable' : 'Enable'}</Button> },
  ];

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search…" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={LISTING_STATUSES.map((s) => ({ label: s, value: s }))} />
      </Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(l) => l.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} />
    </div>
  );
}

export function MachineryPage() {
  return <OwnerListingPage endpoint="/admin/machinery" title="Machinery rentals" subtitle="Moderate machinery rental listings." ownerLabel="Owner" />;
}
export function LabourPage() {
  return <OwnerListingPage endpoint="/admin/labour" title="Labour listings" subtitle="Moderate labour/contractor listings." ownerLabel="Provider" />;
}

// ── Bookings ──────────────────────────────────────────────────────────────────
interface Booking { id: string; status: string; totalAmount: number; startDate: string; endDate: string; user?: { name: string | null }; machineryListing?: { name: string } | null; labourListing?: { groupName: string | null; name: string } | null; createdAt: string }

export function BookingsPage() {
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const params = useMemo(() => { const p: Record<string, unknown> = {}; if (status) p.status = status; if (type) p.type = type; return p; }, [status, type]);
  const list = useKeyset<Booking>('/admin/bookings', params);

  const columns: Column<Booking>[] = [
    { key: 'id', header: 'Booking', render: (b) => <span className="font-mono text-xs">{b.id.slice(0, 8)}</span>, csv: (b) => b.id },
    { key: 'user', header: 'Booked by', render: (b) => b.user?.name || '—', csv: (b) => b.user?.name || '' },
    { key: 'listing', header: 'For', render: (b) => b.machineryListing?.name || b.labourListing?.groupName || b.labourListing?.name || '—', csv: (b) => b.machineryListing?.name || b.labourListing?.name || '' },
    { key: 'status', header: 'Status', render: (b) => <StatusBadge value={b.status} />, csv: (b) => b.status },
    { key: 'totalAmount', header: 'Amount', render: (b) => formatINR(b.totalAmount), csv: (b) => String(b.totalAmount) },
    { key: 'dates', header: 'Dates', render: (b) => `${formatDate(b.startDate)} → ${formatDate(b.endDate)}`, csv: (b) => `${b.startDate}..${b.endDate}` },
  ];

  return (
    <div>
      <PageHeader title="Bookings" subtitle="Machinery and labour rental bookings." />
      <Toolbar>
        <FilterSelect label="Status" value={status} onChange={setStatus} options={BOOKING_STATUSES.map((s) => ({ label: s, value: s }))} />
        <FilterSelect label="Type" value={type} onChange={setType} options={[{ label: 'Machinery', value: 'machinery' }, { label: 'Labour', value: 'labour' }]} />
      </Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(b) => b.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} exportName="bookings" />
    </div>
  );
}

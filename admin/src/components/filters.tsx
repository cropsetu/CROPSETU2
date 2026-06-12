/** Toolbar primitives for list screens: debounced search + select filters. */
import { useEffect, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { useDebounced } from '../lib/hooks';

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [local, setLocal] = useState(value);
  const debounced = useDebounced(local, 350);
  useEffect(() => { onChange(debounced); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
      <input className="input pl-8" value={local} onChange={(e) => setLocal(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export interface FilterOption { label: string; value: string }

export function FilterSelect({ label, value, onChange, options, allLabel = 'All' }: {
  label: string; value: string; onChange: (v: string) => void; options: FilterOption[]; allLabel?: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-slate-500">
      <span className="hidden sm:inline">{label}</span>
      <select className="input w-auto py-1.5" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** key/value definition list used in detail drawers/pages. */
export function DescList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={i}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{it.label}</dt>
          <dd className="mt-0.5 text-sm text-slate-800">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

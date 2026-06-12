/** ⌘K / Ctrl-K quick navigation across every admin screen. */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { ALL_NAV_ITEMS } from '../nav';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQ('');
        setActive(0);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return ALL_NAV_ITEMS;
    return ALL_NAV_ITEMS.filter((i) => `${i.label} ${i.keywords ?? ''}`.toLowerCase().includes(term));
  }, [q]);

  if (!open) return null;

  const go = (to: string) => { setOpen(false); navigate(to); };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-24" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
      <div className="card relative z-10 w-full max-w-lg overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter' && results[active]) { go(results[active].to); }
            }}
            placeholder="Jump to…"
            className="w-full bg-transparent py-3 text-sm outline-none"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.map((item, i) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(item.to)}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${i === active ? 'bg-brand-50 text-brand-800' : 'text-slate-700'}`}
                >
                  <Icon className="h-4 w-4 text-slate-400" /> {item.label}
                </button>
              </li>
            );
          })}
          {results.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">No matches</li>}
        </ul>
      </div>
    </div>
  );
}

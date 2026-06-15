/** Persistent layout: grouped left nav + top bar + ⌘K palette. */
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Eye, LogOut, Menu, Search, Sprout, X } from 'lucide-react';
import { NAV } from '../nav';
import { useAuth } from '../lib/auth';
import { useAdminMe, allowedByScope } from '../lib/scopes';
import { useViewAs } from '../lib/viewAs';
import { useConfirm } from './confirm';
import { CommandPalette } from './CommandPalette';
import { Badge } from './ui';

const ENV_NAME = import.meta.env.VITE_ENV_NAME || 'local';
const ENV_TONE = ENV_NAME === 'production' ? 'red' : ENV_NAME === 'staging' ? 'amber' : 'slate';

export function AppShell() {
  const { user, logout } = useAuth();
  const { data: me } = useAdminMe();
  const { active: viewAs, exit: exitViewAs } = useViewAs();
  const confirm = useConfirm();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Cosmetic: hide nav items/groups the admin lacks scope for (server still enforces).
  const groups = NAV
    .map((g) => ({ ...g, items: g.items.filter((it) => allowedByScope(me, it.scope)) }))
    .filter((g) => allowedByScope(me, g.scope) && g.items.length > 0);

  const onLogout = async () => {
    const { confirmed } = await confirm({ title: 'Log out?', message: 'You will need to sign in again with OTP.', confirmLabel: 'Log out' });
    if (confirmed) await logout();
  };

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-slate-200 bg-white transition-transform md:static md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
          <div className="flex items-center gap-2 font-semibold text-brand-800">
            <Sprout className="h-5 w-5" /> CropSetu Admin
          </div>
          <button className="md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
        </div>
        <nav className="h-[calc(100%-3.5rem)] overflow-y-auto px-3 py-3" aria-label="Main">
          {groups.map((group) => (
            <div key={group.title} className="mb-4">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.title}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${isActive ? 'bg-brand-50 font-medium text-brand-800' : 'text-slate-600 hover:bg-slate-100'}`
                        }
                      >
                        <Icon className="h-4 w-4 shrink-0" /> {item.label}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {mobileOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 md:hidden" onClick={() => setMobileOpen(false)} />}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* View-as (impersonation) banner — high-visibility, persistent, READ-ONLY.
            No user token is minted; the admin is just reading the target's data
            through admin endpoints. Exit clears the read-only context. */}
        {viewAs && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-400 px-4 py-2 text-sm font-medium text-amber-950">
            <span className="flex items-center gap-2">
              <Eye className="h-4 w-4 shrink-0" />
              Viewing as <strong>{viewAs.target.name || 'user'}</strong>
              <span className="font-mono text-xs opacity-80">{viewAs.target.id.slice(0, 8)}</span>
              <span className="rounded bg-amber-950/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">Read only</span>
            </span>
            <button onClick={exitViewAs} className="inline-flex items-center gap-1 rounded-md bg-amber-950/10 px-2.5 py-1 text-xs font-semibold hover:bg-amber-950/20">
              <X className="h-3.5 w-3.5" /> Exit
            </button>
          </div>
        )}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
          <div className="flex items-center gap-3">
            <button className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
            <button
              onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
              className="hidden items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-50 sm:flex"
            >
              <Search className="h-3.5 w-3.5" /> Jump to… <kbd className="rounded bg-slate-100 px-1 text-[10px]">⌘K</kbd>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <Badge tone={ENV_TONE}>{ENV_NAME}</Badge>
            <div className="text-right text-sm">
              <div className="font-medium text-slate-800">{user?.name || 'Administrator'}</div>
              <div className="text-xs text-slate-400">{user?.phone || 'ADMIN'}</div>
            </div>
            <button onClick={onLogout} className="btn-ghost" title="Log out" aria-label="Log out"><LogOut className="h-4 w-4" /></button>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}

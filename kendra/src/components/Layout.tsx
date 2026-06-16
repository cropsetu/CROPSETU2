import { Sprout, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';

/** App chrome: a slim top bar (brand + signed-in identity + logout) over content. */
export function Layout({ subtitle, children }: { subtitle?: string; children: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 text-white">
              <Sprout className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight text-slate-900">Krushi Seva Kendra</p>
              <p className="text-xs leading-tight text-slate-500">{subtitle || 'CropSetu partner portal'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {user?.phone && <span className="hidden text-sm text-slate-500 sm:inline">{user.phone}</span>}
            <button
              onClick={() => void logout()}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}

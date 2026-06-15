/**
 * View-as ("impersonation") context — a SPA-wide, READ-ONLY session flag.
 *
 * SECURITY: "view as user" is read-only by construction. The backend never mints
 * a user-scoped token; it returns a short-lived, signed READ-ONLY descriptor
 * (see backend/src/utils/viewAsContext.js). The admin keeps reading the TARGET
 * user's data through the EXISTING admin GET endpoints under the admin's own
 * token — writes as the user are impossible. This context only drives UI: a
 * persistent banner + a flag the UI uses to hide every mutation control while
 * active. It is intentionally NOT persisted (memory only) and auto-clears on
 * expiry, so it never outlives a tab.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface ViewAsContextDescriptor {
  actAs: string;
  adminId: string;
  readOnly: true;
  issuedAt: number;
  expiresAt: number;
}

export interface ViewAsTarget {
  id: string;
  name: string | null;
  role: string;
}

export interface ActiveViewAs {
  token: string;
  context: ViewAsContextDescriptor;
  target: ViewAsTarget;
}

interface ViewAsState {
  active: ActiveViewAs | null;
  /** True while a (non-expired) view-as session is in effect → UI is read-only. */
  isReadOnly: boolean;
  start: (session: ActiveViewAs) => void;
  exit: () => void;
}

const ViewAsCtx = createContext<ViewAsState | null>(null);

export function ViewAsProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveViewAs | null>(null);

  const exit = useCallback(() => setActive(null), []);
  const start = useCallback((session: ActiveViewAs) => setActive(session), []);

  // Auto-clear when the short-lived context expires so a stale read-only banner
  // can never linger. Re-armed whenever the active session changes.
  useEffect(() => {
    if (!active) return;
    const ms = active.context.expiresAt - Date.now();
    if (ms <= 0) { setActive(null); return; }
    const t = window.setTimeout(() => setActive(null), ms);
    return () => window.clearTimeout(t);
  }, [active]);

  const value = useMemo<ViewAsState>(
    () => ({ active, isReadOnly: active !== null, start, exit }),
    [active, start, exit],
  );

  return <ViewAsCtx.Provider value={value}>{children}</ViewAsCtx.Provider>;
}

export function useViewAs(): ViewAsState {
  const ctx = useContext(ViewAsCtx);
  if (!ctx) throw new Error('useViewAs must be used within ViewAsProvider');
  return ctx;
}

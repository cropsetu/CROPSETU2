/** Minimal toast: a context with success/error helpers and a fixed-position stack. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle, X } from 'lucide-react';

type Kind = 'success' | 'error';
interface Toast { id: number; kind: Kind; message: string }
interface ToastApi { success: (m: string) => void; error: (m: string) => void }

const ToastContext = createContext<ToastApi | null>(null);
let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((kind: Kind, message: string) => {
    const id = ++counter;
    setToasts((t) => [...t, { id, kind, message }]);
    window.setTimeout(() => remove(id), 4500);
  }, [remove]);

  const api = useMemo<ToastApi>(() => ({
    success: (m) => push('success', m),
    error: (m) => push('error', m),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-md ${
              t.kind === 'success'
                ? 'border-brand-200 bg-brand-50 text-brand-800'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {t.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="flex-1">{t.message}</span>
            <button onClick={() => remove(t.id)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

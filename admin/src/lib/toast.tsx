/** Minimal global toast system (no external deps). */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; message: string }

interface ToastApi {
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
let counter = 0;

const STYLES: Record<ToastKind, { cls: string; Icon: typeof Info }> = {
  success: { cls: 'border-green-200 bg-green-50 text-green-800', Icon: CheckCircle2 },
  error: { cls: 'border-red-200 bg-red-50 text-red-800', Icon: AlertTriangle },
  info: { cls: 'border-slate-200 bg-white text-slate-700', Icon: Info },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++counter;
    setToasts((t) => [...t, { id, kind, message }]);
    window.setTimeout(() => remove(id), 5000);
  }, [remove]);

  const api: ToastApi = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2" aria-live="polite" role="status">
        {toasts.map(({ id, kind, message }) => {
          const { cls, Icon } = STYLES[kind];
          return (
            <div key={id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-md ${cls}`}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{message}</span>
              <button onClick={() => remove(id)} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

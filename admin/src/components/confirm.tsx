/**
 * Imperative confirm dialog — `const confirm = useConfirm()` then
 * `const { confirmed, reason } = await confirm({ ... })`.
 *
 * Every destructive / irreversible admin action routes through this: it can
 * REQUIRE a typed reason (sent to the audited API) and/or a type-to-confirm
 * phrase before the confirm button enables.
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { Button, Field, Input, Textarea } from './ui';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  tone?: 'default' | 'danger';
  requireReason?: boolean;
  reasonLabel?: string;
  typeToConfirm?: string;
}
export interface ConfirmResult { confirmed: boolean; reason: string }

type Resolver = (r: ConfirmResult) => void;
const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<ConfirmResult>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const resolver = useRef<Resolver | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    setReason('');
    setTyped('');
    return new Promise<ConfirmResult>((resolve) => { resolver.current = resolve; });
  }, []);

  const close = (confirmed: boolean) => {
    resolver.current?.({ confirmed, reason: reason.trim() });
    resolver.current = null;
    setOpts(null);
  };

  const reasonOk = !opts?.requireReason || reason.trim().length > 0;
  const typeOk = !opts?.typeToConfirm || typed === opts.typeToConfirm;
  const canConfirm = reasonOk && typeOk;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!opts}
        onClose={() => close(false)}
        title={opts?.title || ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
            <Button variant={opts?.tone === 'danger' ? 'danger' : 'primary'} disabled={!canConfirm} onClick={() => close(true)}>
              {opts?.confirmLabel || 'Confirm'}
            </Button>
          </>
        }
      >
        {opts?.message && <div className="mb-4 text-sm text-slate-600">{opts.message}</div>}
        {opts?.requireReason && (
          <div className="mb-3">
            <Field label={opts.reasonLabel || 'Reason (recorded in the audit log)'}>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you doing this?" autoFocus />
            </Field>
          </div>
        )}
        {opts?.typeToConfirm && (
          <Field label={<>Type <span className="font-mono font-semibold">{opts.typeToConfirm}</span> to confirm</>}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={opts.typeToConfirm} />
          </Field>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}

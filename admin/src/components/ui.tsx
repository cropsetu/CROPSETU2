/** Lightweight shadcn-style UI primitives (Tailwind, no runtime UI dep). */
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

export const cn = clsx;

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANT: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
};

export function Button({ variant = 'secondary', loading, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button className={cn(VARIANT[variant], className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('card', className)}>{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-slate-400', className)} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ message = 'Nothing to show.' }: { message?: string }) {
  return <div className="py-12 text-center text-sm text-slate-400">{message}</div>;
}

export function ErrorState({ message }: { message: string }) {
  return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>;
}

export function Field({ label, htmlFor, error, hint, children }: { label: ReactNode; htmlFor?: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('input', props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('input', props.className)} />;
}
export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn('input', props.className)}>{children}</select>;
}

// ── Status / role badges ──────────────────────────────────────────────────────
const TONE: Record<string, string> = {
  green: 'bg-green-100 text-green-800',
  red: 'bg-red-100 text-red-700',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-blue-100 text-blue-700',
  slate: 'bg-slate-100 text-slate-600',
  violet: 'bg-violet-100 text-violet-700',
};

export function Badge({ children, tone = 'slate', className }: { children: ReactNode; tone?: keyof typeof TONE; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', TONE[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, keyof typeof TONE> = {
  // generic ok/active
  ACTIVE: 'green', VERIFIED: 'green', DELIVERED: 'green', CONFIRMED: 'green', APPROVED: 'green', COMPLETED: 'green', RESOLVED: 'green', CLOSED: 'slate', paid: 'green',
  // pending / in-progress
  PENDING: 'amber', SUBMITTED: 'amber', SHIPPED: 'blue', INVESTIGATING: 'amber', CONTAINED: 'blue', OPEN: 'amber', pending: 'amber', queued: 'amber', running: 'blue',
  // bad
  REJECTED: 'red', CANCELLED: 'red', REFUNDED: 'violet', INACTIVE: 'slate', failed: 'red',
  // severity
  LOW: 'slate', MEDIUM: 'amber', HIGH: 'red', CRITICAL: 'red',
};

export function StatusBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-400">—</span>;
  return <Badge tone={STATUS_TONE[value] ?? 'slate'}>{value}</Badge>;
}

export function BoolBadge({ value, trueLabel = 'Yes', falseLabel = 'No' }: { value?: boolean | null; trueLabel?: string; falseLabel?: string }) {
  return <Badge tone={value ? 'green' : 'slate'}>{value ? trueLabel : falseLabel}</Badge>;
}

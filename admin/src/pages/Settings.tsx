import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Lock, CheckCircle2, XCircle } from 'lucide-react';
import { apiGet, apiPatch, errorMessage } from '../lib/api';
import { useToast } from '../lib/toast';
import { PageHeader, Card, Button, Input, Select, Badge, Spinner, ErrorState } from '../components/ui';
import { formatUsd, formatNumber } from '../lib/format';

type SettingType = 'STRING' | 'NUMBER' | 'BOOL' | 'JSON' | 'ENUM';
interface EnumOption { value: string; label: string }
interface SettingItem {
  key: string;
  type: SettingType;
  label?: string;
  description?: string;
  value: unknown;
  isDefault: boolean;
  options?: EnumOption[] | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}
interface SettingGroup { category: string; items: SettingItem[] }
interface EnvItem { key: string; secret: boolean; present: boolean }
interface EnvGroup { category: string; items: EnvItem[] }
interface BudgetSummary {
  monthlyBudgetUsdCap: number;
  month: { tokens: number; costUsd: number };
  today: { tokens: number; costUsd: number };
  lifetime: { tokens: number; costUsd: number };
  usagePct: number | null;
  overCap: boolean;
}

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="App Settings"
        subtitle="Runtime config, AI model routing & budget — no redeploy, and secrets are never exposed."
      />
      <div className="space-y-6">
        <BudgetPanel />
        <SettingsGroups />
        <EnvStatusPanel />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function BudgetPanel() {
  const q = useQuery({
    queryKey: ['settings-budget'],
    queryFn: () => apiGet<BudgetSummary>('/admin/settings/budget').then((r) => r.data),
  });
  if (q.isLoading)
    return (
      <Card>
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      </Card>
    );
  if (q.error || !q.data)
    return (
      <Card>
        <ErrorState message={q.error ? errorMessage(q.error) : 'Failed to load AI budget'} />
      </Card>
    );
  const b = q.data;
  const cap = b.monthlyBudgetUsdCap;
  const pct = b.usagePct ?? 0;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">AI Budget — this month</h2>
        {cap > 0 ? (
          <Badge tone={b.overCap ? 'red' : pct >= 80 ? 'amber' : 'green'}>{pct}% of cap</Badge>
        ) : (
          <Badge tone="slate">No cap set</Badge>
        )}
      </div>
      {cap > 0 && (
        <div className="mb-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-2 rounded-full ${b.overCap ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-600'}`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {formatUsd(b.month.costUsd)} of {formatUsd(cap)} monthly budget
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Spend this month" value={formatUsd(b.month.costUsd)} />
        <Metric label="Tokens this month" value={formatNumber(b.month.tokens)} />
        <Metric label="Spend today" value={formatUsd(b.today.costUsd)} />
        <Metric label="Lifetime spend" value={formatUsd(b.lifetime.costUsd)} />
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Set the ceiling below via <span className="font-mono">ai.monthlyBudgetUsdCap</span>. Aggregated from per-user daily AI usage.
      </p>
    </Card>
  );
}

function SettingsGroups() {
  const q = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<{ groups: SettingGroup[] }>('/admin/settings').then((r) => r.data.groups),
  });
  if (q.isLoading)
    return (
      <Card>
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      </Card>
    );
  if (q.error || !q.data)
    return (
      <Card>
        <ErrorState message={q.error ? errorMessage(q.error) : 'Failed to load settings'} />
      </Card>
    );
  return (
    <div className="space-y-5">
      {q.data.map((group) => (
        <Card key={group.category}>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">{group.category}</h2>
          <div className="divide-y divide-slate-100">
            {group.items.map((item) => (
              <SettingRow key={item.key} item={item} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function SettingRow({ item }: { item: SettingItem }) {
  const toast = useToast();
  const qc = useQueryClient();
  const current = item.value;
  const currentStr = current == null ? '' : String(current);
  const [draft, setDraft] = useState<string>(item.type === 'BOOL' ? '' : currentStr);

  const save = useMutation({
    mutationFn: (value: unknown) => apiPatch(`/admin/settings/${encodeURIComponent(item.key)}`, { value }),
    onSuccess: () => {
      toast.success(`${item.label || item.key} saved`);
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['settings-budget'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const changed = item.type !== 'BOOL' && draft !== currentStr;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-[14rem] flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-slate-800">{item.label || item.key}</p>
          {item.isDefault && <Badge tone="slate">default</Badge>}
        </div>
        {item.description && <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>}
        <p className="mt-0.5 font-mono text-[11px] text-slate-400">{item.key}</p>
      </div>
      <div className="flex items-center gap-2">
        {item.type === 'BOOL' ? (
          <Button variant={current ? 'primary' : 'secondary'} loading={save.isPending} onClick={() => save.mutate(!current)}>
            {current ? 'On' : 'Off'}
          </Button>
        ) : item.type === 'ENUM' && item.options ? (
          <>
            <Select value={draft} onChange={(e) => setDraft(e.target.value)} className="w-56">
              {item.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Button variant="primary" disabled={!changed} loading={save.isPending} onClick={() => save.mutate(draft)}>
              Save
            </Button>
          </>
        ) : (
          <>
            <Input
              type={item.type === 'NUMBER' ? 'number' : 'text'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-44"
            />
            <Button
              variant="primary"
              disabled={!changed}
              loading={save.isPending}
              onClick={() => save.mutate(item.type === 'NUMBER' ? Number(draft) : draft)}
            >
              Save
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function EnvStatusPanel() {
  const q = useQuery({
    queryKey: ['settings-env'],
    queryFn: () => apiGet<{ groups: EnvGroup[] }>('/admin/settings/env-status').then((r) => r.data.groups),
  });
  return (
    <Card>
      <div className="mb-1 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-900">Environment status</h2>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Presence of expected environment variables. Values are never read or shown — secrets stay on the server.
      </p>
      {q.isLoading && (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}
      {q.error && <ErrorState message={errorMessage(q.error)} />}
      {q.data && (
        <div className="space-y-4">
          {q.data.map((group) => (
            <div key={group.category}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{group.category}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.items.map((env) => (
                  <div key={env.key} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                    <span className="flex items-center gap-1.5 font-mono text-xs text-slate-700">
                      {env.secret && <Lock className="h-3 w-3 text-slate-400" />}
                      {env.key}
                    </span>
                    {env.present ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-green-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        present
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                        <XCircle className="h-3.5 w-3.5" />
                        absent
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

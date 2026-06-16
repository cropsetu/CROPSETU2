import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Inbox as InboxIcon, ChevronRight, Leaf } from 'lucide-react';
import { apiGet } from '../lib/api';
import { Layout } from '../components/Layout';
import { Badge, Card, Spinner } from '../components/ui';
import type { Share } from '../lib/types';

type Filter = '' | 'PENDING' | 'REPLIED';
const TABS: { key: Filter; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'PENDING', label: 'New' },
  { key: 'REPLIED', label: 'Replied' },
];

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function InboxPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['inbox', filter],
    queryFn: async () => apiGet<Share[]>('/crop-reports/seller/inbox', filter ? { status: filter } : undefined),
  });

  const shares = data?.data || [];
  const unread = data?.meta?.unread ?? 0;

  return (
    <Layout subtitle="Crop diagnosis reports from farmers">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <InboxIcon className="h-5 w-5 text-brand-700" /> Reports inbox
          {unread > 0 && <Badge tone="green">{unread} new</Badge>}
        </h1>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
              filter === t.key ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Spinner label="Loading reports…" />
      ) : isError ? (
        <Card className="p-6 text-center text-sm text-slate-500">Could not load reports. Please refresh.</Card>
      ) : shares.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center text-slate-500">
          <Leaf className="h-8 w-8 text-slate-300" />
          <p className="text-sm">No reports yet. When a nearby farmer sends you a crop-diagnosis report, it will appear here.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {shares.map((s) => {
            const r = s.report;
            const f = s.farmer;
            const unreadDot = !s.readAt;
            return (
              <button
                key={s.id}
                onClick={() => navigate(`/reports/${s.id}`)}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50/30"
              >
                {unreadDot && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="unread" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-slate-900">{r?.primaryDisease || 'Crop report'}</p>
                    {r?.riskLevel && <Badge tone={r.riskLevel.toLowerCase()}>{r.riskLevel}</Badge>}
                    {s.status === 'REPLIED' && <Badge tone="slate">Replied</Badge>}
                    {s.status === 'REPLIED' && s.fulfillment === 'COLLECT' && <Badge tone="green">Collect</Badge>}
                    {s.status === 'REPLIED' && s.fulfillment === 'DELIVERY' && <Badge tone="green">Delivery</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {r?.cropType}{r?.growthStage ? ` · ${r.growthStage}` : ''}
                    {typeof r?.confidenceScore === 'number' ? ` · ${Math.round(r.confidenceScore * 100)}% confidence` : ''}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-400">
                    {f?.name || 'Farmer'}{f?.village ? `, ${f.village}` : ''} · {timeAgo(s.createdAt)}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
              </button>
            );
          })}
        </div>
      )}
    </Layout>
  );
}

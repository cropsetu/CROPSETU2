import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bot, Mic, MessageSquare, Stethoscope, ShoppingCart, CalendarCheck, Star, Eye, EyeOff } from 'lucide-react';
import { apiGet, errorMessage } from '../lib/api';
import { useKeyset } from '../lib/useKeyset';
import { PageHeader, Card, Button, Badge, StatusBadge, Spinner, ErrorState } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Drawer } from '../components/Modal';
import { Toolbar, SearchInput, FilterSelect, DescList } from '../components/filters';
import { useConfirm } from '../components/confirm';
import { formatDate, formatDateTime, relativeTime, formatINR, formatNumber } from '../lib/format';

// ── shared types + helpers ────────────────────────────────────────────────────
type ActivityType = 'ai_chat' | 'voice_session' | 'voice_conversation' | 'diagnosis' | 'order' | 'booking' | 'review';

interface FeedItem {
  id: string;
  type: ActivityType;
  userId: string;
  title: string;
  summary: string | null;
  createdAt: string;
  ref: Record<string, unknown>;
  user: { id: string; name: string | null; phone: string } | null;
}

interface MaskedUser { id: string; name: string | null; phone: string }

const TYPE_META: Record<ActivityType, { label: string; tone: Parameters<typeof Badge>[0]['tone']; icon: typeof Bot }> = {
  ai_chat:            { label: 'AI Chat', tone: 'violet', icon: Bot },
  voice_session:      { label: 'Voice Turn', tone: 'blue', icon: Mic },
  voice_conversation: { label: 'Voice Chat', tone: 'blue', icon: MessageSquare },
  diagnosis:          { label: 'Diagnosis', tone: 'green', icon: Stethoscope },
  order:              { label: 'Order', tone: 'amber', icon: ShoppingCart },
  booking:            { label: 'Booking', tone: 'amber', icon: CalendarCheck },
  review:             { label: 'Review', tone: 'slate', icon: Star },
};

function TypeBadge({ type }: { type: ActivityType }) {
  const m = TYPE_META[type] ?? { label: type, tone: 'slate' as const, icon: Bot };
  const Icon = m.icon;
  return <Badge tone={m.tone}><Icon className="mr-1 h-3 w-3" />{m.label}</Badge>;
}

const FILTER_OPTIONS = (Object.keys(TYPE_META) as ActivityType[]).map((t) => ({ label: TYPE_META[t].label, value: t }));

// ── Activity Feed (cross-user) ────────────────────────────────────────────────
interface FeedMeta { merged?: boolean; capPerType?: number; cappedTypes?: string[]; perTypeFetched?: Record<string, number>; totalFetched?: number; paginated?: boolean }

export function ActivityFeedPage() {
  const navigate = useNavigate();
  const [type, setType] = useState('');
  const [userId, setUserId] = useState('');

  const params = useMemo(() => {
    const p: Record<string, unknown> = {};
    if (type) p.type = type;
    if (userId.trim()) p.userId = userId.trim();
    return p;
  }, [type, userId]);

  const list = useKeyset<FeedItem>('/admin/activity', params);
  const meta = list.meta as FeedMeta | undefined;

  const columns: Column<FeedItem>[] = [
    { key: 'type', header: 'Type', render: (it) => <TypeBadge type={it.type} />, csv: (it) => it.type },
    {
      key: 'user', header: 'User',
      render: (it) => it.user
        ? <button onClick={(e) => { e.stopPropagation(); navigate(`/activity/users/${it.user!.id}`); }} className="text-left hover:underline">
            <span className="block text-slate-800">{it.user.name || 'Unnamed'}</span>
            <span className="block font-mono text-xs text-slate-400">{it.user.phone}</span>
          </button>
        : <span className="text-slate-400">—</span>,
      csv: (it) => it.user ? `${it.user.name ?? ''} ${it.user.phone}` : '',
    },
    { key: 'title', header: 'Activity', render: (it) => <span className="font-medium text-slate-800">{it.title}</span>, csv: (it) => it.title },
    { key: 'summary', header: 'Summary', render: (it) => <span className="text-slate-500">{it.summary || '—'}</span>, csv: (it) => it.summary || '' },
    { key: 'createdAt', header: 'When', render: (it) => <span title={formatDateTime(it.createdAt)}>{relativeTime(it.createdAt)}</span>, csv: (it) => it.createdAt },
  ];

  return (
    <div>
      <PageHeader title="Activity feed" subtitle="What every user is doing — AI & voice chats, diagnoses, orders, bookings and reviews, newest first." />
      <Toolbar>
        <SearchInput value={userId} onChange={setUserId} placeholder="Filter by user ID (UUID)…" />
        <FilterSelect label="Type" value={type} onChange={setType} options={FILTER_OPTIONS} allLabel="All types" />
      </Toolbar>

      {meta?.merged && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Merged across all sources · capped at <b>{meta.capPerType}</b> per type per refresh (no silent truncation).
          {meta.cappedTypes && meta.cappedTypes.length > 0 && (
            <> Hit the cap: <span className="font-medium text-amber-700">{meta.cappedTypes.map((t) => TYPE_META[t as ActivityType]?.label ?? t).join(', ')}</span> — pick that type to page through its full history.</>
          )}
        </div>
      )}

      <DataTable
        columns={columns}
        items={list.items}
        rowKey={(it) => `${it.type}:${it.id}`}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        // Only the single-type view is keyset-paginated; the merged feed is a
        // capped window (prev/next hidden when not paginated).
        page={meta?.paginated ? list.page : undefined}
        canPrev={meta?.paginated ? list.canPrev : undefined}
        canNext={meta?.paginated ? list.canNext : undefined}
        onPrev={list.prev}
        onNext={list.next}
        exportName="activity"
        emptyMessage="No activity matches these filters."
      />
    </div>
  );
}

// ── Per-user 360 ──────────────────────────────────────────────────────────────
interface User360 {
  user: { id: string; name: string | null; phone: string; role: string; district: string | null; state: string | null; createdAt: string; lastActiveAt: string | null };
  counts: { aiConversations: number; voiceSessions: number; voiceConversations: number; diagnoses: number; orders: number; bookings: number; reviews: number };
  recent: {
    aiConversations: { id: string; title: string | null; messageCount: number; isScanSession: boolean; language: string; updatedAt: string }[];
    voiceSessions: { id: string; transcriptionPreview: string | null; durationSeconds: number | null; languageDetected: string | null; conversationId: string | null; createdAt: string }[];
    voiceConversations: { id: string; title: string | null; messageCount: number; language: string; updatedAt: string }[];
    diagnoses: { id: string; cropType: string; primaryDisease: string; riskLevel: string; confidenceScore: number; createdAt: string }[];
    orders: { id: string; status: string; paymentStatus: string; totalAmount: number; createdAt: string }[];
    bookings: { id: string; status: string; totalAmount: number; type: string | null; createdAt: string }[];
    reviews: { id: string; rating: number; comment: string | null; productId: string | null; createdAt: string }[];
  };
}

const COUNT_CARDS: { key: keyof User360['counts']; label: string; type: ActivityType }[] = [
  { key: 'aiConversations', label: 'AI chats', type: 'ai_chat' },
  { key: 'voiceSessions', label: 'Voice turns', type: 'voice_session' },
  { key: 'voiceConversations', label: 'Voice chats', type: 'voice_conversation' },
  { key: 'diagnoses', label: 'Diagnoses', type: 'diagnosis' },
  { key: 'orders', label: 'Orders', type: 'order' },
  { key: 'bookings', label: 'Bookings', type: 'booking' },
  { key: 'reviews', label: 'Reviews', type: 'review' },
];

type ThreadKind = 'ai' | 'voice';

export function UserActivity360Page() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [thread, setThread] = useState<{ kind: ThreadKind; id: string; title: string } | null>(null);

  const q = useQuery({
    queryKey: ['activity-360', id],
    queryFn: () => apiGet<User360>(`/admin/activity/users/${id}`).then((r) => r.data),
  });

  if (q.isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (q.error != null || !q.data) return <ErrorState message={errorMessage(q.error, 'User not found.')} />;

  const { user, counts, recent } = q.data;

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/activity')} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="h-4 w-4" /> Back to activity feed</button>
      <PageHeader
        title={user.name || 'Unnamed user'}
        subtitle={`${user.role} · ${user.district ?? '—'}, ${user.state ?? '—'} · joined ${formatDate(user.createdAt)}`}
      />

      <Card className="p-5">
        <DescList items={[
          { label: 'User ID', value: <span className="font-mono text-xs">{user.id}</span> },
          { label: 'Phone', value: <span className="font-mono">{user.phone}</span> },
          { label: 'Role', value: <Badge tone={user.role === 'ADMIN' ? 'violet' : 'slate'}>{user.role}</Badge> },
          { label: 'Last active', value: relativeTime(user.lastActiveAt) },
        ]} />
      </Card>

      {/* count cards per activity type */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {COUNT_CARDS.map((c) => {
          const Icon = TYPE_META[c.type].icon;
          return (
            <Card key={c.key} className="p-4">
              <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400"><Icon className="h-3.5 w-3.5" /> {c.label}</div>
              <div className="text-2xl font-semibold text-slate-800">{formatNumber(counts[c.key])}</div>
            </Card>
          );
        })}
      </div>

      {/* sectioned recent lists */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="AI chats" icon={Bot} empty="No AI conversations.">
          {recent.aiConversations.map((c) => (
            <Row key={c.id} onClick={() => setThread({ kind: 'ai', id: c.id, title: c.title || 'AI chat' })}>
              <span className="flex-1 truncate text-slate-800">{c.title || 'Untitled chat'}{c.isScanSession && <Badge tone="green" className="ml-2">scan</Badge>}</span>
              <span className="text-xs text-slate-400">{c.messageCount} msg</span>
              <span className="w-20 text-right text-xs text-slate-400">{relativeTime(c.updatedAt)}</span>
            </Row>
          ))}
        </Section>

        <Section title="Voice chats" icon={MessageSquare} empty="No voice conversations.">
          {recent.voiceConversations.map((c) => (
            <Row key={c.id} onClick={() => setThread({ kind: 'voice', id: c.id, title: c.title || 'Voice chat' })}>
              <span className="flex-1 truncate text-slate-800">{c.title || 'Untitled voice chat'}</span>
              <span className="text-xs text-slate-400">{c.messageCount} msg</span>
              <span className="w-20 text-right text-xs text-slate-400">{relativeTime(c.updatedAt)}</span>
            </Row>
          ))}
        </Section>

        <Section title="Voice turns" icon={Mic} empty="No voice turns.">
          {recent.voiceSessions.map((v) => (
            <div key={v.id} className="flex items-start gap-3 py-2 text-sm">
              <span className="flex-1 italic text-slate-500">“{v.transcriptionPreview || '(no transcript)'}”</span>
              <span className="whitespace-nowrap text-xs text-slate-400">{v.durationSeconds != null ? `${Math.round(v.durationSeconds)}s` : '—'}</span>
              <span className="w-20 text-right text-xs text-slate-400">{relativeTime(v.createdAt)}</span>
            </div>
          ))}
        </Section>

        <Section title="Diagnoses" icon={Stethoscope} empty="No disease reports.">
          {recent.diagnoses.map((d) => (
            <div key={d.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="flex-1 truncate text-slate-800">{d.cropType} · {d.primaryDisease}</span>
              <StatusBadge value={d.riskLevel.toUpperCase()} />
              <span className="text-xs text-slate-400">{Math.round((d.confidenceScore ?? 0) * 100)}%</span>
              <span className="w-20 text-right text-xs text-slate-400">{relativeTime(d.createdAt)}</span>
            </div>
          ))}
        </Section>

        <Section title="Orders" icon={ShoppingCart} empty="No orders.">
          {recent.orders.map((o) => (
            <div key={o.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="flex-1 font-mono text-xs text-slate-500">{o.id.slice(0, 8)}</span>
              <StatusBadge value={o.status} />
              <span className="text-slate-700">{formatINR(o.totalAmount)}</span>
              <span className="w-20 text-right text-xs text-slate-400">{relativeTime(o.createdAt)}</span>
            </div>
          ))}
        </Section>

        <Section title="Bookings" icon={CalendarCheck} empty="No bookings.">
          {recent.bookings.map((b) => (
            <div key={b.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="flex-1 font-mono text-xs text-slate-500">{b.id.slice(0, 8)}{b.type && <Badge className="ml-2">{b.type}</Badge>}</span>
              <StatusBadge value={b.status} />
              <span className="text-slate-700">{formatINR(b.totalAmount)}</span>
              <span className="w-20 text-right text-xs text-slate-400">{relativeTime(b.createdAt)}</span>
            </div>
          ))}
        </Section>

        <Section title="Reviews" icon={Star} empty="No reviews.">
          {recent.reviews.map((r) => (
            <div key={r.id} className="flex items-start gap-3 py-2 text-sm">
              <span className="whitespace-nowrap text-amber-600">{'★'.repeat(r.rating)}</span>
              <span className="flex-1 truncate text-slate-600">{r.comment || '(no comment)'}</span>
              <span className="w-20 text-right text-xs text-slate-400">{relativeTime(r.createdAt)}</span>
            </div>
          ))}
        </Section>
      </div>

      {thread && <ThreadDrawer kind={thread.kind} id={thread.id} title={thread.title} onClose={() => setThread(null)} />}
    </div>
  );
}

function Section({ title, icon: Icon, empty, children }: { title: string; icon: typeof Bot; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const isEmpty = items.filter(Boolean).length === 0;
  return (
    <Card className="p-5">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700"><Icon className="h-4 w-4 text-slate-400" /> {title}</h3>
      {isEmpty ? <p className="py-2 text-sm text-slate-400">{empty}</p> : <div className="divide-y divide-slate-100">{children}</div>}
    </Card>
  );
}

function Row({ onClick, children }: { onClick?: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 py-2 text-sm ${onClick ? 'cursor-pointer hover:bg-slate-50' : ''}`}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
    >
      {children}
    </div>
  );
}

// ── Thread drawer (AI or voice messages) with audited reveal ──────────────────
interface AiMessage { id: string; role: string; content: string; messageType: string; tokensUsed: number; modelUsed: string | null; ragUsed: boolean; language: string; createdAt: string }
interface VoiceMessage { id: string; role: string; content: string; durationSeconds: number | null; modelUsed: string | null; language: string; audioInputUrl: string | null; audioOutputUrl: string | null; createdAt: string }

interface ThreadData {
  conversation: { id: string; title: string | null; messageCount: number; language: string; user: MaskedUser | null };
  contentRevealed: boolean;
  messages: (AiMessage | VoiceMessage)[];
}

function ThreadDrawer({ kind, id, title, onClose }: { kind: ThreadKind; id: string; title: string; onClose: () => void }) {
  const confirm = useConfirm();
  const [reveal, setReveal] = useState<{ on: boolean; reason: string }>({ on: false, reason: '' });
  const endpoint = kind === 'ai' ? `/admin/activity/conversations/${id}` : `/admin/activity/voice-conversations/${id}`;

  const q = useQuery({
    queryKey: ['thread', kind, id, reveal.on, reveal.reason],
    queryFn: () => apiGet<ThreadData>(endpoint, reveal.on ? { reveal: true, reason: reveal.reason } : {}).then((r) => r.data),
  });

  const onReveal = async () => {
    if (reveal.on) { setReveal({ on: false, reason: '' }); return; }
    const { confirmed, reason } = await confirm({
      title: 'Reveal message content',
      message: 'The full text of every message in this thread will be decrypted on screen and this access will be written to the audit log.',
      requireReason: true,
      confirmLabel: 'Reveal content',
    });
    if (confirmed) setReveal({ on: true, reason });
  };

  return (
    <Drawer open onClose={onClose} title={title} width="max-w-2xl">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {q.data?.conversation.user && <>{q.data.conversation.user.name || 'Unnamed'} · <span className="font-mono">{q.data.conversation.user.phone}</span> · </>}
          {q.data?.conversation.messageCount ?? 0} messages
          {reveal.on && <Badge tone="amber" className="ml-2">Content revealed (audited)</Badge>}
        </div>
        <Button variant="secondary" onClick={onReveal}>
          {reveal.on ? <><EyeOff className="h-4 w-4" /> Hide content</> : <><Eye className="h-4 w-4" /> Reveal content</>}
        </Button>
      </div>

      {q.isLoading && <div className="flex justify-center py-10"><Spinner /></div>}
      {q.error != null && <ErrorState message={errorMessage(q.error, 'Could not load this thread.')} />}

      {q.data && (
        <div className="space-y-3">
          {q.data.messages.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No messages.</p>}
          {q.data.messages.map((m) => {
            const isUser = m.role === 'user';
            const ai = m as AiMessage;
            const voice = m as VoiceMessage;
            return (
              <div key={m.id} className={`rounded-lg border p-3 ${isUser ? 'border-slate-200 bg-white' : 'border-brand-100 bg-brand-50/40'}`}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <Badge tone={isUser ? 'slate' : 'violet'}>{m.role}</Badge>
                  {m.modelUsed && <span>{m.modelUsed}</span>}
                  {kind === 'ai' && <span>· {formatNumber(ai.tokensUsed)} tok</span>}
                  {kind === 'ai' && ai.ragUsed && <Badge tone="green">RAG</Badge>}
                  {kind === 'voice' && voice.durationSeconds != null && <span>· {Math.round(voice.durationSeconds)}s</span>}
                  <span className="ml-auto">{formatDateTime(m.createdAt)}</span>
                </div>
                <div className={`whitespace-pre-wrap text-sm ${reveal.on ? 'text-slate-800' : 'italic text-slate-500'}`}>{m.content || '—'}</div>
                {kind === 'voice' && reveal.on && (voice.audioInputUrl || voice.audioOutputUrl) && (
                  <div className="mt-1 flex gap-3 text-xs">
                    {voice.audioInputUrl && <a className="text-brand-700 hover:underline" href={voice.audioInputUrl} target="_blank" rel="noreferrer">input audio</a>}
                    {voice.audioOutputUrl && <a className="text-brand-700 hover:underline" href={voice.audioOutputUrl} target="_blank" rel="noreferrer">output audio</a>}
                  </div>
                )}
              </div>
            );
          })}
          {!reveal.on && q.data.messages.length > 0 && (
            <p className="pt-1 text-center text-xs text-slate-400">Content is masked. Use “Reveal content” (audited) to view the full text.</p>
          )}
        </div>
      )}
    </Drawer>
  );
}

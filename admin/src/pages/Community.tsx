import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Pin, PinOff, Trash2, RotateCcw } from 'lucide-react';
import { apiDelete, apiPatch, errorMessage } from '../lib/api';
import { useKeyset } from '../lib/useKeyset';
import { useInvalidateList } from '../lib/hooks';
import { PageHeader, Button, Badge, BoolBadge } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Toolbar, SearchInput, FilterSelect } from '../components/filters';
import { useConfirm } from '../components/confirm';
import { useToast } from '../lib/toast';
import { formatDate, relativeTime } from '../lib/format';

// ── Posts ─────────────────────────────────────────────────────────────────────
interface Post { id: string; title: string; category: string; isPinned: boolean; deletedAt: string | null; createdAt: string; author?: { name: string | null } }

export function PostsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateList();
  const [search, setSearch] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState('');
  const params = useMemo(() => { const p: Record<string, unknown> = {}; if (search) p.search = search; if (includeDeleted) p.includeDeleted = includeDeleted; return p; }, [search, includeDeleted]);
  const list = useKeyset<Post>('/admin/posts', params);

  const patch = useMutation({ mutationFn: (vars: { id: string; data: Record<string, unknown> }) => apiPatch(`/admin/posts/${vars.id}`, vars.data), onSuccess: () => { toast.success('Post updated'); invalidate('/admin/posts'); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (vars: { id: string; reason: string }) => apiDelete(`/admin/posts/${vars.id}`, { reason: vars.reason }), onSuccess: () => { toast.success('Post removed'); invalidate('/admin/posts'); }, onError: (e) => toast.error(errorMessage(e)) });

  const onDelete = async (p: Post) => {
    const { confirmed, reason } = await confirm({ title: 'Remove post?', tone: 'danger', message: 'Soft-deletes the post (hidden from all reads, recoverable).', requireReason: true, confirmLabel: 'Remove' });
    if (confirmed) remove.mutate({ id: p.id, reason });
  };

  const columns: Column<Post>[] = [
    { key: 'title', header: 'Title', render: (p) => <span className={`font-medium ${p.deletedAt ? 'text-slate-400 line-through' : ''}`}>{p.title}</span>, csv: (p) => p.title },
    { key: 'author', header: 'Author', render: (p) => p.author?.name || '—', csv: (p) => p.author?.name || '' },
    { key: 'category', header: 'Category', render: (p) => <Badge>{p.category}</Badge>, csv: (p) => p.category },
    { key: 'isPinned', header: 'Pinned', render: (p) => <BoolBadge value={p.isPinned} />, csv: (p) => String(p.isPinned) },
    { key: 'deletedAt', header: 'State', render: (p) => p.deletedAt ? <Badge tone="red">Deleted</Badge> : <Badge tone="green">Live</Badge>, csv: (p) => (p.deletedAt ? 'deleted' : 'live') },
    { key: 'createdAt', header: 'Posted', render: (p) => formatDate(p.createdAt), csv: (p) => p.createdAt },
    { key: 'actions', header: '', render: (p) => (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {!p.deletedAt && <Button variant="ghost" title={p.isPinned ? 'Unpin' : 'Pin'} onClick={() => patch.mutate({ id: p.id, data: { isPinned: !p.isPinned } })}>{p.isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</Button>}
        {p.deletedAt
          ? <Button variant="ghost" title="Restore" onClick={() => patch.mutate({ id: p.id, data: { restore: true } })}><RotateCcw className="h-4 w-4 text-green-600" /></Button>
          : <Button variant="ghost" title="Remove" onClick={() => onDelete(p)}><Trash2 className="h-4 w-4 text-red-500" /></Button>}
      </div>
    )},
  ];

  return (
    <div>
      <PageHeader title="Community posts" subtitle="Pin, moderate and soft-delete community posts." />
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Title or text…" />
        <FilterSelect label="Show" value={includeDeleted} onChange={setIncludeDeleted} options={[{ label: 'Include deleted', value: 'true' }]} allLabel="Live only" />
      </Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(p) => p.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} />
    </div>
  );
}

// ── Comments ──────────────────────────────────────────────────────────────────
interface Comment { id: string; text: string; createdAt: string; author?: { name: string | null }; post?: { title: string } }

export function CommentsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateList();
  const list = useKeyset<Comment>('/admin/comments', {});
  const remove = useMutation({ mutationFn: (vars: { id: string; reason: string }) => apiDelete(`/admin/comments/${vars.id}`, { reason: vars.reason }), onSuccess: () => { toast.success('Comment deleted'); invalidate('/admin/comments'); }, onError: (e) => toast.error(errorMessage(e)) });
  const onDelete = async (c: Comment) => { const { confirmed, reason } = await confirm({ title: 'Delete comment?', tone: 'danger', requireReason: true, confirmLabel: 'Delete' }); if (confirmed) remove.mutate({ id: c.id, reason }); };

  const columns: Column<Comment>[] = [
    { key: 'text', header: 'Comment', render: (c) => <span className="line-clamp-2 max-w-md">{c.text}</span>, csv: (c) => c.text },
    { key: 'author', header: 'Author', render: (c) => c.author?.name || '—', csv: (c) => c.author?.name || '' },
    { key: 'post', header: 'On post', render: (c) => <span className="line-clamp-1 max-w-xs text-slate-500">{c.post?.title || '—'}</span>, csv: (c) => c.post?.title || '' },
    { key: 'createdAt', header: 'When', render: (c) => relativeTime(c.createdAt), csv: (c) => c.createdAt },
    { key: 'actions', header: '', render: (c) => <Button variant="ghost" onClick={() => onDelete(c)}><Trash2 className="h-4 w-4 text-red-500" /></Button> },
  ];

  return (
    <div>
      <PageHeader title="Comments" subtitle="Remove abusive comments." />
      <DataTable columns={columns} items={list.items} rowKey={(c) => c.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} />
    </div>
  );
}

// ── Groups ────────────────────────────────────────────────────────────────────
interface Group { id: string; name: string; isPublic: boolean; memberCount: number; district: string | null; createdAt: string; createdBy?: { name: string | null }; _count?: { members: number } }

export function GroupsPage() {
  const toast = useToast();
  const invalidate = useInvalidateList();
  const [search, setSearch] = useState('');
  const params = useMemo(() => (search ? { search } : {}), [search]);
  const list = useKeyset<Group>('/admin/groups', params);
  const patch = useMutation({ mutationFn: (vars: { id: string; data: Record<string, unknown> }) => apiPatch(`/admin/groups/${vars.id}`, vars.data), onSuccess: () => { toast.success('Group updated'); invalidate('/admin/groups'); }, onError: (e) => toast.error(errorMessage(e)) });

  const columns: Column<Group>[] = [
    { key: 'name', header: 'Group', render: (g) => <span className="font-medium">{g.name}</span>, csv: (g) => g.name },
    { key: 'createdBy', header: 'Created by', render: (g) => g.createdBy?.name || '—', csv: (g) => g.createdBy?.name || '' },
    { key: 'members', header: 'Members', render: (g) => g._count?.members ?? g.memberCount, csv: (g) => String(g._count?.members ?? g.memberCount) },
    { key: 'isPublic', header: 'Public', render: (g) => <BoolBadge value={g.isPublic} trueLabel="Public" falseLabel="Private" />, csv: (g) => String(g.isPublic) },
    { key: 'createdAt', header: 'Created', render: (g) => formatDate(g.createdAt), csv: (g) => g.createdAt },
    { key: 'actions', header: '', render: (g) => <Button variant="ghost" onClick={() => patch.mutate({ id: g.id, data: { isPublic: !g.isPublic } })}>{g.isPublic ? 'Make private' : 'Make public'}</Button> },
  ];

  return (
    <div>
      <PageHeader title="Groups" subtitle="Manage community groups." />
      <Toolbar><SearchInput value={search} onChange={setSearch} placeholder="Group name…" /></Toolbar>
      <DataTable columns={columns} items={list.items} rowKey={(g) => g.id} isLoading={list.isLoading} isFetching={list.isFetching} error={list.error}
        page={list.page} canPrev={list.canPrev} canNext={list.canNext} onPrev={list.prev} onNext={list.next} />
    </div>
  );
}

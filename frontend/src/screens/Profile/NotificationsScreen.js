/**
 * NotificationsScreen — the farmer's notification inbox.
 *
 * Notifications were already being written by rent, animaltrade, agristore and
 * cropReportShare and delivered as push, but there was no screen to read them
 * back. This is that screen.
 *
 * Each type gets a picture (docs/branding/IMAGE_PROCESS.md §5.19) because the
 * body text is the only other signal and many users cannot read it fluently.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import { COLORS } from '@krushisarva/shared/constants/colors';
import api from '@krushisarva/shared/services/api';
import PhotoIcon from '../../components/PhotoIcon';

const PAGE = 20;

/** Fallback glyph per NotificationType, used until a photo exists for that type. */
const GLYPH = {
  ORDER_UPDATE: 'cube-outline',
  BOOKING_UPDATE: 'calendar-outline',
  NEW_MESSAGE: 'chatbubble-outline',
  NEW_COMMENT: 'chatbubbles-outline',
  POST_LIKE: 'heart-outline',
  SYSTEM: 'notifications-outline',
  CROP_REPORT_RECEIVED: 'document-text-outline',
  CROP_REPORT_REPLIED: 'create-outline',
};

function timeAgo(iso, t) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return t('notif.justNow', 'Just now');
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function NotificationsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (reset = false) => {
    try {
      const res = await api.get('/notifications', {
        params: { limit: PAGE, ...(reset ? {} : cursor ? { cursor } : {}) },
      });
      const d = res.data?.data ?? res.data ?? {};
      const rows = d.items ?? d.rows ?? [];
      setItems(prev => (reset ? rows : [...prev, ...rows]));
      setCursor(d.nextCursor ?? null);
      setHasMore(Boolean(d.hasMore ?? d.nextCursor));
    } catch {
      setHasMore(false);            // offline or failed — stop paging, keep what we have
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [cursor]);

  useEffect(() => { load(true); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const markRead = async (item) => {
    if (item.readAt) return;
    setItems(prev => prev.map(n => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)));
    try { await api.patch(`/notifications/${item.id}/read`); } catch { /* optimistic; retried on next load */ }
  };

  const markAll = async () => {
    setItems(prev => prev.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    try { await api.patch('/notifications/read-all'); } catch { /* optimistic */ }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[S.row, !item.readAt && S.rowUnread]}
      onPress={() => markRead(item)}
      activeOpacity={0.8}
    >
      <PhotoIcon
        set="notif" name={item.type} size={48} radius={10}
        fallback={
          <View style={S.glyphWrap}>
            <Ionicons name={GLYPH[item.type] || 'notifications-outline'} size={22} color={COLORS.primary} />
          </View>
        }
      />
      <View style={S.body}>
        <Text style={[S.title, !item.readAt && S.titleUnread]} numberOfLines={2}>{item.title}</Text>
        {!!item.body && <Text style={S.sub} numberOfLines={2}>{item.body}</Text>}
      </View>
      <View style={S.meta}>
        <Text style={S.time}>{timeAgo(item.createdAt, t)}</Text>
        {!item.readAt && <View style={S.dot} />}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[S.root, { paddingTop: insets.top }]}>
      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={S.h1}>{t('notif.title', 'Notifications')}</Text>
        <TouchableOpacity onPress={markAll} hitSlop={12}>
          <Text style={S.allRead}>{t('notif.markAll', 'Mark all')}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.primary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={n => n.id}
          renderItem={renderItem}
          contentContainerStyle={items.length ? null : S.emptyWrap}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setCursor(null); load(true); }} />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasMore && !loading) load(false); }}
          ListEmptyComponent={
            <View style={S.empty}>
              <PhotoIcon
                set="state" name="empty" size={120} radius={16}
                fallback={<Ionicons name="notifications-off-outline" size={64} color={COLORS.grayMedium} />}
              />
              <Text style={S.emptyTxt}>{t('notif.empty', 'No notifications yet')}</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  h1: { flex: 1, fontSize: 20, fontWeight: '700', color: COLORS.gray900 ?? '#06210d' },
  allRead: { color: COLORS.primary, fontWeight: '600', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border ?? '#d7e1d5' },
  rowUnread: { backgroundColor: '#f2fbf1' },
  glyphWrap: { width: 48, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primaryPale ?? '#e3f5da' },
  body: { flex: 1 },
  title: { fontSize: 14, color: COLORS.gray900 ?? '#06210d' },
  titleUnread: { fontWeight: '700' },
  sub: { fontSize: 12, color: COLORS.grayMedium ?? '#57685a', marginTop: 2 },
  meta: { alignItems: 'flex-end', gap: 6 },
  time: { fontSize: 11, color: COLORS.grayMedium ?? '#57685a' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary },
  emptyWrap: { flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingTop: 60 },
  emptyTxt: { color: COLORS.grayMedium ?? '#57685a', fontSize: 14 },
});

/**
 * VoiceHistoryScreen — list of the farmer's past voice chats.
 *
 * Backend: GET /api/v1/ai/voice/conversations
 * Tap a row → opens the existing VoiceChat screen pre-loaded with the transcript.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SHADOWS, RADIUS } from '../../constants/colors';
import { useLanguage } from '../../context/LanguageContext';
import { getVoiceConversations, deleteVoiceConversation } from '../../services/aiApi';
import { safeErrorMessage } from '../../services/api';

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function VoiceHistoryScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefresh] = useState(false);
  const [error, setError]       = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await getVoiceConversations();
      setItems(rows);
    } catch (e) {
      setError(safeErrorMessage(e, t('voiceHistory.loadFailed', 'Could not load voice chats.')));
    }
  }, [t]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefresh(true);
    await load();
    setRefresh(false);
  };

  const openConversation = (item) => {
    navigation.navigate('VoiceChat', { conversationId: item.id });
  };

  const onDelete = async (id) => {
    try {
      await deleteVoiceConversation(id);
      setItems(items.filter(x => x.id !== id));
    } catch (e) {
      setError(safeErrorMessage(e, t('voiceHistory.deleteFailed', 'Could not delete.')));
    }
  };

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={S.safe}>
      <View style={[S.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.white} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>{t('voiceHistory.title', 'Voice Chat History')}</Text>
          <Text style={S.headerSub}>
            {items.length} {items.length === 1 ? 'chat' : 'chats'}
          </Text>
        </View>
      </View>

      {error ? (
        <View style={S.empty}>
          <Ionicons name="cloud-offline-outline" size={48} color={COLORS.gray175} />
          <Text style={S.emptyTitle}>{error}</Text>
          <TouchableOpacity style={S.retryBtn} onPress={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
            <Text style={S.retryTxt}>{t('retry', 'Retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View style={S.empty}>
          <Ionicons name="mic-outline" size={48} color={COLORS.gray175} />
          <Text style={S.emptyTitle}>{t('voiceHistory.emptyTitle', 'No voice chats yet')}</Text>
          <Text style={S.emptyText}>{t('voiceHistory.emptyText', 'Your voice conversations will appear here.')}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={S.card}
              onPress={() => openConversation(item)}
              activeOpacity={0.85}
            >
              <View style={S.iconCircle}>
                <Ionicons name="mic" size={20} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.title} numberOfLines={1}>
                  {item.title || t('voiceHistory.untitled', 'Voice chat')}
                </Text>
                <View style={S.rowFoot}>
                  <Text style={S.time}>{formatDate(item.updatedAt || item.createdAt)}</Text>
                  <Text style={S.msgCount}>
                    {item._count?.messages ?? item.messageCount ?? 0} msgs
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => onDelete(item.id)} hitSlop={12} style={S.delBtn}>
                <Ionicons name="trash-outline" size={18} color={COLORS.textLight} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const S = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingBottom: 14,
    backgroundColor: COLORS.primary,
  },
  backBtn:     { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white },
  headerSub:   { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 1 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    padding: 12, marginBottom: 10, ...SHADOWS.small,
  },
  iconCircle: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.primary + '15',
    justifyContent: 'center', alignItems: 'center',
  },
  title:    { fontSize: 14, fontWeight: '700', color: COLORS.textDark, marginBottom: 4 },
  rowFoot:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time:     { fontSize: 11, color: COLORS.textLight },
  msgCount: { fontSize: 11, color: COLORS.textMedium, fontWeight: '600' },
  delBtn:   { padding: 6 },

  empty:      { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textDark, textAlign: 'center' },
  emptyText:  { fontSize: 13, color: COLORS.textLight, textAlign: 'center', lineHeight: 20 },
  retryBtn:   { marginTop: 8, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.primary + '15' },
  retryTxt:   { color: COLORS.primary, fontWeight: '700' },
});

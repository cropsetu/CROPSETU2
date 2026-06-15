/**
 * MyAnimalChatsScreen — the user's inbox of animal-trade chats.
 *
 * Launched from the AnimalTradeHome header (the icon that replaced the old
 * "+ Post" button). Calls GET /api/v1/animals/chats/my and renders one row
 * per chat. Tapping a row opens the existing Chat screen with the right
 * listing/seller params.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image,
  ActivityIndicator, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS } from '../../constants/colors';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { connectSocket } from '../../services/socket';
import AnimalIcon from '../../components/AnimalIcons';

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

function ChatRow({ row, onPress }) {
  const { t } = useLanguage();
  const thumb = row.listing?.images?.[0];
  const animalLine = row.listing
    ? `${row.listing.animal}${row.listing.breed ? ' · ' + row.listing.breed : ''}`
    : t('animalChats.listingRemoved');
  const last = row.lastMessage;
  const lastText = last
    ? (last.imageUrl ? t('animalChats.photo') : (last.mine ? t('animalChats.youPrefix') : '') + (last.text || ''))
    : t('animalChats.tapToStart');

  return (
    <TouchableOpacity style={s.row} onPress={() => onPress(row)} activeOpacity={0.7}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={s.thumb} />
      ) : (
        <View style={[s.thumb, s.thumbPlaceholder]}>
          <AnimalIcon type="All" size={48} />
        </View>
      )}
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={s.headerLine}>
          <Text style={s.name} numberOfLines={1}>
            {row.counterpart?.name || (row.role === 'buyer' ? t('animalChats.seller') : t('animalChats.buyer'))}
          </Text>
          <Text style={s.time}>{timeAgo(last?.createdAt || row.updatedAt)}</Text>
        </View>
        <Text style={s.animal} numberOfLines={1}>{animalLine}</Text>
        <Text style={s.preview} numberOfLines={1}>{lastText}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function MyAnimalChatsScreen({ navigation }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [rows,       setRows]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);

  const fetchChats = useCallback(async () => {
    try {
      setError(null);
      const { data } = await api.get('/animals/chats/my');
      setRows(data.data || []);
    } catch (e) {
      setError(e?.response?.data?.error?.message || t('animalChats.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchChats(); }, [fetchChats]));

  // Real-time: listen for new messages on this user's personal socket room
  // (the backend emits to `user:<id>` for both participants when any message
  // is sent). On receipt, update the matching row's preview + float it up.
  // If we receive a `new_message` for a chat we don't yet have (first contact
  // from a buyer), refetch to pick up the new conversation.
  useFocusEffect(useCallback(() => {
    if (!user?.id) return;
    let socketRef = null;
    let onNewMessage;
    let alive = true;

    (async () => {
      try {
        const s = await connectSocket();
        if (!alive) return;
        socketRef = s;

        onNewMessage = (msg) => {
          if (!msg?.chatId) return;
          setRows((prev) => {
            const idx = prev.findIndex(r => r.id === msg.chatId);
            if (idx < 0) {
              // New chat we haven't seen — refetch the full list.
              fetchChats();
              return prev;
            }
            const target = prev[idx];
            const updated = {
              ...target,
              updatedAt: msg.createdAt || new Date().toISOString(),
              lastMessage: {
                text: msg.text,
                imageUrl: msg.imageUrl,
                createdAt: msg.createdAt,
                mine: msg.senderId === user.id,
              },
            };
            // Float to the top.
            return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
          });
        };

        s.on('new_message', onNewMessage);
      } catch { /* socket unavailable; useFocusEffect re-runs handle the rest */ }
    })();

    return () => {
      alive = false;
      if (socketRef && onNewMessage) socketRef.off('new_message', onNewMessage);
    };
  }, [user?.id, fetchChats]));

  const openChat = (row) => {
    navigation.navigate('Chat', {
      listingId: row.listingId,
      sellerName: row.counterpart?.name || (row.role === 'buyer' ? t('animalChats.seller') : t('animalChats.buyer')),
      sellerId: row.counterpart?.id,
      chatId: row.id,
    });
  };

  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.textDark} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('chatWithSeller') || 'Chat with Seller'}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.error} />
          <Text style={s.errorTxt}>{error}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={fetchChats}>
            <Text style={s.retryTxt}>{t('animalChats.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => <ChatRow row={item} onPress={openChat} />}
          ItemSeparatorComponent={() => <View style={s.sep} />}
          contentContainerStyle={rows.length === 0 ? { flex: 1 } : { paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchChats(); }} colors={[COLORS.primary]} />
          }
          ListEmptyComponent={
            <View style={s.center}>
              <Ionicons name="chatbubbles-outline" size={64} color={COLORS.gray175 || COLORS.grayLightMid} />
              <Text style={s.emptyTitle}>{t('animalChats.emptyTitle')}</Text>
              <Text style={s.emptySub}>
                {t('animalChats.emptySub')}
              </Text>
              <TouchableOpacity
                style={[s.retryBtn, { marginTop: 14 }]}
                onPress={() => navigation.navigate('AnimalTradeHome')}
              >
                <Text style={s.retryTxt}>{t('animalChats.browseAnimals')}</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 10 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface, paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    paddingTop: Platform.OS === 'android' ? 44 : 12,
  },
  backBtn:     { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: COLORS.textDark },

  row:        { flexDirection: 'row', padding: 14, backgroundColor: COLORS.surface, alignItems: 'center' },
  thumb:      { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.divider || COLORS.border },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  headerLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  name:       { flex: 1, fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  time:       { fontSize: 11, color: COLORS.textMedium, marginLeft: 8 },
  animal:     { fontSize: 12, color: COLORS.primary, fontWeight: '600', marginBottom: 2 },
  preview:    { fontSize: 13, color: COLORS.textMedium },
  sep:        { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border },

  errorTxt:   { fontSize: 15, color: COLORS.error, textAlign: 'center' },
  retryBtn:   { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  retryTxt:   { color: COLORS.white, fontWeight: '700', fontSize: 15 },

  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textDark, marginTop: 8 },
  emptySub:   { fontSize: 13, color: COLORS.textMedium, textAlign: 'center', paddingHorizontal: 24 },
});

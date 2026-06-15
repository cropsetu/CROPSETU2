/**
 * ChatScreen — single conversation between buyer and seller about a listing.
 *
 * Two entry-points to this screen:
 *   1) From AnimalDetail's "Chat with Seller" button — only `listingId`,
 *      `sellerId`, `sellerName` are passed. We POST /animals/:listingId/chat
 *      to upsert the Chat row, then load messages.
 *   2) From MyAnimalChats inbox — `chatId` is already known, we skip the
 *      upsert and load messages directly.
 *
 * Sends messages via POST /animals/chats/:chatId/messages.
 * Polls every 5s while focused; switch to socket events later without
 * changing the rest of this file (setMessages is idempotent on last id).
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SHADOWS } from '../../constants/colors';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { connectSocket } from '../../services/socket';

const POLL_MS    = 8000;   // socket is primary; polling is fallback only
const MAX_CHARS  = 2000;
const COUNTER_AT = 1800;    // show char counter when within 200 of cap

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Pretty-print an Indian phone number as a last-resort label when a chat
// participant hasn't set a name (OTP signups can have a null name).
function prettyPhone(p) {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, '');
  if (digits.length < 10) return String(p).trim() || null;
  const last10 = digits.slice(-10);
  return `+91 ${last10.slice(0, 5)} ${last10.slice(5)}`;
}

function MessageBubble({ message, isMe, otherInitial, otherAvatarUri, onRetry }) {
  return (
    <View style={[styles.messagRow, isMe && styles.messageRowMe]}>
      {!isMe && (
        <View style={styles.avatarSmall}>
          {otherAvatarUri ? (
            <Image source={{ uri: otherAvatarUri }} style={styles.avatarSmallImg} />
          ) : otherInitial ? (
            <Text style={styles.avatarSmallText}>{otherInitial}</Text>
          ) : (
            <Ionicons name="person" size={16} color={COLORS.textWhite} />
          )}
        </View>
      )}
      <TouchableOpacity
        activeOpacity={message.failed ? 0.6 : 1}
        onPress={() => message.failed && onRetry?.(message)}
        style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, message.failed && styles.bubbleFailed]}
      >
        <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{message.text}</Text>
        <View style={styles.bubbleFooter}>
          <Text style={[styles.bubbleTime, isMe && { color: COLORS.primaryPale }]}>
            {formatTime(message.createdAt)}
          </Text>
          {message.pending ? (
            <Ionicons name="time-outline" size={11} color={isMe ? COLORS.primaryPale : COLORS.textLight} style={{ marginLeft: 4 }} />
          ) : message.failed ? (
            <Text style={styles.failedHint}>· tap to retry</Text>
          ) : isMe ? (
            <Ionicons name="checkmark-done" size={12} color={message.readAt ? '#7DD3FC' : COLORS.primaryPale} style={{ marginLeft: 4 }} />
          ) : null}
        </View>
      </TouchableOpacity>
    </View>
  );
}

// Approximate native stack header + status bar; close enough for the
// KeyboardAvoidingView offset on iOS without pulling in extra deps.
const APPROX_HEADER_OFFSET = Platform.OS === 'ios' ? 88 : 0;

export default function ChatScreen({ route, navigation }) {
  const {
    listingId, chatId: initialChatId,
    // Counterpart info (preferred). `peerRole` is what the OTHER person is
    // relative to this listing — 'seller' when a buyer opens the chat, 'buyer'
    // when the seller opens it from their inbox.
    peerName, peerAvatar, peerRole, peerPhone, listingTitle,
    // Legacy param kept for backward-compatibility with older navigations.
    sellerName,
  } = route.params || {};
  const { t } = useLanguage();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  // ── Resolve who we're talking to (never the current user) ───────────────────
  // NOTE: t() returns the KEY itself when a translation is missing, so the
  // fallback MUST be passed as t()'s 2nd argument (not `t(key) || 'x'`).
  const roleLabel = peerRole === 'seller' ? t('chat.seller', 'Seller')
                  : peerRole === 'buyer'  ? t('chat.buyer',  'Buyer')
                  : null;
  // Prefer a real name; if the counterpart never set one, fall back to their
  // phone number (a usable identifier) before the generic role label.
  const realName =
    (peerName   && String(peerName).trim()) ||
    (sellerName && String(sellerName).trim() && sellerName !== 'Buyer' && sellerName !== 'Seller' ? String(sellerName).trim() : '') ||
    '';
  const phoneLabel = prettyPhone(peerPhone);
  const peerDisplayName = realName || phoneLabel || roleLabel || t('chat.conversation', 'Conversation');
  // Only treat the avatar as an image when it's an actual URL — listings store
  // initials (e.g. "RK") in this field, which must render as a letter instead.
  const peerAvatarUri = typeof peerAvatar === 'string' && /^https?:\/\//i.test(peerAvatar) ? peerAvatar : null;
  // Letter avatar only when we have a real name; otherwise a person icon.
  const peerInitial = realName ? realName.charAt(0).toUpperCase() : null;
  const headerSubtitle = roleLabel || listingTitle || null;

  const [chatId,    setChatId]    = useState(initialChatId || null);
  const [messages,  setMessages]  = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading,   setLoading]   = useState(true);
  const [sending,   setSending]   = useState(false);
  const [error,     setError]     = useState(null);
  const [focused,   setFocused]   = useState(false);

  const flatListRef = useRef(null);
  const pollTimerRef = useRef(null);

  // ── Init ────────────────────────────────────────────────────────────────────
  const init = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      let cid = chatId;
      if (!cid) {
        if (!listingId) throw new Error('Missing listingId');
        const { data } = await api.post(`/animals/${listingId}/chat`);
        cid = data?.data?.id;
        setChatId(cid);
      }
      if (!cid) throw new Error('Failed to open chat');
      const { data: msgs } = await api.get(`/animals/chats/${cid}/messages`, { params: { limit: 100 } });
      setMessages(msgs?.data || []);
    } catch (e) {
      setError(e?.response?.data?.error?.message || e?.message || 'Failed to open chat');
    } finally {
      setLoading(false);
    }
  }, [chatId, listingId]);

  useEffect(() => { init(); }, []);

  // Diff helper: detects changes the cheap last-id check would miss —
  // specifically, readAt updates on existing messages (read receipts).
  const isSameState = useCallback((prev, next) => {
    if (prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i++) {
      const a = prev[i], b = next[i];
      if (!a || !b) return false;
      if (a.id !== b.id) return false;
      // readAt is the only mutable field that comes back from GET — compare it.
      if ((a.readAt || null) !== (b.readAt || null)) return false;
    }
    return true;
  }, []);

  const mergeServerMessages = useCallback((prev, rows) => {
    if (isSameState(prev, rows)) return prev;
    const pending = prev.filter(m => m.pending || m.failed);
    return [...rows, ...pending];
  }, [isSameState]);

  // ── Poll (fallback when socket is disconnected) ─────────────────────────────
  useFocusEffect(useCallback(() => {
    if (!chatId) return;
    pollTimerRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/animals/chats/${chatId}/messages`, { params: { limit: 100 } });
        setMessages(prev => mergeServerMessages(prev, data?.data || []));
      } catch { /* keep polling */ }
    }, POLL_MS);
    return () => clearInterval(pollTimerRef.current);
  }, [chatId, mergeServerMessages]));

  // ── Socket: real-time messages + read receipts ─────────────────────────────
  useFocusEffect(useCallback(() => {
    if (!chatId || !user?.id) return;
    let alive = true;
    let socketRef = null;
    let onNewMessage, onMessagesRead;

    (async () => {
      try {
        const s = await connectSocket();
        if (!alive) return;
        socketRef = s;
        s.emit('join_chat', { chatId });

        // Mark the counterpart's messages as read for THIS user — fires
        // a `messages_read` event back to the room so the other side sees ✓✓ instantly.
        s.emit('mark_read', { chatId });

        onNewMessage = (msg) => {
          if (!msg || msg.chatId !== chatId) return;
          setMessages(prev => {
            // Replace optimistic temp row by senderId+text match, or append.
            const idx = prev.findIndex(m => m.pending && m.senderId === msg.senderId && m.text === msg.text);
            if (idx >= 0) {
              const next = prev.slice();
              next[idx] = msg;
              return next;
            }
            if (prev.some(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          // If the message is from the counterpart, mark read immediately.
          if (msg.senderId !== user.id) s.emit('mark_read', { chatId });
        };

        // Counterpart just read everything we sent — flip our ✓✓ to blue.
        onMessagesRead = ({ chatId: cid, userId: readerId }) => {
          if (cid !== chatId || readerId === user.id) return;
          const now = new Date().toISOString();
          setMessages(prev => prev.map(m =>
            m.senderId === user.id && !m.readAt ? { ...m, readAt: now } : m
          ));
        };

        s.on('new_message', onNewMessage);
        s.on('messages_read', onMessagesRead);
      } catch { /* socket unavailable; HTTP polling covers it */ }
    })();

    return () => {
      alive = false;
      if (socketRef) {
        if (onNewMessage)   socketRef.off('new_message', onNewMessage);
        if (onMessagesRead) socketRef.off('messages_read', onMessagesRead);
      }
    };
  }, [chatId, user?.id]));

  useEffect(() => {
    if (!messages.length) return;
    setTimeout(() => flatListRef.current?.scrollToEnd?.({ animated: true }), 60);
  }, [messages.length]);

  // ── Send (optimistic, with retry) ──────────────────────────────────────────
  const sendMessage = async (text, retryOf = null) => {
    const trimmed = (text || '').trim();
    if (!trimmed || sending || !chatId) return;
    const tempId = retryOf || `temp-${Date.now()}`;
    if (retryOf) {
      // Flip the existing row to pending instead of inserting a new one.
      setMessages(prev => prev.map(m => m.id === retryOf ? { ...m, pending: true, failed: false } : m));
    } else {
      setMessages(prev => [...prev, {
        id: tempId, senderId: user?.id, text: trimmed,
        createdAt: new Date().toISOString(), pending: true,
      }]);
      setInputText('');
    }
    setSending(true);
    try {
      const { data } = await api.post(`/animals/chats/${chatId}/messages`, { text: trimmed });
      const saved = data?.data;
      setMessages(prev => prev.map(m => m.id === tempId ? saved : m));
    } catch {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, pending: false, failed: true } : m));
    } finally {
      setSending(false);
    }
  };

  const retryFailed = (msg) => sendMessage(msg.text, msg.id);

  // ── Key handling — web: Enter sends, Shift+Enter newline ───────────────────
  const onKeyPress = (e) => {
    if (Platform.OS !== 'web') return;
    if (e?.nativeEvent?.key === 'Enter' && !e?.nativeEvent?.shiftKey) {
      e.preventDefault?.();
      sendMessage(inputText);
    }
  };

  // ── Derived UI flags ───────────────────────────────────────────────────────
  const canSend  = !!chatId && !sending && inputText.trim().length > 0;
  const disabled = !chatId || loading;
  const overCap  = inputText.length >= MAX_CHARS;
  const showCount = inputText.length >= COUNTER_AT;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={[styles.chatHeader, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => navigation?.goBack?.()}
          style={styles.backBtn}
          accessibilityLabel={t('common.back', 'Back')}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.textDark} />
        </TouchableOpacity>
        <View style={styles.chatAvatar}>
          {peerAvatarUri ? (
            <Image source={{ uri: peerAvatarUri }} style={styles.chatAvatarImg} />
          ) : peerInitial ? (
            <Text style={styles.chatAvatarText}>{peerInitial}</Text>
          ) : (
            <Ionicons name="person" size={22} color={COLORS.textWhite} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.chatName} numberOfLines={1}>{peerDisplayName}</Text>
          {headerSubtitle ? (
            <Text style={styles.chatSubtitle} numberOfLines={1}>{headerSubtitle}</Text>
          ) : null}
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={APPROX_HEADER_OFFSET}
      >
        {/* Body */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.mutedTxt}>Loading conversation…</Text>
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={48} color={COLORS.error} />
            <Text style={styles.errorTxt}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={init}>
              <Text style={styles.retryTxt}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            windowSize={5}
            maxToRenderPerBatch={10}
            removeClippedSubviews
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                isMe={item.senderId === user?.id}
                otherInitial={peerInitial}
                otherAvatarUri={peerAvatarUri}
                onRetry={retryFailed}
              />
            )}
            contentContainerStyle={messages.length === 0 ? styles.messagesListEmpty : styles.messagesList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="chatbubble-ellipses-outline" size={36} color={COLORS.primary} />
                </View>
                <Text style={styles.emptyTitle}>Say hello 👋</Text>
                <Text style={styles.emptyHint}>
                  Send a message to start the conversation with {peerDisplayName}.
                </Text>
              </View>
            }
          />
        )}

        {/* Composer */}
        <View style={styles.composerWrap}>
          <View style={[styles.composer, focused && styles.composerFocused, disabled && styles.composerDisabled]}>
            <TextInput
              style={styles.input}
              placeholder={
                disabled
                  ? 'Loading…'
                  : (t('chat.typePlaceholder') || 'Type a message…')
              }
              placeholderTextColor={COLORS.textLight}
              value={inputText}
              onChangeText={(v) => setInputText(v.length > MAX_CHARS ? v.slice(0, MAX_CHARS) : v)}
              onFocus={() => setFocused(true)}
              onBlur={()  => setFocused(false)}
              onKeyPress={onKeyPress}
              multiline
              editable={!disabled}
              maxLength={MAX_CHARS}
              blurOnSubmit={false}
              returnKeyType="default"
            />
            <TouchableOpacity
              style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
              onPress={() => sendMessage(inputText)}
              disabled={!canSend}
              accessibilityLabel="Send message"
            >
              {sending
                ? <ActivityIndicator color={COLORS.textWhite} size="small" />
                : <Ionicons name="send" size={18} color={canSend ? COLORS.textWhite : COLORS.textLight} />}
            </TouchableOpacity>
          </View>
          {(showCount || overCap) && (
            <Text style={[styles.charCount, overCap && { color: COLORS.error }]}>
              {inputText.length} / {MAX_CHARS}
            </Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 10 },

  // ── Header ──
  chatHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surface, paddingHorizontal: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  chatAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  chatAvatarImg: { width: 44, height: 44, borderRadius: 22 },
  chatAvatarText: { fontSize: 18, fontWeight: '800', color: COLORS.textWhite },
  chatName: { fontSize: 17, fontWeight: '700', color: COLORS.textDark },
  chatSubtitle: { fontSize: 13, color: COLORS.textMedium, fontWeight: '600', marginTop: 2 },

  // ── Messages list ──
  messagesList:      { padding: 16, paddingBottom: 12 },
  messagesListEmpty: { flexGrow: 1, justifyContent: 'center', padding: 24 },

  // ── Bubbles ──
  messagRow:        { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end', gap: 8 },
  messageRowMe:     { flexDirection: 'row-reverse' },
  avatarSmall:      { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.primaryLight, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarSmallImg:   { width: 32, height: 32, borderRadius: 16 },
  avatarSmallText:  { fontSize: 13, fontWeight: '700', color: COLORS.textWhite },

  bubble:        { maxWidth: '78%', borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
  bubbleMe:      { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleThem:    { backgroundColor: COLORS.surface, borderBottomLeftRadius: 4, ...SHADOWS.small },
  bubbleFailed:  { borderWidth: 1, borderColor: COLORS.error, opacity: 0.9 },
  bubbleText:    { fontSize: 15, color: COLORS.textDark, lineHeight: 21 },
  bubbleTextMe:  { color: COLORS.textWhite },
  bubbleFooter:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 },
  bubbleTime:    { fontSize: 11, color: COLORS.textLight },
  failedHint:    { fontSize: 11, color: COLORS.error, marginLeft: 4, fontWeight: '600' },

  // ── Empty state ──
  emptyWrap:  { alignItems: 'center', gap: 10, paddingHorizontal: 32 },
  emptyIcon:  { width: 76, height: 76, borderRadius: 38, backgroundColor: COLORS.greenBreeze || COLORS.primaryLight, justifyContent: 'center', alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textDark, marginTop: 4 },
  emptyHint:  { fontSize: 14, color: COLORS.textMedium, textAlign: 'center', lineHeight: 20 },
  mutedTxt:   { fontSize: 13, color: COLORS.textMedium },

  // ── Composer ──
  composerWrap: {
    backgroundColor: COLORS.surface,
    borderTopWidth: 1, borderTopColor: COLORS.border,
    paddingHorizontal: 12, paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 8 : 10,
  },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    backgroundColor: COLORS.inputBg, borderRadius: 22,
    borderWidth: 1.5, borderColor: 'transparent',
    paddingLeft: 14, paddingRight: 4, paddingVertical: 4,
  },
  composerFocused:  { borderColor: COLORS.primary, backgroundColor: COLORS.surface },
  composerDisabled: { opacity: 0.6 },

  input: {
    flex: 1,
    paddingVertical: Platform.OS === 'web' ? 10 : 8,
    fontSize: 15, color: COLORS.textDark,
    maxHeight: 120, minHeight: 36,
    // Disable the web default outline since our wrapper shows focus.
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },

  sendBtn:         { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-end', marginBottom: 2 },
  sendBtnDisabled: { backgroundColor: COLORS.border },

  charCount: { alignSelf: 'flex-end', marginTop: 4, marginRight: 6, fontSize: 11, color: COLORS.textLight },

  // ── Error ──
  errorTxt: { fontSize: 14, color: COLORS.error, textAlign: 'center' },
  retryBtn: { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  retryTxt: { color: COLORS.white, fontWeight: '700', fontSize: 15 },
});

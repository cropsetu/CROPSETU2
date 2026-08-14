/**
 * ChatScreen — one buyer↔seller conversation about a listing.
 *
 * The screenshot that started this rework showed a full-screen "Network Error"
 * with a permanently dead composer. That was structural, not cosmetic: `init()`
 * had to succeed to produce a `chatId`, the composer was disabled whenever
 * `chatId` was null, and nothing ever retried. One dropped packet on a village
 * connection and the conversation was over until the user killed the app.
 *
 * What holds now:
 *   • Cached messages paint first, so the thread is readable before the network
 *     is consulted at all.
 *   • Opening the chat retries on its own with exponential backoff + jitter, up
 *     to a bounded number of attempts, and reconnects when the socket returns.
 *   • The composer is only disabled while the very first open is in flight.
 *     After a failure you can still type; the message queues and flushes when
 *     the connection comes back.
 *   • Every message carries a clientMsgId, so a queued retry cannot post twice —
 *     the server's unique (chatId, clientMsgId) index returns the original.
 *   • Errors are specific: no internet / server busy / session expired / seller
 *     unavailable, each with the action that fixes it.
 *
 * Sends via POST /animals/chats/:chatId/messages; socket events are primary for
 * receiving, polling is the fallback.
 */
import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SHADOWS } from '@cropsetu/shared/constants/colors';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import { useAuth } from '@cropsetu/shared/context/AuthContext';
import api from '@cropsetu/shared/services/api';
import { connectSocket } from '@cropsetu/shared/services/socket';
import { classifyError, backoffDelay, ERROR_CODES } from '../../utils/apiError';

const POLL_MS      = 10_000;  // socket is primary; polling is the fallback
const MAX_CHARS    = 2000;
const COUNTER_AT   = 1800;    // show char counter when within 200 of cap
const PAGE_SIZE    = 30;
const MAX_OPEN_ATTEMPTS = 5;
const CACHE_PREFIX = '@animalChat:';
/** Keep the tail of the thread on disk — enough to read, small enough to write. */
const CACHE_MESSAGES = 50;

/** Statuses a locally-owned message can be in. */
const SENDING = 'sending';
const QUEUED  = 'queued';
const FAILED  = 'failed';

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

/** RN-safe unique id for a send attempt. */
function newClientMsgId() {
  try { if (global.crypto?.randomUUID) return global.crypto.randomUUID(); } catch { /* fall through */ }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const MessageBubble = memo(function MessageBubble({ message, isMe, otherInitial, otherAvatarUri, onRetry, t }) {
  const status = message.localStatus;
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
        activeOpacity={status === FAILED ? 0.6 : 1}
        onPress={() => status === FAILED && onRetry?.(message)}
        style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, status === FAILED && styles.bubbleFailed]}
        accessibilityRole={status === FAILED ? 'button' : 'text'}
        accessibilityLabel={[
          message.text,
          status === FAILED ? t('chat.failedTapRetry', 'Not sent. Tap to try again.') : null,
          status === QUEUED ? t('chat.queued', 'Waiting for connection') : null,
        ].filter(Boolean).join('. ')}
      >
        <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{message.text}</Text>
        <View style={styles.bubbleFooter}>
          <Text style={[styles.bubbleTime, isMe && { color: COLORS.primaryPale }]}>
            {formatTime(message.createdAt)}
          </Text>
          {/* Pending → Sent → Read, plus the two offline states. */}
          {status === QUEUED ? (
            <View style={styles.stateRow}>
              <Ionicons name="cloud-offline-outline" size={11} color={isMe ? COLORS.primaryPale : COLORS.textLight} />
              <Text style={[styles.stateTxt, isMe && { color: COLORS.primaryPale }]}>{t('chat.queued', 'Waiting')}</Text>
            </View>
          ) : status === SENDING ? (
            <Ionicons name="time-outline" size={11} color={isMe ? COLORS.primaryPale : COLORS.textLight} style={{ marginLeft: 4 }} />
          ) : status === FAILED ? (
            <Text style={styles.failedHint}>· {t('chat.tapRetry', 'tap to retry')}</Text>
          ) : isMe ? (
            <Ionicons
              name="checkmark-done"
              size={12}
              color={message.readAt ? '#7DD3FC' : COLORS.primaryPale}
              style={{ marginLeft: 4 }}
            />
          ) : null}
        </View>
      </TouchableOpacity>
    </View>
  );
});

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
    : peerRole === 'buyer' ? t('chat.buyer', 'Buyer')
      : null;
  const realName =
    (peerName && String(peerName).trim())
    || (sellerName && String(sellerName).trim() && sellerName !== 'Buyer' && sellerName !== 'Seller' ? String(sellerName).trim() : '')
    || '';
  // A phone number only appears here if the caller already revealed it through
  // the audited endpoint; chat never fetches one of its own.
  const phoneLabel = prettyPhone(peerPhone);
  const peerDisplayName = realName || phoneLabel || roleLabel || t('chat.conversation', 'Conversation');
  const peerAvatarUri = typeof peerAvatar === 'string' && /^https?:\/\//i.test(peerAvatar) ? peerAvatar : null;
  const peerInitial = realName ? realName.charAt(0).toUpperCase() : null;
  const headerSubtitle = roleLabel || listingTitle || null;

  const [chatId, setChatId] = useState(initialChatId || null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  // `opening` is true only for the FIRST open attempt — that is the one moment
  // the composer legitimately has nowhere to put a message.
  const [opening, setOpening] = useState(!initialChatId);
  const [connection, setConnection] = useState('connecting'); // connecting | online | offline
  const [error, setError] = useState(null);
  const [focused, setFocused] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderCursor, setOlderCursor] = useState(null);
  const [hasOlder, setHasOlder] = useState(false);

  const flatListRef = useRef(null);
  const pollTimerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const attemptRef = useRef(0);
  const aliveRef = useRef(true);
  const socketRef = useRef(null);
  /** Messages typed while offline, flushed in order once a chat exists. */
  const outboxRef = useRef([]);

  useEffect(() => () => {
    aliveRef.current = false;
    clearTimeout(retryTimerRef.current);
    clearInterval(pollTimerRef.current);
  }, []);

  const cacheKey = chatId ? `${CACHE_PREFIX}${chatId}` : (listingId ? `${CACHE_PREFIX}listing:${listingId}` : null);

  // ── Cache: paint the thread before touching the network ────────────────────
  useEffect(() => {
    if (!cacheKey) return;
    let alive = true;
    AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (!alive || !raw) return;
        const rows = JSON.parse(raw);
        if (!Array.isArray(rows) || rows.length === 0) return;
        // Only seed; never clobber messages already fetched or typed.
        setMessages((prev) => (prev.length ? prev : rows));
      })
      .catch(() => { /* a missing cache is not an error */ });
    return () => { alive = false; };
  }, [cacheKey]);

  const persist = useCallback((rows) => {
    if (!cacheKey) return;
    const keep = rows.filter((m) => !m.localStatus).slice(-CACHE_MESSAGES);
    AsyncStorage.setItem(cacheKey, JSON.stringify(keep)).catch(() => {});
  }, [cacheKey]);

  /**
   * Merge a server page into local state.
   *
   * Server rows win over the optimistic copy of the SAME message (matched on
   * clientMsgId), which is how a bubble goes from "sending" to a real ✓ without
   * ever appearing twice.
   */
  const mergeServer = useCallback((prev, rows) => {
    const byClientId = new Map(rows.filter((r) => r.clientMsgId).map((r) => [r.clientMsgId, r]));
    const serverIds = new Set(rows.map((r) => r.id));
    const locals = prev.filter((m) => (
      m.localStatus
      && !serverIds.has(m.id)
      && !(m.clientMsgId && byClientId.has(m.clientMsgId))
    ));
    return [...rows, ...locals];
  }, []);

  // ── Open the chat (with bounded, jittered retry) ───────────────────────────
  const open = useCallback(async ({ manual = false } = {}) => {
    if (manual) attemptRef.current = 0;
    setError(null);
    try {
      let cid = chatId;
      if (!cid) {
        if (!listingId) throw Object.assign(new Error('Missing listingId'), { fatal: true });
        const { data } = await api.post(`/animals/${listingId}/chat`);
        cid = data?.data?.id;
        if (!cid) throw new Error('Failed to open chat');
        if (!aliveRef.current) return;
        setChatId(cid);
      }

      const { data: page } = await api.get(`/animals/chats/${cid}/messages`, { params: { limit: PAGE_SIZE } });
      if (!aliveRef.current) return;
      const rows = page?.data || [];
      setMessages((prev) => mergeServer(prev, rows));
      persist(rows);
      setHasOlder(!!page?.meta?.hasMore);
      setOlderCursor(page?.meta?.nextCursor || null);
      setConnection('online');
      setOpening(false);
      attemptRef.current = 0;
    } catch (e) {
      if (!aliveRef.current) return;
      const classified = classifyError(e, t('chat.openFailed', 'Could not open this conversation.'));
      if (classified.code === ERROR_CODES.CANCELED) return;
      setError(classified);
      setConnection('offline');
      setOpening(false);

      // Auto-retry only what retrying can fix. A 403 (blocked seller) or a 404
      // will never succeed, and hammering them is pure noise.
      const worthRetrying = classified.retryable || classified.code === ERROR_CODES.RATE_LIMIT;
      if (worthRetrying && attemptRef.current < MAX_OPEN_ATTEMPTS && !e?.fatal) {
        const delay = backoffDelay(attemptRef.current++);
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => { if (aliveRef.current) open(); }, delay);
      }
    }
  }, [chatId, listingId, mergeServer, persist, t]);

  useEffect(() => { open(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** POST one already-optimistic message and reconcile its bubble. */
  const deliver = useCallback(async (msg) => {
    setMessages((prev) => prev.map((m) => (m.clientMsgId === msg.clientMsgId ? { ...m, localStatus: SENDING } : m)));
    try {
      const { data } = await api.post(`/animals/chats/${msg.chatId}/messages`, {
        text: msg.text,
        clientMsgId: msg.clientMsgId,
      });
      const saved = data?.data;
      if (!aliveRef.current) return;
      setMessages((prev) => prev.map((m) => (
        m.clientMsgId === msg.clientMsgId ? { ...saved, clientMsgId: msg.clientMsgId } : m
      )));
      setConnection('online');
      setError(null);
    } catch (e) {
      if (!aliveRef.current) return;
      const classified = classifyError(e, t('chat.sendFailed', 'Message not sent.'));
      // Offline is not a failure — hold the message and try again on reconnect.
      const queue = classified.code === ERROR_CODES.OFFLINE || classified.code === ERROR_CODES.TIMEOUT;
      if (queue) outboxRef.current.push(msg);
      setMessages((prev) => prev.map((m) => (
        m.clientMsgId === msg.clientMsgId ? { ...m, localStatus: queue ? QUEUED : FAILED } : m
      )));
      setError(classified);
      if (queue) setConnection('offline');
    }
  }, [t]);

  // ── Outbox: flush anything typed while the chat was unreachable ────────────
  const flushOutbox = useCallback(async () => {
    if (!chatId || outboxRef.current.length === 0) return;
    // Drain first: a failure re-queues that specific message inside deliver()
    // rather than replaying the whole batch.
    const batch = outboxRef.current;
    outboxRef.current = [];
    for (const queued of batch) {
      // A message typed before the chat row existed has no chatId yet.
      await deliver({ ...queued, chatId });
    }
  }, [chatId, deliver]);

  useEffect(() => { if (chatId && connection === 'online') flushOutbox(); }, [chatId, connection, flushOutbox]);

  // ── Poll (fallback when the socket is down) ────────────────────────────────
  useFocusEffect(useCallback(() => {
    if (!chatId) return undefined;
    pollTimerRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/animals/chats/${chatId}/messages`, { params: { limit: PAGE_SIZE } });
        if (!aliveRef.current) return;
        const rows = data?.data || [];
        setMessages((prev) => mergeServer(prev, rows));
        persist(rows);
        setConnection('online');
        setError((e) => (e?.retryable ? null : e)); // a poll succeeding clears a transient error
      } catch {
        if (aliveRef.current) setConnection('offline');
      }
    }, POLL_MS);
    return () => clearInterval(pollTimerRef.current);
  }, [chatId, mergeServer, persist]));

  // ── Socket: real-time messages + read receipts ─────────────────────────────
  useFocusEffect(useCallback(() => {
    if (!chatId || !user?.id) return undefined;
    let alive = true;
    let s = null;
    let onNewMessage, onMessagesRead, onConnect, onDisconnect;

    (async () => {
      try {
        s = await connectSocket();
        if (!alive) return;
        socketRef.current = s;
        s.emit('join_chat', { chatId });
        s.emit('mark_read', { chatId });
        setConnection('online');

        onNewMessage = (msg) => {
          if (!msg || msg.chatId !== chatId) return;
          setMessages((prev) => {
            // Resolve our own optimistic bubble by clientMsgId — an id match is
            // exact, unlike the old senderId+text guess which collapsed two
            // identical messages ("ok" twice) into one.
            const idx = msg.clientMsgId
              ? prev.findIndex((m) => m.clientMsgId === msg.clientMsgId)
              : prev.findIndex((m) => m.localStatus && m.senderId === msg.senderId && m.text === msg.text);
            if (idx >= 0) {
              const next = prev.slice();
              next[idx] = msg;
              return next;
            }
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          if (msg.senderId !== user.id) s.emit('mark_read', { chatId });
        };

        onMessagesRead = ({ chatId: cid, userId: readerId }) => {
          if (cid !== chatId || readerId === user.id) return;
          const now = new Date().toISOString();
          setMessages((prev) => prev.map((m) => (
            m.senderId === user.id && !m.readAt ? { ...m, readAt: now } : m
          )));
        };

        // The socket layer reconnects on its own; when it does, re-join the room
        // and re-sync, because messages sent while we were away were broadcast
        // to a room we were not in.
        onConnect = () => {
          if (!alive) return;
          setConnection('online');
          s.emit('join_chat', { chatId });
          open();
        };
        onDisconnect = () => { if (alive) setConnection('offline'); };

        s.on('new_message', onNewMessage);
        s.on('messages_read', onMessagesRead);
        s.on('connect', onConnect);
        s.on('disconnect', onDisconnect);
      } catch {
        if (alive) setConnection('offline'); // HTTP polling covers it
      }
    })();

    return () => {
      alive = false;
      if (s) {
        if (onNewMessage)   s.off('new_message', onNewMessage);
        if (onMessagesRead) s.off('messages_read', onMessagesRead);
        if (onConnect)      s.off('connect', onConnect);
        if (onDisconnect)   s.off('disconnect', onDisconnect);
      }
    };
  }, [chatId, user?.id])); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!messages.length) return undefined;
    const id = setTimeout(() => flatListRef.current?.scrollToEnd?.({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [messages.length]);

  // Keep the on-disk tail current, including messages we just sent — that is
  // what makes the thread readable the next time the app opens with no signal.
  // persist() drops locally-owned rows, so a queued message is never mistaken
  // for a delivered one after a restart.
  useEffect(() => { if (messages.length) persist(messages); }, [messages, persist]);

  // ── Older messages ─────────────────────────────────────────────────────────
  const loadOlder = useCallback(async () => {
    if (!chatId || !hasOlder || loadingOlder || !olderCursor) return;
    setLoadingOlder(true);
    try {
      const { data } = await api.get(`/animals/chats/${chatId}/messages`, {
        params: { limit: PAGE_SIZE, before: olderCursor },
      });
      if (!aliveRef.current) return;
      const rows = data?.data || [];
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        return [...rows.filter((r) => !known.has(r.id)), ...prev];
      });
      setHasOlder(!!data?.meta?.hasMore);
      setOlderCursor(data?.meta?.nextCursor || null);
    } catch {
      /* keep what is on screen; the button stays available */
    } finally {
      if (aliveRef.current) setLoadingOlder(false);
    }
  }, [chatId, hasOlder, loadingOlder, olderCursor]);

  // ── Send ───────────────────────────────────────────────────────────────────
  const sendMessage = useCallback((text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return;

    const msg = {
      id: `local-${newClientMsgId()}`,
      clientMsgId: newClientMsgId(),
      chatId,
      senderId: user?.id,
      text: trimmed,
      createdAt: new Date().toISOString(),
      localStatus: chatId ? SENDING : QUEUED,
    };
    setMessages((prev) => [...prev, msg]);
    setInputText('');

    // No chat row yet (the open is still failing) — hold it and keep trying to
    // open. This is the case that used to lock the composer forever.
    if (!chatId) {
      outboxRef.current.push(msg);
      open();
      return;
    }
    deliver(msg);
  }, [chatId, user?.id, deliver, open]);

  const retryFailed = useCallback((msg) => {
    if (!chatId) { outboxRef.current.push(msg); open({ manual: true }); return; }
    deliver({ ...msg, chatId });
  }, [chatId, deliver, open]);

  // ── Key handling — web: Enter sends, Shift+Enter newline ───────────────────
  const onKeyPress = (e) => {
    if (Platform.OS !== 'web') return;
    if (e?.nativeEvent?.key === 'Enter' && !e?.nativeEvent?.shiftKey) {
      e.preventDefault?.();
      sendMessage(inputText);
    }
  };

  // ── Derived UI flags ───────────────────────────────────────────────────────
  // The composer is live unless this is the very first open. Everything else —
  // no signal, server down, a failed open being retried — still accepts typing;
  // the message queues.
  const composerDisabled = opening;
  const canSend  = !composerDisabled && inputText.trim().length > 0;
  const overCap  = inputText.length >= MAX_CHARS;
  const showCount = inputText.length >= COUNTER_AT;
  const queuedCount = messages.filter((m) => m.localStatus === QUEUED).length;

  /** The one-line status bar under the header. */
  const banner = (() => {
    if (error?.code === ERROR_CODES.AUTH) {
      return { tone: 'error', icon: 'log-in-outline', text: t('chat.sessionExpired', 'Session expired. Please sign in again.'), action: { label: t('signIn', 'Sign in'), onPress: () => navigation.navigate('Login') } };
    }
    if (error?.code === ERROR_CODES.FORBIDDEN) {
      return { tone: 'error', icon: 'ban-outline', text: t('chat.sellerUnavailable', 'This seller is not available.'), action: null };
    }
    if (error?.code === ERROR_CODES.NOT_FOUND) {
      return { tone: 'error', icon: 'alert-circle-outline', text: t('chat.chatGone', 'This conversation is no longer available.'), action: null };
    }
    if (error?.code === ERROR_CODES.RATE_LIMIT) {
      return { tone: 'warn', icon: 'hourglass-outline', text: error.message, action: null };
    }
    if (error?.code === ERROR_CODES.MAINTENANCE || error?.code === ERROR_CODES.SERVER) {
      return { tone: 'warn', icon: 'server-outline', text: t('chat.serverBusy', 'Server is busy. Retrying…'), action: { label: t('retry', 'Retry'), onPress: () => open({ manual: true }) } };
    }
    if (connection === 'offline') {
      return {
        tone: 'warn',
        icon: 'cloud-offline-outline',
        text: queuedCount > 0
          ? t('chat.offlineQueued', '{{n}} message waiting to send').replace('{{n}}', queuedCount)
          : t('chat.offline', 'No internet connection'),
        action: { label: t('retry', 'Retry'), onPress: () => open({ manual: true }) },
      };
    }
    return null;
  })();

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {/* Header */}
      <View style={[styles.chatHeader, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => navigation?.goBack?.()}
          style={styles.backBtn}
          accessibilityRole="button"
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

      {banner ? (
        <View
          style={[styles.banner, banner.tone === 'error' ? styles.bannerError : styles.bannerWarn]}
          accessibilityRole="alert"
        >
          <Ionicons
            name={banner.icon}
            size={15}
            color={banner.tone === 'error' ? COLORS.error : COLORS.warning}
          />
          <Text style={styles.bannerTxt} numberOfLines={2}>{banner.text}</Text>
          {banner.action ? (
            <TouchableOpacity onPress={banner.action.onPress} hitSlop={8} accessibilityRole="button">
              <Text style={styles.bannerAction}>{banner.action.label}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={APPROX_HEADER_OFFSET}
      >
        {/* Body. Note there is no full-screen error state any more: even a
            failed open leaves the (possibly cached) thread and the composer
            usable, with the banner above explaining what is wrong. */}
        {opening && messages.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.mutedTxt}>{t('chat.loading', 'Loading conversation…')}</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            windowSize={7}
            initialNumToRender={20}
            maxToRenderPerBatch={12}
            removeClippedSubviews
            data={messages}
            keyExtractor={(item) => item.clientMsgId || item.id}
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                isMe={item.senderId === user?.id}
                otherInitial={peerInitial}
                otherAvatarUri={peerAvatarUri}
                onRetry={retryFailed}
                t={t}
              />
            )}
            contentContainerStyle={messages.length === 0 ? styles.messagesListEmpty : styles.messagesList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={hasOlder ? (
              <TouchableOpacity style={styles.olderBtn} onPress={loadOlder} disabled={loadingOlder} accessibilityRole="button">
                {loadingOlder
                  ? <ActivityIndicator size="small" color={COLORS.primary} />
                  : <Text style={styles.olderTxt}>{t('chat.loadOlder', 'Load older messages')}</Text>}
              </TouchableOpacity>
            ) : null}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="chatbubble-ellipses-outline" size={36} color={COLORS.primary} />
                </View>
                <Text style={styles.emptyTitle}>{t('chat.sayHello', 'Say hello 👋')}</Text>
                <Text style={styles.emptyHint}>
                  {t('chat.startHint', 'Send a message to start the conversation with {{name}}.')
                    .replace('{{name}}', peerDisplayName)}
                </Text>
              </View>
            }
          />
        )}

        {/* Composer */}
        <View style={[styles.composerWrap, { paddingBottom: insets.bottom + 8 }]}>
          <View style={[styles.composer, focused && styles.composerFocused, composerDisabled && styles.composerDisabled]}>
            <TextInput
              style={styles.input}
              placeholder={composerDisabled
                ? t('chat.loading', 'Loading…')
                : t('chat.typePlaceholder', 'Type a message…')}
              placeholderTextColor={COLORS.textLight}
              value={inputText}
              onChangeText={(v) => setInputText(v.length > MAX_CHARS ? v.slice(0, MAX_CHARS) : v)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyPress={onKeyPress}
              multiline
              editable={!composerDisabled}
              maxLength={MAX_CHARS}
              blurOnSubmit={false}
              returnKeyType="default"
              accessibilityLabel={t('chat.typePlaceholder', 'Type a message')}
            />
            <TouchableOpacity
              style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
              onPress={() => sendMessage(inputText)}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel={t('chat.send', 'Send message')}
            >
              <Ionicons name="send" size={18} color={canSend ? COLORS.textWhite : COLORS.textLight} />
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
  backBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  chatAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  chatAvatarImg: { width: 44, height: 44, borderRadius: 22 },
  chatAvatarText: { fontSize: 18, fontWeight: '800', color: COLORS.textWhite },
  chatName: { fontSize: 17, fontWeight: '700', color: COLORS.textDark },
  chatSubtitle: { fontSize: 13, color: COLORS.textMedium, fontWeight: '600', marginTop: 2 },

  // ── Connection banner ──
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  bannerWarn:   { backgroundColor: COLORS.yellowWarm },
  bannerError:  { backgroundColor: COLORS.error + '14' },
  bannerTxt:    { flex: 1, fontSize: 12.5, color: COLORS.textMedium, fontWeight: '600' },
  bannerAction: { fontSize: 12.5, fontWeight: '800', color: COLORS.primary },

  // ── Messages list ──
  messagesList:      { padding: 16, paddingBottom: 12 },
  messagesListEmpty: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  olderBtn:  { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 18, marginBottom: 10, borderRadius: 16, backgroundColor: COLORS.surface, minHeight: 40, justifyContent: 'center' },
  olderTxt:  { fontSize: 13, fontWeight: '700', color: COLORS.primary },

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
  stateRow:      { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 6 },
  stateTxt:      { fontSize: 10.5, color: COLORS.textLight, fontWeight: '600' },
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
    maxHeight: 120, minHeight: 40,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },

  sendBtn:         { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-end', marginBottom: 2 },
  sendBtnDisabled: { backgroundColor: COLORS.border },

  charCount: { alignSelf: 'flex-end', marginTop: 4, marginRight: 6, fontSize: 11, color: COLORS.textLight },
});

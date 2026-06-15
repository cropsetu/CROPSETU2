/**
 * InAppChatBanner — a WhatsApp-style heads-up shown at the top of the app when
 * an animal-trade chat message arrives while the app is open.
 *
 * It rides the existing socket bus (the backend emits `new_message` to the
 * user's room with sender name/avatar/role), so no extra polling or native push
 * is needed for the foreground case. Tapping it opens the conversation.
 *
 * Suppressed when: the message is the user's own, or they're already viewing
 * that exact chat. Auto-dismisses after a few seconds; tap the ✕ to dismiss.
 *
 * NOTE: this only fires while the app is FOREGROUNDED. Notifications when the
 * app is backgrounded/closed require OS push (expo-notifications) — see the
 * registration steps in the chat PR/notes.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Animated, Text, View, TouchableOpacity, StyleSheet, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { connectSocket } from '../services/socket';
import { navigate, getActiveRoute } from '../navigation/navigationRef';
import { COLORS } from '../constants/colors';

const VISIBLE_MS = 4500;

export default function InAppChatBanner() {
  const { user, isLoggedIn } = useAuth();
  const insets = useSafeAreaInsets();
  const [notice, setNotice] = useState(null);
  const slide = useRef(new Animated.Value(-200)).current;
  const hideTimer = useRef(null);
  // The backend emits each message to several rooms (chat + both user rooms),
  // so a socket in more than one can receive it twice — show it only once.
  const lastMsgId = useRef(null);

  const hide = useCallback(() => {
    clearTimeout(hideTimer.current);
    Animated.timing(slide, { toValue: -200, duration: 220, useNativeDriver: true })
      .start(() => setNotice(null));
  }, [slide]);

  const show = useCallback((next) => {
    setNotice(next);
    slide.setValue(-200);
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, friction: 9, tension: 70 }).start();
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => hide(), VISIBLE_MS);
  }, [slide, hide]);

  useEffect(() => {
    if (!isLoggedIn || !user?.id) return;
    let alive = true;
    let socketRef = null;
    let handler = null;

    (async () => {
      try {
        const s = await connectSocket();
        if (!alive) return;
        socketRef = s;
        handler = (msg) => {
          if (!msg?.chatId || !msg.senderId) return;
          if (msg.senderId === user.id) return;                 // my own message
          if (msg.id && msg.id === lastMsgId.current) return;   // duplicate room delivery
          lastMsgId.current = msg.id;
          const route = getActiveRoute();
          if (route?.name === 'Chat' && route?.params?.chatId === msg.chatId) return; // already reading it

          const avatar = typeof msg.senderAvatar === 'string' && /^https?:\/\//i.test(msg.senderAvatar)
            ? msg.senderAvatar : null;
          show({
            chatId:     msg.chatId,
            listingId:  msg.listingId,
            senderId:   msg.senderId,
            senderRole: msg.senderRole,
            name:       (msg.senderName && String(msg.senderName).trim())
              || (msg.senderRole === 'buyer' ? 'Buyer' : 'Seller'),
            avatar,
            text:       msg.imageUrl ? '📷 Photo' : (msg.text || ''),
          });
        };
        s.on('new_message', handler);
      } catch { /* socket unavailable — banner simply won't fire */ }
    })();

    return () => {
      alive = false;
      clearTimeout(hideTimer.current);
      if (socketRef && handler) socketRef.off('new_message', handler);
    };
  }, [isLoggedIn, user?.id, show]);

  const open = () => {
    const n = notice;
    hide();
    if (!n) return;
    navigate('AnimalTrade', {
      screen: 'Chat',
      params: {
        chatId:    n.chatId,
        listingId: n.listingId,
        peerName:  n.name,
        peerAvatar: n.avatar,
        peerId:    n.senderId,
        peerRole:  n.senderRole,
      },
    });
  };

  if (!notice) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingTop: insets.top + 6, transform: [{ translateY: slide }] }]}
    >
      <TouchableOpacity activeOpacity={0.92} onPress={open} style={styles.card}>
        <View style={styles.avatar}>
          {notice.avatar ? (
            <Image source={{ uri: notice.avatar }} style={styles.avatarImg} />
          ) : (
            <Ionicons name="chatbubble-ellipses" size={20} color={COLORS.textWhite} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{notice.name}</Text>
          <Text style={styles.msg} numberOfLines={1}>{notice.text}</Text>
        </View>
        <TouchableOpacity onPress={hide} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.close}>
          <Ionicons name="close" size={18} color={COLORS.textLight} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingHorizontal: 10, zIndex: 9999, elevation: 9999,
  },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface, borderRadius: 16,
    paddingVertical: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.16, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
  },
  avatarImg: { width: 44, height: 44, borderRadius: 22 },
  name: { fontSize: 15, fontWeight: '800', color: COLORS.textDark },
  msg:  { fontSize: 13, color: COLORS.textMedium, marginTop: 1 },
  close: { padding: 4, marginLeft: 2 },
});

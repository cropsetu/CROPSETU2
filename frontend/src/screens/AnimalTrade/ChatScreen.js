import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, SafeAreaView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOWS } from '../../constants/colors';
import { useLanguage } from '../../context/LanguageContext';

function MessageBubble({ message }) {
  const isMe = message.senderId === 'me';
  return (
    <View style={[styles.messagRow, isMe && styles.messageRowMe]}>
      {!isMe && (
        <View style={styles.avatarSmall}>
          <Text style={styles.avatarSmallText}>
            {message.senderName?.charAt(0) || 'S'}
          </Text>
        </View>
      )}
      <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
        <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{message.text}</Text>
        <Text style={[styles.bubbleTime, isMe && { color: COLORS.primaryPale }]}>{message.time}</Text>
      </View>
    </View>
  );
}

function QuickReply({ text, onPress }) {
  return (
    <TouchableOpacity style={styles.quickReply} onPress={() => onPress(text)}>
      <Text style={styles.quickReplyText}>{text}</Text>
    </TouchableOpacity>
  );
}

export default function ChatScreen({ route }) {
  const { sellerName } = route.params;
  const { t } = useLanguage();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef(null);

  const quickReplies = [
    'Kya price negotiate ho sakta hai?',
    'Kya delivery possible hai?',
    'Animal ki photos bhejein',
    'Kab milna sambhav hai?',
  ];

  const sendMessage = (text) => {
    if (!text.trim()) return;
    const newMsg = {
      id: `m${Date.now()}`,
      senderId: 'me',
      text: text.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: 'Today',
    };
    setMessages(prev => [...prev, newMsg]);
    setInputText('');

    // Simulate reply after 1.5s
    setTimeout(() => {
      const replies = [
        'Ji zaroor, aap aa ke dekh sakte ho.',
        'Haan, delivery possible hai 100km tak.',
        'Photo bhej raha hoon abhi.',
        'Kal subah 10 baje milein?',
      ];
      const reply = {
        id: `m${Date.now() + 1}`,
        senderId: 'other',
        senderName: sellerName,
        text: replies[Math.floor(Math.random() * replies.length)],
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: 'Today',
      };
      setMessages(prev => [...prev, reply]);
    }, 1500);
  };

  useEffect(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Chat Header Info */}
      <View style={styles.chatHeader}>
        <View style={styles.chatAvatar}>
          <Text style={styles.chatAvatarText}>{sellerName?.charAt(0)}</Text>
        </View>
        <View>
          <Text style={styles.chatName}>{sellerName}</Text>
          <View style={styles.onlineRow}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>{t('chat.online')}</Text>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Messages */}
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={10}
          removeClippedSubviews
          ref={flatListRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
        />

        {/* Quick Replies */}
        <View>
          <FlatList
            windowSize={5}
            maxToRenderPerBatch={10}
            removeClippedSubviews
            horizontal
            data={quickReplies}
            keyExtractor={i => i}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickRepliesContainer}
            renderItem={({ item }) => (
              <QuickReply text={item} onPress={sendMessage} />
            )}
          />
        </View>

        {/* Input */}
        <View style={styles.inputBar}>
          <TouchableOpacity style={styles.attachBtn}>
            <Ionicons name="attach" size={24} color={COLORS.textMedium} />
          </TouchableOpacity>
          <TextInput
            style={styles.messageInput}
            placeholder={t('chat.typePlaceholder')}
            placeholderTextColor={COLORS.textLight}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
            onPress={() => sendMessage(inputText)}
            disabled={!inputText.trim()}
          >
            <Ionicons name="send" size={20} color={inputText.trim() ? COLORS.textWhite : COLORS.textLight} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  chatHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  chatAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
  chatAvatarText: { fontSize: 18, fontWeight: '800', color: COLORS.textWhite },
  chatName: { fontSize: 17, fontWeight: '700', color: COLORS.textDark },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.success },
  onlineText: { fontSize: 13, color: COLORS.success, fontWeight: '600' },

  messagesList: { padding: 16, paddingBottom: 8 },
  messagRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end', gap: 8 },
  messageRowMe: { flexDirection: 'row-reverse' },
  avatarSmall: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.primaryLight, justifyContent: 'center', alignItems: 'center' },
  avatarSmallText: { fontSize: 13, fontWeight: '700', color: COLORS.textWhite },

  bubble: { maxWidth: '75%', borderRadius: 18, padding: 12 },
  bubbleMe: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: COLORS.surface, borderBottomLeftRadius: 4, ...SHADOWS.small },
  bubbleText: { fontSize: 15, color: COLORS.textDark, lineHeight: 22 },
  bubbleTextMe: { color: COLORS.textWhite },
  bubbleTime: { fontSize: 11, color: COLORS.textLight, marginTop: 4, textAlign: 'right' },

  quickRepliesContainer: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  quickReply: { backgroundColor: COLORS.surface, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1.5, borderColor: COLORS.primary },
  quickReplyText: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },

  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  attachBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  messageInput: { flex: 1, backgroundColor: COLORS.inputBg, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: COLORS.textDark, maxHeight: 100, borderWidth: 1, borderColor: COLORS.border },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { backgroundColor: COLORS.border },
});

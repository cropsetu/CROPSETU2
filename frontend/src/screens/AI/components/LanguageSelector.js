/**
 * LanguageSelector — Lovable-style glass pill with globe icon + language name.
 * Tap opens a slide-up Modal with a glass list of LANGUAGES + "Auto-detect".
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, FlatList,
  Pressable, StyleSheet, Dimensions,
} from 'react-native';
import { Globe, ChevronDown, Check } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { useLanguage } from '../../../context/LanguageContext';

const { height: H } = Dimensions.get('window');

const INTER_REG = 'Inter_400Regular';
const INTER_SEMI = 'Inter_600SemiBold';
const INTER_BOLD = 'Inter_700Bold';

// Auto-detect: AIChatScreen detects each message's script and replies in the
// matching language. Stored as the magic string 'auto' on chatLanguage.
const AUTO = { code: 'auto', name: 'Auto-detect', nativeName: 'Auto-detect', flag: '🌐' };

export default function LanguageSelector({ compact = false }) {
  const { chatLanguage, setChatLanguage, setLanguage, LANGUAGES } = useLanguage();
  const [open, setOpen] = useState(false);

  const current = chatLanguage === 'auto'
    ? AUTO
    : (LANGUAGES.find((l) => l.code === chatLanguage) || AUTO);
  const label = current.nativeName || current.name;

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        activeOpacity={0.75}
        style={styles.triggerWrap}
      >
        <BlurView intensity={28} tint="dark" style={styles.triggerBlur}>
          <View style={styles.triggerRow}>
            <Globe size={14} color="#F5B841" strokeWidth={2.2} />
            <Text style={styles.triggerTxt} numberOfLines={1}>
              {label}
            </Text>
            <ChevronDown size={14} color="rgba(255,255,255,0.55)" strokeWidth={2.2} />
          </View>
        </BlurView>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheetWrap} onPress={() => {}}>
            <BlurView intensity={60} tint="dark" style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Language</Text>
              <FlatList
                data={[AUTO, ...LANGUAGES]}
                keyExtractor={(item) => item.code}
                renderItem={({ item }) => {
                  const active = item.code === current.code;
                  return (
                    <TouchableOpacity
                      style={[styles.row, active && styles.rowActive]}
                      activeOpacity={0.7}
                      onPress={async () => {
                        if (item.code === 'auto') {
                          // Chat replies will detect-per-message from script.
                          // Leave the global app UI language alone.
                          await setChatLanguage('auto');
                          setOpen(false);
                          return;
                        }
                        // Picking a specific language sets BOTH the chat
                        // language and the app UI language so the picker
                        // feels intuitive (one-tap full switch).
                        await setChatLanguage(item.code);
                        await setLanguage(item.code);
                        setOpen(false);
                      }}
                    >
                      <Text style={styles.flag}>{item.flag || '🌐'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name}>{item.nativeName || item.name}</Text>
                        {item.region ? (
                          <Text style={styles.region}>{item.region}</Text>
                        ) : null}
                      </View>
                      {active && <Check size={18} color="#22C55E" strokeWidth={2.6} />}
                    </TouchableOpacity>
                  );
                }}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                style={{ maxHeight: H * 0.55 }}
                showsVerticalScrollIndicator={false}
              />
            </BlurView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  triggerWrap: {
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  triggerBlur: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  triggerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  triggerTxt: {
    fontSize: 12,
    color: '#F0FDF4',
    fontFamily: INTER_SEMI,
    maxWidth: 110,
  },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    paddingHorizontal: 14,
    paddingBottom: 22,
  },
  sheet: {
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(12,36,21,0.85)',
    paddingTop: 10,
    paddingBottom: 16,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: INTER_BOLD,
    letterSpacing: 2.2,
    textAlign: 'center',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  rowActive: {
    backgroundColor: 'rgba(34,197,94,0.1)',
  },
  flag: { fontSize: 20 },
  name: {
    fontSize: 14,
    color: '#F0FDF4',
    fontFamily: INTER_SEMI,
  },
  region: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: INTER_REG,
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginHorizontal: 18,
  },
});

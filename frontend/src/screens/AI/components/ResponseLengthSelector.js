/**
 * ResponseLengthSelector — glass pill matching LanguageSelector. Lets the farmer
 * pick how long FarmMind's replies should be (Short / Medium / Long / Extra Long).
 * The choice is persisted in LanguageContext and sent with every chat message.
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, FlatList,
  Pressable, StyleSheet, Dimensions,
} from 'react-native';
import { Gauge, ChevronDown, Check } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../../../context/LanguageContext';

const { height: H } = Dimensions.get('window');

const INTER_REG = 'Inter_400Regular';
const INTER_SEMI = 'Inter_600SemiBold';
const INTER_BOLD = 'Inter_700Bold';

const OPTIONS = [
  { code: 'short',      label: 'Short',      hint: 'Quick, to-the-point answers' },
  { code: 'medium',     label: 'Medium',     hint: 'Balanced detail' },
  { code: 'long',       label: 'Long',       hint: 'Thorough, sectioned advice' },
  { code: 'extra_long', label: 'Extra Long', hint: 'Most comprehensive' },
];

export default function ResponseLengthSelector({ compact = false }) {
  const { responseLength, setResponseLength } = useLanguage();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const current = OPTIONS.find((o) => o.code === responseLength) || OPTIONS[0];

  return (
    <>
      {compact ? (
        // Composer icon-button variant (sits next to the paperclip/mic).
        <TouchableOpacity
          onPress={() => setOpen(true)}
          activeOpacity={0.7}
          style={styles.compactBtn}
          accessibilityRole="button"
          accessibilityLabel={`Response length: ${current.label}`}
        >
          <Gauge size={20} color="#F5B841" strokeWidth={2.2} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={() => setOpen(true)}
          activeOpacity={0.75}
          style={styles.triggerWrap}
        >
          <BlurView intensity={28} tint="dark" style={styles.triggerBlur}>
            <View style={styles.triggerRow}>
              <Gauge size={14} color="#F5B841" strokeWidth={2.2} />
              <Text style={styles.triggerTxt} numberOfLines={1}>
                {current.label}
              </Text>
              <ChevronDown size={14} color="rgba(255,255,255,0.55)" strokeWidth={2.2} />
            </View>
          </BlurView>
        </TouchableOpacity>
      )}

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheetWrap, { paddingBottom: insets.bottom + 24 }]} onPress={() => {}}>
            <BlurView intensity={60} tint="dark" style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>RESPONSE LENGTH</Text>
              <FlatList
                data={OPTIONS}
                keyExtractor={(item) => item.code}
                renderItem={({ item }) => {
                  const active = item.code === current.code;
                  return (
                    <TouchableOpacity
                      style={[styles.row, active && styles.rowActive]}
                      activeOpacity={0.7}
                      onPress={async () => {
                        await setResponseLength(item.code);
                        setOpen(false);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name}>{item.label}</Text>
                        <Text style={styles.region}>{item.hint}</Text>
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
  compactBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
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
    maxWidth: 90,
  },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    paddingHorizontal: 14,
    // paddingBottom is applied inline as insets.bottom + 24 to clear the home indicator
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

/**
 * CosmicPicker — searchable bottom-sheet picker (light theme).
 *
 * Same API as LocationPicker: title, items, selected, onSelect, placeholder,
 * disabled. Used for state/district/taluka selection.
 */

import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, TextInput, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COSMIC, CR, CS, CT } from '../theme/cosmicTheme';
import { Haptics } from '../../../utils/haptics';

export default function CosmicPicker({
  title,
  items = [],
  selected,
  onSelect,
  placeholder = 'Select…',
  disabled = false,
  prefix,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const insets = useSafeAreaInsets();

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((it) => String(it).toLowerCase().includes(q));
  }, [items, query]);

  const handleSelect = (val) => {
    Haptics.selection?.();
    onSelect?.(val);
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <Pressable
        onPress={() => { if (!disabled) { Haptics.light?.(); setOpen(true); } }}
        style={({ pressed }) => [
          styles.trigger,
          disabled && styles.triggerDisabled,
          pressed && !disabled && { opacity: 0.75 },
        ]}
      >
        {!!prefix && <View style={{ marginRight: 6 }}>{prefix}</View>}
        <Text style={[styles.triggerText, !selected && styles.triggerPlaceholder]} numberOfLines={1}>
          {selected || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={16} color={disabled ? COSMIC.MUTED : COSMIC.TEXT_2} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => { setOpen(false); setQuery(''); }}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => { setOpen(false); setQuery(''); }} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.handle} />

          <View style={styles.headerRow}>
            <Text style={styles.title}>{title || 'Select'}</Text>
            <Pressable
              onPress={() => { setOpen(false); setQuery(''); }}
              hitSlop={{ top: 10, left: 10, bottom: 10, right: 10 }}
            >
              <Ionicons name="close" size={20} color={COSMIC.TEXT_2} />
            </Pressable>
          </View>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={14} color={COSMIC.MUTED} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search…"
              placeholderTextColor={COSMIC.MUTED}
              style={styles.searchInput}
              autoFocus
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={{ top: 8, left: 8, bottom: 8, right: 8 }}>
                <Ionicons name="close-circle" size={16} color={COSMIC.MUTED} />
              </Pressable>
            )}
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(it) => String(it)}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            ListEmptyComponent={
              <View style={styles.emptyList}>
                <Text style={styles.emptyText}>No matches for "{query}"</Text>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handleSelect(item)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: COSMIC.SURFACE_HI }]}
              >
                <Text style={styles.rowText} numberOfLines={1}>{item}</Text>
                {item === selected && <Ionicons name="checkmark-circle" size={18} color={COSMIC.PRIMARY} />}
              </Pressable>
            )}
            style={{ maxHeight: '70%' }}
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: COSMIC.BORDER_HI,
    borderRadius: CR.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COSMIC.SURFACE,
    minHeight: 44,
  },
  triggerDisabled: {
    opacity: 0.5,
  },
  triggerText: {
    flex: 1,
    fontSize: 14,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_500Medium',
  },
  triggerPlaceholder: {
    color: COSMIC.MUTED,
    fontFamily: 'Inter_400Regular',
  },

  backdrop: {
    flex: 1,
    backgroundColor: COSMIC.OVERLAY,
  },
  sheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    maxHeight: '85%',
    paddingHorizontal: CS.base,
    paddingTop: 8,
    borderTopLeftRadius: CR.xxl,
    borderTopRightRadius: CR.xxl,
    borderTopWidth: 1,
    borderColor: COSMIC.BORDER,
    backgroundColor: COSMIC.SURFACE,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: COSMIC.BORDER_HI,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    ...CT.styles.h3,
    fontSize: 17,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: COSMIC.SURFACE_HI,
    borderWidth: 1,
    borderColor: COSMIC.BORDER,
    borderRadius: CR.md,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_500Medium',
    padding: 0,
  },
  row: {
    paddingHorizontal: 8,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: CR.md,
    gap: 8,
  },
  rowText: {
    fontSize: 15,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_500Medium',
    flex: 1,
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COSMIC.BORDER,
  },
  emptyList: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    ...CT.styles.bodySM,
    color: COSMIC.TEXT_3,
  },
});

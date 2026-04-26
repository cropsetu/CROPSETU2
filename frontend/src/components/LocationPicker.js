import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  TouchableWithoutFeedback, TextInput, FlatList, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SHADOWS } from '../constants/colors';

/**
 * Reusable searchable modal picker.
 * Props:
 *   title      — Modal header title
 *   items      — string[] of options
 *   selected   — currently selected string
 *   onSelect   — (value: string) => void
 *   placeholder— placeholder for the trigger button
 *   disabled   — grey out the button
 */
export default function LocationPicker({ title, items = [], selected, onSelect, placeholder = 'Select…', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((it) => it.toLowerCase().includes(q));
  }, [items, query]);

  function handleSelect(val) {
    onSelect(val);
    setOpen(false);
    setQuery('');
  }

  return (
    <>
      {/* Trigger Button */}
      <TouchableOpacity
        style={[s.btn, disabled && s.btnDisabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={disabled ? 1 : 0.75}
      >
        <Text style={[s.btnTxt, !selected && s.btnPlaceholder]} numberOfLines={1}>
          {selected || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={disabled ? COLORS.gray175 : COLORS.gray550} />
      </TouchableOpacity>

      {/* Modal Sheet */}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => { setOpen(false); setQuery(''); }}>
        <TouchableWithoutFeedback onPress={() => { setOpen(false); setQuery(''); }}>
          <View style={s.backdrop} />
        </TouchableWithoutFeedback>

        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.sheetTitle}>{title}</Text>

          {/* Search */}
          <View style={s.searchRow}>
            <Ionicons name="search-outline" size={16} color={COLORS.gray350} />
            <TextInput
              style={s.searchInput}
              placeholder="Search..."
              placeholderTextColor={COLORS.gray350}
              value={query}
              onChangeText={setQuery}
              autoFocus={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={16} color={COLORS.gray350} />
              </TouchableOpacity>
            )}
          </View>

          {filtered.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="search-outline" size={36} color={COLORS.gray175} />
              <Text style={s.emptyTxt}>No results for "{query}"</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item}
              style={s.list}
              keyboardShouldPersistTaps="always"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.item, item === selected && s.itemActive]}
                  onPress={() => handleSelect(item)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.itemTxt, item === selected && s.itemTxtActive]}>{item}</Text>
                  {item === selected && <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={s.sep} />}
            />
          )}

          <TouchableOpacity style={s.cancelBtn} onPress={() => { setOpen(false); setQuery(''); }}>
            <Text style={s.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  btn: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.grayBorder,
    paddingHorizontal: 14, paddingVertical: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    ...SHADOWS.small,
  },
  btnDisabled: { backgroundColor: COLORS.grayPaper, borderColor: COLORS.grayBorder },
  btnTxt: { fontSize: 15, color: COLORS.textDark, flex: 1, marginRight: 8 },
  btnPlaceholder: { color: COLORS.gray350 },

  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    maxHeight: '80%',
    ...SHADOWS.large,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.gray175, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: COLORS.textDark, textAlign: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.grayBg },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginVertical: 10,
    backgroundColor: COLORS.grayPaper, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.grayBorder,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.textDark },

  list: { maxHeight: 320 },
  item: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  itemActive: { backgroundColor: COLORS.primary + '08' },
  itemTxt: { fontSize: 15, color: COLORS.textDark },
  itemTxtActive: { color: COLORS.primary, fontWeight: '700' },
  sep: { height: 1, backgroundColor: COLORS.grayBg },
  empty: { padding: 32, alignItems: 'center', gap: 8 },
  emptyTxt: { color: COLORS.gray350, fontSize: 14 },

  cancelBtn: { marginHorizontal: 16, marginTop: 8, backgroundColor: COLORS.grayBg, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center' },
  cancelTxt: { fontSize: 15, fontWeight: '700', color: COLORS.gray550 },
});

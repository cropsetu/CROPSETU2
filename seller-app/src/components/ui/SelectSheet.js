/**
 * SelectSheet — one bottom-sheet picker for every "choose one from a list".
 *
 * Replaces three near-identical hand-rolled modals in AddProductScreen
 * (category, subcategory) plus the shared LocationPicker's shape, which had
 * drifted apart in radius, search behaviour and empty-state wording.
 *
 * Fixes it brings along:
 *   - the option list is virtualised (FlatList). The category modal previously
 *     mapped every option into a ScrollView; with a long list that is hundreds
 *     of mounted rows for a sheet showing eight.
 *   - search for lists past a threshold, so a 36-district list isn't a scroll
 *     marathon
 *   - loading / error+retry / empty are first-class, instead of the caller
 *     rendering three ad-hoc branches
 *   - Android hardware back and web Escape close it; the backdrop is hidden
 *     from screen readers and the sheet is announced as modal
 *
 * VISUALLY the trigger is an input — same 14px radius, same 1.5px border, same
 * height — because that is what it is. The sheet itself is the app's deepest
 * radius (30) and is the only surface allowed to use it, which is what makes a
 * sheet read as "a layer above" rather than "another card".
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, FlatList, Modal, Platform,
  Pressable, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import { C, E, F, HIT, R, SP, T } from '../../theme';
import { TextField } from './Form';
import Button from './Button';
import { EmptyState, ErrorState } from './States';

const SEARCH_THRESHOLD = 8;

export default function SelectSheet({
  /** string[] or { value, label, description }[] */
  items = [],
  value,
  onChange,
  title,
  placeholder,
  /** Label for the "clear selection" row. Omitted → not clearable. */
  clearLabel,
  disabled = false,
  loading = false,
  error = null,
  onRetry,
  searchable,
  emptyLabel,
  accessibilityLabel,
  testID,
  style,
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const options = useMemo(
    () => items.map((it) => (typeof it === 'string' ? { value: it, label: it } : it)).filter(Boolean),
    [items],
  );

  const selected = options.find((o) => o.value === value);
  const showSearch = searchable ?? options.length > SEARCH_THRESHOLD;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => String(o.label).toLowerCase().includes(q) ||
             String(o.description ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  const close = useCallback(() => { setOpen(false); setQuery(''); }, []);

  const select = useCallback((next) => {
    onChange?.(next);
    close();
  }, [onChange, close]);

  // Android hardware back closes the sheet rather than popping the screen.
  useEffect(() => {
    if (!open || Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => sub.remove();
  }, [open, close]);

  useEffect(() => {
    if (!open || Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const renderItem = useCallback(({ item }) => {
    const active = item.value === value;
    return (
      <Pressable
        onPress={() => select(item.value)}
        accessibilityRole="radio"
        accessibilityState={{ selected: active }}
        accessibilityLabel={item.label}
        accessibilityHint={item.description}
        style={({ pressed }) => [ss.row, active && ss.rowActive, pressed && { opacity: 0.7 }]}
      >
        {active ? <View style={ss.rowRail} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={[ss.rowTxt, active && ss.rowTxtActive]}>{item.label}</Text>
          {item.description ? <Text style={ss.rowDesc}>{item.description}</Text> : null}
        </View>
        {active ? <Ionicons name="checkmark-circle" size={22} color={C.brandInk} /> : null}
      </Pressable>
    );
  }, [value, select]);

  const listRef = useRef(null);

  return (
    <>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || title}
        accessibilityValue={{ text: selected?.label || placeholder || '' }}
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        style={({ pressed }) => [
          ss.trigger,
          disabled && ss.triggerDisabled,
          pressed && !disabled && { borderColor: C.brand },
          style,
        ]}
      >
        <Text
          style={[ss.triggerTxt, !selected && ss.triggerPlaceholder]}
          numberOfLines={1}
        >
          {selected?.label || placeholder || t('locationPicker.selectPlaceholder', 'Select')}
        </Text>
        <Ionicons name="chevron-down" size={18} color={disabled ? C.textFaint : C.textMuted} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={close}
      >
        <View style={ss.root}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessible={false}
            importantForAccessibility="no"
          >
            <View style={ss.backdrop} />
          </Pressable>

          <View style={ss.sheet} accessibilityViewIsModal>
            <View style={ss.handle} />
            <View style={ss.titleWrap}>
              <Text style={ss.title} accessibilityRole="header">{title}</Text>
              <View style={ss.titleRule} />
            </View>

            {showSearch && !loading && !error ? (
              <View style={ss.searchWrap}>
                <TextField
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('locationPicker.searchPlaceholder', 'Search…')}
                  accessibilityLabel={t('locationPicker.searchPlaceholder', 'Search')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  prefix={<Ionicons name="search" size={16} color={C.textFaint} />}
                  suffix={
                    query ? (
                      <Pressable
                        onPress={() => setQuery('')}
                        hitSlop={HIT.slop}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.clear', 'Clear search')}
                      >
                        <Ionicons name="close-circle" size={18} color={C.textFaint} />
                      </Pressable>
                    ) : null
                  }
                />
              </View>
            ) : null}

            {loading ? (
              <View style={ss.stateBox}>
                <ActivityIndicator size="large" color={C.brand} />
                <Text style={ss.stateTxt}>{t('products.modalLoading', 'Loading…')}</Text>
              </View>
            ) : error ? (
              <ErrorState error={error} onRetry={onRetry} compact />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon="search-outline"
                compact
                title={
                  query
                    ? t('locationPicker.noResults', { query, defaultValue: `No matches for "${query}"` })
                    : (emptyLabel || t('common.nothingHere', 'Nothing to choose from yet'))
                }
              />
            ) : (
              <FlatList
                ref={listRef}
                data={filtered}
                keyExtractor={(item) => String(item.value)}
                renderItem={renderItem}
                style={ss.list}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={12}
                windowSize={7}
                removeClippedSubviews={Platform.OS === 'android'}
                ItemSeparatorComponent={() => <View style={ss.sep} />}
                ListHeaderComponent={
                  clearLabel ? (
                    <>
                      <Pressable
                        onPress={() => select('')}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: !value }}
                        accessibilityLabel={clearLabel}
                        style={({ pressed }) => [ss.row, !value && ss.rowActive, pressed && { opacity: 0.7 }]}
                      >
                        {!value ? <View style={ss.rowRail} /> : null}
                        <Text style={[ss.rowTxt, !value && ss.rowTxtActive, { flex: 1 }]}>{clearLabel}</Text>
                        {!value ? <Ionicons name="checkmark-circle" size={22} color={C.brandInk} /> : null}
                      </Pressable>
                      <View style={ss.sep} />
                    </>
                  ) : null
                }
              />
            )}

            <View style={ss.footer}>
              <Button label={t('cancel', 'Cancel')} variant="neutral" fullWidth onPress={close} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const ss = StyleSheet.create({
  // Matches `Form`'s input shell exactly — a picker is an input.
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SP.sm,
    minHeight: HIT.min + 4,
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: C.borderStrong,
    paddingHorizontal: SP.lg,
  },
  triggerDisabled: { backgroundColor: C.surfaceSunken, borderColor: C.border },
  triggerTxt: { ...T.bodyLg, flex: 1, color: C.text },
  triggerPlaceholder: { color: C.textFaint },

  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: C.overlay },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.xxl,
    borderTopRightRadius: R.xxl,
    borderTopWidth: 1,
    borderColor: C.border,
    maxHeight: '85%',
    paddingBottom: Platform.OS === 'ios' ? SP.xxxl : SP.lg,
    ...E.float,
  },
  handle: {
    width: 48, height: 5, borderRadius: R.pill,
    backgroundColor: C.borderStrong,
    alignSelf: 'center', marginTop: SP.md,
  },
  // Left-aligned and ruled, matching every other section head in the app —
  // a centred sheet title was the last piece of generic modal styling left.
  titleWrap: { paddingHorizontal: SP.xl, paddingTop: SP.xl, paddingBottom: SP.lg, gap: SP.md },
  title: { ...T.heading, color: C.text },
  titleRule: { height: 1, backgroundColor: C.border },
  searchWrap: { paddingHorizontal: SP.xl, paddingBottom: SP.md },

  list: { maxHeight: 400 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    minHeight: HIT.min + 8,
    paddingHorizontal: SP.xl,
    paddingVertical: SP.md,
  },
  rowActive: { backgroundColor: C.brandPale },
  rowRail: { position: 'absolute', left: 0, top: SP.sm, bottom: SP.sm, width: 3, borderRadius: R.pill, backgroundColor: C.brand },
  rowTxt: { ...T.bodyLg, color: C.text },
  rowTxtActive: { ...T.bodyLg, fontFamily: F.sans700, color: C.brandInk },
  rowDesc: { ...T.caption, color: C.textMuted, marginTop: 2 },
  sep: { height: 1, backgroundColor: C.divider, marginHorizontal: SP.xl },

  stateBox: { paddingVertical: SP.huge, alignItems: 'center', gap: SP.md },
  stateTxt: { ...T.body, color: C.textMuted },

  footer: { paddingHorizontal: SP.xl, paddingTop: SP.md },
});

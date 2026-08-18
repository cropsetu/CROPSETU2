/**
 * Saved Addresses — manage where orders get delivered.
 *
 * ── Why this screen exists ──────────────────────────────────────────────────
 * Account → "Saved Addresses" opened the profile-location editor (city, district,
 * PIN), which is a different thing entirely. The real address book — the one
 * checkout reads and writes — had NO management surface anywhere in the app:
 * a farmer could add an address mid-checkout and then never edit or remove it.
 * That is both a usability hole and a data-rights one, since a delivery address
 * is personal data the person it belongs to could not delete.
 *
 * ── Privacy ─────────────────────────────────────────────────────────────────
 * Addresses are rendered only on this screen and only for their owner (every
 * endpoint scopes by `userId`). Nothing here is logged or sent anywhere else.
 */
import { useState, useCallback, useRef, memo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl, Modal, ScrollView, Alert,
  KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS } from '@cropsetu/shared/constants/colors';
import api from '@cropsetu/shared/services/api';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';

const TYPE_ICON = { HOME: 'home-outline', OFFICE: 'briefcase-outline', OTHER: 'location-outline' };
const TYPE_KEY  = { HOME: 'typeHome',     OFFICE: 'typeOffice',        OTHER: 'typeOther'      };

const EMPTY_FORM = {
  type: 'HOME', name: '', phone: '', flat: '', street: '',
  landmark: '', city: '', state: '', pincode: '', isDefault: false,
};

// Mirrors the server's own checks (addresses.routes.js) so the farmer is told
// what is wrong before a round trip, never instead of the server checking.
const PHONE_RE   = /^[6-9][0-9]{9}$/;
const PINCODE_RE = /^[1-9][0-9]{5}$/;

const AddressCard = memo(function AddressCard({ item, onEdit, onDelete, onMakeDefault, busy }) {
  const { t } = useLanguage();
  const line = [item.flat, item.street, item.landmark, item.city, item.state]
    .filter(Boolean).join(', ');

  return (
    <View style={S.card}>
      <View style={S.cardTop}>
        <View style={S.typeChip}>
          <Ionicons name={TYPE_ICON[item.type] || TYPE_ICON.OTHER} size={13} color={COLORS.primary} />
          <Text style={S.typeTxt}>{t(`savedAddresses.${TYPE_KEY[item.type] || 'typeOther'}`)}</Text>
        </View>
        {item.isDefault ? (
          <View style={S.defaultChip}>
            <Text style={S.defaultTxt}>{t('savedAddresses.defaultBadge')}</Text>
          </View>
        ) : null}
      </View>

      <Text style={S.name}>{item.name}</Text>
      <Text style={S.line}>{line}</Text>
      <Text style={S.line}>{item.pincode}</Text>
      <Text style={S.phone}>{item.phone}</Text>

      <View style={S.actions}>
        {!item.isDefault ? (
          <TouchableOpacity
            style={S.actionBtn}
            disabled={busy}
            onPress={() => onMakeDefault(item)}
            accessibilityRole="button"
          >
            <Ionicons name="star-outline" size={15} color={COLORS.primary} />
            <Text style={S.actionTxt}>{t('savedAddresses.setDefault')}</Text>
          </TouchableOpacity>
        ) : <View style={{ flex: 1 }} />}
        <TouchableOpacity style={S.actionBtn} disabled={busy} onPress={() => onEdit(item)} accessibilityRole="button">
          <Ionicons name="create-outline" size={15} color={COLORS.primary} />
          <Text style={S.actionTxt}>{t('savedAddresses.edit')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={S.actionBtn} disabled={busy} onPress={() => onDelete(item)} accessibilityRole="button">
          <Ionicons name="trash-outline" size={15} color={COLORS.error} />
          <Text style={[S.actionTxt, { color: COLORS.error }]}>{t('savedAddresses.delete')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

function Field({ label, value, onChangeText, keyboardType, maxLength, autoCapitalize }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={S.fieldLabel}>{label}</Text>
      <TextInput
        style={S.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        placeholderTextColor={COLORS.textMedium}
      />
    </View>
  );
}

export default function SavedAddressesScreen({ navigation }) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  const [items,      setItems]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);
  const [busy,       setBusy]       = useState(false);

  const [form,       setForm]       = useState(null);   // null = sheet closed
  const [editingId,  setEditingId]  = useState(null);
  const [formError,  setFormError]  = useState('');
  const [saving,     setSaving]     = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const alive    = useRef(true);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setError(null);
      const { data } = await api.get('/addresses');
      if (!alive.current) return;
      setItems(Array.isArray(data?.data) ? data.data : []);
    } catch (e) {
      if (alive.current) setError(e?.response?.data?.error?.message || t('savedAddresses.loadFailed'));
    } finally {
      inFlight.current = false;
      if (alive.current) { setLoading(false); setRefreshing(false); }
    }
  }, [t]);

  useFocusEffect(useCallback(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; };
  }, [load]));

  const openAdd  = useCallback(() => { setEditingId(null); setFormError(''); setForm({ ...EMPTY_FORM }); }, []);
  const openEdit = useCallback((item) => {
    setEditingId(item.id);
    setFormError('');
    setForm({
      type: item.type || 'HOME', name: item.name || '', phone: item.phone || '',
      flat: item.flat || '', street: item.street || '', landmark: item.landmark || '',
      city: item.city || '', state: item.state || '', pincode: item.pincode || '',
      isDefault: Boolean(item.isDefault),
    });
  }, []);

  const save = useCallback(async () => {
    if (!form || saving) return;
    const required = ['name', 'phone', 'flat', 'street', 'city', 'state', 'pincode'];
    if (required.some((k) => !String(form[k] || '').trim())) {
      setFormError(t('savedAddresses.errRequired')); return;
    }
    if (!PHONE_RE.test(String(form.phone).replace(/\D/g, '').slice(-10))) {
      setFormError(t('savedAddresses.errPhone')); return;
    }
    if (!PINCODE_RE.test(String(form.pincode).trim())) {
      setFormError(t('savedAddresses.errPincode')); return;
    }

    setSaving(true); setFormError('');
    try {
      const payload = { ...form, phone: String(form.phone).replace(/\D/g, '').slice(-10) };
      if (editingId) await api.put(`/addresses/${editingId}`, payload);
      else           await api.post('/addresses', payload);
      if (!alive.current) return;
      setForm(null); setEditingId(null);
      await load();
    } catch (e) {
      if (alive.current) setFormError(e?.response?.data?.error?.message || t('savedAddresses.saveFailed'));
    } finally {
      if (alive.current) setSaving(false);
    }
  }, [form, editingId, saving, load, t]);

  const makeDefault = useCallback(async (item) => {
    if (busy) return;
    setBusy(true);
    // Optimistic: the star moves at once, and is reconciled by the reload below.
    setItems((prev) => prev.map((a) => ({ ...a, isDefault: a.id === item.id })));
    try {
      await api.patch(`/addresses/${item.id}/default`);
      await load();
    } catch (e) {
      await load();  // snap back to whatever the server actually holds
      if (alive.current) {
        Alert.alert(t('savedAddresses.title'),
          e?.response?.data?.error?.message || t('savedAddresses.defaultFailed'));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [busy, load, t]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete || busy) return;
    setBusy(true);
    const id = pendingDelete.id;
    try {
      await api.delete(`/addresses/${id}`);
      if (!alive.current) return;
      setPendingDelete(null);
      // Reload rather than splice: deleting the default promotes another one
      // server-side, and the list must show which.
      await load();
    } catch (e) {
      if (alive.current) {
        setPendingDelete(null);
        Alert.alert(t('savedAddresses.title'),
          e?.response?.data?.error?.message || t('savedAddresses.deleteFailed'));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [pendingDelete, busy, load, t]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <SafeAreaView style={S.root} edges={['bottom']}>
      <View style={[S.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.iconBtn} hitSlop={8} accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color={COLORS.textDark} />
        </TouchableOpacity>
        <Text style={S.headerTitle}>{t('savedAddresses.title')}</Text>
        <TouchableOpacity onPress={openAdd} style={S.iconBtn} hitSlop={8} accessibilityRole="button"
          accessibilityLabel={t('savedAddresses.add')}>
          <Ionicons name="add" size={26} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {loading && !items.length ? (
        <View style={S.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : error ? (
        <View style={S.center}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.error} />
          <Text style={S.errorTxt}>{error}</Text>
          <TouchableOpacity style={S.primaryBtn} onPress={() => { setLoading(true); load(); }}>
            <Text style={S.primaryBtnTxt}>{t('savedAddresses.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <AddressCard
              item={item} busy={busy}
              onEdit={openEdit} onDelete={setPendingDelete} onMakeDefault={makeDefault}
            />
          )}
          contentContainerStyle={items.length ? { padding: 16, paddingBottom: 32 } : { flexGrow: 1 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} colors={[COLORS.primary]}
              onRefresh={() => { setRefreshing(true); load(); }} />
          }
          ListEmptyComponent={
            <View style={S.center}>
              <Ionicons name="location-outline" size={64} color={COLORS.gray175} />
              <Text style={S.emptyTitle}>{t('savedAddresses.empty')}</Text>
              <Text style={S.emptySub}>{t('savedAddresses.emptyHint')}</Text>
              <TouchableOpacity style={[S.primaryBtn, { marginTop: 12 }]} onPress={openAdd}>
                <Text style={S.primaryBtnTxt}>{t('savedAddresses.add')}</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* ── Add / edit sheet ─────────────────────────────────────────────── */}
      <Modal visible={!!form} transparent animationType="slide" onRequestClose={() => !saving && setForm(null)}>
        <KeyboardAvoidingView style={S.sheetBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={S.sheet}>
            <View style={S.sheetHandle} />
            <Text style={S.sheetTitle}>
              {editingId ? t('savedAddresses.edit') : t('savedAddresses.add')}
            </Text>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={S.typeRow}>
                {['HOME', 'OFFICE', 'OTHER'].map((ty) => (
                  <TouchableOpacity
                    key={ty}
                    style={[S.typeOpt, form?.type === ty && S.typeOptOn]}
                    onPress={() => set('type')(ty)}
                  >
                    <Ionicons name={TYPE_ICON[ty]} size={15}
                      color={form?.type === ty ? COLORS.white : COLORS.textMedium} />
                    <Text style={[S.typeOptTxt, form?.type === ty && { color: COLORS.white }]}>
                      {t(`savedAddresses.${TYPE_KEY[ty]}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Field label={t('savedAddresses.fName')}     value={form?.name}     onChangeText={set('name')}     maxLength={100} autoCapitalize="words" />
              <Field label={t('savedAddresses.fPhone')}    value={form?.phone}    onChangeText={set('phone')}    keyboardType="phone-pad" maxLength={10} />
              <Field label={t('savedAddresses.fFlat')}     value={form?.flat}     onChangeText={set('flat')}     maxLength={100} />
              <Field label={t('savedAddresses.fStreet')}   value={form?.street}   onChangeText={set('street')}   maxLength={200} />
              <Field label={t('savedAddresses.fLandmark')} value={form?.landmark} onChangeText={set('landmark')} maxLength={200} />
              <Field label={t('savedAddresses.fCity')}     value={form?.city}     onChangeText={set('city')}     maxLength={100} />
              <Field label={t('savedAddresses.fState')}    value={form?.state}    onChangeText={set('state')}    maxLength={100} />
              <Field label={t('savedAddresses.fPincode')}  value={form?.pincode}  onChangeText={set('pincode')}  keyboardType="number-pad" maxLength={6} />

              <View style={S.defaultRow}>
                <Text style={S.defaultRowTxt}>{t('savedAddresses.makeDefault')}</Text>
                <Switch
                  value={!!form?.isDefault}
                  onValueChange={set('isDefault')}
                  trackColor={{ false: COLORS.border, true: COLORS.primary + '70' }}
                  thumbColor={form?.isDefault ? COLORS.primary : COLORS.white}
                />
              </View>

              {formError ? <Text style={S.formError}>{formError}</Text> : null}

              <View style={S.sheetBtns}>
                <TouchableOpacity style={[S.secondaryBtn]} disabled={saving} onPress={() => setForm(null)}>
                  <Text style={S.secondaryBtnTxt}>{t('savedAddresses.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[S.primaryBtn, { flex: 1 }, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}>
                  {saving ? <ActivityIndicator color={COLORS.white} />
                          : <Text style={S.primaryBtnTxt}>{t('savedAddresses.save')}</Text>}
                </TouchableOpacity>
              </View>
              <View style={{ height: 16 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      <Modal visible={!!pendingDelete} transparent animationType="fade"
        onRequestClose={() => !busy && setPendingDelete(null)}>
        <View style={S.confirmBackdrop}>
          <View style={S.confirmCard}>
            <View style={S.confirmIcon}><Ionicons name="trash" size={26} color={COLORS.error} /></View>
            <Text style={S.confirmTitle}>{t('savedAddresses.deleteTitle')}</Text>
            <Text style={S.confirmBody}>{t('savedAddresses.deleteBody')}</Text>
            <View style={S.confirmBtns}>
              <TouchableOpacity style={S.secondaryBtn} disabled={busy} onPress={() => setPendingDelete(null)}>
                <Text style={S.secondaryBtnTxt}>{t('savedAddresses.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.dangerBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={confirmDelete}>
                {busy ? <ActivityIndicator color={COLORS.white} />
                      : <Text style={S.primaryBtnTxt}>{t('savedAddresses.delete')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 10 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface, paddingHorizontal: 12, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  iconBtn:     { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: COLORS.textDark },

  card: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardTop:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  typeChip:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
  typeTxt:     { fontSize: 12, fontWeight: '700', color: COLORS.primary, textTransform: 'uppercase' },
  defaultChip: { backgroundColor: COLORS.mintPale, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 2 },
  defaultTxt:  { fontSize: 11, fontWeight: '700', color: COLORS.emerald },

  name:  { fontSize: 15, fontWeight: '700', color: COLORS.textDark, marginBottom: 3 },
  line:  { fontSize: 13, color: COLORS.textMedium, lineHeight: 19 },
  phone: { fontSize: 13, color: COLORS.textMedium, marginTop: 3 },

  actions:   { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12,
               borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionTxt: { fontSize: 13, fontWeight: '600', color: COLORS.primary },

  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.gray700dark, marginTop: 10 },
  emptySub:   { fontSize: 14, color: COLORS.textMedium, textAlign: 'center' },
  errorTxt:   { fontSize: 15, color: COLORS.error, textAlign: 'center' },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 18, paddingTop: 10, maxHeight: '88%',
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border,
                 alignSelf: 'center', marginBottom: 12 },
  sheetTitle:  { fontSize: 17, fontWeight: '800', color: COLORS.textDark, marginBottom: 14 },

  typeRow:   { flexDirection: 'row', gap: 8, marginBottom: 16 },
  typeOpt:   { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1, justifyContent: 'center',
               paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  typeOptOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  typeOptTxt:{ fontSize: 13, fontWeight: '600', color: COLORS.textMedium },

  fieldLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textMedium, marginBottom: 5 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: COLORS.textDark,
    backgroundColor: COLORS.background,
  },

  defaultRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                   paddingVertical: 6, marginBottom: 6 },
  defaultRowTxt: { fontSize: 14, color: COLORS.textDark, flex: 1, paddingRight: 12 },

  formError: { fontSize: 13, color: COLORS.error, marginBottom: 10 },

  sheetBtns:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  primaryBtn:   { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 24,
                  paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  primaryBtnTxt:{ color: COLORS.white, fontWeight: '700', fontSize: 15 },
  secondaryBtn: { backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border,
                  borderRadius: 10, paddingHorizontal: 22, paddingVertical: 12,
                  alignItems: 'center', justifyContent: 'center' },
  secondaryBtnTxt: { color: COLORS.textDark, fontWeight: '700', fontSize: 15 },
  dangerBtn:    { backgroundColor: COLORS.error, borderRadius: 10, flex: 1,
                  paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },

  confirmBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  confirmCard:  { backgroundColor: COLORS.surface, borderRadius: 18, padding: 22, width: '100%', alignItems: 'center' },
  confirmIcon:  { width: 54, height: 54, borderRadius: 27, backgroundColor: COLORS.errorLight,
                  alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  confirmTitle: { fontSize: 17, fontWeight: '800', color: COLORS.textDark, marginBottom: 6, textAlign: 'center' },
  confirmBody:  { fontSize: 14, color: COLORS.textMedium, textAlign: 'center', lineHeight: 20, marginBottom: 18 },
  confirmBtns:  { flexDirection: 'row', gap: 10, width: '100%' },
});

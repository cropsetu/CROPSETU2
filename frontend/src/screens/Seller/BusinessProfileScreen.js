import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, SafeAreaView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOWS, RADIUS } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import api, { saveTokens } from '../../services/api';
import { DISTRICT_LIST, getTalukas, BUSINESS_TYPES } from '../../constants/locations';
import { isValidGst, isValidIfsc, isValidAadhaar, isValidPan } from '../../utils/validators';
import LocationPicker from '../../components/LocationPicker';

// ── Reusable form field wrapper ───────────────────────────────────────────────
function FormField({ label, required, children, hint }) {
  return (
    <View style={f.wrap}>
      <Text style={f.label}>{label}{required ? ' *' : ''}</Text>
      {children}
      {hint ? <Text style={f.hint}>{hint}</Text> : null}
    </View>
  );
}

function TextF({ value, onChangeText, placeholder, keyboardType = 'default', autoCapitalize = 'sentences', maxLength }) {
  return (
    <TextInput
      style={f.input}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={COLORS.textLight}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      maxLength={maxLength}
    />
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ icon, title, color = COLORS.sellerPrimary }) {
  return (
    <View style={sh.wrap}>
      <View style={[sh.icon, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={sh.title}>{title}</Text>
    </View>
  );
}

// ── Profile completion badge ──────────────────────────────────────────────────
function CompletionBadge({ percent }) {
  const { t } = useLanguage();
  const color = percent >= 80 ? COLORS.sellerDelivered : percent >= 50 ? COLORS.sellerPending : COLORS.error;
  return (
    <View style={[cb.wrap, { borderColor: color + '40', backgroundColor: color + '10' }]}>
      <Text style={[cb.pct, { color }]}>{percent}%</Text>
      <Text style={[cb.label, { color }]}>
        {percent >= 80 ? t('sellerBizProfile.profileComplete') : percent >= 50 ? t('sellerBizProfile.almostDone') : t('sellerBizProfile.incomplete')}
      </Text>
    </View>
  );
}

// ── Calculate profile completion ─────────────────────────────────────────────
function calcCompletion(u, form) {
  const fields = [
    u?.name,
    form.businessType,
    form.district,
    form.taluka,
    form.village,
    form.gstNumber || form.gstOptOut,
    form.bankAccountNumber,
    form.bankIfsc,
    form.bankHolderName,
    form.bankName,
  ];
  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 100);
}

export default function BusinessProfileScreen({ navigation }) {
  const { user, updateUser } = useAuth();
  const { t } = useLanguage();

  const [saving, setSaving] = useState(false);
  // Single toast slot, kind drives color: 'success' (green, slides back) | 'error' (red, stays put)
  const [toast, setToast] = useState(null); // { kind, msg } | null
  const toastAnim = useRef(new Animated.Value(0)).current;

  function flashSavedToast() {
    setToast({ kind: 'success', msg: t('sellerBizProfile.saved', 'Saved') });
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(toastAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => {
      setToast(null);
      navigation.goBack();
    });
  }

  function flashError(msg) {
    setToast({ kind: 'error', msg });
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.delay(2400),
      Animated.timing(toastAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }

  // Bank + KYC fields live under sellerProfile, not on the top-level user.
  const sp = user?.sellerProfile;

  // Whether sensitive (encrypted) fields are already on file — drives "✓ Saved" hint.
  const hasAadhaar = !!sp?.aadharNumber;
  const hasPan     = !!sp?.panNumber;
  const hasBankAcc = !!sp?.bankAccountNumber;

  // Form state — pre-fill from user object
  const [form, setForm] = useState({
    businessType:      user?.businessType     || 'individual_farmer',
    district:          user?.district         || '',
    taluka:            user?.taluka           || '',
    village:           user?.village          || '',
    gstNumber:         user?.gstNumber        || '',
    gstOptOut:         user?.gstOptOut        || (!user?.gstNumber),
    // Plain-text bank fields — safe to re-display.
    bankHolderName:    sp?.bankHolderName     || '',
    bankName:          sp?.bankName           || '',
    bankIfsc:          sp?.bankIfsc           || '',
    // Encrypted/PII — never re-display. User types fresh value to update.
    bankAccountNumber: '',
    aadharNumber:      '',
    panNumber:         '',
  });

  const set = (key) => (val) => {
    setForm((prev) => {
      const next = { ...prev, [key]: val };
      if (key === 'district') next.taluka = '';   // reset taluka on district change
      return next;
    });
  };

  const completion = calcCompletion(user, form);

  async function handleSave() {
    if (!form.district)        return flashError(t('sellerBizProfile.selectDistrictMsg', 'Please select a district'));
    if (!form.taluka)          return flashError(t('sellerBizProfile.selectTalukaMsg',   'Please select a taluka'));
    if (!form.village.trim())  return flashError(t('sellerBizProfile.enterVillageMsg',   'Please enter your village'));

    if (!form.gstOptOut && form.gstNumber.trim() && !isValidGst(form.gstNumber)) {
      return flashError(t('sellerBizProfile.invalidGstMsg', 'Invalid GST format (e.g. 27ABCDE1234F1Z5)'));
    }

    if (form.bankIfsc.trim() && !isValidIfsc(form.bankIfsc)) {
      return flashError(t('sellerBizProfile.invalidIfscMsg', 'Invalid IFSC (e.g. SBIN0012345)'));
    }

    if (form.aadharNumber.trim() && !isValidAadhaar(form.aadharNumber)) {
      return flashError(t('sellerBizProfile.invalidAadhaar', 'Aadhaar must be exactly 12 digits'));
    }

    if (form.panNumber.trim() && !isValidPan(form.panNumber)) {
      return flashError(t('sellerBizProfile.invalidPan', 'Invalid PAN format (e.g. ABCDE1234F)'));
    }

    setSaving(true);
    try {
      const payload = {
        // Submitting this seller-onboarding form is the explicit opt-in that
        // authorises a FARMER→SELLER promotion. The backend records it as a
        // SELLER_ONBOARDING consent record and only then flips the role.
        sellerConsent:  true,
        businessType:   form.businessType,
        district:       form.district,
        taluka:         form.taluka,
        village:        form.village.trim(),
        state:          'Maharashtra',
        gstOptOut:      form.gstOptOut,
        gstNumber:      form.gstOptOut ? '' : form.gstNumber.trim().toUpperCase(),
        bankHolderName: form.bankHolderName.trim(),
        bankName:       form.bankName.trim(),
        bankIfsc:       form.bankIfsc.trim().toUpperCase(),
      };
      // Only include encrypted PII fields when the user actually typed a fresh value.
      // Sending '' would encrypt the empty string and overwrite the stored value.
      const aadharIn = form.aadharNumber.trim();
      const panIn    = form.panNumber.trim().toUpperCase();
      const acctIn   = form.bankAccountNumber.trim();
      if (aadharIn) payload.aadharNumber      = aadharIn;
      if (panIn)    payload.panNumber         = panIn;
      if (acctIn)   payload.bankAccountNumber = acctIn;
      const { data } = await api.put('/users/me', payload);
      // If the backend just upgraded our role to SELLER it returns fresh tokens.
      // Persist them so the next request's JWT carries the new role; otherwise
      // SELLER-only routes (dashboard stats, inbox) keep returning 403.
      if (data.data?.tokens?.accessToken && data.data?.tokens?.refreshToken) {
        await saveTokens({
          accessToken:  data.data.tokens.accessToken,
          refreshToken: data.data.tokens.refreshToken,
          userId:       data.data.id,
        });
      }
      updateUser(data.data);
      flashSavedToast();
    } catch (e) {
      flashError(e.response?.data?.error?.message || t('sellerBizProfile.saveError', 'Failed to save profile'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      {toast && (
        <Animated.View
          pointerEvents="none"
          style={[
            s.savedToast,
            toast.kind === 'error' && { backgroundColor: '#C62828' },
            {
              opacity: toastAnim,
              transform: [{
                translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }),
              }],
            },
          ]}
        >
          <Ionicons name={toast.kind === 'error' ? 'alert-circle' : 'checkmark-circle'} size={20} color="#fff" />
          <Text style={s.savedToastTxt}>{toast.msg}</Text>
        </Animated.View>
      )}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>

          {/* Completion badge */}
          <CompletionBadge percent={completion} />

          {/* ── Business Identity ── */}
          <View style={s.section}>
            <SectionHeader icon="storefront-outline" title={t('sellerBizProfile.bizIdentity')} />

            <FormField label={t('sellerBizProfile.bizType')} required>
              <View style={s.bizChips}>
                {BUSINESS_TYPES.map((bt) => {
                  const active = form.businessType === bt.key;
                  return (
                    <TouchableOpacity
                      key={bt.key}
                      style={[s.bizChip, active && s.bizChipActive]}
                      onPress={() => set('businessType')(bt.key)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name={bt.icon} size={16} color={active ? COLORS.sellerPrimary : COLORS.gray550} />
                      <Text style={[s.bizChipTxt, active && s.bizChipTxtActive]}>{t('biz.' + bt.tKey)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </FormField>
          </View>

          {/* ── Location ── */}
          <View style={s.section}>
            <SectionHeader icon="location-outline" title={t('sellerBizProfile.yourLocation')} color={COLORS.sellerConfirmed} />

            <FormField label={t('sellerBizProfile.state')}>
              <View style={f.readOnly}>
                <Text style={f.readOnlyTxt}>Maharashtra</Text>
              </View>
            </FormField>

            <FormField label={t('sellerBizProfile.district')} required>
              <LocationPicker
                title={t('sellerBizProfile.selectDistrictTitle')}
                items={DISTRICT_LIST}
                selected={form.district}
                onSelect={set('district')}
                placeholder={t('sellerBizProfile.selectDistrictPlaceholder')}
              />
            </FormField>

            <FormField label={t('sellerBizProfile.taluka')} required>
              <LocationPicker
                title={t('sellerBizProfile.selectTalukaTitle')}
                items={getTalukas(form.district)}
                selected={form.taluka}
                onSelect={set('taluka')}
                placeholder={form.district ? t('sellerBizProfile.selectTalukaPlaceholder') : t('sellerBizProfile.selectDistrictFirst')}
                disabled={!form.district}
              />
            </FormField>

            <FormField label={t('sellerBizProfile.villageTown')} required hint={t('sellerBizProfile.primaryLocation')}>
              <TextF
                value={form.village}
                onChangeText={set('village')}
                placeholder="e.g. Kalamb, Wadgaon Sheri"
              />
            </FormField>
          </View>

          {/* ── GST ── */}
          <View style={s.section}>
            <SectionHeader icon="document-text-outline" title={t('sellerBizProfile.gstDetails')} color={COLORS.sellerShipped} />

            <TouchableOpacity
              style={s.checkRow}
              onPress={() => set('gstOptOut')(!form.gstOptOut)}
              activeOpacity={0.8}
            >
              <View style={[s.checkbox, form.gstOptOut && s.checkboxActive]}>
                {form.gstOptOut && <Ionicons name="checkmark" size={14} color={COLORS.white} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.checkLabel}>{t('sellerBizProfile.noGst')}</Text>
                <Text style={s.checkHint}>{t('sellerBizProfile.noGstHint')}</Text>
              </View>
            </TouchableOpacity>

            {!form.gstOptOut && (
              <FormField
                label={t('sellerBizProfile.gstNumber')}
                hint={t('sellerBizProfile.gstHint')}
              >
                <TextF
                  value={form.gstNumber}
                  onChangeText={set('gstNumber')}
                  placeholder="27ABCDE1234F1Z5"
                  autoCapitalize="characters"
                  maxLength={15}
                />
              </FormField>
            )}
          </View>

          {/* ── Bank Account ── */}
          <View style={s.section}>
            <SectionHeader icon="card-outline" title={t('sellerBizProfile.bankAccountSection')} color={COLORS.sellerDelivered} />
            <Text style={s.sectionHint}>{t('sellerBizProfile.bankHint')}</Text>

            <FormField label={t('sellerBizProfile.holderName')}>
              <TextF value={form.bankHolderName} onChangeText={set('bankHolderName')} placeholder={t('sellerBizProfile.holderNamePlaceholder')} />
            </FormField>

            <FormField label={t('sellerBizProfile.bankName')}>
              <TextF value={form.bankName} onChangeText={set('bankName')} placeholder={t('sellerBizProfile.bankNamePlaceholder')} />
            </FormField>

            <FormField
              label={t('sellerBizProfile.accountNumber')}
              hint={hasBankAcc ? t('sellerBizProfile.onFileHint', 'On file — leave blank to keep, enter a new number to replace') : undefined}
            >
              <TextF
                value={form.bankAccountNumber}
                onChangeText={set('bankAccountNumber')}
                placeholder={hasBankAcc ? '•••• •••• ••••' : t('sellerBizProfile.accountNumberPlaceholder')}
                keyboardType="number-pad"
                maxLength={18}
              />
            </FormField>

            <FormField label={t('sellerBizProfile.ifscCode')} hint={t('sellerBizProfile.ifscHint')}>
              <TextF
                value={form.bankIfsc}
                onChangeText={set('bankIfsc')}
                placeholder={t('sellerBizProfile.ifscPlaceholder')}
                autoCapitalize="characters"
                maxLength={11}
              />
            </FormField>
          </View>

          {/* ── KYC Documents ── */}
          <View style={s.section}>
            <SectionHeader icon="shield-checkmark-outline" title={t('sellerBizProfile.kycDocs')} color={COLORS.sellerPending} />
            <Text style={s.sectionHint}>{t('sellerBizProfile.kycHint')}</Text>

            <FormField
              label={t('sellerBizProfile.aadhaar')}
              hint={hasAadhaar ? t('sellerBizProfile.onFileHint', 'On file — leave blank to keep, enter a new number to replace') : t('sellerBizProfile.aadhaarHint')}
            >
              <TextF
                value={form.aadharNumber}
                onChangeText={set('aadharNumber')}
                placeholder={hasAadhaar ? '•••• •••• ••••' : t('sellerBizProfile.aadhaarPlaceholder')}
                keyboardType="number-pad"
                maxLength={12}
              />
            </FormField>

            <FormField
              label={t('sellerBizProfile.pan')}
              hint={hasPan ? t('sellerBizProfile.onFileHint', 'On file — leave blank to keep, enter a new number to replace') : t('sellerBizProfile.panHint')}
            >
              <TextF
                value={form.panNumber}
                onChangeText={set('panNumber')}
                placeholder={hasPan ? '••••• •••• •' : t('sellerBizProfile.panPlaceholder')}
                autoCapitalize="characters"
                maxLength={10}
              />
            </FormField>
          </View>

          {/* Data security notice */}
          <View style={s.securityNote}>
            <Ionicons name="lock-closed-outline" size={16} color={COLORS.sellerDelivered} />
            <Text style={s.securityTxt}>{t('sellerBizProfile.securityNote')}</Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Save Button */}
      <View style={s.footer}>
        <TouchableOpacity
          style={[s.saveBtn, saving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={20} color={COLORS.white} />
              <Text style={s.saveTxt}>{t('sellerBizProfile.saveBizProfile')}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.grayPaper },
  savedToast: {
    position: 'absolute', top: Platform.OS === 'web' ? 20 : 50, left: 0, right: 0,
    marginHorizontal: 'auto', alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1B7F3E', paddingHorizontal: 18, paddingVertical: 11,
    borderRadius: 26, zIndex: 1000,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  savedToastTxt: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.2 },

  section: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: 16,
    marginBottom: 12,
    ...SHADOWS.small,
  },
  sectionHint: { fontSize: 12, color: COLORS.textMedium, marginTop: -4, marginBottom: 12, lineHeight: 16 },

  bizChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  bizChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADIUS.sm, borderWidth: 1.5, borderColor: COLORS.sellerBorder,
    backgroundColor: COLORS.white,
  },
  bizChipActive: { borderColor: COLORS.sellerPrimary, backgroundColor: COLORS.sellerPrimary + '10' },
  bizChipTxt: { fontSize: 12, color: COLORS.textMedium, fontWeight: '600' },
  bizChipTxtActive: { color: COLORS.sellerPrimary },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: COLORS.gray175, justifyContent: 'center', alignItems: 'center', marginTop: 1, flexShrink: 0 },
  checkboxActive: { backgroundColor: COLORS.sellerPrimary, borderColor: COLORS.sellerPrimary },
  checkLabel: { fontSize: 14, color: COLORS.textDark, fontWeight: '600', marginBottom: 2 },
  checkHint:  { fontSize: 11, color: COLORS.textMedium, lineHeight: 15 },

  securityNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: COLORS.sellerDelivered + '10', borderRadius: RADIUS.md,
    padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.sellerDelivered + '25',
  },
  securityTxt: { flex: 1, fontSize: 12, color: COLORS.gray700dark, lineHeight: 17 },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: COLORS.white, padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    borderTopWidth: 1, borderTopColor: COLORS.grayBg,
    ...SHADOWS.medium,
  },
  saveBtn: {
    backgroundColor: COLORS.sellerPrimary, borderRadius: RADIUS.lg,
    paddingVertical: 15, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  saveTxt: { fontSize: 16, fontWeight: '800', color: COLORS.white },
});

// Section header styles
const sh = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  icon: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '800', color: COLORS.textDark },
});

// Completion badge styles
const cb = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    padding: 12, borderRadius: RADIUS.lg, borderWidth: 1,
    marginBottom: 12,
  },
  pct:   { fontSize: 22, fontWeight: '900' },
  label: { fontSize: 13, fontWeight: '700' },
});

// Form field styles
const f = StyleSheet.create({
  wrap:  { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.gray700dark, marginBottom: 6 },
  hint:  { fontSize: 11, color: COLORS.textLight, marginTop: 4 },
  input: {
    backgroundColor: COLORS.grayPaper, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.sellerBorder,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: COLORS.textDark,
  },
  readOnly: {
    backgroundColor: COLORS.grayBg, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.sellerBorder,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  readOnlyTxt: { fontSize: 15, color: COLORS.textMedium },
});

/**
 * BusinessProfileScreen — seller onboarding / KYC.
 *
 * The single most consequential form in the app: submitting it is the explicit
 * consent that promotes FARMER → SELLER, and it carries bank + Aadhaar + PAN.
 * The payload, the consent flag, the encrypted-field handling ("blank means
 * keep what's on file") and the token re-save are all unchanged.
 *
 * IT HAS TO FEEL LIKE A BANK COUNTER, NOT A SIGN-UP FORM
 * ------------------------------------------------------
 * A shop owner is being asked for an Aadhaar number and a bank account by an
 * app they installed last week. Everything visual here is spent on making that
 * feel calm and accountable:
 *
 *   - It opens on a statement of purpose and a security line, before the first
 *     input. The old screen opened straight onto a percentage.
 *   - Five numbered sections, each with a one-line explanation of what it is
 *     for, so nothing is asked for without a reason attached.
 *   - Every encrypted field carries a green lock chip on its label — at the
 *     point of entry, not in a footnote. A field whose value is already stored
 *     says so with an "On file" badge and keeps its "leave blank to keep"
 *     hint, which is the single most confusing behaviour in the form.
 *   - The completion meter turns green only at 80%+, and it never claims a
 *     stored-but-unreadable value is missing.
 *
 * What changed behaviourally:
 *   - Errors are inline and all reported at once, with the form scrolling to
 *     the first offender. It used to `return flashError(...)` on the first
 *     failure, so fixing four fields meant four submit attempts.
 *   - The bespoke toast animation is gone in favour of the shared one, which
 *     also announces itself to screen readers.
 *   - Leaving mid-form with a typed-in account number now asks first.
 *   - The completion meter is announced as a progress bar rather than a bare
 *     percentage floating in the layout.
 *   - Save is blocked while offline instead of timing out after 15 seconds.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@cropsetu/shared/context/AuthContext';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import api, { safeErrorMessage, saveTokens } from '@cropsetu/shared/services/api';
import { DISTRICT_LIST, getTalukas, BUSINESS_TYPES } from '@cropsetu/shared/constants/locations';
import { isValidGst, isValidIfsc, isValidAadhaar, isValidPan } from '@cropsetu/shared/utils/validators';

import { C, E, R, SP, T, alpha, useResponsive } from '../theme';
import { useNetwork } from '../hooks/useNetwork';
import useUnsavedChanges from '../hooks/useUnsavedChanges';
import {
  Screen, ActionBar, Button, Field, TextField, Chip, ChipGroup,
  CheckboxRow, FormSection, SelectSheet, ProgressBar, InlineNotice,
  Card, Badge,
  useConfirm, useToast,
} from '../components/ui';

/** Sections in the form, in scroll order. Drives the "01 / 05" counters. */
const TOTAL_SECTIONS = 5;

// Fields that count toward "profile complete". Kept as a list so the meter and
// the copy can never disagree about what is still missing.
const COMPLETION_FIELDS = [
  'name', 'businessType', 'district', 'taluka', 'village',
  'gst', 'bankAccountNumber', 'bankIfsc', 'bankHolderName', 'bankName',
];

function calcCompletion(user, form, onFile) {
  const filled = {
    name: !!user?.name,
    businessType: !!form.businessType,
    district: !!form.district,
    taluka: !!form.taluka,
    village: !!form.village.trim(),
    gst: !!(form.gstNumber.trim() || form.gstOptOut),
    // An encrypted field is never echoed back, so "already on file" is the only
    // way to know it is filled — the old version compared the always-empty
    // input and therefore under-reported completion for returning sellers.
    bankAccountNumber: !!(form.bankAccountNumber.trim() || onFile.bankAccount),
    bankIfsc: !!form.bankIfsc.trim(),
    bankHolderName: !!form.bankHolderName.trim(),
    bankName: !!form.bankName.trim(),
  };
  const done = COMPLETION_FIELDS.filter((k) => filled[k]).length;
  return { percent: Math.round((done / COMPLETION_FIELDS.length) * 100), filled };
}

function validate(form, t) {
  const errors = {};

  if (!form.district) errors.district = t('sellerBizProfile.selectDistrictMsg', 'Please select a district');
  if (!form.taluka) errors.taluka = t('sellerBizProfile.selectTalukaMsg', 'Please select a taluka');
  if (!form.village.trim()) errors.village = t('sellerBizProfile.enterVillageMsg', 'Please enter your village');

  if (!form.gstOptOut && form.gstNumber.trim() && !isValidGst(form.gstNumber)) {
    errors.gstNumber = t('sellerBizProfile.invalidGstMsg', 'Invalid GST format (e.g. 27ABCDE1234F1Z5)');
  }
  if (form.bankIfsc.trim() && !isValidIfsc(form.bankIfsc)) {
    errors.bankIfsc = t('sellerBizProfile.invalidIfscMsg', 'Invalid IFSC (e.g. SBIN0012345)');
  }
  if (form.aadharNumber.trim() && !isValidAadhaar(form.aadharNumber)) {
    errors.aadharNumber = t('sellerBizProfile.invalidAadhaar', 'Aadhaar must be exactly 12 digits');
  }
  if (form.panNumber.trim() && !isValidPan(form.panNumber)) {
    errors.panNumber = t('sellerBizProfile.invalidPan', 'Invalid PAN format (e.g. ABCDE1234F)');
  }

  // Account number without an IFSC can't be paid into — catch it here rather
  // than at payout time, weeks later.
  if (form.bankAccountNumber.trim() && !form.bankIfsc.trim()) {
    errors.bankIfsc = t('sellerBizProfile.ifscRequiredWithAcct', 'IFSC is required when you add an account number.');
  }

  return errors;
}

export default function BusinessProfileScreen({ navigation }) {
  const { user, updateUser } = useAuth();
  const { t } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const { isOffline } = useNetwork();
  const { gutter, isExpanded, contentMaxWidth } = useResponsive();

  // Bank + KYC live under sellerProfile, not on the top-level user.
  const sp = user?.sellerProfile;
  const onFile = useMemo(() => ({
    aadhaar: !!sp?.aadharNumber,
    pan: !!sp?.panNumber,
    bankAccount: !!sp?.bankAccountNumber,
  }), [sp]);

  const [form, setForm] = useState(() => ({
    businessType: user?.businessType || 'individual_farmer',
    district: user?.district || '',
    taluka: user?.taluka || '',
    village: user?.village || '',
    gstNumber: user?.gstNumber || '',
    gstOptOut: user?.gstOptOut || !user?.gstNumber,
    // Plain-text — safe to re-display.
    bankHolderName: sp?.bankHolderName || '',
    bankName: sp?.bankName || '',
    bankIfsc: sp?.bankIfsc || '',
    // Encrypted PII — never re-displayed; blank means "keep the stored value".
    bankAccountNumber: '',
    aadharNumber: '',
    panNumber: '',
  }));

  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);

  const setField = useCallback((key) => (value) => {
    dirtyRef.current = true;
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'district' && value !== prev.district) next.taluka = '';
      // Opting out of GST clears whatever was typed, so a stale number can't be
      // submitted behind a ticked "I don't have GST".
      if (key === 'gstOptOut' && value === true) next.gstNumber = '';
      return next;
    });
    // Clear this field's error as soon as it is edited; the full re-validation
    // happens in the effect below (only once the form has been submitted once).
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }, []);

  useEffect(() => {
    if (!submitted) return;
    setErrors(validate(form, t));
  }, [form, submitted, t]);

  const confirmDiscard = useCallback(() => confirm({
    title: t('sellerBizProfile.discardTitle', 'Leave without saving?'),
    message: t('sellerBizProfile.discardMsg', 'Your business details will not be saved.'),
    confirmLabel: t('products.discard', 'Discard'),
    cancelLabel: t('products.keepEditing', 'Keep editing'),
    destructive: true,
  }), [confirm, t]);

  const { allowNext } = useUnsavedChanges(dirtyRef.current && !saving, confirmDiscard);

  const scrollRef = useRef(null);
  const fieldY = useRef({});
  const registerY = useCallback((key) => (y) => { fieldY.current[key] = y; }, []);

  const scrollToFirstError = useCallback((errs) => {
    const order = ['district', 'taluka', 'village', 'gstNumber', 'bankIfsc', 'aadharNumber', 'panNumber'];
    const first = order.find((k) => errs[k]);
    const y = first ? fieldY.current[first] : undefined;
    if (typeof y === 'number') scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
  }, []);

  const { percent } = calcCompletion(user, form, onFile);
  const meterColor = percent >= 80 ? C.success : percent >= 50 ? C.warning : C.danger;
  const meterLabel = percent >= 80
    ? t('sellerBizProfile.profileComplete')
    : percent >= 50
      ? t('sellerBizProfile.almostDone')
      : t('sellerBizProfile.incomplete');

  const talukaOptions = useMemo(() => getTalukas(form.district), [form.district]);

  const handleSave = useCallback(async () => {
    setSubmitted(true);
    const errs = validate(form, t);
    setErrors(errs);

    if (Object.keys(errs).some((k) => errs[k])) {
      toast.error(t('products.fixErrors', 'Please fix the highlighted fields.'));
      scrollToFirstError(errs);
      return;
    }

    if (isOffline) {
      toast.warning(t('common.offlineAction', 'You are offline. Reconnect to save this.'));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        // Submitting this form is the explicit opt-in that authorises a
        // FARMER→SELLER promotion. The backend records it as a SELLER_ONBOARDING
        // consent record and only then flips the role.
        sellerConsent: true,
        businessType: form.businessType,
        district: form.district,
        taluka: form.taluka,
        village: form.village.trim(),
        state: 'Maharashtra',
        gstOptOut: form.gstOptOut,
        gstNumber: form.gstOptOut ? '' : form.gstNumber.trim().toUpperCase(),
        bankHolderName: form.bankHolderName.trim(),
        bankName: form.bankName.trim(),
        bankIfsc: form.bankIfsc.trim().toUpperCase(),
      };

      // Only send encrypted PII when the user typed a fresh value. Sending ''
      // would encrypt the empty string and destroy what is stored.
      const aadharIn = form.aadharNumber.trim();
      const panIn = form.panNumber.trim().toUpperCase();
      const acctIn = form.bankAccountNumber.trim();
      if (aadharIn) payload.aadharNumber = aadharIn;
      if (panIn) payload.panNumber = panIn;
      if (acctIn) payload.bankAccountNumber = acctIn;

      const { data } = await api.put('/users/me', payload);

      // A role upgrade returns fresh tokens; persist them so the next request's
      // JWT carries SELLER. Without this, dashboard stats and the report inbox
      // keep 403-ing.
      if (data.data?.tokens?.accessToken && data.data?.tokens?.refreshToken) {
        await saveTokens({
          accessToken: data.data.tokens.accessToken,
          refreshToken: data.data.tokens.refreshToken,
          userId: data.data.id,
        });
      }
      updateUser(data.data);

      dirtyRef.current = false;
      allowNext();
      toast.success(t('sellerBizProfile.saved', 'Saved'));

      // Reached from the dashboard → go back to it. Reached as the app's first
      // screen (account not a seller yet) there is nothing behind this one, and
      // the save has just flipped the role — so open the dashboard and drop the
      // KYC form from the stack.
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.replace('SellerDashboard');
    } catch (e) {
      toast.error(safeErrorMessage(e, t('sellerBizProfile.saveError', 'Failed to save profile')));
    } finally {
      setSaving(false);
    }
  }, [form, t, toast, isOffline, scrollToFirstError, updateUser, allowNext, navigation]);

  return (
    <Screen edges={['left', 'right']} background={C.bgAlt}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            { padding: gutter, paddingBottom: SP.huge },
            isExpanded && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* ── Purpose, then progress. In that order: a percentage is
              meaningless until you know what it is a percentage of. ── */}
          <Card style={b.intro}>
            <View style={b.introHead}>
              <View style={b.introMark}>
                <Ionicons name="shield-checkmark" size={20} color={C.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={b.introTitle} accessibilityRole="header">
                  {t('sellerProfile.bizProfileKyc', 'Business profile & KYC')}
                </Text>
                <Text style={b.introSub}>
                  {t('sellerBizProfile.securityNote')}
                </Text>
              </View>
            </View>

            <View
              style={b.meter}
              accessible
              accessibilityLabel={`${meterLabel}. ${percent}% ${t('sellerBizProfile.completion', 'complete')}`}
            >
              <View style={b.meterTop}>
                <Text style={[b.meterPct, { color: meterColor }]}>{percent}%</Text>
                <Text style={b.meterLabel} numberOfLines={2}>{meterLabel}</Text>
              </View>
              <ProgressBar
                value={percent}
                color={meterColor}
                label={t('sellerBizProfile.completion', 'Profile completion')}
                style={{ marginTop: SP.md }}
              />
            </View>
          </Card>

          {submitted && Object.values(errors).some(Boolean) ? (
            <InlineNotice variant="error" style={{ marginBottom: SP.lg }}>
              {t('products.fixErrors', 'Please fix the highlighted fields.')}
            </InlineNotice>
          ) : null}

          {/* ── Business identity ── */}
          <FormSection
            icon="storefront-outline"
            title={t('sellerBizProfile.bizIdentity')}
            hint={t('sellerBizProfile.bizIdentityHint', 'How buyers will see your shop.')}
            step={1}
            total={TOTAL_SECTIONS}
          >
            <Field label={t('sellerBizProfile.bizType')} required>
              <ChipGroup accessibilityLabel={t('sellerBizProfile.bizType')}>
                {BUSINESS_TYPES.map((bt) => (
                  <Chip
                    key={bt.key}
                    label={t('biz.' + bt.tKey)}
                    icon={bt.icon}
                    selected={form.businessType === bt.key}
                    onPress={() => setField('businessType')(bt.key)}
                  />
                ))}
              </ChipGroup>
            </Field>
          </FormSection>

          {/* ── Location ── */}
          <FormSection
            icon="location-outline"
            title={t('sellerBizProfile.yourLocation')}
            hint={t('sellerBizProfile.primaryLocation')}
            step={2}
            total={TOTAL_SECTIONS}
          >
            <Field label={t('sellerBizProfile.state')}>
              <TextField
                value={t('scope.state')}
                editable={false}
                label={t('sellerBizProfile.state')}
                accessibilityHint={t('sellerBizProfile.stateFixed', 'Currently fixed to Maharashtra')}
              />
            </Field>

            <Field
              label={t('sellerBizProfile.district')}
              required
              error={errors.district}
              onLayoutY={registerY('district')}
            >
              <SelectSheet
                title={t('sellerBizProfile.selectDistrictTitle')}
                placeholder={t('sellerBizProfile.selectDistrictPlaceholder')}
                items={DISTRICT_LIST}
                value={form.district}
                onChange={setField('district')}
                accessibilityLabel={t('sellerBizProfile.district')}
              />
            </Field>

            <Field
              label={t('sellerBizProfile.taluka')}
              required
              error={errors.taluka}
              onLayoutY={registerY('taluka')}
            >
              <SelectSheet
                title={t('sellerBizProfile.selectTalukaTitle')}
                placeholder={form.district
                  ? t('sellerBizProfile.selectTalukaPlaceholder')
                  : t('sellerBizProfile.selectDistrictFirst')}
                items={talukaOptions}
                value={form.taluka}
                onChange={setField('taluka')}
                disabled={!form.district}
                accessibilityLabel={t('sellerBizProfile.taluka')}
              />
            </Field>

            <Field
              label={t('sellerBizProfile.villageTown')}
              required
              hint={errors.village ? undefined : t('sellerBizProfile.primaryLocation')}
              error={errors.village}
              onLayoutY={registerY('village')}
            >
              <TextField
                value={form.village}
                onChangeText={setField('village')}
                placeholder={t('sellerBizProfile.villagePlaceholder')}
                error={errors.village}
                label={t('sellerBizProfile.villageTown')}
              />
            </Field>
          </FormSection>

          {/* ── GST ── */}
          <FormSection
            icon="document-text-outline"
            title={t('sellerBizProfile.gstDetails')}
            hint={t('sellerBizProfile.gstHint')}
            step={3}
            total={TOTAL_SECTIONS}
          >
            <CheckboxRow
              checked={form.gstOptOut}
              onToggle={() => setField('gstOptOut')(!form.gstOptOut)}
              label={t('sellerBizProfile.noGst')}
              hint={t('sellerBizProfile.noGstHint')}
            />

            {!form.gstOptOut ? (
              <Field
                label={t('sellerBizProfile.gstNumber')}
                hint={errors.gstNumber ? undefined : t('sellerBizProfile.gstHint')}
                error={errors.gstNumber}
                onLayoutY={registerY('gstNumber')}
                style={{ marginTop: SP.md }}
              >
                <TextField
                  value={form.gstNumber}
                  onChangeText={setField('gstNumber')}
                  placeholder={t('sellerBizProfile.gstPlaceholder', '27ABCDE1234F1Z5')}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={15}
                  error={errors.gstNumber}
                  label={t('sellerBizProfile.gstNumber')}
                />
              </Field>
            ) : null}
          </FormSection>

          {/* ── Bank ── */}
          <FormSection
            icon="card-outline"
            title={t('sellerBizProfile.bankAccountSection')}
            hint={t('sellerBizProfile.bankHint')}
            step={4}
            total={TOTAL_SECTIONS}
          >
            <Field label={t('sellerBizProfile.holderName')}>
              <TextField
                value={form.bankHolderName}
                onChangeText={setField('bankHolderName')}
                placeholder={t('sellerBizProfile.holderNamePlaceholder')}
                autoCapitalize="words"
                label={t('sellerBizProfile.holderName')}
              />
            </Field>

            <Field label={t('sellerBizProfile.bankName')}>
              <TextField
                value={form.bankName}
                onChangeText={setField('bankName')}
                placeholder={t('sellerBizProfile.bankNamePlaceholder')}
                autoCapitalize="words"
                label={t('sellerBizProfile.bankName')}
              />
            </Field>

            <Field
              label={t('sellerBizProfile.accountNumber')}
              secure
              secureLabel={t('sellerBizProfile.encrypted', 'Encrypted')}
              hint={onFile.bankAccount
                ? t('sellerBizProfile.onFileHint', 'On file — leave blank to keep, enter a new number to replace')
                : undefined}
            >
              <TextField
                value={form.bankAccountNumber}
                onChangeText={setField('bankAccountNumber')}
                placeholder={onFile.bankAccount ? '•••• •••• ••••' : t('sellerBizProfile.accountNumberPlaceholder')}
                keyboardType="number-pad"
                maxLength={18}
                label={t('sellerBizProfile.accountNumber')}
                suffix={onFile.bankAccount
                  ? <Badge label={t('sellerBizProfile.onFile', 'On file')} color={C.success} icon="lock-closed" />
                  : null}
              />
            </Field>

            <Field
              label={t('sellerBizProfile.ifscCode')}
              hint={errors.bankIfsc ? undefined : t('sellerBizProfile.ifscHint')}
              error={errors.bankIfsc}
              onLayoutY={registerY('bankIfsc')}
            >
              <TextField
                value={form.bankIfsc}
                onChangeText={setField('bankIfsc')}
                placeholder={t('sellerBizProfile.ifscPlaceholder')}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={11}
                error={errors.bankIfsc}
                label={t('sellerBizProfile.ifscCode')}
              />
            </Field>
          </FormSection>

          {/* ── KYC ── */}
          <FormSection
            icon="shield-checkmark-outline"
            title={t('sellerBizProfile.kycDocs')}
            hint={t('sellerBizProfile.kycHint')}
            step={5}
            total={TOTAL_SECTIONS}
          >
            <Field
              label={t('sellerBizProfile.aadhaar')}
              secure
              secureLabel={t('sellerBizProfile.encrypted', 'Encrypted')}
              hint={errors.aadharNumber
                ? undefined
                : onFile.aadhaar
                  ? t('sellerBizProfile.onFileHint', 'On file — leave blank to keep, enter a new number to replace')
                  : t('sellerBizProfile.aadhaarHint')}
              error={errors.aadharNumber}
              onLayoutY={registerY('aadharNumber')}
            >
              <TextField
                value={form.aadharNumber}
                onChangeText={setField('aadharNumber')}
                placeholder={onFile.aadhaar ? '•••• •••• ••••' : t('sellerBizProfile.aadhaarPlaceholder')}
                keyboardType="number-pad"
                maxLength={12}
                error={errors.aadharNumber}
                label={t('sellerBizProfile.aadhaar')}
                suffix={onFile.aadhaar
                  ? <Badge label={t('sellerBizProfile.onFile', 'On file')} color={C.success} icon="lock-closed" />
                  : null}
              />
            </Field>

            <Field
              label={t('sellerBizProfile.pan')}
              secure
              secureLabel={t('sellerBizProfile.encrypted', 'Encrypted')}
              hint={errors.panNumber
                ? undefined
                : onFile.pan
                  ? t('sellerBizProfile.onFileHint', 'On file — leave blank to keep, enter a new number to replace')
                  : t('sellerBizProfile.panHint')}
              error={errors.panNumber}
              onLayoutY={registerY('panNumber')}
            >
              <TextField
                value={form.panNumber}
                onChangeText={setField('panNumber')}
                placeholder={onFile.pan ? '••••• •••• •' : t('sellerBizProfile.panPlaceholder')}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={10}
                error={errors.panNumber}
                label={t('sellerBizProfile.pan')}
                suffix={onFile.pan
                  ? <Badge label={t('sellerBizProfile.onFile', 'On file')} color={C.success} icon="lock-closed" />
                  : null}
              />
            </Field>
          </FormSection>

          {/* Repeated at the point of submission, not only at the top: this is
              the moment the seller is actually handing the data over. */}
          <InlineNotice variant="success" icon="lock-closed">
            {t('sellerBizProfile.securityNote')}
          </InlineNotice>
        </ScrollView>
      </KeyboardAvoidingView>

      <ActionBar>
        <Button
          label={t('sellerBizProfile.saveBizProfile')}
          icon="checkmark-circle-outline"
          size="lg"
          fullWidth
          loading={saving}
          disabled={saving}
          onPress={handleSave}
        />
      </ActionBar>
    </Screen>
  );
}

const b = StyleSheet.create({
  intro: { marginBottom: SP.lg, ...E.raised },
  introHead: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.lg },
  introMark: {
    width: 42, height: 42, borderRadius: R.sm,
    backgroundColor: C.successPale,
    borderWidth: 1,
    borderColor: alpha(C.success, 0.22),
    alignItems: 'center', justifyContent: 'center',
  },
  introTitle: { ...T.subhead, color: C.text },
  introSub: { ...T.caption, color: C.textMuted, marginTop: SP.xs, lineHeight: 18 },

  meter: {
    marginTop: SP.xl,
    paddingTop: SP.lg,
    borderTopWidth: 1,
    borderTopColor: C.divider,
  },
  meterTop: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  meterPct: { ...T.figureMd },
  meterLabel: { ...T.label, color: C.textMuted, flex: 1 },
});

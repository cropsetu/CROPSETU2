/**
 * SellerProfileScreen — account overview and settings.
 *
 * Same endpoint (`PUT /users/me` with the display name) and same navigation
 * targets.
 *
 * THE COMPOSITION
 * ---------------
 * The old screen led with a full-bleed orange gradient, a pulsing halo around
 * the avatar and a centred name — the visual language of a social profile,
 * applied to what is actually a business account page. It now leads the way a
 * letterhead does: identity on the left, ruled off from the content below,
 * with the completion meter as the first thing under the rule because it is
 * the only thing on this screen that has an action attached to it.
 *
 * Settings are grouped into ruled cards under tracked eyebrows rather than
 * floating in a single long list, so "account", "business" and "legal" are
 * separable at a glance — which matters because the business group is the one
 * that gates getting paid.
 *
 * WHAT THE BEHAVIOUR STILL GUARANTEES
 *   - The Terms and Privacy rows had `onPress={() => {}}`. They looked
 *     tappable, had a chevron, and did nothing. They open the real documents
 *     (and say so when there is no browser to open them in).
 *   - The avatar's halo ran an unbounded `Animated.loop` for the lifetime of
 *     the screen, foreground or not. The halo is gone entirely: it was
 *     decoration around a static initial, and deleting it is cheaper than
 *     making it correct.
 *   - The completion figure double-counted: it read `user.bankAccountNumber`,
 *     which is never present (bank fields live under `user.sellerProfile`), so
 *     a fully-onboarded seller was permanently shown as incomplete.
 *   - Name editing has a length limit, trim feedback, and reports failures
 *     through a toast rather than an Alert that is invisible on web.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@cropsetu/shared/context/AuthContext';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import api, { safeErrorMessage } from '@cropsetu/shared/services/api';
import { BUSINESS_TYPES } from '@cropsetu/shared/constants/locations';

import { C, E, HIT, R, SP, T, alpha, useResponsive } from '../theme';
import { useNetwork } from '../hooks/useNetwork';
import {
  Screen, Button, IconButton, PressableRow, TextField, Rule,
  Card, Avatar, Badge, ProgressBar, useConfirm, useToast,
} from '../components/ui';

const TERMS_URL = 'https://cropsetu.app/terms';
const PRIVACY_URL = 'https://cropsetu.app/privacy';
const MAX_NAME = 60;

/**
 * Completion, counted against the fields the KYC form actually writes.
 * `sellerProfile` is the source of truth for bank details.
 */
function calcCompletion(user) {
  const sp = user?.sellerProfile;
  const checks = [
    user?.name,
    user?.businessType,
    user?.district,
    user?.taluka,
    user?.village,
    user?.gstNumber || user?.gstOptOut,
    sp?.bankAccountNumber,
    sp?.bankIfsc,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

// ── Row ──────────────────────────────────────────────────────────────────────

function Row({ icon, label, value, onPress, badge, hint, last }) {
  return (
    <PressableRow
      onPress={onPress}
      accessibilityLabel={value ? `${label}: ${value}` : label}
      accessibilityHint={hint}
      style={[r.row, !last && r.rowRuled]}
    >
      <View style={r.rowIcon}>
        <Ionicons name={icon} size={18} color={C.brandInk} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={r.rowLabel} numberOfLines={1}>{label}</Text>
        {value ? <Text style={r.rowValue} numberOfLines={2}>{value}</Text> : null}
      </View>
      {badge ? (
        <Badge label={badge.text} color={badge.color} icon={badge.icon} />
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
      ) : null}
    </PressableRow>
  );
}

function SectionCard({ title, children }) {
  return (
    <View style={r.section}>
      <Text style={r.sectionTitle} accessibilityRole="header">{title}</Text>
      <Card padded={false}>{children}</Card>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function SellerProfileScreen({ navigation }) {
  const { user, logout, updateUser } = useAuth();
  const { t } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const { isOffline } = useNetwork();
  const { gutter, isExpanded, contentMaxWidth } = useResponsive();

  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [nameError, setNameError] = useState(null);
  const [saving, setSaving] = useState(false);

  const completion = calcCompletion(user);
  const completionColor = completion >= 80 ? C.success : completion >= 50 ? C.warning : C.danger;

  const bizType = useMemo(
    () => BUSINESS_TYPES.find((b) => b.key === user?.businessType),
    [user?.businessType],
  );
  const bizTypeLabel = bizType ? t('biz.' + bizType.tKey) : t('notSet', 'Not set');

  const locationStr = [user?.village, user?.taluka, user?.district].filter(Boolean).join(', ') || null;

  const startEdit = useCallback(() => {
    setName(user?.name || '');
    setNameError(null);
    setEditMode(true);
  }, [user?.name]);

  const cancelEdit = useCallback(() => {
    setName(user?.name || '');
    setNameError(null);
    setEditMode(false);
  }, [user?.name]);

  const handleSaveName = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('sellerProfile.nameRequired', 'Please enter your name.'));
      return;
    }
    if (trimmed === (user?.name || '')) {
      setEditMode(false);
      return;
    }
    if (isOffline) {
      toast.warning(t('common.offlineAction', 'You are offline. Reconnect to save this.'));
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.put('/users/me', { name: trimmed });
      updateUser(data.data);
      setEditMode(false);
      toast.success(t('sellerProfile.nameUpdated', 'Name updated'));
    } catch (e) {
      const message = safeErrorMessage(e, t('sellerProfile.updateError', 'Could not update your name.'));
      setNameError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [name, user?.name, isOffline, toast, t, updateUser]);

  const handleLogout = useCallback(async () => {
    const ok = await confirm({
      title: t('logout', 'Log out'),
      message: t('logoutConfirm', 'Are you sure you want to log out?'),
      confirmLabel: t('logout', 'Log out'),
      cancelLabel: t('cancel', 'Cancel'),
      destructive: true,
      icon: 'log-out-outline',
    });
    if (ok) logout();
  }, [confirm, logout, t]);

  // A URL that can't be opened (no browser, blocked scheme) should say so
  // rather than doing nothing — the failure mode the old empty handlers had.
  const openUrl = useCallback(async (url) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('unsupported');
      await Linking.openURL(url);
    } catch {
      toast.error(t('common.linkFailed', 'Could not open the link on this device.'));
    }
  }, [toast, t]);

  const showHelp = useCallback(() => {
    confirm({
      title: t('sellerProfile.helpCenter', 'Help centre'),
      message: t('sellerProfile.helpMsg'),
      confirmLabel: t('common.gotIt', 'Got it'),
      cancelLabel: t('cancel', 'Cancel'),
      icon: 'help-circle-outline',
    });
  }, [confirm, t]);

  const constrain = isExpanded && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' };

  return (
    <Screen edges={['top', 'left', 'right']} background={C.bgAlt}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: SP.huge }}
      >
        <View style={[{ paddingHorizontal: gutter }, constrain]}>
          {/* ── Identity ── */}
          <View style={sp.header}>
            {editMode ? (
              <View style={sp.editWrap}>
                <TextField
                  value={name}
                  onChangeText={(v) => { setName(v); if (nameError) setNameError(null); }}
                  placeholder={t('sellerProfile.yourName', 'Your name')}
                  label={t('sellerProfile.displayName', 'Display name')}
                  maxLength={MAX_NAME}
                  autoCapitalize="words"
                  error={nameError}
                  returnKeyType="done"
                  onSubmitEditing={handleSaveName}
                />
                {nameError ? (
                  <Text style={sp.nameError} accessibilityLiveRegion="polite">{nameError}</Text>
                ) : null}
                <View style={sp.editBtns}>
                  <Button
                    label={t('cancel', 'Cancel')}
                    variant="neutral"
                    size="md"
                    onPress={cancelEdit}
                    disabled={saving}
                    style={{ flex: 1 }}
                  />
                  <Button
                    label={t('save', 'Save')}
                    size="md"
                    loading={saving}
                    onPress={handleSaveName}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            ) : (
              <View style={sp.identity}>
                <Avatar name={user?.name} size={68} />
                <View style={{ flex: 1 }}>
                  <Text style={sp.name} numberOfLines={2} accessibilityRole="header">
                    {user?.name?.trim() || t('seller', 'Seller')}
                  </Text>
                  {user?.phone ? <Text style={sp.phone}>+91 {user.phone}</Text> : null}
                  {bizType ? (
                    <Badge
                      label={bizTypeLabel}
                      icon="storefront-outline"
                      style={{ marginTop: SP.sm }}
                    />
                  ) : null}
                </View>
                <IconButton
                  icon="pencil"
                  size={17}
                  color={C.brandInk}
                  background={C.surface}
                  onPress={startEdit}
                  accessibilityLabel={t('sellerProfile.editName', 'Edit name')}
                  buttonStyle={sp.editIcon}
                />
              </View>
            )}
          </View>

          <Rule />

          {/* ── Completion ── */}
          <PressableRow
            onPress={() => navigation.navigate('BusinessProfile')}
            accessibilityLabel={`${t('sellerProfile.completion', 'Profile completion')}: ${completion}%`}
            accessibilityHint={t('sellerProfile.completionHint', 'Opens your business profile to fill in what is missing')}
            style={sp.completionWrap}
          >
            <Card style={sp.completionCard}>
              <View style={sp.completionTop}>
                <View style={{ flex: 1 }}>
                  <Text style={sp.completionTitle}>{t('sellerProfile.completion', 'Profile completion')}</Text>
                  <Text style={sp.completionSub} numberOfLines={2}>
                    {completion < 100
                      ? t('sellerProfile.completionSub')
                      : t('sellerProfile.completionDone')}
                  </Text>
                </View>
                <Text style={[sp.completionPct, { color: completionColor }]}>{completion}%</Text>
                <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
              </View>
              <ProgressBar
                value={completion}
                color={completionColor}
                label={t('sellerProfile.completion', 'Profile completion')}
                style={{ marginTop: SP.lg }}
              />
            </Card>
          </PressableRow>

          {/* ── Account ── */}
          <SectionCard title={t('sellerProfile.account', 'Account')}>
            <Row
              icon="call-outline"
              label={t('sellerProfile.phoneNumber', 'Phone number')}
              value={user?.phone ? `+91 ${user.phone}` : t('notSet', 'Not set')}
            />
            <Row
              icon="person-outline"
              label={t('sellerProfile.displayName', 'Display name')}
              value={user?.name || t('notSet', 'Not set')}
              onPress={startEdit}
            />
            <Row
              icon="location-outline"
              label={t('sellerProfile.location', 'Location')}
              value={locationStr || t('sellerProfile.notSetTap')}
              onPress={() => navigation.navigate('BusinessProfile')}
              last
            />
          </SectionCard>

          {/* ── Business ── */}
          <SectionCard title={t('sellerProfile.businessInfo', 'Business')}>
            <Row
              icon="storefront-outline"
              label={t('sellerProfile.businessType', 'Business type')}
              value={bizTypeLabel}
              onPress={() => navigation.navigate('BusinessProfile')}
            />
            <Row
              icon="document-text-outline"
              label={t('sellerProfile.gstNumber', 'GST number')}
              value={
                user?.gstNumber ? user.gstNumber
                  : user?.gstOptOut ? t('sellerProfile.notApplicable', 'Not applicable')
                    : t('sellerProfile.notAdded', 'Not added')
              }
              onPress={() => navigation.navigate('BusinessProfile')}
              badge={
                user?.gstNumber
                  ? { text: t('sellerProfile.verified', 'Verified'), color: C.success, icon: 'checkmark-circle' }
                  : user?.gstOptOut
                    ? { text: t('sellerProfile.exempt', 'Exempt'), color: C.warning, icon: 'remove-circle-outline' }
                    : null
              }
            />
            <Row
              icon="card-outline"
              label={t('sellerProfile.bankAccount', 'Bank account')}
              value={
                user?.sellerProfile?.bankAccountNumber
                  ? [
                      `••••${String(user.sellerProfile.bankAccountNumber).slice(-4)}`,
                      user.sellerProfile.bankName,
                    ].filter(Boolean).join(' · ')
                  : t('sellerProfile.notAdded', 'Not added')
              }
              onPress={() => navigation.navigate('BusinessProfile')}
              badge={
                user?.sellerProfile?.bankAccountNumber
                  ? { text: t('sellerProfile.added', 'Added'), color: C.success, icon: 'lock-closed' }
                  : null
              }
            />
            <Row
              icon="shield-checkmark-outline"
              label={t('sellerProfile.kycStatus', 'KYC status')}
              value={user?.kycStatus === 'verified'
                ? t('sellerProfile.verified', 'Verified')
                : t('sellerProfile.pendingVerification', 'Pending verification')}
              badge={user?.kycStatus === 'verified'
                ? { text: t('sellerProfile.verified', 'Verified'), color: C.success, icon: 'checkmark-circle' }
                : { text: t('sellerProfile.pending', 'Pending'), color: C.warning, icon: 'hourglass-outline' }}
              last
            />
          </SectionCard>

          {/* ── Seller info ── */}
          <SectionCard title={t('sellerProfile.sellerInfo', 'Seller')}>
            <Row
              icon="calendar-outline"
              label={t('sellerProfile.sellerSince', 'Seller since')}
              value={(() => {
                const created = user?.createdAt ? new Date(user.createdAt) : null;
                return created && !Number.isNaN(created.getTime())
                  ? created.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
                  : '—';
              })()}
            />
            <Row
              icon="pulse-outline"
              label={t('sellerProfile.accountStatus', 'Account status')}
              value={t('sellerProfile.active', 'Active')}
              badge={{ text: t('sellerProfile.active', 'Active'), color: C.success, icon: 'ellipse' }}
              last
            />
          </SectionCard>

          {/* ── Actions ── */}
          <SectionCard title={t('sellerProfile.quickActions', 'More')}>
            <Row
              icon="briefcase-outline"
              label={t('sellerProfile.bizProfileKyc', 'Business profile & KYC')}
              value={t('sellerProfile.bizProfileSub')}
              onPress={() => navigation.navigate('BusinessProfile')}
            />
            <Row
              icon="help-circle-outline"
              label={t('sellerProfile.helpCenter', 'Help centre')}
              onPress={showHelp}
            />
            <Row
              icon="document-text-outline"
              label={t('sellerProfile.terms', 'Terms of service')}
              onPress={() => openUrl(TERMS_URL)}
              hint={t('common.opensBrowser', 'Opens in your browser')}
            />
            <Row
              icon="lock-closed-outline"
              label={t('sellerProfile.privacy', 'Privacy policy')}
              onPress={() => openUrl(PRIVACY_URL)}
              hint={t('common.opensBrowser', 'Opens in your browser')}
              last
            />
          </SectionCard>

          <Button
            label={t('logout', 'Log out')}
            icon="log-out-outline"
            variant="dangerSoft"
            size="lg"
            fullWidth
            haptic="warning"
            onPress={handleLogout}
            style={{ marginTop: SP.xxl }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const sp = StyleSheet.create({
  header: { paddingTop: SP.xl, paddingBottom: SP.xl },
  identity: { flexDirection: 'row', alignItems: 'center', gap: SP.lg },
  name: { ...T.title, color: C.text },
  phone: { ...T.body, color: C.textMuted, marginTop: 2 },
  editIcon: {
    width: HIT.minCompact,
    height: HIT.minCompact,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
  },

  editWrap: { gap: SP.md },
  nameError: { ...T.captionBold, color: C.danger, textAlign: 'center' },
  editBtns: { flexDirection: 'row', gap: SP.md },

  completionWrap: { marginTop: SP.xl, borderRadius: R.xl },
  completionCard: { ...E.raised },
  completionTop: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  completionTitle: { ...T.bodyBold, color: C.text },
  completionSub: { ...T.caption, color: C.textMuted, marginTop: 2 },
  completionPct: { ...T.figureMd },
});

const r = StyleSheet.create({
  section: { marginTop: SP.xxl },
  sectionTitle: {
    ...T.section,
    color: C.textMuted,
    textTransform: 'uppercase',
    marginBottom: SP.md,
    marginLeft: SP.xs,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.lg,
    paddingHorizontal: SP.xl,
    paddingVertical: SP.lg,
    minHeight: HIT.min + 8,
  },
  rowRuled: { borderBottomWidth: 1, borderBottomColor: C.divider },
  rowIcon: {
    width: 38, height: 38, borderRadius: R.sm,
    backgroundColor: C.brandPale,
    borderWidth: 1,
    borderColor: alpha(C.brand, 0.18),
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { ...T.bodyBold, color: C.text },
  rowValue: { ...T.caption, color: C.textMuted, marginTop: 2 },
});

/**
 * Delete Account — DPDP Act §8 "Right to Erasure" (client flow).
 *
 * Two deliberate steps, because the action is irreversible:
 *   1. CONFIRM — spell out exactly what is erased and what is retained, so the
 *      farmer is not surprised later that their past orders still exist.
 *   2. VERIFY  — an OTP is sent to the registered phone and posted back with the
 *      delete. The backend (DELETE /users/me) refuses without a live OTP for
 *      THIS user's number, so a stolen/left-open handset cannot wipe an account.
 *
 * On success the server has already invalidated our tokens (sessions deleted +
 * tokenVersion bumped), so we call logout() to clear local state and land the
 * user back on the login screen.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Modal, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@cropsetu/shared/context/AuthContext';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import api from '@cropsetu/shared/services/api';
import { KHET, KFONT, KSHADOW } from '@cropsetu/shared/constants/khetTheme';

const RESEND_COOLDOWN_SEC = 30;

/** 9876543210 → +91 98••••••10. Never render the full number in a danger dialog. */
function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return '';
  return `+91 ${digits.slice(0, 2)}${'•'.repeat(6)}${digits.slice(8)}`;
}

/**
 * Map a failed erase/send into a translated, farmer-readable line. The server
 * messages are English-only, so we key off status and fall back to its text.
 */
function errorFor(err, t) {
  const status = err?.response?.status;
  const serverMsg = err?.response?.data?.error?.message || err?.response?.data?.message;
  if (status === 401) return t('deleteAccount.errWrongOtp', 'That OTP is incorrect or has expired. Please try again.');
  if (status === 423) return t('deleteAccount.errLocked', 'Too many wrong attempts. Please try again later.');
  if (status === 429) return t('deleteAccount.errTooMany', 'Too many requests. Please wait a few minutes and try again.');
  if (status === 422 || status === 400) return serverMsg || t('deleteAccount.errOtpFormat', 'Enter the 6-digit code.');
  if (!err?.response) return t('deleteAccount.errNetwork', 'No connection. Check your internet and try again.');
  return serverMsg || t('deleteAccount.errGeneric', 'Could not delete your account. Please try again.');
}

export default function DeleteAccountModal({ visible, onClose }) {
  const { user, sendOtp, logout } = useAuth();
  const { t } = useLanguage();

  const [step,      setStep]      = useState('confirm'); // 'confirm' | 'otp' | 'done'
  const [otp,       setOtp]       = useState('');
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState('');
  const [cooldown,  setCooldown]  = useState(0);
  // Dev/staging convenience: with MSG91 unset the backend returns the OTP in the
  // send response so there is something to type without a real SMS.
  const [devOtp,    setDevOtp]    = useState('');

  const timerRef = useRef(null);
  // Guards a setState after the modal unmounts mid-request (RN warns otherwise).
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; if (timerRef.current) clearInterval(timerRef.current); }, []);

  // Reset to a clean first step every time the sheet is reopened, so a cancelled
  // attempt never leaves a stale OTP or error on screen.
  useEffect(() => {
    if (!visible) return;
    setStep('confirm'); setOtp(''); setError(''); setBusy(false); setDevOtp('');
    setCooldown(0);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, [visible]);

  const startCooldown = useCallback(() => {
    setCooldown(RESEND_COOLDOWN_SEC);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(timerRef.current); timerRef.current = null; return 0; }
        return c - 1;
      });
    }, 1000);
  }, []);

  // Step 1 → 2. sendOtp() transparently solves the proof-of-work challenge the
  // server issues under suspicion, so we just await it.
  const requestOtp = useCallback(async () => {
    if (!user?.phone) { setError(t('deleteAccount.errNoPhone', 'No phone number on this account.')); return; }
    setBusy(true); setError('');
    try {
      const res = await sendOtp(user.phone);
      if (!aliveRef.current) return;
      // Same shape LoginScreen reads. Deliberately NOT auto-filled here: on a
      // destructive action the user should type the code on purpose.
      const dev = res?.data?.devOtp ?? res?.devOtp;
      setDevOtp(/^\d{6}$/.test(String(dev ?? '')) ? String(dev) : '');
      setStep('otp');
      setOtp('');
      startCooldown();
    } catch (err) {
      if (aliveRef.current) setError(errorFor(err, t));
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [user?.phone, sendOtp, startCooldown, t]);

  // Step 2 — the irreversible call.
  const confirmDelete = useCallback(async () => {
    if (otp.length !== 6) { setError(t('deleteAccount.errOtpFormat', 'Enter the 6-digit code.')); return; }
    setBusy(true); setError('');
    try {
      // axios sends a body on DELETE only via `data`.
      await api.delete('/users/me', { data: { otp } });
      if (!aliveRef.current) return;
      setStep('done');
      // Brief confirmation, then tear down the session. Our tokens are already
      // dead server-side; logout() clears storage, socket and auth state, which
      // unmounts this screen via the root navigator.
      setTimeout(() => { logout(); }, 1600);
    } catch (err) {
      if (aliveRef.current) { setError(errorFor(err, t)); setBusy(false); }
    }
  }, [otp, logout, t]);

  const dismiss = busy ? () => {} : onClose;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <KeyboardAvoidingView
        style={S.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={S.card}>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={S.cardInner}>

            {step === 'confirm' && (
              <>
                <View style={S.iconWrap}>
                  <Ionicons name="trash-outline" size={26} color={KHET.destructive} />
                </View>
                <Text style={S.title}>{t('deleteAccount.title', 'Delete account?')}</Text>
                <Text style={S.msg}>
                  {t('deleteAccount.intro', 'This permanently erases your personal data. It cannot be undone.')}
                </Text>

                <View style={S.listBlock}>
                  <Text style={S.listHead}>{t('deleteAccount.erasedHead', 'Permanently erased')}</Text>
                  {[
                    t('deleteAccount.erasedProfile', 'Your profile, phone number and photo'),
                    t('deleteAccount.erasedFarms',   'Farms, crop cycles, soil and irrigation records'),
                    t('deleteAccount.erasedAi',      'AI chats, voice sessions and crop scans'),
                    t('deleteAccount.erasedSeller',  'Saved addresses, cart, and seller bank/KYC details'),
                  ].map((line) => (
                    <View key={line} style={S.listRow}>
                      <Ionicons name="close-circle" size={15} color={KHET.destructive} />
                      <Text style={S.listTxt}>{line}</Text>
                    </View>
                  ))}
                </View>

                <View style={S.listBlock}>
                  <Text style={S.listHead}>{t('deleteAccount.keptHead', 'Kept, but no longer linked to you')}</Text>
                  {[
                    t('deleteAccount.keptOrders',   'Past orders and bookings (required for tax and the other party)'),
                    t('deleteAccount.keptListings', 'Community posts and listings, shown as “Deleted User”'),
                  ].map((line) => (
                    <View key={line} style={S.listRow}>
                      <Ionicons name="information-circle" size={15} color={KHET.mutedForeground} />
                      <Text style={S.listTxt}>{line}</Text>
                    </View>
                  ))}
                </View>

                <Text style={S.note}>
                  {t('deleteAccount.reuseNote', 'Your phone number is freed, so you can sign up again later as a new account.')}
                </Text>

                {!!error && <Text style={S.error}>{error}</Text>}

                <View style={S.btnRow}>
                  <TouchableOpacity style={[S.btn, S.btnCancel]} onPress={dismiss} disabled={busy} activeOpacity={0.8}>
                    <Text style={S.btnCancelTxt}>{t('cancel', 'Cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[S.btn, S.btnDanger, busy && S.btnDisabled]}
                    onPress={requestOtp}
                    disabled={busy}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                  >
                    {busy
                      ? <ActivityIndicator size="small" color={KHET.white} />
                      : <Text style={S.btnDangerTxt}>{t('deleteAccount.continue', 'Continue')}</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}

            {step === 'otp' && (
              <>
                <View style={S.iconWrap}>
                  <Ionicons name="shield-checkmark-outline" size={26} color={KHET.destructive} />
                </View>
                <Text style={S.title}>{t('deleteAccount.verifyTitle', 'Confirm it’s you')}</Text>
                <Text style={S.msg}>
                  {t('deleteAccount.verifyMsg', 'We sent a 6-digit code to {{phone}}. Enter it to permanently delete your account.', { phone: maskPhone(user?.phone) })}
                </Text>

                <TextInput
                  style={S.otpInput}
                  value={otp}
                  onChangeText={(v) => { setOtp(v.replace(/\D/g, '').slice(0, 6)); setError(''); }}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                  editable={!busy}
                  placeholder="000000"
                  placeholderTextColor={KHET.mutedForeground + '66'}
                  textContentType="oneTimeCode"
                  accessibilityLabel={t('deleteAccount.otpLabel', 'Six digit code')}
                />

                {!!devOtp && (
                  <Text style={S.devHint}>{t('deleteAccount.devOtp', 'Dev mode — code: {{otp}}', { otp: devOtp })}</Text>
                )}

                <TouchableOpacity
                  onPress={requestOtp}
                  disabled={busy || cooldown > 0}
                  activeOpacity={0.7}
                  style={S.resendWrap}
                >
                  <Text style={[S.resend, (busy || cooldown > 0) && S.resendOff]}>
                    {cooldown > 0
                      ? t('deleteAccount.resendIn', 'Resend code in {{sec}}s', { sec: cooldown })
                      : t('deleteAccount.resend', 'Resend code')}
                  </Text>
                </TouchableOpacity>

                {!!error && <Text style={S.error}>{error}</Text>}

                <View style={S.btnRow}>
                  <TouchableOpacity style={[S.btn, S.btnCancel]} onPress={dismiss} disabled={busy} activeOpacity={0.8}>
                    <Text style={S.btnCancelTxt}>{t('cancel', 'Cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[S.btn, S.btnDanger, (busy || otp.length !== 6) && S.btnDisabled]}
                    onPress={confirmDelete}
                    disabled={busy || otp.length !== 6}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                  >
                    {busy
                      ? <ActivityIndicator size="small" color={KHET.white} />
                      : <Text style={S.btnDangerTxt}>{t('deleteAccount.confirmBtn', 'Delete forever')}</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}

            {step === 'done' && (
              <View style={S.donePad}>
                <View style={[S.iconWrap, S.doneIcon]}>
                  <Ionicons name="checkmark-circle" size={30} color={KHET.white} />
                </View>
                <Text style={S.title}>{t('deleteAccount.doneTitle', 'Account deleted')}</Text>
                <Text style={S.msg}>
                  {t('deleteAccount.doneMsg', 'Your personal data has been erased. Thank you for using CropSetu.')}
                </Text>
                <ActivityIndicator size="small" color={KHET.mutedForeground} style={{ marginTop: 6 }} />
              </View>
            )}

          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 380, maxHeight: '88%',
    backgroundColor: KHET.card, borderRadius: 24,
    borderWidth: 1, borderColor: KHET.border,
    ...KSHADOW.elegant,
  },
  cardInner: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 20, alignItems: 'center' },

  iconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: KHET.destructive + '14',
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  doneIcon: { backgroundColor: KHET.destructive },

  title: { fontSize: 20, fontFamily: KFONT.displaySemi, color: KHET.foreground, marginBottom: 6, textAlign: 'center', letterSpacing: -0.3 },
  msg:   { fontSize: 14, color: KHET.mutedForeground, fontFamily: KFONT.sans, textAlign: 'center', lineHeight: 20, marginBottom: 18 },

  listBlock: { width: '100%', marginBottom: 14 },
  listHead: {
    fontSize: 11, fontFamily: KFONT.sansBold, color: KHET.mutedForeground,
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8,
  },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  listTxt: { flex: 1, fontSize: 13, fontFamily: KFONT.sans, color: KHET.foreground, lineHeight: 18 },

  note: {
    width: '100%', fontSize: 12, fontFamily: KFONT.sans, color: KHET.mutedForeground,
    lineHeight: 17, marginBottom: 16,
  },

  otpInput: {
    width: '100%', textAlign: 'center',
    fontSize: 28, letterSpacing: 10,
    fontFamily: KFONT.sansBold, color: KHET.foreground,
    borderWidth: 1, borderColor: KHET.border, borderRadius: 16,
    paddingVertical: 14, backgroundColor: KHET.muted,
    marginBottom: 10,
  },
  devHint: { fontSize: 12, fontFamily: KFONT.sans, color: KHET.mutedForeground, marginBottom: 6 },

  resendWrap: { paddingVertical: 6, marginBottom: 6 },
  resend:    { fontSize: 13, fontFamily: KFONT.sansSemi, color: KHET.primary ?? KHET.foreground },
  resendOff: { color: KHET.mutedForeground },

  error: {
    width: '100%', fontSize: 13, fontFamily: KFONT.sansSemi, color: KHET.destructive,
    textAlign: 'center', lineHeight: 18, marginBottom: 12,
  },

  btnRow: { flexDirection: 'row', gap: 12, width: '100%', marginTop: 4 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  btnCancel:    { backgroundColor: KHET.muted, borderWidth: 1, borderColor: KHET.border },
  btnCancelTxt: { fontSize: 15, fontFamily: KFONT.sansSemi, color: KHET.foreground },
  btnDanger:    { backgroundColor: KHET.destructive },
  btnDangerTxt: { fontSize: 15, fontFamily: KFONT.sansBold, color: KHET.white },
  btnDisabled:  { opacity: 0.55 },

  donePad: { alignItems: 'center', paddingVertical: 8 },
});

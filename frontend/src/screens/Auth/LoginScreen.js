import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { OTP_RESEND_COOLDOWN_SEC } from '../../constants/config';
import { s, vs, fs, ms } from '../../utils/responsive';

const STEPS = { PHONE: 'phone', OTP: 'otp' };
const APP_LOGO = require('../../../assets/icon.png');

export default function LoginScreen() {
  const { sendOtp, verifyOtp } = useAuth();
  const { t } = useLanguage();

  const [step,    setStep]    = useState(STEPS.PHONE);
  const [phone,   setPhone]   = useState('');
  const [otp,     setOtp]     = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [resendIn, setResendIn] = useState(0);

  const otpRef    = useRef(null);
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  // ── Step transition animation ─────────────────────────────────────────────
  useEffect(() => {
    fadeAnim.setValue(0);
    slideAnim.setValue(20);
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start();
    if (step === STEPS.OTP) {
      const t = setTimeout(() => otpRef.current?.focus(), 320);
      return () => clearTimeout(t);
    }
  }, [step]);

  // ── Resend countdown ──────────────────────────────────────────────────────
  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  // Clear inline error when the user edits an input.
  useEffect(() => { if (errorMsg) setErrorMsg(null); }, [phone, otp]);

  // ── Step 1: send OTP ──────────────────────────────────────────────────────
  async function handleSendOtp({ isResend = false } = {}) {
    if (!/^[6-9]\d{9}$/.test(phone)) {
      setErrorMsg(t('login.invalidPhoneMsg'));
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await sendOtp(phone);
      if (!isResend) setStep(STEPS.OTP);
      setResendIn(OTP_RESEND_COOLDOWN_SEC);
      // Demo mode: when MSG91 is not configured the server returns the OTP so
      // the demo user can sign in without an SMS. Auto-fill it for them.
      const devOtp = result?.data?.devOtp ?? result?.devOtp;
      if (devOtp) setOtp(devOtp);
    } catch (err) {
      setErrorMsg(err.userMessage || err.response?.data?.error?.message || t('login.otpError'));
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: verify OTP ────────────────────────────────────────────────────
  async function handleVerifyOtp() {
    if (otp.length !== 6) {
      setErrorMsg(t('login.invalidOtpMsg'));
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      await verifyOtp(phone, otp);
      // RootNavigator handles routing on success.
    } catch (err) {
      setErrorMsg(err.userMessage || err.response?.data?.error?.message || t('login.verifyError'));
    } finally {
      setLoading(false);
    }
  }

  function goBackToPhone() {
    setStep(STEPS.PHONE);
    setOtp('');
    setErrorMsg(null);
  }

  return (
    <SafeAreaView style={sty.safe}>
      <View style={sty.gradient}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={sty.inner}
        >
          {/* Logo area */}
          <View style={sty.logoArea}>
            <View style={sty.logoBadge}>
              <Image source={APP_LOGO} style={sty.logoImg} resizeMode="contain" />
            </View>
            <Text style={sty.appName}>{t('appName')}</Text>
            <Text style={sty.tagline}>{t('login.tagline')}</Text>
          </View>

          {/* Card */}
          <Animated.View
            style={[
              sty.card,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            {step === STEPS.PHONE ? (
              <>
                <Text style={sty.cardTitle}>{t('login.enterPhone')}</Text>
                <Text style={sty.cardSub}>{t('login.otpWillSend')}</Text>

                {errorMsg ? (
                  <View style={sty.errorBox} accessibilityLiveRegion="polite">
                    <Ionicons name="alert-circle" size={ms(16)} color={COLORS.error || '#B91C1C'} />
                    <Text style={sty.errorTxt}>{errorMsg}</Text>
                  </View>
                ) : null}

                <View style={sty.phoneRow}>
                  <View style={sty.countryCode}>
                    <Text style={sty.flag}>🇮🇳</Text>
                    <Text style={sty.countryTxt}>+91</Text>
                  </View>
                  <View style={sty.divider} />
                  <TextInput
                    style={sty.phoneInput}
                    placeholder={t('login.phonePlaceholder')}
                    placeholderTextColor={COLORS.textLight}
                    keyboardType="phone-pad"
                    maxLength={10}
                    value={phone}
                    onChangeText={(v) => setPhone(v.replace(/\D/g, ''))}
                    returnKeyType="done"
                    onSubmitEditing={handleSendOtp}
                    autoFocus
                  />
                </View>

                <PrimaryButton
                  label={t('login.sendOtp')}
                  loading={loading}
                  disabled={loading || phone.length !== 10}
                  onPress={handleSendOtp}
                  trailingIcon="arrow-forward"
                />
              </>
            ) : (
              <>
                <TouchableOpacity
                  onPress={goBackToPhone}
                  style={sty.backBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="chevron-back" size={ms(22)} color={COLORS.primary} />
                  <Text style={sty.backTxt}>+91 {phone}</Text>
                </TouchableOpacity>

                <Text style={sty.cardTitle}>{t('login.enterOtp')}</Text>
                <Text style={sty.cardSub}>{t('login.otpSentTo', { phone })}</Text>

                {errorMsg ? (
                  <View style={sty.errorBox} accessibilityLiveRegion="polite">
                    <Ionicons name="alert-circle" size={ms(16)} color={COLORS.error || '#B91C1C'} />
                    <Text style={sty.errorTxt}>{errorMsg}</Text>
                  </View>
                ) : null}

                <TextInput
                  ref={otpRef}
                  style={sty.otpInput}
                  placeholder="• • • • • •"
                  placeholderTextColor={COLORS.textLight}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={otp}
                  onChangeText={(v) => setOtp(v.replace(/\D/g, ''))}
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  importantForAutofill="yes"
                  selectionColor={COLORS.primary}
                  returnKeyType="done"
                  onSubmitEditing={handleVerifyOtp}
                />

                <PrimaryButton
                  label={t('login.verifyLogin')}
                  loading={loading}
                  disabled={loading || otp.length !== 6}
                  onPress={handleVerifyOtp}
                  trailingIcon="checkmark"
                />

                <TouchableOpacity
                  onPress={() => handleSendOtp({ isResend: true })}
                  style={sty.resendBtn}
                  disabled={loading || resendIn > 0}
                  accessibilityRole="button"
                >
                  <Text style={[sty.resendTxt, (resendIn > 0 || loading) && sty.resendTxtDisabled]}>
                    {resendIn > 0 ? `${t('login.resendOtp')} (${resendIn}s)` : t('login.resendOtp')}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </Animated.View>

          <Text style={sty.footer}>{t('login.termsNote')}</Text>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}

// ── Reusable primary button ───────────────────────────────────────────────────
function PrimaryButton({ label, onPress, loading, disabled, trailingIcon }) {
  return (
    <TouchableOpacity
      style={[sty.btn, disabled && sty.btnDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {loading ? (
        <ActivityIndicator color={COLORS.white} />
      ) : (
        <>
          <Text style={sty.btnTxt}>{label}</Text>
          {trailingIcon ? (
            <Ionicons name={trailingIcon} size={ms(18)} color={COLORS.white} style={sty.btnIcon} />
          ) : null}
        </>
      )}
    </TouchableOpacity>
  );
}

const sty = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: COLORS.primary },
  gradient: { flex: 1, backgroundColor: COLORS.primary },
  inner:    {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: s(24),
    paddingVertical:   vs(24),
  },

  // ── Logo area ──────────────────────────────────────────────────────────────
  logoArea: { alignItems: 'center', marginBottom: vs(32) },
  logoBadge: {
    width: ms(96),
    height: ms(96),
    borderRadius: ms(28),
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: vs(16),
    ...SHADOWS.large,
  },
  logoImg: {
    width: ms(80),
    height: ms(80),
    borderRadius: ms(20),
  },
  appName: {
    fontSize: fs(34),
    fontWeight: TYPE.weight.black,
    color: COLORS.textWhite,
    letterSpacing: -0.7,
  },
  tagline: {
    fontSize: fs(TYPE.size.sm),
    color: COLORS.greenWash,
    marginTop: vs(6),
    textAlign: 'center',
    lineHeight: fs(19),
    maxWidth: s(290),
  },

  // ── Card ───────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: s(28),
    padding: s(24),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.65)',
    ...SHADOWS.large,
  },
  cardTitle: {
    fontSize: fs(22),
    fontWeight: TYPE.weight.black,
    color: COLORS.textDark,
    marginBottom: vs(6),
    letterSpacing: -0.2,
  },
  cardSub: {
    fontSize: fs(TYPE.size.sm),
    color: COLORS.textMedium,
    marginBottom: vs(18),
    lineHeight: fs(20),
  },

  // ── Inline error banner ────────────────────────────────────────────────────
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: s(8),
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: s(12),
    paddingHorizontal: s(12),
    paddingVertical: vs(10),
    marginBottom: vs(14),
  },
  errorTxt: {
    flex: 1,
    color: '#991B1B',
    fontSize: fs(13),
    lineHeight: fs(18),
  },

  // ── Phone input ────────────────────────────────────────────────────────────
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: s(16),
    backgroundColor: COLORS.inputBg,
    marginBottom: vs(16),
    paddingLeft: s(12),
  },
  countryCode: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: vs(12),
    gap: s(6),
  },
  flag: { fontSize: fs(18) },
  countryTxt: {
    fontSize: fs(TYPE.size.base),
    fontWeight: TYPE.weight.bold,
    color: COLORS.textDark,
  },
  divider: {
    width: 1,
    height: vs(24),
    backgroundColor: COLORS.border,
    marginHorizontal: s(10),
  },
  phoneInput: {
    flex: 1,
    paddingVertical: vs(14),
    paddingRight: s(14),
    fontSize: fs(TYPE.size.base),
    color: COLORS.textDark,
    letterSpacing: 0.5,
  },

  // ── OTP input ──────────────────────────────────────────────────────────────
  otpInput: {
    width: '100%',
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingHorizontal: s(14),
    paddingVertical: vs(16),
    fontSize: fs(26),
    fontWeight: '700',
    color: COLORS.nearBlack,
    backgroundColor: COLORS.white,
    marginBottom: vs(16),
    textAlign: 'center',
    letterSpacing: s(8),
  },

  // ── Buttons ────────────────────────────────────────────────────────────────
  btn: {
    flexDirection: 'row',
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingVertical: vs(16),
    minHeight: vs(52),
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.greenGlow,
  },
  btnDisabled: {
    opacity: 0.55,
    shadowOpacity: 0,
    elevation: 0,
  },
  btnTxt: {
    color: COLORS.white,
    fontSize: fs(TYPE.size.base),
    fontWeight: TYPE.weight.bold,
    letterSpacing: 0.1,
  },
  btnIcon: { marginLeft: s(8) },

  // ── Back / resend ──────────────────────────────────────────────────────────
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: vs(14),
    paddingVertical: vs(4),
    paddingRight: s(8),
    minHeight: 36,
  },
  backTxt: {
    color: COLORS.primary,
    fontSize: fs(TYPE.size.sm),
    fontWeight: TYPE.weight.semibold,
    marginLeft: s(2),
  },
  resendBtn: {
    alignItems: 'center',
    marginTop: vs(14),
    minHeight: 44,
    justifyContent: 'center',
  },
  resendTxt: {
    color: COLORS.primary,
    fontSize: fs(TYPE.size.sm),
    fontWeight: TYPE.weight.semibold,
  },
  resendTxtDisabled: {
    color: COLORS.textLight,
  },

  // ── Footer ─────────────────────────────────────────────────────────────────
  footer: {
    textAlign: 'center',
    color: COLORS.mintBorder,
    fontSize: fs(11),
    marginTop: vs(24),
    lineHeight: fs(16),
  },
});

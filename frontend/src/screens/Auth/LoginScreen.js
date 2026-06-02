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
  Modal,
  ScrollView,
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
  const [legal,    setLegal]    = useState(null);   // 'terms' | 'privacy' | null

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

          <View style={sty.footerWrap}>
            <Text style={sty.footer}>{t('login.agreePrefix')}</Text>
            <View style={sty.footerLinksRow}>
              <TouchableOpacity
                onPress={() => setLegal('terms')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="link"
                accessibilityLabel={t('login.termsOfUse')}
              >
                <Text style={sty.footerLink}>{t('login.termsOfUse')}</Text>
              </TouchableOpacity>
              <Text style={sty.footer}> {t('login.andConnector')} </Text>
              <TouchableOpacity
                onPress={() => setLegal('privacy')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="link"
                accessibilityLabel={t('login.privacyPolicy')}
              >
                <Text style={sty.footerLink}>{t('login.privacyPolicy')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>

      <LegalModal type={legal} onClose={() => setLegal(null)} t={t} />
    </SafeAreaView>
  );
}

// ── Legal content modal (Terms of Use / Privacy Policy) ─────────────────────────
// Placeholder copy — replace LEGAL_CONTENT with your reviewed legal text, or
// swap the modal for a WebView/Linking call once the pages are hosted online.
const LEGAL_CONTENT = {
  terms: {
    title: 'Terms of Use',
    body: `Last updated: June 2026

Welcome to CropSetu. By creating an account and using this app, you agree to these Terms of Use.

1. Use of the service
CropSetu provides farming tools, marketplace listings, and advisory features. You agree to use them lawfully and to provide accurate information.

2. Your account
You are responsible for activity under your account and for keeping your phone number and login secure.

3. Listings and transactions
Rentals, sales, and bookings made through CropSetu are agreements between users. CropSetu is not a party to those agreements and does not guarantee any listing, price, or outcome.

4. Advisory content
AI and informational content is provided for guidance only and is not a substitute for professional agronomic, financial, or legal advice.

5. Changes
We may update these terms from time to time. Continued use of the app means you accept the updated terms.

Contact us at support@cropsetu.app for any questions about these terms.`,
  },
  privacy: {
    title: 'Privacy Policy',
    body: `Last updated: June 2026

This Privacy Policy explains how CropSetu collects, uses, and protects your information.

1. Information we collect
We collect your phone number for login, profile details you provide, farm and crop data you enter, and approximate location when you enable it.

2. How we use it
We use your information to operate the app, show nearby listings, personalise advisory content, and improve the service.

3. Sharing
We do not sell your personal data. Limited information may be shared with other users only as needed to complete a listing, booking, or chat you initiate.

4. Security
We use industry-standard measures to protect your data. No method of transmission is fully secure, so we cannot guarantee absolute security.

5. Your choices
You may edit or delete your profile and farm data, and disable location sharing, at any time from the app settings.

Contact us at support@cropsetu.app for any privacy questions or data requests.`,
  },
};

function LegalModal({ type, onClose, t }) {
  const content = type ? LEGAL_CONTENT[type] : null;
  const title = type === 'terms' ? t('login.termsOfUse') : t('login.privacyPolicy');
  return (
    <Modal
      visible={!!type}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={sty.modalOverlay}>
        <View style={sty.modalCard}>
          <View style={sty.modalHeader}>
            <Text style={sty.modalTitle} numberOfLines={1}>{title}</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t('login.legalClose')}
            >
              <Ionicons name="close" size={ms(24)} color={COLORS.textDark} />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={sty.modalScroll}
            contentContainerStyle={{ paddingBottom: vs(16) }}
            showsVerticalScrollIndicator
          >
            <Text style={sty.modalBody}>{content?.body}</Text>
          </ScrollView>
          <TouchableOpacity style={sty.modalCloseBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={sty.modalCloseTxt}>{t('login.legalClose')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
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
  footerWrap: {
    alignItems: 'center',
    marginTop: vs(24),
  },
  footer: {
    textAlign: 'center',
    color: COLORS.mintBorder,
    fontSize: fs(11),
    lineHeight: fs(16),
  },
  footerLinksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: vs(2),
  },
  footerLink: {
    color: COLORS.white,
    fontSize: fs(11),
    lineHeight: fs(16),
    fontWeight: TYPE.weight.bold,
    textDecorationLine: 'underline',
  },

  // ── Legal modal ──────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: s(24),
    borderTopRightRadius: s(24),
    paddingHorizontal: s(20),
    paddingTop: vs(16),
    paddingBottom: vs(20),
    maxHeight: '82%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: vs(12),
  },
  modalTitle: {
    flex: 1,
    fontSize: fs(20),
    fontWeight: TYPE.weight.black,
    color: COLORS.textDark,
    letterSpacing: -0.2,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalBody: {
    fontSize: fs(13),
    lineHeight: fs(20),
    color: COLORS.textMedium,
  },
  modalCloseBtn: {
    marginTop: vs(14),
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingVertical: vs(14),
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: vs(48),
  },
  modalCloseTxt: {
    color: COLORS.white,
    fontSize: fs(TYPE.size.base),
    fontWeight: TYPE.weight.bold,
  },
});

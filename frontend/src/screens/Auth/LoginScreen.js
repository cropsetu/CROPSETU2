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
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { OTP_RESEND_COOLDOWN_SEC } from '../../constants/config';
import { isValidPhone, isValidOtp } from '../../utils/validators';
import { s, vs, fs, ms } from '../../utils/responsive';

const STEPS = { PHONE: 'phone', OTP: 'otp' };
const APP_LOGO = require('../../../assets/icon.png');

// Deep crop-green field — dominant 60% backdrop the light card floats on.
const FIELD_GRADIENT = [COLORS.primary, COLORS.primaryDark2, COLORS.greenDeep];

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
  const [focused,  setFocused]  = useState(null);    // 'phone' | 'otp' | null

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
    // Client-side rate-limit guard: never fire while a request is in flight or
    // during the resend cooldown. Enforcing it HERE (not just on the button's
    // disabled prop) covers every entry point — the Send button, the Resend
    // link, and the keyboard "done" (onSubmitEditing) — so the cooldown can't be
    // bypassed by navigating back to the phone step or pressing return. The
    // server limits remain authoritative (AUTH-1); this just curbs local spam.
    if (loading || resendIn > 0) return;

    if (!isValidPhone(phone)) {
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
      // If the server rate-limited the request, honour its Retry-After so the
      // local cooldown matches the authoritative server window.
      const retryAfter = Number(err?.response?.headers?.['retry-after']);
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        setResendIn(Math.min(Math.ceil(retryAfter), 300)); // cap to a sane max
      }
      setErrorMsg(err.userMessage || err.response?.data?.error?.message || t('login.otpError'));
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: verify OTP ────────────────────────────────────────────────────
  async function handleVerifyOtp() {
    if (!isValidOtp(otp)) {
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
    setFocused(null);
  }

  const isPhoneStep = step === STEPS.PHONE;

  return (
    <View style={sty.root}>
      <LinearGradient
        colors={FIELD_GRADIENT}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={sty.safe}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={sty.inner}
        >
          <ScrollView
            contentContainerStyle={sty.scrollBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* ── Brand: frosted logo badge → app name → tagline ── */}
            <View style={sty.logoArea}>
              <View style={sty.logoShadow}>
                <BlurView intensity={40} tint="light" style={sty.logoBadge}>
                  <Image source={APP_LOGO} style={sty.logoImg} resizeMode="contain" />
                </BlurView>
              </View>
              <Text style={sty.appName}>{t('appName')}</Text>
              <Text style={sty.tagline}>{t('login.tagline')}</Text>
            </View>

            {/* ── One elevated card per step ── */}
            <Animated.View
              style={[
                sty.card,
                { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
              ]}
            >
              {/* Two-step progress dots */}
              <View style={sty.steps} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={[sty.stepDot, sty.stepDotActive]} />
                <View style={[sty.stepBar, !isPhoneStep && sty.stepBarActive]} />
                <View style={[sty.stepDot, !isPhoneStep && sty.stepDotActive]} />
              </View>

              {isPhoneStep ? (
                <>
                  <View style={sty.headerIcon}>
                    <Ionicons name="call" size={ms(22)} color={COLORS.primary} />
                  </View>
                  <Text style={sty.cardTitle}>{t('login.enterPhone')}</Text>
                  <Text style={sty.cardSub}>{t('login.otpWillSend')}</Text>

                  {errorMsg ? (
                    <View style={sty.errorBox} accessibilityLiveRegion="polite">
                      <Ionicons name="alert-circle" size={ms(16)} color={COLORS.error} />
                      <Text style={sty.errorTxt}>{errorMsg}</Text>
                    </View>
                  ) : null}

                  <View style={[sty.phoneRow, focused === 'phone' && sty.fieldFocused]}>
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
                      onFocus={() => setFocused('phone')}
                      onBlur={() => setFocused(null)}
                      returnKeyType="done"
                      onSubmitEditing={handleSendOtp}
                      autoFocus
                    />
                  </View>

                  <PrimaryButton
                    label={resendIn > 0 ? `${t('login.sendOtp')} (${resendIn}s)` : t('login.sendOtp')}
                    loading={loading}
                    disabled={loading || phone.length !== 10 || resendIn > 0}
                    onPress={handleSendOtp}
                    trailingIcon="arrow-forward"
                  />

                  <View style={sty.trustRow}>
                    <Ionicons name="shield-checkmark" size={ms(14)} color={COLORS.primaryMedium} />
                    <Text style={sty.trustTxt}>{t('login.secureNote')}</Text>
                  </View>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    onPress={goBackToPhone}
                    style={sty.backBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t('login.changeNumber')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="chevron-back" size={ms(20)} color={COLORS.primary} />
                    <Text style={sty.backTxt}>+91 {phone}</Text>
                  </TouchableOpacity>

                  <View style={sty.headerIcon}>
                    <Ionicons name="chatbubble-ellipses" size={ms(22)} color={COLORS.primary} />
                  </View>
                  <Text style={sty.cardTitle}>{t('login.enterOtp')}</Text>
                  <Text style={sty.cardSub}>{t('login.otpSentTo', { phone })}</Text>

                  {errorMsg ? (
                    <View style={sty.errorBox} accessibilityLiveRegion="polite">
                      <Ionicons name="alert-circle" size={ms(16)} color={COLORS.error} />
                      <Text style={sty.errorTxt}>{errorMsg}</Text>
                    </View>
                  ) : null}

                  <TextInput
                    ref={otpRef}
                    style={[sty.otpInput, focused === 'otp' && sty.otpInputFocused]}
                    placeholder={t('login.otpPlaceholder')}
                    placeholderTextColor={COLORS.textLight}
                    keyboardType="number-pad"
                    maxLength={6}
                    value={otp}
                    onChangeText={(v) => setOtp(v.replace(/\D/g, ''))}
                    onFocus={() => setFocused('otp')}
                    onBlur={() => setFocused(null)}
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

                  <View style={sty.resendRow}>
                    <Text style={sty.resendPrompt}>{t('login.didntGetCode')}</Text>
                    <TouchableOpacity
                      onPress={() => handleSendOtp({ isResend: true })}
                      style={sty.resendBtn}
                      disabled={loading || resendIn > 0}
                      accessibilityRole="button"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[sty.resendTxt, (resendIn > 0 || loading) && sty.resendTxtDisabled]}>
                        {resendIn > 0 ? `${t('login.resendOtp')} (${resendIn}s)` : t('login.resendOtp')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </Animated.View>

            {/* ── Legal footer ── */}
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
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <LegalModal type={legal} onClose={() => setLegal(null)} t={t} />
    </View>
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
          <View style={sty.modalGrabber} />
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

// ── Reusable primary button — the single harvest-orange focal action ────────────
function PrimaryButton({ label, onPress, loading, disabled, trailingIcon }) {
  return (
    <TouchableOpacity
      style={[sty.btn, disabled && sty.btnDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
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
  root:  { flex: 1, backgroundColor: COLORS.primary },
  safe:  { flex: 1 },
  inner: { flex: 1 },
  scrollBody: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: s(24),
    paddingVertical:   vs(32),
  },

  // ── Brand / logo area ────────────────────────────────────────────────────────
  logoArea: { alignItems: 'center', marginBottom: vs(32) },
  logoShadow: {
    borderRadius: ms(28),
    marginBottom: vs(16),
    ...SHADOWS.large,
  },
  logoBadge: {
    width: ms(96),
    height: ms(96),
    borderRadius: ms(28),
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    backgroundColor: 'rgba(255,255,255,0.18)',
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

  // ── Card ─────────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: s(24),
    padding: s(24),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.65)',
    ...SHADOWS.large,
  },

  // ── Two-step progress indicator ──────────────────────────────────────────────
  steps: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: vs(18),
  },
  stepDot: {
    width: s(8),
    height: s(8),
    borderRadius: s(4),
    backgroundColor: COLORS.borderGreen,
  },
  stepDotActive: { backgroundColor: COLORS.primary },
  stepBar: {
    width: s(28),
    height: 2,
    marginHorizontal: s(6),
    borderRadius: 1,
    backgroundColor: COLORS.borderGreen,
  },
  stepBarActive: { backgroundColor: COLORS.primary },

  // ── Icon-led header ──────────────────────────────────────────────────────────
  headerIcon: {
    width: ms(44),
    height: ms(44),
    borderRadius: ms(22),
    backgroundColor: COLORS.primaryPale,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: vs(12),
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

  // ── Inline error banner ──────────────────────────────────────────────────────
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: s(8),
    backgroundColor: COLORS.errorLight,
    borderColor: COLORS.redPale200,
    borderWidth: 1,
    borderRadius: s(12),
    paddingHorizontal: s(12),
    paddingVertical: vs(10),
    marginBottom: vs(14),
  },
  errorTxt: {
    flex: 1,
    color: COLORS.errorDark,
    fontSize: fs(13),
    lineHeight: fs(18),
  },

  // ── Phone input ──────────────────────────────────────────────────────────────
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.borderGreen,
    borderRadius: s(16),
    backgroundColor: COLORS.primarySoft,
    marginBottom: vs(18),
    paddingLeft: s(12),
  },
  // Shared focus ring for both fields.
  fieldFocused: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.white,
    ...SHADOWS.greenGlow,
  },
  countryCode: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: vs(14),
    gap: s(6),
  },
  flag: { fontSize: fs(18) },
  countryTxt: {
    fontSize: fs(TYPE.size.md),
    fontWeight: TYPE.weight.bold,
    color: COLORS.textDark,
  },
  divider: {
    width: 1,
    height: vs(26),
    backgroundColor: COLORS.borderGreen,
    marginHorizontal: s(10),
  },
  phoneInput: {
    flex: 1,
    paddingVertical: vs(15),
    paddingRight: s(14),
    fontSize: fs(TYPE.size.md),
    fontWeight: TYPE.weight.semibold,
    color: COLORS.textDark,
    letterSpacing: 0.5,
  },

  // ── OTP input — large & legible for outdoor / low-literacy use ───────────────
  otpInput: {
    width: '100%',
    borderWidth: 1.5,
    borderColor: COLORS.borderGreen,
    borderRadius: RADIUS.lg,
    paddingHorizontal: s(14),
    paddingVertical: vs(18),
    fontSize: fs(28),
    fontWeight: TYPE.weight.bold,
    color: COLORS.nearBlack,
    backgroundColor: COLORS.primarySoft,
    marginBottom: vs(18),
    textAlign: 'center',
    letterSpacing: s(10),
  },
  otpInputFocused: {
    borderColor: COLORS.primary,
    borderWidth: 2,
    backgroundColor: COLORS.white,
    ...SHADOWS.greenGlow,
  },

  // ── Primary CTA (10% accent — harvest orange) ────────────────────────────────
  btn: {
    flexDirection: 'row',
    backgroundColor: COLORS.cta,
    borderRadius: RADIUS.full,
    paddingVertical: vs(16),
    minHeight: vs(54),
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.orangeGlow,
  },
  btnDisabled: {
    backgroundColor: COLORS.ctaLight,
    opacity: 0.6,
    shadowOpacity: 0,
    elevation: 0,
  },
  btnTxt: {
    color: COLORS.white,
    fontSize: fs(TYPE.size.md),
    fontWeight: TYPE.weight.bold,
    letterSpacing: 0.2,
  },
  btnIcon: { marginLeft: s(8) },

  // ── Trust microcopy (phone step) ─────────────────────────────────────────────
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(6),
    marginTop: vs(16),
  },
  trustTxt: {
    color: COLORS.textMedium,
    fontSize: fs(TYPE.size.xs),
    fontWeight: TYPE.weight.medium,
  },

  // ── Back / resend ────────────────────────────────────────────────────────────
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: vs(14),
    paddingVertical: vs(6),
    paddingHorizontal: s(10),
    marginLeft: -s(4),
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primaryPale,
    minHeight: 36,
  },
  backTxt: {
    color: COLORS.primary,
    fontSize: fs(TYPE.size.sm),
    fontWeight: TYPE.weight.bold,
    marginLeft: s(2),
  },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: vs(16),
  },
  resendPrompt: {
    color: COLORS.textMedium,
    fontSize: fs(TYPE.size.sm),
  },
  resendBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: s(6),
  },
  resendTxt: {
    color: COLORS.primary,
    fontSize: fs(TYPE.size.sm),
    fontWeight: TYPE.weight.bold,
  },
  resendTxtDisabled: {
    color: COLORS.textLight,
  },

  // ── Footer ───────────────────────────────────────────────────────────────────
  footerWrap: {
    alignItems: 'center',
    marginTop: vs(28),
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

  // ── Legal modal ────────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: s(24),
    borderTopRightRadius: s(24),
    paddingHorizontal: s(20),
    paddingTop: vs(12),
    paddingBottom: vs(20),
    maxHeight: '82%',
  },
  modalGrabber: {
    alignSelf: 'center',
    width: s(40),
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: vs(12),
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

// ─────────────────────────────────────────────────────────────────────────────
// LoginScreen · "KhetAI-style" phone + OTP auth (rebranded → CropSetu)
// ─────────────────────────────────────────────────────────────────────────────
// A faithful rebuild of the supplied mock: a soft field-green canvas with a
// decorative "neural leaf", an AI-verification pill, a 2-step progress bar,
// serif-italic display headings, bilingual (English + हिन्दी) microcopy, a white
// phone pill with a +91 country chip, six circular OTP cells, and a single green
// CTA. All of the real auth wiring (send/verify/resend, cooldown, dev-OTP
// autofill, friendly errors) is preserved from the previous screen.
//
// To rename the app, change APP_NAME below — it is the only brand string.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Phone,
  MessageSquare,
  ShieldCheck,
  Wifi,
  Check,
} from 'lucide-react-native';
import { useAuth } from '../../context/AuthContext';
import { OTP_RESEND_COOLDOWN_SEC } from '../../constants/config';
import { isValidPhone, isValidOtp } from '../../utils/validators';
import { s, vs, fs, ms } from '../../utils/responsive';
// Shared brand surface (palette, serif face, neural leaf, pill) — one source of
// truth for the login + account-profile screens. See components/ui/brandKit.js.
import { BRAND as C, SERIF, NeuralLeaf, BrandPill as Pill } from '../../components/ui/brandKit';

// ── Brand (change these two lines to rename / re-logo the app) ───────────────
const APP_NAME = 'CropSetu';
const LOGO = require('../../../assets/cropsetu-logo.png');

const STEPS = { PHONE: 'phone', OTP: 'otp' };

// ─────────────────────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const { sendOtp, verifyOtp } = useAuth();

  const [step, setStep] = useState(STEPS.PHONE);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [resendIn, setResendIn] = useState(0);
  const [legal, setLegal] = useState(null); // 'terms' | 'privacy' | null

  const otpRef = useRef(null);

  // Focus the OTP field shortly after the step transition settles.
  useEffect(() => {
    if (step !== STEPS.OTP) return undefined;
    const id = setTimeout(() => otpRef.current?.focus(), 320);
    return () => clearTimeout(id);
  }, [step]);

  // Resend cooldown ticker.
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const id = setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  // Forgiving: clear any inline error the moment the user edits a field.
  useEffect(() => { if (errorMsg) setErrorMsg(null); }, [phone, otp]); // eslint-disable-line react-hooks/exhaustive-deps

  // mm:ss for the resend countdown.
  const clock = useMemo(() => {
    const m = Math.floor(resendIn / 60);
    const sec = String(resendIn % 60).padStart(2, '0');
    return `${m}:${sec}`;
  }, [resendIn]);

  // ── Step 1 → send OTP ──────────────────────────────────────────────────────
  const handleSendOtp = useCallback(async ({ isResend = false } = {}) => {
    // Local rate-limit guard — also enforced server-side. Covers the Send button,
    // the Resend link, and the keyboard "done" path so the cooldown can't be
    // bypassed by navigating back to the phone step.
    if (loading || resendIn > 0) return;

    if (!isValidPhone(phone)) {
      setErrorMsg('Please enter a valid 10-digit mobile number.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await sendOtp(phone);
      if (!isResend) setStep(STEPS.OTP);
      setResendIn(OTP_RESEND_COOLDOWN_SEC);
      // Demo mode: when SMS is not configured the server echoes the OTP so the
      // demo user can sign in without a real text. Auto-fill it for them.
      const devOtp = result?.data?.devOtp ?? result?.devOtp;
      if (devOtp) setOtp(devOtp);
    } catch (err) {
      const retryAfter = Number(err?.response?.headers?.['retry-after']);
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        setResendIn(Math.min(Math.ceil(retryAfter), 300));
      }
      setErrorMsg(
        err.userMessage ||
        err.response?.data?.error?.message ||
        "We couldn't send the code. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [loading, resendIn, phone, sendOtp]);

  // ── Step 2 → verify OTP ────────────────────────────────────────────────────
  const handleVerifyOtp = useCallback(async () => {
    if (!isValidOtp(otp)) {
      setErrorMsg('That code looks incomplete. Enter all 6 digits.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      await verifyOtp(phone, otp);
      // RootNavigator routes onward on success.
    } catch (err) {
      setErrorMsg(
        err.userMessage ||
        err.response?.data?.error?.message ||
        'That code is incorrect. Please check and try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [otp, phone, verifyOtp]);

  const goBackToPhone = useCallback(() => {
    setStep(STEPS.PHONE);
    setOtp('');
    setErrorMsg(null);
  }, []);

  const isPhone = step === STEPS.PHONE;
  const grouped = phone.length > 5 ? `${phone.slice(0, 5)} ${phone.slice(5)}` : phone;

  return (
    <View style={sty.root}>
      <StatusBar style="dark" />

      {/* Soft field-green canvas */}
      <LinearGradient
        colors={[C.bgTop, C.bgMid, C.bgBot]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Decorative "neural leaf", behind everything */}
      <NeuralLeaf />

      <SafeAreaView style={sty.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={sty.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* ── Top bar: back · wordmark · (online) ── */}
          <View style={sty.topBar}>
            {isPhone ? (
              // No back affordance on the first step — it has nowhere to go.
              <View style={sty.topSide} />
            ) : (
              <Pressable
                onPress={goBackToPhone}
                style={({ pressed }) => [sty.backBtn, pressed && sty.pressed]}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <ArrowLeft size={ms(20)} color={C.green} strokeWidth={2.4} />
              </Pressable>
            )}

            <View style={sty.wordmark}>
              <Image source={LOGO} style={sty.wordmarkLogo} resizeMode="cover" />
              <Text style={sty.wordmarkTxt} maxFontSizeMultiplier={1.3}>{APP_NAME}</Text>
            </View>

            <View style={sty.topRight}>
              {isPhone ? null : (
                <View style={sty.onlinePill}>
                  <Wifi size={ms(13)} color={C.green} strokeWidth={2.4} />
                  <Text style={sty.onlineTxt}>Online</Text>
                </View>
              )}
            </View>
          </View>

          <ScrollView
            contentContainerStyle={sty.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* Phone step keeps its pill above the progress bar; OTP step does not. */}
            {isPhone ? (
              <Pill icon={Sparkles} label="Secure AI verification" style={sty.topPill} />
            ) : null}

            {/* ── 2-step progress ── */}
            <ProgressBar step={isPhone ? 1 : 2} total={2} />

            {/* ── Icon badge (+ AI pill on the OTP step) ── */}
            <View style={sty.badgeRow}>
              <View style={sty.iconBadge}>
                {isPhone
                  ? <Phone size={ms(26)} color={C.white} strokeWidth={2.2} fill={C.white} />
                  : <MessageSquare size={ms(26)} color={C.white} strokeWidth={2.2} />}
              </View>
              {isPhone ? null : <Pill icon={Sparkles} label="AI auto-read" style={sty.badgePill} />}
            </View>

            {/* ── Display heading (serif italic, two lines) ── */}
            {isPhone ? (
              <Text style={sty.heading} maxFontSizeMultiplier={1.3}>
                <Text style={sty.headingDark}>What's your{'\n'}</Text>
                <Text style={sty.headingGreen}>mobile number?</Text>
              </Text>
            ) : (
              <Text style={sty.heading} maxFontSizeMultiplier={1.3}>
                <Text style={sty.headingDark}>Enter the{'\n'}</Text>
                <Text style={sty.headingGreen}>6-digit code</Text>
              </Text>
            )}

            {/* ── Sub copy ── */}
            {isPhone ? (
              <>
                <Text style={sty.subtitle} maxFontSizeMultiplier={1.4}>
                  We'll send a 6-digit OTP on your number to verify it's really you.
                </Text>
                <Text style={[sty.subtitle, sty.subtitleHi]} maxFontSizeMultiplier={1.4}>
                  आपका मोबाइल नंबर क्या है?
                </Text>
              </>
            ) : (
              <View style={sty.sentRow}>
                <Text style={sty.sentTxt} maxFontSizeMultiplier={1.4}>
                  Sent to <Text style={sty.sentPhone}>+91 {grouped}</Text>
                </Text>
                <Pressable onPress={goBackToPhone} hitSlop={8} accessibilityRole="button">
                  <Text style={sty.changeTxt}>Change</Text>
                </Pressable>
              </View>
            )}

            {/* ── Inline error (paired icon + plain copy) ── */}
            {errorMsg ? (
              <View style={sty.errorBox} accessibilityLiveRegion="assertive">
                <Text style={sty.errorTxt}>{errorMsg}</Text>
              </View>
            ) : null}

            {/* ── Form body ── */}
            {isPhone ? (
              <View style={sty.body}>
                <Text style={sty.fieldLabel}>MOBILE NUMBER</Text>

                <View style={sty.phonePill}>
                  <View style={sty.chip}>
                    <Text style={sty.flag} allowFontScaling={false}>🇮🇳</Text>
                    <Text style={sty.chipTxt}>+91</Text>
                  </View>
                  <TextInput
                    style={sty.phoneInput}
                    placeholder="98765 43210"
                    placeholderTextColor={C.textHint}
                    keyboardType="phone-pad"
                    maxLength={11}
                    value={grouped}
                    onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
                    returnKeyType="done"
                    onSubmitEditing={handleSendOtp}
                    autoFocus
                    accessibilityLabel="Mobile number, country code plus 91"
                  />
                </View>

                {/* Trust pill */}
                <View style={sty.trustPill}>
                  <ShieldCheck size={ms(16)} color={C.green} strokeWidth={2.3} />
                  <Text style={sty.trustTxt}>Your number stays private. Never shared or sold.</Text>
                </View>

                <CTAButton
                  label="Send OTP / OTP भेजें"
                  loading={loading}
                  disabled={phone.length !== 10 || resendIn > 0}
                  suffix={resendIn > 0 ? ` (${resendIn}s)` : ''}
                  onPress={() => handleSendOtp()}
                  Icon={ArrowRight}
                />
              </View>
            ) : (
              <View style={sty.body}>
                <OtpCells
                  ref={otpRef}
                  value={otp}
                  onChange={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
                  onComplete={handleVerifyOtp}
                />

                {/* Resend — countdown then an active link */}
                <View style={sty.resendRow}>
                  {resendIn > 0 ? (
                    <Text style={sty.resendTxt} accessibilityLiveRegion="polite">
                      Resend OTP in <Text style={sty.resendClock}>{clock}</Text>
                    </Text>
                  ) : (
                    <Pressable
                      onPress={() => handleSendOtp({ isResend: true })}
                      disabled={loading}
                      hitSlop={10}
                      accessibilityRole="button"
                    >
                      <Text style={[sty.resendLink, loading && sty.resendDisabled]}>Resend OTP</Text>
                    </Pressable>
                  )}
                </View>

                <CTAButton
                  label="Verify OTP"
                  loading={loading}
                  disabled={otp.length !== 6}
                  onPress={handleVerifyOtp}
                  Icon={Check}
                />

                <Text style={sty.helper}>
                  Didn't get the code? Check your SMS inbox or try again in a moment.
                </Text>
              </View>
            )}

            {/* ── Legal footer ── */}
            <View style={sty.footer}>
              <Text style={sty.footerTxt}>
                By continuing, you agree to our{' '}
                <Text style={sty.footerLink} onPress={() => setLegal('terms')}>Terms of Use</Text>
                {' '}and{' '}
                <Text style={sty.footerLink} onPress={() => setLegal('privacy')}>Privacy Policy</Text>
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <LegalModal type={legal} onClose={() => setLegal(null)} />
    </View>
  );
}

// NeuralLeaf + Pill now come from the shared brandKit (imported above).

// ── 2-step progress bar with "Step X of N" label ─────────────────────────────
function ProgressBar({ step, total }) {
  return (
    <View style={sty.progressRow}>
      <View style={sty.progressTrack}>
        {Array.from({ length: total }).map((_, i) => (
          <View key={i} style={[sty.progressSeg, i < step && sty.progressSegOn]} />
        ))}
      </View>
      <Text style={sty.progressLabel}>Step {step} of {total}</Text>
    </View>
  );
}

// ── Single green CTA (gradient when enabled, muted when disabled) ─────────────
function CTAButton({ label, suffix = '', loading, disabled, onPress, Icon }) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [sty.cta, pressed && !off && sty.ctaPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
    >
      <LinearGradient
        colors={off ? [C.greenMutedA, C.greenMutedB] : [C.greenBright, C.greenInk]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={sty.ctaFill}
      >
        {loading ? (
          <ActivityIndicator color={C.white} />
        ) : (
          <>
            <Text style={sty.ctaTxt} maxFontSizeMultiplier={1.3}>{label}{suffix}</Text>
            {Icon ? (
              <View style={sty.ctaIcon}>
                <Icon size={ms(18)} color={C.white} strokeWidth={2.6} />
              </View>
            ) : null}
          </>
        )}
      </LinearGradient>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Six circular OTP cells backed by ONE hidden input — gives paste, SMS-autofill,
// auto-advance and backspace for free. The circles are pure presentation.
// ─────────────────────────────────────────────────────────────────────────────
const OtpCells = React.forwardRef(function OtpCells({ value, onChange, onComplete }, ref) {
  const cells = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  const activeIndex = Math.min(value.length, 5);

  const handleChange = (text) => {
    const digits = text.replace(/\D/g, '').slice(0, 6);
    onChange?.(digits);
    if (digits.length === 6) onComplete?.();
  };

  return (
    <View style={sty.otpRow}>
      {cells.map((digit, i) => {
        const active = i === activeIndex && value.length < 6;
        return (
          <View
            key={i}
            style={[sty.otpCell, digit !== '' && sty.otpCellFilled, active && sty.otpCellActive]}
          >
            <Text style={sty.otpDigit}>{digit}</Text>
          </View>
        );
      })}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={handleChange}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={6}
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        importantForAutofill="yes"
        caretHidden
        selectionColor="transparent"
        style={sty.otpHiddenInput}
        accessibilityLabel="One-time password, 6 digits"
      />
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Legal content (Terms / Privacy) — replace bodies with your reviewed copy.
// ─────────────────────────────────────────────────────────────────────────────
const LEGAL = {
  terms: {
    title: 'Terms of Use',
    body: `Last updated: June 2026

Welcome to ${APP_NAME}. By creating an account and using this app, you agree to these Terms of Use.

1. Use of the service
${APP_NAME} provides farming tools, marketplace listings, and advisory features. You agree to use them lawfully and to provide accurate information.

2. Your account
You are responsible for activity under your account and for keeping your phone number and login secure.

3. Listings and transactions
Rentals, sales, and bookings made through ${APP_NAME} are agreements between users. ${APP_NAME} is not a party to those agreements.

4. Advisory content
AI and informational content is provided for guidance only and is not a substitute for professional advice.

Contact support@cropsetu.app for any questions about these terms.`,
  },
  privacy: {
    title: 'Privacy Policy',
    body: `Last updated: June 2026

This Privacy Policy explains how ${APP_NAME} collects, uses, and protects your information.

1. Information we collect
Your phone number for login, profile details you provide, farm and crop data you enter, and approximate location when enabled.

2. How we use it
To operate the app, show nearby listings, personalise advisory content, and improve the service.

3. Sharing
We do not sell your personal data. Limited information may be shared with other users only as needed to complete a listing, booking, or chat you initiate.

4. Your choices
You may edit or delete your profile and farm data, and disable location sharing, at any time from settings.

Contact support@cropsetu.app for any privacy questions or data requests.`,
  },
};

function LegalModal({ type, onClose }) {
  const content = type ? LEGAL[type] : null;
  return (
    <Modal visible={!!type} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sty.modalOverlay}>
        <View style={sty.modalCard}>
          <View style={sty.modalGrabber} />
          <Text style={sty.modalTitle}>{content?.title}</Text>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: vs(12) }}>
            <Text style={sty.modalBody}>{content?.body}</Text>
          </ScrollView>
          <Pressable style={sty.modalClose} onPress={onClose} accessibilityRole="button">
            <Text style={sty.modalCloseTxt}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const sty = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bgTop },
  flex: { flex: 1 },
  safe: { flex: 1 },

  // ── Top bar ──
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(20),
    paddingTop: vs(6),
    minHeight: vs(52),
  },
  backBtn: {
    width: ms(42),
    height: ms(42),
    borderRadius: ms(21),
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.shadowGreen,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  pressed: { opacity: 0.7 },
  topSide: { width: ms(42) },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: s(8) },
  wordmarkLogo: { width: ms(26), height: ms(26), borderRadius: ms(7) },
  wordmarkTxt: {
    fontSize: fs(19),
    fontWeight: '800',
    color: C.greenDeep,
    letterSpacing: -0.2,
  },
  topRight: { minWidth: ms(42), alignItems: 'flex-end' },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    backgroundColor: C.white,
    paddingHorizontal: s(11),
    paddingVertical: vs(6),
    borderRadius: 999,
    shadowColor: C.shadowGreen,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  onlineTxt: { fontSize: fs(12), fontWeight: '700', color: C.green },

  // ── Scroll body ──
  scroll: {
    flexGrow: 1,
    paddingHorizontal: s(24),
    paddingTop: vs(10),
    paddingBottom: vs(28),
  },

  // ── Pills ──
  // Margin overrides passed to the shared <Pill> (BrandPill) in the hero.
  topPill: { marginTop: vs(8), marginBottom: vs(16) },
  badgePill: { marginLeft: s(12) },

  // ── Progress ──
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: s(12) },
  progressTrack: { flex: 1, flexDirection: 'row', gap: s(8) },
  progressSeg: {
    flex: 1,
    height: vs(6),
    borderRadius: 999,
    backgroundColor: C.progressOff,
  },
  progressSegOn: { backgroundColor: C.greenDeep },
  progressLabel: { fontSize: fs(13), fontWeight: '600', color: C.greenDeep },

  // ── Icon badge row ──
  badgeRow: { flexDirection: 'row', alignItems: 'center', marginTop: vs(26) },
  iconBadge: {
    width: ms(60),
    height: ms(60),
    borderRadius: ms(20),
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.greenDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 5,
  },

  // ── Heading ──
  heading: { marginTop: vs(18) },
  headingDark: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontWeight: '700',
    fontSize: fs(38),
    lineHeight: fs(44),
    color: C.headingDark,
  },
  headingGreen: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontWeight: '700',
    fontSize: fs(38),
    lineHeight: fs(44),
    color: C.headingGreen,
  },

  // ── Sub copy ──
  subtitle: {
    fontSize: fs(15.5),
    lineHeight: fs(23),
    color: C.textBody,
    marginTop: vs(14),
  },
  subtitleHi: { marginTop: vs(4) },

  sentRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: s(8), marginTop: vs(12) },
  sentTxt: { fontSize: fs(15.5), color: C.textBody },
  sentPhone: { fontWeight: '800', color: C.headingDark },
  changeTxt: { fontSize: fs(15.5), fontWeight: '700', color: C.green },

  // ── Error ──
  errorBox: {
    backgroundColor: C.errorBg,
    borderColor: C.errorBorder,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(14),
    paddingVertical: vs(10),
    marginTop: vs(16),
  },
  errorTxt: { color: C.errorInk, fontSize: fs(13.5), lineHeight: fs(19) },

  // ── Form body ──
  body: { marginTop: vs(22) },
  fieldLabel: {
    fontSize: fs(12.5),
    fontWeight: '700',
    letterSpacing: 1,
    color: C.label,
    marginBottom: vs(10),
  },

  // Phone pill
  phonePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.white,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.inputBorder,
    paddingLeft: s(8),
    paddingRight: s(8),
    minHeight: vs(64),
    shadowColor: C.shadowGreen,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    backgroundColor: C.chipBg,
    borderRadius: 16,
    paddingHorizontal: s(12),
    paddingVertical: vs(10),
  },
  flag: { fontSize: fs(18) },
  chipTxt: { fontSize: fs(16), fontWeight: '800', color: C.headingDark },
  phoneInput: {
    flex: 1,
    paddingHorizontal: s(14),
    paddingVertical: vs(14),
    fontSize: fs(20),
    fontWeight: '600',
    letterSpacing: 1,
    color: C.headingDark,
  },

  // Trust pill
  trustPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    backgroundColor: C.pill,
    borderRadius: 16,
    paddingHorizontal: s(14),
    paddingVertical: vs(12),
    marginTop: vs(16),
  },
  trustTxt: { flex: 1, fontSize: fs(13.5), fontWeight: '600', color: C.greenDeep },

  // ── CTA ──
  cta: {
    marginTop: vs(22),
    borderRadius: 22,
    overflow: 'hidden',
    shadowColor: C.greenInk,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 5,
  },
  ctaPressed: { opacity: 0.9 },
  ctaFill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: vs(60),
    paddingHorizontal: s(20),
  },
  ctaTxt: { color: C.white, fontSize: fs(18), fontWeight: '700', letterSpacing: 0.2 },
  ctaIcon: {
    position: 'absolute',
    right: s(16),
    width: ms(34),
    height: ms(34),
    borderRadius: ms(17),
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── OTP ──
  otpRow: { flexDirection: 'row', gap: s(10), position: 'relative' },
  otpCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: C.white,
    borderWidth: 1.5,
    borderColor: C.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.shadowGreen,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  otpCellFilled: { borderColor: C.green },
  otpCellActive: { borderColor: C.green, borderWidth: 2 },
  otpDigit: { fontSize: fs(24), fontWeight: '800', color: C.headingDark },
  otpHiddenInput: {
    ...StyleSheet.absoluteFillObject,
    color: 'transparent',
    fontSize: 1,
    textAlign: 'center',
  },

  // ── Resend / helper ──
  resendRow: { alignItems: 'center', justifyContent: 'center', marginTop: vs(26), minHeight: vs(28) },
  resendTxt: { fontSize: fs(15), color: C.textBody },
  resendClock: { fontWeight: '800', color: C.headingDark },
  resendLink: { fontSize: fs(15), fontWeight: '700', color: C.green },
  resendDisabled: { color: C.textHint },
  helper: {
    fontSize: fs(13.5),
    lineHeight: fs(19),
    color: C.textBody,
    textAlign: 'center',
    marginTop: vs(18),
    paddingHorizontal: s(16),
  },

  // ── Footer ──
  footer: { marginTop: vs(24), alignItems: 'center', paddingHorizontal: s(8) },
  footerTxt: { fontSize: fs(12), lineHeight: fs(18), color: C.textBody, textAlign: 'center' },
  footerLink: { fontWeight: '700', color: C.green, textDecorationLine: 'underline' },

  // ── Legal modal ──
  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: C.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: s(20),
    paddingTop: vs(12),
    paddingBottom: vs(20),
    maxHeight: '82%',
  },
  modalGrabber: { alignSelf: 'center', width: s(40), height: 4, borderRadius: 2, backgroundColor: C.borderMed, marginBottom: vs(14) },
  modalTitle: { fontSize: fs(20), fontWeight: '800', color: C.headingDark, marginBottom: vs(12) },
  modalBody: { fontSize: fs(13.5), lineHeight: fs(20), color: C.textBody },
  modalClose: {
    marginTop: vs(14),
    backgroundColor: C.green,
    borderRadius: 999,
    minHeight: vs(50),
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseTxt: { color: C.white, fontSize: fs(15), fontWeight: '700' },
});

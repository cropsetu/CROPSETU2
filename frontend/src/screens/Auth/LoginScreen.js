// ─────────────────────────────────────────────────────────────────────────────
// Auth flow — CropSetu design (ported from the Lovable "dharti-connect-hub" project).
// Three steps: WELCOME (pre-login) → PHONE (mobile entry) → OTP (6-digit verify).
// Real OTP backend logic (sendOtp / verifyOtp) is preserved. The phone field is
// uncontrolled (ref-based) to dodge the New-Architecture Android caret-reset bug;
// the OTP uses 6 single-char boxes (each holds ≤1 char, so no caret issue).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Image,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { isValidPhone, isValidOtp, normalizePhone } from '../../utils/validators';
import { KHET, KFONT, KSHADOW } from '../../constants/khetTheme';

const HERO = require('../../../assets/khet/welcome-hero.jpg');

const STEPS = { WELCOME: 'welcome', PHONE: 'phone', OTP: 'otp' };
const LANGS = ['हिन्दी', 'English', 'मराठी', 'தமிழ்', 'తెలుగు', 'ಕನ್ನಡ', 'বাংলা'];
const OTP_LEN = 6;
const RESEND_SECONDS = 30;

export default function LoginScreen() {
  const { sendOtp, verifyOtp } = useAuth();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState(STEPS.WELCOME);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [resendIn, setResendIn] = useState(0);

  // Phone — uncontrolled (ref holds the live value; boolean drives the button).
  const phoneValueRef = useRef('');
  const [phoneReady, setPhoneReady] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [phoneDisplay, setPhoneDisplay] = useState(''); // STABLE snapshot for the field + OTP labels

  // OTP — six single-char boxes.
  const [otpDigits, setOtpDigits] = useState(Array(OTP_LEN).fill(''));
  const [autoFilled, setAutoFilled] = useState(false);
  const otpRefs = useRef([]);

  const code = otpDigits.join('');
  const otpComplete = code.length === OTP_LEN && otpDigits.every((d) => d !== '');

  // ── Resend countdown ───────────────────────────────────────────────────────
  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  // NOTE: We deliberately do NOT auto-verify on completion. In dev the server
  // returns the OTP and we auto-fill it; auto-verifying as well would skip the
  // OTP screen entirely (it would flash by). The user taps "Verify OTP".

  // ── Step 1: send OTP ───────────────────────────────────────────────────────
  async function handleSendOtp({ isResend = false } = {}) {
    if (loading || resendIn > 0) return;
    const phone = phoneValueRef.current;
    if (!isValidPhone(phone)) {
      setErrorMsg('Enter a valid 10-digit mobile number.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await sendOtp(phone);
      setPhoneDisplay(phone);
      if (!isResend) setStep(STEPS.OTP);
      setResendIn(RESEND_SECONDS);
      setOtpDigits(Array(OTP_LEN).fill(''));
      setAutoFilled(false);
      // Demo mode: server returns the OTP when SMS is not configured — auto-fill.
      const devOtp = result?.data?.devOtp ?? result?.devOtp;
      if (devOtp && /^\d{6}$/.test(String(devOtp))) {
        setOtpDigits(String(devOtp).split(''));
        setAutoFilled(true);
      }
    } catch (err) {
      const retryAfter = Number(err?.response?.headers?.['retry-after']);
      if (Number.isFinite(retryAfter) && retryAfter > 0) setResendIn(Math.min(Math.ceil(retryAfter), 300));
      setErrorMsg(err.userMessage || err.response?.data?.error?.message || 'Could not send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: verify OTP ─────────────────────────────────────────────────────
  async function handleVerify() {
    const c = otpDigits.join('');
    if (!isValidOtp(c) || loading) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      await verifyOtp(phoneDisplay || phoneValueRef.current, c);
      // RootNavigator routes on success.
    } catch (err) {
      setErrorMsg(err.userMessage || err.response?.data?.error?.message || 'Invalid or expired code.');
      setOtpDigits(Array(OTP_LEN).fill(''));
      setAutoFilled(false);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  function handlePhoneChange(v) {
    // Normalise first: strips spaces/punctuation and a pasted +91 country code or
    // leading-0 trunk prefix, then cap at the 10-digit national number. Pasting
    // "+91 98765 43210" or "098765 43210" now yields the correct number.
    const digits = normalizePhone(v).slice(0, 10);
    phoneValueRef.current = digits;
    const ready = digits.length === 10;
    setPhoneReady((r) => (r === ready ? r : ready));
    if (errorMsg) setErrorMsg(null);
  }

  function handleOtpChange(i, v) {
    if (errorMsg) setErrorMsg(null);
    const digits = v.replace(/\D/g, '');

    // Paste or SMS auto-fill drops the whole code into one box — spread the digits
    // across the boxes from the current index instead of keeping only the last one.
    if (digits.length > 1) {
      setOtpDigits((prev) => {
        const next = [...prev];
        for (let k = 0; k < digits.length && i + k < OTP_LEN; k++) next[i + k] = digits[k];
        return next;
      });
      const filledTo = Math.min(i + digits.length, OTP_LEN);
      otpRefs.current[filledTo >= OTP_LEN ? OTP_LEN - 1 : filledTo]?.focus();
      return;
    }

    // Single character (typing) or empty string (backspace clears the box).
    const ch = digits.slice(-1);
    setOtpDigits((prev) => {
      const next = [...prev];
      next[i] = ch;
      return next;
    });
    if (ch && i < OTP_LEN - 1) otpRefs.current[i + 1]?.focus();
  }

  function handleOtpKey(i, e) {
    if (e.nativeEvent.key === 'Backspace' && !otpDigits[i] && i > 0) {
      otpRefs.current[i - 1]?.focus();
    }
  }

  function backToPhone() {
    setStep(STEPS.PHONE);
    setOtpDigits(Array(OTP_LEN).fill(''));
    setAutoFilled(false);
    setErrorMsg(null);
  }

  if (step === STEPS.WELCOME) {
    return <WelcomeView insets={insets} onStart={() => setStep(STEPS.PHONE)} />;
  }

  if (step === STEPS.PHONE) {
    return (
      <PhoneView
        insets={insets}
        loading={loading}
        errorMsg={errorMsg}
        phoneReady={phoneReady}
        phoneFocused={phoneFocused}
        phoneDisplay={phoneDisplay}
        resendIn={resendIn}
        onBack={() => setStep(STEPS.WELCOME)}
        onChange={handlePhoneChange}
        onFocus={() => setPhoneFocused(true)}
        onBlur={() => setPhoneFocused(false)}
        onSubmit={() => handleSendOtp()}
      />
    );
  }

  return (
    <OtpView
      insets={insets}
      loading={loading}
      errorMsg={errorMsg}
      otpDigits={otpDigits}
      otpRefs={otpRefs}
      autoFilled={autoFilled}
      phoneDisplay={phoneDisplay}
      resendIn={resendIn}
      complete={otpComplete}
      onBack={backToPhone}
      onChange={handleOtpChange}
      onKey={handleOtpKey}
      onVerify={handleVerify}
      onResend={() => handleSendOtp({ isResend: true })}
    />
  );
}

// ── Reusable bits ────────────────────────────────────────────────────────────
function GradientButton({ label, sublabel, onPress, disabled, loading, style }) {
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} disabled={disabled} style={[{ borderRadius: 18 }, style]}>
      <LinearGradient
        colors={KHET.gradPrimary}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[sty.gradBtn, disabled && sty.gradBtnDisabled]}
      >
        <Text style={sty.gradBtnTxt}>
          {label}
          {sublabel ? <Text style={sty.gradBtnSub}>{`  ${sublabel}`}</Text> : null}
        </Text>
        <View style={sty.gradBtnArrow}>
          {loading ? (
            <ActivityIndicator color={KHET.primaryForeground} size="small" />
          ) : (
            <Ionicons name="arrow-forward" size={16} color={KHET.primaryForeground} />
          )}
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

function Blobs() {
  return (
    <>
      <View style={[sty.blob, { backgroundColor: KHET.primaryGlow, top: -96, left: -96 }]} />
      <View style={[sty.blob, { backgroundColor: KHET.primary, top: 160, right: -80, opacity: 0.1 }]} />
    </>
  );
}

// ── Welcome (pre-login) ──────────────────────────────────────────────────────
function WelcomeView({ insets, onStart }) {
  const { height } = useWindowDimensions();
  // Web uses document-scroll globally (see App.js), so this full-bleed landing
  // screen must clamp to the viewport — otherwise the page scrolls. Native: flex:1.
  const lockViewport = Platform.OS === 'web' ? { height, overflow: 'hidden' } : null;
  return (
    <View style={[sty.root, lockViewport]}>
      <StatusBar style="light" />
      <Image source={HERO} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <LinearGradient
        colors={KHET.gradHero}
        locations={KHET.gradHeroLocs}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Top bar */}
      <View style={[sty.topbar, { paddingTop: insets.top + 8 }]}>
        <View style={sty.glassPill}>
          <Ionicons name="leaf" size={15} color={KHET.primaryGlow} />
          <Text style={sty.glassPillTxt}>CropSetu</Text>
        </View>
        <View style={sty.glassPill}>
          <Ionicons name="language" size={13} color="#fff" />
          <Text style={sty.glassPillTxt}>हिन्दी / EN</Text>
        </View>
      </View>

      {/* Bottom content panel — fixed (no scroll); content sits at the bottom over the hero. */}
      <View style={[sty.welcomeBody, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={sty.heroTitle}>
          Your farm,{'\n'}
          <Text style={sty.heroTitleItalic}>smarter every season.</Text>
        </Text>

        <Text style={sty.heroDesc}>
          Diagnose crop disease from a photo, talk to your personal AI agronomist, and track mandi prices — all in your language.
        </Text>

        <View style={sty.langRow}>
          {LANGS.map((l) => (
            <View key={l} style={sty.langChip}>
              <Text style={sty.langChipTxt}>{l}</Text>
            </View>
          ))}
          <View style={sty.langChip}>
            <Text style={[sty.langChipTxt, { opacity: 0.8 }]}>+3 more</Text>
          </View>
        </View>

        <View style={{ marginTop: 28 }}>
          <GradientButton label="Get started" sublabel="/ शुरू करें" onPress={onStart} />
        </View>

        <View style={sty.termsRow}>
          <Ionicons name="shield-checkmark" size={12} color="rgba(255,255,255,0.6)" />
          <Text style={sty.termsTxt}>By continuing you agree to our Terms & Privacy</Text>
        </View>
      </View>
    </View>
  );
}

// ── Phone (mobile entry) ─────────────────────────────────────────────────────
function PhoneView({ insets, loading, errorMsg, phoneReady, phoneFocused, phoneDisplay, onBack, onChange, onFocus, onBlur, onSubmit }) {
  const scrollRef = useRef(null);
  const scrollDown = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
  return (
    <LinearGradient colors={KHET.gradSurface} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 1 }} style={sty.root}>
      <StatusBar style="dark" />
      <Blobs />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[sty.surfaceBody, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={sty.surfaceHeader}>
            <TouchableOpacity onPress={onBack} style={sty.backCircle} activeOpacity={0.8}>
              <Ionicons name="arrow-back" size={16} color={KHET.foreground} />
            </TouchableOpacity>
            <View style={sty.brandRow}>
              <Ionicons name="leaf" size={15} color={KHET.primary} />
              <Text style={sty.brandTxt}>CropSetu</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          <View style={{ marginTop: 24 }}>
            <View style={sty.accentPill}>
              <Ionicons name="sparkles" size={11} color={KHET.primary} />
              <Text style={sty.accentPillTxt}>Secure AI verification</Text>
            </View>

            <View style={sty.progressRow}>
              <LinearGradient colors={KHET.gradPrimary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={sty.progFill} />
              <View style={sty.progEmpty} />
              <Text style={sty.progTxt}>Step 1 of 2</Text>
            </View>

            <LinearGradient colors={KHET.gradPrimary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={sty.iconSquare}>
              <Ionicons name="call" size={24} color={KHET.primaryForeground} />
            </LinearGradient>

            <Text style={sty.title}>
              What's your{'\n'}
              <Text style={sty.titleItalic}>mobile number?</Text>
            </Text>
            <Text style={sty.subtle}>We'll send a 6-digit OTP on your number to verify it's really you.</Text>
            <Text style={[sty.subtle, { marginTop: 4 }]}>आपका मोबाइल नंबर क्या है?</Text>

            <Text style={sty.fieldLabel}>MOBILE NUMBER</Text>
            <View style={[sty.inputCard, phoneFocused && sty.inputCardFocused]}>
              <View style={sty.ccChip}>
                <Text style={{ fontSize: 16 }}>🇮🇳</Text>
                <Text style={sty.ccTxt}>+91</Text>
              </View>
              <TextInput
                style={sty.phoneInput}
                placeholder="98765 43210"
                placeholderTextColor="rgba(87,104,90,0.5)"
                keyboardType="number-pad"
                maxLength={15}
                defaultValue={phoneDisplay}
                onChangeText={onChange}
                onFocus={() => { onFocus(); scrollDown(); }}
                onBlur={onBlur}
                returnKeyType="done"
                onSubmitEditing={onSubmit}
                autoFocus
              />
            </View>

            {errorMsg ? (
              <View style={sty.errorBox}>
                <Ionicons name="alert-circle" size={15} color={KHET.destructive} />
                <Text style={sty.errorTxt}>{errorMsg}</Text>
              </View>
            ) : (
              <View style={sty.privacyBox}>
                <Ionicons name="shield-checkmark" size={15} color={KHET.primary} />
                <Text style={sty.privacyTxt}>Your number stays private. Never shared or sold.</Text>
              </View>
            )}

            <GradientButton
              label="Send OTP / OTP भेजें"
              onPress={onSubmit}
              loading={loading}
              disabled={loading || !phoneReady}
              style={{ marginTop: 28, opacity: !phoneReady && !loading ? 0.65 : 1 }}
            />
          </View>

          <Text style={sty.footerTerms}>
            By continuing you agree to our <Text style={sty.footerStrong}>Terms</Text> & <Text style={sty.footerStrong}>Privacy Policy</Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

// ── OTP (verify) ─────────────────────────────────────────────────────────────
function OtpView({ insets, loading, errorMsg, otpDigits, otpRefs, autoFilled, phoneDisplay, resendIn, complete, onBack, onChange, onKey, onVerify, onResend }) {
  const scrollRef = useRef(null);
  const scrollDown = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
  // Size the six boxes explicitly from the viewport. (flex:1 + aspectRatio:1 makes
  // react-native-web blow one box up to fill the whole screen.) 48 = body padding,
  // 50 = five 10px gaps; capped at 58 so the boxes don't grow huge on web/tablet.
  const { width } = useWindowDimensions();
  const otpBoxSize = Math.min(58, Math.floor((width - 48 - 50) / 6));
  // Once all six digits are in (auto-fill or manual), no more typing is needed —
  // hide the keyboard so the Verify button is revealed.
  useEffect(() => { if (complete) Keyboard.dismiss(); }, [complete]);
  const masked = phoneDisplay ? `+91 ${phoneDisplay.slice(0, 5)} ${phoneDisplay.slice(5)}` : '+91 ••••• •••••';
  const mm = Math.floor(resendIn / 60).toString();
  const ss = (resendIn % 60).toString().padStart(2, '0');

  return (
    <LinearGradient colors={KHET.gradSurface} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 1 }} style={sty.root}>
      <StatusBar style="dark" />
      <Blobs />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[sty.surfaceBody, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={sty.surfaceHeader}>
            <TouchableOpacity onPress={onBack} style={sty.backCircle} activeOpacity={0.8}>
              <Ionicons name="arrow-back" size={16} color={KHET.foreground} />
            </TouchableOpacity>
            <View style={sty.brandRow}>
              <Ionicons name="leaf" size={15} color={KHET.primary} />
              <Text style={sty.brandTxt}>CropSetu</Text>
            </View>
            <View style={sty.onlinePill}>
              <Ionicons name="wifi" size={12} color={KHET.primary} />
              <Text style={sty.onlinePillTxt}>Online</Text>
            </View>
          </View>

          <View style={{ marginTop: 24 }}>
            <View style={sty.progressRow}>
              <LinearGradient colors={KHET.gradPrimary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={sty.progFill} />
              <LinearGradient colors={KHET.gradPrimary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={sty.progFill} />
              <Text style={sty.progTxt}>Step 2 of 2</Text>
            </View>

            <Text style={sty.title}>
              Enter the{'\n'}
              <Text style={sty.titleItalic}>6-digit code</Text>
            </Text>
            <Text style={sty.subtle}>
              Sent to <Text style={sty.subtleStrong}>{masked}</Text>
              <Text onPress={onBack} style={sty.changeLink}>  Change</Text>
            </Text>

            {/* OTP boxes */}
            <View style={sty.otpRow}>
              {otpDigits.map((d, i) => (
                <TextInput
                  key={i}
                  ref={(el) => { otpRefs.current[i] = el; }}
                  style={[sty.otpBox, { width: otpBoxSize, height: otpBoxSize }, d ? sty.otpBoxFilled : null]}
                  keyboardType="number-pad"
                  maxLength={1}
                  value={d}
                  onChangeText={(v) => onChange(i, v)}
                  onKeyPress={(e) => onKey(i, e)}
                  onFocus={scrollDown}
                  autoFocus={i === 0 && !otpDigits[0]}
                  editable={!loading}
                  selectionColor={KHET.primary}
                  textContentType="oneTimeCode"
                  autoComplete={i === 0 ? 'sms-otp' : 'off'}
                />
              ))}
            </View>

            {autoFilled && (
              <LinearGradient colors={KHET.gradPrimary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={sty.autofillBanner}>
                <Ionicons name="sparkles" size={13} color={KHET.primaryForeground} />
                <Text style={sty.autofillTxt}>Auto-filled from SMS</Text>
              </LinearGradient>
            )}

            {/* Status */}
            <View style={{ marginTop: 18, minHeight: 20 }}>
              {errorMsg ? (
                <View style={sty.errorBox}>
                  <Ionicons name="alert-circle" size={15} color={KHET.destructive} />
                  <Text style={sty.errorTxt}>{errorMsg}</Text>
                </View>
              ) : loading ? (
                <View style={sty.verifyingBox}>
                  <ActivityIndicator size="small" color={KHET.primary} />
                  <Text style={sty.verifyingTxt}>Verifying code…</Text>
                </View>
              ) : null}
            </View>

            {/* Resend */}
            <View style={{ marginTop: 8, alignItems: 'center' }}>
              {resendIn > 0 ? (
                <Text style={sty.subtle}>
                  Resend OTP in <Text style={sty.subtleStrong}>{mm}:{ss}</Text>
                </Text>
              ) : (
                <TouchableOpacity onPress={onResend} disabled={loading}>
                  <Text style={sty.resendLink}>Resend OTP / दोबारा भेजें</Text>
                </TouchableOpacity>
              )}
            </View>

            <GradientButton
              label={loading ? 'Verifying…' : 'Verify OTP'}
              onPress={onVerify}
              loading={loading}
              disabled={!complete || loading}
              style={{ marginTop: 28, opacity: !complete && !loading ? 0.65 : 1 }}
            />
          </View>

          <Text style={sty.footerTerms}>Didn't get the code? Check your SMS inbox or try again in a moment.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const sty = StyleSheet.create({
  root: { flex: 1, backgroundColor: KHET.background },

  // ── Welcome ──
  topbar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  glassPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  glassPillTxt: { color: '#fff', fontSize: 13, fontFamily: KFONT.sansSemi },
  welcomeBody: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 24 },
  heroTitle: { color: '#fff', fontSize: 44, lineHeight: 46, fontFamily: KFONT.display, letterSpacing: -0.5 },
  heroTitleItalic: { color: KHET.primaryGlow, fontFamily: KFONT.displayItalic, fontStyle: 'italic' },
  heroDesc: { color: 'rgba(255,255,255,0.82)', fontSize: 15, lineHeight: 23, marginTop: 16, fontFamily: KFONT.sans },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 22 },
  langChip: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  langChipTxt: { color: 'rgba(255,255,255,0.88)', fontSize: 11, fontFamily: KFONT.sansMed },
  glassBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
    borderRadius: 18,
    paddingVertical: 14,
  },
  glassBtnTxt: { color: '#fff', fontSize: 14, fontFamily: KFONT.sansMed },
  termsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 24 },
  termsTxt: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontFamily: KFONT.sans },

  // ── Gradient button ──
  gradBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 16,
    ...KSHADOW.elegant,
  },
  gradBtnDisabled: { shadowOpacity: 0, elevation: 0 },
  gradBtnTxt: { color: KHET.primaryForeground, fontSize: 16, fontFamily: KFONT.sansSemi },
  gradBtnSub: { color: 'rgba(244,251,237,0.8)', fontSize: 13, fontFamily: KFONT.sans },
  gradBtnArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Surface (phone / otp) ──
  surfaceBody: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 8 },
  blob: { position: 'absolute', width: 288, height: 288, borderRadius: 144, opacity: 0.18 },
  surfaceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderColor: KHET.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...KSHADOW.soft,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brandTxt: { color: KHET.foreground, fontSize: 14, fontFamily: KFONT.sansSemi },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(0,95,33,0.2)',
  },
  onlinePillTxt: { color: KHET.primary, fontSize: 11, fontFamily: KFONT.sansMed },

  accentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: KHET.accent,
    borderWidth: 1,
    borderColor: 'rgba(0,95,33,0.2)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  accentPillTxt: { color: KHET.accentForeground, fontSize: 11, fontFamily: KFONT.sansSemi, letterSpacing: 0.3 },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 28 },
  progFill: { flex: 1, height: 4, borderRadius: 2 },
  progEmpty: { flex: 1, height: 4, borderRadius: 2, backgroundColor: KHET.border },
  progTxt: { color: KHET.mutedForeground, fontSize: 11, fontFamily: KFONT.sansMed },

  iconSquare: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', ...KSHADOW.elegant },
  otpHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 26 },

  title: { color: KHET.foreground, fontSize: 36, lineHeight: 40, fontFamily: KFONT.display, letterSpacing: -0.5, marginTop: 26 },
  titleItalic: { color: KHET.primary, fontFamily: KFONT.displayItalic, fontStyle: 'italic' },
  subtle: { color: KHET.mutedForeground, fontSize: 14, lineHeight: 21, marginTop: 12, fontFamily: KFONT.sans },
  subtleStrong: { color: KHET.foreground, fontFamily: KFONT.sansSemi },
  changeLink: { color: KHET.primary, fontFamily: KFONT.sansSemi },

  fieldLabel: { color: KHET.mutedForeground, fontSize: 11, fontFamily: KFONT.sansBold, letterSpacing: 1, marginTop: 28, marginBottom: 8 },
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: KHET.card,
    borderRadius: 16,
    padding: 8,
    borderWidth: 1,
    borderColor: KHET.border,
    ...KSHADOW.soft,
  },
  inputCardFocused: { borderColor: KHET.primary, borderWidth: 2 },
  ccChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: KHET.secondary, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  ccTxt: { color: KHET.secondaryForeground, fontSize: 14, fontFamily: KFONT.sansSemi },
  phoneInput: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 12,
    fontSize: 18,
    color: KHET.foreground,
    fontFamily: KFONT.sansSemi,
    letterSpacing: 1,
    // The input card border shows focus; kill the web default outline.
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },

  privacyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(201,242,192,0.6)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,95,33,0.1)',
  },
  privacyTxt: { flex: 1, color: KHET.accentForeground, fontSize: 12, lineHeight: 17, fontFamily: KFONT.sans },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(223,34,37,0.08)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(223,34,37,0.25)',
  },
  errorTxt: { flex: 1, color: KHET.destructive, fontSize: 13, lineHeight: 18, fontFamily: KFONT.sansMed },

  footerTerms: { textAlign: 'center', color: KHET.mutedForeground, fontSize: 11, marginTop: 40, fontFamily: KFONT.sans, lineHeight: 16 },
  footerStrong: { color: KHET.foreground, fontFamily: KFONT.sansSemi },

  // ── OTP boxes ──
  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 36 },
  otpBox: {
    borderRadius: 16,
    backgroundColor: KHET.card,
    textAlign: 'center',
    fontSize: 28,
    color: KHET.foreground,
    fontFamily: KFONT.displaySemi,
    borderWidth: 1,
    borderColor: KHET.border,
    ...KSHADOW.soft,
    // The box border shows fill/focus; kill the web default outline.
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  otpBoxFilled: { borderColor: KHET.primary, borderWidth: 2 },
  autofillBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 16,
    ...KSHADOW.soft,
  },
  autofillTxt: { color: KHET.primaryForeground, fontSize: 12, fontFamily: KFONT.sansMed },
  verifyingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: KHET.card,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: KHET.border,
  },
  verifyingTxt: { color: KHET.mutedForeground, fontSize: 14, fontFamily: KFONT.sans },
  resendLink: { color: KHET.primary, fontSize: 14, fontFamily: KFONT.sansBold },
});

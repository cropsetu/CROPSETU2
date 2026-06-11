// ─────────────────────────────────────────────────────────────────────────────
// Screen 2 · OTP verification
// ─────────────────────────────────────────────────────────────────────────────
// Drives the idle → verifying → success / error machine around the injected
// async stubs `onVerifyOtp(otp)` and `onResendOtp()`. Verification auto-fires
// the moment 6 digits land (one less tap for the farmer) and is also available
// via the button. Errors clear-and-refocus after the shake; success plays a
// brief celebration before handing back to the flow via `onVerified`.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import { KeyRound, CircleCheckBig, Pencil } from 'lucide-react-native';
import AuthScreenLayout from './components/AuthScreenLayout';
import OtpInput from './components/OtpInput';
import PrimaryButton from './components/PrimaryButton';
import AuthTopControls from './components/AuthTopControls';
import { useAuthTheme } from './theme';
import { useT } from './strings';
import { Haptics } from '../../../utils/haptics';
import { SFX } from '../../../utils/authSound';
import { isValidOtp } from '../../../utils/validators';
import { s, vs } from '../../../utils/responsive';

const OTP_LENGTH = 6;
const SHAKE_MS = 480;          // matches the reanimated error shake in OtpInput
const SUCCESS_HOLD_MS = 1000;  // let the success animation breathe before leaving

/** Reveal only the last 4 digits, grouped — enough to recognise, safe to show. */
function maskPhone(raw) {
  const masked = raw
    .split('')
    .map((d, i) => (i >= raw.length - 4 ? d : '•'))
    .join('');
  const grouped = masked.length > 5 ? `${masked.slice(0, 5)} ${masked.slice(5)}` : masked;
  return `+91 ${grouped}`;
}

function toFriendlyError(err, t) {
  const code = err?.code || err?.name;
  if (code === 'WRONG_OTP' || err?.status === 401) return t('auth.errWrongOtp');
  if (code === 'NETWORK' || err?.message === 'Network Error') return t('auth.errNetwork');
  return t('auth.errSendFailed');
}

/**
 * @param {object} props
 * @param {string} props.phone                          Raw digits being verified.
 * @param {(otp:string)=>Promise<void>} props.onVerifyOtp   Stub; rejects on bad code.
 * @param {() => Promise<void>} props.onResendOtp           Stub.
 * @param {() => void} props.onEditNumber                Back to screen 1.
 * @param {() => void} [props.onVerified]                Called after success.
 * @param {number} [props.resendCooldown=30]            Seconds before resend unlocks.
 */
export default function OtpVerificationScreen({
  phone,
  onVerifyOtp,
  onResendOtp,
  onEditNumber,
  onVerified,
  resendCooldown = 30,
}) {
  const theme = useAuthTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const reduceMotion = useReducedMotion();

  const [otp, setOtp] = useState('');
  const [status, setStatus] = useState('idle');   // idle | verifying | success | error
  const [error, setError] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(resendCooldown);
  const [resending, setResending] = useState(false);

  const otpRef = useRef(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // ── Resend countdown ──────────────────────────────────────────────────────
  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const id = setInterval(() => setSecondsLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  const clock = useMemo(() => {
    const m = Math.floor(secondsLeft / 60);
    const sec = String(secondsLeft % 60).padStart(2, '0');
    return `${m}:${sec}`;
  }, [secondsLeft]);

  // ── Resend attention shimmer — a few gentle opacity/scale pulses on the link
  // the moment the countdown unlocks, to draw the eye. Reduce-motion: none.
  const attention = useSharedValue(0);
  const attentionStyle = useAnimatedStyle(() => ({
    opacity: 1 - attention.value * 0.4,
    transform: [{ scale: 1 + attention.value * 0.03 }],
  }));
  const prevSeconds = useRef(secondsLeft);
  useEffect(() => {
    if (prevSeconds.current > 0 && secondsLeft === 0 && !reduceMotion) {
      cancelAnimation(attention);
      attention.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 480 }),
          withTiming(0, { duration: 480 }),
        ),
        3,            // ~3 pulses, then settle
        false,
      );
    }
    prevSeconds.current = secondsLeft;
    return undefined;
  }, [secondsLeft, reduceMotion, attention]);

  // ── Verify ────────────────────────────────────────────────────────────────
  const verify = useCallback(
    async (code) => {
      if (status === 'verifying' || status === 'success') return;
      if (!isValidOtp(code)) {
        setError(t('auth.errInvalidOtp'));
        return;
      }
      setStatus('verifying');
      setError(null);
      try {
        await onVerifyOtp?.(code);
        if (!mounted.current) return;
        setStatus('success');
        setTimeout(() => { if (mounted.current) onVerified?.(); }, SUCCESS_HOLD_MS);
      } catch (err) {
        if (!mounted.current) return;
        setStatus('error');
        setError(toFriendlyError(err, t));
        // Clear + refocus after the shake so retyping is immediate.
        setTimeout(() => {
          if (!mounted.current) return;
          setOtp('');
          setStatus('idle');
          otpRef.current?.focus();
        }, SHAKE_MS);
      }
    },
    [status, onVerifyOtp, onVerified, t],
  );

  const handleChange = useCallback(
    (digits) => {
      if (error && status !== 'error') setError(null);   // forgiving edit
      setOtp(digits);
    },
    [error, status],
  );

  // ── Resend ────────────────────────────────────────────────────────────────
  const resend = useCallback(async () => {
    if (secondsLeft > 0 || resending) return;
    Haptics.selection();
    SFX.play('tap');           // faint tick on tap (self-gates on mute / reduce-motion)
    setResending(true);
    setError(null);
    setOtp('');
    try {
      await onResendOtp?.();
    } catch (err) {
      if (mounted.current) setError(toFriendlyError(err, t));
    } finally {
      if (mounted.current) {
        setResending(false);
        setSecondsLeft(resendCooldown);
        otpRef.current?.focus();
      }
    }
  }, [secondsLeft, resending, onResendOtp, resendCooldown, t]);

  const locked = status === 'verifying' || status === 'success';

  return (
    <AuthScreenLayout
      step={2}
      onBack={onEditNumber}
      topRightSlot={<AuthTopControls />}
      HeaderIcon={KeyRound}
      title={t('auth.otpTitle')}
      subtitle={t('auth.otpSentTo', { phone: maskPhone(phone) })}
      subtitleAccessory={
        <Pressable
          onPress={onEditNumber}
          style={styles.editRow}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('auth.editNumber')}
          disabled={locked}
        >
          <Pencil size={s(13)} color={theme.primary} strokeWidth={2.25} />
          <Text style={styles.editText}>{t('auth.editNumber')}</Text>
        </Pressable>
      }
    >
      <OtpInput
        ref={otpRef}
        value={otp}
        onChangeText={handleChange}
        onComplete={verify}
        length={OTP_LENGTH}
        status={status}
        error={error}
        autoFocus
      />

      <View style={styles.ctaWrap}>
        <PrimaryButton
          label={status === 'success' ? t('auth.verified') : t('auth.verify')}
          loadingLabel={t('auth.verifying')}
          loading={status === 'verifying'}
          disabled={otp.length !== OTP_LENGTH || locked}
          onPress={() => verify(otp)}
          Icon={status === 'success' ? CircleCheckBig : undefined}
          testID="verify-otp"
        />
      </View>

      {/* Resend — live countdown, then an active link */}
      <View style={styles.resendRow}>
        {secondsLeft > 0 ? (
          <Text style={styles.resendCountdown} accessibilityLiveRegion="polite">
            {t('auth.resendIn', { time: clock })}
          </Text>
        ) : (
          <Pressable
            onPress={resend}
            disabled={resending || locked}
            style={styles.resendBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('auth.resend')}
            accessibilityState={{ disabled: resending || locked }}
          >
            <Animated.View style={attentionStyle}>
              <Text style={[styles.resendLink, (resending || locked) && styles.resendDisabled]}>
                {resending ? t('auth.resending') : t('auth.resend')}
              </Text>
            </Animated.View>
          </Pressable>
        )}
      </View>
    </AuthScreenLayout>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    editRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(t.space.xs),
      alignSelf: 'flex-start',
      marginTop: vs(t.space.md),
      paddingVertical: vs(t.space.xs),
      minHeight: 36,
    },
    editText: { ...t.text.label, color: t.primary },
    ctaWrap: { marginTop: vs(t.space.xl) },
    resendRow: {
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: vs(t.space.lg),
      minHeight: t.tap,
    },
    resendCountdown: { ...t.text.helper, color: t.textTertiary },
    resendBtn: { minHeight: t.tap, justifyContent: 'center', paddingHorizontal: s(t.space.sm) },
    resendLink: { ...t.text.bodyStrong, color: t.primary },
    resendDisabled: { color: t.textTertiary },
  });
}

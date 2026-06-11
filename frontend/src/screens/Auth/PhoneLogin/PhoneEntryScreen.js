// ─────────────────────────────────────────────────────────────────────────────
// Screen 1 · Phone entry
// ─────────────────────────────────────────────────────────────────────────────
// Owns the phone value's transient UI: format validation, the loading state on
// the CTA, and friendly inline errors. The actual send is delegated to the
// injected async `onSendOtp(phone)` — this screen never knows how OTPs are sent.
//   • resolves → parent advances to OTP
//   • rejects  → mapped to plain-language copy near the field (never a raw code)
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  useReducedMotion,
} from 'react-native-reanimated';
import { Smartphone, ShieldCheck, ArrowRight } from 'lucide-react-native';
import AuthScreenLayout from './components/AuthScreenLayout';
import PhoneInput from './components/PhoneInput';
import PrimaryButton from './components/PrimaryButton';
import AuthTopControls from './components/AuthTopControls';
import LegalFooter from './components/LegalFooter';
import Shimmer from './components/Shimmer';
import { useAuthTheme } from './theme';
import { useT } from './strings';
import { Haptics } from '../../../utils/haptics';
import { SFX } from '../../../utils/authSound';
import { SPRINGS } from '../../../components/ui/motion';
import { isValidPhone } from '../../../utils/validators';
import { s, vs } from '../../../utils/responsive';

/** Map any thrown handler error to friendly, localised copy. */
function toFriendlyError(err, t) {
  const code = err?.code || err?.name;
  if (code === 'NETWORK' || err?.message === 'Network Error') return t('auth.errNetwork');
  if (code === 'RATE_LIMIT' || err?.status === 429) return t('auth.errTooMany');
  return t('auth.errSendFailed');
}

/**
 * @param {object} props
 * @param {string} props.phone                     Raw digits, owned by the flow.
 * @param {(d:string)=>void} props.onChangePhone
 * @param {(phone:string)=>Promise<void>} props.onSendOtp   Stub; may reject.
 * @param {() => void} [props.onGuest]
 * @param {() => void} [props.onToggleLanguage]
 * @param {string} [props.languageCode='EN']
 * @param {() => void} [props.onTerms]
 * @param {() => void} [props.onPrivacy]
 */
export default function PhoneEntryScreen({
  phone,
  onChangePhone,
  onSendOtp,
  onGuest,
  onToggleLanguage,
  languageCode = 'EN',
  onTerms,
  onPrivacy,
}) {
  const theme = useAuthTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const reduceMotion = useReducedMotion();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const valid = isValidPhone(phone);

  // One-time "ready" pulse on the CTA the moment the number becomes valid, with a
  // gentle selection tick + quiet confirm sound. Fires once per validity flip.
  const pulse = useSharedValue(1);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const prevValid = useRef(valid);
  useEffect(() => {
    if (valid && !prevValid.current) {
      Haptics.selection();
      SFX.play('tap');
      if (!reduceMotion) {
        pulse.value = withSequence(
          withSpring(1.02, SPRINGS.snappy),
          withSpring(1, SPRINGS.snappy),
        );
      }
    }
    prevValid.current = valid;
  }, [valid, reduceMotion, pulse]);

  const handleChange = useCallback(
    (digits) => {
      if (error) setError(null);      // forgiving: clear the error as they edit
      onChangePhone?.(digits);
    },
    [error, onChangePhone],
  );

  const submit = useCallback(async () => {
    if (loading) return;
    if (!valid) {
      setError(t('auth.errInvalidPhone'));   // covers the keyboard "done" path
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onSendOtp?.(phone);
      // Success → quiet "whoosh" as the flow transitions to the OTP screen; this
      // component then unmounts, so don't setState here.
      SFX.play('whoosh');
    } catch (err) {
      if (mounted.current) {
        setError(toFriendlyError(err, t));
        setLoading(false);
      }
    }
  }, [loading, valid, phone, onSendOtp, t]);

  return (
    <AuthScreenLayout
      step={1}
      topRightSlot={<AuthTopControls onToggleLanguage={onToggleLanguage} languageCode={languageCode} />}
      HeaderIcon={Smartphone}
      title={t('auth.phoneTitle')}
      subtitle={t('auth.phoneSubtitle')}
      footer={<LegalFooter onTerms={onTerms} onPrivacy={onPrivacy} onGuest={onGuest} />}
    >
      {/* Relative wrap so the loading sheen can sit over the form body. */}
      <View style={styles.bodyWrap}>
        <PhoneInput
          value={phone}
          onChangeText={handleChange}
          onSubmitEditing={submit}
          error={error}
          editable={!loading}
          autoFocus
        />

        <Animated.View style={[styles.ctaWrap, pulseStyle]}>
          <PrimaryButton
            label={t('auth.getOtp')}
            loadingLabel={t('auth.sending')}
            loading={loading}
            disabled={!valid}
            onPress={submit}
            Icon={ArrowRight}
            testID="get-otp"
          />
        </Animated.View>

        {/* Trust line — icon + text, reinforces safety of sharing a number */}
        <View style={styles.trustRow}>
          <ShieldCheck size={s(15)} color={theme.primaryDim} strokeWidth={2.25} />
          <Text style={styles.trustText}>{t('auth.trustLine')}</Text>
        </View>

        {/* Faint "working" sheen while the code is being sent (reduce-motion: off). */}
        <Shimmer active={loading} />
      </View>
    </AuthScreenLayout>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    bodyWrap: { position: 'relative' },
    ctaWrap: { marginTop: vs(t.space.xl) },
    trustRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(t.space.xs),
      marginTop: vs(t.space.base),
      paddingHorizontal: s(t.space.sm),
    },
    trustText: { ...t.text.caption, color: t.textTertiary, flexShrink: 1, textAlign: 'center' },
  });
}

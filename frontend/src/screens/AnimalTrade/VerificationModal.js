/**
 * VerificationModal — Aadhaar verification bottom-sheet (UI-only mock).
 * Accepts OTP `123456` — persists isVerified flag in AsyncStorage.
 * Ported from Animal-Trade-Hub reference UI.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Dimensions, KeyboardAvoidingView, Modal, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLanguage } from '../../context/LanguageContext';
import { COLORS } from '../../constants/colors';

const { height } = Dimensions.get('window');

const VERIFIED_KEY = '@farmeasy:aadhaar_verified';

export function useIsVerified() {
  const [isVerified, setIsVerified] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(VERIFIED_KEY).then(v => setIsVerified(v === '1'));
  }, []);
  return [isVerified, setIsVerified];
}

export default function VerificationModal({ visible, onClose, onVerified }) {
  const { t } = useLanguage();
  const [step, setStep]       = useState('phone');
  const [phone, setPhone]     = useState('');
  const [otp, setOtp]         = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const slideAnim     = useRef(new Animated.Value(height)).current;
  const successScale  = useRef(new Animated.Value(0)).current;
  const checkScale    = useRef(new Animated.Value(0)).current;
  const otpRefs       = useRef([]);

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 8 }).start();
    } else {
      Animated.timing(slideAnim, { toValue: height, duration: 250, useNativeDriver: true }).start(() => {
        setStep('phone');
        setOtp(['', '', '', '', '', '']);
        setError('');
        setPhone('');
      });
    }
  }, [visible, slideAnim]);

  const handleSendOtp = useCallback(() => {
    if (phone.length < 10) {
      setError('Enter valid 10-digit number');
      return;
    }
    setError('');
    setStep('otp');
    setTimeout(() => otpRefs.current[0]?.focus(), 300);
  }, [phone]);

  const handleOtpChange = useCallback((text, index) => {
    const newOtp = [...otp];
    newOtp[index] = text.slice(-1);
    setOtp(newOtp);
    if (text && index < 5) otpRefs.current[index + 1]?.focus();
  }, [otp]);

  const handleVerify = useCallback(async () => {
    const s = otp.join('');
    if (s.length < 6) { setError('Enter 6-digit OTP'); return; }
    setLoading(true); setError('');
    await new Promise(r => setTimeout(r, 700)); // mock server roundtrip
    setLoading(false);
    if (s === '123456') {
      await AsyncStorage.setItem(VERIFIED_KEY, '1');
      setStep('success');
      Animated.sequence([
        Animated.spring(successScale, { toValue: 1, useNativeDriver: true }),
        Animated.delay(300),
        Animated.spring(checkScale,   { toValue: 1, useNativeDriver: true }),
      ]).start();
      setTimeout(() => { onVerified?.(); onClose(); }, 2200);
    } else {
      setError('Invalid OTP. Try 123456');
    }
  }, [otp, onClose, onVerified, successScale, checkScale]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={s.overlay}
      >
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} />
        <Animated.View style={[s.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={s.handle} />
          <TouchableOpacity style={s.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={24} color={COLORS.textMedium} />
          </TouchableOpacity>

          {step === 'phone' && (
            <>
              <Text style={s.title}>{t('animal.verifyAadhaarTitle')}</Text>
              <Text style={s.subtitle}>
                Verified sellers get 3x more responses. Link your Aadhaar for trust badge.
              </Text>
              <Text style={s.label}>Mobile Number (linked to Aadhaar)</Text>
              <View style={s.inputRow}>
                <Text style={s.phonePrefix}>+91</Text>
                <TextInput
                  style={s.input}
                  placeholder={t('animal.phonePlaceholder')}
                  placeholderTextColor={COLORS.textMedium}
                  keyboardType="phone-pad"
                  maxLength={10}
                  value={phone}
                  onChangeText={setPhone}
                />
              </View>
              {error ? <Text style={s.error}>{error}</Text> : null}
              <TouchableOpacity style={s.btn} onPress={handleSendOtp}>
                <Text style={s.btnText}>{t('login.sendOtp')}</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'otp' && (
            <>
              <Text style={s.title}>{t('login.enterOtp')}</Text>
              <Text style={s.subtitle}>OTP sent to +91 {phone}. Enter 6-digit code to verify.</Text>
              <View style={s.otpRow}>
                {otp.map((digit, i) => (
                  <TextInput
                    key={i}
                    ref={(r) => { if (r) otpRefs.current[i] = r; }}
                    style={[s.otpBox, digit ? s.otpBoxFilled : null]}
                    value={digit}
                    onChangeText={(t) => handleOtpChange(t, i)}
                    keyboardType="numeric"
                    maxLength={1}
                    textAlign="center"
                    onKeyPress={({ nativeEvent }) => {
                      if (nativeEvent.key === 'Backspace' && !otp[i] && i > 0) {
                        otpRefs.current[i - 1]?.focus();
                      }
                    }}
                  />
                ))}
              </View>
              {error ? <Text style={s.error}>{error}</Text> : null}
              <TouchableOpacity style={s.btn} onPress={handleVerify} disabled={loading}>
                <Text style={s.btnText}>{loading ? 'Verifying...' : 'Verify Aadhaar'}</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'success' && (
            <View style={s.successContainer}>
              <Animated.View style={[s.successCircle, { transform: [{ scale: successScale }] }]}>
                <Animated.View style={{ transform: [{ scale: checkScale }] }}>
                  <Ionicons name="checkmark" size={52} color={COLORS.white} />
                </Animated.View>
              </Animated.View>
              <Text style={s.successTitle}>{t('animal.aadhaarVerified')}</Text>
              <Text style={s.successText}>
                Your account is now verified. You will receive a verified badge on your listings.
              </Text>
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet:        { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
                  padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24, minHeight: 380 },
  handle:       { width: 40, height: 4, backgroundColor: COLORS.borderGreen, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  closeBtn:     { position: 'absolute', top: 20, right: 20 },
  title:        { fontSize: 22, fontWeight: '800', color: COLORS.textDark, marginBottom: 6, fontFamily: 'Inter_800ExtraBold' },
  subtitle:     { fontSize: 14, color: COLORS.textMedium, marginBottom: 24, lineHeight: 20, fontFamily: 'Inter_400Regular' },
  label:        { fontSize: 13, fontWeight: '600', color: COLORS.textDark, marginBottom: 8, fontFamily: 'Inter_600SemiBold' },
  inputRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  phonePrefix:  { backgroundColor: COLORS.primaryPale, borderWidth: 1, borderColor: COLORS.borderGreen, borderRadius: 10,
                  paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, color: COLORS.textDark, fontWeight: '600',
                  fontFamily: 'Inter_600SemiBold' },
  input:        { flex: 1, borderWidth: 1.5, borderColor: COLORS.borderGreen, borderRadius: 10,
                  paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: COLORS.textDark,
                  backgroundColor: COLORS.background, fontFamily: 'Inter_400Regular' },
  btn:          { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
  btnText:      { color: COLORS.white, fontSize: 16, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  error:        { color: COLORS.error, fontSize: 13, marginTop: 8, fontFamily: 'Inter_400Regular' },
  otpRow:       { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: 8 },
  otpBox:       { width: 46, height: 56, borderWidth: 2, borderColor: COLORS.borderGreen, borderRadius: 10,
                  alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background,
                  fontSize: 22, fontWeight: '700', textAlign: 'center', color: COLORS.textDark,
                  fontFamily: 'Inter_700Bold' },
  otpBoxFilled: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryPale },
  successContainer: { alignItems: 'center', paddingVertical: 20 },
  successCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: COLORS.success,
                   alignItems: 'center', justifyContent: 'center', marginBottom: 20,
                   shadowColor: COLORS.success, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4,
                   shadowRadius: 16, elevation: 8 },
  successTitle: { fontSize: 24, fontWeight: '800', color: COLORS.textDark, marginBottom: 8, fontFamily: 'Inter_800ExtraBold' },
  successText:  { fontSize: 15, color: COLORS.textMedium, textAlign: 'center', fontFamily: 'Inter_400Regular' },
});

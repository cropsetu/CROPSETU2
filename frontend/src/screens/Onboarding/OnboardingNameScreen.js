/**
 * OnboardingNameScreen — Step 1/4: Farmer's name
 * Matches LoginScreen's design language: green gradient bg, white card, rounded inputs.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLanguage } from '../../context/LanguageContext';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../../constants/colors';
import { EntrySlide } from '../../components/ui/ImmersiveKit';
import { s, vs, fs, ms } from '../../utils/responsive';

export default function OnboardingNameScreen({ navigation }) {
  const { t } = useLanguage();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const canProceed = firstName.trim().length >= 1;

  return (
    <View style={sty.safe}>
      <View style={[sty.gradient, { backgroundColor: COLORS.pineGreen }]}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={sty.inner}>

          {/* Logo */}
          <EntrySlide delay={0} fromY={-20}>
          <View style={sty.logoArea}>
            <View style={sty.logoCircle}>
              <Ionicons name="person-outline" size={ms(38)} color={COLORS.textWhite} />
            </View>
            <Text style={sty.appName}>{t('appName')}</Text>
            <Text style={sty.tagline}>{t('onboarding.nameSub') || 'Let\'s set up your farming profile'}</Text>
          </View>

          </EntrySlide>

          {/* Progress */}
          <View style={sty.progressRow}>
            {[1, 2, 3, 4, 5].map(i => (
              <View key={i} style={[sty.progressDot, i <= 2 && sty.progressDotActive]} />
            ))}
            <Text style={sty.progressText}>Step 2 of 5</Text>
          </View>

          {/* Card */}
          <EntrySlide delay={200} fromY={30}>
          <View style={sty.card}>
            <Text style={sty.cardTitle}>{t('onboarding.nameTitle') || 'What is your name?'}</Text>
            <Text style={sty.cardSub}>{t('onboarding.nameSub') || 'This helps personalize your AI recommendations'}</Text>

            <View style={sty.inputRow}>
              <View style={sty.inputIcon}><Ionicons name="person" size={16} color={COLORS.primary} /></View>
              <TextInput
                style={sty.input}
                value={firstName}
                onChangeText={setFirstName}
                placeholder={t('onboarding.firstName') || 'First Name *'}
                placeholderTextColor={COLORS.textLight}
                autoFocus
                maxLength={50}
              />
            </View>

            <View style={sty.inputRow}>
              <View style={sty.inputIcon}><Ionicons name="people" size={16} color={COLORS.primary} /></View>
              <TextInput
                style={sty.input}
                value={lastName}
                onChangeText={setLastName}
                placeholder={t('onboarding.lastName') || 'Last Name'}
                placeholderTextColor={COLORS.textLight}
                maxLength={50}
              />
            </View>

            <TouchableOpacity
              style={[sty.btn, !canProceed && { opacity: 0.5 }]}
              onPress={() => canProceed && navigation.navigate('OnboardingLocation', { firstName: firstName.trim(), lastName: lastName.trim() })}
              disabled={!canProceed}
            >
              <LinearGradient colors={[COLORS.primary, COLORS.primaryMedium || '#2D9B63']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={sty.btnGrad}>
                <Text style={sty.btnTxt}>{t('next')}</Text>
                <Ionicons name="arrow-forward" size={18} color="#FFF" />
              </LinearGradient>
            </TouchableOpacity>
          </View>

          </EntrySlide>

          {/* Skip */}
          <TouchableOpacity style={sty.skipBtn} onPress={() => navigation.navigate('OnboardingLocation', { firstName: '', lastName: '' })}>
            <Text style={sty.skipTxt}>{t('onboarding.skip') || 'Skip for now'}</Text>
          </TouchableOpacity>

        </KeyboardAvoidingView>
      </View>
    </View>
  );
}

const sty = StyleSheet.create({
  safe: { flex: 1 },
  gradient: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: s(24), paddingVertical: vs(24) },

  logoArea: { alignItems: 'center', marginBottom: vs(20) },
  logoCircle: { width: ms(76), height: ms(76), borderRadius: ms(24), backgroundColor: 'rgba(255,255,255,0.14)', justifyContent: 'center', alignItems: 'center', marginBottom: vs(12), borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  appName: { fontSize: fs(30), fontWeight: TYPE.weight.black || '900', color: COLORS.textWhite, letterSpacing: -0.5 },
  tagline: { fontSize: fs(13), color: 'rgba(255,255,255,0.6)', marginTop: vs(6), textAlign: 'center' },

  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: s(6), marginBottom: vs(16) },
  progressDot: { width: s(24), height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  progressDotActive: { backgroundColor: '#FFF', width: s(32) },
  progressText: { fontSize: fs(11), color: 'rgba(255,255,255,0.5)', marginLeft: s(8) },

  card: { backgroundColor: COLORS.surface || '#FFF', borderRadius: s(28), padding: s(24), borderWidth: 1, borderColor: 'rgba(255,255,255,0.65)', ...SHADOWS.large },
  cardTitle: { fontSize: fs(22), fontWeight: TYPE.weight.black || '900', color: COLORS.textDark, marginBottom: vs(6), letterSpacing: -0.2 },
  cardSub: { fontSize: fs(13), color: COLORS.textMedium || '#666', marginBottom: vs(20), lineHeight: fs(19) },

  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: vs(14), gap: s(10) },
  inputIcon: { width: s(40), height: s(40), borderRadius: s(12), backgroundColor: COLORS.primary + '10', justifyContent: 'center', alignItems: 'center' },
  input: { flex: 1, borderWidth: 1.5, borderColor: COLORS.border || '#E0E0E0', borderRadius: s(16), paddingHorizontal: s(14), paddingVertical: vs(14), fontSize: fs(15), color: COLORS.textDark, backgroundColor: COLORS.inputBg || '#FAFAFA' },

  btn: { marginTop: vs(6), borderRadius: RADIUS.full || 28, overflow: 'hidden' },
  btnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: s(8), paddingVertical: vs(16), ...SHADOWS.greenGlow },
  btnTxt: { color: '#FFF', fontSize: fs(16), fontWeight: TYPE.weight.bold || '700' },

  skipBtn: { alignItems: 'center', marginTop: vs(20) },
  skipTxt: { color: 'rgba(255,255,255,0.6)', fontSize: fs(13), fontWeight: '600' },
});

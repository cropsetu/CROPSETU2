/**
 * OnboardingLanguageScreen — Screen 1/2: Pick your language.
 * CropSetu theme: forest-green gradient surface, Fraunces serif headline,
 * Plus Jakarta Sans cards, single-green selection, gradient CTA. Staggered
 * card entrance + press-scale motion preserved. Logic unchanged.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
  Easing,
  Platform,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage } from "../../context/LanguageContext";
import { KHET, KFONT, KSHADOW } from "../../constants/khetTheme";

const LANGS = [
  { code: "en", name: "English",   native: "English",  flag: "🌍", region: "Global" },
  { code: "hi", name: "Hindi",     native: "हिन्दी",     flag: "🏛️", region: "UP · MP · Rajasthan" },
  { code: "mr", name: "Marathi",   native: "मराठी",      flag: "🏰", region: "Maharashtra" },
  { code: "ta", name: "Tamil",     native: "தமிழ்",      flag: "🛕", region: "Tamil Nadu" },
  { code: "te", name: "Telugu",    native: "తెలుగు",     flag: "💎", region: "Telangana · AP" },
  { code: "kn", name: "Kannada",   native: "ಕನ್ನಡ",      flag: "🪷", region: "Karnataka" },
  { code: "ml", name: "Malayalam", native: "മലയാളം",    flag: "🌴", region: "Kerala" },
  { code: "bn", name: "Bengali",   native: "বাংলা",      flag: "🐅", region: "West Bengal" },
  { code: "gu", name: "Gujarati",  native: "ગુજરાતી",    flag: "🦁", region: "Gujarat" },
  { code: "pa", name: "Punjabi",   native: "ਪੰਜਾਬੀ",     flag: "🌾", region: "Punjab" },
];

// ── Soft green ambient blobs (matches the auth screens) ─────────────────────
function Blobs() {
  return (
    <>
      <View style={[sty.blob, { backgroundColor: KHET.primaryGlow, top: -90, right: -90 }]} />
      <View style={[sty.blob, { backgroundColor: KHET.primary, top: 220, left: -80, opacity: 0.1 }]} />
    </>
  );
}

// ── Language card with entrance + press-scale animation ─────────────────────
function LangCard({ lang, active, onSelect, index }) {
  const scale = useRef(new Animated.Value(1)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeIn, {
      toValue: 1, duration: 400, delay: index * 60,
      easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
  }, []);

  const translateY = fadeIn.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });

  return (
    <Animated.View style={{ opacity: fadeIn, transform: [{ scale }, { translateY }] }}>
      <TouchableOpacity
        style={[sty.langCard, active && sty.langCardActive]}
        activeOpacity={1}
        onPressIn={() => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5 }).start()}
        onPress={() => onSelect(lang.code)}
      >
        {/* Flag chip */}
        <View style={[sty.flagWrap, active && sty.flagWrapActive]}>
          <Text style={sty.flag}>{lang.flag}</Text>
        </View>

        {/* Text */}
        <View style={{ flex: 1 }}>
          <Text style={[sty.langNative, active && sty.langNativeActive]}>{lang.native}</Text>
          <Text style={[sty.langRegion, active && sty.langRegionActive]}>{lang.region}</Text>
        </View>

        {/* Check / radio */}
        {active ? (
          <LinearGradient colors={KHET.gradPrimary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={sty.checkCircle}>
            <Ionicons name="checkmark" size={15} color={KHET.primaryForeground} />
          </LinearGradient>
        ) : (
          <View style={sty.radioCircle} />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function OnboardingLanguageScreen({ navigation }) {
  const { language, setLanguage, t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState(language || "en");
  const { height: winHeight } = useWindowDimensions();

  const handleSelect = useCallback((code) => {
    setSelected(code);
    setLanguage(code);
  }, [setLanguage]);

  const handleNext = async () => {
    await setLanguage(selected);
    navigation.navigate("OnboardingProfile");
  };

  const selectedLang = LANGS.find((l) => l.code === selected);

  return (
    <LinearGradient colors={KHET.gradSurface} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 1 }} style={sty.container}>
      <Blobs />

      <ScrollView
        style={[
          sty.scrollFlex,
          Platform.OS === "web" && { height: winHeight, maxHeight: winHeight },
        ]}
        contentContainerStyle={[sty.scroll, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        {/* ── Hero headline ── */}
        <View style={sty.hero}>
          <LinearGradient colors={KHET.gradPrimary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={sty.heroIcon}>
            <Ionicons name="language" size={26} color={KHET.primaryForeground} />
          </LinearGradient>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={sty.title}>
              Choose your{"\n"}
              <Text style={sty.titleAccent}>language</Text>
            </Text>
            <Text style={sty.subtitle}>अपनी भाषा चुनें · तुमची भाषा निवडा</Text>
          </View>
        </View>

        {/* ── Language list ── */}
        <View style={sty.listContainer}>
          {LANGS.map((lang, i) => (
            <LangCard key={lang.code} lang={lang} active={selected === lang.code} onSelect={handleSelect} index={i} />
          ))}
        </View>

        <View style={{ height: 180 }} />
      </ScrollView>

      {/* ── Bottom CTA ── */}
      <View style={[sty.bottomBar, { paddingBottom: insets.bottom + 18 }]}>
        <View style={sty.selectedIndicator}>
          <Text style={sty.selectedFlag}>{selectedLang?.flag}</Text>
          <Text style={sty.selectedText}>
            <Text style={sty.selectedNative}>{selectedLang?.native}</Text>
            {"  ·  "}{selectedLang?.name}
          </Text>
        </View>

        <TouchableOpacity onPress={handleNext} activeOpacity={0.9} style={{ borderRadius: 18 }}>
          <LinearGradient colors={KHET.gradPrimary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={sty.btnGrad}>
            <Text style={sty.btnTxt}>{t("next")}</Text>
            <View style={sty.btnArrow}>
              <Ionicons name="arrow-forward" size={16} color={KHET.primaryForeground} />
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

const sty = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: KHET.background,
    ...(Platform.OS === "web" ? { height: "100vh", overflow: "hidden" } : {}),
  },
  scrollFlex: { flex: 1, minHeight: 0, ...(Platform.OS === "web" ? { height: "100%" } : {}) },
  scroll: { paddingBottom: 20, paddingHorizontal: 24 },

  blob: { position: "absolute", width: 280, height: 280, borderRadius: 140, opacity: 0.18 },

  // Brand
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 22 },
  brandIcon: {
    width: 42, height: 42, borderRadius: 13,
    justifyContent: "center", alignItems: "center", ...KSHADOW.elegant,
  },
  appName: { fontSize: 18, fontFamily: KFONT.sansBold, color: KHET.foreground, letterSpacing: -0.3 },
  appSub: { fontSize: 11, color: KHET.mutedForeground, marginTop: 1, fontFamily: KFONT.sans },

  // Hero
  hero: { flexDirection: "row", alignItems: "center", marginBottom: 26 },
  heroIcon: { width: 56, height: 56, borderRadius: 16, justifyContent: "center", alignItems: "center", ...KSHADOW.elegant },
  title: { fontSize: 30, fontFamily: KFONT.display, color: KHET.foreground, lineHeight: 34, letterSpacing: -0.5 },
  titleAccent: { fontFamily: KFONT.displayItalic, fontStyle: "italic", color: KHET.primary },
  subtitle: { fontSize: 12, color: KHET.mutedForeground, marginTop: 8, lineHeight: 18, fontFamily: KFONT.sans },

  // List
  listContainer: { gap: 10 },
  langCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: 16, borderWidth: 1.5, borderColor: KHET.border,
    backgroundColor: KHET.card, ...KSHADOW.soft,
  },
  langCardActive: { borderColor: KHET.primary, borderWidth: 2, backgroundColor: KHET.accent },
  flagWrap: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: KHET.secondary, justifyContent: "center", alignItems: "center",
  },
  flagWrapActive: { backgroundColor: "rgba(255,255,255,0.65)" },
  flag: { fontSize: 24 },
  langNative: { fontSize: 16, fontFamily: KFONT.sansSemi, color: KHET.foreground },
  langNativeActive: { color: KHET.primary, fontFamily: KFONT.sansBold },
  langRegion: { fontSize: 11, color: KHET.mutedForeground, marginTop: 2, fontFamily: KFONT.sans },
  langRegionActive: { color: KHET.accentForeground },
  checkCircle: { width: 27, height: 27, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  radioCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: KHET.border },

  // Bottom bar
  bottomBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 24, paddingTop: 12,
    backgroundColor: KHET.card,
    borderTopWidth: 1, borderTopColor: KHET.border,
    ...KSHADOW.soft,
  },
  selectedIndicator: {
    flexDirection: "row", alignItems: "center", gap: 8,
    alignSelf: "center", marginBottom: 12,
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 999, backgroundColor: KHET.accent,
    borderWidth: 1, borderColor: "rgba(0,95,33,0.15)",
  },
  selectedFlag: { fontSize: 16 },
  selectedText: { fontSize: 13, color: KHET.mutedForeground, fontFamily: KFONT.sans },
  selectedNative: { fontFamily: KFONT.sansBold, color: KHET.primary },
  btnGrad: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: 16, borderRadius: 18, ...KSHADOW.elegant,
  },
  btnTxt: { color: KHET.primaryForeground, fontSize: 16, fontFamily: KFONT.sansSemi },
  btnArrow: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.18)", justifyContent: "center", alignItems: "center",
  },
});

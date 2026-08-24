/**
 * OnboardingIntroScreen — the first-run value-prop carousel.
 *
 * Until now a brand-new user went OTP → language picker → farm form, and was
 * never told what the app does. This is the missing first step.
 *
 * Three slides, not four: a fourth "everything in one place" slide restates the
 * other three and adds a swipe most users skip. Every caption is a real localised
 * string — the illustrations are deliberately text-free so one asset serves all
 * ten languages (docs/branding/IMAGE_PROCESS.md §10.4).
 */
import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, useWindowDimensions, TouchableOpacity, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import { KHET, KFONT, KRADIUS, KSPACE } from '@krushisarva/shared/constants/khetTheme';

const SLIDES = [
  { key: 'advice', img: require('../../../assets/onboard/advice.webp'),
    titleKey: 'intro.adviceTitle', title: 'Smart farming advice',
    bodyKey: 'intro.adviceBody',  body: 'Crop guidance, weather and market prices — in your language.' },
  { key: 'scan', img: require('../../../assets/onboard/scan.webp'),
    titleKey: 'intro.scanTitle', title: 'Krushi Drishti',
    bodyKey: 'intro.scanBody',  body: 'Photograph a sick leaf and get treatment guidance.' },
  { key: 'market', img: require('../../../assets/onboard/market.webp'),
    titleKey: 'intro.marketTitle', title: 'Buy, sell and rent',
    bodyKey: 'intro.marketBody',  body: 'Farm inputs, livestock and machinery, near you.' },
];

export default function OnboardingIntroScreen({ navigation }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const [index, setIndex] = useState(0);
  const listRef = useRef(null);

  const last = index === SLIDES.length - 1;
  const go = () => {
    if (last) return navigation.replace('OnboardingLanguage');
    listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  };

  return (
    <View style={[S.root, { paddingTop: insets.top }]}>
      <View style={S.skipRow}>
        <TouchableOpacity onPress={() => navigation.replace('OnboardingLanguage')} hitSlop={12}>
          <Text style={S.skip}>{t('intro.skip', 'Skip')}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={s => s.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          <View style={[S.slide, { width }]}>
            <Image source={item.img} style={S.img} resizeMode="contain" />
            <Text style={S.title}>{t(item.titleKey, item.title)}</Text>
            <Text style={S.body}>{t(item.bodyKey, item.body)}</Text>
          </View>
        )}
      />

      <View style={[S.footer, { paddingBottom: insets.bottom + KSPACE.s16 }]}>
        <View style={S.dots}>
          {SLIDES.map((s, i) => (
            <View key={s.key} style={[S.dot, i === index && S.dotActive]} />
          ))}
        </View>
        <TouchableOpacity style={S.cta} onPress={go} activeOpacity={0.85}>
          <Text style={S.ctaTxt}>{last ? t('intro.start', 'Get started') : t('next', 'Next')}</Text>
          <Ionicons name="arrow-forward" size={18} color={KHET.white} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: KHET.background },
  skipRow: { alignItems: 'flex-end', paddingHorizontal: KSPACE.s20, paddingTop: KSPACE.s8 },
  skip: { color: KHET.mutedForeground, fontFamily: KFONT.sansSemi, fontSize: 14 },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: KSPACE.s24 },
  img: { width: '86%', height: '46%', marginBottom: KSPACE.s24 },
  title: { fontFamily: KFONT.displayBold, fontSize: 26, color: KHET.foreground, textAlign: 'center' },
  body: { fontFamily: KFONT.sans, fontSize: 15, lineHeight: 22, color: KHET.mutedForeground,
          textAlign: 'center', marginTop: KSPACE.s10, paddingHorizontal: KSPACE.s8 },
  footer: { paddingHorizontal: KSPACE.s20, gap: KSPACE.s14 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: KHET.border },
  dotActive: { width: 20, backgroundColor: KHET.primary },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
         backgroundColor: KHET.primary, paddingVertical: 16, borderRadius: KRADIUS.r14 },
  ctaTxt: { color: KHET.white, fontFamily: KFONT.sansBold, fontSize: 16 },
});

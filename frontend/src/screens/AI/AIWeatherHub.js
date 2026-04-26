import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../../context/LanguageContext';
import { COLORS } from '../../constants/colors';

import AIAssistantHome from './AIAssistantHome';
import WeatherHome from '../Weather/WeatherHome';

const { width: W } = Dimensions.get('window');
const TRACK_INNER_PAD = 3;

export default function AIWeatherHub({ navigation }) {
  const [tab, setTab] = useState('ai');
  const slideAnim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  const PILL_W = (W - 32 - TRACK_INNER_PAD * 2) / 2;

  const switchTab = (tabKey) => {
    if (tabKey === tab) return;
    setTab(tabKey);
    Animated.spring(slideAnim, {
      toValue: tabKey === 'ai' ? 0 : 1,
      tension: 120,
      friction: 14,
      useNativeDriver: true,
    }).start();
  };

  const pillTranslate = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, PILL_W],
  });

  const isAI      = tab === 'ai';
  const isWeather = tab === 'weather';

  // Accent underline color animates between green (AI) and blue (Weather)
  const accentColor = isAI ? COLORS.primary : COLORS.blue;

  return (
    <View style={S.root}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* ── Header ───────────────────────────────────────────────────── */}
      <View style={[S.headerOuter, { paddingTop: insets.top + 6 }]}>
        {/* Brand row */}
        <View style={S.brandRow}>
          <View style={S.dot} />
          <Text style={S.brand}>{t('aiHub.brand')}</Text>
          <View style={S.dot} />
        </View>

        {/* Pill switcher track */}
        <View style={S.track}>
          {/* Sliding pill */}
          <Animated.View
            style={[
              S.pill,
              {
                width: PILL_W,
                backgroundColor: isAI ? COLORS.primary : COLORS.blue,
                transform: [{ translateX: pillTranslate }],
              },
            ]}
          />

          {/* AI button */}
          <TouchableOpacity
            style={[S.tabBtn, { width: PILL_W }]}
            activeOpacity={0.8}
            onPress={() => switchTab('ai')}
          >
            <Ionicons
              name={isAI ? 'sparkles' : 'sparkles-outline'}
              size={15}
              color={isAI ? COLORS.textWhite : COLORS.textLight}
            />
            <Text style={[S.tabLabel, isAI && S.tabLabelActive]}>{t('aiHub.tabAI')}</Text>
          </TouchableOpacity>

          {/* Weather button */}
          <TouchableOpacity
            style={[S.tabBtn, { width: PILL_W }]}
            activeOpacity={0.8}
            onPress={() => switchTab('weather')}
          >
            <Ionicons
              name={isWeather ? 'partly-sunny' : 'partly-sunny-outline'}
              size={15}
              color={isWeather ? COLORS.textWhite : COLORS.textLight}
            />
            <Text style={[S.tabLabel, isWeather && S.tabLabelActive]}>{t('aiHub.tabWeather')}</Text>
          </TouchableOpacity>
        </View>

        {/* Accent underline */}
        <View style={[S.accentLine, { backgroundColor: accentColor }]} />
      </View>

      {/* ── Content ──────────────────────────────────────────────────── */}
      <View style={S.content}>
        <View style={{ flex: 1, display: isAI ? 'flex' : 'none' }}>
          <AIAssistantHome navigation={navigation} embeddedInHub />
        </View>
        <View style={{ flex: 1, display: isWeather ? 'flex' : 'none' }}>
          <WeatherHome navigation={navigation} embeddedInHub />
        </View>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  headerOuter: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(46,204,113,0.12)',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    gap: 8,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
  },
  brand: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2.5,
  },
  track: {
    flexDirection: 'row',
    backgroundColor: COLORS.greenDeep,
    borderRadius: 14,
    padding: TRACK_INNER_PAD,
    position: 'relative',
    overflow: 'hidden',
  },
  pill: {
    position: 'absolute',
    top: TRACK_INNER_PAD,
    left: TRACK_INNER_PAD,
    height: 36,
    borderRadius: 11,
  },
  tabBtn: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    zIndex: 1,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  tabLabelActive: {
    color: COLORS.textWhite,
  },
  accentLine: {
    height: 2,
    borderRadius: 1,
    marginTop: 10,
    width: 40,
    alignSelf: 'center',
  },
  content: {
    flex: 1,
  },
});

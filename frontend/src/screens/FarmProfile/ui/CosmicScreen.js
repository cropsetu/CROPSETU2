/**
 * CosmicScreen — page wrapper for every MyFarm v2 screen.
 *
 * Provides:
 *   • Deep-space background (CosmicBackground)
 *   • SafeArea handling with optional custom paddings
 *   • StatusBar set to light-content (matched to dark canvas)
 *   • Optional scroll container with pull-to-refresh
 *
 * Usage:
 *   <CosmicScreen>
 *     ...your content...
 *   </CosmicScreen>
 *
 *   <CosmicScreen scroll refreshing={syncing} onRefresh={reload}>
 *     ...
 *   </CosmicScreen>
 */

import React from 'react';
import { View, ScrollView, StyleSheet, StatusBar, RefreshControl, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CosmicBackground from '../theme/CosmicBackground';
import { COSMIC } from '../theme/cosmicTheme';

export default function CosmicScreen({
  children,
  scroll = false,
  refreshing = false,
  onRefresh,
  contentStyle,
  style,
  backgroundVariant = 'default',
  edges = { top: true, bottom: true },
  disableTopInset = false,
  contentContainerStyle,
}) {
  const insets = useSafeAreaInsets();
  const topInset = disableTopInset ? 0 : (edges.top ? insets.top : 0);
  const bottomInset = edges.bottom ? insets.bottom : 0;

  const inner = (
    <View style={[styles.inner, contentStyle, { paddingTop: topInset, paddingBottom: bottomInset }]}>
      {children}
    </View>
  );

  const refreshControl = onRefresh
    ? (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        tintColor={COSMIC.PRIMARY}
        colors={[COSMIC.PRIMARY]}
        progressBackgroundColor={COSMIC.SURFACE}
      />
    )
    : undefined;

  return (
    <View style={[styles.root, style]}>
      <StatusBar barStyle="dark-content" backgroundColor={COSMIC.BG} translucent={Platform.OS === 'android'} />
      <CosmicBackground variant={backgroundVariant} />
      {scroll ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[{ paddingTop: topInset, paddingBottom: bottomInset + 40 }, contentContainerStyle]}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : inner}
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COSMIC.BG },
  scroll: { flex: 1 },
  inner:  { flex: 1 },
});

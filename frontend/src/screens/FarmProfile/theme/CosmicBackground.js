/**
 * CosmicBackground — plain light canvas under every MyFarm screen.
 *
 * Intentionally minimal: solid warm off-white. Matches the rest of the
 * app's background (constants/colors.js `background: #F4F8F1`).
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { COSMIC } from './cosmicTheme';

export default function CosmicBackground() {
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: COSMIC.BG }]} pointerEvents="none" />;
}

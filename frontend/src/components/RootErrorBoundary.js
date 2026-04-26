/**
 * Top-level error boundary — catches uncaught render errors anywhere in the
 * tree and offers a Reload action. Without this, a single bug white-screens
 * the entire app and the user has nothing to do but force-quit.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { COLORS } from '../constants/colors';

let _Updates = null;
function getUpdates() {
  if (Platform.OS === 'web') return null;
  if (!_Updates) {
    try { _Updates = require('expo-updates'); } catch { _Updates = null; }
  }
  return _Updates;
}

export default class RootErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (__DEV__) {
      console.error('[RootErrorBoundary]', error, info?.componentStack);
    }
    // Future: forward to Sentry / Bugsnag here.
  }

  reload = async () => {
    const Updates = getUpdates();
    if (Updates?.reloadAsync) {
      try { await Updates.reloadAsync(); return; } catch { /* fall through */ }
    }
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={s.root}>
        <Text style={s.title}>Something went wrong</Text>
        <Text style={s.body}>
          The app hit an unexpected error. Please reload to try again.
        </Text>
        <TouchableOpacity style={s.btn} onPress={this.reload} accessibilityRole="button">
          <Text style={s.btnTxt}>Reload</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: COLORS?.primary ?? '#1B4332',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: '#cfe7d8',
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  btn: {
    backgroundColor: '#fff',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
  },
  btnTxt: {
    color: COLORS?.primary ?? '#1B4332',
    fontWeight: '700',
    fontSize: 15,
  },
});

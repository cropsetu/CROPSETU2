/**
 * Feedback — toasts and confirmation dialogs that work on every platform.
 *
 * WHY THIS EXISTS
 * ---------------
 * The seller app renders on web (`expo start --web`, react-native-web 0.21),
 * and react-native-web ships Alert as a literal no-op:
 *
 *     class Alert { static alert() {} }
 *
 * Every `Alert.alert(...)` in this app therefore did NOTHING in a browser. That
 * silently broke:
 *   - "Delete product?" / "Log out?" / "Mark as SHIPPED?" — the confirm never
 *     appeared, so the destructive action could never be completed
 *   - every validation message on AddProduct — tapping Save on an invalid form
 *     produced no feedback at all, just a button that appeared to do nothing
 *   - every API error message — failures vanished
 *
 * These components render real UI, so the same code path works on iOS, Android
 * and web. They are also accessible (announced to screen readers, dialogs are
 * modal with a labelled role, Escape/backdrop dismiss) and honour Reduce Motion.
 *
 * VISUAL: one toast, four meanings. Every toast is the same deep-ink slab and
 * carries its variant in a coloured rail and a coloured icon rather than by
 * being a differently-coloured slab. Four saturated rectangles sliding in from
 * the top of a parchment app looked like four different products; this reads as
 * one voice, and the variant is still carried by icon + hue + haptic + the
 * screen-reader announcement, never by hue alone.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  AccessibilityInfo, Animated, BackHandler, Modal, Platform, Pressable,
  StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Haptics } from '@krushisarva/shared/utils/haptics';
import { C, E, HIT, R, SP, T, alpha } from '../../theme';
import { useReducedMotion } from '../../hooks/useMotion';

const FeedbackContext = createContext(null);

const TOAST_VARIANTS = {
  success: { rail: C.successBold, icon: 'checkmark-circle',   haptic: 'success' },
  error:   { rail: C.dangerBold,  icon: 'alert-circle',       haptic: 'error' },
  warning: { rail: C.warningBold, icon: 'warning',            haptic: 'warning' },
  info:    { rail: C.brandLight,  icon: 'information-circle', haptic: null },
};

const DEFAULT_TOAST_MS = 3200;

// ── Toast ────────────────────────────────────────────────────────────────────

function Toast({ toast, onDismiss }) {
  const reduced = useReducedMotion();
  const anim = useRef(new Animated.Value(0)).current;
  const variant = TOAST_VARIANTS[toast.variant] || TOAST_VARIANTS.info;
  const timer = useRef(null);

  useEffect(() => {
    // Screen readers don't see a toast appear — announce it explicitly.
    AccessibilityInfo.announceForAccessibility?.(toast.message);
    if (variant.haptic) Haptics[variant.haptic]?.();

    Animated.timing(anim, {
      toValue: 1,
      duration: reduced ? 120 : 220,
      useNativeDriver: true,
    }).start();

    if (toast.duration !== 0) {
      timer.current = setTimeout(() => {
        Animated.timing(anim, {
          toValue: 0,
          duration: reduced ? 100 : 180,
          useNativeDriver: true,
        }).start(({ finished }) => { if (finished) onDismiss(toast.id); });
      }, toast.duration ?? DEFAULT_TOAST_MS);
    }

    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    onDismiss(toast.id);
  }, [onDismiss, toast.id]);

  return (
    <Animated.View
      style={[
        ts.toast,
        {
          opacity: anim,
          transform: reduced
            ? []
            : [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
        },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <View style={[ts.rail, { backgroundColor: variant.rail }]} />
      <Ionicons name={variant.icon} size={20} color={variant.rail} />
      <Text style={ts.toastTxt} numberOfLines={4}>{toast.message}</Text>
      {toast.actionLabel ? (
        <Pressable
          onPress={() => { toast.onAction?.(); dismissNow(); }}
          hitSlop={HIT.slop}
          accessibilityRole="button"
          accessibilityLabel={toast.actionLabel}
          style={({ pressed }) => [ts.action, pressed && { opacity: 0.6 }]}
        >
          <Text style={ts.actionTxt}>{toast.actionLabel}</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={dismissNow}
          hitSlop={HIT.slop}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          <Ionicons name="close" size={18} color={alpha(C.onBrand, 0.85)} />
        </Pressable>
      )}
    </Animated.View>
  );
}

// ── Confirm dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ request, onResolve }) {
  const reduced = useReducedMotion();
  const anim = useRef(new Animated.Value(0)).current;
  const open = !!request;

  useEffect(() => {
    if (!open) { anim.setValue(0); return; }
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      speed: reduced ? 40 : 18,
      bounciness: reduced ? 0 : 6,
    }).start();
    AccessibilityInfo.announceForAccessibility?.(request.title);
  }, [open, anim, reduced, request]);

  // Android hardware back cancels, matching what Alert.alert did.
  useEffect(() => {
    if (!open || Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onResolve(false); return true; });
    return () => sub.remove();
  }, [open, onResolve]);

  // Web: Escape cancels.
  useEffect(() => {
    if (!open || Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onResolve(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onResolve]);

  if (!open) return null;

  const destructive = request.destructive;
  // Two tones on purpose: the solid confirm button wants the saturated brand,
  // the icon sits on a light plate and needs the 4.5:1 ink version.
  const accent = destructive ? C.dangerBold : C.brand;
  const accentInk = destructive ? C.danger : C.brandInk;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => onResolve(false)}
    >
      <View style={cs.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => request.dismissible !== false && onResolve(false)}
          accessible={false}
          importantForAccessibility="no"
        >
          <Animated.View style={[cs.backdrop, { opacity: anim }]} />
        </Pressable>

        <Animated.View
          style={[
            cs.card,
            {
              opacity: anim,
              transform: reduced
                ? []
                : [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
            },
          ]}
          accessibilityViewIsModal
          accessibilityRole="alert"
          accessibilityLabel={request.title}
        >
          <View
            style={[
              cs.iconWrap,
              { backgroundColor: alpha(accentInk, 0.08), borderColor: alpha(accentInk, 0.22) },
            ]}
          >
            <Ionicons
              name={request.icon || (destructive ? 'trash-outline' : 'help-circle-outline')}
              size={28}
              color={accentInk}
            />
          </View>

          <Text style={cs.title}>{request.title}</Text>
          {request.message ? <Text style={cs.message}>{request.message}</Text> : null}

          <View style={cs.actions}>
            <Pressable
              onPress={() => onResolve(false)}
              style={({ pressed }) => [cs.btn, cs.btnGhost, pressed && cs.pressed]}
              accessibilityRole="button"
              accessibilityLabel={request.cancelLabel}
            >
              <Text style={cs.btnGhostTxt}>{request.cancelLabel}</Text>
            </Pressable>

            <Pressable
              onPress={() => { Haptics[destructive ? 'warning' : 'light']?.(); onResolve(true); }}
              style={({ pressed }) => [cs.btn, { backgroundColor: accent }, pressed && cs.pressed]}
              accessibilityRole="button"
              accessibilityLabel={request.confirmLabel}
            >
              <Text style={cs.btnSolidTxt}>{request.confirmLabel}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmReq, setConfirmReq] = useState(null);
  const resolverRef = useRef(null);
  const idRef = useRef(0);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((tst) => tst.id !== id));
  }, []);

  const showToast = useCallback((message, opts = {}) => {
    if (!message) return null;
    const id = ++idRef.current;
    setToasts((prev) => {
      const next = [...prev, { id, message: String(message), variant: 'info', ...opts }];
      // Never stack more than three — beyond that they cover the content the
      // user is being told about.
      return next.slice(-3);
    });
    return id;
  }, []);

  const toast = useMemo(() => ({
    show:    (msg, opts) => showToast(msg, opts),
    success: (msg, opts) => showToast(msg, { variant: 'success', ...opts }),
    error:   (msg, opts) => showToast(msg, { variant: 'error', duration: 4200, ...opts }),
    warning: (msg, opts) => showToast(msg, { variant: 'warning', ...opts }),
    info:    (msg, opts) => showToast(msg, { variant: 'info', ...opts }),
    dismiss: dismissToast,
  }), [showToast, dismissToast]);

  /**
   * Promise-based confirm. Drop-in replacement for the two-button
   * `Alert.alert(title, msg, [cancel, ok])` shape used across the app:
   *
   *     if (await confirm({ title, message, destructive: true })) { ...act... }
   */
  const confirm = useCallback((options) => new Promise((resolve) => {
    // A second confirm while one is open would strand the first promise.
    resolverRef.current?.(false);
    resolverRef.current = resolve;
    setConfirmReq({
      confirmLabel: 'OK',
      cancelLabel: 'Cancel',
      destructive: false,
      dismissible: true,
      ...options,
    });
  }), []);

  const resolveConfirm = useCallback((value) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setConfirmReq(null);
    resolve?.(value);
  }, []);

  // A pending confirm must not outlive the provider.
  useEffect(() => () => resolverRef.current?.(false), []);

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <SafeAreaView style={ts.host} pointerEvents="box-none" edges={['top']}>
        {toasts.map((tst) => (
          <Toast key={tst.id} toast={tst} onDismiss={dismissToast} />
        ))}
      </SafeAreaView>
      <ConfirmDialog request={confirmReq} onResolve={resolveConfirm} />
    </FeedbackContext.Provider>
  );
}

function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useToast/useConfirm must be used within <FeedbackProvider>');
  return ctx;
}

export const useToast = () => useFeedback().toast;
export const useConfirm = () => useFeedback().confirm;

// ── Styles ───────────────────────────────────────────────────────────────────

const ts = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    alignItems: 'center',
    paddingHorizontal: SP.lg,
    paddingTop: SP.sm,
    zIndex: 9999,
    ...(Platform.OS === 'web' ? { position: 'fixed' } : null),
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    maxWidth: 520,
    width: '100%',
    paddingLeft: SP.xl,
    paddingRight: SP.lg,
    paddingVertical: SP.lg,
    borderRadius: R.lg,
    marginBottom: SP.sm,
    backgroundColor: C.text,
    overflow: 'hidden',
    ...E.float,
  },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  toastTxt: { ...T.body, flex: 1, color: C.onDark },
  action: { paddingHorizontal: SP.sm, paddingVertical: SP.xs },
  actionTxt: { ...T.labelBold, color: C.onBrand, textDecorationLine: 'underline' },
});

const cs = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xxl },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: C.overlay },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: C.surface,
    borderRadius: R.xxl,
    borderWidth: 1,
    borderColor: C.border,
    padding: SP.xxl,
    alignItems: 'center',
    ...E.float,
  },
  iconWrap: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: SP.xl,
  },
  title: { ...T.heading, color: C.text, textAlign: 'center', marginBottom: SP.sm },
  message: { ...T.body, color: C.textMuted, textAlign: 'center', marginBottom: SP.xs },
  actions: { flexDirection: 'row', gap: SP.md, marginTop: SP.xxl, width: '100%' },
  btn: {
    flex: 1,
    minHeight: HIT.min + 2,
    borderRadius: R.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.lg,
  },
  btnGhost: { backgroundColor: C.surfaceSunken, borderWidth: 1.5, borderColor: C.border },
  btnGhostTxt: { ...T.button, color: C.textBody },
  btnSolidTxt: { ...T.button, color: C.onBrand },
  pressed: { opacity: 0.75 },
});

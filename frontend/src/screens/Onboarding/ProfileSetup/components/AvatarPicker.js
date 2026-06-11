// ─────────────────────────────────────────────────────────────────────────────
// <AvatarPicker/> — optional circular profile photo
// ─────────────────────────────────────────────────────────────────────────────
// Empty → a friendly dashed placeholder + "Add photo (optional)". Tapping opens
// a camera / gallery / remove sheet (expo-image-picker, which also drives the
// camera). The PICK is real; the UPLOAD is delegated to the parent via
// `onPick(asset)` and reflected back through `uploading` / `progress` / `error`,
// shown as an animated SVG progress ring. No layout shift between states.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Image, Modal, StyleSheet, Platform } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedProps, withTiming, useReducedMotion, Easing,
} from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { Camera, ImagePlus, Images, Trash2, UserRound, X } from 'lucide-react-native';
import { useOnbTheme } from '../theme';
import { useT } from '../strings';
import { Haptics } from '../../../../utils/haptics';
import { s, vs } from '../../../../utils/responsive';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const MEDIA = ImagePicker.MediaTypeOptions ? ImagePicker.MediaTypeOptions.Images : ['images'];
const PICK_OPTS = { mediaTypes: MEDIA, allowsEditing: true, aspect: [1, 1], quality: 0.7 };

/**
 * @param {object} props
 * @param {string|null} props.uri
 * @param {boolean} [props.uploading]
 * @param {number} [props.progress]      0..1
 * @param {boolean} [props.error]
 * @param {(asset:{uri:string})=>void} props.onPick
 * @param {() => void} props.onRemove
 * @param {number} [props.size=112]
 */
export default function AvatarPicker({
  uri, uploading = false, progress = 0, error = false, onPick, onRemove, size = 112,
}) {
  const theme = useOnbTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const reduceMotion = useReducedMotion();
  const [sheet, setSheet] = useState(false);

  // Progress ring geometry.
  const stroke = s(4);
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  const p = useSharedValue(0);
  useEffect(() => {
    const target = Math.max(0, Math.min(1, progress));
    p.value = reduceMotion ? target : withTiming(target, { duration: 250, easing: Easing.out(Easing.cubic) });
  }, [progress, reduceMotion, p]);
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: circ * (1 - p.value) }));

  // ── Picking ────────────────────────────────────────────────────────────────
  async function pickFrom(source) {
    setSheet(false);
    try {
      const perm = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm?.granted) return;       // graceful: user can try again or skip
      const res = source === 'camera'
        ? await ImagePicker.launchCameraAsync(PICK_OPTS)
        : await ImagePicker.launchImageLibraryAsync(PICK_OPTS);
      if (!res.canceled) {
        const asset = res.assets?.[0] || res;
        Haptics.light();
        // TODO: parent's onUploadPhoto(asset) performs the real upload.
        onPick?.(asset);
      }
    } catch {
      /* picker failure is non-fatal — the field stays optional */
    }
  }

  const a11yLabel = uploading
    ? t('onb.a11y.avatarUploading', { percent: Math.round((progress || 0) * 100) })
    : uri ? t('onb.a11y.avatarSet') : t('onb.a11y.avatarEmpty');

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => { Haptics.selection(); setSheet(true); }}
        disabled={uploading}
        style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityState={{ busy: uploading }}
      >
        {uri ? (
          <Image source={{ uri }} style={styles.img} resizeMode="cover" />
        ) : (
          <View style={styles.placeholder}>
            <UserRound size={s(40)} color={theme.textTertiary} strokeWidth={1.75} />
          </View>
        )}

        {/* Progress ring (only while uploading) */}
        {uploading ? (
          <>
            <View style={[styles.ringOverlay, { borderRadius: size / 2 }]}>
              <Text style={styles.percent}>{Math.round((progress || 0) * 100)}%</Text>
            </View>
            <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
              <Circle cx={cx} cy={cx} r={r} stroke={theme.border} strokeWidth={stroke} fill="none" />
              <AnimatedCircle
                cx={cx} cy={cx} r={r}
                stroke={theme.accent} strokeWidth={stroke} fill="none"
                strokeLinecap="round"
                strokeDasharray={circ}
                animatedProps={ringProps}
                // start the ring at 12 o'clock
                transform={`rotate(-90 ${cx} ${cx})`}
              />
            </Svg>
          </>
        ) : (
          // Camera badge — clear affordance that this is editable.
          <View style={[styles.badge, error && styles.badgeError]}>
            {uri ? <Camera size={s(15)} color={theme.onAccent} strokeWidth={2.25} />
                 : <ImagePlus size={s(15)} color={theme.onAccent} strokeWidth={2.25} />}
          </View>
        )}
      </Pressable>

      {/* Caption — pairs state with text (never colour-only) */}
      {uploading ? (
        <Text style={styles.caption} accessibilityLiveRegion="polite">{t('onb.photoUploading')}</Text>
      ) : error ? (
        <Pressable onPress={() => setSheet(true)} accessibilityRole="button">
          <Text style={[styles.caption, styles.captionError]} accessibilityLiveRegion="assertive">
            {t('onb.photoFailed')}
          </Text>
        </Pressable>
      ) : uri ? (
        <View style={styles.actionsRow}>
          <Pressable onPress={() => setSheet(true)} style={styles.linkBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('onb.changePhoto')}>
            <Text style={styles.link}>{t('onb.changePhoto')}</Text>
          </Pressable>
          <Text style={styles.dot}>·</Text>
          <Pressable onPress={() => { Haptics.light(); onRemove?.(); }} style={styles.linkBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('onb.a11y.removePhoto')}>
            <Text style={[styles.link, styles.removeLink]}>{t('onb.removePhoto')}</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.caption}>
          {t('onb.addPhoto')} · <Text style={styles.optional}>{t('onb.optional')}</Text>
        </Text>
      )}

      {/* ── Source sheet ── */}
      <Modal visible={sheet} transparent animationType="fade" onRequestClose={() => setSheet(false)}>
        <Pressable style={styles.overlay} onPress={() => setSheet(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation?.()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{t('onb.photoSheetTitle')}</Text>
              <Pressable onPress={() => setSheet(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('onb.back')}>
                <X size={s(22)} color={theme.textSecondary} />
              </Pressable>
            </View>
            <SheetRow icon={Camera} label={t('onb.takePhoto')} onPress={() => pickFrom('camera')} theme={theme} styles={styles} hide={Platform.OS === 'web'} />
            <SheetRow icon={Images} label={t('onb.chooseGallery')} onPress={() => pickFrom('library')} theme={theme} styles={styles} />
            {uri ? (
              <SheetRow icon={Trash2} label={t('onb.removePhoto')} destructive onPress={() => { setSheet(false); Haptics.light(); onRemove?.(); }} theme={theme} styles={styles} />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function SheetRow({ icon: Icon, label, onPress, destructive, theme, styles, hide }) {
  if (hide) return null;
  return (
    <Pressable style={styles.sheetRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Icon size={s(20)} color={destructive ? theme.error : theme.primary} strokeWidth={2.25} />
      <Text style={[styles.sheetRowText, destructive && { color: theme.error }]}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    wrap: { alignItems: 'center', gap: vs(t.space.md) },
    avatar: {
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: t.avatarPlaceholderBg,
      borderWidth: 2, borderColor: t.avatarPlaceholderBorder,
      borderStyle: 'dashed', overflow: 'hidden',
    },
    img: { width: '100%', height: '100%' },
    placeholder: { alignItems: 'center', justifyContent: 'center' },
    badge: {
      position: 'absolute', right: -s(2), bottom: -s(2),
      width: s(34), height: s(34), borderRadius: s(17),
      backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center',
      borderWidth: 3, borderColor: t.surface,
    },
    badgeError: { backgroundColor: t.error },
    ringOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.35)',
    },
    percent: { ...t.text.bodyStrong, color: '#FFFFFF' },

    caption: { ...t.text.helper, color: t.textSecondary, textAlign: 'center' },
    captionError: { color: t.error },
    optional: { color: t.textTertiary },
    actionsRow: { flexDirection: 'row', alignItems: 'center', gap: s(t.space.sm) },
    linkBtn: { minHeight: 36, justifyContent: 'center' },
    link: { ...t.text.label, color: t.primary },
    removeLink: { color: t.error },
    dot: { color: t.textTertiary },

    overlay: { flex: 1, backgroundColor: t.overlay, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: t.radius.xxl, borderTopRightRadius: t.radius.xxl,
      paddingHorizontal: s(t.space.lg), paddingTop: vs(t.space.base), paddingBottom: vs(t.space.xxl),
    },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: vs(t.space.sm) },
    sheetTitle: { ...t.text.title, color: t.textPrimary },
    sheetRow: {
      flexDirection: 'row', alignItems: 'center', gap: s(t.space.md),
      minHeight: t.tap, paddingVertical: vs(t.space.md),
    },
    sheetRowText: { ...t.text.body, color: t.textPrimary },
  });
}

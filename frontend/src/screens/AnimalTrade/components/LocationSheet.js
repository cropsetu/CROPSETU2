/**
 * "Where are you looking?" — the location control for the marketplace.
 *
 * Two problems this fixes. First, the distance chips were simply DISABLED when
 * location permission was denied, so a farmer who said no once (or whose phone
 * has no fix indoors) had no way to search near home at all. Second, the app
 * asked for GPS at launch, before the user had any idea why — the worst moment
 * to ask, and the reason so many denials happen in the first place.
 *
 * So: permission is requested HERE, at the moment distance actually matters,
 * with a plain-language explanation of what it is for. Saying no is a normal
 * path, not a dead end — type a village, taluka, district or PIN instead, and
 * that choice is remembered.
 */
import { useState, useEffect, memo } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, TextInput,
  TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@cropsetu/shared/constants/colors';

const GREEN = COLORS.primary;

/** A 6-digit Indian PIN. Anything else is treated as a place name. */
const PIN_RE = /^\d{6}$/;

/**
 * @param {object}   p
 * @param {boolean}  p.visible
 * @param {'granted'|'denied'|'loading'} p.gpsStatus
 * @param {object?}  p.manualLocation  { label } the user previously typed
 * @param {Function} p.onUseGps        async () => coords|null — asks for permission
 * @param {Function} p.onManual        (loc|null) => void
 * @param {Function} p.onClose
 * @param {Function} p.t
 */
function LocationSheet({ visible, gpsStatus, manualLocation, onUseGps, onManual, onClose, t }) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(manualLocation?.label || '');
  const [asking, setAsking] = useState(false);
  const [denied, setDenied] = useState(gpsStatus === 'denied');

  useEffect(() => {
    if (visible) {
      setText(manualLocation?.label || '');
      setDenied(gpsStatus === 'denied');
    }
  }, [visible, manualLocation, gpsStatus]);

  const useGps = async () => {
    setAsking(true);
    try {
      const coords = await onUseGps();
      if (coords) onClose();
      else setDenied(true);
    } finally {
      setAsking(false);
    }
  };

  const applyManual = () => {
    const label = text.trim();
    if (!label) { onManual(null); onClose(); return; }
    onManual(PIN_RE.test(label) ? { label, pincode: label } : { label });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={S.backdrop}>
        <Pressable style={S.backdropTap} onPress={onClose} accessibilityLabel={t('common.close', 'Close')} />
        <View style={[S.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={S.grabber} />
          <ScrollView contentContainerStyle={S.body} keyboardShouldPersistTaps="handled">
            <Text style={S.title}>{t('animal.locationTitle', 'Where are you looking?')}</Text>

            {/* Farmer-friendly reason, shown BEFORE the OS prompt. */}
            <View style={S.whyCard}>
              <Ionicons name="information-circle" size={18} color={GREEN} />
              <Text style={S.whyTxt}>
                {t(
                  'animal.locationWhy',
                  'We use your location only to show animals near you and how far away each one is. Your exact location is never shown to sellers.',
                )}
              </Text>
            </View>

            <TouchableOpacity
              style={S.gpsBtn}
              onPress={useGps}
              disabled={asking}
              accessibilityRole="button"
              accessibilityLabel={t('animal.useMyLocation', 'Use my current location')}
            >
              {asking
                ? <ActivityIndicator color={COLORS.white} />
                : <Ionicons name="locate" size={20} color={COLORS.white} />}
              <Text style={S.gpsTxt}>{t('animal.useMyLocation', 'Use my current location')}</Text>
            </TouchableOpacity>

            {denied ? (
              <View style={S.deniedCard}>
                <Ionicons name="alert-circle-outline" size={16} color={COLORS.warning} />
                <Text style={S.deniedTxt}>
                  {t(
                    'animal.locationDeniedHelp',
                    'Location is switched off for KrushiSarva. You can turn it on in phone Settings, or just type your place below.',
                  )}
                </Text>
              </View>
            ) : null}

            <View style={S.orRow}>
              <View style={S.orLine} />
              <Text style={S.orTxt}>{t('animal.or', 'or')}</Text>
              <View style={S.orLine} />
            </View>

            <Text style={S.label}>{t('animal.typePlace', 'Type your village, taluka, district or PIN code')}</Text>
            <TextInput
              style={S.input}
              value={text}
              onChangeText={setText}
              placeholder={t('animal.placePlaceholder', 'e.g. Baramati, Pune or 413102')}
              placeholderTextColor={COLORS.textLight}
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={applyManual}
              accessibilityLabel={t('animal.typePlace', 'Type your village, taluka, district or PIN code')}
            />

            <TouchableOpacity style={S.applyBtn} onPress={applyManual} accessibilityRole="button">
              <Text style={S.applyTxt}>{t('animal.setLocation', 'Set location')}</Text>
            </TouchableOpacity>

            {manualLocation ? (
              <TouchableOpacity
                style={S.clearBtn}
                onPress={() => { onManual(null); setText(''); onClose(); }}
                accessibilityRole="button"
              >
                <Text style={S.clearTxt}>{t('animal.clearLocation', 'Clear saved location')}</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  backdropTap: { flex: 1 },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '88%', paddingTop: 8,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, marginBottom: 12 },
  body:    { paddingHorizontal: 20, paddingBottom: 8 },

  title: { fontSize: 19, fontWeight: '800', color: COLORS.textDark, marginBottom: 14, fontFamily: 'Inter_800ExtraBold' },

  whyCard: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: COLORS.greenBreeze || (GREEN + '12'), borderRadius: 12, padding: 12, marginBottom: 16,
  },
  whyTxt: { flex: 1, fontSize: 13.5, color: COLORS.textMedium, lineHeight: 20 },

  gpsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: GREEN, borderRadius: 14, minHeight: 52,
  },
  gpsTxt: { color: COLORS.white, fontSize: 15.5, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },

  deniedCard: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: COLORS.yellowWarm, borderRadius: 12, padding: 12, marginTop: 12,
    borderWidth: 1, borderColor: COLORS.warning + '55',
  },
  deniedTxt: { flex: 1, fontSize: 13, color: COLORS.textMedium, lineHeight: 19 },

  orRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 18 },
  orLine: { flex: 1, height: 1, backgroundColor: COLORS.divider },
  orTxt:  { fontSize: 13, color: COLORS.textLight, fontWeight: '600' },

  label: { fontSize: 14.5, fontWeight: '700', color: COLORS.textDark, marginBottom: 8 },
  input: {
    backgroundColor: COLORS.inputBg, borderRadius: 12,
    borderWidth: 1.5, borderColor: COLORS.border,
    paddingHorizontal: 14, minHeight: 50, fontSize: 15, color: COLORS.textDark,
  },

  applyBtn: {
    marginTop: 14, backgroundColor: GREEN, borderRadius: 14,
    minHeight: 52, alignItems: 'center', justifyContent: 'center',
  },
  applyTxt: { color: COLORS.white, fontSize: 16, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },

  clearBtn: { marginTop: 12, alignItems: 'center', paddingVertical: 12 },
  clearTxt: { fontSize: 14, fontWeight: '700', color: COLORS.error },
});

export default memo(LocationSheet);

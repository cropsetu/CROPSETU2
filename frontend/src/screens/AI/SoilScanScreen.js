/**
 * SoilScanScreen — photograph a Soil Health Card; AI extracts the 12 values.
 *
 * Reuses the chat screen's camera/gallery + compressImage pattern. Extraction
 * is advisory only: on success we hand the values to SoilForm as editable
 * pre-fills (never auto-saved) so the farmer verifies before storing.
 */
import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator,
  StatusBar, Alert, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ScanLine, Camera, ImageIcon, Sparkles, Sun, CheckCircle2, RotateCcw } from 'lucide-react-native';
import { useLanguage } from '../../context/LanguageContext';
import { scanSoilCard } from '../../services/aiApi';
import { compressImage } from '../../utils/mediaCompressor';
import {
  BG, BG_GRADIENT, P_LIGHT, ACCENT, DANGER, TEXT, TEXT2, MUTED, SURFACE, BORDER,
  INTER_REG, INTER_SEMI, INTER_BOLD, INTER_EXTRA, CosmicHeader, soilHumanError,
} from './components/soilShared';

export default function SoilScanScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  const [preview, setPreview] = useState(null);   // { uri, base64 }
  const [reading, setReading] = useState(false);
  const [error, setError] = useState(null);

  const runOcr = useCallback(async (base64) => {
    setReading(true); setError(null);
    try {
      const result = await scanSoilCard(base64, 'image/jpeg');
      const fields = result?.fields || {};
      const found = result?.fieldsFound ?? Object.values(fields).filter(v => v != null).length;
      if (!found) {
        setError(t('soilHub.scan.noneRead', 'Could not read any values. Try a clearer, flat photo — or enter them manually.'));
        return;
      }
      navigation.replace('SoilForm', {
        prefill: fields,
        inputMethod: 'ocr',
        notes: result?.notes || '',
      });
    } catch (err) {
      setError(soilHumanError(err, t));
    } finally {
      setReading(false);
    }
  }, [navigation, t]);

  const handleAsset = useCallback(async (asset) => {
    if (!asset?.uri) return;
    try {
      const c = await compressImage(asset.uri, { needBase64: true });
      if (!c?.base64) {
        Alert.alert(t('soilHub.scan.photo', 'Photo'), t('soilHub.scan.cantRead', 'Could not read that image. Please try another.'));
        return;
      }
      setPreview({ uri: c.uri || asset.uri, base64: c.base64 });
      setError(null);
      runOcr(c.base64);
    } catch {
      Alert.alert(t('soilHub.scan.photo', 'Photo'), t('soilHub.scan.cantProcess', 'Could not process that image. Please try another.'));
    }
  }, [runOcr, t]);

  const pickFromCamera = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('soilHub.scan.cameraPerm', 'Camera permission'), t('soilHub.scan.cameraPermBody', 'Please allow camera access in Settings to scan your card.'));
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.85, allowsEditing: false });
    if (!res.canceled && res.assets?.[0]) handleAsset(res.assets[0]);
  }, [handleAsset, t]);

  const pickFromGallery = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('soilHub.scan.photoPerm', 'Photos permission'), t('soilHub.scan.photoPermBody', 'Please allow photo access in Settings to choose a card photo.'));
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.85 });
    if (!res.canceled && res.assets?.[0]) handleAsset(res.assets[0]);
  }, [handleAsset, t]);

  return (
    <View style={S.root}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <LinearGradient colors={BG_GRADIENT} style={StyleSheet.absoluteFill} />

      <CosmicHeader
        title={t('soilHub.scan.title', 'Scan card')}
        subtitle={t('soilHub.scan.subtitle', 'AI reads your Soil Health Card')}
        Icon={ScanLine}
        onBack={() => navigation.goBack()}
        insetTop={insets.top}
      />

      <ScrollView contentContainerStyle={[S.scroll, { paddingBottom: insets.bottom + 36 }]} showsVerticalScrollIndicator={false}>
        {/* Preview / dropzone */}
        <View style={S.frame}>
          {preview ? (
            <>
              <Image source={{ uri: preview.uri }} style={S.previewImg} resizeMode="cover" />
              {reading && (
                <View style={S.readingOverlay}>
                  <ActivityIndicator color={P_LIGHT} size="large" />
                  <Text style={S.readingTxt}>{t('soilHub.scan.reading', 'Reading your card…')}</Text>
                </View>
              )}
            </>
          ) : (
            <View style={S.placeholder}>
              <View style={S.placeholderIcon}>
                <ScanLine size={34} color={P_LIGHT} strokeWidth={1.8} />
              </View>
              <Text style={S.placeholderTxt}>{t('soilHub.scan.prompt', 'Take a photo of your Soil Health Card')}</Text>
            </View>
          )}
        </View>

        {error ? <Text style={S.errorTxt}>{error}</Text> : null}

        {/* Actions */}
        {!reading && (
          <View style={S.actions}>
            <TouchableOpacity style={[S.actionBtn, S.actionPrimary]} activeOpacity={0.9} onPress={pickFromCamera}>
              <Camera size={18} color={BG} strokeWidth={2.3} />
              <Text style={S.actionPrimaryTxt}>{preview ? t('soilHub.scan.retake', 'Retake') : t('soilHub.scan.takePhoto', 'Take photo')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[S.actionBtn, S.actionGhost]} activeOpacity={0.9} onPress={pickFromGallery}>
              <ImageIcon size={18} color={TEXT} strokeWidth={2.3} />
              <Text style={S.actionGhostTxt}>{t('soilHub.scan.gallery', 'Gallery')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Retry OCR on the same photo */}
        {preview && error && !reading && (
          <TouchableOpacity style={S.retryRow} activeOpacity={0.85} onPress={() => runOcr(preview.base64)}>
            <RotateCcw size={15} color={ACCENT} />
            <Text style={S.retryTxt}>{t('soilHub.scan.retry', 'Try reading again')}</Text>
          </TouchableOpacity>
        )}

        {/* Manual fallback */}
        <TouchableOpacity style={S.manualRow} activeOpacity={0.85} onPress={() => navigation.replace('SoilForm')}>
          <Text style={S.manualTxt}>{t('soilHub.scan.manual', 'Or enter values manually')}</Text>
        </TouchableOpacity>

        {/* Tips */}
        <View style={S.tips}>
          <Text style={S.tipsTitle}>{t('soilHub.scan.tipsTitle', 'For best results')}</Text>
          <Tip Icon={Sun} text={t('soilHub.scan.tip1', 'Use good light, avoid shadows and glare')} />
          <Tip Icon={CheckCircle2} text={t('soilHub.scan.tip2', 'Lay the card flat and fill the frame')} />
          <Tip Icon={Sparkles} text={t('soilHub.scan.tip3', 'Always check the values before saving')} />
        </View>
      </ScrollView>
    </View>
  );
}

function Tip({ Icon, text }) {
  return (
    <View style={S.tipRow}>
      <Icon size={15} color={MUTED} strokeWidth={2.1} />
      <Text style={S.tipTxt}>{text}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 20, paddingTop: 18, gap: 16 },

  frame: {
    height: 280, borderRadius: 22, overflow: 'hidden',
    backgroundColor: SURFACE, borderWidth: 1.5, borderColor: BORDER,
    borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center',
  },
  previewImg: { width: '100%', height: '100%' },
  readingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,13,8,0.78)', justifyContent: 'center', alignItems: 'center', gap: 12 },
  readingTxt: { fontSize: 14, color: TEXT, fontWeight: '700', fontFamily: INTER_BOLD },
  placeholder: { alignItems: 'center', gap: 14, paddingHorizontal: 30 },
  placeholderIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: 'rgba(74,222,128,0.12)', justifyContent: 'center', alignItems: 'center' },
  placeholderTxt: { fontSize: 14, color: TEXT2, textAlign: 'center', lineHeight: 20, fontFamily: INTER_SEMI },

  errorTxt: { fontSize: 13, color: DANGER, textAlign: 'center', fontFamily: INTER_SEMI },

  actions: { flexDirection: 'row', gap: 12 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 14 },
  actionPrimary: { backgroundColor: P_LIGHT },
  actionPrimaryTxt: { fontSize: 14.5, fontWeight: '900', color: BG, fontFamily: INTER_EXTRA },
  actionGhost: { backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
  actionGhostTxt: { fontSize: 14.5, fontWeight: '800', color: TEXT, fontFamily: INTER_EXTRA },

  retryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  retryTxt: { fontSize: 13.5, color: ACCENT, fontWeight: '700', fontFamily: INTER_BOLD },

  manualRow: { alignItems: 'center', paddingVertical: 4 },
  manualTxt: { fontSize: 13.5, color: MUTED, textDecorationLine: 'underline', fontFamily: INTER_SEMI },

  tips: { backgroundColor: SURFACE, borderRadius: 16, padding: 15, borderWidth: 1, borderColor: BORDER, gap: 10 },
  tipsTitle: { fontSize: 11, fontWeight: '900', color: TEXT2, letterSpacing: 1, fontFamily: INTER_BOLD },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  tipTxt: { flex: 1, fontSize: 12.5, color: TEXT2, lineHeight: 17, fontFamily: INTER_REG },
});

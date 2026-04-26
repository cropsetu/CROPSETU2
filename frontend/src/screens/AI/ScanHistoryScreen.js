/**
 * ScanHistoryScreen — paginated list of the farmer's past AI crop diagnoses.
 *
 * Backend: GET /api/v1/crop-disease/reports
 * Tap a row → navigate back to DiagnosisResult populated from the saved row.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SHADOWS, RADIUS } from '../../constants/colors';
import { useLanguage } from '../../context/LanguageContext';
import api, { safeErrorMessage } from '../../services/api';

const RISK_COLOR = {
  CRITICAL: COLORS.error,
  HIGH:     COLORS.error,
  MODERATE: COLORS.amberDark,
  MEDIUM:   COLORS.amberDark,
  LOW:      COLORS.primary,
  UNKNOWN:  COLORS.textMedium,
};

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Map a saved CropDiseaseReport row → the shape DiagnosisResultScreen expects
// for `route.params.diagnosis`. We spread `fullReport` so any top-level fields
// the AI returned (treatment, prevention, etc.) flow through unchanged.
function reportToDiagnosis(row) {
  const full = row.fullReport || {};
  return {
    ...full,
    disease:    full.disease || full.primary_disease?.name || row.primaryDisease,
    confidence: full.confidence ?? Math.round((row.confidenceScore || 0) * 100),
    severity:   full.severity || (row.riskLevel || '').toLowerCase(),
    crop:       full.crop || row.cropType,
    reportId:   row.id,
    _fullReport: full,
  };
}

export default function ScanHistoryScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefresh] = useState(false);
  const [error, setError]       = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get('/crop-disease/reports?limit=50');
      setItems(res.data.data || []);
    } catch (e) {
      setError(safeErrorMessage(e, t('scanHistory.loadFailed', 'Could not load past scans.')));
    }
  }, [t]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefresh(true);
    await load();
    setRefresh(false);
  };

  const openReport = async (item) => {
    try {
      // Pull the full report (the list endpoint omits fullReport to keep payload small)
      const res = await api.get(`/crop-disease/reports/${item.id}`);
      const diagnosis = reportToDiagnosis(res.data.data);
      navigation.navigate('DiagnosisResult', { diagnosis, farmContext: {}, imageUri: null });
    } catch (e) {
      setError(safeErrorMessage(e, t('scanHistory.openFailed', 'Could not open report.')));
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={S.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  return (
    <View style={S.safe}>
      {/* Header */}
      <View style={[S.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.white} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>{t('scanHistory.title', 'Past Crop Scans')}</Text>
          <Text style={S.headerSub}>
            {t('scanHistory.subtitle', { count: items.length, defaultValue: '{{count}} reports' })}
          </Text>
        </View>
      </View>

      {error ? (
        <View style={S.empty}>
          <Ionicons name="cloud-offline-outline" size={48} color={COLORS.gray175} />
          <Text style={S.emptyTitle}>{error}</Text>
          <TouchableOpacity style={S.retryBtn} onPress={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
            <Text style={S.retryTxt}>{t('retry', 'Retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View style={S.empty}>
          <Ionicons name="leaf-outline" size={48} color={COLORS.gray175} />
          <Text style={S.emptyTitle}>{t('scanHistory.emptyTitle', 'No past scans')}</Text>
          <Text style={S.emptyText}>{t('scanHistory.emptyText', 'Your AI crop diagnoses will appear here.')}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          renderItem={({ item }) => {
            const riskCol = RISK_COLOR[item.riskLevel] || RISK_COLOR.UNKNOWN;
            return (
              <TouchableOpacity
                style={S.card}
                onPress={() => openReport(item)}
                activeOpacity={0.85}
              >
                <View style={[S.riskBar, { backgroundColor: riskCol }]} />
                <View style={{ flex: 1, padding: 12 }}>
                  <View style={S.rowTop}>
                    <Text style={S.disease} numberOfLines={1}>{item.primaryDisease || t('scanHistory.unknown', 'Unknown')}</Text>
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textLight} />
                  </View>
                  <Text style={S.crop} numberOfLines={1}>
                    {item.cropType}{item.growthStage ? ` · ${item.growthStage}` : ''}{item.variety ? ` · ${item.variety}` : ''}
                  </Text>
                  <View style={S.rowFoot}>
                    <View style={[S.riskPill, { backgroundColor: riskCol + '15' }]}>
                      <Text style={[S.riskTxt, { color: riskCol }]}>
                        {item.riskLevel || 'UNKNOWN'} · {Math.round((item.confidenceScore || 0) * 100)}%
                      </Text>
                    </View>
                    <Text style={S.time}>{formatDate(item.createdAt)}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const S = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingBottom: 14,
    backgroundColor: COLORS.primary,
  },
  backBtn:     { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white },
  headerSub:   { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 1 },

  card: {
    flexDirection: 'row', backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    overflow: 'hidden', marginBottom: 10, ...SHADOWS.small,
  },
  riskBar:    { width: 4 },
  rowTop:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  disease:    { flex: 1, fontSize: 15, fontWeight: '800', color: COLORS.textDark, marginRight: 8 },
  crop:       { fontSize: 12, color: COLORS.textMedium, marginBottom: 8 },
  rowFoot:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  riskPill:   { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  riskTxt:    { fontSize: 10, fontWeight: '800' },
  time:       { fontSize: 11, color: COLORS.textLight },

  empty:      { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textDark, textAlign: 'center' },
  emptyText:  { fontSize: 13, color: COLORS.textLight, textAlign: 'center', lineHeight: 20 },
  retryBtn:   { marginTop: 8, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.primary + '15' },
  retryTxt:   { color: COLORS.primary, fontWeight: '700' },
});

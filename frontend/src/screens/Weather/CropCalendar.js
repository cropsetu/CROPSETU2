import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, FlatList, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOWS } from '../../constants/colors';
import api from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';

function CropCard({ crop, onPress, t }) {
  return (
    <TouchableOpacity style={styles.cropCard} onPress={() => onPress(crop)} activeOpacity={0.88}>
      <View style={styles.cropCardInner}>
        <Text style={styles.cropIcon}>{crop.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cropName}>{crop.name}</Text>
          <Text style={styles.cropNameHi}>{crop.nameHi}</Text>
          <View style={styles.cropMeta}>
            <View style={styles.metaChip}>
              <Ionicons name="calendar" size={12} color={COLORS.primary} />
              <Text style={styles.metaText}>{crop.season}</Text>
            </View>
          </View>
        </View>
        <View style={styles.cropArrow}>
          <Ionicons name="chevron-forward" size={22} color={COLORS.primary} />
        </View>
      </View>
      <View style={styles.cropInfo}>
        <View style={styles.cropInfoItem}>
          <Text style={styles.cropInfoLabel}>{t('cropCalendar.sowing')}</Text>
          <Text style={styles.cropInfoValue}>{crop.sowingMonth}</Text>
        </View>
        <View style={styles.cropInfoDivider} />
        <View style={styles.cropInfoItem}>
          <Text style={styles.cropInfoLabel}>{t('cropCalendar.duration')}</Text>
          <Text style={styles.cropInfoValue}>{crop.duration}</Text>
        </View>
        <View style={styles.cropInfoDivider} />
        <View style={styles.cropInfoItem}>
          <Text style={styles.cropInfoLabel}>{t('cropCalendar.harvest')}</Text>
          <Text style={styles.cropInfoValue}>{crop.harvestMonth}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const CROP_FALLBACK = [
  { id: 1, name: 'Tomato', nameHi: 'टमाटर', icon: '🍅', season: 'Kharif / Rabi', sowingMonth: 'Jun–Jul / Oct–Nov', harvestMonth: 'Sep–Oct / Jan–Feb', duration: '90–120 days' },
  { id: 2, name: 'Wheat',  nameHi: 'गेहूं',  icon: '🌾', season: 'Rabi',          sowingMonth: 'Oct–Nov',           harvestMonth: 'Mar–Apr',           duration: '120–150 days' },
  { id: 3, name: 'Rice',   nameHi: 'धान',    icon: '🌾', season: 'Kharif',        sowingMonth: 'Jun–Jul',           harvestMonth: 'Oct–Nov',           duration: '100–150 days' },
  { id: 4, name: 'Cotton', nameHi: 'कपास',   icon: '🪴', season: 'Kharif',        sowingMonth: 'Apr–Jun',           harvestMonth: 'Oct–Jan',           duration: '160–200 days' },
  { id: 5, name: 'Onion',  nameHi: 'प्याज',  icon: '🧅', season: 'Rabi',          sowingMonth: 'Oct–Dec',           harvestMonth: 'Mar–May',           duration: '90–120 days' },
  { id: 6, name: 'Soybean',nameHi: 'सोयाबीन',icon: '🫘', season: 'Kharif',        sowingMonth: 'Jun–Jul',           harvestMonth: 'Oct–Nov',           duration: '90–120 days' },
  { id: 7, name: 'Potato', nameHi: 'आलू',    icon: '🥔', season: 'Rabi',          sowingMonth: 'Oct–Nov',           harvestMonth: 'Jan–Mar',           duration: '90–120 days' },
  { id: 8, name: 'Sugarcane',nameHi:'गन्ना', icon: '🎍', season: 'Spring',        sowingMonth: 'Feb–Mar',           harvestMonth: 'Dec–Mar',           duration: '12–18 months' },
  { id: 9, name: 'Maize',  nameHi: 'मक्का',  icon: '🌽', season: 'Kharif',        sowingMonth: 'Jun–Jul',           harvestMonth: 'Sep–Oct',           duration: '80–100 days' },
  { id:10, name: 'Groundnut',nameHi:'मूंगफली',icon:'🥜', season: 'Kharif',        sowingMonth: 'Jun–Jul',           harvestMonth: 'Oct–Nov',           duration: '90–120 days' },
];

export default function CropCalendar({ navigation }) {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [crops,       setCrops]       = useState([]);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    api.get('/weather/crops')
      .then(({ data }) => setCrops(data.data?.length ? data.data : CROP_FALLBACK))
      .catch(() => setCrops(CROP_FALLBACK))
      .finally(() => setLoading(false));
  }, []);

  const q = searchQuery.toLowerCase();
  const filteredCrops = crops.filter(c =>
    !q ||
    c.name?.toLowerCase().includes(q) ||
    (c.nameHi || '').includes(searchQuery)
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        windowSize={5}
        maxToRenderPerBatch={10}
        removeClippedSubviews
        data={filteredCrops}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {/* Banner */}
            <View style={styles.banner}>
              <Ionicons name="leaf" size={40} color={COLORS.primaryPale} />
              <Text style={styles.bannerTitle}>{t('cropCalendar.bannerTitle')}</Text>
              <Text style={styles.bannerSub}>{t('cropCalendar.bannerSub')}</Text>
            </View>

            {/* Seasonal Guide */}
            <View style={styles.seasonSection}>
              <Text style={styles.sectionTitle}>{t('cropCalendar.currentSeasonGuide')}</Text>
              <View style={styles.seasonCards}>
                <View style={[styles.seasonCard, { backgroundColor: COLORS.greenPale }]}>
                  <Text style={styles.seasonEmoji}>🌧️</Text>
                  <Text style={styles.seasonName}>{t('cropCalendar.kharif')}</Text>
                  <Text style={styles.seasonMonths}>{t('cropCalendar.kharifMonths')}</Text>
                  <Text style={styles.seasonCrops}>{t('cropCalendar.kharifCrops')}</Text>
                </View>
                <View style={[styles.seasonCard, { backgroundColor: COLORS.yellowWarm }]}>
                  <Text style={styles.seasonEmoji}>☀️</Text>
                  <Text style={styles.seasonName}>{t('cropCalendar.rabi')}</Text>
                  <Text style={styles.seasonMonths}>{t('cropCalendar.rabiMonths')}</Text>
                  <Text style={styles.seasonCrops}>{t('cropCalendar.rabiCrops')}</Text>
                </View>
                <View style={[styles.seasonCard, { backgroundColor: COLORS.lightSky }]}>
                  <Text style={styles.seasonEmoji}>🌸</Text>
                  <Text style={styles.seasonName}>{t('cropCalendar.zaid')}</Text>
                  <Text style={styles.seasonMonths}>{t('cropCalendar.zaidMonths')}</Text>
                  <Text style={styles.seasonCrops}>{t('cropCalendar.zaidCrops')}</Text>
                </View>
              </View>
            </View>

            <Text style={styles.sectionTitle}>{t('cropCalendar.selectYourCrop')}</Text>
          </>
        }
        renderItem={({ item }) => (
          <CropCard crop={item} t={t} onPress={crop => navigation.navigate('CropDetail', { crop, cropName: crop.name })} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  listContent: { paddingBottom: 30 },

  banner: { padding: 28, alignItems: 'center', gap: 8 },
  bannerTitle: { fontSize: 26, fontWeight: '900', color: COLORS.textWhite },
  bannerSub: { fontSize: 14, color: COLORS.primaryPale, textAlign: 'center' },

  seasonSection: { padding: 16, paddingBottom: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: COLORS.textDark, marginBottom: 14, paddingHorizontal: 16 },
  seasonCards: { flexDirection: 'row', gap: 10 },
  seasonCard: { flex: 1, borderRadius: 14, padding: 12, alignItems: 'center', gap: 4 },
  seasonEmoji: { fontSize: 24 },
  seasonName: { fontSize: 14, fontWeight: '800', color: COLORS.textDark },
  seasonMonths: { fontSize: 11, color: COLORS.textLight },
  seasonCrops: { fontSize: 10, color: COLORS.textMedium, textAlign: 'center', lineHeight: 14 },

  cropCard: { backgroundColor: COLORS.surface, borderRadius: 18, marginHorizontal: 16, overflow: 'hidden', ...SHADOWS.small },
  cropCardInner: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  cropIcon: { fontSize: 40 },
  cropName: { fontSize: 19, fontWeight: '800', color: COLORS.textDark },
  cropNameHi: { fontSize: 14, color: COLORS.textMedium, fontWeight: '600', marginTop: 3 },
  cropMeta: { flexDirection: 'row', gap: 8, marginTop: 8 },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.primaryPale, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  metaText: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },
  cropArrow: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primaryPale, justifyContent: 'center', alignItems: 'center' },

  cropInfo: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: COLORS.divider },
  cropInfoItem: { flex: 1, padding: 12, alignItems: 'center' },
  cropInfoLabel: { fontSize: 11, color: COLORS.textLight, fontWeight: '500' },
  cropInfoValue: { fontSize: 12, color: COLORS.textDark, fontWeight: '700', marginTop: 3, textAlign: 'center' },
  cropInfoDivider: { width: 1, backgroundColor: COLORS.divider },
});

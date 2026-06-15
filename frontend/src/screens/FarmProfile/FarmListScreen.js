/**
 * FarmListScreen — all farms as compact white cards with soil-stripe accent.
 *
 * Each card shows nickname, location, size, soil, irrigation, crop count.
 * Long-press opens the Set Active / Edit / Delete menu.
 * Orange FAB bottom-right adds a new farm.
 */

import React, { useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import CosmicScreen from './ui/CosmicScreen';
import CosmicHeader from './ui/CosmicHeader';
import GlassCard from './ui/GlassCard';
import GlowButton from './ui/GlowButton';
import { CropIcon } from '../../components/CropIcons';
import { useMultiFarm } from '../../context/MultiFarmContext';
import { useLanguage } from '../../context/LanguageContext';
import { COSMIC, CR, CS, GLOW, GRADIENT } from './theme/cosmicTheme';
import { Haptics } from '../../utils/haptics';

const SOIL_COLORS = {
  BLACK_COTTON: '#4B3B32',
  RED:          '#C45A3C',
  ALLUVIAL:     '#D4A76A',
  SANDY:        '#E8D5A3',
  CLAY_LOAM:    '#8B7D6B',
  SANDY_LOAM:   '#B8935A',
  LATERITE:     '#CD7F32',
  UNKNOWN:      '#9E9E9E',
};

export default function FarmListScreen({ navigation }) {
  const { t } = useLanguage();
  const { farms, activeFarmId, switchActiveFarm, refresh, syncing, removeFarm } = useMultiFarm();

  const goAdd = () => navigation.navigate('FarmAddEdit');
  const goDetail = (farm) => navigation.navigate('FarmDetail', { farmId: farm.id });
  const goEdit = (farm) => navigation.navigate('FarmAddEdit', { farm });

  const handleLongPress = useCallback((farm) => {
    Haptics.medium?.();
    Alert.alert(farm.farmName || farm.farmAlias || t('farmProfile.farmNumberLabel', { number: farm.farmNumber }), '', [
      { text: t('farmProfile.setActive') || 'Set active', onPress: () => { Haptics.success?.(); switchActiveFarm(farm.id); } },
      { text: t('edit') || 'Edit', onPress: () => goEdit(farm) },
      { text: t('delete') || 'Delete', style: 'destructive', onPress: () => {
        Alert.alert(
          t('farmProfile.deleteTitle') || 'Delete farm?',
          t('farmProfile.deleteConfirm') || 'This cannot be undone.',
          [
            { text: t('cancel') || 'Cancel', style: 'cancel' },
            { text: t('delete') || 'Delete', style: 'destructive', onPress: () => removeFarm(farm.id) },
          ]
        );
      }},
      { text: t('cancel') || 'Cancel', style: 'cancel' },
    ]);
  }, [t, switchActiveFarm, removeFarm, navigation]);

  const renderFarm = ({ item: farm }) => {
    const isActive = farm.id === activeFarmId;
    const soilColor = SOIL_COLORS[farm.soilType] || SOIL_COLORS.UNKNOWN;
    const cropCount = farm._count?.cropCycles || 0;

    return (
      <Pressable
        onPress={() => goDetail(farm)}
        onLongPress={() => handleLongPress(farm)}
        style={({ pressed }) => [{ marginBottom: 8 }, pressed && { opacity: 0.88 }]}
      >
        <GlassCard variant={isActive ? 'bordered' : 'plain'} padding={0}>
          <View style={styles.row}>
            <View style={[styles.stripe, { backgroundColor: soilColor }]} />
            <View style={styles.body}>
              <View style={styles.topRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {farm.farmName || farm.farmAlias || t('farmProfile.farmNumberLabel', { number: farm.farmNumber })}
                </Text>
                {isActive && (
                  <View style={styles.activeBadge}>
                    <Ionicons name="star" size={9} color={COSMIC.INVERSE} />
                    <Text style={styles.activeText}>{t('farmProfile.active')}</Text>
                  </View>
                )}
              </View>

              {!!(farm.village || farm.taluka || farm.district) && (
                <View style={styles.locRow}>
                  <Ionicons name="location-outline" size={10} color={COSMIC.TEXT_3} />
                  <Text style={styles.loc} numberOfLines={1}>
                    {[farm.village, farm.taluka, farm.district].filter(Boolean).join(', ')}
                  </Text>
                </View>
              )}

              <View style={styles.tags}>
                {farm.landSizeAcres > 0 && <Tag label={`${farm.landSizeAcres} ac`} color={COSMIC.PRIMARY} />}
                {farm.soilType && <Tag label={(farm.soilType || '').replace(/_/g, ' ').toLowerCase()} color={soilColor} capitalize />}
                {farm.irrigationSystem && <Tag label={farm.irrigationSystem.toLowerCase()} color={COSMIC.INFO} capitalize />}
                {cropCount > 0 && <Tag label={`${cropCount} ${cropCount === 1 ? t('farmProfile.cropSingular') : t('farmProfile.cropPlural')}`} color={COSMIC.ACCENT} />}
              </View>
            </View>
            <View style={styles.chev}>
              <Ionicons name="chevron-forward" size={16} color={COSMIC.TEXT_3} />
            </View>
          </View>
        </GlassCard>
      </Pressable>
    );
  };

  return (
    <CosmicScreen edges={{ top: false, bottom: true }}>
      <CosmicHeader
        title={t('farmProfile.myFarms') || 'My farms'}
        subtitle={farms.length > 0 ? `${farms.length} ${farms.length === 1 ? t('farmProfile.farmSingular') : t('farmProfile.farmPlural')} · ${t('farmProfile.longPressToEdit')}` : undefined}
      />
      <FlatList
        data={farms}
        keyExtractor={(f) => f.id}
        renderItem={renderFarm}
        onRefresh={refresh}
        refreshing={syncing}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyBubble}>
              <CropIcon crop="Wheat" size={28} />
            </View>
            <Text style={styles.emptyTitle}>{t('farmProfile.noFarms')}</Text>
            <Text style={styles.emptyText}>{t('farmProfile.emptyHint')}</Text>
            <GlowButton label={t('farmProfile.addAFarm')} icon="add" variant="primary" onPress={goAdd} style={{ marginTop: 12, minWidth: 180 }} size="sm" />
          </View>
        }
      />
      <AddFab onPress={goAdd} />
    </CosmicScreen>
  );
}

function Tag({ label, color, capitalize }) {
  if (!label) return null;
  return (
    <View style={[styles.tag, { backgroundColor: color + '15', borderColor: color + '33' }]}>
      <Text style={[styles.tagText, { color, textTransform: capitalize ? 'capitalize' : 'none' }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function AddFab({ onPress }) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const handle = () => { Haptics.medium?.(); onPress && onPress(); };
  return (
    <Pressable
      onPress={handle}
      accessibilityLabel={t('farmProfile.addFarm')}
      style={({ pressed }) => [
        styles.fab,
        { bottom: 20 + insets.bottom },
        GLOW.gold,
        pressed && { transform: [{ scale: 0.96 }] },
      ]}
    >
      <LinearGradient
        colors={GRADIENT.accent}
        start={GRADIENT.start}
        end={GRADIENT.end}
        style={StyleSheet.absoluteFill}
      />
      <Ionicons name="add" size={26} color={COSMIC.INVERSE} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: CS.base,
    paddingBottom: 100,
    paddingTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 72,
  },
  stripe: {
    width: 4,
    borderTopLeftRadius: CR.lg,
    borderBottomLeftRadius: CR.lg,
  },
  body: {
    flex: 1,
    padding: 10,
    gap: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    flex: 1,
    fontSize: 15,
    color: COSMIC.TEXT,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: CR.pill,
    backgroundColor: COSMIC.PRIMARY,
  },
  activeText: {
    color: COSMIC.INVERSE,
    fontSize: 9,
    fontFamily: 'PlusJakartaSans_700Bold',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  locRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  loc: {
    fontSize: 11,
    color: COSMIC.TEXT_3,
    fontFamily: 'PlusJakartaSans_400Regular',
    flexShrink: 1,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: CR.pill,
    borderWidth: 0.5,
  },
  tagText: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  chev: {
    paddingRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Empty
  empty: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  emptyBubble: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COSMIC.PRIMARY_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 16,
    color: COSMIC.TEXT,
    fontFamily: 'PlusJakartaSans_700Bold',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: COSMIC.TEXT_2,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 280,
    fontFamily: 'PlusJakartaSans_400Regular',
  },

  // FAB
  fab: {
    position: 'absolute',
    right: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 20,
  },
});

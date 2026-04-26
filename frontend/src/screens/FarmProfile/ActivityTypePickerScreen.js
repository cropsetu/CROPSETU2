/**
 * ActivityTypePickerScreen — 12-tile grid to pick what kind of activity to log.
 *
 * Design:
 *   • 3-column grid of ActivityChip.Tile (color + icon per type)
 *   • Friendly intro bubble
 *
 * Route params:
 *   farmId?   — scope logs to this farm (optional)
 *   cycleId?  — scope to a specific cycle (sets cycleId on the log)
 *   plotId?   — scope to a specific plot (v2 backend)
 *
 * After the farmer picks a type, we push the corresponding typed logger.
 * Until the full suite lands, unimplemented types show a friendly
 * "Coming soon" sheet so the grid remains visually complete.
 */

import React from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import CosmicScreen from './ui/CosmicScreen';
import CosmicHeader from './ui/CosmicHeader';
import ActivityChip from './ui/ActivityChip';
import { useLanguage } from '../../context/LanguageContext';
import { useMultiFarm } from '../../context/MultiFarmContext';
import { COSMIC, CR, CS, CT, ACTIVITY_TYPES } from './theme/cosmicTheme';

// Pretty labels (stable even without i18n v2).
const TYPE_LABELS = {
  LAND_PREP:  'Land prep',
  SOWING:     'Sowing',
  IRRIGATION: 'Irrigation',
  FERTILIZER: 'Fertilizer',
  SPRAY:      'Spray',
  SCOUT:      'Scouting',
  WEEDING:    'Weeding',
  PRUNING:    'Pruning',
  HARVEST:    'Harvest',
  SALE:       'Sale',
  EXPENSE:    'Expense',
  INCOME:     'Income',
};

export default function ActivityTypePickerScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { activeFarm } = useMultiFarm();
  const { farmId, cycleId, plotId } = route.params || {};

  const contextSubtitle = activeFarm
    ? `${activeFarm.farmName || activeFarm.farmAlias || 'Farm'} · ${cycleId ? 'this cycle' : (farmId ? 'this farm' : 'all farms')}`
    : undefined;

  const pick = (type) => {
    if (type === 'IRRIGATION') {
      navigation.navigate('ActivityIrrigationLog', { farmId, cycleId, plotId });
      return;
    }
    // Type not shipped yet — route to CropCycleDetail inline modal if we have a cycle
    if (cycleId && ['FERTILIZER', 'SPRAY', 'HARVEST', 'SALE'].includes(type)) {
      navigation.navigate('CropCycleDetail', { cycleId, prefillActivity: type });
      return;
    }
    Alert.alert(
      `${TYPE_LABELS[type] || type} log`,
      'This activity type is landing in the next milestone. Until then, use the logs inside the crop-cycle detail screen.',
    );
  };

  return (
    <CosmicScreen edges={{ top: false, bottom: false }}>
      <CosmicHeader
        title={t('myFarm.v2.pickActivity') || 'What did you do?'}
        subtitle={contextSubtitle}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <View style={styles.introBubble}>
            <Ionicons name="hand-left-outline" size={18} color={COSMIC.PRIMARY} />
          </View>
          <Text style={styles.introTitle}>Pick what you did today</Text>
          <Text style={styles.introText}>
            Tap any activity — fields, photos and cost will be captured for that log.
          </Text>
        </View>

        <View style={styles.grid}>
          {ACTIVITY_TYPES.map((a) => (
            <View key={a.key} style={styles.gridCell}>
              <ActivityChip.Tile
                type={a.key}
                label={TYPE_LABELS[a.key] || a.key}
                onPress={() => pick(a.key)}
              />
            </View>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </CosmicScreen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: CS.base,
    paddingTop: CS.base,
    paddingBottom: 60,
  },
  intro: {
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 18,
  },
  introBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COSMIC.PRIMARY_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  introTitle: {
    fontSize: 16,
    color: COSMIC.TEXT,
    textAlign: 'center',
    fontFamily: 'Inter_700Bold',
  },
  introText: {
    fontSize: 12,
    color: COSMIC.TEXT_2,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 300,
    fontFamily: 'Inter_400Regular',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  gridCell: {
    flexBasis: '31.5%',
    flexGrow: 1,
    minWidth: 104,
  },
});

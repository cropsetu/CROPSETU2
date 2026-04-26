/**
 * FarmProfileBanner — Global visual farm-profile strip.
 *
 * Renders a horizontal row of image-backed chips showing the farmer's
 * active profile: primary crop (SVG icon + age), soil type (photo thumbnail),
 * irrigation method (photo thumbnail), location, and land size.
 *
 * Used in: AIAssistantHome, CropScanScreen, AIChatScreen, DailyPlanner, etc.
 *
 * Props:
 *   onEdit  — called when the pencil icon is tapped (navigate to Profile)
 *   compact — boolean, smaller text/icons for tight spaces (default false)
 *   style   — optional outer style override
 */

import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFarm } from '../context/FarmContext';
import CropIcon from './CropIcons';
import SoilIcon from './SoilIcons';
import IrrigationIcon from './IrrigationIcons';
import { COLORS } from '../constants/colors';

// ─── Short display labels ─────────────────────────────────────────────────────

const SOIL_SHORT = {
  black:    'Black Cotton',
  red:      'Red Laterite',
  alluvial: 'Alluvial',
  sandy:    'Sandy Loam',
  clay:     'Clay',
  laterite: 'Laterite',
};

const IRRIGATION_SHORT = {
  drip:      'Drip',
  sprinkler: 'Sprinkler',
  flood:     'Flood',
  rainfed:   'Rainfed',
  canal:     'Canal',
};

const GREEN   = COLORS.primary;
const GREEN6  = COLORS.primarySoft;
const GREEN20 = COLORS.borderGreen;

// ─── Single chip wrapper ──────────────────────────────────────────────────────

function Chip({ children, empty }) {
  return (
    <View style={[S.chip, empty && S.chipEmpty]}>
      {children}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FarmProfileBanner({ onEdit, compact = false, style }) {
  const { farmProfile, getAIContext } = useFarm();
  const aiCtx = getAIContext();

  const primaryCrop   = farmProfile.currentCrops?.[0] || null;
  const cropName      = primaryCrop?.name || '';
  const cropAge       = aiCtx.primaryCropAge;
  const soilKey       = farmProfile.soilType || '';
  const irrigationKey = farmProfile.irrigationType || '';
  const location      = farmProfile.location || {};
  const landSize      = farmProfile.landSize || '';

  const hasAnyData = cropName || soilKey || irrigationKey || location.district || location.state || landSize;

  const iconSize  = compact ? 28 : 34;
  const thumbSize = compact ? 24 : 28;
  const labelSize = compact ? 11 : 12;

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!hasAnyData) {
    return (
      <TouchableOpacity
        style={[S.wrapper, S.emptyWrapper, style]}
        onPress={onEdit}
        activeOpacity={0.75}
      >
        <Ionicons name="leaf-outline" size={15} color={GREEN} />
        <Text style={S.emptyText}>Set your farm profile for personalised AI</Text>
        <Ionicons name="chevron-forward" size={14} color={GREEN} />
      </TouchableOpacity>
    );
  }

  // ── Populated state ──────────────────────────────────────────────────────
  return (
    <View style={[S.wrapper, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={S.scrollContent}
      >

        {/* ── Crop chip ─────────────────────────────────────────────────── */}
        {cropName ? (
          <Chip>
            <View style={[S.iconWrap, { width: iconSize + 4, height: iconSize + 4 }]}>
              <CropIcon crop={cropName} size={iconSize} />
            </View>
            <Text style={[S.chipLabel, { fontSize: labelSize }]} numberOfLines={1}>
              {cropName}
            </Text>
            {cropAge != null && (
              <View style={S.ageBadge}>
                <Text style={S.ageBadgeTxt}>{cropAge}d</Text>
              </View>
            )}
          </Chip>
        ) : (
          <Chip empty>
            <Ionicons name="leaf-outline" size={15} color={COLORS.gray350} />
            <Text style={[S.chipLabel, S.chipLabelEmpty, { fontSize: labelSize }]}>No crop set</Text>
          </Chip>
        )}

        {/* ── Soil chip ─────────────────────────────────────────────────── */}
        {soilKey ? (
          <Chip>
            <View style={[S.thumbImg, { width: thumbSize, height: thumbSize, overflow: 'hidden', borderRadius: thumbSize / 2 }]}>
              <SoilIcon type={soilKey} size={thumbSize} />
            </View>
            <Text style={[S.chipLabel, { fontSize: labelSize }]} numberOfLines={1}>
              {SOIL_SHORT[soilKey] || soilKey}
            </Text>
          </Chip>
        ) : null}

        {/* ── Irrigation chip ───────────────────────────────────────────── */}
        {irrigationKey ? (
          <Chip>
            <View style={[S.thumbImg, { width: thumbSize, height: thumbSize, overflow: 'hidden', borderRadius: thumbSize / 2 }]}>
              <IrrigationIcon type={irrigationKey} size={thumbSize} />
            </View>
            <Text style={[S.chipLabel, { fontSize: labelSize }]} numberOfLines={1}>
              {IRRIGATION_SHORT[irrigationKey] || irrigationKey}
            </Text>
          </Chip>
        ) : null}

        {/* ── Location chip ─────────────────────────────────────────────── */}
        {(location.district || location.state) ? (
          <Chip>
            <Ionicons name="location-outline" size={13} color={COLORS.cta} />
            <Text style={[S.chipLabel, { fontSize: labelSize }]} numberOfLines={1}>
              {location.district || location.state}
            </Text>
          </Chip>
        ) : null}

        {/* ── Land size chip ────────────────────────────────────────────── */}
        {landSize ? (
          <Chip>
            <Ionicons name="resize-outline" size={13} color={COLORS.brownAlt} />
            <Text style={[S.chipLabel, { fontSize: labelSize }]} numberOfLines={1}>
              {landSize} acres
            </Text>
          </Chip>
        ) : null}

        {/* spacer so last chip clears the edit button */}
        <View style={{ width: 40 }} />
      </ScrollView>

      {/* ── Edit button — floats right, outside scroll ────────────────── */}
      {onEdit && (
        <TouchableOpacity style={S.editBtn} onPress={onEdit} activeOpacity={0.7}>
          <Ionicons name="pencil-outline" size={13} color={GREEN} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  wrapper: {
    backgroundColor: GREEN6,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: GREEN20,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    minHeight: 54,
  },

  emptyWrapper: {
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  emptyText: {
    flex: 1,
    fontSize: 12,
    color: GREEN,
    fontWeight: '600',
  },

  scrollContent: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
    flexDirection: 'row',
  },

  // ── Chip ──
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.white,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(26,92,42,0.12)',
    shadowColor: COLORS.black,
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  chipEmpty: {
    borderStyle: 'dashed',
    borderColor: COLORS.gray175,
    backgroundColor: COLORS.grayPaper,
  },
  chipLabel: {
    fontWeight: '700',
    color: COLORS.charcoal,
    maxWidth: 100,
  },
  chipLabelEmpty: {
    color: COLORS.gray350,
    fontWeight: '500',
  },

  // ── Crop SVG icon wrap ──
  iconWrap: {
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(23,107,67,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Photo thumbnail ──
  thumbImg: {
    borderRadius: 999,
    resizeMode: 'cover',
    borderWidth: 1.5,
    borderColor: 'rgba(26,92,42,0.15)',
  },
  thumbPlaceholder: {
    borderRadius: 999,
    backgroundColor: 'rgba(26,92,42,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Crop age badge ──
  ageBadge: {
    backgroundColor: 'rgba(46,204,113,0.15)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginLeft: 2,
  },
  ageBadgeTxt: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.greenDeep,
  },

  // ── Floating edit button ──
  editBtn: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderLeftWidth: 1,
    borderLeftColor: GREEN20,
  },
});

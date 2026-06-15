/**
 * ActivityFeedItem — clean list-row in the activity feed.
 *
 * Layout (left-to-right):
 *   • Solid colored 36×36 circle with white icon inside (activity-type colour)
 *   • Content column:
 *       row 1 — title (bold)              · time (right-aligned, muted)
 *       row 2 — subtitle (up to 2 lines, muted)
 *       row 3 — photo thumbs / voice pill (optional)
 *
 * Caller controls dividers between rows by adding a 1-px hairline border via
 * `style` (callers already do this pattern e.g. `i > 0 ? styles.bordered : null`).
 *
 * The earlier vertical timeline rail was removed — on the light minimal
 * theme it added visual noise without helping scanning. The colour pills
 * already make activity types instantly recognisable.
 */

import React from 'react';
import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COSMIC, CR, activityMeta } from '../theme/cosmicTheme';
import { useLanguage } from '../../../context/LanguageContext';

export default function ActivityFeedItem({
  type,
  title,
  subtitle,
  timeAgo,
  photos = [],
  hasVoice = false,
  offline = false,
  // connectTop / connectBottom kept as no-op props for backwards compat with
  // callers that pass them — the new design uses caller-supplied dividers.
  // eslint-disable-next-line no-unused-vars
  connectTop = false,
  // eslint-disable-next-line no-unused-vars
  connectBottom = false,
  onPress,
  onPlayVoice,
  style,
}) {
  const { t } = useLanguage();
  const meta = activityMeta(type);
  const Wrapper = onPress ? Pressable : View;

  return (
    <Wrapper
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: COSMIC.SURFACE_HI },
        style,
      ]}
    >
      {/* Solid coloured icon circle */}
      <View style={[styles.icon, { backgroundColor: meta.color }]}>
        <Ionicons name={meta.icon} size={16} color="#FFFFFF" />
      </View>

      {/* Content column */}
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{title || meta.key}</Text>
          <View style={styles.metaRow}>
            {offline && <Ionicons name="cloud-offline-outline" size={11} color={COSMIC.WARN} style={{ marginRight: 4 }} />}
            {!!timeAgo && <Text style={styles.time} numberOfLines={1}>{timeAgo}</Text>}
          </View>
        </View>

        {!!subtitle && (
          <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>
        )}

        {(photos.length > 0 || hasVoice) && (
          <View style={styles.attachmentRow}>
            {photos.slice(0, 3).map((uri, i) => (
              <Image key={`${uri}-${i}`} source={{ uri }} style={styles.thumb} />
            ))}
            {photos.length > 3 && (
              <View style={[styles.thumb, styles.thumbMore]}>
                <Text style={styles.thumbMoreText}>+{photos.length - 3}</Text>
              </View>
            )}
            {hasVoice && (
              <Pressable onPress={onPlayVoice} style={styles.voicePill}>
                <Ionicons name="play" size={11} color={COSMIC.ACCENT} />
                <Text style={styles.voicePillText}>{t('aiChat.voiceTag')}</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </Wrapper>
  );
}

const ICON_SIZE = 36;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle shadow so the colored circle pops slightly off the white card.
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  content: {
    flex: 1,
    paddingTop: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 14,
    color: COSMIC.TEXT,
    fontFamily: 'PlusJakartaSans_700Bold',
    textTransform: 'capitalize',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  time: {
    fontSize: 11,
    color: COSMIC.TEXT_3,
    fontFamily: 'PlusJakartaSans_500Medium',
  },
  subtitle: {
    fontSize: 12,
    color: COSMIC.TEXT_2,
    fontFamily: 'PlusJakartaSans_400Regular',
    marginTop: 3,
    lineHeight: 16,
  },

  // Attachments
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: CR.sm,
    backgroundColor: COSMIC.SURFACE_HI,
  },
  thumbMore: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COSMIC.BORDER_HI,
  },
  thumbMoreText: {
    fontSize: 11,
    color: COSMIC.TEXT_2,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  voicePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: CR.pill,
    backgroundColor: COSMIC.ACCENT_SOFT,
    borderWidth: 1,
    borderColor: COSMIC.ACCENT + '33',
  },
  voicePillText: {
    fontSize: 11,
    color: COSMIC.ACCENT,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
});

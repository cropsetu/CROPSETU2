/**
 * ReceivedReportsScreen — seller inbox of crop diagnosis reports shared by
 * farmers via DiagnosisResultScreen → KrushiKendraShareSheet.
 *
 * Endpoint unchanged: GET /api/v1/crop-reports/seller/inbox
 *
 * THE ROW READS AS A CASE FILE
 * ----------------------------
 * Each row is one farmer's problem, and the seller's job is to triage it. So
 * the row is ordered by what triage needs, top to bottom: the disease name in
 * Fraunces (what), the crop and stage (context), the farmer and village (who),
 * then risk and elapsed time on one footing line (how urgent). Risk is a
 * coloured rail down the left edge AND an icon-bearing pill in the footer —
 * risk is the one field on this screen that must never be carried by hue
 * alone, since "high" and "low" are the red/green pair.
 *
 * Unread is stated in words. It used to be a coloured border and an 8px dot,
 * which is invisible to anyone who can't separate those hues and ambiguous to
 * everyone else; a filled "New" badge says it outright, and the row's
 * accessibility label leads with it.
 *
 * What else changed from the original:
 *   - The list re-rendered every row on every parent state change (the
 *     renderItem closure was inline). Rows are memoised components.
 *   - `useEffect` + `useFocusEffect` both called `load()`, so opening the
 *     screen fired two identical requests. The shared list hook does it once.
 *   - The filter tabs were generic buttons; they carry tab semantics and
 *     selected state for screen readers.
 *   - Relative timestamps recomputed `Date.now()` inside render for every row.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Animated, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import api from '@cropsetu/shared/services/api';
import { CropIcon } from '@cropsetu/shared/components/CropIcons';

import { C, R, SP, T, riskMeta, useResponsive } from '../theme';
import useAsyncData from '../hooks/useAsyncData';
import { useEntrance } from '../hooks/useMotion';
import {
  Screen, AppHeader, Card, Chip, FilterBar, Badge, PressableRow,
  EmptyState, ErrorState, SkeletonList,
} from '../components/ui';

const TABS = [
  { key: 'ALL', tKey: 'inbox.tabAll', fallback: 'All' },
  { key: 'PENDING', tKey: 'inbox.tabPending', fallback: 'Pending' },
  { key: 'REPLIED', tKey: 'inbox.tabReplied', fallback: 'Replied' },
];

/** `now` is passed in so a 40-row list doesn't call Date.now() 40 times. */
function relativeTime(iso, t, now) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const min = Math.floor((now - then) / 60000);
  if (min < 1) return t('share.justNow', 'Just now');
  if (min < 60) return t('share.minAgo', { n: min, defaultValue: '{{n}} min ago' });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('share.hourAgo', { n: hr, defaultValue: '{{n}} h ago' });
  const day = Math.floor(hr / 24);
  if (day < 7) return t('share.dayAgo', { n: day, defaultValue: '{{n}} d ago' });
  return new Date(iso).toLocaleDateString();
}

// ── Row ──────────────────────────────────────────────────────────────────────

const ReportRow = React.memo(function ReportRow({ item, index, onPress, t, now }) {
  const entrance = useEntrance({ index, distance: 16 });

  const report = item.report || {};
  const farmer = item.farmer || {};
  const risk = riskMeta(report.riskLevel);
  const unread = !item.readAt;
  const replied = item.status === 'REPLIED';

  const disease = report.primaryDisease || t('share.unknownDisease', 'Unknown disease');
  const farmerLabel = [
    farmer.name || (farmer.phone ? `+91 ${farmer.phone}` : t('orders.buyerFallback', 'Farmer')),
    farmer.village,
  ].filter(Boolean).join(' · ');
  const when = relativeTime(item.createdAt, t, now);

  return (
    <Animated.View style={entrance}>
      <Card padded={false} accent={risk.color} style={[ri.card, unread && ri.cardUnread]}>
        <PressableRow
          onPress={() => onPress(item.id)}
          // One announcement per row instead of eight fragments, and it leads
          // with the unread state because that is what decides whether the
          // seller opens it.
          accessibilityLabel={[
            unread ? t('inbox.unread', 'Unread') : null,
            disease,
            report.cropType,
            farmerLabel,
            report.riskLevel ? `${t('share.risk', 'Risk')}: ${report.riskLevel}` : null,
            when,
          ].filter(Boolean).join('. ')}
          accessibilityHint={t('inbox.openHint', 'Opens the full report so you can reply')}
          style={ri.pressable}
        >
          <View style={ri.topRow}>
            <Text style={ri.disease} numberOfLines={2}>{disease}</Text>
            {unread ? <Badge label={t('inbox.new', 'New')} color={C.brand} filled /> : null}
          </View>

          {report.cropType || report.growthStage ? (
            <Text style={ri.crop} numberOfLines={1}>
              {[report.cropType, report.growthStage].filter(Boolean).join(' · ')}
            </Text>
          ) : null}

          <View style={ri.metaRow}>
            <Ionicons name="person-circle-outline" size={15} color={C.textFaint} />
            <Text style={ri.farmer} numberOfLines={1}>{farmerLabel}</Text>
          </View>

          <View style={ri.footRow}>
            <View style={[ri.riskPill, { backgroundColor: risk.tint }]}>
              <Ionicons name={risk.icon} size={12} color={risk.color} />
              <Text style={[ri.riskTxt, { color: risk.color }]} numberOfLines={1}>
                {report.riskLevel || t('common.unknown', 'UNKNOWN')}
                {report.confidenceScore != null ? ` · ${Math.round(report.confidenceScore)}%` : ''}
              </Text>
            </View>

            {replied ? (
              <View style={ri.repliedRow}>
                <Ionicons name="checkmark-done" size={13} color={C.success} />
                <Text style={ri.repliedTxt}>{t('inbox.replied', 'You replied')}</Text>
              </View>
            ) : null}

            <Text style={ri.time} numberOfLines={1}>{when}</Text>
          </View>
        </PressableRow>
      </Card>
    </Animated.View>
  );
});

// ── Screen ───────────────────────────────────────────────────────────────────

export default function ReceivedReportsScreen({ navigation }) {
  const { t } = useLanguage();
  const { gutter, isExpanded, contentMaxWidth } = useResponsive();
  const [filter, setFilter] = useState('ALL');

  const inbox = useAsyncData(
    useCallback(({ signal }) => {
      const params = filter === 'ALL' ? {} : { status: filter };
      return api.get('/crop-reports/seller/inbox', { params, signal })
        .then((res) => res.data.data || []);
    }, [filter]),
    [filter],
    {
      initialData: [],
      refetchOnFocus: true,
      errorFallback: t('share.loadFailed', 'Could not load reports.'),
    },
  );

  const items = inbox.data || [];

  // Recomputed once per render pass, not once per row.
  const now = useMemo(() => Date.now(), [items]);

  const openDetail = useCallback((shareId) => {
    navigation.navigate('ReceivedReportDetail', { shareId });
  }, [navigation]);

  const renderItem = useCallback(({ item, index }) => (
    <ReportRow item={item} index={index} onPress={openDetail} t={t} now={now} />
  ), [openDetail, t, now]);

  const keyExtractor = useCallback(
    (item, index) => (item?.id != null ? String(item.id) : `report-${index}`),
    [],
  );

  return (
    <Screen edges={['top', 'left', 'right']}>
      <AppHeader
        title={t('inbox.title', 'Received Reports')}
        subtitle={t('inbox.subtitle', 'Crop diagnosis from nearby farmers')}
        onBack={() => navigation.goBack()}
      />

      <FilterBar>
        {TABS.map((tab) => (
          <Chip
            key={tab.key}
            label={t(tab.tKey, tab.fallback)}
            selected={filter === tab.key}
            onPress={() => setFilter(tab.key)}
            accessibilityRole="tab"
            size="sm"
          />
        ))}
      </FilterBar>

      {inbox.isInitialLoading ? (
        <SkeletonList count={4} thumb={false} />
      ) : inbox.error && items.length === 0 ? (
        <ErrorState error={inbox.error} onRetry={inbox.retry} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={[
            { padding: gutter, flexGrow: 1, paddingBottom: SP.huge },
            isExpanded && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={inbox.refreshing}
              onRefresh={inbox.refresh}
              tintColor={C.brand}
              colors={[C.brand]}
            />
          }
          ListEmptyComponent={
            <EmptyState
              illustration={<CropIcon crop="Wheat" size={56} />}
              title={
                filter === 'ALL'
                  ? t('inbox.emptyTitle', 'No reports yet')
                  : t('inbox.emptyFiltered', 'Nothing in this tab')
              }
              body={t('inbox.emptyText', 'When a nearby farmer sends you a crop diagnosis, it will appear here.')}
              actionLabel={filter !== 'ALL' ? t('orders.clearFilter', 'Show all') : undefined}
              onAction={filter !== 'ALL' ? () => setFilter('ALL') : undefined}
            />
          }
          initialNumToRender={7}
          maxToRenderPerBatch={9}
          windowSize={9}
        />
      )}
    </Screen>
  );
}

const ri = StyleSheet.create({
  card: { marginBottom: SP.lg },
  // Supplementary to the "New" badge, never the only signal.
  cardUnread: { borderColor: C.brand },
  pressable: { paddingVertical: SP.lg, paddingLeft: SP.xl, paddingRight: SP.lg, borderRadius: R.xl },

  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  disease: { ...T.subhead, flex: 1, color: C.text },
  crop: { ...T.caption, color: C.textMuted, marginTop: SP.xs },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginTop: SP.sm },
  farmer: { ...T.caption, flex: 1, color: C.textFaint },

  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginTop: SP.lg,
    flexWrap: 'wrap',
  },
  riskPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    borderRadius: R.pill,
    paddingHorizontal: SP.md,
    paddingVertical: 4,
    flexShrink: 1,
  },
  riskTxt: { ...T.micro, textTransform: 'uppercase' },

  repliedRow: { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  repliedTxt: { ...T.micro, color: C.success, textTransform: 'uppercase' },

  time: { ...T.caption, color: C.textFaint, marginLeft: 'auto' },
});

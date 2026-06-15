/**
 * MandiGlanceCard — live mandi (market) price for a crop, with a 30-day trend
 * sparkline, nearby markets, and a comparison against the cycle's own sale
 * price. Surfaces the existing Agmarknet data inside the crop-cycle screen so
 * the farmer can time/benchmark the sale. Degrades silently when the feature
 * is off or no data exists.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getMandiPrices, getMandiTrend } from '../../../services/mandiApi';
import { Sparkline } from '../../../components/charts';
import SpeakerButton from '../ui/SpeakerButton';
import GlassCard from '../ui/GlassCard';
import { COSMIC, CR, CT } from '../theme/cosmicTheme';
import { useLanguage } from '../../../context/LanguageContext';

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

export default function MandiGlanceCard({ cropName, district, state, salePricePerKgInr }) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [best, setBest] = useState(null);
  const [others, setOthers] = useState([]);
  const [points, setPoints] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!cropName) { setLoading(false); return; }
      try {
        const { rows } = await getMandiPrices({ commodity: cropName, district, state });
        if (!alive) return;
        if (!rows.length) { setBest(null); setLoading(false); return; }
        setBest(rows[0]);
        setOthers(rows.slice(1, 4));
        // 30-day trend for the top market (best-effort).
        try {
          const { trend } = await getMandiTrend(cropName, rows[0].market, 30);
          if (alive && Array.isArray(trend)) setPoints(trend.map((t) => t.modalPrice).filter((n) => n != null));
        } catch {}
      } catch {
        if (alive) setBest(null);   // feature off / 404 → render nothing
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [cropName, district, state]);

  if (loading) {
    return (
      <GlassCard style={styles.card}>
        <View style={styles.headRow}><Text style={styles.title}>{t('mspTracker.mandiPrice')}</Text></View>
        <ActivityIndicator color={COSMIC.PRIMARY} style={{ marginVertical: 8 }} />
      </GlassCard>
    );
  }
  if (!best) return null;

  const modal = Number(best.modalPrice) || 0;       // ₹ per quintal
  const perKg = modal / 100;
  const sale = Number(salePricePerKgInr) || 0;
  const diffPct = sale > 0 && perKg > 0 ? Math.round(((sale - perKg) / perKg) * 100) : null;
  const speakText =
    t('mandiGlance.speakPrice', { crop: cropName, price: Math.round(modal), market: best.market })
    + (diffPct != null
      ? t('mandiGlance.speakComparison', {
          percent: Math.abs(diffPct),
          direction: diffPct >= 0 ? t('mandiGlance.above') : t('mandiGlance.below'),
        })
      : '.');

  return (
    <GlassCard style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.title}>{t('mspTracker.mandiPrice')}</Text>
        <View style={styles.headRight}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Agmarknet</Text>
          <SpeakerButton text={speakText} size={16} tint={COSMIC.PRIMARY} style={{ marginLeft: 6 }} />
        </View>
      </View>

      <View style={styles.bestRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.bestPrice}>₹{modal.toLocaleString('en-IN')}<Text style={styles.bestUnit}> /qtl</Text></Text>
          <Text style={styles.bestMeta} numberOfLines={1}>
            {best.market}{best.priceDate ? ` · ${fmtDate(best.priceDate)}` : ''}
          </Text>
        </View>
        {points.length > 1 && (
          <Sparkline points={points} width={96} height={40} color={COSMIC.PRIMARY} fill />
        )}
      </View>

      {diffPct != null && (
        <View style={[styles.cmp, { backgroundColor: diffPct >= 0 ? COSMIC.PRIMARY_SOFT : COSMIC.DANGER_SOFT }]}>
          <Ionicons
            name={diffPct >= 0 ? 'trending-up' : 'trending-down'}
            size={14}
            color={diffPct >= 0 ? COSMIC.PRIMARY : COSMIC.DANGER}
          />
          <Text style={[styles.cmpText, { color: diffPct >= 0 ? COSMIC.PRIMARY : COSMIC.DANGER }]}>
            {t('mandiGlance.saleComparison', {
              sale,
              percent: Math.abs(diffPct),
              direction: diffPct >= 0 ? t('mandiGlance.above') : t('mandiGlance.below'),
            })}
          </Text>
        </View>
      )}

      {others.length > 0 && (
        <View style={styles.others}>
          {others.map((m, i) => (
            <View key={`${m.market}-${i}`} style={styles.otherRow}>
              <Text style={styles.otherMarket} numberOfLines={1}>{m.market}</Text>
              <Text style={styles.otherPrice}>₹{(Number(m.modalPrice) || 0).toLocaleString('en-IN')}</Text>
            </View>
          ))}
        </View>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 0 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { ...CT.styles.h3, fontSize: 15 },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COSMIC.SUCCESS },
  liveText: { fontSize: 10, color: COSMIC.TEXT_3, fontFamily: CT.family.semibold, textTransform: 'uppercase', letterSpacing: 0.4 },

  bestRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bestPrice: { fontSize: 24, fontFamily: CT.family.extra, color: COSMIC.TEXT },
  bestUnit: { fontSize: 13, fontFamily: CT.family.medium, color: COSMIC.TEXT_3 },
  bestMeta: { fontSize: 12, fontFamily: CT.family.medium, color: COSMIC.TEXT_3, marginTop: 1 },

  cmp: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingHorizontal: 10, paddingVertical: 7, borderRadius: CR.md },
  cmpText: { fontSize: 12, fontFamily: CT.family.semibold, flex: 1 },

  others: { marginTop: 10, borderTopWidth: 1, borderTopColor: COSMIC.BORDER, paddingTop: 8, gap: 5 },
  otherRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  otherMarket: { fontSize: 12, color: COSMIC.TEXT_2, fontFamily: CT.family.medium, flex: 1 },
  otherPrice: { fontSize: 12, color: COSMIC.TEXT, fontFamily: CT.family.bold },
});

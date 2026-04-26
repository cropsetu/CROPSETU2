import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../../../context/LanguageContext';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../../../constants/colors';

const iconFor = (cond = '') => {
  const c = cond.toLowerCase();
  if (c.includes('rain') || c.includes('drizzle')) return 'rainy';
  if (c.includes('cloud')) return 'cloudy';
  if (c.includes('storm') || c.includes('thunder')) return 'thunderstorm';
  if (c.includes('snow')) return 'snow';
  if (c.includes('clear') || c.includes('sun')) return 'sunny';
  return 'partly-sunny';
};

const fmtDay = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short' });
};

export default function WeatherGlanceCard({ weather }) {
  const { t } = useLanguage();
  const hasData = weather && (weather.currentTempC != null || Array.isArray(weather.forecast7Day));

  if (!hasData) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{t('myFarm.weather.title')}</Text>
        <View style={styles.emptyRow}>
          <Ionicons name="cloud-offline-outline" size={22} color={COLORS.textMedium} />
          <Text style={styles.emptyText}>{t('myFarm.weather.noData')}</Text>
        </View>
      </View>
    );
  }

  const forecast = Array.isArray(weather.forecast7Day) ? weather.forecast7Day.slice(0, 3) : [];

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('myFarm.weather.title')}</Text>
      <View style={styles.currentRow}>
        <Ionicons name={iconFor(weather.currentCondition)} size={36} color={COLORS.skyBlue} />
        <View style={styles.currentText}>
          <Text style={styles.temp}>{weather.currentTempC != null ? `${Math.round(weather.currentTempC)}°C` : '—'}</Text>
          <Text style={styles.cond}>{weather.currentCondition || ''}</Text>
        </View>
      </View>
      {forecast.length > 0 && (
        <View style={styles.forecastRow}>
          {forecast.map((f, i) => (
            <View key={i} style={styles.forecastItem}>
              <Text style={styles.forecastDay}>{fmtDay(f.date || f.day)}</Text>
              <Ionicons name={iconFor(f.condition)} size={20} color={COLORS.skyBlue} />
              <Text style={styles.forecastTemp}>
                {f.tempMaxC != null ? `${Math.round(f.tempMaxC)}°` : '—'}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    ...SHADOWS.small,
  },
  title: {
    fontSize: TYPE.size.base,
    fontWeight: TYPE.weight.semibold,
    color: COLORS.textDark,
    marginBottom: 10,
  },
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  currentText: { flex: 1 },
  temp: { fontSize: TYPE.size.xl, fontWeight: TYPE.weight.bold, color: COLORS.textDark },
  cond: { fontSize: TYPE.size.sm, color: COLORS.textMedium, marginTop: 2 },
  forecastRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  forecastItem: { alignItems: 'center', flex: 1 },
  forecastDay: { fontSize: TYPE.size.xs, color: COLORS.textMedium, marginBottom: 4 },
  forecastTemp: { fontSize: TYPE.size.sm, fontWeight: TYPE.weight.semibold, color: COLORS.textDark, marginTop: 4 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emptyText: { fontSize: TYPE.size.sm, color: COLORS.textMedium },
});

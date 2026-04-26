/**
 * MachineryDetail — Full equipment detail with:
 * • Image/video gallery
 * • Specs: age, mileage, HP, fuel type
 * • Availability calendar (month view, occupied/available)
 * • Date-range booking form with conflict check
 * • Cost calculator
 */
import { COLORS } from '../../constants/colors';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, Alert, Linking, ActivityIndicator, Dimensions,
  StatusBar, Modal, TextInput, Animated,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const { width: W } = Dimensions.get('window');



// ── Day/month keys (resolved via t() at render) ───────────────────────────────
const DAY_KEYS   = ['daySun','dayMon','dayTue','dayWed','dayThu','dayFri','daySat'];
const MONTH_KEYS = ['monthJan','monthFeb','monthMar','monthApr','monthMay','monthJun','monthJul','monthAug','monthSep','monthOct','monthNov','monthDec'];

// ── Calendar helpers ──────────────────────────────────────────────────────────
function buildMonthCells(year, month) {
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

function dateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isBooked(year, month, day, bookedRanges) {
  const d = new Date(year, month, day);
  return bookedRanges.some(r => {
    const s = new Date(r.startDate);
    const e = new Date(r.endDate);
    s.setHours(0,0,0,0); e.setHours(23,59,59,999);
    return d >= s && d <= e;
  });
}

function isPast(year, month, day) {
  const today = new Date(); today.setHours(0,0,0,0);
  return new Date(year, month, day) < today;
}

// ── Mini calendar ─────────────────────────────────────────────────────────────
function AvailCalendar({ year, month, bookedRanges, selStart, selEnd, onDayPress, t }) {
  const cells = buildMonthCells(year, month);
  return (
    <View>
      <View style={C.calWeekRow}>
        {DAY_KEYS.map(dk => <Text key={dk} style={C.calDayName}>{t('weatherHome.' + dk)}</Text>)}
      </View>
      <View style={C.calGrid}>
        {cells.map((day, i) => {
          if (!day) return <View key={`e${i}`} style={C.calCell} />;

          const past    = isPast(year, month, day);
          const booked  = !past && isBooked(year, month, day, bookedRanges);
          const dk      = dateKey(year, month, day);
          const isStart = dk === selStart;
          const isEnd   = dk === selEnd;
          const inRange = selStart && selEnd && dk >= selStart && dk <= selEnd;
          const today   = dk === dateKey(...[ new Date().getFullYear(), new Date().getMonth(), new Date().getDate() ]);

          let bgColor = 'transparent';
          let txtColor = past ? COLORS.divider : COLORS.charcoal;
          if (booked)           { bgColor = COLORS.redPale200; txtColor = COLORS.error; }
          if (inRange && !booked) bgColor = COLORS.primary + '25';
          if (isStart || isEnd)  bgColor = COLORS.primary;
          if (isStart || isEnd)  txtColor = COLORS.white;

          return (
            <TouchableOpacity
              key={dk}
              style={[C.calCell, { backgroundColor: bgColor, borderRadius: 8 },
                today && !isStart && !isEnd && { borderWidth: 1.5, borderColor: COLORS.primary }]}
              onPress={() => !past && !booked && onDayPress(dk)}
              disabled={past || booked}
            >
              <Text style={[C.calDayTxt, { color: txtColor }]}>{day}</Text>
              {booked && <Text style={C.calBookedDot}>●</Text>}
            </TouchableOpacity>
          );
        })}
      </View>
      {/* Legend */}
      <View style={C.legend}>
        <View style={C.legendItem}>
          <View style={[C.legendDot, { backgroundColor: COLORS.redPale200 }]} />
          <Text style={C.legendTxt}>{t('rent.occupied')}</Text>
        </View>
        <View style={C.legendItem}>
          <View style={[C.legendDot, { backgroundColor: COLORS.primary }]} />
          <Text style={C.legendTxt}>{t('rent.yourSelection')}</Text>
        </View>
        <View style={C.legendItem}>
          <View style={[C.legendDot, { backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.primary }]} />
          <Text style={C.legendTxt}>{t('rent.todayLegend')}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Spec row ──────────────────────────────────────────────────────────────────
function SpecRow({ icon, label, value, color = COLORS.grayDark2 }) {
  if (!value) return null;
  return (
    <View style={D.specRow}>
      <View style={[D.specIconWrap, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={D.specLabel}>{label}</Text>
        <Text style={D.specValue}>{value}</Text>
      </View>
    </View>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function MachineryDetail({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { id, machinery: passedData } = route.params;

  const [data,         setData]         = useState(passedData || null);
  const [bookedRanges, setBookedRanges] = useState([]);
  const [galIdx,       setGalIdx]       = useState(0);
  const [calYear,      setCalYear]      = useState(new Date().getFullYear());
  const [calMonth,     setCalMonth]     = useState(new Date().getMonth());
  const [selStart,     setSelStart]     = useState(null);
  const [selEnd,       setSelEnd]       = useState(null);
  const [notes,        setNotes]        = useState('');
  const [booking,      setBooking]      = useState(false);
  const [loadingData,  setLoadingData]  = useState(!passedData);

  // Fetch full detail if not passed
  useEffect(() => {
    const fetchId = id || passedData?.id;
    if (!fetchId) return;
    (async () => {
      try {
        const res = await api.get(`/rent/machinery/${fetchId}`);
        setData(res.data.data);
        setBookedRanges(res.data.data.bookings || []);
      } catch { /* use passedData */ }
      finally { setLoadingData(false); }
    })();
  }, [id]);

  // Fetch availability for current month
  useEffect(() => {
    const fetchId = id || passedData?.id;
    if (!fetchId) return;
    api.get(`/rent/machinery/${fetchId}/availability`, {
      params: { year: calYear, month: calMonth + 1 },
    }).then(r => setBookedRanges(r.data.data || [])).catch(() => {});
  }, [calYear, calMonth, id]);

  const m = data;

  const handleDayPress = useCallback((dk) => {
    if (!selStart || (selStart && selEnd)) {
      setSelStart(dk);
      setSelEnd(null);
    } else {
      if (dk < selStart) { setSelStart(dk); setSelEnd(null); }
      else setSelEnd(dk);
    }
  }, [selStart, selEnd]);

  const selectedDays = useCallback(() => {
    if (!selStart || !selEnd) return 0;
    const s = new Date(selStart);
    const e = new Date(selEnd);
    return Math.round((e - s) / 86400000) + 1;
  }, [selStart, selEnd]);

  const totalCost = () => {
    const days = selectedDays();
    return days > 0 && m ? days * (m.pricePerDay || 0) : 0;
  };

  const handleBook = async () => {
    if (!selStart || !selEnd) {
      Alert.alert(t('rent.selectDatesAlert'), t('rent.selectDatesMsg'));
      return;
    }
    const days = selectedDays();
    if (days <= 0) {
      Alert.alert(t('rent.invalidRange'), t('rent.invalidRangeMsg'));
      return;
    }
    setBooking(true);
    try {
      await api.post('/rent/bookings', {
        machineryListingId: m.id,
        startDate:          selStart,
        endDate:            selEnd,
        days,
        totalAmount:        totalCost(),
        notes:              notes.trim() || null,
      });
      Alert.alert(
        t('rent.bookingConfirmed'),
        `${m.name}: ${selStart} → ${selEnd} (${days} ${t('rent.ageLabel').toLowerCase()})\n\n₹${totalCost().toLocaleString()}`,
        [{ text: t('ok'), onPress: () => navigation.goBack() }]
      );
      setSelStart(null); setSelEnd(null);
      // Refresh availability
      const fetchId = id || passedData?.id;
      const r = await api.get(`/rent/machinery/${fetchId}/availability`, { params: { year: calYear, month: calMonth + 1 } });
      setBookedRanges(r.data.data || []);
    } catch (err) {
      const msg = err.response?.data?.error?.message || t('rent.bookingFailed');
      Alert.alert(t('rent.bookingFailed'), msg);
    } finally {
      setBooking(false);
    }
  };

  if (loadingData || !m) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.white }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const allMedia = [...(m.images || []), ...(m.videos || [])];
  const prevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m2 => m2 - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m2 => m2 + 1);
  };

  const days  = selectedDays();
  const total = totalCost();

  return (
    <AnimatedScreen>
    <View style={D.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>

        {/* ── Media gallery ── */}
        <View style={D.galleryWrap}>
          {allMedia.length > 0 ? (
            <>
              <ScrollView
                horizontal pagingEnabled showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={e => setGalIdx(Math.round(e.nativeEvent.contentOffset.x / W))}
              >
                {allMedia.map((uri, i) => {
                  const isVideo = m.videos?.includes(uri);
                  return (
                    <View key={i} style={{ width: W, height: 300 }}>
                      {isVideo
                        ? (
                          <Video
                            source={{ uri }}
                            style={D.galleryImg}
                            resizeMode={ResizeMode.COVER}
                            useNativeControls
                            shouldPlay={false}
                            isLooping={false}
                          />
                        )
                        : <Image source={{ uri }} style={D.galleryImg} resizeMode="cover" />
                      }
                    </View>
                  );
                })}
              </ScrollView>
              {allMedia.length > 1 && (
                <View style={D.dots}>
                  {allMedia.map((_, i) => (
                    <View key={i} style={[D.dot, i === galIdx && D.dotActive]} />
                  ))}
                </View>
              )}
            </>
          ) : (
            <View style={[D.galleryImgFallback]}>
              <Ionicons name="construct" size={80} color={COLORS.blue} />
            </View>
          )}

          {/* Gradient overlay */}
          <LinearGradient
            colors={['rgba(0,0,0,0.4)', 'transparent', 'rgba(0,0,0,0.5)']}
            locations={[0, 0.4, 1]}
            style={D.galleryGradient}
            pointerEvents="none"
          />

          {/* Back & actions overlay */}
          <View style={[D.galleryNav, { paddingTop: insets.top + 8 }]}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={D.navBtn}>
              <Ionicons name="arrow-back" size={22} color={COLORS.white} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => m.ownerPhone && Linking.openURL(`tel:${m.ownerPhone}`)} style={D.navBtn}>
              <Ionicons name="call-outline" size={22} color={COLORS.white} />
            </TouchableOpacity>
          </View>

          {/* Availability overlay */}
          <View style={[D.availOverlay, { backgroundColor: m.available ? COLORS.primaryPale : COLORS.orangeWarm }]}>
            <View style={[D.availDot, { backgroundColor: m.available ? COLORS.primary : COLORS.cta }]} />
            <Text style={[D.availTxt, { color: m.available ? COLORS.primary : COLORS.cta }]}>
              {m.available ? t('rent.availableNow') : t('rent.advanceBookingOnly')}
            </Text>
          </View>
        </View>

        <View style={D.content}>

          {/* ── Title + Price ── */}
          <View style={D.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={D.title}>{m.name}</Text>
              {m.brand ? <Text style={D.subtitle}>{m.brand}</Text> : null}
            </View>
            <View style={D.priceBox}>
              {m.pricePerHour ? <Text style={D.priceHr}>₹{m.pricePerHour?.toLocaleString()}/hr</Text> : null}
              <Text style={D.priceDay}>₹{m.pricePerDay?.toLocaleString()}/day</Text>
              {m.pricePerAcre ? <Text style={D.priceAcre}>₹{m.pricePerAcre?.toLocaleString()}/acre</Text> : null}
            </View>
          </View>

          {/* Rating */}
          {m.rating > 0 && (
            <View style={D.ratingRow}>
              {[1,2,3,4,5].map(s => (
                <Ionicons key={s} name={s <= Math.round(m.rating) ? 'star' : 'star-outline'} size={15} color={COLORS.yellowDark2} />
              ))}
              <Text style={D.ratingTxt}>{m.rating?.toFixed(1)} ({m.ratingCount} {t('rent.reviewsCount')})</Text>
            </View>
          )}

          {/* ── Equipment Specs ── */}
          <Text style={D.sectionTitle}>{t('rent.equipmentDetails')}</Text>
          <View style={D.specsCard}>
            <SpecRow icon="calendar-outline"   label={t('rent.ageLabel')}        value={m.ageYears     ? `${m.ageYears} yr${m.ageYears > 1 ? 's' : ''}` : null} color={COLORS.blue} />
            <SpecRow icon="speedometer-outline" label={t('rent.usageLabel')}      value={m.mileageHours ? `${m.mileageHours.toLocaleString()} h` : null}            color={COLORS.purpleDark} />
            <SpecRow icon="flash-outline"       label={t('rent.powerLabel')}      value={m.horsePower}  color={COLORS.cta} />
            <SpecRow icon="flame-outline"       label={t('rent.fuelLabel')}       value={m.fuelType ? t('rent.fuel' + m.fuelType.charAt(0).toUpperCase() + m.fuelType.slice(1)) : null} color={COLORS.error} />
            <SpecRow icon="location-outline"    label={t('rent.locationLabel')}   value={m.location}    color={COLORS.primaryLight} />
            {m.availableFrom ? (
              <SpecRow icon="time-outline" label={t('rent.availableFromLabel')}
                value={`${new Date(m.availableFrom).toLocaleDateString('en-IN')} – ${m.availableTo ? new Date(m.availableTo).toLocaleDateString('en-IN') : t('rent.ongoing')}`}
                color={COLORS.primary} />
            ) : null}
          </View>

          {/* Features */}
          {m.features?.length > 0 && (
            <>
              <Text style={D.sectionTitle}>{t('rent.featuresSection')}</Text>
              <View style={D.featureWrap}>
                {m.features.map((f, i) => (
                  <View key={i} style={D.featureChip}>
                    <Ionicons name="checkmark-circle" size={14} color={COLORS.primary} />
                    <Text style={D.featureTxt}>{f}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Description */}
          {m.description ? (
            <>
              <Text style={D.sectionTitle}>{t('rent.aboutEquipment')}</Text>
              <Text style={D.descTxt}>{m.description}</Text>
            </>
          ) : null}

          {/* ── Availability Calendar ── */}
          <Text style={D.sectionTitle}>{t('rent.availCalendar')}</Text>
          <View style={D.calCard}>
            <View style={D.calHeader}>
              <TouchableOpacity onPress={prevMonth} style={D.calNavBtn}>
                <Ionicons name="chevron-back" size={20} color={COLORS.charcoal} />
              </TouchableOpacity>
              <Text style={D.calMonthTxt}>{t('weatherHome.' + MONTH_KEYS[calMonth])} {calYear}</Text>
              <TouchableOpacity onPress={nextMonth} style={D.calNavBtn}>
                <Ionicons name="chevron-forward" size={20} color={COLORS.charcoal} />
              </TouchableOpacity>
            </View>
            <AvailCalendar
              year={calYear} month={calMonth}
              bookedRanges={bookedRanges}
              selStart={selStart} selEnd={selEnd}
              onDayPress={handleDayPress}
              t={t}
            />
          </View>

          {/* ── Booking summary ── */}
          {selStart && (
            <View style={D.selCard}>
              <Text style={D.selTitle}>{t('rent.bookingSummary')}</Text>
              <View style={D.selRow}>
                <Ionicons name="calendar-outline" size={15} color={COLORS.primary} />
                <Text style={D.selTxt}>
                  {selStart}{selEnd ? ` → ${selEnd}` : ` ${t('rent.selectEndDate')}`}
                </Text>
              </View>
              {selEnd && (
                <>
                  <View style={D.selRow}>
                    <Ionicons name="time-outline" size={15} color={COLORS.primary} />
                    <Text style={D.selTxt}>{days} × ₹{m.pricePerDay?.toLocaleString()}/day</Text>
                  </View>
                  <View style={[D.selRow, { borderTopWidth: 1, borderTopColor: COLORS.lightGray2, marginTop: 8, paddingTop: 8 }]}>
                    <Text style={D.totalLabel}>{t('rent.totalAmount')}</Text>
                    <Text style={D.totalAmt}>₹{total.toLocaleString()}</Text>
                  </View>
                  <TextInput
                    style={D.notesInput}
                    placeholder={t('rent.notesPlaceholder')}
                    placeholderTextColor={COLORS.grayLightMid}
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    numberOfLines={2}
                  />
                </>
              )}
            </View>
          )}

          {/* ── Owner card ── */}
          {(m.ownerName || m.owner) && (
            <>
              <Text style={D.sectionTitle}>{t('rent.equipOwner')}</Text>
              <View style={D.ownerCard}>
                <View style={D.ownerAvatar}>
                  {m.owner?.avatar
                    ? <Image source={{ uri: m.owner.avatar }} style={D.ownerAvatarImg} />
                    : <Ionicons name="person" size={22} color={COLORS.white} />
                  }
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={D.ownerName}>{m.ownerName || m.owner?.name}</Text>
                  <Text style={D.ownerLoc}>{m.location}</Text>
                </View>
                <TouchableOpacity
                  style={D.callSmall}
                  onPress={() => m.ownerPhone && Linking.openURL(`tel:${m.ownerPhone}`)}
                >
                  <Ionicons name="call" size={18} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {/* ── Bottom bar ── */}
      <View style={[D.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
        <TouchableOpacity
          style={D.callBtn}
          onPress={() => m.ownerPhone && Linking.openURL(`tel:${m.ownerPhone}`)}
        >
          <Ionicons name="call" size={20} color={COLORS.primary} />
          <Text style={D.callBtnTxt}>{t('rent.callOwner')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[D.bookBtn2, (!selStart || !selEnd || booking) && { opacity: 0.5 }]}
          onPress={handleBook}
          disabled={!selStart || !selEnd || booking}
        >
          {booking
            ? <ActivityIndicator size="small" color={COLORS.white} />
            : <>
                <Ionicons name="calendar" size={20} color={COLORS.white} />
                <Text style={D.bookBtn2Txt}>
                  {selStart && selEnd ? `${t('rent.booking')} ${days}d — ₹${total.toLocaleString()}` : t('rent.selectDatesPlaceholder')}
                </Text>
              </>
          }
        </TouchableOpacity>
      </View>
    </View>
    </AnimatedScreen>
  );
}

const D = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.background },

  galleryWrap:    { height: 300, position: 'relative' },
  galleryImg:     { width: W, height: 300 },
  galleryImgFallback: { width: W, height: 300, backgroundColor: COLORS.blueBg, justifyContent: 'center', alignItems: 'center' },
  galleryGradient:{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  galleryNav:     { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  navBtn:         { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' },
  dots:        { position: 'absolute', bottom: 14, width: '100%', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot:         { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive:   { backgroundColor: COLORS.white, width: 20 },
  availOverlay:{ position: 'absolute', bottom: 14, left: 14, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  availDot:    { width: 7, height: 7, borderRadius: 4 },
  availTxt:    { fontSize: 11, fontWeight: '700' },

  content: { padding: 16, backgroundColor: COLORS.background, marginTop: -16, borderTopLeftRadius: 20, borderTopRightRadius: 20 },

  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  title:    { fontSize: 20, fontWeight: '800', color: COLORS.textDark, flex: 1, marginRight: 8 },
  subtitle: { fontSize: 13, color: COLORS.textLight, marginTop: 2 },
  priceBox: { alignItems: 'flex-end' },
  priceHr:  { fontSize: 13, color: COLORS.textLight },
  priceDay: { fontSize: 18, fontWeight: '900', color: COLORS.primary },
  priceAcre:{ fontSize: 11, color: COLORS.textLight, marginTop: 1 },

  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 16 },
  ratingTxt: { fontSize: 13, color: COLORS.textLight, marginLeft: 4 },

  sectionTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textDark, marginBottom: 10, marginTop: 6 },

  specsCard: { backgroundColor: COLORS.white, borderRadius: 18, padding: 4, marginBottom: 16, shadowColor: COLORS.black, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  specRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  specIconWrap:{ width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  specLabel: { fontSize: 11, color: COLORS.textLight, fontWeight: '600' },
  specValue: { fontSize: 14, color: COLORS.textDark, fontWeight: '700', marginTop: 1 },

  featureWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  featureChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.primaryPale, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  featureTxt:  { fontSize: 12, color: COLORS.primary, fontWeight: '700' },

  descTxt: { fontSize: 14, color: COLORS.grayMid2, lineHeight: 22, marginBottom: 16 },

  calCard:     { backgroundColor: COLORS.white, borderRadius: 16, padding: 14, marginBottom: 16, shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  calHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  calNavBtn:   { padding: 8 },
  calMonthTxt: { fontSize: 15, fontWeight: '800', color: COLORS.textDark },

  selCard: { backgroundColor: COLORS.primaryPale, borderRadius: 16, padding: 14, marginBottom: 16, borderWidth: 1.5, borderColor: COLORS.primary + '40' },
  selTitle: { fontSize: 14, fontWeight: '800', color: COLORS.primary, marginBottom: 10 },
  selRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  selTxt:   { fontSize: 14, color: COLORS.textDark, fontWeight: '600', flex: 1 },
  totalLabel:{ fontSize: 14, color: COLORS.textDark, fontWeight: '700', flex: 1 },
  totalAmt: { fontSize: 18, fontWeight: '900', color: COLORS.primary },
  notesInput: { marginTop: 10, backgroundColor: COLORS.white, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.border, padding: 10, fontSize: 13, color: COLORS.textDark, minHeight: 50 },

  ownerCard:    { backgroundColor: COLORS.white, borderRadius: 16, padding: 14, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  ownerAvatar:  { width: 46, height: 46, borderRadius: 23, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  ownerAvatarImg:{ width: 46, height: 46, borderRadius: 23 },
  ownerName:    { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  ownerLoc:     { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  callSmall:    { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },

  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 10, padding: 12, paddingTop: 10, backgroundColor: COLORS.white, borderTopWidth: 1, borderTopColor: COLORS.lightGray2 },
  callBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 2, borderColor: COLORS.primary, borderRadius: 14, paddingVertical: 13 },
  callBtnTxt:{ fontSize: 14, fontWeight: '700', color: COLORS.primary },
  bookBtn2:  { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 13 },
  bookBtn2Txt:{ fontSize: 13, fontWeight: '800', color: COLORS.white },
});

const C = StyleSheet.create({
  calWeekRow: { flexDirection: 'row', marginBottom: 4 },
  calDayName: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700', color: COLORS.textLight },
  calGrid:    { flexDirection: 'row', flexWrap: 'wrap' },
  calCell:    { width: `${100 / 7}%`, aspectRatio: 1, justifyContent: 'center', alignItems: 'center', padding: 2 },
  calDayTxt:  { fontSize: 13, fontWeight: '600' },
  calBookedDot:{ fontSize: 5, color: COLORS.error, marginTop: -2 },
  legend:     { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:  { width: 12, height: 12, borderRadius: 4 },
  legendTxt:  { fontSize: 10, color: COLORS.textBody, fontWeight: '600' },
});

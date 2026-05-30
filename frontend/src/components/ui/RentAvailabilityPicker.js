/**
 * RentAvailabilityPicker — tap-to-pick availability window for rent listings.
 *
 * Replaces the old free-text "YYYY-MM-DD" inputs. Presents two read-only chips
 * (From / To) that open a calendar modal where the user taps a start date and an
 * optional end date. Cross-platform (web + native) — built on a plain month grid,
 * no native date-picker dependency.
 *
 * Edge cases handled:
 *  • Past dates are disabled — you can't make a listing available in the past.
 *  • End date can never be before the start date (selection logic enforces it).
 *  • End date is optional → "ongoing" availability (empty `to`).
 *  • Re-opening syncs to the current committed value; Cancel discards changes.
 *  • Clear resets both dates.
 *  • Editing a listing whose start date is already in the past keeps that value.
 *
 * Value format is "YYYY-MM-DD" strings (ISO date, lexicographically sortable),
 * matching what the backend stores and what edit-mode passes in.
 *
 * Props: { from, to, onChange({from, to}), t }
 */
import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';

const DAY_KEYS   = ['daySun', 'dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat'];
const MONTH_KEYS = ['monthJan', 'monthFeb', 'monthMar', 'monthApr', 'monthMay', 'monthJun', 'monthJul', 'monthAug', 'monthSep', 'monthOct', 'monthNov', 'monthDec'];

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

function buildMonthCells(year, month) {
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

function todayKey() {
  const t = new Date();
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
}

function isPastCell(y, m, d) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(y, m, d) < today;
}

// "2026-05-30" → "30 May 2026" (locale-aware, no time component surprises)
function fmtNice(dk) {
  if (!dk) return null;
  const [y, m, d] = dk.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function RentAvailabilityPicker({ from, to, onChange, t }) {
  const now = new Date();
  const [open,     setOpen]     = useState(false);
  const [calYear,  setCalYear]  = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [selStart, setSelStart] = useState(from || null);
  const [selEnd,   setSelEnd]   = useState(to   || null);

  const openModal = () => {
    // Sync local working selection to the committed value each time we open.
    setSelStart(from || null);
    setSelEnd(to || null);
    const base = from ? new Date(from) : new Date();
    setCalYear(base.getFullYear());
    setCalMonth(base.getMonth());
    setOpen(true);
  };

  const handleDayPress = (dk) => {
    // No start yet, or a full range already chosen → start a fresh range.
    if (!selStart || (selStart && selEnd)) {
      setSelStart(dk);
      setSelEnd(null);
    } else if (dk < selStart) {
      // Tapped before the current start → it becomes the new start.
      setSelStart(dk);
      setSelEnd(null);
    } else {
      // Tapped on/after start → it's the end (same-day = single-day window).
      setSelEnd(dk);
    }
  };

  const commit    = () => { onChange({ from: selStart || '', to: selEnd || '' }); setOpen(false); };
  const clearAll  = () => { setSelStart(null); setSelEnd(null); };
  const setOngoing = () => { setSelEnd(null); }; // keep start, no end date

  // Don't let the user page into months that are entirely in the past.
  const canPrev = calYear > now.getFullYear() || (calYear === now.getFullYear() && calMonth > now.getMonth());
  const prevMonth = () => {
    if (!canPrev) return;
    if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); }
    else setCalMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); }
    else setCalMonth((m) => m + 1);
  };

  const cells = buildMonthCells(calYear, calMonth);
  const tk    = todayKey();
  const hasValue = !!(from || to);

  return (
    <View>
      {/* ── Read-only field chips ── */}
      <View style={S.fieldRow}>
        <TouchableOpacity style={S.chip} onPress={openModal} activeOpacity={0.8}>
          <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
          <View style={{ flex: 1 }}>
            <Text style={S.chipLabel}>{t('rent.fromDate')}</Text>
            <Text style={[S.chipVal, !from && S.chipPlaceholder]} numberOfLines={1}>
              {fmtNice(from) || t('rent.selectDate', 'Select date')}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={S.chip} onPress={openModal} activeOpacity={0.8}>
          <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
          <View style={{ flex: 1 }}>
            <Text style={S.chipLabel}>{t('rent.toDate')}</Text>
            <Text style={[S.chipVal, !to && S.chipPlaceholder]} numberOfLines={1}>
              {fmtNice(to) || t('rent.ongoingShort', 'Ongoing')}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      <Text style={S.help}>
        {t('rent.availabilityHelp', 'Tap to pick when your listing is available. Leave the end date empty for ongoing availability.')}
      </Text>

      {hasValue ? (
        <TouchableOpacity onPress={() => onChange({ from: '', to: '' })} style={S.clearLink}>
          <Ionicons name="close-circle-outline" size={14} color={COLORS.error} />
          <Text style={S.clearLinkTxt}>{t('rent.clearDates', 'Clear dates')}</Text>
        </TouchableOpacity>
      ) : null}

      {/* ── Calendar modal ── */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={S.backdrop}>
          <View style={S.card}>
            <View style={S.cardHead}>
              <Text style={S.cardTitle}>{t('rent.availabilityDates')}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={COLORS.charcoal} />
              </TouchableOpacity>
            </View>

            {/* Selection summary */}
            <View style={S.sumRow}>
              <View style={[S.sumPill, selStart && S.sumPillActive]}>
                <Text style={[S.sumPillTxt, selStart && S.sumPillTxtActive]}>{fmtNice(selStart) || t('rent.fromDate')}</Text>
              </View>
              <Ionicons name="arrow-forward" size={14} color={COLORS.textLight} />
              <View style={[S.sumPill, selEnd && S.sumPillActive]}>
                <Text style={[S.sumPillTxt, selEnd && S.sumPillTxtActive]}>{fmtNice(selEnd) || t('rent.ongoingShort', 'Ongoing')}</Text>
              </View>
            </View>

            {/* Month nav */}
            <View style={S.calHead}>
              <TouchableOpacity onPress={prevMonth} disabled={!canPrev} style={[S.navBtn, !canPrev && { opacity: 0.3 }]}>
                <Ionicons name="chevron-back" size={20} color={COLORS.charcoal} />
              </TouchableOpacity>
              <Text style={S.monthTxt}>{t('weatherHome.' + MONTH_KEYS[calMonth])} {calYear}</Text>
              <TouchableOpacity onPress={nextMonth} style={S.navBtn}>
                <Ionicons name="chevron-forward" size={20} color={COLORS.charcoal} />
              </TouchableOpacity>
            </View>

            {/* Weekday header */}
            <View style={S.weekRow}>
              {DAY_KEYS.map((dk) => <Text key={dk} style={S.dayName}>{t('weatherHome.' + dk)}</Text>)}
            </View>

            {/* Day grid */}
            <View style={S.grid}>
              {cells.map((day, i) => {
                if (!day) return <View key={`e${i}`} style={S.cell} />;
                const dk      = dateKey(calYear, calMonth, day);
                const past    = isPastCell(calYear, calMonth, day);
                const isStart = dk === selStart;
                const isEnd   = dk === selEnd;
                const inRange = selStart && selEnd && dk > selStart && dk < selEnd;
                const isToday = dk === tk;

                let bg = 'transparent';
                let col = past ? COLORS.divider : COLORS.charcoal;
                if (inRange)          bg = COLORS.primary + '22';
                if (isStart || isEnd) { bg = COLORS.primary; col = COLORS.white; }

                return (
                  <TouchableOpacity
                    key={dk}
                    style={[S.cell, { backgroundColor: bg, borderRadius: 8 },
                      isToday && !isStart && !isEnd && { borderWidth: 1.5, borderColor: COLORS.primary }]}
                    disabled={past}
                    onPress={() => handleDayPress(dk)}
                  >
                    <Text style={[S.cellTxt, { color: col }]}>{day}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Secondary actions */}
            <View style={S.actRow}>
              <TouchableOpacity style={S.ghostBtn} onPress={setOngoing} disabled={!selStart}>
                <Ionicons name="infinite" size={15} color={selStart ? COLORS.primary : COLORS.grayLightMid} />
                <Text style={[S.ghostTxt, !selStart && { color: COLORS.grayLightMid }]}>{t('rent.markOngoing', 'No end date')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.ghostBtn} onPress={clearAll} disabled={!selStart && !selEnd}>
                <Ionicons name="refresh-outline" size={15} color={(selStart || selEnd) ? COLORS.error : COLORS.grayLightMid} />
                <Text style={[S.ghostTxt, { color: (selStart || selEnd) ? COLORS.error : COLORS.grayLightMid }]}>{t('rent.clear', 'Clear')}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={S.doneBtn} onPress={commit} activeOpacity={0.85}>
              <Ionicons name="checkmark" size={18} color={COLORS.white} />
              <Text style={S.doneTxt}>{t('rent.done')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  fieldRow: { flexDirection: 'row', gap: 12 },
  chip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.white, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.gray100alt,
    paddingHorizontal: 12, paddingVertical: 11,
  },
  chipLabel:       { fontSize: 11, color: COLORS.textLight, fontWeight: '600' },
  chipVal:         { fontSize: 14, color: COLORS.textDark, fontWeight: '700', marginTop: 1 },
  chipPlaceholder: { color: COLORS.grayLightMid, fontWeight: '500' },

  help:      { fontSize: 12, color: COLORS.textLight, marginTop: 8, lineHeight: 17 },
  clearLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-start' },
  clearLinkTxt: { fontSize: 12, color: COLORS.error, fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card:     { width: '100%', maxWidth: 400, backgroundColor: COLORS.white, borderRadius: 20, padding: 18 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  cardTitle:{ fontSize: 17, fontWeight: '800', color: COLORS.textDark },

  sumRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 14 },
  sumPill:  { borderWidth: 1.5, borderColor: COLORS.gray150, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, minWidth: 110, alignItems: 'center' },
  sumPillActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryPale },
  sumPillTxt:    { fontSize: 12, fontWeight: '700', color: COLORS.grayMid2 },
  sumPillTxtActive: { color: COLORS.primary },

  calHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  navBtn:   { padding: 8 },
  monthTxt: { fontSize: 15, fontWeight: '800', color: COLORS.textDark },

  weekRow:  { flexDirection: 'row', marginBottom: 4 },
  dayName:  { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700', color: COLORS.textLight },
  grid:     { flexDirection: 'row', flexWrap: 'wrap' },
  cell:     { width: `${100 / 7}%`, aspectRatio: 1, justifyContent: 'center', alignItems: 'center', padding: 2 },
  cellTxt:  { fontSize: 13, fontWeight: '600' },

  actRow:   { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, marginBottom: 14 },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 6 },
  ghostTxt: { fontSize: 13, fontWeight: '700', color: COLORS.primary },

  doneBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 14 },
  doneTxt:  { color: COLORS.white, fontSize: 15, fontWeight: '800' },
});

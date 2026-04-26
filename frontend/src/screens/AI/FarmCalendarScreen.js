/**
 * FarmCalendarScreen — AI-generated crop calendar with task tracking
 *
 * Tabs:
 *  - Today    : due + overdue tasks across all active calendars
 *  - Calendars: list of active calendars, create new
 *  - Create   : form to generate a new ICAR-based crop calendar
 */
import { COLORS } from '../../constants/colors';
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, StatusBar, FlatList, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../../context/LanguageContext';
import {
  getCropCalendars, getCalendarTodaysTasks, generateCropCalendar,
  updateCalendarTask, getCrops,
} from '../../services/aiApi';
import AnimatedScreen from '../../components/ui/AnimatedScreen';

const STATUS_CONFIG = {
  upcoming:   { color: COLORS.textMedium, icon: 'time-outline' },
  pending:    { color: COLORS.textMedium, icon: 'time-outline' },
  due:        { color: COLORS.amberDark, icon: 'alert-circle-outline' },
  overdue:    { color: COLORS.red, icon: 'warning-outline' },
  completed:  { color: COLORS.primary, icon: 'checkmark-circle-outline' },
  done:       { color: COLORS.primary, icon: 'checkmark-circle-outline' },
  skipped:    { color: COLORS.textMedium, icon: 'close-circle-outline' },
};

function TaskCard({ task, onDone, onSkip, language, t }) {
  const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.upcoming;
  const isDone = task.status === 'completed' || task.status === 'done' || task.status === 'skipped';
  // Backend uses: title, scheduledDate, description, calendar.crop
  const cropName = task.calendar?.crop || task.cropName || null;
  return (
    <View style={[S.taskCard, isDone && S.taskCardDone]}>
      <View style={[S.taskStatus, { backgroundColor: cfg.color + '20' }]}>
        <Ionicons name={cfg.icon} size={18} color={cfg.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[S.taskName, isDone && S.taskNameDone]}>{task.title || task.task}</Text>
        {cropName && <Text style={S.taskCrop}>{cropName}</Text>}
        {task.scheduledDate && (
          <Text style={[S.taskDate, task.status === 'overdue' && { color: COLORS.red }]}>
            {new Date(task.scheduledDate).toLocaleDateString()}
            {task.status === 'overdue' ? ` • ${t('farmCalendar.overdue')}` : ''}
          </Text>
        )}
        {task.description ? <Text style={S.taskNotes} numberOfLines={2}>{task.description}</Text> : null}
      </View>
      {!isDone && (
        <View style={S.taskActions}>
          <TouchableOpacity style={S.doneBtn} onPress={() => onDone(task.id)}>
            <Ionicons name="checkmark" size={16} color={COLORS.white} />
          </TouchableOpacity>
          <TouchableOpacity style={S.skipBtn} onPress={() => onSkip(task.id)}>
            <Ionicons name="close" size={16} color={COLORS.gray550} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function CreateCalendar({ language, t, onCreated, onCancel, crops }) {
  const [cropName, setCropName]     = useState('');
  const [sowingDate, setSowingDate] = useState('');
  const [season, setSeason]         = useState('kharif');
  const [cropModal, setCropModal]   = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);

  const currentYear = new Date().getFullYear();

  const handleCreate = async () => {
    if (!cropName || !sowingDate) {
      setError(t('farmCalendar.cropAndDateRequired'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await generateCropCalendar({
        crop: cropName,
        season,
        sowingDate,
        fieldName: '',
      });
      onCreated(result);
    } catch (err) {
      setError(err?.response?.data?.error?.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={S.createForm}>
      <Text style={S.createTitle}>{t('farmCalendar.newCropCalendar')}</Text>

      <TouchableOpacity style={S.cropSelect} onPress={() => setCropModal(true)}>
        <Ionicons name="leaf-outline" size={16} color={COLORS.primary} />
        <Text style={[S.cropSelectTxt, cropName && { color: COLORS.textDark }]}>
          {cropName || t('farmCalendar.selectCrop')}
        </Text>
        <Ionicons name="chevron-down" size={16} color={COLORS.oliveGreen} />
      </TouchableOpacity>

      <View style={S.rowInputs}>
        {['kharif','rabi','summer'].map(s => (
          <TouchableOpacity
            key={s}
            style={[S.seasonChip, season === s && S.seasonChipActive]}
            onPress={() => setSeason(s)}
          >
            <Text style={[S.seasonChipTxt, season === s && S.seasonChipTxtActive]}>
              {t(`farmCalendar.season_${s}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={S.fieldWrap}>
        <Text style={S.fieldLabel}>{t('farmCalendar.sowingDate')} *</Text>
        <TextInput
          style={S.input}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={COLORS.textLight}
          value={sowingDate}
          onChangeText={setSowingDate}
        />
      </View>

      {error ? <Text style={S.errorTxt}>{error}</Text> : null}

      <View style={S.createBtns}>
        <TouchableOpacity style={S.cancelBtn} onPress={onCancel}>
          <Text style={S.cancelTxt}>{t('farmCalendar.cancel')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[S.calcBtn, { flex: 1 }, loading && { opacity: 0.6 }]} onPress={handleCreate} disabled={loading}>
          {loading ? <ActivityIndicator color={COLORS.white} size="small" /> : (
            <Text style={S.calcTxt}>{t('farmCalendar.create')}</Text>
          )}
        </TouchableOpacity>
      </View>

      <Modal visible={cropModal} transparent animationType="slide">
        <View style={S.modalOverlay}>
          <View style={S.modalSheet}>
            <Text style={S.modalTitle}>{t('farmCalendar.selectCrop')}</Text>
            <FlatList
              windowSize={5}
              maxToRenderPerBatch={10}
              removeClippedSubviews
              data={crops}
              keyExtractor={(_, i) => String(i)}
              renderItem={({ item }) => (
                <TouchableOpacity style={S.modalItem} onPress={() => { setCropName(item.name); setCropModal(false); }}>
                  <Text style={S.modalItemTxt}>{item.name}</Text>
                  {item.nameHi ? <Text style={S.modalItemHi}>{item.nameHi}</Text> : null}
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={S.modalClose} onPress={() => setCropModal(false)}>
              <Text style={S.modalCloseTxt}>{t('farmCalendar.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default function FarmCalendarScreen({ navigation }) {
  const { language, t } = useLanguage();
  const [tab, setTab]           = useState('today');
  const [todayTasks, setToday]  = useState([]);
  const [calendars, setCals]    = useState([]);
  const [crops, setCrops]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [creating, setCreating] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      // Backend returns { today: [...], overdue: [...] }
      const result = await getCalendarTodaysTasks();
      const todayArr  = result?.today   || [];
      const overdueArr = result?.overdue || [];
      // Tag overdue tasks so the card can highlight them
      const merged = [
        ...overdueArr.map(t => ({ ...t, status: 'overdue' })),
        ...todayArr.map(t => ({ ...t, status: t.status || 'due' })),
      ];
      setToday(merged);
    } catch {}
    setLoading(false);
  }, []);

  const loadCals = useCallback(async () => {
    setLoading(true);
    try {
      const cals = await getCropCalendars();
      setCals(cals);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    getCrops().then(setCrops).catch(() => {});
    if (tab === 'today')     loadTasks();
    if (tab === 'calendars') loadCals();
  }, [tab]);

  const handleDone = async (taskId) => {
    await updateCalendarTask(taskId, 'completed').catch(() => {});
    setToday(prev => prev.map(t => t.id === taskId ? { ...t, status: 'done' } : t));
  };

  const handleSkip = async (taskId) => {
    await updateCalendarTask(taskId, 'skipped').catch(() => {});
    setToday(prev => prev.map(t => t.id === taskId ? { ...t, status: 'skipped' } : t));
  };

  const TABS = [
    { key: 'today',     label: t('farmCalendar.todaysTasks') },
    { key: 'calendars', label: t('farmCalendar.calendars') },
    { key: 'create',    label: t('farmCalendar.createNew') },
  ];

  return (
    <AnimatedScreen style={S.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>{t('farmCalendar.farmCalendar')}</Text>
          <Text style={S.headerSub}>{t('farmCalendar.icarbasedTaskSchedule')}</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.tabScroll} contentContainerStyle={S.tabContent}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={[S.tabBtn, tab === t.key && S.tabBtnActive]} onPress={() => setTab(t.key)}>
            <Text style={[S.tabTxt, tab === t.key && S.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {tab === 'today' && (
        loading ? (
          <View style={S.centered}><ActivityIndicator color={COLORS.primary} size="large" /></View>
        ) : (
          <FlatList
            windowSize={5}
            maxToRenderPerBatch={10}
            removeClippedSubviews
            data={todayTasks}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => (
              <TaskCard task={item} language={language} onDone={handleDone} onSkip={handleSkip} />
            )}
            contentContainerStyle={S.listContent}
            ListEmptyComponent={
              <View style={S.centered}>
                <Ionicons name="calendar-outline" size={48} color={COLORS.oliveGreen} />
                <Text style={S.emptyTxt}>{t('farmCalendar.noTasksForToday')}</Text>
                <Text style={S.emptySub}>{t('farmCalendar.createFromTab')}</Text>
              </View>
            }
          />
        )
      )}

      {tab === 'calendars' && (
        loading ? (
          <View style={S.centered}><ActivityIndicator color={COLORS.primary} size="large" /></View>
        ) : (
          <FlatList
            windowSize={5}
            maxToRenderPerBatch={10}
            removeClippedSubviews
            data={calendars}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={S.listContent}
            renderItem={({ item }) => (
              <View style={S.calCard}>
                <View style={S.calIcon}>
                  <Ionicons name="leaf" size={20} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.calCrop}>{item.crop}</Text>
                  <Text style={S.calMeta}>
                    {item.season} · {item.year}
                    {item.sowingDate ? ` · Sown ${new Date(item.sowingDate).toLocaleDateString()}` : ''}
                  </Text>
                </View>
                <View style={S.calStats}>
                  <Text style={[S.calStat, { color: COLORS.primary }]}>{item.stats?.total || 0}</Text>
                  <Text style={S.calStatLabel}>{t('farmCalendar.tasks')}</Text>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={S.centered}>
                <Ionicons name="calendar-outline" size={48} color={COLORS.oliveGreen} />
                <Text style={S.emptyTxt}>{t('farmCalendar.noCalendarsYet')}</Text>
                <TouchableOpacity style={S.createBtnSmall} onPress={() => setTab('create')}>
                  <Text style={S.createBtnSmallTxt}>{t('farmCalendar.createNew')}</Text>
                </TouchableOpacity>
              </View>
            }
          />
        )
      )}

      {tab === 'create' && (
        <ScrollView contentContainerStyle={{ padding: 18 }}>
          <CreateCalendar
            language={language}
            crops={crops}
            onCreated={(result) => {
              setTab('calendars');
              loadCals();
            }}
            onCancel={() => setTab('calendars')}
          />
        </ScrollView>
      )}
    </AnimatedScreen>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 52, paddingHorizontal: 18, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textDark },
  headerSub:   { fontSize: 10, color: COLORS.textLight, marginTop: 1 },

  tabScroll:  { flexGrow: 0 },
  tabContent: { paddingHorizontal: 18, paddingVertical: 12, gap: 8 },
  tabBtn: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  tabBtnActive:   { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabTxt:         { fontSize: 13, fontWeight: '700', color: COLORS.textMedium },
  tabTxtActive:   { color: COLORS.white },

  listContent: { padding: 18, paddingBottom: 40, gap: 10 },

  taskCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  taskCardDone: { opacity: 0.5 },
  taskStatus: { width: 36, height: 36, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  taskName:     { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  taskNameDone: { textDecorationLine: 'line-through', color: COLORS.textMedium },
  taskCrop: { fontSize: 11, color: COLORS.primary, fontWeight: '600', marginTop: 2 },
  taskDate: { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  taskNotes: { fontSize: 11, color: COLORS.textMedium, marginTop: 4, lineHeight: 16 },
  taskActions: { gap: 6 },
  doneBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center',
  },
  skipBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(107,114,128,0.15)', justifyContent: 'center', alignItems: 'center',
  },

  calCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  calIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(23,107,67,0.08)', justifyContent: 'center', alignItems: 'center' },
  calCrop: { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  calMeta: { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  calStats: { alignItems: 'center' },
  calStat:  { fontSize: 18, fontWeight: '900' },
  calStatLabel: { fontSize: 10, color: COLORS.textLight },

  createForm: { gap: 14 },
  createTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textDark },
  cropSelect: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cropSelectTxt: { flex: 1, fontSize: 14, color: COLORS.textMedium },
  rowInputs: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  seasonChip: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  seasonChipActive:    { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  seasonChipTxt:       { fontSize: 13, color: COLORS.textMedium, fontWeight: '700' },
  seasonChipTxtActive: { color: COLORS.white },
  fieldWrap: { gap: 6 },
  fieldLabel: { fontSize: 13, color: COLORS.textMedium, fontWeight: '600' },
  input: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: COLORS.border,
    color: COLORS.textBody, fontSize: 14,
  },
  errorTxt: { fontSize: 13, color: COLORS.error },
  createBtns: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    paddingHorizontal: 18, paddingVertical: 14,
    borderRadius: 14, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center',
  },
  cancelTxt: { fontSize: 14, color: COLORS.textMedium, fontWeight: '700' },
  calcBtn: {
    backgroundColor: COLORS.primary, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center',
  },
  calcTxt: { fontSize: 15, fontWeight: '800', color: COLORS.white },

  createBtnSmall: {
    marginTop: 12, backgroundColor: COLORS.primary, borderRadius: 10,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  createBtnSmallTxt: { fontSize: 14, fontWeight: '700', color: COLORS.white },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  emptyTxt: { fontSize: 15, color: COLORS.textMedium, fontWeight: '700', textAlign: 'center' },
  emptySub:  { fontSize: 12, color: COLORS.textLight, textAlign: 'center' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '60%', padding: 18 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textDark, marginBottom: 14 },
  modalItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border, flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalItemTxt: { fontSize: 14, color: COLORS.textBody, fontWeight: '600', flex: 1 },
  modalItemHi:  { fontSize: 13, color: COLORS.textLight },
  modalClose: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  modalCloseTxt: { fontSize: 14, color: COLORS.error, fontWeight: '700' },
});

import { useRef, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Dimensions, Animated, StatusBar, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPlannerTasks, updateTaskDone, generateAITasks } from '../../services/aiApi';
import { useLanguage } from '../../context/LanguageContext';
import { COLORS } from '../../constants/colors';

const { width: W } = Dimensions.get('window');

const PRIORITY = {
  urgent: { color: COLORS.red, bg: COLORS.darkMaroon, tKey: 'urgent' },
  today:  { color: COLORS.amberDark, bg: COLORS.darkAmber, tKey: 'today'  },
  plan:   { color: COLORS.primary, bg: COLORS.successLight, tKey: 'planned'},
};

const ALL_TASKS = [
  {
    id: 1, priority: 'urgent', done: false,
    title: 'Apply Mancozeb fungicide',
    crop: 'Tomato', field: 'Block A',
    time: 'Before 10 AM',
    icon: 'flask-outline', color: COLORS.red,
    detail: 'Mancozeb 75% WP @ 2g/litre. Mix 500ml in 15L pump. Cover rows 1–8.',
    aiReason: 'Early Blight signs detected 3 days ago. Humidity forecast 85% — act before rain.',
  },
  {
    id: 2, priority: 'urgent', done: false,
    title: 'Remove infected leaves',
    crop: 'Tomato', field: 'Block A',
    time: 'Morning',
    icon: 'cut-outline', color: COLORS.red,
    detail: 'Remove yellowing bottom leaves. Bag and burn — do not compost.',
    aiReason: 'Prevents blight from spreading. Complements fungicide application.',
  },
  {
    id: 3, priority: 'today', done: false,
    title: 'Irrigate field Block 2',
    crop: 'Wheat', field: 'Block 2',
    time: '5–8 PM',
    icon: 'water-outline', color: COLORS.blue,
    detail: 'Run drip system zone 2 for 3 hours. Check soil moisture sensor before starting.',
    aiReason: 'Soil moisture at 28% (below 35% threshold). Next rain not expected till Friday.',
  },
  {
    id: 4, priority: 'today', done: false,
    title: 'Monitor aphid traps',
    crop: 'Cotton', field: 'Block C',
    time: 'Afternoon',
    icon: 'bug-outline', color: COLORS.amberDark,
    detail: 'Check yellow sticky traps. If >50 aphids/trap, trigger spray protocol.',
    aiReason: 'High aphid pressure forecast based on temperature (28°C) and humidity.',
  },
  {
    id: 5, priority: 'plan', done: false,
    title: 'Soil sampling — Block D',
    crop: 'Fallow', field: 'Block D',
    time: 'This week',
    icon: 'earth-outline', color: COLORS.tangerine,
    detail: 'Collect 10 samples zigzag pattern. Send to Krishi Kendra.',
    aiReason: 'Soil Health Card due renewal. Last test was 24 months ago.',
  },
  {
    id: 6, priority: 'plan', done: false,
    title: 'Market visit — Nashik Mandi',
    crop: 'Tomato', field: '',
    time: 'Thursday',
    icon: 'storefront-outline', color: COLORS.purple,
    detail: 'Current rate ₹2,150/q. Take 5 crates for price testing. Negotiate minimum ₹2,300.',
    aiReason: 'Prices forecasted to rise 8–12% by Thursday based on supply data.',
  },
];

function TaskItem({ task, onToggle, t }) {
  const p  = PRIORITY[task.priority];
  const [open, setOpen] = useState(false);
  const rot = useRef(new Animated.Value(0)).current;
  const height = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    Animated.parallel([
      Animated.timing(rot,    { toValue: next ? 1 : 0, duration: 240, useNativeDriver: true }),
      Animated.timing(height, { toValue: next ? 1 : 0, duration: 240, useNativeDriver: false }),
    ]).start();
  };

  const chevronRot = rot.interpolate({ inputRange: [0,1], outputRange: ['0deg', '180deg'] });

  return (
    <View style={[T.item, { backgroundColor: task.doneAt ? COLORS.nearBlack2 : p.bg, borderColor: task.doneAt ? 'rgba(255,255,255,0.04)' : `${p.color}25` }]}>
      <TouchableOpacity style={T.itemTop} onPress={toggle} activeOpacity={0.8}>
        <TouchableOpacity style={[T.checkbox, task.doneAt && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]} onPress={() => onToggle(task.id)}>
          {task.doneAt && <Ionicons name="checkmark" size={14} color={COLORS.white} />}
        </TouchableOpacity>
        <View style={[T.taskIcon, { backgroundColor: `${task.color}18` }]}>
          <Ionicons name={task.icon} size={16} color={task.doneAt ? COLORS.grayMid2 : task.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[T.taskTitle, task.doneAt && T.taskDone]}>{task.title}</Text>
          <View style={T.taskMeta}>
            <Ionicons name="leaf-outline" size={10} color={COLORS.grayMedium} />
            <Text style={T.taskMetaText}>{task.crop}{task.field ? ` · ${task.field}` : ''}</Text>
            <View style={T.metaDot} />
            <Ionicons name="time-outline" size={10} color={COLORS.grayMedium} />
            <Text style={T.taskMetaText}>{t(`planner.${PRIORITY[task.priority]?.tKey || 'today'}`)}</Text>
          </View>
        </View>
        <View style={[T.priorityPill, { backgroundColor: `${p.color}15` }]}>
          <Text style={[T.priorityText, { color: p.color }]}>{t(`planner.${p.tKey}`)}</Text>
        </View>
        <Animated.View style={{ transform: [{ rotate: chevronRot }], marginLeft: 4 }}>
          <Ionicons name="chevron-down" size={14} color={COLORS.grayMid2} />
        </Animated.View>
      </TouchableOpacity>

      {open && (
        <View style={T.expanded}>
          <View style={T.expandedDiv} />
          <Text style={T.expandedDetail}>{task.description}</Text>
          <View style={T.aiReason}>
            <Ionicons name="hardware-chip-outline" size={12} color={COLORS.primary} />
            <Text style={T.aiReasonText}>{task.aiReason}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

export default function DailyPlannerScreen({ navigation }) {
  const insets  = useSafeAreaInsets();
  const { t }   = useLanguage();
  const [tasks, setTasks]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGen]  = useState(false);
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  const done  = tasks.filter(t => !!t.doneAt).length;
  const total = tasks.length;
  const pct   = total > 0 ? done / total : 0;

  const progAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progAnim, { toValue: pct, duration: 500, useNativeDriver: false }).start();
  }, [pct]);

  // Load from API on mount
  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const fetched = await getPlannerTasks();
      setTasks(fetched);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (showLoading = true) => {
    if (showLoading) setGen(true);
    try {
      const newTasks = await generateAITasks({ crop: 'Tomato', state: 'Maharashtra', dayOfSeason: 45 });
      setTasks(newTasks);
    } catch {
      // Keep existing tasks if generation fails
    } finally {
      if (showLoading) setGen(false);
    }
  };

  const toggle = async (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const nowDone = !task.doneAt;
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === id ? { ...t, doneAt: nowDone ? new Date().toISOString() : null } : t));
    try {
      await updateTaskDone(id, nowDone);
    } catch {
      // Revert on failure
      setTasks(prev => prev.map(t => t.id === id ? { ...t, doneAt: task.doneAt } : t));
    }
  };

  const urgent    = tasks.filter(t => t.priority === 'urgent' && !t.doneAt);
  const today_    = tasks.filter(t => t.priority === 'today'  && !t.doneAt);
  const planned   = tasks.filter(t => t.priority === 'plan'   && !t.doneAt);
  const doneTasks = tasks.filter(t => !!t.doneAt);

  const renderSection = (label, items, dotColor) => {
    if (items.length === 0) return null;
    return (
      <View style={T.section}>
        <View style={T.sectionHeader}>
          <View style={[T.sectionDot, { backgroundColor: dotColor }]} />
          <Text style={T.sectionTitle}>{label}</Text>
          <View style={[T.countBadge, { backgroundColor: `${dotColor}15` }]}>
            <Text style={[T.countText, { color: dotColor }]}>{items.length}</Text>
          </View>
        </View>
        {items.map(item => <TaskItem key={item.id} task={item} onToggle={toggle} t={t} />)}
      </View>
    );
  };

  return (
    <View style={T.root}>
      <StatusBar barStyle="dark-content" />

      {/* ── Header ── */}
      <View style={[T.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={T.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={T.headerTitle}>{t('planner.title')}</Text>
          <Text style={T.headerSub}>{today}</Text>
        </View>
        <TouchableOpacity style={T.aiGenBtn} onPress={() => handleGenerate(true)} activeOpacity={0.8} disabled={generating}>
          {generating
            ? <ActivityIndicator size="small" color={COLORS.amberDark} />
            : <Ionicons name="sparkles-outline" size={14} color={COLORS.amberDark} />}
          <Text style={T.aiGenText}>{generating ? t('planner.generating') : t('planner.regenerate')}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Progress bar ── */}
      <View style={T.progressCard}>
        <View style={T.progressTop}>
          <Text style={T.progressLabel}>{t('planner.tasksComplete', { done, total })}</Text>
          <Text style={T.progressPct}>{Math.round(pct * 100)}%</Text>
        </View>
        <View style={T.progressBg}>
          <Animated.View style={[T.progressFill, {
            width: progAnim.interpolate({ inputRange: [0,1], outputRange: ['0%', '100%'] }),
          }]} />
        </View>
        {done === total && total > 0 && (
          <View style={T.allDoneRow}>
            <Ionicons name="checkmark-circle" size={14} color={COLORS.primary} />
            <Text style={T.allDoneText}>{t('planner.allTasksDone')}</Text>
          </View>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={T.list}>
        {loading ? (
          <View style={{ alignItems: 'center', paddingVertical: 48 }}>
            <ActivityIndicator color={COLORS.primary} size="large" />
            <Text style={{ color: COLORS.textBody, marginTop: 12, fontSize: 13 }}>{t('planner.generatingAI')}</Text>
          </View>
        ) : tasks.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Ionicons name="checkmark-done-circle-outline" size={48} color={COLORS.textDark} />
            <Text style={{ color: COLORS.textBody, marginTop: 10, fontSize: 14 }}>{t('planner.noTasks')}</Text>
            <TouchableOpacity onPress={() => handleGenerate(true)} style={{ marginTop: 14, backgroundColor: 'rgba(46,204,113,0.12)', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}>
              <Text style={{ color: COLORS.primary, fontWeight: '700' }}>{t('planner.generateWithAI')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {renderSection(t('planner.sectionUrgent'), urgent, COLORS.red)}
            {renderSection(t('planner.sectionToday'), today_, COLORS.amberDark)}
            {renderSection(t('planner.sectionPlanned'), planned, COLORS.primary)}
            {doneTasks.length > 0 && renderSection(t('planner.sectionDone'), doneTasks, COLORS.grayMid2)}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const T = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 18, paddingBottom: 12,
  },
  backBtn:     { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: COLORS.slate800 },
  headerSub:   { fontSize: 11, color: COLORS.gray350, marginTop: 1 },
  aiGenBtn:    {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(243,156,18,0.1)',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(243,156,18,0.2)',
  },
  aiGenText: { fontSize: 11, fontWeight: '700', color: COLORS.amberDark },

  // Progress
  progressCard: {
    marginHorizontal: 18, marginBottom: 8,
    backgroundColor: COLORS.white,
    borderRadius: 16, padding: 16, gap: 10,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: COLORS.black, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  progressTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressLabel:{ fontSize: 13, color: COLORS.textMedium, fontWeight: '600' },
  progressPct:  { fontSize: 16, fontWeight: '900', color: COLORS.primary },
  progressBg:   { height: 6, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 3 },
  allDoneRow:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  allDoneText:  { fontSize: 12, color: COLORS.primary, fontWeight: '600' },

  // Sections
  list:        { paddingHorizontal: 18, paddingBottom: 48 },
  section:     { marginTop: 16 },
  sectionHeader:{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sectionDot:  { width: 6, height: 6, borderRadius: 3 },
  sectionTitle:{ fontSize: 11, fontWeight: '900', color: COLORS.gray350, letterSpacing: 1.2, textTransform: 'uppercase', flex: 1 },
  countBadge:  { width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  countText:   { fontSize: 11, fontWeight: '900' },

  // Task item
  item: {
    borderRadius: 14, padding: 14, marginBottom: 8,
    borderWidth: 1,
    backgroundColor: COLORS.white,
    shadowColor: COLORS.black, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, flexShrink: 0,
    borderWidth: 1.5, borderColor: COLORS.gray175,
    justifyContent: 'center', alignItems: 'center',
  },
  taskIcon:     { width: 34, height: 34, borderRadius: 9, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  taskTitle:    { fontSize: 13, fontWeight: '700', color: COLORS.slate800, marginBottom: 4 },
  taskDone:     { textDecorationLine: 'line-through', color: COLORS.gray350 },
  taskMeta:     { flexDirection: 'row', alignItems: 'center', gap: 3 },
  taskMetaText: { fontSize: 10, color: COLORS.gray350 },
  metaDot:      { width: 3, height: 3, borderRadius: 2, backgroundColor: COLORS.gray175, marginHorizontal: 2 },
  priorityPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  priorityText: { fontSize: 10, fontWeight: '700' },

  // Expanded
  expanded:       { paddingTop: 10, gap: 8 },
  expandedDiv:    { height: 1, backgroundColor: 'rgba(0,0,0,0.06)' },
  expandedDetail: { fontSize: 13, color: COLORS.textMedium, lineHeight: 19 },
  aiReason: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    backgroundColor: 'rgba(46,204,113,0.08)',
    borderRadius: 8, padding: 10,
  },
  aiReasonText: { flex: 1, fontSize: 11, color: COLORS.textMedium, lineHeight: 16 },
});

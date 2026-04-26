/**
 * MyRentListingsScreen — Manage your own machinery & labour listings.
 * Shows two tabs: Machinery | Workers
 * Each card has Edit (navigate to prefilled form) and Delete (with confirm).
 */
import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, Image, StatusBar, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import api from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import { COLORS } from '../../constants/colors';

const RED   = COLORS.error;

const MACH_CATS = {
  tractor: { icon: 'construct-outline', color: COLORS.blue },
  harvester: { icon: 'leaf-outline', color: COLORS.purpleDark },
  sprayer: { icon: 'water-outline', color: COLORS.tealDarkAlt },
  rotavator: { icon: 'refresh-circle-outline', color: COLORS.cta },
  thresher: { icon: 'aperture-outline', color: COLORS.error },
  transplanter: { icon: 'git-branch-outline', color: COLORS.primaryLight },
  truck: { icon: 'bus-outline', color: COLORS.blueSteel },
  tempo: { icon: 'car-outline', color: COLORS.brownAlt },
  other: { icon: 'ellipsis-horizontal', color: COLORS.grayMid },
};

// ── Machinery card ─────────────────────────────────────────────────────────────
function MachineryCard({ item, onEdit, onDelete, t }) {
  const cat = MACH_CATS[item.category] || MACH_CATS.other;
  return (
    <View style={S.card}>
      <View style={S.cardTop}>
        {/* Thumbnail */}
        <View style={[S.thumb, { backgroundColor: cat.color + '15' }]}>
          {item.images?.[0]
            ? <Image source={{ uri: item.images[0] }} style={S.thumbImg} />
            : <Ionicons name={cat.icon} size={28} color={cat.color} />
          }
        </View>

        {/* Info */}
        <View style={S.cardInfo}>
          <Text style={S.cardName} numberOfLines={1}>{item.name}</Text>
          {item.brand ? <Text style={S.cardSub}>{item.brand}{item.horsePower ? ` • ${item.horsePower}` : ''}</Text> : null}
          <Text style={S.cardPrice}>₹{item.pricePerDay?.toLocaleString()}/day</Text>
          <View style={[S.statusBadge, { backgroundColor: item.available ? COLORS.primaryPale : COLORS.orangeWarm }]}>
            <View style={[S.statusDot, { backgroundColor: item.available ? COLORS.primary : COLORS.cta }]} />
            <Text style={[S.statusTxt, { color: item.available ? COLORS.primary : COLORS.cta }]}>
              {item.available ? t('rent.listAvailable') : t('rent.listAdvanceBooking')}
            </Text>
          </View>
        </View>
      </View>

      <View style={S.cardMeta}>
        <Ionicons name="location-outline" size={12} color={COLORS.grayMedium} />
        <Text style={S.cardLoc}>{item.location}, {item.district}</Text>
      </View>

      {/* Actions */}
      <View style={S.actionRow}>
        <TouchableOpacity style={S.editBtn} onPress={() => onEdit(item)}>
          <Ionicons name="pencil-outline" size={15} color={COLORS.primary} />
          <Text style={S.editBtnTxt}>{t('rent.edit')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={S.deleteBtn} onPress={() => onDelete(item, 'machinery')}>
          <Ionicons name="trash-outline" size={15} color={RED} />
          <Text style={S.deleteBtnTxt}>{t('rent.delete')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Labour card ────────────────────────────────────────────────────────────────
function LabourCard({ item, onEdit, onDelete, t }) {
  const initials = (item.leader || item.name || 'W')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <View style={S.card}>
      <View style={S.cardTop}>
        {/* Avatar */}
        <View style={[S.thumb, { backgroundColor: COLORS.primary + '15' }]}>
          {item.image
            ? <Image source={{ uri: item.image }} style={S.thumbImg} />
            : <Text style={S.initials}>{initials}</Text>
          }
        </View>

        <View style={S.cardInfo}>
          <Text style={S.cardName} numberOfLines={1}>{item.leader || item.name}</Text>
          <Text style={S.cardSub}>{item.name}{item.groupSize > 1 ? ` • ${t('rent.workersCount', { count: item.groupSize })}` : ''}</Text>
          <Text style={S.cardPrice}>₹{item.pricePerDay?.toLocaleString()}/day</Text>
          <View style={[S.statusBadge, { backgroundColor: item.available ? COLORS.primaryPale : COLORS.orangeWarm }]}>
            <View style={[S.statusDot, { backgroundColor: item.available ? COLORS.primary : COLORS.cta }]} />
            <Text style={[S.statusTxt, { color: item.available ? COLORS.primary : COLORS.cta }]}>
              {item.available ? t('rent.listAvailable') : t('rent.listAdvanceBooking')}
            </Text>
          </View>
        </View>
      </View>

      <View style={S.skillsRow}>
        {(item.skills || []).slice(0, 3).map((s, i) => (
          <View key={i} style={S.skillTag}>
            <Text style={S.skillTagTxt}>{s}</Text>
          </View>
        ))}
      </View>

      <View style={S.cardMeta}>
        <Ionicons name="location-outline" size={12} color={COLORS.grayMedium} />
        <Text style={S.cardLoc}>{item.location}, {item.district}</Text>
      </View>

      <View style={S.actionRow}>
        <TouchableOpacity style={S.editBtn} onPress={() => onEdit(item)}>
          <Ionicons name="pencil-outline" size={15} color={COLORS.primary} />
          <Text style={S.editBtnTxt}>{t('rent.edit')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={S.deleteBtn} onPress={() => onDelete(item, 'labour')}>
          <Ionicons name="trash-outline" size={15} color={RED} />
          <Text style={S.deleteBtnTxt}>{t('rent.delete')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────
export default function MyRentListingsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  const [tab,       setTab]       = useState('machinery');
  const [machinery, setMachinery] = useState([]);
  const [labour,    setLabour]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [deleting,  setDeleting]  = useState(null); // id being deleted

  const fetchMyListings = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, lRes] = await Promise.allSettled([
        api.get('/rent/machinery/my'),
        api.get('/rent/labour/my'),
      ]);
      setMachinery(mRes.status === 'fulfilled' ? (mRes.value.data?.data || []) : []);
      setLabour(lRes.status === 'fulfilled'    ? (lRes.value.data?.data || []) : []);
    } catch {
      // keep empty
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload every time this screen is focused (e.g. after edit)
  useFocusEffect(useCallback(() => { fetchMyListings(); }, [fetchMyListings]));

  const handleDelete = (item, type) => {
    Alert.alert(
      t('rent.confirmDelete'),
      t('rent.confirmDeleteMsg'),
      [
        { text: t('rent.cancel'), style: 'cancel' },
        {
          text: t('rent.delete'), style: 'destructive',
          onPress: async () => {
            setDeleting(item.id);
            try {
              await api.delete(`/rent/${type}/${item.id}`);
              if (type === 'machinery') setMachinery(prev => prev.filter(m => m.id !== item.id));
              else                      setLabour(prev => prev.filter(l => l.id !== item.id));
            } catch (e) {
              Alert.alert(t('rent.error'), e?.response?.data?.error?.message || t('rent.deleteError'));
            } finally {
              setDeleting(null);
            }
          },
        },
      ]
    );
  };

  const handleEdit = (item, type) => {
    if (type === 'machinery' || !type) {
      navigation.navigate('AddMachinery', { listing: item, editMode: true });
    } else {
      navigation.navigate('AddWorker', { listing: item, editMode: true });
    }
  };

  const items    = tab === 'machinery' ? machinery : labour;
  const isEmpty  = !loading && items.length === 0;

  return (
    <View style={[S.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.charcoal} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>{t('rent.myRentListings')}</Text>
          <Text style={S.headerSub}>{t('rent.manageListings')}</Text>
        </View>
        <TouchableOpacity
          style={S.addBtn}
          onPress={() => navigation.navigate(tab === 'machinery' ? 'AddMachinery' : 'AddWorker')}
        >
          <Ionicons name="add-circle" size={28} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={S.tabBar}>
        {[
          { key: 'machinery', label: `${t('rent.machineryTab')} (${machinery.length})`, icon: 'construct-outline' },
          { key: 'labour',    label: `${t('rent.workersTab')} (${labour.length})`,      icon: 'people-outline'    },
        ].map(tb => (
          <TouchableOpacity
            key={tb.key}
            style={[S.tabItem, tab === tb.key && S.tabItemActive]}
            onPress={() => setTab(tb.key)}
          >
            <Ionicons name={tb.icon} size={15} color={tab === tb.key ? COLORS.primary : COLORS.grayMedium} />
            <Text style={[S.tabTxt, tab === tb.key && S.tabTxtActive]}>{tb.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={S.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : isEmpty ? (
        <View style={S.center}>
          <Ionicons name={tab === 'machinery' ? 'construct-outline' : 'people-outline'} size={60} color={COLORS.divider} />
          <Text style={S.emptyTitle}>{tab === 'machinery' ? t('rent.noMachineryListed') : t('rent.noLabourListed')}</Text>
          <Text style={S.emptySub}>{t('rent.tapToAdd')}</Text>
          <TouchableOpacity
            style={S.addFirstBtn}
            onPress={() => navigation.navigate(tab === 'machinery' ? 'AddMachinery' : 'AddWorker')}
          >
            <Ionicons name="add" size={16} color={COLORS.primary} />
            <Text style={S.addFirstTxt}>
              {tab === 'machinery' ? t('rent.listMachinery') : t('rent.registerAsWorker')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={10}
          removeClippedSubviews
          data={items}
          keyExtractor={i => i.id}
          contentContainerStyle={S.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchMyListings} colors={[COLORS.primary]} />}
          renderItem={({ item }) =>
            tab === 'machinery' ? (
              <View style={{ opacity: deleting === item.id ? 0.5 : 1 }}>
                <MachineryCard
                  item={item}
                  onEdit={i => handleEdit(i, 'machinery')}
                  onDelete={i => handleDelete(i, 'machinery')}
                  t={t}
                />
              </View>
            ) : (
              <View style={{ opacity: deleting === item.id ? 0.5 : 1 }}>
                <LabourCard
                  item={item}
                  onEdit={i => handleEdit(i, 'labour')}
                  onDelete={i => handleDelete(i, 'labour')}
                  t={t}
                />
              </View>
            )
          }
        />
      )}
    </View>
  );
}

const S = StyleSheet.create({
  root:        { flex: 1, backgroundColor: COLORS.background },
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.lightGray2, gap: 10 },
  backBtn:     { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: COLORS.textDark },
  headerSub:   { fontSize: 11, color: COLORS.textLight, marginTop: 1 },
  addBtn:      { padding: 4 },

  tabBar:       { flexDirection: 'row', backgroundColor: COLORS.white, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightGray2 },
  tabItem:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  tabItemActive:{ borderBottomColor: COLORS.primary },
  tabTxt:       { fontSize: 13, fontWeight: '600', color: COLORS.textLight },
  tabTxtActive: { color: COLORS.primary, fontWeight: '800' },

  list: { padding: 14, gap: 12 },

  card: {
    backgroundColor: COLORS.white, borderRadius: 16, padding: 14,
    shadowColor: COLORS.black, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  cardTop:  { flexDirection: 'row', gap: 12, marginBottom: 8 },
  thumb:    { width: 70, height: 70, borderRadius: 12, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%' },
  initials: { fontSize: 22, fontWeight: '800', color: COLORS.primary },
  cardInfo: { flex: 1, gap: 3 },
  cardName: { fontSize: 15, fontWeight: '800', color: COLORS.textDark },
  cardSub:  { fontSize: 12, color: COLORS.textLight },
  cardPrice:{ fontSize: 14, fontWeight: '700', color: COLORS.primary },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, marginTop: 2 },
  statusDot:   { width: 6, height: 6, borderRadius: 3 },
  statusTxt:   { fontSize: 10, fontWeight: '700' },

  skillsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 6 },
  skillTag:  { backgroundColor: COLORS.grayLight, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  skillTagTxt: { fontSize: 10, color: COLORS.grayMid2, fontWeight: '600' },

  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
  cardLoc:  { fontSize: 12, color: COLORS.textLight, flex: 1 },

  actionRow:   { flexDirection: 'row', gap: 10 },
  editBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 10, paddingVertical: 9 },
  editBtnTxt:  { fontSize: 13, fontWeight: '700', color: COLORS.primary },
  deleteBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: RED, borderRadius: 10, paddingVertical: 9 },
  deleteBtnTxt:{ fontSize: 13, fontWeight: '700', color: RED },

  center:      { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  emptyTitle:  { fontSize: 16, fontWeight: '700', color: COLORS.grayLight2, marginTop: 8 },
  emptySub:    { fontSize: 13, color: COLORS.grayLightMid },
  addFirstBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  addFirstTxt: { color: COLORS.primary, fontSize: 13, fontWeight: '700' },
});

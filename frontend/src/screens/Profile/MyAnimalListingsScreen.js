/**
 * MyAnimalListingsScreen — shows the user's own animal listings
 */
import { COLORS } from '../../constants/colors';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, Platform, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import AnimalIcon from '../../components/AnimalIcons';

function ListingCard({ item, onDelete, onEdit }) {
  const { t } = useLanguage();
  const firstImg = item.images?.[0];
  const price    = typeof item.price === 'number' ? item.price : parseFloat(item.price || 0);
  const date     = item.createdAt
    ? new Date(item.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  return (
    <View style={styles.card}>
      <View style={styles.cardInner}>
        {firstImg ? (
          <Image source={{ uri: firstImg }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="paw-outline" size={28} color={COLORS.textMedium} />
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.animalName} numberOfLines={1}>
            {item.animal} — {item.breed}
          </Text>
          <Text style={styles.detail}>{item.age} · {item.gender}</Text>
          <Text style={styles.location} numberOfLines={1}>
            <Ionicons name="location-outline" size={12} color={COLORS.textMedium} /> {item.sellerLocation}
          </Text>
          <Text style={styles.price}>₹{price.toLocaleString('en-IN')}</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <Ionicons name="eye-outline" size={13} color={COLORS.textMedium} />
          <Text style={styles.footerTxt}>{t('myAnimalListings.viewsCount', { count: item.viewCount ?? 0 })}</Text>
          <Text style={[styles.footerTxt, { marginLeft: 10 }]}>{date}</Text>
        </View>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onEdit(item)}>
          <Ionicons name="create-outline" size={18} color={COLORS.primary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onDelete(item)}>
          <Ionicons name="trash-outline" size={18} color={COLORS.error} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function MyAnimalListingsScreen({ navigation }) {
  const { t } = useLanguage();
  const [listings,   setListings]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);
  // Delete-confirm modal: the listing being asked about, or null.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting,      setDeleting]      = useState(false);

  const fetchListings = useCallback(async (refresh = false) => {
    try {
      setError(null);
      const { data } = await api.get('/animals/my');
      setListings(data.data || []);
    } catch (e) {
      setError(e?.response?.data?.error?.message || t('myAnimalListings.loadError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  // Refresh on focus so a newly-posted listing shows up immediately
  useFocusEffect(
    useCallback(() => {
      fetchListings();
    }, [fetchListings])
  );

  const handleRefresh = () => { setRefreshing(true); fetchListings(true); };

  // The card's trash button just opens the confirm modal — the actual API
  // call fires from the modal's "Delete" button below. Using a state-driven
  // Modal is required because RN's Alert.alert multi-button confirm does NOT
  // work on React Native for Web (silently drops the buttons).
  const requestDelete = (item) => setPendingDelete(item);

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    const id = pendingDelete.id;
    try {
      await api.delete(`/animals/${id}`);
      setListings((prev) => prev.filter((l) => l.id !== id));
      setPendingDelete(null);
    } catch (e) {
      const msg = e?.response?.data?.error?.message
        || e?.message
        || t('myAnimalListings.deleteFailedMsg');
      setPendingDelete(null);
      // Brief alert for the error case — single-button alerts work fine on web.
      Alert.alert(t('rent.deleteError'), msg);
    } finally {
      setDeleting(false);
    }
  };

  const handleEdit = (item) => {
    navigation.navigate('AnimalTrade', {
      screen: 'AddAnimalListing',
      params: { listing: item },
    });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('profile.myListingsTitle')}</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('AnimalTrade', { screen: 'AddAnimalListing' })}
        >
          <Ionicons name="add" size={24} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.error} />
          <Text style={styles.errorTxt}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchListings()}>
            <Text style={styles.retryTxt}>{t('profile.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={10}
          removeClippedSubviews
          data={listings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          renderItem={({ item }) => <ListingCard item={item} onDelete={requestDelete} onEdit={handleEdit} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[COLORS.primary]} />}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <AnimalIcon type="All" size={64} />
              <Text style={styles.emptyTitle}>{t('profile.noListingsYet')}</Text>
              <Text style={styles.emptySubtitle}>{t('myAnimalListings.emptySubtitle')}</Text>
              <TouchableOpacity
                style={[styles.retryBtn, { marginTop: 12 }]}
                onPress={() => navigation.navigate('AnimalTrade', { screen: 'AddAnimalListing' })}
              >
                <Text style={styles.retryTxt}>{t('profile.addListing')}</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* Delete confirmation — Modal works on iOS / Android / Web; multi-button
          Alert.alert does NOT work on web. */}
      <Modal
        visible={!!pendingDelete}
        transparent
        animationType="fade"
        onRequestClose={() => !deleting && setPendingDelete(null)}
      >
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmIconCircle}>
              <Ionicons name="trash" size={28} color={COLORS.error} />
            </View>
            <Text style={styles.confirmTitle}>{t('profile.removeListingTitle')}</Text>
            <Text style={styles.confirmBody}>
              {pendingDelete
                ? t('myAnimalListings.removeBody', { name: `${pendingDelete.animal}${pendingDelete.breed ? ' — ' + pendingDelete.breed : ''}` })
                : t('farmProfile.deleteConfirm')}
            </Text>
            <View style={styles.confirmBtnRow}>
              <TouchableOpacity
                disabled={deleting}
                style={[styles.confirmBtn, styles.confirmBtnSecondary]}
                onPress={() => setPendingDelete(null)}
              >
                <Text style={styles.confirmBtnTextSecondary}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={deleting}
                style={[styles.confirmBtn, styles.confirmBtnDanger, deleting && { opacity: 0.6 }]}
                onPress={confirmDelete}
              >
                {deleting
                  ? <ActivityIndicator color={COLORS.white} />
                  : <Text style={styles.confirmBtnTextDanger}>{t('rent.delete')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface, paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    paddingTop: Platform.OS === 'android' ? 44 : 12,
  },
  backBtn:     { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: COLORS.textDark },
  addBtn:      { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },

  card: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden',
    shadowColor: COLORS.black, shadowOpacity: 0.05,
    shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardInner: { flexDirection: 'row', padding: 14 },
  thumb:     { width: 72, height: 72, borderRadius: 10, backgroundColor: COLORS.grayBg },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },

  animalName: { fontSize: 15, fontWeight: '700', color: COLORS.textDark, marginBottom: 3 },
  detail:     { fontSize: 12, color: COLORS.textMedium, marginBottom: 2 },
  location:   { fontSize: 12, color: COLORS.textMedium, marginBottom: 4 },
  price:      { fontSize: 16, fontWeight: '800', color: COLORS.primary },

  footer:      { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.border, paddingHorizontal: 14, paddingVertical: 10 },
  footerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  footerTxt:   { fontSize: 12, color: COLORS.textMedium },
  actionBtn:   { padding: 6, marginLeft: 4 },
  deleteBtn:   { padding: 6 },

  errorTxt: { fontSize: 15, color: COLORS.error, textAlign: 'center' },
  retryBtn: { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10, marginTop: 8 },
  retryTxt: { color: COLORS.white, fontWeight: '700', fontSize: 15 },

  emptyTitle:    { fontSize: 18, fontWeight: '700', color: COLORS.gray700dark, marginTop: 12 },
  emptySubtitle: { fontSize: 14, color: COLORS.textMedium, textAlign: 'center', marginTop: 4 },

  confirmBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  confirmCard: {
    width: '100%', maxWidth: 360, backgroundColor: COLORS.surface,
    borderRadius: 18, padding: 22, alignItems: 'center',
    shadowColor: COLORS.black, shadowOpacity: 0.15, shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 }, elevation: 6,
  },
  confirmIconCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  confirmTitle: {
    fontSize: 18, fontWeight: '800', color: COLORS.textDark,
    textAlign: 'center', marginBottom: 6,
  },
  confirmBody: {
    fontSize: 14, color: COLORS.textMedium, textAlign: 'center',
    lineHeight: 20, marginBottom: 18,
  },
  confirmBtnRow: { flexDirection: 'row', gap: 10, width: '100%' },
  confirmBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmBtnSecondary: { backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border },
  confirmBtnDanger:    { backgroundColor: COLORS.error },
  confirmBtnTextSecondary: { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  confirmBtnTextDanger:    { fontSize: 15, fontWeight: '800', color: COLORS.white },
});

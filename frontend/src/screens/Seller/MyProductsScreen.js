import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, SafeAreaView,
  Alert, Switch, Image, Animated, Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '../../utils/haptics';
import { COLORS, SHADOWS, RADIUS } from '../../constants/colors';
import { useLanguage } from '../../context/LanguageContext';
import api from '../../services/api';

const UNIT_LABELS = { kg: 'kg', g: 'g', litre: 'L', ml: 'ml', piece: 'pc', bag: 'bag', packet: 'pkt', acre: 'acre', quintal: 'qtl' };

function ProductCard({ item, onEdit, onDelete, onToggle, index = 0 }) {
  const { t } = useLanguage();
  const image      = item.images?.[0];
  const unit       = UNIT_LABELS[item.unit] || item.unit;
  const translateY = useRef(new Animated.Value(40)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, tension: 70, friction: 9, delay: index * 60, useNativeDriver: true }),
      Animated.timing(opacity,    { toValue: 1, duration: 380, delay: index * 60, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[s.card, { transform: [{ translateY }], opacity }]}>
      <View style={s.cardInner}>
        {image ? (
          <Image source={{ uri: image }} style={s.thumb} resizeMode="cover" />
        ) : (
          <View style={[s.thumb, s.thumbPlaceholder]}>
            <Ionicons name="image-outline" size={28} color={COLORS.gray175} />
          </View>
        )}

        <View style={{ flex: 1 }}>
          <Text style={s.productName} numberOfLines={2}>{item.name}</Text>
          <Text style={s.productCat}>{item.category?.name}</Text>

          <View style={s.priceRow}>
            <Text style={s.price}>₹{item.price?.toLocaleString('en-IN')}/{unit}</Text>
            {item.mrp && item.mrp > item.price && (
              <Text style={s.mrp}>₹{item.mrp}</Text>
            )}
          </View>

          <Text style={[s.stock, item.stock === 0 && { color: COLORS.error }]}>
            {t('myProducts.stock', { n: item.stock, unit })}
          </Text>
        </View>

        {/* Toggle active/inactive */}
        <Switch
          value={item.isActive}
          onValueChange={() => onToggle(item)}
          trackColor={{ false: COLORS.gray175, true: COLORS.sellerPrimary + '60' }}
          thumbColor={item.isActive ? COLORS.sellerPrimary : COLORS.textLight}
          style={{ marginLeft: 8 }}
        />
      </View>

      <View style={s.cardActions}>
        <TouchableOpacity style={s.actionBtn} onPress={() => onEdit(item)}>
          <Ionicons name="pencil-outline" size={16} color={COLORS.sellerPrimary} />
          <Text style={[s.actionTxt, { color: COLORS.sellerPrimary }]}>{t('myProducts.edit')}</Text>
        </TouchableOpacity>
        <View style={s.actionDivider} />
        <TouchableOpacity style={s.actionBtn} onPress={() => onDelete(item)}>
          <Ionicons name="trash-outline" size={16} color={COLORS.error} />
          <Text style={[s.actionTxt, { color: COLORS.error }]}>{t('myProducts.delete')}</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

export default function MyProductsScreen({ navigation }) {
  const { t } = useLanguage();
  const [products,   setProducts]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page,       setPage]       = useState(1);
  const [hasMore,    setHasMore]    = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (pageNum = 1, replace = true) => {
    try {
      const { data } = await api.get(`/agristore/seller/products?page=${pageNum}&limit=20`);
      const list = data.data || [];
      if (replace) {
        setProducts(list);
      } else {
        setProducts((prev) => [...prev, ...list]);
      }
      setHasMore(list.length === 20);
      setPage(pageNum);
    } catch (e) {
      console.warn('MyProducts load:', e.message);
    }
  }, []);

  useEffect(() => {
    load(1, true).finally(() => setLoading(false));

    const unsubscribe = navigation.addListener('focus', () => {
      load(1, true);
    });
    return unsubscribe;
  }, [load, navigation]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(1, true);
    setRefreshing(false);
  };

  const onLoadMore = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    await load(page + 1, false);
    setLoadingMore(false);
  };

  const handleEdit = (item) => {
    navigation.navigate('AddProduct', { product: item });
  };

  const handleDelete = (item) => {
    Alert.alert(
      t('myProducts.deleteProduct'),
      t('myProducts.deleteConfirm', { name: item.name }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('myProducts.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/agristore/seller/products/${item.id}`);
              setProducts((prev) => prev.filter((p) => p.id !== item.id));
            } catch (e) {
              Alert.alert(t('error'), e.response?.data?.error?.message || t('myProducts.deleteError'));
            }
          },
        },
      ]
    );
  };

  const handleToggle = async (item) => {
    try {
      const { data } = await api.put(`/agristore/seller/products/${item.id}`, {
        isActive: !item.isActive,
      });
      setProducts((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, isActive: data.data.isActive } : p))
      );
    } catch (e) {
      Alert.alert(t('error'), t('myProducts.updateStatusError'));
    }
  };

  // Pulsing FAB ring — must be declared before any early returns (Rules of Hooks)
  const fabRing = useRef(new Animated.Value(1)).current;
  const fabRingOpacity = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.timing(fabRing,        { toValue: 1.7, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(fabRingOpacity, { toValue: 0,   duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator size="large" color={COLORS.sellerPrimary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <FlatList
        windowSize={5}
        maxToRenderPerBatch={10}
        removeClippedSubviews
        data={products}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <ProductCard
            item={item}
            index={index}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onToggle={handleToggle}
          />
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.sellerPrimary} />
        }
        contentContainerStyle={{ padding: 12, paddingBottom: 100, flexGrow: 1 }}
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator color={COLORS.sellerPrimary} style={{ marginVertical: 16 }} /> : null
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="storefront-outline" size={64} color={COLORS.gray175} />
            <Text style={s.emptyTitle}>{t('myProducts.noProducts')}</Text>
            <Text style={s.emptyText}>{t('myProducts.noProductsSub')}</Text>
          </View>
        }
      />

      {/* FAB with pulse ring */}
      <View style={s.fabWrap}>
        <Animated.View style={[s.fabRing, { transform: [{ scale: fabRing }], opacity: fabRingOpacity }]} />
        <TouchableOpacity
          style={s.fab}
          onPress={() => {
            Haptics.light();
            navigation.navigate('AddProduct', { product: null });
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={30} color={COLORS.white} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.sellerBg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.sellerBg },

  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    marginBottom: 12,
    overflow: 'hidden',
    ...SHADOWS.small,
  },
  cardInner: { flexDirection: 'row', padding: 14, alignItems: 'flex-start', gap: 12 },

  thumb: { width: 72, height: 72, borderRadius: RADIUS.md },
  thumbPlaceholder: { backgroundColor: COLORS.grayBg, justifyContent: 'center', alignItems: 'center' },

  productName: { fontSize: 15, fontWeight: '700', color: COLORS.textDark, marginBottom: 2, flexShrink: 1 },
  productCat:  { fontSize: 12, color: COLORS.textMedium, marginBottom: 6 },

  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  price: { fontSize: 16, fontWeight: '800', color: COLORS.sellerPrimary },
  mrp:   { fontSize: 12, color: COLORS.textLight, textDecorationLine: 'line-through' },

  stock: { fontSize: 12, color: COLORS.textMedium, fontWeight: '600' },

  cardActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: COLORS.grayBg,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, gap: 6,
  },
  actionTxt:     { fontSize: 13, fontWeight: '700' },
  actionDivider: { width: 1, backgroundColor: COLORS.grayBg },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textMedium },
  emptyText:  { fontSize: 14, color: COLORS.textLight, textAlign: 'center' },

  fabWrap: { position: 'absolute', bottom: 24, right: 20, alignItems: 'center', justifyContent: 'center' },
  fabRing: {
    position: 'absolute',
    width: 58, height: 58, borderRadius: 29,
    borderWidth: 2, borderColor: COLORS.sellerPrimary,
  },
  fab: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: COLORS.sellerPrimary,
    justifyContent: 'center', alignItems: 'center',
    elevation: 8, shadowColor: COLORS.sellerPrimary, shadowOpacity: 0.45,
    shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
});

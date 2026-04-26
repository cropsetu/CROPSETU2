/**
 * SavedPostsScreen — shows community posts the user has bookmarked
 */
import { COLORS } from '../../constants/colors';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../../services/api';

const CATEGORY_COLORS = {
  TIP:       COLORS.emerald,
  QUESTION:  COLORS.blue,
  NEWS:      COLORS.gold,
  SALE:      COLORS.error,
  COMMUNITY: COLORS.violet,
};

function PostCard({ post }) {
  const date = post.createdAt
    ? new Date(post.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
  const catColor = CATEGORY_COLORS[post.category] || COLORS.textMedium;
  const firstImg = post.images?.[0];

  return (
    <View style={styles.card}>
      {firstImg && (
        <Image source={{ uri: firstImg }} style={styles.postImg} resizeMode="cover" />
      )}
      <View style={styles.cardBody}>
        <View style={styles.metaRow}>
          <View style={[styles.catBadge, { backgroundColor: catColor + '18' }]}>
            <Text style={[styles.catTxt, { color: catColor }]}>
              {post.category || 'POST'}
            </Text>
          </View>
          <Text style={styles.dateStr}>{date}</Text>
        </View>

        <Text style={styles.title} numberOfLines={2}>{post.title || 'Untitled'}</Text>
        {post.description ? (
          <Text style={styles.desc} numberOfLines={3}>{post.description}</Text>
        ) : null}

        <View style={styles.footer}>
          {post.author?.avatar ? (
            <Image source={{ uri: post.author.avatar }} style={styles.authorAvatar} />
          ) : (
            <View style={[styles.authorAvatar, styles.avatarPlaceholder]}>
              <Ionicons name="person" size={12} color={COLORS.textMedium} />
            </View>
          )}
          <Text style={styles.authorName} numberOfLines={1}>
            {post.author?.name || 'Farmer'}
          </Text>
          <View style={{ flex: 1 }} />
          <Ionicons name="bookmark" size={16} color={COLORS.primary} />
        </View>
      </View>
    </View>
  );
}

export default function SavedPostsScreen({ navigation }) {
  const [posts,     setPosts]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page,      setPage]      = useState(1);
  const [hasMore,   setHasMore]   = useState(true);
  const [error,     setError]     = useState(null);

  const fetchPosts = useCallback(async (p = 1, refresh = false) => {
    try {
      if (p === 1) setError(null);
      const { data } = await api.get(`/community/saved?page=${p}&limit=20`);
      const items = data.data || [];
      const meta  = data.meta || {};
      setPosts((prev) => refresh || p === 1 ? items : [...prev, ...items]);
      setHasMore(p < (meta.totalPages || 1));
      setPage(p);
    } catch (e) {
      setError(e?.response?.data?.error?.message || 'Failed to load saved posts');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchPosts(1); }, [fetchPosts]);

  const handleRefresh  = () => { setRefreshing(true); fetchPosts(1, true); };
  const handleLoadMore = () => { if (hasMore && !loading) fetchPosts(page + 1); };

  if (loading && posts.length === 0) {
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
        <Text style={styles.headerTitle}>Saved Posts</Text>
        <View style={{ width: 40 }} />
      </View>

      {error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.error} />
          <Text style={styles.errorTxt}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchPosts(1)}>
            <Text style={styles.retryTxt}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={10}
          removeClippedSubviews
          data={posts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          renderItem={({ item }) => <PostCard post={item} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[COLORS.primary]} />}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={hasMore ? <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 16 }} /> : null}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="bookmark-outline" size={64} color={COLORS.gray175} />
              <Text style={styles.emptyTitle}>No saved posts yet</Text>
              <Text style={styles.emptySubtitle}>Bookmark community posts to see them here</Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />
      )}
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

  card: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border,
    overflow: 'hidden',
    shadowColor: COLORS.black, shadowOpacity: 0.05,
    shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  postImg:  { width: '100%', height: 160 },
  cardBody: { padding: 14 },

  metaRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  catBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  catTxt:   { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  dateStr:  { fontSize: 12, color: COLORS.textMedium },

  title: { fontSize: 16, fontWeight: '700', color: COLORS.textDark, marginBottom: 6, lineHeight: 22 },
  desc:  { fontSize: 13, color: COLORS.textMedium, lineHeight: 18, marginBottom: 10 },

  footer:          { flexDirection: 'row', alignItems: 'center', gap: 6 },
  authorAvatar:    { width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.grayBg },
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  authorName:      { fontSize: 13, fontWeight: '600', color: COLORS.gray700dark, flex: 1 },

  errorTxt: { fontSize: 15, color: COLORS.error, textAlign: 'center' },
  retryBtn: { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10, marginTop: 8 },
  retryTxt: { color: COLORS.white, fontWeight: '700', fontSize: 15 },

  emptyTitle:    { fontSize: 18, fontWeight: '700', color: COLORS.gray700dark, marginTop: 12 },
  emptySubtitle: { fontSize: 14, color: COLORS.textMedium, textAlign: 'center', marginTop: 4 },
});

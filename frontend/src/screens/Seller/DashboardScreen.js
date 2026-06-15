import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, SafeAreaView,
  Animated, Easing, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '../../utils/haptics';
import { COLORS, SHADOWS, RADIUS } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { SoundEffects } from '../../utils/sounds';
import api from '../../services/api';
import AnimatedScreen from '../../components/ui/AnimatedScreen';
import DashboardStatIcon from '../../components/DashboardStatIcons';

const { width: W } = Dimensions.get('window');

const STATUS_COLOR = {
  PENDING:   COLORS.sellerPending,
  CONFIRMED: COLORS.sellerConfirmed,
  SHIPPED:   COLORS.sellerShipped,
  DELIVERED: COLORS.sellerDelivered,
  CANCELLED: COLORS.error,
};

// ── Animated number counter ─────────────────────────────────────────────────
function Counter({ target, prefix = '', suffix = '', style }) {
  const anim    = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState('0');

  useEffect(() => {
    if (target == null) return;
    const numeric = parseFloat(String(target).replace(/[^0-9.]/g, '')) || 0;
    Animated.timing(anim, {
      toValue: numeric,
      duration: 1400,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
    const id = anim.addListener(({ value: v }) =>
      setDisplay(prefix + Math.round(v).toLocaleString('en-IN') + suffix)
    );
    return () => anim.removeListener(id);
  }, [target]);

  return <Text style={style}>{display}</Text>;
}

// ── Animated stat card ──────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color, delay = 0, isRevenue = false }) {
  const translateX = useRef(new Animated.Value(-W * 0.5)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateX, {
        toValue: 0, tension: 70, friction: 9,
        delay, useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1, duration: 450,
        delay, useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Pulse glow on mount
  const glow = useRef(new Animated.Value(3)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay + 600),
      Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 10, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
          Animated.timing(glow, { toValue: 3,  duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        ]), { iterations: 3 }
      ),
    ]).start();
  }, []);

  return (
    <Animated.View style={[d.statCard, { borderLeftColor: color, transform: [{ translateX }], opacity }]}>
      <Animated.View style={[d.statIcon, { backgroundColor: color + '18', shadowRadius: glow, shadowColor: color, shadowOpacity: 0.5, shadowOffset: { width: 0, height: 0 } }]}>
        <DashboardStatIcon type={icon} size={30} />
      </Animated.View>
      <View style={{ flex: 1 }}>
        <Counter
          target={value}
          prefix={isRevenue ? '₹' : ''}
          style={d.statValue}
        />
        <Text style={d.statLabel}>{label}</Text>
        {sub ? <Text style={d.statSub}>{sub}</Text> : null}
      </View>
    </Animated.View>
  );
}

// ── Animated quick action ───────────────────────────────────────────────────
function QuickAction({ icon, label, color, onPress, delay = 0 }) {
  const scale   = useRef(new Animated.Value(0.5)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale,   { toValue: 1, tension: 80, friction: 8, delay, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 350, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  const pressIn  = () => {
    Haptics.light();
    Animated.spring(pressScale, { toValue: 0.9, useNativeDriver: true, speed: 50 }).start();
  };
  const pressOut = () =>
    Animated.spring(pressScale, { toValue: 1, tension: 200, friction: 6, useNativeDriver: true }).start();

  return (
    <Animated.View style={[d.quickAction, { transform: [{ scale: Animated.multiply(scale, pressScale) }], opacity }]}>
      <TouchableOpacity onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} activeOpacity={1} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
        <View style={[d.qaIcon, { backgroundColor: color + '18' }]}>
          <DashboardStatIcon type={icon} size={36} />
        </View>
        <Text style={d.qaLabel}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Order card ──────────────────────────────────────────────────────────────
function OrderCard({ item, index }) {
  const { t } = useLanguage();
  const translateY = useRef(new Animated.Value(30)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, tension: 70, friction: 9, delay: index * 80, useNativeDriver: true }),
      Animated.timing(opacity,    { toValue: 1, duration: 400, delay: index * 80, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[d.orderCard, { transform: [{ translateY }], opacity }]}>
      <View style={d.orderTop}>
        <View style={{ flex: 1 }}>
          <Text style={d.orderProduct} numberOfLines={1}>{item.product?.name}</Text>
          <Text style={d.orderBuyer}>{item.order?.user?.name || '—'} · {item.order?.user?.phone}</Text>
        </View>
        <View style={[d.statusBadge, { backgroundColor: (STATUS_COLOR[item.order?.status] || COLORS.grayMedium) + '18' }]}>
          <Text style={[d.statusText, { color: STATUS_COLOR[item.order?.status] || COLORS.grayMedium }]}>
            {item.order?.status}
          </Text>
        </View>
      </View>
      <View style={d.orderBottom}>
        <Text style={d.orderQty}>{t('dash.qty', { n: item.quantity, unit: item.product?.unit || '' })}</Text>
        <Text style={d.orderAmt}>₹{item.totalPrice?.toLocaleString('en-IN')}</Text>
      </View>
    </Animated.View>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────
export default function DashboardScreen({ navigation }) {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const [stats,        setStats]        = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);

  // Header animations
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerY       = useRef(new Animated.Value(-20)).current;
  const pulseAnim     = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    SoundEffects.tap();

    Animated.parallel([
      Animated.timing(headerOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(headerY,       { toValue: 0, tension: 60, friction: 9, useNativeDriver: true }),
    ]).start();

    // Live indicator pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.4, duration: 700, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 700, easing: Easing.in(Easing.ease),  useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const [inboxUnread, setInboxUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const [statsRes, ordersRes, inboxRes] = await Promise.all([
        api.get('/agristore/seller/stats'),
        api.get('/agristore/seller/orders?limit=5'),
        api.get('/crop-reports/seller/inbox?limit=1').catch(() => ({ data: { meta: { unread: 0 } } })),
      ]);
      setStats(statsRes.data.data);
      setRecentOrders(ordersRes.data.data || []);
      setInboxUnread(inboxRes.data?.meta?.unread || 0);
    } catch (e) {
      console.warn('Dashboard load error:', e.message);
    }
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Time-based greeting
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? t('dash.goodMorning') :
    hour < 17 ? t('dash.goodAfternoon') :
    t('dash.goodEvening');

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : 'S';

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.sellerBg }}>
        <ActivityIndicator size="large" color={COLORS.sellerPrimary} />
        <Text style={{ marginTop: 12, color: COLORS.textMedium, fontWeight: '600' }}>{t('dash.loading')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <AnimatedScreen>
    <SafeAreaView style={d.safe}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.sellerPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <Animated.View style={{ opacity: headerOpacity, transform: [{ translateY: headerY }] }}>
          <LinearGradient colors={[COLORS.deepBrick, COLORS.burntSienna, COLORS.cta]} locations={[0, 0.5, 1]} style={d.header}>
            {/* Subtle grid overlay */}
            <View style={d.headerGrid} pointerEvents="none" />

            <View style={d.headerTop}>
              <View style={{ flex: 1 }}>
                <Text style={d.greeting}>{greeting}</Text>
                <Text style={d.sellerName}>{user?.name || 'Seller'}</Text>
                <Text style={d.sellerPhone}>+91 {user?.phone}</Text>
              </View>

              <TouchableOpacity
                style={d.avatar}
                onPress={() => navigation.navigate('SellerProfile')}
                activeOpacity={0.85}
              >
                <Text style={d.avatarTxt}>{initials}</Text>
              </TouchableOpacity>
            </View>

            {/* Live indicator */}
            <View style={d.liveRow}>
              <Animated.View style={[d.liveDot, { transform: [{ scale: pulseAnim }] }]} />
              <Text style={d.liveTxt}>{t('dash.liveBanner')}</Text>
            </View>
          </LinearGradient>
        </Animated.View>

        <View style={d.body}>
          {/* ── Stats ── */}
          <Text style={d.sectionTitle}>{t('dash.performance')}</Text>
          <StatCard
            icon="storefront-outline"
            label={t('dash.totalProducts')}
            value={stats?.totalProducts ?? 0}
            sub={t('dash.activeProducts', { count: stats?.activeProducts ?? 0 })}
            color={COLORS.sellerPrimary}
            delay={0}
          />
          <StatCard
            icon="cart-outline"
            label={t('dash.totalOrders')}
            value={stats?.totalSold ?? 0}
            sub={t('dash.unitsSold')}
            color={COLORS.sellerAccent}
            delay={120}
          />
          <StatCard
            icon="cash-outline"
            label={t('dash.totalRevenue')}
            value={stats?.totalRevenue ?? 0}
            color={COLORS.sellerPending}
            delay={240}
            isRevenue
          />

          {/* ── Received Reports CTA ── */}
          <TouchableOpacity
            style={d.inboxCard}
            onPress={() => navigation.navigate('ReceivedReports')}
            activeOpacity={0.85}
          >
            <View style={d.inboxIcon}>
              <Ionicons name="leaf" size={22} color={COLORS.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={d.inboxTitle}>{t('inbox.dashTitle', 'Received Crop Reports')}</Text>
              <Text style={d.inboxSub}>
                {inboxUnread > 0
                  ? t('inbox.dashUnread', { count: inboxUnread, defaultValue: '{{count}} new from farmers nearby' })
                  : t('inbox.dashEmpty', 'AI diagnoses sent by nearby farmers')}
              </Text>
            </View>
            {inboxUnread > 0 ? (
              <View style={d.inboxBadge}>
                <Text style={d.inboxBadgeTxt}>{inboxUnread > 99 ? '99+' : inboxUnread}</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={20} color={COLORS.white} />
            )}
          </TouchableOpacity>

          {/* ── Quick Actions ── */}
          <Text style={d.sectionTitle}>{t('dash.quickActions')}</Text>
          <View style={d.quickGrid}>
            <QuickAction
              icon="add-circle"
              label={t('dash.addProduct')}
              color={COLORS.sellerPrimary}
              onPress={() => navigation.navigate('AddProduct')}
              delay={0}
            />
            <QuickAction
              icon="list"
              label={t('dash.myProducts')}
              color={COLORS.sellerAccent}
              onPress={() => navigation.navigate('SellerMyProducts')}
              delay={80}
            />
            <QuickAction
              icon="receipt"
              label={t('dash.orders')}
              color={COLORS.sellerConfirmed}
              onPress={() => navigation.navigate('SellerOrders')}
              delay={160}
            />
            <QuickAction
              icon="person"
              label={t('dash.profile')}
              color={COLORS.sellerPending}
              onPress={() => navigation.navigate('SellerProfile')}
              delay={240}
            />
          </View>

          {/* ── Recent Orders ── */}
          <Text style={d.sectionTitle}>{t('dash.recentOrders')}</Text>
          {recentOrders.length === 0 ? (
            <View style={d.emptyCard}>
              <Ionicons name="receipt-outline" size={48} color={COLORS.gray175} />
              <Text style={d.emptyTitle}>{t('dash.noOrdersYet')}</Text>
              <Text style={d.emptyText}>{t('dash.noOrdersSub')}</Text>
            </View>
          ) : (
            recentOrders.map((item, i) => (
              <OrderCard key={item.id} item={item} index={i} />
            ))
          )}

          {/* ── Back to main app ── */}
          <TouchableOpacity
            style={d.logoutBtn}
            onPress={() => {
              Haptics.warning();
              navigation.goBack();
            }}
          >
            <Ionicons name="arrow-back-outline" size={20} color={COLORS.error} />
            <Text style={d.logoutTxt}>Back to CropSetu</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </View>
      </ScrollView>
    </SafeAreaView>
    </AnimatedScreen>
  );
}

const d = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.sellerBg },

  // Header
  header: { paddingTop: 14, paddingBottom: 22, paddingHorizontal: 20, overflow: 'hidden' },
  headerGrid: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    opacity: 0.06,
    // CSS-style grid lines via borderWidth trick
    borderWidth: 0,
  },
  headerTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  greeting:   { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginBottom: 3 },
  sellerName: { fontSize: 24, fontWeight: '900', color: COLORS.white },
  sellerPhone:{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  avatar: {
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)',
  },
  avatarTxt: { fontSize: 20, fontWeight: '900', color: COLORS.white },
  liveRow:  { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.neonMint },
  liveTxt:  { fontSize: 12, color: 'rgba(255,255,255,0.75)' },

  body: { padding: 16 },

  sectionTitle: {
    fontSize: 16, fontWeight: '800', color: COLORS.textDark,
    marginTop: 22, marginBottom: 12,
  },

  // Stat card
  statCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    padding: 16, marginBottom: 10,
    borderLeftWidth: 4,
    ...SHADOWS.small,
  },
  statIcon:  { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '900', color: COLORS.textDark },
  statLabel: { fontSize: 13, color: COLORS.textMedium, fontWeight: '600' },
  statSub:   { fontSize: 11, color: COLORS.textLight, marginTop: 2 },

  // Quick actions
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  quickAction: {
    width: '47%', backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    padding: 16, ...SHADOWS.small,
  },
  qaIcon:  { width: 52, height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  qaLabel: { fontSize: 13, fontWeight: '700', color: COLORS.textDark, textAlign: 'center' },

  // Order cards
  orderCard: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    padding: 14, marginBottom: 10, ...SHADOWS.small,
  },
  orderTop:     { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  orderProduct: { fontSize: 15, fontWeight: '700', color: COLORS.textDark, marginBottom: 3 },
  orderBuyer:   { fontSize: 12, color: COLORS.textLight },
  orderBottom:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderQty:     { fontSize: 13, color: COLORS.textMedium },
  orderAmt:     { fontSize: 16, fontWeight: '800', color: COLORS.sellerAccent },
  statusBadge:  { borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 4 },
  statusText:   { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },

  emptyCard:  { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: 32, alignItems: 'center', gap: 8, ...SHADOWS.small },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textMedium },
  emptyText:  { fontSize: 13, color: COLORS.textLight, textAlign: 'center', lineHeight: 20 },

  // Received Reports CTA
  inboxCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: 18, padding: 14, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.primary, ...SHADOWS.small,
  },
  inboxIcon:     { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.22)', justifyContent: 'center', alignItems: 'center' },
  inboxTitle:    { fontSize: 15, fontWeight: '800', color: COLORS.white },
  inboxSub:      { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  inboxBadge:    { minWidth: 26, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 13, backgroundColor: COLORS.white, justifyContent: 'center', alignItems: 'center' },
  inboxBadgeTxt: { fontSize: 12, fontWeight: '900', color: COLORS.primary },

  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 24, padding: 16, borderRadius: RADIUS.md,
    borderWidth: 1.5, borderColor: COLORS.error + '40', backgroundColor: COLORS.roseTint,
  },
  logoutTxt: { fontSize: 15, fontWeight: '700', color: COLORS.error },
});

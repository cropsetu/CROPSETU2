/**
 * RentHome — Machinery & Labour marketplace
 *
 * Location model (see ./rentLocationPrefs.js):
 *   • One location bar states the active source — GPS, a hand-picked district,
 *     or "everywhere" — and opens onto a picker that can change it. Source,
 *     radius and strictness all persist across restarts.
 *   • "Within 5 km" is enforced server-side with ?strict=true, so a listing that
 *     never shared coordinates is either excluded or labelled "Location not
 *     shared" — it never poses as a nearby result.
 *   • "Any" keeps lat/lng and sends ?radius=all, so distance badges and distance
 *     ordering survive; it only removes the ceiling.
 *   • Search, category and pagination are query params, so they filter the
 *     whole catalogue rather than the twenty rows that happen to be loaded.
 *   • Ordering is not user-facing: there is no sort control. buildListParams
 *     picks it from the active source — nearest under GPS, rating otherwise.
 *   • The list is a single virtualized FlatList that pages; the header (search,
 *     location bar, categories) rides in ListHeaderComponent.
 */
import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useDeferredValue,
  memo,
} from "react";
import useFocusRefresh from "../../hooks/useFocusRefresh";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Pressable,
  TextInput,
  StatusBar,
  Image,
  ScrollView,
  ActivityIndicator,
  Linking,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { Haptics } from "@cropsetu/shared/utils/haptics";
import {
  SPRINGS,
  AnimatedCard,
  isReducedMotion,
  enterAnimation,
} from "@cropsetu/shared/components/ui/motion";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import useScrollHeader from "../../hooks/useScrollHeader";
import ScrollToTopButton from "../../components/ScrollToTopButton";
import { useLocation } from "../../context/LocationContext";
import api from "@cropsetu/shared/services/api";
import { useLanguage } from "@cropsetu/shared/context/LanguageContext";
import { useAuth } from "@cropsetu/shared/context/AuthContext";
import MockImagePlaceholder from "../../components/MockImagePlaceholder";
import { COLORS, TYPE, SHADOWS } from "@cropsetu/shared/constants/colors";
import {
  KHET,
  KSPACE,
  KGUTTER,
  KRADIUS,
  KICON,
  KBORDER,
  circle,
  withAlpha,
} from "@cropsetu/shared/constants/khetTheme";
import AnimatedScreen from "@cropsetu/shared/components/ui/AnimatedScreen";
import { SkeletonGrid } from "../../components/ui/Skeleton";
import PhotoIcon from "../../components/PhotoIcon";
import { MachineryIcon } from "../../components/MachineryIcons";
import { LabourIcon } from "../../components/LabourIcon";
import useRentListings, { probeTotal } from "../../hooks/useRentListings";
import {
  useRentLocationPrefs,
  buildListParams,
  effectiveSource,
  SOURCE,
  RADIUS_OPTIONS,
} from "./rentLocationPrefs";
import { RentLocationPill, RentRadiusRow, RentLocationSheet } from "./RentLocationBar";

const GREEN = COLORS.primary;
const BG = COLORS.background;

// ── Machinery categories ───────────────────────────────────────────────────────
const MACH_CATS = [
  {
    key: "all",
    tKey: "catAll",
    icon: "grid-outline",
    color: COLORS.primary,
    bg: COLORS.primaryPale,
  },
  {
    key: "tractor",
    tKey: "catTractor",
    icon: "construct-outline",
    color: COLORS.blue,
    bg: COLORS.blueBg,
  },
  {
    key: "harvester",
    tKey: "catHarvester",
    icon: "leaf-outline",
    color: COLORS.purpleDark,
    bg: COLORS.purplePale,
  },
  {
    key: "sprayer",
    tKey: "catSprayer",
    icon: "water-outline",
    color: COLORS.tealDarkAlt,
    bg: COLORS.tealPale2,
  },
  {
    key: "rotavator",
    tKey: "catRotavator",
    icon: "refresh-circle-outline",
    color: COLORS.cta,
    bg: COLORS.sellerPrimaryPale,
  },
  {
    key: "thresher",
    tKey: "catThresher",
    icon: "aperture-outline",
    color: COLORS.error,
    bg: COLORS.redPale,
  },
  {
    key: "transplanter",
    tKey: "catTransplanter",
    icon: "git-branch-outline",
    color: COLORS.primaryLight,
    bg: COLORS.primaryPale,
  },
  {
    key: "truck",
    tKey: "catTruck",
    icon: "bus-outline",
    color: COLORS.blueSteel,
    bg: COLORS.steelPale,
  },
  {
    key: "tempo",
    tKey: "catTempo",
    icon: "car-outline",
    color: COLORS.brownAlt,
    bg: COLORS.brownPale,
  },
  {
    key: "other",
    tKey: "catOther",
    icon: "ellipsis-horizontal",
    color: COLORS.grayMid,
    bg: COLORS.divider,
  },
];

// ── Category chip ──────────────────────────────────────────────────────────────
function CatChip({ cat, active, onPress }) {
  const { t } = useLanguage();
  const sc = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sc.value }],
  }));
  const press = (to) => {
    if (!isReducedMotion()) sc.value = withSpring(to, SPRINGS.snappy);
  };
  return (
    <Animated.View style={animStyle}>
      <Pressable
        style={[
          S.catChip,
          active && { backgroundColor: 'transparent' },
        ]}
        onPress={() => {
          Haptics.selection();
          onPress(cat.key);
        }}
        onPressIn={() => press(0.9)}
        onPressOut={() => press(1)}
        accessibilityRole="radio"
        accessibilityState={{ selected: active, checked: active }}
        accessibilityLabel={t("rent." + cat.tKey)}
      >
        <View
          style={[
            S.catIconWrap,
            // No tinted disc behind the photo — the machine itself is the label.
            // Selection is carried by the label colour and the underline instead.
            active && { backgroundColor: withAlpha(COLORS.white, 0.2) },
          ]}
        >
          {cat.key !== "all" && cat.key !== "other" ? (
            <PhotoIcon set="mach" name={cat.key} size={60} radius={0}
              fallback={<MachineryIcon type={cat.key} size={40} />} />
          ) : (
            <Ionicons
              name={cat.icon}
              size={30}
              color={active ? COLORS.primary : cat.color}
            />
          )}
        </View>
        <Text style={[S.catLabel, active && S.catLabelActive]}>
          {t("rent." + cat.tKey)}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// ── "Location not shared" pill ────────────────────────────────────────────────
// Rendered only when distances ARE available for this query — i.e. every sibling
// card carries a badge and this one cannot. A silent blank there reads as "very
// close by"; this says what is actually true. Wraps freely: the Marathi string
// is roughly twice the English one.
function NoLocationPill({ t }) {
  return (
    <View style={S.noLocPill}>
      <Ionicons name="help-circle-outline" size={KICON.xs} color={COLORS.cta} />
      <Text style={S.noLocTxt}>
        {t("rent.locNotShared", "Location not shared")}
      </Text>
    </View>
  );
}

// ── Booking status badge (shown on cards the current user has booked) ───────────
function bookingStatusInfo(status) {
  if (status === "PENDING")
    return {
      tKey: "bookingPendingShort",
      fallback: "Request pending",
      color: COLORS.cta,
      bg: COLORS.orangeWarm,
      icon: "time-outline",
    };
  if (status === "CONFIRMED")
    return {
      tKey: "bookingConfirmedShort",
      fallback: "Booking confirmed",
      color: GREEN,
      bg: COLORS.primaryPale,
      icon: "checkmark-circle",
    };
  if (status === "ACTIVE")
    return {
      tKey: "statusActive",
      fallback: "Active",
      color: COLORS.blue,
      bg: COLORS.blueBg,
      icon: "play-circle",
    };
  return null;
}

function BookedTag({ status, t }) {
  const bi = bookingStatusInfo(status);
  if (!bi) return null;
  return (
    <View
      style={[
        S.bookedTag,
        { backgroundColor: bi.bg, borderColor: withAlpha(bi.color, "40") },
      ]}
    >
      <Ionicons name={bi.icon} size={13} color={bi.color} />
      <Text style={[S.bookedTagTxt, { color: bi.color }]} numberOfLines={1}>
        {t("rent." + bi.tKey, bi.fallback)}
      </Text>
    </View>
  );
}

// ── Machinery card ─────────────────────────────────────────────────────────────
const MachineryCard = memo(function MachineryCard({
  item,
  onPress,
  index = 0,
  isOwner = false,
  bookingStatus = null,
  distanceMode = false,
}) {
  const { t } = useLanguage();
  const catInfo =
    MACH_CATS.find((c) => c.key === item.category) ||
    MACH_CATS[MACH_CATS.length - 1];

  // Availability badge reflects real bookings first, then the owner's manual flag.
  const booked = item.bookedStatus; // 'BOOKED' | 'RESERVED' | null
  const statusColor =
    booked === "BOOKED"
      ? COLORS.error
      : booked === "RESERVED"
        ? COLORS.cta
        : item.available
          ? GREEN
          : COLORS.cta;
  const statusBg =
    booked === "BOOKED"
      ? COLORS.redPale
      : booked === "RESERVED"
        ? COLORS.orangeWarm
        : item.available
          ? COLORS.primaryPale
          : COLORS.orangeWarm;
  const statusLabel =
    booked === "BOOKED"
      ? t("rent.bookedNow", "Booked")
      : booked === "RESERVED"
        ? t("rent.reservedSoon", "Reserved")
        : item.available
          ? t("rent.listAvailable")
          : t("rent.listAdvanceBooking");

  const unlocated = distanceMode && item.distanceKm == null;

  return (
    <AnimatedCard
      style={S.mCard}
      onPress={() => onPress(item)}
      index={index}
      scaleValue={0.97}
      accessibilityLabel={`${item.name} ${item.pricePerDay} per day`}
    >
      {/* Photo */}
      <View style={S.mPhotoWrap}>
        {item.images?.[0] ? (
          <Image
            source={{ uri: item.images[0] }}
            style={S.mPhoto}
            resizeMode="cover"
          />
        ) : (
          <View
            style={[
              S.mPhoto,
              {
                backgroundColor: catInfo.bg,
                justifyContent: "center",
                alignItems: "center",
              },
            ]}
          >
            <MockImagePlaceholder
              category={item.category || "machinery"}
              size={140}
            />
          </View>
        )}
        {/* Gradient overlay */}
        <LinearGradient
          colors={["transparent", withAlpha(COLORS.black, 0.5)]}
          style={S.mPhotoGradient}
          pointerEvents="none"
        />
        {/* Availability badge — Booked / Reserved / Available */}
        <View
          style={[
            S.availBadge,
            { backgroundColor: statusBg, borderColor: statusColor },
          ]}
        >
          <View style={[S.availDot, { backgroundColor: statusColor }]} />
          <Text style={[S.availTxt, { color: statusColor }]} numberOfLines={1}>
            {statusLabel}
          </Text>
        </View>
        {/* Category label */}
        <View style={[S.catTag, { backgroundColor: catInfo.color }]}>
          <Text style={S.catTagTxt} numberOfLines={1}>{t("rent." + catInfo.tKey)}</Text>
        </View>
        {/* Distance */}
        {item.distanceKm != null && (
          <View style={S.distOverlay}>
            <Ionicons name="navigate-circle" size={11} color={COLORS.blue} />
            <Text style={S.distOverlayTxt}>{item.distanceKm} km</Text>
          </View>
        )}
      </View>

      <View style={S.mBody}>
        <View style={S.mTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={S.mName} numberOfLines={1}>
              {item.name}
            </Text>
            {item.brand ? (
              <Text style={S.mBrand}>
                {item.brand}
                {item.horsePower ? ` • ${item.horsePower}` : ""}
              </Text>
            ) : null}
          </View>
          <View style={S.mPriceCol}>
            <Text style={S.mPrice}>
              ₹{item.pricePerHour?.toLocaleString()}/hr
            </Text>
            <Text style={S.mPriceDay}>
              ₹{item.pricePerDay?.toLocaleString()}/day
            </Text>
          </View>
        </View>

        <View style={S.mMetaRow}>
          <View style={S.ratingPill}>
            <Ionicons name="star" size={11} color={COLORS.yellowDark2} />
            <Text style={S.ratingTxt}>
              {item.rating?.toFixed(1)} ({item.ratingCount})
            </Text>
          </View>
          {item.ageYears != null && (
            <View style={S.metaPill}>
              <Ionicons
                name="calendar-outline"
                size={11}
                color={COLORS.grayMedium}
              />
              <Text style={S.metaTxt}>
                {t("rent.yrOld", { count: item.ageYears })}
              </Text>
            </View>
          )}
          <View style={S.verifiedPill}>
            <Ionicons name="checkmark-circle" size={11} color={GREEN} />
            <Text style={[S.metaTxt, { color: GREEN }]}>{t("verified")}</Text>
          </View>
        </View>

        <View style={S.mLocRow}>
          <Ionicons
            name="location-outline"
            size={13}
            color={COLORS.grayMedium}
          />
          <Text style={S.mLocTxt} numberOfLines={1}>
            {item.location}
          </Text>
        </View>

        {unlocated && <NoLocationPill t={t} />}

        {isOwner ? (
          <View style={S.ownTag}>
            <Ionicons name="person-circle-outline" size={15} color={GREEN} />
            <Text style={S.ownTagTxt}>
              {t("rent.ownListingTitle", "Your Listing")}
            </Text>
          </View>
        ) : bookingStatus ? (
          <BookedTag status={bookingStatus} t={t} />
        ) : (
          <TouchableOpacity style={S.bookBtn} onPress={() => onPress(item)}>
            <Ionicons name="calendar" size={KICON.sm} color={COLORS.white} />
            <Text style={S.bookBtnTxt}>{t("bookNow")}</Text>
          </TouchableOpacity>
        )}
      </View>
    </AnimatedCard>
  );
});

// ── Worker card ────────────────────────────────────────────────────────────────
// memo'd: without it every keystroke in the search box re-ran each card's
// Reanimated hooks, initials split and subtitle join for every row on screen.
const WorkerCard = memo(function WorkerCard({
  item,
  onPress,
  index = 0,
  isOwner = false,
  bookingStatus = null,
  distanceMode = false,
}) {
  const { t } = useLanguage();
  const initials = (item.leader || item.name || "W")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const sc = useSharedValue(1);
  const scStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sc.value }],
  }));

  // The name line already shows `leader || name`. The subtitle carries only the
  // parts it does NOT: the group's name (only meaningful when a leader is the
  // title) and the head-count. Both absent → no empty second line.
  const subtitle = [
    item.leader && item.name !== item.leader ? item.name : null,
    item.groupSize > 1 ? t("rent.workersCount", { count: item.groupSize }) : null,
  ]
    .filter(Boolean)
    .join(" • ");

  const statusColor =
    item.bookedStatus === "BOOKED"
      ? COLORS.error
      : item.bookedStatus === "RESERVED"
        ? COLORS.cta
        : item.available
          ? GREEN
          : COLORS.cta;

  const unlocated = distanceMode && item.distanceKm == null;

  return (
    <Animated.View entering={enterAnimation(index)} style={[S.wCard, scStyle]}>
      <Pressable
        style={{ flex: 1 }}
        onPress={() => {
          Haptics.light();
          onPress(item);
        }}
        onPressIn={() => {
          if (!isReducedMotion()) sc.value = withSpring(0.97, SPRINGS.snappy);
        }}
        onPressOut={() => {
          if (!isReducedMotion()) sc.value = withSpring(1, SPRINGS.snappy);
        }}
      >
        {/* Header — avatar + status, stacked like MachineryCard's photo block.
            This card renders in a 2-column grid (~155px wide). The old layout
            was a horizontal row (avatar | info | price+Call) needing ~192px of
            fixed width before the name got a single pixel, which crushed names
            to "R.." and slid the Call button on top of the price. */}
        <View style={S.wHeader}>
          <View style={S.wAvatarWrap}>
            {item.image ? (
              <Image source={{ uri: item.image }} style={S.wAvatar} />
            ) : (
              <View style={S.wAvatarPlaceholder}>
                <Text style={S.wInitials}>{initials}</Text>
              </View>
            )}
            <View style={[S.wAvailDot, { backgroundColor: statusColor }]} />
          </View>

          <View style={S.wHeaderTxt}>
            <Text style={S.wName} numberOfLines={1}>
              {item.leader || item.name}
            </Text>
            {/* Second line only when it adds something the name line does not.
                A solo worker has no `leader`, so `name` is already the title —
                printing it again rendered the same text twice. */}
            {!!subtitle && (
              <Text style={S.wGroup} numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>
        </View>

        <View style={S.wBody}>
          {/* Two skills max — a third never fit on one line at this width and
              wrapped into a ragged second row. */}
          {(item.skills || []).length > 0 && (
            <View style={S.wSkillsWrap}>
              {(item.skills || []).slice(0, 2).map((s, i) => (
                <View key={i} style={S.skillTag}>
                  <Text style={S.skillTagTxt} numberOfLines={1}>{s}</Text>
                </View>
              ))}
              {(item.skills || []).length > 2 && (
                <View style={S.skillMore}>
                  <Text style={S.skillMoreTxt}>+{(item.skills || []).length - 2}</Text>
                </View>
              )}
            </View>
          )}

          <View style={S.wMetaRow}>
            <Ionicons name="location-outline" size={KICON.xs} color={COLORS.grayMedium} />
            <Text style={S.wMetaTxt} numberOfLines={1}>
              {item.location || item.district || "—"}
              {item.distanceKm != null ? ` · ${item.distanceKm} ${t("rent.kmAway")}` : ""}
            </Text>
          </View>

          {unlocated && <NoLocationPill t={t} />}

          {/* Price and rating share one row; the CTA gets its own full-width
              row below, so they can no longer overlap. */}
          <View style={S.wPriceRow}>
            <View style={S.wPriceCol}>
              <Text style={S.wPrice} numberOfLines={1}>
                ₹{item.pricePerDay?.toLocaleString() ?? "—"}
              </Text>
              <Text style={S.wPriceUnit}>{t("rent.perDayUnit", "/day")}</Text>
            </View>
            {/* Only show a rating once there is one. `(0).toFixed(1)` is the
                truthy string "0.0", so the old `|| "—"` fallback never fired
                and every unrated worker advertised a 0.0 star score. */}
            {item.rating > 0 ? (
              <View style={S.ratingPill}>
                <Ionicons name="star" size={11} color={COLORS.yellowDark2} />
                <Text style={S.ratingTxt}>{item.rating.toFixed(1)}</Text>
              </View>
            ) : (
              <View style={S.newPill}>
                <Text style={S.newPillTxt}>{t("rent.newWorker", "New")}</Text>
              </View>
            )}
          </View>

          {item.bookedStatus && (
            <View
              style={[
                S.workerBooked,
                {
                  backgroundColor:
                    item.bookedStatus === "BOOKED"
                      ? COLORS.redPale
                      : COLORS.orangeWarm,
                },
              ]}
            >
              <Ionicons name="lock-closed" size={10} color={statusColor} />
              <Text style={[S.workerBookedTxt, { color: statusColor }]}>
                {item.bookedStatus === "BOOKED"
                  ? t("rent.bookedNow", "Booked")
                  : t("rent.reservedSoon", "Reserved")}
              </Text>
            </View>
          )}

          {isOwner ? (
            <View style={S.ownTag}>
              <Ionicons name="person-circle-outline" size={13} color={GREEN} />
              <Text style={S.ownTagTxt} numberOfLines={1}>
                {t("rent.ownListingTitle", "Your Listing")}
              </Text>
            </View>
          ) : bookingStatus ? (
            <BookedTag status={bookingStatus} t={t} />
          ) : (
            <TouchableOpacity style={S.callBtn} onPress={() => onPress(item)}>
              <Ionicons name="call" size={13} color={COLORS.white} />
              <Text style={S.callBtnTxt} numberOfLines={1}>{t("rent.call")}</Text>
            </TouchableOpacity>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
});

// ── Main screen ────────────────────────────────────────────────────────────────
export default function RentHome({ navigation }) {
  const { t } = useLanguage();
  const { isLoggedIn, user } = useAuth();
  const myId = user?.id ?? null;
  const insets = useSafeAreaInsets();
  const {
    onScroll: hideOnScroll,
    headerAnimatedStyle,
    showTopBtn,
  } = useScrollHeader(55);
  const listRef = useRef(null);

  // ── Location: global GPS + the persisted source/radius preference ──────────
  const {
    coords,
    loading: gpsLoading,
    permissionDenied,
    error: gpsError,
    refresh: refreshGps,
    refreshing: gpsRefreshing,
  } = useLocation();
  const [prefs, setPrefs, prefsHydrated] = useRentLocationPrefs();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [radiusOpen, setRadiusOpen] = useState(false);

  const [tab, setTab] = useState("machinery");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");

  const [pendingCount, setPendingCount] = useState(0);
  const [hasListings, setHasListings] = useState(false);
  // Map of listingId → my booking status (PENDING/CONFIRMED/ACTIVE) for badges on cards.
  const [bookingMap, setBookingMap] = useState({});

  // The input keeps `search` so typing echoes instantly (useDeferredValue keeps
  // the echo off the render critical path); the REQUEST waits 350 ms so a
  // ten-letter word is one round-trip, not ten.
  const deferredSearch = useDeferredValue(search);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(id);
  }, [search]);

  const source = effectiveSource(prefs, coords);
  // Only a GPS query yields distances; a district or catalogue-wide query has no
  // origin to measure from, and the UI must not imply otherwise.
  const distanceMode = source === SOURCE.GPS;
  const searchActive = debouncedSearch.length > 0;

  // Hold the first request until BOTH the stored prefs and the GPS attempt have
  // settled — otherwise we fire once against the defaults and again against the
  // restored prefs, which is the double-fetch this screen used to have.
  const ready = prefsHydrated && !gpsLoading;

  const machineryParams = useMemo(
    () => buildListParams(prefs, coords, { search: debouncedSearch, category, talukaEnabled: true }),
    [prefs, coords, debouncedSearch, category],
  );
  const labourParams = useMemo(
    () => buildListParams(prefs, coords, { search: debouncedSearch, talukaEnabled: true }),
    [prefs, coords, debouncedSearch],
  );

  // Dev-only offline fallback, unchanged in spirit from the old outer catch: a
  // developer with no API still sees a populated screen. Never in production.
  const machineryFallback = useCallback(
    () => require("../../constants/mockData").MACHINERY_LISTINGS || [],
    [],
  );
  const labourFallback = useCallback(
    () => require("../../constants/mockData").LABOUR_LISTINGS || [],
    [],
  );

  const machinery = useRentListings({
    path: "/rent/machinery",
    params: machineryParams,
    enabled: ready && tab === "machinery",
    devFallback: machineryFallback,
  });
  const labour = useRentListings({
    path: "/rent/labour",
    params: labourParams,
    enabled: ready && tab === "labour",
    devFallback: labourFallback,
  });

  const active = tab === "machinery" ? machinery : labour;
  const activeParams = tab === "machinery" ? machineryParams : labourParams;
  const activePath = tab === "machinery" ? "/rent/machinery" : "/rent/labour";

  // ── Side data: my listings (bell), pending count, my booking badges ────────
  const loadSideData = useCallback(() => {
    if (!isLoggedIn) {
      setBookingMap({});
      setHasListings(false);
      setPendingCount(0);
      return;
    }
    Promise.all([
      api.get("/rent/machinery/my").catch(() => null),
      api.get("/rent/labour/my").catch(() => null),
    ]).then(([mr, lr]) => {
      const count = (mr?.data?.data?.length || 0) + (lr?.data?.data?.length || 0);
      setHasListings(count > 0);
      if (count > 0) {
        api
          .get("/rent/bookings/received/pending-count")
          .then((r) => setPendingCount(r.data?.data?.count ?? 0))
          .catch(() => {});
      }
    });

    api
      .get("/rent/bookings")
      .then((r) => {
        const map = {};
        (r.data?.data ?? []).forEach((b) => {
          if (!["PENDING", "CONFIRMED", "ACTIVE"].includes(b.status)) return;
          const lid = b.machineryListing?.id || b.labourListing?.id;
          if (!lid) return;
          // Prefer a CONFIRMED/ACTIVE status over a PENDING one if several exist.
          if (!map[lid] || map[lid] === "PENDING") map[lid] = b.status;
        });
        setBookingMap(map);
      })
      .catch(() => {});
  }, [isLoggedIn]);

  // Refresh on focus — but only on a RETURN to the screen, only via a ref, and
  // only when the data is actually stale.
  //
  // All three matter. Depending on `active.refresh` directly would re-run this
  // effect every time the params change (its identity tracks them), firing a
  // second request right behind the one the params effect just sent — which is
  // exactly the double-fetch this screen used to have. Skipping the first focus
  // leaves the initial load to the params effect alone. And the staleness gate
  // stops the four side-data requests (my machinery, my labour, my bookings,
  // pending count) from refiring every single time the tab is tapped; screens
  // that add, delete or book a listing call invalidateFocusData('rent'), so a
  // real change still lands immediately.
  const focusedBefore = useRef(false);
  const refreshRef = useRef(null);
  useEffect(() => { refreshRef.current = active.refresh; }, [active.refresh]);
  useFocusRefresh(
    () => {
      loadSideData();
      if (focusedBefore.current) refreshRef.current?.();
      focusedBefore.current = true;
    },
    { key: 'rent' },
  );

  // ── Recovery: how many listings exist one radius up ────────────────────────
  const nextRadius = useMemo(() => {
    if (source !== SOURCE.GPS || prefs.radiusKm == null) return undefined;
    const i = RADIUS_OPTIONS.indexOf(prefs.radiusKm);
    return i >= 0 && i < RADIUS_OPTIONS.length - 1 ? RADIUS_OPTIONS[i + 1] : undefined;
  }, [source, prefs.radiusKm]);

  const [nextRadiusTotal, setNextRadiusTotal] = useState(null);
  const isEmpty = ready && !active.loading && active.items.length === 0;
  useEffect(() => {
    setNextRadiusTotal(null);
    if (!isEmpty || nextRadius === undefined) return;
    let cancelled = false;
    probeTotal(activePath, {
      ...activeParams,
      radius: nextRadius == null ? "all" : nextRadius,
    }).then((n) => {
      if (!cancelled) setNextRadiusTotal(n);
    });
    return () => { cancelled = true; };
  }, [isEmpty, nextRadius, activePath, activeParams]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const openMachinery = useCallback(
    (i) => navigation.navigate("MachineryDetail", { id: i.id, machinery: i }),
    [navigation],
  );
  const openLabour = useCallback(
    (i) => navigation.navigate("LabourDetail", { id: i.id, labour: i }),
    [navigation],
  );
  const scrollTop = useCallback(
    () => listRef.current?.scrollToOffset({ offset: 0, animated: !isReducedMotion() }),
    [],
  );
  const switchTab = useCallback((key) => {
    setTab(key);
    setCategory("all");
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  // ── Derived copy ──────────────────────────────────────────────────────────
  const shown = active.items.length;
  const total = active.total;
  const unlocatedShown = distanceMode
    ? active.items.filter((i) => i.distanceKm == null).length
    : 0;

  const scopeLine = useMemo(() => {
    if (!shown) return null;
    if (source === SOURCE.GPS) {
      return prefs.radiusKm == null
        ? t("rent.showingNearest", { shown, total })
        : t("rent.showingWithin", { shown, total, km: prefs.radiusKm });
    }
    if (source === SOURCE.DISTRICT) {
      return t("rent.showingInDistrict", { shown, total, district: prefs.district });
    }
    return t("rent.showingAll", { shown, total });
  }, [shown, total, source, prefs.radiusKm, prefs.district, t]);

  const gpsUnavailable = prefs.source === SOURCE.GPS && !coords && !gpsLoading;

  /**
   * Tapping a distance.
   *
   * A radius is measured FROM somewhere and the only origin we have is the
   * device GPS, so asking for "within 10 km" with no position is the moment to
   * explain why we need one — the picker offers GPS, a district, and the reason.
   * Selecting the chip anyway would look like a filter while the request
   * carried no radius at all and the results covered the whole state.
   *
   * Tapping the active chip clears it, so a farmer can widen without hunting
   * for an "off" control. "All" is the explicit way to the same place.
   */
  const handleRadiusChange = useCallback(
    (km) => {
      if (km == null) { setPrefs({ radiusKm: null }); return; }
      if (!coords) { setSheetOpen(true); return; }
      setPrefs((prev) =>
        prev.radiusKm === km && prev.source === SOURCE.GPS
          ? { radiusKm: null }
          : { source: SOURCE.GPS, radiusKm: km },
      );
    },
    [coords, setPrefs],
  );


  // ── Header (rides in ListHeaderComponent so the list virtualizes) ──────────
  const header = (
    <View>
      {/* Search */}
      <View style={S.searchRow}>
        <RentLocationPill
          prefs={prefs}
          coords={coords}
          expanded={radiusOpen}
          onToggle={() => setRadiusOpen(v => !v)}
          onOpen={() => setSheetOpen(true)}
        />
        <View style={S.searchBar}>
          <Ionicons name="search-outline" size={KICON.base} color={COLORS.grayMedium} />
          <TextInput
            style={S.searchInput}
            placeholder={
              tab === "machinery" ? t("machinerySearch") : t("labourSearch")
            }
            placeholderTextColor={COLORS.textLight}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {deferredSearch !== search && (
            <ActivityIndicator size="small" color={COLORS.grayLightMid} />
          )}
          {search.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearch("")}
              accessibilityRole="button"
              accessibilityLabel={t("rent.clearSearch", "Clear search")}
              hitSlop={10}
            >
              <Ionicons name="close-circle" size={17} color={COLORS.grayLightMid} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* GPS asked for but unavailable — one line of why, and two ways out.
          The old UI disabled every chip and said nothing. */}
      {gpsUnavailable && (
        <View style={S.gpsNotice}>
          <Ionicons name="alert-circle-outline" size={KICON.base} color={COLORS.cta} />
          <View style={{ flex: 1 }}>
            <Text style={S.gpsNoticeTxt}>
              {permissionDenied
                ? t("rent.gpsDeniedLine", "Location permission is off, so distances are unavailable.")
                : gpsError
                  ? t("rent.gpsErrorLine", "Could not get your position — no signal or GPS is off.")
                  : t("rent.gpsNoFixLine", "No position yet, so distances are unavailable.")}
            </Text>
            <View style={S.gpsNoticeBtns}>
              <TouchableOpacity
                style={S.gpsNoticeBtn}
                onPress={() => {
                  setPrefs({ source: SOURCE.DISTRICT });
                  setSheetOpen(true);
                }}
                accessibilityRole="button"
              >
                <Ionicons name="map-outline" size={KICON.sm} color={GREEN} />
                <Text style={S.gpsNoticeBtnTxt}>
                  {t("rent.chooseDistrict", "Choose district")}
                </Text>
              </TouchableOpacity>
              {permissionDenied ? (
                <TouchableOpacity
                  style={S.gpsNoticeBtn}
                  onPress={() => Linking.openSettings?.()}
                  accessibilityRole="button"
                >
                  <Ionicons name="settings-outline" size={KICON.sm} color={GREEN} />
                  <Text style={S.gpsNoticeBtnTxt}>
                    {t("rent.openSettings", "Open Settings")}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={S.gpsNoticeBtn}
                  onPress={refreshGps}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!gpsRefreshing }}
                  disabled={gpsRefreshing}
                >
                  <Ionicons name="refresh" size={KICON.sm} color={GREEN} />
                  <Text style={S.gpsNoticeBtnTxt}>
                    {t("rent.gpsRetry", "Try again")}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      )}

      {/* Radius chips live under the search box and only when asked for — the
          location pill in the search row toggles them. */}
      {radiusOpen && (
        <RentRadiusRow
          prefs={prefs}
          coords={coords}
          onChange={handleRadiusChange}
          onOpen={() => setSheetOpen(true)}
        />
      )}

      {/* Category filter (machinery only) — now a server-side `category` param */}
      {tab === "machinery" && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={S.catRow}
          accessibilityRole="radiogroup"
        >
          {MACH_CATS.map((cat) => (
            <CatChip
              key={cat.key}
              cat={cat}
              active={category === cat.key}
              onPress={setCategory}
            />
          ))}
        </ScrollView>
      )}

      {/* Section title + truthful count */}
      <View style={S.sectionHeader}>
        <Text style={S.sectionTitle}>
          {tab === "labour"
            ? t("rent.workersSection")
            : category === "all"
              ? t("rent.availMachinery")
              : t("rent." + MACH_CATS.find((c) => c.key === category)?.tKey)}
        </Text>
        {!active.loading && (
          <View style={S.countBadge}>
            <Text style={S.countTxt}>
              {total} {t("rent.found")}
            </Text>
          </View>
        )}
      </View>

      {/* "Showing 20 of 63 within 25 km" — the total used to be thrown away, so
          a seller's listing at position 21 was invisible with no hint of it. */}
      {!active.loading && !!scopeLine && (
        <Text style={S.scopeLine}>{scopeLine}</Text>
      )}

      {/* Loose mode: say once that unmeasurable listings are in the list. */}
      {!active.loading && unlocatedShown > 0 && (
        <View style={S.unlocatedNote}>
          <Ionicons name="information-circle-outline" size={KICON.sm} color={COLORS.blue} />
          <Text style={S.unlocatedNoteTxt}>
            {t("rent.unlocatedNotice", { count: unlocatedShown })}
          </Text>
        </View>
      )}
    </View>
  );

  // ── Empty state ───────────────────────────────────────────────────────────
  const empty = active.loading ? (
    // Same 2-up shape as the cards below, so nothing shifts when page 1 lands.
    // The real photo block is a fixed 190 and the row gap a fixed 12, so both are
    // passed outright — deriving them from card width drifts on wider screens.
    <SkeletonGrid
      rows={3}
      gutter={KGUTTER.tight}
      gap={KSPACE.s12}
      photoH={190}
      label={
        tab === "machinery"
          ? t("rent.loadingMachinery")
          : t("rent.loadingWorkers")
      }
    />
  ) : (
    <View style={S.emptyWrap}>
      <View style={S.emptyIconBg}>
        {tab === "machinery" ? (
          <MachineryIcon type="tractor" size={56} />
        ) : (
          <LabourIcon size={56} />
        )}
      </View>
      <Text style={S.emptyTitle}>
        {t("rent.emptyHereTitle", "Nothing here yet")}
      </Text>
      <Text style={S.emptyTxt}>
        {tab === "machinery" ? t("rent.noMachinery") : t("rent.noWorkersFound")}
      </Text>

      {/* Widen the search before offering to list your own — that is the move
          the user actually wants, and the old empty state never offered it. */}
      {nextRadius !== undefined && (
        <TouchableOpacity
          style={S.widenBtn}
          onPress={() => setPrefs({ radiusKm: nextRadius })}
          accessibilityRole="button"
        >
          <Ionicons name="resize-outline" size={KICON.base} color={COLORS.white} />
          <Text style={S.widenTxt}>
            {nextRadius == null
              ? t("rent.widenToAny", "Search any distance")
              : t("rent.widenTo", { km: nextRadius })}
            {nextRadiusTotal != null
              ? ` · ${t("rent.widenFound", { count: nextRadiusTotal })}`
              : ""}
          </Text>
        </TouchableOpacity>
      )}

      {source === SOURCE.GPS && prefs.strictCoords && (
        <TouchableOpacity
          style={S.emptyLinkBtn}
          onPress={() => setPrefs({ strictCoords: false })}
          accessibilityRole="button"
        >
          <Text style={S.emptyLinkTxt}>
            {t("rent.includeUnlocated", "Also show listings without a shared location")}
          </Text>
        </TouchableOpacity>
      )}

      <Text style={S.emptyHint}>
        {tab === "machinery" ? t("rent.beFirstMachinery") : t("rent.beFirstWorker")}
      </Text>
      <TouchableOpacity
        style={S.addFirstBtn}
        onPress={() =>
          navigation.navigate(tab === "machinery" ? "AddMachinery" : "AddWorker")
        }
        accessibilityRole="button"
      >
        <Ionicons name="add" size={KICON.base} color={GREEN} />
        <Text style={S.addFirstTxt}>
          {tab === "machinery"
            ? t("rent.listYourMachinery")
            : t("rent.registerAsWorker")}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // ── Footer: load more + the "list your own" banner ────────────────────────
  const footer = (
    <View>
      {active.hasMore && (
        <TouchableOpacity
          style={S.loadMoreBtn}
          onPress={active.loadMore}
          disabled={active.loadingMore}
          accessibilityRole="button"
          accessibilityState={{ disabled: active.loadingMore, busy: active.loadingMore }}
        >
          {active.loadingMore ? (
            <ActivityIndicator size="small" color={GREEN} />
          ) : (
            <Ionicons name="chevron-down" size={KICON.base} color={GREEN} />
          )}
          <Text style={S.loadMoreTxt}>
            {t("rent.loadMoreOf", { remaining: Math.max(0, total - shown) })}
          </Text>
        </TouchableOpacity>
      )}

      {!active.loading && (
        <TouchableOpacity
          style={S.listBanner}
          onPress={() =>
            navigation.navigate(tab === "machinery" ? "AddMachinery" : "AddWorker")
          }
          activeOpacity={0.9}
        >
          <View style={S.listBannerLeft}>
            {tab === "machinery" ? (
              <MachineryIcon type="tractor" size={36} />
            ) : (
              <LabourIcon size={36} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={S.listBannerTitle}>
                {tab === "machinery"
                  ? t("rent.listYourMachinery")
                  : t("rent.registerAsWorker")}
              </Text>
              <Text style={S.listBannerSub}>
                {tab === "machinery"
                  ? t("rent.bannerEarnMachinery")
                  : t("rent.findWageWork")}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={KICON.lg} color={GREEN} />
        </TouchableOpacity>
      )}

      <View style={{ height: KSPACE.s32 }} />
    </View>
  );

  const renderItem = useCallback(
    ({ item, index }) =>
      tab === "machinery" ? (
        <MachineryCard
          item={item}
          index={index}
          isOwner={myId != null && (myId === item.owner?.id || myId === item.ownerId)}
          bookingStatus={bookingMap[item.id]}
          distanceMode={distanceMode}
          onPress={openMachinery}
        />
      ) : (
        <WorkerCard
          item={item}
          index={index}
          isOwner={myId != null && (myId === item.provider?.id || myId === item.providerId)}
          bookingStatus={bookingMap[item.id]}
          distanceMode={distanceMode}
          onPress={openLabour}
        />
      ),
    [tab, myId, bookingMap, distanceMode, openMachinery, openLabour],
  );

  return (
    <AnimatedScreen>
      <View style={[S.root, { paddingTop: insets.top }]}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

        {active.error && !active.loading && (
          <TouchableOpacity
            style={S.errorBanner}
            onPress={active.refresh}
            accessibilityRole="button"
          >
            <Ionicons
              name="cloud-offline-outline"
              size={KICON.base}
              color={COLORS.white}
              style={{ marginRight: KSPACE.s6 }}
            />
            <Text style={S.errorBannerTxt}>
              {t("rent.fetchError", "Could not load listings. Tap to retry.")}
            </Text>
          </TouchableOpacity>
        )}

        {/* ── Header (collapses on scroll) ── */}
        <Animated.View style={headerAnimatedStyle}>
          <View style={S.header}>
            <View style={{ flex: 1 }}>
              <Text style={S.headerTitle}>{t("rentTitle")}</Text>
            </View>
            <View
              style={[
                S.gpsDot,
                { backgroundColor: coords != null ? COLORS.sellerAccentLight : COLORS.cta },
              ]}
            />
            {hasListings && (
              <TouchableOpacity
                style={S.bellBtn}
                onPress={() => navigation.navigate("RentBookings")}
                accessibilityRole="button"
              >
                <Ionicons
                  name="notifications-outline"
                  size={KICON.xl}
                  color={COLORS.charcoal}
                />
                {pendingCount > 0 && (
                  <View style={S.bellBadge}>
                    <Text style={S.bellBadgeTxt}>
                      {pendingCount > 9 ? "9+" : pendingCount}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>

        {/* ── Tabs (always visible) ── */}
        <View style={S.tabBar}>
          {[
            { key: "machinery", tKey: "machineryTab", icon: "construct-outline" },
            { key: "labour", tKey: "workersTab", icon: "people-outline" },
          ].map((tb) => (
            <TouchableOpacity
              key={tb.key}
              style={[S.tabItem, tab === tb.key && S.tabItemActive]}
              onPress={() => switchTab(tb.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === tb.key }}
            >
              <Ionicons
                name={tb.icon}
                size={KICON.base}
                color={tab === tb.key ? GREEN : COLORS.grayMedium}
              />
              <Text style={[S.tabTxt, tab === tb.key && S.tabTxtActive]}>
                {t("rent." + tb.tKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* One virtualized list. The old screen nested two scrollEnabled={false}
            FlatLists inside a ScrollView, which rendered every row eagerly and
            had nowhere to hang pagination. */}
        <FlatList
          ref={listRef}
          key={tab}
          data={active.items}
          extraData={bookingMap}
          keyExtractor={(item) => String(item.id)}
          numColumns={2}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          ListFooterComponent={footer}
          contentContainerStyle={S.listContent}
          columnWrapperStyle={S.gridRow}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScroll={hideOnScroll}
          scrollEventThrottle={16}
          onEndReached={active.loadMore}
          onEndReachedThreshold={0.6}
          removeClippedSubviews={false}
        />

        <ScrollToTopButton visible={showTopBtn} onPress={scrollTop} />

        <RentLocationSheet
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
          prefs={prefs}
          setPrefs={setPrefs}
          coords={coords}
          permissionDenied={permissionDenied}
          locationError={gpsError}
          refreshing={gpsRefreshing}
          onRefreshGps={refreshGps}
          searchActive={searchActive}
        />
      </View>
    </AnimatedScreen>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  errorBanner: {
    backgroundColor: COLORS.error,
    paddingVertical: KSPACE.s8,
    paddingHorizontal: KSPACE.s16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  errorBannerTxt: { fontSize: 13, fontWeight: "600", color: COLORS.white, flexShrink: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: KSPACE.s18,
    paddingVertical: KSPACE.s14,
    backgroundColor: COLORS.surface,
    borderBottomWidth: KBORDER.hairline,
    borderBottomColor: COLORS.border,
    gap: 9,
    ...SHADOWS.small,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: TYPE.weight.black,
    letterSpacing: -0.3,
    color: COLORS.textDark,
  },
  gpsDot: { ...circle(8) },
  bellBtn: { padding: KSPACE.s4, position: "relative" },
  bellBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: COLORS.error,
    borderRadius: 8,
    minWidth: 16,
    // minHeight, not height: this box holds text, and at a large OS text size a
    // fixed 16 clipped the count instead of growing with it.
    minHeight: 16,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: KSPACE.s3,
  },
  bellBadgeTxt: { fontSize: 9, fontWeight: "800", color: COLORS.white },

  tabBar: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    paddingHorizontal: KGUTTER.base,
    borderBottomWidth: KBORDER.hairline,
    borderBottomColor: COLORS.border,
  },
  tabItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: KSPACE.s6,
    minHeight: 44,
    paddingVertical: KSPACE.s12,
    borderBottomWidth: 2.5,
    borderBottomColor: "transparent",
  },
  tabItemActive: { borderBottomColor: GREEN },
  tabTxt: { fontSize: 14, fontWeight: "600", color: COLORS.textMedium },
  tabTxtActive: { color: GREEN, fontWeight: "800" },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: KSPACE.s8,
    paddingHorizontal: KGUTTER.base, paddingTop: KSPACE.s16, paddingBottom: KSPACE.s8,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: KSPACE.s10,
    backgroundColor: COLORS.surface,
    borderRadius: KRADIUS.r18,
    paddingHorizontal: KSPACE.s14,
    paddingVertical: KSPACE.s12,
    borderWidth: KBORDER.chip,
    borderColor: KHET.primary,
    ...SHADOWS.small,
  },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.textDark, padding: KSPACE.s0 },

  // GPS unavailable notice
  gpsNotice: {
    flexDirection: "row",
    gap: KSPACE.s8,
    marginHorizontal: KGUTTER.base,
    marginTop: KSPACE.s8,
    padding: KSPACE.s12,
    backgroundColor: COLORS.orangeWarm,
    borderRadius: KRADIUS.r12,
    borderWidth: KBORDER.hairline,
    borderColor: withAlpha(COLORS.cta, "35"),
  },
  gpsNoticeTxt: { fontSize: 12, lineHeight: 17, color: COLORS.textBody },
  gpsNoticeBtns: { flexDirection: "row", flexWrap: "wrap", gap: KSPACE.s8, marginTop: KSPACE.s8 },
  gpsNoticeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 44,
    paddingHorizontal: KSPACE.s12,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderWidth: KBORDER.chip,
    borderColor: GREEN,
  },
  gpsNoticeBtnTxt: {
    fontSize: 12,
    fontWeight: "800",
    color: GREEN,
    flexShrink: 1,
  },

  // Category chips
  catRow: { paddingHorizontal: KGUTTER.tight, paddingVertical: KSPACE.s10, gap: KSPACE.s8 },
  catChip: {
    flexDirection: "column",
    alignItems: "center",
    gap: KSPACE.s4,
    paddingVertical: KSPACE.s6,
    paddingHorizontal: KSPACE.s6,
    // No card behind the machinery filter — the photo is the affordance, and a
    // bordered pill around each one made the row read as six competing buttons.
    backgroundColor: 'transparent',
    minWidth: 64,
  },
  catIconWrap: {
    // Cut-outs need no frame: no background, no radius, nothing to clip against.
    width: 60, height: 60,
    justifyContent: "center",
    alignItems: "center",
  },
  catLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.grayMid2,
    textAlign: "center",
  },
  catLabelActive: { color: COLORS.primary },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: KSPACE.s10,
    paddingHorizontal: KGUTTER.base,
    paddingTop: KSPACE.s12,
    paddingBottom: KSPACE.s6,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: TYPE.weight.black,
    letterSpacing: -0.2,
    color: COLORS.textDark,
    flex: 1,
  },
  countBadge: {
    backgroundColor: withAlpha(GREEN, "15"),
    borderRadius: 8,
    paddingHorizontal: KSPACE.s8,
    paddingVertical: KSPACE.s3,
  },
  countTxt: { fontSize: 11, fontWeight: "700", color: GREEN },

  scopeLine: {
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textMedium,
    paddingHorizontal: KGUTTER.base,
    paddingBottom: KSPACE.s8,
  },
  unlocatedNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: KSPACE.s6,
    marginHorizontal: KGUTTER.base,
    marginBottom: KSPACE.s8,
    padding: KSPACE.s8,
    backgroundColor: COLORS.blueBg,
    borderRadius: 8,
  },
  unlocatedNoteTxt: { flex: 1, fontSize: 11, lineHeight: 16, color: COLORS.blue },

  // "Location not shared" pill on a card
  noLocPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: KSPACE.s4,
    alignSelf: "flex-start",
    marginBottom: KSPACE.s8,
    paddingHorizontal: 7,
    paddingVertical: KSPACE.s3,
    backgroundColor: COLORS.orangeWarm,
    borderRadius: 8,
  },
  noLocTxt: { fontSize: 10, fontWeight: "700", color: COLORS.cta, flexShrink: 1 },

  // 2-column grid — column wrapper supplies the gutter, the list container the
  // outer padding; cards flex:1 so each fills its half evenly.
  listContent: { paddingHorizontal: KGUTTER.tight, paddingBottom: KSPACE.s4 },
  gridRow: { gap: KSPACE.s12, alignItems: "stretch", marginBottom: KSPACE.s16 },

  // Machinery card
  mCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 22,
    overflow: "hidden",
    ...SHADOWS.small,
  },
  mPhotoWrap: { height: 190, position: "relative" },
  mPhoto: { width: "100%", height: "100%" },
  mPhotoGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "55%",
  },
  availBadge: {
    position: "absolute",
    top: KSPACE.s10,
    right: KSPACE.s10,
    // catTag sits absolute at top-LEFT of the same image; both grow with the OS
    // text size and at 2x they collide mid-card ("Rotavator" over "Available").
    // Capping each at 45% of the card width keeps a gutter between them.
    maxWidth: "45%",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: KRADIUS.r20,
    borderWidth: KBORDER.hairline,
    paddingHorizontal: KSPACE.s10,
    paddingVertical: 5,
    backgroundColor: COLORS.white,
  },
  availDot: { width: 7, height: 7, borderRadius: 4 },
  availTxt: { fontSize: 11, fontWeight: "700", flexShrink: 1 },
  catTag: {
    position: "absolute",
    top: KSPACE.s10,
    left: KSPACE.s10,
    maxWidth: "45%",
    borderRadius: 8,
    paddingHorizontal: KSPACE.s8,
    paddingVertical: KSPACE.s4,
  },
  catTagTxt: { fontSize: 10, fontWeight: "800", color: COLORS.white, flexShrink: 1 },  // paired with numberOfLines={1} at the call site
  distOverlay: {
    position: "absolute",
    bottom: KSPACE.s8,
    right: KSPACE.s10,
    flexDirection: "row",
    alignItems: "center",
    gap: KSPACE.s3,
    backgroundColor: withAlpha(COLORS.white, 0.92),
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: KSPACE.s3,
  },
  distOverlayTxt: { fontSize: 11, fontWeight: "800", color: COLORS.blue },
  workerBooked: {
    flexDirection: "row",
    alignItems: "center",
    gap: KSPACE.s3,
    alignSelf: "flex-start",
    marginTop: KSPACE.s4,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: KSPACE.s3,
  },
  workerBookedTxt: { fontSize: 10, fontWeight: "800" },
  mBody: { padding: KSPACE.s14 },
  mTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: KSPACE.s8,
    gap: KSPACE.s8,
  },
  // flexShrink + minWidth: at 2x text the price column ("₹/hr") grew and
  // squeezed this column toward zero, so RN wrapped the machinery name one
  // CHARACTER per line ("S h a k t i m a n" down the card). numberOfLines={1}
  // does not prevent that — it only caps the line count, and a 1-char-wide
  // column still renders 1 char. The minWidth is the actual guard.
  mName: {
    fontSize: 16,
    fontWeight: TYPE.weight.black,
    color: COLORS.textDark,
    flexShrink: 1,
    minWidth: 90,
  },
  mBrand: {
    fontSize: 12,
    color: COLORS.textMedium,
    marginTop: KSPACE.s2,
  },
  mPriceCol: { alignItems: "flex-end", flexShrink: 0 },
  mPrice: { fontSize: 15, fontWeight: "900", color: GREEN },
  mPriceDay: {
    fontSize: 11,
    color: COLORS.textMedium,
    marginTop: KSPACE.s1,
  },
  mMetaRow: { flexDirection: "row", gap: KSPACE.s6, marginBottom: KSPACE.s8, flexWrap: "wrap" },
  ratingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: KSPACE.s3,
    backgroundColor: COLORS.yellowAmber,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: KSPACE.s3,
  },
  ratingTxt: { fontSize: 11, fontWeight: "700", color: COLORS.amber },
  // Shown in the rating pill's place for a worker with no ratings yet, so the
  // slot keeps its height and the card layout does not shift between the two.
  newPill: {
    // Left on the raw concat: withAlpha() rounds alpha to 3dp, and 0x12/255 =
    // 0.070588 -> 0.071 moves one channel by 1/255. Exactness over idiom.
    backgroundColor: GREEN + "12",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: KSPACE.s3,
  },
  newPillTxt: { fontSize: 11, fontWeight: "700", color: GREEN },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: KSPACE.s3,
    backgroundColor: COLORS.background,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: KSPACE.s3,
  },
  metaTxt: { fontSize: 11, fontWeight: "600", color: COLORS.textBody },
  verifiedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: KSPACE.s3,
    backgroundColor: COLORS.primaryPale,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: KSPACE.s3,
  },
  mLocRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: KSPACE.s4,
    marginBottom: KSPACE.s12,
  },
  mLocTxt: {
    fontSize: 12,
    color: COLORS.textMedium,
    flex: 1,
  },
  bookBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: KSPACE.s6,
    backgroundColor: GREEN,
    borderRadius: KRADIUS.r12,
    paddingVertical: KSPACE.s12,
  },
  // flexShrink matches every sibling CTA label (ownTagTxt, callBtnTxt, widenTxt,
  // addFirstTxt); without it a long Marathi "Book now" overflowed the button at
  // 360dp. Costs nothing when the label already fits.
  bookBtnTxt: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.white,
    flexShrink: 1,
  },
  ownTag: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: COLORS.primaryPale,
    borderRadius: KRADIUS.r12,
    borderWidth: KBORDER.chip,
    borderColor: withAlpha(GREEN, "40"),
    paddingVertical: KSPACE.s10,
    paddingHorizontal: KSPACE.s10,
  },
  ownTagTxt: {
    fontSize: 12,
    fontWeight: "800",
    color: GREEN,
    flexShrink: 1,
  },
  bookedTag: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: KRADIUS.r12,
    borderWidth: KBORDER.chip,
    paddingVertical: KSPACE.s10,
    paddingHorizontal: KSPACE.s10,
  },
  bookedTagTxt: { fontSize: 12, fontWeight: "800", flexShrink: 1 },

  // Worker card
  // Vertical card — it lives in a 2-column grid (~155px wide), so the content
  // stacks rather than sitting in three side-by-side columns.
  wCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: KRADIUS.r20,
    overflow: "hidden",
    ...SHADOWS.small,
  },
  wHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: KSPACE.s10,
    paddingHorizontal: KSPACE.s12,
    paddingTop: KSPACE.s12,
  },
  wHeaderTxt: { flex: 1, minWidth: 0 },
  wBody: {
    paddingHorizontal: KSPACE.s12,
    paddingBottom: KSPACE.s12,
    paddingTop: KSPACE.s8,
    gap: KSPACE.s6,
  },
  wAvatarWrap: { position: "relative" },
  // 44 not 56: at ~155px column width the avatar plus its gap was eating a
  // third of the row before the name started.
  wAvatar: {
    ...circle(44),
    borderWidth: KBORDER.selected,
    borderColor: withAlpha(GREEN, "40"),
  },
  wAvatarPlaceholder: {
    ...circle(44),
    backgroundColor: withAlpha(GREEN, "15"),
    justifyContent: "center",
    alignItems: "center",
    borderWidth: KBORDER.selected,
    borderColor: withAlpha(GREEN, "30"),
  },
  wInitials: { fontSize: 15, fontWeight: "800", color: GREEN },
  wAvailDot: {
    position: "absolute",
    bottom: KSPACE.s1,
    right: KSPACE.s1,
    ...circle(14),
    borderWidth: 2.5,
    borderColor: COLORS.white,
  },
  wName: { fontSize: 14, fontWeight: TYPE.weight.black, color: COLORS.textDark },
  wGroup: {
    fontSize: 11,
    color: COLORS.textMedium,
    marginTop: KSPACE.s1,
  },
  wSkillsWrap: { flexDirection: "row", flexWrap: "wrap", gap: KSPACE.s4 },
  skillTag: {
    // See newPill: 0x12 alpha does not survive withAlpha()'s 3dp rounding.
    backgroundColor: GREEN + "12",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: KSPACE.s3,
    borderWidth: KBORDER.hairline,
    borderColor: withAlpha(GREEN, "25"),
    // Cap relative to the column, not a fixed 120px that overflowed it.
    maxWidth: "100%",
    flexShrink: 1,
  },
  skillTagTxt: { fontSize: 10, fontWeight: "700", color: GREEN },
  skillMore: {
    backgroundColor: COLORS.background,
    borderRadius: 8,
    paddingHorizontal: KSPACE.s8,
    paddingVertical: KSPACE.s4,
  },
  skillMoreTxt: { fontSize: 10, fontWeight: "700", color: COLORS.grayMid2 },
  wMetaRow: { flexDirection: "row", alignItems: "center", gap: KSPACE.s4 },
  wMetaTxt: {
    fontSize: 11,
    color: COLORS.textMedium,
    flex: 1,
  },
  // Price and rating share a row; the CTA is full-width below them, so the
  // Call button can no longer land on top of the price.
  wPriceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: KSPACE.s6,
  },
  wPriceCol: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: KSPACE.s1,
    flexShrink: 1,
  },
  wPrice: { fontSize: 15, fontWeight: "900", color: GREEN },
  wPriceUnit: { fontSize: 10, fontWeight: "600", color: COLORS.textMedium },
  // Full-width CTA at the bottom of the card, matching machinery's bookBtn.
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: GREEN,
    borderRadius: KRADIUS.r10,
    paddingVertical: 9,
    marginTop: KSPACE.s2,
  },
  callBtnTxt: { fontSize: 12, fontWeight: "800", color: COLORS.white },

  emptyWrap: {
    alignItems: "center",
    paddingVertical: KSPACE.s40,
    paddingHorizontal: KSPACE.s24,
    gap: KSPACE.s8,
  },
  emptyIconBg: {
    ...circle(80),
    backgroundColor: COLORS.primaryPale,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: KSPACE.s8,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.textDark,
    textAlign: "center",
  },
  emptyTxt: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.textMedium,
    textAlign: "center",
  },
  emptyHint: {
    fontSize: 12,
    color: COLORS.textMedium,
    textAlign: "center",
    marginTop: KSPACE.s8,
  },
  widenBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: KSPACE.s8,
    minHeight: 44,
    paddingHorizontal: KSPACE.s16,
    backgroundColor: GREEN,
    borderRadius: KRADIUS.r12,
    marginTop: KSPACE.s8,
  },
  widenTxt: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.white,
    flexShrink: 1,
    textAlign: "center",
  },
  emptyLinkBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: KSPACE.s8 },
  emptyLinkTxt: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.blue,
    textAlign: "center",
    textDecorationLine: "underline",
  },
  addFirstBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: KSPACE.s6,
    minHeight: 44,
    borderWidth: KBORDER.chip,
    borderColor: GREEN,
    borderRadius: KRADIUS.r10,
    paddingHorizontal: KSPACE.s16,
  },
  addFirstTxt: { fontSize: 13, fontWeight: "700", color: GREEN, flexShrink: 1 },

  loadMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: KSPACE.s8,
    minHeight: 44,
    marginHorizontal: KSPACE.s8,
    marginBottom: KSPACE.s12,
    paddingHorizontal: KSPACE.s16,
    backgroundColor: COLORS.surface,
    borderRadius: KRADIUS.r12,
    borderWidth: KBORDER.chip,
    borderColor: withAlpha(GREEN, "40"),
  },
  loadMoreTxt: { fontSize: 13, fontWeight: "800", color: GREEN, flexShrink: 1 },

  listBanner: {
    marginHorizontal: KSPACE.s0,
    marginVertical: KSPACE.s8,
    backgroundColor: COLORS.white,
    borderRadius: KRADIUS.r16,
    padding: KSPACE.s16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: KBORDER.chip,
    borderColor: withAlpha(GREEN, "30"),
    shadowColor: COLORS.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  listBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: KSPACE.s12,
    flex: 1,
  },
  listBannerTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textDark,
    marginBottom: KSPACE.s2,
  },
  listBannerSub: {
    fontSize: 12,
    color: COLORS.textMedium,
    lineHeight: 16,
  },
});

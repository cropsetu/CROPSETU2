/**
 * PhotoIcon — a real photograph of a thing, with the existing SVG icon as fallback.
 *
 * Tier 2 + tier 3 of the stack in docs/branding/IMAGE_PROCESS.md §4:
 *   bundled photo  →  existing SVG component  →  never a blank box.
 *
 * SIZE RULE (IMAGE_PROCESS.md §2): only use this at >= 48 dp. Below that a photograph
 * has no controlled silhouette and turns to mud, where the hand-drawn SVG still reads.
 * If a caller needs < 48 dp, render the SVG directly instead of reaching for this.
 */
import React from 'react';
import { Image, StyleSheet } from 'react-native';
import { resolveVariant } from '@cropsetu/shared/components/StoreCategoryIcons';
import { resolveVariant as resolveWx } from './WeatherIcons';
import { CLOUDINARY_CLOUD_NAME } from '@cropsetu/shared/constants/config';

/**
 * Sets served from Cloudinary rather than bundled (IMAGE_PROCESS.md §4).
 *
 * These are browse surfaces — crops, animals, store categories, machinery — that
 * already need a network to show listings at all, so bundling ~1.4 MB of them
 * buys no offline benefit on a low-end-Android target. Offline, the SVG kit
 * renders exactly as it did before; the photo is the enhancement, not the floor.
 *
 * Same transform the rest of the app uses: f_auto picks WebP/AVIF per device,
 * q_auto:eco trades a little quality for bytes, c_limit never upscales.
 */
const CDN_SETS = new Set(['crop', 'animal', 'cat', 'mach', 'scheme', 'order', 'notif']);

/**
 * Bump when assets are re-uploaded. Cloudinary treats a /v<n>/ segment as a
 * cache-buster, and without one the OS image cache keeps serving the previous
 * upload for the same URL — which is exactly how the pre-alpha animal cut-outs
 * kept rendering with their old opaque backgrounds after a re-upload.
 */
const ASSET_VERSION = 3;

function cdnUri(set, key, size) {
  if (!CLOUDINARY_CLOUD_NAME) return null;
  const w = Math.round(size * 2);           // @2x for the device pixel ratio
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload`
       + `/f_auto,q_auto:eco,w_${w},c_limit/v${ASSET_VERSION}/krushisarva/ui/${set}/${encodeURIComponent(key)}`;
}

/**
 * Every generated photographic set, keyed exactly as the app's own enums/constants key them,
 * so a lookup is `PhotoIcon set="crop" name={cropName}` with no translation layer.
 * Metro resolves @2x from the same path, so one entry per asset covers both densities.
 */
const SETS = {
  activity: {
    EXPENSE: require('../../assets/act/EXPENSE.webp'),
    FERTILIZER: require('../../assets/act/FERTILIZER.webp'),
    HARVEST: require('../../assets/act/HARVEST.webp'),
    INCOME: require('../../assets/act/INCOME.webp'),
    IRRIGATION: require('../../assets/act/IRRIGATION.webp'),
    LAND_PREP: require('../../assets/act/LAND_PREP.webp'),
    OTHER: require('../../assets/act/OTHER.webp'),
    PRUNING: require('../../assets/act/PRUNING.webp'),
    SALE: require('../../assets/act/SALE.webp'),
    SCOUT: require('../../assets/act/SCOUT.webp'),
    SOWING: require('../../assets/act/SOWING.webp'),
    SPRAY: require('../../assets/act/SPRAY.webp'),
    WEEDING: require('../../assets/act/WEEDING.webp'),
  },
  ai: {
    avatar: require('../../assets/ai/avatar.webp'),
    "chat-empty": require('../../assets/ai/chat-empty.webp'),
  },
  imp: {
    bullock: require('../../assets/imp/bullock.webp'),
    manual: require('../../assets/imp/manual.webp'),
    power_tiller: require('../../assets/imp/power_tiller.webp'),
    tractor: require('../../assets/imp/tractor.webp'),
  },
  irrigation: {
    drip: require('../../assets/irrigation/drip.webp'),
    flood: require('../../assets/irrigation/flood.webp'),
    furrow: require('../../assets/irrigation/furrow.webp'),
    mixed: require('../../assets/irrigation/mixed.webp'),
    rainfed: require('../../assets/irrigation/rainfed.webp'),
    sprinkler: require('../../assets/irrigation/sprinkler.webp'),
  },
  onboard: {
    advice: require('../../assets/onboard/advice.webp'),
    market: require('../../assets/onboard/market.webp'),
    scan: require('../../assets/onboard/scan.webp'),
  },
  ops: {
    bund: require('../../assets/ops/bund.webp'),
    harrowing: require('../../assets/ops/harrowing.webp'),
    levelling: require('../../assets/ops/levelling.webp'),
    ploughing: require('../../assets/ops/ploughing.webp'),
  },
  placeholders: {
    product: require('../../assets/placeholders/product.webp'),
    profile: require('../../assets/placeholders/profile.webp'),
  },
  scenes: {
    "stage-flowering": require('../../assets/scenes/stage-flowering.webp'),
    "stage-fruiting": require('../../assets/scenes/stage-fruiting.webp'),
    "stage-harvested": require('../../assets/scenes/stage-harvested.webp'),
    "stage-land-prep": require('../../assets/scenes/stage-land-prep.webp'),
    "stage-maturity": require('../../assets/scenes/stage-maturity.webp'),
    "stage-planning": require('../../assets/scenes/stage-planning.webp'),
    "stage-sowing": require('../../assets/scenes/stage-sowing.webp'),
    "stage-vegetative": require('../../assets/scenes/stage-vegetative.webp'),
  },
  scout: {
    deficiency: require('../../assets/scout/deficiency.webp'),
    disease: require('../../assets/scout/disease.webp'),
    healthy: require('../../assets/scout/healthy.webp'),
    pest: require('../../assets/scout/pest.webp'),
    weed: require('../../assets/scout/weed.webp'),
  },
  sev: {
    critical: require('../../assets/sev/critical.webp'),
    high: require('../../assets/sev/high.webp'),
    low: require('../../assets/sev/low.webp'),
    moderate: require('../../assets/sev/moderate.webp'),
  },
  soil: {
    alluvial: require('../../assets/soil/alluvial.webp'),
    black: require('../../assets/soil/black.webp'),
    clay: require('../../assets/soil/clay.webp'),
    laterite: require('../../assets/soil/laterite.webp'),
    red: require('../../assets/soil/red.webp'),
    sandy: require('../../assets/soil/sandy.webp'),
    sandy_loam: require('../../assets/soil/sandy_loam.webp'),
    unknown: require('../../assets/soil/unknown.webp'),
  },
  sow: {
    broadcasting: require('../../assets/sow/broadcasting.webp'),
    dibbling: require('../../assets/sow/dibbling.webp'),
    line_sowing: require('../../assets/sow/line_sowing.webp'),
    transplant: require('../../assets/sow/transplant.webp'),
  },
  state: {
    empty: require('../../assets/state/empty.webp'),
    error: require('../../assets/state/error.webp'),
    "no-results": require('../../assets/state/no-results.webp'),
    offline: require('../../assets/state/offline.webp'),
    success: require('../../assets/state/success.webp'),
  },
  svc: {
    farms: require('../../assets/svc/farms.webp'),
    markets: require('../../assets/svc/markets.webp'),
    scan: require('../../assets/svc/scan.webp'),
    soil: require('../../assets/svc/soil.webp'),
    soilscan: require('../../assets/svc/soilscan.webp'),
    voice: require('../../assets/svc/voice.webp'),
  },
  symptoms: {
    brown_spots: require('../../assets/symptoms/brown_spots.webp'),
    curling_leaves: require('../../assets/symptoms/curling_leaves.webp'),
    fruit_damage: require('../../assets/symptoms/fruit_damage.webp'),
    holes: require('../../assets/symptoms/holes.webp'),
    insects: require('../../assets/symptoms/insects.webp'),
    pale_color: require('../../assets/symptoms/pale_color.webp'),
    root_rot: require('../../assets/symptoms/root_rot.webp'),
    stem_rot: require('../../assets/symptoms/stem_rot.webp'),
    stunted: require('../../assets/symptoms/stunted.webp'),
    white_powder: require('../../assets/symptoms/white_powder.webp'),
    wilting: require('../../assets/symptoms/wilting.webp'),
    yellow_leaves: require('../../assets/symptoms/yellow_leaves.webp'),
  },
  wx: {
    cloudy: require('../../assets/wx/cloudy.webp'),
    drizzle: require('../../assets/wx/drizzle.webp'),
    fog: require('../../assets/wx/fog.webp'),
    "partly-cloudy": require('../../assets/wx/partly-cloudy.webp'),
    rain: require('../../assets/wx/rain.webp'),
    snow: require('../../assets/wx/snow.webp'),
    sunny: require('../../assets/wx/sunny.webp'),
    thunderstorm: require('../../assets/wx/thunderstorm.webp'),
    windy: require('../../assets/wx/windy.webp'),
  },
};



/** `canvas` = does this set have a photo for this key? Lets callers branch cheaply. */
export function hasPhoto(set, key) {
  return Boolean(SETS[set] && SETS[set][key]);
}

/**
 * Store categories arrive as either a full category name ("Seeds & Planting Material") or the
 * Ionicon name the DB stores ("leaf"). StoreCategoryIcons already owns that normalisation, so
 * reuse its resolver rather than maintaining a second alias table that can drift from it.
 */
/** AI-hub tile ids differ from the asset keys where two tiles share one picture. */
const SVC_ALIAS = {
  disease: 'scan',        // both open Krushi Drishti
  chatSupport: 'chat',    // both open Krushi Gyaan
  voiceChat: 'voice',
  mandi: 'markets',
  stateCrops: 'statecrops',
};

/**
 * Crop keys the app uses that don't match an asset filename 1:1. The asset set was
 * built from CropIcons.js, which distinguishes Green/Red Chilli; the pickers use a
 * single "Chilli". Aliasing beats renaming the asset, which CropIcons still needs.
 */
const IRR_ALIAS = { canal: 'furrow' };  // UI key -> asset key (Prisma enum uses FURROW)

const CROP_ALIAS = { Chilli: 'Green_Chilli', Grape: 'Grapes', Chili: 'Green_Chilli' };

function keyFor(set, name) {
  if (!name) return name;
  if (set === 'crop') {
    const n = String(name).trim();
    return CROP_ALIAS[n] ?? n.replace(/ /g, '_');
  }
  if (set === 'cat') return resolveVariant(name);
  if (set === 'irrigation') return IRR_ALIAS[name] ?? name;
  if (set === 'svc') return SVC_ALIAS[name] ?? name;
  // Weather arrives as an Ionicon name or free English condition text; WeatherIcons
  // already normalises ~70 of those onto its 9 variants, which are our asset keys.
  if (set === 'wx') return resolveWx(name);
  return name;
}

export default function PhotoIcon({ set, name, size = 56, radius = 10, fill = false, fallback = null }) {
  const key = keyFor(set, name);
  const [remoteFailed, setRemoteFailed] = React.useState(false);
  // `fill` used StyleSheet.absoluteFill, which inside expo-linear-gradient did not
  // resolve to the tile box — the image rendered oversized and only its top edge
  // showed. A plain 100%/100% flex child fills the parent reliably, and `contain`
  // guarantees the whole subject is visible rather than cropping it to the box.
  const style = fill
    ? { width: '100%', height: '100%', borderRadius: radius }
    : { width: size, height: size, borderRadius: radius };
  const mode = fill ? 'contain' : 'cover';

  if (CDN_SETS.has(set) && key && !remoteFailed) {
    const uri = cdnUri(set, key, fill ? 64 : size);
    if (uri) {
      return (
        <Image
          source={{ uri }}
          style={style}
          resizeMode={mode}
          accessible={false}
          // Offline or a missing upload drops straight to the SVG — never a blank box.
          onError={() => setRemoteFailed(true)}
        />
      );
    }
  }

  const src = SETS[set]?.[key];
  if (!src) return fallback;
  // `fill` lets the photo take the whole of an already-square parent tile, which is
  // how a selection surface should look — the picture IS the choice, not a garnish.
  return (
    <Image
      source={src}
      style={style}
      resizeMode={mode}
      accessible={false}
    />
  );
}

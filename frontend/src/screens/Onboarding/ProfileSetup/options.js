// ─────────────────────────────────────────────────────────────────────────────
// CropSetu · Profile-Setup option sets (typed config)
// ─────────────────────────────────────────────────────────────────────────────
// Each option is { value, labelKey, icon } where:
//   • value    — the enum sent to the backend (stable; do not localise)
//   • labelKey — i18n key resolved through t()
//   • icon     — a descriptor the <OptionIcon/> renderer understands:
//       { kind:'crop',  key }  → app CropIcon
//       { kind:'soil',  key }  → app SoilIcon
//       { kind:'irrig', key }  → app IrrigationIcon
//       { kind:'lucide', name }→ a lucide icon (fallback for options w/o art)
// Add a row to extend any picker — nothing else needs to change.
// ─────────────────────────────────────────────────────────────────────────────
import { LANGUAGES as APP_LANGUAGES } from '../../../i18n/translations';

/** App languages, in their own script (reused from the app's i18n table). */
export const LANGUAGES = APP_LANGUAGES;

/** Common field crops — every key matches the app's CropIcon art. */
export const CROPS = [
  { value: 'Wheat',     labelKey: 'onb.crop.wheat',     icon: { kind: 'crop', key: 'Wheat' } },
  { value: 'Rice',      labelKey: 'onb.crop.rice',      icon: { kind: 'crop', key: 'Rice' } },
  { value: 'Maize',     labelKey: 'onb.crop.maize',     icon: { kind: 'crop', key: 'Maize' } },
  { value: 'Cotton',    labelKey: 'onb.crop.cotton',    icon: { kind: 'crop', key: 'Cotton' } },
  { value: 'Sugarcane', labelKey: 'onb.crop.sugarcane', icon: { kind: 'crop', key: 'Sugarcane' } },
  { value: 'Soybean',   labelKey: 'onb.crop.soybean',   icon: { kind: 'crop', key: 'Soybean' } },
  { value: 'Groundnut', labelKey: 'onb.crop.groundnut', icon: { kind: 'crop', key: 'Groundnut' } },
  { value: 'Mustard',   labelKey: 'onb.crop.mustard',   icon: { kind: 'crop', key: 'Mustard' } },
  { value: 'Bajra',     labelKey: 'onb.crop.bajra',     icon: { kind: 'crop', key: 'Bajra' } },
  { value: 'Jowar',     labelKey: 'onb.crop.jowar',     icon: { kind: 'crop', key: 'Jowar' } },
  { value: 'Gram',      labelKey: 'onb.crop.gram',      icon: { kind: 'crop', key: 'Gram' } },
  { value: 'Turmeric',  labelKey: 'onb.crop.turmeric',  icon: { kind: 'crop', key: 'Turmeric' } },
];

/** Soil types — `key` maps to the app's SoilIcon art; value is the backend enum. */
export const SOILS = [
  { value: 'BLACK',     labelKey: 'onb.soil.black',     icon: { kind: 'soil', key: 'black' } },
  { value: 'RED',       labelKey: 'onb.soil.red',       icon: { kind: 'soil', key: 'red' } },
  { value: 'ALLUVIAL',  labelKey: 'onb.soil.alluvial',  icon: { kind: 'soil', key: 'alluvial' } },
  { value: 'SANDY',     labelKey: 'onb.soil.sandy',     icon: { kind: 'soil', key: 'sandy' } },
  { value: 'CLAY_LOAM', labelKey: 'onb.soil.clay',      icon: { kind: 'soil', key: 'clay' } },
  { value: 'LATERITE',  labelKey: 'onb.soil.laterite',  icon: { kind: 'soil', key: 'laterite' } },
  { value: 'UNKNOWN',   labelKey: 'onb.soil.notsure',   icon: { kind: 'lucide', name: 'CircleQuestionMark' } },
];

/** Water source — `key` maps to the app's IrrigationIcon; borewell falls back. */
export const IRRIGATIONS = [
  { value: 'CANAL',     labelKey: 'onb.irrig.canal',     icon: { kind: 'irrig', key: 'canal' } },
  { value: 'BOREWELL',  labelKey: 'onb.irrig.borewell',  icon: { kind: 'lucide', name: 'Waves' } },
  { value: 'DRIP',      labelKey: 'onb.irrig.drip',      icon: { kind: 'irrig', key: 'drip' } },
  { value: 'SPRINKLER', labelKey: 'onb.irrig.sprinkler', icon: { kind: 'irrig', key: 'sprinkler' } },
  { value: 'RAINFED',   labelKey: 'onb.irrig.rainfed',   icon: { kind: 'irrig', key: 'rainfed' } },
  { value: 'FLOOD',     labelKey: 'onb.irrig.flood',     icon: { kind: 'irrig', key: 'flood' } },
];

/** Indian states + UTs for the location picker (display strings; stable values). */
export const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman & Nicobar', 'Chandigarh', 'Dadra & Nagar Haveli and Daman & Diu', 'Delhi',
  'Jammu & Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
].map((name) => ({ value: name, label: name }));

/** Land-size stepper bounds (acres). */
export const LAND = { min: 0, max: 200, step: 0.5, default: 1 };

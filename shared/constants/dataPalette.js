// ─────────────────────────────────────────────────────────────────────────────
// DATA PALETTE — encoding channels, NOT semantic roles.
//
// This file is deliberately separate from khetTheme.js, and importing nothing
// from it is the point. The two hold different KINDS of object:
//
//   KHET   is semantic. Every name states a ROLE ("destructiveInk", "successBg")
//          and carries a documented contrast guarantee against named surfaces.
//          A KHET token means the same thing on every screen in the app.
//
//   This   is data. STAGE_RAMP[3] means "stage 4 of 8" — its hue is fixed by its
//          POSITION, and its correctness is a property of the whole sequence
//          (monotone progression, adjacent separation), not of any one entry.
//          SECTION_TINTS is categorical: correctness is a property of the SET
//          being mutually distinguishable.
//
// Neither survives being named individually in a semantic palette. Calling the
// ramp's fourth step `KHET.stage3`, or a tint `KHET.tintWater`, would create
// entries that mean nothing outside one screen — and the next developer would
// read them as semantic and reuse "water blue" for an info state. That is
// precisely how a data palette gets laundered into a design system.
//
// Rule: components take these as ARGUMENTS (a `tint` prop), never resolve them
// by name from a theme.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crop growth-stage ramp — an ORDERED 8-step progression, sown to harvest.
 * Deep forest at the start, ripening gold at the end.
 *
 * Index IS the meaning. Do not sort, filter, or reuse a member out of sequence.
 */
export const STAGE_RAMP = [
  '#0E5C2B',  // 0 · sowing
  '#176B3A',  // 1
  '#1E8643',  // 2  — see the contrast note below; was #1F8A45
  '#2E9B53',  // 3
  '#4BAE66',  // 4
  '#74C58A',  // 5
  '#C9A227',  // 6 · ripening
  '#E0AF3B',  // 7 · harvest
];

/**
 * The legible ink for text sitting ON each ramp step, index-aligned to
 * STAGE_RAMP. Every pairing is >= 4.5:1 (WCAG AA for normal text) — measured,
 * not assumed.
 *
 * This exists because the ramp SHIPPED with white text on all eight steps, and
 * six of them failed AA — down to 2.03:1 on the gold end, which is the same
 * failure the theme file had already caught and fixed for KHET.gold. The
 * discipline existed; it had just never been pointed at this array.
 *
 * A ramp colour cannot carry a contrast guarantee on its own, because its hue
 * is fixed by its position in the sequence. So the guarantee lives here, beside
 * it, as a per-step foreground.
 *
 *   step 0  white on #0E5C2B  8.13:1
 *   step 1  white on #176B3A  6.56:1
 *   step 2  white on #1E8643  4.62:1   <- step darkened 1.5% in luminance from
 *                                         #1F8A45, where white was 4.39:1 and
 *                                         dark ink only 3.88:1. Neither passed;
 *                                         nudging the step was the smallest fix
 *                                         that kept the progression monotone.
 *   step 3  ink   on #2E9B53  4.82:1
 *   step 4  ink   on #4BAE66  6.13:1
 *   step 5  ink   on #74C58A  8.20:1
 *   step 6  ink   on #C9A227  7.05:1
 *   step 7  ink   on #E0AF3B  8.42:1
 */
const RAMP_WHITE = '#ffffff';
const RAMP_INK = '#06210d';   // === KHET.foreground, duplicated so this file
//                               imports nothing from the semantic layer.
export const STAGE_RAMP_INK = [
  RAMP_WHITE, RAMP_WHITE, RAMP_WHITE, RAMP_INK,
  RAMP_INK, RAMP_INK, RAMP_INK, RAMP_INK,
];

/**
 * Ink for text on an arbitrary ramp step. Prefer STAGE_RAMP_INK[i] when you
 * have the index; use this when the step arrives as a colour.
 */
export const stageInk = (step) => {
  const i = STAGE_RAMP.indexOf(step);
  return i === -1 ? RAMP_INK : STAGE_RAMP_INK[i];
};

/**
 * Section tints — CATEGORICAL. Each identifies a topic in the crop encyclopedia;
 * they carry no order and no magnitude.
 *
 * These are used as low-alpha washes and icon tints, not as text backgrounds, so
 * they carry no contrast guarantee. If one is ever used behind text, pair it
 * with an explicit ink the way STAGE_RAMP_INK does.
 *
 * Previously this map was half-tokenised — five raw hexes mixed with references
 * to KHET.primary / gold / primaryGlow / destructive — so one object was
 * simultaneously semantic and data. Every value is now a literal, which is what
 * makes the object's KIND unambiguous.
 */
export const SECTION_TINTS = {
  about:     '#005F21',
  varieties: '#E0AF3B',
  soil:      '#31AA40',
  seed:      '#1E8643',   // was #1F8A45 — kept in step with STAGE_RAMP[2]
  fert:      '#0A8F6E',
  water:     '#2E90C9',
  pests:     '#DF2225',
  dis:       '#B8431F',
  harvest:   '#E0AF3B',
  market:    '#C8922A',
  dd:        '#005F21',
  // Soil brown. Previously a one-off literal inline in CropDetail's summary
  // grid that never made it into the map at all, so it could not be reused and
  // could not be reviewed as part of the set.
  soilBrown: '#A6792E',
};

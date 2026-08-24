/**
 * batch7.mjs — onboarding carousel heroes, second pass.
 *
 * Slides 2 and 3 of OnboardingIntroScreen. The first pass went through the
 * `objects-3d` family, whose "one single object" rule and "phone or laptop
 * mockups" negative produced a phone with no visible screen and a lone tractor
 * with a European-looking humpless cow. These two are rebuilt on `onboard-hero`.
 *
 * New IDs rather than --redo on ONBOARD-scan / ONBOARD-market, so the originals
 * stay on disk and the change is revertible by swapping two files back.
 *
 * On text: the model is told, twice, to render NO writing. The "parameters" on
 * slide 2 are wordless pictograms — a sun-behind-cloud, a leaf, a droplet, bars.
 * The app ships in ten languages and its own pitch is "in your language", so a
 * hero with baked-in English labels would contradict the screen it sits on.
 * Image models also mangle Devanagari, which rules out doing it per-language.
 */
const KB = 1024;

const hero = (k, subject, anchor) => ({
  id: `ONBOARD2-${k}`,
  set: 'onboard-hero',
  provider: 'openai',           // transparency: the Gemini image API has no background param
  subject,
  anchor,
  outputs: [{ path: `frontend/assets/onboard/${k}.webp`, fmt: 'webp', q: 80, cap: 320 * KB }],
  density: [1024],
});

export const BATCH7 = [
  // ── Slide 2 · crop scan + AI analysis ────────────────────────────────────
  hero(
    'scan',
    `a crop-scanning moment shown as one compact group. A bare brown-skinned Indian
hand and forearm enters from the lower right holding a plain dark smartphone upright,
tilted slightly towards the viewer so its SCREEN IS VISIBLE. Standing to the left of
the phone, close and slightly overlapping it, is one large broad cotton leaf —
palmately lobed with five lobes, deep green, carrying three or four soft yellow-brown
blotches on its surface. On the phone screen: a plain deep-green live view of that same
leaf with four thin bright-green corner brackets forming a square scan frame around it,
and one thin horizontal scan line. Floating in the air around the upper half of the
phone, as if projected out of it, are FOUR small rounded translucent white cards of
equal size, evenly spaced along a gentle arc, each tilted slightly and each carrying
exactly ONE simple flat pictogram centred on an otherwise completely blank face: the
first a sun half hidden behind a cloud, the second a single leaf silhouette, the third
a water droplet, the fourth three ascending bars of a simple chart. A thin bright-green
progress arc, broken into a few segments, curves around the outside of the phone. The
cards are small, clean and uncluttered`,
    `leaf in deep #005f21 and #31aa40 with the blotches in muted ochre and warm brown,
phone body near-black, scan frame and progress arc in #31aa40, floating cards translucent
off-white #f9fdf6 with their pictograms in #005f21 and one accent in warm gold #e0af3b`,
  ),

  // ── Slide 3 · marketplace: machinery, livestock, inputs ──────────────────
  hero(
    'market',
    `three farm subjects arranged as one balanced group. LEFT: a compact Indian farm
tractor in three-quarter view from the front left, its bodywork painted a strong warm
RED, with a black seat, a plain unmarked grille, black tyres with deep chunky treads and
a vertical exhaust stack — a small utility tractor of the kind used on Indian smallholdings,
completely plain with no badge, no lettering and no number plate anywhere on it. RIGHT
and slightly behind: one WHITE Indian humped bullock, a Bos indicus zebu with a clearly
pronounced muscular shoulder HUMP, a deep loose hanging DEWLAP under its throat, upward
curving horns and long drooping ears, standing calm in profile with its head turned
towards the viewer. FRONT CENTRE, on the ground between them: a small cluster of farm
inputs — two plump woven polypropylene fertilizer sacks, one bright blue and one bright
orange, sitting upright with their tops folded and stitched, and beside them one glossy
yellow plastic agro-chemical bottle with a red cap. Every sack, bottle and surface is
completely blank and unprinted`,
    `tractor in a strong warm red, the bullock in clean off-white with pale grey shading
and a dark muzzle, fertilizer sacks in saturated cobalt blue and bright orange, bottle in
bright yellow with a red cap, all on the neutral palette of the rest of the set`,
  ),
];

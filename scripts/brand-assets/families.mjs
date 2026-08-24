/**
 * families.mjs — the prompt composition system from IMAGE_PROCESS.md §6.
 *
 * A prompt is never written whole. It is composed:
 *   LANE PREAMBLE + SUBJECT + FAMILY CLAUSES + PALETTE ANCHOR + RESTATED NO-TEXT + NEGATIVE
 *
 * The markdown in IMAGE_PROCESS.md §5 is the human source of truth. This file is the
 * executable copy. When they disagree, the markdown wins and this file is corrected.
 */

// ── Lane preambles (IMAGE_PROCESS.md §6.1) ──────────────────────────────────
export const LANES = {
  P: `Photorealistic documentary photograph, natural available light, 35 mm full-frame
at f/4, medium depth of field, true-to-life colour, no HDR, no vignette, no lens
flare, no colour grading. Rural Maharashtra on the Deccan plateau. Real Indian crop
varieties only. Absolutely NO text, letters, numbers, words, logos, watermarks or
signatures anywhere in the image.`,

  R: `Photorealistic studio product photograph of one real object, shot on a seamless
plain very light neutral background, near-white. Real materials with true real-world
texture and wear — the crumb and grit of soil, the refraction and surface tension of
water, the coarse fibre of jute, honest scratches and use-marks on painted metal, the
grain of a wooden handle. Real-world proportions and real construction. 50 mm lens,
f/8, everything in sharp focus, no depth-of-field blur. Soft large diffused key light
from the upper left with a broad fill, subtle natural ambient shadow and a soft contact
shadow directly beneath the object. True-to-life colour, neutral white balance, no
colour grading, no HDR. Three-quarter view from slightly above. One object only,
centred, nothing else in the frame. Absolutely NO text, letters, numbers, words,
logos, watermarks or signatures.`,


  // RG — Lane R's house style for a GROUP. Identical materials/lighting language,
  // but without R's "One object only … nothing else in the frame", which otherwise
  // contradicts any multi-subject family and quietly wins over the family clauses.
  RG: `Photorealistic studio photograph of real objects, lit and rendered exactly like a
high-end product shot. Real materials with true real-world texture and wear — the coarse
weave of polypropylene sacking, honest scratches and use-marks on painted metal, the
grain of a wooden handle, real hide and hair, the soft matte of a leaf. Real-world
proportions, real construction, correct relative scale between subjects. 50 mm lens,
f/8, everything in sharp focus, no depth-of-field blur. Soft large diffused key light
from the upper left with a broad fill, subtle natural ambient shadow and a soft contact
shadow beneath each element. True-to-life colour, neutral white balance, no colour
grading, no HDR, no vignette, no lens flare. Several subjects composed together as one
deliberate group. Absolutely NO text, letters, numbers, words, logos, watermarks or
signatures anywhere in the image.`,

  C: `Clean stylised botanical illustration in the style of a printed agricultural
extension field-guide poster — bold simplified shapes with confident dark-green
outlines of even weight, smooth flat colour fills with soft cel-shaded gradients,
NO photographic texture, NO fine grain, NO depth-of-field blur, NO realistic
micro-detail. The affected area is deliberately EXAGGERATED and clarified so it
reads instantly and unambiguously — larger, higher contrast and more separated than
it would be in real life, while staying botanically truthful in kind. Slightly
saturated natural colours. Absolutely NO text, letters, numbers, words, logos,
watermarks or signatures anywhere in the image.`,

  V: `Flat vector illustration, semi-flat with soft long shadows and a subtle paper
grain; clean geometric shapes, rounded stroke ends, no outlines on large fills;
limited palette drawn ONLY from deep forest green #005f21, leaf green #31aa40,
pale green #c9f2c0, mint #e3f5da, warm gold #e0af3b, muted grey-green #57685a,
warm soil brown #7E5A3C, off-white #f9fdf6; a single soft light from the upper
left; centred subject with generous margin; flat plain background; no gradient
meshes, no photorealism, no isometric 3D. Absolutely NO text, letters, numbers,
words, logos, watermarks or signatures anywhere in the image.`,
};

// ── Global negative (IMAGE_ASSETS.md §4.4) ──────────────────────────────────
const NEG_GLOBAL = `text, typography, captions, letters, Devanagari or Latin script,
numbers, UI chrome, dialog boxes, buttons, cursors, app screenshots, phone or
laptop mockups, logos, brand marks, watermarks, signatures, borders, frames,
container plates, collage, tiling, multiple panels, split screen, extra limbs,
deformed hands, six fingers, stock-photo grin, staged thumbs-up, drone or aerial
view, red barns, silos, picket fences, rolling green pasture, tulips, Caucasian
or East Asian models, glossy 3D render, plastic clay look, skeuomorphic bevels,
HDR halo, teal-and-orange grading, neon colours, purple, magenta, blue-dominant palette`;

// Per-lane additions (IMAGE_PROCESS.md §6.3)
const NEG_LANE = {
  P: `market stall, packaging, price tag, hand holding the subject, brand badge,
number plate, operator in the seat, studio softbox reflection, watermark grid`,
  R: `3D render, CGI, cartoon, illustration, drawing, painting, vector, line art,
toy, plasticine, playdough, clay, inflated balloon shapes, exaggerated proportions,
plastic sheen, chrome, mirror reflection, neon rim light, glowing edges, glass dome,
dark moody lighting, busy background, cluttered scene, multiple objects, hands
holding the object, brand badge, number plate, label print`,
  V: ``,
};
NEG_LANE.RG = NEG_LANE.R;

// ── Family templates (the §5.x "shared clauses") ────────────────────────────
export const FAMILIES = {
  // ── §5.1 · leaf-only symptoms (9). One cotton leaf, one angle, one background. ──
  'symptoms-leaf': {
    lane: 'P', size: '1024x1024', quality: 'medium', background: 'opaque',
    role: 'input-affordance',
    clauses: `Species, non-negotiable: the leaf is a COTTON leaf — palmately lobed with five
pointed lobes radiating from a single central point where the petiole joins, like a
maple or grape leaf in outline. It is NOT heart-shaped, NOT oval, NOT cordate, NOT a
simple single-blade leaf. Every image in this set must show the same leaf shape.

Setting: one single detached leaf on its short petiole, held flat against a plain
seamless very light warm-grey studio backdrop, near-white, approximately #f2f0ec,
evenly lit with no gradient and no visible horizon. No hand, no fingers, no soil, no
field, no other leaves, no scale reference.

Composition: the leaf fills 80 percent of a square frame, seen flat-on from directly
above, tip pointing straight up, petiole straight down. Lit evenly with no harsh cast
shadow across the blade. The symptom must be the single most visible thing in the
frame and must remain unmistakable at 72 by 72 pixels.

Canvas: square 1:1. Background: full-bleed, no transparency.`,
    restate: `Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO
diagnosis label, NO confidence percentage, NO arrows or callouts, NO before-and-after
split, NO second panel, NO soil, NO field, NO horizon, NO heart-shaped leaf.`,
    negativeAdd: `human skin, gore, blood, alarming red UI colouring, warning triangle,
diagnosis text, confidence percentage, before-and-after split, two panels, arrows,
callout lines, ruler, scale bar, soil, field, horizon, sky, dark background,
heart-shaped leaf, cordate leaf, oval leaf, simple unlobed leaf, multiple leaves`,
  },

  // ── §5.1 · whole-plant symptoms (3). These CANNOT be leaf-only; they need soil. ──
  'symptoms-plant': {
    lane: 'P', size: '1024x1024', quality: 'medium', background: 'opaque',
    role: 'input-affordance',
    clauses: `Species: a young COTTON plant, its leaves palmately lobed with five pointed lobes.

Setting: shot at ground level against a plain seamless very light warm-grey studio
backdrop, near-white, approximately #f2f0ec, filling the entire upper two-thirds of
the frame with no horizon and no field scene. Only a shallow band of dark soil in the
lower third, just enough to ground the plant. No other plants beyond those the subject
requires, no people, no tools, no sky.

Composition: the subject centred and filling 75 percent of a square frame. The symptom
must be the single most visible thing and must remain unmistakable at 72 by 72 pixels.

Canvas: square 1:1. Background: full-bleed, no transparency.`,
    restate: `Restated: NO text, NO letters, NO numbers, NO diagnosis label, NO arrows or
callouts, NO field rows receding to a horizon, NO sky, NO other crops in the distance.`,
    negativeAdd: `human skin, gore, warning triangle, diagnosis text, arrows, callout lines,
ruler, scale bar, field rows, horizon, sky, distant crops, farm scene, landscape,
tractor, people, dark background`,
  },

  'symptoms-cartoon': {
    lane: 'C', size: '1024x1024', quality: 'medium', background: 'opaque',
    role: 'input-affordance',
    clauses: `Species: a COTTON leaf — palmately lobed with five pointed lobes radiating from a
single central point, like a maple leaf in outline. Every image in this set uses the
same leaf shape, the same angle and the same colours, so the ONLY thing that differs
between two images is the symptom itself.

Setting: one single leaf on a short petiole, drawn flat-on from directly above, tip
pointing straight up, on a plain uniform very light warm-grey field, approximately
#f2f0ec, with no shading, no vignette and no shadow behind the leaf.

Composition: the leaf fills 80 percent of a square frame. The symptom is the single
most visible element and must be unmistakable at 72 by 72 pixels — draw it larger and
bolder than reality so it survives that size.

Canvas: square 1:1. Background: full-bleed flat colour, no transparency.`,
    restate: `Restated: NO text, NO letters, NO numbers, NO labels, NO arrows or callouts, NO
soil, NO field, NO horizon, NO photographic texture, NO heart-shaped leaf, NO frame
or border around the illustration.`,
    negativeAdd: `photograph, photorealistic, photographic texture, film grain, noise,
bokeh, depth of field, realistic shadow, soil, field, horizon, sky, arrows, callout
lines, labels, ruler, scale bar, heart-shaped leaf, cordate leaf, oval leaf, border,
frame, poster layout, colour swatch, watercolour bleed, sketchy pencil lines`,
  },

  'objects-3d': {
    lane: 'R', size: '1024x1024', quality: 'medium', background: 'transparent',
    clauses: `Composition: one single object, centred, filling 72 percent of a square frame,
three-quarter view from slightly above, on a fully transparent background with one soft
blurred contact shadow beneath it. No ground plane, no scene, no second object unless the
subject explicitly names one. Must remain identifiable at 56 by 56 pixels.

Canvas: square 1:1. Background: fully transparent.`,
    restate: `Restated: NO text, NO letters, NO numbers, NO brand badges, NO number plates,
NO labels on sacks or bottles, NO people beyond bare hands and forearms, NO faces.`,
    negativeAdd: `brand badge, manufacturer name, number plate, label, packaging print,
barcode, price tag, face, portrait, full human figure, ground plane, grass, field, sky`,
  },


  // ── onboarding heroes. NOT objects-3d: these render at ~312dp (819px), are
  // allowed to be a GROUP rather than one object, and slide 2 needs a phone and
  // a pictogram overlay that the global negative otherwise forbids outright.
  'onboard-hero': {
    lane: 'RG', size: '1024x1024', quality: 'high', background: 'transparent',
    clauses: `Composition: a single connected group of subjects arranged as one
balanced tableau, centred, filling 88 percent of a square frame, seen in three-quarter
view from slightly above, on a fully transparent background with soft blurred contact
shadows beneath each element that touches the ground. The group reads as one silhouette
with no element cropped by the frame edge. Renders at roughly 320 device-independent
pixels, so every element must stay legible at that size — no fine detail that dissolves.

Canvas: square 1:1. Background: fully transparent.`,
    restate: `Restated and absolute: there is NO writing anywhere in this image. No text,
no letters, no numbers, no words, no digits, no labels, no captions, no brand badges, no
manufacturer names, no number plates, no printing on sacks, bottles or packaging, no
readable characters of any script. Every panel, card, screen, badge and surface is either
blank or carries ONLY a simple wordless pictogram. If any surface would normally carry
writing, leave it completely empty instead.`,
    negativeDrop: [
      'UI chrome', 'dialog boxes', 'buttons', 'app screenshots',
      'phone or laptop mockups', 'multiple objects', 'hands holding the object',
      'cluttered scene', 'busy background',
    ],
    negativeAdd: `readable text of any kind, lettering, numerals, gauge readings,
speech bubbles, tooltips, brand logo, manufacturer badge, registration plate, price tag,
barcode, packaging print, face, portrait, full human figure beyond hands and forearms,
Caucasian hands, ground plane, grass, field, sky, horizon`,
  },

  scenes: {
    lane: 'R', size: '1536x1024', quality: 'medium', background: 'opaque',
    clauses: `Composition: a wide empty field backdrop. A low horizon sits at 55 percent height.
The CENTRAL 40 percent of the frame must be visually EMPTY and low in contrast — the app
composites a crop illustration there at runtime. Detail belongs only in the far left and
far right thirds and along the horizon. No single dominant object, no focal point, no figure.

Canvas: landscape 3:2. Background: full-bleed, no transparency.`,
    restate: `Restated: NO text, NO signboards, NO field markers with writing, NO scarecrow,
NO human figures, NO animals, NO buildings, NO centre-frame focal object.`,
    negativeAdd: `signboard, field marker, scarecrow, human figure, animal, building, barn,
silo, fence, tractor, centre-frame object, focal point, crop in the centre`,
  },

  brand: {
    lane: 'V', size: '1024x1024', quality: 'high', background: 'transparent',
    clauses: `Composition: perfectly centred; the subject occupies the central 60 percent of the
square with at least 20 percent clear margin on all four sides. The mark must stay
readable as a solid one-colour silhouette at 48 by 48 pixels — no thin lines, no detail
narrower than one thirtieth of the canvas, no element touching any edge, no separated
floating specks.

Canvas: square 1:1. Background: fully transparent.`,
    restate: `Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO
wordmark, NO app-store badge, NO circular or rounded-square container plate — the mark
alone on transparency.`,
    negativeAdd: `container plate, rounded-square badge, circular badge, drop-shadow bevel,
glossy 3D render, skeuomorphic gradient, clay render, app store badge, sticker outline`,
  },

  soil: {
    lane: 'R', size: '1024x1024', quality: 'medium', background: 'transparent',
    clauses: `Colour is the whole point of this image. Real soils photograph muddy and similar;
this set must not. Shoot and light this clod so its CHARACTERISTIC DEFINING HUE — the
one thing that tells a farmer which soil this is — is unmistakable and strongly
present, at the saturated end of what this soil truly looks like in the field, never
washed out toward grey-brown. It must be tellable apart at a glance from every other
soil type in the set at 64 by 64 pixels.

Composition: plain transparent background, a single soft key light from the upper
left, one gentle contact shadow directly beneath the subject, the clod centred and
filling 70 percent of a square frame, matte non-glossy surface. No hand, no tool, no
container, no scale reference. Must remain identifiable at 64 by 64 pixels.

Canvas: square 1:1. Background: fully transparent.`,
    restate: `Restated: NO text, NO letters, NO numbers, NO labels, NO measuring tape, NO
container, NO hand.`,
    negativeAdd: `pot, jar, test tube, laboratory glassware, hand, trowel, ruler, plant`,
  },

  irrigation: {
    lane: 'R', size: '1024x1024', quality: 'medium', background: 'transparent',
    clauses: `Composition: plain transparent background, a single soft key light from the upper
left, one gentle contact shadow, the subject centred and filling 70 percent of a
square frame. Water is rendered as clean translucent blue-white liquid, never as a
stylised droplet symbol. No crop plants, no people, no machinery beyond the
irrigation hardware itself. Must remain identifiable at 64 by 64 pixels.

Canvas: square 1:1. Background: fully transparent.`,
    restate: `Restated: NO text, NO letters, NO numbers, NO flow arrows, NO diagram labels, NO
measurement markings on the pipe.`,
    negativeAdd: `flow arrows, diagram labels, blueprint lines, pipe markings, gauge, meter, people`,
  },

  placeholders: {
    lane: 'R', size: '1024x1024', quality: 'medium', background: 'transparent',
    clauses: `Composition: plain transparent background, a single soft key light from the upper
left, one gentle contact shadow, the subject centred and filling 65 percent of a
square frame. Deliberately generic and neutral. Must read at 64 by 64 pixels.

Canvas: square 1:1. Background: fully transparent.`,
    restate: `Restated: NO text, NO letters, NO numbers, NO facial features, NO brand marks, NO
question mark, NO camera glyph.`,
    negativeAdd: `facial features, eyes, mouth, hair detail, specific ethnicity, specific age,
question mark, camera glyph, broken-image icon, dotted placeholder outline`,
  },
};

/** Compose the full prompt for one asset. */
export function composePrompt(asset) {
  const fam = FAMILIES[asset.set];
  if (!fam) throw new Error(`no family template for set "${asset.set}" (${asset.id})`);
  // NEG_GLOBAL was authored for flat-vector work. Three of its terms describe the
  // Lane R house style, so they must be dropped for R or they fight the preamble.
  const R_CONFLICTS = ['glossy 3D render', 'plastic clay look', 'skeuomorphic bevels'];
  const base = (fam.lane === 'R' || fam.lane === 'RG')
    ? NEG_GLOBAL.split(',').map(t => t.trim())
        .filter(t => !R_CONFLICTS.includes(t)).join(', ')
    : NEG_GLOBAL;
  // A family may legitimately need something the global/lane negative forbids
  // (the onboarding heroes need a phone, a UI overlay and more than one object).
  // Dropping is declared per-family so the global list stays strict by default.
  const norm = t => t.replace(/\s+/g, ' ').trim().toLowerCase();
  const drop = (fam.negativeDrop ?? []).map(norm);
  const negative = [base, NEG_LANE[fam.lane], fam.negativeAdd]
    .filter(Boolean).join(', ')
    .split(',').map(t => t.replace(/\s+/g, ' ').trim())
    .filter(t => t && !drop.includes(norm(t)))
    .join(', ').replace(/\s+/g, ' ').trim();
  const blocks = [
    LANES[fam.lane],
    `Subject: ${asset.subject}`,
    fam.clauses,
    asset.anchor ? `Palette anchor: ${asset.anchor}` : null,
    fam.restate,
    `Negative: ${negative}.`,
  ].filter(Boolean);
  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n');
}

export function paramsFor(asset) {
  const fam = FAMILIES[asset.set];
  return {
    size: asset.size ?? fam.size,
    quality: asset.quality ?? fam.quality,
    background: asset.background ?? fam.background,
  };
}

/** batch1.mjs — IMAGE_PROCESS.md §5.1, §5.2, §5.3, §5.24. 28 assets. */
const KB = 1024;
const sym = (key, subject, set = 'symptoms-leaf') => ({
  id: `SYMPTOM-${key}`, set, role: 'input-affordance', subject,
  outputs: [{ path: `frontend/assets/symptoms/${key}.webp`, fmt: 'webp', q: 82, cap: 16 * KB }],
  density: [144, 288], fallback: "Ionicons name='leaf-outline'",
});
const soil = (key, subject) => ({
  id: `SOIL-${key}`, set: 'soil', subject,
  outputs: [{ path: `frontend/assets/soil/${key}.webp`, fmt: 'webp', q: 90, cap: 14 * KB }],
  density: [128, 256], fallback: `SoilIcon type='${key}'`,
});
const irr = (key, subject) => ({
  id: `IRR-${key}`, set: 'irrigation', subject,
  outputs: [{ path: `frontend/assets/irrigation/${key}.webp`, fmt: 'webp', q: 78, cap: 18 * KB }],
  density: [128, 256], fallback: `IrrigationIcon type='${key}'`,
});

export const BATCH1 = [
  // ── §5.1 Crop-scan symptoms (12) — same cotton leaf, same angle, same background ──
  sym('yellow_leaves',  'a single cotton leaf whose blade has turned uniform lemon-to-mustard yellow while the veins stay distinctly green, the classic interveinal yellowing of nutrient chlorosis'),
  sym('brown_spots',    'a single green cotton leaf carrying about ten brown necrotic lesions of clearly VARYING size and IRREGULAR ragged outline, from two to nine millimetres, scattered unevenly across the blade with several merging into larger blotches and a few reaching the leaf margin — not round, not evenly spaced, not uniform'),
  sym('white_powder',   'a single green cotton leaf covered in numerous separate circular chalky-white powdery patches scattered across the whole upper blade surface, five to fifteen millimetres each, some merging into larger irregular islands, like flour dusted in blotches — the powder sits ON TOP of the green tissue and green leaf still shows clearly between the patches'),
  sym('wilting',        'a single cotton leaf that has completely lost turgor — the petiole bent sharply downward through ninety degrees so the blade hangs limply straight down, the whole leaf soft, slack and drooping like cloth, the lobes folded together and the edges softly wrinkled, still fully green with no spots and no yellowing'),
  sym('insects',        'a single green cotton leaf with a cluster of small pale-green soft-bodied aphids gathered densely along the underside of the midrib, plus two or three on the upper blade'),
  sym('holes',          'a single green cotton leaf perforated by six to ten ragged chewed holes of varying size, some at the margin leaving bitten notches, the edges of each hole slightly browned'),
  sym('stunted',        'two young cotton plants side by side in soil, the left one normal height and the right one visibly half its size with smaller crowded leaves and shortened internodes', 'symptoms-plant'),
  sym('fruit_damage',   'a single cotton boll on its stem with a dark sunken rotted patch on one side and a small round bore hole, the fibre inside discoloured brown'),
  sym('stem_rot',       'a cotton stem at soil level with a dark water-soaked brown-black lesion girdling it, the tissue above sunken and shrivelled, the surrounding soil visible', 'symptoms-plant'),
  sym('curling_leaves', 'a single green cotton leaf whose margins have rolled tightly upward and inward into tight tube-like rolls along every edge, so the whole blade is cupped into a deep boat shape with the rolled edges standing well clear of the leaf surface, the tissue between the veins visibly puckered and blistered'),
  sym('root_rot',       'a young cotton plant lifted from the soil and laid on its side, its root system dark brown, soft and stringy with the outer tissue sloughing away from the core', 'symptoms-plant'),
  sym('pale_color',     'a single cotton leaf of a washed-out pale whitish-green, uniformly faded and low in pigment across the entire blade including the veins'),

  // ── §5.2 Soil types (8 — incl. the two enum values with no icon today) ──
  soil('black',      'a rounded handful-sized clod of dark grey-black Deccan cotton soil, dense and slightly cracked, with fine shrinkage fissures across its surface'),
  soil('red',        'a rounded clod of iron-red lateritic-red soil, granular and crumbly, a few coarser grains breaking free at the base'),
  soil('alluvial',   'a rounded clod of pale fawn-brown river alluvial soil, smooth-textured and fine, faintly layered'),
  soil('sandy',      'a low conical heap of loose pale-tan sand, individual grains catching the light, the heap slumping at its edges'),
  soil('clay',       'a smooth, plastic, greyish-brown clay clod, dense and slightly glossy where it has been pressed, holding a clean thumb impression'),
  soil('laterite',   'a chunk of hard porous rust-orange laterite, pitted with irregular cavities, its surface rough and iron-stained'),
  soil('sandy_loam', 'a rounded clod of mid-brown sandy loam, visibly mixed — fine dark particles bound with pale sand grains, crumbling at one edge'),
  soil('unknown',    'three small soil clods of clearly different colours — dark grey, red-brown and pale tan — grouped together on neutral ground, none dominant'),

  // ── §5.3 Irrigation systems (6 — reconciled to the Prisma enum) ──
  irr('drip',      'a short length of black drip lateral pipe lying on dark soil with two inline emitters, a single water droplet suspended below each, a small dark wet patch spreading under them'),
  irr('sprinkler', 'a low impact sprinkler head on a short riser, throwing a fine radial fan of water droplets outward and upward in a shallow arc'),
  irr('flood',     'a bunded field plot filled with a shallow sheet of standing water, the soil bund visible along the near edge, the water surface calm and reflective'),
  irr('furrow',    'two parallel open soil furrows running toward the viewer with water flowing along the bottom of each, the ridges between them dry'),
  irr('rainfed',   'a single soft rain cloud above dry cracked field soil, with a few falling droplets and two small dark impact marks where drops have landed'),
  irr('mixed',     'a drip lateral with one emitter on the left and a sprinkler head on the right, sharing one patch of soil, both delivering water'),

  // ── §5.24 Content placeholders (2) ──
  { id: 'PLACEHOLDER-profile', set: 'placeholders',
    subject: 'a rounded matte generic head-and-shoulders silhouette wearing a simple collared shirt with a folded towel over one shoulder, warm and neutral, no facial features at all, no gender markers, no skin-tone specificity',
    outputs: [{ path: 'frontend/assets/placeholders/profile.webp', fmt: 'webp', q: 90, cap: 12 * KB }],
    density: [128, 256], fallback: 'initials in a LinearGradient circle (ProfileScreen.js:562)' },
  { id: 'PLACEHOLDER-product', set: 'placeholders',
    subject: 'a rounded matte closed cardboard carton with a small green leaf resting on its lid, plain and unbranded',
    outputs: [{ path: 'frontend/assets/placeholders/product.webp', fmt: 'webp', q: 90, cap: 12 * KB }],
    density: [128, 256], fallback: "MockImagePlaceholder category={…}" },
];

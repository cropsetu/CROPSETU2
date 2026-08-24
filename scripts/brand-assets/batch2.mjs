/** batch2.mjs — IMAGE_PROCESS.md §5.4–§5.10. 42 assets, Lane R (photoreal) + Lane P. */
const KB=1024;
const obj=(g,key,subject)=>({id:`${g}-${key}`,set:'objects-3d',subject,
  outputs:[{path:`frontend/assets/${g.toLowerCase()}/${key}.webp`,fmt:'webp',q:80,cap:20*KB}],
  density:[112,224]});
const leaf=(g,key,subject)=>({id:`${g}-${key}`,set:'symptoms-leaf',role:'input-affordance',subject,
  outputs:[{path:`frontend/assets/${g.toLowerCase()}/${key}.webp`,fmt:'webp',q:82,cap:18*KB}],
  density:[128,256]});
const scene=(key,subject)=>({id:`SCENE-${key}`,set:'scenes',subject,
  outputs:[{path:`frontend/assets/scenes/stage-${key}.webp`,fmt:'webp',q:62,cap:60*KB}],density:[720]});

export const BATCH2=[
 // §5.4 farm activities (13)
 obj('ACT','LAND_PREP','a mouldboard plough body of painted steel, its share and mouldboard polished bright by use, a little dark soil still clinging to the blade'),
 obj('ACT','SOWING','a shallow open palm holding a small heap of pale cotton seeds, a few seeds spilling over the edge of the hand'),
 obj('ACT','IRRIGATION','a short length of black drip lateral pipe with one brass inline emitter, a single water droplet hanging from the emitter'),
 obj('ACT','FERTILIZER','an open jute sack folded down at the mouth, filled with pale grey-white granular fertiliser prills, a few prills spilled at its base'),
 obj('ACT','SPRAY','a blue plastic knapsack sprayer lance with a brass adjustable nozzle at its tip, a fine mist just beginning to leave the nozzle'),
 obj('ACT','SCOUT','a round hand-held magnifying glass with a black handle, held over a single green cotton leaf so the leaf is enlarged inside the lens'),
 obj('ACT','WEEDING','a khurpi hand hoe with a worn wooden handle and a curved steel blade, a small clump of pulled weeds with soil on their roots beside it'),
 obj('ACT','PRUNING','a pair of red-handled steel secateurs, blades slightly open, one freshly cut green sprig lying beside them'),
 obj('ACT','HARVEST','a shallow woven cane basket heaped with freshly picked white cotton bolls'),
 obj('ACT','SALE','a filled jute produce sack tied at the neck with rough twine, a small stack of Indian rupee coins resting against its base'),
 obj('ACT','EXPENSE','an open palm seen from above with three Indian rupee coins resting on it, tilted slightly as if passing them away'),
 obj('ACT','INCOME','an open cupped palm holding a small neat stack of Indian rupee coins, angled toward the viewer'),
 obj('ACT','OTHER','a simple farm hand tool with a worn wooden handle and a plain steel head, generic and unspecific'),
 // §5.6 sowing methods (4)
 obj('SOW','broadcasting','an open hand caught mid-throw, scattering a spray of pale seeds outward in a wide arc'),
 obj('SOW','line_sowing','a seed drill tube with three seeds falling from its outlet in a single straight line'),
 obj('SOW','dibbling','a pointed wooden dibbler with a single seed poised at the tip of its point'),
 obj('SOW','transplant','a young cotton seedling held by its stem with an intact rounded root ball of moist dark soil around the roots'),
 // §5.7 land prep operations (4)
 obj('OPS','ploughing','a single curved furrow slice of dark soil freshly turned and inverted, its cut face smooth and its crumbly edge broken'),
 obj('OPS','harrowing','a short gang of three steel harrow discs on their axle, soil crumbs caught between them'),
 obj('OPS','levelling','a flat steel levelling blade with a wooden drag frame, a smooth strip of levelled soil behind it'),
 obj('OPS','bund','a short section of raised soil bund with a clean trapezoidal profile, freshly shaped and patted smooth'),
 // §5.8 implements (4)
 obj('IMP','tractor','a small compact Indian farm tractor in three-quarter front view, painted blue, no brand badges and no number plate'),
 obj('IMP','bullock','a yoked pair of white Indian bullocks harnessed to a plain wooden plough beam, seen from the side'),
 obj('IMP','power_tiller','a two-wheel walking power tiller with long handlebars and a rotary tine assembly'),
 obj('IMP','manual','a khurpi and a short pickaxe crossed over one another, worn wooden handles and used steel heads'),
 // §5.9 scout issue types (5) — Lane P, leaf on neutral
 leaf('SCOUT','pest','a single green cotton leaf with three small chewing caterpillars on its surface and ragged feeding damage at the margin'),
 leaf('SCOUT','disease','a single green cotton leaf with one spreading brown-black lesion bounded by a yellow halo, no insects present'),
 leaf('SCOUT','weed','a broadleaf weed seedling growing up between two cotton seedlings, visibly a different plant from the crop around it'),
 leaf('SCOUT','deficiency','a single cotton leaf showing sharp interveinal yellowing with the veins remaining dark green, uniform across the blade, no spots and no insects'),
 leaf('SCOUT','healthy','a single deep-green cotton leaf, unblemished, turgid and evenly coloured with a faint natural sheen'),
 // §5.10 severity ramp (4) — one subject, four steps
 leaf('SEV','low','a single green cotton leaf with only about five percent of its blade affected by light brown discolouration at one edge'),
 leaf('SEV','moderate','a single cotton leaf with about twenty-five percent of its blade affected by brown discolouration spreading from the margin'),
 leaf('SEV','high','a single cotton leaf with about fifty-five percent of its blade brown and necrotic, the remaining tissue yellowing'),
 leaf('SEV','critical','a single cotton leaf with about eighty-five percent of its blade brown, dry and necrotic, only a small green patch remaining at the base'),
 // §5.5 growth stages (8)
 scene('planning','bare unworked ground with dry stubble and a few scattered stones, a thin line of neem trees along the far bund; soil #9C7A55, horizon greening toward #CFE0C4'),
 scene('land-prep','freshly ploughed soil in deep parallel furrows running toward the horizon, loose clods, no crop; soil #7E5A3C, horizon warming toward #D8C3A2'),
 scene('sowing','flat prepared seedbeds with faint seed lines and a few just-emerged specks of green; soil #6B4A30, horizon greening toward #C7DDAE'),
 scene('vegetative','dense low green foliage covering the beds, soil barely visible between the rows; soil #5C7C3A, horizon #9CC97E'),
 scene('flowering','lush green rows dotted with small pale flowers; soil #4F7A34, horizon #86BE6A'),
 scene('fruiting','heavy green rows with the plants visibly weighted down, deeper shadow between the rows; soil #4A722F, horizon #7FB45F'),
 scene('maturity','the field turned gold and dry, stalks leaning, warm late light; soil #9C7E2E, horizon #D9C36A'),
 scene('harvested','cut stubble rows with a few stacked bundles at the far left edge only, open cleared ground; soil #B79237, horizon #C9B25A'),
];

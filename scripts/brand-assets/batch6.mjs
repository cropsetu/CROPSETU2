/** batch6.mjs — B6 schemes/status/notifications (23) + B0 non-alpha assets. */
const KB=1024;
const o=(g,k,s,cap=18)=>({id:`${g}-${k}`,set:'objects-3d',subject:s,
  outputs:[{path:`frontend/assets/${g.toLowerCase()}/${k}.webp`,fmt:'webp',q:80,cap:cap*KB}],density:[112,224]});
export const BATCH6=[
 // The ONE asset that must be OpenAI: Gemini has no transparent-background parameter,
 // and the adaptive / monochrome / notification icons all need true alpha.
 { id:'IMG-BRAND-001', set:'brand', provider:'openai', quality:'high',
   subject:'a single app-icon mark — one upright young shoot bearing three leaves rising out of a cupped open hand simplified to two smooth curved shapes, with a small warm-gold sun disc tucked behind the topmost leaf; bold, symmetrical, one unbroken silhouette',
   anchor:'shoot and leaves in #005f21 and #31aa40, the cupped hand in #c9f2c0, the sun disc in #e0af3b; exactly four flat colours, no intermediate tints',
   outputs:[] },
 // ── Government schemes (9) — benefit-literal, no text, no emblems ──
 o('SCHEME','PMKISAN','an open cupped palm receiving a small stack of Indian rupee coins'),
 o('SCHEME','PMFBY','an open umbrella sheltering a short row of healthy green crop seedlings from rain'),
 o('SCHEME','KCC','a plain unbranded plastic card lying beside a small jute seed sack'),
 o('SCHEME','SMAM','a small compact tractor beside a stack of Indian coins'),
 o('SCHEME','PMKSY-PDMC','a drip lateral pipe with an emitter beside a small stack of Indian coins'),
 o('SCHEME','NMSA-SHC','a printed soil test card lying on dark soil beside a small clod'),
 o('SCHEME','PM-KMY','the weathered hands of an elderly farmer resting together on the top of a walking staff'),
 o('SCHEME','eNAM','two hands meeting over a filled produce sack, one passing coins to the other'),
 o('SCHEME','AIF','a small grain storage silo beside a stack of Indian coins'),
 // ── Order status (6) ──
 o('ORDER','PENDING','a sealed brown cardboard parcel resting closed and untouched'),
 o('ORDER','CONFIRMED','a brown cardboard parcel with a clean paper seal freshly applied across its flap'),
 o('ORDER','SHIPPED','a small delivery van in three-quarter view with a parcel visible in the open rear'),
 o('ORDER','DELIVERED','a brown cardboard parcel set down on a doorstep threshold'),
 o('ORDER','CANCELLED','a brown cardboard parcel lying on its side with its flaps open and empty'),
 o('ORDER','REFUNDED','an open palm receiving a small stack of Indian coins back, a folded parcel behind'),
 // ── Notification types (8) ──
 o('NOTIF','ORDER_UPDATE','a small brown parcel with a paper slip tucked under its tape'),
 o('NOTIF','BOOKING_UPDATE','a desk calendar block with one date page turned up'),
 o('NOTIF','NEW_MESSAGE','a folded paper note tucked into a small envelope'),
 o('NOTIF','NEW_COMMENT','two small folded paper notes overlapping, one behind the other'),
 o('NOTIF','POST_LIKE','a small pressed green leaf resting on a plain paper card'),
 o('NOTIF','SYSTEM','a plain brass hand bell standing upright'),
 o('NOTIF','CROP_REPORT_RECEIVED','a printed crop report page with one green leaf laid across it'),
 o('NOTIF','CROP_REPORT_REPLIED','a printed crop report page with a second page beside it and a pen resting on top'),
 // ── B0 photographic (auth + onboarding + states) — Gemini can do these ──
 {id:'AUTH-hero',set:'symptoms-plant',subject:'a Marathi farmer in his late forties standing at the edge of his own jowar field in golden hour, framed from the chest up, seen slightly from below, looking off-camera to the right with a calm unposed expression, one hand resting on a green jowar stalk; plain off-white cotton half-sleeve shirt with a folded cotton towel over one shoulder; the LOWER HALF of the frame must be visually quiet and low in contrast because the app lays a dark gradient and buttons over it',
  outputs:[{path:'shared/assets/khet/welcome-hero.webp',fmt:'webp',q:72,cap:150*KB}],density:[1080]},
 o('STATE','error','a small terracotta plant pot tipped over on its side with a little spilled soil and one intact healthy green seedling lying beside it, a small recoverable mishap',20),
 o('STATE','offline','a slender rural mobile signal tower standing on a low green mound, calm and unalarming',20),
 o('STATE','empty','a shallow empty woven cane basket resting on the ground with one small green sprout just beginning to grow beside it',20),
 o('STATE','success','a healthy young plant with four broad leaves growing from a small mound of soil',20),
 o('STATE','no-results','three small seedlings of clearly different shapes standing in a row in soil with a fourth empty gap in the row where nothing grows',20),
 o('ONBOARD','advice','an Indian farmer standing in a bunded jowar field, one hand shading his eyes, looking up at a sky holding both warm sun and one soft rain cloud',30),
 o('ONBOARD','scan','one large cotton leaf with a few soft yellow-brown blotches, held close, with a hand entering from the lower right holding a phone seen from behind so no screen is visible',30),
 o('ONBOARD','market','a small compact Indian farm tractor with two seed sacks and a sprayer on the ground beside its front wheel and one cow standing behind it',30),
];

/** batch4.mjs — B3: weather (9), AI identity (2), service tiles (11) = 22. */
const KB=1024;
const o=(g,k,s,cap=20)=>({id:`${g}-${k}`,set:'objects-3d',subject:s,
  outputs:[{path:`frontend/assets/${g.toLowerCase()}/${k}.webp`,fmt:'webp',q:80,cap:cap*KB}],density:[112,224]});
export const BATCH4=[
 // weather conditions — real sky photography, shot for a 56dp hero
 o('WX','sunny','a bright clear sun high in a cloudless blue sky, shot from below with warm golden light'),
 o('WX','partly-cloudy','the sun partly hidden behind one soft white cumulus cloud in a blue sky'),
 o('WX','cloudy','a layered bank of grey overcast cloud filling the frame, no sun visible'),
 o('WX','rain','a dark grey rain cloud with visible falling rain streaks beneath it'),
 o('WX','drizzle','a soft pale grey cloud with fine light drizzle falling in thin close streaks'),
 o('WX','thunderstorm','a dark storm cloud with one bright forked lightning bolt striking downward'),
 o('WX','fog','a low bank of pale grey mist lying across the frame, everything softened and dim'),
 o('WX','snow','a pale grey cloud with distinct white snowflakes falling beneath it'),
 o('WX','windy','a bent windswept tree with its branches and leaves blown hard to one side'),
 // AI identity
 o('AI','avatar','a smooth polished badge-shaped emblem holding one upright green shoot whose topmost leaf carries a small warm-gold spark at its tip, organic first and technological second, photographed as a real object on a plain light backdrop',24),
 o('AI','chat-empty','a smooth rounded speech-bubble form resting on soil with one small green shoot growing up out of its opening',24),
 // service tiles
 o('SVC','scan','a camera aperture ring framing one green cotton leaf, the leaf sharp inside the ring'),
 o('SVC','chat','a rounded speech bubble with a pointed tail at its lower left, one small green shoot rising from inside the bubble opening'),
 o('SVC','voice','a studio microphone with three concentric sound arcs curving out to one side'),
 o('SVC','markets','a market stall canopy over a filled produce basket with a small stack of Indian coins beside it'),
 o('SVC','weather','a bright sun disc partly behind one soft white cumulus cloud, the sun clearly visible above and to the right of the cloud'),
 o('SVC','farms','three furrow rows of soil receding in perspective with one green shoot in the centre row'),
 o('SVC','soil','a rectangular block of soil cut away to reveal three clearly distinct coloured horizon layers, no tool present'),
 o('SVC','statecrops','a raised relief map of the Indian subcontinent seen from above, with three distinct green crop shoots standing on its surface'),
 o('SVC','credits','a neat stack of Indian coins with one small warm-gold spark above the top coin'),
 o('SVC','planner','a desk calendar block standing upright with its date pages visible and one green shoot growing up through the top page'),
 o('SVC','soilscan','a printed soil test document card with a magnifying glass held over one corner'),
];

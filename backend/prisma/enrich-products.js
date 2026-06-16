/**
 * enrich-products.js — fill ALL remaining columns on the 20 generated products
 * and attach them to the verified seller "JAY SHAKTI KRUSHI KENDRE".
 *
 * Sets per product: nameHi, nameMr, manufacturer, countryOfOrigin, subcategory,
 * specifications (JSON), harvestDate (seeds only), viewCount, and the seller +
 * location columns (sellerId, district, taluka, village, state, sellScope).
 *
 * Left at sane defaults on purpose:
 *   - rating / ratingCount: kept 0 (no real Review rows exist; fabricating a
 *     rating would show "N reviews" with an empty reviews list).
 *   - harvestDate: only set for seed products; null for equipment (not applicable).
 *
 * Idempotent: matches by exact name, updates in place. Re-runnable.
 *
 * Run: DATABASE_URL="<railway public url>" node prisma/enrich-products.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Verified seller (agri-input shop, KYC VERIFIED) — owns the catalogue now.
const SELLER_ID = 'b75615e0-8582-4aeb-85be-3e6214a40f26';
const LOCATION = { district: 'AHMEDNAGAR', taluka: 'RAHURI', village: 'VAMBORI', state: 'Maharashtra' };

const DATA = [
  { name: 'Mahindra 575 DI XP Plus Tractor (47 HP)',
    nameHi: 'महिंद्रा 575 डीआई एक्सपी प्लस ट्रैक्टर (47 एचपी)', nameMr: 'महिंद्रा 575 डीआय एक्सपी प्लस ट्रॅक्टर (४७ एचपी)',
    manufacturer: 'Mahindra & Mahindra Ltd.', countryOfOrigin: 'India', subcategory: 'Tractors', views: 540,
    specifications: { Engine: '4-cylinder diesel', Power: '47 HP', 'Lift Capacity': '1600 kg', Transmission: '8 Forward + 2 Reverse', PTO: '540 RPM', 'Fuel Tank': '45 L', Warranty: '5 years / 5000 hrs' } },

  { name: 'John Deere 5050D Tractor (50 HP)',
    nameHi: 'जॉन डियर 5050डी ट्रैक्टर (50 एचपी)', nameMr: 'जॉन डिअर ५०५०डी ट्रॅक्टर (५० एचपी)',
    manufacturer: 'John Deere India Pvt. Ltd.', countryOfOrigin: 'India', subcategory: 'Tractors', views: 470,
    specifications: { Engine: '3-cylinder diesel', Power: '50 HP', 'Lift Capacity': '1800 kg', Transmission: 'Collar Shift 8F + 4R', PTO: '540 RPM', 'Fuel Tank': '60 L', Warranty: '5 years' } },

  { name: 'Honda Power Tiller F300 (7 HP)',
    nameHi: 'होंडा पावर टिलर F300 (7 एचपी)', nameMr: 'होंडा पॉवर टिलर F300 (७ एचपी)',
    manufacturer: 'Honda India Power Products Ltd.', countryOfOrigin: 'India', subcategory: 'Power Tillers', views: 310,
    specifications: { Engine: 'Honda GX-series petrol', Power: '7 HP', 'Tilling Width': '600 mm', Fuel: 'Petrol', Weight: '~130 kg', Starting: 'Recoil' } },

  { name: 'Kubota Combine Harvester DC-70 Plus',
    nameHi: 'कुबोटा कंबाइन हार्वेस्टर DC-70 प्लस', nameMr: 'कुबोटा कंबाईन हार्वेस्टर DC-70 प्लस',
    manufacturer: 'Kubota Agricultural Machinery India Pvt. Ltd.', countryOfOrigin: 'India', subcategory: 'Combine Harvesters', views: 280,
    specifications: { Type: 'Track-type combine', Crops: 'Paddy & Wheat', 'Cutting Width': '2000 mm', 'Grain Tank': '380 L', Engine: '70 HP diesel', Drive: 'Rubber crawler track' } },

  { name: 'VST Shakti Power Reaper (4-Stroke)',
    nameHi: 'वीएसटी शक्ति पावर रीपर (4-स्ट्रोक)', nameMr: 'व्हीएसटी शक्ती पॉवर रीपर (४-स्ट्रोक)',
    manufacturer: 'VST Tillers Tractors Ltd.', countryOfOrigin: 'India', subcategory: 'Reapers', views: 360,
    specifications: { Engine: '4-stroke petrol', 'Cutting Width': '1200 mm', Crops: 'Paddy & Wheat', Type: 'Walk-behind', Weight: '~28 kg' } },

  { name: 'Mahyco Hybrid Tomato Seeds (10g)',
    nameHi: 'माहिको हाइब्रिड टमाटर बीज (10 ग्राम)', nameMr: 'माहिको हायब्रिड टोमॅटो बियाणे (१० ग्रॅम)',
    manufacturer: 'Maharashtra Hybrid Seeds Co. (Mahyco)', countryOfOrigin: 'India', subcategory: 'Vegetable Seeds', views: 820, harvestDate: 'Packed for 2025-26 season',
    specifications: { Type: 'F1 Hybrid', Germination: '>90%', 'Days to Maturity': '90-95 days', 'Seed Rate': '100-120 g/acre', 'Net Weight': '10 g', 'Disease Resistance': 'Leaf-curl tolerant' } },

  { name: 'Nuziveedu BT Cotton Seeds (450g)',
    nameHi: 'नुजिवीडु बीटी कपास बीज (450 ग्राम)', nameMr: 'नुझिवीडू बीटी कापूस बियाणे (४५० ग्रॅम)',
    manufacturer: 'Nuziveedu Seeds Ltd.', countryOfOrigin: 'India', subcategory: 'Cotton Seeds', views: 610, harvestDate: 'Packed for 2025-26 Kharif',
    specifications: { Technology: 'BG-II Bt', 'Bollworm Resistance': 'Yes', Duration: '160-180 days', 'Net Weight': '450 g', Approval: 'GEAC approved' } },

  { name: 'Bayer Confidor Insecticide (Imidacloprid 17.8% SL, 500ml)',
    nameHi: 'बायर कॉन्फिडोर कीटनाशक (इमिडाक्लोप्रिड 17.8% SL, 500ml)', nameMr: 'बायर कॉन्फिडॉर कीटकनाशक (इमिडाक्लोप्रिड १७.८% SL, ५००ml)',
    manufacturer: 'Bayer CropScience Ltd.', countryOfOrigin: 'India', subcategory: 'Insecticides', views: 430,
    specifications: { 'Active Ingredient': 'Imidacloprid 17.8% SL', Action: 'Systemic', 'Target Pests': 'Aphids, Jassids, Whitefly', Dose: '100-125 ml/acre', Volume: '500 ml' } },

  { name: 'Syngenta Amistar Fungicide (Azoxystrobin 23% SC, 250ml)',
    nameHi: 'सिंजेंटा अमिस्टार फफूंदनाशक (एज़ोक्सिस्ट्रोबिन 23% SC, 250ml)', nameMr: 'सिंजेंटा अमिस्टार बुरशीनाशक (अॅझोक्सीस्ट्रोबिन २३% SC, २५०ml)',
    manufacturer: 'Syngenta India Ltd.', countryOfOrigin: 'India', subcategory: 'Fungicides', views: 390,
    specifications: { 'Active Ingredient': 'Azoxystrobin 23% SC', Action: 'Systemic (preventive + curative)', 'Target Diseases': 'Blast, Blight, Sheath rot', Dose: '200 ml/acre', Volume: '250 ml' } },

  { name: 'UPL Saaf Fungicide (Carbendazim 12% + Mancozeb 63% WP, 1kg)',
    nameHi: 'यूपीएल साफ फफूंदनाशक (कार्बेन्डाजिम 12% + मैन्कोजेब 63% WP, 1kg)', nameMr: 'यूपीएल साफ बुरशीनाशक (कार्बेन्डाझिम १२% + मॅन्कोझेब ६३% WP, १kg)',
    manufacturer: 'UPL Ltd.', countryOfOrigin: 'India', subcategory: 'Fungicides', views: 350,
    specifications: { 'Active Ingredient': 'Carbendazim 12% + Mancozeb 63% WP', Action: 'Contact + Systemic', 'Target Diseases': 'Blight, Rust, Downy mildew', Dose: '300-400 g/acre', 'Net Weight': '1 kg' } },

  { name: 'Tata Rallis Tafgor Insecticide (Dimethoate 30% EC, 1L)',
    nameHi: 'टाटा रैलिस टैफगोर कीटनाशक (डाइमेथोएट 30% EC, 1L)', nameMr: 'टाटा रॅलिस टॅफगोर कीटकनाशक (डायमेथोएट ३०% EC, १L)',
    manufacturer: 'Rallis India Ltd. (Tata Enterprise)', countryOfOrigin: 'India', subcategory: 'Insecticides', views: 300,
    specifications: { 'Active Ingredient': 'Dimethoate 30% EC', Action: 'Systemic + Contact', 'Target Pests': 'Aphids, Mites, Shoot borer', Dose: '330-660 ml/acre', Volume: '1 L' } },

  { name: 'Kirloskar 5 HP Monoblock Water Pump',
    nameHi: 'किर्लोस्कर 5 एचपी मोनोब्लॉक वाटर पंप', nameMr: 'किर्लोस्कर ५ एचपी मोनोब्लॉक वॉटर पंप',
    manufacturer: 'Kirloskar Brothers Ltd.', countryOfOrigin: 'India', subcategory: 'Water Pumps', views: 410,
    specifications: { Power: '5 HP', Phase: 'Single-phase', Type: 'Centrifugal Monoblock', 'Max Head': '40 m', Outlet: '50 mm', Body: 'Cast iron' } },

  { name: 'Crompton 1 HP Submersible Pump (V4)',
    nameHi: 'क्रॉम्पटन 1 एचपी सबमर्सिबल पंप (V4)', nameMr: 'क्रॉम्प्टन १ एचपी सबमर्सिबल पंप (V4)',
    manufacturer: 'Crompton Greaves Consumer Electricals Ltd.', countryOfOrigin: 'India', subcategory: 'Submersible Pumps', views: 360,
    specifications: { Power: '1 HP', Type: '4-inch borewell submersible', 'Max Head': '50 m', Stages: 'Multi-stage', Body: 'Stainless steel' } },

  { name: 'Jain Irrigation HDPE Pipe 63mm (100m Roll)',
    nameHi: 'जैन इरिगेशन एचडीपीई पाइप 63mm (100 मीटर रोल)', nameMr: 'जैन इरिगेशन एचडीपीई पाईप ६३mm (१०० मीटर रोल)',
    manufacturer: 'Jain Irrigation Systems Ltd.', countryOfOrigin: 'India', subcategory: 'HDPE Pipes', views: 250,
    specifications: { Material: 'HDPE PE-63', Diameter: '63 mm', Length: '100 m', 'Pressure Rating': 'PN 6', Feature: 'UV stabilised', Standard: 'IS 4984' } },

  { name: 'Finolex PVC Pipes 4-inch (Pack of 6, 3m each)',
    nameHi: 'फिनोलेक्स पीवीसी पाइप 4-इंच (6 का पैक)', nameMr: 'फिनोलेक्स पीव्हीसी पाईप ४-इंच (६ चा संच)',
    manufacturer: 'Finolex Industries Ltd.', countryOfOrigin: 'India', subcategory: 'PVC Pipes', views: 230,
    specifications: { Material: 'Rigid PVC-U', Diameter: '4 inch (110 mm)', 'Length each': '3 m', Quantity: '6 pipes', Standard: 'ISI IS 4985', Joint: 'Socket' } },

  { name: 'Tata Power Solar Panel 330W Polycrystalline',
    nameHi: 'टाटा पावर सोलर पैनल 330W पॉलीक्रिस्टलाइन', nameMr: 'टाटा पॉवर सोलर पॅनेल 330W पॉलीक्रिस्टलाईन',
    manufacturer: 'Tata Power Solar Systems Ltd.', countryOfOrigin: 'India', subcategory: 'Solar Panels', views: 690,
    specifications: { 'Peak Power': '330 W', Type: 'Polycrystalline', Cells: '72 cells', Glass: 'Anti-reflective tempered', Efficiency: '~17%', Warranty: '25-year performance' } },

  { name: 'Luminous Solar Water Pump 3 HP (DC)',
    nameHi: 'ल्यूमिनस सोलर वाटर पंप 3 एचपी (DC)', nameMr: 'ल्युमिनस सोलर वॉटर पंप ३ एचपी (DC)',
    manufacturer: 'Luminous Power Technologies Pvt. Ltd.', countryOfOrigin: 'India', subcategory: 'Solar Pumps', views: 320,
    specifications: { Power: '3 HP DC', Type: 'Submersible solar pump set', 'Panel Capacity': '3000 Wp', Scheme: 'PM-KUSUM eligible', Warranty: '5 years', Includes: 'Panels + Controller + Pump' } },

  { name: 'Aspee Battery Knapsack Sprayer 16L',
    nameHi: 'एस्पी बैटरी नैपसैक स्प्रेयर 16L', nameMr: 'एस्पी बॅटरी नॅपसॅक फवारणी पंप १६L',
    manufacturer: 'American Spring & Pressing Works Pvt. Ltd. (Aspee)', countryOfOrigin: 'India', subcategory: 'Sprayers', views: 480,
    specifications: { 'Tank Capacity': '16 L', Power: 'Rechargeable 12V battery', Runtime: '~6 hrs/charge', Nozzles: 'Adjustable (multiple)', Type: 'Knapsack' } },

  { name: 'Falcon Garden Hand Tool Set (Khurpi, Sickle, Trowel)',
    nameHi: 'फाल्कन गार्डन हैंड टूल सेट (खुरपी, हंसिया, ट्रॉवेल)', nameMr: 'फाल्कन गार्डन हँड टूल सेट (खुरपी, विळा, ट्रॉवेल)',
    manufacturer: 'Falcon Garden Tools Pvt. Ltd.', countryOfOrigin: 'India', subcategory: 'Hand Tools', views: 540,
    specifications: { Pieces: '3 (Khurpi, Sickle, Trowel)', Material: 'Forged steel', Handle: 'Wooden', Use: 'Weeding, harvesting, digging' } },

  { name: 'Digital Soil Moisture & pH Meter (4-in-1)',
    nameHi: 'डिजिटल मिट्टी नमी और पीएच मीटर (4-इन-1)', nameMr: 'डिजिटल माती आर्द्रता व पीएच मीटर (४-इन-१)',
    manufacturer: 'AgriTech Instruments', countryOfOrigin: 'India', subcategory: 'Soil Testing Instruments', views: 720,
    specifications: { Measures: 'Moisture, pH, Temperature, Light', Probe: 'Dual metal, battery-free', Display: 'LCD', 'pH Range': '3.5 - 9', Use: 'Field & garden' } },
];

async function main() {
  console.log(`Enriching ${DATA.length} products + attaching to seller ${SELLER_ID}\n`);
  let updated = 0, missing = 0;

  for (const d of DATA) {
    const existing = await prisma.product.findFirst({ where: { name: d.name }, select: { id: true } });
    if (!existing) { console.warn(`  ⚠  not found: ${d.name}`); missing++; continue; }

    await prisma.product.update({
      where: { id: existing.id },
      data: {
        sellerId: SELLER_ID,
        nameHi: d.nameHi, nameMr: d.nameMr,
        manufacturer: d.manufacturer, countryOfOrigin: d.countryOfOrigin,
        subcategory: d.subcategory, specifications: d.specifications,
        harvestDate: d.harvestDate ?? null,
        viewCount: d.views ?? 0,
        sellScope: 'state',
        ...LOCATION,
      },
    });
    console.log(`  ✓ ${d.name}`);
    updated++;
  }

  console.log(`\nDone — updated: ${updated}, not found: ${missing}`);
}

main()
  .catch((err) => { console.error('❌ Failed:', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());

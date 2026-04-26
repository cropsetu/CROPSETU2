/**
 * AI Service — FarmEasy Krishi Raksha
 * Routes crop disease prediction through the FarmEasy backend (Gemini 2.0 Flash).
 * Falls back to curated mock data when offline or API unavailable.
 */
import api from './api';

// ─── Map backend response → display-friendly format ───────────────────────────
function mapBackendResponse(data) {
  const fertilizers = (data.fertilizers || []).map((f) => ({
    name: f.product || f.nutrient || 'Fertilizer',
    dose: f.dose || '—',
    timing: f.timing || f.method || '—',
  }));

  const pesticides = (data.pesticides || []).map((p) => ({
    name: p.name,
    dose: p.dosePerAcre ? `${p.dose} | ${p.dosePerAcre}/acre` : (p.dose || '—'),
    timing: p.timing || '—',
  }));

  // Build a concise warning from immediateActions + disease info
  const diseaseWarning = data.primaryDisease?.name
    ? `${data.primaryDisease.name} detected — ${data.riskLevel || 'MODERATE'} risk (${data.primaryDisease.probability || 0}% probability)`
    : null;
  const actionWarning = (data.immediateActions || []).slice(0, 2).join(' • ') || null;
  const warning = diseaseWarning || actionWarning || null;

  const generalAdvice =
    (data.culturalControls || [])[0] ||
    data.analysisNotes ||
    'Consult your local Krishi Vigyan Kendra (KVK) for tailored advice.';

  return {
    fertilizers,
    pesticides,
    warning,
    generalAdvice,
    disease: data.primaryDisease || null,
    riskLevel: data.riskLevel || null,
    weatherRisk: data.weatherRisk || null,
  };
}

/**
 * Get AI crop recommendation via the FarmEasy backend (Gemini 2.0 Flash).
 * @param {Object} params - Form fields from the AI Advisor screen
 * @returns {Object} { fertilizers, pesticides, warning, generalAdvice, disease, riskLevel }
 */
export async function getAIRecommendation(params) {
  const {
    crop, soilType, landSize, problem, irrigation,
    previousCrop, symptoms, pincode, growthStage,
  } = params;

  try {
    const { data: res } = await api.post('/crop-disease/predict', {
      // Use GPS-detected pincode, fall back to Pune (Maharashtra) if unavailable
      pincode: (String(pincode || '').replace(/\D/g, '') || '411001').slice(0, 6),
      cropType: crop,
      growthStage: growthStage || 'Vegetative',
      fieldArea: landSize || '1',
      irrigationMethod: irrigation || undefined,
      prevCrop: previousCrop || undefined,
      symptoms: [problem, symptoms].filter(Boolean),
    });

    return mapBackendResponse(res.data || res);
  } catch (error) {
    console.warn('[AIService] Backend call failed, using fallback:', error.message);
    return getMockRecommendation(crop, problem);
  }
}

// ─── Fallback mock data ───────────────────────────────────────────────────────
function getMockRecommendation(crop, problem) {
  const base = {
    'Wheat': {
      fertilizers: [
        { name: 'DAP (Di-Ammonium Phosphate)', dose: '50 kg/acre as basal dose', timing: 'At time of sowing' },
        { name: 'Urea (46% N)', dose: '33 kg/acre', timing: 'Split: 1/3 at sowing, 2/3 at CRI stage (21 DAS)' },
        { name: 'MOP (Muriate of Potash)', dose: '13 kg/acre', timing: 'At sowing as basal dose' },
      ],
      pesticides: [
        { name: 'Propiconazole 25% EC (Tilt)', dose: '100 ml in 200 L water/acre', timing: 'Spray when rust symptoms appear' },
        { name: 'Chlorpyrifos 20% EC', dose: '1.5 L/acre', timing: 'At tillering if aphid infestation seen' },
      ],
      warning: 'Check for yellow/brown rust after rain. Spray fungicide immediately if >5% leaves infected.',
      generalAdvice: 'Ensure proper drainage to prevent root rot. Conduct soil test before next season.',
    },
    'Rice/Paddy': {
      fertilizers: [
        { name: 'DAP', dose: '25 kg/acre as basal', timing: 'At transplanting' },
        { name: 'Urea', dose: '55 kg/acre total', timing: 'Split: at transplanting, tillering, and panicle initiation' },
        { name: 'Zinc Sulphate', dose: '10 kg/acre', timing: 'Basal in zinc-deficient soils' },
      ],
      pesticides: [
        { name: 'Carbofuran 3G (Furadan)', dose: '6 kg/acre', timing: 'At transplanting for stem borer' },
        { name: 'Tricyclazole 75% WP', dose: '80 g in 200 L/acre', timing: 'At flag leaf stage for blast' },
      ],
      warning: 'Maintain 5 cm water level. High humidity increases blast risk — monitor daily.',
      generalAdvice: 'Use certified paddy seeds treated with fungicide for better germination.',
    },
    'Tomato': {
      fertilizers: [
        { name: 'NPK 19:19:19', dose: '2 kg/100 L water', timing: 'Fertigation every 15 days' },
        { name: 'Calcium Nitrate', dose: '3 kg/100 L water', timing: 'Weekly spray from flowering stage' },
        { name: 'Borax', dose: '0.5 g/L', timing: 'Spray at flowering to improve fruit setting' },
      ],
      pesticides: [
        { name: 'Imidacloprid 17.8% SL', dose: '0.5 ml/L', timing: 'Every 15 days for whitefly/aphid' },
        { name: 'Mancozeb 75% WP (Dithane M-45)', dose: '2.5 g/L', timing: 'Preventive spray every 10 days' },
      ],
      warning: 'High humidity favors early blight. Remove infected leaves immediately.',
      generalAdvice: 'Stake plants properly and ensure 60 cm plant spacing for good air circulation.',
    },
  };

  return base[crop] || {
    fertilizers: [
      { name: 'NPK (10:26:26)', dose: '50 kg/acre', timing: 'At sowing as basal dose' },
      { name: 'Urea (46% N)', dose: '35 kg/acre', timing: 'Top dressing at active growth stage' },
      { name: 'Micronutrient mixture', dose: '5 kg/acre', timing: 'Once during vegetative stage' },
    ],
    pesticides: [
      { name: 'Neem Oil 5000 PPM', dose: '3 ml/L water', timing: 'Spray every 10 days (organic)' },
    ],
    warning: problem !== 'No Visible Problem'
      ? `${problem} detected — consult KVK for specific treatment.`
      : null,
    generalAdvice: 'Conduct soil testing before applying fertilizers for best results and cost saving.',
  };
}

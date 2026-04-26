/**
 * Loan Calculator Routes
 *
 * POST /api/v1/loan/kcc-eligibility    — KCC credit limit based on crop, area, district
 * POST /api/v1/loan/emi                — EMI calculator
 * GET  /api/v1/loan/compare            — loan types comparison table
 * GET  /api/v1/loan/kcc-info           — KCC scheme overview
 *
 * Data sources:
 *   NABARD Scale of Finance (district-crop wise, updated annually)
 *   RBI interest rate guidelines
 *   KCC (Kisan Credit Card) scheme norms — GoI
 *
 * DISCLAIMER: Always shown — "Final eligibility determined by your bank / cooperative."
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isEnabled } from '../services/featureFlag.service.js';

const router = Router();

// ── KCC Scale of Finance (NABARD, 2025-26 Maharashtra) ────────────────────────
// Source: NABARD Scale of Finance Circular, Maharashtra, FY 2025-26
// Unit: ₹/acre
const KCC_SCALE_OF_FINANCE = {
  'soybean':     { min: 15000, max: 22000, avg: 18000 },
  'cotton':      { min: 20000, max: 35000, avg: 27000 },
  'tur':         { min: 12000, max: 18000, avg: 14500 },
  'onion':       { min: 25000, max: 50000, avg: 38000 },
  'tomato':      { min: 30000, max: 60000, avg: 45000 },
  'wheat':       { min: 12000, max: 18000, avg: 15000 },
  'gram':        { min: 10000, max: 16000, avg: 13000 },
  'maize':       { min: 12000, max: 20000, avg: 16000 },
  'groundnut':   { min: 14000, max: 22000, avg: 18000 },
  'sugarcane':   { min: 30000, max: 55000, avg: 42000 },
  'jowar':       { min: 8000,  max: 12000, avg: 10000 },
  'bajra':       { min: 6000,  max: 10000, avg: 8000  },
  'sunflower':   { min: 10000, max: 16000, avg: 13000 },
  'pomegranate': { min: 50000, max: 100000,avg: 75000 },
  'grapes':      { min: 80000, max: 150000,avg: 110000},
  'rice':        { min: 14000, max: 22000, avg: 18000 },
  'default':     { min: 10000, max: 20000, avg: 15000 },
};

// ── Bank loan products (reference data) ──────────────────────────────────────
const LOAN_PRODUCTS = [
  {
    type:                'KCC (Kisan Credit Card)',
    typeHi:              'किसान क्रेडिट कार्ड',
    bank:                'All public sector banks / cooperative banks',
    interestRate:        7.0,         // % p.a. base rate
    subventedRate:       4.0,         // % p.a. after Govt subvention (if repaid on time)
    subventionCondition: 'Repay within 1 year for 3% interest subvention (effective 4% p.a.)',
    maxTenure:           12,          // months (revolving credit, renewed annually)
    maxAmount:           3000000,     // ₹30 lakh upper limit
    collateralRequired:  false,       // up to ₹1.6 lakh
    collateralThreshold: 160000,
    processingFee:       'Nil for KCC up to ₹3 lakh',
    eligibility:         ['Any farmer with cultivable land', 'Crop insurance (PMFBY) compulsory'],
    documentsRequired:   ['Aadhaar', 'Land records (7/12)', 'Bank account', 'Crop details', 'Passport photo'],
    highlight:           '✅ सबसे अच्छी ब्याज दर — समय पर चुकाने पर सिर्फ 4% प्रति वर्ष',
  },
  {
    type:                'Agri Term Loan',
    typeHi:              'कृषि टर्म लोन',
    bank:                'All commercial banks / RRBs',
    interestRate:        10.5,
    subventedRate:       null,
    subventionCondition: null,
    maxTenure:           84,          // 7 years
    maxAmount:           10000000,    // ₹1 crore
    collateralRequired:  true,
    collateralThreshold: 160000,
    processingFee:       '0.5-1% of loan amount',
    eligibility:         ['Land ownership required', 'Good credit history'],
    documentsRequired:   ['Land records', 'Aadhaar', 'Bank statement', 'ITR (if applicable)'],
    highlight:           'भूमि सुधार, सिंचाई, ड्रिप सिस्टम जैसे बड़े निवेश के लिए',
  },
  {
    type:                'Agri Gold Loan',
    typeHi:              'कृषि गोल्ड लोन',
    bank:                'All commercial banks / NBFCs',
    interestRate:        8.5,
    subventedRate:       null,
    subventionCondition: null,
    maxTenure:           12,
    maxAmount:           2000000,
    collateralRequired:  true,        // gold as collateral
    collateralThreshold: 0,
    processingFee:       '0.5% of loan amount',
    eligibility:         ['Any farmer / person with gold jewellery', '75-80% of gold value as loan'],
    documentsRequired:   ['Aadhaar', 'Gold jewellery (for valuation)', 'KYC'],
    highlight:           'त्वरित लोन, कोई जमीन जरूरी नहीं — सोने पर तुरंत पैसा',
  },
  {
    type:                'Mudra Loan (Agri-Kishor/Tarun)',
    typeHi:              'मुद्रा लोन (कृषि)',
    bank:                'All scheduled commercial banks / MFIs',
    interestRate:        11.5,
    subventedRate:       null,
    subventionCondition: null,
    maxTenure:           60,
    maxAmount:           1000000,     // Tarun: up to ₹10 lakh
    collateralRequired:  false,       // up to ₹10 lakh
    collateralThreshold: 0,
    processingFee:       'Nil (for loans up to ₹10 lakh)',
    eligibility:         ['Agri-allied activities: poultry, dairy, fishery, food processing'],
    documentsRequired:   ['Aadhaar', 'Business plan', 'Quotations', 'Bank statement'],
    highlight:           'पशुपालन, मुर्गीपालन, मत्स्य पालन के लिए बिना जमानत लोन',
  },
];

// ── POST /api/v1/loan/kcc-eligibility ────────────────────────────────────────
router.post('/kcc-eligibility', authenticate, async (req, res) => {
  if (!await isEnabled('loan_calculator')) return sendError(res, 'लोन कैलकुलेटर अभी उपलब्ध नहीं है।', 503);

  const { crops = [], totalAreaAcres } = req.body;

  if (!totalAreaAcres || isNaN(parseFloat(totalAreaAcres)) || parseFloat(totalAreaAcres) <= 0) {
    return sendError(res, 'totalAreaAcres (positive number) is required', 400);
  }

  const area = parseFloat(totalAreaAcres);
  let totalCreditLimit = 0;
  const breakdown = [];

  if (!crops.length) {
    // Generic estimate
    const scale = KCC_SCALE_OF_FINANCE.default;
    totalCreditLimit = scale.avg * area;
    breakdown.push({ crop: 'Mixed crops', area, scalePerAcre: scale.avg, limit: Math.round(totalCreditLimit) });
  } else {
    for (const entry of crops) {
      const cropName = (entry.crop || entry).toLowerCase().trim();
      const cropArea = parseFloat(entry.area || (area / crops.length));
      const scale    = KCC_SCALE_OF_FINANCE[cropName] || KCC_SCALE_OF_FINANCE.default;
      const limit    = scale.avg * cropArea;
      totalCreditLimit += limit;
      breakdown.push({
        crop:          cropName,
        area:          cropArea,
        scalePerAcre:  scale.avg,
        limit:         Math.round(limit),
        scaleRange:    `₹${scale.min.toLocaleString('en-IN')}-₹${scale.max.toLocaleString('en-IN')}/acre`,
      });
    }
  }

  // 10% contingency allowance (standard KCC norm)
  const contingency  = Math.round(totalCreditLimit * 0.1);
  const finalLimit   = Math.round(totalCreditLimit + contingency);
  // KCC limit capped at ₹30 lakh without special approval
  const cappedLimit  = Math.min(finalLimit, 3000000);
  // Collateral-free up to ₹1.6 lakh
  const needsCollateral = cappedLimit > 160000;

  return sendSuccess(res, {
    estimatedCreditLimit:   cappedLimit,
    breakdown,
    contingencyAllowance:   contingency,
    uncappedEstimate:       finalLimit,
    collateralRequired:     needsCollateral,
    collateralNote:         needsCollateral ? 'आपकी भूमि KCC के लिए जमानत होगी।' : 'कोई जमानत जरूरी नहीं (₹1.6 लाख तक)।',
    interestRate:           '7% p.a. (4% p.a. with Government subvention on timely repayment)',
    interestRateHi:         '7% प्रति वर्ष (समय पर चुकाने पर 4% — सरकारी सब्सिडी)',
    sourceNote:             `NABARD Scale of Finance 2025-26 (Maharashtra). Area: ${area} acres.`,
    disclaimer:             'यह अनुमानित सीमा है। अंतिम KCC सीमा आपका बैंक/सहकारी संस्था तय करेगी।',
  });
});

// ── POST /api/v1/loan/emi ─────────────────────────────────────────────────────
router.post('/emi', authenticate, async (req, res) => {
  if (!await isEnabled('loan_calculator')) return sendError(res, 'लोन कैलकुलेटर अभी उपलब्ध नहीं है।', 503);

  const { principal, annualInterestRate, tenureMonths } = req.body;
  const P = parseFloat(principal);
  const r = parseFloat(annualInterestRate) / 12 / 100;   // monthly rate
  const n = parseInt(tenureMonths, 10);

  if (!P || P <= 0)  return sendError(res, 'principal must be a positive number', 400);
  if (!r || r <= 0)  return sendError(res, 'annualInterestRate must be positive', 400);
  if (!n || n <= 0)  return sendError(res, 'tenureMonths must be a positive integer', 400);

  // EMI = P × r × (1+r)^n / ((1+r)^n - 1)
  const emi          = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const totalPayment = emi * n;
  const totalInterest = totalPayment - P;

  // Build repayment schedule (first 3 + last month for brevity)
  const schedule = [];
  let balance    = P;
  for (let i = 1; i <= n; i++) {
    const intPart = balance * r;
    const prinPart = emi - intPart;
    balance -= prinPart;
    if (i <= 3 || i === n) {
      schedule.push({ month: i, emi: Math.round(emi), interest: Math.round(intPart), principal: Math.round(prinPart), balance: Math.round(Math.max(0, balance)) });
    }
  }

  return sendSuccess(res, {
    emi:                  Math.round(emi),
    totalPayment:         Math.round(totalPayment),
    totalInterest:        Math.round(totalInterest),
    principal:            P,
    annualInterestRate:   parseFloat(annualInterestRate),
    tenureMonths:         n,
    repaymentScheduleSample: schedule,
    note:                 'EMI calculation based on reducing balance method.',
    noteHi:               'EMI की गणना घटती शेष विधि (Reducing Balance) से की गई है।',
  });
});

// ── GET /api/v1/loan/compare ──────────────────────────────────────────────────
router.get('/compare', authenticate, async (req, res) => {
  if (!await isEnabled('loan_calculator')) return sendError(res, 'लोन कैलकुलेटर अभी उपलब्ध नहीं है।', 503);
  return sendSuccess(res, LOAN_PRODUCTS, 200, {
    source:    'RBI / NABARD / Govt of India scheme norms, 2025-26',
    disclaimer: 'ब्याज दरें समय-समय पर बदलती हैं। अपने बैंक से जांच करें।',
    updatedAt:  '2025-04',
  });
});

// ── GET /api/v1/loan/kcc-info ─────────────────────────────────────────────────
router.get('/kcc-info', authenticate, async (req, res) => {
  return sendSuccess(res, {
    name:          'Kisan Credit Card (KCC)',
    nameHi:        'किसान क्रेडिट कार्ड',
    description:   'KCC is a revolving credit facility for farmers to meet crop cultivation expenses, allied activities, and personal consumption needs.',
    descriptionHi: 'KCC किसानों के लिए एक रिवॉल्विंग क्रेडिट सुविधा है जो फसल खर्च, संबद्ध गतिविधियों और व्यक्तिगत जरूरतों के लिए है।',
    benefits:      ['Interest rate: 7% p.a. (4% effective with Govt subvention)', 'No collateral up to ₹1.6 lakh', 'Revolving credit — no need to apply again each year', 'Crop insurance (PMFBY) included', 'Personal accident insurance of ₹50,000', 'Free ATM card / RuPay card'],
    benefitsHi:    ['ब्याज दर: 7% (4% प्रभावी — सब्सिडी के साथ)', '₹1.6 लाख तक बिना जमानत', 'हर साल आवेदन की जरूरत नहीं', 'PMFBY फसल बीमा शामिल', '₹50,000 का दुर्घटना बीमा', 'ATM/RuPay कार्ड मुफ्त'],
    applicationSteps: [
      { step: 1, desc: 'Visit your nearest bank branch (SBI, BOI, Bank of Maharashtra, DCCB, etc.)', descHi: 'नजदीकी बैंक शाखा में जाएं' },
      { step: 2, desc: 'Fill KCC application form with crop details and land records', descHi: 'KCC आवेदन फॉर्म भरें' },
      { step: 3, desc: 'Submit: Aadhaar, 7/12 extract, passport photo, bank account details', descHi: 'दस्तावेज जमा करें: आधार, 7/12, फोटो, बैंक खाता' },
      { step: 4, desc: 'Bank verifies land records and approves credit limit', descHi: 'बैंक जमीन की जांच करके KCC मंजूर करेगा' },
      { step: 5, desc: 'Receive RuPay KCC card within 7-15 days', descHi: '7-15 दिन में RuPay KCC कार्ड मिलेगा' },
    ],
    helpline: 'PM-Kisan Helpline: 155261 | Kisan Call Center: 1800-180-1551',
    source:   'GoI / RBI / NABARD, 2025-26',
  });
});

export default router;

/**
 * Seed: Government schemes for farmers.
 *
 * Source: official websites of MoAFW, NABARD, state agri departments.
 * Keep benefit amounts and deadlines accurate — farmers depend on this.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SCHEMES = [
  {
    schemeCode: 'PMKISAN',
    schemeName: 'PM-KISAN Samman Nidhi',
    schemeNameHi: 'प्रधानमंत्री किसान सम्मान निधि',
    schemeNameMr: 'पंतप्रधान किसान सन्मान निधी',
    ministry: 'Ministry of Agriculture & Farmers Welfare',
    type: 'DIRECT_BENEFIT',
    state: null,
    description: 'Direct income support of ₹6,000/year to eligible landholding farmer families, paid in three equal installments of ₹2,000 every four months.',
    benefitsSummary: '₹6,000/year in 3 installments via DBT to bank account.',
    eligibility: {
      landOwnership: 'required',
      incomeTax: 'not_payable',
      excludedCategories: ['government_employee', 'professional', 'pensioner>10k'],
    },
    documentsReq: ['Aadhaar', 'Land records', 'Bank account linked to Aadhaar'],
    applicationUrl: 'https://pmkisan.gov.in',
    helpline: '155261 / 011-24300606',
    benefitAmount: 6000,
    benefitType: 'ANNUAL_CASH',
    deadline: null,
    isActive: true,
  },
  {
    schemeCode: 'PMFBY',
    schemeName: 'Pradhan Mantri Fasal Bima Yojana',
    schemeNameHi: 'प्रधानमंत्री फसल बीमा योजना',
    schemeNameMr: 'पंतप्रधान पीक विमा योजना',
    ministry: 'Ministry of Agriculture & Farmers Welfare',
    type: 'INSURANCE',
    state: null,
    description: 'Crop insurance against losses from natural calamities, pests, and diseases. Farmer premium: 2% (Kharif), 1.5% (Rabi), 5% (commercial/horticulture).',
    benefitsSummary: 'Claim compensation against crop loss. Premium mostly subsidised.',
    eligibility: {
      cropsCovered: ['notified_kharif', 'notified_rabi', 'commercial', 'horticultural'],
      loaneeNonLoanee: 'both',
    },
    documentsReq: ['Aadhaar', 'Land records', 'Sowing certificate', 'Bank account'],
    applicationUrl: 'https://pmfby.gov.in',
    helpline: '14447',
    benefitAmount: null,
    benefitType: 'INSURANCE',
    deadline: 'Enrollment closes before cut-off date each season — check with nearest bank/CSC.',
    isActive: true,
  },
  {
    schemeCode: 'KCC',
    schemeName: 'Kisan Credit Card',
    schemeNameHi: 'किसान क्रेडिट कार्ड',
    schemeNameMr: 'किसान क्रेडिट कार्ड',
    ministry: 'Ministry of Agriculture & NABARD',
    type: 'CREDIT',
    state: null,
    description: 'Short-term credit for crop cultivation at subsidised interest (7%, with 3% incentive for prompt repayment → effective 4%). Loan up to ₹3 lakh without collateral.',
    benefitsSummary: 'Crop loan @ 4% effective rate (after PR incentive). Limit up to ₹3 lakh uncollateralised.',
    eligibility: {
      landOwnership: 'required_or_tenant',
      age: { min: 18, max: 75 },
    },
    documentsReq: ['Aadhaar', 'PAN', 'Land records (7/12 or patta)', 'Passport photos'],
    applicationUrl: 'https://www.india.gov.in/spotlight/kisan-credit-card-kcc',
    helpline: 'Contact nearest bank branch',
    benefitAmount: 300000,
    benefitType: 'CREDIT_LIMIT',
    deadline: null,
    isActive: true,
  },
  {
    schemeCode: 'SMAM',
    schemeName: 'Sub-Mission on Agricultural Mechanization (SMAM)',
    schemeNameHi: 'कृषि यंत्रीकरण उप-मिशन',
    schemeNameMr: 'कृषी यांत्रिकीकरण उपमिशन',
    ministry: 'Ministry of Agriculture & Farmers Welfare',
    type: 'SUBSIDY',
    state: null,
    description: 'Subsidy on farm machinery purchase (tractors, power tillers, reapers, harvesters, sprayers). Subsidy varies 40-50% for general farmers, 50-80% for SC/ST/women/small farmers.',
    benefitsSummary: 'Upfront subsidy up to 50% (general) / 80% (SC/ST/women) on eligible machinery.',
    eligibility: {
      landOwnership: 'required',
      specialCategory: ['SC', 'ST', 'women', 'small_marginal'],
    },
    documentsReq: ['Aadhaar', 'Land records', 'Caste certificate (if applicable)', 'Bank account'],
    applicationUrl: 'https://agrimachinery.nic.in',
    helpline: 'State agri department',
    benefitAmount: null,
    benefitType: 'SUBSIDY_PERCENT',
    deadline: null,
    isActive: true,
  },
  {
    schemeCode: 'PMKSY-PDMC',
    schemeName: 'PM Krishi Sinchayee Yojana — Per Drop More Crop',
    schemeNameHi: 'प्रधानमंत्री कृषि सिंचाई योजना — प्रति बूंद अधिक फसल',
    ministry: 'Ministry of Agriculture & Farmers Welfare',
    type: 'SUBSIDY',
    state: null,
    description: 'Subsidy for micro-irrigation (drip/sprinkler) to improve water use efficiency. 55% for small & marginal; 45% for other farmers.',
    benefitsSummary: 'Up to 55% subsidy on drip/sprinkler systems.',
    eligibility: {
      landOwnership: 'required',
      waterSource: 'assured',
    },
    documentsReq: ['Aadhaar', 'Land records', 'Water source proof', 'Bank account'],
    applicationUrl: 'https://pmksy.gov.in',
    helpline: 'State horticulture mission',
    benefitAmount: null,
    benefitType: 'SUBSIDY_PERCENT',
    deadline: null,
    isActive: true,
  },
  {
    schemeCode: 'NMSA-SHC',
    schemeName: 'Soil Health Card Scheme',
    schemeNameHi: 'मृदा स्वास्थ्य कार्ड योजना',
    ministry: 'Ministry of Agriculture & Farmers Welfare',
    type: 'ADVISORY',
    state: null,
    description: 'Free soil testing + personalised fertilizer recommendations every 2 years. Helps reduce input costs and improve yields.',
    benefitsSummary: 'Free soil testing + fertilizer recommendation every 2 years.',
    eligibility: {
      landOwnership: 'required',
    },
    documentsReq: ['Aadhaar', 'Land records'],
    applicationUrl: 'https://soilhealth.dac.gov.in',
    helpline: 'Contact block agriculture office',
    benefitAmount: null,
    benefitType: 'ADVISORY',
    deadline: null,
    isActive: true,
  },
  {
    schemeCode: 'PM-KMY',
    schemeName: 'PM Kisan Maan-Dhan Yojana',
    schemeNameHi: 'प्रधानमंत्री किसान मान-धन योजना',
    ministry: 'Ministry of Agriculture & Farmers Welfare',
    type: 'PENSION',
    description: 'Pension of ₹3,000/month for small & marginal farmers after age 60. Monthly contribution ₹55–₹200 based on age at entry; matched by government.',
    benefitsSummary: '₹3,000/month pension after 60. Govt matches your contribution.',
    eligibility: {
      landOwnership: 'upto_2_hectares',
      age: { min: 18, max: 40 },
    },
    documentsReq: ['Aadhaar', 'Land records', 'Savings/Jan Dhan bank account'],
    applicationUrl: 'https://maandhan.in',
    helpline: '1800-3000-3468',
    benefitAmount: 3000,
    benefitType: 'MONTHLY_PENSION',
    deadline: null,
    isActive: true,
  },
  {
    schemeCode: 'eNAM',
    schemeName: 'National Agriculture Market (e-NAM)',
    schemeNameHi: 'राष्ट्रीय कृषि बाज़ार',
    ministry: 'Ministry of Agriculture & Farmers Welfare',
    type: 'MARKETPLACE',
    description: 'Online trading platform integrating APMC mandis nationwide. Farmers can view real-time prices and sell produce to buyers across states.',
    benefitsSummary: 'Pan-India online mandi. Better price discovery, wider buyer reach.',
    eligibility: { mustRegister: true },
    documentsReq: ['Aadhaar', 'Bank account', 'Land records'],
    applicationUrl: 'https://enam.gov.in',
    helpline: '1800-270-0224',
    benefitAmount: null,
    benefitType: 'MARKETPLACE',
    deadline: null,
    isActive: true,
  },
  {
    schemeCode: 'AIF',
    schemeName: 'Agriculture Infrastructure Fund',
    schemeNameHi: 'कृषि अवसंरचना निधि',
    ministry: 'Ministry of Agriculture & Farmers Welfare',
    type: 'CREDIT',
    description: '3% interest subvention + credit guarantee for post-harvest & community farming infrastructure (warehouses, cold storage, custom hiring centres). Loans up to ₹2 crore.',
    benefitsSummary: 'Loan up to ₹2 crore @ 3% interest subvention for 7 years. Credit guarantee for up to ₹2 crore via CGTMSE.',
    eligibility: {
      applicantTypes: ['farmer', 'FPO', 'SHG', 'cooperative', 'startup'],
    },
    documentsReq: ['Project report', 'KYC', 'Land / lease documents'],
    applicationUrl: 'https://agriinfra.dac.gov.in',
    helpline: '011-23382012',
    benefitAmount: 20000000,
    benefitType: 'CREDIT_WITH_SUBVENTION',
    deadline: null,
    isActive: true,
  },
];

export async function seedSchemes() {
  console.log('[Seed Schemes] Upserting %d schemes...', SCHEMES.length);
  for (const s of SCHEMES) {
    await prisma.governmentScheme.upsert({
      where: { schemeCode: s.schemeCode },
      create: s,
      update: s,
    });
  }
  const total = await prisma.governmentScheme.count();
  console.log('[Seed Schemes] Done — %d schemes total.', total);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedSchemes()
    .catch(err => { console.error(err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}

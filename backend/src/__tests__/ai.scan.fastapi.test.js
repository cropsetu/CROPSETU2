/**
 * Tests for src/services/ai.scan.fastapi.js — the FastAPI response
 * adapter that converts the agentic pipeline's rich shape into the flat
 * shape DiagnosisResultScreen consumes.
 *
 * Run:  node --test src/__tests__/ai.scan.fastapi.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { flattenFastAPIDiagnosis, extractUsage } from '../services/ai.scan.fastapi.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeReport(overrides = {}) {
  return {
    report_id: 'r-abc123',
    farm: { crop: 'Tomato', variety: 'Pusa Ruby', growth_stage: 'flowering' },
    disease: {
      name_common: 'Early Blight',
      name_scientific: 'Alternaria solani',
      pathogen_type: 'fungal',
      confidence_pct: 82,
      confidence_tier: 'HIGH',
      severity: 'Moderate',
      severity_pct: 25,
      spread_risk: 'HIGH',
      description: 'Concentric ring lesions on lower leaves',
    },
    causes: ['High humidity (>80%) for 3+ days', 'Overhead irrigation'],
    treatment: {
      immediate:  ['Remove and destroy infected leaves'],
      chemical:   [
        { product: 'Mancozeb 75% WP', active_ingredient: 'Mancozeb',
          dosage: '2.5 g/L', application_method: 'Foliar spray' },
      ],
      biological: [{ agent: 'Trichoderma viride' }],
      organic:    [],
      cultural:   ['Improve airflow'],
      preventive: ['Use protectant fungicide weekly'],
    },
    action_card: {
      diagnosis_one_liner: 'Early Blight (Moderate)',
      top_3_actions: ['Spray Mancozeb today', 'Remove infected leaves', 'Switch to drip irrigation'],
      follow_up_days: 7,
      urgency: { level: 'today' },
    },
    next_steps: ['Spray Mancozeb today', 'Remove infected leaves'],
    advisor_needed: false,
    confidence_score: 0.82,
    risk_level: 'HIGH',
    weather_outlook: { risk: 'HIGH', advisory: 'High humidity favours fungal spread', weather_used: true },
    farmer_summary: 'Your tomato crop has Early Blight at 82% confidence.',
    meta: {
      tier: 'best',
      model_diagnose: 'gemini-2.5-pro',
      model_treatment: 'claude-sonnet-4-6',
      escalated: false,
      needs_lab_confirmation: false,
      safety: { registry_version: '2026.05.28-r1', blockers: [], warnings: [] },
      pipeline_token_usage: { total_tokens: 4500, total_cost_usd: 0.018 },
    },
    ...overrides,
  };
}


// ── Shape compatibility ─────────────────────────────────────────────────────

test('flattenFastAPIDiagnosis produces the flat shape the mobile screen expects', () => {
  const out = flattenFastAPIDiagnosis(makeReport(), { cropName: 'Tomato' });
  // These keys are what flattenNodePrediction also produces — the mobile
  // client switches on them, so any rename here is a breaking change.
  for (const key of [
    'disease', 'scientific', 'confidence', 'severity', 'isHealthy', 'crop',
    'stage', 'affectedAreaEstimate', 'spreadRisk', 'urgencyLevel',
    'immediateAction', 'treatment', 'organicTreatment', 'prevention',
    'nextSteps', 'notes', 'causes', 'weatherRiskNote', 'consultExpert',
    'followUpSchedule',
  ]) {
    assert.ok(key in out, `missing key: ${key}`);
  }
});

test('confidence is scaled 0..100 (not 0..1)', () => {
  const out = flattenFastAPIDiagnosis(makeReport(), {});
  assert.equal(out.confidence, 82);
});

test('disease name uses name_common', () => {
  const out = flattenFastAPIDiagnosis(makeReport(), {});
  assert.equal(out.disease, 'Early Blight');
  assert.equal(out.scientific, 'Alternaria solani');
});

test('treatment lines render product + dose + method', () => {
  const out = flattenFastAPIDiagnosis(makeReport(), {});
  assert.equal(out.treatment.length, 1);
  assert.equal(out.treatment[0], 'Mancozeb 75% WP — 2.5 g/L (Foliar spray)');
});

test('organicTreatment joins biological + organic items', () => {
  const out = flattenFastAPIDiagnosis(makeReport(), {});
  assert.equal(out.organicTreatment, 'Trichoderma viride');
});

test('nextSteps prefers action_card.top_3_actions over next_steps', () => {
  const out = flattenFastAPIDiagnosis(makeReport(), {});
  assert.deepEqual(out.nextSteps, [
    'Spray Mancozeb today', 'Remove infected leaves', 'Switch to drip irrigation',
  ]);
});

test('urgencyLevel pulled from action_card.urgency.level', () => {
  const out = flattenFastAPIDiagnosis(makeReport(), {});
  assert.equal(out.urgencyLevel, 'today');
});

test('falls back to severity when urgency missing', () => {
  const report = makeReport({ action_card: { top_3_actions: [], follow_up_days: 7 } });
  report.disease.severity = 'severe';
  const out = flattenFastAPIDiagnosis(report, {});
  assert.equal(out.urgencyLevel, 'immediate');
});

test('consultExpert reflects meta.escalated', () => {
  const r1 = makeReport({ meta: { ...makeReport().meta, escalated: true } });
  assert.equal(flattenFastAPIDiagnosis(r1, {}).consultExpert, true);
  const r2 = makeReport();
  assert.equal(flattenFastAPIDiagnosis(r2, {}).consultExpert, false);
});

test('consultExpert reflects meta.needs_lab_confirmation', () => {
  const r = makeReport({ meta: { ...makeReport().meta, needs_lab_confirmation: true } });
  assert.equal(flattenFastAPIDiagnosis(r, {}).consultExpert, true);
});


// ── needs_rescan short-circuit ──────────────────────────────────────────────

test('needs_rescan report short-circuits to a "rescan" flat shape', () => {
  const rescan = {
    report_id: 'needs_rescan',
    farm: { crop: 'Tomato' },
    next_steps: ['Retake photo in daylight', 'Stand closer to the leaf'],
    farmer_summary: 'Image too blurry — please retake.',
    weather_outlook: { advisory: '' },
  };
  const out = flattenFastAPIDiagnosis(rescan, { cropName: 'Tomato' });
  assert.equal(out.needsRescan, true);
  assert.equal(out.disease, 'Needs rescan');
  assert.equal(out.confidence, 0);
  assert.equal(out.consultExpert, true);
  assert.deepEqual(out.nextSteps, [
    'Retake photo in daylight', 'Stand closer to the leaf',
  ]);
});


// ── farmCtx overrides ──────────────────────────────────────────────────────

test('crop / stage / affectedArea come from farmCtx if provided', () => {
  const out = flattenFastAPIDiagnosis(makeReport(), {
    cropName: 'Override-Crop',
    growthStage: 'fruiting',
    affectedArea: '25-50%',
  });
  assert.equal(out.crop, 'Override-Crop');
  assert.equal(out.stage, 'fruiting');
  assert.equal(out.affectedAreaEstimate, '25-50%');
});


// ── Rich passthrough fields ────────────────────────────────────────────────

test('tier and model ids ride through unmodified', () => {
  const out = flattenFastAPIDiagnosis(makeReport(), {});
  assert.equal(out.tier, 'best');
  assert.equal(out.modelDiagnose, 'gemini-2.5-pro');
  assert.equal(out.modelTreatment, 'claude-sonnet-4-6');
});

test('safety meta is exposed for the UI', () => {
  const out = flattenFastAPIDiagnosis(makeReport(), {});
  assert.deepEqual(out.safety, { registry_version: '2026.05.28-r1', blockers: [], warnings: [] });
});


// ── isHealthy detection ────────────────────────────────────────────────────

test('isHealthy true when disease name is "Tomato - healthy" with high confidence', () => {
  const r = makeReport();
  r.disease.name_common = 'Tomato - healthy';
  r.confidence_score = 0.92;
  const out = flattenFastAPIDiagnosis(r, {});
  assert.equal(out.isHealthy, true);
});

test('isHealthy false at low confidence even with healthy label', () => {
  const r = makeReport();
  r.disease.name_common = 'Tomato - healthy';
  r.confidence_score = 0.40;
  const out = flattenFastAPIDiagnosis(r, {});
  assert.equal(out.isHealthy, false);
});


// ── extractUsage ───────────────────────────────────────────────────────────

test('extractUsage pulls tokens + cost from meta.pipeline_token_usage', () => {
  const u = extractUsage(makeReport());
  assert.equal(u.tokens, 4500);
  assert.equal(u.costUsd, 0.018);
});

test('extractUsage returns zeros for missing usage', () => {
  const u = extractUsage({ meta: {} });
  assert.equal(u.tokens, 0);
  assert.equal(u.costUsd, 0);
});


// ── Edge cases ─────────────────────────────────────────────────────────────

test('null/undefined report returns the input unchanged', () => {
  assert.equal(flattenFastAPIDiagnosis(null, {}), null);
  assert.equal(flattenFastAPIDiagnosis(undefined, {}), undefined);
});

test('missing disease object still produces a valid flat shape', () => {
  const r = makeReport({ disease: undefined });
  const out = flattenFastAPIDiagnosis(r, {});
  assert.equal(out.disease, 'Unknown');
  assert.equal(out.scientific, '');
  assert.equal(out.confidence, 82);    // confidence_score still set on the root
});

test('treatment shape with no chemicals returns empty treatment array', () => {
  const r = makeReport();
  r.treatment = { immediate: ['Spray fungicide'], chemical: [],
                  biological: [], organic: [], cultural: [], preventive: [] };
  const out = flattenFastAPIDiagnosis(r, {});
  assert.deepEqual(out.treatment, []);
  assert.equal(out.organicTreatment, null);
});

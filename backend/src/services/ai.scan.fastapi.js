/**
 * FastAPI scan client + response adapter.
 *
 * Why this file exists
 *   The Express /ai/scan handler historically ran Gemini directly (see
 *   ai.predict.service.js). When USE_FASTAPI_FOR_SCAN=true we instead
 *   forward the image to FastAPI's full agentic pipeline (Image Quality
 *   → Weather → Disease Diagnosis → Treatment with chemical-registry
 *   validation → Report). FastAPI runs on a separate Railway service,
 *   so we cannot share a filesystem — the image must travel inline as
 *   base64. The materialise step on the FastAPI side writes it back to
 *   a temp file before invoking the path-based pipeline.
 *
 * Response shape contract
 *   The mobile DiagnosisResultScreen consumes a FLAT shape produced by
 *   flattenNodePrediction() in ai.routes.js. flattenFastAPIDiagnosis()
 *   here MUST emit the same keys with compatible values so the migration
 *   is invisible to the client. New richer fields from the agentic
 *   pipeline (urgency badges, dispensing sheet, compliance audit) ride
 *   along under `_fullReport` so future client updates can opt in.
 */
import fs from 'fs';
import { postSignedJSON, getSigned } from '../utils/fastapi-signed.js';
import logger from '../utils/logger.js';

// ── Inline-payload size guards (mirror FastAPI's _MAX_INLINE_BYTES_PER_IMAGE)
const MAX_BYTES_PER_IMAGE = 8 * 1024 * 1024;

// Polling tunables for the async-job interface (FastAPI's /ai/scan now
// returns a job_id immediately; this client polls until the worker finishes).
// Defaults: poll every 2 s for up to 180 s total. The cascade-into-ensemble
// pipeline tops out around 120 s in the worst case, so 180 s leaves margin.
const POLL_INITIAL_DELAY_MS = 1_000;
const POLL_INTERVAL_MS      = 2_000;
const POLL_MAX_TOTAL_MS     = 180_000;

const ALLOWED_TIERS = new Set(['fast', 'best']);

function normaliseTier(value) {
  const v = String(value || '').trim().toLowerCase();
  return ALLOWED_TIERS.has(v) ? v : 'fast';
}

/**
 * Read a single image file from disk and call FastAPI's /ai/scan.
 *
 * @param {object} args
 * @param {string} args.filePath        Path to the uploaded image (multer temp)
 * @param {string} args.mimeType        e.g. 'image/jpeg'
 * @param {string} args.viewType        Image view tag ('close_up', 'whole_plant', etc.)
 * @param {object} args.params          Flat params dict — gets passed straight to FastAPI.
 *                                      MUST include crop_name. Other useful keys:
 *                                      crop_growth_stage, soil_type, irrigation_system,
 *                                      farm_size_acres, state, district,
 *                                      field_latitude, field_longitude, language, tier.
 * @param {string} [args.userId]        Forwarded as x-user-id (drives spend caps)
 * @param {string} [args.requestId]     Forwarded as x-request-id for log correlation
 * @param {string} [args.idempotencyKey] Honoured by FastAPI's idempotency cache
 * @returns {Promise<object>}           The unwrapped { ...report } payload from FastAPI
 */
export async function callFastAPIScan({
  filePath,
  mimeType = 'image/jpeg',
  viewType = 'close_up',
  params,
  userId,
  requestId,
  idempotencyKey,
}) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('Scan image not found on disk');
  }
  const raw = fs.readFileSync(filePath);
  if (raw.length > MAX_BYTES_PER_IMAGE) {
    const sizeMb = (raw.length / 1_000_000).toFixed(1);
    const err = new Error(`Scan image too large (${sizeMb} MB). Maximum 8 MB.`);
    err.status = 413;
    throw err;
  }

  const body = {
    images: [{
      data:      raw.toString('base64'),
      mime_type: mimeType || 'image/jpeg',
      type:      viewType || 'close_up',
    }],
    params: {
      ...params,
      tier: normaliseTier(params?.tier),
    },
  };

  // POST /ai/scan now returns either:
  //   • { success, status: "done", data, _idempotent_replay: true }   (cached)
  //   • { success, job_id, status: "queued" }                         (enqueued)
  //   • { success, job_id, status: "queued"|"running", _idempotent_replay }
  // The enqueue itself returns in <500ms; the upload-side timeout below is
  // a defensive ceiling, not the pipeline budget.
  const submitEnvelope = await postSignedJSON('/ai/scan', body, {
    userId,
    requestId,
    idempotencyKey,
    timeoutMs: 10_000,
  });

  if (!submitEnvelope || submitEnvelope.success === false) {
    const err = new Error(submitEnvelope?.error || 'FastAPI scan returned no data');
    err.status = 502;
    throw err;
  }

  // Idempotent inline replay path — no polling needed.
  if (submitEnvelope.status === 'done' && submitEnvelope.data) {
    return submitEnvelope.data;
  }

  const jobId = submitEnvelope.job_id;
  if (!jobId) {
    const err = new Error('FastAPI did not return a job_id');
    err.status = 502;
    throw err;
  }

  // Poll GET /ai/scan/{job_id} until status=done or we exceed POLL_MAX_TOTAL_MS.
  const startedAt = Date.now();
  await new Promise(r => setTimeout(r, POLL_INITIAL_DELAY_MS));
  while (Date.now() - startedAt < POLL_MAX_TOTAL_MS) {
    const snap = await getSigned(`/ai/scan/${encodeURIComponent(jobId)}`, {
      userId,
      requestId,
      timeoutMs: 10_000,
    });
    if (!snap || snap.success === false) {
      const err = new Error(snap?.error || `FastAPI status returned non-success for ${jobId}`);
      err.status = 502;
      throw err;
    }
    if (snap.status === 'done' && snap.data) {
      return snap.data;
    }
    if (snap.status === 'failed') {
      const err = new Error(snap.error || `FastAPI job ${jobId} failed`);
      err.status = 502;
      throw err;
    }
    // queued | running — wait and try again
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  const err = new Error(`FastAPI job ${jobId} did not complete within ${POLL_MAX_TOTAL_MS}ms`);
  err.status = 504;
  throw err;
}


/**
 * Submit a scan to FastAPI and return IMMEDIATELY with the job_id (no polling).
 *
 * Use this when the caller wants to manage polling itself — e.g. a route
 * that returns the job_id to a mobile client that will poll a status
 * endpoint, avoiding the long-lived HTTP connection that breaks the
 * Android OkHttp 60s readTimeout ceiling.
 *
 * Returns one of:
 *   { jobId, status: 'queued' }                                  — newly enqueued
 *   { jobId, status: 'queued'|'running', idempotentReplay: true } — same idem key in flight
 *   { jobId: null, status: 'done', data, idempotentReplay: true } — cached result available
 */
export async function submitFastAPIScan({
  filePath,
  images,                       // optional pre-built array — overrides filePath
  mimeType = 'image/jpeg',
  viewType = 'close_up',
  params,
  userId,
  requestId,
  idempotencyKey,
}) {
  // Two modes:
  //   (a) `images` array supplied (multi-image JSON path from mobile)
  //   (b) `filePath` supplied (legacy single-image multipart path)
  // FastAPI's /ai/scan route already accepts a list — see fastapi/routes/scan.py.
  let imagesPayload;
  if (Array.isArray(images) && images.length > 0) {
    for (const img of images) {
      if (!img?.data) throw new Error('image entry missing base64 data');
      // base64 length × 0.75 ≈ raw byte count.
      if (img.data.length * 0.75 > MAX_BYTES_PER_IMAGE) {
        const sizeMb = ((img.data.length * 0.75) / 1_000_000).toFixed(1);
        const err = new Error(`One image is too large (${sizeMb} MB). Maximum 8 MB each.`);
        err.status = 413;
        throw err;
      }
    }
    imagesPayload = images.map(img => ({
      data:      img.data,
      mime_type: img.mime_type || 'image/jpeg',
      type:      img.type || viewType || 'close_up',
    }));
  } else {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('Scan image not found on disk');
    }
    const raw = fs.readFileSync(filePath);
    if (raw.length > MAX_BYTES_PER_IMAGE) {
      const sizeMb = (raw.length / 1_000_000).toFixed(1);
      const err = new Error(`Scan image too large (${sizeMb} MB). Maximum 8 MB.`);
      err.status = 413;
      throw err;
    }
    imagesPayload = [{
      data:      raw.toString('base64'),
      mime_type: mimeType || 'image/jpeg',
      type:      viewType || 'close_up',
    }];
  }

  const body = {
    images: imagesPayload,
    params: {
      ...params,
      tier: normaliseTier(params?.tier),
    },
  };

  const envelope = await postSignedJSON('/ai/scan', body, {
    userId,
    requestId,
    idempotencyKey,
    timeoutMs: 10_000,
  });

  if (!envelope || envelope.success === false) {
    const err = new Error(envelope?.error || 'FastAPI scan returned no data');
    err.status = 502;
    throw err;
  }

  // Cached idempotent replay — pipeline already done, return data immediately.
  if (envelope.status === 'done' && envelope.data) {
    return { jobId: null, status: 'done', data: envelope.data, idempotentReplay: true };
  }

  if (!envelope.job_id) {
    const err = new Error('FastAPI did not return a job_id');
    err.status = 502;
    throw err;
  }

  return {
    jobId: envelope.job_id,
    status: envelope.status || 'queued',
    idempotentReplay: !!envelope._idempotent_replay,
  };
}


/**
 * Poll FastAPI for the current status of a job. Returns one round-trip.
 *
 *   { status: 'queued' | 'running' | 'done' | 'failed', data?: report, error?: str }
 *
 * The mobile client calls this repeatedly until status is 'done' or 'failed'.
 */
export async function getFastAPIScanStatus({ jobId, userId, requestId }) {
  if (!jobId) throw new Error('jobId required');
  const snap = await getSigned(`/ai/scan/${encodeURIComponent(jobId)}`, {
    userId,
    requestId,
    timeoutMs: 10_000,
  });
  if (!snap || snap.success === false) {
    const err = new Error(snap?.error || `FastAPI status returned non-success for ${jobId}`);
    err.status = 502;
    throw err;
  }
  return {
    status: snap.status,
    data: snap.data || null,
    error: snap.error || null,
  };
}


/**
 * Convert the FastAPI agentic report → the FLAT shape DiagnosisResultScreen
 * expects. Mirrors flattenNodePrediction() in ai.routes.js so the migration
 * is invisible to the mobile client. New rich fields (urgency badge, compliance
 * audit, etc.) ride along on _fullReport for future client opt-in.
 *
 * @param {object} report FastAPI report.data
 * @param {object} farmCtx The same farmContext object the client sent
 */
export function flattenFastAPIDiagnosis(report, farmCtx = {}) {
  if (!report || typeof report !== 'object') return report;

  // Detect the "images unusable, please rescan" short-circuit.
  if (report.report_id === 'needs_rescan') {
    return {
      disease:              'Needs rescan',
      scientific:           '',
      confidence:           0,
      severity:             'unknown',
      isHealthy:            false,
      crop:                 farmCtx.cropName || '',
      stage:                farmCtx.growthStage || '',
      affectedAreaEstimate: farmCtx.affectedArea || '',
      spreadRisk:           '',
      urgencyLevel:         '',
      estimatedYieldLoss:   '',
      immediateAction:      (report.next_steps || [])[0] || 'Please retake clearer photos',
      treatment:            [],
      organicTreatment:     null,
      prevention:           '',
      nextSteps:            report.next_steps || [],
      notes:                report.farmer_summary || 'The uploaded images could not be analysed. Please retake.',
      causes:               [],
      weatherRiskNote:      report.weather_outlook?.advisory || '',
      soilConsideration:    '',
      previousCropNote:     '',
      consultExpert:        true,
      followUpSchedule:     [],
      needsRescan:          true,
      _fullReport:          report,
    };
  }

  const disease   = report.disease || {};
  const treatment = report.treatment || {};
  const meta      = report.meta || {};
  const action    = report.action_card || {};
  const weather   = report.weather_outlook || {};

  // ── Severity / urgency normalisation ─────────────────────────────────────
  const sevRaw  = String(disease.severity || report.risk_level || 'moderate').toLowerCase();
  const urgency = action.urgency?.level
    || (sevRaw === 'severe' ? 'immediate'
      : sevRaw === 'moderate' ? 'today'
      : 'thisweek');

  // ── Treatment lines ──────────────────────────────────────────────────────
  // The agentic chemical_controls entries are richer than the Node format —
  // we keep the same "product — dose (timing)" rendering used by DiagnosisResult.
  const treatmentLines = (treatment.chemical || []).map(c => {
    const prod = c.product || c.active_ingredient || '';
    const dose = c.dosage || c.dose || c.dose_per_acre || '';
    const tip  = c.application_method || c.timing || '';
    const base = `${prod}${dose ? ` — ${dose}` : ''}`;
    return tip ? `${base} (${tip})` : base;
  });

  const organicLines = []
    .concat(treatment.organic || [])
    .concat(treatment.biological || [])
    .map(o => o.product || o.agent || '')
    .filter(Boolean);
  const organicTreatment = organicLines.length ? organicLines.join('\n') : null;

  // ── Causes — pull from explicit causes + the cross_verify penalty list ──
  const causes = []
    .concat(Array.isArray(report.causes) ? report.causes : [])
    .filter(Boolean)
    .slice(0, 4);

  // ── Next steps — prefer the curated weekly_actions, fall back to next_steps
  const nextSteps = Array.isArray(action.top_3_actions) && action.top_3_actions.length
    ? action.top_3_actions
    : (report.next_steps || []).slice(0, 4);

  // ── Confidence: report.confidence_score is 0..1
  const confidencePct = Math.round((report.confidence_score || 0) * 100);

  // ── Healthy detection — agentic pipeline uses "is_out_of_distribution"
  // for non-crop images; for actual "no disease found" we look at the
  // disease label.
  const diseaseName = disease.name_common || '';
  const isHealthy   = /healthy/i.test(diseaseName) && confidencePct >= 70;

  return {
    disease:              diseaseName || 'Unknown',
    scientific:           disease.name_scientific || '',
    confidence:           confidencePct,
    severity:             sevRaw,
    isHealthy,
    crop:                 farmCtx.cropName    || report.farm?.crop || '',
    stage:                farmCtx.growthStage || report.farm?.growth_stage || '',
    affectedAreaEstimate: farmCtx.affectedArea || report.farm?.affected_area || '',
    spreadRisk:           String(disease.spread_risk || '').toLowerCase(),
    urgencyLevel:         urgency,
    estimatedYieldLoss:   '',
    immediateAction:      (treatment.immediate || [])[0] || nextSteps[0] || '',
    treatment:            treatmentLines,
    organicTreatment,
    prevention:           (treatment.preventive || []).join('. '),
    nextSteps,
    notes:                report.farmer_summary || disease.description || '',
    causes,
    weatherRiskNote:      weather.advisory || weather.forecast_risk || '',
    soilConsideration:    '',
    previousCropNote:     '',
    consultExpert:        !!(meta.escalated || meta.needs_lab_confirmation || report.advisor_needed),
    followUpSchedule:     [],
    // ── Surface a few rich fields under a stable key so the client can
    // opt into them progressively without a breaking change ──
    tier:                 meta.tier || null,
    modelDiagnose:        meta.model_diagnose || null,
    modelTreatment:       meta.model_treatment || null,
    safety:               meta.safety || null,
    _fullReport:          report,
  };
}


/**
 * Token + cost extraction so the credits/usage logic in the route handler
 * doesn't need to know the FastAPI shape.
 */
export function extractUsage(report) {
  const tu = report?.meta?.pipeline_token_usage || {};
  return {
    tokens: Number(tu.total_tokens || 0),
    costUsd: Number(tu.total_cost_usd || 0),
  };
}

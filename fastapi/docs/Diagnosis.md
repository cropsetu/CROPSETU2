# Crop Disease Diagnosis — Architecture & Processing

This document explains how the CropSetu crop-disease diagnosis pipeline works end to end:
the request lifecycle, every processing stage, the prompts used, and the safety/grounding
layers that gate the model's output. The service is **Gemini-only** (Google Gemini for all
LLM calls) and runs inside the FastAPI AI microservice.

> File references point at functions/modules (stable). Line numbers drift, so this doc cites
> files and symbols rather than line numbers.

---

## 1. Design philosophy

Three ideas shape the whole pipeline:

1. **Cheap-first, escalate only when uncertain.** A single fast vision model handles the easy
   majority of scans. Only low-confidence or ambiguous cases fan out to a multi-model ensemble.
2. **Async job model.** A scan returns a `job_id` instantly; the heavy work runs in a Celery
   worker; the client polls. This exists because the ensemble path can take 60–120s while the
   Android HTTP client has a hard ~60s socket ceiling.
3. **The LLM proposes, the rules dispose.** The model suggests a diagnosis and a treatment, but
   a deterministic safety layer (banned-chemical registry, CIB&RC label claims, state bans,
   PHI/pollinator checks) is the final authority. A banned or off-label pesticide can never ship.

---

## 2. End-to-end request flow

```
Mobile app
  └─> Express  POST /api/v1/ai/scan/submit
        signs HMAC · authenticates · reserves credits
        └─> FastAPI  POST /ai/scan                     [routes/scan.py]
              verify signed request · validate image (≤8MB) · sanitize free-text
              · daily spend-cap check · idempotency dedup
              └─> enqueue Celery job → returns { job_id, status: "queued" }   (instant)

  (background)
  Celery worker                                          [jobs/tasks.py]
    materialise base64 → temp files
    └─> orchestrator.run_diagnosis(params, images)       [orchestrator.py]
          runs the full pipeline (Section 3)
          records real LLM cost into the spend cap
          fire-and-forget persist → Postgres             [persistence/diagnosis_repo.py]

  Mobile polls
  └─> Express → FastAPI  GET /ai/scan/{job_id}           [routes/scan.py]
        owner check (IDOR guard) → status; when "done", the full report
```

**Entry points**
- [`routes/scan.py`](../routes/scan.py) — `POST /ai/scan` (submit) and `GET /ai/scan/{job_id}` (poll).
  Both require the signed Express→FastAPI HMAC header.
- [`jobs/queue.py`](../jobs/queue.py) — Celery app (Redis broker, db 1), idempotency-key→job binding,
  and job→owner binding (used by the GET ownership check).
- [`jobs/tasks.py`](../jobs/tasks.py) — `run_diagnosis_task`: materialises images, runs the
  orchestrator, then records the pipeline's real USD cost into the daily spend cap.

**Payload handed to the orchestrator**
```python
{
  "params": {
    "tier": "fast" | "best",
    "crop_name", "crop_growth_stage", "soil_type", "irrigation_system", "planting_date",
    "state", "district", "field_latitude", "field_longitude",
    "symptom_description", "recent_pesticide_used", "fertilizer_history", ...  # free-text (sanitized)
  },
  "images": [{"path": "<tempfile>", "type": "leaf"}],
  "request_id": "...", "user_id": "..."
}
```

---

## 3. The orchestrator pipeline

[`orchestrator.py`](../orchestrator.py) → `run_diagnosis()` wraps everything in a **240s hard
timeout** plus a `PipelineBudget` wall-clock tracker that gives each stage a soft cap and
degrades gracefully when time runs low (e.g. skips the treatment LLM if <8s remain).

| # | Stage | LLM? | Purpose |
|---|-------|------|---------|
| 1 | Coords + **Image quality** + Weather fetch (parallel) | No (Pillow CV) | Score image usability; fetch weather by GPS→district→state fallback |
| 2 | **Weather risk analysis** | No (rules) | Compute `overall_disease_risk` + `favorable_diseases` |
| — | **Image quality gate** | — | score < 0.4 → short-circuit "retake photo"; 0.4–0.6 → marginal (penalty later) |
| 3 | **Disease diagnosis** | **Gemini vision** | Image + context + candidate ballot → structured JSON diagnosis |
| 3.25 | **Cascade gate → Ensemble** | Gemini ×2–4 | If confidence < 0.80 **or** ambiguous (and budget allows) → fan out + reconcile by voting |
| 3.5 | **Visual audit + Cross-verify** | No (rules) | HSV pixel check of color claims; weather/image penalties adjust confidence |
| 4 | **Treatment** | **Gemini text** | RAG-grounded IPM plan, then deterministic safety scrub |
| 5 | **Report generator** | No (template) | Assemble the farmer-facing 4-section report (+ optional regional-language blocks) |
| — | **Persist** | — | Fire-and-forget INSERT into `ai_scan_diagnoses` (never blocks the response) |

**Early-exit responses**
- `_needs_rescan_response` — image too blurry/dark/unclear.
- `_service_unavailable_response` — the diagnosis provider (Gemini) was down.
- `_fallback_treatment` — cultural-only plan when out of time budget or confidence too low.

Token usage/cost is summed across all five stages into
`report.meta.pipeline_token_usage.total_cost_usd`, which the worker records into the spend cap.

---

## 4. Stage 1 — Image quality (CV, no LLM)

[`agents/image_quality_agent.py`](../agents/image_quality_agent.py). Pure Pillow heuristics — runs
before any token is spent so a useless photo never reaches the LLM. Three checks:

- **Blur** — edge-energy via a `FIND_EDGES` filter; low edge stddev → blurry.
- **Exposure** — mean luminance must sit in a usable band (not too dark/blown out).
- **Green ratio** — fraction of plant-green pixels (HSV) on a downsampled 64×64 grid; very low
  green → probably not a plant photo.

Composite score `≈ 0.5·blur + 0.2·exposure + 0.3·green`, with a small multi-image bonus.
`usable = score ≥ 0.4`. Output: `{quality_score, usable, suggestions, enhancement_notes}`.

**Gate** (in the orchestrator): `IMAGE_UNUSABLE_THRESHOLD = 0.4` → hard reject (rescan);
`IMAGE_QUALITY_THRESHOLD = 0.6` → "marginal" (proceed, but cross-verify applies a confidence penalty).

---

## 5. Stage 2 — Weather risk (rules, no LLM, $0)

[`services/weather_rules.py`](../services/weather_rules.py) → `analyze_weather_risk_rules()`
(the [`agents/weather_analysis_agent.py`](../agents/weather_analysis_agent.py) wrapper now just
delegates to it). A disease-condition matrix maps temperature / humidity / leaf-wetness to the
diseases each condition favors. Output:

```python
{ "overall_disease_risk": "LOW|MODERATE|HIGH|CRITICAL",
  "favorable_diseases": [...], "risk_factors": [...], "soil_risk", "forecast_risk",
  "advisory", "weather_used": bool }
```

This `favorable_diseases` list is shown to the diagnosis model as *context to break ties* — never
as something that should override the pixels.

---

## 6. Stage 3 — Disease diagnosis (Gemini vision) — the core

[`agents/disease_diagnosis_agent.py`](../agents/disease_diagnosis_agent.py).

### 6.1 The system prompt
Loaded from [`agents/prompts/diagnose.v2.md`](../agents/prompts/diagnose.v2.md) via
[`agents/prompt_registry.py`](../agents/prompt_registry.py) (versioned + content-hashed for audit;
supports per-user A/B bucketing). The persona is *"Dr. KrishiGuard"* and the prompt is a calibrated
**7-step diagnostic protocol**:

1. **Visual analysis** — clinical description (lesion shape/color/margin, distribution pattern).
2. **Multi-perspective** — three independent reads (morphology / distribution / host-stage);
   3/3 = high confidence, 0/3 caps at 0.55.
3. **Pathogen-type classification** — fungal / bacterial / viral / oomycete / nematode / pest /
   abiotic / nutrient / **none**. This is critical: it's what lets the safety layer strip chemicals
   from non-pathogen cases (a wrong pathogen type could ship a pesticide for a non-pathogen problem).
4. **Weather correlation** — SUPPORTS / PARTIAL / CONTRADICTS ("diagnose from pixels first").
5. **Contextual validation** — explicit differentials vs nutrient deficiency, herbicide injury, sunscald.
6. **Differential diagnosis** — top-3 with distinguishing features + look-alikes ruled out.
7. **Calibrated confidence** — honest probability; "under-confidence is safe, over-confidence is
   dangerous" because the system routes low confidence to a human advisor.

It also defines explicit **Healthy / Non-disease / Crop-mismatch / Out-of-distribution** paths so the
model is never forced to invent a disease, and a strict JSON output contract.

### 6.2 The candidate ballot (the key accuracy mechanism)
For a covered crop, `candidates_for(crop)`
([`data/crop_disease_whitelist.py`](../data/crop_disease_whitelist.py)) injects the exact list of
allowed diseases into the prompt, and the prompt forces: *"the primary disease and ALL differentials
MUST be chosen VERBATIM from the candidate list."* This eliminates the #1 cause of wrong diagnoses —
the model inventing a plausible but off-ballot name. Uncovered crops fall back to "open vocabulary".

### 6.3 The user/context block
A **structured, labeled template** (not raw concatenation):
```
CROP DISEASE ANALYSIS
{CANDIDATE DISEASES ballot}
CROP & FIELD:
  Crop / Variety / Growth Stage / Soil / Irrigation / Affected Area
  Symptoms / Pesticides / Fertilizer        ← user free-text, sanitized at the route
WEATHER RISK ASSESSMENT:
  Overall Risk / Risk Factors / Favourable Diseases
```
Free-text fields are control-stripped and length-capped at the route boundary
([`security/input_sanitize.py`](../security/input_sanitize.py)) before they ever reach the prompt.

### 6.4 The call + retries
`call_llm_vision` ([`agents/llm_dispatch.py`](../agents/llm_dispatch.py) →
[`agents/llm_utils.py`](../agents/llm_utils.py)):
- Model: `AI_CROP_DIAGNOSE_MODEL` (default `gemini-2.5-flash`), `max_tokens=8192`, Gemini "thinking"
  tokens disabled on Flash to avoid mid-JSON truncation.
- **Two-temperature retry**: attempt 1 at `temp=0.0` (deterministic); if the JSON fails to parse or
  the disease is empty, attempt 2 at `temp=0.5`. Tokens accumulate across both attempts.
- **No cross-model fallback by design** — if Gemini is down the agent returns `service_unavailable`
  (a clear error) rather than a weaker model's guess.

### 6.5 Output normalization
Snaps the model's disease name to the canonical ballot name (`snap_to_candidate`), guards against a
Latin binomial leaking into the `disease` field, applies the Healthy path, and rescales differential
probabilities to sum ≤ 1. Output shape (abridged):
```json
{
  "primary_diagnosis": {"disease", "scientific_name", "confidence", "severity",
                        "evidence": [...], "pathogen_type"},
  "differentials": [{"disease", "probability", "reason", "distinguishing_feature"}],
  "confidence_score": 0.0,
  "spread_risk", "weather_correlation",
  "is_healthy", "needs_advisor", "needs_lab_confirmation", "crop_mismatch",
  "is_out_of_distribution", "service_unavailable",
  "causal_factors": [...], "_prompt_meta": {...}
}
```

---

## 7. Stage 3.25 — Cascade gate + ensemble (escalation)

The orchestrator escalates when:
```
ENABLE_ENSEMBLE
  and (confidence < ENSEMBLE_ESCALATE_BELOW(0.80) or ambiguous)
  and not crop_mismatch and not is_out_of_distribution
  and remaining_budget(user) ≥ ENSEMBLE_MIN_BUDGET_USD(0.05)   # AISVC-5 guard
```
*Ambiguous* = the primary confidence is within `ENSEMBLE_AMBIGUOUS_DELTA` (0.10) of the top
differential probability (and that differential > 0.25).

[`agents/ensemble_agent.py`](../agents/ensemble_agent.py) `run_parallel()` fans out the same
image + context to **Gemini Pro + Flash** concurrently (each with a 90s timeout — a failed member
just means fewer votes), then [`agents/reconciler.py`](../agents/reconciler.py) `fuse()`:

1. **Canonicalize** every model's disease name
   ([`data/disease_synonyms.py`](../data/disease_synonyms.py), `@lru_cache`) so "Brown Rust" and
   "Puccinia triticina" count as the same vote.
2. **Vote** (drop "Unknown" when a real diagnosis exists; ties broken by confidence).
3. **Fuse confidence** (accuracy-weighted average + agreement bonus; capped at 0.55 on disagreement).
4. **Safety-biased merge** — pick the *worst* reported severity, OR-merge the
   needs-lab / OOD / crop-mismatch flags, merge differentials.

> Note: the default `.env` ships `ENABLE_ENSEMBLE=false` (simpler single-model flow). The machinery
> is preserved and flips on via env. The ensemble chain lives in
> [`agents/registry.py`](../agents/registry.py) `STAGE_TIER_CHAINS["ensemble"]`.

---

## 8. Stage 3.5 — Confidence verification (rules, $0)

Two deterministic correctors run after diagnosis:

- **Visual verify** ([`safety/visual_verify.py`](../safety/visual_verify.py)) — extracts color
  claims from the model ("yellow halos", "white sporulation"), computes the actual HSV histogram of
  the image, and penalizes claims present in < ~0.1% of pixels (likely hallucinated).
- **Cross-verify** ([`safety/cross_verify.py`](../safety/cross_verify.py)) — stacks penalties for
  weather contradiction (only when the disease is in the weather KB), poor image quality, ambiguous
  differentials, needs-lab, and falsified visual claims; caps the total penalty (tighter when the
  ensemble agreed). If confidence drops below `DIAGNOSIS_ESCALATE_BELOW` (0.50) it sets
  `needs_advisor = true`.

---

## 9. Stage 4 — Treatment (RAG-grounded, then safety-scrubbed)

[`agents/treatment_agent.py`](../agents/treatment_agent.py) + prompt
[`agents/prompts/treatment.v1.md`](../agents/prompts/treatment.v1.md).

### 9.1 Hard gate
Before any LLM call: if confidence < 0.50, OOD, crop-mismatch, or viral/abiotic → return a
**cultural-only** plan (no chemicals).

### 9.2 RAG grounding (static, not embeddings)
[`rag/knowledge_base.py`](../rag/knowledge_base.py) `retrieve(disease, crop, zone)` —
zone resolved via [`data/agro_zones.py`](../data/agro_zones.py) `zone_for(state, district)`.
These are **O(1) dict lookups** (intentional, to enforce hard constraints). It returns the
CIB&RC-registered actives for that crop-disease pair, cultural practices, the ETL (economic
threshold), and FSSAI MRLs. They are embedded into the prompt as hard constraints:
```
REGISTERED ACTIVES FOR THIS CROP-DISEASE PAIR (recommend ONLY from this list): ...
HARD CONSTRAINTS:
  • Do NOT recommend an active not in the registered list — it will be rejected by the validator.
  • If the list is empty, recommend ONLY cultural / biological options.
```

### 9.3 The treatment prompt
Enforces full IPM rigor: pathogen-based routing (viral → vector control, no curative chemical),
**FRAC/IRAC resistance groups on every chemical**, a rotation plan (never the same mode of action
twice), pollinator safety during bloom, PHI/REI enforcement, real Indian brand names + approximate
MRP, applicator PPE, and a strict flat-JSON contract.

Model: `AI_CROP_TREATMENT_MODEL` (default `gemini-2.5-flash`), text call. Result is **cached**
(Redis 7d / in-memory 24h) keyed on disease + crop + severity + tier + `registry_version`, so any
registry bump auto-invalidates the cache.

### 9.4 Deterministic safety validation (the real authority)
[`safety/validator.py`](../safety/validator.py) `validate_treatment()` *mutates* the LLM output:
- **Policy gate** ([`safety/policy.py`](../safety/policy.py)) — strips all chemicals for
  low-confidence / viral / abiotic diagnoses.
- **Banned check** ([`safety/chemicals.py`](../safety/chemicals.py)) — ~90 centrally banned actives,
  plus per-state bans ([`data/state_bans.py`](../data/state_bans.py): Kerala, Sikkim-organic,
  Maharashtra cotton, Punjab Malwa, …).
- **Off-label check** — any active not in the CIB&RC label-claim matrix for that crop-disease is removed.
- **PHI/REI clamp** — silently raised to registry baselines if the model under-stated them.
- **Bee-toxic-during-bloom** → blocker.
- **ETL monitor gate** — for mild severity below the economic threshold, chemicals are *deferred*
  in favor of a monitor-first plan.

A **compliance audit** ([`safety/compliance.py`](../safety/compliance.py)) then emits
PASSED / WARNING / FAILED / N/A checks into the report annex.

---

## 10. Stage 5 — Report generator (template, no LLM, $0)

[`agents/report_generator_agent.py`](../agents/report_generator_agent.py) is deterministic string
assembly — instant, $0. It produces a 4-section report:

1. **Farmer summary** — disease, confidence tier badge, severity, urgency, weekly action checklist.
2. **Detailed guidance** — disease explanation, weather "why now" cards, spray schedule, safety DO/DON'T.
3. **Dispensing sheet** — dealer product list with brands/prices/substitutes, incompatibilities, PPE.
4. **Annex** — input echo, environmental data, evidence matrix (primary + differentials), compliance
   audit, and reproducibility metadata (registry versions, prompt hashes, model used).

Optional **regional-language blocks** translate short summaries via Sarvam, protecting the disease
name from machine-translation corruption with a placeholder token.

---

## 11. Models & prompts at a glance

| Stage | Model | Prompt | On failure |
|-------|-------|--------|-----------|
| Image quality | none (Pillow CV) | — | binary go/no-go |
| Weather risk | none (rules) | — | safe default |
| **Diagnosis** | `gemini-2.5-flash` (vision) | [`diagnose.v2.md`](../agents/prompts/diagnose.v2.md) | `temp 0.0→0.5` retry; else `service_unavailable` |
| Ensemble | `gemini-2.5-pro` + `flash` | same diagnose prompt | per-member timeout, graceful |
| **Treatment** | `gemini-2.5-flash` (text) | [`treatment.v1.md`](../agents/prompts/treatment.v1.md) | cultural-only fallback |
| Report | none (template) | — | — |

Provider plumbing: [`agents/llm_dispatch.py`](../agents/llm_dispatch.py) (flat per-feature,
Gemini-only, transient retry), [`agents/registry.py`](../agents/registry.py) (model catalog +
stage chains), [`agents/router.py`](../agents/router.py) (the fallback-chain runner used by the
ensemble).

---

## 12. Key configuration ([`config.py`](../config.py) / `.env`)

| Var | Default | Effect |
|-----|---------|--------|
| `AI_CROP_DIAGNOSE_MODEL` | `gemini-2.5-flash` | Diagnosis vision model |
| `AI_CROP_TREATMENT_MODEL` | `gemini-2.5-flash` | Treatment text model |
| `IMAGE_UNUSABLE_THRESHOLD` | 0.4 | Hard-reject image below this |
| `IMAGE_QUALITY_THRESHOLD` | 0.6 | Mark image "marginal" below this |
| `DIAGNOSIS_ESCALATE_BELOW` | 0.5 | Set `needs_advisor` / block chemicals below this |
| `ENSEMBLE_ESCALATE_BELOW` | 0.80 | Escalate to ensemble below this confidence |
| `ENSEMBLE_AMBIGUOUS_DELTA` | 0.10 | Escalate if primary ≈ top-differential |
| `ENABLE_ENSEMBLE` | `false` | Master ensemble switch |
| `ENSEMBLE_MIN_BUDGET_USD` | 0.05 | Skip ensemble if user's remaining budget is below this |
| `PIPELINE_DEFAULT_TIER` / `ALLOW_BEST_TIER` | `fast` / `true` | Default tier + ops kill-switch |

---

## 13. One-sentence summary

An image + farm context goes through a CV quality gate → a rule-based weather-risk pass → a
Gemini-vision diagnosis constrained to a curated disease ballot → an optional multi-model ensemble
with voting on uncertainty → rule-based confidence correction → a RAG-grounded Gemini treatment plan
that is then deterministically scrubbed against banned / off-label / state-ban / PHI registries → a
template-assembled farmer report, all persisted with reproducibility metadata.

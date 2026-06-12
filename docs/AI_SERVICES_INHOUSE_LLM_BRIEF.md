# CropSetu AI Services — In-House LLM Agent Design Brief

> **Status:** Design input document (not a spec).
> **Audience:** An LLM design partner (e.g. Claude Chat) with **no access to the CropSetu repository**.
> **Goal:** Provide enough accurate, file-grounded context about CropSetu's three AI services and their current third-party LLM footprint that the reader can propose an **in-house / self-hosted LLM agent architecture** to replace or augment the current dependency on Google Gemini (plus Sarvam for voice, and optional Groq/OpenAI).
> **Repo root assumed by all paths:** `/Users/shubhamyeljale/Desktop/CROPSETU2`
> **Source:** Distilled from 7 specialist code-reader traces of the live codebase. Where readers could not determine something, it is flagged **[UNKNOWN]**.

---

## 1. Purpose of this document

CropSetu is a mobile-first agriculture platform for Indian farmers. Three of its features are "AI services":

1. **Crop Disease Diagnosis** (internally "CropGuard" / "Dr. KrishiGuard") — a farmer photographs a diseased leaf; the system returns a structured diagnosis + a compliance-checked IPM (Integrated Pest Management) treatment plan.
2. **AI Text Chat** ("FarmMind") — a conversational agronomy advisor that answers farming questions, personalised with the farmer's farm profile.
3. **AI Voice Chat** — a hands-free, multilingual version of FarmMind: speak a question, hear a spoken answer in an Indian language.

All three currently depend on **third-party hosted models**:

- **Google Gemini** (`gemini-2.5-flash` default, `gemini-2.5-pro` for escalation) — the sole production LLM for vision diagnosis, treatment text, chat, alerts, soil-card OCR.
- **Sarvam AI** — Indic speech-to-text (STT), text-to-speech (TTS), and translation.
- **Groq** (`llama-3.3-70b-versatile`) — optional last-resort *text-chat* fallback.
- **OpenAI** (`gpt-4o`) — optional single ensemble vision voter, off by default.

**This document exists so an LLM design partner can answer: "How do we build an in-house LLM agent (and supporting models) that powers these three services, reduces/eliminates the third-party dependency, and preserves the strong safety/compliance guarantees the current system has?"**

The brief is deliberately exhaustive about: the request flows, every external model call site, the abstraction seams where a new model plugs in, the proprietary domain data that already exists (and could train/ground an in-house model), and the hard constraints (multilingual, vision, structured JSON, Indian agro-chemical compliance).

**Honesty note:** The codebase has substantial stale documentation. Docstrings and one architecture doc reference Anthropic/Claude and "Pro" models that are **not** on the live path. The live, env-resolved truth is **Gemini-only** (`gemini-2.5-flash`) for both vision and text by default. This document states the *live* behavior and flags doc/code contradictions explicitly.

---

## 2. System context

### 2.1 What CropSetu is

A React Native (Expo) mobile app for Indian farmers, backed by an Express (Node) API and a dedicated FastAPI (Python) AI microservice. Persistence is PostgreSQL (via Prisma on the Express side, asyncpg on the FastAPI side) plus Redis. The platform is deployed on Railway (project "secure-essence", ~5 services, Postgres not Mongo).

### 2.2 Three-tier topology

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TIER 1 — MOBILE APP  (React Native / Expo)                                │
│  frontend/src/services/aiApi.js, aiService.js                              │
│  Screens: AIChatScreen.js, VoiceChatScreen.js, DiagnosisResultScreen      │
│  - captures crop photo / typed text / recorded audio                       │
│  - holds Bearer JWT; talks ONLY to Express                                  │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ HTTPS + Bearer JWT
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  TIER 2 — EXPRESS BACKEND BROKER  (Node)                                    │
│  backend/src/routes/ai.routes.js  (all /api/v1/ai/* routes)                 │
│  OWNS: JWT auth, AUTHORITATIVE credit ledger (Prisma/Postgres),             │
│        Redis rate-limit + cooldown, conversation/scan persistence,          │
│        Sarvam STT/TTS/translate (voice lives ENTIRELY here),                │
│        farm-context enrichment, circuit breakers.                           │
│  Proxies ALL LLM inference to FastAPI over HMAC-SHA256-signed HTTP.          │
│  backend/src/utils/fastapi-signed.js = the single egress.                   │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ HMAC-signed JSON  (X-Sig-Timestamp / X-Sig-Signature)
                │ over  ts.METHOD.path.sha256(body)
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  TIER 3 — FASTAPI AI SERVICE  ("CropGuard Agentic AI", port 8001)          │
│  fastapi/main.py → routes/{scan,chat}.py                                    │
│  - Crop diagnosis: async Celery pipeline (5 stages, multi-agent)            │
│  - Chat: Writer→Enhancer agentic text pipeline                              │
│  - LLM calls: agents/llm_dispatch.py → agents/llm_utils.py (raw httpx)      │
│  - Deterministic safety layer: chemicals/state-bans/policy/validator        │
│  - Structured RAG: rag/knowledge_base.py (CIB&RC label-claim matrix)        │
│  EXTERNAL: Gemini (LLM), Open-Meteo (weather), Redis, Postgres, Celery      │
└──────────────────────────────────────────────────────────────────────────┘
```

**Key division of labor for an in-house design:**
- **Voice STT/TTS/translation lives in Express** (`backend/src/services/sarvam.service.js`). FastAPI has **no speech code** (its only Sarvam use is *report-text* translation, unrelated to voice).
- **All LLM text/vision inference lives in FastAPI.**
- **The authoritative per-user budget is the Express credit ledger** (Prisma `AICredit`/`AICreditTransaction`). FastAPI enforces a *secondary* per-user daily USD spend cap as a cost ceiling.

### 2.3 Why HMAC signing matters

FastAPI is deployed at a **public Railway URL**. Every Express→FastAPI request is HMAC-SHA256 signed (shared secret `AI_SHARED_SECRET`) with a 30s skew window and a single-use Redis replay nonce (`fastapi/security/auth.py:96-151`). This prevents anyone from hitting the public FastAPI URL directly to burn LLM spend. **An in-house inference service must sit behind this same signed envelope (or replace the seam wholesale).**

---

## 3. Service deep-dive: Crop Disease Diagnosis ("CropGuard")

### 3.1 What it does

A farmer's crop photo + farm context becomes a structured, multi-section diagnosis & IPM-treatment report. It is **async** (returns a `job_id`, then the app polls). The pipeline brackets two expensive LLM stages (vision diagnosis + text treatment) with cheap deterministic stages (image-quality CV, weather rules, cross-verify, template report) and a **deterministic safety layer as the final authority over any chemical recommendation**.

### 3.2 Inputs / outputs

**Inputs:**
- **One** crop image (base64 inline, ≤8MB, jpg/png/webp). *Multi-image support was removed — only `images[0]` is used.*
- `params` dict: `crop_name` (required), `crop_growth_stage`, `soil_type`, `irrigation_system`, `planting_date`, `crop_variety`, `previous_crop`, `affected_area_percent`, `symptom_description`, `recent_pesticide_used`, `fertilizer_history`, `farm_history`, `farm_size_acres`, `field_latitude/longitude`, `state/district/city`, `language`, `tier` (`fast`|`best`), `farmer_name/contact/address`.
- Headers: `x-user-id` (spend cap + IDOR + A/B bucket), `x-request-id`, `idempotency-key`, HMAC `X-Sig-Timestamp`/`X-Sig-Signature`.

**Outputs:**
- Async envelope: `{job_id, status:queued}` then poll `{status, data:<report>, error}`.
- **Report dict**: 4 sections — `farmer_summary_page`, `detailed_guidance_page`, `dispensing_sheet_page`, `annex_page` — plus flat compatibility fields (`disease`, `treatment`, `causes`, `next_steps`, `weather_outlook`, `confidence_score`, `image_quality`), `local_blocks` (Sarvam-translated native-language strips), and `meta` (tier, models used, token usage/cost, prompt+registry versions, ensemble agreement, visual_audit, safety blockers/warnings, request_id).
- Short-circuits: `needs_rescan` (unusable image, **no LLM spend**) or `service_unavailable` (Gemini down — **no weaker-model fallback**).
- Side effects: a Postgres audit row per scan (`ai_scan_diagnoses`); Redis-cached treatment (7 days); idempotent result cache.

### 3.3 End-to-end flow (ASCII)

```
Mobile app
  │  POST /api/v1/ai/chat? no — POST scan via Express (multipart/JSON)
  ▼
Express  backend/src/routes/ai.routes.js (~1020-1079)  [USE_FASTAPI_FOR_SCAN=true]
  │  backend/src/services/ai.scan.fastapi.js: base64-encode (<=8MB), normalise tier,
  │  HMAC-sign, POST /ai/scan, then poll GET /ai/scan/{job_id} every 2s up to 300s
  ▼
FastAPI  routes/scan.py  POST /ai/scan
  │  verify_signed_request → slowapi limit (10/min;60/hr) → clean_user_text →
  │  _validate_images (single image, 8MB, magic-byte sniff) → check_under_cap (402) →
  │  idempotency (inline replay cache OR in-flight job reuse)
  │  enqueue_diagnosis() → Celery task (Redis broker db1); bind job owner (IDOR guard)
  │  return {job_id, status:queued}
  ▼
Celery worker  jobs/tasks.py  run_diagnosis_task  (max_retries=0)
  │  base64 → tempfile; set request_id/user_id contextvars; asyncio.run(run_diagnosis)
  ▼
orchestrator.py  run_diagnosis(params, images)   [240s asyncio.wait_for cap]
  │
  ├─ STAGE 1 (parallel, $0):
  │     • resolve weather coords  (GPS → geocode → district → state capital → Nagpur)
  │     • fetch Open-Meteo weather + soil moisture
  │     • image_quality_agent  (Pillow CV: blur/exposure/green-ratio + magic-byte)  NO LLM
  │
  ├─ STAGE 2 (rule-based, $0):  analyze_weather_risk_rules → disease risk + favorable diseases
  │
  ├─ QUALITY GATE:  unusable (<0.4) → needs_rescan short-circuit (NO LLM)
  │                 marginal (0.4–0.6) → penalised downstream
  │
  ├─ STAGE 3  ►► LLM VISION ◄◄  run_disease_diagnosis_agent
  │     • single Gemini 2.5 Flash vision call (call_llm_vision)
  │     • prompt = diagnose.v2.md system + per-crop candidate ballot + weather/context
  │       (+ optional local ONNX classifier prior)
  │     • temp 0.0; ONE same-model retry on JSON-parse failure; NO cross-model fallback
  │     • _normalise: snap disease name to crop whitelist, guard binomial leaks,
  │       normalise differential probabilities
  │     • provider outage → service_unavailable (fail loud, never degrade silently)
  │
  ├─ STAGE 3.25  CASCADE GATE (only if ENABLE_ENSEMBLE=true; OFF by default)
  │     if confidence < 0.80 OR ambiguous, and budget OK:
  │       ensemble_agent.run_parallel → Gemini Pro + Gemini Flash (+ GPT-4o if key set
  │       + crop specialist if registered), concurrent asyncio.gather, 90s/member
  │     reconciler.fuse(): canonicalise names → confidence-aware vote → accuracy-weighted
  │       fusion + agreement bonus → safety-biased flag merge
  │
  ├─ STAGE 3.5  SKEPTIC LAYER ($0):
  │     • safety/visual_verify  HSV pixel histogram vs LLM color claims → falsified-claim penalty
  │     • safety/cross_verify   rule-based confidence caps (OOD 0.45, crop_mismatch 0.30,
  │       model-disagreement 0.55, weather-contradiction [KB-gated], image-quality ramp,
  │       lab-confirmation); sets needs_advisor below 0.50
  │
  ├─ STAGE 4  ►► LLM TEXT ◄◄  run_treatment_agent
  │     • HARD GATE: confidence<0.5 / OOD / crop-mismatch / viral / abiotic → cultural-only
  │     • RAG grounding: rag/knowledge_base.retrieve(disease, crop, zone) → registered actives
  │     • single Gemini 2.5 Flash text call (call_llm_text); NO fallback for treatment
  │     • safety/validator: strip banned/off-label/bee-toxic actives, clamp PHI/REI
  │     • ETL monitor-gate; Redis-cache 7 days
  │
  ├─ STAGE 5  run_report_generator_agent  (TEMPLATE, NO LLM, $0)
  │     • 4 sections + Sarvam-translated native-language strips (brand/active names kept English)
  │     • token usage aggregated; meta stamped; record_diagnosis() → Postgres audit row
  │
  ▼  full report dict → Celery stores in Redis
Express polls until status=done → flattenFastAPIDiagnosis() → mobile flat shape → app
```

### 3.4 LLM / vision call sites (Crop Disease Diagnosis)

| Where | Provider | Model (live default) | Purpose |
|---|---|---|---|
| `agents/disease_diagnosis_agent.py:run_disease_diagnosis_agent` → `agents/llm_dispatch.py:call_llm_vision` → `agents/llm_utils.py:call_gemini_vision` | Gemini | `gemini-2.5-flash` (`AI_CROP_DIAGNOSE_MODEL`) | Primary vision diagnosis → structured JSON (primary_diagnosis, differentials, pathogen_type, confidence, severity, weather_correlation) |
| `agents/ensemble_agent.py:run_parallel` → `agents/router.py:dispatch_one_vision` → `_call_one_vision` | Gemini (+OpenAI optional) | `gemini-2.5-pro`, `gemini-2.5-flash`, `gpt-4o` (only if `OPENAI_API_KEY` set) | Parallel multi-model re-diagnosis when first pass is low-confidence/ambiguous. **OFF by default** (`ENABLE_ENSEMBLE='false'`) |
| `agents/treatment_agent.py:run_treatment_agent` → `call_llm_text` → `call_gemini_text` | Gemini | `gemini-2.5-flash` (`AI_CROP_TREATMENT_MODEL`) | RAG-grounded IPM treatment plan (FRAC/IRAC, biological/cultural, rotation, Indian brand names) |
| `agents/report_generator_agent.py:_attach_local_blocks` → `services/sarvam_translator.py:translate_blocks` | Sarvam | Sarvam Translate (`mode=formal`) **[exact model id UNKNOWN]** | Translate 5 short English report blocks into farmer's Indic language; disease/chemical/brand names token-protected from MT |
| `models/local_classifier.py:classify` | In-house ONNX | MobileNetV2 / PlantVillage (38 labels) | **Optional** local soft prior (disabled unless `LOCAL_CLASSIFIER_MODEL_PATH` set) |

**Critical reality check (confirmed against source):**
- The "multi-agent" richness in *normal production* is mostly the **rule-based, $0** stages (image quality, weather, cross_verify, visual_verify, validator, template report). With the ensemble OFF by default, diagnosis is effectively **a single Gemini vision call → reconciler bypassed → single-result branch**.
- The diagnose path **deliberately has NO model fallback**. This is a load-bearing design constraint: *fail loud, don't silently degrade* (the doc notes Pro was ~67% top-1 vs Flash ~30% on a textbook set, so a silent weaker guess is a real harm). **An in-house substitute should preserve this contract.**

### 3.5 The local classifier (existing in-house vision seam)

`models/local_classifier.py` already loads an external ONNX MobileNetV2 PlantVillage classifier (38 classes) and produces a soft prior fed into the diagnose prompt. It is disabled unless `LOCAL_CLASSIFIER_MODEL_PATH` is set. The docstring describes a "tier-zero fallback" intent: its output *could* be promoted from prior to primary when LLMs fail. **This is the most natural beachhead for an in-house vision model.**

### 3.6 Safety / visual-verify (deterministic, $0 — the crown jewels)

- **Closed-ballot diagnosis:** `data/crop_disease_whitelist.candidates_for(crop)` converts the open label space to a per-crop ballot; `snap_to_candidate()` is **match-only** (never nearest-neighbour) so an incomplete whitelist degrades softly.
- **Visual claim verification** (`safety/visual_verify`): HSV pixel histogram audits the LLM's color claims ("yellow halos", "white sporulation"); fabricated claims → confidence penalty.
- **Cross-verify skeptic** (`safety/cross_verify`): rule-based confidence caps/penalties.
- **Treatment policy gate + chemical validator** (`safety/policy.py` + `safety/validator.py:77-225`): strips chemicals on low confidence/OOD/crop-mismatch/viral/abiotic; drops centrally + state-banned and off-label (CIB&RC label-claim) actives; blocks bee-toxic actives during flowering; clamps PHI/REI; full-organic-state block (e.g. Sikkim); ETL monitor-first gate.
- **Compliance audit** (`safety/compliance.build_compliance_audit`): 7-check PASSED/WARNING/FAILED/N-A block for the dispensing sheet.

**Design implication:** the safety layer is provider-agnostic and sits *downstream* of the LLM. An in-house model inherits all these guarantees for free, as long as it emits the same structured fields the validator consumes.

### 3.7 Async Celery worker

`jobs/tasks.py:run_diagnosis_task` (lines 102-161): `max_retries=0` (a retried diagnose costs money), base64→tempfile, `asyncio.run(orchestrator)`, `record_spend(user_id, cost)`, tempfile cleanup. Celery limits: `time_limit=300` / `soft=270`; orchestrator wraps at 240s.

### 3.8 Data assets (diagnosis)

| File | Role |
|---|---|
| `fastapi/agents/prompts/diagnose.v2.md` | Active vision diagnose system prompt (Dr. KrishiGuard, 7-step, 16.8 KB) |
| `fastapi/agents/prompts/treatment.v1.md` | Active treatment system prompt (IPM plan) |
| `fastapi/agents/prompts/diagnose.v1.md` | Retired, kept for eval replay only |
| `fastapi/rag/knowledge_base.py` | Structured (non-vector) RAG: CIB&RC label-claim matrix |
| `fastapi/data/crop_disease_whitelist.py` | Per-crop candidate ballots + canonical name-snap |
| `fastapi/data/disease_synonyms.py` / `disease_lexicon.py` | Name canonicalization + vetted local-language names |
| `fastapi/safety/chemicals.py` / `data/state_bans.py` | Registered actives + central/state bans |
| `fastapi/models/local_classifier.py` | ONNX classifier seam |
| `fastapi/data/agro_zones.py` / `state_language.py` / `district_coords.py` | Zone keying, state→language, coord fallback |

---

## 4. Service deep-dive: AI Text Chat ("FarmMind")

### 4.1 What it does

A conversational agronomy advisor. The active production path: app → Express `POST /api/v1/ai/chat` → (reserve credits, enrich farm profile from Prisma) → HMAC-signed FastAPI `POST /ai/chat` → **Writer→Enhancer agentic text pipeline** → reply + tap-able follow-up chips.

> A **legacy** Express-native single-call chat (`backend/src/services/ai.chat.service.js:chatWithFarmMind`) still exists but is **superseded** — the chat route now only imports `getCurrentSeason` from it and forwards all inference to FastAPI.

### 4.2 Inputs / outputs

**Inputs:** text message (≤1000 chars at Express, capped 4000 at FastAPI), `conversationId` (or null), `farmProfile` overrides + selected language, `responseLength` (`short`|`medium`|`long`|`extra_long`, default short), `mode` (`text`|`voice`), optional image `{data, mime_type}` (≤12MB), last-20-turn history, enriched farm context.

**Outputs:** `reply` (length/voice/markdown-shaped), `type:'text'`, `card`/`structured_data` (null for chat), `followUps` (3-5 chips, 2-3 for voice), `token_info` (model, tokens, cost, calls — summed across all calls), `conversationId`.

### 4.3 Flow (ASCII)

```
App → Express POST /api/v1/ai/chat
  authenticate → aiChatLimit → idempotency('chat') → validate (image<=12MB, msg<=1000) →
  Redis cooldown → reserveCredits(hasImage ? 'ai_scan_gemini' : 'ai_chat_gemini')  [402 if exhausted] →
  find/create AIConversation, load last 20 AIMessage →
  buildEnrichedProfile → chatContext.service.buildFarmerChatContext (parallel Prisma queries) →
  HMAC-sign → POST FastAPI /ai/chat (120s)
        │
        ▼
FastAPI routes/chat.py  (verify_signed_request, 100s budget)
  services/chat_service.py:chat_with_farmmind
    clean_user_text (strip control/zero-width/bidi; cap msg 4000, each turn 2000)
    _compute_profile → FARMER PROFILE text block (+ per-language instruction)
    _format_history → last 20 turns "Farmer:/FarmMind:"
    ROUTE:
      has_image → _vision_reply           (single CHAT_VISION call)
      mode=='voice' → _voice_reply         (single concise CHAT_WRITER call, <90 words)
      else → _agentic_text_reply:
        Writer  (CHAT_WRITER)  drafts answer
        Enhancer(CHAT_ENHANCER) fact-checks + rewrites  — ONLY for long/extra_long
        (short/medium = Writer-only single call)
        Follow-ups folded into the SAME final call via ###FOLLOWUPS### delimiter (no extra LLM call)
        _split_followups ALWAYS strips the block from the visible reply (leak-proof)
    return {reply, type:'text', structured_data:null, token_info, followUps}
        │
        ▼
Express settles credits with actual token_info → persist user+assistant AIMessage + AIUsage → app
```

### 4.4 LLM call sites (Text Chat)

| Where | Provider | Model (live default) | Purpose |
|---|---|---|---|
| `chat_service.py:_agentic_text_reply` (Writer, line 408) | Gemini | `gemini-2.5-flash` (`AI_CHAT_WRITER_MODEL`) | Draft the answer; folds in follow-up chips when no Enhancer runs |
| `chat_service.py:_agentic_text_reply` (Enhancer, line 429) | Gemini | `gemini-2.5-flash` (`AI_CHAT_ENHANCER_MODEL`) | Fact-check + rewrite — **only** for `long`/`extra_long` |
| `chat_service.py:_voice_reply` (line 450) | Gemini | `gemini-2.5-flash` (CHAT_WRITER, voice mode) | Single concise spoken-style reply (<90 words, no markdown) |
| `chat_service.py:_vision_reply` (line 472) | Gemini | `gemini-2.5-flash` (`AI_CHAT_VISION_MODEL`) | General image understanding (NOT crop-disease — that's `/ai/scan`). NO fallback |
| `llm_dispatch.py:call_llm_text` capacity fallback (line 273) | Gemini | `gemini-2.5-pro` (Flash↔Pro swap) | Capacity fallback for chat features (separate quota) |
| `llm_dispatch.py:call_llm_text` Groq fallback (line 289) | Groq | `llama-3.3-70b-versatile` | **Last-resort** cross-provider text-chat fallback (only if `GROQ_API_KEY` set) |
| `ai.chat.service.js:chatWithFarmMind` (line 529) — **LEGACY, unused for inference** | Gemini | `gemini-2.5-flash` (ENV.GEMINI_MODEL) | Legacy single-call chat; superseded |

### 4.5 Context / "RAG"

Chat does **no vector or KB retrieval**. Its only grounding is the **structured farm profile** injected into the prompt (`_compute_profile`: crops, soil report, cycle history, multi-year trends, recurring issues) built Express-side by `chatContext.service.js` from Prisma. `rag/knowledge_base.py`, `prompt_registry.py`, `safety/policy.py` serve the **scan** pipeline, **not** chat. Chat prompts are **inline in `chat_service.py`** (not in the versioned prompt registry).

### 4.6 Follow-ups, fallback, safety/PII

- **Follow-ups:** produced in the same LLM call as the answer (no extra call), split on `###FOLLOWUPS###`, always stripped from the visible reply (leak-proof, `chat_service.py:330-365`).
- **Fallback (chat only):** Gemini primary → Gemini Flash↔Pro capacity → Groq Llama (gated on `GROQ_API_KEY`). **The memory note "chat has no model fallback" is stale** — chat *does* have two fallback layers. Vision and all non-chat features genuinely have NO fallback.
- **Safety:** HMAC signing; `clean_user_text` strips control/zero-width/bidi and caps lengths; Writer system prompt SECURITY clause treats the farmer message as data (no role change, no system-prompt reveal, farming-only); 100s pipeline budget; PII redaction in logs (`security/pii.py` masks GPS/phones/emails/Aadhaar/PAN/GST/IFSC). **Chat has no diagnosis-confidence or label-claim gating** — that guards `/ai/scan` only.

---

## 5. Service deep-dive: AI Voice Chat

### 5.1 What it does

Hands-free multilingual FarmMind. The user speaks; the app records audio; **Sarvam STT** transcribes; the transcript goes to the LLM chat pipeline (FastAPI, Gemini) which replies **already in the farmer's language** (no translation step); **Sarvam TTS** synthesizes the reply to audio which auto-plays.

Two entry points differ:
- **`VoiceChatScreen.js`** — full STT + LLM + TTS (cosmic particle-sphere UI).
- **Inline mic in `AIChatScreen.js`** — voice as **INPUT only** (`sendVoiceMessage`, no TTS, text reply).

### 5.2 Inputs / outputs

**Inputs:** recorded audio (m4a/AAC ~44.1kHz mono 64kbps; also mp3/wav/webm/ogg/aac) as multipart field `audio`; language hint (BCP-47 or short code, or null for auto-detect); `conversationId`; `farmProfile`; `Idempotency-Key`.

**Outputs:** `transcription`, `detectedLanguage` (BCP-47), `reply` (concise spoken-style, in farmer's language), `audio: {audio: base64 WAV, mimeType: 'audio/wav'}`, `followUps` (2-3), `conversationId`, token usage.

### 5.3 Pipeline (ASCII)

```
VoiceChatScreen (expo-av)
  record m4a/AAC; auto-stop on 10s silence (<-45 dBFS) or 60s cap; discard <500ms
  │  FileSystem.uploadAsync multipart → POST /api/v1/ai/voice
  ▼
Express  ai.routes.js  POST /ai/voice (line 542)
  authenticate → aiVoiceLimit → idempotency → multer (25MB) → reserveCredits('ai_voice')
  │
  ├─ STT (Sarvam)  sarvam.service.js:sarvamSTT
  │     POST https://api.sarvam.ai/speech-to-text  model 'saaras:v3'  mode 'transcribe'
  │     empty transcript → 422 ; service error → 503 + credit refund
  │
  ├─ find/create VoiceConversation, load last 20 VoiceMessages, build enriched profile
  │  reply language = body.language OR Sarvam-detected OR 'en'
  │
  ├─ LLM (FastAPI/Gemini)  callFastAPI('/ai/chat', {message:transcript, mode:'voice'/'text', ...})
  │     [55s cap]  chat_service.py:_voice_reply → single Writer call with _VOICE_DIRECTIVE
  │     reply ALREADY in farmer's language; follow-ups split by ###FOLLOWUPS###
  │
  ├─ persist user+assistant VoiceMessages; settleCredits('ai_voice')
  │
  └─ TTS (Sarvam)  [text-first split: dedicated screen calls /ai/tts SEPARATELY]
        sarvam.service.js:sarvamTTS
        POST https://api.sarvam.ai/text-to-speech  model 'bulbul:v3'  speaker 'priya'  22050Hz
        → base64 WAV
  ▼
VoiceChatScreen.playBase64Audio() → expo-av Audio.Sound (and types reply on-screen)
```

### 5.4 Sarvam usage / call sites

| Where | Provider | Model (over-the-wire) | Purpose |
|---|---|---|---|
| `backend/src/services/sarvam.service.js:sarvamSTT` (line 82) | Sarvam | `saaras:v3` | Speech-to-text (Indic/English audio → text). 15s timeout, `sarvamBreaker` |
| `backend/src/services/sarvam.service.js:sarvamTTS` (line 128) | Sarvam | `bulbul:v3`, speaker `priya` | Text-to-speech → base64 WAV |
| `backend/src/services/sarvam.service.js:sarvamTranslate` (line 174) | Sarvam | `mayura:v1` | Translate between Indian languages (via `/ai/translate`; **NOT** on live voice round-trip) |
| `fastapi/services/chat_service.py:_voice_reply` (via `call_llm_text`) | Gemini | `gemini-2.5-flash` (CHAT_WRITER) | Spoken-style reply in farmer's language |
| `fastapi/services/sarvam_translator.py:_translate_one` | Sarvam | translate (`mode=formal`) **[model id UNKNOWN]** | **Report enrichment only** — not voice |

> **Model-id inconsistencies to verify:** code sends STT `saaras:v3` but a docstring says `saarika:v2` and env default is `sarvam:saarika`; TTS body says `bulbul:v3` but a comment says `bulbul:v1`. The over-the-wire values are **v3 for both**.

### 5.5 Languages supported

~11 Indic languages + English: `hi, mr, ta, te, kn, gu, pa, bn, ml, or, en`. Assamese (`as`) maps to a language but is **absent** from Sarvam tags. NE-states/islands default to English. Note `'or'→'od-IN'` quirk. Language maps live in `fastapi/services/state_language.py` (state→lang) and BCP-47 maps in `sarvam.service.js` / `VoiceChatScreen.js` / `utils/speak.js` (consolidation to shared JSON is a noted TODO).

> **Offline TTS fallback that already exists:** `frontend/src/utils/speak.js` uses **expo-speech** (free, on-device OS TTS) for insights/P&L/mandi — a ready-made in-house TTS pattern, though not wired into voice chat.

---

## 6. Current third-party LLM / AI footprint (consolidated)

### 6.1 Every external model call site

| # | Service | Call site (file) | Provider | Exact model | Endpoint / how called |
|---|---|---|---|---|---|
| 1 | Diagnosis | `fastapi/agents/llm_utils.py:call_gemini_vision` (via `disease_diagnosis_agent`) | Gemini | `gemini-2.5-flash` | raw httpx POST `…/v1beta/models/{model}:generateContent`, `x-goog-api-key`, inline_data image, max_tokens 8192, temp 0, thinkingBudget=0 (Flash) |
| 2 | Diagnosis (ensemble, OFF) | `call_gemini_vision` via `ensemble_agent`/`router` | Gemini | `gemini-2.5-pro`, `gemini-2.5-flash` | same Gemini REST; concurrent gather, 90s/member |
| 3 | Diagnosis (ensemble, OFF) | `fastapi/agents/llm_utils.py:call_openai_vision` | OpenAI | `gpt-4o` (`OPENAI_DIAGNOSE_MODEL`) | raw httpx POST `https://api.openai.com/v1/chat/completions`, Bearer, data-URI image. Only if `OPENAI_API_KEY` + `ENABLE_ENSEMBLE` |
| 4 | Treatment | `fastapi/agents/llm_utils.py:call_gemini_text` (via `treatment_agent`) | Gemini | `gemini-2.5-flash` | raw httpx POST Gemini generateContent, max_tokens 8192 |
| 5 | Chat (Writer) | `call_gemini_text` (via `chat_service._agentic_text_reply`) | Gemini | `gemini-2.5-flash` | Gemini REST |
| 6 | Chat (Enhancer) | `call_gemini_text` | Gemini | `gemini-2.5-flash` | Gemini REST (only long/extra_long) |
| 7 | Chat (vision) | `call_gemini_vision` (via `_vision_reply`) | Gemini | `gemini-2.5-flash` | Gemini REST, inline_data |
| 8 | Chat (voice mode) | `call_gemini_text` (via `_voice_reply`) | Gemini | `gemini-2.5-flash` | Gemini REST |
| 9 | Chat (capacity fallback) | `llm_dispatch.py:call_llm_text` line 273 | Gemini | `gemini-2.5-pro` | Gemini REST (Flash↔Pro swap) |
| 10 | Chat (cross-provider fallback) | `fastapi/agents/llm_utils.py:call_groq_text` | Groq | `llama-3.3-70b-versatile` | raw httpx POST `https://api.groq.com/openai/v1/chat/completions`, Bearer. Only if `GROQ_API_KEY` |
| 11 | Soil OCR | `fastapi/services/soil_ocr_service.py:extract_soil_card` → `call_llm_vision` | Gemini | `gemini-2.5-flash` (`AI_SOIL_OCR_MODEL`) | Gemini REST, inline_data |
| 12 | Smart Alerts | `call_gemini_text` (via `alert_service.py`) | Gemini | `gemini-2.5-flash` (`AI_ALERT_MODEL`) | Gemini REST |
| 13 | Pest enhancement | `call_gemini_text` (PEST feature) | Gemini | `gemini-2.5-flash` (`AI_PEST_MODEL`) | Gemini REST |
| 14 | Voice STT | `backend/src/services/sarvam.service.js:sarvamSTT` | Sarvam | `saaras:v3` | Node fetch multipart → `api.sarvam.ai/speech-to-text` |
| 15 | Voice TTS | `sarvam.service.js:sarvamTTS` | Sarvam | `bulbul:v3` (speaker `priya`) | Node fetch JSON → `api.sarvam.ai/text-to-speech` |
| 16 | Translation (standalone) | `sarvam.service.js:sarvamTranslate` | Sarvam | `mayura:v1` | Node fetch JSON → `api.sarvam.ai/translate` |
| 17 | Report translation | `fastapi/services/sarvam_translator.py:_translate_one` | Sarvam | translate `mode=formal` **[id UNKNOWN]** | httpx POST `api.sarvam.ai/translate` |
| 18 | Schemes Q&A | `backend/src/services/claude.service.js:callClaude` | **Gemini** (despite name) | `gemini-2.5-flash` (ENV.GEMINI_MODEL) | OpenAI SDK pointed at Gemini OpenAI-compat base |
| 19 | Legacy in-Express scan | `backend/src/services/ai.predict.service.js:callGemini` | Gemini (or GPT-4o if only OpenAI key) | `gemini-2.5-flash` (ENV.GEMINI_MODEL) | OpenAI SDK, Gemini OpenAI-compat base, `USE_FASTAPI_FOR_SCAN=false` only |
| 20 | Legacy Express chat | `backend/src/services/ai.chat.service.js:chatWithFarmMind` | Gemini | `gemini-2.5-flash` | OpenAI SDK, Gemini OpenAI-compat base. **Not used for inference** |

**Distinct external LLM/AI call sites documented: 20** (16 distinct + 4 legacy/standalone variants; the *production-live* LLM surface is Gemini for everything in 1–13, 18, 19 and Sarvam for 14–17).

### 6.2 Provider-abstraction layer

Two parallel dispatch layers funnel into one file:

```
Feature handlers (chat_service, disease_diagnosis_agent, treatment_agent, soil_ocr, alert_service)
        │
        ├──────────────► agents/llm_dispatch.py   (FLAT per-feature dispatcher)
        │                  get_feature_config(feature) → FeatureConfig{feature,model,api_key,base_url}
        │                  _detect_provider(model)  ◄── HARD-REJECTS any non-'gemini-' id (ConfigError)
        │                  call_llm_text(): Gemini → Flash↔Pro → Groq (chat only)
        │                  call_llm_vision(): NO fallback
        │
        └──────────────► agents/router.py  (CHAIN/registry dispatcher; vision diagnose + ensemble only)
                           dispatch_vision / dispatch_one_vision / _run_chain
                           registry.STAGE_TIER_CHAINS, resolve_chain (drops unkeyed models)
        ▼
agents/llm_utils.py   ◄── THE ONLY place a raw LLM HTTP request is built & parsed
  call_gemini_text / call_gemini_vision / call_groq_text / call_openai_vision
  _PRICING table (USD/1K tokens) ; _make_token_info / _calc_cost ; base URLs ; thinkingBudget toggle
```

Supporting:
- `agents/prompt_registry.py` — versioned `.md` prompts (`ACTIVE_VERSIONS={'diagnose':'v2','treatment':'v1'}`), SHA-256 hashed, sticky A/B bucketing. Provider-agnostic plain text.
- `config.py` — loads `.env`, exposes `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `OPENAI_DIAGNOSE_MODEL`, `GROQ_FALLBACK_MODEL`.
- `services/http_clients.py` — pooled long-lived `httpx.AsyncClient` per upstream (`get_gemini` 120s, `get_groq` 90s, `get_openai` 120s, `get_sarvam`).

### 6.3 How tightly coupled is the code to Gemini?

**Coupling is MODERATE, and the seams are clean — but there are real blockers:**

1. **NO vendor SDK is used anywhere.** Every provider (Gemini, Groq, OpenAI) is hand-rolled httpx returning a uniform `(raw_text, token_info)` tuple. The installed `anthropic==0.94.0` and `groq==1.1.2` packages are **dead weight** (anthropic never imported; groq called via raw HTTP).
2. **Prompts are fully provider-agnostic** (plain `.md` / inline strings; system+user concatenated). An in-house model receives identical prompts with no caller changes.
3. **THE hard blocker:** `agents/llm_dispatch.py:_detect_provider` (lines 107-116) **raises `ConfigError` on any non-`gemini-` model id** (verified in source). `FeatureConfig.base_url` exists (line 94) but is **vestigial / unused**. To admit an in-house model you must relax `_detect_provider` and honor `base_url`.
4. **Three Gemini-isms baked into `llm_utils.py`:** `thinkingConfig.thinkingBudget=0` (Flash-only), the `candidates[0].content.parts[0].text` response shape, and `usageMetadata` token field names. An in-house endpoint must either mimic Gemini's `generateContent` response shape or get its own parser helper.
5. **Two dispatchers** must both be updated: the flat `llm_dispatch` (chat/soil/treatment/diagnose-single) **and** the chain `router`+`registry` (vision-chain/ensemble).
6. **Pricing coupling:** `llm_utils._PRICING` must get a row for any new model id or `_calc_cost` silently uses the Flash fallback price (won't bill $0, but the estimate is wrong, and the daily spend cap is mis-fed).
7. **No schema validation on LLM output:** structured output relies on `utils/json_extractor.extract_json` + ad-hoc `_normalise`/critical-field dict checks. An in-house model must produce **reliable JSON**.

---

## 7. Supporting infrastructure

### 7.1 Express credit ledger (AUTHORITATIVE spend)

Prisma/Postgres, `backend/src/services/aiCredit.service.js`:
- **`AICredit`** (one row/user): `balance`, `lifetimeEarned`, `lifetimeSpent`, `freeRefillDate`, `tier`.
- **`AICreditTransaction`** (append-only ledger): `amount`, `balanceAfter`, `type` (feature), `aiModel`, `tokensUsed`, `costUsd`, `metadata.status` (HOLD/SETTLED/RELEASED).
- **Flow:** `reserveCredits()` does an atomic conditional decrement (`updateMany where balance>=floor`) + HOLD row **before** the LLM call (402 on exhaustion) → `settleCredits()` reconciles to actual tokens (charge delta / refund) → `releaseCredits()` refunds on failure. `creditsForUsage = max(floor, ceil(tokens/1000))`.
- **Per-feature floors** (`CREDIT_COSTS`): `ai_scan_gemini` 3, `ai_chat_gemini` 1, `ai_voice` 2, `ai_tts`/`ai_translate` 1, `soil_ocr` 3 (+ legacy `ai_*_claude`/`groq` keys kept only so historical rows resolve a floor).
- **Free-tier daily caps** (`AIUsage`): scan 500, chat 200, token 1,000,000 (currently raised for testing).
- **Idempotent scan settlement:** Redis `SET NX scan_settled:<jobId>` (24h) so duplicate polls don't double-charge.

> **A provider swap MUST keep `token_info.total_tokens` flowing back** so `settleCredits` meters correctly. If a new provider returns no token count, settle falls back to the per-feature floor.

### 7.2 FastAPI USD spend cap (secondary cost ceiling)

`fastapi/security/spend.py`: `DAILY_SPEND_CAP_USD` (default $1.00 identified, $0.10 anonymous shared bucket). `check_under_cap` before scan enqueue (402 if over); `record_spend` after (only `jobs/tasks.py` increments it — **chat/alert compute token_info but never `record_spend`**, so enforcement coverage is partial). Fail-CLOSED when Redis required but unreachable.

### 7.3 RAG knowledge base

`fastapi/rag/knowledge_base.py` — **structured, non-vector** (deliberate design: "failure mode is dosage/registration hallucination, not recall; embedding-based RAG is a future enhancement"). Tables: `_LABEL_CLAIMS` (22 `(crop,disease)→active-set`), `_CULTURAL_PRACTICES` (5) + `_GENERIC_IPM` (5), `_ETL` (5), `_FSSAI_MRL` (13). Keyed `(disease, crop, zone)`. Off-label actives are excluded **at retrieval**; no registered active → cultural-only.

### 7.4 Eval / golden-set harness

`fastapi/eval/`: `golden_runner.py` (top-1/top-3/Brier/severity/escalation/cost over a labeled `manifest.jsonl`), `load_eval.py` (concurrent load + per-stage token/cost/latency), `replay.py` (re-run diagnose stage on persisted Postgres scans — **text-only, image bytes not stored**), `build_golden_set.py` (sample PlantVillage), `run_book_dataset.py` (textbook dataset). Eval uses the **same** `same_disease()` matcher production uses.

> **Data maturity gaps:** the committed `data/golden_set/manifest.jsonl` is **EMPTY** (no checked-in labeled image set). The only realized labeled-eval artifact is `eval/reports/book_dataset/` — 100 rows / 13 crops / 97 saved responses; observed **32/92 top-1 strict, 48/92 top-3, 8 service-unavailable** (single hosted-model run).

### 7.5 Observability & resilience

- **Circuit breakers** (`backend/src/resilience/breakers.js`): `fastapiBreaker` (130s backstop, 50% failure over 5 calls, 30s reset; `httpFailure()` counts only 5xx/network so 402 spend-cap rejects don't trip it); `sarvamBreaker` (15-20s timeout). In-process per-instance (not fleet-shared).
- **Rate limiting:** Redis sliding window (chat 30/min, scan 100/min, voice 15/min), fail-closed in prod.
- **PII log filter** (`security/pii.py`), request-id/user-id contextvars, structured logs tagged with request_id/user_id/tier/stage/model/cost.
- **Retry/backoff** (`llm_dispatch._with_retry`): retries `{429,500,502,503,504}` + timeouts, max 2, exp backoff cap 8s, honors `Retry-After`; config errors (400/401/403) fail fast.

---

## 8. Proprietary assets for an in-house model

These are all **small, in-code, PR-diffable Python dicts (no DB, no embeddings)** — directly reusable as a class set / label normalizer / grounding tables for an in-house model.

| Asset | Size / contents | File |
|---|---|---|
| Crop-disease catalog (seed) | 70 crops / 360 curated disease+pest entries (ICAR/AICRP, CABI, EPPO, PlantVillage) | `data/crop_disease_catalog.py` |
| **Whitelist ballot (label space)** | **75 crops / 441 entries (incl. "Healthy")** after folding in 38 PlantVillage labels + 22 KB label-claims | `data/crop_disease_whitelist.py` (`WHITELIST_VERSION='1'`) |
| Disease synonyms | 94 synonyms → 42 canonical names; 18 crop-scoped binomial overrides; 9 guarded generics | `data/disease_synonyms.py` |
| Disease lexicon (Indic names) | **Only 8 diseases, only hi+mr populated** (starter set; docstring overstates coverage) | `data/disease_lexicon.py` |
| Agro-climatic zones | 15 ICAR zones; 37 state/UT mappings; 16 district overrides | `data/agro_zones.py` |
| Severity enum | 4 levels + 19 aliases; unknown→Moderate | `data/severity.py` |
| Central banned actives | 52 (–90 per one doc) banned/restricted actives w/ scope/since/reason | `safety/chemicals.py` (`2026.06.06-r2`) |
| Registered actives | 31 CIB&RC actives (FRAC/IRAC, PHI, REI, pollinator, brand aliases; 5 biologicals) | `safety/chemicals.py` |
| State bans | 14 records across Kerala/Sikkim/Maharashtra/Punjab/AP (crop-scoped, time-bounded) | `data/state_bans.py` (`2026.05.28-sb-r1`) |
| Structured KB | 22 label-claims, 5 cultural-practice sets, 5 ETL, 13 MRL, 4 regulatory notes | `rag/knowledge_base.py` |
| Prompts | `diagnose.v2.md` (16.8 KB), `treatment.v1.md`, `diagnose.v1.md` (eval) | `agents/prompts/` |
| Golden set | **EMPTY manifest**; one realized 100-row textbook benchmark | `data/golden_set/manifest.jsonl`, `eval/reports/book_dataset/` |
| Local classifier | ONNX MobileNetV2 / PlantVillage 38-label list embedded | `models/local_classifier.py` |
| Persisted scans | `ai_scan_diagnoses` (29 cols + JSONB payload, image **hashes** only — no bytes) | Postgres |

**Manifest/training-data contract** (`eval/golden_runner.py:12-24`): `{id, image_paths[], params{crop_name,...,tier,language}, ground_truth{disease, scientific_name, severity}}`.

---

## 9. Requirements & constraints for the in-house LLM agent

Distilled from everything above. An in-house agent (or model suite) must satisfy:

**Capabilities**
1. **Vision** — diagnose crop disease from a single leaf photo, constrained to a **441-entry per-crop ballot**, emitting structured JSON (primary diagnosis, differentials w/ probabilities, pathogen_type, confidence, severity, weather_correlation). Reliable JSON is mandatory (no schema validator downstream).
2. **Multilingual text** — agronomy chat + spoken-style voice replies **directly in ~11 Indian languages + English** (`hi, mr, ta, te, kn, gu, pa, bn, ml, or, en`). For voice, no separate translation step (model replies in target language).
3. **Structured treatment generation** — IPM plans grounded in the RAG label-claim matrix (the LLM is a *thin formatter* over a structured dict; this is the **easiest component to in-source**).
4. **(Optional) STT/TTS** — to replace Sarvam for voice; or keep Sarvam and only in-house the LLM.

**Safety / compliance (NON-NEGOTIABLE, mostly downstream & deterministic)**
5. Must emit fields the deterministic safety layer consumes: confidence, severity, OOD/crop-mismatch signals, disease name (snappable to canonical), structured chemical recommendations. The banned-chemical/state-ban/off-label/PHI/REI guards (`safety/validator.py`, `safety/policy.py`, `safety/chemicals.py`, `data/state_bans.py`) run *after* the model and stay in place.
6. **Preserve "fail loud, don't silently degrade"** on the diagnose path — no weaker-model fallback.

**Cost / latency / ops**
7. Low cost (the whole point); the Express credit ledger + FastAPI USD cap assume a `(model, input_tokens, output_tokens) → cost` price row. An in-house model needs a `_PRICING` row (possibly a self-hosted compute cost or $0) and **must return `token_info` so the credit ledger meters correctly**.
8. Latency budgets: chat 100s (FastAPI) under Express 120s; voice 55s (FastAPI) under native ~60s OkHttp ceiling; diagnosis 240s orchestrator / 300s Celery hard.
9. **"Offline-ish":** the existing ONNX local classifier and expo-speech OS-TTS show an appetite for on-device/on-prem inference. An OpenAI-compatible self-hosted endpoint (vLLM/TGI/Ollama) is the natural target.

**Contracts it must satisfy (so the swap is invisible upstream)**
10. `(raw_text, token_info{model,input_tokens,output_tokens,total_tokens,cost_usd})` return contract.
11. The flat diagnosis shape `flattenFastAPIDiagnosis` expects (mobile `DiagnosisResultScreen`), and the report dict shape `orchestrator.run_diagnosis` returns (with `meta.model_diagnose`, `meta.confidence_score`, `meta.pipeline_token_usage.agents`).
12. The chat response shape `{reply, type, structured_data, token_info, followUps}`.

---

## 10. Abstraction seams (where an in-house model plugs in)

**PRIMARY SEAM — `fastapi/agents/llm_utils.py`**
The ONLY place a raw LLM HTTP request is built and a response parsed. Add `call_local_text` / `call_local_vision` siblings returning the same `(raw_text, token_info)` tuple. An in-house model that emits Gemini-shaped `(text, usage)` here flows to **every feature unchanged**. Base URLs are hardcoded here (`_GEMINI_BASE`, `_GROQ_BASE`, `_OPENAI_BASE`, lines 43-45) — add a local base.

**HARD GATE — `fastapi/agents/llm_dispatch.py:_detect_provider` (lines 107-116)**
Currently raises `ConfigError` on any non-`gemini-` id. Add an `'inhouse'`/`'local'` branch (and a `local-*` / `self-*` model-id prefix), then route in `call_llm_text` / `call_llm_vision` to the new helper. `FeatureConfig.base_url` (line 94) already exists — make it non-vestigial.

**CHAIN PATH — `fastapi/agents/registry.py` + `agents/router.py`**
For the vision-diagnose/ensemble path (which uses `router`, not `llm_dispatch`): register the in-house model in `MODEL_CATALOG` (provider, capabilities, api_key), add it to `STAGE_TIER_CHAINS`, add `provider=='inhouse'` adapters in `router._call_one_text/_call_one_vision`. NOTE: `_detect_provider` in the dispatcher path is the blocker; the registry path needs its own provider mapping.

**PRICING — `fastapi/agents/llm_utils.py:_PRICING` + `_calc_cost`**
Add a `$0` (or compute-cost) row for the in-house model id, else `_calc_cost` uses the Flash fallback price.

**HTTP POOL — `fastapi/services/http_clients.py`**
Add `get_inhouse()` pooled `httpx.AsyncClient` pointed at the self-hosted base URL (mirror `get_gemini/get_groq/get_openai`).

**VISION (in-house, already exists) — `fastapi/models/local_classifier.py:classify`**
An on-prem ONNX vision seam already producing a soft prior. Promote prior→primary by wiring its output into the diagnosis result when LLMs fail.

**SPECIALISTS — `fastapi/agents/specialists/`**
Drop a fine-tuned per-crop in-house model here and it votes in the ensemble automatically (designed for exactly this).

**PROMPTS — `fastapi/agents/prompt_registry.py`** (no change needed)
Provider-agnostic versioned `.md` text; an in-house model gets its own prompt variant via the A/B mechanism without code changes.

**TREATMENT GROUNDING — `fastapi/rag/knowledge_base.retrieve`**
Any treatment generator must consume this structured dict; the LLM is a thin formatter, so the treatment model is the easiest to in-source.

**VOICE STT/TTS (Express) — `backend/src/services/sarvam.service.js`**
`sarvamSTT` (line 82) and `sarvamTTS` (line 128) are the single STT/TTS call sites. Replace bodies to hit an in-house Whisper/Conformer (STT) and VITS/Indic-TTS (TTS); callers only need `{transcript, languageCode}` and `{audio, mimeType}`. Env stubs `AI_VOICE_STT_MODEL`/`AI_VOICE_STT_API_KEY` already anticipate this.

**TRANSLATION — `sarvam.service.js:sarvamTranslate` (line 174) & `fastapi/services/sarvam_translator.py:_translate_one`**
Two independent call sites for an in-house Indic MT model (not on the live voice path).

**NETWORK SEAM — `backend/src/utils/fastapi-signed.js` + `fastapi/security/auth.py`**
An in-house inference service can sit behind the same `/ai/chat` and `/ai/scan` signed envelope and the same response shapes with **zero Express changes**; or repoint `AI_BACKEND_URL`. The HMAC contract must stay in lockstep with `fastapi/security/auth.py`.

**RESPONSE ADAPTERS — `backend/src/services/ai.scan.fastapi.js:flattenFastAPIDiagnosis` / `extractUsage`**
A new provider only needs to emit the same flat diagnosis shape (or be adapted here) to stay invisible to the mobile screen.

---

## 11. Open questions & decisions to discuss with the LLM design partner

These are the concrete questions to put to Claude Chat when designing the in-house agent:

1. **Build strategy per capability:** For each of {vision diagnosis, multilingual chat/treatment text, STT, TTS}, should CropSetu **self-host open weights**, **fine-tune**, **distill from the current Gemini outputs**, or **keep a hybrid** (in-house primary + hosted escape hatch)? The diagnose path's "no fallback / fail loud" contract argues for high in-house accuracy before cutover.

2. **Vision model choice:** Given a **441-class, 75-crop** Indian-crop ballot and only a tiny realized eval set (PlantVillage covers ~14 crops; the textbook benchmark is 100 images, ~32% top-1 strict on hosted Gemini today), what vision approach is realistic? A fine-tuned VLM that reads the candidate ballot prompt? A classifier (extending the existing ONNX MobileNetV2) feeding a small VLM? How do we get labeled images for the **minor Indian crops with no public dataset**?

3. **Multilingual text serving:** One model for all ~11 Indian languages + English, or per-language adapters? Must reply *directly* in the target language for voice (no MT step). What open-weights base has the best Indic coverage + agronomy reliability + JSON discipline?

4. **Serving stack:** vLLM / TGI / Ollama (OpenAI-compatible) vs a custom server? An **OpenAI-compatible endpoint** drops in cleanest (clone `call_groq_text`, point a new base at the local endpoint). What GPU footprint/quantization for the cost targets, and can any of this run "offline-ish" / on-prem near the farmer?

5. **Structured-output reliability:** There is **no schema validator** on LLM output (only `extract_json` + ad-hoc checks). Should we add constrained/grammar-based decoding (e.g. JSON schema / GBNF) on the in-house model to guarantee the diagnosis/treatment JSON contract? This is a strong argument for self-hosting.

6. **Embeddings for RAG:** The KB is deliberately structured/non-vector today ("dosage hallucination, not recall"). Does an in-house model change that calculus — is embedding RAG now worth it for the **chat** path (which has *no* retrieval at all, only a farm-profile prompt)?

7. **STT/TTS replacement for Sarvam:** In-house Whisper/Conformer (STT) + VITS/Indic-TTS (TTS) for ~11 Indic languages — feasible quality vs Sarvam's `saaras:v3`/`bulbul:v3`? Or keep Sarvam and only in-house the LLM first? Note the existing free **expo-speech** on-device fallback.

8. **Cost model & metering:** With self-hosted compute, what `_PRICING` semantics make sense (amortized GPU cost per 1K tokens?) so the **Express credit ledger** and **FastAPI USD cap** keep working? The model must still emit `token_info`.

9. **Eval-driven rollout:** The golden set is empty. What's the plan to (a) build a labeled golden image set from the textbook dataset + field scans, (b) run the in-house model through `golden_runner.py` against the hosted Gemini baseline (top-1/top-3/Brier/severity/cost/latency), and (c) shadow/A-B via the prompt-registry bucketing before cutover?

10. **Two-dispatcher + provider-gate refactor:** Should we first **consolidate** the flat `llm_dispatch` and chain `router`+`registry` paths and make `base_url`/provider-detection first-class, so an in-house model needs *one* integration point instead of several? What's the minimal diff?

11. **Safety invariants to preserve:** Confirm the in-house model's outputs carry all signals the deterministic safety layer needs (confidence, OOD, crop-mismatch, severity, snappable disease name, structured actives) so the banned/off-label/state-ban/PHI guards keep working unchanged.

12. **Ensemble/specialists:** Is a **per-crop specialist** model suite (slotting into `agents/specialists/`) a better in-house strategy than one big model, given the ensemble infrastructure already exists (just OFF)?

---

## 12. Appendix

### 12.1 Route / file map

**Express (Tier 2):**
- `backend/src/routes/ai.routes.js` — all `/api/v1/ai/*` (chat 332, voice 542, tts 740, translate 768, scan submit/poll ~1020-1079, scan follow-up 1574)
- `backend/src/utils/fastapi-signed.js` — `postSignedJSON`/`getSigned`/`callFastAPI` (single egress)
- `backend/src/services/aiCredit.service.js` — credit ledger
- `backend/src/services/ai.scan.fastapi.js` — scan client + `flattenFastAPIDiagnosis`
- `backend/src/services/sarvam.service.js` — STT/TTS/translate
- `backend/src/services/claude.service.js` — schemes Q&A (Gemini under the hood)
- `backend/src/routes/cropdisease.routes.js` — LEGACY direct-Gemini predict

**FastAPI (Tier 3):**
- `fastapi/main.py` — app factory, 6 routers, health endpoints
- `fastapi/routes/scan.py` — `POST /ai/scan`, `GET /ai/scan/{job_id}`
- `fastapi/routes/chat.py` — `POST /ai/chat`
- `fastapi/orchestrator.py` — `run_diagnosis` (5-stage pipeline, lines 133-582)
- `fastapi/jobs/tasks.py` — Celery `run_diagnosis_task`
- `fastapi/agents/llm_dispatch.py` — flat dispatcher + `_detect_provider`
- `fastapi/agents/llm_utils.py` — raw HTTP + `_PRICING`
- `fastapi/agents/router.py` + `registry.py` — chain dispatcher
- `fastapi/agents/disease_diagnosis_agent.py`, `treatment_agent.py`, `ensemble_agent.py`, `reconciler.py`, `report_generator_agent.py`
- `fastapi/services/chat_service.py` — `chat_with_farmmind`
- `fastapi/safety/{validator,policy,chemicals,compliance,cross_verify,visual_verify}.py`
- `fastapi/rag/knowledge_base.py`
- `fastapi/models/local_classifier.py`
- `fastapi/eval/*` — golden/load/replay/book-dataset runners

**Registered FastAPI surface (all `/ai/*` and `/agripredict/*` behind `verify_signed_request`):**
`POST /ai/chat`, `POST /ai/scan`, `GET /ai/scan/{job_id}`, `POST /api/v1/crop-disease/agentic-predict` (400 deprecation stub), `POST /ai/soil-card-ocr`, `POST /ai/scan/{report_id}/feedback`, `POST /ai/alerts`, `POST /agripredict/predict`, `GET /health`, `GET /health/details`.

### 12.2 Key environment variables

| Var | Purpose |
|---|---|
| `GEMINI_API_KEY` | Sole production LLM key (required in prod) |
| `AI_<FEATURE>_MODEL` / `_API_KEY` / `_BASE_URL` | Per-feature override (`base_url` vestigial today); features: TEXT_CHAT, CHAT_WRITER, CHAT_ENHANCER, CHAT_VISION, SOIL_OCR, CROP_DIAGNOSE, CROP_TREATMENT, ALERT, PEST |
| `GROQ_API_KEY` / `GROQ_FALLBACK_MODEL` | Optional chat fallback (`llama-3.3-70b-versatile`) |
| `OPENAI_API_KEY` / `OPENAI_DIAGNOSE_MODEL` | Optional ensemble vision voter (`gpt-4o`) |
| `SARVAM_API_KEY` | Voice STT/TTS/translate + report translation |
| `ENABLE_ENSEMBLE` | Multi-model diagnose fan-out (default `false`) |
| `LOCAL_CLASSIFIER_MODEL_PATH` | Enables the ONNX local classifier prior |
| `AI_SHARED_SECRET` | Express↔FastAPI HMAC secret (required in prod) |
| `DATABASE_URL` | Postgres (shared) |
| `REDIS_URL` | Celery broker (db1), idempotency, spend cap, caches |
| `DAILY_SPEND_CAP_USD` | FastAPI secondary cost ceiling (default 1.00 / 0.10 anon) |
| `USE_FASTAPI_FOR_SCAN` | Route scans to FastAPI vs legacy in-Express path |
| `AI_BACKEND_URL` | FastAPI base URL (default localhost:8001) |
| `AI_DIAGNOSE_VERSION` | Pin diagnose prompt version for eval |
| `PIPELINE_DEFAULT_TIER`, `ENSEMBLE_ESCALATE_BELOW` (0.80), `DIAGNOSIS_ESCALATE_BELOW` (0.50) | Pipeline tuning |

### 12.3 Glossary of CropSetu domain terms

| Term | Meaning |
|---|---|
| **FarmMind** | The conversational AI advisor (text + voice chat) |
| **CropGuard / Dr. KrishiGuard** | The crop-disease diagnosis agent / its diagnose persona |
| **IPM** | Integrated Pest Management — the structured treatment plan output |
| **CIB&RC** | Central Insecticides Board & Registration Committee (India) — authority on registered/label-claim pesticides |
| **Label-claim** | The legally-registered (crop, disease) → active matrix; recommending outside it is illegal (Insecticides Act 1968) |
| **FRAC / IRAC** | Fungicide / Insecticide resistance-action group codes (for rotation) |
| **PHI / REI** | Pre-Harvest Interval / Re-Entry Interval (safety clamps) |
| **MRL (FSSAI)** | Maximum Residue Limit |
| **ETL** | Economic Threshold Level (monitor-first gate before chemicals) |
| **Agro-climatic zone** | One of 15 ICAR zones used to key the RAG grounding |
| **OOD** | Out-of-distribution (image not a recognizable crop leaf) |
| **Ballot / whitelist** | The per-crop candidate-disease list constraining diagnosis (75 crops / 441 entries) |
| **Sarvam** | Third-party Indic STT/TTS/translation provider |
| **Tier (fast/best)** | Latency-vs-accuracy preference; influences model/ensemble selection |
| **needs_rescan / service_unavailable** | Short-circuit reports (unusable image / provider down) — NOT charged |
| **Credit ledger** | Express Postgres `AICredit`/`AICreditTransaction` — authoritative per-user budget |

### 12.4 Honesty ledger — known unknowns & stale docs

- **Stale Anthropic/Claude references:** `fastapi/docs/ARCHITECTURE.md` describes a Gemini+Claude stack and an ensemble with `claude-sonnet-4-6`; `claude.service.js` and ledger keys say "claude"; `@anthropic-ai/sdk` and `anthropic` package are installed. **None are on the live path.** Anthropic was fully removed; live config is Gemini-only. The two architecture docs **contradict each other** (ARCHITECTURE.md = Gemini+Claude; Diagnosis.md = Gemini-only); trust `get_feature_config`, not the prose.
- **Doc says "Pro", config says "Flash":** diagnose/treatment docstrings reference `gemini-2.5-pro`, but the live `_DEFAULTS` is `gemini-2.5-flash` for both.
- **Stale memory note:** "chat has no model fallback" is wrong — chat has Flash↔Pro + Groq fallback layers.
- **Sarvam model-id mismatches** (STT `saaras:v3` vs docstring `saarika:v2`; TTS `bulbul:v3` vs comment `bulbul:v1`).
- **Exact runtime model ids for FastAPI-brokered calls** are whatever FastAPI returns in `token_info.model` / `meta.model_diagnose`; not pinned in the repo subset read. The Sarvam translate model id and exact runtime `AI_*_MODEL` env values were **not read from `.env`**.
- **Empty golden set;** single small realized benchmark; `disease_lexicon.py` only 8 diseases / 2 languages.
- **Whether `GROQ_API_KEY` / `OPENAI_API_KEY` / `ENABLE_ENSEMBLE` are set in production** is unknown (determines whether fallbacks/ensemble are live).
- Some safety-registry counts differ between readers (e.g. "52" vs "~90" banned actives) — treat as authoritative-but-versioned, verify against the in-code `REGISTRY_VERSION`.
```

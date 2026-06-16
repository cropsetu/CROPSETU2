# WI-11 — AI model routing (per-request provider selection)

Makes the admin **AI Models** dropdowns (`ai.model.*` settings) actually route AI
traffic to Gemini / OpenAI / **Claude (Anthropic)** / Groq, instead of only storing
the selection.

Status: **merged to `main`** (PR #27 FastAPI provider layer + per-request override,
PR #28 Express forwarding). Routing is live once the FastAPI service deploys `main`
and the relevant provider API keys are set on it.

---

## Provider layer (`fastapi/`)

The dispatch routes by model-id prefix.

| File | Change |
|---|---|
| `fastapi/agents/llm_dispatch.py` | `_detect_provider` → `gemini-*`/`gpt-*`/`claude-*`/`llama-*`(+`mixtral-*`); `get_feature_config(feature, model_override)` resolves the **provider-appropriate API key** (`GEMINI_/OPENAI_/ANTHROPIC_/GROQ_API_KEY`) and raises a clear `ConfigError` when that key is unset; `call_llm_text` + `call_llm_vision` dispatch the primary call to the detected provider (Gemini keeps its Flash↔Pro + Groq fallback chain; others call direct; Groq is rejected for vision). |
| `fastapi/agents/llm_utils.py` | `call_anthropic_text` + `call_anthropic_vision` (official `anthropic` SDK / `AsyncAnthropic` — system as `system=`, content blocks, `usage.input_tokens/output_tokens`, **no `temperature`** since Opus 4.8/4.7 400 on it); `call_openai_text` + `call_openai_vision` (raw httpx, OpenAI-compatible); `_PRICING` rows for `gpt-4o`/`gpt-4o-mini`/`claude-opus-4-8`/`claude-sonnet-4-6`/`claude-haiku-4-5`/`llama-3.3-70b`. |
| `fastapi/config.py` | reads `GEMINI_/OPENAI_/ANTHROPIC_/GROQ_API_KEY`. |
| `fastapi/requirements.txt` | `anthropic>=0.49`. |

---

## Per-request override (done)

The admin `ai.model.*` setting drives the model **per request**, not just via env.

- **FastAPI** — `get_feature_config(feature, model_override)` honours a forwarded
  model; threaded through `routes/chat.py`, `routes/soil_ocr.py`,
  `services/chat_service.py`, `services/soil_ocr_service.py`,
  `agents/disease_diagnosis_agent.py` (`model_diagnose`),
  `agents/treatment_agent.py` (`model_treatment`). The scan path carries the
  override inside `params` through the enqueue → Celery → orchestrator hop.
- **Express** — `ai.routes.js` reads `ai.model.chat` / `ai.model.diagnose` /
  `ai.model.treatment` / `ai.model.soilOcr` / `ai.model.voiceStt` via `getSetting()`
  and forwards them per request (`body.model`, `params.model_diagnose`,
  `params.model_treatment`, …), 60s-cached and fail-safe.

## Coverage

| | Gemini | OpenAI | Anthropic | Groq |
|---|:---:|:---:|:---:|:---:|
| **Chat / treatment (text)** | ✅ | ✅ | ✅ | ✅ |
| **Diagnosis / soil-OCR (vision)** | ✅ | ✅ | ✅ | ❌ no vision |

## Guards (added on `feat/ai-ux-robustness-and-voice`)

- **Vision dropdowns are filtered** — `ai.model.diagnose` / `ai.model.soilOcr` only
  offer vision-capable models (Groq's Llama is excluded), so a non-vision model can't
  be picked for a vision feature and hard-fail the call.
- **Missing-key error** — selecting a provider whose key isn't set returns a clear
  `ConfigError` ("set `<PROVIDER>_API_KEY` …") instead of an opaque upstream 401.
- The voice STT setting (`ai.model.voiceStt`, `sarvam:*`) is not an LLM — it routes
  in the voice STT path, not `llm_dispatch`.

## Deploy notes

- Set the provider keys on the **FastAPI** service env (`OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `GROQ_API_KEY`); Gemini works with the existing key.
- Verify the resolved `anthropic` version pins cleanly against `jiter==0.14.0`.

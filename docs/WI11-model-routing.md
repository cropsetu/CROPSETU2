# WI-11 — AI model routing (per-request provider selection)

Makes the admin **AI Models** dropdowns (WI-1 `ai.model.*` settings) actually route
AI traffic to Gemini / OpenAI / **Claude (Anthropic)** / Groq, instead of only
storing the selection.

Branch: `feat/ai-model-routing` (off `main`). **Not merged / not deployed** — this
touches the FastAPI AI service; review + deploy on your schedule.

---

## ✅ Done in this branch — the provider layer

The FastAPI dispatch was Gemini-only (`_detect_provider` rejected non-`gemini-*`
ids; `call_llm_text/vision` always called Gemini). Now it routes by model-id prefix.

| File | Change |
|---|---|
| `fastapi/agents/llm_dispatch.py` | `_detect_provider` → `gemini-*`/`gpt-*`/`claude-*`/`llama-*`(+`mixtral-*`); `get_feature_config` resolves the **provider-appropriate API key** (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GROQ_API_KEY`, not always `GEMINI_API_KEY`); `call_llm_text` + `call_llm_vision` dispatch the **primary** call to the detected provider (Gemini keeps its Flash↔Pro + Groq fallback chain; others call direct). |
| `fastapi/agents/llm_utils.py` | New `call_anthropic_text` + `call_anthropic_vision` (**official `anthropic` SDK / `AsyncAnthropic`** — system as `system=`, content blocks, `usage.input_tokens/output_tokens`, **no `temperature`** since Opus 4.8/4.7 400 on it); new `call_openai_text`; `_PRICING` rows for `claude-opus-4-8`/`claude-sonnet-4-6`/`claude-haiku-4-5`. |
| `fastapi/config.py` | `ANTHROPIC_API_KEY`. |
| `fastapi/requirements.txt` | `anthropic>=0.49` (its deps — httpx/jiter/distro/anyio/sniffio/pydantic — were already pinned). |

**This alone enables provider switching via env today:** e.g.
`AI_CROP_DIAGNOSE_MODEL=claude-opus-4-8` + `ANTHROPIC_API_KEY=…` routes scan
diagnosis to Claude. Verify the resolved `anthropic` version pins cleanly against
`jiter==0.14.0` (pin it exactly once `pip install` resolves it).

---

## ⬜ Remaining — the per-request AppSetting override (mechanical)

So the admin `ai.model.*` setting (not just env) drives the model per request.

**1. FastAPI — accept an optional model + thread it down**

- `llm_dispatch.get_feature_config(feature, model_override: str | None = None)`:
  when `model_override` is truthy, use it as `model` (still resolve the
  provider-appropriate key from it). One-line change at the `model = …` resolution.
- `routes/chat.py` (`POST /ai/chat`): read `body.get("model")`, pass to
  `chat_with_farmmind(..., model_override=...)`.
- `routes/scan.py` (`POST /ai/scan` / enqueue): read `body.get("model_diagnose")` /
  `body.get("model_treatment")`, thread into the diagnosis/treatment configs.
- `services/chat_service.py` + `orchestrator.py`: add `model_override` params and
  pass to their `get_feature_config(...)` calls (writer/vision/voice; diagnose/
  treatment). These are the call sites that resolve the FeatureConfig.

**2. Express — read the setting + forward it per request**

- `backend/src/routes/ai.routes.js` chat handler: `const model = await getSetting('ai.model.chat').catch(()=>null);` → add `...(model ? { model } : {})` to the FastAPI `/ai/chat` payload. Same for voice (`ai.model.voiceStt`).
- `backend/src/routes/ai.routes.js` `/scan/submit` + `backend/src/services/ai.scan.fastapi.js` `submitFastAPIScan`: read `ai.model.diagnose` / `ai.model.treatment`, add `model_diagnose` / `model_treatment` to the FastAPI body.
- Import: `import { getSetting } from '../services/settings.service.js';`

**3. Caveats**

- Vision features (diagnose/treatment/soilOcr) require a **vision-capable** model —
  `llama-*` (Groq) has no vision; the dispatch raises a clear `ConfigError`. The
  admin dropdown lets a user pick a non-vision model for a vision feature; consider
  filtering the options per feature, or rely on the runtime error.
- The voice STT setting (`ai.model.voiceStt`, e.g. `sarvam:*`) is **not** an LLM —
  it routes in the voice STT path, not `llm_dispatch`. Wire it separately if needed.
- Stale "Gemini-only" wording remains in a couple of `llm_dispatch.py` comments —
  cosmetic.

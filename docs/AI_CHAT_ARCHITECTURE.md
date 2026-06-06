# CropSetu / FarmMind — AI Chat Architecture

End-to-end architecture of the **AI Text Chat** and **AI Voice Chat** features, covering the React Native client, the Node.js/Express gateway, and the FastAPI AI service. Every section links to the exact source file and line.

> **TL;DR:** The mobile app talks only to Express. Express handles auth, credits, persistence, and speech (Sarvam STT/TTS), then forwards a clean text request to a **stateless** FastAPI service that does all LLM orchestration. FastAPI never talks to the app and is reachable only by Express via an HMAC-signed request.

---

## Table of contents

1. [Topology](#1-topology)
2. [AI Text Chat — full flow](#2-ai-text-chat--full-flow)
3. [AI Voice Chat — full flow](#3-ai-voice-chat--full-flow)
4. [The FastAPI agentic pipeline](#4-the-fastapi-agentic-pipeline)
5. [LLM dispatch & providers](#5-llm-dispatch--providers)
6. [Text vs Voice — differences](#6-text-vs-voice--differences)
7. [Cross-cutting systems](#7-cross-cutting-systems)
8. [Error handling & status codes](#8-error-handling--status-codes)
9. [Environment / config reference](#9-environment--config-reference)
10. [File map](#10-file-map)

---

## 1. Topology

```
┌─────────────────────────┐    HTTPS / JSON     ┌──────────────────────────┐   HMAC-signed    ┌─────────────────────────┐
│   FRONTEND               │   Bearer JWT        │   NODE.JS / EXPRESS       │   HTTP / JSON    │   FASTAPI (Python)      │
│   React Native (Expo)    │ ──────────────────► │   "BFF" / gateway         │ ───────────────► │   AI brain (stateless)  │
│                          │                     │   :3001/api/v1            │   :8001          │                         │
│  AIChatScreen            │ ◄────────────────── │  - auth (JWT)             │ ◄─────────────── │  - LLM dispatch         │
│  VoiceChatScreen         │   reply (+ audio)   │  - credits & rate limit   │   reply + tokens │  - Writer → Enhancer    │
│  aiApi.js / api.js       │                     │  - Sarvam STT / TTS       │                  │  - vision / voice path  │
│                          │                     │  - Prisma persistence     │                  │  - follow-up suggester  │
└─────────────────────────┘                     └──────────────────────────┘                  └─────────────────────────┘
                                                          │                                            │
                                                          ▼                                            ▼
                                                   PostgreSQL (Prisma)                       Gemini · Groq · Claude · Sarvam
                                                   conversations · messages ·
                                                   credits · transactions
```

**Three load-bearing design decisions**

| Decision | Why |
|---|---|
| FastAPI is **stateless** (no conversation memory) | Express owns history in Postgres and sends the last 20 turns on every call. Lets the AI service scale/restart freely. |
| FastAPI is **headless** (app never calls it directly) | Every Express→FastAPI request is signed with `HMAC-SHA256(secret, ts + method + path + sha256(body))`. Contract kept in lockstep between `backend/src/utils/fastapi-signed.js` and `fastapi/security/auth.py`. |
| LLM choice is **feature-based** | Each feature (`CHAT_WRITER`, `CHAT_ENHANCER`, `CHAT_VISION`, …) picks its own model/key via env; provider is auto-detected from the model name. No hidden fallback chain. |

---

## 2. AI Text Chat — full flow

### Sequence

```
User types ─► AIChatScreen.sendMessage()
                 │  (6s cooldown, language auto-detect, optimistic bubble)
                 ▼
            aiApi.sendChatMessage()  ── POST /ai/chat (JSON, Bearer JWT) ─►  Express
                                                                              │
   ┌──────────────────────────────────────────────────────────────────────┘
   ▼  ai.routes.js  (authenticate → aiChatLimit)
   1. verify JWT (user active, tokenVersion matches)
   2. validate (msg ≤1000 chars; image ≤12MB, image/*)
   3. 6s server cooldown  ───────────────────────────────► 429
   4. credit pre-check (ai_chat_groq=1 / ai_scan_gemini=3) ► 402
   5. find/create AIConversation
   6. fetch last 20 messages from Postgres
   7. buildEnrichedProfile() (crops, soil, cycles, location)
   8. callFastAPI('/ai/chat', {...}, userId, 120s) ──────────────────────►  FastAPI
                                                                              │
   ┌──────────────────────────────────────────────────────────────────────┘
   ▼  chat.py → chat_with_farmmind() → _agentic_text_reply()
   Writer (draft) ─► Enhancer (fact-check rewrite) ─► Follow-ups (separate JSON call)
                                                                              │
   ◄──────── { reply, type, structured_data:null, token_info, followUps } ───┘
   9. persist user + assistant messages, bump messageCount
  10. deductCredits() (fire-and-forget, ceil(tokens/1000))
  11. respond { success, data:{ reply, conversationId, followUps, tokenUsage } }
   │
   ▼
AIChatScreen renders AI bubble + follow-up chips (saves conversationId on first message)
```

### ① Client send — `sendMessage()`
[frontend/src/screens/AI/AIChatScreen.js:615](../frontend/src/screens/AI/AIChatScreen.js#L615)

- **6-second client cooldown** via `lastSentAt` ref.
- **Language resolution** — `resolveMsgLang()` ([AIChatScreen.js:571](../frontend/src/screens/AI/AIChatScreen.js#L571)): when `chatLanguage === 'auto'`, runs `detectLanguage()` which counts Indic Unicode-block frequencies. Devanagari is shared by Hindi & Marathi, so it tie-breaks on the app UI language.
- Optimistically appends the user bubble and sets `typing = true`.

### ② API call — `sendChatMessage()`
[frontend/src/services/aiApi.js:27](../frontend/src/services/aiApi.js#L27)

```http
POST {API_BASE_URL}/ai/chat          # e.g. http://localhost:3001/api/v1/ai/chat
Authorization: Bearer <accessToken>  # injected by axios interceptor (api.js)
Content-Type: application/json

{
  "message": "…",
  "conversationId": null,             // null on first turn
  "farmProfile": { … },
  "includeFarmContext": true,
  "language": "hi",                   // "en" | "hi" | "mr" | …
  "responseLength": "short",          // short | medium | long | extra_long
  "image": { "data": "<base64>", "mime_type": "image/jpeg" }  // or null
}
```

The shared axios client ([api.js](../frontend/src/services/api.js)) attaches the Bearer token, adds `X-CSRF-Token` on web mutations, and **auto-refreshes on 401** (POST `/auth/refresh`, then replays the original request once).

### ③ Express handler
[backend/src/routes/ai.routes.js:330](../backend/src/routes/ai.routes.js#L330) — chain `authenticate → aiChatLimit`

1. **Auth** ([auth.js:27](../backend/src/middleware/auth.js#L27)) — verifies JWT, confirms user exists/active and `tokenVersion` matches (a phone change bumps `tokenVersion`, invalidating old tokens). Sets `req.user = { id, role }`.
2. **Validation** — message ≤ 1000 chars; image `image/*` and ≤ 12 MB; message-or-image required.
3. **Server cooldown** — 6s gap per user (`lastAiCall` Map) → `429`.
4. **Credit pre-check** — `ai_scan_gemini` (floor 3) if image present, else `ai_chat_groq` (floor 1) → `402`.
5. **Conversation** — find by `conversationId` or create (title = first 40 chars).
6. **History** — last 20 messages (`role`, `content`) from Postgres.
7. **Farm context** — `buildEnrichedProfile()` merges DB profile (crops, soil report, recent harvest cycles, location) with client-supplied values.
8. **Forward** — `callFastAPI('/ai/chat', payload, userId, 120_000)` — **120s timeout** for slow Indic-language generations.

### ④ Reply returns
- Persists **two** messages (user + assistant), increments `messageCount`.
- **Deducts credits** fire-and-forget ([ai.routes.js:438](../backend/src/routes/ai.routes.js#L438)) — `max(floor, ceil(tokensUsed / 1000))`.
- Returns `{ success, data: { reply, type, card, conversationId, followUps, tokenUsage } }`.

### ⑤ Client renders
- Saves `conversationId` on the first turn.
- Appends the AI bubble tagged with `lang` (so the "Listen" button uses the right voice) and renders follow-up chips.

> **No streaming.** Each chat call is one synchronous request/response — the full reply arrives at once. There is no SSE/WebSocket path.

### "Listen" (TTS inside text chat)
[frontend/src/services/aiApi.js:434](../frontend/src/services/aiApi.js#L434) → `POST /ai/tts` → **Sarvam TTS** in Express (not FastAPI). Text is truncated at a sentence boundary near 1000 chars; resulting base64 audio is **cached per-bubble per-language** for instant replays.

---

## 3. AI Voice Chat — full flow

A separate screen ([VoiceChatScreen.js](../frontend/src/screens/AI/VoiceChatScreen.js)) with a holographic-sphere UI, separate DB tables, and server-side STT + TTS.

### Sequence

```
Tap mic ─► startRecording()                         (m4a + metering)
              │  metering → audioLevel (animation) + silence auto-stop (10s @ −45dB)
              ▼
Stop/auto ─► stopAndSend()                          (60s hard cap, 500ms min)
              │
              ▼
        aiApi.sendVoiceChatMessage()  ── POST /ai/voice?tts=1 (multipart) ─► Express
                                          fields: audio, conversationId,        │
                                                  farmProfile(JSON), language    │
   ┌──────────────────────────────────────────────────────────────────────────┘
   ▼  ai.routes.js  (authenticate → aiVoiceLimit → audioUpload.single('audio') 25MB)
   1. Sarvam STT → { transcript, language }   (fallback: Groq Whisper)
   2. credit check (ai_voice = 2)
   3. find/create VoiceConversation            ← separate tables
   4. buildEnrichedProfile()
   5. callFastAPI('/ai/chat', { message:transcript, mode:'voice', … }) ───────► FastAPI
                                                                                  │
   ◄──────────────────── { reply, followUps, token_info } ────────────────────┘
   6. Sarvam TTS(reply) → base64 WAV   (translate first if needed)
   7. persist VoiceMessage rows, deduct ai_voice credit
   8. respond { transcription, detectedLanguage, reply, conversationId, audio }
   │
   ▼
VoiceChatScreen: typewriter-reveal reply + playBase64Audio() (sphere → speaking state)
```

### ① Record — `startRecording()`
[frontend/src/screens/AI/VoiceChatScreen.js:400](../frontend/src/screens/AI/VoiceChatScreen.js#L400)

- `Audio.Recording` (m4a) with **metering enabled**.
- Metering callback drives `audioLevel` (0–1, animates the sphere/waveform) **and auto-stop on silence** (10s below −45 dB). Hard 60s cap; 500 ms minimum discards accidental taps.

### ② Stop & send — `stopAndSend()`
[frontend/src/screens/AI/VoiceChatScreen.js:474](../frontend/src/screens/AI/VoiceChatScreen.js#L474)

- Language hint: `'auto'` → send `null` (Sarvam auto-detects); otherwise the selected language so STT and reply align.

### ③ Upload — `sendVoiceChatMessage()`
[frontend/src/services/aiApi.js:384](../frontend/src/services/aiApi.js#L384)

```http
POST {API_BASE_URL}/ai/voice?tts=1     # ?tts=1 → also synthesize speech for the reply
Authorization: Bearer <token>
Content-Type: multipart/form-data

audio          = <.m4a file>
conversationId = <uuid | omitted>
farmProfile    = <JSON string>
language       = "hi-IN" | null        # null = auto-detect
```

On native this uses `FileSystem.uploadAsync()` (not fetch+FormData) because **Android OkHttp silently drops `file://` URIs** inside a normal FormData body.

### ④ Express orchestration
[backend/src/routes/ai.routes.js:470](../backend/src/routes/ai.routes.js#L470) — chain `authenticate → aiVoiceLimit → audioUpload.single('audio')` (25 MB)

```
audio ─► STT (Sarvam primary → Groq Whisper fallback) ─► transcript
      ─► credit check (ai_voice = 2)
      ─► VoiceConversation lifecycle (SEPARATE tables: VoiceConversation / VoiceMessage)
      ─► buildEnrichedProfile()
      ─► callFastAPI('/ai/chat', { message:transcript, history, farm_profile,
                                    mode:'voice', response_length:'short' })
      ─► TTS (only if tts=1 + SARVAM_API_KEY): translate reply→target lang, Sarvam TTS → base64 WAV
```

The same `/ai/chat` FastAPI endpoint serves voice, but `mode='voice'` routes to a single concise Writer pass (see [§4](#4-the-fastapi-agentic-pipeline)).

### ⑤ Response & playback
Response: `{ transcription, detectedLanguage, reply, conversationId, audio: { audio: base64, mimeType } }`.
Client ([VoiceChatScreen.js:558](../frontend/src/screens/AI/VoiceChatScreen.js#L558)) reveals the reply with a **typewriter effect**, then `playBase64Audio()` plays the WAV via `Audio.Sound` and animates the sphere; on finish it unloads and returns to idle. Empty STT → *"I didn't catch that — try speaking closer to the mic."*

---

## 4. The FastAPI agentic pipeline

Entry: [fastapi/routes/chat.py:15](../fastapi/routes/chat.py#L15) → `chat_with_farmmind()` [fastapi/services/chat_service.py:427](../fastapi/services/chat_service.py#L427)

`chat_with_farmmind()` routes to one of three isolated paths:

```
has_image?  ─► _vision_reply()         1 CHAT_VISION call            + follow-ups
mode=voice? ─► _voice_reply()          1 CHAT_WRITER (spoken style)  + follow-ups
default     ─► _agentic_text_reply()   CHAT_WRITER → CHAT_ENHANCER   + follow-ups
```

### Text path (Writer → Enhancer → Follow-ups)
[chat_service.py:338](../fastapi/services/chat_service.py#L338)

```
 message + history(last 20) + farm_profile + response_length
                       │
 ┌─────────────────────▼──────────────────────┐
 │ STAGE 1 — WRITER (CHAT_WRITER)              │  gemini-2.5-flash · temp 0.3 · 4096 tok
 │  system = senior-agronomist persona         │  → "DRAFT answer"
 │         + FARMER PROFILE block              │
 │         + length directive + language rule  │
 └─────────────────────┬──────────────────────┘
                       │  (if AI_CHAT_ENHANCER_ENABLED=true, the default)
 ┌─────────────────────▼──────────────────────┐
 │ STAGE 2 — ENHANCER (CHAT_ENHANCER)          │  fact-check + rewrite
 │  "improve the draft, fix vague advice"      │  → "FINAL answer"  (non-fatal: draft used on failure)
 └─────────────────────┬──────────────────────┘
                       │
 ┌─────────────────────▼──────────────────────┐
 │ STAGE 3 — FOLLOW-UPS (separate JSON call)   │  → ["When to spray?", …]  (3–5 text / 2–3 voice)
 │  isolated → can NEVER leak into reply text  │
 └─────────────────────────────────────────────┘
```

- **FARMER PROFILE block** ([chat_service.py:192](../fastapi/services/chat_service.py#L192)) personalizes every prompt: farmer name, village/taluka/district/state, season + month, up to 5 active crops (stage/age/area/variety), soil-health report, irrigation, water sources, land size, and up to 3 recent harvest cycles with yield & profit. This is why *"my crops / my soil"* questions work.
- **Response length** ([chat_service.py:45](../fastapi/services/chat_service.py#L45)) is a hard spec injected into the prompt:

  | Value | Spec |
  |---|---|
  | `short` | 60–120 words, no headers |
  | `medium` | 150–280 words, 2–3 bold headers |
  | `long` | 350–550 words, full structure, rainfed vs irrigated, varieties, sources |
  | `extra_long` | 600–900 words, comprehensive, district nuance, economics |

- **Tokens accumulate** across all 3 calls (`_accumulate`); `token_info.model` is the final answer-producing model.
- **Follow-ups are a deliberately separate LLM call** returning a JSON array, so they can never bleed into the reply — verified by [tests/test_chat_followups.py](../fastapi/tests/test_chat_followups.py) (`test_followups_cannot_leak_into_reply`: the reply is returned verbatim even if it literally contains `<<FOLLOWUPS>>` markers).

### Voice path
[chat_service.py:380](../fastapi/services/chat_service.py#L380) — a **single Writer call, no Enhancer**, governed by `_VOICE_DIRECTIVE`: *no markdown, no bullets, 2–4 spoken sentences, < ~90 words* — which **overrides any `response_length`**. Follow-ups capped at 2–3.

### Vision path (general image understanding, NOT disease scan)
[chat_service.py:402](../fastapi/services/chat_service.py#L402) — a single `CHAT_VISION` call that describes the image and answers. `structured_data` is always `null`. Crop **disease diagnosis** is a separate pipeline (`/ai/scan` → `/scan/job/:id` async polling), distinct from chat.

### Request / response schema (`/ai/chat`)
```python
# request
message: str
history: list[dict]          # [{role:"user"|"assistant", content:str}]
farm_profile: dict
response_length: str = "short"
mode: str = "text"           # "text" | "voice"
image: Optional[dict]        # {data:b64, mime_type} | None

# response
{ "success": true,
  "data": { "reply": str, "type": "text", "structured_data": null,
            "token_info": { model, input_tokens, output_tokens, total_tokens, cost_usd, calls },
            "followUps": [str] } }
```

---

## 5. LLM dispatch & providers

[fastapi/agents/llm_dispatch.py](../fastapi/agents/llm_dispatch.py)

- **Feature-based, not provider-based.** Each feature reads `AI_<FEATURE>_MODEL` / `_API_KEY` / `_BASE_URL`; missing values fall back to baked-in defaults.
- **Provider auto-detected** from the model name (a custom `BASE_URL` always wins):

  | Model prefix | Provider | Endpoint |
  |---|---|---|
  | `claude-*` | Anthropic | official AsyncAnthropic SDK |
  | `gemini-*` | Gemini | REST (`x-goog-api-key` header) |
  | `gpt-*`, `o1-*`, `o3-*` | OpenAI-compatible | `api.openai.com/v1` |
  | `llama-*`, `mixtral-*`, `whisper-*` | OpenAI-compatible | `api.groq.com/openai/v1` |
  | `deepseek-*` | OpenAI-compatible | `api.deepseek.com/v1` |
  | `grok-*` | OpenAI-compatible | `api.x.ai/v1` |
  | *(custom `BASE_URL` set)* | OpenAI-compatible | OpenRouter / Ollama / vLLM / private |

- **No fallback chain by design** — if the chosen model fails after retries, the call fails (admin keeps full control). Retries cover transient `429/500/502/503/504` + timeouts only, with exponential backoff (1.5s → 3s → 6s, cap 8s, honoring `Retry-After`).
- **Pooled HTTP clients** per upstream ([http_clients.py](../fastapi/services/http_clients.py)) — Gemini 120s read, Groq 90s, Sarvam 15s; Anthropic SDK pools itself.

**Default model per feature**

| Feature | Default model | Key |
|---|---|---|
| `CHAT_WRITER` / `CHAT_ENHANCER` / `CHAT_VISION` | `gemini-2.5-flash` | `GEMINI_API_KEY` |
| `TEXT_CHAT` (legacy single-pass) | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| `VOICE_STT` | `whisper-large-v3-turbo` | `GROQ_API_KEY` |
| `CROP_DIAGNOSE` / `CROP_TREATMENT` | `claude-haiku-4-5-20251001` | `ANTHROPIC_API_KEY` |
| `ALERT` / `PEST` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |

> Chat stages default to **Gemini 2.5 Flash** because the pipeline makes 3 calls/message and Groq's free tier would `429` under that load.

---

## 6. Text vs Voice — differences

| | Text Chat | Voice Chat |
|---|---|---|
| Screen | `AIChatScreen` | `VoiceChatScreen` |
| Endpoint | `POST /ai/chat` (JSON) | `POST /ai/voice?tts=1` (multipart) |
| DB tables | `AIConversation` / `AIMessage` | `VoiceConversation` / `VoiceMessage` |
| STT / TTS | none (TTS only via "Listen") | Sarvam STT + Sarvam TTS, server-side |
| FastAPI path | `_agentic_text_reply` (Writer **+** Enhancer) | `_voice_reply` (Writer only) |
| Length | respects `responseLength` | forced concise (~90 words, no markdown) |
| Credit feature | `ai_chat_groq` (1) / `ai_scan_gemini` (3 w/ image) | `ai_voice` (2) |
| Rate limit | 30 / 60s | 15 / 60s |
| Upload transport | axios JSON | `FileSystem.uploadAsync` (Android OkHttp fix) |

---

## 7. Cross-cutting systems

### Auth ([middleware/auth.js:27](../backend/src/middleware/auth.js#L27))
Strict `Bearer <token>` parse → verify JWT (`JWT_SECRET`, HS256) → confirm user exists, `isActive !== false`, and `tokenVersion` matches DB. Sets `req.user = { id, role }`. `x-user-id` is forwarded to FastAPI for per-user rate limiting & spend caps.

### Credits ([services/aiCredit.service.js](../backend/src/services/aiCredit.service.js))
- **1 credit = 1000 tokens.** Cost = `max(per-feature floor, ceil(tokens / 1000))`.
- Floors: `ai_chat_groq` 1, `ai_chat_claude` 2, `ai_voice` 2, `ai_scan_gemini` 3, `ai_scan_claude` 5, rule-based 0.
- Free tier = **100 credits/month**, auto-refilled on the 1st (tiers: free/basic/pro/enterprise, each with a daily token cap).
- **Checked before** the call (`402` if short); **deducted after** success inside a Prisma `$transaction` (balance + `AITransaction` log written atomically, clamped at 0).

### Language & response length
Both originate in [LanguageContext.js](../frontend/src/context/LanguageContext.js) (persisted to AsyncStorage): `chatLanguage` (incl. `'auto'`) and `responseLength` (4 options from [ResponseLengthSelector.js](../frontend/src/screens/AI/components/ResponseLengthSelector.js)). They ride the request → Express forwards → FastAPI bakes a **language instruction** ("respond in Hindi Devanagari, keep technical terms as-is") and a **length directive** into the system prompt of every stage. `'auto'` triggers client script-detection for text and Sarvam auto-detect for voice.

### Conversation memory
FastAPI is **stateless**. Express stores history in Postgres and sends only the **last 20 turns** on each call (`_format_history`, [chat_service.py:212](../fastapi/services/chat_service.py#L212)).

### Image-in-chat (general vision)
Attaching a photo compresses it to base64 JPEG and embeds it in the `/ai/chat` body → FastAPI `_vision_reply()`. This is **general image Q&A**, not disease diagnosis (`structured_data` always `null`). Disease scan is the separate `/ai/scan` async pipeline.

---

## 8. Error handling & status codes

Client maps statuses to friendly text via `humanReadableError()` ([aiApi.js](../frontend/src/services/aiApi.js)):

| Status | Meaning | User sees |
|---|---|---|
| 429 | rate limit / cooldown | "Too many requests — wait 30 seconds." |
| 402 | out of credits | "You've used all your AI credits this month." |
| 401 | token invalid/expired | auto-refresh once; else "Session expired." |
| 413 | payload too large | "That was too large." |
| 500/502/503/504 | FastAPI/LLM down or timeout | "The AI service is temporarily down." |
| Network Error | offline | "No internet — check your connection." |

FastAPI retries only transient `429/5xx` + timeouts (exp backoff, no fallback). The Enhancer and follow-up stages are **non-fatal**: failure falls back to the draft / empty follow-ups.

---

## 9. Environment / config reference

**Backend (Express)** — [backend/src/config/env.js](../backend/src/config/env.js)

| Var | Default | Purpose |
|---|---|---|
| `AI_BACKEND_URL` | `http://localhost:8001` | FastAPI service URL |
| `AI_SHARED_SECRET` | *(empty)* | HMAC secret for Express→FastAPI signing |
| `USE_FASTAPI_FOR_SCAN` | `false` | route `/ai/scan` to FastAPI vs in-Node Gemini |
| `SARVAM_API_KEY` | *(empty)* | Indic STT / TTS / translate |
| `GROQ_API_KEY` | *(empty)* | Whisper STT fallback |
| `AI_VOICE_STT_MODEL` | `whisper-large-v3-turbo` | STT fallback model |
| `AI_TOKENS_PER_CREDIT` | `1000` | token→credit ratio |
| `AI_FREE_MONTHLY_CREDITS` | `100` | monthly free grant |
| `AI_MIN_CREDITS_PER_CALL` | `1` | floor per call |

**FastAPI** — [fastapi/.env.example](../fastapi/.env.example)

| Var | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` / `GROQ_API_KEY` / `ANTHROPIC_API_KEY` | *(empty)* | provider keys |
| `AI_CHAT_WRITER_MODEL` | `gemini-2.5-flash` | draft stage |
| `AI_CHAT_ENHANCER_MODEL` | `gemini-2.5-flash` | rewrite stage |
| `AI_CHAT_ENHANCER_ENABLED` | `true` | toggle the 2nd pass |
| `AI_CHAT_VISION_MODEL` | `gemini-2.5-flash` | image chat |
| `AI_<FEATURE>_BASE_URL` | *(unset)* | escape hatch for custom/OpenAI-compatible hosts |

**Frontend** — [frontend/src/services/config.js](../frontend/src/services/config.js)

| Var | Resolution |
|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | wins if set; else dev `http://<DEV_HOST>:3001/api/v1`, else prod Railway URL |

---

## 10. File map

**Frontend**
- [frontend/src/screens/AI/AIChatScreen.js](../frontend/src/screens/AI/AIChatScreen.js) — text chat UI + send flow
- [frontend/src/screens/AI/VoiceChatScreen.js](../frontend/src/screens/AI/VoiceChatScreen.js) — voice chat UI, recording, TTS playback
- [frontend/src/screens/AI/components/ResponseLengthSelector.js](../frontend/src/screens/AI/components/ResponseLengthSelector.js) — length picker
- [frontend/src/services/aiApi.js](../frontend/src/services/aiApi.js) — AI endpoints
- [frontend/src/services/api.js](../frontend/src/services/api.js) — axios client, token inject, 401 refresh
- [frontend/src/context/LanguageContext.js](../frontend/src/context/LanguageContext.js) — language + response length state

**Backend (Express)**
- [backend/src/app.js](../backend/src/app.js) — middleware order, route mounting
- [backend/src/routes/ai.routes.js](../backend/src/routes/ai.routes.js) — all AI routes
- [backend/src/services/aiCredit.service.js](../backend/src/services/aiCredit.service.js) — credit system
- [backend/src/middleware/auth.js](../backend/src/middleware/auth.js) — JWT auth
- [backend/src/utils/fastapi-signed.js](../backend/src/utils/fastapi-signed.js) — HMAC signing
- [backend/src/config/env.js](../backend/src/config/env.js) — config

**FastAPI**
- [fastapi/routes/chat.py](../fastapi/routes/chat.py) — `/ai/chat` endpoint
- [fastapi/services/chat_service.py](../fastapi/services/chat_service.py) — agentic pipeline
- [fastapi/agents/llm_dispatch.py](../fastapi/agents/llm_dispatch.py) — provider routing
- [fastapi/agents/llm_utils.py](../fastapi/agents/llm_utils.py) — per-provider calls + pricing
- [fastapi/services/http_clients.py](../fastapi/services/http_clients.py) — pooled clients
- [fastapi/tests/test_chat_followups.py](../fastapi/tests/test_chat_followups.py) — pipeline routing & follow-up tests
- [fastapi/main.py](../fastapi/main.py) — app, CORS, rate limit, health

---

*Generated from a code-level read of the chat pipeline across all three tiers. Update alongside changes to `ai.routes.js`, `chat_service.py`, or `llm_dispatch.py`.*

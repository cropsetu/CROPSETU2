# Voice Assistant — Realtime (Gemini Live) Design & Phased Plan

Goal: make the voice assistant feel like ChatGPT/Gemini voice — the farmer talks,
the assistant responds almost immediately, and they can interrupt it (barge-in) —
instead of the current "record → wait → transcribe → wait → answer → wait → speak"
turn-taking.

This doc is the plan for that rebuild. **Phase 0 (latency quick wins) is already
shipped** on `feat/ai-ux-robustness-and-voice`; the realtime rebuild (Phases 1–4)
is scoped here and gated on the decisions in §3.

---

## 1. Where the time goes today (request/response at every layer)

One voice turn is strictly serial (measured structurally; instrument to confirm):

```
[silence wait] → stop/flush → upload(m4a) → Sarvam STT(full file) → DB+context
   → Gemini(full reply, blocking) → DB writes → 2nd round-trip → Sarvam TTS(full)
   → download+decode full WAV → play
```

Dominant costs, in order:
1. **Silence endpointing** — was a flat 10s after the farmer stopped talking.
   *(Phase 0: cut to 1.8s.)*
2. **Blocking Gemini generation** — server holds until the whole reply is generated.
3. **Whole-file STT** — only starts after recording stops + uploads.
4. **Whole-reply TTS + full-clip download** — no audio until the entire WAV is ready.
5. **Two round-trips** — `/ai/voice` (STT+LLM) then a separate `/ai/tts`.

Nothing overlaps. The realtime target is to **overlap** these and **stream** each.

### Phase 0 — shipped (no rebuild)
- `SILENCE_MS` 10s → **1.8s** (`VoiceChatScreen.js`). Biggest perceived win.
- Voice reply `max_tokens` 4096 → **512** (`chat_service._voice_reply`) — caps tail latency.
- Typewriter sped up (~6 chars/20ms) so text tracks audio instead of lagging ~6s.
- Native-voice error shape fixed so failures show the real message, not a generic one.

Phase 0 roughly halves perceived latency. Phases 1–4 are the "feels realtime" work.

---

## 2. Target architecture

A genuine realtime experience needs five things the current stack doesn't have:

1. **Continuous mic streaming** with server-side VAD/endpointing (no fixed timer).
2. **Streaming STT** with interim/partial transcripts.
3. **Streaming LLM** that starts generating before the user fully stops (or
   speech-to-speech).
4. **Streaming TTS** that plays audio while later tokens still generate.
5. **Barge-in** — the farmer can interrupt the assistant mid-sentence.

Two ways to get there:

### Option A — Gemini Live API (chosen direction)
One bidirectional WebSocket session does STT + LLM + TTS natively, with VAD and
interruption built in. Collapses the whole pipeline into one stream.

```
RN client  ⇄  Express WS relay (auth, credits, signing)  ⇄  Gemini Live WS
   mic PCM frames  →→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→  Gemini
   speaker PCM/Opus  ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←  Gemini
```

**Trade-off (critical):** Gemini Live's native audio **replaces Sarvam**, so we lose
Sarvam's Indic-tuned STT (`saaras`) and Indic TTS voices that the product currently
depends on for Marathi/Hindi/regional languages. Gemini Live's Indic voice + ASR
quality **must be validated** before committing (see §3).

### Option B — Hybrid streaming (fallback if Gemini Live's Indic quality is insufficient)
Keep Sarvam for voice quality, but stream every stage:
`Sarvam streaming STT (WS) → Gemini streamGenerateContent → Sarvam sentence-chunked TTS`,
all overlapped, with client VAD for endpointing. Feels near-realtime without
abandoning Indic voices. More moving parts than Option A but no voice-quality risk.

Recommendation: **validate Option A's Indic quality first; fall back to Option B if
it's not good enough.** Both reuse the same client streaming + Express relay work.

---

## 3. Prerequisites & open decisions (BLOCKING — need answers before Phase 1)

1. **Gemini Live API access** — confirm the project's Google AI / Vertex access
   includes the Live API (native audio), and the cost model per audio-minute.
2. **Indic voice/ASR validation** — run a quality bake-off on real Marathi/Hindi/
   (target languages) clips: Gemini Live native audio **vs** today's Sarvam saaras+bulbul.
   This decides Option A vs Option B. *Owner: product + a few native speakers.*
3. **Client streaming stack** — `expo-av` cannot do bidirectional PCM streaming.
   Need a config plugin / dev-client with a native audio module (e.g. a WebRTC or
   raw-PCM record/playback lib). Confirm we can ship a custom dev client (not Expo Go).
4. **Billing model for streaming** — today's reserve→settle assumes one
   `token_info` per turn. Streaming/audio-minute billing needs: reserve on session
   open, meter during the stream, settle on close. Decide credit cost per audio-minute.
5. **Network reality** — rural 2G/3G uplinks: a persistent WS with PCM may be worse
   than today's batch upload. Need a graceful **degrade to Phase-0 batch mode** when
   the connection can't sustain streaming.

---

## 4. Phased implementation plan

Each phase is independently shippable and de-risks the next.

| Phase | Scope | Risk | Ship value |
|---|---|---|---|
| **0 ✅** | Latency quick wins (done) | low | ~½ perceived latency now |
| **1** | Streaming LLM + sentence-chunked TTS over the *existing* request (text streams out of FastAPI via SSE; Express proxies; TTS synthesizes per sentence; client plays sentence 1 while 2 generates). Still batch STT. | med | First audio after ~1 sentence, not the full reply |
| **2** | Client VAD + streaming STT (Sarvam WS or Gemini), interim transcripts; remove the silence-timer batch upload. | med-high | Turn ends the instant the farmer stops |
| **3** | Full bidirectional session (Option A Gemini Live **or** Option B hybrid) over an Express WS relay; barge-in; per-session credit metering. | high | "Feels realtime" |
| **4** | Polish: graceful degrade to batch on poor networks, language auto-detect, voice selection, analytics on each stage's wall-clock. | med | Robustness at rural-network scale |

**Phase 1 is the highest-ROI next step** and needs no new infra or provider — it
turns the blocking Gemini call into a stream and starts audio after the first
sentence. It also builds the Express stream-proxy that Phases 2–3 reuse.

---

## 5. Touch points (for whoever picks this up)

- Client: `frontend/src/screens/AI/VoiceChatScreen.js` (record/playback loop),
  `frontend/src/services/aiApi.js` (`sendVoiceChatMessage`, `textToSpeech`).
- Express: `backend/src/routes/ai.routes.js` `/ai/voice` + `/ai/tts` (→ a streaming
  WS/SSE relay), `backend/src/services/sarvam.service.js` (STT/TTS clients),
  `backend/src/services/aiCredit.service.js` (per-session metering).
- FastAPI: `fastapi/routes/chat.py` + `fastapi/services/chat_service.py` (voice path
  → `streamGenerateContent`), `fastapi/agents/llm_utils.py` (`call_gemini_text` →
  streaming variant).
- Billing: `aiCredit.service.js` reserve/settle → reserve-on-open/meter/settle-on-close.

---

## 6. Definition of done (realtime)

- Time-to-first-audio ≤ ~1.5s after the farmer stops speaking on a 4G connection.
- The farmer can interrupt the assistant and it stops + listens.
- Indic language quality is at least on par with today's Sarvam output (per §3.2).
- Graceful fallback to Phase-0 batch mode when the network can't sustain streaming.
- Credits are metered correctly per audio-minute with no double-charge.

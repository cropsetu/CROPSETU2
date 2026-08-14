/**
 * Server-owned copy for the AI safety refusal.
 *
 * WHY THIS LIVES ON THE SERVER AND NOT IN shared/i18n
 *   Every other user-visible string in this product is rendered on the device
 *   through `t()`. This one cannot be: when fastapi/safety/validator excises the
 *   whole reply, the VOICE path still has to say something, and the text that
 *   gets spoken is chosen by Express — it is handed to Sarvam TTS with the
 *   farmer's language tag before any client sees it. So the refusal needs a
 *   server-side home, keyed by the same language codes the voice pipeline
 *   already normalises to.
 *
 * WHY THE PYTHON SIDE NO LONGER SUPPLIES IT
 *   `validator._ADVICE_SAFE_FALLBACK` is a hardcoded English sentence, and
 *   chat_service used to return it as the assistant's answer. On voice that
 *   produced an English refusal spoken in a Marathi/Malayalam voice — on the one
 *   surface built for people who cannot read. chat_service now returns an EMPTY
 *   reply plus `token_info.safety.replaced_with_fallback`, and Express
 *   substitutes the line below.
 *
 * TRANSLATION STATUS — OPEN
 *   Only `en` is written. Every other language falls through to it, so a Marathi
 *   farmer still hears English today; the mechanism is in place, the copy is not.
 *   Native copy for ta/kn/ml/te/bn/gu/pa/hi/mr is a product deliverable and is
 *   deliberately NOT machine-translated here — a mistranslated safety refusal is
 *   worse than an English one, because the farmer would act on it. Clients that
 *   want to render their own localized line on SCREEN can key off the
 *   `safetyRefusal: true` flag Express puts on the chat/voice payloads.
 */

// Keyed by the BCP-47 tags sarvam.service.normaliseLangCode emits, so the voice
// path can look up with the very tag it is about to hand to TTS.
const SAFETY_REFUSAL = {
  'en-IN': "I can't recommend a chemical for this. Please contact your nearest "
         + 'Krishi Vigyan Kendra (KVK) or agriculture officer before spraying anything.',
};

const SAFETY_REFUSAL_DEFAULT = SAFETY_REFUSAL['en-IN'];

/**
 * The refusal line to show and speak. `lang` may be a bare code ("mr"), a BCP-47
 * tag ("mr-IN"), null or unknown — all resolve, none throw.
 */
export function safetyRefusalLine(lang) {
  const tag = String(lang || '').trim();
  if (!tag) return SAFETY_REFUSAL_DEFAULT;
  if (SAFETY_REFUSAL[tag]) return SAFETY_REFUSAL[tag];
  const short = tag.split('-')[0].toLowerCase();
  return SAFETY_REFUSAL[`${short}-IN`] || SAFETY_REFUSAL_DEFAULT;
}

export default safetyRefusalLine;

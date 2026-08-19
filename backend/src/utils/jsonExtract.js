/**
 * Robust JSON extractor for LLM responses.
 *
 * Handles:
 *   - Markdown code fences (```json ... ```)
 *   - Bare JSON mixed with text
 *   - Direct JSON strings
 *
 * Used by ai.predict.service.js and ai.chat.service.js.
 */

/**
 * Extract the first JSON object as a raw string (without parsing).
 * Useful when the caller wants to parse themselves.
 *
 * @param {string} raw — raw model output
 * @returns {string} JSON string
 */
export function extractJSONString(raw) {
  raw = (raw || '').trim();
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  }
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? match[0] : raw;
}

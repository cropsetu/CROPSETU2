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
 * Extract the first JSON object from a raw LLM response string.
 * Strips code fences, finds the outermost { ... } block, and parses it.
 *
 * @param {string} raw — raw model output
 * @returns {object} parsed JSON object
 * @throws {Error} if no valid JSON can be extracted
 */
export function extractJSON(raw) {
  if (!raw?.trim()) throw new Error('Empty response from model');

  // Strip markdown code fences if present
  let text = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // Try direct parse first (fastest path)
  try { return JSON.parse(text); } catch { /* fall through */ }

  // Find the outermost { ... } block
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
  }

  throw new Error(`Could not parse JSON from model response: ${raw.slice(0, 120)}`);
}

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

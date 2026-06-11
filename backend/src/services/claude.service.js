/**
 * Scheme Q&A LLM Service — Gemini-backed
 *
 * callClaude() — non-streaming single response (government schemes Q&A).
 *
 * The export name is kept as `callClaude` for backwards-compat with existing
 * callers (schemes.routes.js). CropSetu consolidated onto Google Gemini for
 * production, so this now calls Gemini via its OpenAI-compatible endpoint —
 * Anthropic/Claude was removed.
 */
import OpenAI from 'openai';
import { ENV } from '../config/env.js';

let _client = null;
function client() {
  if (!_client) {
    if (!ENV.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');
    _client = new OpenAI({
      apiKey: ENV.GEMINI_API_KEY,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    });
  }
  return _client;
}

const MODEL = ENV.GEMINI_MODEL || 'gemini-2.5-flash';

/**
 * Non-streaming Gemini call (single system + user turn).
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userMessage
 * @param {number} [opts.maxTokens=800]
 * @returns {Promise<string>} response text
 */
export async function callClaude({ systemPrompt, userMessage, maxTokens = 800 }) {
  const response = await client().chat.completions.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage },
    ],
  });
  return response.choices[0]?.message?.content || '';
}

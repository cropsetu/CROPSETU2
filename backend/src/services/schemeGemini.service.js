/**
 * Scheme Q&A LLM Service — Gemini
 *
 * Government-schemes Q&A, answered by Gemini via its OpenAI-compatible endpoint.
 * (Formerly claude.service.js / callClaude() — a misleading name: it has always
 * called Gemini here, not Anthropic/Claude. Renamed so the code + logs are honest.)
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
 * Non-streaming Gemini call (single system + user turn) for scheme Q&A.
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userMessage
 * @param {number} [opts.maxTokens=800]
 * @returns {Promise<{answer: string, tokensUsed: number, model: string}>}
 *   The usage block rides along so the caller can debit the credit ledger against
 *   real token counts — settling with 0 would charge only the per-feature floor
 *   regardless of how long the answer ran.
 */
export async function askSchemeQuestion({ systemPrompt, userMessage, maxTokens = 800 }) {
  const response = await client().chat.completions.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage },
    ],
  });
  return {
    answer: response.choices[0]?.message?.content || '',
    tokensUsed: response.usage?.total_tokens || 0,
    model: MODEL,
  };
}

/**
 * Claude Service — thin wrapper around @anthropic-ai/sdk
 *
 * callClaude() — non-streaming single response (schemes Q&A, disease analysis)
 */
import Anthropic from '@anthropic-ai/sdk';
import { ENV } from '../config/env.js';

let _client = null;
function client() {
  if (!_client) {
    if (!ENV.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set in .env');
    _client = new Anthropic({ apiKey: ENV.ANTHROPIC_API_KEY });
  }
  return _client;
}

const MODEL = ENV.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

/**
 * Non-streaming Claude call.
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userMessage
 * @param {number} [opts.maxTokens=800]
 * @returns {Promise<string>} response text
 */
export async function callClaude({ systemPrompt, userMessage, maxTokens = 800 }) {
  const response = await client().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });
  return response.content[0]?.text || '';
}


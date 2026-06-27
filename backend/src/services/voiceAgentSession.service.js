/**
 * Voice-Agent session store — "Hey Krushi" assistant.
 *
 * Holds the in-progress conversational DRAFT + turn history for ONE voice-agent
 * conversation (any domain: farm / animal-post / rent / …) across multiple turns.
 * Server-side (Redis) so FastAPI stays stateless, the draft never bloats the
 * rural audio upload, and enum-clamping happens before the client sees values.
 *
 * Key   : voiceagent:sess:${userId}:${sessionId}
 * Value : { domain, draft, turnHistory:[{role,content}], context, updatedAt }
 * TTL   : 15 min, refreshed each turn. A live voice conversation is inherently
 *         online, so there's no offline requirement on this transient state —
 *         the FINAL save runs on the client through the offline writeQueue.
 *
 * Redis is best-effort: if it's down, getSession returns null and each turn
 * starts from the client-sent draft, so multi-turn degrades but never crashes.
 */
import crypto from 'crypto';
import redis from '../config/redis.js';
import logger from '../utils/logger.js';

const TTL_SEC = 15 * 60;
const KEY = (userId, sessionId) => `voiceagent:sess:${userId}:${sessionId}`;

// Domains the assistant can drive. Keep in sync with fastapi voice_agent_domains.py.
// Validated up-front so an unknown domain is rejected BEFORE we spend STT + a credit.
export const VOICE_AGENT_DOMAINS = new Set([
  'farm',            // MyFarm — farm record
  'animal_post',     // Animal Trade — sell an animal
  'rent_machinery',  // Rent — machinery/equipment listing
  'rent_labour',     // Rent — farm labour listing
  'profile',         // Profile — edit user profile
  'onboarding',      // Onboarding — first-time setup + first farm
]);

export function newSessionId() {
  return crypto.randomUUID();
}

export async function getSession(userId, sessionId) {
  if (!sessionId) return null;
  try {
    const raw = await redis.get(KEY(userId, sessionId));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    logger.warn('[VoiceAgent] session read failed (non-fatal): %s', e.message);
    return null;
  }
}

export async function saveSession(userId, sessionId, data) {
  try {
    await redis.set(KEY(userId, sessionId), JSON.stringify({ ...data, updatedAt: Date.now() }), 'EX', TTL_SEC);
  } catch (e) {
    logger.warn('[VoiceAgent] session write failed (non-fatal): %s', e.message);
  }
}

export async function clearSession(userId, sessionId) {
  if (!sessionId) return;
  try {
    await redis.del(KEY(userId, sessionId));
  } catch (e) {
    logger.warn('[VoiceAgent] session clear failed (non-fatal): %s', e.message);
  }
}

/** Append a (user, assistant) exchange, keeping only the last `keep` turns. */
export function appendTurn(turnHistory, userText, assistantText, keep = 12) {
  const next = Array.isArray(turnHistory) ? [...turnHistory] : [];
  if (userText) next.push({ role: 'user', content: String(userText).slice(0, 1000) });
  if (assistantText) next.push({ role: 'assistant', content: String(assistantText).slice(0, 1000) });
  return next.slice(-keep * 2);
}

/**
 * IMD Scraper Service
 * Scrapes India Meteorological Department city weather pages for
 * text-based warnings and advisories that Open-Meteo doesn't provide.
 *
 * Target: https://city.imd.gov.in/citywx/city_weather_test.php?id={CITY_ID}
 *
 * IMPORTANT: This is a bonus layer only.
 * If scraping fails for any reason (network, parse error, IMD downtime),
 * this function returns { alerts: [], imdAvailable: false } and the
 * app continues working perfectly on Open-Meteo data alone.
 *
 * Timeout: 8 seconds (IMD site is sometimes slow)
 * No retries — IMD is best-effort
 */
import axios from 'axios';
import { getCityId } from '../utils/cityIds.js';

const IMD_BASE   = 'https://city.imd.gov.in/citywx/city_weather_test.php';
const TIMEOUT_MS = 3_000; // 3s — IMD is now background-only, no need to wait longer

// ── Severity detection from warning text ─────────────────────────────────────
function detectSeverity(text) {
  const t = text.toLowerCase();
  if (t.includes('red alert') || t.includes('extreme') || t.includes('severe') || t.includes('cyclone')) return 'high';
  if (t.includes('orange alert') || t.includes('heavy rain') || t.includes('warning') || t.includes('thunderstorm')) return 'medium';
  return 'low';
}

// ── Detect alert type from text ───────────────────────────────────────────────
function detectType(text) {
  const t = text.toLowerCase();
  if (t.includes('warning') || t.includes('alert') || t.includes('danger')) return 'warning';
  return 'advisory';
}

// ── Extract all text content from HTML tags (strip HTML) ─────────────────────
function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Parse warning/advisory text blocks from IMD HTML ─────────────────────────
function parseAlerts(html) {
  const alerts = [];

  // IMD pages typically contain warning text in <td> cells or <p> tags
  // Look for any cell/block containing warning keywords
  const WARNING_KEYWORDS = /warning|alert|advisory|heavy rain|thunderstorm|cyclone|flood|danger|caution|extreme|forecast/i;

  // Extract content from table cells and paragraphs
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  const paraRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;

  const candidates = [];

  let m;
  while ((m = cellRegex.exec(html)) !== null) {
    const text = stripHtml(m[1]);
    if (text.length > 10 && WARNING_KEYWORDS.test(text)) candidates.push(text);
  }
  while ((m = paraRegex.exec(html)) !== null) {
    const text = stripHtml(m[1]);
    if (text.length > 10 && WARNING_KEYWORDS.test(text)) candidates.push(text);
  }

  // De-duplicate and limit to 5 most relevant alerts
  const seen = new Set();
  for (const text of candidates) {
    const key = text.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // Extract a short title (first sentence or first 60 chars)
    const firstSentence = text.split(/[.!]/)[0].trim();
    const title = firstSentence.length > 5
      ? (firstSentence.length > 60 ? firstSentence.slice(0, 60) + '…' : firstSentence)
      : 'IMD Weather Alert';

    alerts.push({
      source:      'IMD',
      type:        detectType(text),
      title,
      description: text.length > 200 ? text.slice(0, 200) + '…' : text,
      severity:    detectSeverity(text),
    });

    if (alerts.length >= 5) break;
  }

  return alerts;
}

// ── Extract 7-day forecast text from IMD HTML ─────────────────────────────────
function parseForecastText(html) {
  const rows = [];

  // IMD 7-day tables often have day abbreviations in header rows
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1];
    // Look for tables that contain day names (Mon, Tue...)
    if (!/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(tableHtml)) continue;

    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const row = stripHtml(rowMatch[1]);
      if (row.length > 3) rows.push(row);
    }
    if (rows.length > 0) break; // found the forecast table
  }

  return rows;
}

/**
 * Scrape IMD weather page for a city.
 * @param {string} cityName - City name to look up in cityIds map
 * @returns {Promise<{alerts: Array, forecastText: Array, imdAvailable: boolean}>}
 */
export async function scrapeIMD(cityName) {
  // Default result — returned on any failure
  const fallback = { alerts: [], forecastText: [], imdAvailable: false };

  const cityId = getCityId(cityName);
  if (!cityId) return fallback;

  try {
    const response = await axios.get(IMD_BASE, {
      params:  { id: cityId },
      timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FarmEasy/1.0; +https://farmeasy.in)',
        'Accept':     'text/html,application/xhtml+xml',
      },
      // Treat all 2xx AND 3xx as success for scraping purposes
      validateStatus: (status) => status < 400,
    });

    const html = response.data;
    if (typeof html !== 'string' || html.length < 100) return fallback;

    const alerts       = parseAlerts(html);
    const forecastText = parseForecastText(html);

    return { alerts, forecastText, imdAvailable: true };

  } catch (err) {
    // Silently fail — IMD is best-effort
    console.warn('[IMD Scraper] Failed (non-fatal):', err.message?.slice(0, 80));
    return fallback;
  }
}

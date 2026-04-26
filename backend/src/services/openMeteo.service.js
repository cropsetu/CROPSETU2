/**
 * Open-Meteo Service
 * Fetches current weather + hourly + daily + agriculture data.
 * Free API — no key required. Timezone set to Asia/Kolkata.
 *
 * Retry policy: 1 automatic retry on network error or 5xx response.
 * Timeout: 10 seconds per attempt.
 */
import axios from 'axios';
import { getCondition, getConditionLabel } from '../utils/weatherCodes.js';

const BASE_URL    = 'https://api.open-meteo.com/v1/forecast';
const GEO_URL     = 'https://nominatim.openstreetmap.org/reverse'; // free, no key
const TIMEOUT_MS  = 10_000;
const MAX_RETRIES = 1;

// ── Reverse geocode lat/lon → place name ──────────────────────────────────────
// Uses Nominatim (OpenStreetMap) — free, no API key required.
// Returns the most specific available name: village → town → city → state.
export async function reverseGeocode(lat, lon) {
  try {
    const res = await axios.get(GEO_URL, {
      params: {
        lat, lon,
        format: 'json',
        'accept-language': 'en',
        zoom: 10,           // zoom 10 = city/town level
      },
      timeout: 4_000,
      headers: {
        // Nominatim requires a User-Agent identifying your app
        'User-Agent': 'FarmEasy/1.0 (farmeasy.in)',
      },
    });

    const addr = res.data?.address || {};
    // Pick most specific populated-place name available
    const name =
      addr.village     ||
      addr.town        ||
      addr.city        ||
      addr.county      ||
      addr.state_district ||
      addr.state       ||
      '';

    return name;
  } catch {
    // Non-fatal — caller falls back to empty string
    return '';
  }
}

// ── Wind direction helper ──────────────────────────────────────────────────────
function degToCompass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((deg % 360) / 45) % 8];
}

// ── Fetch with 1 retry ────────────────────────────────────────────────────────
async function fetchWithRetry(url, params, attempt = 0) {
  try {
    const res = await axios.get(url, { params, timeout: TIMEOUT_MS });
    return res.data;
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      // Wait 1.5s before retry to let transient issues clear
      await new Promise(r => setTimeout(r, 1500));
      return fetchWithRetry(url, params, attempt + 1);
    }
    throw err;
  }
}

// ── Format ISO time → "3 PM" style ───────────────────────────────────────────
function formatHour(iso) {
  const h = new Date(iso).getHours();
  if (h === 0)  return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

// ── Format ISO date → "Mon, 10 Apr" ──────────────────────────────────────────
const DAY_NAMES   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDate(iso) {
  const d = new Date(iso);
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

// ── Format sunrise/sunset "HH:MM" → "6:32 AM" ────────────────────────────────
function formatTime(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  if (h === 0)  return `12:${m} AM`;
  if (h === 12) return `12:${m} PM`;
  return h < 12 ? `${h}:${m} AM` : `${h - 12}:${m} PM`;
}

/**
 * Main export — fetches and normalises Open-Meteo data.
 * @param {number} lat
 * @param {number} lon
 * @param {'en'|'hi'} lang
 * @returns {Promise<object>} normalized weather object
 */
export async function fetchOpenMeteo(lat, lon, lang = 'en') {
  const params = {
    latitude:  lat,
    longitude: lon,
    timezone:  'Asia/Kolkata',

    // Current — ONLY fields valid in Open-Meteo current object
    current: [
      'temperature_2m',
      'apparent_temperature',
      'relative_humidity_2m',
      'precipitation',
      'weather_code',
      'cloud_cover',
      'surface_pressure',
      'wind_speed_10m',
      'wind_gusts_10m',
      'wind_direction_10m',
      'uv_index',
    ].join(','),

    // Hourly — extra atmosphere fields (dew, visibility, VPD, CAPE, solar, gusts)
    // These are NOT available in current — we read them at the current-hour index
    hourly: [
      'temperature_2m',
      'precipitation_probability',
      'weather_code',
      'wind_speed_10m',
      'wind_gusts_10m',
      'relative_humidity_2m',
      'dew_point_2m',
      'visibility',
      'vapour_pressure_deficit',
      'cape',
      'sunshine_duration',
      'shortwave_radiation',
    ].join(','),

    // Daily — 7 days
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'precipitation_probability_max',
      'weather_code',
      'sunrise',
      'sunset',
      'uv_index_max',
      'wind_speed_10m_max',
      'wind_gusts_10m_max',
      'rain_sum',
      'showers_sum',
      'precipitation_hours',
      'sunshine_duration',
      'shortwave_radiation_sum',
      'wind_direction_10m_dominant',   // correct field name
    ].join(','),

    // Agriculture-specific (soil)
    hourly_soil: [
      'soil_temperature_0cm',
      'soil_temperature_6cm',
      'soil_temperature_18cm',
      'soil_moisture_0_to_1cm',
      'soil_moisture_1_to_3cm',
      'soil_moisture_3_to_9cm',
      'evapotranspiration',
      'et0_fao_evapotranspiration',
    ].join(','),

    forecast_days: 7,
  };

  // Merge hourly and soil hourly into one request
  params.hourly = [params.hourly, params.hourly_soil].join(',');
  delete params.hourly_soil;

  const raw = await fetchWithRetry(BASE_URL, params);

  const c      = raw.current;
  const hourly = raw.hourly;
  const daily  = raw.daily;
  const nowMs  = Date.now();

  // ── Current ────────────────────────────────────────────────────────────────
  const condEntry = getCondition(c.weather_code);

  // ── Find current-hour index in hourly array for atmosphere fields
  const nowMs2 = Date.now();
  let currIdx = 0;
  for (let i = 0; i < hourly.time.length; i++) {
    if (new Date(hourly.time[i]).getTime() >= nowMs2) { currIdx = i; break; }
  }

  // Read atmosphere fields from hourly at current-hour index
  const h = hourly; // shorthand
  const currDewPoint  = h.dew_point_2m?.[currIdx] != null ? Math.round(h.dew_point_2m[currIdx]) : null;
  const currVis       = h.visibility?.[currIdx]   != null ? Math.round(h.visibility[currIdx] / 1000) : null;
  const currVPD       = h.vapour_pressure_deficit?.[currIdx] != null ? parseFloat(h.vapour_pressure_deficit[currIdx].toFixed(2)) : null;
  const currCAPE      = h.cape?.[currIdx]          != null ? Math.round(h.cape[currIdx]) : null;
  const currSolar     = h.shortwave_radiation?.[currIdx] != null ? Math.round(h.shortwave_radiation[currIdx]) : null;
  const currGusts     = h.wind_gusts_10m?.[currIdx] != null ? Math.round(h.wind_gusts_10m[currIdx]) : (c.wind_gusts_10m != null ? Math.round(c.wind_gusts_10m) : null);

  const current = {
    temperature:          Math.round(c.temperature_2m),
    feelsLike:            Math.round(c.apparent_temperature),
    humidity:             c.relative_humidity_2m,
    windSpeed:            Math.round(c.wind_speed_10m),
    windGusts:            c.wind_gusts_10m != null ? Math.round(c.wind_gusts_10m) : currGusts,
    windDirection:        c.wind_direction_10m,
    windCompass:          degToCompass(c.wind_direction_10m),
    precipitation:        c.precipitation,
    cloudCover:           c.cloud_cover,
    pressure:             Math.round(c.surface_pressure),
    uvIndex:              Math.round(c.uv_index ?? 0),
    weatherCode:          c.weather_code,
    condition:            getConditionLabel(c.weather_code, lang),
    conditionEn:          condEntry.en,
    conditionIcon:        condEntry.icon,
    isRain:               condEntry.isRain,
    isStorm:              condEntry.isStorm,
    // Atmosphere — from hourly[currIdx]
    dewPoint:             currDewPoint,
    visibility:           currVis,
    vapourPressureDeficit:currVPD,
    cape:                 currCAPE,
    solarRadiation:       currSolar,
    leafWetness:          null,  // estimated below
  };

  // ── Leaf wetness — estimated from RH + dew point spread (standard agro formula)
  if (current.humidity != null && currDewPoint != null) {
    const spread = current.temperature - currDewPoint;
    const rh     = current.humidity;
    if      (rh >= 95 || spread <= 1) current.leafWetness = 90;
    else if (rh >= 85 || spread <= 3) current.leafWetness = 65;
    else if (rh >= 70 || spread <= 6) current.leafWetness = 35;
    else                              current.leafWetness = 10;
  }

  // ── Hourly (next 24 slots from now) ───────────────────────────────────────
  const hourlyData = [];
  for (let i = 0; i < hourly.time.length && hourlyData.length < 24; i++) {
    const slotMs = new Date(hourly.time[i]).getTime();
    if (slotMs < nowMs - 1800_000) continue; // skip slots > 30min in the past
    hourlyData.push({
      time:                     formatHour(hourly.time[i]),
      timeIso:                  hourly.time[i],
      temperature:              Math.round(hourly.temperature_2m[i]),
      precipitationProbability: hourly.precipitation_probability?.[i] ?? 0,
      weatherCode:              hourly.weather_code[i],
      condition:                getConditionLabel(hourly.weather_code[i], lang),
      conditionIcon:            getCondition(hourly.weather_code[i]).icon,
      windSpeed:                Math.round(hourly.wind_speed_10m?.[i] ?? 0),
      windGusts:                Math.round(hourly.wind_gusts_10m?.[i] ?? 0),
      humidity:                 hourly.relative_humidity_2m?.[i] ?? 0,
      dewPoint:                 hourly.dew_point_2m?.[i] != null ? Math.round(hourly.dew_point_2m[i]) : null,
      visibility:               hourly.visibility?.[i] != null ? Math.round(hourly.visibility[i] / 1000) : null, // m→km
      vapourPressureDeficit:    hourly.vapour_pressure_deficit?.[i] != null ? parseFloat(hourly.vapour_pressure_deficit[i].toFixed(2)) : null,
      leafWetness:              null,
      cape:                     hourly.cape?.[i] != null ? Math.round(hourly.cape[i]) : null,
      sunshineDuration:         hourly.sunshine_duration?.[i] != null ? Math.round(hourly.sunshine_duration[i] / 60) : null, // s→min
      solarRadiation:           hourly.shortwave_radiation?.[i] != null ? Math.round(hourly.shortwave_radiation[i]) : null, // W/m²
      isNow:                    hourlyData.length === 0,
    });
  }

  // ── Daily (7 days) ─────────────────────────────────────────────────────────
  const dailyData = daily.time.slice(0, 7).map((dateStr, i) => ({
    date:                    dateStr,
    dateLabel:               i === 0 ? (lang === 'hi' ? 'आज' : 'Today') : formatDate(dateStr),
    maxTemp:                 Math.round(daily.temperature_2m_max[i]),
    minTemp:                 Math.round(daily.temperature_2m_min[i]),
    precipitationSum:        parseFloat((daily.precipitation_sum?.[i] || 0).toFixed(1)),
    rainSum:                 parseFloat((daily.rain_sum?.[i] || 0).toFixed(1)),
    showersSum:              parseFloat((daily.showers_sum?.[i] || 0).toFixed(1)),
    precipitationHours:      daily.precipitation_hours?.[i] ?? 0,
    precipitationProbability:daily.precipitation_probability_max?.[i] ?? 0,
    weatherCode:             daily.weather_code[i],
    condition:               getConditionLabel(daily.weather_code[i], lang),
    conditionIcon:           getCondition(daily.weather_code[i]).icon,
    sunrise:                 formatTime(daily.sunrise[i]),
    sunset:                  formatTime(daily.sunset[i]),
    sunriseIso:              daily.sunrise[i],
    sunsetIso:               daily.sunset[i],
    uvIndexMax:              Math.round(daily.uv_index_max?.[i] ?? 0),
    windSpeedMax:            Math.round(daily.wind_speed_10m_max?.[i] ?? 0),
    windGustsMax:            Math.round(daily.wind_gusts_10m_max?.[i] ?? 0),
    dominantWindDirection:   daily.wind_direction_10m_dominant?.[i] != null ? degToCompass(daily.wind_direction_10m_dominant[i]) : null,
    sunshineDuration:        daily.sunshine_duration?.[i] != null ? Math.round(daily.sunshine_duration[i] / 3600) : null, // s→hours
    solarRadiationSum:       daily.shortwave_radiation_sum?.[i] != null ? Math.round(daily.shortwave_radiation_sum[i]) : null, // MJ/m²
    growingDegreeDays:       null, // not available in Open-Meteo forecast API
  }));

  // ── Agriculture (take current-hour slot) ───────────────────────────────────
  // Find index of current or next hour in hourly array
  let soilIdx = 0;
  for (let i = 0; i < hourly.time.length; i++) {
    if (new Date(hourly.time[i]).getTime() >= nowMs) { soilIdx = i; break; }
  }

  const agriculture = {
    soilTemperature: {
      surface:  hourly.soil_temperature_0cm?.[soilIdx]  != null ? Math.round(hourly.soil_temperature_0cm[soilIdx])  : null,
      depth6cm: hourly.soil_temperature_6cm?.[soilIdx]  != null ? Math.round(hourly.soil_temperature_6cm[soilIdx])  : null,
      depth18cm:hourly.soil_temperature_18cm?.[soilIdx] != null ? Math.round(hourly.soil_temperature_18cm[soilIdx]) : null,
    },
    soilMoisture: {
      // Open-Meteo gives m³/m³ — multiply by 100 for percentage approximation
      surface:     hourly.soil_moisture_0_to_1cm?.[soilIdx]  != null ? parseFloat((hourly.soil_moisture_0_to_1cm[soilIdx]  * 100).toFixed(1)) : null,
      depth1to3cm: hourly.soil_moisture_1_to_3cm?.[soilIdx]  != null ? parseFloat((hourly.soil_moisture_1_to_3cm[soilIdx]  * 100).toFixed(1)) : null,
      depth3to9cm: hourly.soil_moisture_3_to_9cm?.[soilIdx]  != null ? parseFloat((hourly.soil_moisture_3_to_9cm[soilIdx]  * 100).toFixed(1)) : null,
    },
    evapotranspiration: hourly.evapotranspiration?.[soilIdx]         != null ? parseFloat(hourly.evapotranspiration[soilIdx].toFixed(2))         : null,
    referenceET:        hourly.et0_fao_evapotranspiration?.[soilIdx] != null ? parseFloat(hourly.et0_fao_evapotranspiration[soilIdx].toFixed(2)) : null,
  };

  return { current, hourly: hourlyData, daily: dailyData, agriculture };
}

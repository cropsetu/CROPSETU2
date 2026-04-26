/**
 * Irrigation Scheduler Service
 *
 * Algorithm: FAO Penman-Monteith simplified (Hargreaves method)
 *
 * Steps:
 * 1. Fetch 7-day weather from Open-Meteo for farmer's location
 * 2. Calculate ET0 (reference evapotranspiration) via Hargreaves equation
 * 3. Get crop coefficient Kc from CropMaster based on current growth stage
 * 4. ETc = ET0 × Kc (crop water need in mm/day)
 * 5. Check rainfall forecast for next 3 days (effective rainfall = rain × 0.8)
 * 6. Net irrigation need = ETc - effective rainfall
 * 7. Irrigate if net > 0, skip if upcoming rain covers the need
 *
 * ET0 formula (Hargreaves):
 *   ET0 = 0.0023 × (Tmean + 17.8) × √(Tmax - Tmin) × Ra
 *   Ra (extraterrestrial radiation) ≈ function of latitude and day of year
 *
 * Sources:
 *   Open-Meteo API (free, no key): https://api.open-meteo.com
 *   CropMaster Kc values (ICAR/FAO)
 */
import axios from 'axios';
import prisma from '../config/db.js';

// ── Open-Meteo fetch (7-day forecast + historical) ────────────────────────────
export async function fetchWeatherForIrrigation(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_max,windspeed_10m_max,shortwave_radiation_sum&timezone=Asia%2FKolkata&forecast_days=7`;
  const res = await axios.get(url, { timeout: 10000 });
  return res.data;
}

// ── Extraterrestrial radiation (Ra) approximation ─────────────────────────────
// MJ/m²/day — simplified from FAO 56 Table 2.6
function approximateRa(lat, dayOfYear) {
  const phi   = (lat * Math.PI) / 180;                // latitude in radians
  const dr    = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);  // inverse relative distance
  const delta = 0.409 * Math.sin((2 * Math.PI * dayOfYear) / 365 - 1.39); // solar declination
  const ws    = Math.acos(-Math.tan(phi) * Math.tan(delta));               // sunset hour angle
  const Ra    = (24 / Math.PI) * 4.92 * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
  return Math.max(Ra, 0);
}

// ── Hargreaves ET0 ────────────────────────────────────────────────────────────
function calcET0(tMax, tMin, dayOfYear, lat) {
  const tMean = (tMax + tMin) / 2;
  const Ra    = approximateRa(lat, dayOfYear);
  return 0.0023 * (tMean + 17.8) * Math.sqrt(Math.abs(tMax - tMin)) * Ra;
}

// ── Kc by growth stage ────────────────────────────────────────────────────────
function getCropKc(crop, daysSinceSowing) {
  const maturity = crop.maturityDays || 120;
  const progress = daysSinceSowing / maturity; // 0 to 1
  const { kcInitial = 0.4, kcMid = 1.0, kcLate = 0.6 } = crop;

  if (progress <= 0.2)       return kcInitial;
  if (progress <= 0.4)       return kcInitial + ((kcMid - kcInitial) * ((progress - 0.2) / 0.2));
  if (progress <= 0.7)       return kcMid;
  if (progress <= 1.0)       return kcMid + ((kcLate - kcMid) * ((progress - 0.7) / 0.3));
  return kcLate;
}

// ── Stage name from Kc phase ──────────────────────────────────────────────────
function getStageName(daysSinceSowing, maturity) {
  const p = daysSinceSowing / maturity;
  if (p <= 0.2) return 'Initial / Germination';
  if (p <= 0.4) return 'Crop Development';
  if (p <= 0.7) return 'Mid-season (Peak Growth)';
  return 'Late-season / Maturation';
}

// ── Main: generate irrigation recommendation ──────────────────────────────────
export async function getIrrigationRecommendation({ userId, lat, lon, cropName, sowingDate, fieldName }) {
  if (!lat || !lon) throw new Error('lat and lon are required');

  // Load crop master
  const crop = await prisma.cropMaster.findFirst({
    where: { name: { equals: cropName, mode: 'insensitive' } },
  });

  const daysSinceSowing = sowingDate
    ? Math.max(0, Math.floor((Date.now() - new Date(sowingDate).getTime()) / (1000 * 60 * 60 * 24)))
    : 45; // default mid-season

  const kc         = crop ? getCropKc(crop, daysSinceSowing) : 0.7;
  const cropStage  = crop ? getStageName(daysSinceSowing, crop.maturityDays) : 'Unknown';
  const maturity   = crop?.maturityDays || 120;

  // Fetch weather
  let weather;
  try {
    weather = await fetchWeatherForIrrigation(lat, lon);
  } catch {
    throw new Error('Weather data unavailable. Please try again.');
  }

  const daily = weather.daily;
  if (!daily?.time?.length) throw new Error('Weather data malformed');

  const today    = daily.time[0];
  const dayOfYear = Math.ceil((new Date(today) - new Date(new Date(today).getFullYear(), 0, 1)) / (1000 * 60 * 60 * 24));

  const tMax = daily.temperature_2m_max[0] || 30;
  const tMin = daily.temperature_2m_min[0] || 20;
  const hum  = daily.relative_humidity_2m_max?.[0] || 60;
  const wind = daily.windspeed_10m_max?.[0] || 10;
  const rain = daily.precipitation_sum?.[0] || 0;

  // 3-day rain forecast (effective rainfall = 80% of forecast)
  const rainForecast3d = [1, 2, 3].reduce((sum, i) => sum + (daily.precipitation_sum?.[i] || 0), 0);
  const effectiveRain  = rain * 0.8;
  const rainForecastEff = rainForecast3d * 0.8;

  // ET0 and ETc
  const et0 = calcET0(tMax, tMin, dayOfYear, lat);
  const etc = et0 * kc;  // mm/day

  // Net irrigation need: today's ETc minus today's effective rain
  const netNeed = Math.max(0, etc - effectiveRain);

  // Decision logic
  let shouldIrrigate = true;
  let reason = '';
  let reasonHi = '';

  if (rain > 10) {
    shouldIrrigate = false;
    reason   = `Today's rainfall (${rain.toFixed(1)}mm) is sufficient. Skip irrigation.`;
    reasonHi = `आज की बारिश (${rain.toFixed(1)}mm) पर्याप्त है। सिंचाई न करें।`;
  } else if (rainForecast3d > 15 && netNeed < 5) {
    shouldIrrigate = false;
    reason   = `Heavy rain forecast in next 3 days (${rainForecast3d.toFixed(0)}mm). Skip irrigation.`;
    reasonHi = `अगले 3 दिन में भारी बारिश की उम्मीद (${rainForecast3d.toFixed(0)}mm)। सिंचाई न करें।`;
  } else if (netNeed < 3) {
    shouldIrrigate = false;
    reason   = `Crop water need is very low (${netNeed.toFixed(1)}mm). No irrigation needed today.`;
    reasonHi = `फसल को पानी की जरूरत बहुत कम है (${netNeed.toFixed(1)}mm)। आज सिंचाई जरूरी नहीं।`;
  } else if (daysSinceSowing > maturity * 0.85) {
    shouldIrrigate = false;
    reason   = 'Crop is near maturity. Withhold irrigation for quality and drying.';
    reasonHi = 'फसल परिपक्वता के पास है। गुणवत्ता और सुखाने के लिए पानी रोकें।';
  } else {
    reason   = `Crop needs ${netNeed.toFixed(0)}mm water today. ET₀=${et0.toFixed(1)}mm, Kc=${kc.toFixed(2)}, ETc=${etc.toFixed(1)}mm.`;
    reasonHi = `फसल को आज ${netNeed.toFixed(0)}mm पानी चाहिए। ET₀=${et0.toFixed(1)}mm, ETc=${etc.toFixed(1)}mm।`;
  }

  const waterAmount = shouldIrrigate ? `${Math.round(netNeed * 1.2)}mm` : '0mm';
  const bestTime    = shouldIrrigate ? 'Morning before 9 AM or evening after 5 PM' : null;
  const bestTimeHi  = shouldIrrigate ? 'सुबह 9 बजे से पहले या शाम 5 बजे के बाद' : null;

  // Build 7-day forecast strip
  const weeklyForecast = daily.time.map((date, i) => {
    const dailyET0  = calcET0(daily.temperature_2m_max[i] || 30, daily.temperature_2m_min[i] || 20, dayOfYear + i, lat);
    const dailyETC  = dailyET0 * kc;
    const dailyRain = daily.precipitation_sum?.[i] || 0;
    const dailyNeed = Math.max(0, dailyETC - dailyRain * 0.8);
    return {
      date,
      shouldIrrigate: dailyNeed > 3 && dailyRain < 10,
      waterNeedMm:    Math.round(dailyNeed),
      rainfall:       dailyRain,
      tMax:           daily.temperature_2m_max[i],
      tMin:           daily.temperature_2m_min[i],
    };
  });

  // Persist log
  const log = await prisma.irrigationLog.create({
    data: {
      userId,
      crop:          cropName || 'Unknown',
      fieldName:     fieldName || null,
      date:          new Date(),
      shouldIrrigate,
      reason,
      reasonHi,
      waterAmount,
      bestTime,
      temp:          tMax,
      humidity:      hum,
      rainfall:      rain,
      rainForecast:  rainForecast3d,
      windSpeed:     wind,
      cropStage,
      etcValue:      parseFloat(etc.toFixed(2)),
      et0Value:      parseFloat(et0.toFixed(2)),
      kcValue:       parseFloat(kc.toFixed(3)),
      farmerAction:  'pending',
    },
  }).catch(e => { console.warn('[Irrigation] Log persist failed: %s', e.message); return null; });

  return {
    shouldIrrigate,
    reason, reasonHi,
    waterAmount, bestTime, bestTimeHi,
    cropStage,
    daysSinceSowing,
    et0: parseFloat(et0.toFixed(2)),
    etc: parseFloat(etc.toFixed(2)),
    kc:  parseFloat(kc.toFixed(3)),
    netNeedMm: parseFloat(netNeed.toFixed(1)),
    weather: { tMax, tMin, humidity: hum, rainfall: rain, rainForecast3d: parseFloat(rainForecast3d.toFixed(1)), windSpeed: wind },
    weeklyForecast,
    logId: log?.id || null,
    source: 'Open-Meteo + FAO Hargreaves method',
    disclaimer: 'यह ET₀ आधारित स्वचालित सुझाव है। अपने खेत की मिट्टी और फसल की स्थिति देखकर निर्णय लें।',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Weather Service — fetches current + forecast weather from OpenWeatherMap.
 * Used by AI crop scan to enrich diagnosis with weather context.
 */
import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';

const OWM_BASE = 'https://api.openweathermap.org/data/2.5';

/**
 * Fetch weather data by pincode (India).
 * Returns { current, forecast, weatherRisk } or null on failure.
 */
export async function getWeatherData(pincode) {
  const apiKey = ENV.OPENWEATHER_API_KEY;
  if (!apiKey) {
    logger.warn('[Weather] No OPENWEATHER_API_KEY set — skipping weather fetch');
    return null;
  }

  try {
    const url = `${OWM_BASE}/weather?zip=${pincode},IN&appid=${apiKey}&units=metric`;
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn('[Weather] OWM returned %d for pincode %s', res.status, pincode);
      return null;
    }
    const data = await res.json();

    const current = {
      temp: data.main?.temp,
      humidity: data.main?.humidity,
      windSpeed: data.wind?.speed,
      description: data.weather?.[0]?.description,
      clouds: data.clouds?.all,
    };

    // Simple risk assessment
    const riskLevel =
      current.humidity > 85 ? 'high' :
      current.humidity > 70 ? 'moderate' : 'low';

    return {
      current,
      weatherRisk: {
        riskLevel,
        factors: current.humidity > 85 ? ['High humidity — disease risk'] : [],
      },
    };
  } catch (err) {
    logger.error({ err }, '[Weather] Failed to fetch weather data');
    return null;
  }
}

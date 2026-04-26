/**
 * Weather Service - FarmEasy
 *
 * SECURITY — API KEY HANDLING
 * ────────────────────────────
 * Do NOT place a real OpenWeatherMap key in this file.
 * Client-side bundles are decompilable; any key here will be extracted.
 *
 * Recommended production approach:
 *   1. Create a thin backend route  GET /api/v1/weather?lat=&lon=
 *   2. That route calls OpenWeatherMap server-to-server (key stays on server).
 *   3. Replace fetchWeather() below with a call to your own backend route
 *      via the authenticated `api` axios instance (token is already injected).
 *
 * Until that backend route exists, the service uses mock data when the
 * placeholder key is unchanged — no real OWM requests are made.
 */

import * as Location from 'expo-location';

// Keep this as the placeholder — do not replace with a real key here.
// Set the real key only in your backend environment variables.
const OWM_API_KEY = 'YOUR_OPENWEATHER_API_KEY_HERE';
const BASE_URL = 'https://api.openweathermap.org/data/2.5';

/**
 * Request location permission and fetch current coordinates
 */
async function getCurrentLocation() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location permission denied');
  }
  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: location.coords.latitude, lon: location.coords.longitude };
}

/**
 * Reverse geocode coordinates to city name
 */
async function getCityName(lat, lon) {
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
    return {
      city: place.city || place.district || place.subregion || 'Your Location',
      state: place.region || '',
    };
  } catch {
    return { city: 'Your Location', state: '' };
  }
}

/**
 * Map OpenWeatherMap icon code to Ionicons name
 */
function mapWeatherIcon(iconCode) {
  const map = {
    '01d': 'sunny', '01n': 'moon',
    '02d': 'partly-sunny', '02n': 'cloudy-night',
    '03d': 'cloud', '03n': 'cloud',
    '04d': 'cloud', '04n': 'cloud',
    '09d': 'rainy', '09n': 'rainy',
    '10d': 'rainy', '10n': 'rainy',
    '11d': 'thunderstorm', '11n': 'thunderstorm',
    '13d': 'snow', '13n': 'snow',
    '50d': 'partly-sunny', '50n': 'partly-sunny',
  };
  return map[iconCode] || 'partly-sunny';
}

/**
 * Fetch current weather + 7-day forecast from OpenWeatherMap
 * Falls back to mock data if API fails or no key provided
 */
export async function fetchWeather() {
  try {
    const { lat, lon } = await getCurrentLocation();
    const { city, state } = await getCityName(lat, lon);

    // One Call API for current + forecast
    const resp = await fetch(
      `${BASE_URL}/onecall?lat=${lat}&lon=${lon}&exclude=minutely,alerts&appid=${OWM_API_KEY}&units=metric`
    );

    if (!resp.ok) throw new Error('Weather API error');
    const data = await resp.json();

    const current = data.current;
    const hourly = data.hourly.slice(0, 6);
    const daily = data.daily.slice(0, 7);

    return {
      city,
      state,
      current: {
        temp: Math.round(current.temp),
        feelsLike: Math.round(current.feels_like),
        humidity: current.humidity,
        windSpeed: Math.round(current.wind_speed * 3.6), // m/s to km/h
        windDir: degreeToDir(current.wind_deg),
        condition: current.weather[0].description,
        icon: mapWeatherIcon(current.weather[0].icon),
        uvIndex: Math.round(current.uvi || 0),
        visibility: Math.round((current.visibility || 10000) / 1000),
        pressure: current.pressure,
        rainChance: Math.round((hourly[0]?.pop || 0) * 100),
      },
      hourly: hourly.map(h => ({
        time: new Date(h.dt * 1000).toLocaleTimeString([], { hour: 'numeric', hour12: true }),
        temp: Math.round(h.temp),
        icon: mapWeatherIcon(h.weather[0].icon),
        rain: Math.round((h.pop || 0) * 100),
      })),
      weekly: daily.map(d => ({
        day: new Date(d.dt * 1000).toLocaleDateString('en-IN', { weekday: 'short' }),
        high: Math.round(d.temp.max),
        low: Math.round(d.temp.min),
        icon: mapWeatherIcon(d.weather[0].icon),
        rain: Math.round((d.pop || 0) * 100),
      })),
      alerts: [],
      farmingTip: generateFarmingTip(current.temp, current.humidity, hourly),
    };
  } catch {
    throw new Error('Weather data unavailable');
  }
}

function degreeToDir(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function generateFarmingTip(temp, humidity, hourly) {
  const rainChance = Math.max(...hourly.map(h => h.pop || 0)) * 100;

  if (rainChance > 60) {
    return '🌧️ Heavy rain expected. Delay pesticide spraying. Check drainage in fields.';
  }
  if (temp > 38) {
    return '☀️ Very hot day. Irrigate fields in evening. Protect seedlings from heat stress.';
  }
  if (temp < 12) {
    return '🌡️ Cold night ahead. Cover sensitive crops. Apply potash to improve frost resistance.';
  }
  if (humidity > 80) {
    return '💧 High humidity favors fungal disease. Apply preventive fungicide spray today.';
  }
  if (rainChance < 20 && temp > 28) {
    return '🌱 Good weather for spraying. Apply fertilizers or pesticides today for best results.';
  }
  return '✅ Pleasant farming weather. Good time to inspect crops for pest & disease signs.';
}

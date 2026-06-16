/**
 * weatherBackground.js — maps a WMO weather code + local hour-of-day to one of
 * the 8 photo backdrops in assets/weather/. Shared single source of truth used
 * by WeatherHome (hero card) and ProfileScreen (header + body backdrop) so the
 * condition → image mapping never drifts between screens.
 *
 * Images live in assets/weather/ — see the naming guide in project docs.
 */

export const WEATHER_IMAGES = {
  rain_day:      require('../../assets/weather/wx_rain_day.jpg'),
  rain_night:    require('../../assets/weather/wx_rain_night.jpg'),
  thunderstorm:  require('../../assets/weather/wx_thunderstorm.jpg'),
  clear_night:   require('../../assets/weather/wx_clear_night.jpg'),
  clear_morning: require('../../assets/weather/wx_clear_morning.jpg'),
  clear_day:     require('../../assets/weather/wx_clear_day.jpg'),
  sunrise:       require('../../assets/weather/wx_sunrise.jpg'),
  cloudy:        require('../../assets/weather/wx_cloudy.jpg'),
};

/**
 * Pick the backdrop image for a WMO weather code + local hour.
 * @param {number} weatherCode  WMO code 0-99 (0-2 clear, 3-48 cloud/fog, 51-82 rain, 95-99 storm)
 * @param {number} hour         local hour 0-23 (e.g. new Date().getHours())
 * @returns a require()'d image module suitable for an <Image>/<ImageBackground> source.
 */
export function getWeatherImage(weatherCode, hour) {
  const isNight = hour < 6 || hour >= 19;

  if (weatherCode >= 95) return WEATHER_IMAGES.thunderstorm;             // WMO 95-99 — thunder/lightning
  if (weatherCode >= 51) return isNight                                   // WMO 51-82 — rain
    ? WEATHER_IMAGES.rain_night
    : WEATHER_IMAGES.rain_day;
  if (weatherCode >= 3)  return WEATHER_IMAGES.cloudy;                   // WMO 3-48  — overcast/fog

  // WMO 0-2 — clear sky, split by hour
  if (isNight)                        return WEATHER_IMAGES.clear_night;  // 19:00 – 05:59
  if (hour >= 5  && hour < 8)         return WEATHER_IMAGES.sunrise;      // early golden light
  if (hour >= 17 && hour < 20)        return WEATHER_IMAGES.sunrise;      // evening golden light
  if (hour >= 8  && hour < 10)        return WEATHER_IMAGES.clear_morning;// misty morning
  return WEATHER_IMAGES.clear_day;                                        // 10:00 – 16:59
}

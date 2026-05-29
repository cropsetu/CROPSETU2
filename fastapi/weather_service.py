"""
Weather Service — CropGuard Agentic AI

Fetches current weather + 7-day forecast using Open-Meteo (free, no API key needed).
Returns a unified dict consumed by the orchestrator and weather_rules.

Open-Meteo docs: https://open-meteo.com/en/docs
"""
from __future__ import annotations

import json
import logging
import time

import httpx

logger = logging.getLogger(__name__)

_BASE = "https://api.open-meteo.com/v1/forecast"

# ── Coordinate-bucketed cache ───────────────────────────────────────────────
# Open-Meteo's grid resolution is ~11 km, so requests within 0.1° of each
# other receive identical forecasts. Bucket lat/lon to 1 decimal place and
# share a single fetch across all callers in that bucket for 30 minutes —
# this cuts the per-scan latency and the ratelimit pressure on Open-Meteo
# (free tier: 10k req/day, easy to hit during a marketing push).
_WEATHER_TTL_SECONDS = 30 * 60
_WEATHER_NAMESPACE = "weather:om"

try:
    import redis as _redis_lib
    _redis = _redis_lib.Redis(host="localhost", port=6379, db=0, socket_connect_timeout=2)
    _redis.ping()
    _REDIS_OK = True
except Exception:
    _redis = None
    _REDIS_OK = False

_MEM: dict[str, tuple[dict, float]] = {}
_MEM_MAX = 200


def _cache_key(lat: float, lon: float) -> str:
    return f"{_WEATHER_NAMESPACE}:{round(lat, 1)}:{round(lon, 1)}"


def _cache_get(key: str) -> dict | None:
    if _REDIS_OK:
        try:
            raw = _redis.get(key)
            if raw:
                return json.loads(raw)
        except Exception:
            pass
    entry = _MEM.get(key)
    if entry:
        val, ts = entry
        if time.time() - ts < _WEATHER_TTL_SECONDS:
            return val
        _MEM.pop(key, None)
    return None


def _cache_set(key: str, value: dict) -> None:
    if _REDIS_OK:
        try:
            _redis.setex(key, _WEATHER_TTL_SECONDS, json.dumps(value))
            return
        except Exception:
            pass
    if len(_MEM) >= _MEM_MAX:
        oldest = min(_MEM, key=lambda k: _MEM[k][1])
        _MEM.pop(oldest, None)
    _MEM[key] = (value, time.time())


async def fetch_weather(lat: float, lon: float) -> dict:
    """
    Fetch current + 7-day forecast weather for a location.

    Results are cached by rounded coordinates for 30 minutes — see the
    module-level cache. Bypass the cache by calling _fetch_weather_uncached
    directly (used by tests).

    Returns:
      {
        "current": { temperature, humidity, dew_point, vpd, wind_speed, precipitation,
                     cloud_cover, weather_desc, apparent_temperature },
        "daily_forecast": [ { date, temp_max, temp_min, humidity_avg, precipitation_sum, ... }, ... ],
        "soil": { soil_temperature, soil_moisture },
        "location": { latitude, longitude },
      }
    """
    key = _cache_key(lat, lon)
    cached = _cache_get(key)
    if cached is not None:
        logger.info("[Weather] cache HIT lat=%.2f lon=%.2f", lat, lon)
        return cached

    result = await _fetch_weather_uncached(lat, lon)
    _cache_set(key, result)
    return result


async def _fetch_weather_uncached(lat: float, lon: float) -> dict:
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": ",".join([
            "temperature_2m", "relative_humidity_2m", "dew_point_2m",
            "apparent_temperature", "precipitation", "weather_code",
            "cloud_cover", "wind_speed_10m", "vapour_pressure_deficit",
        ]),
        "daily": ",".join([
            "temperature_2m_max", "temperature_2m_min",
            "precipitation_sum", "precipitation_probability_max",
            "wind_speed_10m_max",
        ]),
        "hourly": "soil_temperature_6cm,soil_moisture_3_to_9cm",
        "timezone": "Asia/Kolkata",
        "forecast_days": 7,
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(_BASE, params=params)
        resp.raise_for_status()
        data = resp.json()

    # Parse current
    cur = data.get("current", {})
    current = {
        "temperature": cur.get("temperature_2m"),
        "humidity": cur.get("relative_humidity_2m"),
        "dew_point": cur.get("dew_point_2m"),
        "apparent_temperature": cur.get("apparent_temperature"),
        "precipitation": cur.get("precipitation", 0),
        "cloud_cover": cur.get("cloud_cover"),
        "wind_speed": cur.get("wind_speed_10m"),
        "vpd": cur.get("vapour_pressure_deficit"),
        "weather_code": cur.get("weather_code", 0),
        "weather_desc": _weather_code_to_desc(cur.get("weather_code", 0)),
    }

    # Parse daily forecast
    daily_raw = data.get("daily", {})
    dates = daily_raw.get("time", [])
    daily_forecast = []
    for i, date in enumerate(dates):
        daily_forecast.append({
            "date": date,
            "temp_max": _safe_idx(daily_raw.get("temperature_2m_max"), i),
            "temp_min": _safe_idx(daily_raw.get("temperature_2m_min"), i),
            "precipitation_sum": _safe_idx(daily_raw.get("precipitation_sum"), i),
            "precipitation_probability": _safe_idx(daily_raw.get("precipitation_probability_max"), i),
            "wind_speed_max": _safe_idx(daily_raw.get("wind_speed_10m_max"), i),
        })

    # Parse soil (take first hourly value as representative)
    hourly = data.get("hourly", {})
    soil = {
        "soil_temperature": _safe_idx(hourly.get("soil_temperature_6cm"), 0),
        "soil_moisture": _safe_idx(hourly.get("soil_moisture_3_to_9cm"), 0),
    }

    result = {
        "current": current,
        "daily_forecast": daily_forecast,
        "soil": soil,
        "location": {"latitude": lat, "longitude": lon},
    }

    logger.info(
        "[Weather] lat=%.2f lon=%.2f temp=%.1f°C humidity=%s%% precip=%.1fmm",
        lat, lon,
        current.get("temperature") or 0,
        current.get("humidity") or "?",
        current.get("precipitation") or 0,
    )
    return result


def _safe_idx(arr: list | None, idx: int):
    if arr and idx < len(arr):
        return arr[idx]
    return None


def _weather_code_to_desc(code: int) -> str:
    """WMO weather code → human-readable description."""
    _MAP = {
        0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
        45: "Fog", 48: "Depositing rime fog",
        51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
        61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
        71: "Slight snowfall", 73: "Moderate snowfall", 75: "Heavy snowfall",
        80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
        95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
    }
    return _MAP.get(code, f"WMO code {code}")

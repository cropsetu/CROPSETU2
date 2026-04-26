"""
Rule-Based Weather Risk Analysis — CropGuard

Replaces the Groq/Gemini LLM call for weather analysis.
Zero cost, zero latency, fully deterministic.

Returns the same dict shape as the LLM weather_analysis_agent so the orchestrator
can drop this in as a zero-cost replacement.
"""
from __future__ import annotations
import logging
from typing import Optional

logger = logging.getLogger(__name__)


# ── Disease-condition matrix (temp °C, humidity %, leaf wetness hrs) ──────────
# Each entry: (disease_name, temp_min, temp_max, humidity_min, humidity_min_leaf_wet)
_DISEASE_CONDITIONS: list[tuple[str, float, float, float, float]] = [
    ("Powdery Mildew",     20, 28,  40,  0),
    ("Downy Mildew",       15, 22,  85,  4),
    ("Bacterial Blight",   25, 35,  80,  2),
    ("Rust",               15, 25,  90,  6),
    ("Fusarium Wilt",      20, 35,  60,  0),   # soil-temp driven; humidity proxy
    ("Late Blight",        10, 24,  90,  4),
    ("Early Blight",       24, 30,  80,  0),
    ("Anthracnose",        25, 35,  90,  3),
    ("Cercospora Leaf Spot", 25, 32, 80,  2),
    ("Alternaria Blight",  24, 30,  80,  0),
    ("Gray Mold (Botrytis)", 15, 22, 90, 4),
    ("Thrips / Aphids",    30, 45,   0,  0),   # triggered by HOT + DRY
]

_DRY_HOT_PESTS = {"Thrips / Aphids"}


def _favorable_diseases(temp: float, humidity: float, leaf_wet_hrs: float) -> list[str]:
    """Return list of diseases favored by current conditions."""
    result = []
    for name, tmin, tmax, hmin, lwet in _DISEASE_CONDITIONS:
        if name in _DRY_HOT_PESTS:
            # triggered by low humidity + high temp
            if temp > 30 and humidity < 50:
                result.append(name)
        else:
            if tmin <= temp <= tmax and humidity >= hmin and leaf_wet_hrs >= lwet:
                result.append(name)
    return result


def _analyze_forecast(daily: list[dict[str, float]]) -> str:
    """Summarise 7-day forecast rain/humidity risk."""
    if not daily:
        return "Forecast data not available"
    rain_days = sum(1 for d in daily if (d.get("rainfall") or 0) > 2)
    high_hum_days = sum(1 for d in daily if (d.get("humidity_max") or 0) > 75)
    if rain_days >= 4:
        return f"Heavy rain expected on {rain_days}/7 days — disease window will extend all week"
    elif rain_days >= 2:
        return f"Rain expected on {rain_days}/7 days — disease risk elevated mid-week"
    elif high_hum_days >= 4:
        return f"High humidity ({high_hum_days}/7 days) — fungal risk persists even without rain"
    elif rain_days == 0 and high_hum_days <= 1:
        return "Dry and low-humidity forecast — disease pressure likely to ease"
    else:
        return f"Scattered rain ({rain_days} days) — monitor crops every 2–3 days"


def _generate_advisory(risk: str, temp: float, humidity: float, vpd: float) -> str:
    """Generate actionable advisory based on risk level."""
    if risk == "CRITICAL":
        return (
            "CRITICAL: Apply preventive fungicide IMMEDIATELY — delay of 24+ hours risks "
            "severe crop loss. Avoid overhead irrigation. Remove infected plant material."
        )
    elif risk == "HIGH":
        return (
            f"HIGH RISK: Humidity {humidity:.0f}% + temp {temp:.0f}°C strongly favour fungal spread. "
            "Apply fungicide within 48 hours. Avoid overhead irrigation. Ensure good crop canopy airflow."
        )
    elif risk == "MODERATE":
        if humidity > 70:
            return (
                f"MODERATE: Monitor crop daily — conditions (humidity {humidity:.0f}%) "
                "can escalate quickly. Spray preventive fungicide if rain expected within 3 days."
            )
        elif temp > 32 and humidity < 45:
            return (
                f"MODERATE: Hot dry conditions (temp {temp:.0f}°C, humidity {humidity:.0f}%) "
                "favour mite and aphid pressure. Inspect leaf undersides daily."
            )
        return "MODERATE: Monitor crop regularly. Apply preventive fungicide as precaution."
    else:
        return "LOW: Conditions are currently unfavourable for most diseases. Continue regular monitoring."


def analyze_weather_risk_rules(
    weather_data: Optional[dict],
    crop_name: str = "",
    soil_type: str = "",
    growth_stage: str = "",
) -> dict:
    """
    Pure rule-based weather risk analysis. No LLM, no cost, ~0ms latency.
    Returns the same shape as run_weather_analysis_agent().
    """
    if not weather_data:
        return {
            "overall_disease_risk": "MODERATE",
            "risk_factors": ["Weather data unavailable — using conservative MODERATE risk defaults"],
            "favorable_diseases": [],
            "soil_risk": "UNKNOWN",
            "forecast_risk": "Forecast data not available",
            "advisory": "Monitor weather manually. Apply preventive fungicide if humidity exceeds 80%.",
            "weather_used": False,
        }

    current  = weather_data.get("current", {})
    daily    = weather_data.get("daily_forecast", [])[:7]
    soil     = weather_data.get("soil", {})

    temp      = float(current.get("temperature") or 25)
    humidity  = float(current.get("humidity") or 50)
    dew_point = float(current.get("dew_point") or 15)
    vpd       = float(current.get("vpd") or 1.0)
    wind      = float(current.get("wind_speed") or 0)
    precip    = float(current.get("precipitation") or 0)
    cloud     = float(current.get("cloud_cover") or 0)

    # Estimate leaf wetness hours from VPD + precipitation
    leaf_wet_hrs = 0.0
    if vpd < 0.4:
        leaf_wet_hrs += 6     # high leaf wetness when VPD very low
    elif vpd < 0.8:
        leaf_wet_hrs += 3
    if precip > 0.5:
        leaf_wet_hrs += 4     # recent rain
    if cloud > 70 and humidity > 75:
        leaf_wet_hrs += 2     # overcast + humid

    # ── Risk factors ──────────────────────────────────────────────────────────
    risk_factors: list[str] = []
    risk_score = 0   # 0=LOW, 1=MODERATE, 2=HIGH, 3=CRITICAL

    # Humidity check
    if humidity > 85:
        risk_factors.append(f"Very high humidity ({humidity:.0f}%) — critical fungal risk window")
        risk_score = max(risk_score, 3)
    elif humidity > 75:
        risk_factors.append(f"High humidity ({humidity:.0f}%) favors fungal disease spread")
        risk_score = max(risk_score, 2)
    elif humidity > 60:
        risk_factors.append(f"Moderate humidity ({humidity:.0f}%) — monitor regularly")
        risk_score = max(risk_score, 1)

    # Temperature check
    if 18 <= temp <= 28:
        risk_factors.append(f"Temperature ({temp:.0f}°C) in the ideal fungal-growth range")
        risk_score = max(risk_score, 2 if humidity > 70 else 1)
    elif temp > 32 and humidity < 50:
        risk_factors.append(f"Hot & dry ({temp:.0f}°C, {humidity:.0f}%) — pest/mite pressure elevated")
        risk_score = max(risk_score, 1)

    # VPD / leaf wetness
    if vpd < 0.3:
        risk_factors.append(f"Very low VPD ({vpd:.2f} kPa) — prolonged leaf wetness, critical for spore germination")
        risk_score = max(risk_score, 3)
    elif vpd < 0.6:
        risk_factors.append(f"Low VPD ({vpd:.2f} kPa) — leaves likely wet for extended periods")
        risk_score = max(risk_score, 2)

    # Wind (spore dispersal)
    if 10 < wind <= 20:
        risk_factors.append(f"Moderate wind ({wind:.0f} km/h) aids spore dispersal to new plants")
    elif wind > 20:
        risk_factors.append(f"High wind ({wind:.0f} km/h) rapidly spreads airborne spores across field")
        risk_score = max(risk_score, 2)

    # Precipitation
    if precip > 5:
        risk_factors.append(f"Recent rainfall ({precip:.1f} mm) — rain splash spreads bacterial and fungal spores")
        risk_score = max(risk_score, 2)
    elif precip > 0.5:
        risk_factors.append(f"Light rain ({precip:.1f} mm) — wet conditions increase infection risk")

    # Dew point
    if dew_point > (temp - 5):
        risk_factors.append(f"Dew point ({dew_point:.0f}°C) close to temp ({temp:.0f}°C) — dew likely overnight")
        risk_score = max(risk_score, 1)

    # ── Soil risk ─────────────────────────────────────────────────────────────
    soil_moisture_surf = float(soil.get("moisture_0_1cm", 0))
    soil_temp_6cm      = float(soil.get("temperature_6cm", 20))
    soil_risk = "LOW"
    if soil_moisture_surf > 0.30:
        soil_risk = "HIGH"
        risk_factors.append(f"High soil surface moisture ({soil_moisture_surf:.2f} m³/m³) — root rot / wilt risk")
    elif soil_moisture_surf > 0.18:
        soil_risk = "MODERATE"
        risk_factors.append(f"Moderate soil moisture ({soil_moisture_surf:.2f} m³/m³) — monitor root zone")
    if soil_temp_6cm > 26:
        risk_factors.append(f"Warm soil ({soil_temp_6cm:.0f}°C at 6cm) — Fusarium wilt / nematode risk")
        if soil_risk == "LOW":
            soil_risk = "MODERATE"

    # ── Overall risk level ────────────────────────────────────────────────────
    risk_levels = ["LOW", "MODERATE", "HIGH", "CRITICAL"]
    overall_risk = risk_levels[min(risk_score, 3)]

    # ── Favorable diseases ────────────────────────────────────────────────────
    favorable = _favorable_diseases(temp, humidity, leaf_wet_hrs)

    # ── Forecast risk ─────────────────────────────────────────────────────────
    forecast = _analyze_forecast(daily)

    # ── Advisory ──────────────────────────────────────────────────────────────
    advisory = _generate_advisory(overall_risk, temp, humidity, vpd)

    logger.info(
        f"[WeatherRules] risk={overall_risk}  temp={temp:.0f}°C  humidity={humidity:.0f}%  "
        f"vpd={vpd:.2f}kPa  leafWet≈{leaf_wet_hrs:.0f}hrs  favorable={favorable}"
    )

    return {
        "overall_disease_risk": overall_risk,
        "risk_factors":         risk_factors,
        "favorable_diseases":   favorable,
        "soil_risk":            soil_risk,
        "forecast_risk":        forecast,
        "advisory":             advisory,
        "weather_used":         True,
        "_rule_based":          True,  # marks as rule-based (not LLM)
    }

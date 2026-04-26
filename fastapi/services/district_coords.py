"""
District Coordinate Resolver — CropGuard

Resolves weather-lookup coordinates via priority chain:
  1. GPS (lat/lon from device)
  2. District center (lookup table)
  3. State capital fallback
  4. Default (central India)

Used by the orchestrator to ensure weather data is always available,
even when the user doesn't grant GPS permission.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# ── Indian State Capitals (lat, lon) ─────────────────────────────────────────
_STATE_CAPITALS: dict[str, tuple[float, float]] = {
    "andhra pradesh":    (16.5062, 80.6480),
    "arunachal pradesh": (27.0844, 93.6053),
    "assam":             (26.1445, 91.7362),
    "bihar":             (25.6093, 85.1376),
    "chhattisgarh":      (21.2514, 81.6296),
    "goa":               (15.4909, 73.8278),
    "gujarat":           (23.0225, 72.5714),
    "haryana":           (30.7333, 76.7794),
    "himachal pradesh":  (31.1048, 77.1734),
    "jharkhand":         (23.3441, 85.3096),
    "karnataka":         (12.9716, 77.5946),
    "kerala":            (8.5241, 76.9366),
    "madhya pradesh":    (23.2599, 77.4126),
    "maharashtra":       (19.0760, 72.8777),
    "manipur":           (24.8170, 93.9368),
    "meghalaya":         (25.5788, 91.8933),
    "mizoram":           (23.7271, 92.7176),
    "nagaland":          (25.6747, 94.1086),
    "odisha":            (20.2961, 85.8245),
    "punjab":            (30.7333, 76.7794),
    "rajasthan":         (26.9124, 75.7873),
    "sikkim":            (27.3389, 88.6065),
    "tamil nadu":        (13.0827, 80.2707),
    "telangana":         (17.3850, 78.4867),
    "tripura":           (23.8315, 91.2868),
    "uttar pradesh":     (26.8467, 80.9462),
    "uttarakhand":       (30.3165, 78.0322),
    "west bengal":       (22.5726, 88.3639),
}

# ── Major District Centers (state → district → (lat, lon)) ──────────────────
_DISTRICT_CENTERS: dict[str, dict[str, tuple[float, float]]] = {
    "maharashtra": {
        "pune":       (18.5204, 73.8567),
        "nashik":     (19.9975, 73.7898),
        "nagpur":     (21.1458, 79.0882),
        "aurangabad": (19.8762, 75.3433),
        "kolhapur":   (16.7050, 74.2433),
        "solapur":    (17.6599, 75.9064),
        "satara":     (17.6805, 74.0183),
        "sangli":     (16.8524, 74.5815),
        "ahmednagar": (19.0948, 74.7480),
        "jalgaon":    (21.0077, 75.5626),
        "thane":      (19.2183, 72.9781),
        "raigad":     (18.5158, 73.1822),
        "mumbai":     (19.0760, 72.8777),
    },
    "karnataka": {
        "bengaluru":  (12.9716, 77.5946),
        "mysuru":     (12.2958, 76.6394),
        "hubli":      (15.3647, 75.1240),
        "belgaum":    (15.8497, 74.4977),
        "mangalore":  (12.9141, 74.8560),
    },
    "tamil nadu": {
        "chennai":    (13.0827, 80.2707),
        "coimbatore": (11.0168, 76.9558),
        "madurai":    (9.9252, 78.1198),
        "trichy":     (10.7905, 78.7047),
        "salem":      (11.6643, 78.1460),
    },
    "uttar pradesh": {
        "lucknow":    (26.8467, 80.9462),
        "varanasi":   (25.3176, 82.9739),
        "agra":       (27.1767, 78.0081),
        "kanpur":     (26.4499, 80.3319),
        "prayagraj":  (25.4358, 81.8463),
    },
    "rajasthan": {
        "jaipur":     (26.9124, 75.7873),
        "jodhpur":    (26.2389, 73.0243),
        "udaipur":    (24.5854, 73.7125),
        "kota":       (25.2138, 75.8648),
    },
    "madhya pradesh": {
        "bhopal":     (23.2599, 77.4126),
        "indore":     (22.7196, 75.8577),
        "jabalpur":   (23.1815, 79.9864),
        "gwalior":    (26.2183, 78.1828),
    },
    "gujarat": {
        "ahmedabad":  (23.0225, 72.5714),
        "surat":      (21.1702, 72.8311),
        "vadodara":   (22.3072, 73.1812),
        "rajkot":     (22.3039, 70.8022),
    },
    "punjab": {
        "chandigarh": (30.7333, 76.7794),
        "ludhiana":   (30.9010, 75.8573),
        "amritsar":   (31.6340, 74.8723),
    },
    "west bengal": {
        "kolkata":    (22.5726, 88.3639),
        "siliguri":   (26.7271, 88.3953),
    },
}

# Default fallback: central India (Nagpur)
_DEFAULT_COORDS = (21.1458, 79.0882)


async def get_weather_coords(
    lat: float | None,
    lon: float | None,
    state: str = "",
    district: str = "",
    city: str = "",
) -> tuple[float, float, str]:
    """
    Resolve coordinates for weather lookup.

    Returns: (latitude, longitude, source)
    where source is one of: "gps", "district", "state", "default"
    """
    # 1. GPS coordinates provided
    if lat is not None and lon is not None:
        try:
            lat_f, lon_f = float(lat), float(lon)
            if -90 <= lat_f <= 90 and -180 <= lon_f <= 180:
                return lat_f, lon_f, "gps"
        except (ValueError, TypeError):
            pass

    state_lower = (state or "").lower().strip()
    district_lower = (district or city or "").lower().strip()

    # 2. District center lookup
    if state_lower and district_lower:
        state_districts = _DISTRICT_CENTERS.get(state_lower, {})
        for name, coords in state_districts.items():
            if name in district_lower or district_lower in name:
                logger.info("[Coords] Resolved via district: %s, %s", district_lower, state_lower)
                return coords[0], coords[1], "district"

    # 3. State capital fallback
    if state_lower and state_lower in _STATE_CAPITALS:
        coords = _STATE_CAPITALS[state_lower]
        logger.info("[Coords] Resolved via state capital: %s", state_lower)
        return coords[0], coords[1], "state"

    # 4. Default (central India)
    logger.warning("[Coords] No location resolved — using default (Nagpur)")
    return _DEFAULT_COORDS[0], _DEFAULT_COORDS[1], "default"

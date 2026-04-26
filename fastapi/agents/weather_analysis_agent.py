"""
Weather Analysis Agent — CropGuard Agentic AI

NOTE: The orchestrator now uses the rule-based weather_rules.py instead of this
LLM-based agent ($0 cost, deterministic). This module is kept for backward
compatibility — it simply delegates to weather_rules.analyze_weather_risk_rules.

If you need LLM-enhanced weather analysis in the future, this is the place to add it.
"""
from __future__ import annotations

import logging

from agents.llm_utils import empty_token_info
from services.weather_rules import analyze_weather_risk_rules

logger = logging.getLogger(__name__)


async def run_weather_analysis_agent(
    weather_data: dict | None,
    crop_name: str = "Unknown",
    soil_type: str = "Unknown",
    growth_stage: str = "Unknown",
) -> tuple[dict, dict]:
    """
    Analyse weather risk for crop disease.
    Returns (weather_risk_dict, token_info).

    Currently delegates to the rule-based engine (zero cost).
    """
    result = analyze_weather_risk_rules(
        weather_data=weather_data,
        crop_name=crop_name,
        soil_type=soil_type,
        growth_stage=growth_stage,
    )
    return result, empty_token_info("rule-based")

"""
Unit tests for services/state_language.py
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.state_language import lang_for_state, lang_display_name, STATE_TO_LANG


def test_known_state_returns_language():
    assert lang_for_state("Maharashtra") == "mr"
    assert lang_for_state("Tamil Nadu") == "ta"
    assert lang_for_state("Punjab") == "pa"
    assert lang_for_state("West Bengal") == "bn"
    assert lang_for_state("Kerala") == "ml"


def test_lookup_is_case_insensitive_and_strips_whitespace():
    assert lang_for_state("maharashtra") == "mr"
    assert lang_for_state("MAHARASHTRA") == "mr"
    assert lang_for_state("  Maharashtra  ") == "mr"
    assert lang_for_state("Tamil nadu") == "ta"


def test_unknown_state_returns_fallback():
    assert lang_for_state("Atlantis") == "en"
    assert lang_for_state("Atlantis", fallback="hi") == "hi"
    assert lang_for_state(None) == "en"
    assert lang_for_state("") == "en"


def test_hindi_belt_states_map_to_hindi():
    for s in ("Uttar Pradesh", "Bihar", "Rajasthan", "Madhya Pradesh", "Delhi"):
        assert lang_for_state(s) == "hi", s


def test_north_east_states_default_to_english():
    for s in ("Manipur", "Meghalaya", "Nagaland", "Mizoram", "Sikkim"):
        assert lang_for_state(s) == "en", s


def test_lang_display_name_returns_native_script():
    assert lang_display_name("mr") == "मराठी"
    assert lang_display_name("ta") == "தமிழ்"
    assert lang_display_name("pa") == "ਪੰਜਾਬੀ"
    assert lang_display_name("en") == "English"


def test_lang_display_name_unknown_returns_input():
    assert lang_display_name("xx") == "xx"


def test_state_map_covers_all_major_states():
    # Safety net — if someone removes Maharashtra by accident, this fails.
    must_have = {"Maharashtra", "Karnataka", "Tamil Nadu", "Punjab",
                 "Gujarat", "Uttar Pradesh", "West Bengal", "Kerala"}
    assert must_have.issubset(STATE_TO_LANG.keys())

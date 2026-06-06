"""
Tests for the cost-trimmed FarmMind chat pipeline:
  - short/medium text → ONE Writer call (follow-ups folded into the answer)
  - long/extra_long text → Writer + Enhancer (2 calls); follow-ups folded into the Enhancer
  - AI_CHAT_ENHANCER_ENABLED=false → single Writer pass even for long
  - voice → one Writer call; image → one CHAT_VISION call (type "text", NO card)
  - follow-ups are split off the answer with a single delimiter — the block is
    ALWAYS stripped, so a malformed block can never leak into the reply.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import services.chat_service as cs

M = cs._FOLLOWUP_MARKER  # "###FOLLOWUPS###"


# ── Pure helpers ──────────────────────────────────────────────────────────────

def test_split_followups_basic():
    raw = f"Use Mancozeb 75 WP @ 2.5 g/L.\n{M}\nWhen to spray again?\nIs it safe for bees?"
    ans, fu = cs._split_followups(raw, "text")
    assert ans == "Use Mancozeb 75 WP @ 2.5 g/L."
    assert fu == ["When to spray again?", "Is it safe for bees?"]


def test_split_followups_no_marker():
    assert cs._split_followups("Just an answer.", "text") == ("Just an answer.", [])


def test_split_followups_lowercase_marker_and_no_leak():
    raw = "Answer here.\n###followups###\nQuestion one here?"
    ans, fu = cs._split_followups(raw, "text")
    assert ans == "Answer here." and M not in ans and "###" not in ans
    assert fu == ["Question one here?"]


def test_parse_followups_json_array_and_caps():
    raw = '["q one?","q two?","q three?","q four?","q five?","q six?"]'
    assert len(cs._parse_followups(raw, "text")) == 5     # text cap
    assert len(cs._parse_followups(raw, "voice")) == 3    # voice cap


def test_length_directive_voice_override():
    assert "VOICE MODE" in cs._length_directive("extra_long", "voice")
    assert "60" in cs._length_directive("short", "text")
    assert cs._length_directive("bogus", "text") == cs._LENGTH_DIRECTIVES["short"]


# ── Branch routing (mock the LLM calls) ───────────────────────────────────────

class _Cfg:
    def __init__(self, feature, model):
        self.feature, self.model, self.api_key, self.base_url = feature, model, "k", None


_TOK = {"model": "gemini-2.5-flash", "input_tokens": 1, "output_tokens": 1, "total_tokens": 2}


def _patch(monkeypatch, *, text_outputs=None, vision_output=None):
    text_outputs = list(text_outputs or [])
    log = {"text": [], "vision": 0}

    async def fake_text(cfg, system, user):
        log["text"].append(cfg.feature)
        return (text_outputs.pop(0) if text_outputs else ""), _TOK

    async def fake_vision(cfg, system, user, images_b64, **kw):
        log["vision"] += 1
        assert images_b64 and images_b64[0]["data"]
        return vision_output, _TOK

    monkeypatch.setattr(cs, "get_feature_config", lambda f: _Cfg(f, "gemini-2.5-flash"))
    monkeypatch.setattr(cs, "call_llm_text", fake_text)
    monkeypatch.setattr(cs, "call_llm_vision", fake_vision)
    return log


def test_text_short_single_call(monkeypatch):
    monkeypatch.delenv("AI_CHAT_ENHANCER_ENABLED", raising=False)
    log = _patch(monkeypatch, text_outputs=[f"Short answer.\n{M}\nWhen to irrigate?\nWhich fertilizer?"])
    out = asyncio.run(cs.chat_with_farmmind("how to grow tomato?", [], {}, response_length="short"))
    assert log["text"] == ["CHAT_WRITER"]           # ONE call — enhancer gated out, follow-ups folded
    assert log["vision"] == 0
    assert out["type"] == "text" and out["structured_data"] is None
    assert out["reply"] == "Short answer."
    assert out["followUps"] == ["When to irrigate?", "Which fertilizer?"]


def test_text_long_writer_then_enhancer(monkeypatch):
    monkeypatch.delenv("AI_CHAT_ENHANCER_ENABLED", raising=False)
    log = _patch(monkeypatch, text_outputs=[
        "DRAFT answer",                                   # writer (draft, no follow-ups)
        f"FINAL enhanced answer\n{M}\nQ one?\nQ two?",    # enhancer (final + folded follow-ups)
    ])
    out = asyncio.run(cs.chat_with_farmmind("plan my season", [], {}, response_length="long"))
    assert log["text"] == ["CHAT_WRITER", "CHAT_ENHANCER"]   # TWO calls, no separate follow-up call
    assert out["reply"] == "FINAL enhanced answer"
    assert out["followUps"] == ["Q one?", "Q two?"]


def test_enhancer_disabled_single_pass(monkeypatch):
    monkeypatch.setenv("AI_CHAT_ENHANCER_ENABLED", "false")
    log = _patch(monkeypatch, text_outputs=[f"Only answer.\n{M}\nQ one?"])
    out = asyncio.run(cs.chat_with_farmmind("q?", [], {}, response_length="long"))  # long but disabled
    assert log["text"] == ["CHAT_WRITER"]
    assert out["reply"] == "Only answer." and out["followUps"] == ["Q one?"]


def test_voice_single_call(monkeypatch):
    monkeypatch.delenv("AI_CHAT_ENHANCER_ENABLED", raising=False)
    log = _patch(monkeypatch, text_outputs=[f"Spoken reply.\n{M}\nAur kya?\nKab spray?"])
    out = asyncio.run(cs.chat_with_farmmind("kab boun?", [], {}, mode="voice"))
    assert log["text"] == ["CHAT_WRITER"]            # one call, never the enhancer
    assert out["reply"] == "Spoken reply." and len(out["followUps"]) == 2


def test_image_single_vision_call(monkeypatch):
    log = _patch(monkeypatch, vision_output=f"I see a maize leaf. Here is what to do.\n{M}\nHow often to scout?\nSpray now?")
    image = {"data": "ZmFrZQ==", "mime_type": "image/jpeg"}
    out = asyncio.run(cs.chat_with_farmmind("what is this?", [], {"crops": [{"name": "Maize"}]}, image=image))
    assert log["vision"] == 1 and log["text"] == []   # ONE vision call, follow-ups folded in
    assert out["type"] == "text" and out["structured_data"] is None     # NO crop-disease card
    assert "maize leaf" in out["reply"] and M not in out["reply"]
    assert out["followUps"] == ["How often to scout?", "Spray now?"]


def test_followups_cannot_leak(monkeypatch):
    monkeypatch.setenv("AI_CHAT_ENHANCER_ENABLED", "false")
    leaky = f"Use Mancozeb.\n{M}\nReal question one?\nignore this junk"
    _patch(monkeypatch, text_outputs=[leaky])
    out = asyncio.run(cs.chat_with_farmmind("treat blight?", [], {}))
    assert out["reply"] == "Use Mancozeb." and M not in out["reply"]
    assert "Real question one?" in out["followUps"]


def test_chat_features_resolve_to_providers():
    from agents.llm_dispatch import get_feature_config
    for feat in ("CHAT_WRITER", "CHAT_ENHANCER", "CHAT_VISION"):
        cfg = get_feature_config(feat)
        assert cfg.provider in ("gemini", "anthropic", "openai_compatible")

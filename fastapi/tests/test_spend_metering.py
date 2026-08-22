"""Every AI path that burns tokens must reach the daily USD cap (claude.md §36).

§36 ends with "Ensure all AI paths that should be metered are actually metered."
They were not. Three of four meters were dead:

  /ai/chat and /ai/alerts   read token_info["total_cost_usd"], a key that only
                            exists on the orchestrator's rolled-up
                            pipeline_token_usage. A per-call token_info carries
                            "cost_usd", so cost was always 0.0, the `if cost > 0`
                            guard never opened, and record_spend never ran.
  /ai/chat/stream           the voice path — its `final` frame carries token_info
                            and nothing read it.
  /ai/soil-card-ocr         a vision call over a full-page photo, no meter at all.

So the "daily spend cap" measured scans only, which is exactly the defect those
call sites were written to fix. The bug was invisible because nothing throws: a
missing key reads as 0.0 and the guard quietly closes.

These tests assert on the KEY the producers actually emit, which is the thing
that was wrong. A test that fed a hand-built dict containing `total_cost_usd`
would have passed against the broken code.
"""
import pytest

from security.spend import cost_of
from agents.llm_utils import empty_token_info, _make_token_info
from services.chat_service import _new_usage, _accumulate


class TestCostOf:
    def test_reads_the_key_per_call_token_info_actually_emits(self):
        # This is the regression. Every one of these producers emits `cost_usd`.
        assert cost_of(_make_token_info("gemini-2.0-flash", 1000, 500)) > 0
        assert cost_of({"cost_usd": 0.0123}) == pytest.approx(0.0123)

    def test_reads_the_orchestrator_aggregate_shape_too(self):
        # pipeline_token_usage sums across stages and names it total_cost_usd.
        assert cost_of({"total_cost_usd": 0.05}) == pytest.approx(0.05)

    def test_a_zeroed_token_info_costs_nothing(self):
        assert cost_of(empty_token_info("none")) == 0.0

    def test_a_chat_turn_accumulated_across_calls_is_billable(self):
        # Chat makes several LLM calls per turn; the aggregate is what gets
        # metered, and it must not lose the cost on the way.
        agg = _new_usage("gemini-2.0-flash")
        for _ in range(3):
            _accumulate(agg, _make_token_info("gemini-2.0-flash", 800, 400))
        assert agg["calls"] == 3
        assert cost_of(agg) > 0
        assert cost_of(agg) == pytest.approx(agg["cost_usd"])

    @pytest.mark.parametrize("bad", [None, {}, {"cost_usd": None}, {"cost_usd": "abc"}])
    def test_never_raises_on_junk(self, bad):
        # Accounting must not be able to fail a reply the farmer already got.
        assert cost_of(bad) == 0.0

    def test_does_not_silently_return_zero_for_a_real_cost(self):
        # The shape of the original bug, stated directly: a dict that HAS a cost
        # under the producers' key must never read as free.
        assert cost_of({"cost_usd": 0.004, "total_tokens": 900}) != 0.0


class TestEveryPathIsWired:
    """The meters exist and are reachable from each route module."""

    def test_chat_and_stream_share_one_recorder(self):
        from routes import chat
        assert callable(chat._record_chat_spend)
        src = __import__("inspect").getsource(chat.ai_chat_stream)
        # The voice path must meter its final frame, not just the non-stream route.
        assert "_record_chat_spend" in src, "voice stream is not metered"

    def test_soil_ocr_has_a_recorder_and_calls_it(self):
        from routes import soil_ocr
        import inspect
        assert callable(soil_ocr._record_soil_ocr_spend)
        assert "_record_soil_ocr_spend" in inspect.getsource(soil_ocr.soil_card_ocr)

    def test_alerts_uses_cost_of(self):
        import inspect
        from services import alert_service
        src = inspect.getsource(alert_service._record_alert_spend)
        assert "cost_of" in src
        # Deliberately NOT asserting the string is absent — the comment there
        # names the old key to explain the bug, and that is worth keeping. The
        # precise check (code, not comments) is the last test in this class.

    def test_no_metering_site_still_reads_the_wrong_key_directly(self):
        # The guard against reintroduction. cost_of() may name both keys; the
        # call sites may not reach past it.
        import inspect
        from routes import chat, soil_ocr
        from services import alert_service
        for mod in (chat, soil_ocr, alert_service):
            src = inspect.getsource(mod)
            for line in src.splitlines():
                if "total_cost_usd" in line and "cost_of" not in line:
                    assert line.strip().startswith("#"), (
                        f"{mod.__name__} reads total_cost_usd outside cost_of(): {line.strip()}"
                    )

"""
Tests for security/auth.py, security/spend.py, and security/pii.py.

These cover the Express ↔ FastAPI handshake math, the per-user daily
spend cap, and the PII redaction filter.
"""
import hashlib
import hmac
import logging
import os
import subprocess
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from logging_config import setup_logging


# ══════════════════════════════════════════════════════════════════════════════
# Auth — HMAC math
# ══════════════════════════════════════════════════════════════════════════════

def test_hmac_matches_canonical_definition(monkeypatch):
    """The auth module's _compute() must produce a signature identical to the
    canonical formula. Any drift means Express and FastAPI will disagree."""
    monkeypatch.setenv("AI_SHARED_SECRET", "the-shared-secret-32-chars-or-more-xxx")
    import importlib
    import security.auth as auth_mod
    importlib.reload(auth_mod)

    ts = "1700000000"
    body_hash = hashlib.sha256(b'{"hello":"world"}').hexdigest()
    sig = auth_mod._compute(body_hash, ts, "POST", "/ai/scan")
    expected = hmac.new(
        b"the-shared-secret-32-chars-or-more-xxx",
        f"{ts}.POST./ai/scan.{body_hash}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    assert sig == expected


def test_hmac_different_path_yields_different_sig(monkeypatch):
    monkeypatch.setenv("AI_SHARED_SECRET", "secret-1234567890123456789012345678")
    import importlib, security.auth as auth_mod
    importlib.reload(auth_mod)
    ts = "1700000000"
    body_hash = hashlib.sha256(b"").hexdigest()
    sig_a = auth_mod._compute(body_hash, ts, "POST", "/ai/scan")
    sig_b = auth_mod._compute(body_hash, ts, "POST", "/ai/chat")
    assert sig_a != sig_b


def test_hmac_different_body_yields_different_sig(monkeypatch):
    monkeypatch.setenv("AI_SHARED_SECRET", "secret-1234567890123456789012345678")
    import importlib, security.auth as auth_mod
    importlib.reload(auth_mod)
    ts = "1700000000"
    h1 = hashlib.sha256(b"{}").hexdigest()
    h2 = hashlib.sha256(b'{"a":1}').hexdigest()
    sig_a = auth_mod._compute(h1, ts, "POST", "/ai/scan")
    sig_b = auth_mod._compute(h2, ts, "POST", "/ai/scan")
    assert sig_a != sig_b


def test_hmac_python_matches_node(monkeypatch):
    """End-to-end handshake: have Node compute a signature with the same
    inputs and confirm the Python side reproduces it byte-for-byte. This
    catches any drift in either implementation."""
    secret = "handshake-test-secret-1234567890ab"
    ts = "1700000000"
    path = "/ai/scan"
    body_hash = hashlib.sha256(b'{"images":[],"params":{}}').hexdigest()

    # Compute on the Python side
    monkeypatch.setenv("AI_SHARED_SECRET", secret)
    import importlib, security.auth as auth_mod
    importlib.reload(auth_mod)
    py_sig = auth_mod._compute(body_hash, ts, "POST", path)

    # Compute the same thing in Node via inline -e (gracefully skip if node missing)
    node_path = subprocess.run(
        ["which", "node"], capture_output=True, text=True,
    ).stdout.strip()
    if not node_path:
        pytest.skip("node not available on PATH")
    node_script = (
        f"const crypto = require('crypto'); "
        f"const sig = crypto.createHmac('sha256', '{secret}')"
        f".update('{ts}.POST.{path}.{body_hash}').digest('hex'); "
        f"process.stdout.write(sig);"
    )
    out = subprocess.run([node_path, "-e", node_script],
                         capture_output=True, text=True, timeout=10)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == py_sig


# ══════════════════════════════════════════════════════════════════════════════
# Spend cap
# ══════════════════════════════════════════════════════════════════════════════

def _fresh_spend(monkeypatch, cap=0.05):
    monkeypatch.setenv("DAILY_SPEND_CAP_USD", str(cap))
    monkeypatch.setenv("ANONYMOUS_DAILY_CAP_USD", str(cap))
    monkeypatch.setenv("SPEND_CAP_ENABLED", "true")
    import importlib, security.spend as spend
    importlib.reload(spend)
    # Wipe in-mem state from any prior tests so we start clean
    spend._MEM.clear()
    return spend


def _unique_uid(prefix="t") -> str:
    """User IDs unique per pytest invocation so Redis state from a previous
    run can't pollute the current test (Redis spend keys have 26h TTL)."""
    import uuid
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _wipe_spend_for(spend, user_id: str) -> None:
    """Best-effort wipe of both the in-mem AND Redis spend counters for one
    user so the test starts at 0.00 regardless of prior runs."""
    spend._MEM.pop(spend._today_key(user_id), None)
    if spend._REDIS_OK:
        try:
            ymd = spend._today_key(user_id)[1]
            spend._redis.delete(spend._redis_key(user_id, ymd))
        except Exception:
            pass


def test_spend_under_cap_does_not_raise(monkeypatch):
    spend = _fresh_spend(monkeypatch, cap=1.0)
    uid = _unique_uid("under")
    _wipe_spend_for(spend, uid)
    spend.record_spend(uid, 0.20)
    # Should NOT raise
    spend.check_under_cap(uid)
    assert spend.get_used(uid) == pytest.approx(0.20)


def test_spend_over_cap_raises_402(monkeypatch):
    from fastapi import HTTPException
    spend = _fresh_spend(monkeypatch, cap=0.05)
    uid = _unique_uid("over")
    _wipe_spend_for(spend, uid)
    spend.record_spend(uid, 0.06)
    with pytest.raises(HTTPException) as exc_info:
        spend.check_under_cap(uid)
    assert exc_info.value.status_code == 402
    detail = exc_info.value.detail
    assert detail["code"] == "daily_cap_reached"
    assert detail["used_usd"] >= 0.05
    assert detail["cap_usd"] == 0.05
    assert detail["resets_at_utc"]


def test_spend_record_negative_or_zero_ignored(monkeypatch):
    spend = _fresh_spend(monkeypatch, cap=1.0)
    uid = _unique_uid("zero")
    _wipe_spend_for(spend, uid)
    spend.record_spend(uid, 0.0)
    spend.record_spend(uid, -1.0)
    assert spend.get_used(uid) == 0


def test_spend_anonymous_uses_smaller_bucket(monkeypatch):
    monkeypatch.setenv("DAILY_SPEND_CAP_USD", "1.00")
    monkeypatch.setenv("ANONYMOUS_DAILY_CAP_USD", "0.01")
    monkeypatch.setenv("SPEND_CAP_ENABLED", "true")
    import importlib, security.spend as spend
    importlib.reload(spend)
    spend._MEM.clear()
    _wipe_spend_for(spend, "")   # wipe the anonymous bucket in Redis too
    spend.record_spend("", 0.02)
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        spend.check_under_cap("")
    assert ei.value.detail["cap_usd"] == 0.01


def test_spend_disabled_via_env(monkeypatch):
    monkeypatch.setenv("SPEND_CAP_ENABLED", "false")
    import importlib, security.spend as spend
    importlib.reload(spend)
    uid = _unique_uid("disabled")
    # When disabled, check_under_cap must be a no-op even after huge spend
    spend.record_spend(uid, 999.99)
    spend.check_under_cap(uid)  # must not raise


# ══════════════════════════════════════════════════════════════════════════════
# PII redaction
# ══════════════════════════════════════════════════════════════════════════════

def test_pii_scrub_text_gps(monkeypatch):
    import importlib
    monkeypatch.setenv("PII_REDACTION_ENABLED", "true")
    import security.pii as pii
    importlib.reload(pii)
    out = pii._scrub_text("Field GPS: lat=19.0765, lon=72.8777 — humid")
    assert "19.0765" not in out
    assert "72.8777" not in out
    assert "<lat>" in out
    assert "<lon>" in out


def test_pii_scrub_text_phone():
    from security.pii import _scrub_text
    out = _scrub_text("Reach me at +919876543210 anytime")
    assert "9876543210" not in out
    assert "<phone>" in out


def test_pii_scrub_text_email():
    from security.pii import _scrub_text
    out = _scrub_text("Send report to farmer@example.com")
    assert "farmer@example.com" not in out
    assert "<email>" in out


def test_pii_scrub_symptom_description():
    from security.pii import _scrub_text
    out = _scrub_text('symptom_description: "yellow halos appearing on lower leaves spreading upward fast"')
    assert "<redacted>" in out
    assert "yellow halos" not in out


def test_pii_filter_applies_to_log_records(monkeypatch, capsys):
    """End-to-end: install the filter, emit a record, and confirm the
    formatted output is scrubbed."""
    monkeypatch.setenv("LOG_FORMAT", "text")
    monkeypatch.setenv("PII_REDACTION_ENABLED", "true")
    import importlib
    import observability.logging as obs_log
    importlib.reload(obs_log)
    obs_log.setup_logging()

    import security.pii as pii
    importlib.reload(pii)
    pii.install()

    log = logging.getLogger("pii_test_child")
    log.warning("Field GPS: lat=19.07, lon=72.87 phone=9876543210")
    out = capsys.readouterr().out
    assert "<lat>" in out
    assert "<lon>" in out
    assert "<phone>" in out
    assert "19.07" not in out
    assert "9876543210" not in out

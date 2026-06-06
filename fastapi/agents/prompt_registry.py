"""
Prompt Registry — CropGuard

Loads versioned prompts from disk, hashes their content for replay/audit,
and exposes a single `load_prompt(name)` entrypoint. Every diagnosis the
pipeline emits carries the prompt name + version + hash in `report.meta`
so we can:

  • Roll back a prompt regression without redeploying the app
    (drop a `.disabled` next to the bad version, bump ACTIVE map)
  • Replay historical scans against a new prompt (stored hash uniquely
    identifies the prompt text that ran)
  • A/B test by routing N% of requests to a v2 file (future work — the
    registry already returns a (name, version) tuple ready for branching)

Files live at agents/prompts/<name>.<version>.md and are pure text — no
templating, no f-strings, no escape headaches. Reviewers can diff them
in a PR without grokking Python.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).parent / "prompts"

# Active version per prompt name. Two shapes are accepted:
#
#   "diagnose": "v1"                          # single version — 100 % traffic
#   "diagnose": {"v1": 0.90, "v2": 0.10}     # weighted A/B (weights sum to 1.0)
#
# When you ship a candidate v2, drop the .md next to v1 and switch the
# value here to the dict form with a small weight on v2 (5–10 %). Bucketing
# is STICKY by user_id (or anonymous bucket id) — a given farmer always
# sees the same variant across attempts, so we never tell them "Late Blight"
# on attempt 1 and "Septoria" on attempt 2 due to A/B flip-flop.
#
# The full prompt history stays on disk; older versions are loadable by
# explicit (name, version) for eval replay.
ACTIVE_VERSIONS: dict[str, str | dict[str, float]] = {
    # v2 is THE production diagnose prompt (strict naming + per-crop candidate
    # narrowing + Healthy path). v1.md stays on disk only for historical eval
    # replay (eval/replay.py, eval/load_eval.py via AI_DIAGNOSE_VERSION) — it is
    # never served to live traffic.
    "diagnose":  "v2",
    "treatment": "v1",
}


@dataclass(frozen=True)
class Prompt:
    name:    str
    version: str
    text:    str
    hash:    str   # first 12 hex chars of SHA-256 — short enough for logs

    def meta(self) -> dict:
        return {"name": self.name, "version": self.version, "hash": self.hash}


_cache: dict[tuple[str, str], Prompt] = {}
_lock = Lock()


# ── A/B variant resolution ──────────────────────────────────────────────────

def _resolve_version(name: str, bucket_id: str | None) -> str:
    """
    Resolve which version a given bucket_id should see for this prompt.

    Single-version active map → return the version unchanged.
    Dict active map → hash bucket_id into [0,1) and find the matching slot.

    Sticky property: hashing the bucket_id deterministically means the same
    user always lands in the same variant across requests, which is what
    you want for A/B (don't flip-flop a farmer's diagnosis prompt mid-week).
    """
    active = ACTIVE_VERSIONS.get(name)
    if active is None:
        raise KeyError(f"Unknown prompt {name!r}. Register it in ACTIVE_VERSIONS.")
    if isinstance(active, str):
        return active
    if not isinstance(active, dict) or not active:
        raise ValueError(f"Bad ACTIVE_VERSIONS[{name!r}] entry: {active!r}")

    # Normalise weights so they sum to 1.0 (operator typo guard).
    total = sum(float(w) for w in active.values()) or 1.0
    normalised = [(ver, float(w) / total) for ver, w in active.items()]
    normalised.sort()   # alphabetical ordering for deterministic bucketing

    # Hash bucket_id → [0, 1). Empty bucket_id → bucket on the hash of the
    # prompt name itself, so anonymous traffic still distributes across
    # variants instead of all-or-nothing landing in one bucket.
    key = (bucket_id or f"anon:{name}").encode("utf-8")
    h = hashlib.sha256(key + name.encode()).digest()
    # First 4 bytes → uint32 → [0, 1)
    n = int.from_bytes(h[:4], "big") / (1 << 32)

    acc = 0.0
    for ver, w in normalised:
        acc += w
        if n < acc:
            return ver
    return normalised[-1][0]  # safety net


def _load_from_disk(name: str, version: str) -> Prompt:
    path = _PROMPTS_DIR / f"{name}.{version}.md"
    if not path.exists():
        raise FileNotFoundError(
            f"Prompt file missing: {path}. Have you committed the v1 file? "
            f"See agents/prompts/README for the contract."
        )
    text = path.read_text(encoding="utf-8")
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]
    return Prompt(name=name, version=version, text=text, hash=digest)


def load_prompt(
    name: str,
    version: str | None = None,
    *,
    bucket_id: str | None = None,
) -> Prompt:
    """
    Return a cached Prompt.

    Resolution order:
      1. Explicit `version` argument (used by the eval harness to replay
         against a specific historical version regardless of A/B config).
      2. Sticky A/B variant for `bucket_id` (typically user_id; falls
         back to a per-prompt-name anonymous bucket).
      3. Single active version when no A/B is configured.
    """
    resolved_version = version or _resolve_version(name, bucket_id)
    key = (name, resolved_version)
    with _lock:
        cached = _cache.get(key)
        if cached:
            return cached
        prompt = _load_from_disk(name, resolved_version)
        _cache[key] = prompt
        logger.info(
            "[PromptRegistry] loaded %s@%s hash=%s (len=%d)",
            name, resolved_version, prompt.hash, len(prompt.text),
        )
        return prompt


def all_active() -> dict[str, dict]:
    """
    Snapshot of every active prompt's metadata for /health. When A/B is
    configured for a prompt, returns the WEIGHTS map and a per-variant
    meta block (hash, etc.) so ops can see the full traffic split.
    """
    out: dict[str, dict] = {}
    for n, active in ACTIVE_VERSIONS.items():
        if isinstance(active, dict):
            out[n] = {
                "variants": {
                    ver: load_prompt(n, version=ver).meta() | {"weight": float(w)}
                    for ver, w in active.items()
                },
            }
        else:
            out[n] = load_prompt(n, version=active).meta()
    return out

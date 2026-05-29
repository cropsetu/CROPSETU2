"""
Chemical Registry — CropGuard

Versioned, in-code source of truth for:
  • Banned pesticides (central + state-level)
  • CIB&RC-registered active ingredients with FRAC/IRAC group + baseline PHI
  • Brand-name aliases used by Indian farmers (for hallucination detection)

The registry is intentionally a Python dict (not JSON) for v1 — it's
import-fast, type-checked, and diffs cleanly in PRs. Move to Postgres
+ a CIB&RC PDF sync job when the list grows past ~200 entries.

REGISTRY_VERSION bumps on every change. The validator stamps this version
into the report meta so we can replay against historical decisions.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

REGISTRY_VERSION = "2026.05.28-r1"
REGISTRY_SOURCES = (
    "CIB&RC Annexure-VI (2024)",
    "Insecticides Act 1968 (Central + state amendments)",
    "FRAC/IRAC/HRAC code lists",
)


# ── 1. Banned actives ────────────────────────────────────────────────────────
# Lowercased active-ingredient names. State scope is annotated where the ban
# is regional rather than central. Order is the registry's history of bans;
# do not reorder casually — the audit log references positions for clarity.
BANNED_ACTIVES: dict[str, dict] = {
    "monocrotophos":   {"scope": "central", "since": "2020", "reason": "Acute toxicity (Class I), persistent residues"},
    "endosulfan":      {"scope": "central", "since": "2011", "reason": "Persistent organic pollutant, neurotoxic"},
    "methyl parathion":{"scope": "central", "since": "2018", "reason": "Highly toxic OP, banned across crops"},
    "phorate":         {"scope": "central", "since": "2020", "reason": "Class I extreme hazard, banned on most crops"},
    "triazophos":      {"scope": "central", "since": "2020", "reason": "Acute toxicity, bee-toxic"},
    "phosphamidon":    {"scope": "central", "since": "2020", "reason": "Class I, banned for use"},
    "carbofuran":      {"scope": "central", "since": "2020", "reason": "Acute toxicity, bird/bee kills"},
    "dichlorvos":      {"scope": "restricted", "since": "2020", "reason": "Banned on many crops; restricted elsewhere"},
    "lindane":         {"scope": "central", "since": "2011", "reason": "Organochlorine, POP"},
    "aldrin":          {"scope": "central", "since": "2003", "reason": "Organochlorine, banned globally"},
    "chlordane":       {"scope": "central", "since": "2003", "reason": "Organochlorine, banned globally"},
    "heptachlor":      {"scope": "central", "since": "2003", "reason": "Organochlorine, banned globally"},
    "ddt":             {"scope": "agricultural-banned", "since": "1989", "reason": "Banned for agriculture (limited public-health use only)"},
    "ethion":          {"scope": "central", "since": "2018", "reason": "OP, banned"},
    "methomyl":        {"scope": "central", "since": "2018", "reason": "Class I extreme hazard"},
    "trichlorfon":     {"scope": "central", "since": "2018", "reason": "OP, banned on food crops"},
}


# ── 2. Registered actives ────────────────────────────────────────────────────
# Minimal CIB&RC-registered list with the metadata the validator needs.
# Add more as we encounter them in production logs — the validator marks
# any unknown active as "unverified" rather than rejecting, so an
# incomplete registry only degrades to "needs human review".
@dataclass(frozen=True)
class RegisteredActive:
    name: str                       # canonical lowercase
    aliases: tuple[str, ...] = ()   # alternate spellings the LLM might emit
    pesticide_type: str = "fungicide"   # fungicide | insecticide | bactericide | herbicide | nematicide
    frac_irac_group: str = ""       # canonical group code, e.g. "FRAC M03"
    phi_days_default: int = 7       # safe baseline if LLM omits
    rei_hours_default: int = 24
    pollinator_safety: str = "caution"  # safe | caution | avoid_during_bloom
    notes: str = ""


REGISTERED_ACTIVES: dict[str, RegisteredActive] = {
    a.name: a for a in (
        # Fungicides — contact / multi-site
        RegisteredActive("mancozeb",        ("dithane",),         "fungicide",  "FRAC M03", 3,  24, "safe"),
        RegisteredActive("chlorothalonil",  (),                   "fungicide",  "FRAC M05", 7,  24, "safe"),
        RegisteredActive("copper oxychloride", ("blitox",),       "fungicide",  "FRAC M01", 5,  24, "safe"),
        RegisteredActive("bordeaux mixture",("bordeaux",),        "fungicide",  "FRAC M01", 5,  24, "safe"),
        RegisteredActive("captan",          (),                   "fungicide",  "FRAC M04", 7,  24, "safe"),
        RegisteredActive("zineb",           (),                   "fungicide",  "FRAC M03", 7,  24, "safe"),
        # Fungicides — systemic
        RegisteredActive("propiconazole",   ("tilt",),            "fungicide",  "FRAC 3",   14, 24, "caution"),
        RegisteredActive("tebuconazole",    ("folicur",),         "fungicide",  "FRAC 3",   21, 24, "caution"),
        RegisteredActive("difenoconazole",  ("score",),           "fungicide",  "FRAC 3",   14, 24, "caution"),
        RegisteredActive("hexaconazole",    ("contaf",),          "fungicide",  "FRAC 3",   21, 24, "caution"),
        RegisteredActive("azoxystrobin",    ("amistar",),         "fungicide",  "FRAC 11",  7,  12, "safe"),
        RegisteredActive("trifloxystrobin", (),                   "fungicide",  "FRAC 11",  7,  12, "safe"),
        RegisteredActive("metalaxyl",       ("metalaxyl-m", "ridomil"), "fungicide", "FRAC 4", 14, 24, "safe"),
        RegisteredActive("cymoxanil",       (),                   "fungicide",  "FRAC 27",  10, 24, "safe"),
        RegisteredActive("dimethomorph",    (),                   "fungicide",  "FRAC 40",  7,  24, "safe"),
        RegisteredActive("fosetyl-al",      ("aliette",),         "fungicide",  "FRAC P07", 14, 24, "safe"),
        # Insecticides
        RegisteredActive("imidacloprid",    ("confidor",),        "insecticide","IRAC 4A",  21, 12, "avoid_during_bloom"),
        RegisteredActive("thiamethoxam",    ("actara",),          "insecticide","IRAC 4A",  21, 12, "avoid_during_bloom"),
        RegisteredActive("acetamiprid",     (),                   "insecticide","IRAC 4A",  14, 12, "caution"),
        RegisteredActive("spinosad",        ("tracer",),          "insecticide","IRAC 5",   3,  4,  "caution"),
        RegisteredActive("emamectin benzoate", ("proclaim",),     "insecticide","IRAC 6",   7,  12, "caution"),
        RegisteredActive("chlorantraniliprole", ("coragen",),     "insecticide","IRAC 28",  3,  12, "safe"),
        RegisteredActive("flubendiamide",   ("fame",),            "insecticide","IRAC 28",  5,  12, "safe"),
        RegisteredActive("lambda-cyhalothrin", ("karate",),       "insecticide","IRAC 3A",  7,  24, "avoid_during_bloom"),
        RegisteredActive("deltamethrin",    ("decis",),           "insecticide","IRAC 3A",  7,  12, "avoid_during_bloom"),
        # Bactericides
        RegisteredActive("streptomycin sulphate", ("streptocycline",), "bactericide", "FRAC 25", 7, 12, "safe"),
        # Biologicals
        RegisteredActive("trichoderma viride",   (),              "fungicide",  "BIO",      0,  0, "safe", "Bio-control agent"),
        RegisteredActive("trichoderma harzianum",(),              "fungicide",  "BIO",      0,  0, "safe", "Bio-control agent"),
        RegisteredActive("pseudomonas fluorescens", (),           "fungicide",  "BIO",      0,  0, "safe", "Bio-control agent"),
        RegisteredActive("bacillus subtilis",    (),              "fungicide",  "BIO",      0,  0, "safe", "Bio-control agent"),
        RegisteredActive("beauveria bassiana",   (),              "insecticide","BIO",      0,  0, "safe", "Entomopathogenic fungus"),
    )
}


# Alias → canonical active. Built once at import time so lookups are O(1).
_ALIAS_INDEX: dict[str, str] = {}
for canonical, entry in REGISTERED_ACTIVES.items():
    _ALIAS_INDEX[canonical] = canonical
    for alias in entry.aliases:
        _ALIAS_INDEX[alias.lower()] = canonical


# ── 3. State-level extra bans ────────────────────────────────────────────────
# Some states ban or restrict actives that the centre permits. The validator
# pulls the farmer's state from params and applies the union of (central +
# state) bans.
STATE_LEVEL_BANS: dict[str, set[str]] = {
    "kerala": {
        "chlorpyrifos", "imidacloprid", "thiamethoxam", "acetamiprid",
        "lambda-cyhalothrin", "deltamethrin", "atrazine", "paraquat",
        "glyphosate", "2,4-d",
    },
    "punjab": {
        # Restricted set — varies year to year; conservative list.
        "monocrotophos", "phorate",  # already central; redundancy is fine
    },
    "sikkim": {
        # Sikkim is a fully organic state — all synthetic pesticides barred.
        # The validator handles this specially (see is_state_organic).
    },
}

FULLY_ORGANIC_STATES = {"sikkim"}


# ── 4. Public lookup helpers ─────────────────────────────────────────────────

_NON_WORD = re.compile(r"[^\w\s+-]")


def _normalise(name: str) -> str:
    """Lowercase + strip punctuation that varies between LLM outputs.
    E.g. 'Mancozeb 75% WP' → 'mancozeb 75 wp'."""
    if not name:
        return ""
    s = name.lower()
    s = _NON_WORD.sub(" ", s)
    return " ".join(s.split())


def find_active(query: str) -> RegisteredActive | None:
    """Resolve an LLM-emitted product name to a canonical registered active.
    Tries: exact match → alias match → substring match. Returns None if
    the query is unknown (which the validator treats as 'unverified')."""
    q = _normalise(query)
    if not q:
        return None
    # 1. Direct canonical hit
    if q in REGISTERED_ACTIVES:
        return REGISTERED_ACTIVES[q]
    # 2. Alias hit
    if q in _ALIAS_INDEX:
        return REGISTERED_ACTIVES[_ALIAS_INDEX[q]]
    # 3. Token-overlap (product names often suffix concentration/formulation)
    tokens = set(q.split())
    for canonical in REGISTERED_ACTIVES:
        canon_tokens = set(canonical.split())
        if canon_tokens and canon_tokens.issubset(tokens):
            return REGISTERED_ACTIVES[canonical]
    # 4. Alias substring
    for alias, canonical in _ALIAS_INDEX.items():
        if alias and alias in q:
            return REGISTERED_ACTIVES[canonical]
    return None


def is_banned(query: str, state: str | None = None) -> tuple[bool, str]:
    """Return (banned, reason). State name is case-insensitive; empty/None
    skips state-level checks."""
    q = _normalise(query)
    if not q:
        return False, ""
    for banned, meta in BANNED_ACTIVES.items():
        if banned in q:
            return True, f"{meta['scope']} ban since {meta['since']} — {meta['reason']}"
    state_key = (state or "").lower().strip()
    if state_key and state_key in STATE_LEVEL_BANS:
        for banned in STATE_LEVEL_BANS[state_key]:
            if banned in q:
                return True, f"banned in {state_key.title()} (state-level restriction)"
    return False, ""


def is_state_organic(state: str | None) -> bool:
    return (state or "").lower().strip() in FULLY_ORGANIC_STATES

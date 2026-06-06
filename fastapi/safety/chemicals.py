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

REGISTRY_VERSION = "2026.06.06-r2"
REGISTRY_SOURCES = (
    "CIB&RC Annexure-VI (2024)",
    "Insecticides Act 1968 (Central + state amendments)",
    "FRAC/IRAC/HRAC code lists",
)


# ── 1. Banned actives ────────────────────────────────────────────────────────
# Lowercased active-ingredient names. State scope is annotated where the ban
# is regional rather than central. Order is the registry's history of bans;
# do not reorder casually — the audit log references positions for clarity.
# Sourced from the CIB&RC / PPQS "List of pesticides banned, refused
# registration and restricted in use" + the Insecticides (Prohibition) Order,
# 2023. VERIFY against the latest PPQS gazette before relying on it in prod —
# this is a living list (see ppqs.gov.in). Bumping REGISTRY_VERSION above
# auto-invalidates the treatment cache so a new ban takes effect immediately.
BANNED_ACTIVES: dict[str, dict] = {
    # ── Organochlorines / POPs (banned 1989–2011) ──
    "ddt":             {"scope": "agricultural-banned", "since": "1989", "reason": "Banned for agriculture (limited public-health use only)"},
    "toxaphene":       {"scope": "central", "since": "1989", "reason": "Organochlorine POP (camphechlor)"},
    "dibromochloropropane": {"scope": "central", "since": "1989", "reason": "DBCP — banned"},
    "pentachloronitrobenzene": {"scope": "central", "since": "1989", "reason": "PCNB — banned"},
    "endrin":          {"scope": "central", "since": "1990", "reason": "Organochlorine POP"},
    "aldrin":          {"scope": "central", "since": "2003", "reason": "Organochlorine POP, banned globally"},
    "chlordane":       {"scope": "central", "since": "2003", "reason": "Organochlorine POP"},
    "heptachlor":      {"scope": "central", "since": "2003", "reason": "Organochlorine POP"},
    "dieldrin":        {"scope": "central", "since": "2001", "reason": "Organochlorine POP"},
    "benzene hexachloride": {"scope": "central", "since": "1997", "reason": "BHC/HCH — banned"},
    "lindane":         {"scope": "central", "since": "2011", "reason": "Organochlorine (gamma-HCH), POP"},
    "endosulfan":      {"scope": "central", "since": "2011", "reason": "Persistent, neurotoxic; SC-ordered ban"},
    # ── 2001 order ──
    "aldicarb":        {"scope": "central", "since": "2001", "reason": "Class Ia carbamate — banned"},
    "chlorobenzilate": {"scope": "central", "since": "2001", "reason": "Banned"},
    "ethylene dibromide": {"scope": "central", "since": "2001", "reason": "EDB — banned"},
    "maleic hydrazide":{"scope": "central", "since": "2001", "reason": "Banned"},
    "paraquat dimethyl sulfate": {"scope": "central", "since": "2001", "reason": "Banned formulation"},
    "trichloroacetic acid": {"scope": "central", "since": "2001", "reason": "TCA — banned"},
    "menazon":         {"scope": "central", "since": "1996", "reason": "Banned"},
    "metoxuron":       {"scope": "central", "since": "1996", "reason": "Banned"},
    "nitrofen":        {"scope": "central", "since": "1996", "reason": "Banned"},
    "tetradifon":      {"scope": "central", "since": "1996", "reason": "Banned"},
    # ── 2018 prohibition order (S.O. 3951(E); some effective 2020) ──
    "alachlor":        {"scope": "central", "since": "2018", "reason": "2018 prohibition order"},
    "benomyl":         {"scope": "central", "since": "2018", "reason": "2018 prohibition order"},
    "carbaryl":        {"scope": "central", "since": "2018", "reason": "2018 prohibition order"},
    "diazinon":        {"scope": "central", "since": "2018", "reason": "2018 prohibition order"},
    "dichlorvos":      {"scope": "central", "since": "2018", "reason": "DDVP — 2018 prohibition order"},
    "fenarimol":       {"scope": "central", "since": "2018", "reason": "2018 prohibition order"},
    "fenthion":        {"scope": "central", "since": "2018", "reason": "2018 prohibition order"},
    "linuron":         {"scope": "central", "since": "2018", "reason": "2018 prohibition order"},
    "methoxy ethyl mercury chloride": {"scope": "central", "since": "2018", "reason": "Organomercury — 2018 order"},
    "methyl parathion":{"scope": "central", "since": "2018", "reason": "Highly toxic OP — 2018 order"},
    "sodium cyanide":  {"scope": "central", "since": "2018", "reason": "2018 order (insecticidal use)"},
    "thiometon":       {"scope": "central", "since": "2018", "reason": "2018 prohibition order"},
    "tridemorph":      {"scope": "central", "since": "2018", "reason": "2018 prohibition order"},
    "trichlorfon":     {"scope": "central", "since": "2018", "reason": "OP — 2018 prohibition order"},
    "ethion":          {"scope": "central", "since": "2018", "reason": "OP — banned"},
    "phorate":         {"scope": "central", "since": "2020", "reason": "Class I — 2018 order, effective 2020"},
    "phosphamidon":    {"scope": "central", "since": "2020", "reason": "Class I — 2018 order, effective 2020"},
    "triazophos":      {"scope": "central", "since": "2020", "reason": "Bee-toxic — 2018 order, effective 2020"},
    # ── Insecticides (Prohibition) Order, 2023 ──
    "dicofol":         {"scope": "central", "since": "2023", "reason": "2023 Prohibition Order"},
    "dinocap":         {"scope": "central", "since": "2023", "reason": "2023 Prohibition Order"},
    "methomyl":        {"scope": "central", "since": "2023", "reason": "Class I — 2023 Prohibition Order"},
    "monocrotophos":   {"scope": "central", "since": "2023", "reason": "2023 Prohibition Order (1-yr phase-out)"},
    # ── Other historically-banned arsenicals / organomercurials / OPs ──
    "ethyl parathion": {"scope": "central", "since": "1990", "reason": "Parathion — banned"},
    "phenylmercury acetate": {"scope": "central", "since": "1990", "reason": "Organomercury — banned"},
    "calcium cyanide": {"scope": "central", "since": "1990", "reason": "Banned"},
    "copper acetoarsenite": {"scope": "central", "since": "1990", "reason": "Paris green — banned"},
    "sodium methanearsonate": {"scope": "central", "since": "1990", "reason": "Arsenical — banned"},
    "chlorfenvinphos": {"scope": "central", "since": "1990", "reason": "Banned"},
    "pentachlorophenol": {"scope": "central", "since": "1991", "reason": "Banned"},
    # ── Restricted-use (blocked here conservatively; verify crop-specific allowances) ──
    "carbofuran":      {"scope": "restricted", "since": "2020", "reason": "Restricted — only 3% CG formulation permitted"},
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

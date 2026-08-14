"""
Treatment Validator — CropGuard

Runs AFTER the treatment LLM call and BEFORE the response is cached or
returned. Treats every LLM-emitted chemical as untrusted input and:

  • drops banned actives (central + state-level)
  • marks unknown actives as unverified (needs human review)
  • clamps PHI / REI to registry baselines when the LLM omits or low-balls
  • forces pollinator_safety="avoid_during_bloom" when crop is flowering
    and active is known bee-toxic
  • runs the policy gate — if chemicals are disallowed by confidence /
    crop_mismatch / pathogen_type, strips chemical_controls entirely and
    replaces with culture+biological measures

Output:
  ValidationResult(
    sanitized_treatment: dict,    # treatment dict with unsafe items removed
    blockers:           list,     # hard-stops applied (banned, off-label)
    warnings:           list,     # softer flags (unverified, dose unknown)
    registry_version:   str,
  )

The orchestrator surfaces blockers + warnings into the report meta and
the dispensing-sheet compliance audit.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from data.state_bans import (
    REGISTRY_VERSION as STATE_BANS_VERSION,
    is_banned_in_state,
)
from rag.knowledge_base import _LABEL_CLAIMS  # crop+disease -> allowed actives
from safety.chemicals import (
    REGISTRY_VERSION,
    find_active,
    is_banned,
    is_state_organic,
)
from safety.policy import allow_chemical_recommendations

logger = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    sanitized_treatment: dict
    blockers: list[dict] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    registry_version: str = REGISTRY_VERSION

    def to_meta(self) -> dict:
        return {
            "registry_version": self.registry_version,
            "blockers": self.blockers,
            "warnings": self.warnings,
            "blocker_count": len(self.blockers),
            "warning_count": len(self.warnings),
        }


_BEE_TOXIC_ACTIVES = {
    "imidacloprid", "thiamethoxam", "clothianidin", "fipronil",
    "lambda-cyhalothrin", "deltamethrin", "cypermethrin", "bifenthrin",
}


def _growth_stage_is_flowering(stage: str | None) -> bool:
    s = (stage or "").lower()
    return any(kw in s for kw in ("flower", "bloom", "anthesis"))


def validate_treatment(
    treatment: dict,
    *,
    diagnosis: dict,
    params: dict,
) -> ValidationResult:
    """Single entry point — orchestrator calls this once per request."""
    state = (params.get("state") or "").lower().strip()
    crop  = (params.get("crop_name") or "").lower().strip()
    disease_name = ((diagnosis.get("primary_diagnosis") or {}).get("disease") or "").lower().strip()
    flowering = _growth_stage_is_flowering(params.get("crop_growth_stage"))

    # Label-claim allowed set for (crop, disease). When the matrix has
    # NO entry for the pair, allowed_for_label is None → off-label check
    # is silent (we already warned in the RAG grounding prompt that no
    # chemicals are registered, so the LLM should have produced none).
    allowed_for_label: set[str] | None = _LABEL_CLAIMS.get((crop, disease_name))
    # Close the silent kill-switch: a (crop, disease) pair with NO registry
    # entry but whose crop IS covered by our candidate whitelist must FAIL SAFE
    # — treat the allowed set as EMPTY so the off-label check below blocks ALL
    # chemicals (cultural-only) instead of skipping. A typo'd/missing pair would
    # otherwise downgrade a leaked chemical to a mere warning. Uncovered
    # (open-vocab) crops keep the skip — we genuinely don't know their registry.
    if allowed_for_label is None:
        try:
            from data.crop_disease_whitelist import is_covered
            if is_covered(crop):
                allowed_for_label = set()
        except Exception:
            pass

    blockers: list[dict] = []
    warnings: list[dict] = []

    # ── Step 1. Policy gate — strip chemicals if disallowed ──────────────────
    allowed, reason = allow_chemical_recommendations(diagnosis)
    if not allowed:
        if treatment.get("chemical_controls"):
            blockers.append({
                "code": "policy_gate",
                "scope": "all_chemicals",
                "detail": reason,
            })
            logger.warning(
                "[Validator] Stripping %d chemical_controls — %s",
                len(treatment.get("chemical_controls", [])), reason,
            )
            treatment["chemical_controls"] = []
            treatment["medicine_combinations"] = []
            # Keep rotation_plan field but blank — UI reads it as "no rotation needed"
            treatment["rotation_plan"] = ""
        # Also block "Sikkim is fully organic" case at the state level
    if is_state_organic(state):
        if treatment.get("chemical_controls"):
            blockers.append({
                "code": "organic_state",
                "scope": "all_chemicals",
                "detail": f"{state.title()} is a fully organic state — synthetic pesticides barred",
            })
            treatment["chemical_controls"] = []
            treatment["medicine_combinations"] = []
            treatment["rotation_plan"] = ""

    # ── Step 2. Per-chemical validation (only if any remain) ─────────────────
    sanitized_chems: list[dict] = []
    for idx, chem in enumerate(treatment.get("chemical_controls", []) or []):
        verdict = _validate_chemical(
            chem, state=state, flowering=flowering,
            crop=crop, allowed_for_label=allowed_for_label,
        )
        if verdict["blocker"]:
            blockers.append({
                "code": verdict["code"],
                "scope": chem.get("product", f"chemical[{idx}]"),
                "detail": verdict["detail"],
            })
            continue
        if verdict["warning"]:
            warnings.append({
                "code": verdict["code"],
                "scope": chem.get("product", f"chemical[{idx}]"),
                "detail": verdict["detail"],
            })
        sanitized_chems.append(verdict["sanitized"])

    treatment["chemical_controls"] = sanitized_chems

    # ── Step 3. Re-validate medicine_combinations (a separate LLM block) ─────
    sanitized_combos: list[dict] = []
    for combo in treatment.get("medicine_combinations", []) or []:
        components = combo.get("components", []) or []
        kept: list[dict] = []
        for comp in components:
            v = _validate_chemical(
                {"product": comp.get("product", ""), "frac_irac_group": comp.get("frac_group", "")},
                state=state, flowering=flowering,
                crop=crop, allowed_for_label=allowed_for_label,
            )
            if v["blocker"]:
                blockers.append({
                    "code": v["code"],
                    "scope": f"combo:{combo.get('name','?')}/{comp.get('product','?')}",
                    "detail": v["detail"],
                })
                continue
            kept.append(comp)
        if kept:
            combo = dict(combo)
            combo["components"] = kept
            sanitized_combos.append(combo)
        # If all components were dropped, drop the combo entirely
    treatment["medicine_combinations"] = sanitized_combos

    # ── Step 4. Re-validate "do_not_use" — if the LLM mentions a banned
    #            active here, that's good (it's flagging it). We don't act
    #            on that block, but we surface the registry hits for the
    #            compliance audit.
    # (no-op — kept for clarity)

    # ── Step 5. If chemicals were stripped, ensure cultural+biological remain
    if not treatment.get("chemical_controls") and not treatment.get("cultural_practices"):
        treatment["cultural_practices"] = [
            "Remove and destroy visibly infected plant material",
            "Improve airflow by pruning and proper spacing",
            "Switch to drip irrigation to reduce leaf wetness",
        ]
    if not treatment.get("chemical_controls") and not treatment.get("biological_options"):
        # Keep the field present so the UI renders the section
        treatment["biological_options"] = treatment.get("biological_options", [])

    # ── Step 6. Stamp validator metadata
    treatment.setdefault("_safety", {})
    treatment["_safety"] = {
        "registry_version":   REGISTRY_VERSION,
        "state_bans_version": STATE_BANS_VERSION,
        "blockers": blockers,
        "warnings": warnings,
    }

    logger.info(
        "[Validator] reg=%s chems_kept=%d blockers=%d warnings=%d",
        REGISTRY_VERSION, len(sanitized_chems), len(blockers), len(warnings),
    )

    return ValidationResult(
        sanitized_treatment=treatment,
        blockers=blockers,
        warnings=warnings,
    )


# ── Per-chemical validator ───────────────────────────────────────────────────

def _validate_chemical(
    chem: dict,
    *,
    state: str,
    flowering: bool,
    crop: str = "",
    allowed_for_label: set[str] | None = None,
) -> dict[str, Any]:
    """
    Returns dict {blocker, warning, code, detail, sanitized}.

    blocker=True  → chemical removed from output (banned, off-label, etc.)
    warning=True  → kept, but flagged in safety audit (unknown active, dose missing)
    """
    product = chem.get("product", "") or chem.get("active_ingredient", "")
    active_field = chem.get("active_ingredient") or product

    # 1. Ban check — central registry
    banned, ban_reason = is_banned(product, state=state)
    if not banned:
        banned, ban_reason = is_banned(active_field, state=state)
    if banned:
        return {
            "blocker": True,
            "warning": False,
            "code": "banned_chemical",
            "detail": f"{product!r}: {ban_reason}",
            "sanitized": None,
        }

    # 1b. Ban check — state-specific registry (Phase 7 addition).
    # Crop-scoped bans (e.g. Maharashtra cotton-area emergency lists) are
    # honoured here so e.g. monocrotophos on cotton in Maharashtra is
    # blocked even though it's only "restricted" centrally.
    if state:
        state_banned, state_reason = is_banned_in_state(active_field, state, crop=crop)
        if not state_banned:
            state_banned, state_reason = is_banned_in_state(product, state, crop=crop)
        if state_banned:
            return {
                "blocker": True,
                "warning": False,
                "code": "banned_in_state",
                "detail": f"{product!r}: {state_reason}",
                "sanitized": None,
            }

    # 1c. Label-claim check — CIB&RC registers each active for SPECIFIC
    # crop-pest combinations. Off-label is illegal under the Insecticides
    # Act 1968 even if the chemical itself is registered for other crops.
    # When the (crop, disease) pair has no label-claim entry in our matrix,
    # allowed_for_label is None and this check is skipped (the RAG block
    # already told the LLM to recommend cultural only — anything that
    # slipped through is the unverified_active warning instead).
    if allowed_for_label is not None:
        active_lc = (active_field or product or "").strip().lower()
        # Match via substring so "Mancozeb 75% WP" matches "mancozeb".
        if active_lc and not any(name in active_lc or active_lc in name
                                  for name in allowed_for_label):
            return {
                "blocker": True,
                "warning": False,
                "code": "off_label",
                "detail": (
                    f"{product!r}: not registered for this crop-pest combination "
                    f"under CIB&RC label claims (allowed: {sorted(allowed_for_label)})"
                ),
                "sanitized": None,
            }

    # 2. Registry resolve
    active = find_active(active_field) or find_active(product)

    sanitized = dict(chem)
    code = ""
    detail = ""
    warning = False

    if active is None:
        # Unknown active → keep but flag for human review. We don't drop
        # because the registry is intentionally incomplete; dropping every
        # unknown would over-block.
        warning = True
        code = "unverified_active"
        detail = f"{product!r}: not in CIB&RC registry slice — needs human verification"
        sanitized["_validator_note"] = "unverified active ingredient"
    else:
        # 3. PHI / REI clamp — never lower than registry baseline
        phi_llm = sanitized.get("phi_days")
        if not isinstance(phi_llm, (int, float)) or phi_llm < active.phi_days_default:
            sanitized["phi_days"] = active.phi_days_default
            warning = warning or False  # silent clamp; surfaced below if needed
        rei_llm = sanitized.get("rei_hours")
        if not isinstance(rei_llm, (int, float)) or rei_llm < active.rei_hours_default:
            sanitized["rei_hours"] = active.rei_hours_default

        # 4. FRAC/IRAC fill-in
        if not sanitized.get("frac_irac_group") and active.frac_irac_group:
            sanitized["frac_irac_group"] = active.frac_irac_group

        # 5. Pollinator safety enforcement during flowering
        active_lower = active.name
        if flowering and active_lower in _BEE_TOXIC_ACTIVES:
            sanitized["pollinator_safety"] = "avoid_during_bloom"
            return {
                "blocker": True,
                "warning": False,
                "code": "bee_toxic_during_bloom",
                "detail": (
                    f"{product!r}: bee-toxic active ({active.name}) cannot be sprayed during flowering"
                ),
                "sanitized": None,
            }
        if not sanitized.get("pollinator_safety"):
            sanitized["pollinator_safety"] = active.pollinator_safety

    # 6. Dose sanity — must have dosage
    if not sanitized.get("dosage"):
        warning = True
        code = code or "missing_dosage"
        detail = detail or f"{product!r}: dosage missing — apply per CIB&RC label"

    return {
        "blocker": False,
        "warning": warning,
        "code": code,
        "detail": detail,
        "sanitized": sanitized,
    }


# ── Free-text advice gate (chat / voice) ─────────────────────────────────────
# validate_treatment() above sanitizes the STRUCTURED treatment dict the scan
# pipeline builds — chemical_controls / medicine_combinations / rotation_plan.
# Chat and voice never build that dict: they hand the model's prose straight
# to the farmer and to TTS, which is why a banned active named in a chat answer
# used to reach the farmer with no registry check at all. Same registry, same
# blocker vocabulary, different input shape — so this is a second entry point,
# not an overload of the first. validate_treatment's signature is load-bearing
# for the scan path and is deliberately untouched.

_ADVICE_MAX_NGRAM = 4   # longest banned name is 4 words
                        # ("methoxy ethyl mercury chloride")

# Sentence boundary used when excising an unsafe sentence. The negative
# lookbehind on a digit is the same guard the TTS splitter needs: "Spray at
# 2.5 g/L" has to stay ONE sentence, or dropping the flagged half leaves the
# farmer a bare "5 g/L".
_ADVICE_SENTENCE_BREAK = re.compile(r"(?<!\d)[.!?](?=\s|$)|[।\n]")

# Latin-only, and deliberately left that way for now — see the RESIDUAL RISK note
# in validate_advice_text. Widening this to `[^\W\d_]` looks like it would cover
# Devanagari, and does not: Python's `\w` excludes Indic combining marks (matras,
# virama, nukta are all str.isalnum() == False), so "मॅन्कोझेब" shatters into five
# one-letter tokens and the registry lookup sees garbage. A real fix needs the
# Indic mark ranges in the character class AND a transliteration alias layer over
# safety.chemicals; half of that is worse than neither, because it reads as
# coverage that does not exist.
_ADVICE_WORD = re.compile(r"[A-Za-z][\w'\-]*")

# "Chlorpyrifos 20EC", "Mancozeb 75% WP" — a name carrying a formulation code
# is a pesticide product whatever the registry knows about it.
_ADVICE_PRODUCT = re.compile(
    r"\b([A-Za-z][\w\-]{4,})\s*[\d.]*\s*%?\s*(?:EC|SC|WP|WG|WDG|SL|SP|SG|DP|GR)\b"
)

# Suffixes that are pesticide nomenclature rather than ordinary words. These
# only ever raise an unverified_active WARNING — never a blocker — so a false
# positive costs one metadata flag and nothing the farmer can see.
_ADVICE_ACTIVE_SUFFIXES = (
    "conazole", "strobin", "thrin", "prid", "mectin",
    "phos", "fos", "sulfuron", "carb", "myl", "oxam",
)

# Returned when every sentence had to be dropped. English, because this
# function has no language argument by contract — `replaced_with_fallback`
# in the meta tells the caller to substitute its own localized line.
_ADVICE_SAFE_FALLBACK = (
    "I can't recommend a chemical for this. Please contact your nearest "
    "Krishi Vigyan Kendra (KVK) or agriculture officer before spraying anything."
)


@dataclass
class TextValidationResult:
    sanitized_text: str
    blockers: list[dict] = field(default_factory=list)   # [{"code","active","detail"}]
    warnings: list[dict] = field(default_factory=list)
    registry_version: str = REGISTRY_VERSION
    replaced_with_fallback: bool = False

    def to_meta(self) -> dict:
        return {
            "registry_version": self.registry_version,
            "state_bans_version": STATE_BANS_VERSION,
            "blockers": self.blockers,
            "warnings": self.warnings,
            "blocker_count": len(self.blockers),
            "warning_count": len(self.warnings),
            "replaced_with_fallback": self.replaced_with_fallback,
        }


def _advice_sentence_spans(text: str) -> list[tuple[int, int]]:
    """Contiguous (start, end) spans covering the whole string, so joining a
    subset of them preserves the original spacing of what survives."""
    spans: list[tuple[int, int]] = []
    start = 0
    for m in _ADVICE_SENTENCE_BREAK.finditer(text):
        end = m.end()
        if end > start:
            spans.append((start, end))
        start = end
    if start < len(text):
        spans.append((start, len(text)))
    return spans


def _advice_strip(text: str, cuts: list[tuple[int, int]]) -> str:
    """Drop every sentence overlapping a flagged span. Redacting only the
    chemical name would leave "Spray ___ at 2 ml/L" — an instruction to spray
    an unnamed thing at a real dose, which is worse than saying nothing."""
    kept = [
        text[s:e] for s, e in _advice_sentence_spans(text)
        if not any(c_start < e and c_end > s for c_start, c_end in cuts)
    ]
    return re.sub(r"\n{3,}", "\n\n", "".join(kept)).strip()


def _advice_named_active(phrase: str) -> Any | None:
    """Stricter wrapper over find_active() for prose.

    find_active()'s last resort is an alias SUBSTRING match, which is right
    for an LLM-emitted `product` field but wrong for free text, where
    "bordeauxish" or "ridomil-like" would resolve. Require the canonical name
    (or one full alias) to appear as whole words.

    Brand aliases that are also ordinary English words ("score", "tilt",
    "fame") still resolve, so an organic-state farmer can lose a sentence
    containing "score". That is the safe direction: the alternative is naming
    a synthetic pesticide in a state where synthetics are barred.
    """
    active = find_active(phrase)
    if active is None:
        return None
    words = set(re.findall(r"[\w+-]+", phrase.lower()))
    for candidate in (active.name, *active.aliases):
        cand_words = set(candidate.lower().split())
        if cand_words and cand_words.issubset(words):
            return active
    return None


def _advice_record(bucket: list[dict], seen: set[str], code: str, active: str, detail: str) -> None:
    key = f"{code}:{active.lower()}"
    if key in seen:
        return
    seen.add(key)
    bucket.append({"code": code, "active": active, "detail": detail})


def validate_advice_text(text: str, *, state: str | None = None) -> TextValidationResult:
    """Registry gate for free-text advice (chat, voice, scan follow-up).

    Blocks (sentence is excised from `sanitized_text`):
      • banned_active  — the mention is centrally banned, or banned in the
                         farmer's state (STATE_LEVEL_BANS via is_banned).
      • organic_state  — a synthetic registered active named in a fully
                         organic state (Sikkim).
    Warns (text untouched, surfaced in `to_meta()` for monitoring):
      • unverified_active — the text names something shaped like a pesticide
                         that is not in the registry slice, so nothing checked
                         its label claim, PHI or state bans.

    `state` must be the RAW farmer state, unabbreviated and lowercase-safe
    ("Kerala", "Maharashtra"). A default like "India" is not a key in
    STATE_LEVEL_BANS and silently disables every state-level ban.

    RESIDUAL RISK — ACCEPTED, NOT CLOSED. Detection is Latin-script only, because
    the registry keys are: `is_banned("क्लोरपायरीफॉस")` is False, so a banned
    active written in Devanagari or Tamil passes this gate untouched. Closing it
    needs a transliteration alias layer over safety.chemicals (Devanagari + Tamil
    + Telugu spellings of at least chlorpyrifos, monocrotophos, endosulfan and
    imidacloprid) plus an Indic-aware tokeniser — see _ADVICE_WORD. Until that
    ships, the only thing keeping actives in Latin is the instruction in
    agents/prompts/chat_rules.v1.md — a prompt, not a gate. Chat/voice is the
    surface with no other validator behind it, so this is the known hole, and it
    is a known hole rather than a covered case.
    """
    original = text or ""
    if not original.strip():
        return TextValidationResult(sanitized_text=original)

    state_key = (state or "").strip()
    organic = is_state_organic(state_key)
    # Whole-text prefilter. is_banned() is a substring test, so if no banned
    # name appears anywhere in the answer it cannot appear in any window of it
    # — that skips the O(tokens × registry) scan on the ~99% of answers that
    # name nothing banned, which matters on a per-request path.
    text_banned, text_ban_reason = is_banned(original, state=state_key)

    blockers: list[dict] = []
    warnings: list[dict] = []
    seen: set[str] = set()
    cuts: list[tuple[int, int]] = []

    tokens = [(m.group(0), m.start(), m.end()) for m in _ADVICE_WORD.finditer(original)]

    if text_banned or organic:
        total = len(tokens)
        consumed: set[int] = set()
        # Window width ascends across the WHOLE token list, not per start
        # index. is_banned() is a substring test, so a wider window starting
        # one token early ("Use Monocrotophos", "infected leaves Spray
        # Endosulfan") also matches — and it would then be reported as the
        # active and excise a span far wider than the mention. Narrowest
        # match wins; its tokens are consumed so no wider window re-reports it.
        for n in range(1, _ADVICE_MAX_NGRAM + 1):
            for i in range(0, total - n + 1):
                if any(j in consumed for j in range(i, i + n)):
                    continue
                window = tokens[i:i + n]
                phrase = " ".join(w for w, _s, _e in window)
                span = (window[0][1], window[-1][2])

                if text_banned:
                    banned, reason = is_banned(phrase, state=state_key)
                    if banned:
                        _advice_record(blockers, seen, "banned_active", phrase, reason)
                        cuts.append(span)
                        consumed.update(range(i, i + n))
                        continue

                # Registered names top out at two words ("copper oxychloride",
                # "emamectin benzoate"), so wider windows can only produce
                # find_active() token-subset artefacts.
                if n <= 2:
                    active = _advice_named_active(phrase)
                    if active is not None:
                        if organic and active.frac_irac_group != "BIO":
                            _advice_record(
                                blockers, seen, "organic_state", active.name,
                                f"{state_key.title()} is a fully organic state — "
                                f"synthetic pesticide ({active.name}) cannot be recommended",
                            )
                            cuts.append(span)
                        consumed.update(range(i, i + n))

    checked: set[str] = set()

    def _flag_unverified(name: str) -> None:
        key = name.lower()
        if key in checked:
            return
        checked.add(key)
        if _advice_named_active(name) is not None:
            return          # in the registry — validated above
        if is_banned(name, state=state_key)[0]:
            return          # already a blocker
        _advice_record(
            warnings, seen, "unverified_active", name,
            f"{name!r}: named in advice but absent from the CIB&RC registry slice — "
            "label claim, PHI and state bans unchecked",
        )

    for m in _ADVICE_PRODUCT.finditer(original):
        _flag_unverified(m.group(1))
    for word, _s, _e in tokens:
        if len(word) >= 7 and word.lower().endswith(_ADVICE_ACTIVE_SUFFIXES):
            _flag_unverified(word)

    sanitized = original
    replaced = False
    if cuts:
        sanitized = _advice_strip(original, cuts)
        if not sanitized.strip():
            sanitized, replaced = _ADVICE_SAFE_FALLBACK, True
    elif text_banned:
        # The prefilter found a banned active the token scan could not locate —
        # it only exists once punctuation is normalised away ("...sodium.
        # Cyanide..."). Nothing to excise surgically, so drop the whole answer
        # rather than ship an unlocated ban.
        _advice_record(blockers, seen, "banned_active", "", text_ban_reason)
        sanitized, replaced = _ADVICE_SAFE_FALLBACK, True

    if blockers:
        logger.warning(
            "[Validator] advice text: state=%s blockers=%s warnings=%d replaced=%s",
            state_key or "?", [b["code"] for b in blockers], len(warnings), replaced,
        )

    return TextValidationResult(
        sanitized_text=sanitized,
        blockers=blockers,
        warnings=warnings,
        replaced_with_fallback=replaced,
    )

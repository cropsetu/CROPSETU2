"""
data/state_bans.py — versioned state-level pesticide ban registry.

Why this file exists separately from safety/chemicals.py
  The central ban list in safety/chemicals.py.BANNED_ACTIVES is a small,
  relatively stable set. State-level bans are larger, more volatile, and
  often time-bounded (Punjab seasonal cotton-area bans, Kerala's broad
  organic state status, Sikkim's full organic ban, Maharashtra rolling
  endosulfan-residue bans). Keeping them in their own file:
    - lets us re-issue updates without touching the validator code
    - makes the versioning visible (REGISTRY_VERSION)
    - keeps PR diffs scoped when bans change

The validator (safety/validator.py) calls is_banned_in_state() to gate
each chemical recommendation. The compliance audit (safety/compliance.py)
joins the result with the central registry into the audit row.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


REGISTRY_VERSION = "2026.05.28-sb-r1"
REGISTRY_SOURCES = (
    "Kerala Govt. SRO 1216/2011 (state organic policy)",
    "Sikkim Organic Mission notifications (2010, 2016)",
    "Maharashtra Agri Dept. ad-hoc cotton-area circulars (2017-)",
    "Punjab Agriculture Dept. circulars (Bhatinda, Mansa restrictions)",
    "Andhra Pradesh ZBNF / Natural Farming guidelines (2019-)",
)


@dataclass(frozen=True)
class StateBan:
    """A pesticide active banned/restricted in a specific state."""
    active: str               # canonical lowercase active ingredient
    state: str                # canonical state name (lowercased)
    since: str                # YYYY-MM-DD or YYYY
    expires: Optional[str] = None  # YYYY-MM-DD; None = indefinite
    scope: str = "banned"     # banned | restricted | seasonal
    crops: tuple[str, ...] = ()    # () = all crops; specific list = restricted to these
    reason: str = ""


# Use a list (not dict) because (state, active) is a many-to-many
# relationship — the same active can be banned in many states.
_STATE_BANS: list[StateBan] = [
    # ── Kerala: state organic-leaning policy bans a broad set of OPs/carbamates
    StateBan("monocrotophos", "kerala", "2011", scope="banned",
             reason="Kerala SRO 1216/2011 — organic state policy"),
    StateBan("methyl parathion", "kerala", "2011", scope="banned",
             reason="Kerala SRO 1216/2011 — organic state policy"),
    StateBan("phorate", "kerala", "2011", scope="banned",
             reason="Kerala SRO 1216/2011 — organic state policy"),
    StateBan("carbofuran", "kerala", "2011", scope="banned",
             reason="Kerala SRO 1216/2011 — organic state policy"),
    StateBan("endosulfan", "kerala", "2010", scope="banned",
             reason="Plantation injury linked to endosulfan; state ban predates central"),
    StateBan("paraquat dichloride", "kerala", "2017", scope="restricted",
             reason="Kerala restricts paraquat for non-tea crops"),

    # ── Sikkim: 100% organic state — all synthetic pesticides effectively banned
    StateBan("synthetic pesticides (all)", "sikkim", "2016", scope="banned",
             reason="Sikkim Organic Mission — full ban on synthetic agro-chemicals"),

    # ── Maharashtra: cotton-area emergency bans (post-Yavatmal incidents, 2017-)
    StateBan("monocrotophos", "maharashtra", "2017", scope="restricted",
             crops=("cotton",),
             reason="Maharashtra Agri Dept post-Yavatmal incident restrictions"),
    StateBan("acephate", "maharashtra", "2017", scope="restricted",
             crops=("cotton",),
             reason="Maharashtra Agri Dept post-Yavatmal incident restrictions"),
    StateBan("diafenthiuron", "maharashtra", "2017", scope="restricted",
             crops=("cotton",),
             reason="Maharashtra Agri Dept post-Yavatmal incident restrictions"),
    StateBan("profenofos", "maharashtra", "2017", scope="restricted",
             crops=("cotton",),
             reason="Maharashtra Agri Dept post-Yavatmal incident restrictions"),

    # ── Punjab: cotton-belt OP/insecticide restrictions in Malwa districts
    StateBan("monocrotophos", "punjab", "2018", scope="restricted",
             reason="Punjab Agri Dept restriction in Malwa cotton belt"),
    StateBan("phorate", "punjab", "2018", scope="restricted",
             reason="Punjab Agri Dept restriction in Malwa cotton belt"),

    # ── Andhra Pradesh: ZBNF / Natural Farming preferred — strong nudges, not blanket bans
    # We treat AP bans as "restricted" rather than hard "banned" because the
    # state policy nudges toward biologicals but does not legally prohibit
    # registered chemicals.
    StateBan("monocrotophos", "andhra pradesh", "2019", scope="restricted",
             reason="AP ZBNF — prefers biological alternatives"),
]


def is_banned_in_state(active: str | None, state: str | None,
                       crop: str | None = None) -> tuple[bool, str]:
    """
    True if `active` is banned/restricted in `state` (for `crop`, if scoped).

    Returns (is_banned, reason). When `crops` is set on the StateBan and
    `crop` doesn't match, the ban does NOT apply.
    """
    a = (active or "").strip().lower()
    s = (state or "").strip().lower()
    c = (crop or "").strip().lower()
    if not a or not s:
        return False, ""
    for ban in _STATE_BANS:
        if ban.active != a or ban.state != s:
            continue
        if ban.crops and c and c not in ban.crops:
            continue
        return True, f"{ban.scope} in {state} since {ban.since}: {ban.reason}"
    # Sikkim's catch-all entry uses a sentinel active name.
    if s == "sikkim":
        return True, "Sikkim is a 100% organic state — synthetic pesticides are banned"
    return False, ""

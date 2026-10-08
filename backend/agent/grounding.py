"""Grounding check (design §7.1, R5-07, SYS-01, SYS-03).

Extracts every numeric from an LLM response and verifies it against the numeric fields of the tool
results produced in the same turn, using the tolerance table of §7.1 Step 3.

Documented interpretations of the table (all are representation-only, none lets a number be derived):
  * Dollar and percentage comparisons use absolute values (direction is carried by words like "under").
  * Bare decimals (e.g. 1.04, 4.1) must equal a tool value after rounding the tool value to the stated precision.
  * Fields that the tools report as fractions in [0, 1] (shares, pct_with_errors, pct_delayed) are also indexed
    x100 so that "45%" can match 0.45.
  * Fiscal periods match a literal "FYyyyy Qn" string, or a (fiscal_year, fiscal_quarter) pair, in a tool result.
  * Record ids (BUD-00237), markdown list markers and plain years (2024) are not treated as numerics.
"""

from __future__ import annotations

import logging
import math
import re
from typing import Any, Iterable

logger = logging.getLogger("grounding")

_NUM = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
_SUFFIX = {"k": 1e3, "m": 1e6, "b": 1e9, "thousand": 1e3, "million": 1e6, "billion": 1e9}

# Priority order matters: earlier patterns claim their span first.
NUMERIC_PATTERNS: list[tuple[str, str]] = [
    ("fiscal_period", r"FY20\d\d\s+Q[1-4]"),
    ("abbreviated_dollar", rf"\$\s*{_NUM}\s*(?:[KMBkmb]\b|thousand\b|million\b|billion\b)"),
    ("bare_dollar", rf"\$\s*{_NUM}"),
    ("percentage", rf"(?<![\w.]){_NUM}\s*(?:%|percent\b)"),
    ("bare_integer", rf"(?<![\w.]){_NUM}(?![\w])"),
]
_RECORD_ID = re.compile(r"\b[A-Z]{1,4}-\d+\b")
_LIST_MARKER = re.compile(r"(?m)^(\s*)\d+[.)](?=\s)")
_FRACTION_KEYS = ("share", "pct_with_errors", "pct_delayed")


def _mask(text: str) -> str:
    text = _RECORD_ID.sub(lambda m: " " * len(m.group()), text)
    return _LIST_MARKER.sub(lambda m: " " * len(m.group()), text)


def extract_numerics(text: str) -> list[dict]:
    """Return [{raw_str, numeric_type, normalized_float, context_snippet, decimals}] in order of appearance."""
    masked, taken, found = _mask(text), [], []
    for ntype, pat in NUMERIC_PATTERNS:
        for m in re.finditer(pat, masked, flags=re.IGNORECASE if ntype == "abbreviated_dollar" else 0):
            if any(m.start() < e and s < m.end() for s, e in taken):
                continue
            raw = text[m.start():m.end()].strip()
            if ntype == "fiscal_period":
                norm, dec = re.sub(r"\s+", " ", raw.upper()), 0
            else:
                body = re.search(_NUM, raw)
                numtxt = body.group().replace(",", "")
                dec = len(numtxt.split(".")[1]) if "." in numtxt else 0
                norm = float(numtxt)
                if ntype == "abbreviated_dollar":
                    norm *= _SUFFIX[re.search(r"([KMBkmb]|thousand|million|billion)\s*$", raw, re.I).group(1).lower()]
                if ntype == "bare_integer" and dec == 0 and "," not in raw and 1900 <= norm <= 2100:
                    continue  # a plain year, not a quantity
            taken.append((m.start(), m.end()))
            found.append({"raw_str": raw, "numeric_type": ntype, "normalized_float": norm, "decimals": dec,
                          "context_snippet": text[max(0, m.start() - 30):m.end() + 30], "_pos": m.start()})
    found.sort(key=lambda d: d["_pos"])
    for f in found:
        f.pop("_pos")
    return found


def build_evidence_lookup(tool_results: Iterable[Any]) -> dict:
    """Index every numeric leaf and every fiscal period string found in the tool results."""
    values: list[float] = []
    periods: set[str] = set()

    def walk(node: Any, key: str = "") -> None:
        if isinstance(node, bool):
            return
        if isinstance(node, (int, float)):
            if math.isfinite(node):
                values.append(float(node))
                if -1.0 <= node <= 1.0 and any(k in key for k in _FRACTION_KEYS):
                    values.append(float(node) * 100)
        elif isinstance(node, str):
            for m in re.finditer(r"FY20\d\d\s+Q[1-4]", node, re.I):
                periods.add(re.sub(r"\s+", " ", m.group().upper()))
        elif isinstance(node, dict):
            fy, fq = node.get("fiscal_year"), node.get("fiscal_quarter")
            if isinstance(fy, str) and isinstance(fq, str):
                periods.add(f"{fy} {fq}".upper())
            for k, v in node.items():
                walk(v, str(k))
        elif isinstance(node, (list, tuple)):
            for v in node:
                walk(v, key)

    for r in tool_results:
        walk(r)
    return {"values": values, "periods": periods}


def _matches(n: dict, ev: dict) -> bool:
    t, x = n["numeric_type"], n["normalized_float"]
    if t == "fiscal_period":
        return x in ev["periods"]
    vals = ev["values"]
    if t == "bare_dollar":
        return any(abs(abs(v) - x) <= 1.0 + 1e-9 for v in vals)
    if t == "abbreviated_dollar":
        # value / unit rounds to the stated number of decimals => half-open window [x - half, x + half)
        raw = n["raw_str"].lower()
        u = 1e9 if re.search(r"(b|billion)\s*$", raw) else 1e6 if re.search(r"(m|million)\s*$", raw) else 1e3
        half = 0.5 * 10 ** (-n["decimals"]) * u
        lo, hi = round(x - half, 3), round(x + half, 3)
        return any(lo <= abs(v) < hi for v in vals)
    if t == "percentage":
        return any(abs(abs(v) - x) <= 0.05 + 1e-9 for v in vals)
    # bare integer / bare decimal
    d = n["decimals"]
    return any(abs(abs(v) - x) < 1e-9 if d == 0 else round(abs(v), d) == round(x, d) for v in vals)


def run_grounding_check(response_text: str, tool_results: list[Any], turn_id: str | None = None) -> dict:
    """Verify every numeric in ``response_text``. Returns {"failed_values": [...], "flagged": bool, "message": str, ...}."""
    ev = build_evidence_lookup(tool_results)
    nums = extract_numerics(response_text)
    failed: list[str] = []
    for n in nums:
        if not _matches(n, ev) and n["raw_str"] not in failed:
            failed.append(n["raw_str"])
    if failed:
        logger.warning("grounding_flag: %d value(s) unverified in turn %s", len(failed), turn_id)  # counts only (SYS-03)
    return {
        "failed_values": failed,
        "flagged": bool(failed),
        "extracted_count": len(nums),
        "message": (f"{len(failed)} numeric value(s) in this response could not be traced to tool results from this turn."
                    if failed else ""),
    }

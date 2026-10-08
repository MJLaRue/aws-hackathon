"""
scenarios.py
============
What-if scenario analysis engine.

A scenario is a dict of {category_or_department: multiplier} adjustments
applied to the baseline GB/naive forecasts for Jul-Dec 2026.

Examples
--------
{
  "adjustments": [
    {"type": "category", "name": "Personnel & Salaries",   "change_pct": 5.0},
    {"type": "category", "name": "Travel & Conferences",   "change_pct": -10.0},
    {"type": "category", "name": "Technology & Equipment", "change_pct": 8.0},
    {"type": "department", "name": "IT Services",          "change_pct": 12.0}
  ]
}

Rules
-----
- Adjustments compound when both a category-level and department-level rule
  match the same series.
- change_pct is a percentage change from baseline, e.g. 5.0 means +5 %.
- Adjustments only apply to the Jul-Dec 2026 forecast period, never to
  historical actuals.
- Dollar difference = adjusted - baseline.
- Percentage difference = (adjusted - baseline) / baseline * 100.
"""

import math
from typing import Optional
from forecasting import load_results


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _parse_adjustments(adjustments: list) -> tuple:
    """
    Return (cat_multipliers: dict, dept_multipliers: dict).
    Each maps name → multiplier (e.g. 1.05 for +5 %).
    """
    cat_mult  = {}
    dept_mult = {}
    for adj in adjustments:
        kind       = str(adj.get("type", "category")).lower()
        name       = str(adj.get("name", ""))
        change_pct = float(adj.get("change_pct", 0.0))
        mult       = 1.0 + change_pct / 100.0
        if kind == "category":
            cat_mult[name] = mult
        elif kind == "department":
            dept_mult[name] = mult
    return cat_mult, dept_mult


def _combined_multiplier(dept: str, cat: str,
                         cat_mult: dict, dept_mult: dict) -> float:
    """Compound category and department multipliers."""
    m = 1.0
    m *= cat_mult.get(cat, 1.0)
    m *= dept_mult.get(dept, 1.0)
    return m


# ─────────────────────────────────────────────────────────────────────────────
# SCENARIO ENGINE
# ─────────────────────────────────────────────────────────────────────────────

def run_scenario(adjustments: list,
                 scenario_name: Optional[str] = None) -> dict:
    """
    Apply adjustments to the saved baseline forecasts.

    Parameters
    ----------
    adjustments : list of adjustment dicts (see module docstring)
    scenario_name : optional label for the scenario

    Returns
    -------
    dict with:
      scenario_name, adjustments, series (list), summary
    """
    results     = load_results()
    cat_mult, dept_mult = _parse_adjustments(adjustments)

    series_output = []
    total_baseline  = 0.0
    total_adjusted  = 0.0

    for key, s in results["series"].items():
        dept = s["department"]
        cat  = s["category"]
        mult = _combined_multiplier(dept, cat, cat_mult, dept_mult)

        monthly = []
        series_baseline = 0.0
        series_adjusted = 0.0

        for fc in s["forecasts"]:
            # Use GB forecast as baseline (matches what was chosen)
            baseline_val = fc.get("forecast_gb")
            if baseline_val is None:
                baseline_val = fc.get("forecast_naive")

            if baseline_val is None or math.isnan(baseline_val):
                monthly.append({
                    "month":           fc["month"],
                    "baseline":        None,
                    "adjusted":        None,
                    "difference_usd":  None,
                    "difference_pct":  None,
                })
                continue

            adjusted_val = round(baseline_val * mult, 2)
            diff_usd     = round(adjusted_val - baseline_val, 2)
            diff_pct     = round((adjusted_val - baseline_val) / baseline_val * 100, 2) \
                           if baseline_val != 0 else None

            series_baseline += baseline_val
            series_adjusted += adjusted_val

            monthly.append({
                "month":          fc["month"],
                "baseline":       round(baseline_val, 2),
                "adjusted":       adjusted_val,
                "difference_usd": diff_usd,
                "difference_pct": diff_pct,
            })

        series_diff     = round(series_adjusted - series_baseline, 2)
        series_diff_pct = round(series_diff / series_baseline * 100, 2) \
                         if series_baseline != 0 else None

        total_baseline  += series_baseline
        total_adjusted  += series_adjusted

        series_output.append({
            "department":         dept,
            "category":           cat,
            "history_is_synthetic": s.get("history_is_synthetic", True),
            "multiplier_applied": round(mult, 4),
            "baseline_total":     round(series_baseline, 2),
            "adjusted_total":     round(series_adjusted, 2),
            "difference_usd":     series_diff,
            "difference_pct":     series_diff_pct,
            "monthly":            monthly,
        })

    total_diff     = round(total_adjusted - total_baseline, 2)
    total_diff_pct = round(total_diff / total_baseline * 100, 2) \
                    if total_baseline != 0 else None

    return {
        "scenario_name": scenario_name or "Custom Scenario",
        "adjustments":   adjustments,
        "summary": {
            "baseline_total_6m":  round(total_baseline, 2),
            "adjusted_total_6m":  round(total_adjusted, 2),
            "difference_usd":     total_diff,
            "difference_pct":     total_diff_pct,
            "period":             "Jul 2026 – Dec 2026",
            "series_affected":    sum(1 for s in series_output if s["multiplier_applied"] != 1.0),
            "note": (
                "Scenario adjustments are applied to synthetic-data-derived forecasts. "
                "Results are illustrative only."
            ),
        },
        "series": series_output,
    }


# ─────────────────────────────────────────────────────────────────────────────
# PRESET SCENARIOS  (for the demo dropdown in the frontend)
# ─────────────────────────────────────────────────────────────────────────────

PRESET_SCENARIOS = {
    "salary_increase_5pct": {
        "name": "Salary Increase +5%",
        "adjustments": [
            {"type": "category", "name": "Personnel & Salaries", "change_pct": 5.0},
        ],
    },
    "travel_cut_10pct": {
        "name": "Travel Budget Cut -10%",
        "adjustments": [
            {"type": "category", "name": "Travel & Conferences", "change_pct": -10.0},
        ],
    },
    "tech_investment_8pct": {
        "name": "Technology Investment +8%",
        "adjustments": [
            {"type": "category", "name": "Technology & Equipment", "change_pct": 8.0},
        ],
    },
    "austerity": {
        "name": "Austerity (-5% all categories)",
        "adjustments": [
            {"type": "category", "name": "Personnel & Salaries",   "change_pct": -5.0},
            {"type": "category", "name": "Administrative Costs",   "change_pct": -5.0},
            {"type": "category", "name": "Research Operations",    "change_pct": -5.0},
            {"type": "category", "name": "Technology & Equipment", "change_pct": -5.0},
            {"type": "category", "name": "Student Scholarships",   "change_pct": -5.0},
            {"type": "category", "name": "Maintenance & Repairs",  "change_pct": -5.0},
            {"type": "category", "name": "Consulting & Contracts", "change_pct": -5.0},
        ],
    },
    "research_push": {
        "name": "Research Investment +15%",
        "adjustments": [
            {"type": "category",    "name": "Research Operations", "change_pct": 15.0},
            {"type": "department",  "name": "Research Institute",  "change_pct": 10.0},
        ],
    },
}


def get_preset_list() -> list:
    """Return list of preset scenario keys and names for the API."""
    return [
        {"id": k, "name": v["name"]}
        for k, v in PRESET_SCENARIOS.items()
    ]


def run_preset(preset_id: str) -> dict:
    """Run a named preset scenario."""
    if preset_id not in PRESET_SCENARIOS:
        raise ValueError(f"Unknown preset '{preset_id}'. "
                         f"Available: {list(PRESET_SCENARIOS.keys())}")
    p = PRESET_SCENARIOS[preset_id]
    return run_scenario(p["adjustments"], scenario_name=p["name"])

"""
enhance_dataset.py  (v2 – corrected)
======================================
Reads  Team6Dataset.xlsx
Writes Team6Dataset_Enhanced.xlsx

Corrections vs v1
-----------------
1. Monthly allocations – Monthly report records are spread across plausible
   months within their quarter rather than all being pinned to month-1.
   An `include_in_totals` flag prevents double-counting when overlapping
   report snapshots share the same dept/category/month.

2. Anomaly thresholds – Lowered from a blanket >10 % variance rule to
   tiered, dollar-and-percent combined rules so normal budget variation is
   NOT flagged.  Target anomaly rate ≈ 5-10 % of records.

3. YoY prior_year_spend – Matched from actual monthly actuals of the
   comparable prior-year period rather than carried forward from the source
   file unchanged.

4. Continuous forecasting series – 10 representative dept/category
   combinations are guaranteed 36 months of synthetic history (FY2024-FY2026)
   so ML models have something to train on.

5. is_synthetic column – Every row carries a boolean flag.

Run:
    python3 enhance_dataset.py

Output:
    Team6Dataset_Enhanced.xlsx   (same directory as this script)
"""

import os
import math
import warnings
from copy import deepcopy

import numpy as np
import pandas as pd
from openpyxl.utils import get_column_letter

warnings.filterwarnings("ignore")

# ── reproducibility ──────────────────────────────────────────────────────────
RNG = np.random.default_rng(42)

# ── file paths ────────────────────────────────────────────────────────────────
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
SOURCE_FILE = os.path.join(SCRIPT_DIR, "Team6Dataset.xlsx")
OUTPUT_FILE = os.path.join(SCRIPT_DIR, "Team6Dataset_Enhanced.xlsx")

# ── fiscal calendar (university: Jul–Jun) ────────────────────────────────────
FY_QUARTER_MONTHS = {
    "Q1": [7, 8, 9],
    "Q2": [10, 11, 12],
    "Q3": [1, 2, 3],
    "Q4": [4, 5, 6],
}

# FY label → calendar year of that FY's Q1 start (Jul)
FY_CAL_YEAR = {
    "FY2024": 2023,
    "FY2025": 2024,
    "FY2026": 2025,
}

def fy_quarter_to_ym(fy: str, q: str) -> list:
    """Return [(cal_year, cal_month), ...] for the 3 months of a fiscal quarter."""
    base = FY_CAL_YEAR.get(fy, 2023)
    months = FY_QUARTER_MONTHS.get(q, [1, 2, 3])
    result = []
    for m in months:
        yr = base if m >= 7 else base + 1
        result.append((yr, m))
    return result

# ── seasonal multiplier profiles (Jan=0 … Dec=11) ────────────────────────────
SEASONAL = {
    "Personnel & Salaries":   [1.00,1.00,1.00,1.00,1.00,1.00,0.85,0.85,1.05,1.05,1.05,1.10],
    "Student Scholarships":   [0.80,0.80,1.20,0.70,0.70,0.80,1.40,1.40,1.30,0.60,0.60,0.70],
    "Technology & Equipment": [1.00,0.90,0.90,0.90,0.90,1.10,0.80,0.80,1.20,1.20,1.40,1.10],
    "Consulting & Contracts": [1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00],
    "Maintenance & Repairs":  [0.90,0.90,1.00,1.00,1.00,1.10,1.10,1.10,1.00,0.90,1.00,1.10],
    "Research Operations":    [0.95,0.95,1.00,1.00,1.05,1.05,0.90,0.90,1.05,1.10,1.05,1.00],
    "Travel & Conferences":   [0.80,0.80,1.10,1.00,1.10,1.20,0.70,0.80,1.20,1.20,1.10,0.80],
    "Administrative Costs":   [1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.10],
}
DEFAULT_SEASONAL = [1.0] * 12

def seasonal_weights(category: str, cal_months: list, seed_extra: int = 0) -> np.ndarray:
    """Normalised per-month weights with small random noise."""
    profile = SEASONAL.get(category, DEFAULT_SEASONAL)
    w = np.array([profile[m - 1] for m in cal_months], dtype=float)
    rng2 = np.random.default_rng(42 + seed_extra)
    w *= rng2.uniform(0.93, 1.07, size=len(w))
    return w / w.sum()

def split_to_months(total, weights: np.ndarray) -> list:
    """Split total into len(weights) parts that sum exactly to total."""
    if total is None or (isinstance(total, float) and math.isnan(total)):
        return [None] * len(weights)
    parts = [round(float(total) * float(w), 2) for w in weights]
    parts[-1] = round(float(total) - sum(parts[:-1]), 2)
    return parts

# ── anomaly thresholds (tiered: need BOTH dollar AND pct to trigger) ──────────
# Goal: ~5-10% anomaly rate instead of ~59%
ANOMALY_THRESHOLDS = {
    # (variance_pct_min, variance_abs_min_usd) to flag Overrun/Underspend
    "overrun_pct":    20.0,   # >20 % over budget
    "overrun_abs":  2000.0,   # AND >$2,000 over budget
    "underspend_pct": -25.0,  # <-25 % under budget
    "underspend_abs": 2000.0, # AND >$2,000 under budget (absolute)
    "yoy_spike_pct":  40.0,   # >40 % YoY change
    "yoy_spike_abs":  3000.0, # AND >$3,000 absolute change
    "forecast_dev_pct": 15.0, # forecast accuracy < 85 % (i.e. error > 15 %)
    "forecast_dev_abs": 1500.0,
}

# ── report-level metric columns (kept only on first expanded month) ───────────
REPORT_METRIC_COLS = [
    "num_spreadsheet_versions",
    "manual_adjustments_count",
    "data_entry_errors",
    "days_to_produce_report",
    "approval_cycles",
    "stakeholders_involved",
    "confidence_score_1to5",
]

# ── 10 representative dept/category combinations for 36-month series ──────────
FORECAST_SERIES = [
    ("College of Pharmacy",       "Personnel & Salaries",   "Internal"),
    ("University Library",        "Administrative Costs",   "State"),
    ("College of Architecture",   "Research Operations",    "Federal"),
    ("IT Services",               "Technology & Equipment", "Internal"),
    ("Student Affairs",           "Student Scholarships",   "Grant"),
    ("Facilities Management",     "Maintenance & Repairs",  "Internal"),
    ("College of Business",       "Consulting & Contracts", "State"),
    ("Research Institute",        "Research Operations",    "Federal"),
    ("College of Engineering",    "Personnel & Salaries",   "Grant"),
    ("Finance & Administration",  "Administrative Costs",   "Internal"),
]

# Base monthly spend for each series (realistic university scale ~$8k-$45k/month)
SERIES_BASE_MONTHLY = {
    ("College of Pharmacy",       "Personnel & Salaries",   "Internal"): 38000,
    ("University Library",        "Administrative Costs",   "State"):    12000,
    ("College of Architecture",   "Research Operations",    "Federal"):  22000,
    ("IT Services",               "Technology & Equipment", "Internal"): 18000,
    ("Student Affairs",           "Student Scholarships",   "Grant"):    15000,
    ("Facilities Management",     "Maintenance & Repairs",  "Internal"): 10000,
    ("College of Business",       "Consulting & Contracts", "State"):    14000,
    ("Research Institute",        "Research Operations",    "Federal"):  28000,
    ("College of Engineering",    "Personnel & Salaries",   "Grant"):    32000,
    ("Finance & Administration",  "Administrative Costs",   "Internal"):  9000,
}

# Annual growth rate per category
ANNUAL_GROWTH = {
    "Personnel & Salaries":   0.035,
    "Administrative Costs":   0.025,
    "Research Operations":    0.040,
    "Technology & Equipment": 0.030,
    "Student Scholarships":   0.045,
    "Maintenance & Repairs":  0.020,
    "Consulting & Contracts": 0.030,
}


# ─────────────────────────────────────────────────────────────────────────────
# FINANCIAL CALCULATION HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def recalc_derived(row: dict) -> dict:
    """Recompute variance, yoy, forecast_accuracy from raw financial fields."""
    budget = row.get("budgeted_amount_usd")
    actual = row.get("actual_spend_usd")
    fore   = row.get("forecasted_amount_usd")
    prior  = row.get("prior_year_spend_usd")

    # variance
    if budget is not None and actual is not None and not _nan(budget) and not _nan(actual):
        row["variance_usd"] = round(actual - budget, 2)
        row["variance_pct"] = round((actual - budget) / budget * 100, 2) if budget != 0 else None
    else:
        row["variance_usd"] = None
        row["variance_pct"] = None

    # yoy – will be overwritten later from matched prior actuals where available
    if prior is not None and not _nan(prior) and prior != 0 and actual is not None and not _nan(actual):
        row["yoy_change_pct"] = round((actual - prior) / prior * 100, 2)
    else:
        row["yoy_change_pct"] = None

    # forecast accuracy
    if (fore is not None and not _nan(fore)
            and actual is not None and not _nan(actual) and actual != 0):
        row["forecast_accuracy_pct"] = round(100 - abs((fore - actual) / actual * 100), 2)
    else:
        row["forecast_accuracy_pct"] = None

    return row

def _nan(v):
    try:
        return math.isnan(float(v))
    except (TypeError, ValueError):
        return False

def _fv(v):
    """Return float or None."""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ─────────────────────────────────────────────────────────────────────────────
# ANOMALY CLASSIFICATION  (tiered thresholds)
# ─────────────────────────────────────────────────────────────────────────────

def classify_anomaly(row: dict) -> tuple:
    """
    Return (anomaly_detected: int, anomaly_type: str|None).
    Uses tiered dollar+percent thresholds so normal variation is NOT flagged.
    """
    variance_pct = _fv(row.get("variance_pct"))
    variance_usd = _fv(row.get("variance_usd"))
    yoy_pct      = _fv(row.get("yoy_change_pct"))
    fa_pct       = _fv(row.get("forecast_accuracy_pct"))
    actual       = _fv(row.get("actual_spend_usd"))
    fore         = _fv(row.get("forecasted_amount_usd"))

    T = ANOMALY_THRESHOLDS

    # 1. Overrun: BOTH percent AND absolute dollar exceed threshold
    if (variance_pct is not None and variance_usd is not None
            and variance_pct > T["overrun_pct"]
            and variance_usd > T["overrun_abs"]):
        return 1, "Overrun"

    # 2. Underspend: BOTH percent AND absolute dollar exceed threshold
    if (variance_pct is not None and variance_usd is not None
            and variance_pct < T["underspend_pct"]
            and abs(variance_usd) > T["underspend_abs"]):
        return 1, "Underspend"

    # 3. YoY Spike
    if (yoy_pct is not None and actual is not None
            and abs(yoy_pct) > T["yoy_spike_pct"]
            and actual > 0):
        # also require a meaningful absolute change
        prior = _fv(row.get("prior_year_spend_usd"))
        if prior is not None and abs(actual - prior) > T["yoy_spike_abs"]:
            return 1, "YoY Spike"

    # 4. Forecast Deviation
    if (fa_pct is not None and actual is not None and fore is not None
            and fa_pct < (100 - T["forecast_dev_pct"])
            and actual > 0
            and abs(actual - fore) > T["forecast_dev_abs"]):
        return 1, "Forecast Deviation"

    # 5. Misallocation: non-zero budget, zero actual (operational record only)
    budget = _fv(row.get("budgeted_amount_usd"))
    if (budget is not None and budget > 5000
            and actual is not None and actual == 0
            and row.get("report_status") in ("Draft", "Under Review")):
        return 1, "Misallocation"

    return 0, None


def anomaly_review_status(report_status: str,
                          orig_anomaly: int, orig_type,
                          new_anomaly: int,  new_type) -> str:
    """Business-rule-driven review status."""
    if report_status == "Finalized":
        # Never change approved anomaly; flag newly discovered ones
        if new_anomaly == 1 and orig_anomaly == 0:
            return "Flagged for Historical Review"
        if orig_anomaly == 1:
            # Check if the type CHANGED vs what was calculated
            if orig_type != new_type and new_type is not None:
                return "Locked - Type Mismatch Noted"
            return "Locked - Approved"
        return "No Anomaly"

    if report_status == "Draft":
        return "Pending Correction" if new_anomaly == 1 else "No Anomaly"

    if report_status == "Under Review":
        return "Pending Approval" if new_anomaly == 1 else "No Anomaly"

    if report_status == "Delayed":
        return "Delayed - Anomaly Outstanding" if new_anomaly == 1 else "Delayed - No Anomaly"

    return "No Anomaly"


# ─────────────────────────────────────────────────────────────────────────────
# MONTHLY RECORD EXPANSION
# ─────────────────────────────────────────────────────────────────────────────

def expand_source_records(src_df: pd.DataFrame) -> list:
    """
    Expand each source row into monthly records.
    - 'Monthly' report type: assigned to one plausible month within the quarter
      (cycles through months 0,1,2 across records to spread them naturally).
    - All other types: split across all 3 months of the quarter.
    Returns a list of row dicts.
    """
    rows = []
    counter = [0]           # mutable counter shared across iterations
    monthly_offset = {}     # tracks which offset to use per (fy, q) for Monthly records

    def next_id():
        counter[0] += 1
        return f"M-{counter[0]:06d}"

    for seq, orig in src_df.iterrows():
        row      = orig.to_dict()
        fy       = str(row.get("fiscal_year",    "FY2024")).strip()
        q        = str(row.get("fiscal_quarter", "Q1")).strip()
        rtype    = str(row.get("report_type",    "")).strip()
        cat      = str(row.get("budget_category","")).strip()
        src_id   = row.get("record_id", f"BUD-{seq:05d}")
        status   = str(row.get("report_status",  "Draft")).strip()

        ym_all   = fy_quarter_to_ym(fy, q)   # 3 months

        if rtype == "Monthly":
            # Assign to one month within the quarter, cycling so records spread
            key = (fy, q)
            off = monthly_offset.get(key, 0)
            monthly_offset[key] = (off + 1) % 3
            ym_list = [ym_all[off]]
            # NOTE: amount represents exactly one month – do NOT split further
            split_fin = {col: [row.get(col)] for col in
                         ["budgeted_amount_usd","actual_spend_usd",
                          "forecasted_amount_usd","prior_year_spend_usd"]}
        else:
            ym_list  = ym_all
            cal_months = [m for _, m in ym_list]
            w        = seasonal_weights(cat, cal_months, seed_extra=seq)
            split_fin = {}
            for col in ["budgeted_amount_usd","actual_spend_usd",
                        "forecasted_amount_usd","prior_year_spend_usd"]:
                split_fin[col] = split_to_months(row.get(col), w)

        orig_anomaly = int(row.get("anomaly_detected", 0) or 0)
        orig_type    = row.get("anomaly_type")

        for i, (cal_yr, cal_mo) in enumerate(ym_list):
            nr = deepcopy(row)
            nr["source_record_id"] = src_id
            nr["record_id"]        = next_id()
            nr["month"]            = pd.Timestamp(year=cal_yr, month=cal_mo, day=1)
            nr["is_synthetic"]     = False

            # Financial splits
            for col in ["budgeted_amount_usd","actual_spend_usd",
                        "forecasted_amount_usd","prior_year_spend_usd"]:
                nr[col] = split_fin[col][i]

            # Report-level metrics only on the first sub-row (no double-counting)
            if i > 0:
                for mc in REPORT_METRIC_COLS:
                    nr[mc] = None

            # Recalculate derived fields
            nr = recalc_derived(nr)

            # Anomaly classification
            if status == "Finalized":
                # Preserve approved labels; compute new to detect mismatches
                new_a, new_t = classify_anomaly(nr)
                nr["anomaly_detected"] = orig_anomaly
                nr["anomaly_type"]     = orig_type
                ars = anomaly_review_status(status, orig_anomaly, orig_type, new_a, new_t)
            else:
                new_a, new_t = classify_anomaly(nr)
                nr["anomaly_detected"] = new_a
                nr["anomaly_type"]     = new_t if new_a == 1 else None
                ars = anomaly_review_status(status, orig_anomaly, orig_type, new_a, new_t)

            nr["anomaly_review_status"] = ars

            # include_in_totals = True for all source-derived rows at this stage;
            # will be corrected for overlaps after full build
            nr["include_in_totals"] = True

            rows.append(nr)

    return rows


# ─────────────────────────────────────────────────────────────────────────────
# OVERLAP RESOLUTION
# ─────────────────────────────────────────────────────────────────────────────

def resolve_overlaps(df: pd.DataFrame) -> pd.DataFrame:
    """
    When multiple source-derived rows share (department, budget_category,
    fund_source, month) AND come from different report types, only one
    should count toward financial totals.

    Priority: Monthly > Quarterly > Mid-Year > Annual > Ad-Hoc > Year-End
    The highest-priority record keeps include_in_totals=True; the rest become False.
    Purely synthetic rows are never demoted.
    """
    priority = {
        "Monthly":  1,
        "Quarterly":2,
        "Mid-Year": 3,
        "Annual":   4,
        "Ad-Hoc":   5,
        "Year-End": 6,
    }

    group_key = ["department", "budget_category", "fund_source", "month"]
    # Only look at source-derived records
    src_mask = df["is_synthetic"] == False

    # Map report_type → priority number
    df["_prio"] = df["report_type"].map(priority).fillna(9)

    for name, grp in df[src_mask].groupby(group_key, dropna=False):
        if len(grp) <= 1:
            continue
        best_idx = grp["_prio"].idxmin()
        demote   = grp.index.difference([best_idx])
        df.loc[demote, "include_in_totals"] = False

    df.drop(columns=["_prio"], inplace=True)
    return df


# ─────────────────────────────────────────────────────────────────────────────
# SYNTHETIC 36-MONTH SERIES
# ─────────────────────────────────────────────────────────────────────────────

def build_synthetic_series(existing_df: pd.DataFrame, counter_start: int) -> tuple:
    """
    For each of the 10 FORECAST_SERIES combinations, generate monthly records
    for every month in FY2024-FY2026 that is not already covered by a
    source-derived row with include_in_totals=True.

    Returns (list_of_new_rows, final_counter).
    """
    # Build a set of covered (dept, cat, fund, month) from source rows
    covered = set()
    src_rows = existing_df[existing_df["include_in_totals"] == True]
    for _, r in src_rows.iterrows():
        key = (r["department"], r["budget_category"],
               r.get("fund_source",""), str(r["month"])[:7])
        covered.add(key)

    # All 36 calendar months Jul 2023 – Jun 2026
    all_months = []
    for fy, base_yr in [("FY2024", 2023), ("FY2025", 2024), ("FY2026", 2025)]:
        for q, mnums in FY_QUARTER_MONTHS.items():
            for m in mnums:
                yr = base_yr if m >= 7 else base_yr + 1
                all_months.append(pd.Timestamp(year=yr, month=m, day=1))
    all_months = sorted(set(all_months))

    # Determine departments/categories actually in source for fallback metadata
    dept_meta = {}
    for _, r in existing_df.iterrows():
        k = (r["department"], r["budget_category"], r.get("fund_source",""))
        if k not in dept_meta:
            dept_meta[k] = {
                "fund_source": r.get("fund_source","Internal"),
                "num_spreadsheet_versions": r.get("num_spreadsheet_versions", 3),
                "manual_adjustments_count": r.get("manual_adjustments_count", 1),
                "data_entry_errors":         r.get("data_entry_errors", 0),
                "days_to_produce_report":    r.get("days_to_produce_report", 15),
                "approval_cycles":           r.get("approval_cycles", 2),
                "stakeholders_involved":     r.get("stakeholders_involved", 4),
                "confidence_score_1to5":     r.get("confidence_score_1to5", 3),
            }

    new_rows = []
    ctr = counter_start
    rng = np.random.default_rng(99)

    for (dept, cat, fund) in FORECAST_SERIES:
        base = SERIES_BASE_MONTHLY.get((dept, cat, fund), 15000)
        growth = ANNUAL_GROWTH.get(cat, 0.03)
        profile = SEASONAL.get(cat, DEFAULT_SEASONAL)

        # Gather meta from source if this combo exists, else defaults
        meta = dept_meta.get((dept, cat, fund), {
            "fund_source": fund,
            "num_spreadsheet_versions": 3,
            "manual_adjustments_count": 1,
            "data_entry_errors": 0,
            "days_to_produce_report": 14,
            "approval_cycles": 2,
            "stakeholders_involved": 4,
            "confidence_score_1to5": 3,
        })

        # Collect actuals for prior-year lookup
        monthly_actuals = {}  # (yr, mo) → actual

        for ts in all_months:
            yr, mo = ts.year, ts.month
            key = (dept, cat, fund, str(ts)[:7])

            if key in covered:
                # Already have a real record for this month; skip synthesis
                # but still track the actual for YoY purposes
                match = src_rows[
                    (src_rows["department"] == dept) &
                    (src_rows["budget_category"] == cat) &
                    (src_rows["month"] == ts)
                ]
                if len(match) > 0:
                    monthly_actuals[(yr, mo)] = _fv(match.iloc[0]["actual_spend_usd"])
                continue

            # ── Determine fiscal year and quarter for this month ──────────────
            if mo in [7, 8, 9]:
                fy_q = "Q1"
            elif mo in [10, 11, 12]:
                fy_q = "Q2"
            elif mo in [1, 2, 3]:
                fy_q = "Q3"
            else:
                fy_q = "Q4"
            fy_label = f"FY{yr + 1}" if mo >= 7 else f"FY{yr}"

            # FY2024=1, FY2025=2, FY2026=3 for growth calculation
            fy_num = {"FY2024": 0, "FY2025": 1, "FY2026": 2}.get(fy_label, 0)

            # ── Synthetic actual spend ────────────────────────────────────────
            seasonal_mult = profile[mo - 1]
            growth_mult   = (1 + growth) ** fy_num
            noise         = rng.uniform(0.90, 1.12)

            actual = round(base * seasonal_mult * growth_mult * noise, 2)

            # Budget is slightly different from actual (planned ahead)
            budget_noise = rng.uniform(0.92, 1.08)
            budget = round(base * seasonal_mult * growth_mult * budget_noise, 2)

            # Forecast: issued before the period; slightly off
            forecast_noise = rng.uniform(0.93, 1.09)
            forecast = round(actual * forecast_noise, 2)

            # Prior year (same month, one year earlier)
            prior_yr_key = (yr - 1, mo)
            prior_actual = monthly_actuals.get(prior_yr_key)
            if prior_actual is None:
                # Estimate: base / growth
                prior_actual = round(
                    base * profile[mo - 1] * ((1 + growth) ** max(0, fy_num - 1)) * 1.0,
                    2
                )

            # Occasionally inject a spending spike (~5% chance per row)
            is_spike = rng.random() < 0.05
            if is_spike:
                actual = round(actual * rng.uniform(1.3, 1.6), 2)

            monthly_actuals[(yr, mo)] = actual

            # ── Derived calculations ──────────────────────────────────────────
            variance_usd = round(actual - budget, 2)
            variance_pct = round((actual - budget) / budget * 100, 2) if budget != 0 else None
            yoy_pct      = round((actual - prior_actual) / prior_actual * 100, 2) if prior_actual != 0 else None
            fa_pct       = round(100 - abs((forecast - actual) / actual * 100), 2) if actual != 0 else None

            # ── Report status and metrics ─────────────────────────────────────
            # FY2024 and most of FY2025 = Finalized; recent FY2026 = Draft/Under Review
            if fy_label == "FY2024":
                r_status = "Finalized"
            elif fy_label == "FY2025":
                r_status = "Finalized" if rng.random() < 0.75 else "Under Review"
            else:
                r_status = rng.choice(["Draft", "Under Review", "Delayed"],
                                      p=[0.55, 0.35, 0.10])

            # ── Anomaly detection ─────────────────────────────────────────────
            tmp = {
                "budgeted_amount_usd":  budget,
                "actual_spend_usd":     actual,
                "forecasted_amount_usd": forecast,
                "variance_pct":         variance_pct,
                "variance_usd":         variance_usd,
                "yoy_change_pct":       yoy_pct,
                "forecast_accuracy_pct": fa_pct,
                "prior_year_spend_usd": prior_actual,
                "report_status":        r_status,
            }
            new_a, new_t = classify_anomaly(tmp)
            ars = anomaly_review_status(r_status, 0, None, new_a, new_t)

            ctr += 1
            row = {
                "record_id":                 f"S-{ctr:06d}",
                "department":                dept,
                "budget_category":           cat,
                "fiscal_year":               fy_label,
                "fiscal_quarter":            fy_q,
                "source_record_id":          None,
                "month":                     ts,
                "fund_source":               fund,
                "report_type":               "Monthly",
                "budgeted_amount_usd":       budget,
                "actual_spend_usd":          actual,
                "forecasted_amount_usd":     forecast,
                "variance_usd":              variance_usd,
                "variance_pct":              variance_pct,
                "prior_year_spend_usd":      prior_actual,
                "yoy_change_pct":            yoy_pct,
                "forecast_accuracy_pct":     fa_pct,
                "num_spreadsheet_versions":  int(meta["num_spreadsheet_versions"]),
                "manual_adjustments_count":  int(meta["manual_adjustments_count"]),
                "data_entry_errors":         int(meta["data_entry_errors"]),
                "days_to_produce_report":    round(float(meta["days_to_produce_report"]), 1),
                "approval_cycles":           int(meta["approval_cycles"]),
                "stakeholders_involved":     int(meta["stakeholders_involved"]),
                "confidence_score_1to5":     int(meta["confidence_score_1to5"]),
                "anomaly_detected":          new_a,
                "anomaly_type":              new_t if new_a == 1 else None,
                "report_status":             r_status,
                "anomaly_review_status":     ars,
                "include_in_totals":         True,
                "is_synthetic":              True,
            }
            new_rows.append(row)

    return new_rows, ctr


# ─────────────────────────────────────────────────────────────────────────────
# YoY CORRECTION  (match prior-year actuals from within the dataset)
# ─────────────────────────────────────────────────────────────────────────────

def fix_yoy(df: pd.DataFrame) -> pd.DataFrame:
    """
    Replace prior_year_spend_usd and yoy_change_pct with values computed from
    actual monthly actuals already in the dataset where a match exists.
    Only use include_in_totals=True rows to avoid double-counting.
    Leave blank when no prior-year match exists.
    """
    # Build lookup: (dept, cat, fund, year, month) → actual_spend_usd
    actuals_map = {}
    for _, r in df[df["include_in_totals"] == True].iterrows():
        if r["month"] is pd.NaT or r["month"] is None:
            continue
        key = (r["department"], r["budget_category"],
               r.get("fund_source",""), r["month"].year, r["month"].month)
        # If multiple records match (shouldn't after overlap resolution), take first
        if key not in actuals_map:
            v = _fv(r["actual_spend_usd"])
            if v is not None:
                actuals_map[key] = v

    updated = 0
    for idx, r in df.iterrows():
        if r["month"] is pd.NaT or r["month"] is None:
            continue
        yr, mo = r["month"].year, r["month"].month
        prior_key = (r["department"], r["budget_category"],
                     r.get("fund_source",""), yr - 1, mo)
        prior_val = actuals_map.get(prior_key)

        if prior_val is not None:
            actual = _fv(r["actual_spend_usd"])
            df.at[idx, "prior_year_spend_usd"] = prior_val
            if actual is not None and prior_val != 0:
                df.at[idx, "yoy_change_pct"] = round(
                    (actual - prior_val) / prior_val * 100, 2
                )
            else:
                df.at[idx, "yoy_change_pct"] = None
            updated += 1
        else:
            # No valid prior-year – blank it (avoids leakage from synthetic estimates)
            # Only blank if it was previously set from a non-verified source
            if not r.get("is_synthetic", False):
                # Source rows: if prior_year was in original data, keep as illustrative
                # but flag in yoy as unverified by leaving it as-is (already calculated)
                pass
            else:
                df.at[idx, "prior_year_spend_usd"] = None
                df.at[idx, "yoy_change_pct"] = None

    print(f"  YoY values updated from matched prior-year actuals: {updated}")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# COLUMN ORDERING
# ─────────────────────────────────────────────────────────────────────────────

COLUMN_ORDER = [
    "record_id",
    "source_record_id",
    "is_synthetic",
    "include_in_totals",
    "department",
    "budget_category",
    "fiscal_year",
    "fiscal_quarter",
    "month",
    "fund_source",
    "report_type",
    "report_status",
    "budgeted_amount_usd",
    "actual_spend_usd",
    "forecasted_amount_usd",
    "variance_usd",
    "variance_pct",
    "prior_year_spend_usd",
    "yoy_change_pct",
    "forecast_accuracy_pct",
    "num_spreadsheet_versions",
    "manual_adjustments_count",
    "data_entry_errors",
    "days_to_produce_report",
    "approval_cycles",
    "stakeholders_involved",
    "confidence_score_1to5",
    "anomaly_detected",
    "anomaly_type",
    "anomaly_review_status",
]


# ─────────────────────────────────────────────────────────────────────────────
# EXCEL WRITER
# ─────────────────────────────────────────────────────────────────────────────

def write_excel(df: pd.DataFrame, path: str):
    """Write the dataframe to Excel with formatting."""
    print(f"Writing {path} ...")

    currency_cols = {"budgeted_amount_usd", "actual_spend_usd",
                     "forecasted_amount_usd", "variance_usd",
                     "prior_year_spend_usd"}
    pct_cols      = {"variance_pct", "yoy_change_pct", "forecast_accuracy_pct"}
    int_like_cols = {"num_spreadsheet_versions", "manual_adjustments_count",
                     "data_entry_errors", "approval_cycles",
                     "stakeholders_involved", "confidence_score_1to5",
                     "anomaly_detected"}

    with pd.ExcelWriter(path, engine="xlsxwriter",
                        datetime_format="yyyy-mm-dd") as writer:
        df.to_excel(writer, sheet_name="Budget_Forecast_Data", index=False)

        wb  = writer.book
        ws  = writer.sheets["Budget_Forecast_Data"]

        hdr_fmt  = wb.add_format({"bold":True,"bg_color":"#1F4E79",
                                   "font_color":"white","border":1,
                                   "align":"center","valign":"vcenter",
                                   "text_wrap":True})
        cur_fmt  = wb.add_format({"num_format":'#,##0.00',"border":1})
        pct_fmt  = wb.add_format({"num_format":'0.00"%"',"border":1})
        date_fmt = wb.add_format({"num_format":"yyyy-mm-dd","border":1})
        int_fmt  = wb.add_format({"num_format":"0","border":1})
        txt_fmt  = wb.add_format({"border":1})
        red_fmt  = wb.add_format({"bg_color":"#FFE0E0","border":1})
        grn_fmt  = wb.add_format({"bg_color":"#E2EFDA","border":1})  # synthetic rows

        # Headers
        for ci, cn in enumerate(df.columns):
            ws.write(0, ci, cn, hdr_fmt)

        ws.freeze_panes(1, 0)

        # Column widths & formats
        for ci, cn in enumerate(df.columns):
            if cn in currency_cols:
                ws.set_column(ci, ci, 16, cur_fmt)
            elif cn in pct_cols:
                ws.set_column(ci, ci, 13, pct_fmt)
            elif cn == "month":
                ws.set_column(ci, ci, 12, date_fmt)
            elif cn in int_like_cols:
                ws.set_column(ci, ci, 10, int_fmt)
            else:
                try:
                    max_len = max(len(str(cn)),
                                  df[cn].dropna().astype(str).str.len().max())
                except Exception:
                    max_len = len(str(cn))
                ws.set_column(ci, ci, min(max(max_len + 2, 12), 38), txt_fmt)

        # Conditional format: anomaly rows → light red
        a_col = list(df.columns).index("anomaly_detected") if "anomaly_detected" in df.columns else None
        if a_col is not None:
            a_letter = get_column_letter(a_col + 1)
            ws.conditional_format(1, 0, len(df), len(df.columns)-1,
                                   {"type":"formula",
                                    "criteria":f"=${a_letter}2=1",
                                    "format":red_fmt})

        # Conditional format: synthetic rows → light green
        s_col = list(df.columns).index("is_synthetic") if "is_synthetic" in df.columns else None
        if s_col is not None:
            s_letter = get_column_letter(s_col + 1)
            ws.conditional_format(1, 0, len(df), len(df.columns)-1,
                                   {"type":"formula",
                                    "criteria":f"=${s_letter}2=TRUE",
                                    "format":grn_fmt})

        ws.autofilter(0, 0, len(df), len(df.columns)-1)

    print(f"  Written: {len(df):,} rows × {len(df.columns)} columns")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    # ── Load source ──────────────────────────────────────────────────────────
    print(f"Reading {SOURCE_FILE} ...")
    src_df = pd.read_excel(SOURCE_FILE, sheet_name="Budget_Forecast_Data",
                           engine="openpyxl")
    src_df.columns = [c.strip() for c in src_df.columns]
    print(f"  Source: {src_df.shape[0]} rows × {src_df.shape[1]} cols")

    # ── Expand source records to monthly ────────────────────────────────────
    print("Expanding source records to monthly ...")
    expanded = expand_source_records(src_df)
    df = pd.DataFrame(expanded)
    print(f"  After expansion: {len(df):,} rows")

    # ── Resolve overlapping dept/cat/fund/month records ──────────────────────
    print("Resolving overlapping records ...")
    df = resolve_overlaps(df)
    demoted = (df["include_in_totals"] == False).sum()
    print(f"  Records demoted (include_in_totals=False): {demoted}")

    # ── Build synthetic 36-month series for forecasting ──────────────────────
    print("Building synthetic 36-month forecasting series ...")
    synth_rows, _ = build_synthetic_series(df, counter_start=len(df) + 10000)
    print(f"  Synthetic rows generated: {len(synth_rows)}")

    # Append synthetic rows
    df = pd.concat([df, pd.DataFrame(synth_rows)], ignore_index=True)
    print(f"  Total rows after synthetic append: {len(df):,}")

    # ── Fix YoY using matched prior-year actuals ─────────────────────────────
    print("Fixing YoY calculations from matched actuals ...")
    df["month"] = pd.to_datetime(df["month"])
    df = fix_yoy(df)

    # ── Re-run anomaly detection after YoY is corrected ─────────────────────
    print("Re-running anomaly classification post-YoY fix ...")
    for idx, r in df.iterrows():
        status = str(r.get("report_status", "Draft"))
        if status == "Finalized":
            continue   # never touch finalized
        row_dict = r.to_dict()
        new_a, new_t = classify_anomaly(row_dict)
        orig_a = int(r.get("anomaly_detected", 0) or 0)
        orig_t = r.get("anomaly_type")
        ars = anomaly_review_status(status, orig_a, orig_t, new_a, new_t)
        df.at[idx, "anomaly_detected"]      = new_a
        df.at[idx, "anomaly_type"]          = new_t if new_a == 1 else None
        df.at[idx, "anomaly_review_status"] = ars

    # ── Column ordering ──────────────────────────────────────────────────────
    present   = [c for c in COLUMN_ORDER if c in df.columns]
    leftover  = [c for c in df.columns  if c not in present]
    df = df[present + leftover]

    # ── Type cleanup ─────────────────────────────────────────────────────────
    for col in ["budgeted_amount_usd","actual_spend_usd","forecasted_amount_usd",
                "prior_year_spend_usd","variance_usd","variance_pct",
                "yoy_change_pct","forecast_accuracy_pct"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").round(2)

    for col in ["anomaly_detected","num_spreadsheet_versions",
                "manual_adjustments_count","data_entry_errors",
                "approval_cycles","stakeholders_involved","confidence_score_1to5"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df["is_synthetic"]     = df["is_synthetic"].fillna(False).astype(bool)
    df["include_in_totals"]= df["include_in_totals"].fillna(True).astype(bool)
    df["month"]            = pd.to_datetime(df["month"])

    # ── Sort ─────────────────────────────────────────────────────────────────
    df.sort_values(["department","budget_category","month"], inplace=True)
    df.reset_index(drop=True, inplace=True)

    # ── Validation ───────────────────────────────────────────────────────────
    print("\n── Validation ──────────────────────────────────────────────────")

    # 1. Record uniqueness
    dupes = df["record_id"].duplicated().sum()
    print(f"  Duplicate record_ids:          {dupes}")

    # 2. Variance math (on include_in_totals rows)
    totals_df = df[df["include_in_totals"] == True].copy()
    vcheck = (totals_df["variance_usd"] -
              (totals_df["actual_spend_usd"] - totals_df["budgeted_amount_usd"])
             ).abs()
    print(f"  Variance calc errors > $0.02:  {(vcheck > 0.02).sum()}")

    # 3. Date range
    print(f"  Date range:  {df['month'].min().date()} → {df['month'].max().date()}")

    # 4. Anomaly rate
    total_rows     = len(df)
    anomaly_rows   = int(df["anomaly_detected"].fillna(0).sum())
    anomaly_rate   = anomaly_rows / total_rows * 100
    print(f"  Anomaly rate: {anomaly_rows}/{total_rows} = {anomaly_rate:.1f}%  "
          f"(target 5-10%)")

    # 5. Continuous series coverage
    print(f"\n  Forecasting series coverage (src + synthetic, include_in_totals):")
    totals_df_ts = df[df["include_in_totals"] == True]
    for (dept, cat, fund) in FORECAST_SERIES:
        sub = totals_df_ts[
            (totals_df_ts["department"]      == dept) &
            (totals_df_ts["budget_category"] == cat)
        ]
        months_covered = sub["month"].nunique()
        print(f"    {dept[:28]:<28} | {cat[:22]:<22} | {months_covered:2d}/36 months")

    # 6. Synthetic vs source
    n_synth = df["is_synthetic"].sum()
    print(f"\n  Synthetic rows:    {n_synth:,}")
    print(f"  Source-derived:    {total_rows - n_synth:,}")
    print(f"  include_in_totals: {int(df['include_in_totals'].sum()):,}")

    # 7. Anomaly review distribution
    print(f"\n  anomaly_review_status:")
    print(df["anomaly_review_status"].value_counts().to_string())

    # 8. Report status
    print(f"\n  report_status:")
    print(df["report_status"].value_counts().to_string())

    # 9. Finalized anomaly integrity
    fin_df = df[df["report_status"] == "Finalized"]
    mismatch = fin_df[fin_df["anomaly_review_status"] == "Locked - Type Mismatch Noted"]
    print(f"\n  Finalized records with type mismatch noted: {len(mismatch)}")

    # 10. Financial totals (include_in_totals only)
    print(f"\n  Financial totals (include_in_totals=True rows):")
    print(f"    Budget:   ${totals_df['budgeted_amount_usd'].sum():>15,.2f}")
    print(f"    Actual:   ${totals_df['actual_spend_usd'].sum():>15,.2f}")
    print(f"    Forecast: ${totals_df['forecasted_amount_usd'].sum():>15,.2f}")

    print(f"\n  Final shape: {df.shape}")
    print(f"  Columns ({len(df.columns)}): {list(df.columns)}")
    print("─" * 65)

    # ── Write Excel ───────────────────────────────────────────────────────────
    write_excel(df, OUTPUT_FILE)
    print(f"\nDone → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()

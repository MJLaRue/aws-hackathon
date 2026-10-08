"""
analytics.py
============
All financial calculation logic.  Every function accepts a pre-filtered
DataFrame (already restricted to include_in_totals=True rows) so
double-counting is impossible at the call site.

All monetary values are rounded to 2 decimal places.
All percentage values are rounded to 1 decimal place.
None / NaN values are handled gracefully throughout.
"""

import math
import numpy as np
import pandas as pd
from typing import Optional


# ── helpers ───────────────────────────────────────────────────────────────────

def _safe_pct(numerator, denominator, decimals: int = 1) -> Optional[float]:
    """Return numerator/denominator * 100, or None on zero/missing denominator."""
    try:
        d = float(denominator)
        n = float(numerator)
        if d == 0 or math.isnan(d) or math.isnan(n):
            return None
        return round(n / d * 100, decimals)
    except (TypeError, ValueError):
        return None


def _nv(v, default=0.0):
    """Numeric value or default when None/NaN."""
    try:
        f = float(v)
        return default if math.isnan(f) else f
    except (TypeError, ValueError):
        return default


def apply_filters(
    df: pd.DataFrame,
    fiscal_year:   Optional[str] = None,
    department:    Optional[str] = None,
    category:      Optional[str] = None,
    fund_source:   Optional[str] = None,
    report_status: Optional[str] = None,
    month_start:   Optional[str] = None,   # "YYYY-MM"
    month_end:     Optional[str] = None,   # "YYYY-MM"
    include_synthetic: bool = True,
) -> pd.DataFrame:
    """
    Apply optional dimension filters.  Returns a filtered copy.
    All filters are case-insensitive substring matches except exact-match
    categorical fields (fiscal_year, report_status).
    """
    out = df.copy()

    if fiscal_year:
        out = out[out["fiscal_year"] == fiscal_year]
    if department:
        out = out[out["department"].str.contains(department, case=False, na=False)]
    if category:
        out = out[out["budget_category"].str.contains(category, case=False, na=False)]
    if fund_source:
        out = out[out["fund_source"].str.contains(fund_source, case=False, na=False)]
    if report_status:
        out = out[out["report_status"] == report_status]
    if month_start:
        out = out[out["month"] >= pd.Timestamp(month_start)]
    if month_end:
        # include all days in the end month
        out = out[out["month"] <= pd.Timestamp(month_end) + pd.offsets.MonthEnd(0)]
    if not include_synthetic:
        out = out[out["is_synthetic"] == False]

    return out


# ── KPI summary ───────────────────────────────────────────────────────────────

def kpi_summary(df: pd.DataFrame) -> dict:
    """
    Top-level KPI card values.
    df must already be filtered to include_in_totals=True rows.
    """
    total_budget   = round(df["budgeted_amount_usd"].sum(),  2)
    total_actual   = round(df["actual_spend_usd"].sum(),     2)
    total_forecast = round(df["forecasted_amount_usd"].sum(), 2)
    total_variance = round(total_actual - total_budget,       2)
    variance_pct   = _safe_pct(total_variance, total_budget)

    anomaly_count  = int(df["anomaly_detected"].fillna(0).sum())
    total_records  = len(df)

    # Average forecast accuracy (exclude rows where it is null)
    fa_series = df["forecast_accuracy_pct"].dropna()
    avg_forecast_accuracy = round(float(fa_series.mean()), 1) if len(fa_series) > 0 else None

    return {
        "total_budget":            total_budget,
        "total_actual":            total_actual,
        "total_forecast":          total_forecast,
        "total_variance_usd":      total_variance,
        "total_variance_pct":      variance_pct,
        "anomaly_count":           anomaly_count,
        "anomaly_rate_pct":        _safe_pct(anomaly_count, total_records),
        "avg_forecast_accuracy":   avg_forecast_accuracy,
        "total_records":           total_records,
    }


# ── monthly trends ────────────────────────────────────────────────────────────

def monthly_trend(df: pd.DataFrame) -> list:
    """
    Monthly budget vs actual vs forecast totals, sorted by month.
    Returns a list of dicts suitable for a time-series chart.
    """
    if "month" not in df.columns or df["month"].isna().all():
        return []

    grp = (
        df.groupby(df["month"].dt.to_period("M"))
        .agg(
            budget   =("budgeted_amount_usd",   "sum"),
            actual   =("actual_spend_usd",      "sum"),
            forecast =("forecasted_amount_usd", "sum"),
            anomalies=("anomaly_detected",       lambda x: int(x.fillna(0).sum())),
        )
        .reset_index()
        .sort_values("month")
    )

    result = []
    for _, row in grp.iterrows():
        period = row["month"]
        result.append({
            "month":           str(period),          # "2024-07"
            "month_label":     period.strftime("%b %Y"),
            "budget":          round(float(_nv(row["budget"])),   2),
            "actual":          round(float(_nv(row["actual"])),   2),
            "forecast":        round(float(_nv(row["forecast"])), 2),
            "variance_usd":    round(float(_nv(row["actual"])) - float(_nv(row["budget"])), 2),
            "anomaly_count":   row["anomalies"],
        })
    return result


# ── department breakdown ──────────────────────────────────────────────────────

def department_breakdown(df: pd.DataFrame) -> list:
    """Budget, actual, variance per department, sorted by actual spend desc."""
    grp = (
        df.groupby("department", dropna=False)
        .agg(
            budget    =("budgeted_amount_usd", "sum"),
            actual    =("actual_spend_usd",    "sum"),
            anomalies =("anomaly_detected",    lambda x: int(x.fillna(0).sum())),
            records   =("record_id",           "count"),
        )
        .reset_index()
        .sort_values("actual", ascending=False)
    )

    result = []
    for _, row in grp.iterrows():
        b = float(_nv(row["budget"]))
        a = float(_nv(row["actual"]))
        result.append({
            "department":      row["department"],
            "budget":          round(b, 2),
            "actual":          round(a, 2),
            "variance_usd":    round(a - b, 2),
            "variance_pct":    _safe_pct(a - b, b),
            "anomaly_count":   row["anomalies"],
            "record_count":    int(row["records"]),
        })
    return result


# ── category breakdown ────────────────────────────────────────────────────────

def category_breakdown(df: pd.DataFrame) -> list:
    """Budget, actual, variance per budget_category."""
    grp = (
        df.groupby("budget_category", dropna=False)
        .agg(
            budget    =("budgeted_amount_usd", "sum"),
            actual    =("actual_spend_usd",    "sum"),
            anomalies =("anomaly_detected",    lambda x: int(x.fillna(0).sum())),
        )
        .reset_index()
        .sort_values("actual", ascending=False)
    )

    result = []
    for _, row in grp.iterrows():
        b = float(_nv(row["budget"]))
        a = float(_nv(row["actual"]))
        result.append({
            "category":        row["budget_category"],
            "budget":          round(b, 2),
            "actual":          round(a, 2),
            "variance_usd":    round(a - b, 2),
            "variance_pct":    _safe_pct(a - b, b),
            "anomaly_count":   row["anomalies"],
        })
    return result


# ── anomaly detail ────────────────────────────────────────────────────────────

def anomaly_records(df: pd.DataFrame, limit: int = 200) -> list:
    """
    Return anomaly records with key fields for the anomaly table.
    Finalized records with 'Locked - Type Mismatch Noted' are included
    so reviewers can see them.
    """
    anom = df[df["anomaly_detected"].fillna(0) == 1].copy()
    anom = anom.sort_values("month", ascending=False).head(limit)

    cols = [
        "record_id", "department", "budget_category", "fiscal_year",
        "fiscal_quarter", "month", "fund_source", "report_type",
        "report_status", "actual_spend_usd", "budgeted_amount_usd",
        "variance_usd", "variance_pct", "anomaly_type",
        "anomaly_review_status", "is_synthetic",
    ]
    cols = [c for c in cols if c in anom.columns]
    anom = anom[cols]

    records = []
    for _, row in anom.iterrows():
        r = {}
        for c in cols:
            v = row[c]
            if isinstance(v, (pd.Timestamp,)):
                r[c] = v.strftime("%Y-%m-%d") if not pd.isna(v) else None
            elif isinstance(v, float) and math.isnan(v):
                r[c] = None
            elif hasattr(v, "item"):          # numpy scalar
                r[c] = v.item()
            else:
                r[c] = v
        records.append(r)
    return records


# ── anomaly summary ───────────────────────────────────────────────────────────

def anomaly_summary(df: pd.DataFrame) -> dict:
    """Counts by anomaly_type and by anomaly_review_status."""
    anom = df[df["anomaly_detected"].fillna(0) == 1]

    by_type   = anom["anomaly_type"].value_counts().to_dict()
    by_status = anom["anomaly_review_status"].value_counts().to_dict()

    # Also count Finalized mismatches
    fin_mismatch = int(
        (df["anomaly_review_status"] == "Locked - Type Mismatch Noted").sum()
    )

    return {
        "total_anomalies":   int(anom["anomaly_detected"].fillna(0).sum()),
        "by_type":           {str(k): int(v) for k, v in by_type.items()},
        "by_review_status":  {str(k): int(v) for k, v in by_status.items()},
        "finalized_mismatches": fin_mismatch,
    }


# ── filter option enumerations ────────────────────────────────────────────────

def filter_options(df: pd.DataFrame) -> dict:
    """
    Return sorted unique values for each filter dimension.
    Used to populate dropdown menus in the frontend.
    """
    def _sorted_unique(col):
        return sorted(df[col].dropna().unique().tolist()) if col in df.columns else []

    months = sorted(
        df["month"].dropna().dt.strftime("%Y-%m").unique().tolist()
    ) if "month" in df.columns else []

    return {
        "fiscal_years":    _sorted_unique("fiscal_year"),
        "departments":     _sorted_unique("department"),
        "categories":      _sorted_unique("budget_category"),
        "fund_sources":    _sorted_unique("fund_source"),
        "report_statuses": _sorted_unique("report_status"),
        "months":          months,
    }


# ── spending trend per dept/category (for forecasting series) ─────────────────

def series_trend(df: pd.DataFrame, department: str, category: str) -> list:
    """
    Monthly actual spend for a specific dept+category pair.
    Returns rows sorted by month — ready to feed a forecasting model.
    """
    sub = df[
        (df["department"] == department) &
        (df["budget_category"] == category)
    ].sort_values("month")

    return [
        {
            "month":        row["month"].strftime("%Y-%m") if not pd.isna(row["month"]) else None,
            "actual":       round(float(_nv(row["actual_spend_usd"])), 2),
            "budget":       round(float(_nv(row["budgeted_amount_usd"])), 2),
            "forecast":     round(float(_nv(row["forecasted_amount_usd"])), 2),
            "is_synthetic": bool(row.get("is_synthetic", False)),
        }
        for _, row in sub.iterrows()
    ]

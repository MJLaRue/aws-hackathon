"""REST views for the dashboard panels. Anomalies and variance go through the same dispatcher as the chat tools (§3.7)."""
from __future__ import annotations

import numpy as np
from pydantic import BaseModel

from forecasting.cv import rolling_origin_cv, select_best
from forecasting.forecast import forecastable_entities, ratio_series, run_forecast
from tools.dispatcher import dispatch_tool

BUD_INCONSISTENCY_SQL = ("SELECT record_id FROM budget_records WHERE source_variance = 0.0 AND variance_pct != 0.0 "
                         "ORDER BY record_id")


GAP_BUCKETS = [(0.0, 1.0, "Under 1%"), (1.0, 2.5, "1% to 2.5%"), (2.5, 5.0, "2.5% to 5%"), (5.0, 10.0, "5% to 10%"),
               (10.0, 20.0, "10% to 20%"), (20.0, None, "20% or more")]


class ModelScore(BaseModel):
    model: str
    cv_mae: float
    cv_smape: float
    folds: int
    selected: bool


class GapBucket(BaseModel):
    label: str
    rows: int


class BenchmarkResponse(BaseModel):
    model_name: str | None
    cv_mae: float | None
    cv_smape: float | None
    n_quarters: int | None
    forecast_target: str
    source_rows_compared: int
    mean_gap: float | None
    max_gap: float | None
    caveat: str | None
    inconsistent_variance_records: list[str]
    inconsistency_warnings: list[str]
    model_comparison: list[ModelScore] = []      # every candidate's rolling-origin CV score on the total series
    gap_median: float | None = None
    gap_histogram: list[GapBucket] = []          # |source forecast - actual| / actual, in % buckets
    gap_under_1pct_share: float | None = None


def caveat_text(mean_gap: float | None, max_gap: float | None) -> str | None:
    """§10.2: wording depends on the computed mean gap; no figures are hard coded."""
    if mean_gap is None or max_gap is None:
        return None
    if mean_gap < 5:
        return (f"Note: The source forecast (forecasted_amount_usd) shows a mean absolute gap of {mean_gap:.1f}% "
                f"(max {max_gap:.2f}%) versus actuals. This is unusually close and may indicate post-hoc adjustment. "
                "The source forecast was not used as a model input.")
    return (f"Source forecast accuracy: {mean_gap:.1f}% mean absolute gap versus actuals (max {max_gap:.2f}%). "
            "Treat as an upper-bound reference only. The source forecast was not used as a model input.")


def get_benchmark(conn, dataset_id: str) -> BenchmarkResponse:
    row = conn.execute(
        "SELECT COUNT(*), AVG(ABS(source_forecast - actual) / NULLIF(actual, 0) * 100), "
        "MAX(ABS(source_forecast - actual) / NULLIF(actual, 0) * 100) FROM budget_records "
        "WHERE source_forecast IS NOT NULL AND actual != 0").fetchone()
    n, mean_gap, max_gap = int(row[0]), row[1], row[2]
    fc = run_forecast(conn, dataset_id, "total", None)
    gaps = [float(r[0]) for r in conn.execute(
        "SELECT ABS(source_forecast - actual) / NULLIF(actual, 0) * 100 FROM budget_records "
        "WHERE source_forecast IS NOT NULL AND actual != 0").fetchall() if r[0] is not None]
    hist = [GapBucket(label=lab, rows=sum(1 for g in gaps if g >= lo and (hi is None or g < hi))) for lo, hi, lab in GAP_BUCKETS]
    cv = rolling_origin_cv([r for _, r in ratio_series(conn, "total", None)])
    best = select_best(cv)
    comparison = sorted((ModelScore(model=m, cv_mae=v["mae"], cv_smape=v["smape"], folds=v["folds"], selected=m == best)
                         for m, v in cv.items()), key=lambda x: x.cv_mae)
    ids = [r[0] for r in conn.execute(BUD_INCONSISTENCY_SQL).fetchall()]
    warnings = [f"{rid}: variance_usd=$0.00 but variance_pct≠0 (inconsistent). This record is carried as-is." for rid in ids]
    return BenchmarkResponse(
        model_name=fc.model_name, cv_mae=fc.cv_mae, cv_smape=fc.cv_smape, n_quarters=fc.n_quarters,
        forecast_target=fc.forecast_target, source_rows_compared=n,
        mean_gap=float(mean_gap) if mean_gap is not None else None,
        max_gap=float(max_gap) if max_gap is not None else None,
        caveat=caveat_text(mean_gap, max_gap), inconsistent_variance_records=ids, inconsistency_warnings=warnings,
        model_comparison=comparison, gap_median=float(np.median(gaps)) if gaps else None, gap_histogram=hist,
        gap_under_1pct_share=(sum(1 for g in gaps if g < 1.0) / len(gaps)) if gaps else None)


def anomalies_view(conn, dataset_id: str, entity_level: str = "total", entity_name: str | None = None,
                   sensitivity: float = 2.5) -> dict:
    args = {"entity_level": entity_level, "sensitivity": sensitivity}
    if entity_name:
        args["entity_name"] = entity_name
    return dispatch_tool("detect_anomalies", args, conn, dataset_id)


def variance_view(conn, dataset_id: str, entity_level: str = "total", entity_name: str | None = None,
                  grain: str = "quarter") -> dict:
    args = {"entity_level": entity_level, "grain": grain}
    if entity_name:
        args["entity_name"] = entity_name
    return dispatch_tool("explain_variance", args, conn, dataset_id)


class OutlookRow(BaseModel):
    entity_level: str
    entity_name: str | None
    fy2026_budget: float
    fy2027_forecast: float
    fy2027_low_80: float
    fy2027_high_80: float
    projected_gap_usd: float     # forecast spend minus the FY2026 budget carried forward as the FY2027 budget base
    projected_gap_pct: float
    confidence_label: str
    model_name: str | None


def get_outlook(conn, dataset_id: str) -> list[OutlookRow]:
    """FY2027 projected spend per entity (sum of the four quarterly dollar forecasts) against the FY2026 budget.

    The interval is the sum of the quarterly 80% bounds, which overstates the width of a yearly total
    (quarterly errors partly cancel); the UI labels it as a rough range.
    """
    rows = []
    for level, name in forecastable_entities(conn):
        r = run_forecast(conn, dataset_id, level, name, horizon=4)
        if r.refusal or r.entity_not_found or not r.dollar_forecast_available or not r.planned_budget_total or len(r.points) < 4:
            continue
        total = sum(p.dollar_forecast for p in r.points)
        lo = sum(p.dollar_pi_80_low for p in r.points)
        hi = sum(p.dollar_pi_80_high for p in r.points)
        base = r.planned_budget_total
        rows.append(OutlookRow(entity_level=level, entity_name=name, fy2026_budget=base, fy2027_forecast=total,
                               fy2027_low_80=lo, fy2027_high_80=hi, projected_gap_usd=total - base,
                               projected_gap_pct=(total / base - 1) * 100, confidence_label=r.confidence_label,
                               model_name=r.model_name))
    return rows

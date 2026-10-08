"""REST views for the dashboard panels. Anomalies and variance go through the same dispatcher as the chat tools (§3.7)."""
from __future__ import annotations

from pydantic import BaseModel

from forecasting.forecast import run_forecast
from tools.dispatcher import dispatch_tool

BUD_INCONSISTENCY_SQL = ("SELECT record_id FROM budget_records WHERE source_variance = 0.0 AND variance_pct != 0.0 "
                         "ORDER BY record_id")


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
    ids = [r[0] for r in conn.execute(BUD_INCONSISTENCY_SQL).fetchall()]
    warnings = [f"{rid}: variance_usd=$0.00 but variance_pct≠0 (inconsistent). This record is carried as-is." for rid in ids]
    return BenchmarkResponse(
        model_name=fc.model_name, cv_mae=fc.cv_mae, cv_smape=fc.cv_smape, n_quarters=fc.n_quarters,
        forecast_target=fc.forecast_target, source_rows_compared=n,
        mean_gap=float(mean_gap) if mean_gap is not None else None,
        max_gap=float(max_gap) if max_gap is not None else None,
        caveat=caveat_text(mean_gap, max_gap), inconsistent_variance_records=ids, inconsistency_warnings=warnings)


def anomalies_view(conn, dataset_id: str, entity_level: str = "total", entity_name: str | None = None,
                   sensitivity: float = 2.5) -> dict:
    args = {"entity_level": entity_level, "sensitivity": sensitivity}
    if entity_name:
        args["entity_name"] = entity_name
    return dispatch_tool("detect_anomalies", args, conn, dataset_id)


def variance_view(conn, dataset_id: str, entity_level: str = "total", entity_name: str | None = None) -> dict:
    args = {"entity_level": entity_level}
    if entity_name:
        args["entity_name"] = entity_name
    return dispatch_tool("explain_variance", args, conn, dataset_id)

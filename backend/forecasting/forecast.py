"""run_forecast tool (design §5, §6 Tool 3; Rev 5 §0.7)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field

from forecasting.cv import compute_confidence_label, rolling_origin_cv, select_best
from forecasting.models import ALL_MODELS, MIN_SEASONAL_QUARTERS, available_models

REFUSAL = ("Department × Category forecasting is not supported: these pairs average 2.2 rows of history, "
           "which is far below the 8-quarter minimum required for rolling-origin cross-validation.")
FORECAST_TARGET = "spend-vs-budget ratio"
BUDGET_YEAR = "FY2026"
_LEVEL_COL = {"department": "department", "category": "category", "fund_source": "fund_source"}

_DDL = """
CREATE TABLE IF NOT EXISTS forecast_results (
    forecast_id VARCHAR PRIMARY KEY, dataset_id VARCHAR NOT NULL, entity_level VARCHAR NOT NULL,
    entity_name VARCHAR, forecast_quarter VARCHAR NOT NULL, period_index INTEGER NOT NULL,
    ratio_forecast DOUBLE NOT NULL, pi_80_low DOUBLE NOT NULL, pi_80_high DOUBLE NOT NULL,
    pi_95_low DOUBLE NOT NULL, pi_95_high DOUBLE NOT NULL, dollar_forecast DOUBLE,
    dollar_pi_80_low DOUBLE, dollar_pi_80_high DOUBLE, dollar_pi_95_low DOUBLE, dollar_pi_95_high DOUBLE,
    planned_budget_total DOUBLE, model_name VARCHAR NOT NULL, cv_mae DOUBLE, cv_smape DOUBLE,
    confidence_label VARCHAR NOT NULL, computed_at TIMESTAMP NOT NULL
)"""


class RunForecastRequest(BaseModel):
    dataset_id: str
    entity_level: Literal["total", "department", "category", "fund_source"]
    entity_name: str | None = None
    horizon: int = Field(default=4, ge=1, le=8)
    planned_budget_total: float | None = None
    force_recompute: bool = False


class ForecastPoint(BaseModel):
    forecast_quarter: str
    period_index: int
    ratio_forecast: float
    pi_80_low: float
    pi_80_high: float
    pi_95_low: float
    pi_95_high: float
    dollar_forecast: float | None = None
    dollar_pi_80_low: float | None = None
    dollar_pi_80_high: float | None = None
    dollar_pi_95_low: float | None = None
    dollar_pi_95_high: float | None = None


class RunForecastResponse(BaseModel):
    entity_level: str
    entity_name: str | None = None
    entity_not_found: bool = False
    model_name: str | None = None
    cv_mae: float | None = None
    cv_smape: float | None = None
    confidence_label: Literal["High", "Medium", "Low"] = "Low"
    forecast_target: str = FORECAST_TARGET
    planned_budget_total: float | None = None
    points: list[ForecastPoint] = []
    stl_available: bool = False
    stl_note: str | None = None
    dollar_forecast_available: bool = False
    dollar_unavailable_reason: str | None = None
    refusal: str | None = None
    n_quarters: int | None = None
    prediction_interval_levels: list[int] = [80, 95]   # percent levels of the pi_80_* / pi_95_* fields (grounding anchor)


def quarter_label(period_index: int) -> str:
    """13 -> 'FY2027 Q1' (period 1 = FY2024 Q1)."""
    return f"FY{2024 + (period_index - 1) // 4} Q{(period_index - 1) % 4 + 1}"


def _entity_filter(level: str, name: str | None) -> tuple[str, list]:
    if level == "total":
        return "", []
    return f"AND {_LEVEL_COL[level]} = ?", [name]


def ratio_series(conn, level: str, name: str | None) -> list[tuple[int, float]]:
    """Observed (period_index, SUM(actual)/SUM(budget)) pairs from budget_totals, oldest first (§5.2)."""
    flt, params = _entity_filter(level, name)
    rows = conn.execute(
        "SELECT period_index, SUM(actual) / NULLIF(SUM(budget), 0) FROM budget_totals "
        f"WHERE period_index IS NOT NULL {flt} GROUP BY period_index ORDER BY period_index", params).fetchall()
    return [(int(p), float(r)) for p, r in rows if r is not None]


def _budget_total(conn, level: str, name: str | None) -> float | None:
    flt, params = _entity_filter(level, name)
    v = conn.execute(f"SELECT SUM(budget) FROM budget_totals WHERE fiscal_year = ? {flt}", [BUDGET_YEAR, *params]).fetchone()[0]
    return float(v) if v else None


def _dollar(ratio: float, budget: float | None) -> float | None:
    return None if budget is None else ratio * budget


def _stl(n: int) -> tuple[bool, str | None]:
    if n >= MIN_SEASONAL_QUARTERS:
        return True, None
    return False, f"STL unavailable: {n} quarters of data (minimum {MIN_SEASONAL_QUARTERS} required)"


def _from_cache(conn, dataset_id, level, name, horizon, budget_override) -> RunForecastResponse | None:
    rows = conn.execute(
        "SELECT * FROM forecast_results WHERE dataset_id = ? AND entity_level = ? AND "
        "(entity_name = ? OR (entity_name IS NULL AND ? IS NULL)) ORDER BY period_index",
        [dataset_id, level, name, name]).fetchall()
    cols = [d[0] for d in conn.description]
    rows = [dict(zip(cols, r)) for r in rows][:horizon]
    if len(rows) < horizon:
        return None
    if budget_override is not None and rows[0]["planned_budget_total"] != budget_override:
        return None
    first = rows[0]
    n = len(ratio_series(conn, level, name))
    stl_ok, stl_note = _stl(n)
    pbt = first["planned_budget_total"]
    pts = [ForecastPoint(**{k: r[k] for k in ForecastPoint.model_fields}) for r in rows]
    return RunForecastResponse(
        entity_level=level, entity_name=name, model_name=first["model_name"], cv_mae=first["cv_mae"],
        cv_smape=first["cv_smape"], confidence_label=first["confidence_label"], planned_budget_total=pbt,
        points=pts, stl_available=stl_ok, stl_note=stl_note, dollar_forecast_available=pbt is not None,
        dollar_unavailable_reason=None if pbt is not None else f"No {BUDGET_YEAR} budget found for this entity.",
        n_quarters=n)


def run_forecast(conn, dataset_id: str, entity_level: str, entity_name: str | None = None, horizon: int = 4,
                 planned_budget_total: float | None = None, force_recompute: bool = False) -> RunForecastResponse:
    if entity_level == "dept_x_category" or "×" in str(entity_level):
        return RunForecastResponse(entity_level=entity_level, entity_name=entity_name, refusal=REFUSAL)
    if entity_level not in ("total", *_LEVEL_COL):
        raise ValueError(f"unsupported entity_level: {entity_level}")
    if entity_level == "total" or (entity_name or "").lower() == "total":
        entity_level, entity_name = "total", None
    elif not entity_name:
        raise ValueError("entity_name is required for this entity_level")

    conn.execute(_DDL)
    series = ratio_series(conn, entity_level, entity_name)
    if not series:
        return RunForecastResponse(entity_level=entity_level, entity_name=entity_name, entity_not_found=True)
    if not force_recompute:
        cached = _from_cache(conn, dataset_id, entity_level, entity_name, horizon, planned_budget_total)
        if cached:
            return cached

    y = np.array([r for _, r in series])
    n = len(y)
    last_period = 12  # forecasts always start at the quarter after the last modelled year (FY2027 Q1)
    cv = rolling_origin_cv(y) if n >= 9 else {}
    best_name = select_best(cv)
    pool = {m.name: m for m in available_models(n)}
    if best_name is None:  # no CV possible (<9 quarters or all fits failed): default to the simplest model
        best_name = "Naive"
    model = pool[best_name]().fit(y)
    res = model.forecast(horizon, intervals=True)
    cv_mae = cv[best_name]["mae"] if best_name in cv else None
    cv_smape = cv[best_name]["smape"] if best_name in cv else None
    width = float(np.mean(res.pi_95_high - res.pi_95_low))
    label = compute_confidence_label(n, cv_mae, cv_smape, width)

    budget = planned_budget_total if planned_budget_total is not None else _budget_total(conn, entity_level, entity_name)
    pts = []
    for k in range(horizon):
        pi = last_period + 1 + k
        vals = [float(res.point[k]), float(res.pi_80_low[k]), float(res.pi_80_high[k]),
                float(res.pi_95_low[k]), float(res.pi_95_high[k])]
        d = [_dollar(v, budget) for v in vals]
        pts.append(ForecastPoint(forecast_quarter=quarter_label(pi), period_index=pi, ratio_forecast=vals[0],
                                 pi_80_low=vals[1], pi_80_high=vals[2], pi_95_low=vals[3], pi_95_high=vals[4],
                                 dollar_forecast=d[0], dollar_pi_80_low=d[1], dollar_pi_80_high=d[2],
                                 dollar_pi_95_low=d[3], dollar_pi_95_high=d[4]))

    # Persist (replace any prior rows for this entity so reads are consistent).
    conn.execute("DELETE FROM forecast_results WHERE dataset_id = ? AND entity_level = ? AND "
                 "(entity_name = ? OR (entity_name IS NULL AND ? IS NULL))",
                 [dataset_id, entity_level, entity_name, entity_name])
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for p in pts:
        conn.execute("INSERT INTO forecast_results VALUES (" + ",".join("?" * 22) + ")", [
            str(uuid.uuid4()), dataset_id, entity_level, entity_name, p.forecast_quarter, p.period_index,
            p.ratio_forecast, p.pi_80_low, p.pi_80_high, p.pi_95_low, p.pi_95_high, p.dollar_forecast,
            p.dollar_pi_80_low, p.dollar_pi_80_high, p.dollar_pi_95_low, p.dollar_pi_95_high, budget,
            best_name, cv_mae, cv_smape, label, now])

    stl_ok, stl_note = _stl(n)
    return RunForecastResponse(
        entity_level=entity_level, entity_name=entity_name, model_name=best_name, cv_mae=cv_mae, cv_smape=cv_smape,
        confidence_label=label, planned_budget_total=budget, points=pts, stl_available=stl_ok, stl_note=stl_note,
        dollar_forecast_available=budget is not None,
        dollar_unavailable_reason=None if budget is not None else f"No {BUDGET_YEAR} budget found for this entity.",
        n_quarters=n)


def forecastable_entities(conn) -> list[tuple[str, str | None]]:
    """Total + every department, category and fund source (33 on the original file, 43 on the enhanced one)."""
    out: list[tuple[str, str | None]] = [("total", None)]
    for level, col in _LEVEL_COL.items():
        names = [r[0] for r in conn.execute(f"SELECT DISTINCT {col} FROM budget_totals WHERE {col} IS NOT NULL ORDER BY 1").fetchall()]
        out += [(level, n) for n in names]
    return out

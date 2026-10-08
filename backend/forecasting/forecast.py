"""run_forecast tool (design §5, §6 Tool 3; Rev 5 §0.7)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field

from forecasting.cv import compute_confidence_label, rolling_origin_cv, select_best
from forecasting.models import ALL_MODELS, MIN_SEASONAL_QUARTERS, available_models, make_model

REFUSAL = ("Department × Category forecasting is not supported: these pairs average 2.2 rows of history, "
           "which is far below the 8-quarter minimum required for rolling-origin cross-validation.")
FORECAST_TARGET = "spend-vs-budget ratio"
BUDGET_YEAR = "FY2026"
FIRST_FISCAL_YEAR = 2024   # period 1 = FY2024 Q1 = July 2023; fiscal years start in July
GRAINS = {"quarter": {"season": 4, "per_year": 4, "min_train": 8, "history_years": 3},
          "month": {"season": 12, "per_year": 12, "min_train": 24, "history_years": 3}}
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
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
# Added after the first release; older dataset files get the columns on first use. Cached rows from before
# this change have NULL grain and are never read, so they are recomputed (their dollar base was different).
_MIGRATIONS = ("ALTER TABLE forecast_results ADD COLUMN IF NOT EXISTS grain VARCHAR",
               "ALTER TABLE forecast_results ADD COLUMN IF NOT EXISTS forecast_period VARCHAR")


class RunForecastRequest(BaseModel):
    dataset_id: str
    entity_level: Literal["total", "department", "category", "fund_source"]
    entity_name: str | None = None
    grain: Literal["quarter", "month"] = "quarter"
    horizon: int = Field(default=4, ge=1, le=24)
    planned_budget_total: float | None = None
    force_recompute: bool = False


class ForecastPoint(BaseModel):
    forecast_quarter: str          # fiscal quarter the point falls in (for month grain: the containing quarter)
    forecast_period: str = ""      # display label: "FY2027 Q1" or "Jul 2026"
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
    grain: Literal["quarter", "month"] = "quarter"
    model_name: str | None = None
    cv_mae: float | None = None
    cv_smape: float | None = None
    confidence_label: Literal["High", "Medium", "Low"] = "Low"
    forecast_target: str = FORECAST_TARGET
    planned_budget_total: float | None = None   # annual budget base; dollar fields use planned_budget_total / periods_per_year
    periods_per_year: int = 4
    points: list[ForecastPoint] = []
    stl_available: bool = False
    stl_note: str | None = None
    dollar_forecast_available: bool = False
    dollar_unavailable_reason: str | None = None
    refusal: str | None = None
    n_quarters: int | None = None               # number of periods in the modelled series at the requested grain
    interpolated_periods: int = 0               # monthly gaps filled by linear interpolation before fitting
    prediction_interval_levels: list[int] = [80, 95]   # percent levels of the pi_80_* / pi_95_* fields (grounding anchor)


def quarter_label(period_index: int) -> str:
    """13 -> 'FY2027 Q1' (period 1 = FY2024 Q1)."""
    return f"FY{FIRST_FISCAL_YEAR + (period_index - 1) // 4} Q{(period_index - 1) % 4 + 1}"


def month_label(month_index: int) -> str:
    """37 -> 'Jul 2026' (month 1 = July 2023, the first month of FY2024)."""
    m0 = 6 + month_index - 1   # months since January 2023
    return f"{_MONTHS[m0 % 12]} {2023 + m0 // 12}"


def month_quarter(month_index: int) -> str:
    """37 -> 'FY2027 Q1'."""
    return quarter_label((month_index - 1) // 3 + 1)


def _entity_filter(level: str, name: str | None) -> tuple[str, list]:
    if level == "total":
        return "", []
    return f"AND {_LEVEL_COL[level]} = ?", [name]


MONTH_INDEX_SQL = "(date_diff('month', DATE '2023-07-01', month) + 1)"


def ratio_series(conn, level: str, name: str | None, grain: str = "quarter") -> list[tuple[int, float]]:
    """Observed (period_index, SUM(actual)/SUM(budget)) pairs from budget_totals, oldest first (§5.2).

    For grain "month" the index is the month number (1 = July 2023); gaps in the calendar are kept as gaps, so
    callers must check contiguity before fitting a seasonal model.
    """
    flt, params = _entity_filter(level, name)
    key, notnull = ("period_index", "period_index IS NOT NULL") if grain == "quarter" else (MONTH_INDEX_SQL, "month IS NOT NULL")
    rows = conn.execute(
        f"SELECT {key} AS k, SUM(actual) / NULLIF(SUM(budget), 0) FROM budget_totals "
        f"WHERE {notnull} {flt} GROUP BY k ORDER BY k", params).fetchall()
    return [(int(p), float(r)) for p, r in rows if r is not None]


def monthly_available(conn) -> bool:
    return bool(conn.execute("SELECT COUNT(*) FROM budget_totals WHERE month IS NOT NULL").fetchone()[0])


def _budget_total(conn, level: str, name: str | None) -> float | None:
    flt, params = _entity_filter(level, name)
    v = conn.execute(f"SELECT SUM(budget) FROM budget_totals WHERE fiscal_year = ? {flt}", [BUDGET_YEAR, *params]).fetchone()[0]
    return float(v) if v else None


def _dollar(ratio: float, budget: float | None, per_year: int = 4) -> float | None:
    """Dollar value of a spend/budget ratio for ONE period: ratio x (annual budget / periods per year)."""
    return None if budget is None else ratio * budget / per_year


def _stl(n: int, grain: str = "quarter") -> tuple[bool, str | None]:
    need = 2 * GRAINS[grain]["season"]
    unit = "months" if grain == "month" else "quarters"
    if n >= need:
        return True, None
    return False, f"STL unavailable: {n} {unit} of data (minimum {need} required)"


def _from_cache(conn, dataset_id, level, name, horizon, budget_override, grain) -> RunForecastResponse | None:
    rows = conn.execute(
        "SELECT * FROM forecast_results WHERE dataset_id = ? AND entity_level = ? AND grain = ? AND "
        "(entity_name = ? OR (entity_name IS NULL AND ? IS NULL)) ORDER BY period_index",
        [dataset_id, level, grain, name, name]).fetchall()
    cols = [d[0] for d in conn.description]
    rows = [dict(zip(cols, r)) for r in rows][:horizon]
    if len(rows) < horizon:
        return None
    if budget_override is not None and rows[0]["planned_budget_total"] != budget_override:
        return None
    first = rows[0]
    obs = ratio_series(conn, level, name, grain)
    n = (obs[-1][0] - obs[0][0] + 1) if grain == "month" else len(obs)   # interpolated span, as when fitted
    stl_ok, stl_note = _stl(n, grain)
    pbt = first["planned_budget_total"]
    pts = [ForecastPoint(**{k: r[k] for k in ForecastPoint.model_fields}) for r in rows]
    return RunForecastResponse(
        entity_level=level, entity_name=name, grain=grain, model_name=first["model_name"], cv_mae=first["cv_mae"],
        cv_smape=first["cv_smape"], confidence_label=first["confidence_label"], planned_budget_total=pbt,
        periods_per_year=GRAINS[grain]["per_year"], points=pts, stl_available=stl_ok, stl_note=stl_note,
        dollar_forecast_available=pbt is not None,
        dollar_unavailable_reason=None if pbt is not None else f"No {BUDGET_YEAR} budget found for this entity.",
        n_quarters=n, interpolated_periods=n - len(obs))


def run_forecast(conn, dataset_id: str, entity_level: str, entity_name: str | None = None, horizon: int = 4,
                 planned_budget_total: float | None = None, force_recompute: bool = False,
                 grain: str = "quarter") -> RunForecastResponse:
    if grain not in GRAINS:
        raise ValueError(f"unsupported grain: {grain}")
    if entity_level == "dept_x_category" or "×" in str(entity_level):
        return RunForecastResponse(entity_level=entity_level, entity_name=entity_name, refusal=REFUSAL)
    if entity_level not in ("total", *_LEVEL_COL):
        raise ValueError(f"unsupported entity_level: {entity_level}")
    if entity_level == "total" or (entity_name or "").lower() == "total":
        entity_level, entity_name = "total", None
    elif not entity_name:
        raise ValueError("entity_name is required for this entity_level")

    g = GRAINS[grain]
    per_year, season = g["per_year"], g["season"]
    n_hist_years = g["history_years"]
    conn.execute(_DDL)
    for stmt in _MIGRATIONS:
        conn.execute(stmt)
    if grain == "month" and not monthly_available(conn):
        return RunForecastResponse(entity_level=entity_level, entity_name=entity_name, grain=grain,
                                   refusal="Monthly forecasting needs a month column; this dataset has none.")
    series = ratio_series(conn, entity_level, entity_name, grain)
    if not series:
        return RunForecastResponse(entity_level=entity_level, entity_name=entity_name, entity_not_found=True, grain=grain)
    last_period = n_hist_years * per_year   # forecasts start after the last modelled year (FY2027 Q1 / Jul 2026)
    interpolated = 0
    if grain == "month":
        # Monthly history has gaps (each quarterly record expands to 1-3 months). Fill interior gaps linearly when
        # there is enough real history to cross-validate; the count is reported so the UI can say so.
        have = dict(series)
        first, last = min(have), max(have)
        if last != last_period or len(have) < g["min_train"]:
            return RunForecastResponse(
                entity_level=entity_level, entity_name=entity_name, grain=grain, n_quarters=len(have),
                refusal=f"{entity_name or 'Total'} has only {len(have)} months of history ending "
                        f"{month_label(last)}; a monthly forecast needs at least {g['min_train']} months through "
                        f"{month_label(last_period)}. Use the quarterly forecast.")
        idx = np.arange(first, last + 1)
        vals = np.interp(idx, [k for k, _ in series], [v for _, v in series])
        interpolated = int(len(idx) - len(have))
        series = [(int(k), float(v)) for k, v in zip(idx, vals)]
    if not force_recompute:
        cached = _from_cache(conn, dataset_id, entity_level, entity_name, horizon, planned_budget_total, grain)
        if cached:
            return cached

    y = np.array([r for _, r in series])
    n = len(y)
    min_train = g["min_train"]
    cv = rolling_origin_cv(y, min_train=min_train, season=season) if n > min_train else {}
    best_name = select_best(cv)
    pool = {m.name: m for m in available_models(n, season)}
    if best_name is None:  # no CV possible or all fits failed: default to the simplest model
        best_name = "Naive"
    model = make_model(pool[best_name], season).fit(y)
    res = model.forecast(horizon, intervals=True)
    cv_mae = cv[best_name]["mae"] if best_name in cv else None
    cv_smape = cv[best_name]["smape"] if best_name in cv else None
    width = float(np.mean(res.pi_95_high - res.pi_95_low))
    label = compute_confidence_label(n, cv_mae, cv_smape, width, min_scorable=min_train + 1)

    budget = planned_budget_total if planned_budget_total is not None else _budget_total(conn, entity_level, entity_name)
    pts = []
    for k in range(horizon):
        pi = last_period + 1 + k
        vals = [float(res.point[k]), float(res.pi_80_low[k]), float(res.pi_80_high[k]),
                float(res.pi_95_low[k]), float(res.pi_95_high[k])]
        d = [_dollar(v, budget, per_year) for v in vals]
        period, quarter = (month_label(pi), month_quarter(pi)) if grain == "month" else (quarter_label(pi), quarter_label(pi))
        pts.append(ForecastPoint(forecast_quarter=quarter, forecast_period=period, period_index=pi, ratio_forecast=vals[0],
                                 pi_80_low=vals[1], pi_80_high=vals[2], pi_95_low=vals[3], pi_95_high=vals[4],
                                 dollar_forecast=d[0], dollar_pi_80_low=d[1], dollar_pi_80_high=d[2],
                                 dollar_pi_95_low=d[3], dollar_pi_95_high=d[4]))

    # Persist (replace any prior rows for this entity and grain so reads are consistent).
    conn.execute("DELETE FROM forecast_results WHERE dataset_id = ? AND entity_level = ? AND grain = ? AND "
                 "(entity_name = ? OR (entity_name IS NULL AND ? IS NULL))",
                 [dataset_id, entity_level, grain, entity_name, entity_name])
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for p in pts:
        conn.execute("INSERT INTO forecast_results (forecast_id, dataset_id, entity_level, entity_name, forecast_quarter, "
                     "period_index, ratio_forecast, pi_80_low, pi_80_high, pi_95_low, pi_95_high, dollar_forecast, "
                     "dollar_pi_80_low, dollar_pi_80_high, dollar_pi_95_low, dollar_pi_95_high, planned_budget_total, "
                     "model_name, cv_mae, cv_smape, confidence_label, computed_at, grain, forecast_period) VALUES ("
                     + ",".join("?" * 24) + ")", [
            str(uuid.uuid4()), dataset_id, entity_level, entity_name, p.forecast_quarter, p.period_index,
            p.ratio_forecast, p.pi_80_low, p.pi_80_high, p.pi_95_low, p.pi_95_high, p.dollar_forecast,
            p.dollar_pi_80_low, p.dollar_pi_80_high, p.dollar_pi_95_low, p.dollar_pi_95_high, budget,
            best_name, cv_mae, cv_smape, label, now, grain, p.forecast_period])

    stl_ok, stl_note = _stl(n, grain)
    return RunForecastResponse(
        entity_level=entity_level, entity_name=entity_name, grain=grain, model_name=best_name, cv_mae=cv_mae,
        cv_smape=cv_smape, confidence_label=label, planned_budget_total=budget, periods_per_year=per_year, points=pts,
        stl_available=stl_ok, stl_note=stl_note, dollar_forecast_available=budget is not None,
        dollar_unavailable_reason=None if budget is not None else f"No {BUDGET_YEAR} budget found for this entity.",
        n_quarters=n, interpolated_periods=interpolated)


def forecastable_entities(conn) -> list[tuple[str, str | None]]:
    """Total + every department, category and fund source (33 on the original file, 43 on the enhanced one)."""
    out: list[tuple[str, str | None]] = [("total", None)]
    for level, col in _LEVEL_COL.items():
        names = [r[0] for r in conn.execute(f"SELECT DISTINCT {col} FROM budget_totals WHERE {col} IS NOT NULL ORDER BY 1").fetchall()]
        out += [(level, n) for n in names]
    return out

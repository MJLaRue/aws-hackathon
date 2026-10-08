"""Variance queries and decomposition (design §3.1, §6 Tool 6; Rev 5 §0.3).

All aggregates read the ``budget_totals`` view. ``build_variance_query`` is shared with the
KPI panel and the query_actuals tool so dashboard and chat numbers cannot diverge.
"""

from __future__ import annotations

from typing import Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel

from analysis.anomaly import detect_anomalies, detect_persistent_patterns

EntityLevel = Literal["total", "department", "category", "fund_source", "dept_x_category"]
_GROUP_COLS: dict[str, list[str]] = {
    "total": [], "department": ["department"], "category": ["category"],
    "fund_source": ["fund_source"], "dept_x_category": ["department", "category"],
}
_SELECT_PCT = "(SUM(actual) / NULLIF(SUM(budget), 0) - 1) * 100"


def build_variance_query(entity_level: str, entity_name: str | None = None, fiscal_year: str | None = None,
                         fiscal_quarter: str | None = None, period_index_from: int | None = None,
                         period_index_to: int | None = None, order_desc: bool = True,
                         limit: int | None = None) -> tuple[str, list]:
    """Return (sql, params). Rows: entity columns + total_actual, total_budget, variance_usd, variance_pct_agg.

    For dept_x_category, entity_name is "Department | Category" when given.
    """
    if entity_level not in _GROUP_COLS:
        raise ValueError(f"unknown entity_level: {entity_level}")
    cols = _GROUP_COLS[entity_level]
    where, params = [], []
    if entity_name is not None and entity_level != "total":
        if entity_level == "dept_x_category":
            dept, _, cat = entity_name.partition("|")
            where += ["department = ?", "category = ?"]
            params += [dept.strip(), cat.strip()]
        else:
            where.append(f"{cols[0]} = ?")
            params.append(entity_name)
    for cond, val in (("fiscal_year = ?", fiscal_year), ("fiscal_quarter = ?", fiscal_quarter),
                      ("period_index >= ?", period_index_from), ("period_index <= ?", period_index_to)):
        if val is not None:
            where.append(cond)
            params.append(val)
    if period_index_from is not None or period_index_to is not None:
        where.append("period_index IS NOT NULL")
    sel = ", ".join(cols + [
        "SUM(actual) AS total_actual", "SUM(budget) AS total_budget",
        "SUM(actual - budget) AS variance_usd", f"{_SELECT_PCT} AS variance_pct_agg", "COUNT(*) AS row_count"])
    sql = f"SELECT {sel} FROM budget_totals"
    if where:
        sql += " WHERE " + " AND ".join(where)
    if cols:
        sql += " GROUP BY " + ", ".join(cols)
        sql += f" ORDER BY variance_pct_agg {'DESC' if order_desc else 'ASC'}, {', '.join(cols)}"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return sql, params


def query_entity_rows(conn, entity_level: str, **filters) -> list[dict]:
    sql, params = build_variance_query(entity_level, **filters)
    df = conn.execute(sql, params).df()
    if entity_level == "dept_x_category":
        df.insert(0, "entity_name", df["department"] + " | " + df["category"])
    elif entity_level == "total":
        df.insert(0, "entity_name", "Total")
    else:
        df = df.rename(columns={_GROUP_COLS[entity_level][0]: "entity_name"})
    return df.to_dict("records")


class VarianceContributor(BaseModel):
    entity_type: str
    entity_name: str
    variance_usd: float
    variance_pct_agg: float
    share_of_total_variance: float  # |variance_usd| / sum(|variance_usd|) across the dimension, 0..1


class RecordContributor(BaseModel):
    record_id: str
    department: str
    category: str
    fiscal_year: str
    fiscal_quarter: str
    variance_usd: float
    variance_pct: float
    is_persistent_pattern: bool


class FundSourceSplit(BaseModel):
    fund_source: str
    variance_usd: float
    variance_pct_agg: float
    share_of_total_variance: float


class ExplainVarianceResponse(BaseModel):
    entity_level: str
    entity_name: str | None
    entity_not_found: bool = False
    period_description: str
    total_variance_usd: float
    total_variance_pct: float
    top_department_contributors: list[VarianceContributor]
    top_category_contributors: list[VarianceContributor]
    top_record_contributors: list[RecordContributor]
    persistent_pattern_share: float
    one_time_outlier_share: float
    fund_source_split: list[FundSourceSplit]
    dq_warnings: list[str]
    quarterly_time_series: list[dict]
    stl_available: bool = False
    stl_note: str | None = None


STL_MIN_QUARTERS = 8


def _attach_stl(series: list[dict]) -> tuple[bool, str | None]:
    """Gate STL at >=8 quarters (§3.6); when eligible add stl_trend/stl_seasonal (period 4) to each point."""
    n = len(series)
    if n < STL_MIN_QUARTERS:
        return False, f"STL decomposition unavailable: only {n} quarters of data (minimum {STL_MIN_QUARTERS} required)."
    from statsmodels.tsa.seasonal import STL
    fit = STL(np.array([p["variance_pct_agg"] for p in series]), period=4, robust=True).fit()
    for p, t, sv in zip(series, fit.trend, fit.seasonal):
        p["stl_trend"], p["stl_seasonal"] = float(t), float(sv)
    return True, None


def attach_dq_warnings(conn, record_ids: list[str]) -> list[str]:
    """Row-level data-quality warnings for the given record_ids (§2.6a, §10.1)."""
    if not record_ids:
        return []
    ph = ",".join("?" * len(record_ids))
    rows = conn.execute(f"SELECT record_id FROM budget_records WHERE record_id IN ({ph}) "
                        "AND source_variance = 0.0 AND variance_pct != 0.0 ORDER BY record_id", record_ids).fetchall()
    return [f"{r[0]}: variance_usd=0 but variance_pct≠0 in the source file; carried as-is." for r in rows]


def _period_desc(fiscal_year, fiscal_quarter, lo, hi) -> str:
    if lo is not None or hi is not None:
        return f"period_index {lo if lo is not None else 'start'}–{hi if hi is not None else 'end'}"
    if fiscal_year or fiscal_quarter:
        return " ".join(x for x in (fiscal_year, fiscal_quarter) if x)
    return "all periods"


def _contrib(rows: list[dict], etype: str, n: int) -> list[VarianceContributor]:
    denom = sum(abs(r["variance_usd"]) for r in rows) or 1.0
    top = sorted(rows, key=lambda r: -abs(r["variance_usd"]))[:n]
    return [VarianceContributor(entity_type=etype, entity_name=r["entity_name"], variance_usd=r["variance_usd"],
                                variance_pct_agg=r["variance_pct_agg"] or 0.0,
                                share_of_total_variance=abs(r["variance_usd"]) / denom) for r in top]


def filter_scope(df: pd.DataFrame, entity_level: str, entity_name: str | None = None, fiscal_year: str | None = None,
                 fiscal_quarter: str | None = None, period_index_from: int | None = None,
                 period_index_to: int | None = None) -> pd.DataFrame:
    """Row-level equivalent of build_variance_query's WHERE clause (same entity and period semantics)."""
    if entity_name is not None and entity_level != "total":
        if entity_level == "dept_x_category":
            d, _, c = entity_name.partition("|")
            df = df[(df["department"] == d.strip()) & (df["category"] == c.strip())]
        else:
            df = df[df[entity_level] == entity_name] if entity_level != "category" else df[df["category"] == entity_name]
    if fiscal_year:
        df = df[df["fiscal_year"] == fiscal_year]
    if fiscal_quarter:
        df = df[df["fiscal_quarter"] == fiscal_quarter]
    if period_index_from is not None:
        df = df[df["period_index"] >= period_index_from]
    if period_index_to is not None:
        df = df[df["period_index"] <= period_index_to]
    return df


def explain_variance(conn, dataset_id: str, entity_level: str, entity_name: str | None = None,
                     fiscal_year: str | None = None, fiscal_quarter: str | None = None,
                     period_index_from: int | None = None, period_index_to: int | None = None) -> ExplainVarianceResponse:
    f = dict(fiscal_year=fiscal_year, fiscal_quarter=fiscal_quarter,
             period_index_from=period_index_from, period_index_to=period_index_to)
    desc = _period_desc(fiscal_year, fiscal_quarter, period_index_from, period_index_to)
    all_df = conn.execute("SELECT * FROM budget_totals").df()

    df = filter_scope(all_df, entity_level, entity_name, fiscal_year, fiscal_quarter, period_index_from, period_index_to)

    if df.empty:
        return ExplainVarianceResponse(
            entity_level=entity_level, entity_name=entity_name, entity_not_found=True, period_description=desc,
            total_variance_usd=0.0, total_variance_pct=0.0, top_department_contributors=[],
            top_category_contributors=[], top_record_contributors=[], persistent_pattern_share=0.0,
            one_time_outlier_share=0.0, fund_source_split=[], dq_warnings=[], quarterly_time_series=[])

    def grouped(col: str) -> list[dict]:
        g = df.groupby(col, dropna=True)[["actual", "budget"]].sum()
        return [{"entity_name": k, "variance_usd": float(r.actual - r.budget),
                 "variance_pct_agg": float((r.actual / r.budget - 1) * 100) if r.budget else 0.0}
                for k, r in g.iterrows()]

    tot_a, tot_b = float(df["actual"].sum()), float(df["budget"].sum())
    fund_rows = grouped("fund_source")
    denom = sum(abs(r["variance_usd"]) for r in fund_rows) or 1.0
    fund = [FundSourceSplit(fund_source=r["entity_name"], variance_usd=r["variance_usd"],
                            variance_pct_agg=r["variance_pct_agg"], share_of_total_variance=abs(r["variance_usd"]) / denom)
            for r in sorted(fund_rows, key=lambda r: -abs(r["variance_usd"]))]

    # Persistent-pattern membership is judged on the whole dataset, not the filtered slice.
    pats = {(p["entity_type"], p["entity_name"], p["direction"]) for p in detect_persistent_patterns(all_df)}
    d = df.assign(variance_usd=df["actual"] - df["budget"])
    sign = d["variance_usd"].map(lambda v: "over" if v > 0 else "under")
    d["is_persistent"] = [(("category", c, s) in pats) or (("department", dep, s) in pats)
                          for c, dep, s in zip(d["category"], d["department"], sign)]
    abs_total = d["variance_usd"].abs().sum() or 1.0
    persistent_share = float(d.loc[d["is_persistent"], "variance_usd"].abs().sum() / abs_total)
    flagged_ids = set(detect_anomalies(all_df)["record_id"])
    outlier_share = float(d.loc[d["record_id"].isin(flagged_ids), "variance_usd"].abs().sum() / abs_total)

    top = d.reindex(d["variance_usd"].abs().sort_values(ascending=False, kind="stable").index).head(10)
    records = [RecordContributor(
        record_id=r.record_id, department=r.department, category=r.category, fiscal_year=r.fiscal_year,
        fiscal_quarter=r.fiscal_quarter, variance_usd=float(r.variance_usd),
        variance_pct=float(r.variance_pct) if pd.notna(r.variance_pct) else 0.0,
        is_persistent_pattern=bool(r.is_persistent)) for r in top.itertuples()]

    ts = (df[df["period_index"].notna()].groupby(["period_index", "fiscal_year", "fiscal_quarter"])[["actual", "budget"]]
          .sum().reset_index().sort_values("period_index"))
    series = [{"period_index": int(r.period_index), "fiscal_year": r.fiscal_year, "fiscal_quarter": r.fiscal_quarter,
               "actual": float(r.actual), "budget": float(r.budget),
               "variance_pct_agg": float((r.actual / r.budget - 1) * 100) if r.budget else 0.0}
              for r in ts.itertuples()]

    stl_ok, stl_note = _attach_stl(series)

    return ExplainVarianceResponse(
        stl_available=stl_ok, stl_note=stl_note,
        entity_level=entity_level, entity_name=entity_name, period_description=desc,
        total_variance_usd=tot_a - tot_b, total_variance_pct=(tot_a / tot_b - 1) * 100 if tot_b else 0.0,
        top_department_contributors=_contrib(grouped("department"), "department", 5),
        top_category_contributors=_contrib(grouped("category"), "category", 5),
        top_record_contributors=records, persistent_pattern_share=persistent_share,
        one_time_outlier_share=outlier_share, fund_source_split=fund,
        dq_warnings=attach_dq_warnings(conn, [r.record_id for r in records]), quarterly_time_series=series)

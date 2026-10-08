"""KPI panel aggregation (design §3.7). Shares build_variance_query() with the chat tools."""

from __future__ import annotations

import os

from pydantic import BaseModel

from analysis import anomaly
from analysis.variance import build_variance_query, query_entity_rows


class KpiEntityRow(BaseModel):
    entity_level: str
    entity_name: str
    total_actual: float
    total_budget: float
    variance_usd: float
    variance_pct_agg: float


class FiscalYearSummary(BaseModel):
    fiscal_year: str
    total_actual: float
    total_budget: float
    variance_usd: float
    variance_pct: float


class KpiResponse(BaseModel):
    fiscal_year_filter: str | None
    top_over_departments: list[KpiEntityRow]
    top_under_departments: list[KpiEntityRow]
    top_over_categories: list[KpiEntityRow]
    top_under_categories: list[KpiEntityRow]
    total_actual: float
    total_budget: float
    total_variance_pct: float
    anomaly_count: int
    source_flag_disagreement_count: int
    fiscal_year_summary: list[FiscalYearSummary]


def _top(conn, level: str, fy: str | None, n: int, desc: bool) -> list[KpiEntityRow]:
    sql, params = build_variance_query(level, fiscal_year=fy, order_desc=desc, limit=n)
    out = []
    for r in conn.execute(sql, params).df().to_dict("records"):
        out.append(KpiEntityRow(entity_level=level, entity_name=r[level], total_actual=r["total_actual"],
                                total_budget=r["total_budget"], variance_usd=r["variance_usd"],
                                variance_pct_agg=r["variance_pct_agg"]))
    return out


def get_kpis(conn, dataset_id: str, fiscal_year: str | None = None, top_n: int | None = None) -> KpiResponse:
    n = top_n or int(os.environ.get("KPI_TOP_N", "5"))
    total = query_entity_rows(conn, "total", fiscal_year=fiscal_year)[0]
    years = conn.execute("SELECT fiscal_year, SUM(actual), SUM(budget) FROM budget_totals "
                         "GROUP BY fiscal_year ORDER BY fiscal_year").fetchall()
    run = anomaly.latest_run_summary(conn, dataset_id) or anomaly.run_and_store(conn, dataset_id)
    return KpiResponse(
        fiscal_year_filter=fiscal_year,
        top_over_departments=_top(conn, "department", fiscal_year, n, True),
        top_under_departments=_top(conn, "department", fiscal_year, n, False),
        top_over_categories=_top(conn, "category", fiscal_year, n, True),
        top_under_categories=_top(conn, "category", fiscal_year, n, False),
        total_actual=total["total_actual"], total_budget=total["total_budget"],
        total_variance_pct=total["variance_pct_agg"] or 0.0,
        anomaly_count=run["anomaly_count"], source_flag_disagreement_count=run["fp"] + run["fn"],
        fiscal_year_summary=[FiscalYearSummary(fiscal_year=y, total_actual=a, total_budget=b,
                                               variance_usd=a - b, variance_pct=(a / b - 1) * 100) for y, a, b in years])

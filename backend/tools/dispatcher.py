"""Tool dispatcher (design §6). All arithmetic happens here / in the analysis modules, never in the LLM (SYS-01)."""

from __future__ import annotations

from typing import Any

import pandas as pd
from pydantic import BaseModel, ValidationError

import catalog
from analysis.anomaly import compute_confusion_matrix, detect_anomalies, detect_persistent_patterns
from analysis.health import get_reporting_health
from analysis.variance import attach_dq_warnings, build_variance_query, explain_variance, filter_scope
from forecasting.forecast import REFUSAL, RunForecastResponse, run_forecast
from ingestion.schema import PERIOD_MAP
from tools.definitions import (
    ActualsRow, AnomalyRecord, ComparePeriodRequest, ComparePeriodResponse, ConfusionMatrix,
    DetectAnomaliesRequest, DetectAnomaliesResponse, EntityCounts, ExplainVarianceRequest,
    GetReportingHealthRequest, ListEntitiesRequest, ListEntitiesResponse, PeriodSnapshot, PersistentPattern,
    QueryActualsRequest, QueryActualsResponse, RunForecastRequest, TOOL_NAMES,
)


class ToolError(Exception):
    """Invalid tool input (maps to HTTP 422 / a structured tool error for the agent loop)."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


def _parse(model: type[BaseModel], tool_input: dict, dataset_id: str) -> Any:
    # The session's active dataset always wins over whatever id the model supplied.
    try:
        return model(**{**tool_input, "dataset_id": dataset_id})
    except ValidationError as e:
        raise ToolError("; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()))


def _dq_for_scope(conn, df: pd.DataFrame) -> list[str]:
    """Row-level DQ warnings (variance_usd=0 with nonzero pct; values at the ±50 cap) for the records in scope."""
    warnings = attach_dq_warnings(conn, df["record_id"].tolist()) if len(df) <= 5000 else []
    capped = df[(df["variance_pct"] <= -50) | (df["variance_pct"] >= 50)]
    if len(capped):
        warnings.append(f"{len(capped)} record(s) in scope have |variance_pct| >= 50; variance_pct is capped at ±50 in the original source.")
    return warnings


def _inline(sql: str, params: list) -> str:
    for p in params:
        sql = sql.replace("?", repr(p), 1)
    return sql


def _list_entities(conn, dataset_id: str) -> ListEntitiesResponse:
    col = lambda c: [r[0] for r in conn.execute(f"SELECT DISTINCT {c} FROM budget_records WHERE {c} IS NOT NULL ORDER BY 1").fetchall()]  # noqa: E731
    periods = [{"fiscal_year": r[0], "fiscal_quarter": r[1], "period_index": r[2], "row_count": r[3]} for r in conn.execute(
        "SELECT fiscal_year, fiscal_quarter, period_index, COUNT(*) FROM budget_totals "
        "GROUP BY 1,2,3 ORDER BY period_index NULLS LAST, 1, 2").fetchall()]
    return ListEntitiesResponse(entities=EntityCounts(
        departments=col("department"), categories=col("category"), fund_sources=col("fund_source"),
        fiscal_years=col("fiscal_year"), fiscal_quarters=col("fiscal_quarter"), periods=periods,
        total_rows=conn.execute("SELECT COUNT(*) FROM budget_records").fetchone()[0],
        datasets=[{"dataset_id": d["dataset_id"], "name": d["name"], "row_count": d["row_count"]} for d in catalog.list_datasets()]))


def _query_actuals(conn, req: QueryActualsRequest) -> QueryActualsResponse:
    if req.period_index_from is not None and req.period_index_to is not None and req.period_index_from > req.period_index_to:
        raise ToolError("period_index_from must be <= period_index_to")
    sql, params = build_variance_query(req.entity_level, req.entity_name, req.fiscal_year, req.fiscal_quarter,
                                       req.period_index_from, req.period_index_to)
    df = conn.execute(sql, params).df()
    scope = filter_scope(conn.execute("SELECT * FROM budget_totals").df(), req.entity_level, req.entity_name,
                         req.fiscal_year, req.fiscal_quarter, req.period_index_from, req.period_index_to)
    rows = []
    for r in df.to_dict("records"):
        if req.entity_level == "total":
            name = None
        elif req.entity_level == "dept_x_category":
            name = f"{r['department']} | {r['category']}"
        else:
            name = r[req.entity_level]
        rows.append(ActualsRow(
            entity_level=req.entity_level, entity_name=name, fiscal_year=req.fiscal_year, fiscal_quarter=req.fiscal_quarter,
            period_index=None, total_actual=r["total_actual"], total_budget=r["total_budget"], variance_usd=r["variance_usd"],
            variance_pct_agg=r["variance_pct_agg"] if pd.notna(r["variance_pct_agg"]) else 0.0, row_count=int(r["row_count"]),
            dq_warnings=_dq_for_scope(conn, scope if req.entity_level == "total" or req.entity_name else
                                      _entity_scope(scope, req.entity_level, name))))
    return QueryActualsResponse(rows=rows, query_sql=_inline(sql, params), entity_not_found=not rows and req.entity_name is not None)


def _entity_scope(scope: pd.DataFrame, level: str, name: str | None) -> pd.DataFrame:
    if name is None:
        return scope
    if level == "dept_x_category":
        d, _, c = name.partition("|")
        return scope[(scope["department"] == d.strip()) & (scope["category"] == c.strip())]
    return scope[scope[level] == name]


def _snapshot(df: pd.DataFrame, fiscal_year: str, fiscal_quarter: str) -> PeriodSnapshot | None:
    fy, fq = fiscal_year, fiscal_quarter
    sub = df[(df["fiscal_year"] == fy) & (df["fiscal_quarter"] == fq)]
    if sub.empty:
        return None
    a, b = float(sub["actual"].sum()), float(sub["budget"].sum())
    return PeriodSnapshot(fiscal_year=fy, fiscal_quarter=fq, period_index=PERIOD_MAP.get((fy, fq)), actual=a, budget=b,
                          variance_usd=a - b, variance_pct_agg=(a / b - 1) * 100 if b else None, row_count=len(sub))


def _delta_pct(new: float, old: float) -> float | None:
    return (new / old - 1) * 100 if old else None


def _compare_periods(conn, req: ComparePeriodRequest) -> ComparePeriodResponse:
    if req.period_a == req.period_b:
        raise ToolError("period_a and period_b must differ")
    df = filter_scope(conn.execute("SELECT * FROM budget_totals").df(), req.entity_level, req.entity_name)
    resp = ComparePeriodResponse(entity_level=req.entity_level, entity_name=req.entity_name)
    if df.empty:
        resp.entity_not_found = True
        return resp
    a, b = _snapshot(df, **req.period_a.model_dump()), _snapshot(df, **req.period_b.model_dump())
    missing = [f"{p.fiscal_year} {p.fiscal_quarter}" for p, s in ((req.period_a, a), (req.period_b, b)) if s is None]
    if missing:
        resp.period_not_found = missing
        resp.period_a, resp.period_b = a, b
        return resp
    resp.period_a, resp.period_b = a, b
    resp.actual_delta_usd, resp.actual_delta_pct = b.actual - a.actual, _delta_pct(b.actual, a.actual)
    resp.budget_delta_usd, resp.budget_delta_pct = b.budget - a.budget, _delta_pct(b.budget, a.budget)
    resp.variance_usd_delta = b.variance_usd - a.variance_usd
    if a.variance_pct_agg is not None and b.variance_pct_agg is not None:
        resp.variance_pct_delta = b.variance_pct_agg - a.variance_pct_agg
    in_scope = df[((df["fiscal_year"] == req.period_a.fiscal_year) & (df["fiscal_quarter"] == req.period_a.fiscal_quarter)) |
                  ((df["fiscal_year"] == req.period_b.fiscal_year) & (df["fiscal_quarter"] == req.period_b.fiscal_quarter))]
    resp.dq_warnings = _dq_for_scope(conn, in_scope)
    return resp


def _detect_anomalies(conn, req: DetectAnomaliesRequest) -> DetectAnomaliesResponse:
    all_df = conn.execute("SELECT * FROM budget_totals").df()
    scope = filter_scope(all_df, req.entity_level, req.entity_name)
    if scope.empty:
        return DetectAnomaliesResponse(anomalies=[], persistent_patterns=[], confusion_matrix=ConfusionMatrix(tp=0, fp=0, fn=0, tn=0),
                                       total_records_scanned=0, sensitivity_used=req.sensitivity, entity_not_found=True)
    flagged = detect_anomalies(all_df, sensitivity=req.sensitivity)   # peer statistics always use the whole dataset
    flagged = flagged[flagged["record_id"].isin(scope["record_id"])]
    anomalies = []
    for r in flagged.to_dict("records"):
        anomalies.append(AnomalyRecord(**{
            **{k: r[k] for k in ("record_id", "department", "category", "fiscal_year", "fiscal_quarter", "actual", "budget",
                                 "variance_pct", "peer_group", "peer_median", "peer_mad", "z_score", "detector_reason", "severity",
                                 "source_anomaly_type")},
            "source_record_id": r["source_record_id"] if isinstance(r["source_record_id"], str) else None, "is_synthetic": bool(r["is_synthetic"]),
            "period_index": int(r["period_index"]) if pd.notna(r["period_index"]) else None,
            "source_anomaly_flag": int(r["source_anomaly_flag"]) if pd.notna(r["source_anomaly_flag"]) else None,
            "source_anomaly_type": r["source_anomaly_type"] if isinstance(r["source_anomaly_type"], str) else None}))
    patterns = detect_persistent_patterns(all_df)
    if req.entity_level in ("department", "category") and req.entity_name:
        patterns = [p for p in patterns if p["entity_type"] == req.entity_level and p["entity_name"] == req.entity_name]
    cm = compute_confusion_matrix(set(flagged["record_id"]), scope)
    return DetectAnomaliesResponse(anomalies=anomalies, persistent_patterns=[PersistentPattern(**p) for p in patterns],
                                   confusion_matrix=ConfusionMatrix(**cm), total_records_scanned=len(scope),
                                   sensitivity_used=req.sensitivity)


def dispatch_tool(tool_name: str, tool_input: dict, conn, dataset_id: str) -> dict:
    """Execute one tool call and return a JSON-serialisable dict. Raises ToolError on invalid input."""
    if tool_name not in TOOL_NAMES:
        raise ToolError(f"Unknown tool: {tool_name}", status=404)
    tool_input = dict(tool_input or {})
    if tool_name == "list_entities":
        _parse(ListEntitiesRequest, tool_input, dataset_id)
        out = _list_entities(conn, dataset_id)
    elif tool_name == "query_actuals":
        out = _query_actuals(conn, _parse(QueryActualsRequest, tool_input, dataset_id))
    elif tool_name == "run_forecast":
        level = str(tool_input.get("entity_level", ""))
        if level == "dept_x_category" or "×" in level:
            out = RunForecastResponse(entity_level=level, entity_name=tool_input.get("entity_name"), refusal=REFUSAL)
        else:
            r = _parse(RunForecastRequest, tool_input, dataset_id)
            out = run_forecast(conn, dataset_id, r.entity_level, r.entity_name, r.horizon, r.planned_budget_total, r.force_recompute,
                             r.grain)
    elif tool_name == "detect_anomalies":
        out = _detect_anomalies(conn, _parse(DetectAnomaliesRequest, tool_input, dataset_id))
    elif tool_name == "compare_periods":
        out = _compare_periods(conn, _parse(ComparePeriodRequest, tool_input, dataset_id))
    elif tool_name == "explain_variance":
        r = _parse(ExplainVarianceRequest, tool_input, dataset_id)
        out = explain_variance(conn, dataset_id, r.entity_level, r.entity_name, r.fiscal_year, r.fiscal_quarter,
                               r.period_index_from, r.period_index_to, r.grain)
    else:  # get_reporting_health
        r = _parse(GetReportingHealthRequest, tool_input, dataset_id)
        out = get_reporting_health(conn, dataset_id, r.grouping, r.entity_name)
    return out.model_dump(mode="json")

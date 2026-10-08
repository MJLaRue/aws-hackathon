"""Pydantic models and JSON schemas for the seven LLM tools (design §6)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from analysis.health import GetReportingHealthRequest, GetReportingHealthResponse, ProcessHealthRow  # noqa: F401
from analysis.variance import ExplainVarianceResponse  # noqa: F401
from forecasting.forecast import ForecastPoint, RunForecastRequest, RunForecastResponse  # noqa: F401

# JSON schemas exactly as written in §6 (extracted from the design; detect_anomalies text reflects Rev 5 §0.5).
TOOL_SCHEMAS: list[dict] = json.loads((Path(__file__).parent / "schemas.json").read_text(encoding="utf-8"))
TOOL_NAMES = [t["name"] for t in TOOL_SCHEMAS]


# ---- Tool 1: list_entities
class ListEntitiesRequest(BaseModel):
    dataset_id: str


class EntityCounts(BaseModel):
    departments: list[str]
    categories: list[str]
    fund_sources: list[str]
    fiscal_years: list[str]
    fiscal_quarters: list[str]
    periods: list[dict]
    total_rows: int
    datasets: list[dict]


class ListEntitiesResponse(BaseModel):
    entities: EntityCounts


# ---- Tool 2: query_actuals
class QueryActualsRequest(BaseModel):
    dataset_id: str
    entity_level: Literal["total", "department", "category", "fund_source", "dept_x_category"]
    entity_name: str | None = None
    fiscal_year: str | None = None
    fiscal_quarter: str | None = None
    period_index_from: int | None = Field(None, ge=1, le=12)
    period_index_to: int | None = Field(None, ge=1, le=12)


class ActualsRow(BaseModel):
    entity_level: str
    entity_name: str | None
    fiscal_year: str | None
    fiscal_quarter: str | None
    period_index: int | None
    total_actual: float
    total_budget: float
    variance_usd: float
    variance_pct_agg: float
    row_count: int
    dq_warnings: list[str]


class QueryActualsResponse(BaseModel):
    rows: list[ActualsRow]
    query_sql: str
    entity_not_found: bool = False


# ---- Tool 4: detect_anomalies
class DetectAnomaliesRequest(BaseModel):
    dataset_id: str
    entity_level: Literal["total", "department", "category", "fund_source", "dept_x_category"]
    entity_name: str | None = None
    sensitivity: float = Field(default=2.5, ge=1.0, le=5.0)


class AnomalyRecord(BaseModel):
    record_id: str
    source_record_id: str | None = None
    is_synthetic: bool = False
    department: str
    category: str
    fiscal_year: str
    fiscal_quarter: str
    period_index: int | None
    actual: float
    budget: float
    variance_pct: float
    peer_group: str
    peer_median: float
    peer_mad: float
    z_score: float
    detector_reason: Literal["zscore", "abs_floor", "both"]
    severity: Literal["high", "medium", "low"]
    source_anomaly_flag: int | None
    source_anomaly_type: str | None


class PersistentPattern(BaseModel):
    entity_type: str
    entity_name: str
    direction: str
    qualifying_years: list[str]
    per_year_variance: dict[str, float]


class ConfusionMatrix(BaseModel):
    tp: int
    fp: int
    fn: int
    tn: int


class DetectAnomaliesResponse(BaseModel):
    anomalies: list[AnomalyRecord]
    persistent_patterns: list[PersistentPattern]
    confusion_matrix: ConfusionMatrix
    total_records_scanned: int
    sensitivity_used: float
    entity_not_found: bool = False


# ---- Tool 5: compare_periods
class PeriodRef(BaseModel):
    fiscal_year: str
    fiscal_quarter: str


class ComparePeriodRequest(BaseModel):
    dataset_id: str
    entity_level: Literal["total", "department", "category", "fund_source"]
    entity_name: str | None = None
    period_a: PeriodRef
    period_b: PeriodRef


class PeriodSnapshot(BaseModel):
    fiscal_year: str
    fiscal_quarter: str
    period_index: int | None
    actual: float
    budget: float
    variance_usd: float
    variance_pct_agg: float | None
    row_count: int


class ComparePeriodResponse(BaseModel):
    entity_level: str
    entity_name: str | None
    period_a: PeriodSnapshot | None = None
    period_b: PeriodSnapshot | None = None
    actual_delta_usd: float | None = None
    actual_delta_pct: float | None = None
    budget_delta_usd: float | None = None
    budget_delta_pct: float | None = None
    variance_usd_delta: float | None = None
    variance_pct_delta: float | None = None
    dq_warnings: list[str] = []
    period_not_found: list[str] = []
    entity_not_found: bool = False


# ---- Tool 6: explain_variance
class ExplainVarianceRequest(BaseModel):
    dataset_id: str
    entity_level: Literal["total", "department", "category", "fund_source"]
    entity_name: str | None = None
    fiscal_year: str | None = None
    fiscal_quarter: str | None = None
    period_index_from: int | None = None
    period_index_to: int | None = None
    grain: Literal["quarter", "month"] = "quarter"

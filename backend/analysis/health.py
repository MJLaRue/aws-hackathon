"""Reporting process health (design §4, Rev 5 §0.4). DESCRIPTIVE ONLY."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

DESCRIPTIVE_NOTE = (
    "These statistics describe observed reporting process characteristics. "
    "No causal relationship between process metrics and budget variance is "
    "implied or supported by this data."
)
ABSENT_NOTE = "Reporting-process columns were not mapped for this dataset. Process health view is unavailable."
_GROUPINGS = {"total": None, "department": "department", "report_type": "report_type", "report_status": "report_status"}
_PROCESS_COLS = ("num_spreadsheet_versions", "manual_adjustments_count", "data_entry_errors",
                 "days_to_produce_report", "approval_cycles")
_UNIT = "COALESCE(source_record_id, department || '|' || category || '|' || fiscal_year || '|' || fiscal_quarter)"


class ProcessHealthRow(BaseModel):
    group_value: str | None
    avg_spreadsheet_versions: float
    avg_manual_adjustments: float
    avg_data_entry_errors: float
    avg_days_to_produce: float
    avg_approval_cycles: float
    pct_with_errors: float
    pct_delayed: float
    row_count: int


class GetReportingHealthRequest(BaseModel):
    dataset_id: str
    grouping: Literal["total", "department", "report_type", "report_status"]
    entity_name: str | None = None


class GetReportingHealthResponse(BaseModel):
    grouping: str
    rows: list[ProcessHealthRow]
    descriptive_note: str = DESCRIPTIVE_NOTE
    dq_note: str | None = None


def get_reporting_health(conn, dataset_id: str, grouping: str, entity_name: str | None = None) -> GetReportingHealthResponse:
    if grouping not in _GROUPINGS:
        raise ValueError(f"grouping must be one of {sorted(_GROUPINGS)}")
    col = _GROUPINGS[grouping]
    # One row per reporting unit: months 2-3 of a source record carry NULL process columns, and
    # synthetic series repeat the same values every month, so rows are deduplicated first.
    params: list = []
    where = ""
    if entity_name is not None and col:
        where = f"AND {col} = ?"
        params.append(entity_name)
    group_sel = f"{col} AS group_value" if col else "CAST(NULL AS VARCHAR) AS group_value"
    sql = f"""
    WITH h AS (
      SELECT DISTINCT ON ({_UNIT}) *
      FROM budget_totals
      WHERE num_spreadsheet_versions IS NOT NULL {where}
      ORDER BY {_UNIT}, month NULLS LAST, record_id
    )
    SELECT {group_sel},
           AVG(num_spreadsheet_versions), AVG(manual_adjustments_count), AVG(data_entry_errors),
           AVG(days_to_produce_report), AVG(approval_cycles),
           COUNT(*) FILTER (WHERE data_entry_errors >= 1)::DOUBLE / COUNT(*),
           COUNT(*) FILTER (WHERE report_status = 'Delayed')::DOUBLE / COUNT(*),
           COUNT(*)
    FROM h {f'GROUP BY {col} ORDER BY {col}' if col else ''}
    """
    out = conn.execute(sql, params).fetchall()
    if not out:
        present = conn.execute("SELECT COUNT(*) FROM budget_totals WHERE " +
                               " OR ".join(f"{c} IS NOT NULL" for c in _PROCESS_COLS)).fetchone()[0]
        return GetReportingHealthResponse(grouping=grouping, rows=[], dq_note=None if present else ABSENT_NOTE)
    rows = [ProcessHealthRow(group_value=r[0], avg_spreadsheet_versions=r[1] or 0.0, avg_manual_adjustments=r[2] or 0.0,
                             avg_data_entry_errors=r[3] or 0.0, avg_days_to_produce=r[4] or 0.0,
                             avg_approval_cycles=r[5] or 0.0, pct_with_errors=r[6] or 0.0, pct_delayed=r[7] or 0.0,
                             row_count=int(r[8])) for r in out]
    return GetReportingHealthResponse(grouping=grouping, rows=rows)

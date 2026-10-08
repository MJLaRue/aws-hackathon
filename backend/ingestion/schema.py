"""Canonical schema, column mapping and period derivation (design §2.4, §2.5, Rev 5 §0.2/§0.3)."""

from __future__ import annotations

import pandas as pd

# Source column name -> canonical field name. Covers the original 25-column file and the
# five enhanced columns (source_record_id, is_synthetic, include_in_totals, month,
# anomaly_review_status).
COLUMN_MAP: dict[str, str] = {
    "record_id": "record_id",
    "source_record_id": "source_record_id",
    "is_synthetic": "is_synthetic",
    "include_in_totals": "include_in_totals",
    "department": "department",
    "budget_category": "category",
    "fiscal_year": "fiscal_year",
    "fiscal_quarter": "fiscal_quarter",
    "month": "month",
    "fund_source": "fund_source",
    "report_type": "report_type",
    "report_status": "report_status",
    "budgeted_amount_usd": "budget",
    "actual_spend_usd": "actual",
    "forecasted_amount_usd": "source_forecast",
    "variance_usd": "source_variance",
    "variance_pct": "variance_pct",
    "prior_year_spend_usd": "prior_year_actual",
    "yoy_change_pct": "yoy_change_pct",
    "forecast_accuracy_pct": "forecast_accuracy_pct",
    "anomaly_detected": "source_anomaly_flag",
    "anomaly_type": "source_anomaly_type",
    "anomaly_review_status": "anomaly_review_status",
    "num_spreadsheet_versions": "num_spreadsheet_versions",
    "manual_adjustments_count": "manual_adjustments_count",
    "data_entry_errors": "data_entry_errors",
    "days_to_produce_report": "days_to_produce_report",
    "approval_cycles": "approval_cycles",
    "stakeholders_involved": "stakeholders_involved",
    "confidence_score_1to5": "confidence_score_1to5",
}

# Canonical fields that must be mapped for a file to be accepted (§2.3). The "period
# indicator" is the fiscal_year + fiscal_quarter pair.
REQUIRED_FIELDS: list[str] = ["fiscal_year", "fiscal_quarter", "department", "category", "budget", "actual"]

# Canonical column order of budget_records (period_index is derived, never read from source).
CANONICAL_COLUMNS: list[str] = [
    "record_id", "source_record_id", "is_synthetic", "include_in_totals",
    "department", "category", "fiscal_year", "fiscal_quarter", "period_index", "month",
    "fund_source", "report_type", "report_status",
    "budget", "actual", "source_forecast", "source_variance", "variance_pct",
    "prior_year_actual", "yoy_change_pct", "forecast_accuracy_pct",
    "source_anomaly_flag", "source_anomaly_type", "anomaly_review_status",
    "num_spreadsheet_versions", "manual_adjustments_count", "data_entry_errors",
    "days_to_produce_report", "approval_cycles", "stakeholders_involved", "confidence_score_1to5",
]

PERIOD_MAP: dict[tuple[str, str], int] = {
    ("FY2024", "Q1"): 1, ("FY2024", "Q2"): 2, ("FY2024", "Q3"): 3, ("FY2024", "Q4"): 4,
    ("FY2025", "Q1"): 5, ("FY2025", "Q2"): 6, ("FY2025", "Q3"): 7, ("FY2025", "Q4"): 8,
    ("FY2026", "Q1"): 9, ("FY2026", "Q2"): 10, ("FY2026", "Q3"): 11, ("FY2026", "Q4"): 12,
}


def derive_period_index(df: pd.DataFrame) -> pd.DataFrame:
    """Return df with a nullable-integer ``period_index``; unrecognised periods become NULL (R1-07)."""
    out = df.copy()
    out["period_index"] = pd.Series(
        [PERIOD_MAP.get((y, q)) for y, q in zip(out["fiscal_year"], out["fiscal_quarter"])],
        index=out.index,
        dtype="Int64",
    )
    return out


CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS budget_records (
    record_id           VARCHAR PRIMARY KEY,
    source_record_id    VARCHAR,
    is_synthetic        BOOLEAN NOT NULL DEFAULT FALSE,
    include_in_totals   BOOLEAN NOT NULL DEFAULT TRUE,
    department          VARCHAR NOT NULL,
    category            VARCHAR NOT NULL,
    fiscal_year         VARCHAR NOT NULL,
    fiscal_quarter      VARCHAR NOT NULL,
    period_index        INTEGER,          -- nullable; NULL for unrecognised fiscal periods
    month               DATE,
    fund_source         VARCHAR,
    report_type         VARCHAR,
    report_status       VARCHAR,
    budget              DOUBLE NOT NULL,
    actual              DOUBLE NOT NULL,
    source_forecast     DOUBLE,
    source_variance     DOUBLE,
    variance_pct        DOUBLE,
    prior_year_actual   DOUBLE,
    yoy_change_pct      DOUBLE,
    forecast_accuracy_pct DOUBLE,
    source_anomaly_flag INTEGER,
    source_anomaly_type VARCHAR,
    anomaly_review_status VARCHAR,
    num_spreadsheet_versions    INTEGER,
    manual_adjustments_count    INTEGER,
    data_entry_errors           INTEGER,
    days_to_produce_report      DOUBLE,
    approval_cycles             DOUBLE,
    stakeholders_involved       DOUBLE,
    confidence_score_1to5       INTEGER
);
""".strip()

# Aggregate queries read this view (Rev 5 §0.3).
CREATE_TOTALS_VIEW_SQL = (
    "CREATE VIEW IF NOT EXISTS budget_totals AS "
    "SELECT * FROM budget_records WHERE include_in_totals"
)

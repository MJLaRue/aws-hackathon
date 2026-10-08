"""Ingestion pipeline: file detection, parsing, column mapping (design §2.1-§2.3)."""

from __future__ import annotations

import difflib
import io

import pandas as pd
from fastapi import HTTPException
from pydantic import BaseModel

from ingestion.schema import COLUMN_MAP, REQUIRED_FIELDS

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
XLSX_MAGIC = b"PK\x03\x04"
FUZZY_THRESHOLD = 0.8


class ColumnMappingProposal(BaseModel):
    dataset_name: str
    source_columns: list[str]
    suggestions: dict[str, str | None]  # source_col -> canonical_field or None
    required_fields: list[str]
    unmapped_required: list[str]


class ColumnMappingRequest(BaseModel):
    dataset_name: str
    mapping: dict[str, str]  # source_col -> canonical_field (confirmed by user)


def detect_and_parse(file_bytes: bytes, filename: str) -> pd.DataFrame:
    """Parse an uploaded XLSX/CSV into a raw DataFrame. Raises HTTP 413 above 50 MB."""
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 50 MB upload limit.")
    if file_bytes[:4] == XLSX_MAGIC:
        return pd.read_excel(io.BytesIO(file_bytes), engine="openpyxl")
    try:
        return pd.read_csv(io.BytesIO(file_bytes), encoding="utf-8")
    except UnicodeDecodeError:
        return pd.read_csv(io.BytesIO(file_bytes), encoding="latin-1")


def suggest_column_mapping(source_columns: list[str]) -> dict[str, str | None]:
    """Case-insensitive fuzzy match of source columns to COLUMN_MAP keys (ratio >= 0.8).

    An exact (case-insensitive) match always wins; two source columns never claim the
    same canonical field (the higher-scoring one keeps it).
    """
    keys = list(COLUMN_MAP)
    scored: list[tuple[float, str, str]] = []
    for col in source_columns:
        norm = str(col).strip().lower()
        for key in keys:
            ratio = 1.0 if norm == key else difflib.SequenceMatcher(None, norm, key).ratio()
            if ratio >= FUZZY_THRESHOLD:
                scored.append((ratio, col, COLUMN_MAP[key]))
    suggestions: dict[str, str | None] = {col: None for col in source_columns}
    claimed: set[str] = set()
    for ratio, col, field in sorted(scored, key=lambda t: -t[0]):
        if suggestions[col] is None and field not in claimed:
            suggestions[col] = field
            claimed.add(field)
    return suggestions


def validate_mapping(mapping: dict[str, str | None]) -> list[str]:
    """Return required canonical fields that are not mapped (empty list = valid)."""
    mapped = {v for v in mapping.values() if v}
    return [f for f in REQUIRED_FIELDS if f not in mapped]


def build_mapping_proposal(dataset_name: str, df: pd.DataFrame) -> ColumnMappingProposal:
    cols = [str(c) for c in df.columns]
    suggestions = suggest_column_mapping(cols)
    return ColumnMappingProposal(
        dataset_name=dataset_name,
        source_columns=cols,
        suggestions=suggestions,
        required_fields=REQUIRED_FIELDS,
        unmapped_required=validate_mapping(suggestions),
    )


# ---------------------------------------------------------------------------
# Mapping application, DuckDB load, validation report (design §2.4-§2.6, Rev 5 §0)
# ---------------------------------------------------------------------------

import uuid  # noqa: E402
from pathlib import Path  # noqa: E402

import duckdb  # noqa: E402

from ingestion.schema import (  # noqa: E402
    CANONICAL_COLUMNS,
    CREATE_TABLE_SQL,
    CREATE_TOTALS_VIEW_SQL,
    derive_period_index,
)


class DQFinding(BaseModel):
    code: str
    record_ids: list[str]
    message: str


class ValidationReport(BaseModel):
    total_rows: int
    rows_accepted: int
    rows_rejected: int
    rows_unmapped_period: int
    rows_excluded_from_totals: int = 0
    rows_synthetic: int = 0
    fiscal_period_range: str
    department_count: int
    category_count: int
    fund_source_count: int
    variance_usd_mismatches: int
    yoy_mismatches: int
    forecast_accuracy_mismatches: int
    duplicate_key_combos: int
    duplicate_key_rows: int
    source_flag_sign_disagreements: int
    dq_findings: list[DQFinding]


_TEXT = ["record_id", "source_record_id", "department", "category", "fiscal_year", "fiscal_quarter",
         "fund_source", "report_type", "report_status", "source_anomaly_type", "anomaly_review_status"]
_DOUBLE = ["budget", "actual", "source_forecast", "source_variance", "variance_pct", "prior_year_actual",
           "yoy_change_pct", "forecast_accuracy_pct", "days_to_produce_report", "approval_cycles",
           "stakeholders_involved"]
_INT = ["source_anomaly_flag", "num_spreadsheet_versions", "manual_adjustments_count",
        "data_entry_errors", "confidence_score_1to5"]
_BOOL_DEFAULT = {"is_synthetic": False, "include_in_totals": True}


def _to_bool(series: pd.Series, default: bool) -> pd.Series:
    def conv(v):
        if v is None or (isinstance(v, float) and pd.isna(v)) or v is pd.NA:
            return default
        if isinstance(v, str):
            return v.strip().lower() in {"true", "t", "1", "yes", "y"}
        return bool(v)
    return series.map(conv).astype(bool)


def apply_mapping(df: pd.DataFrame, mapping: dict[str, str | None]) -> tuple[pd.DataFrame, int]:
    """Rename source columns to canonical names, coerce types, reject invalid rows.

    Returns (clean_df, rows_rejected). Rejected: missing required values, non-numeric
    budget/actual, duplicate record_id (first occurrence kept). Unrecognised fiscal
    periods are NOT rejected (R1-07).
    """
    rename = {src: dst for src, dst in mapping.items() if dst and src in df.columns}
    out = df.rename(columns=rename)
    out = out.loc[:, ~out.columns.duplicated()].copy()
    n_in = len(out)
    if "record_id" not in out.columns:
        out["record_id"] = [f"ROW-{i + 1:06d}" for i in range(n_in)]
    for col in CANONICAL_COLUMNS:
        if col not in out.columns and col != "period_index":
            out[col] = pd.NA
    for col in _TEXT:
        out[col] = out[col].map(lambda v: None if pd.isna(v) else str(v).strip())
    for col in _DOUBLE:
        out[col] = pd.to_numeric(out[col], errors="coerce")
    for col in _INT:
        out[col] = pd.to_numeric(out[col], errors="coerce").round().astype("Int64")
    for col, default in _BOOL_DEFAULT.items():
        out[col] = _to_bool(out[col], default)
    out["month"] = pd.to_datetime(out["month"], errors="coerce").dt.date
    out["source_record_id"] = out["source_record_id"].where(out["source_record_id"].notna(), None)
    # Original-schema files have no source_record_id: a record is its own source.
    no_src = out["source_record_id"].isna() & ~out["is_synthetic"]
    out.loc[no_src, "source_record_id"] = out.loc[no_src, "record_id"]

    valid = (
        out[["record_id", "department", "category", "fiscal_year", "fiscal_quarter"]].notna().all(axis=1)
        & out["budget"].notna() & out["actual"].notna()
    )
    dup = out["record_id"].duplicated(keep="first")
    keep = valid & ~dup
    rejected = int((~keep).sum())
    out = derive_period_index(out[keep])
    return out[CANONICAL_COLUMNS].reset_index(drop=True), rejected


def _scalar(conn: duckdb.DuckDBPyConnection, sql: str) -> int:
    return int(conn.execute(sql).fetchone()[0] or 0)


def _ids(conn: duckdb.DuckDBPyConnection, sql: str) -> list[str]:
    return [r[0] for r in conn.execute(sql).fetchall()]


def _period_range(conn: duckdb.DuckDBPyConnection) -> str:
    lo = conn.execute("SELECT fiscal_year, fiscal_quarter FROM budget_records WHERE period_index IS NOT NULL "
                      "ORDER BY period_index LIMIT 1").fetchone()
    hi = conn.execute("SELECT fiscal_year, fiscal_quarter FROM budget_records WHERE period_index IS NOT NULL "
                      "ORDER BY period_index DESC LIMIT 1").fetchone()
    return f"{lo[0]} {lo[1]} – {hi[0]} {hi[1]}" if lo and hi else "n/a"


def load_to_duckdb(df: pd.DataFrame, dataset_id: str, db_path: str | Path,
                   total_rows: int | None = None, rows_rejected: int = 0) -> ValidationReport:
    """Create budget_records (+ budget_totals view), insert canonical rows, run DQ checks (§2.6).

    ``df`` must already be canonical (see apply_mapping). ``dataset_id`` is recorded by the
    caller in the catalog; it is accepted here so each file is self-describing in logs.
    """
    conn = duckdb.connect(str(db_path))
    try:
        conn.execute(CREATE_TABLE_SQL)
        conn.execute(CREATE_TOTALS_VIEW_SQL)
        conn.register("incoming", df)
        cols = ", ".join(CANONICAL_COLUMNS)
        conn.execute(f"INSERT INTO budget_records ({cols}) SELECT {cols} FROM incoming")
        conn.unregister("incoming")
        report = _build_report(conn, total_rows if total_rows is not None else len(df) + rows_rejected,
                               rows_rejected)
    finally:
        conn.close()
    return report


def _build_report(conn: duckdb.DuckDBPyConnection, total_rows: int, rows_rejected: int) -> ValidationReport:
    n = _scalar(conn, "SELECT COUNT(*) FROM budget_records")
    src = "COALESCE(source_record_id, record_id)"

    # R1-05 derived column reconciliation
    var_mm = _scalar(conn, "SELECT COUNT(*) FROM budget_records WHERE source_variance IS NOT NULL "
                           "AND ABS((actual - budget) - source_variance) > 0.01")
    yoy_mm = _scalar(conn, "SELECT COUNT(*) FROM budget_records WHERE prior_year_actual IS NOT NULL "
                           "AND prior_year_actual != 0 AND yoy_change_pct IS NOT NULL "
                           "AND ABS((actual / prior_year_actual - 1) * 100 - yoy_change_pct) > 0.05")
    fa_mm = _scalar(conn, "SELECT COUNT(*) FROM budget_records WHERE source_forecast IS NOT NULL AND actual != 0 "
                          "AND forecast_accuracy_pct IS NOT NULL "
                          "AND ABS((100 - ABS(source_forecast - actual) / actual * 100) - forecast_accuracy_pct) > 0.05")

    findings: list[DQFinding] = []

    # (a) variance_usd = 0 but variance_pct != 0 (evaluated dynamically; may be empty)
    a_ids = _ids(conn, "SELECT record_id FROM budget_records WHERE source_variance = 0.0 AND variance_pct != 0.0 "
                       "ORDER BY record_id")
    findings.append(DQFinding(
        code="variance_zero_nonzero_pct", record_ids=a_ids,
        message=("variance_usd=0 but variance_pct≠0 for: " + ", ".join(a_ids) + ". Rows are carried as-is."
                 if a_ids else "No rows with variance_usd=0 and variance_pct≠0.")))

    # (b) source forecast gap
    gap = conn.execute("SELECT AVG(ABS(source_forecast - actual) / NULLIF(actual, 0) * 100), "
                       "MAX(ABS(source_forecast - actual) / NULLIF(actual, 0) * 100) FROM budget_records "
                       "WHERE source_forecast IS NOT NULL AND actual != 0").fetchone()
    mean_gap, max_gap = gap
    if mean_gap is None:
        msg_b = "No source forecast values present."
    elif mean_gap < 5:
        msg_b = (f"Source forecast mean absolute gap is {mean_gap:.1f}% (max {max_gap:.2f}%). This is unusually "
                 "close to actuals and may indicate post-hoc adjustment. The source forecast is not used as a model input.")
    else:
        msg_b = f"Source forecast mean absolute gap is {mean_gap:.1f}% (max {max_gap:.2f}%)."
    findings.append(DQFinding(code="source_forecast_gap", record_ids=[], message=msg_b))

    # (c) duplicate natural keys: distinct non-synthetic source records sharing dept+category+year+quarter
    dup = conn.execute(
        f"WITH k AS (SELECT department, category, fiscal_year, fiscal_quarter, COUNT(DISTINCT {src}) AS cnt "
        "FROM budget_records WHERE NOT is_synthetic GROUP BY 1,2,3,4 HAVING COUNT(DISTINCT "
        f"{src}) > 1) SELECT COUNT(*), COALESCE(SUM(cnt), 0) FROM k").fetchone()
    dup_combos, dup_rows = int(dup[0]), int(dup[1])
    findings.append(DQFinding(
        code="duplicate_keys", record_ids=[],
        message=(f"Found {dup_combos} duplicate (dept+category+year+quarter) combinations covering {dup_rows} rows. "
                 "record_id remains the primary key; all queries aggregate over the natural key.")))

    # (d) anomaly label sign inconsistency (counted per source record)
    def sign_counts(label: str, cmp: str) -> tuple[int, int]:
        bad = _scalar(conn, f"SELECT COUNT(DISTINCT {src}) FROM budget_records WHERE source_anomaly_type='{label}' "
                            f"AND variance_pct {cmp} 0")
        tot = _scalar(conn, f"SELECT COUNT(DISTINCT {src}) FROM budget_records WHERE source_anomaly_type='{label}'")
        return bad, tot
    o_bad, o_tot = sign_counts("Overrun", "<")
    u_bad, u_tot = sign_counts("Underspend", ">")
    pct = lambda b, t: (100 * b / t) if t else 0.0  # noqa: E731
    findings.append(DQFinding(
        code="anomaly_sign_inconsistency", record_ids=[],
        message=(f"Overrun rows with negative variance_pct: {o_bad} of {o_tot} ({pct(o_bad, o_tot):.0f}%). "
                 f"Underspend rows with positive variance_pct: {u_bad} of {u_tot} ({pct(u_bad, u_tot):.0f}%). "
                 "Source anomaly labels are not reliable for sign-based filtering.")))

    # (e) capped values
    cap_n = _scalar(conn, "SELECT COUNT(*) FROM budget_records WHERE variance_pct <= -50 OR variance_pct >= 50")
    findings.append(DQFinding(
        code="variance_pct_cap", record_ids=[],
        message=(f"{cap_n} rows have |variance_pct| ≥ 50. variance_pct is capped at ±50 in the original source "
                 "file. The anomaly detector operates on these raw values.")))

    # (f) explicit +50 cap check (always runs)
    f_ids = _ids(conn, "SELECT record_id FROM budget_records WHERE variance_pct >= 50 ORDER BY record_id")
    findings.append(DQFinding(code="rows_at_plus_cap", record_ids=f_ids,
                              message=f"Rows at +50 cap: {len(f_ids)}"))

    excluded = _ids(conn, "SELECT record_id FROM budget_records WHERE NOT include_in_totals ORDER BY record_id")
    if excluded:
        findings.append(DQFinding(
            code="excluded_from_totals", record_ids=excluded,
            message=f"{len(excluded)} rows are flagged include_in_totals=FALSE and are excluded from all aggregates."))

    return ValidationReport(
        total_rows=total_rows,
        rows_accepted=n,
        rows_rejected=rows_rejected,
        rows_unmapped_period=_scalar(conn, "SELECT COUNT(*) FROM budget_records WHERE period_index IS NULL"),
        rows_excluded_from_totals=len(excluded),
        rows_synthetic=_scalar(conn, "SELECT COUNT(*) FROM budget_records WHERE is_synthetic"),
        fiscal_period_range=_period_range(conn),
        department_count=_scalar(conn, "SELECT COUNT(DISTINCT department) FROM budget_records"),
        category_count=_scalar(conn, "SELECT COUNT(DISTINCT category) FROM budget_records"),
        fund_source_count=_scalar(conn, "SELECT COUNT(DISTINCT fund_source) FROM budget_records"),
        variance_usd_mismatches=var_mm,
        yoy_mismatches=yoy_mm,
        forecast_accuracy_mismatches=fa_mm,
        duplicate_key_combos=dup_combos,
        duplicate_key_rows=dup_rows,
        source_flag_sign_disagreements=o_bad + u_bad,
        dq_findings=findings,
    )


def run_ingestion_pipeline(data: "pd.DataFrame | list[dict]", db: str | Path,
                           mapping: dict[str, str | None] | None = None,
                           dataset_id: str | None = None) -> ValidationReport:
    """Map, clean and load ``data`` into a DuckDB file; returns the ValidationReport."""
    df = data if isinstance(data, pd.DataFrame) else pd.DataFrame(data)
    total = len(df)
    mapping = mapping or suggest_column_mapping([str(c) for c in df.columns])
    missing = validate_mapping(mapping)
    if missing:
        raise HTTPException(status_code=422, detail={"error": "missing_required_fields", "missing": missing})
    clean, rejected = apply_mapping(df, mapping)
    return load_to_duckdb(clean, dataset_id or str(uuid.uuid4()), db, total_rows=total, rows_rejected=rejected)

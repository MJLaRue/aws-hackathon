# Budget Forecasting Analyst — Technical Design

**Status:** Draft (Revision 4)
**Date:** 2026-10-08
**Requirements source:** docs/requirements.md (APPROVED)
**Profiling source:** docs/design.md
**Ground truth:** tests/ground_truth.md

---

## 1. Architecture Overview

The system is a two-tier web application packaged with docker-compose. The React+TypeScript+Vite frontend communicates with a FastAPI backend over HTTP/SSE. DuckDB runs embedded inside the backend process (no separate database server), storing ingested datasets and persisted forecast results in a named Docker volume. The AWS Bedrock Converse API is called from the backend only; credentials never cross to the browser.

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  React + TypeScript + Vite                               │   │
│  │  • Chat panel (SSE consumer)                             │   │
│  │  • Sources/evidence panel                               │   │
│  │  • Dashboard: KPIs, charts (Recharts), anomaly table    │   │
│  │  • Upload / column-mapping UI                           │   │
│  │  • Dataset selector                                     │   │
│  └──────────────┬───────────────────────────────────────────┘   │
└─────────────────┼───────────────────────────────────────────────┘
                  │  HTTP REST + SSE  (port 8000 → 3000 CORS)
┌─────────────────┼───────────────────────────────────────────────┐
│  Docker: backend (python:3.12-slim)                            │
│  ┌──────────────▼───────────────────────────────────────────┐   │
│  │  FastAPI application                                      │   │
│  │                                                           │   │
│  │  POST /upload         → Ingestion Pipeline               │   │
│  │  GET  /datasets       → Dataset listing                  │   │
│  │  GET  /kpis           → KPI Panel aggregation            │   │
│  │  POST /chat           → SSE streaming agent loop        │   │
│  │  POST /forecast       → Trigger forecast computation    │   │
│  │  GET  /health         → Liveness probe                  │   │
│  │                                                           │   │
│  │  ┌─────────────────────────────────────────────────────┐ │   │
│  │  │  Agent Loop (per chat turn)                         │ │   │
│  │  │  1. Build Bedrock ConverseStream request            │ │   │
│  │  │  2. Stream tokens → SSE → browser                  │ │   │
│  │  │  3. On toolUse block: dispatch tool function        │ │   │
│  │  │  4. Append toolResult, loop (max 10 iters)          │ │   │
│  │  │  5. Post-gen grounding check on final text          │ │   │
│  │  │  6. Emit sources panel event                        │ │   │
│  │  └─────────────────────────────────────────────────────┘ │   │
│  │                                                           │   │
│  │  ┌─────────────┐   ┌──────────────────────────────────┐  │   │
│  │  │  DuckDB     │   │  statsforecast / statsmodels     │  │   │
│  │  │  (embedded) │   │  (ETS, Drift, Naive, Linear)     │  │   │
│  │  │  /data/dbs/ │   └──────────────────────────────────┘  │   │
│  │  └─────────────┘                                         │   │
│  └───────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              │  HTTPS (boto3)                  │
└──────────────────────────────┼──────────────────────────────────┘
                               │
               ┌───────────────▼──────────────────┐
               │  AWS Bedrock Converse API         │
               │  (model ID from env var)          │
               └──────────────────────────────────┘
```

**Request lifecycle for a single chat turn:**

1. Browser `POST /chat` with `{ session_id, message, dataset_id }`.
2. Backend opens a `StreamingResponse` (SSE content-type `text/event-stream`).
3. Agent loop calls `bedrock.converse_stream` with the current conversation history plus the 7 tool schemas.
4. Tokens from `contentBlockDelta` events are immediately emitted as `data: {"type":"token","text":"…"}` SSE events.
5. On a `toolUse` event, the loop pauses streaming, dispatches the named tool function (DuckDB query or model run), collects the result, and emits `data: {"type":"tool_result","tool":"…","summary":"…"}`.
6. The tool result is appended to the conversation as a `tool` role message and the loop iterates (max 10 iterations; on limit the backend emits an error event and breaks).
7. After the final assistant message, the grounding check runs over the accumulated text (section 7). Any failure emits `data: {"type":"grounding_flag","details":"…"}`.
8. A final `data: {"type":"sources","calls":[…]}` event carries the full tool-call manifest for the sources panel.
9. SSE stream closes with `data: [DONE]`.

---

## 2. Ingestion Pipeline (R1)

### 2.1 Endpoint

`POST /upload` accepts `multipart/form-data` with fields `file` (binary) and `dataset_name` (string, max 128 chars, required).

### 2.2 File Detection and Parsing

The backend inspects the first four bytes of the upload for the XLSX magic number (`PK\x03\x04`); anything else is treated as CSV. pandas `read_excel` (openpyxl engine) or `read_csv` (UTF-8, then latin-1 fallback) is used to produce a raw DataFrame. Files larger than 50 MB are rejected immediately with HTTP 413.

### 2.3 Column Mapping

The raw column names are returned to the frontend in a `ColumnMappingProposal` response. The backend uses a case-insensitive fuzzy match (difflib `SequenceMatcher` ratio ≥ 0.8) to auto-suggest a canonical field for each source column. The frontend renders the mapping table; the user may override suggestions. On confirmation, the frontend `POST`s the confirmed `ColumnMappingRequest`. The backend validates that the five required fields are present in the mapping (period indicator, department, category, budget, actual); if any are absent it returns HTTP 422 with a structured error listing the missing fields.

**Pydantic models:**

```python
class ColumnMappingProposal(BaseModel):
    dataset_name: str
    source_columns: list[str]
    suggestions: dict[str, str | None]    # source_col → canonical_field or None
    required_fields: list[str]            # canonical fields that must be mapped
    unmapped_required: list[str]          # canonical fields with no auto-suggestion

class ColumnMappingRequest(BaseModel):
    dataset_name: str
    mapping: dict[str, str]               # source_col → canonical_field (confirmed by user)
```

### 2.4 Canonical Schema

Every field below is stored in DuckDB with the type shown. `period_index` is derived by the ingestion layer and is never read from the source file.

| Canonical Field | Source Column | DuckDB Type | Notes |
|---|---|---|---|
| record_id | record_id | VARCHAR PK | Unique per row |
| department | department | VARCHAR NOT NULL | 16 distinct values |
| category | budget_category | VARCHAR NOT NULL | Renamed |
| fiscal_year | fiscal_year | VARCHAR NOT NULL | FY2024–FY2026 |
| fiscal_quarter | fiscal_quarter | VARCHAR NOT NULL | Q1–Q4 |
| period_index | *(derived)* | INTEGER | Nullable: NULL for unrecognised fiscal periods |
| fund_source | fund_source | VARCHAR | Optional |
| report_type | report_type | VARCHAR | Optional |
| report_status | report_status | VARCHAR | Optional |
| budget | budgeted_amount_usd | DOUBLE NOT NULL | USD |
| actual | actual_spend_usd | DOUBLE NOT NULL | USD |
| source_forecast | forecasted_amount_usd | DOUBLE | USD; post-hoc caveat |
| source_variance | variance_usd | DOUBLE | Carry as-is; app recomputes |
| variance_pct | variance_pct | DOUBLE | Carry as-is; ±50 cap in source |
| prior_year_actual | prior_year_spend_usd | DOUBLE | USD; optional |
| yoy_change_pct | yoy_change_pct | DOUBLE | % rounded to 1 decimal |
| forecast_accuracy_pct | forecast_accuracy_pct | DOUBLE | % rounded to 1 decimal; 100 − |forecast−actual|/actual×100 |
| source_anomaly_flag | anomaly_detected | INTEGER | 0/1; not ground truth |
| source_anomaly_type | anomaly_type | VARCHAR | Nullable; not ground truth |
| num_spreadsheet_versions | num_spreadsheet_versions | INTEGER | |
| manual_adjustments_count | manual_adjustments_count | INTEGER | |
| data_entry_errors | data_entry_errors | INTEGER | |
| days_to_produce_report | days_to_produce_report | DOUBLE | |
| approval_cycles | approval_cycles | DOUBLE | |
| stakeholders_involved | stakeholders_involved | DOUBLE | |
| confidence_score_1to5 | confidence_score_1to5 | INTEGER | 1–5 |

`period_index` derivation (Python, executed during ingestion):

```python
PERIOD_MAP = {
    ("FY2024", "Q1"): 1,  ("FY2024", "Q2"): 2,  ("FY2024", "Q3"): 3,  ("FY2024", "Q4"): 4,
    ("FY2025", "Q1"): 5,  ("FY2025", "Q2"): 6,  ("FY2025", "Q3"): 7,  ("FY2025", "Q4"): 8,
    ("FY2026", "Q1"): 9,  ("FY2026", "Q2"): 10, ("FY2026", "Q3"): 11, ("FY2026", "Q4"): 12,
}
df["period_index"] = df.apply(
    lambda r: PERIOD_MAP.get((r["fiscal_year"], r["fiscal_quarter"])), axis=1
)
```

If a `(fiscal_year, fiscal_quarter)` combination is not in `PERIOD_MAP`, `period_index` is set to `NULL` and the row is included in the validation report's "unmapped period" count. It is **not** rejected (R1-07). Time-series queries and forecasting always filter `WHERE period_index IS NOT NULL` to exclude these rows; aggregate variance queries include them.

### 2.5 Duplicate Key Handling (R1-08)

`record_id` is the DuckDB primary key. The 4-column natural key `(department, category, fiscal_year, fiscal_quarter)` is **not unique**: the dataset contains 23 duplicate combos covering 47 rows. The system accepts the file with a warning. Every query that pivots or groups by this 4-column key uses `SUM` or `AVG` aggregation — never a single-row lookup. The 6-column key `(department, category, fiscal_year, fiscal_quarter, fund_source, report_type)` is unique and may be used for point lookups.

DuckDB table creation:

```sql
CREATE TABLE IF NOT EXISTS budget_records (
    record_id           VARCHAR PRIMARY KEY,
    department          VARCHAR NOT NULL,
    category            VARCHAR NOT NULL,
    fiscal_year         VARCHAR NOT NULL,
    fiscal_quarter      VARCHAR NOT NULL,
    period_index        INTEGER,          -- nullable; NULL for unrecognised fiscal periods
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
    num_spreadsheet_versions    INTEGER,
    manual_adjustments_count    INTEGER,
    data_entry_errors           INTEGER,
    days_to_produce_report      DOUBLE,
    approval_cycles             DOUBLE,
    stakeholders_involved       DOUBLE,
    confidence_score_1to5       INTEGER
);
```

Each dataset lives in its own DuckDB file at `/data/dbs/{dataset_id}.ddb`. The `dataset_id` is a UUID generated at upload time.

**Test for unmapped period row acceptance:**

```python
def test_unmapped_period_row_accepted(tmp_duckdb):
    """
    A row with fiscal_year='FY2023' (outside PERIOD_MAP) must be accepted
    by the ingestion pipeline. period_index must be NULL. The validation
    report must count it in 'unmapped_periods', not in 'rows_rejected'.
    """
    row = make_test_row(fiscal_year="FY2023", fiscal_quarter="Q1")
    report = run_ingestion_pipeline([row], db=tmp_duckdb)
    assert report.rows_rejected == 0
    assert report.rows_unmapped_period == 1
    conn = duckdb.connect(tmp_duckdb)
    result = conn.execute(
        "SELECT period_index FROM budget_records WHERE fiscal_year='FY2023'"
    ).fetchone()
    assert result[0] is None
```

### 2.6 Validation Report

The ingestion pipeline returns a `ValidationReport` Pydantic model. All six explicit DQ findings (R1-06) are surfaced:

**R1-05 derived column reconciliation (run against budget_records after load):**

```sql
-- R1-05 derived column reconciliation (run against budget_records after load)
SELECT COUNT(*) AS variance_usd_mismatches
FROM budget_records
WHERE source_variance IS NOT NULL
  AND ABS((actual - budget) - source_variance) > 0.01;

SELECT COUNT(*) AS yoy_mismatches
FROM budget_records
WHERE prior_year_actual IS NOT NULL AND prior_year_actual != 0
  AND yoy_change_pct IS NOT NULL
  AND ABS((actual / prior_year_actual - 1) * 100 - yoy_change_pct) > 0.05;

SELECT COUNT(*) AS forecast_accuracy_mismatches
FROM budget_records
WHERE source_forecast IS NOT NULL AND actual != 0
  AND forecast_accuracy_pct IS NOT NULL
  AND ABS((100 - ABS(source_forecast - actual) / actual * 100) - forecast_accuracy_pct) > 0.05;
```

These three counts populate the `variance_usd_mismatches`, `yoy_mismatches`, and `forecast_accuracy_mismatches` fields in `ValidationReport` (see below).

**DQ finding (a) — BUD-00018 inconsistency:**
Query: `SELECT record_id FROM budget_records WHERE source_variance = 0.0 AND variance_pct != 0.0`. Any matching rows are listed in the report with the label "variance_usd=0 but variance_pct≠0". For the sample dataset, BUD-00018 (`variance_pct = −2.1`) will appear. These rows are carried as-is; no correction is applied.

**DQ finding (b) — Source forecast mean absolute gap:**
Query: `SELECT AVG(ABS(source_forecast - actual) / NULLIF(actual, 0) * 100) AS mean_gap, MAX(ABS(source_forecast - actual) / NULLIF(actual, 0) * 100) AS max_gap FROM budget_records WHERE source_forecast IS NOT NULL AND actual != 0`. If `mean_gap < 5`, surface caveat: "Source forecast mean absolute gap is {mean_gap:.1f}% (max {max_gap:.2f}%). This is unusually close to actuals and may indicate post-hoc adjustment. The source forecast is not used as a model input."

**DQ finding (c) — Duplicate natural keys:**
Query: `SELECT department, category, fiscal_year, fiscal_quarter, COUNT(*) AS cnt FROM budget_records GROUP BY 1,2,3,4 HAVING cnt > 1`. Count of duplicate combos and total affected rows are reported. Warning text: "Found {n_combos} duplicate (dept+category+year+quarter) combinations covering {n_rows} rows. record_id remains the primary key; all queries aggregate over the natural key."

**DQ finding (d) — Anomaly label sign inconsistency:**
Queries:
```sql
SELECT COUNT(*) FROM budget_records WHERE source_anomaly_type='Overrun' AND variance_pct < 0;
SELECT COUNT(*) FROM budget_records WHERE source_anomaly_type='Underspend' AND variance_pct > 0;
```
Report as: "Overrun rows with negative variance_pct: {n} of 26 ({pct:.0f}%). Underspend rows with positive variance_pct: {n} of 29 ({pct:.0f}%). Source anomaly labels are not reliable for sign-based filtering."

**DQ finding (e) — variance_pct capped at ±50:**
Query: `SELECT COUNT(*) FROM budget_records WHERE variance_pct <= -50 OR variance_pct >= 50`. Report the count and note: "variance_pct is capped at ±50 in the source file. The anomaly detector operates on these capped raw values."

**DQ finding (f) — Check for rows at the +50 cap:**
Query: `SELECT record_id FROM budget_records WHERE variance_pct >= 50`. In the sample dataset this returns 0 rows; the report must explicitly state: "Rows at +50 cap: 0". This check must always run (the count could be non-zero in other datasets).

**`ValidationReport` and `DQFinding` Pydantic models:**

```python
class DQFinding(BaseModel):
    code: str           # e.g. "variance_zero_nonzero_pct", "duplicate_keys"
    record_ids: list[str]
    message: str

class ValidationReport(BaseModel):
    total_rows: int
    rows_accepted: int
    rows_rejected: int
    rows_unmapped_period: int
    fiscal_period_range: str           # e.g. "FY2024 Q1 – FY2026 Q4"
    department_count: int
    category_count: int
    fund_source_count: int
    variance_usd_mismatches: int       # recomputed vs stored
    yoy_mismatches: int
    forecast_accuracy_mismatches: int
    duplicate_key_combos: int
    duplicate_key_rows: int
    source_flag_sign_disagreements: int
    dq_findings: list[DQFinding]
```

### 2.7 Sample Data Button (R1-11)

When no dataset is loaded, the frontend displays a "Load sample data" button. Clicking it triggers `POST /upload/sample` on the backend, which reads the bundled `data/Team6Dataset.xlsx` and runs the same ingestion pipeline (column mapping auto-confirmed using the known canonical mapping, validation report generated and returned). No user interaction is skipped.

### 2.8 Multiple Dataset Support (R1-10)

The backend maintains a `datasets` table in a shared `catalog.ddb` DuckDB file:

```sql
CREATE TABLE datasets (
    dataset_id   VARCHAR PRIMARY KEY,
    name         VARCHAR NOT NULL,
    created_at   TIMESTAMP NOT NULL,
    row_count    INTEGER,
    db_path      VARCHAR NOT NULL
);
```

`GET /datasets` returns the list. The active dataset is passed as `dataset_id` in every tool request. The frontend shows a dataset selector dropdown in the header.

---

## 3. Variance, Trend, and Anomaly Analysis (R2)

### 3.1 DuckDB Query Patterns

All queries use aggregate functions over the canonical table. The four entity levels plus Dept×Category are supported for analysis (not forecasting).

**Total variance:**
```sql
SELECT
    SUM(actual) AS total_actual,
    SUM(budget) AS total_budget,
    (SUM(actual) / SUM(budget) - 1) * 100 AS variance_pct_agg
FROM budget_records
WHERE fiscal_year = $year;  -- optional filter
```

**By Department:**
```sql
SELECT
    department,
    SUM(actual)  AS total_actual,
    SUM(budget)  AS total_budget,
    SUM(actual - budget) AS variance_usd,
    (SUM(actual) / SUM(budget) - 1) * 100 AS variance_pct_agg
FROM budget_records
GROUP BY department
ORDER BY variance_pct_agg DESC;
```

**By Category:**
```sql
SELECT
    category,
    SUM(actual) AS total_actual,
    SUM(budget) AS total_budget,
    SUM(actual - budget) AS variance_usd,
    (SUM(actual) / SUM(budget) - 1) * 100 AS variance_pct_agg
FROM budget_records
GROUP BY category
ORDER BY variance_pct_agg DESC;
```

**By Fund Source:**
```sql
SELECT
    fund_source,
    SUM(actual)  AS total_actual,
    SUM(budget)  AS total_budget,
    SUM(actual - budget) AS variance_usd,
    (SUM(actual) / SUM(budget) - 1) * 100 AS variance_pct_agg
FROM budget_records
GROUP BY fund_source
ORDER BY variance_pct_agg DESC;
```

**Dept × Category (aggregated — required because natural key is non-unique):**
```sql
SELECT
    department,
    category,
    SUM(actual)  AS total_actual,
    SUM(budget)  AS total_budget,
    SUM(actual - budget) AS variance_usd,
    (SUM(actual) / SUM(budget) - 1) * 100 AS variance_pct_agg
FROM budget_records
GROUP BY department, category
ORDER BY department, category;
```

**Time series for a specific entity (e.g., single department):**
```sql
SELECT
    period_index,
    fiscal_year,
    fiscal_quarter,
    SUM(actual)  AS total_actual,
    SUM(budget)  AS total_budget,
    (SUM(actual) / SUM(budget) - 1) * 100 AS ratio_pct
FROM budget_records
WHERE department = $dept
  AND period_index IS NOT NULL     -- exclude rows with unrecognised fiscal periods
GROUP BY period_index, fiscal_year, fiscal_quarter
ORDER BY period_index;
```

### 3.2 Anomaly Detection Algorithm

The anomaly detector is a pure Python function operating on a pandas DataFrame extracted from DuckDB. It is not a model training step; it runs on demand and its outputs are stored in DuckDB table `anomaly_results`.

**DuckDB table DDL:**

```sql
CREATE TABLE IF NOT EXISTS anomaly_results (
    run_id        VARCHAR NOT NULL,   -- UUID for this detection run
    dataset_id    VARCHAR NOT NULL,
    record_id     VARCHAR NOT NULL,
    detector_flag INTEGER NOT NULL,   -- 1 = flagged
    z_score       DOUBLE,
    peer_group    VARCHAR,
    sensitivity   DOUBLE NOT NULL,
    computed_at   TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS anomaly_run_summary (
    run_id      VARCHAR PRIMARY KEY,
    dataset_id  VARCHAR NOT NULL,
    sensitivity DOUBLE NOT NULL,
    tp INTEGER, fp INTEGER, fn INTEGER, tn INTEGER,
    computed_at TIMESTAMP NOT NULL
);
```

Both `anomaly_results` and `anomaly_run_summary` are stored within the dataset's own `.ddb` file at `/data/dbs/{dataset_id}.ddb`. The `dataset_id` column in `anomaly_results` is retained for cross-validation queries and is always equal to the containing file's dataset UUID.

**Algorithm (locked):**

```python
def detect_anomalies(df: pd.DataFrame, sensitivity: float = 2.5) -> pd.DataFrame:
    """
    Peer group: category. Fallback: department (when category MAD = 0).
    Modified Z-score: z = 0.6745 * (value - median) / MAD
    Threshold: |z| > sensitivity (default 2.5)
    """
    results = []
    for category, grp in df.groupby("category"):
        median = grp["variance_pct"].median()
        mad = (grp["variance_pct"] - median).abs().median()
        if mad == 0:
            # Fallback: peer by department
            for dept, sub in grp.groupby("department"):
                sub_median = sub["variance_pct"].median()
                sub_mad = (sub["variance_pct"] - sub_median).abs().median()
                if sub_mad == 0:
                    continue  # All identical; no deviation possible
                z = 0.6745 * (sub["variance_pct"] - sub_median) / sub_mad
                flagged = sub[z.abs() > sensitivity].copy()
                flagged["peer_group"] = "department"
                flagged["peer_median"] = sub_median
                flagged["peer_mad"] = sub_mad
                flagged["z_score"] = z[z.abs() > sensitivity]
                results.append(flagged)
        else:
            z = 0.6745 * (grp["variance_pct"] - median) / mad
            flagged = grp[z.abs() > sensitivity].copy()
            flagged["peer_group"] = "category"
            flagged["peer_median"] = median
            flagged["peer_mad"] = mad
            flagged["z_score"] = z[z.abs() > sensitivity]
            results.append(flagged)
    return pd.concat(results, ignore_index=True) if results else pd.DataFrame()
```

**Ground truth compliance:**
At the default `sensitivity=2.5` the detector must flag all 17 rows with `|variance_pct| ≥ 30` (listed in section 1.9 of design.md and section 2 of ground_truth.md) and produce no more than 5 additional flags. The pytest assertion uses the full 300-row dataset:

```python
def test_anomaly_ground_truth(full_df):  # full_df = data/Team6Dataset.xlsx
    flagged = detect_anomalies(full_df, sensitivity=2.5)
    gt_ids = {
        "BUD-00237","BUD-00189","BUD-00176","BUD-00005","BUD-00190",
        "BUD-00285","BUD-00213","BUD-00267","BUD-00160","BUD-00156",
        "BUD-00228","BUD-00293","BUD-00087","BUD-00202","BUD-00116",
        "BUD-00028","BUD-00241"
    }
    flagged_ids = set(flagged["record_id"])
    assert gt_ids.issubset(flagged_ids), f"Missed: {gt_ids - flagged_ids}"
    extra = flagged_ids - gt_ids
    assert len(extra) <= 5, f"Too many extra flags: {extra}"
```

### 3.3 Source Flag Independence

`source_anomaly_flag` and `source_anomaly_type` are stored as informational metadata. They are never used as ground truth, model training labels, or filtering criteria. The anomaly detector ignores them. The UI displays them in the anomaly table as "Source flag" alongside the application's "Detected" column.

### 3.4 Detector-vs-Source-Flag Panel (R2-04)

A 2×2 confusion matrix is computed for each run of the anomaly detector:

- **TP:** `detector_flag=1 AND source_anomaly_flag=1`
- **FP (source only):** `detector_flag=0 AND source_anomaly_flag=1` — "flagged by source, not by application"
- **FN (detector only):** `detector_flag=1 AND source_anomaly_flag=0` — "flagged by application, not by source"
- **TN:** `detector_flag=0 AND source_anomaly_flag=0`

These counts are returned by `detect_anomalies` and displayed in the dashboard's "Detector vs Source" panel. The pytest assertion:

```python
def test_detector_source_agreement(full_df):
    flagged = detect_anomalies(full_df, sensitivity=2.5)
    flagged_ids = set(flagged["record_id"])
    tp = sum(1 for r in full_df.itertuples()
             if r.record_id in flagged_ids and r.source_anomaly_flag == 1)
    fp = sum(1 for r in full_df.itertuples()
             if r.record_id not in flagged_ids and r.source_anomaly_flag == 1)
    fn = sum(1 for r in full_df.itertuples()
             if r.record_id in flagged_ids and r.source_anomaly_flag == 0)
    tn = sum(1 for r in full_df.itertuples()
             if r.record_id not in flagged_ids and r.source_anomaly_flag == 0)
    assert tp + fp + fn + tn == len(full_df)
```

### 3.5 Persistent Pattern Detection

**Rule (locked):**
An entity qualifies as a persistent pattern when its aggregate variance `(SUM(actual)/SUM(budget) − 1) × 100` has the same sign AND exceeds ±5% in **at least 2 of the 3 fiscal years FY2024, FY2025, FY2026**. The sign must be the same in both (or all three) qualifying years. −5.0% exactly qualifies (boundary is inclusive).

**Implementation:**

```python
def detect_persistent_patterns(df: pd.DataFrame, threshold: float = 5.0) -> list[dict]:
    """
    Returns a list of persistent pattern records for category and department entities.
    Each record includes entity_type, entity_name, qualifying_years, per_year_variance.
    """
    patterns = []
    for entity_col in ("category", "department"):
        yearly = (
            df.groupby([entity_col, "fiscal_year"])
            .apply(lambda g: (g["actual"].sum() / g["budget"].sum() - 1) * 100)
            .reset_index(name="variance_pct_agg")
        )
        for entity, grp in yearly.groupby(entity_col):
            yr_map = dict(zip(grp["fiscal_year"], grp["variance_pct_agg"]))
            over_years  = [y for y, v in yr_map.items() if v >= threshold]
            under_years = [y for y, v in yr_map.items() if v <= -threshold]
            if len(over_years) >= 2:
                patterns.append({
                    "entity_type": entity_col, "entity_name": entity,
                    "direction": "over", "qualifying_years": over_years,
                    "per_year_variance": yr_map,
                })
            if len(under_years) >= 2:
                patterns.append({
                    "entity_type": entity_col, "entity_name": entity,
                    "direction": "under", "qualifying_years": under_years,
                    "per_year_variance": yr_map,
                })
    return patterns
```

**Ground truth (from ground_truth.md section 3) — the full tables are locked:**

*Persistently over-budget categories:* Consulting & Contracts (all 3 years: +16.1%, +13.9%, +14.7%), Equipment & Technology (FY2025+FY2026: +5.8%, +10.9%), Facility Maintenance (FY2024+FY2025: +10.5%, +6.1%), Student Aid & Scholarships (FY2025+FY2026: +7.2%, +10.8%).

*Persistently under-budget categories:* Travel & Conferences (all 3: −17.9%, −14.1%, −9.8%), Professional Development (all 3: −14.1%, −14.1%, −10.4%), Administrative Overhead (all 3: −22.5%, −7.1%, −5.0%), Research Operations (FY2025+FY2026: −5.1%, −13.6%).

*Persistently over-budget departments:* College of Architecture (all 3: +14.2%, +13.5%, +11.9%), College of Pharmacy (all 3: +7.4%, +15.2%, +7.7%), Office of Research (FY2024+FY2026: +6.8%, +9.7%), College of Applied Health Sciences (FY2024+FY2025: +14.3%, +8.6%), College of Liberal Arts & Sciences (FY2024+FY2026: +9.3%, +5.0%).

*Persistently under-budget departments:* College of Education (FY2024+FY2025: −5.9%, −20.3%), College of Medicine (FY2024+FY2026: −18.9%, −26.4%), College of Nursing (FY2025+FY2026: −19.9%, −8.7%), College of Urban Planning (FY2024+FY2026: −17.5%, −9.0%), Graduate College (FY2025+FY2026: −10.9%, −13.3%), College of Business Administration (FY2024+FY2026: −13.1%, −5.0%).

**Boundary handling:** values of exactly ±5.0% qualify (inclusive rule). The dashboard must display "persistent in N of 3 years" for two-year patterns and note the non-qualifying year's value for context (e.g., Facility Maintenance "persistent in FY2024+FY2025; FY2026 reversed to −13.1%").

**Sign-consistency test:**

```python
def test_persistent_pattern_sign_consistency(full_df):
    patterns = detect_persistent_patterns(full_df)
    for p in patterns:
        if p["direction"] == "over":
            assert all(p["per_year_variance"][y] > 0 for y in p["qualifying_years"]), (
                f"Over-budget pattern {p['entity_name']} has a non-positive qualifying year"
            )
        else:
            assert all(p["per_year_variance"][y] < 0 for y in p["qualifying_years"]), (
                f"Under-budget pattern {p['entity_name']} has a non-negative qualifying year"
            )

def test_clas_fy2025_excluded_from_over_qualifying_years(full_df):
    """College of Liberal Arts & Sciences FY2025 = -4.8%; must not appear in over qualifying years."""
    patterns = detect_persistent_patterns(full_df)
    clas_over = [p for p in patterns
                 if p["entity_name"] == "College of Liberal Arts & Sciences"
                 and p["direction"] == "over"]
    assert len(clas_over) == 1
    assert "FY2025" not in clas_over[0]["qualifying_years"]
```

### 3.6 STL Decomposition Gating

STL (Seasonal and Trend decomposition using Loess) requires at minimum 8 quarters of data. The gating is enforced at the analysis layer:

| Entity | Quarters | STL Available |
|---|---|---|
| Travel & Conferences | 7 | **No** |
| College of Liberal Arts & Sciences | 6 | **No** |
| Student Aid & Scholarships | 8 | Yes (minimum) |
| All others (≥8 quarters) | ≥8 | Yes |

When STL is not available, the frontend must show a visible note in the trend chart area: "STL decomposition unavailable: [Entity] has only [N] quarters of data (minimum 8 required)." This note must be present even if the chart area is otherwise empty. The note must not be dismissible.

For STL-ineligible entities, `TrendChart.tsx` renders the raw quarterly spend-vs-budget ratio data points connected by a line, overlaid with an OLS regression line computed client-side from the `quarterly_time_series` array in the `explain_variance` response. No additional API call is required for the fallback trend line.

The STL call uses `statsmodels.tsa.seasonal.STL`. Period parameter is 4 (quarterly seasonality). Results include trend and seasonal components, rendered as overlaid lines on the Recharts time-series chart.

### 3.7 KPI Panel Specification (R2-07)

The dashboard KPI panel displays top over-budget and under-budget entities for immediate situational awareness. Its numbers must be derived from the same `budget_records` table and the same aggregation formula as the chat tools (`query_actuals`, `explain_variance`) so that dashboard KPIs and chat tool outputs are always consistent.

**Endpoint:** `GET /kpis?dataset_id={uuid}&fiscal_year={optional}` returns a `KpiResponse` Pydantic model.

**Pydantic models:**

```python
class KpiEntityRow(BaseModel):
    entity_level: str        # "department" or "category"
    entity_name: str
    total_actual: float
    total_budget: float
    variance_usd: float
    variance_pct_agg: float  # (SUM(actual)/SUM(budget) - 1) * 100

class FiscalYearSummary(BaseModel):
    fiscal_year: str
    total_actual: float
    total_budget: float
    variance_usd: float
    variance_pct: float

class KpiResponse(BaseModel):
    fiscal_year_filter: str | None   # e.g. "FY2026", or None for all years
    top_over_departments: list[KpiEntityRow]   # top-N by variance_pct_agg DESC
    top_under_departments: list[KpiEntityRow]  # top-N by variance_pct_agg ASC
    top_over_categories: list[KpiEntityRow]
    top_under_categories: list[KpiEntityRow]
    total_actual: float
    total_budget: float
    total_variance_pct: float
    anomaly_count: int        # count of `detector_flag=1` rows in `anomaly_results` for the most recent `run_id` by `computed_at` for this `dataset_id`
    source_flag_disagreement_count: int  # count of rows where detector and source disagree (FP + FN from confusion matrix)
    fiscal_year_summary: list[FiscalYearSummary]  # always includes all available years
```

Note: The `GET /kpis` DuckDB query adds a `GROUP BY fiscal_year` sub-query that always returns all available fiscal years regardless of the `fiscal_year_filter`. The `source_flag_disagreement_count` field is computed as `fp + fn` from the `anomaly_run_summary` table for the most recent `run_id` (by `computed_at`) for this `dataset_id`.

**DuckDB queries (same formula as §3.1, enforced by sharing the `build_variance_query()` helper):**

```sql
-- Top-N over-budget departments (example; N from env var KPI_TOP_N, default 5)
SELECT
    department AS entity_name,
    SUM(actual)                              AS total_actual,
    SUM(budget)                              AS total_budget,
    SUM(actual - budget)                     AS variance_usd,
    (SUM(actual) / NULLIF(SUM(budget),0) - 1) * 100 AS variance_pct_agg
FROM budget_records
WHERE ($fiscal_year IS NULL OR fiscal_year = $fiscal_year)
GROUP BY department
ORDER BY variance_pct_agg DESC
LIMIT $kpi_top_n;
```

The same parameterized query structure is used for under-budget departments (ASC), over-budget categories, and under-budget categories.

**Architectural invariant:** `KpiPanel.tsx` calls `GET /kpis` on mount and on every dataset switch. It does not maintain a separate cache. There is no separate aggregation path; the endpoint always queries `budget_records` live. This ensures that a user who asks the chat "which departments are furthest over budget?" and then looks at the KPI panel sees the same numbers.

**Test assertion:**

```python
def test_kpi_panel_matches_query_actuals(full_df, client):
    """KPI top-over-budget departments must match query_actuals entity_level=department results."""
    kpi = client.get("/kpis", params={"dataset_id": "sample"}).json()
    tool = call_tool("query_actuals", {"dataset_id": "sample", "entity_level": "department"})
    # The top entity in KPI must be College of Architecture (+13.52%)
    assert kpi["top_over_departments"][0]["entity_name"] == "College of Architecture"
    # Variance pct must match the tool result within tolerance
    tool_row = next(r for r in tool["rows"] if r["entity_name"] == "College of Architecture")
    assert abs(kpi["top_over_departments"][0]["variance_pct_agg"] - tool_row["variance_pct_agg"]) < 0.01
```

---

## 4. Reporting Process Health (R2b)

### 4.1 Tool Schema

See section 6 for the full `get_reporting_health` tool schema. The tool returns the following structure with a mandatory "descriptive only" note in every response.

### 4.2 DuckDB Query

```sql
SELECT
    {grouping_col},
    AVG(num_spreadsheet_versions)  AS avg_spreadsheet_versions,
    AVG(manual_adjustments_count)  AS avg_manual_adjustments,
    AVG(data_entry_errors)         AS avg_data_entry_errors,
    AVG(days_to_produce_report)    AS avg_days_to_produce,
    AVG(approval_cycles)           AS avg_approval_cycles,
    COUNT(*) FILTER (WHERE data_entry_errors >= 1)::FLOAT / COUNT(*) AS pct_with_errors,
    COUNT(*) FILTER (WHERE report_status = 'Delayed')::FLOAT / COUNT(*) AS pct_delayed,
    COUNT(*) AS row_count
FROM budget_records
GROUP BY {grouping_col}
ORDER BY {grouping_col};
```

The `{grouping_col}` is one of `department`, `report_type`, `report_status`, or `NULL` (total). The tool validates that the requested grouping is one of the four allowed values.

### 4.3 "Descriptive Only" Enforcement (R2B-02)

Two enforcements are required:

1. **System prompt** — The Bedrock system prompt includes the verbatim text:
   `"DESCRIPTIVE ONLY: All process health statistics are descriptive summaries of observed data. You must not assert or imply causal relationships between any process column (spreadsheet versions, manual adjustments, data entry errors, days to produce, approval cycles) and variance size or direction."`

2. **Tool response** — The `get_reporting_health` tool always includes a `descriptive_note` field in its JSON response:
   `"descriptive_note": "These statistics describe observed reporting process characteristics. No causal relationship between process metrics and budget variance is implied or supported by this data."`

**Test assertion:**

```python
def test_descriptive_only_enforcement(system_prompt: str, health_tool_response: dict):
    assert "DESCRIPTIVE ONLY" in system_prompt
    assert "descriptive_note" in health_tool_response
    assert "causal" in health_tool_response["descriptive_note"].lower()
```

---

## 5. Forecasting (R3)

### 5.1 Forecastable Entities

Forecasts are generated for: Total (1 entity), each of the 16 departments, each of the 10 categories, each of the 6 fund sources. Total: 33 forecast series.

**Department × Category is refused** with the exact error message:
`"Department × Category forecasting is not supported: these pairs average 2.2 rows of history, which is far below the 8-quarter minimum required for rolling-origin cross-validation."`

This refusal is enforced in the `run_forecast` tool (section 6), in the `POST /forecast` endpoint, and in the backend before any model code is reached.

### 5.2 Forecast Target

**Locked: spend-vs-budget ratio = SUM(actual) / SUM(budget) per quarter.**

Rationale from profiling: quarterly row counts vary from 12 to 33 (a 2.75× range). Using raw totals or per-row means mixes a real spending signal with a structural composition artifact. The ratio divides out the row-count effect, yielding a comparable signal across all 12 quarters. Values > 1.0 mean over-budget; values < 1.0 mean under-budget.

The 12 observed ratio values per entity are the training input. The model predicts the ratio for each forecast quarter. The application layer recovers a dollar forecast:

```
dollar_forecast = predicted_ratio × planned_budget_total
```

where `planned_budget_total` is `SUM(budget)` for the entity over the most recent completed fiscal year (FY2026). This value is stored at forecast-time in `forecast_results` so that subsequent cached reads return consistent dollar values even if the underlying data changes. Dollar prediction intervals are computed by the same multiplicative transform: `dollar_pi_low = pi_ratio_low × planned_budget_total`.

`source_forecast` is **not** used as a model input. It is carried as `source_forecast` for lineage and appears only in the benchmark panel (section 5.8).

### 5.3 Permitted Models

| Model | Condition |
|---|---|
| Naive | Always available |
| Seasonal Naive | Only when entity has ≥ 8 quarters of history |
| Drift | Always available |
| ETS (non-seasonal, damped trend) | Always available |
| Linear Trend | Always available |

Prophet and all deep learning models are prohibited.

Implementation uses `statsforecast.models` where available. The `statsmodels` `ExponentialSmoothing` with `damped_trend=True, trend='add', seasonal=None` is the ETS fallback.

### 5.4 Rolling-Origin Cross-Validation

Parameters (locked): minimum training window = 8 quarters, maximum folds = 4, scored by MAE and sMAPE.

For an entity with N quarters of history:
- Fold 1: train on periods 1–8, predict period 9
- Fold 2: train on periods 1–9, predict period 10
- Fold 3: train on periods 1–10, predict period 11
- Fold 4: train on periods 1–11, predict period 12 (only if N=12)

For entities with fewer than 12 quarters, fewer folds are available. The minimum is 1 fold (which requires at least 9 quarters of history). Entities with fewer than 9 quarters skip cross-validation and are assigned confidence label "Low" without CV scoring.

The model with the lowest MAE across folds wins. If tied, sMAPE breaks the tie.

**Minimum-folds rule for confidence uplift:** A confidence label of Medium or High requires at least 2 CV folds. An entity with only 1 fold (9 quarters of history) is capped at "Low" regardless of CV error, because a single held-out point does not provide a reliable error estimate. This prevents a lucky single-fold result from producing a spuriously high confidence label.

### 5.5 Confidence Label Logic

The full decision table (all conditions evaluated in order; first match wins):

| Condition | Label |
|---|---|
| Entity has < 9 quarters of history (< 8: cannot model; 8 exactly: no CV folds) | Low |
| 9 quarters exactly (only 1 CV fold; insufficient for uplift) | Low |
| High CV error: MAE ≥ 0.15 OR sMAPE ≥ 30% | Low |
| Wide 95% PI: width > 0.3 AND otherwise would be High | Medium (override) |
| Medium CV error: 0.05 ≤ MAE < 0.15 OR 10% ≤ sMAPE < 30% | Medium |
| Low CV error: MAE < 0.05 AND sMAPE < 10% | High |

> This includes College of Liberal Arts & Sciences (6 quarters) and Travel & Conferences (7 quarters) in the sample dataset. No hard-coded entity names in code; the general rule applies.

Thresholds are configurable via environment variables. Defaults match the `.env.example`:

| Env var | Default | Meaning |
|---|---|---|
| `FORECAST_MAE_HIGH` | 0.05 | MAE below this → High (if other conditions met) |
| `FORECAST_MAE_LOW` | 0.15 | MAE at or above this → Low |
| `FORECAST_SMAPE_HIGH` | 10.0 | sMAPE below this → High |
| `FORECAST_SMAPE_LOW` | 30.0 | sMAPE at or above this → Low |
| `FORECAST_PI_WIDTH_MEDIUM` | 0.3 | 95% PI width above this overrides High → Medium |

Travel & Conferences (7 quarters) additionally cannot use Seasonal Naive (requires ≥ 8 quarters).

### 5.6 Prediction Intervals

Every forecast includes 80% and 95% prediction intervals. For parametric models (ETS), intervals derive from the model's residual variance. For Naive and Drift, bootstrap resampling over the training residuals produces intervals (1000 bootstrap samples). Intervals are stored as separate columns: `pi_80_low`, `pi_80_high`, `pi_95_low`, `pi_95_high`. They are never artificially narrowed.

### 5.7 Forecast Persistence (R3-09)

Forecasts are persisted in DuckDB table `forecast_results` within the dataset's own `.ddb` file. The table stores both ratio-based fields (the model output) and dollar-denominated fields (the derived output used by the LLM and displayed in the UI), so that cached reads return the same complete result as a fresh computation.

```sql
CREATE TABLE IF NOT EXISTS forecast_results (
    forecast_id           VARCHAR PRIMARY KEY,   -- UUID
    dataset_id            VARCHAR NOT NULL,
    entity_level          VARCHAR NOT NULL,       -- total/department/category/fund_source
    entity_name           VARCHAR,                -- NULL for total
    forecast_quarter      VARCHAR NOT NULL,       -- FY2027 Q1 etc.
    period_index          INTEGER NOT NULL,       -- 13, 14, 15, 16 for FY2027
    ratio_forecast        DOUBLE NOT NULL,
    pi_80_low             DOUBLE NOT NULL,
    pi_80_high            DOUBLE NOT NULL,
    pi_95_low             DOUBLE NOT NULL,
    pi_95_high            DOUBLE NOT NULL,
    dollar_forecast       DOUBLE,                 -- ratio_forecast × planned_budget_total
    dollar_pi_80_low      DOUBLE,
    dollar_pi_80_high     DOUBLE,
    dollar_pi_95_low      DOUBLE,
    dollar_pi_95_high     DOUBLE,
    planned_budget_total  DOUBLE,                 -- SUM(budget) for entity in FY2026; denominator used in dollar conversion
    model_name            VARCHAR NOT NULL,
    cv_mae                DOUBLE,
    cv_smape              DOUBLE,
    confidence_label      VARCHAR NOT NULL,       -- High/Medium/Low
    computed_at           TIMESTAMP NOT NULL
);
```

`planned_budget_total` is `SUM(budget)` for the entity over the most recent completed fiscal year (FY2026), stored at forecast-time. This ensures that all five dollar fields remain consistent with the ratio fields on every subsequent read, even if an implementer re-queries the source data later.

The `run_forecast` tool first checks for an existing row matching `(dataset_id, entity_level, entity_name, forecast_quarter)` and returns it without recomputing unless `force_recompute=true` is passed.

### 5.8 Source Forecast Benchmark Panel (R3-10)

The dashboard includes a "Benchmark" panel comparing:
- Application model CV error (MAE and sMAPE from rolling-origin CV)
- Source forecast accuracy, computed dynamically from the DQ query in section 2.6(b)

The caveat text is dynamic, computed at display time from the query result:

- If `mean_gap < 5%`: display `"Note: The source forecast (forecasted_amount_usd) shows a mean absolute gap of {mean_gap:.1f}% (max {max_gap:.2f}%) versus actuals. This is unusually close and may indicate post-hoc adjustment. The source forecast was not used as a model input."`
- If `mean_gap ≥ 5%`: display `"Source forecast accuracy: {mean_gap:.1f}% mean absolute gap versus actuals (max {max_gap:.2f}%). Treat as an upper-bound reference only. The source forecast was not used as a model input."`

For `Team6Dataset.xlsx` the dynamic values will be `mean_gap = 4.1%` and `max_gap = 14.46%`, matching the confirmed profiling figures. Other datasets will show their own computed values.

---

## 6. Tool Definitions (R5)

All tools are registered with the Bedrock Converse API as tool schemas. Each tool maps to a Python function with a matching Pydantic request/response model.

### Tool 1: `list_entities`

**Purpose:** Returns all dimension values, fiscal periods, and row counts in the active dataset so the LLM can reference entities by their exact names.

**JSON Schema:**
```json
{
  "name": "list_entities",
  "description": "Returns all departments, categories, fund sources, fiscal periods, and dataset metadata for the active dataset. Call this first in any session before referencing entity names.",
  "inputSchema": {
    "json": {
      "type": "object",
      "properties": {
        "dataset_id": {"type": "string", "description": "UUID of the active dataset"}
      },
      "required": ["dataset_id"]
    }
  }
}
```

**Pydantic models:**
```python
class ListEntitiesRequest(BaseModel):
    dataset_id: str

class EntityCounts(BaseModel):
    departments: list[str]
    categories: list[str]
    fund_sources: list[str]
    fiscal_years: list[str]
    fiscal_quarters: list[str]
    periods: list[dict]  # [{"fiscal_year": "FY2024", "fiscal_quarter": "Q1", "period_index": 1, "row_count": 25}, ...]
    total_rows: int
    datasets: list[dict]  # [{"dataset_id": "...", "name": "...", "row_count": 300}]

class ListEntitiesResponse(BaseModel):
    entities: EntityCounts
```

### Tool 2: `query_actuals`

**Purpose:** Flexible dimensional query returning aggregated budget/actual/variance rows. All arithmetic is performed by DuckDB; the LLM reads the result, never computes it.

**JSON Schema:**
```json
{
  "name": "query_actuals",
  "description": "Query budget, actual, and variance data. Aggregates over any combination of dimensions. All arithmetic is precomputed — never compute these numbers yourself.",
  "inputSchema": {
    "json": {
      "type": "object",
      "properties": {
        "dataset_id": {"type": "string"},
        "entity_level": {
          "type": "string",
          "enum": ["total", "department", "category", "fund_source", "dept_x_category"],
          "description": "Grouping level for the result"
        },
        "entity_name": {
          "type": "string",
          "description": "Filter to a specific entity (e.g. 'College of Architecture'). Omit for all entities at this level."
        },
        "fiscal_year": {
          "type": "string",
          "description": "Optional filter, e.g. 'FY2024'. Omit for all years."
        },
        "fiscal_quarter": {
          "type": "string",
          "description": "Optional filter, e.g. 'Q3'. Omit for all quarters."
        },
        "period_index_from": {"type": "integer", "description": "Inclusive start period index (1–12)"},
        "period_index_to":   {"type": "integer", "description": "Inclusive end period index (1–12)"}
      },
      "required": ["dataset_id", "entity_level"]
    }
  }
}
```

**Pydantic models:**
```python
class QueryActualsRequest(BaseModel):
    dataset_id: str
    entity_level: Literal["total","department","category","fund_source","dept_x_category"]
    entity_name: str | None = None
    fiscal_year: str | None = None
    fiscal_quarter: str | None = None
    period_index_from: int | None = Field(None, ge=1, le=12)
    period_index_to:   int | None = Field(None, ge=1, le=12)

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
    dq_warnings: list[str]  # populated if BUD-00018 or capped rows appear in results

class QueryActualsResponse(BaseModel):
    rows: list[ActualsRow]
    query_sql: str  # for evidence panel
```

**Error handling:**
- Unknown `entity_name`: DuckDB returns 0 rows; the tool returns an empty `rows` list with a top-level `"entity_not_found": true` flag. The agent loop interprets this and triggers an insufficient-data response.
- Invalid `period_index_from > period_index_to`: HTTP 422 before DuckDB is called.

### Tool 3: `run_forecast`

**Purpose:** Returns persisted or freshly computed forecast for a forecastable entity, including dollar-denominated fields so the LLM can cite dollar figures that are traceable to tool results (SYS-01).

**JSON Schema:**
```json
{
  "name": "run_forecast",
  "description": "Returns the FY2027 forecast for a supported entity level. Refuses Department × Category combinations. Returns point forecast, 80% and 95% prediction intervals in both ratio and dollar terms, selected model, CV error, and confidence label.",
  "inputSchema": {
    "json": {
      "type": "object",
      "properties": {
        "dataset_id": {"type": "string"},
        "entity_level": {
          "type": "string",
          "enum": ["total","department","category","fund_source"],
          "description": "dept_x_category is NOT permitted for forecasting"
        },
        "entity_name": {
          "type": "string",
          "description": "Entity name; omit or use 'total' for the aggregate total."
        },
        "horizon": {
          "type": "integer",
          "default": 4,
          "minimum": 1,
          "maximum": 8,
          "description": "Number of quarters to forecast ahead"
        },
        "planned_budget_total": {
          "type": "number",
          "description": "Optional: the planned total budget for the entity for the forecast period. If provided, used to compute dollar forecast fields. If omitted, dollar fields are computed from SUM(budget) in the most recent fiscal year (FY2026) in the dataset."
        },
        "force_recompute": {
          "type": "boolean",
          "default": false
        }
      },
      "required": ["dataset_id", "entity_level"]
    }
  }
}
```

**Pydantic models:**
```python
class RunForecastRequest(BaseModel):
    dataset_id: str
    entity_level: Literal["total","department","category","fund_source"]
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
    dollar_forecast: float | None        # ratio_forecast × planned_budget_total
    dollar_pi_80_low: float | None
    dollar_pi_80_high: float | None
    dollar_pi_95_low: float | None
    dollar_pi_95_high: float | None

class RunForecastResponse(BaseModel):
    entity_level: str
    entity_name: str | None
    model_name: str
    cv_mae: float | None
    cv_smape: float | None
    confidence_label: Literal["High","Medium","Low"]
    forecast_target: str             # always "spend-vs-budget ratio"
    planned_budget_total: float | None  # denominator used in dollar conversion; grounding anchor
    points: list[ForecastPoint]
    stl_available: bool
    stl_note: str | None             # e.g. "STL unavailable: 7 quarters of data (minimum 8 required)"
    dollar_forecast_available: bool        # False when no FY2026 budget denominator
    dollar_unavailable_reason: str | None  # human-readable; populated when dollar_forecast_available=False
    refusal: str | None              # non-null only for dept_x_category (error path)
```

**Error handling — Dept×Category refusal:** If `entity_level == "dept_x_category"` (or if `entity_level` contains a `×` separator): the tool immediately returns `RunForecastResponse(refusal="Department × Category forecasting is not supported: these pairs average 2.2 rows of history, which is far below the 8-quarter minimum required for rolling-origin cross-validation.", ...)` with all numeric fields null. The LLM reads the `refusal` string and quotes it verbatim. This refusal is logged (without financial figures).

**Error handling — entity not found:** Returns `entity_not_found: true` in a standard error envelope; the agent loop signals insufficient-data.

**Dollar field grounding note:** The LLM is permitted to cite `dollar_forecast` and the dollar interval fields from the tool response verbatim. These are the only dollar figures the LLM may state when answering a forecast question. The grounding check verifies cited dollar amounts against these fields using the tolerance rule appropriate to the cited format: bare-dollar citations (e.g. $108,693) use ± $1; abbreviated citations ($M, $K) use the rounding rules in §7.1 Step 3 Table. If `dollar_forecast_available` is `false`, the LLM must report the ratio forecast only and note the reason from `dollar_unavailable_reason`.

### Tool 4: `detect_anomalies`

**Purpose:** Runs the median/MAD anomaly detector on a specified entity and returns record-level results plus persistent patterns.

**JSON Schema:**
```json
{
  "name": "detect_anomalies",
  "description": "Runs anomaly detection (median/MAD on variance_pct within peer groups) and persistent pattern detection on the specified entity. Source anomaly flags are returned alongside but are NOT the detection ground truth.",
  "inputSchema": {
    "json": {
      "type": "object",
      "properties": {
        "dataset_id": {"type": "string"},
        "entity_level": {
          "type": "string",
          "enum": ["total","department","category","fund_source","dept_x_category"]
        },
        "entity_name": {
          "type": "string",
          "description": "Filter to a specific entity. Omit to run across all entities at this level."
        },
        "sensitivity": {
          "type": "number",
          "default": 2.5,
          "minimum": 1.0,
          "maximum": 5.0,
          "description": "Modified Z-score threshold. Higher = fewer flags."
        }
      },
      "required": ["dataset_id", "entity_level"]
    }
  }
}
```

**Pydantic models:**
```python
class DetectAnomaliesRequest(BaseModel):
    dataset_id: str
    entity_level: Literal["total","department","category","fund_source","dept_x_category"]
    entity_name: str | None = None
    sensitivity: float = Field(default=2.5, ge=1.0, le=5.0)

class AnomalyRecord(BaseModel):
    record_id: str
    department: str
    category: str
    fiscal_year: str
    fiscal_quarter: str
    period_index: int
    actual: float
    budget: float
    variance_pct: float
    peer_group: str         # "category" or "department"
    peer_median: float
    peer_mad: float
    z_score: float
    severity: str           # "high" (|z|>4), "medium" (|z|>3), "low" (|z|>2.5)
    source_anomaly_flag: int
    source_anomaly_type: str | None

class PersistentPattern(BaseModel):
    entity_type: str
    entity_name: str
    direction: str          # "over" or "under"
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
```

### Tool 5: `compare_periods`

**Purpose:** Returns raw figures for two periods and pre-computed deltas. **All arithmetic is done by the tool, never by the LLM** (SYS-01).

**JSON Schema:**
```json
{
  "name": "compare_periods",
  "description": "Compares actual and budget figures for an entity across two fiscal periods. All delta arithmetic is pre-computed — never compute these numbers yourself.",
  "inputSchema": {
    "json": {
      "type": "object",
      "properties": {
        "dataset_id": {"type": "string"},
        "entity_level": {
          "type": "string",
          "enum": ["total","department","category","fund_source"]
        },
        "entity_name": {"type": "string"},
        "period_a": {
          "type": "object",
          "properties": {
            "fiscal_year": {"type": "string"},
            "fiscal_quarter": {"type": "string"}
          },
          "required": ["fiscal_year", "fiscal_quarter"]
        },
        "period_b": {
          "type": "object",
          "properties": {
            "fiscal_year": {"type": "string"},
            "fiscal_quarter": {"type": "string"}
          },
          "required": ["fiscal_year", "fiscal_quarter"]
        }
      },
      "required": ["dataset_id", "entity_level", "period_a", "period_b"]
    }
  }
}
```

**Pydantic models:**
```python
class PeriodRef(BaseModel):
    fiscal_year: str
    fiscal_quarter: str

class ComparePeriodRequest(BaseModel):
    dataset_id: str
    entity_level: Literal["total","department","category","fund_source"]
    entity_name: str | None = None
    period_a: PeriodRef
    period_b: PeriodRef

class PeriodSnapshot(BaseModel):
    fiscal_year: str
    fiscal_quarter: str
    period_index: int
    actual: float
    budget: float
    variance_usd: float
    variance_pct_agg: float
    row_count: int

class ComparePeriodResponse(BaseModel):
    entity_level: str
    entity_name: str | None
    period_a: PeriodSnapshot
    period_b: PeriodSnapshot
    # Pre-computed deltas (SYS-01: LLM must not compute these)
    actual_delta_usd: float       # period_b.actual - period_a.actual
    actual_delta_pct: float       # (period_b.actual / period_a.actual - 1) * 100
    budget_delta_usd: float
    budget_delta_pct: float
    variance_usd_delta: float     # period_b.variance_usd - period_a.variance_usd
    variance_pct_delta: float     # period_b.variance_pct_agg - period_a.variance_pct_agg
    dq_warnings: list[str]
```

**Error handling:**
- Either period not found in data: returns a structured error with `period_not_found: ["FY2027 Q1"]` and an empty snapshot. The agent loop surfaces an insufficient-data message.
- Same period for A and B: HTTP 422 before query.

### Tool 6: `explain_variance`

**Purpose:** Returns a structured variance decomposition attributing variance to top contributors. SYS-01 applies: all figures are DuckDB-computed.

**JSON Schema:**
```json
{
  "name": "explain_variance",
  "description": "Returns a structured variance decomposition for the specified entity and period or period range. All figures are precomputed. The LLM generates narrative from this structure — it must not introduce any numbers not present in this response.",
  "inputSchema": {
    "json": {
      "type": "object",
      "properties": {
        "dataset_id": {"type": "string"},
        "entity_level": {
          "type": "string",
          "enum": ["total","department","category","fund_source"]
        },
        "entity_name": {"type": "string"},
        "fiscal_year": {"type": "string", "description": "Optional; omit for all years"},
        "fiscal_quarter": {"type": "string", "description": "Optional"},
        "period_index_from": {"type": "integer"},
        "period_index_to":   {"type": "integer"}
      },
      "required": ["dataset_id", "entity_level"]
    }
  }
}
```

**Pydantic models:**
```python
class VarianceContributor(BaseModel):
    entity_type: str           # "department" or "category"
    entity_name: str
    variance_usd: float
    variance_pct_agg: float
    share_of_total_variance: float   # 0.0–1.0

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
    period_description: str        # e.g. "FY2024–FY2026 (all)"
    total_variance_usd: float
    total_variance_pct: float
    top_department_contributors: list[VarianceContributor]   # top 5
    top_category_contributors: list[VarianceContributor]     # top 5
    top_record_contributors: list[RecordContributor]         # top 10
    persistent_pattern_share: float   # 0.0–1.0
    one_time_outlier_share: float
    fund_source_split: list[FundSourceSplit]
    dq_warnings: list[str]
    quarterly_time_series: list[dict]  # [{period_index, fiscal_year, fiscal_quarter, actual, budget, variance_pct_agg}]
```

**Error handling:** Same as `query_actuals` — entity not found returns empty result with `entity_not_found: true`.

### Tool 7: `get_reporting_health`

**Purpose:** Returns process health statistics. Every response includes a mandatory `descriptive_note` (R2B-02).

**JSON Schema:**
```json
{
  "name": "get_reporting_health",
  "description": "Returns reporting process health statistics (spreadsheet versions, manual adjustments, data entry errors, days to produce, approval cycles). DESCRIPTIVE ONLY — do not imply causal relationships to budget variance.",
  "inputSchema": {
    "json": {
      "type": "object",
      "properties": {
        "dataset_id": {"type": "string"},
        "grouping": {
          "type": "string",
          "enum": ["total", "department", "report_type", "report_status"],
          "description": "Dimension to group statistics by"
        },
        "entity_name": {
          "type": "string",
          "description": "Filter to a specific entity within the grouping. Omit for all."
        }
      },
      "required": ["dataset_id", "grouping"]
    }
  }
}
```

**Pydantic models:**
```python
class ProcessHealthRow(BaseModel):
    group_value: str | None        # NULL for "total" grouping
    avg_spreadsheet_versions: float
    avg_manual_adjustments: float
    avg_data_entry_errors: float
    avg_days_to_produce: float
    avg_approval_cycles: float
    pct_with_errors: float         # 0.0–1.0
    pct_delayed: float             # 0.0–1.0
    row_count: int

class GetReportingHealthRequest(BaseModel):
    dataset_id: str
    grouping: Literal["total","department","report_type","report_status"]
    entity_name: str | None = None

class GetReportingHealthResponse(BaseModel):
    grouping: str
    rows: list[ProcessHealthRow]
    descriptive_note: str = (
        "These statistics describe observed reporting process characteristics. "
        "No causal relationship between process metrics and budget variance is "
        "implied or supported by this data."
    )
    dq_note: str | None  # Populated if process columns were flagged as absent/partial
```

**Error handling:** If reporting-process columns were not mapped during ingestion, the tool returns an empty `rows` list and sets `dq_note = "Reporting-process columns were not mapped for this dataset. Process health view is unavailable."` rather than raising an exception.

---

## 7. Grounding Check (R5-07 + SYS-01)

### 7.1 Algorithm

The grounding check runs after the agent loop produces its final assistant text, before the SSE stream closes. It is a post-generation extraction and verification step.

**Step 1 — Extract numeric values from the LLM response text:**

```python
import re

NUMERIC_PATTERNS = [
    r'\$\s*[\d,]+(?:\.\d+)?\s*[KMBkmb]',     # abbreviated: $1.2M, $108K
    r'\$\s*[\d,]+(?:\.\d+)?',                  # bare dollar: $108,693 or $108693
    r'[\d,]+(?:\.\d+)?\s*%',                   # percentage: 13.5%, 14.8%
    r'\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b',      # bare integers and decimals (non-dollar)
    r'FY20\d\d\s+Q[1-4]',                      # fiscal period references
]

def extract_numerics(text: str) -> list[dict]:
    """Returns [{raw_str, numeric_type, normalized_float, context_snippet}]
    numeric_type is one of: 'bare_dollar', 'abbreviated_dollar', 'percentage',
    'bare_integer', 'fiscal_period'
    """
    ...
```

**Step 2 — Build a lookup from tool results produced in the same turn:**

The agent loop accumulates all tool results in a `turn_evidence` list. After each tool call, the result's numeric fields are indexed. A "same turn" result means it was produced during this specific invocation of the agent loop; results from prior conversation turns are not used for grounding.

**Step 3 — Tolerance rules by numeric format:**

Every extracted numeric is matched against the turn evidence using the following tolerance table. The implementer must follow this table exactly — no other rules are permitted.

| Format | Example | Match condition |
|---|---|---|
| Bare dollar `$N,NNN[.NN]` or `$NNNNNN` | `$108,693` | Exact ± $1 (rounding only) |
| Abbreviated dollar `$N.NM` | `$1.2M` | value ÷ 1,000,000 rounds to stated decimal; match range [1,150,000, 1,249,999] |
| Abbreviated dollar `$NNNK` | `$108K` | value ÷ 1,000 rounds to stated integer; match range [107,500, 108,499] |
| Percentage `N.N%` | `13.5%` | ± 0.05 percentage points |
| Bare integer count | `17` | Exact match only |
| Fiscal period string | `FY2024 Q3` | Literal string match |

A numeric passes if it matches at least one field in any tool result from the same turn. A numeric fails if no tool result contains a value within the stated tolerance for its format.

**Step 4 — Failure behavior:**

If any extracted numeric fails, the response is flagged. The backend emits a `grounding_flag` SSE event (the LLM response text is still sent to the user, but the flag is visible). The event payload:

```json
{
  "type": "grounding_flag",
  "failed_values": ["$204,000"],
  "message": "1 numeric value(s) in this response could not be traced to tool results from this turn."
}
```

The flag is displayed in the frontend as a visible yellow warning banner above the chat bubble. The event is logged to the backend application log **without the numeric values** (SYS-03 compliance): `logger.warning("grounding_flag: %d value(s) unverified in turn %s", count, turn_id)`.

### 7.2 Fabricated Number Test Harness (AC6)

```python
def test_grounding_flag_triggers(mock_tool_results: list[dict]):
    """
    Inject a known-fabricated number ($204,000) that does not appear
    in any tool result. Assert the grounding flag is raised.
    """
    mock_tool_results = [
        {"tool": "query_actuals", "rows": [{"total_actual": 108693.0, "total_budget": 804131.0}]}
    ]
    response_text = (
        "College of Architecture is over budget by $204,000, which represents a 13.5% overrun."
    )
    flags = run_grounding_check(response_text, mock_tool_results)
    assert "$204,000" in flags["failed_values"]
    assert len(flags["failed_values"]) == 1  # $204,000 fails; 13.5% passes (13.52% rounds to 13.5%)

def test_grounding_exact_dollar_boundary():
    """
    Bare dollar tolerance is exactly ±$1. $108,694 (one dollar over) must NOT
    trigger a flag; $109,000 ($307 over) must trigger a flag.
    """
    tool_results = [
        {"tool": "query_actuals", "rows": [{"variance_usd": 108693.0}]}
    ]
    # $108,694 — within ±$1 — should pass
    flags_close = run_grounding_check("The overrun was $108,694.", tool_results)
    assert len(flags_close.get("failed_values", [])) == 0

    # $109,000 — $307 over — should fail
    flags_far = run_grounding_check("The overrun was $109,000.", tool_results)
    assert "$109,000" in flags_far["failed_values"]
```

---

## 8. SSE Streaming

### 8.1 Endpoint Design

`POST /chat` returns `StreamingResponse(media_type="text/event-stream")`. The request body is `ChatRequest`:

```python
class ChatRequest(BaseModel):
    session_id: str
    dataset_id: str
    message: str
    replay_mode: bool = False
```

Each SSE line is a JSON-encoded event on a `data:` field, followed by a blank line:

```
data: {"type":"token","text":"College"}\n\n
data: {"type":"token","text":" of"}\n\n
data: {"type":"tool_call","tool":"query_actuals","input":{"entity_level":"department"}}\n\n
data: {"type":"tool_result","tool":"query_actuals","summary":"16 departments returned"}\n\n
data: {"type":"token","text":" Architecture"}\n\n
data: {"type":"grounding_ok"}\n\n
data: {"type":"sources","calls":[{"tool":"query_actuals","input":{...},"result_summary":"..."}]}\n\n
data: [DONE]\n\n
```

### 8.2 Partial Token Streaming to React Frontend

The React frontend opens the SSE connection with `EventSource` (for GET) or a `fetch` + `ReadableStream` consumer (for POST, since `EventSource` does not support POST). The chosen implementation is `fetch` + `ReadableStream.getReader()` which handles POST correctly.

```typescript
async function* streamChat(request: ChatRequest): AsyncGenerator<SSEEvent> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        yield JSON.parse(line.slice(6)) as SSEEvent;
      }
    }
  }
}
```

Tokens accumulate in a React state variable and are appended to the chat bubble as they arrive. The sources panel (rendered below the chat bubble) populates incrementally: each `tool_result` event adds an entry to the sources list. Grounding flags appear as banners when the `grounding_flag` event arrives. The sources panel is collapsed by default and expandable per R5-04.

### 8.3 Bedrock Converse API Integration

The backend uses `boto3` with `bedrock-runtime` client. Model ID is read from `BEDROCK_MODEL_ID` environment variable (no default in code). The `converse_stream` call is made with:

```python
response = bedrock.converse_stream(
    modelId=os.environ["BEDROCK_MODEL_ID"],
    system=[{"text": SYSTEM_PROMPT}],
    messages=conversation_history,
    toolConfig={"tools": TOOL_SCHEMAS},
    inferenceConfig={"maxTokens": 2048, "temperature": 0.0},
)
```

`temperature=0.0` is fixed for deterministic numeric narration. Timeout is 30 seconds per API call (configured via `BEDROCK_TIMEOUT_SECONDS`, default 30). Retries: 3 attempts with exponential backoff (1s, 2s, 4s) on `ThrottlingException` and `ServiceUnavailableException`. On exhaustion, the backend emits `data: {"type":"error","message":"Bedrock API unavailable after retries. Please try again."}` and closes the stream.

---

## 9. Replay Mode (R6)

### 9.1 Environment Variable

`REPLAY_MODE=true` in the `.env` file activates replay mode. The backend checks `os.getenv("REPLAY_MODE", "false").lower() == "true"` at startup and sets a module-level `REPLAY_ACTIVE` flag.

### 9.2 Pre-Recorded Traces

Seven replay trace files are stored at `backend/replay/` as JSON:

```
backend/replay/
  prompt_01_over_budget_depts.json
  prompt_02_consulting_contracts.json
  prompt_03_underspending.json
  prompt_04_fy2027_forecast.json
  prompt_05_outlier_records.json
  prompt_06_process_health.json
  prompt_07_bursar_insufficient.json
```

Each file contains:
```json
{
  "prompt": "Which departments are furthest over budget, and by how much?",
  "tool_calls": [
    {
      "tool": "query_actuals",
      "input": {"dataset_id": "sample", "entity_level": "department"},
      "result": {"rows": [...]}
    }
  ],
  "assistant_text": "The three departments furthest over budget are...",
  "grounding_check": "pass"
}
```

**Tool-sequence specification for each replay trace:**

The following table is authoritative for trace construction. When creating the JSON trace files, the `tool_calls` array must include exactly the tools listed (in the order shown). Dollar figures cited in `assistant_text` must trace to a field in one of the listed tool results; no figures may appear in `assistant_text` that are not present in `tool_calls[*].result`.

| Prompt | Expected tool sequence | Key grounding anchors in assistant_text |
|---|---|---|
| 01 — Over-budget departments | `query_actuals(entity_level=department)` | variance_pct_agg for Architecture (+13.52%), Pharmacy (+10.06%), Office of Research (+7.92%); variance_usd for each |
| 02 — Consulting & Contracts | `explain_variance(entity_level=category, entity_name="Consulting & Contracts")`, then `detect_anomalies(entity_level=category, entity_name="Consulting & Contracts")` | per-year variance from `quarterly_time_series` (+16.1%, +13.9%, +14.7%); Office of Research contributor from `top_department_contributors`; persistent_pattern_share; note: **`compare_periods` is NOT expected in this trace** — all year-over-year figures come from `explain_variance.quarterly_time_series` |
| 03 — Underspending categories | `detect_anomalies(entity_level=category)` | persistent_patterns list; qualifying years and per_year_variance for Travel & Conferences, Professional Development, Administrative Overhead, Research Operations |
| 04 — FY2027 forecast | `run_forecast(entity_level=total, horizon=4)` | ratio_forecast, dollar_forecast, dollar_pi_80_low, dollar_pi_80_high, dollar_pi_95_low, dollar_pi_95_high, confidence_label, model_name, cv_mae, planned_budget_total |
| 05 — Outlier records | `detect_anomalies(entity_level=total)` | record_ids from `anomalies` list (all 17 ground-truth rows must appear); z_score, variance_pct for each; confusion_matrix.fn count |
| 06 — Process health | `get_reporting_health(grouping=total)`, then `get_reporting_health(grouping=department)` | avg_days_to_produce, avg_data_entry_errors, pct_with_errors, avg_manual_adjustments, avg_spreadsheet_versions (total level only for scalar citations) |
| 07 — Bursar (insufficient data) | `list_entities()` | departments list (the 16 department names); no dollar figures cited; response must match "insufficient-data" pattern |

This table is the specification contract for the coder who creates the replay trace files. The `BEDROCK_MODEL_ID` used to generate live traces must match the `.env.example` default value; if a different model is used, the traces must be re-recorded.

### 9.3 Serving Without Bedrock Credentials

When `REPLAY_ACTIVE=True`, the agent loop is bypassed. The endpoint matches the incoming user message against the seven pre-recorded prompts using **fuzzy matching** (difflib `SequenceMatcher` ratio ≥ 0.85, case-insensitive, stripped). The best-matching prompt above the threshold is selected. If no prompt scores ≥ 0.85, the endpoint returns a structured error event: `"Replay mode is active. This prompt is not in the scripted demo path."`.

On a match, the matched prompt name is emitted as an SSE event before the response begins:
```json
{"type": "tool_result", "tool": "replay", "summary": "Matched prompt_01 (similarity 0.91)"}
```

Then the pre-recorded `tool_calls` and `assistant_text` are replayed as SSE events in the same format as a live response.

When `REPLAY_ACTIVE=True`, `BEDROCK_MODEL_ID` and AWS credentials are not required and are not validated at startup. The `boto3` client is not instantiated.

**Fuzzy-match test:**

```python
@pytest.mark.parametrize("user_input,expected_trace", [
    # Exact canonical prompt
    ("Which departments are furthest over budget, and by how much?", "prompt_01"),
    # Lowercase with added period — must still match
    ("what did the bursar's office spend on travel?", "prompt_07"),
    # Capital O variant
    ("What did the Bursar's Office spend on travel?", "prompt_07"),
    # Clearly different prompt — must NOT match any trace
    ("What is the weather today?", None),
])
def test_replay_fuzzy_match(user_input, expected_trace, replay_loader):
    match = replay_loader.find_best_match(user_input)
    if expected_trace is None:
        assert match is None
    else:
        assert match["trace_name"] == expected_trace
        assert match["similarity"] >= 0.85
```

### 9.4 Grounding Check on Replay

Replayed responses run the same grounding check as live responses, verifying each numeric in the pre-recorded `assistant_text` against the pre-recorded `tool_calls` results. All seven replay traces must pass the grounding check. This is asserted in pytest:

```python
@pytest.mark.parametrize("trace_file", REPLAY_TRACE_FILES)
def test_replay_passes_grounding(trace_file: str):
    trace = load_trace(trace_file)
    flags = run_grounding_check(trace["assistant_text"], trace["tool_calls"])
    assert len(flags.get("failed_values", [])) == 0, (
        f"Grounding failed for {trace_file}: {flags}"
    )
```

---

## 10. Data Quality Surfacing

### 10.1 BUD-00018 in Variance Analysis UI

Whenever `query_actuals` or `explain_variance` returns results that include record BUD-00018 (directly or as a contributor to an aggregate), the `dq_warnings` list in the response includes the string: `"BUD-00018: variance_usd=$0.00 but variance_pct=−2.1 (inconsistent). This record is carried as-is."`.

The frontend renders this warning as an amber inline callout within the results panel, not as a dismissible toast. The callout includes the `record_id` so the user can trace it to the anomaly table.

The DQ check is implemented as a post-query Python step (not in SQL) that inspects the returned `record_id` values:

```python
DQ_RECORDS = {
    "BUD-00018": "variance_usd=$0.00 but variance_pct=−2.1 (inconsistent). Carried as-is."
}

def attach_dq_warnings(record_ids: list[str]) -> list[str]:
    return [DQ_RECORDS[rid] for rid in record_ids if rid in DQ_RECORDS]
```

### 10.2 Source Forecast Post-Hoc Caveat in Benchmark Panel

The benchmark panel in the dashboard (R3-10) always displays a caveat, with the text computed dynamically from the DQ query in section 2.6(b) at display time. The same logic applies to both the sample dataset and any other uploaded dataset:

- If `mean_gap < 5%`: display `"Note: The source forecast (forecasted_amount_usd) shows a mean absolute gap of {mean_gap:.1f}% (max {max_gap:.2f}%) versus actuals. This is unusually close and may indicate post-hoc adjustment. The source forecast was not used as a model input."`
- If `mean_gap ≥ 5%`: display `"Source forecast accuracy: {mean_gap:.1f}% mean absolute gap versus actuals (max {max_gap:.2f}%). Treat as an upper-bound reference only. The source forecast was not used as a model input."`

For `Team6Dataset.xlsx` the values will be `mean_gap = 4.1%` and `max_gap = 14.46%`, matching the confirmed profiling figures. Other datasets receive their own computed values. No static text containing "4.1%" or "14.5%" appears in code; all figures come from the DuckDB query.

---

## 11. Non-Functional Requirements

### 11.1 docker-compose Structure

```yaml
# docker-compose.yml
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    volumes:
      - duckdb_data:/data/dbs
      - ./data:/app/data:ro        # sample dataset read-only
    env_file: .env
    environment:
      - DUCKDB_DATA_DIR=/data/dbs
    depends_on: []

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - VITE_API_BASE_URL=http://localhost:8000
    depends_on:
      - backend

volumes:
  duckdb_data:
```

The `.env.example` committed to the repository:
```
BEDROCK_MODEL_ID=us.anthropic.claude-3-5-sonnet-20241022-v2:0
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=us-east-1
REPLAY_MODE=false
BEDROCK_TIMEOUT_SECONDS=30
ANOMALY_SENSITIVITY=2.5
FORECAST_HORIZON=4
FORECAST_MAE_HIGH=0.05
FORECAST_MAE_LOW=0.15
FORECAST_SMAPE_HIGH=10.0
FORECAST_SMAPE_LOW=30.0
FORECAST_PI_WIDTH_MEDIUM=0.3
KPI_TOP_N=5
```

No secrets appear in source code. All secrets are read from environment variables at runtime.

### 11.2 README Sections

The README must contain four required sections:

1. **Run Instructions** — prerequisites, `cp .env.example .env`, credential setup, `docker-compose up`, browser URL.
2. **Architecture Diagram** — ASCII or Mermaid diagram of the two-service layout with Bedrock.
3. **How Grounding Works** — a plain-English explanation of the post-generation numeric extraction and verification loop, including what the visible flag means and the tolerance rules that apply to each number format.
4. **Data Caveats** — summarises all six DQ findings from section 2.6, including BUD-00018, the source forecast post-hoc caveat, duplicate natural keys, sign inconsistency, ±50 cap.

### 11.3 Test Fixture (~60 rows)

The fixture at `tests/fixtures/test_dataset.xlsx` (and `test_dataset.csv` equivalent) must cover:
- All 16 departments (at least one row each)
- All 10 categories (at least one row each)
- All 6 fund sources (at least one row each)
- Record BUD-00018 (exact record; used to test DQ warning)
- At least one duplicate natural key pair (same dept+category+year+quarter, different fund_source)
- At least 2 rows at `variance_pct = −50` (tests the cap check)
- Rows spanning at least 3 fiscal years and 4 quarters for time-series tests

Pytest tests that require specific entity coverage use the fixture. Only reconciliation tests use `data/Team6Dataset.xlsx`.

### 11.4 Reconciliation Test Assertions (NFR-05)

```python
@pytest.fixture(scope="session")
def full_df():
    return load_dataset("data/Team6Dataset.xlsx")  # via ingestion pipeline

def test_row_count(full_df): assert len(full_df) == 300
def test_dimensions(full_df):
    assert full_df["department"].nunique() == 16
    assert full_df["category"].nunique() == 10
    assert full_df["fund_source"].nunique() == 6

def test_forecast_accuracy_pct_mean(full_df):
    mean_val = full_df["forecast_accuracy_pct"].mean()
    assert abs(mean_val - 95.91) < 0.05  # ±0.05 ppt tolerance

@pytest.mark.parametrize("fy,expected_pct", [
    ("FY2024", -1.0),
    ("FY2025", -2.6),
    ("FY2026", -3.1),
])
def test_fy_variance(full_df, fy, expected_pct):
    sub = full_df[full_df["fiscal_year"] == fy]
    actual_pct = (sub["actual"].sum() / sub["budget"].sum() - 1) * 100
    assert abs(actual_pct - expected_pct) < 0.1  # ±0.1 ppt tolerance

@pytest.mark.parametrize("cat,expected_pct", [
    ("Consulting & Contracts", 14.8),
    ("Travel & Conferences",  -14.8),
    ("Professional Development", -12.6),
    ("Administrative Overhead", -10.4),
    ("Research Operations",  -8.9),
    ("Facility Maintenance", -5.2),
    ("Supplies & Materials",  3.6),
    ("Personnel & Salaries",  3.4),
    ("Student Aid & Scholarships", 2.3),
    ("Equipment & Technology", 5.5),
])
def test_category_variance(full_df, cat, expected_pct):
    sub = full_df[full_df["category"] == cat]
    actual_pct = (sub["actual"].sum() / sub["budget"].sum() - 1) * 100
    assert abs(actual_pct - expected_pct) < 0.2  # ±0.2 ppt tolerance

@pytest.mark.parametrize("dept,expected_pct", [
    ("College of Architecture", 13.5),
    ("College of Pharmacy", 10.1),
    ("Office of Research", 7.9),
    ("College of Education", -10.9),
    ("School of Public Health", -10.8),
    ("College of Nursing", -9.8),
])
def test_department_variance(full_df, dept, expected_pct):
    sub = full_df[full_df["department"] == dept]
    actual_pct = (sub["actual"].sum() / sub["budget"].sum() - 1) * 100
    assert abs(actual_pct - expected_pct) < 0.2
```

---

## 12. Accessibility (NFR-07)

### 12.1 Recharts ARIA Labels

All Recharts components must have explicit ARIA attributes. Since Recharts renders SVG, the following pattern is applied to every chart:

```tsx
<LineChart
  data={data}
  role="img"
  aria-label={`Quarterly spend-vs-budget trend for ${entityName}. Data spans ${startPeriod} to ${endPeriod}.`}
>
  <title id={`chart-title-${id}`}>{`${entityName} trend chart`}</title>
  <desc id={`chart-desc-${id}`}>
    {`Line chart showing actual spend versus budget for ${entityName} across ${data.length} quarters.`}
  </desc>
  ...
</LineChart>
```

A data table (`<table>` with `<caption>` and `<th scope>` headers) is rendered below each chart as a visually hidden but screen-reader-accessible alternative representation of the chart data:

```tsx
<table className="sr-only" aria-label={`Data table: ${entityName} trend`}>
  <caption>{`${entityName} quarterly actual vs budget`}</caption>
  <thead>
    <tr>
      <th scope="col">Period</th>
      <th scope="col">Actual ($)</th>
      <th scope="col">Budget ($)</th>
      <th scope="col">Variance (%)</th>
    </tr>
  </thead>
  <tbody>
    {data.map(row => <tr key={row.period_index}>...</tr>)}
  </tbody>
</table>
```

### 12.2 Keyboard Navigation

**Chat interface:**
- The message input field receives focus automatically when the page loads (`autoFocus`).
- Submit on `Enter`; newline on `Shift+Enter`.
- The sources panel toggle button is keyboard-focusable and activates on `Enter` and `Space`.
- `Tab` order: message input → submit button → sources panel toggle → source items.

**Anomaly table:**
- The anomaly table is a standard HTML `<table>` with `<th scope="col">` headers.
- Sortable column headers are `<button>` elements within `<th>`, focusable and activatable with keyboard.
- Row drill-down is triggered by `Enter` on a focused row (using `tabIndex={0}` and `onKeyDown` on `<tr>`).
- A skip link (`<a href="#anomaly-table">Skip to anomaly table</a>`) is provided at the top of the page, visible on focus.

**Dataset selector:**
- Implemented as a native `<select>` element for maximum screen-reader compatibility. No custom dropdown.

### 12.3 Color Contrast (WCAG 2.1 AA)

- Minimum contrast ratio 4.5:1 for normal text, 3:1 for large text and UI components.
- The grounding flag banner uses amber background `#FEF3C7` with dark text `#78350F` (contrast ratio ≈ 8.0:1).
- Anomaly severity: "high" = red `#DC2626` on white (contrast 5.9:1 ✓), "medium" = amber `#D97706` on white (3.3:1 — rendered as large/bold text to qualify under 3:1 for large text), "low" = gray `#6B7280` on white (4.6:1 ✓).
- Chart lines: a minimum of 4 visually distinct patterns are used (solid, dashed, dotted, dot-dashed) in addition to color, so the chart is interpretable in monochrome.
- DQ warning callout: amber `#92400E` text on `#FFFBEB` background (contrast ≈ 8.8:1 ✓).

> **Note:** Full WCAG 2.1 AA compliance requires manual testing with assistive technologies (NVDA, JAWS, VoiceOver) and accessibility expert review beyond automated checks.

---

## Appendix A: File Structure

```
aws-hackathon/
├── backend/
│   ├── main.py                    # FastAPI app entry point
│   ├── ingestion/
│   │   ├── pipeline.py            # Upload, mapping, validation, DuckDB load
│   │   └── schema.py              # Canonical schema mapping, period_index derivation
│   ├── analysis/
│   │   ├── anomaly.py             # detect_anomalies(), detect_persistent_patterns()
│   │   ├── variance.py            # explain_variance(), DuckDB query builders, build_variance_query()
│   │   ├── kpis.py                # KPI aggregation (shares build_variance_query() with variance.py)
│   │   └── health.py              # get_reporting_health()
│   ├── forecasting/
│   │   ├── models.py              # Naive, Drift, ETS, Linear Trend, Seasonal Naive
│   │   ├── cv.py                  # Rolling-origin cross-validation
│   │   └── forecast.py            # run_forecast(), confidence labeling, dollar conversion
│   ├── tools/
│   │   ├── definitions.py         # Pydantic models + JSON schemas for all 7 tools
│   │   └── dispatcher.py          # Tool name → function routing
│   ├── agent/
│   │   ├── loop.py                # Agent loop, Bedrock call, SSE emitter
│   │   ├── grounding.py           # Post-generation numeric extraction + verification (tolerance table)
│   │   └── prompts.py             # System prompt (includes DESCRIPTIVE ONLY text)
│   ├── replay/
│   │   ├── loader.py              # Replay mode handler; fuzzy-match prompt routing (SequenceMatcher ≥ 0.85)
│   │   ├── prompt_01_over_budget_depts.json
│   │   ├── prompt_02_consulting_contracts.json
│   │   ├── prompt_03_underspending.json
│   │   ├── prompt_04_fy2027_forecast.json
│   │   ├── prompt_05_outlier_records.json
│   │   ├── prompt_06_process_health.json
│   │   └── prompt_07_bursar_insufficient.json
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Chat.tsx           # SSE consumer, chat bubble, grounding flag banner
│   │   │   ├── Sources.tsx        # Expandable sources panel
│   │   │   ├── Dashboard.tsx      # KPIs, charts, anomaly table
│   │   │   ├── KpiPanel.tsx       # Top over/under departments + categories; calls GET /kpis
│   │   │   ├── AnomalyTable.tsx   # Accessible anomaly table with sort/drill-down
│   │   │   ├── TrendChart.tsx     # Recharts wrapper with ARIA + SR table
│   │   │   ├── Upload.tsx         # Upload UI and column mapping
│   │   │   └── BenchmarkPanel.tsx # Source forecast benchmark + dynamic caveat
│   │   ├── hooks/
│   │   │   └── useSSEChat.ts      # fetch + ReadableStream consumer
│   │   └── App.tsx
│   ├── Dockerfile
│   ├── vite.config.ts
│   └── package.json
├── data/
│   └── Team6Dataset.xlsx
├── tests/
│   ├── ground_truth.md            # (existing)
│   ├── fixtures/
│   │   ├── test_dataset.xlsx
│   │   └── test_dataset.csv
│   ├── test_ingestion.py
│   ├── test_anomaly.py
│   ├── test_forecasting.py
│   ├── test_tools.py
│   ├── test_grounding.py
│   ├── test_replay.py
│   └── test_reconciliation.py     # Full 300-row dataset; marked @pytest.mark.slow
├── docs/
│   ├── requirements.md            # (existing, APPROVED)
│   ├── design.md                  # (existing, profiling findings)
│   └── technical-design.md        # (this document)
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Appendix B: Edge Cases

**Unrecognised entity name in chat:** The `query_actuals` tool returns `entity_not_found: true`. The agent loop is instructed (in the system prompt) to call `list_entities` next and suggest the closest matching entity name to the user. This is the correct path for Prompt 7 ("Bursar's office"). The system must not guess or substitute.

**Division by zero in variance_pct_agg:** Any DuckDB query computing `SUM(actual) / SUM(budget)` where `SUM(budget) = 0` uses `NULLIF(SUM(budget), 0)` to produce NULL rather than a divide-by-zero error. The frontend renders NULL variance as "N/A".

**Entity with 0 quarters of history:** The `run_forecast` tool returns confidence "Low" and an empty `points` list, plus a note: "No history available for this entity."

**period_index NULL (unrecognised fiscal period):** Rows with NULL `period_index` are included in aggregate variance queries but excluded from time-series queries (via `WHERE period_index IS NOT NULL`) and forecasting. The validation report counts them.

**Replay mode + unknown prompt:** Returns a structured SSE error event. The frontend displays: "Replay mode is active. Only the seven scripted demo prompts are available."

**Bedrock returns stop reason = `max_tokens`:** The agent loop detects this, emits a visible warning: "Response was cut short (token limit reached).", and runs the grounding check on the partial text.

**Dataset deleted while a chat session is active:** On the next tool call, DuckDB returns "file not found". The tool handler catches this, returns HTTP 404, and the frontend shows: "The active dataset is no longer available. Please select another dataset."

**Dollar forecast unavailable (entity has no FY2026 budget rows):** `run_forecast` sets `dollar_forecast_available=False` and `dollar_unavailable_reason="No FY2026 budget data found for this entity."` All dollar fields in `ForecastPoint` are returned as `null`. The system prompt and grounding check key off `dollar_forecast_available: false` as the machine-readable suppression signal; the LLM reports only ratio figures and surfaces `dollar_unavailable_reason` to the user.

---

## Appendix C: Reviewer Findings Response Log

This section documents the design revision team's response to each finding from both the assumption-challenger report (`docs/assumption-challenger-findings.md`) and the mechanical design review (`docs/design-review.md`).

### Assumption-Challenger Findings (Revision 1 responses, carried forward)

| Finding | Severity | Resolution |
|---|---|---|
| FINDING-01: `period_index` DDL NOT NULL vs nullable | HIGH | RESOLVED in Rev 1. DDL changed to `INTEGER` (nullable). Derivation and Appendix B describe NULL for unmapped periods. Test `test_unmapped_period_row_accepted` added (§2.5). |
| FINDING-02: Grounding tolerance incomplete for bare dollar amounts | HIGH | RESOLVED in Rev 2. Full tolerance table added to §7.1 Step 3. Additional boundary-case tests added to §7.2. |
| FINDING-03: Dollar forecast missing from tool schema | HIGH | RESOLVED in Rev 1+2. Dollar fields added to `ForecastPoint` Pydantic model (§6 Tool 3) AND to `forecast_results` DDL (§5.7). `planned_budget_total` stored at forecast-time for consistent cached reads. |
| FINDING-04: Confidence label table truncated | HIGH | RESOLVED in Rev 1. Complete table with all rows and env var mappings in §5.5. |
| FINDING-05: Persistent pattern sign-consistency test missing | MEDIUM | RESOLVED in Rev 1. Sign-consistency and CLAS FY2025 exclusion tests added to §3.5. |
| FINDING-06: Replay mode exact-string match fragile | MEDIUM | RESOLVED in Rev 2. §9.3 now specifies fuzzy matching (SequenceMatcher ≥ 0.85). Fuzzy-match test added to §9.3. |
| FINDING-07: KPI aggregation endpoint/component unspecified | MEDIUM | RESOLVED in Rev 2. §3.7 added with full endpoint spec, DuckDB query, consistency invariant, and test assertion. `KpiPanel.tsx` listed in Appendix A. |
| FINDING-08: `compare_periods` not in any replay trace | MEDIUM | RESOLVED in Rev 2. §9.2 now specifies which tools each trace invokes and confirms that prompt 02 uses `explain_variance` + `detect_anomalies` only; `compare_periods` is not expected. |
| FINDING-09: `forecast_accuracy_pct` missing from DDL | MEDIUM | RESOLVED in Rev 1. Column added to both §2.4 canonical schema table and §2.5 DDL. Reconciliation test `test_forecast_accuracy_pct_mean` added to §11.4. |

### Mechanical Design Review Findings (Rev 2)

| Finding | Severity | Resolution |
|---|---|---|
| FINDING-R01: Bare dollar tolerance rule absent | HIGH | RESOLVED. Explicit tolerance table added to §7.1 Step 3. Boundary-case assertions added to §7.2 (`test_grounding_exact_dollar_boundary`). |
| FINDING-R02: Dollar forecast fields missing from `forecast_results` DDL | HIGH | RESOLVED. All five dollar fields plus `planned_budget_total` added to `forecast_results` DDL in §5.7. Note explaining `planned_budget_total` as FY2026 SUM(budget) denominator added to §5.2 and §5.7. |
| FINDING-R03: Replay mode exact-string match; AC8 fragile | MEDIUM | RESOLVED. §9.3 replaced exact-match with fuzzy match (SequenceMatcher ≥ 0.85). Matched trace name emitted as SSE event. Parametrized fuzzy-match test added. |
| FINDING-R04: KPI panel has no endpoint, query, or consistency guarantee | MEDIUM | RESOLVED. §3.7 added with full spec: endpoint `GET /kpis`, `KpiResponse` Pydantic model, DuckDB query using shared `build_variance_query()` helper, explicit "no separate cache" invariant, consistency test, `KPI_TOP_N` env var. |
| FINDING-R05: Replay trace tool-call contents unspecified | MEDIUM | RESOLVED. §9.2 expanded with tool-sequence table specifying expected tools, order, and grounding anchors for all seven prompts. |
| NIT-01: §5.8 vs §10.2 caveat text inconsistency | NIT | RESOLVED. §5.8 removed; caveat logic is now specified exclusively in §10.2 with fully dynamic text. No static "4.1%" or "14.5%" in code. |

### Design Review Findings (Rev 3)

| Finding | Severity | Resolution |
|---|---|---|
| FINDING-MR01: `ValidationReport` Pydantic model absent | HIGH | RESOLVED. `DQFinding` and `ValidationReport` classes added to §2.6 with all required fields (entity counts, fiscal period range, derived-column reconciliation counts, source-flag sign disagreements). |
| FINDING-MR02: `stl_note` dual-use for dollar unavailability | HIGH | RESOLVED. `dollar_forecast_available: bool` and `dollar_unavailable_reason: str | None` added to `RunForecastResponse` in §6 Tool 3. Appendix B updated to set these fields instead of overloading `stl_note`. System prompt and grounding check key off `dollar_forecast_available: false`. |
| FINDING-MR03: `anomaly_results` DDL missing | MEDIUM | RESOLVED. `CREATE TABLE IF NOT EXISTS anomaly_results` and `anomaly_run_summary` DDL added to §3.2. `KpiResponse.anomaly_count` comment updated to reference `detector_flag=1` rows by most recent `run_id`. |
| FINDING-MR04: Fiscal-year breakdown missing from `KpiResponse` | MEDIUM | RESOLVED. `FiscalYearSummary` model and `fiscal_year_summary: list[FiscalYearSummary]` field added to §3.7. Note added that the `GET /kpis` query always returns all fiscal years via a `GROUP BY fiscal_year` sub-query. |
| FINDING-MR05: Plain trend line fallback computation unspecified | MEDIUM | RESOLVED. Sentence added to §3.6 specifying that `TrendChart.tsx` renders raw data points connected by a line overlaid with a client-side OLS regression line from `quarterly_time_series`; no additional API call required. |
| FINDING-MR06: Derived-column reconciliation absent from §2.6 | MEDIUM | RESOLVED. Three SQL reconciliation queries (variance_usd, yoy_change_pct, forecast_accuracy_pct) added to §2.6 before the DQ findings list, labeled "R1-05 derived column reconciliation". |
| FINDING-MR07: `ColumnMappingProposal`/`ColumnMappingRequest` schemas undefined | MEDIUM | RESOLVED. Both Pydantic class definitions added to §2.3 with all fields specified. |
| FINDING-MR08: Abbreviated-dollar tolerance contradicts §7.1 in §6 Tool 3 | NIT | RESOLVED. Dollar field grounding note in §6 Tool 3 updated to distinguish bare-dollar (±$1) from abbreviated-dollar ($M/$K rounding rules per §7.1 Step 3 Table). |
| FINDING-MR09: Named entity rows in confidence label table | NIT | RESOLVED. Named rows for College of Liberal Arts & Sciences and Travel & Conferences removed from §5.5 table. Note added after the "< 8 quarters → Low" row explaining these are covered by the general rule; no hard-coded entity names in code. |

### Design Review Findings (Rev 4)

| Finding | Severity | Resolution |
|---|---|---|
| NEW-01: `anomaly_results` and `anomaly_run_summary` storage location unspecified | MEDIUM | RESOLVED. One sentence added to §3.2 immediately after the DDL block: both tables are stored within the dataset's own `.ddb` file at `/data/dbs/{dataset_id}.ddb`; the `dataset_id` column is retained for cross-validation queries and is always equal to the containing file's dataset UUID. |
| NEW-02: `source_flag_disagreement_count` comment described only FN, not FP+FN | MEDIUM | RESOLVED. Comment updated in §3.7 `KpiResponse` to read "count of rows where detector and source disagree (FP + FN from confusion matrix)". Note added to §3.7 stating that the `GET /kpis` endpoint computes `source_flag_disagreement_count` as `fp + fn` from `anomaly_run_summary` for the most recent `run_id` by `computed_at` for this `dataset_id`. |
| NEW-03: `QueryActualsResponse` referenced as providing `quarterly_time_series` in §3.6 but model lacks that field | MEDIUM | RESOLVED (Option B). The §3.6 sentence now reads "…from the `quarterly_time_series` array in the `explain_variance` response. No additional API call is required for the fallback trend line." The phrase "or `query_actuals`" was removed; `ExplainVarianceResponse` already contains `quarterly_time_series`. `QueryActualsResponse` was not modified. |
| NEW-04: Confidence label table had two overlapping rows for < 8 quarters and < 9 quarters | NIT | RESOLVED. Rows merged into a single row: "Entity has < 9 quarters of history (< 8: cannot model; 8 exactly: no CV folds) → Low". The note about CLAS and Travel & Conferences is retained on the merged row. |
| Field name mismatch: `rows_unmapped_period` vs `unmapped_periods` in §2.5 test | NIT | RESOLVED. Test assertion in §2.5 changed from `report.unmapped_periods` to `report.rows_unmapped_period` to match the `ValidationReport` Pydantic model field defined in §2.6. |

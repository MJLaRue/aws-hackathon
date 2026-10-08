# Assumption-Challenger Findings — Budget Forecasting Analyst
**Design reviewed:** `docs/technical-design.md` (Revision 2)
**Reference sources:** `docs/requirements.md`, `docs/design.md`, `tests/ground_truth.md`
**Reviewer role:** assumption-challenger (see `.kiro/agents/assumption-challenger.md`)
**Date:** 2026-10-08

---

## Summary

The technical design is substantively complete and resolves all findings documented in Appendix C (Revision 1 and mechanical review). The grounding infrastructure, forecast persistence, confidence label table, persistent-pattern detection, replay mode, and KPI panel are all specified. Nine issues were found in this pass. Two are HIGH: (1) the `ValidationReport` Pydantic model is never defined — R1-05 requires seven specific fields and the design describes the DQ checks in prose but never specifies the contract that the coder must implement; (2) the `stl_note` field is re-used for a semantically unrelated "dollar forecast unavailable" message, creating an LLM grounding path where the model could misread a dollar-unavailability note as an STL note and fail to suppress a dollar citation. Four MEDIUM findings cover: the `anomaly_results` table DDL being absent (the KPI panel depends on `anomaly_count` from it), R2-07 requiring "total actual vs budget variance by fiscal year" which is absent from `KpiResponse`, R2-05's requirement for a plain trend line where STL is unavailable (the design specifies the unavailability note but no fallback chart), and R1-05's requirement to include derived-column reconciliation counts in the validation report (the design checks the DQ columns for known issues but never re-verifies `variance_usd = actual − budget` row-by-row and reports the count of mismatches). Three NITs are also raised.

---

## Findings

### FINDING-01: `ValidationReport` Pydantic model is never defined

**Severity:** HIGH
**Section:** §2.6 (Validation Report)
**Observation:** R1-05 specifies seven mandatory fields for the validation report: total row count, count of rows accepted, count of rows flagged or rejected with reasons, fiscal period range found, entity counts (departments, categories, fund sources), derived-column reconciliation results, count of non-unique natural keys, and count of source anomaly flag vs variance sign disagreements. The design describes six DQ findings in prose (§2.6 a–f) but never defines the `ValidationReport` Pydantic model with typed fields. The test in §2.5 references `report.rejected_rows` and `report.unmapped_periods` on a `ValidationReport` instance, proving the class must exist, but without a field list two coders will produce different schemas and the API contract between ingestion and the frontend is unspecified.
**Risk:** The frontend has no typed contract for displaying the validation report. Fields required by R1-05 (entity counts, fiscal period range, derived-column reconciliation mismatch counts) may be omitted. AC9 ("bad period column → validation report, not crash") cannot be tested against a fixed schema.
**Recommendation:** Add a `class ValidationReport(BaseModel)` definition to §2.6 with at minimum these fields:
```python
class ValidationReport(BaseModel):
    total_rows: int
    rows_accepted: int
    rows_rejected: int
    rows_unmapped_period: int          # period_index = NULL
    fiscal_period_range: str           # e.g. "FY2024 Q1 – FY2026 Q4"
    department_count: int
    category_count: int
    fund_source_count: int
    derived_col_mismatches: int        # rows where recomputed variance_usd ≠ stored, etc.
    duplicate_key_combos: int
    duplicate_key_rows: int
    source_flag_sign_disagreements: int  # Overrun with negative + Underspend with positive
    dq_findings: list[DQFinding]       # one entry per R1-06 condition triggered
```

---

### FINDING-02: `stl_note` field re-used for semantically unrelated "dollar forecast unavailable" message

**Severity:** HIGH
**Section:** Appendix B ("Dollar forecast unavailable" edge case) and §6 Tool 3 (`RunForecastResponse`)
**Observation:** `RunForecastResponse` defines `stl_note: str | None` with the comment `# e.g. "STL unavailable: 7 quarters of data (minimum 8 required)"`. Appendix B states: "run_forecast returns all dollar fields as null and sets `stl_note` to include: 'Dollar forecast unavailable: no FY2026 budget data found…'". Two semantically independent failure modes — STL unavailability and missing budget denominator — are packed into the same nullable string field. The system prompt instructs the LLM to suppress dollar citations when `dollar_forecast` is null, but this instruction relies on the LLM correctly interpreting the `stl_note` string rather than on a structured boolean or separate field.
**Risk:** If `stl_note` contains a dollar-unavailability message while `dollar_forecast` is null, and the LLM also needs to cite the STL unavailability reason, both reasons must be concatenated into one string with no structured separator. The LLM has no machine-readable signal that dollar fields are unavailable; it must parse the `stl_note` string. A slight prompt variation could cause the LLM to still attempt a dollar figure, producing a SYS-01 violation (fabricated dollar amount not traceable to a tool result).
**Recommendation:** Add a separate boolean field to `RunForecastResponse`:
```python
dollar_forecast_available: bool   # False when no FY2026 budget denominator exists
dollar_unavailable_reason: str | None  # populated when dollar_forecast_available=False
```
Keep `stl_note` exclusively for STL. The system prompt and the grounding check should key off `dollar_forecast_available: false` to block all dollar citations structurally, not by string-parsing.

---

### FINDING-03: `anomaly_results` DuckDB table DDL is never specified

**Severity:** MEDIUM
**Section:** §3.2, §3.7 (`KpiResponse.anomaly_count`)
**Observation:** §3.2 states "its outputs are stored in DuckDB table `anomaly_results`." §3.7 specifies `anomaly_count: int` in `KpiResponse` with the comment "count from most recent detect_anomalies run (stored in anomaly_results)." No `CREATE TABLE anomaly_results` statement appears anywhere in the design. The schema — primary key, columns for `record_id`, `dataset_id`, `sensitivity_used`, `computed_at`, `detector_flag`, `confusion_matrix_*` — is fully unspecified.
**Risk:** Two coders writing `anomaly.py` and `kpis.py` independently will produce incompatible table layouts. The `GET /kpis` endpoint will fail at the JOIN or SELECT against `anomaly_results` without knowing its schema.
**Recommendation:** Add a `CREATE TABLE IF NOT EXISTS anomaly_results` DDL block to §3.2 (alongside the algorithm), at minimum:
```sql
CREATE TABLE IF NOT EXISTS anomaly_results (
    run_id         VARCHAR PRIMARY KEY,  -- UUID
    dataset_id     VARCHAR NOT NULL,
    record_id      VARCHAR NOT NULL,
    detector_flag  INTEGER NOT NULL,     -- 1 = flagged
    z_score        DOUBLE,
    peer_group     VARCHAR,
    sensitivity    DOUBLE NOT NULL,
    computed_at    TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS anomaly_run_summary (
    run_id     VARCHAR PRIMARY KEY,
    dataset_id VARCHAR NOT NULL,
    sensitivity DOUBLE NOT NULL,
    tp INTEGER, fp INTEGER, fn INTEGER, tn INTEGER,
    computed_at TIMESTAMP NOT NULL
);
```
`KpiResponse.anomaly_count` should document which `run_id` (e.g., most recent by `computed_at` for the given `dataset_id`) it reads from.

---

### FINDING-04: R2-07 "total actual vs budget variance by fiscal year" is absent from `KpiResponse`

**Severity:** MEDIUM
**Section:** §3.7 (`KpiResponse` Pydantic model), R2-07
**Observation:** R2-07 requires the KPI panel to display "total actual vs budget variance (dollar and percent, **by fiscal year**)." The `KpiResponse` model in §3.7 contains `total_actual`, `total_budget`, and `total_variance_pct` at the overall level, and `fiscal_year_filter` (an optional single-year filter). There is no `by_fiscal_year` breakdown field — no list of `{fiscal_year, total_actual, total_budget, variance_usd, variance_pct}` rows. The design's endpoint supports filtering to a single fiscal year, not returning all three years in one response.
**Risk:** The KPI panel cannot display the FY2024 (−1.0%), FY2025 (−2.6%), FY2026 (−3.1%) row confirmed by profiling without making three separate `GET /kpis` calls, which is not specified anywhere. Demo prompt 4 ("how confident are you?") implicitly relies on trend-context from a three-year variance summary; a UI missing this context weakens the demo.
**Recommendation:** Add a `fiscal_year_summary` field to `KpiResponse`:
```python
class FiscalYearSummary(BaseModel):
    fiscal_year: str
    total_actual: float
    total_budget: float
    variance_usd: float
    variance_pct: float

class KpiResponse(BaseModel):
    ...
    fiscal_year_summary: list[FiscalYearSummary]  # always returns all available fiscal years
```
The `GET /kpis` DuckDB query should always include a `GROUP BY fiscal_year` sub-query returning the three-year summary regardless of the `fiscal_year` filter.

---

### FINDING-05: R2-05 plain trend line for STL-ineligible entities is unspecified in the design

**Severity:** MEDIUM
**Section:** §3.6 (STL Decomposition Gating), R2-05
**Observation:** R2-05 states: "Where fewer than 8 quarters are available, only a plain trend line **shall** be shown, with a visible note explaining why STL is not available." The design specifies the unavailability note (§3.6) and that the note "must not be dismissible," but it never specifies what "plain trend line" means computationally or how `TrendChart.tsx` renders it. For Travel & Conferences (7 quarters) and College of Liberal Arts & Sciences (6 quarters), the chart must still draw something — a trend line — but the design gives no specification: is it an OLS regression line? A moving average? A simple line connecting quarterly data points?
**Risk:** The coder will invent a method. If they use a method that requires model output (e.g., calling `run_forecast` and plotting the model's trend component), they introduce an implicit dependency between the chart and the forecast. If they use raw data points, that is technically also "a line" but does not satisfy "trend line" semantically.
**Recommendation:** Add one sentence to §3.6 specifying the fallback: "For entities ineligible for STL, `TrendChart.tsx` renders the raw quarterly spend-vs-budget ratio points connected by a line, with an OLS regression overlay (computed by the frontend from the `quarterly_time_series` array returned by `query_actuals` or `explain_variance`). No separate API call is required."

---

### FINDING-06: R1-05 derived-column reconciliation results are not surfaced in the validation report

**Severity:** MEDIUM
**Section:** §2.6 (Validation Report), R1-05
**Observation:** R1-05 requires the validation report to include "derived-column reconciliation results (variance_usd = actual − budget, yoy_change_pct = actual / prior_year − 1, forecast_accuracy_pct = 100 − |forecast − actual| / actual × 100)." The design's six DQ findings in §2.6 cover BUD-00018 as a special case (variance_usd=0 but variance_pct≠0), but they never specify a row-by-row recomputation of `variance_usd`, `yoy_change_pct`, and `forecast_accuracy_pct` against their constituent fields and a count of mismatches. The BUD-00018 query catches the single known anomaly but does not satisfy the general requirement.
**Risk:** A different uploaded dataset with systematic derivation errors (e.g., `variance_usd` computed as budget − actual rather than actual − budget) will pass ingestion without any warning. This violates R1-05 and AC9.
**Recommendation:** Add three reconciliation queries to §2.6 before the DQ findings, returning mismatch counts:
```sql
-- R1-05 derived column reconciliation
SELECT COUNT(*) AS variance_usd_mismatches
FROM budget_records
WHERE ABS((actual - budget) - source_variance) > 0.01;

SELECT COUNT(*) AS yoy_mismatches
FROM budget_records
WHERE prior_year_actual IS NOT NULL AND prior_year_actual != 0
  AND ABS((actual / prior_year_actual - 1) * 100 - yoy_change_pct) > 0.05;

SELECT COUNT(*) AS forecast_accuracy_mismatches
FROM budget_records
WHERE source_forecast IS NOT NULL AND actual != 0
  AND ABS((100 - ABS(source_forecast - actual) / actual * 100) - forecast_accuracy_pct) > 0.05;
```
Report these counts in `ValidationReport.derived_col_mismatches` (or three separate fields). On the sample dataset all three return 0; on a foreign dataset they may not.

---

### FINDING-07: Confidence label table has a redundant/overlapping row that creates an ambiguous match

**Severity:** NIT
**Section:** §5.5 (Confidence Label Logic)
**Observation:** The confidence label decision table has two rows that fire for the same condition: "Entity has < 8 quarters of history → Low" (row 1) and "< 9 quarters (no CV folds possible) → Low" (row 3). Since "< 9 quarters" is a superset of "has history but < 9 quarters," these overlap. The table also separately names College of Liberal Arts & Sciences (6 quarters) and Travel & Conferences (7 quarters) as named rows rather than deriving them from the general < 8-quarter rule. This is not incorrect but could cause a coder to implement the named rows as special-cases rather than as derivations of the general rule, leading to brittleness if more short-series entities appear.
**Recommendation:** Collapse rows 1 and 3 into: "Entity has < 9 quarters of history (insufficient for any CV fold) → Low." Add a note: "This includes College of Liberal Arts & Sciences (6 quarters) and Travel & Conferences (7 quarters) by derivation; no hard-coded entity names in code."

---

### FINDING-08: `ColumnMappingProposal` and `ColumnMappingRequest` Pydantic models are not defined

**Severity:** NIT
**Section:** §2.3 (Column Mapping)
**Observation:** The design names both `ColumnMappingProposal` (returned by `POST /upload`) and `ColumnMappingRequest` (sent by the frontend on confirmation) but does not specify their fields. The frontend component `Upload.tsx` must know what it receives and sends, but no schema is given.
**Recommendation:** Add skeleton definitions:
```python
class ColumnMappingProposal(BaseModel):
    source_columns: list[str]
    suggestions: dict[str, str | None]   # source_col → canonical_field or None
    required_fields: list[str]
    unmapped_required: list[str]         # canonical fields with no suggestion

class ColumnMappingRequest(BaseModel):
    dataset_name: str
    mapping: dict[str, str]              # source_col → canonical_field (confirmed by user)
```

---

### FINDING-09: Dollar forecast grounding: abbreviated-dollar tolerance not applied to forecast PI dollar fields

**Severity:** NIT
**Section:** §7.1 Step 3 (Tolerance Rules), §6 Tool 3
**Observation:** The tolerance table in §7.1 specifies separate rules for "bare dollar" (exact ± $1) and "abbreviated dollar" (`$1.2M`, `$108K`). The `run_forecast` tool returns `dollar_forecast`, `dollar_pi_80_low`, `dollar_pi_80_high`, `dollar_pi_95_low`, `dollar_pi_95_high` as floats, which may be in the millions for a total-level forecast. The LLM will naturally abbreviate these ("approximately $22.5M"). The grounding check tolerance table covers the abbreviated-dollar case, but §6 Tool 3's "dollar field grounding note" says the check uses "the bare-dollar tolerance rule (exact ± $1)" — this contradicts the §7.1 tolerance table for the abbreviated format.
**Recommendation:** Amend the dollar field grounding note in §6 Tool 3 to read: "The grounding check verifies cited dollar amounts against these fields using the tolerance rule appropriate to the cited format: bare-dollar citations use ± $1; abbreviated citations ($M, $K) use the rounding rules in §7.1 Step 3 Table."

---

## Verified Assumptions

The following assumptions stated or implied by the design were checked against `docs/design.md` and `tests/ground_truth.md` and are CONFIRMED:

- **300 rows, 25 columns, no nulls except anomaly_type (166 nulls)** — confirmed design.md §1.1.
- **record_id is the primary key (BUD-00001 to BUD-00300, all unique)** — confirmed design.md §1.1.
- **`period_index` is derived, not present in source file** — confirmed design.md §2 schema mapping.
- **23 duplicate 4-column key combos covering 47 rows; 6-column key is unique** — confirmed design.md §1.3.
- **BUD-00018: variance_usd=$0.00 but variance_pct=−2.1** — confirmed design.md §1.4.
- **Source forecast mean absolute gap 4.1%, max 14.46%, unusually close** — confirmed design.md §1.7.
- **54% of 'Overrun' rows have negative variance; 55% of 'Underspend' rows have positive variance** — confirmed design.md §1.6.
- **variance_pct bounded: min −50 (2 rows), max +47 (0 rows at +50 cap)** — confirmed design.md §1.4.
- **Forecast target: spend-vs-budget ratio (candidate a)** — confirmed design.md §3.
- **Travel & Conferences has 7 quarters of data; College of Liberal Arts & Sciences has 6 quarters** — confirmed design.md §1.10.
- **All fund sources have 11–12 quarters; State has 11** — confirmed design.md §1.10.
- **17 rows with |variance_pct| ≥ 30** — confirmed design.md §1.9, ground_truth.md §2.
- **Anomaly method: median/MAD, modified Z-score z = 0.6745 × (value − median) / MAD, threshold 2.5** — confirmed ground_truth.md §1.
- **Persistent pattern rule: same-sign variance exceeding ±5% in ≥ 2 of 3 fiscal years** — confirmed ground_truth.md §3.
- **Consulting & Contracts over budget all 3 years: +16.1%, +13.9%, +14.7%** — confirmed ground_truth.md §3.
- **Travel & Conferences under budget all 3 years: −17.9%, −14.1%, −9.8%** — confirmed ground_truth.md §3.
- **Administrative Overhead FY2026: exactly −5.0% (boundary; qualifies)** — confirmed ground_truth.md §3.
- **College of Liberal Arts & Sciences FY2025: −4.8% (below threshold; does not qualify for over-budget pattern)** — confirmed ground_truth.md §3.
- **Office of Research top contributor to Consulting & Contracts: +$174,297 overrun** — confirmed design.md §1.8.
- **Top 3 over-budget departments: Architecture +13.52%, Pharmacy +10.06%, Office of Research +7.92%** — confirmed design.md §1.8.
- **Facility Maintenance reverses in FY2026 (−13.1%); persistent label covers FY2024+FY2025 only** — confirmed ground_truth.md §3.
- **SYS-01: LLM never computes numbers; all figures must trace to a tool result from the same turn** — confirmed requirements.md SYS-01.
- **R3-04 permitted models: Naive, Seasonal Naive (≥8 quarters only), Drift, ETS (non-seasonal, damped), Linear Trend** — confirmed requirements.md R3-04.
- **Replay mode: seven scripted prompts; no Bedrock credentials required when active** — confirmed requirements.md R6-01 through R6-03.
- **Dept×Category forecasting explicitly refused with stated reason** — confirmed requirements.md R3-02; design §5.1 matches.
- **"Bursar's office" does not exist in the dataset; 16 known departments listed** — confirmed design.md §1.2.

---

## Unverified / Wrong Assumptions

The following design claims could not be confirmed against the ground truth sources, or are wrong:

- **WRONG — `stl_note` dual use (FINDING-02):** Appendix B states "`stl_note` to include: 'Dollar forecast unavailable…'" but the `RunForecastResponse` defines `stl_note` only for STL unavailability. These are different conditions; the field cannot serve both purposes reliably.
- **UNVERIFIED — `anomaly_results` table schema (FINDING-03):** The design asserts outputs are stored in `anomaly_results` in DuckDB but no DDL is given. The table structure cannot be verified.
- **UNVERIFIED — ValidationReport field list (FINDING-01):** The design describes DQ findings in prose but does not define the `ValidationReport` Pydantic model. The test code references `report.rejected_rows` and `report.unmapped_periods` but other R1-05 required fields (derived-column reconciliation, entity counts, fiscal period range) are not confirmed present.
- **UNVERIFIED — R2-07 fiscal-year breakdown in KPI panel (FINDING-04):** The `KpiResponse` model does not contain a per-fiscal-year breakdown. Whether this is intentional (the panel shows only the filtered year) or an omission cannot be determined from the design text.
- **UNVERIFIED — plain trend line method (FINDING-05):** The design does not specify what computation produces the "plain trend line" for STL-ineligible entities.
- **UNVERIFIED — derived-column reconciliation in validation report (FINDING-06):** Beyond the BUD-00018 special case, no row-by-row reconciliation of `variance_usd`, `yoy_change_pct`, or `forecast_accuracy_pct` is specified. Whether all three confirmed-zero mismatch counts (design.md §1.4) will be reported generically by the pipeline for arbitrary uploads is unverified.
- **MINOR INCONSISTENCY — confidence label table redundancy (FINDING-07):** Rows "< 8 quarters" and "< 9 quarters" both map to Low; the overlap is harmless but creates ambiguity in implementation.
- **UNVERIFIED — ColumnMappingProposal / ColumnMappingRequest schemas (FINDING-08):** Referenced in §2.3 but not defined. The frontend cannot be implemented against an unspecified contract.
- **INCONSISTENCY — abbreviated-dollar tolerance for forecast fields (FINDING-09):** §6 Tool 3 says bare-dollar tolerance (±$1) applies to dollar forecast fields, but §7.1 says abbreviated dollar format uses a rounding-range rule. For million-dollar forecast totals, LLM responses will use the abbreviated format; the two sections contradict each other.

---

VERDICT: REVISE_REQUIRED

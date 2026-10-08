# Technical Design Mechanical Review
**Document reviewed:** `docs/technical-design.md` (Revision 2)
**Reference documents:** `docs/requirements.md` (APPROVED), `docs/design.md`, `tests/ground_truth.md`, `docs/assumption-challenger-findings.md`
**Review date:** 2026-10-08
**Reviewer role:** mechanical-reviewer

---

## 1. Section Coverage Checklist

| Required Section | Present | Location |
|---|---|---|
| Architecture Overview | ✓ | §1 |
| Ingestion Pipeline | ✓ | §2 |
| Variance/Trend/Anomaly Analysis | ✓ | §3 |
| Reporting Process Health | ✓ | §4 |
| Forecasting | ✓ | §5 |
| Tool Definitions | ✓ | §6 |
| Grounding Check | ✓ | §7 |
| SSE Streaming | ✓ | §8 |
| Replay Mode | ✓ | §9 |
| Data Quality Surfacing | ✓ | §10 |
| Non-Functional Requirements | ✓ | §11 |
| Accessibility | ✓ | §12 |

All 12 required sections are present.

---

## 2. Assumption-Challenger Findings Response Audit

All nine findings from `docs/assumption-challenger-findings.md` are reviewed here:

| Finding | Severity | Addressed? | Assessment |
|---|---|---|---|
| FINDING-01: `ValidationReport` Pydantic model never defined | HIGH | **PARTIAL** | Appendix C logs it as unresolved (it is not in the Revision 1 responses table). The design still lacks a `class ValidationReport(BaseModel)` definition with the fields required by R1-05. |
| FINDING-02: `stl_note` dual-use for semantically unrelated failures | HIGH | **NO** | Appendix B still reads: "sets `stl_note` to include: 'Dollar forecast unavailable…'". No `dollar_forecast_available: bool` field has been added to `RunForecastResponse`. The `stl_note` field in §6 Tool 3 is still the single vehicle for both STL unavailability and dollar unavailability. |
| FINDING-03: `anomaly_results` DDL never specified | MEDIUM | **NO** | No `CREATE TABLE anomaly_results` DDL appears anywhere in the design. `KpiResponse.anomaly_count` still reads "count from most recent detect_anomalies run (stored in anomaly_results)" with no schema defined. |
| FINDING-04: R2-07 "total actual vs budget by fiscal year" absent from `KpiResponse` | MEDIUM | **NO** | `KpiResponse` in §3.7 still lacks a `fiscal_year_summary: list[FiscalYearSummary]` field. The three-year breakdown (FY2024 −1.0%, FY2025 −2.6%, FY2026 −3.1%) required by R2-07 cannot be returned in a single `GET /kpis` call. |
| FINDING-05: R2-05 plain trend line for STL-ineligible entities unspecified | MEDIUM | **NO** | §3.6 still only specifies the unavailability note. No fallback computation method (OLS overlay, raw data points) is described for `TrendChart.tsx`. |
| FINDING-06: R1-05 derived-column reconciliation missing from validation report | MEDIUM | **NO** | §2.6 still covers only the BUD-00018 special case. No row-by-row SQL reconciliation of `variance_usd`, `yoy_change_pct`, and `forecast_accuracy_pct` is specified for arbitrary uploads. |
| FINDING-07: Confidence label table redundant overlap | NIT | **PARTIAL** | The table in §5.5 still contains both "< 8 quarters" and "< 9 quarters" rows plus named-entity rows (CLAS and T&C). No consolidation was made. Harmless but creates implementation ambiguity. |
| FINDING-08: `ColumnMappingProposal` / `ColumnMappingRequest` schemas undefined | NIT | **NO** | §2.3 still names these classes without providing field definitions. |
| FINDING-09: Abbreviated-dollar tolerance contradicts bare-dollar tolerance for forecast fields | NIT | **NO** | §6 Tool 3 grounding note still reads "bare-dollar tolerance rule (exact ± $1)". §7.1 Step 3 Table specifies the correct abbreviated-dollar rule for $M/$K values. The contradiction is not resolved. |

**Summary:** Both HIGH findings (FINDING-01 and FINDING-02) from the assumption-challenger are unresolved. All four MEDIUM findings (FINDING-03 through FINDING-06) are unresolved.

---

## 3. Acceptance Criteria Traceability

| AC | Status | Notes |
|---|---|---|
| AC1 — 300-row reconciliation | Traceable | §11.4 reconciliation tests cover this. |
| AC2 — Anomaly ground truth; ≤5 extra flags | Traceable | §3.2 algorithm + ground-truth test present. |
| AC3 — Detector-vs-source-flag panel; pytest-verified | Traceable | §3.4 specifies panel and test. |
| AC4 — Forecasts with intervals, model, CV error, confidence; CLAS=Low; dept×category refusal | Traceable | §5.1–5.8, §6 Tool 3. |
| AC5 — C&C answer passes grounding; tool trace visible; persistent-pattern label | Traceable | §7, §3.5, §9.2 replay trace 02. |
| AC6 — Fabricated number test triggers grounding flag | Traceable | §7.2 test harness. |
| AC7 — Bursar question returns insufficient-data | Traceable | Appendix B + §9.2 prompt 07. |
| AC8 — Replay completes without Bedrock credentials | Traceable | §9. |
| AC9 — Bad period → validation report not crash; duplicates accepted with warning | **PARTIAL** | §2.5 covers the row-acceptance path. But AC9 cannot be fully tested without a typed `ValidationReport` schema (FINDING-01 from assumption-challenger is unresolved). |
| AC10 — Process health: no causal claim; "descriptive only" in prompt and tool output | Traceable | §4.3. |

---

## 4. Locked Decision Compliance

| Locked Decision | Respected? |
|---|---|
| Forecast target: spend-vs-budget ratio | ✓ §5.2 |
| Anomaly algorithm: median/MAD, modified Z-score 0.6745×(v−median)/MAD, threshold 2.5 | ✓ §3.2 |
| Persistent pattern rule: same-sign ≥±5% in ≥2 of 3 fiscal years | ✓ §3.5 |
| STL threshold: minimum 8 quarters | ✓ §3.6 |
| Dept×Category forecasting refused | ✓ §5.1, §6 Tool 3 |
| No Prophet/deep learning | ✓ §5.3 |

All six locked decisions are respected.

---

## 5. System Requirements (SYS-01 through SYS-06)

| Requirement | Status | Notes |
|---|---|---|
| SYS-01 — LLM never computes numbers | Traceable | §7 grounding check; tool schemas include "never compute these numbers yourself" language; §6 tool descriptions carry the invariant. |
| SYS-02 — Secrets from environment variables | ✓ | §11.1 .env.example; §8.3 BEDROCK_MODEL_ID from env; §9 no credentials in replay mode. |
| SYS-03 — No financial figures in logs | ✓ | §7.1 Step 4 specifies log without numeric values. |
| SYS-04 — Typed Pydantic interfaces for every endpoint and tool | **PARTIAL** | All 7 tool request/response models are defined. BUT `ValidationReport` (R1-05, FINDING-01) remains untyped. `ColumnMappingProposal`/`ColumnMappingRequest` (§2.3) are referenced but not defined (FINDING-08). SYS-04 is partially violated. |
| SYS-05 — Bedrock timeout + exponential backoff | ✓ | §8.3 specifies 30s timeout, 3 retries (1s/2s/4s), error event on exhaustion. |
| SYS-06 — First token within seconds via SSE | ✓ | §8.1–8.2; tokens emitted from `contentBlockDelta` immediately. |

---

## 6. Internal Consistency Check

| Check | Result |
|---|---|
| KPI panel uses same aggregation formula as chat tools | ✓ §3.7 specifies shared `build_variance_query()` helper. |
| `planned_budget_total` in `forecast_results` DDL matches §5.2 derivation | ✓ Both specify FY2026 SUM(budget). |
| Replay grounding check uses same `run_grounding_check()` as live path | ✓ §9.4. |
| Source-forecast caveat text: §5.8 removed; §10.2 is authoritative | ✓ Appendix C NIT-01 confirms removal. |
| `detect_anomalies` sensitivity range: schema says 1.0–5.0; §3.2 algorithm uses default 2.5 | ✓ Consistent. |
| `stl_note` dual-use (STL unavailability AND dollar unavailability) | **CONFLICT** — §6 Tool 3 defines `stl_note` for STL unavailability; Appendix B overloads it for dollar unavailability. Two independent failure conditions share one nullable string field with no structured disambiguation. |
| Confidence label table: rows 1 ("< 8 quarters") and 4 ("< 9 quarters") overlap | **INCONSISTENCY** — Row 1 fires first for < 8 quarters. Row 4 would only fire for exactly 8 quarters. But the table also has named rows (CLAS=6, T&C=7) that duplicate the < 8-quarter derivation. Order-of-evaluation is unambiguous but the overlap creates redundant special cases. |

---

## 7. Findings

### FINDING-MR01: `ValidationReport` Pydantic model is absent — HIGH

**Location:** §2.6, Appendix C (assumption-challenger FINDING-01 not resolved)
**Problem:** The design still lacks a `class ValidationReport(BaseModel)` with typed fields. Appendix C shows assumption-challenger FINDING-01 as unaddressed (it does not appear in the Revision 1 responses table, and no `ValidationReport` class definition exists in the design body). R1-05 mandates seven specific fields. The only test evidence is `report.rejected_rows` and `report.unmapped_periods` in §2.5, but the full contract (entity counts, fiscal period range, derived-column reconciliation counts, source-flag sign disagreements) is unspecified. SYS-04 requires typed Pydantic interfaces for every endpoint. AC9 cannot be fully tested without the typed schema.
**Blocks:** AC9 (partial), SYS-04, R1-05.
**Fix:** Add to §2.6:
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

---

### FINDING-MR02: `stl_note` dual-use creates unstructured LLM disambiguation — HIGH

**Location:** §6 Tool 3 (`RunForecastResponse`), Appendix B
**Problem:** Appendix B still packs a "Dollar forecast unavailable" message into `stl_note`. The `RunForecastResponse` has no structured boolean for dollar availability. The LLM system prompt instructs suppression of dollar citations when `dollar_forecast` is null, but this is a nullability check on a float field — it cannot distinguish "dollar fields null because no FY2026 budget rows" from "dollar fields null because computation was skipped." More critically, if both STL unavailability and dollar unavailability apply simultaneously, both messages must be concatenated into one string. The grounding check in §7 cannot distinguish these two conditions structurally; it relies on the LLM parsing the string. A subtle prompt variation could produce a SYS-01 violation (fabricated dollar amount).
**Blocks:** SYS-01 (potential fabrication path), AC5.
**Fix:** Add to `RunForecastResponse`:
```python
dollar_forecast_available: bool        # False when no FY2026 budget denominator
dollar_unavailable_reason: str | None  # human-readable; populated when dollar_forecast_available=False
```
Amend Appendix B to set `dollar_forecast_available=False` and `dollar_unavailable_reason="No FY2026 budget data found for this entity."` rather than overloading `stl_note`. The system prompt and grounding check should key off `dollar_forecast_available: false` as the machine-readable suppression signal.

---

### FINDING-MR03: `anomaly_results` DuckDB table DDL missing — MEDIUM

**Location:** §3.2, §3.7 (`KpiResponse.anomaly_count`)
**Problem:** `KpiResponse.anomaly_count` requires reading from `anomaly_results` ("count from most recent detect_anomalies run (stored in anomaly_results)"), but no `CREATE TABLE anomaly_results` DDL exists in the design. The coder writing `kpis.py` cannot implement `anomaly_count` without knowing the schema — specifically whether there is a `dataset_id` column, a `computed_at` timestamp to identify the "most recent" run, and a `detector_flag` column to count.
**Blocks:** R2-07 (partial), AC3 consistency between KPI panel and anomaly detector.
**Fix:** Add to §3.2 (alongside the algorithm):
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
Update `KpiResponse.anomaly_count` comment: "count of `detector_flag=1` rows in `anomaly_results` for the most recent `run_id` by `computed_at` for this `dataset_id`."

---

### FINDING-MR04: R2-07 fiscal-year breakdown missing from `KpiResponse` — MEDIUM

**Location:** §3.7 (`KpiResponse` model), R2-07
**Problem:** R2-07 requires the KPI panel to display "total actual vs budget variance (dollar and percent, **by fiscal year**)." `KpiResponse` contains `total_actual`, `total_budget`, `total_variance_pct` at the aggregate level and an optional `fiscal_year_filter` for filtering to a single year — but no `fiscal_year_summary` list returning the three-year breakdown in a single response. To display the confirmed FY2024 (−1.0%), FY2025 (−2.6%), FY2026 (−3.1%) row, the KPI panel would require three separate `GET /kpis` calls, which is neither specified nor efficient.
**Blocks:** R2-07, AC1 (KPI panel data completeness for demo).
**Fix:** Add to `KpiResponse`:
```python
class FiscalYearSummary(BaseModel):
    fiscal_year: str
    total_actual: float
    total_budget: float
    variance_usd: float
    variance_pct: float

class KpiResponse(BaseModel):
    ...
    fiscal_year_summary: list[FiscalYearSummary]  # always includes all available years
```
The `GET /kpis` DuckDB query adds a `GROUP BY fiscal_year` sub-query that always returns all available fiscal years regardless of the `fiscal_year_filter`.

---

### FINDING-MR05: R2-05 plain trend line fallback computation unspecified — MEDIUM

**Location:** §3.6 (STL Decomposition Gating), R2-05
**Problem:** R2-05 mandates: "Where fewer than 8 quarters are available, only a **plain trend line shall be shown**." §3.6 specifies the visible unavailability note (correct) but says nothing about how the "plain trend line" is computed or rendered. Travel & Conferences (7 quarters) and College of Liberal Arts & Sciences (6 quarters) need a real specification: OLS regression? Moving average? Raw data points connected by a line? Without this, two independent coders will produce different outputs, and the frontend component (`TrendChart.tsx`) has no contract to implement against.
**Blocks:** R2-05.
**Fix:** Add one sentence to §3.6: "For STL-ineligible entities, `TrendChart.tsx` renders the raw quarterly spend-vs-budget ratio data points connected by a line, overlaid with an OLS regression line computed client-side from the `quarterly_time_series` array in the `explain_variance` or `query_actuals` response. No additional API call is required for the fallback trend line."

---

### FINDING-MR06: R1-05 derived-column reconciliation absent from ingestion pipeline — MEDIUM

**Location:** §2.6 (Validation Report), R1-05
**Problem:** R1-05 explicitly requires "derived-column reconciliation results (variance_usd = actual − budget, yoy_change_pct = actual / prior_year − 1, forecast_accuracy_pct = 100 − |forecast − actual| / actual × 100)" in the validation report. The design covers the BUD-00018 edge case (variance_usd=0 but variance_pct≠0) but never specifies a row-by-row recomputation of all three derived columns against their constituents. For `Team6Dataset.xlsx` the mismatch count is 0 for all three, but an arbitrary uploaded dataset could have systematic derivation errors that would pass ingestion silently, violating R1-05 and AC9.
**Blocks:** R1-05, AC9 (partial).
**Fix:** Add to §2.6 before the DQ findings list:
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
These three counts populate the three fields added to `ValidationReport` (FINDING-MR01 fix).

---

### FINDING-MR07: SYS-04 violated by undefined `ColumnMappingProposal` / `ColumnMappingRequest` schemas — MEDIUM

**Location:** §2.3 (Column Mapping)
**Problem:** SYS-04 requires typed Pydantic interfaces for every API endpoint. `POST /upload` returns a `ColumnMappingProposal` and accepts a `ColumnMappingRequest`, but neither class is defined anywhere in the design. The assumption-challenger rated this NIT (FINDING-08); however, given SYS-04's explicit requirement for typed interfaces on every endpoint, and given that the frontend `Upload.tsx` cannot be implemented without knowing what it receives and sends, this finding is elevated to MEDIUM.
**Blocks:** SYS-04, R1-02 (column mapping UI implementation).
**Fix:** Add to §2.3:
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

---

### FINDING-MR08: Abbreviated-dollar tolerance in §6 Tool 3 contradicts §7.1 tolerance table — NIT

**Location:** §6 Tool 3 ("Dollar field grounding note"), §7.1 Step 3 Table
**Problem:** §6 Tool 3 states: "The grounding check verifies cited dollar amounts against these fields using the **bare-dollar tolerance rule (exact ± $1)**." But the `run_forecast` tool returns dollar values that will be in the millions (total-level forecast). The LLM will naturally cite these as "$22.5M" — an abbreviated format. §7.1 Step 3 Table correctly specifies the abbreviated-dollar rule ($N.NM → rounding range). The §6 note contradicts §7.1 and would cause the implementer of `grounding.py` to apply the wrong rule to forecast dollar citations, potentially generating spurious grounding flags on correctly rounded million-dollar figures.
**Fix:** Amend the dollar field grounding note in §6 Tool 3: "The grounding check verifies cited dollar amounts against these fields using the tolerance rule appropriate to the cited format: bare-dollar citations (e.g. $108,693) use ± $1; abbreviated citations ($M, $K) use the rounding rules in §7.1 Step 3 Table."

---

### FINDING-MR09: Confidence label table has redundant rows that could produce brittle hard-coded entity names in code — NIT

**Location:** §5.5 (Confidence Label Logic)
**Problem:** The table lists "College of Liberal Arts & Sciences (6 quarters) → Low (always)" and "Travel & Conferences (7 quarters) → Low (always)" as named rows, in addition to the general "< 8 quarters → Low" row. These named rows are derivable from the general rule and risk being implemented as special-cased entity names rather than as derivations of the < 8-quarter rule. If any new entity has fewer than 8 quarters of data, the general rule handles it but the named rows may mislead a coder into thinking only CLAS and T&C need the Low label.
**Fix:** Remove the two named rows. Add a note after the "< 8 quarters → Low" row: "This includes College of Liberal Arts & Sciences (6 quarters) and Travel & Conferences (7 quarters) in the sample dataset. No hard-coded entity names in code; the general rule applies."

---

## 8. Verified Assumptions

The following design claims were checked against `docs/design.md` and `tests/ground_truth.md`:

- **300 rows, 25 columns** — confirmed `design.md §1.1`.
- **record_id unique; BUD-00001 to BUD-00300** — confirmed `design.md §1.1`.
- **`period_index` derived, not in source file** — confirmed `design.md §2`.
- **23 duplicate 4-col key combos / 47 rows; 6-col key unique** — confirmed `design.md §1.3`.
- **BUD-00018: variance_usd=$0 but variance_pct=−2.1** — confirmed `design.md §1.4`.
- **Source forecast mean gap 4.1%, max 14.46%** — confirmed `design.md §1.7`.
- **variance_pct bounded: min −50 (2 rows), max +47 (0 rows at +50 cap)** — confirmed `design.md §1.4`.
- **Forecast target: spend-vs-budget ratio** — confirmed `design.md §3`.
- **Travel & Conferences 7 quarters; CLAS 6 quarters** — confirmed `design.md §1.10`.
- **17 rows with |variance_pct| ≥ 30** — confirmed `design.md §1.9`, `ground_truth.md §2`.
- **Anomaly method: median/MAD, z=0.6745×(v−median)/MAD, threshold 2.5** — confirmed `ground_truth.md §1`.
- **Persistent pattern rule: same-sign ≥±5% in ≥2 of 3 years** — confirmed `ground_truth.md §3`.
- **Consulting & Contracts over all 3 years: +16.1%, +13.9%, +14.7%** — confirmed `ground_truth.md §3`.
- **Travel & Conferences under all 3 years: −17.9%, −14.1%, −9.8%** — confirmed `ground_truth.md §3`.
- **Administrative Overhead FY2026: exactly −5.0% (boundary qualifies)** — confirmed `ground_truth.md §3`.
- **Facility Maintenance reverses to −13.1% in FY2026** — confirmed `ground_truth.md §3`.
- **Dept×Category forecasting refused with correct reason (avg 2.2 rows)** — confirmed `requirements.md` Out of Scope.
- **Dollar forecast = predicted_ratio × SUM(budget FY2026)** — confirmed `design.md §3` candidate (a) and the design §5.2.
- **Top 3 over-budget departments: Architecture +13.52%, Pharmacy +10.06%, Office of Research +7.92%** — confirmed `design.md §1.8`.
- **FY2024/FY2025/FY2026 overall variance: −1.04%, −2.62%, −3.14%** — confirmed `design.md §1.8`.
- **SYS-01 grounding check enforced; fabricated number test present** — confirmed §7.2.
- **Replay mode: seven prompts; no Bedrock credentials when active** — confirmed §9.
- **Bedrock: 30s timeout, 3 retries (1s/2s/4s), exponential backoff** — confirmed §8.3.
- **WCAG 2.1 AA note: full validation requires manual testing** — confirmed §12.3 note.

---

## 9. Unverified / Wrong Assumptions

- **UNRESOLVED (FINDING-MR01 / assumption-challenger FINDING-01): `ValidationReport` schema** — The design describes the validation report's DQ checks in prose but never defines the Pydantic model. The R1-05 fields (entity counts, fiscal period range, derived-column reconciliation counts, source-flag sign disagreements) cannot be verified as present.
- **UNRESOLVED (FINDING-MR02 / assumption-challenger FINDING-02): `stl_note` overloading** — Appendix B still packs "Dollar forecast unavailable" into `stl_note`. The `RunForecastResponse` has no `dollar_forecast_available: bool` field. Two independent failures share one nullable string.
- **UNRESOLVED (FINDING-MR03 / assumption-challenger FINDING-03): `anomaly_results` schema** — Asserted to exist in DuckDB; DDL never provided.
- **UNRESOLVED (FINDING-MR04 / assumption-challenger FINDING-04): fiscal-year breakdown in `KpiResponse`** — R2-07 requires it; `KpiResponse` does not contain it.
- **UNRESOLVED (FINDING-MR05 / assumption-challenger FINDING-05): plain trend line computation** — No method is specified for STL-ineligible entities.
- **UNRESOLVED (FINDING-MR06 / assumption-challenger FINDING-06): derived-column reconciliation** — The three SQL reconciliation queries required by R1-05 are absent from §2.6.
- **UNRESOLVED (FINDING-MR07): `ColumnMappingProposal` / `ColumnMappingRequest` schemas** — Referenced in §2.3; not defined. SYS-04 is violated.
- **INCONSISTENCY (FINDING-MR08): §6 Tool 3 dollar grounding note vs §7.1 tolerance table** — §6 specifies bare-dollar tolerance for all dollar amounts; §7.1 correctly specifies abbreviated format rules. These contradict each other.

---

## 10. Verdict

**Finding counts:**
- HIGH: 2 (FINDING-MR01, FINDING-MR02)
- MEDIUM: 5 (FINDING-MR03, FINDING-MR04, FINDING-MR05, FINDING-MR06, FINDING-MR07)
- NIT: 2 (FINDING-MR08, FINDING-MR09)

**VERDICT: REVISE_REQUIRED**

Both HIGH findings from the assumption-challenger pass (FINDING-01 and FINDING-02) remain unaddressed in Revision 2. All four of the assumption-challenger's MEDIUM findings (FINDING-03 through FINDING-06) are also unaddressed. One additional MEDIUM finding was raised (FINDING-MR07: undefined column-mapping schemas, elevated from assumption-challenger NIT because SYS-04 explicitly requires typed interfaces for every endpoint). The design cannot proceed to implementation until these seven findings are resolved.

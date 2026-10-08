# Technical Design Mechanical Review — Revision 4
**Document reviewed:** `docs/technical-design.md` (Revision 4)
**Reference documents:** `docs/requirements.md` (APPROVED), `docs/design.md`, `tests/ground_truth.md`
**Previous review:** `docs/design-review.md` (Revision 3, findings NEW-01 through NEW-04 + field-name NIT)
**Review date:** 2026-10-08
**Reviewer role:** mechanical-reviewer (fresh read, no context from prior reviews)

---

## 1. Revision 3 Finding Resolution

Each of the 5 findings from the Revision 3 review is checked below. The quoted text is the exact text required by the prior review; the confirmation is based on a direct search of the Revision 4 document.

### NEW-01 — `anomaly_results` DDL storage location

**Required fix:** §3.2 DDL block for `anomaly_results`/`anomaly_run_summary` must be followed by the sentence specifying `.ddb` storage at `/data/dbs/{dataset_id}.ddb` and explaining the `dataset_id` column.

**Status: ✅ RESOLVED**

The following sentence appears in §3.2 immediately after the DDL block (line 426):

> "Both `anomaly_results` and `anomaly_run_summary` are stored within the dataset's own `.ddb` file at `/data/dbs/{dataset_id}.ddb`. The `dataset_id` column in `anomaly_results` is retained for cross-validation queries and is always equal to the containing file's dataset UUID."

Both requirements are satisfied: storage path and `dataset_id` rationale are present.

---

### NEW-02 — `KpiResponse.source_flag_disagreement_count` comment and `GET /kpis` description

**Required fix:** `KpiResponse.source_flag_disagreement_count` comment must read "count of rows where detector and source disagree (FP + FN from confusion matrix)"; `GET /kpis` description must say it aggregates `fp + fn`.

**Status: ✅ RESOLVED**

The Pydantic model in §3.7 now reads:

```python
source_flag_disagreement_count: int  # count of rows where detector and source disagree (FP + FN from confusion matrix)
```

The note immediately after the model definition states:

> "The `source_flag_disagreement_count` field is computed as `fp + fn` from the `anomaly_run_summary` table for the most recent `run_id` (by `computed_at`) for this `dataset_id`."

Both required elements are present verbatim.

---

### NEW-03 — §3.6 OLS sentence references only `explain_variance`

**Required fix:** §3.6 OLS sentence must NOT say "or `query_actuals`"; must say "from the `explain_variance` response" and include "No additional API call is required for the fallback trend line."

**Status: ✅ RESOLVED**

§3.6 now reads:

> "For STL-ineligible entities, `TrendChart.tsx` renders the raw quarterly spend-vs-budget ratio data points connected by a line, overlaid with an OLS regression line computed client-side from the `quarterly_time_series` array in the `explain_variance` response. No additional API call is required for the fallback trend line."

The phrase "or `query_actuals`" is absent. The required sentence "No additional API call is required for the fallback trend line." is present verbatim.

---

### NEW-04 — §5.5 confidence table rows merged

**Required fix:** The two rows (`< 8 quarters` and `< 9 quarters (no CV folds possible)`) must be merged into one row with the combined label `Entity has < 9 quarters of history (< 8: cannot model; 8 exactly: no CV folds)`.

**Status: ✅ RESOLVED**

§5.5 table first row now reads:

| Condition | Label |
|---|---|
| Entity has < 9 quarters of history (< 8: cannot model; 8 exactly: no CV folds) | Low |

The blockquote note (CLAS + Travel & Conferences) is placed after this row. The previously separate `< 8 quarters → Low` row is gone.

---

### Field-name NIT — §2.5 test must use `report.rows_unmapped_period`

**Required fix:** §2.5 unit test must use `report.rows_unmapped_period`, not `report.unmapped_periods`.

**Status: ✅ RESOLVED**

§2.5 test now contains:

```python
assert report.rows_unmapped_period == 1
```

This matches the `ValidationReport` Pydantic model field `rows_unmapped_period: int` defined in §2.6.

---

## 2. Section Coverage Checklist

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

## 3. Acceptance Criteria Traceability

| AC | Traceable? | Design Location | Notes |
|---|---|---|---|
| AC1 — 300-row reconciliation reproduces data profile | ✓ | §11.4 | All reconciliation tests present with correct tolerance values. |
| AC2 — Anomaly ground truth: 17 rows ≥ 30%, persistent patterns, ≤5 extra flags | ✓ | §3.2, §3.5 | Ground truth test with GT set of 17 IDs present; persistent pattern ground truth tables present; sign-consistency tests present. |
| AC3 — Detector-vs-source-flag panel pytest-verified | ✓ | §3.4 | Panel specified; `test_detector_source_agreement` present. |
| AC4 — Forecasts with intervals/model/CV/confidence; CLAS=Low; dept×cat refusal | ✓ | §5.1–5.8, §6 Tool 3 | All elements present. Travel & Conferences additionally cannot use Seasonal Naive (noted §5.5). |
| AC5 — C&C answer passes grounding; tool trace visible; persistent-pattern label | ✓ | §7, §3.5, §9.2 (trace 02) | Replay trace 02 specifies `explain_variance` + `detect_anomalies`; per-year variance from `quarterly_time_series` named as grounding anchor. |
| AC6 — Fabricated number test triggers grounding flag | ✓ | §7.2 | `test_grounding_flag_triggers` and `test_grounding_exact_dollar_boundary` present. |
| AC7 — Bursar question returns insufficient-data response | ✓ | Appendix B, §9.2 (trace 07) | Replay trace 07 specified as `list_entities` + insufficient-data pattern. |
| AC8 — Replay mode completes without Bedrock credentials | ✓ | §9 | Fuzzy-match, REPLAY_ACTIVE flag, no boto3 instantiation all specified. |
| AC9 — Bad period → validation report; duplicates accepted with warning | ✓ | §2.4, §2.5, §2.6 | `ValidationReport` typed; test `test_unmapped_period_row_accepted` present. |
| AC10 — Process health: no causal claim; "descriptive only" in prompt and tool output | ✓ | §4.3 | Both system prompt text and `descriptive_note` field in tool response specified; test present. |

All 10 acceptance criteria are traceable.

---

## 4. Locked Decision Compliance

| Locked Decision | Respected? | Location |
|---|---|---|
| Forecast target: spend-vs-budget ratio | ✓ | §5.2 |
| Anomaly algorithm: median/MAD, modified Z-score 0.6745×(v−median)/MAD, threshold 2.5 | ✓ | §3.2 |
| Persistent pattern rule: same-sign ≥±5% in ≥2 of 3 fiscal years | ✓ | §3.5 |
| STL threshold: minimum 8 quarters | ✓ | §3.6 |
| Dept×Category forecasting refused | ✓ | §5.1, §6 Tool 3 |
| No Prophet/deep learning | ✓ | §5.3 |

All 6 locked decisions are respected.

---

## 5. System Requirements (SYS-01 through SYS-06)

| Requirement | Status | Evidence |
|---|---|---|
| SYS-01 — LLM never computes numbers | ✓ | §7 grounding check; tool schemas include "never compute these numbers yourself" language; `dollar_forecast_available` machine-readable flag prevents fabricated dollar amounts when denominator is absent. |
| SYS-02 — Secrets from environment variables | ✓ | §11.1 `.env.example`; `BEDROCK_MODEL_ID` from env; no credentials in replay mode (§9.3). |
| SYS-03 — No financial figures in logs | ✓ | §7.1 Step 4 logs count only, not values; dept×category refusal logged without financial figures. |
| SYS-04 — Typed Pydantic interfaces for every endpoint and tool | ✓ | All 7 tool request/response models defined. `ValidationReport` typed (§2.6). `ColumnMappingProposal`/`ColumnMappingRequest` defined (§2.3). |
| SYS-05 — Bedrock timeout + exponential backoff | ✓ | §8.3: 30s timeout, 3 retries (1s/2s/4s), error event on exhaustion. |
| SYS-06 — First token within seconds via SSE | ✓ | §8.1–8.2; tokens emitted from `contentBlockDelta` immediately. |

All 6 system requirements are satisfied.

---

## 6. Internal Consistency

| Check | Result |
|---|---|
| KPI panel uses same aggregation formula as chat tools | ✓ §3.7 specifies shared `build_variance_query()` helper. |
| `planned_budget_total` in `forecast_results` DDL matches §5.2 derivation | ✓ Both specify FY2026 SUM(budget). |
| Replay grounding check uses same `run_grounding_check()` as live path | ✓ §9.4. |
| `dollar_forecast_available` / `dollar_unavailable_reason` consistently referenced | ✓ Set in §6 Tool 3, handled in Appendix B edge case, grounding check keys off it. |
| `anomaly_results` storage location and `anomaly_count` filter | ✓ Both §3.2 and §3.7 correctly reference `dataset_id` in per-dataset `.ddb` file; NEW-01 fix verified. |
| `source_flag_disagreement_count` = FP+FN | ✓ Comment and note in §3.7 both correctly state FP+FN; NEW-02 fix verified. |
| `quarterly_time_series` sourced from `explain_variance` only | ✓ §3.6 removed `query_actuals` reference; `ExplainVarianceResponse` has the field; `QueryActualsResponse` does not have it; NEW-03 fix verified. |
| Confidence label table rows 1 and 2 merged | ✓ Single merged row covers < 9 quarters; NEW-04 fix verified. |
| `rows_unmapped_period` field name consistent between model and test | ✓ Both §2.5 test and §2.6 `ValidationReport` now use `rows_unmapped_period`. |
| `rows_rejected` in `ValidationReport` vs `rejected_rows` in §2.5 test | **INCONSISTENCY** — see NEW-05 below. |
| §5.5 confidence decision table broken into two Markdown tables by a blockquote | **RENDERING DEFECT** — see NEW-06 below. |

---

## 7. Findings

### NEW-05: `ValidationReport.rows_rejected` vs `report.rejected_rows` in §2.5 test — NIT

**Location:** §2.5 (unit test), §2.6 (`ValidationReport` Pydantic model)

**Problem:** The `ValidationReport` Pydantic model in §2.6 defines the field as `rows_rejected: int`. The unit test in §2.5 asserts `report.rejected_rows == 0`. These names differ by word order: `rows_rejected` (model) vs `rejected_rows` (test). The test will raise `AttributeError: 'ValidationReport' object has no attribute 'rejected_rows'` at runtime, identical in character to the `rows_unmapped_period` / `unmapped_periods` mismatch that was just fixed by the NIT in Revision 3.

**Fix:** Change the test assertion in §2.5 to match the model:

```python
assert report.rows_rejected == 0
```

(Or rename the model field to `rejected_rows` and update both places — but `rows_rejected` is more consistent with the surrounding `rows_accepted` and `rows_unmapped_period` naming convention already in the model.)

---

### NEW-06: §5.5 confidence decision table is split into two disconnected Markdown tables — NIT

**Location:** §5.5 (Confidence Label Logic)

**Problem:** The confidence decision table is intended to be read as a single ordered table evaluated top-to-bottom ("first match wins"). The Rev 4 fix correctly merged the first row into "Entity has < 9 quarters of history (< 8: cannot model; 8 exactly: no CV folds) → Low" and placed the CLAS/Travel & Conferences note as a blockquote immediately after. However, in Markdown, a blockquote between table rows breaks the table. The rendered result is:

- **Table 1:** one row: the merged `< 9 quarters` row.
- **Blockquote:** the CLAS/Travel note.
- **Table 2 (no header row):** the remaining rows: `9 quarters exactly`, `High CV error`, `Wide 95% PI`, `Medium CV error`, `Low CV error`.

The second table has no column header. A coder reading the rendered document may interpret the second table as a separate, independent table rather than the continuation of the first — leading to confusion about evaluation order and possibly implementing the `9 quarters exactly → Low` rule as a separate code path with no documented header context.

**Fix:** Move the CLAS/Travel blockquote note **after** the complete table, not in the middle of it:

```markdown
The full decision table (all conditions evaluated in order; first match wins):

| Condition | Label |
|---|---|
| Entity has < 9 quarters of history (< 8: cannot model; 8 exactly: no CV folds) | Low |
| 9 quarters exactly (only 1 CV fold; insufficient for uplift) | Low |
| High CV error: MAE ≥ 0.15 OR sMAPE ≥ 30% | Low |
| Wide 95% PI: width > 0.3 AND otherwise would be High | Medium (override) |
| Medium CV error: 0.05 ≤ MAE < 0.15 OR 10% ≤ sMAPE < 30% | Medium |
| Low CV error: MAE < 0.05 AND sMAPE < 10% | High |

> In the sample dataset, College of Liberal Arts & Sciences (6 quarters) and Travel & Conferences (7 quarters) are covered by the first row. No hard-coded entity names in code; the general rule applies.
```

This keeps the table intact and positions the explanatory note where it provides context without breaking the table structure.

---

## 8. Verified Assumptions

The following design claims were verified against `docs/design.md` and `tests/ground_truth.md`:

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
- **All 17 ground-truth record IDs present in §3.2 test fixture** — confirmed against `ground_truth.md §2`.
- **Anomaly method: median/MAD, z=0.6745×(v−median)/MAD, threshold 2.5** — confirmed `ground_truth.md §1`.
- **Persistent pattern rule: same-sign ≥±5% in ≥2 of 3 years** — confirmed `ground_truth.md §3`.
- **Consulting & Contracts over all 3 years: +16.1%, +13.9%, +14.7%** — confirmed `ground_truth.md §3`.
- **Travel & Conferences under all 3 years: −17.9%, −14.1%, −9.8%** — confirmed `ground_truth.md §3`.
- **Administrative Overhead FY2026: exactly −5.0% (boundary qualifies, inclusive rule)** — confirmed `ground_truth.md §3`.
- **Facility Maintenance reverses to −13.1% in FY2026** — confirmed `ground_truth.md §3`.
- **Research Operations FY2024 at −4.4% (below threshold)** — confirmed `ground_truth.md §3`.
- **College of Liberal Arts & Sciences: +9.3%, −4.8%, +5.0% (FY2025 excluded from over-qualifying years)** — confirmed `ground_truth.md §3`.
- **Dept×Category forecasting refused with correct reason (avg 2.2 rows)** — confirmed `requirements.md` Out of Scope.
- **Dollar forecast = predicted_ratio × SUM(budget FY2026)** — confirmed `design.md §3`.
- **Top 3 over-budget departments: Architecture +13.52%, Pharmacy +10.06%, Office of Research +7.92%** — confirmed `design.md §1.8`.
- **FY2024/FY2025/FY2026 overall variance: −1.04%, −2.62%, −3.14%** — confirmed `design.md §1.8`.
- **SYS-01 grounding check enforced; fabricated number test present** — confirmed §7.2.
- **Replay mode: seven prompts; no Bedrock credentials when active** — confirmed §9.
- **Bedrock: 30s timeout, 3 retries (1s/2s/4s), exponential backoff** — confirmed §8.3.
- **WCAG 2.1 AA note: full validation requires manual testing** — confirmed §12.3 note.
- **`ValidationReport` field `rows_unmapped_period` matches test assertion `report.rows_unmapped_period`** — confirmed §2.5 and §2.6; Rev 3 NIT fix verified.
- **`anomaly_results` DDL has `dataset_id` column and is stored in per-dataset `.ddb`** — confirmed §3.2; NEW-01 fix verified.
- **`FiscalYearSummary` has all 5 fields** — confirmed §3.7.
- **`dollar_forecast_available` and `dollar_unavailable_reason` present in `RunForecastResponse`** — confirmed §6 Tool 3.
- **`source_flag_disagreement_count` comment = FP+FN; `GET /kpis` note says `fp + fn`** — confirmed §3.7; NEW-02 fix verified.
- **`quarterly_time_series` sourced only from `explain_variance` response in §3.6** — confirmed §3.6; NEW-03 fix verified.
- **Confidence table first row merged to `< 9 quarters`** — confirmed §5.5; NEW-04 fix verified.

---

## 9. Unverified / Wrong Assumptions

- **MINOR FIELD NAME MISMATCH (NEW-05): `rows_rejected` vs `rejected_rows`** — `ValidationReport` defines `rows_rejected: int` (§2.6), but the §2.5 test asserts `report.rejected_rows == 0`. This will cause an `AttributeError` at test time. Fix is unambiguous: rename the test assertion to `report.rows_rejected`. Severity NIT — does not affect design contract, only test code.

- **RENDERING DEFECT (NEW-06): §5.5 confidence table split by blockquote** — The blockquote inserted between the first and remaining rows of the confidence decision table causes two separate Markdown tables to render, with the second table missing its header row. A coder reading the rendered document may not recognise the rows after the blockquote as a continuation of the same decision table. Severity NIT — the decision logic itself is correct and unambiguous from the source Markdown; however, fixing the table structure eliminates any risk of misinterpretation.

---

## 10. Verdict

**Previous findings resolution:**
- NEW-01 (MEDIUM): ✅ RESOLVED
- NEW-02 (MEDIUM): ✅ RESOLVED
- NEW-03 (MEDIUM): ✅ RESOLVED
- NEW-04 (NIT): ✅ RESOLVED
- Field-name NIT (`rows_unmapped_period`): ✅ RESOLVED

**New findings:**
- NEW-05 (NIT): `report.rejected_rows` in §2.5 test vs `rows_rejected` in `ValidationReport` model — trivially fixable, unambiguous correct value.
- NEW-06 (NIT): §5.5 confidence table split by blockquote — rendering defect, logic is correct, fix is to move blockquote after the complete table.

**Finding counts:**
- HIGH: 0
- MEDIUM: 0
- NIT: 2 (NEW-05, NEW-06)

**VERDICT: APPROVED_WITH_ADVISORIES**

All 5 Revision 3 findings (NEW-01, NEW-02, NEW-03, NEW-04, and the field-name NIT) are genuinely resolved in Revision 4. No new HIGH or MEDIUM findings are introduced. Two NITs are identified: a test-assertion field name mismatch (`rejected_rows` vs `rows_rejected`) and a Markdown table rendering defect in §5.5 caused by placing the blockquote inside the decision table. Neither affects the design contract or coder decisions; both are trivially correctable. The design is approved for implementation, with the advisory that the two NITs should be corrected before implementation to avoid a test failure and a potential readability confusion.

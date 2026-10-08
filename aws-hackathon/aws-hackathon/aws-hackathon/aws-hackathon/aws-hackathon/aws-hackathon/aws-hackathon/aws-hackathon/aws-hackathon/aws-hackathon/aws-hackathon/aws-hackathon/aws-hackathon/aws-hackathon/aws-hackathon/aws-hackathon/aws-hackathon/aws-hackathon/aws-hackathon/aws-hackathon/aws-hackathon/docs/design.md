# Budget Forecasting Analyst — Design Document

## 1. Profiling Findings

All claims were verified by running Python (pandas + openpyxl) against `data/Team6Dataset.xlsx`,
sheet `Budget_Forecast_Data`. Tolerance for floating-point comparisons: $0.01 for USD fields,
0.05 percentage points for percentage fields (rounding to one decimal accounts for all observed
differences).

---

### 1.1 Basics

| Claim | Stated | Actual | Status |
|---|---|---|---|
| Row count | 300 | 300 | CONFIRMED |
| Column count | 25 | 25 | CONFIRMED |
| Columns | (see schema) | record_id, department, budget_category, fiscal_year, fiscal_quarter, fund_source, report_type, budgeted_amount_usd, actual_spend_usd, forecasted_amount_usd, variance_usd, variance_pct, prior_year_spend_usd, yoy_change_pct, forecast_accuracy_pct, num_spreadsheet_versions, manual_adjustments_count, data_entry_errors, days_to_produce_report, approval_cycles, stakeholders_involved, confidence_score_1to5, anomaly_detected, anomaly_type, report_status | CONFIRMED |
| No nulls except anomaly_type | True | True — all other columns 0 nulls | CONFIRMED |
| anomaly_type nulls = 166 | 166 | 166 | CONFIRMED |
| anomaly_type nulls exactly match anomaly_detected = 0 | True | True (perfect alignment) | CONFIRMED |
| record_id unique | True | 300 unique / 300 rows | CONFIRMED |
| record_id range | BUD-00001 to BUD-00300 | BUD-00001 to BUD-00300 | CONFIRMED |
| Grain is quarterly | True | fiscal_year × fiscal_quarter | CONFIRMED |
| fiscal_year values | FY2024–FY2026 | FY2024, FY2025, FY2026 | CONFIRMED |
| fiscal_quarter values | Q1–Q4 | Q1, Q2, Q3, Q4 | CONFIRMED |
| Distinct quarters | 12 | 12 | CONFIRMED |
| Rows per quarter range | 12 to 33 | 12 (FY2026 Q1) to 33 (FY2024 Q3) | CONFIRMED |

Rows per quarter detail:

| Quarter | Rows |
|---|---|
| FY2024 Q1 | 25 |
| FY2024 Q2 | 22 |
| FY2024 Q3 | 33 |
| FY2024 Q4 | 23 |
| FY2025 Q1 | 31 |
| FY2025 Q2 | 26 |
| FY2025 Q3 | 27 |
| FY2025 Q4 | 25 |
| FY2026 Q1 | 12 |
| FY2026 Q2 | 28 |
| FY2026 Q3 | 20 |
| FY2026 Q4 | 28 |

---

### 1.2 Dimensions

| Claim | Stated | Actual | Status |
|---|---|---|---|
| Departments | 16 | 16 | CONFIRMED |
| budget_category values | 10 | 10 | CONFIRMED |
| fund_source values | 6 (Grant, Foundation, Auxiliary, Internal, Tuition, State) | 6 (Auxiliary, Foundation, Grant, Internal, State, Tuition) | CONFIRMED |
| report_type values | 6 (Quarterly, Monthly, Ad-Hoc, Mid-Year, Year-End, Annual) | 6 (Ad-Hoc, Annual, Mid-Year, Monthly, Quarterly, Year-End) | CONFIRMED |
| report_status values | 4 (Draft, Under Review, Finalized, Delayed) | 4 (Delayed, Draft, Finalized, Under Review) | CONFIRMED |

Departments (16): College of Applied Health Sciences, College of Architecture, College of Business
Administration, College of Education, College of Engineering, College of Liberal Arts & Sciences,
College of Medicine, College of Nursing, College of Pharmacy, College of Urban Planning, Graduate
College, Office of Research, Office of the Provost, School of Public Health, Student Affairs,
University Library.

---

### 1.3 Natural Key Uniqueness

| Claim | Stated | Actual | Status |
|---|---|---|---|
| 4-col key (dept + category + year + quarter) is NOT unique | True | 276 distinct combos from 300 rows → 23 combos repeat | CONFIRMED |
| Duplicate combos count | 23 | 23 | CONFIRMED |
| Rows in duplicate combos | — | 47 | NOTE |
| Adding fund_source + report_type makes it unique | True | 300 distinct combos from 300 rows (max 1 per combo) | CONFIRMED |

---

### 1.4 Derived Column Reconciliation

Tolerance used: USD fields ±$0.01; percentage fields ±0.05 pct points (consistent with storage at
one decimal place).

| Claim | Stated mismatches | Actual mismatches | Status |
|---|---|---|---|
| variance_usd = actual_spend_usd − budgeted_amount_usd | 0 | 0 (max diff $0.00) | CONFIRMED |
| yoy_change_pct = actual_spend_usd / prior_year_spend_usd − 1 (as %) | 0 | 0 within ±0.05 pct pts; stored as percentage rounded to 1 decimal | CONFIRMED |
| forecast_accuracy_pct = 100 − \|forecast − actual\| / actual × 100 | 0 | 0 within ±0.05 pct pts; stored rounded to 1 decimal | CONFIRMED |

**BUD-00018 inconsistency (surfaced, not fixed):**
Row BUD-00018 has `budgeted_amount_usd = $2,000`, `actual_spend_usd = $2,000`,
`variance_usd = $0.00` (correct: actual − budget = 0), yet `variance_pct = −2.1`.
The variance_pct is inconsistent with variance_usd for this record. The formula
`(actual − budget) / budget × 100` would yield 0.0%, not −2.1%. This is a data quality
issue in the source file; the application must carry it as-is and surface the discrepancy.

**variance_pct bounds:**

| Claim | Stated | Actual | Status |
|---|---|---|---|
| variance_pct bounded at −50 and +50 | True | min = −50.0, max = +47.0; 0 rows outside [−50, +50] | CONFIRMED |
| Rows at −50 cap | — | 2 | NOTE |
| Rows at +50 cap | — | 0 | NOTE |

---

### 1.5 Reporting-Process Column Statistics

| Claim | Stated | Actual | Status |
|---|---|---|---|
| num_spreadsheet_versions mean ≈ 6.2 | 6.2 | 6.19 | CONFIRMED |
| manual_adjustments_count mean ≈ 2.95 | 2.95 | 2.95 | CONFIRMED |
| data_entry_errors mean ≈ 0.41 | 0.41 | 0.407 | CONFIRMED |
| Rows with at least one data_entry_error | 96 | 96 | CONFIRMED |
| days_to_produce_report mean ≈ 17.7 | 17.7 | 17.671 | CONFIRMED |
| approval_cycles mean ≈ 2.9 | 2.9 | 2.927 | CONFIRMED |
| confidence_score_1to5 mean ≈ 3.7 | 3.7 | 3.733 | CONFIRMED |
| Rows with confidence_score in {1, 2} | 20 | 20 | CONFIRMED |

---

### 1.6 Anomaly Flag Analysis

| Claim | Stated | Actual | Status |
|---|---|---|---|
| anomaly_detected = 1 rows | 134 (45%) | 134 (44.7%) | CONFIRMED |
| Mean \|variance_pct\| for flagged rows | ≈ 13.4 | 13.42 | CONFIRMED |
| Mean \|variance_pct\| for unflagged rows | ≈ 13.1 | 13.11 | CONFIRMED |
| Unflagged rows with \|variance_pct\| > 25 | 22 | 22 | CONFIRMED |
| Flagged rows with \|variance_pct\| < 5 | 23 | 23 | CONFIRMED |

**Anomaly type distribution (actual counts):**

| anomaly_type | Count |
|---|---|
| YoY Spike | 32 |
| Forecast Deviation | 30 |
| Underspend | 29 |
| Overrun | 26 |
| Misallocation | 17 |
| (null — anomaly_detected = 0) | 166 |

**Anomaly type / variance sign inconsistency:**

| Claim | Stated | Actual | Status |
|---|---|---|---|
| Total 'Overrun' rows | 26 | 26 | CONFIRMED |
| 'Overrun' rows with **negative** variance_pct | 14 of 26 | 14 | CONFIRMED |
| 'Overrun' rows with **positive** variance_pct | 12 of 26 | 12 | NOTE |
| Total 'Underspend' rows | 29 | 29 | CONFIRMED |
| 'Underspend' rows with **positive** variance_pct | 16 of 29 | 16 | CONFIRMED |
| 'Underspend' rows with **negative** variance_pct | 13 of 29 | 13 | NOTE |

Approximately 54% of 'Overrun' rows and 55% of 'Underspend' rows carry the wrong sign.
The source anomaly_type label is not reliable for sign-based filtering.

---

### 1.7 Source Forecast Accuracy

| Claim | Stated | Actual | Status |
|---|---|---|---|
| forecasted_amount_usd within 14.5% of actual on every row | True | Max absolute gap = 14.46%; 0 rows > 14.5% | CONFIRMED |
| Mean absolute gap ≈ 4.1% | 4.1% | 4.09% | CONFIRMED |
| Mean forecast_accuracy_pct ≈ 95.9% | 95.9% | 95.91% | CONFIRMED |

Note: the source forecast being uniformly within 14.5% of actuals (mean gap 4.1%) is
unusually close for a budget forecasting dataset. This may indicate the forecast was
adjusted post-hoc to match actuals. See section 4 (Known Data Quality Findings).

---

### 1.8 Aggregate Variance Patterns

All values computed as `(sum(actual_spend_usd) / sum(budgeted_amount_usd) − 1) × 100`.

**By fiscal year:**

| Fiscal Year | Actual ($) | Budget ($) | Variance % | Stated | Status |
|---|---|---|---|---|---|
| FY2024 | 6,034,135.74 | 6,097,797.97 | −1.04% | ≈ −1.0% | CONFIRMED |
| FY2025 | 7,966,716.16 | 8,181,136.48 | −2.62% | ≈ −2.6% | CONFIRMED |
| FY2026 | 7,966,210.22 | 8,224,131.46 | −3.14% | ≈ −3.1% | CONFIRMED |

**By budget category (all years combined):**

| Category | Actual ($) | Budget ($) | Variance % | Stated | Status |
|---|---|---|---|---|---|
| Consulting & Contracts | 3,402,993 | 2,963,034 | +14.85% | ≈ +14.8% | CONFIRMED |
| Equipment & Technology | 2,621,640 | 2,483,834 | +5.55% | ≈ +5.5% | CONFIRMED |
| Supplies & Materials | 2,139,472 | 2,065,082 | +3.60% | ≈ +3.6% | CONFIRMED |
| Personnel & Salaries | 1,631,884 | 1,578,369 | +3.39% | ≈ +3.4% | CONFIRMED |
| Student Aid & Scholarships | 1,039,495 | 1,016,274 | +2.28% | ≈ +2.3% | CONFIRMED |
| Facility Maintenance | 2,167,722 | 2,286,223 | −5.18% | ≈ −5.2% | CONFIRMED |
| Research Operations | 2,537,902 | 2,784,524 | −8.86% | ≈ −8.9% | CONFIRMED |
| Administrative Overhead | 2,460,476 | 2,746,779 | −10.42% | ≈ −10.4% | CONFIRMED |
| Professional Development | 2,595,869 | 2,971,151 | −12.63% | ≈ −12.6% | CONFIRMED |
| Travel & Conferences | 1,369,611 | 1,607,796 | −14.81% | ≈ −14.8% | CONFIRMED |

**By department (all years combined):**

| Department | Actual ($) | Budget ($) | Variance % | Stated | Status |
|---|---|---|---|---|---|
| College of Architecture | 912,824 | 804,131 | +13.52% | ≈ +13.5% | CONFIRMED |
| College of Pharmacy | 830,574 | 754,650 | +10.06% | ≈ +10.1% | CONFIRMED |
| Office of Research | 2,679,957 | 2,483,258 | +7.92% | ≈ +7.9% | CONFIRMED |
| College of Liberal Arts & Sciences | 711,356 | 688,653 | +3.30% | — | NOTE |
| College of Engineering | 1,633,097 | 1,592,919 | +2.52% | — | NOTE |
| Office of the Provost | 2,009,847 | 1,990,726 | +0.96% | — | NOTE |
| Student Affairs | 1,596,045 | 1,619,923 | −1.47% | — | NOTE |
| College of Applied Health Sciences | 674,420 | 702,694 | −4.02% | — | NOTE |
| College of Urban Planning | 1,688,814 | 1,768,898 | −4.53% | — | NOTE |
| College of Business Administration | 1,138,161 | 1,192,666 | −4.57% | — | NOTE |
| University Library | 2,149,656 | 2,325,660 | −7.57% | — | NOTE |
| College of Medicine | 1,275,202 | 1,386,621 | −8.04% | — | NOTE |
| Graduate College | 1,033,550 | 1,130,925 | −8.61% | — | NOTE |
| College of Nursing | 1,139,344 | 1,263,212 | −9.81% | ≈ −9.8% | CONFIRMED |
| School of Public Health | 1,126,224 | 1,262,118 | −10.77% | ≈ −10.8% | CONFIRMED |
| College of Education | 1,367,990 | 1,536,011 | −10.94% | ≈ −10.9% | CONFIRMED |

**Office of Research × Consulting & Contracts:**

| Claim | Stated | Actual | Status |
|---|---|---|---|
| OR contribution to C&C overrun | ≈ +$174K | +$174,297 (3 rows; actual $1,267,790 vs budget $1,093,493) | CONFIRMED |

---

### 1.9 Anomaly Threshold Rows

| Claim | Stated | Actual | Status |
|---|---|---|---|
| Rows with \|variance_pct\| ≥ 25 | 38 | 38 | CONFIRMED |
| Rows with \|variance_pct\| ≥ 30 | 17 | 17 | CONFIRMED |

**Complete list of 17 rows with |variance_pct| ≥ 30 (sorted ascending by variance_pct):**

| record_id | department | budget_category | fiscal_year | fiscal_quarter | variance_pct |
|---|---|---|---|---|---|
| BUD-00237 | College of Urban Planning | Administrative Overhead | FY2026 | Q4 | −50.0 |
| BUD-00189 | Office of the Provost | Professional Development | FY2024 | Q2 | −50.0 |
| BUD-00176 | College of Urban Planning | Professional Development | FY2024 | Q4 | −49.1 |
| BUD-00005 | College of Urban Planning | Professional Development | FY2024 | Q1 | −43.7 |
| BUD-00190 | Graduate College | Professional Development | FY2025 | Q2 | −41.7 |
| BUD-00285 | College of Medicine | Administrative Overhead | FY2024 | Q3 | −38.9 |
| BUD-00213 | College of Applied Health Sciences | Professional Development | FY2026 | Q3 | −36.3 |
| BUD-00267 | College of Applied Health Sciences | Research Operations | FY2026 | Q4 | −35.9 |
| BUD-00160 | Student Affairs | Facility Maintenance | FY2026 | Q3 | −31.0 |
| BUD-00156 | College of Business Administration | Professional Development | FY2026 | Q1 | −31.0 |
| BUD-00228 | College of Applied Health Sciences | Equipment & Technology | FY2024 | Q3 | +31.0 |
| BUD-00293 | Office of the Provost | Consulting & Contracts | FY2026 | Q1 | +31.0 |
| BUD-00087 | Office of the Provost | Student Aid & Scholarships | FY2026 | Q4 | +32.9 |
| BUD-00202 | School of Public Health | Equipment & Technology | FY2025 | Q4 | +33.0 |
| BUD-00116 | College of Architecture | Equipment & Technology | FY2025 | Q4 | +38.0 |
| BUD-00028 | College of Medicine | Equipment & Technology | FY2025 | Q3 | +42.0 |
| BUD-00241 | College of Medicine | Consulting & Contracts | FY2025 | Q2 | +47.0 |

Note: the max positive value is +47.0 (not +50.0), so the +50 cap is never hit in this dataset.
The −50 cap is hit by exactly 2 rows (BUD-00237 and BUD-00189).

---

### 1.10 Series Density

| Claim | Stated | Actual | Status |
|---|---|---|---|
| By category: 7 to 12 quarters | 7–12 | 7 (Travel & Conferences) to 12 (Equipment & Technology, Professional Development) | CONFIRMED |
| By department: 6 to 12 quarters | 6–12 | 6 (College of Liberal Arts & Sciences) to 12 (Office of the Provost) | CONFIRMED |
| College of Liberal Arts & Sciences = 6 quarters | 6 | 6 | CONFIRMED |
| By fund_source: 11 to 12 quarters | 11–12 | 11 (State) to 12 (Auxiliary, Foundation, Grant, Internal, Tuition) | CONFIRMED |

**By category (quarters with data):**

| Category | Quarters |
|---|---|
| Travel & Conferences | 7 |
| Student Aid & Scholarships | 8 |
| Personnel & Salaries | 10 |
| Administrative Overhead | 11 |
| Consulting & Contracts | 11 |
| Facility Maintenance | 11 |
| Research Operations | 11 |
| Supplies & Materials | 11 |
| Equipment & Technology | 12 |
| Professional Development | 12 |

**By department (quarters with data):**

| Department | Quarters |
|---|---|
| College of Liberal Arts & Sciences | 6 |
| College of Education | 8 |
| College of Nursing | 8 |
| College of Pharmacy | 8 |
| Office of Research | 8 |
| School of Public Health | 8 |
| College of Architecture | 9 |
| College of Engineering | 9 |
| College of Medicine | 9 |
| College of Business Administration | 10 |
| Student Affairs | 10 |
| University Library | 10 |
| College of Applied Health Sciences | 11 |
| College of Urban Planning | 11 |
| Graduate College | 11 |
| Office of the Provost | 12 |

**By fund_source (quarters with data):**

| Fund Source | Quarters |
|---|---|
| State | 11 |
| Auxiliary | 12 |
| Foundation | 12 |
| Grant | 12 |
| Internal | 12 |
| Tuition | 12 |

---

## 2. Canonical Schema Mapping

| Source Column Name | Canonical Field Name | Notes |
|---|---|---|
| record_id | record_id | Primary identifier; unique in source |
| department | department | 16 distinct values |
| budget_category | category | Renamed from budget_category |
| fiscal_year | fiscal_year | FY2024, FY2025, FY2026 |
| fiscal_quarter | fiscal_quarter | Q1–Q4 |
| fund_source | fund_source | 6 values; needed to make natural key unique |
| report_type | report_type | 6 values; needed to make natural key unique |
| report_status | report_status | 4 values (Draft, Under Review, Finalized, Delayed) |
| budgeted_amount_usd | budget | USD amount |
| actual_spend_usd | actual | USD amount |
| forecasted_amount_usd | source_forecast | USD amount; see data quality note on post-hoc adjustment |
| variance_usd | source_variance | Carry as-is; application recomputes as actual − budget |
| variance_pct | variance_pct | Carry as-is; bounded at −50/+50 in source; BUD-00018 inconsistency noted |
| prior_year_spend_usd | prior_year_actual | USD amount |
| yoy_change_pct | yoy_change_pct | Stored as %, rounded to 1 decimal (e.g. 15.7 means 15.7%) |
| forecast_accuracy_pct | forecast_accuracy_pct | Stored as %, rounded to 1 decimal; 100 − \|forecast−actual\|/actual×100 |
| anomaly_detected | source_anomaly_flag | Binary (0/1); 134 flagged, 166 unflagged |
| anomaly_type | source_anomaly_type | 5 types + null (null when anomaly_detected = 0); sign inconsistencies noted |
| num_spreadsheet_versions | num_spreadsheet_versions | Integer; mean 6.19 |
| manual_adjustments_count | manual_adjustments_count | Integer; mean 2.95 |
| data_entry_errors | data_entry_errors | Integer; mean 0.407; 96 rows ≥ 1 |
| days_to_produce_report | days_to_produce_report | Numeric; mean 17.67 |
| approval_cycles | approval_cycles | Numeric; mean 2.93 |
| stakeholders_involved | stakeholders_involved | Numeric; no canonical alias change |
| confidence_score_1to5 | confidence_score_1to5 | Integer 1–5; mean 3.73; 20 rows scored 1 or 2 |
| period_index | period_index | Derived: FY2024 Q1 = 1, FY2024 Q2 = 2, …, FY2026 Q4 = 12 |

Note: `period_index` does not exist in the source file. It is derived by the ingestion layer
using the mapping `(fiscal_year, fiscal_quarter) → {(FY2024,Q1):1, (FY2024,Q2):2, …, (FY2026,Q4):12}`.

---

## 3. Forecast Target Decision

All three candidates are computed as aggregates over the 12 fiscal quarters.
The core problem is that row count varies from 12 (FY2026 Q1) to 33 (FY2024 Q3),
a 2.75× range. This makes candidates (b) and (c) incompatible across quarters.

### Candidate (a): Spend-vs-Budget Ratio = sum(actual) / sum(budget) per quarter

| Quarter | Period | Row Count | Ratio |
|---|---|---|---|
| FY2024 Q1 | 1 | 25 | 1.111170 |
| FY2024 Q2 | 2 | 22 | 0.964198 |
| FY2024 Q3 | 3 | 33 | 0.934095 |
| FY2024 Q4 | 4 | 23 | 0.932745 |
| FY2025 Q1 | 5 | 31 | 1.036003 |
| FY2025 Q2 | 6 | 26 | 1.011616 |
| FY2025 Q3 | 7 | 27 | 0.940120 |
| FY2025 Q4 | 8 | 25 | 0.887167 |
| FY2026 Q1 | 9 | 12 | 1.000779 |
| FY2026 Q2 | 10 | 28 | 1.027564 |
| FY2026 Q3 | 11 | 20 | 0.875029 |
| FY2026 Q4 | 12 | 28 | 1.027411 |

Row-count effect: dividing totals by totals, row count cancels out. FY2026 Q1 (12 rows)
produces a plausible ratio (1.000) rather than an artificially low value.

### Candidate (b): Mean actual spend per record per quarter

| Quarter | Period | Row Count | Mean Actual ($) |
|---|---|---|---|
| FY2024 Q1 | 1 | 25 | 74,243.57 |
| FY2024 Q2 | 2 | 22 | 63,815.87 |
| FY2024 Q3 | 3 | 33 | 54,670.08 |
| FY2024 Q4 | 4 | 23 | 42,173.25 |
| FY2025 Q1 | 5 | 31 | 90,008.31 |
| FY2025 Q2 | 6 | 26 | 56,886.88 |
| FY2025 Q3 | 7 | 27 | 82,765.71 |
| FY2025 Q4 | 8 | 25 | 58,509.03 |
| FY2026 Q1 | 9 | 12 | 35,654.89 |
| FY2026 Q2 | 10 | 28 | 69,310.54 |
| FY2026 Q3 | 11 | 20 | 135,592.09 |
| FY2026 Q4 | 12 | 28 | 103,064.80 |

Row-count effect: mean is sensitive to which departments/categories happen to appear in
a given quarter. FY2026 Q1 (12 rows, $35K mean) and FY2026 Q3 (20 rows, $135K mean)
differ by 3.8× — largely an artifact of composition, not a real spending signal.

### Candidate (c): Total actual spend per quarter

| Quarter | Period | Row Count | Total Actual ($) |
|---|---|---|---|
| FY2024 Q1 | 1 | 25 | 1,856,089.21 |
| FY2024 Q2 | 2 | 22 | 1,403,949.09 |
| FY2024 Q3 | 3 | 33 | 1,804,112.71 |
| FY2024 Q4 | 4 | 23 | 969,984.73 |
| FY2025 Q1 | 5 | 31 | 2,790,257.47 |
| FY2025 Q2 | 6 | 26 | 1,479,058.84 |
| FY2025 Q3 | 7 | 27 | 2,234,674.08 |
| FY2025 Q4 | 8 | 25 | 1,462,725.77 |
| FY2026 Q1 | 9 | 12 | 427,858.62 |
| FY2026 Q2 | 10 | 28 | 1,940,695.26 |
| FY2026 Q3 | 11 | 20 | 2,711,841.81 |
| FY2026 Q4 | 12 | 28 | 2,885,814.53 |

Row-count effect: totals scale directly with row count. FY2026 Q1 ($428K, 12 rows)
looks like a massive underspend quarter vs FY2026 Q4 ($2.9M, 28 rows). The difference
is almost entirely composition, not real spending behavior.

### Recommendation

**Chosen target: (a) spend-vs-budget ratio.**

Rationale: the ratio normalises out the varying row counts by placing actual and budget
on the same coverage base. The other two candidates mix a real signal (spending level)
with a structural artifact (how many department × category × fund_source records happen
to appear in each quarter). The ratio is also directly interpretable (values > 1.0 mean
over-budget; values < 1.0 mean under-budget) and maps cleanly to the demo questions
which ask about over/under-budget performance.

For FY2027 forecasting the model will predict the ratio for each of the 4 forecast
quarters; the application layer multiplies by the planned budget total to recover a dollar
forecast. Confidence intervals on the ratio propagate naturally to dollar confidence
intervals.

---

## 4. Known Data Quality Findings

### Finding 1: BUD-00018 variance inconsistency

`record_id = BUD-00018` has `budgeted_amount_usd = $2,000`, `actual_spend_usd = $2,000`,
`variance_usd = $0.00` (consistent with actual − budget = 0), but `variance_pct = −2.1`.
The formula `(actual − budget) / budget × 100` yields 0.0%, not −2.1%.
`variance_usd` and `variance_pct` are internally contradictory for this row.
The application carries both fields as received and surfaces this record as a data quality
warning when presenting variance analysis. Do not attempt to correct it.

### Finding 2: Source forecast suspiciously close to actuals

The source `forecasted_amount_usd` is within 14.46% of `actual_spend_usd` on every row,
with a mean absolute gap of 4.1% and a mean `forecast_accuracy_pct` of 95.9%. For a
real-world budget forecasting dataset spanning 3 fiscal years across 16 departments this
is implausibly accurate. It is likely that the forecast was adjusted post-hoc to match
actuals after the fiscal year closed. The application must not use `source_forecast` as
a baseline for measuring forecast quality or training the FY2027 model. It is carried
as `source_forecast` for lineage but the model trains on `actual` vs `budget` only.

### Finding 3: Duplicate natural keys

The 4-column key (department + category + fiscal_year + fiscal_quarter) is not unique.
23 combinations repeat, covering 47 rows total (the 23 combos each appear in exactly
2 rows, accounting for 46 rows, plus 1 combo that may appear more — the exact distribution
was not enumerated). The 6-column key adding fund_source + report_type is unique.
Any grouping or pivot by the 4-column key must aggregate (sum or mean) rather than
expect one row per cell.

### Finding 4: Source anomaly flag / type inconsistent with variance sign

Of the 26 rows labelled `anomaly_type = 'Overrun'`, 14 (54%) have a **negative**
`variance_pct`, meaning actual was below budget — the opposite of an overrun.
Of the 29 rows labelled `anomaly_type = 'Underspend'`, 16 (55%) have a **positive**
`variance_pct`, meaning actual exceeded budget — the opposite of underspending.
The source flag and type labels are not reliable. The application implements its own
anomaly detection (median/MAD on variance_pct within peer groups) and treats the
source labels as informational metadata only.

---

## 5. Demo Script Ground Truth

Source: R6-02 in `docs/requirements.md`. All figures are computed from the dataset.

### Prompt 1: "Which departments are furthest over budget, and by how much?"

Top 3 over-budget departments (all years combined, variance % = sum(actual)/sum(budget)−1):

| Rank | Department | Variance % | Variance $ |
|---|---|---|---|
| 1 | College of Architecture | +13.52% | +$108,693 |
| 2 | College of Pharmacy | +10.06% | +$75,925 |
| 3 | Office of Research | +7.92% | +$196,699 |

Note: Office of Research has the largest absolute dollar overrun (+$197K) despite a lower
percentage than Architecture and Pharmacy, because it has a much larger budget base.

### Prompt 2: "Why is Consulting & Contracts over budget?"

Consulting & Contracts is over budget in all 3 fiscal years:

| Fiscal Year | Actual ($) | Budget ($) | Variance % |
|---|---|---|---|
| FY2024 | (derived from per-year data) | — | +16.1% |
| FY2025 | — | — | +13.9% |
| FY2026 | — | — | +14.7% |

This qualifies as a **persistent pattern** under the 2-of-3-year rule (all 3 years ≥ +5%).

Largest contributor: **Office of Research** — $1,267,790 actual vs $1,093,493 budget
= +$174,297 overrun (+15.9%) across 3 records.

### Prompt 3: "Where are we consistently underspending?"

Categories with persistent under-budget pattern (≤ −5% in ≥ 2 of 3 fiscal years):

| Category | FY2024 | FY2025 | FY2026 | Pattern |
|---|---|---|---|---|
| Travel & Conferences | −17.9% | −14.1% | −9.8% | All 3 years |
| Professional Development | −14.1% | −14.1% | −10.4% | All 3 years |
| Administrative Overhead | −22.5% | −7.1% | −5.0% | All 3 years (FY2026 at threshold) |
| Research Operations | −4.4% | −5.1% | −13.6% | FY2025 + FY2026 |

Note: Administrative Overhead FY2026 value is exactly −5.0% (at the boundary).
Research Operations FY2024 is −4.4% (below threshold), so only FY2025 and FY2026 qualify.

### Prompt 4: "What is the FY2027 forecast for total spend versus budget, and how confident are you?"

The forecast has not yet been computed. Input data covers FY2024 Q1 through FY2026 Q4
(12 quarters). The model will be trained on the spend-vs-budget ratio series.
The confidence label will derive from the coefficient of variation (CV) of the ratio
series — a low CV yields a "high confidence" label, a high CV yields "low confidence."
The response should note: (1) the forecast horizon is FY2027 Q1–Q4, (2) the underlying
ratio series shows moderate volatility (quarterly ratios range from 0.875 to 1.111),
(3) confidence intervals will be provided, (4) the dataset covers only 3 fiscal years
so extrapolation uncertainty is substantial.

### Prompt 5: "Which individual records are the biggest outliers?"

The 17 rows with |variance_pct| ≥ 30 are the defined outlier list (same as section 1.9):

| record_id | Department | Category | Year | Quarter | variance_pct |
|---|---|---|---|---|---|
| BUD-00237 | College of Urban Planning | Administrative Overhead | FY2026 | Q4 | −50.0 |
| BUD-00189 | Office of the Provost | Professional Development | FY2024 | Q2 | −50.0 |
| BUD-00176 | College of Urban Planning | Professional Development | FY2024 | Q4 | −49.1 |
| BUD-00005 | College of Urban Planning | Professional Development | FY2024 | Q1 | −43.7 |
| BUD-00190 | Graduate College | Professional Development | FY2025 | Q2 | −41.7 |
| BUD-00285 | College of Medicine | Administrative Overhead | FY2024 | Q3 | −38.9 |
| BUD-00213 | College of Applied Health Sciences | Professional Development | FY2026 | Q3 | −36.3 |
| BUD-00267 | College of Applied Health Sciences | Research Operations | FY2026 | Q4 | −35.9 |
| BUD-00160 | Student Affairs | Facility Maintenance | FY2026 | Q3 | −31.0 |
| BUD-00156 | College of Business Administration | Professional Development | FY2026 | Q1 | −31.0 |
| BUD-00228 | College of Applied Health Sciences | Equipment & Technology | FY2024 | Q3 | +31.0 |
| BUD-00293 | Office of the Provost | Consulting & Contracts | FY2026 | Q1 | +31.0 |
| BUD-00087 | Office of the Provost | Student Aid & Scholarships | FY2026 | Q4 | +32.9 |
| BUD-00202 | School of Public Health | Equipment & Technology | FY2025 | Q4 | +33.0 |
| BUD-00116 | College of Architecture | Equipment & Technology | FY2025 | Q4 | +38.0 |
| BUD-00028 | College of Medicine | Equipment & Technology | FY2025 | Q3 | +42.0 |
| BUD-00241 | College of Medicine | Consulting & Contracts | FY2025 | Q2 | +47.0 |

The system's anomaly detector (median/MAD) is the authoritative method; the source
`anomaly_detected` flag is not used as ground truth. The demo should note that the
source flag agrees with 11 of these 17 rows (those that are also flagged as anomalies
in the source) and disagrees with the remaining 6.

### Prompt 6: "How long do reports take to produce, and where are the errors?"

Actual computed process-health statistics:

| Metric | Value |
|---|---|
| Mean days to produce report | 17.7 days |
| Mean data_entry_errors per record | 0.41 |
| Records with at least one data_entry_error | 96 of 300 (32%) |
| Mean manual_adjustments_count | 2.95 |
| Mean num_spreadsheet_versions | 6.19 |
| Mean approval_cycles | 2.93 |

The response should surface these figures without making causal claims
(e.g., do not claim that more spreadsheet versions cause more errors).

### Prompt 7: "What did the Bursar's office spend on travel?"

There is no entity named "Bursar" or "Bursar's office" in this dataset.
The 16 departments are listed in section 1.2. The closest administrative units are
"Office of the Provost" and "Student Affairs." The system must return an
insufficient-data response and must not guess or substitute a different department.
The correct response pattern: "There is no 'Bursar's office' in the dataset. The
available administrative departments are: [list]. Did you mean one of these?"

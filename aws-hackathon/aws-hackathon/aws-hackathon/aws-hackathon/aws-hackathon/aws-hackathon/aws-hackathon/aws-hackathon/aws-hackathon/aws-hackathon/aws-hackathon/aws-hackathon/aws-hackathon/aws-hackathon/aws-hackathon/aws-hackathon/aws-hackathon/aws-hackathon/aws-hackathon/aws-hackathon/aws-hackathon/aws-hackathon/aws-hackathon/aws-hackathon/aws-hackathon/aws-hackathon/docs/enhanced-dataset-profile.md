# Enhanced Dataset Profile — Team6Dataset_Enhanced 1.xlsx

Profiled 2026-10-08 against `data/Team6Dataset_Enhanced 1.xlsx`.

---

## Schema Changes vs Original File

The enhanced file has **30 columns** (up from 25) and **1,154 rows** (up from 300).
The grain is now **monthly** — each original quarterly record is expanded to 3 monthly rows.

### New columns

| Column | Type | Notes |
|---|---|---|
| `source_record_id` | string, nullable | Maps monthly M- row back to original BUD- quarterly record. NULL for synthetic S- rows. |
| `is_synthetic` | boolean | TRUE for 360 S- rows added to extend series for new departments/categories. |
| `include_in_totals` | boolean | FALSE for 7 rows that should be excluded from aggregate computations (see below). |
| `month` | date | First day of each calendar month (e.g. 2024-07-01). |
| `anomaly_review_status` | string, not null | Workflow state: "No Anomaly", "Pending Approval", "Pending Correction", "Delayed - No Anomaly", "Delayed - Anomaly Outstanding", "Flagged for Historical Review", "Locked - Approved", "Locked - Type Mismatch Noted" |

---

## Record ID Scheme

- **M-000001 … M-000794**: Non-synthetic rows (is_synthetic=False). 794 rows.
  Each original BUD- quarterly record expands to 1–3 monthly M- rows.
  Mean monthly rows per BUD- source record: 2.65 (mostly 3; some have 1 or 2).
- **S-010795 … S-011154**: Synthetic rows (is_synthetic=True). 360 rows.
  No `source_record_id`. Added to give 10 new dept/category combos a full 12-quarter monthly series.

---

## variance_pct Scale — CRITICAL

In the **original** file variance_pct was stored as a whole number representing the percentage
(e.g. stored value −50 = −50%). In the **enhanced** file variance_pct is stored as the
**actual decimal percentage** (e.g. stored value −50.0 = −50%, stored value 4.45 = 4.45%).

Ground truth 17 rows confirmed: their variance_pct values in the enhanced file are
essentially identical to the original (e.g. BUD-00237 = −50.00, BUD-00241 = +47.01).
The scale is the same — the original file's values were already real percentages, not basis
points. The in-document representation of variance_pct values like "445.00%" shown in the
pasted preview were a display artifact of the attachment rendering, not actual stored values.

**variance_pct range in enhanced file: −50.00 to +81.07** (max positive is now 81.07, up from
47.0, due to synthetic rows).

---

## Rows Excluded from Totals (include_in_totals = False)

7 rows across 3 source records must be excluded from all aggregate computations:

| source_record_id | department | budget_category | fiscal_year | fiscal_quarter | reason (inferred) |
|---|---|---|---|---|---|
| BUD-00038 (3 rows) | College of Urban Planning | Equipment & Technology | FY2025 | Q1 | Duplicate coverage / reclassified |
| BUD-00069 (3 rows) | Office of the Provost | Supplies & Materials | FY2024 | Q1 | Duplicate coverage / reclassified |
| BUD-00007 (1 row)  | Student Affairs | Facility Maintenance | FY2025 | Q1 | Partial month / data quality |

**Implication:** All DuckDB queries computing aggregates MUST include `WHERE include_in_totals = TRUE`.
This is a new data quality filter not present in the original dataset.

---

## Quarterly Spend-vs-Budget Ratio (include_in_totals=True only)

These replace the original 12 ratio values from design.md §3:

| Quarter | Period | Ratio |
|---|---|---|
| FY2024 Q1 | 1 | 1.0861 |
| FY2024 Q2 | 2 | 0.9991 |
| FY2024 Q3 | 3 | 0.9514 |
| FY2024 Q4 | 4 | 0.9588 |
| FY2025 Q1 | 5 | 1.0346 |
| FY2025 Q2 | 6 | 1.0224 |
| FY2025 Q3 | 7 | 0.9560 |
| FY2025 Q4 | 8 | 0.9200 |
| FY2026 Q1 | 9 | 1.0103 |
| FY2026 Q2 | 10 | 1.0384 |
| FY2026 Q3 | 11 | 0.9105 |
| FY2026 Q4 | 12 | 1.0371 |

These differ slightly from the original values because:
1. `include_in_totals=False` rows are now excluded.
2. The enhanced file corrects a small number of source values.

---

## New Departments and Categories (from Synthetic Rows)

10 new dept × category series were added via synthetic rows:

| Department | Budget Category | Synthetic rows |
|---|---|---|
| College of Architecture | Research Operations | 36 (12 quarters × 3 months) |
| College of Business | Consulting & Contracts | 36 |
| College of Engineering | Personnel & Salaries | 36 |
| College of Pharmacy | Personnel & Salaries | 36 |
| Facilities Management | Maintenance & Repairs | 36 |
| Finance & Administration | Administrative Costs | 36 |
| IT Services | Technology & Equipment | 36 |
| Research Institute | Research Operations | 36 |
| Student Affairs | Student Scholarships | 36 |
| University Library | Administrative Costs | 36 |

**Note:** "College of Business" and "College of Business Administration" are distinct
entities in this dataset. Do not merge them.

New budget categories introduced by synthetic rows:
- `Maintenance & Repairs` (Facilities Management only)
- `Administrative Costs` (Finance & Administration + University Library)
- `Technology & Equipment` (IT Services only)
- `Student Scholarships` (Student Affairs only)

New fund source introduced: `Federal` (used exclusively by synthetic rows).

---

## Process Health Columns — Null Pattern

494 of 1,154 rows (43%) have NULL process health columns
(num_spreadsheet_versions, manual_adjustments_count, data_entry_errors,
days_to_produce_report, approval_cycles, stakeholders_involved, confidence_score_1to5).

ALL 494 null-process-health rows are `is_synthetic=False` (non-synthetic).
These are the 2nd and 3rd monthly expansion rows for BUD- records where
the original quarterly record had process health data filled in only once
(for the first monthly row). The 1st monthly row carries the process health data;
rows 2 and 3 for the same source record have NULLs.

**Implication:** Process health views must aggregate at the `source_record_id` level
(one value per BUD- record), NOT at the monthly row level. Taking a mean over all
monthly rows would count the same data entry errors 1× instead of 3× for most records,
but exclude the second/third month's zeros (which are true nulls, not zeros).
The correct approach: `GROUP BY source_record_id` and take the first non-null value
per process health field, then aggregate those deduplicated values by entity.

---

## anomaly_review_status Column

8 distinct values representing the review workflow state of each anomaly:

| Value | Interpretation |
|---|---|
| No Anomaly | Not flagged; no review needed |
| Delayed - No Anomaly | Report delayed; anomaly not triggered |
| Pending Approval | Anomaly flagged; awaiting approval |
| Pending Correction | Anomaly flagged; data correction in progress |
| Delayed - Anomaly Outstanding | Report delayed AND anomaly unresolved |
| Flagged for Historical Review | Anomaly flagged for retrospective analysis |
| Locked - Approved | Anomaly reviewed and approved as legitimate |
| Locked - Type Mismatch Noted | Anomaly type label inconsistent with sign (source data quality issue) |

This column is **informational metadata** — like `source_anomaly_type`, the application
should display it alongside its own detection results but not use it as ground truth.
"Locked - Type Mismatch Noted" is explicit confirmation of the sign-inconsistency
finding from the original profiling.

---

## prior_year_spend Nulls

120 rows have NULL `prior_year_spend_usd`. All 120 are `is_synthetic=True` AND
`fiscal_year=FY2024` — the first year in the dataset for synthetic series, so
no prior-year figure exists. This is expected and not a data quality defect.

---

## forecast_accuracy_pct Range

Enhanced file: min=59.11%, max=100.00%, mean=95.53%.
The mean is very close to the original 95.9%, confirming the column is consistent.
The 100.00% and near-100% values appear in synthetic rows (forecast very close to actual).
The min of 59.11% is lower than the original 14.5% max-gap figure — some synthetic rows
have a larger forecast-actual gap, meaning the source forecast is less suspicious for
synthetic rows (which were generated with a realistic gap distribution).

---

## Implications for the Technical Design

### Must address in design revision:

1. **`include_in_totals` filter**: ALL aggregate queries must add `WHERE include_in_totals = TRUE`.
   This is a new required filter for every DuckDB query in §3.1, §4, §5, and §6.

2. **Monthly grain**: The canonical schema now has a `month` DATE field.
   Forecasting operates at the quarterly level (aggregate monthly rows to quarter before
   fitting models). The ingestion pipeline must support both quarterly-grain and
   monthly-grain source files.

3. **Process health deduplication**: `get_reporting_health` must aggregate by
   `source_record_id` (or equivalently, by the first monthly row per BUD- group),
   not by row count.

4. **New entity dimensions**: 21 departments (up from 16), 14 budget categories (up from 10),
   7 fund sources (up from 6). Entity counts in R1-05 validation report must be dynamic,
   not hardcoded.

5. **`anomaly_review_status`**: Carry as metadata column. Display in anomaly table alongside
   `source_anomaly_type`. Do not use as ground truth for detection.

6. **Synthetic row handling**: The application should accept `is_synthetic` as a filter
   option for analysis (allow users to optionally exclude synthetic rows from views).
   Forecasting should include synthetic rows by default (they extend series), but the
   UI should label which entity × category series contain synthetic data.

7. **Quarterly ratio values updated**: The 12 ratio values in the forecasting section
   must use the enhanced-file values (listed above) as the authoritative time series.

8. **`source_record_id` linkage**: The anomaly drill-down (R2-08) should show
   `source_record_id` (the original BUD- ID) alongside `record_id` (the M- ID) so
   users can cross-reference with the original file.

### Does NOT invalidate ground truth:

- The 17 rows with |variance_pct| ≥ 30% are still the same BUD- source records,
  confirmed by source_record_id match. Ground truth in tests/ground_truth.md remains
  authoritative for the non-synthetic subset.
- Persistent pattern analysis should be run on `include_in_totals=True` rows only.
  The direction of persistent patterns (C&C over, Travel under, etc.) is not expected
  to change materially, but exact per-year percentages will shift slightly.
- BUD-00018 inconsistency still present: M-000048 (Graduate College, Facility
  Maintenance, FY2025 Q3) has budgeted=$2,000, actual=$2,000, variance_usd=$0.00,
  variance_pct=0.00%. Note: in the enhanced file, variance_pct=0.0 (correctly 0),
  which differs from the original file's −2.1. The BUD-00018 DQ finding may no longer
  apply to the enhanced file — the inconsistency appears to have been corrected.
  The design should check this dynamically rather than hardcoding the BUD-00018 flag.

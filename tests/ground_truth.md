# Ground Truth — Budget Forecasting Analyst

All values in this file were computed from `data/Team6Dataset.xlsx`, sheet
`Budget_Forecast_Data`, using pandas + openpyxl. This file is the authoritative
reference for reconciliation tests.

---

## 1. Anomaly Detection Method

The intended anomaly detection method is **median/MAD (Median Absolute Deviation)
on variance_pct within peer groups**.

Procedure:
1. For each record, compute its peer group by matching on `category` (same budget
   category across all departments and years).
2. Compute the median and MAD of `variance_pct` within that peer group.
3. Compute a modified Z-score: `z = 0.6745 × (variance_pct − median) / MAD`
   (the 0.6745 factor makes MAD consistent with σ for a normal distribution).
4. If |z| exceeds a configurable sensitivity threshold (default: 2.5), the record
   is flagged as an anomaly.
5. If MAD = 0 for a peer group (all records have identical variance_pct), fall back
   to a comparison against a secondary peer group by `department`.

The source column `anomaly_detected` is **NOT used as ground truth**. It is carried
as `source_anomaly_flag` for lineage and displayed alongside the system's own flag,
but reconciliation tests assert against the computed flag, not the source flag.

Rationale for median/MAD over mean/σ: the dataset contains hard-capped values at
±50 variance_pct (2 rows at −50) which would distort a mean-based detector. MAD is
robust to these outliers.

Sensitivity parameter: the threshold (default 2.5) is configurable. At the default
sensitivity the system must flag all 17 rows listed in section 2 with no more than
5 additional record-level flags (per acceptance criterion AC in requirements.md).

---

## 2. Rows with |variance_pct| ≥ 30 (17 rows)

Computed value: exactly **17 rows** have |variance_pct| ≥ 30. Sorted ascending by
variance_pct.

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

Additional thresholds:
- Rows with |variance_pct| ≥ 25: **38**
- Rows with |variance_pct| ≥ 30: **17** (listed above)
- The +50 cap is never reached (maximum positive value is +47.0)
- The −50 cap is reached by 2 rows (BUD-00237 and BUD-00189)

---

## 3. Persistent Patterns

Rule applied: an entity (category or department) qualifies as a persistent pattern
when `(sum(actual) / sum(budget) − 1) × 100` exceeds ±5% in **at least 2 of the
3 available fiscal years (FY2024, FY2025, FY2026)**, with the same sign in both
qualifying years.

Per-year variance is computed as a single aggregate over all records for that
entity × fiscal year combination (not per-record average).

### Persistently Over-Budget Categories

(≥ +5% in ≥ 2 of 3 years)

| Category | FY2024 | FY2025 | FY2026 | Qualifying Years |
|---|---|---|---|---|
| Consulting & Contracts | +16.1% | +13.9% | +14.7% | All 3 |
| Equipment & Technology | +1.0% | +5.8% | +10.9% | FY2025 + FY2026 |
| Facility Maintenance | +10.5% | +6.1% | −13.1% | FY2024 + FY2025 |
| Student Aid & Scholarships | −1.3% | +7.2% | +10.8% | FY2025 + FY2026 |

Note: Facility Maintenance reverses sharply in FY2026 (−13.1%), so the persistent
over-budget label covers FY2024 and FY2025 only. The dashboard should display this
as "persistent in 2 of 3 years" and call out the FY2026 reversal.

### Persistently Under-Budget Categories

(≤ −5% in ≥ 2 of 3 years)

| Category | FY2024 | FY2025 | FY2026 | Qualifying Years |
|---|---|---|---|---|
| Travel & Conferences | −17.9% | −14.1% | −9.8% | All 3 |
| Professional Development | −14.1% | −14.1% | −10.4% | All 3 |
| Administrative Overhead | −22.5% | −7.1% | −5.0% | All 3 (FY2026 at threshold) |
| Research Operations | −4.4% | −5.1% | −13.6% | FY2025 + FY2026 |

Note: Research Operations FY2024 (−4.4%) is below the 5% threshold, so only
FY2025 and FY2026 qualify. The FY2024 value is shown for context.

Note: Administrative Overhead FY2026 is exactly −5.0% (at the boundary). The rule
uses a strict ≤ −5% criterion, so −5.0% qualifies.

### Persistently Over-Budget Departments

(≥ +5% in ≥ 2 of 3 years)

| Department | FY2024 | FY2025 | FY2026 | Qualifying Years |
|---|---|---|---|---|
| College of Architecture | +14.2% | +13.5% | +11.9% | All 3 |
| College of Pharmacy | +7.4% | +15.2% | +7.7% | All 3 |
| Office of Research | +6.8% | +2.9% | +9.7% | FY2024 + FY2026 |
| College of Applied Health Sciences | +14.3% | +8.6% | −18.1% | FY2024 + FY2025 |
| College of Liberal Arts & Sciences | +9.3% | −4.8% | +5.0% | FY2024 + FY2026 |

Notes:
- Office of Research FY2025 (+2.9%) is below threshold; FY2024 and FY2026 qualify.
- College of Applied Health Sciences reverses sharply in FY2026 (−18.1%); the
  persistent over-budget label covers FY2024 + FY2025 only.
- College of Liberal Arts & Sciences FY2026 is exactly +5.0% (at threshold boundary).
  FY2025 (−4.8%) does not qualify (wrong sign and below threshold).

### Persistently Under-Budget Departments

(≤ −5% in ≥ 2 of 3 years)

| Department | FY2024 | FY2025 | FY2026 | Qualifying Years |
|---|---|---|---|---|
| College of Education | −5.9% | −20.3% | +2.0% | FY2024 + FY2025 |
| College of Medicine | −18.9% | +5.8% | −26.4% | FY2024 + FY2026 |
| College of Nursing | +8.5% | −19.9% | −8.7% | FY2025 + FY2026 |
| College of Urban Planning | −17.5% | +1.7% | −9.0% | FY2024 + FY2026 |
| Graduate College | +6.4% | −10.9% | −13.3% | FY2025 + FY2026 |
| College of Business Administration | −13.1% | +6.1% | −5.0% | FY2024 + FY2026 |

Notes:
- College of Education FY2026 (+2.0%) does not qualify; FY2024 and FY2025 qualify.
- College of Medicine FY2025 (+5.8%) is over budget and does not qualify.
- College of Urban Planning FY2025 (+1.7%) does not qualify.
- Graduate College FY2024 (+6.4%) is over budget.
- College of Business Administration FY2026 is exactly −5.0% (at threshold boundary).
  FY2025 (+6.1%) does not qualify (wrong sign).

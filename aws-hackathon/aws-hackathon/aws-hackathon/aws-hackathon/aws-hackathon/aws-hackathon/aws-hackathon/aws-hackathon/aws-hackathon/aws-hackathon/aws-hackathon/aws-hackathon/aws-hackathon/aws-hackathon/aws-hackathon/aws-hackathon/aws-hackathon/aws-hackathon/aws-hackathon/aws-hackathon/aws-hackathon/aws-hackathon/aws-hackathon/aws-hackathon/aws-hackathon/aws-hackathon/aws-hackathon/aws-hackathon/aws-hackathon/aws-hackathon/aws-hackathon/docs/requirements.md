# Budget Forecasting Analyst — Requirements Document

**Format:** EARS (Easy Approach to Requirements Syntax)  
**Status:** APPROVED  
**Date:** 2026-10-08  
**Project:** AWS Hackathon — Budget Forecasting Analyst

---

## Glossary

| Term | Definition |
|------|------------|
| **Entity** | A grouping used for analysis: Total, Department, Category, Fund Source. Department × Category is valid for variance/anomaly views only, never for forecasting. |
| **Period** | A fiscal quarter, identified by fiscal_year + fiscal_quarter (e.g., FY2024 Q1). period_index 1–12 is derived. |
| **Source forecast** | The `forecasted_amount_usd` column from the ingested file. Treated as a benchmark only; not used as model input. |
| **Our forecast** | A forecast produced by the application's statistical models. |
| **Grounding check** | Post-generation verification that every numeric value in an LLM-authored narrative traces to a tool result from the same turn. |
| **Persistent pattern** | An entity whose variance has the same sign in at least 2 of 3 fiscal years and exceeds a configured threshold. |
| **Replay mode** | An operational mode where recorded tool traces and model responses are served instead of live Bedrock calls. |
| **CV error** | Cross-validation error (MAE and sMAPE) from rolling-origin evaluation. |
| **Canonical schema** | The internal normalized representation of ingested data (see R1). |

---

## System-Level Requirements

### SYS-01 — Core Design Invariant (Non-Negotiable)

The LLM **shall never** compute, estimate, or recall numeric values. All figures **shall** originate from deterministic code (DuckDB queries or statistical models) invoked as tools. Every number appearing in any LLM-authored narrative or chat response **shall** trace to a tool result produced in the same conversational turn.

### SYS-02 — Configuration

The system **shall** read all secrets and environment-specific parameters (Bedrock model ID, AWS credentials, replay mode flag, database paths) from environment variables. No secrets or hardcoded model identifiers **shall** appear in source code or committed configuration files.

### SYS-03 — Logging

The system **shall not** write financial figures (dollar amounts, percentages derived from financial data) to application logs.

### SYS-04 — Typed Interfaces

Every API endpoint and every tool schema **shall** have typed request and response models using Pydantic.

### SYS-05 — Bedrock Resilience

When the Bedrock API is called, the system **shall** enforce a per-call timeout, retry with exponential backoff on transient errors, and display a clear user-facing error state if all retries are exhausted.

### SYS-06 — Streaming

When the system generates a chat response, the first token **shall** appear in the browser within a few seconds on the demo dataset, delivered via Server-Sent Events.

---

## R1 — Ingestion

### R1-01 — File Upload

**When** a user uploads a CSV or XLSX file, the system **shall** auto-detect the file format and proceed to column mapping without requiring the user to specify the format.

### R1-02 — Column Mapping UI

**When** a file is uploaded, the system **shall** display a column mapping interface that auto-suggests mappings from uploaded column names to canonical schema fields and allows the user to correct any suggestion before confirming.

### R1-03 — Required Fields

**When** a user confirms a column mapping, the system **shall** reject the mapping if any of the following minimum required fields are unmapped: a period indicator (fiscal year + fiscal quarter, or a date convertible to fiscal quarter), department, category, budget amount, actual spend.

### R1-04 — Optional Fields

**When** optional fields (fund_source, report_type, report_status, reporting-process columns, prior_year_actual, source_forecast, source_anomaly_flag, source_anomaly_type) are absent or unmapped, the system **shall** continue with reduced functionality and display a notice identifying which views are unavailable (e.g., "Process health view unavailable: reporting-process columns not mapped").

### R1-05 — Validation Report

**When** a file is loaded into the system, the system **shall** produce a validation report containing at minimum: total row count, count of rows accepted, count of rows flagged or rejected with reasons, fiscal period range found, entity counts (departments, categories, fund sources), derived-column reconciliation results (variance_usd = actual − budget, yoy_change_pct = actual / prior_year − 1, forecast_accuracy_pct = 100 − |forecast − actual| / actual), count of non-unique natural keys (department + category + fiscal_year + fiscal_quarter), and count of source anomaly flag vs variance sign disagreements.

### R1-06 — Explicit Data Quality Findings

**When** any of the following data quality conditions are present in the loaded file, the system **shall** surface them explicitly in the validation report rather than silently correcting them:

- (a) Rows where `variance_usd` is 0.0 but `variance_pct` is non-zero (e.g., BUD-00018).
- (b) Duplicate natural keys (same department + category + fiscal_year + fiscal_quarter).
- (c) Source anomaly flag/type inconsistent with variance sign.
- (d) Source forecast appearing suspiciously close to actuals (mean absolute gap < 5%), with a note that it may be post-hoc.

### R1-07 — No Silent Row Drops

**When** a row cannot be loaded (missing required field, unparseable value), the system **shall** include that row in the validation report with the reason; it **shall not** silently drop it.

### R1-08 — Duplicate Key Acceptance

**When** a loaded file contains rows with duplicate natural keys, the system **shall** accept the file with a warning in the validation report rather than rejecting it. `record_id` **shall** remain the primary key.

### R1-09 — DuckDB Load

**When** a file passes validation, the system **shall** load the canonical schema into a DuckDB instance, with one DuckDB database per dataset.

### R1-10 — Multiple Datasets

The system **shall** support multiple loaded datasets and **shall** display a dataset selector that allows the user to switch the active dataset.

### R1-11 — Sample Data

**When** no dataset has been loaded, the system **shall** display a "Load sample data" button that loads the bundled `data/Team6Dataset.xlsx` file using the same ingestion pipeline as a user upload (including the validation report).

### R1-12 — Canonical Schema

The internal canonical schema **shall** contain the following fields derived from the ingested file: `record_id`, `department`, `category`, `fiscal_year`, `fiscal_quarter`, `period_index` (derived 1–12), `fund_source`, `report_type`, `report_status`, `budget`, `actual`, `source_forecast`, `source_variance`, `prior_year_actual`, `source_anomaly_flag`, `source_anomaly_type`, `num_spreadsheet_versions`, `manual_adjustments_count`, `data_entry_errors`, `days_to_produce_report`, `approval_cycles`, `stakeholders_involved`, `confidence_score_1to5`. The design document **shall** include the mapping from source column names to canonical names.

---

## R2 — Variance, Trend and Anomaly Analysis

### R2-01 — Entity Levels for Analysis

The system **shall** support variance and anomaly analysis at four entity levels: Total, Department, Category, and Fund Source. It **shall** also support Department × Category for variance and anomaly views. It **shall not** generate forecasts for Department × Category (see R3-02).

### R2-02 — Record-Level Anomaly Detection

**When** anomaly detection is run on an entity, the system **shall** apply a robust statistical method (median/MAD or IQR) to `variance_pct` and `yoy_change_pct`, evaluated against peer groups (same category, then same department) with a configurable sensitivity parameter. Each detected anomaly record **shall** include: `record_id`, entity, period, actual, budget, expected value, deviation, severity score, and the rule that fired.

### R2-03 — Source Flag Independence

The system **shall not** use the source `anomaly_detected` flag or `anomaly_type` column as ground truth or as model training labels. These **shall** be stored as "source flag" columns and displayed alongside the application's own detection results.

### R2-04 — Detector vs Source Flag Agreement Panel

The dashboard **shall** include a panel showing the agreement between the application's anomaly detector and the source flag, with counts for: true positives, false positives (flagged by source, not by application), false negatives (flagged by application, not by source), and true negatives. The panel numbers **shall** be verifiable by a pytest assertion.

### R2-05 — Aggregate Trend View

The dashboard **shall** display a quarterly actual vs budget chart per entity with a simple trend line. Where an entity has at least 8 quarters of data, an STL decomposition **may** be shown. Where fewer than 8 quarters are available, only a plain trend line **shall** be shown, with a visible note explaining why STL is not available.

### R2-06 — Persistent Pattern Detection

The system **shall** flag any entity whose variance has the same sign in at least 2 of the 3 available fiscal years and exceeds a configurable threshold as a "persistent pattern." Entities meeting a one-time threshold but not the persistence criterion **shall** be labeled "one-time outlier." Both labels **shall** be surfaced in dashboard outputs and in LLM narration.

### R2-07 — Dashboard KPIs

The dashboard **shall** display summary KPIs including at minimum: total actual vs budget variance (dollar and percent, by fiscal year), top over-budget and under-budget departments and categories, count of anomalies detected, and count of rows with source-flag disagreement.

### R2-08 — Anomaly Table

The dashboard **shall** include an anomaly table with drill-down to the underlying source rows for each detected anomaly, showing the fields defined in R2-02.

---

## R2b — Reporting Process Health

### R2B-01 — Process Health View

**When** reporting-process columns are present, the system **shall** provide a process health view summarizing by department, report_type, and report_status: average spreadsheet versions, average manual adjustments, average data entry errors, average days to produce, average approval cycles, count of rows with at least one data entry error, and share of Delayed reports.

### R2B-02 — No Causal Claims

**When** the system generates any narration or display text about reporting process metrics, it **shall not** assert or imply causal relationships between process columns and variance size. All process health narration **shall** be framed as descriptive statistics only. A test **shall** assert that the system prompt and process-health tool output carry an explicit "descriptive only" note.

### R2B-03 — Process Health Tool

The system **shall** expose a `get_reporting_health` tool (see R5) returning the statistics defined in R2B-01 for a specified grouping.

---

## R3 — Forecasting

### R3-01 — Forecastable Entities

The system **shall** produce forecasts for the following entity levels: Total, each Department, each Category, each Fund Source. It **shall not** produce forecasts for Department × Category combinations.

### R3-02 — Department × Category Refusal

**When** a forecast is requested for a Department × Category combination (via dashboard or chat), the system **shall** return a clear refusal that states the reason (insufficient history; Department × Category pairs average 2.2 rows of data).

### R3-03 — Forecast Horizon

The default forecast horizon **shall** be 4 quarters (FY2027 Q1–Q4). The system **shall** allow the user to configure the horizon up to 8 quarters.

### R3-04 — Permitted Models

The system **shall** use only the following model families for forecasting: Naive, Seasonal Naive (only where ≥ 8 quarters of history exist), Drift, ETS (non-seasonal and damped trend only), and Linear Trend. Deep learning models and Prophet **shall not** be used.

### R3-05 — Model Selection

The system **shall** select the best model per entity and target via rolling-origin cross-validation with a minimum training window of 8 quarters (yielding at most 4 folds). Selection **shall** be scored by MAE and sMAPE. The selected model name and its CV error **shall** be stored with the forecast results.

### R3-06 — Forecast Target

The system **shall** document the choice of forecast target in the design document, based on profiling results and CV error. The candidate targets are: (a) spend-vs-budget ratio per quarter, (b) mean actual per record per quarter, (c) total actual per quarter. Options (a) and (b) mitigate the row-count problem documented in the data profile. Option (c) **shall** always be accompanied by a visible coverage caveat stating that quarterly row counts vary from 12 to 33.

### R3-07 — Prediction Intervals

Every forecast **shall** include 80% and 95% prediction intervals. Intervals **shall** be presented honestly wide and **shall not** be artificially narrowed for presentation.

### R3-08 — Confidence Labels

Every entity forecast **shall** carry a confidence label of High, Medium, or Low based on: number of quarters of history, CV error, and interval width. Any entity with fewer than 8 quarters of data, or with high CV error, **shall** be labeled Low. College of Liberal Arts & Sciences **shall** be labeled Low (6 quarters of history).

### R3-09 — Forecast Persistence

Forecast results (point forecast, intervals, model name, CV error, confidence label) **shall** be persisted in DuckDB so that the dashboard and chat tools read from the same stored values.

### R3-10 — Source Forecast Benchmark Panel

The dashboard **shall** include a benchmark panel comparing the application's CV error against the source forecast's reported forecast_accuracy_pct. The panel **shall** display a caveat stating that the source forecast may not be a true ex-ante forecast (see data quality finding #2).

---

## R4 — Variance Explanation

### R4-01 — Variance Query

The system **shall** support querying budget vs actual (and vs source forecast) variance for any entity at any period or period range.

### R4-02 — Variance Decomposition

The system **shall** provide a structured variance decomposition for any entity/period query that attributes the variance to: top contributing departments or categories (by variance_usd), top contributing fiscal quarters, top contributing individual records (by variance_usd, with record_ids), share of variance explained by persistent patterns vs one-time outliers, and fund_source split.

### R4-03 — LLM Narrative

**When** a variance decomposition is produced, the system **shall** pass the structured decomposition to the LLM to generate a plain-language explanation. The LLM **shall** be instructed to frame any causal claim beyond what the data shows as a hypothesis. The narrative and the structured data it was built from **shall** be stored together.

### R4-04 — Grounding on Narratives

All numeric values in any LLM-authored narrative — whether produced via the chat interface (R5) or as a standalone variance explanation (R4-03) — **shall** pass the grounding check defined in R5-07. The grounding check applies to both contexts without exception.

---

## R5 — Conversational Analyst

### R5-01 — Chat Interface

The system **shall** provide a chat interface with streaming responses backed by Bedrock tool use via the Converse API.

### R5-02 — Tool Set

The system **shall** implement the following tools with strict JSON schemas and Pydantic-typed request/response models:

| Tool | Description |
|------|-------------|
| `list_entities` | Returns departments, categories, fund sources, fiscal periods, datasets, and row counts per entity |
| `query_actuals` | Filters on any dimension, supports group-by and period range; returns rows with budget, actual, variance |
| `run_forecast` | Entity level + name, horizon, target; returns persisted or freshly computed forecast; refuses for Department × Category with the data constraint as the stated reason |
| `detect_anomalies` | Entity, sensitivity; returns record-level anomalies and persistent patterns |
| `compare_periods` | Entity, period A, period B; returns raw figures for both periods **and** pre-computed deltas (dollar and percent). All arithmetic **shall** be performed by the tool, not by the LLM. |
| `explain_variance` | Entity, period or period range; returns structured decomposition (R4-02) |
| `get_reporting_health` | Grouping; returns R2b statistics |

### R5-03 — Multi-Step Tool Use

The system **shall** support multi-step tool use within a single conversational turn (agent loop). The agent loop **shall** enforce a maximum iteration cap to prevent infinite loops.

### R5-04 — Evidence Panel

Every chat response **shall** include an expandable "sources" panel listing the tool calls made and their results during that turn, including `record_id` values where relevant. Inline charts **shall** be rendered where useful.

### R5-05 — System Prompt Constraints

The system prompt **shall** instruct the model to: (a) refuse to answer numeric questions without first making a tool call, (b) state when data is insufficient to answer a question, (c) state when a series is too short to forecast, (d) label causes it cannot support from the data as hypotheses, and (e) treat all process health statistics as descriptive only with no causal claims.

### R5-06 — Conversation History

The system **shall** maintain conversation history per session. Tool results **shall not** be re-sent in full on later turns where a summary of the earlier result suffices.

### R5-07 — Grounding Check

**After** the model produces a response in any turn, the system **shall** extract numeric values (dollar amounts, percentages, counts, fiscal periods) from the response and verify each against the tool results produced in that turn (allowing rounding and unit formatting such as "$1.2M" for 1,203,552.4). Any number that fails verification **shall** cause the response to be flagged visibly in the UI and logged. A test harness **shall** inject a fabricated number into a model response and assert that the grounding flag triggers.

### R5-08 — Insufficient Data Response

**When** the user asks about an entity that does not exist in the loaded dataset, the system **shall** return an "insufficient data" response and **shall not** produce a guess or fabricated figure.

---

## R6 — Demo Reliability

### R6-01 — Replay Mode

**When** the environment variable controlling replay mode is set to true, the system **shall** serve pre-recorded tool traces and model responses for all scripted demo prompts rather than making live Bedrock API calls.

### R6-02 — Scripted Demo Path

The replay mode **shall** cover the following seven prompts in order, with results consistent with the known data profile:

1. "Which departments are furthest over budget, and by how much?" — Expected: Architecture, Pharmacy, Office of Research with their variance figures.
2. "Why is Consulting & Contracts over budget?" — Expected: persistent ~14–16% overrun in every fiscal year; largest contributor Office of Research; narration labels it a persistent pattern.
3. "Where are we consistently underspending?" — Expected: Travel & Conferences, Professional Development, Administrative Overhead.
4. "What is the FY2027 forecast for total spend versus budget, and how confident are you?" — Expected: intervals, model name, CV error, confidence label, coverage caveat.
5. "Which individual records are the biggest outliers?" — Expected: the 17 rows with |variance_pct| ≥ 30%, shown with record_ids and the detector-vs-source-flag note.
6. "How long do reports take to produce, and where are the errors?" — Expected: process-health stats, no causal claims.
7. A deliberately unanswerable question ("What did the Bursar's office spend on travel?") — Expected: insufficient-data response, no guess.

### R6-03 — Demo Without Credentials

**When** replay mode is active, the system **shall** complete the full scripted demo path without requiring AWS Bedrock credentials.

---

## NFR — Non-Functional Requirements

### NFR-01 — Packaging

The system **shall** be runnable locally via `docker-compose up` using a `.env` file populated from the committed `.env.example`.

### NFR-02 — README

The repository **shall** include a README containing: run instructions, an architecture diagram, a "how grounding works" section, and a "data caveats" section summarizing the known data quality problems.

### NFR-03 — Profiling Step

The first implementation task after requirements approval **shall** be a data profiling step that loads `data/Team6Dataset.xlsx`, re-verifies every claim in the data profile section of this document, writes findings to the design document (including any statement that turns out to be incorrect), and establishes the canonical schema mapping.

### NFR-04 — Test Fixture

The repository **shall** include a trimmed test fixture of approximately 60 rows covering every department, category, and fund source, including record BUD-00018 and at least one duplicate-key pair. Pytest tests **shall not** depend on the full 300-row file except for reconciliation tests.

### NFR-05 — Reconciliation Tests

Pytest **shall** include reconciliation tests that load the full `data/Team6Dataset.xlsx` and assert: 300 rows, 16 departments, 10 categories, 6 fund sources, per-fiscal-year variance percentages (FY2024 −1.0%, FY2025 −2.6%, FY2026 −3.1%), per-category variance percentages (Consulting & Contracts ≈ +14.8%, Travel & Conferences ≈ −14.8%, etc.), and per-department variance percentages (College of Architecture ≈ +13.5%, College of Education ≈ −10.9%, etc.).

### NFR-06 — Ground Truth Document

`tests/ground_truth.md` **shall** document: (a) the anomaly detection method, (b) the list of every row with |variance_pct| ≥ 30% (17 rows expected), (c) the persistent patterns (at minimum Consulting & Contracts over, Travel & Conferences under). At default sensitivity the dashboard **shall** flag every item on that list with no more than 5 additional record-level flags.

### NFR-07 — Accessibility

Frontend UI **shall** follow WCAG 2.1 AA guidelines for color contrast, keyboard navigation, and screen-reader labels on all interactive elements and chart components. (Full validation requires manual testing with assistive technologies.)

---

## Acceptance Criteria (Traceability)

| AC | Requirement(s) |
|----|---------------|
| AC1 — Reconciliation: loading sample file reproduces the 300-row profile | R1-05, NFR-05 |
| AC2 — Anomaly ground truth: 17 rows ≥ 30%, persistent patterns documented, ≤5 extra flags at default sensitivity | R2-02, R2-06, NFR-06 |
| AC3 — Detector-vs-source-flag panel present and pytest-verified | R2-04 |
| AC4 — Forecasts exist for total/all departments/all categories/all fund sources with intervals, model, CV error, confidence label; Lib Arts & Sciences = Low; dept×category returns clear refusal | R3-01, R3-02, R3-05, R3-07, R3-08 |
| AC5 — "Why is C&C over budget?" answer passes grounding check with visible tool trace and persistent-pattern label | R5-03, R5-04, R5-07, R2-06 |
| AC6 — Fabricated number test: grounding flag triggers | R5-07 |
| AC7 — Bursar question returns insufficient-data response, not a guess | R5-08 |
| AC8 — Replay mode completes full scripted demo without Bedrock credentials | R6-01, R6-02, R6-03 |
| AC9 — Bad period column → validation report, not crash; duplicate natural keys → accepted with warning | R1-05, R1-07, R1-08 |
| AC10 — Process-health answer makes no causal claim; system prompt and tool output carry "descriptive only" note | R2B-02, R5-05 |

---

## Out of Scope

The following are explicitly excluded from this release:

- Authentication, SSO, or user management
- Multi-tenant data isolation
- Real ERP or financial system integration
- Write-back to source systems
- **Department × Category forecasting** — not a product decision, but a data constraint. The 134 Dept × Category pairs average 2.2 rows each, which is far below the 8-quarter minimum training window required for any defensible rolling-origin CV. Any forecast at this granularity would be statistically meaningless. The application refuses such requests and explains this reason (R3-02); descriptive variance and anomaly analysis at Dept × Category granularity remains fully supported.
- Deep learning models or Prophet for forecasting

---

## Stretch Goals (post-R1–R6 only)

- **Scenario planner:** adjustable drivers (hiring freeze on Personnel & Salaries, inflation %, consulting spend cap, one-time expense) producing base/optimistic/pessimistic cases, exposed as a `run_scenario` tool. Scenarios apply driver adjustments on top of the stored forecast and **shall** be labeled as assumption-based.
- **Export:** XLSX/PDF export including LLM narrative.

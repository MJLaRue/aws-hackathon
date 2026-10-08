# Handoff — Budget Forecasting Analyst

**Last updated:** 2026-10-08  
**Workflow ID (active):** `wf_29eecd0b93b1b8e5`  
**Session context:** Design phase — iterating toward an approved technical design before any code is written.

---

## What this project is

A university budget forecasting analyst demo app for an AWS hackathon.  
Stack: **Python 3.12 / FastAPI / DuckDB / statsmodels+statsforecast / AWS Bedrock Converse API / React+TypeScript+Vite / Recharts / SSE / Docker-compose (local) + AWS CDK (production)**.

Full requirements are in `docs/requirements.md` (APPROVED — do not modify).  
Profiling findings and verified numeric ground truth are in `docs/design.md` and `tests/ground_truth.md`.  
The enhanced dataset is `data/Team6Dataset_Enhanced 1.xlsx`.

---

## Current state

### Design phase — in progress

A multi-step design loop (`wf_29eecd0b93b1b8e5`) is running. It cycles through:
1. `wf-design` authors `docs/technical-design.md`
2. `assumption-challenger` (wf-design-reviewer with custom persona) reviews it → `docs/assumption-challenger-findings.md`
3. `wf-design-reviewer` (mechanical) → `docs/design-review.md` + `docs/design-review.json`
4. `wf-design` revises if verdict = REVISE_REQUIRED

**Revision 2 is done** (1913 lines). The second assumption-challenger + mechanical pass has completed with `REVISE_REQUIRED` (7 findings — 2 HIGH, 5 MEDIUM). `revise-design-v2` is queued or running to address them.

**Outstanding findings (Revision 2 → Revision 3):**

| # | Sev | Title |
|---|---|---|
| HIGH-01 | HIGH | `ValidationReport` Pydantic model never defined — R1-05 requires 7 typed fields; tests reference fields that don't exist |
| HIGH-02 | HIGH | `stl_note` field re-used for "dollar forecast unavailable" message — structural LLM grounding gap (SYS-01 risk) |
| MED-01 | MEDIUM | `anomaly_results` DDL absent — anomaly persistence table never specified |
| MED-02 | MEDIUM | `KpiResponse` missing `fiscal_year_summary` — R2-07 requires top over/under by year |
| MED-03 | MEDIUM | Plain trend line fallback for STL-ineligible entities unspecified (R2-05) |
| MED-04 | MEDIUM | Derived-column reconciliation SQL missing from validation report spec (R1-05) |
| MED-05 | MEDIUM | `ColumnMappingProposal` / `ColumnMappingRequest` schemas undefined — SYS-04 violation |

The loop will run up to 2 more iterations. Stop condition: `docs/design-review.json` → `{"verdict": "APPROVED"}` or `{"verdict": "APPROVED_WITH_ADVISORIES"}`.

### What is NOT started yet

- Implementation tasks (`tasks.json`) — planned after design approval
- Any application source code
- CDK infra code (`infra/`)
- Test fixtures

---

## Key decisions (locked — do not revisit)

| Decision | Value |
|---|---|
| Forecast target | Spend-vs-budget ratio = `sum(actual)/sum(budget)` per quarter, `include_in_totals=TRUE` rows only |
| Anomaly detection | Median/MAD on `variance_pct` within category peer group; modified Z-score `z = 0.6745 × (v−median)/MAD`; threshold 2.5 (configurable) |
| Persistent pattern rule | Same sign AND exceeds ±5% in ≥ 2 of 3 fiscal years |
| No Dept×Category forecasting | Average 2.2 rows per pair — below 8-quarter CV minimum |
| No Prophet / no deep learning | Permitted: Naive, Seasonal Naive (≥8q), Drift, ETS, Linear Trend only |
| STL gated at ≥ 8 quarters | T&C = 7q → plain trend only; CLAS = 6q → plain trend only |
| LLM grounding | SYS-01 absolute — LLM never computes or recalls numbers; every numeric traces to a tool result |
| Deployment | Local: docker-compose; Production: AWS CDK (Fargate + EFS + S3 + CloudFront + ALB + SSM) |
| Serverless | Rejected for main API — SSE streaming + DuckDB persistence require Fargate |
| AWS credentials | Never stored in repo; IAM task role for AWS services; `.env` for local dev only |

---

## Dataset facts (verified)

**Original file:** `data/Team6Dataset.xlsx` — 300 rows, 25 cols, quarterly grain, BUD-00001–BUD-00300.  
**Enhanced file:** `data/Team6Dataset_Enhanced 1.xlsx` — 1,154 rows, 30 cols, monthly grain.

Enhanced file key facts (see `docs/enhanced-dataset-profile.md` for full detail):
- `include_in_totals=FALSE` on 7 rows — ALL aggregate queries MUST filter `WHERE include_in_totals = TRUE`
- 360 synthetic rows (`is_synthetic=TRUE`) for 10 new dept×category series
- 5 new columns: `source_record_id`, `is_synthetic`, `include_in_totals`, `month`, `anomaly_review_status`
- 21 departments (up from 16), 14 categories (up from 10), 7 fund sources (up from 6, adds Federal)
- Process health columns NULL on rows 2–3 of each BUD- monthly expansion — deduplicate to `source_record_id` before aggregating
- BUD-00018 inconsistency **appears corrected** in enhanced file — DQ check must be dynamic, not hardcoded
- 17 ground-truth outlier rows confirmed present by `source_record_id` match

---

## File map

```
docs/
  requirements.md              ← APPROVED requirements (EARS format) — do not modify
  design.md                    ← Profiling findings + verified numerics + demo ground truth
  technical-design.md          ← THE DESIGN (active — being revised by workflow)
  assumption-challenger-findings.md  ← Latest challenger report (overwritten each iteration)
  design-review.md             ← Latest mechanical review (overwritten each iteration)
  design-review.json           ← Machine-readable verdict {"verdict": "..."}
  enhanced-dataset-profile.md  ← Enhanced dataset schema changes and implications
  aws-cdk-requirements.md      ← CDK deployment spec (Fargate, EFS, S3, CF, ALB, SSM, IAM)
tests/
  ground_truth.md              ← 17 outlier rows + persistent patterns (authoritative)
data/
  Team6Dataset.xlsx            ← Original 300-row quarterly file
  Team6Dataset_Enhanced 1.xlsx ← Enhanced 1,154-row monthly file (USE THIS)
.kiro/
  agents/
    assumption-challenger.md   ← Custom reviewer agent persona
```

---

## Next steps (after design is approved)

1. **Check workflow status** — inspect `docs/design-review.json`. If `"verdict"` is `"APPROVED"` or `"APPROVED_WITH_ADVISORIES"`, the design phase is done. If `"REVISE_REQUIRED"`, the loop is still iterating (or exhausted — check workflow with `inspect_workflow wf_29eecd0b93b1b8e5`).

2. **Run the planner** — once design is approved:
   ```
   run_workflow bundled://investigate  (brief: decompose technical-design.md into tasks.json)
   ```
   Or use `wf-planner` via `agent://wf-planner` with the design + requirements as context.
   Output: `tasks.json` at repo root — ordered implementation checklist, end-to-end slice first.

3. **Implementation** — use `bundled://ralph` or a `workflowPrompt` with parallel backend + frontend tracks, each with a `semantic_reviewer` gate.
   - Backend track: FastAPI, DuckDB ingestion, tools, grounding check, SSE, replay mode
   - Frontend track: React+Vite, Recharts, chat UI, sources panel, KPI panel, anomaly table
   - QA track (after both): functional QA + security + accessibility + assumption-challenger second pass on QA results

4. **CDK infra** — implement `infra/` after core app is working locally. AWS credentials will be supplied by the user at deploy time via env vars — never store them.

5. **Demo** — 7 scripted prompts (R6-02). Ground truth in `docs/design.md` §5. Replay mode must work without Bedrock credentials.

---

## Resuming the active workflow

If the workflow `wf_29eecd0b93b1b8e5` is still running when you start:
- Check: inspect_workflow wf_29eecd0b93b1b8e5
- It will notify you via send_message when steps complete
- Do not re-launch a new design workflow — the existing one has the full context baked in
- If it exhausted iterations (3 max) without APPROVED: read the last `design-review.md` and launch a single `wf-design` pass with a targeted prompt addressing only the remaining HIGH/MEDIUM findings

## Resuming if workflow already finished

If `docs/design-review.json` shows APPROVED or APPROVED_WITH_ADVISORIES:
- The design is done. Read `docs/technical-design.md` to understand the full system.
- Move directly to step 2 (planner) above.
- MEDIUM advisories from the final review should be included in the planner's task list as explicit items.

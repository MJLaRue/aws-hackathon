# Handoff — Budget Forecasting Analyst

**Last updated:** 2026-10-08  
**Workflow ID (active):** none  
**Session context:** Implementation paused — design APPROVED, tasks.json written, scaffold committed. Resume at T02.

---

## What this project is

A university budget forecasting analyst demo app for an AWS hackathon.  
Stack: **Python 3.12 / FastAPI / DuckDB / statsmodels+statsforecast / AWS Bedrock Converse API / React+TypeScript+Vite / Recharts / SSE / Docker-compose (local) + AWS CDK (production)**.

Full requirements are in `docs/requirements.md` (APPROVED — do not modify).  
Profiling findings and verified numeric ground truth are in `docs/design.md` and `tests/ground_truth.md`.  
The enhanced dataset is `data/Team6Dataset_Enhanced 1.xlsx`.

---

## Current state

### Design: APPROVED ✅

`docs/technical-design.md` is at **Revision 4** (2026-10-08).  
`docs/design-review.json` → `{"verdict": "APPROVED_WITH_ADVISORIES"}` — no HIGH or MEDIUM findings.

The design went through 4 revision iterations:
- Rev 1→2: Initial design loop  
- Rev 2→3: Fixed all 9 findings (2 HIGH, 5 MEDIUM, 2 NIT) from the mechanical review  
- Rev 3→4: Fixed 3 new MEDIUMs introduced by Rev 3 fixes + 2 NITs  
- Rev 4: APPROVED — only 2 NIT-level field-name mismatches remaining (addressed in tasks T04/T05)

### Implementation: scaffold committed, task T02 is next

**Git state:** `main` branch is 1 commit ahead of `origin/main`.  
**Last commit (`3d802d5`):** repo scaffold — directory structure, docker-compose.yml, .env.example, .gitignore, Dockerfiles, Vite config, backend/frontend subpackage stubs, tasks.json, NIT doc fixes T04+T05.

**Tasks completed:**

| ID | Title | Status |
|---|---|---|
| T01 | Repo scaffold: directories, docker-compose.yml, .env.example, .gitignore | ✅ done |
| T04 | NIT fix: `report.rows_rejected` field name in design doc | ✅ done |
| T05 | NIT fix: §5.5 confidence table blockquote placement | ✅ done |

**Next task to implement: T02** — FastAPI skeleton with `/health` endpoint.

**What exists on disk:**
- `backend/` — Dockerfile, main.py (stub), requirements.txt, empty `__init__.py` in agent/, analysis/, forecasting/, ingestion/, replay/, tools/
- `frontend/` — Dockerfile, nginx.conf, package.json, vite.config.ts, src/ (empty)
- `tests/fixtures/` — empty
- `docker-compose.yml`, `.env.example`, `.gitignore` at root

**No application logic has been written yet.** The backend subpackage directories exist but contain only `__init__.py` stubs.

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

## Next steps

**START HERE:** Launch the implementation workflow.

The design is approved and tasks.json is ready. The next action is to start `bundled://ralph` pointing at `tasks.json`. Ralph will pick up the first unchecked task, implement it, mark it done, and loop until all 53 tasks are complete.

```
run_workflow bundled://ralph
  goal: "Implement the university budget forecasting analyst app per docs/technical-design.md. Work through tasks.json one task at a time. Backend: Python 3.12 / FastAPI / DuckDB / statsforecast / AWS Bedrock. Frontend: React + TypeScript + Vite + Recharts. Follow the design exactly — no deviations."
  prd_path: "c:\\Users\\bbala\\aws-hackathon\\tasks.json"
```

**Implementation tracks (within Ralph's loop):**
- skeleton (T01–T05): repo structure, FastAPI skeleton, Vite scaffold, 2 NIT design fixes
- backend (T06–T31): ingestion, variance, anomaly, forecasting, grounding, SSE, Bedrock agent, replay
- frontend (T32–T40): useSSEChat hook, Chat, Upload, TrendChart, KPI, Anomaly, Dashboard, smoke test
- qa (T41–T48): ground-truth tests, replay-without-creds, fabricated-number test, reconciliation
- infra (T51–T53): CDK stack (after app works locally)
- demo (T49–T50): 7 scripted prompts, README

**CDK infra:** T51–T53 implement `infra/`. AWS credentials must be supplied by the user at deploy time via env vars — never stored in repo.

**Demo:** 7 scripted prompts from R6-02 in `docs/technical-design.md §9.2`. Replay mode (T46) must work without Bedrock credentials. Ground truth in `docs/design.md`.

---

## Resuming implementation

**Start here:** Check `tasks.json` for the first task where `"done": false` — that is T02.

Launch Ralph pointing at tasks.json:

```
run_workflow bundled://ralph
  goal: "Implement the university budget forecasting analyst app per docs/technical-design.md (Revision 4, APPROVED). Work through tasks.json one task at a time. Backend: Python 3.12 / FastAPI / DuckDB / statsforecast / AWS Bedrock. Frontend: React + TypeScript + Vite + Recharts. Follow the design exactly — no deviations. All files go under c:\\Users\\bbala\\aws-hackathon\\."
  prd_path: "c:\\Users\\bbala\\aws-hackathon\\tasks.json"
```

Ralph will pick up the first unchecked task (T02), implement it, mark it done, and loop through all 53 tasks automatically. Stop condition: `tasks.json` → `"complete": true`.

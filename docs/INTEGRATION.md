# Combined budget workspace and workbook analytics

`feat/budget-analytics-dashboard` includes `Dev_HV` through a merge commit with both
histories as parents. The branches began independently. The merge retains the
budget workspace, its Express/MySQL API, and its analytics dashboard, and adds the
Python workbook analysis, forecasting, scenarios, React components, datasets, and
design documents. Repeated `aws-hackathon/` checkouts, installed `node_modules`,
Python caches, and `.DS_Store` files from `Dev_HV` are excluded. Its original README
is preserved as `DEV_HV_README.md`; its design and handoff documents describe that
branch's earlier work, not necessarily the current combined implementation.

## Local setup

Use Node.js 20.19+, Python 3.11, and Docker Compose:

```sh
npm ci
npm run setup:analytics
cp .env.example .env
docker compose -p uic-budget up -d --wait mysql
npm run db:setup
npm run dev
```

Open http://127.0.0.1:5173, sign in as Alex Morgan, and select **Forecasting &
scenarios**. `/forecasting.html` opens the imported Overview, Forecasting,
Anomalies, and Scenario Planner. Links return to the budget workspace or the
feature branch's `/dashboard.html` dashboard. The root build includes all three
entry pages; no separate frontend installation is needed.

`npm run dev` runs Express (3001), Vite (5173), and Python (8001).
`npm run dev:analytics` starts Python independently. Set `ANALYTICS_PORT` and
`ANALYTICS_URL` in the root `.env` to change its address, or `ANALYTICS_PYTHON` to
use a different Python executable. If the UI uses another port, set `APP_ORIGIN`
to match and run `npm run dev:web -- --port <port>` alongside the other services.
Python binds to loopback and runs without Flask debug mode by default.

## Data and access

The two data sources remain explicit:

- Workspace editing uses MySQL and the existing department permissions.
- Workbook analysis uses `Team6Dataset_Enhanced.xlsx`, including its synthetic
  series. Forecasts cover July–December 2026 as implemented in `Dev_HV`. Scenario
  results are estimates; running them does not publish budget changes to MySQL.

The Python API is accessed through `/api/analytics/*` on Express. The proxy
requires a workspace session, budget read permission, and `scope=all`, because
the workbook contains departments that do not map to scoped MySQL workspaces.
Mutating requests use the existing origin and CSRF guards. Scoped managers keep
their usual budget workspace access. The Python port should remain private.

Committed JSON forecast artifacts are available initially. **Run Forecast**
recomputes them and saves local model artifacts. Serialized models and Python
environments are ignored. AI chat remains a placeholder; Bedrock integration is
not implemented by this merge.

## Verification and deployment

```sh
npm run build
npm run test:analytics
# Requires a separate MySQL database ending in _test; see the main README.
npm test
```

The root Dockerfile builds the combined frontend and Node server. It does not
bundle Python: run the analytics service separately and configure `ANALYTICS_URL`
for a private, reachable service address. `Dev_HV`'s Lambda adapter and deployment
notes are preserved; cloud deployment has not been performed or validated.

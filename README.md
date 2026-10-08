# Ledger — UIC Budget Workspace

A working department budget application for AWS/UIC Enterprise AI Hackathon Team 6. React provides the landing page and workspace UI; Express and Sequelize provide the backend; MySQL 8.4 stores the financial records. The schema follows **Budget Development Database Schema and Features**, dated October 7, 2026: **22 application tables, 184 columns, plus `SequelizeMeta`**.

## Run locally

Prerequisites: Node.js 20.19+, Python 3.11, and Docker with Compose. The local database binds to `127.0.0.1:3307`; the development API and UI bind to loopback as well.

```sh
npm ci
npm run setup:analytics
cp .env.example .env
docker compose -p uic-budget up -d --wait mysql
npm run db:setup
npm run dev
```

Open **http://127.0.0.1:5173**, select **Open your workspace**, then a development account:

| Account                | Access                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Alex Morgan — admin    | All departments and administration                                                       |
| Jordan Lee — manager   | Computer Science; financial editing and scoped audit history                             |
| Taylor Reed — reviewer | UIC department workspaces; read-only budgets and expenses; no salaries or administration |

Seeded financial records and employee identities are **synthetic**, across five departments and three fiscal years. No real UIC employee or financial data is included. Salary rosters are illustrative appointments, not a reconciliation of the complete personnel budget. Seeding skips databases containing users and is disabled in production.

## Features

The app uses product-facing labels: **Dashboard**, **Budget plan**, **Spending**, **Proposed changes**, **Commitments**, **People & pay**, **Data uploads**, **Discussions**, **Activity log**, **Budget years**, and **Workspace settings**. Section headings, forms, and help text use the same terminology. Existing API routes, CSV columns, database entities, and financial rules retain their original contracts.

A floating tool dock opens each workspace section. **All tools** provides grouped, searchable navigation (⌘K / Ctrl+K), with a bottom dock on mobile. The budget plan offers account cards and a comparison table, both with account details and allocation editing.

- Department dashboard, monthly spending, and workspace/year selection.
- Budget matrix, opening base editing, signed live adjustments, optional logical source references, and CSV/XLSX export.
- Shared draft creates, edits, and deletions; overlay preview; discard; atomic publishing with source-snapshot conflict checks.
- Temporary board containing temporary allocations **or** outstanding owed commitments; settlement without creating an expense.
- Dated expenses, editing and soft deletion; account/overall balances against the opening base.
- Separate faculty/staff identities and appointments, UIN validation, and calculated salaries.
- CSV previews with full validation, owned/hashed tokens, expiry, dataset-change detection, and single-use commits. Salary imports replace the active-year list while preserving rollover history.
- Line notes/resolution, line history, scoped/global audit inspection with before/after values.
- Read-only archives, idempotent July 1 rollover in America/Chicago, checked on startup and every minute.
- User status, roles/resource permissions, department hierarchy, Banner accounts, persistent sessions, and configured SAML endpoints.

The **AI chat layer is not implemented yet**. Workbook analytics, model forecasting, and scenario planning from `Dev_HV` are available through **Forecasting & scenarios** in the workspace. See [combined application](docs/INTEGRATION.md) and [AI extension](docs/AI_EXTENSION.md).

## Financial rules

Persisted monetary values use `DECIMAL(14,2)`. Decimal.js performs backend arithmetic; APIs return monetary strings preserving cents.

```text
Planned budget = opening base + non-deleted, non-draft live adjustments
Remaining base balance = opening base − non-deleted expenses
New salary = previous salary + salary increase
```

Draft preview substitutes pending edit/delete overlays for matching live rows and adds new proposals. Publishing applies every pending change in that department/year or applies none. Adjustments do not automatically create expenses.

FY 2027 means July 1, 2026–June 30, 2027. Rollover carries prior base plus live adjustments into the next base, carries salaries with zero increase, archives the source, and expires drafts/import previews. Expenses and unspent balances are not carried. Existing target records block rollover; completed markers make repeat calls idempotent.

## Verification

Create a separate test database using your MySQL administrator. Tests refuse databases whose names do not end with `_test` and reset only the test database.

```sql
CREATE DATABASE uic_budget_test;
GRANT ALL PRIVILEGES ON uic_budget_test.* TO 'budget'@'%';
```

```sh
# Defaults to the separate local uic_budget_test database.
# Set TEST_DATABASE_URL for another isolated test database.
npm test
npm run build

# Keep npm run dev running for browser tests.
npx playwright install chromium
npm run test:ui
```

Backend tests cover the actual schema, defaults/constraints, auth/scope/CSRF, immutable audit values, exact arithmetic, expenses, archives, draft overlays/conflicts, settlement, salaries, CSV ownership/staleness/concurrency, replacement ledgers, exports, administration, and Chicago rollover boundaries. Browser tests cover all screens, desktop/mobile navigation, expense and salary workflows, draft publishing, imports, and read-only restrictions. Browser tests add/remove temporary synthetic records and leave audit history; use a dedicated demo instance. `UI_BASE_URL` and `PLAYWRIGHT_EXECUTABLE_PATH` can override the browser target/runtime.

## Source layout

| Location             | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `server/db.js`       | All documented models, constraints, indexes, recorded migrations |
| `server/core.js`     | Scope/permissions, year locks, exact money, matrix calculations  |
| `server/finance.js`  | Financial CRUD, drafts, commitments, salaries, notes             |
| `server/imports.js`  | Validated previews and transactional commits                     |
| `server/rollover.js` | Atomic fiscal-year and salary rollover                           |
| `server/auth.js`     | Sessions, development sign-in, SAML integration                  |
| `server/admin.js`    | User/role/department/account administration                      |
| `server/app.js`      | HTTP routes, exports, middleware, error handling                 |
| `src/`               | Responsive React UI, bundled fonts, shared styles                |

See [document coverage](docs/DOCUMENT_COVERAGE.md), [schema inventory](docs/SCHEMA.md), and [API reference](docs/API.md).

## UIC SAML and production

Mock sign-in requires `MOCK_AUTH=true` and is always disabled under `NODE_ENV=production`. Production uses provisioned users; UIC authentication does not automatically grant access.

Configure `SAML_ENTRY_POINT`, `SAML_ISSUER`, `SAML_CALLBACK_URL`, `SAML_IDP_CERT`, `SAML_SP_PRIVATE_KEY`, `SAML_SP_CERT`, and `SAML_NETID_ATTRIBUTE`. PEM values support escaped newlines. Endpoints: `/api/auth/saml/login`, `/api/auth/saml/callback`, `/api/auth/saml/metadata`. The implementation requires signed assertions/responses, validates audience and `InResponseTo`, and uses transaction-locked, expiring requests. **Live UIC SAML has not been tested: no IdP configuration was supplied.** Confirm assertion attributes and signing policy with UIC before using real accounts.

Before production use:

1. Use dedicated MySQL credentials and a tested backup/restore process.
2. Run `npm run db:migrate` as a controlled deployment step; runtime never synchronizes or alters the schema.
3. Provision real roles, departments, and the first administrator through a controlled bootstrap/migration. The provided seed is local synthetic data only.
4. Set `NODE_ENV=production`, `MOCK_AUTH=false`, `DEMO_DATA=false`, HTTPS `APP_ORIGIN`, and a unique random `SESSION_SECRET` of at least 32 characters. Supply secrets through the environment. Leave `NODE_ENV` out of Vite `.env` files so builds use production React.
5. Run `npm run build` then `npm start`, or build the Dockerfile. Expose `HOST=0.0.0.0` only intentionally behind an HTTPS reverse proxy; the Dockerfile does this inside its container. Configure a known trusted-proxy hop count if your hosting requires it; do not blindly trust forwarded headers.
6. Verify real SAML, permissions, fiscal-year state, imports, and recovery with institution-approved test data before everyday use.

Compose passwords are isolated-development defaults. Real SAML, production bootstrap, backups, and cloud deployment have not been performed. MySQL DDL commits implicitly; migrations are resumable and recorded but should not run concurrently. The Dockerfile is a deployment starting point; local Node/MySQL is the verified environment.

# Coverage of the supplied document

Source: **Budget Development Database Schema and Features**, dated October 7, 2026. The original source files named there were not supplied. This is a new implementation of the documented model/behavior, not a verified reproduction of its original internals.

| Document feature                       | Implementation                                                                                              | Verification / qualification                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| SAML, mock login, active-user checks   | `server/auth.js`; sign-in dialog; database sessions and request cache                                       | Development auth, inactive users, CSRF tested; live UIC IdP integration needs configuration/testing.                         |
| Department scopes and child workspaces | One-level containers, own/children/all scope, workspace picker                                              | Out-of-scope reads/writes rejected in backend tests.                                                                         |
| Budget matrix and adjustments          | Matrix/overview, account groups, base editing, signed adjustment CRUD and source references                 | Base-plus-adjustment math and exports tested.                                                                                |
| Shared drafts                          | Create/update/delete overlays, preview/discard, source hashes and atomic publication                        | Conflicts, edit/delete overlays, all-or-nothing publication tested.                                                          |
| Temporary board                        | Temporary OR owed live adjustments; settle to permanent/settled                                             | Amount preserved, audit added, no expense created.                                                                           |
| Fiscal-year expenditures               | Dated positive expenses, edit/soft-delete, base-only balances                                               | Invalid dates/year/amounts rejected; totals independent of adjustments.                                                      |
| Faculty and staff salaries             | Separate identities, unique person/department/year appointments, arithmetic and prior-year links            | Legacy faculty UIN, required staff UIN, separate identity spaces tested.                                                     |
| CSV import                             | Adjustment append to active/draft; salary replacement; owned tokens, validation, fingerprint, expiry        | Invalid rows/accounts/UINs, stale/expired/reused/foreign tokens, concurrent commits tested.                                  |
| Export                                 | CSV/XLSX live/draft matrix with totals                                                                      | CSV and actual XLSX workbook parsed in tests.                                                                                |
| Notes and audit                        | Line conversations, resolve/reopen, line detail history, before/after inspector, global audit for all scope | Immutable snapshots, notes and scope tested. Salary snapshots hidden when salary access is denied.                           |
| Archives and rollover                  | Read-only archived years; startup/minute Chicago checks and administrator endpoint                          | July 1 boundary, carried bases/salaries, zero increase, expired drafts, no expenses, idempotency and durable ledgers tested. |
| Administration                         | Users/status, custom permissions, protected system roles, hierarchy, account catalog                        | Scope, self-access preservation and invalid hierarchy tested.                                                                |
| Search/pagination                      | Adjustment, expense, draft, commitment, salary, note, audit, user lists                                     | Server-side search/pagination tested; small reference lists remain unpaginated.                                              |

## Schema fidelity

All 22 application tables / 184 application columns, plus one-column `SequelizeMeta`, are implemented. The MySQL suite counts actual columns and checks precision, defaults, foreign keys and indexes. Fiscal-year numbers remain logical, audit department/account references remain contextual, draft actor IDs remain logical, and session identity stays serialized. Financial parents restrict deletion; optional actors/rollover targets use `SET NULL`; import ownership uses `CASCADE`.

Published/discarded drafts are removed after auditing because the documented status enum permits only `pending` and `expired`. Source-year drafts expire at rollover. Salary source rows and durable ledgers survive target replacement/removal.

## Assumptions made explicit

- Fiscal years use the ending year as their label, July 1–June 30 in America/Chicago.
- Adjustment type/status strings were not enumerated in the document. This version uses `permanent`/`temporary` and `none`/`owed`/`settled`; the documented VARCHAR columns support revising this convention.
- The document does not specify the shape of `permissions_json`. This implementation defines `scope` plus `none`/`read`/`write` per resource. Administration/rollover require all-department scope.
- Drafts are shared within department/year, with creator/updater attribution. Import previews are private to their importing user.
- CSV headers/limits are defined in the import UI: adjustment imports append, salary imports replace, and every validated row commits together.
- Existing target financial records block rollover instead of being overwritten. All live adjustments, including temporary allocations, carry forward as documented.
- Appointment UINs cannot be reassigned after creation. Missing faculty UINs represent legacy identities; staff UINs are mandatory. Faculty and staff remain separate identity spaces.
- Seeded records are synthetic. Salary rosters are illustrative and do not exhaust personnel budgets.
- AI is the next phase; no external model is called or forecasting accuracy claimed.

Live UIC SAML, institution-approved permissions, production administrator bootstrap, real-data reconciliation, cloud hosting, backups/recovery and acceptance testing remain environment work. The original code and exact permission/import conventions would help resolve these assumptions.

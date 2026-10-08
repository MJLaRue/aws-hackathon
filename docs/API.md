# API reference

Base: `/api`. Authenticated writes require the session cookie and `X-CSRF-Token` from `GET /auth/me`. Browser origins must match `APP_ORIGIN`. Financial context is `{ department_id, fiscal_year }`, plus `account_code` for a budget line. Monetary values are decimal strings.

| Method      | Path                                                                                      | Purpose / permission                                            |
| ----------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| GET         | `/health`                                                                                 | Public MySQL availability                                       |
| GET         | `/auth/config`                                                                            | Sign-in capabilities; demo accounts only in mock mode           |
| POST        | `/auth/mock`                                                                              | Development `{ user_id }` sign-in                               |
| GET         | `/auth/me`                                                                                | User/role/permissions/departments/CSRF token                    |
| POST        | `/auth/logout`                                                                            | Destroy current session                                         |
| GET         | `/auth/saml/login`, `/auth/saml/metadata`                                                 | Configured SAML entry/metadata                                  |
| POST        | `/auth/saml/callback`                                                                     | Signed assertion validation for provisioned users               |
| GET         | `/meta`                                                                                   | Permitted departments/accounts/years                            |
| GET         | `/overview`                                                                               | Scoped budget and spending; budgets + expenses read             |
| GET         | `/matrix`                                                                                 | Budgets read; `mode=draft` also requires drafts read            |
| POST        | `/bases`                                                                                  | Set opening base; budgets write                                 |
| GET, POST   | `/adjustments`                                                                            | List/create; budgets read/write                                 |
| PUT, DELETE | `/adjustments/:id`                                                                        | Edit/soft-delete; budgets write                                 |
| GET, POST   | `/expenses`                                                                               | List/create; expenses read/write                                |
| PUT, DELETE | `/expenses/:id`                                                                           | Edit/soft-delete; expenses write                                |
| GET, POST   | `/drafts`                                                                                 | Pending overlays; drafts read/write                             |
| PUT, DELETE | `/drafts/:id`                                                                             | Edit/discard; drafts write                                      |
| POST        | `/drafts/publish`                                                                         | Atomic context publication; budgets + drafts write              |
| GET         | `/commitments`                                                                            | Temporary OR owed; budgets read                                 |
| POST        | `/commitments/:id/settle`                                                                 | Permanent/settled conversion; budgets write                     |
| GET, POST   | `/salaries/faculty`, `/salaries/staff`                                                    | List/create; salaries read/write                                |
| PUT, DELETE | `/salaries/faculty/:id`, `/salaries/staff/:id`                                            | Edit/delete active appointment; salaries write                  |
| GET, POST   | `/notes`                                                                                  | List/create; notes read/write                                   |
| PATCH       | `/notes/:id`                                                                              | Set `{ is_resolved }`; notes write                              |
| GET         | `/audit`                                                                                  | Scoped or all-scope global audit; audit read                    |
| POST        | `/imports/preview`, `/imports/commit`                                                     | Owned preview/single commit; imports + target resource write    |
| GET         | `/export`                                                                                 | Matrix `format=csv`/`xlsx`, optional `mode=draft`; budgets read |
| POST        | `/fiscal-years/rollover`                                                                  | `{ source_fiscal_year }`; all-scope rollover write              |
| GET         | `/admin`                                                                                  | User/role/department/account data; all-scope admin read         |
| POST        | `/admin/users`, `/admin/roles`, `/admin/departments`, `/admin/accounts`                   | Create; all-scope admin write                                   |
| PUT         | `/admin/users/:id`, `/admin/roles/:id`, `/admin/departments/:id`, `/admin/accounts/:code` | Update; all-scope admin write                                   |

Lists accept applicable `department_id`, `fiscal_year`, `account_code`, `q`, `page` (default 1), `limit` (default 20, maximum 100). Notes accept `resolved=false`. Responses contain `{ rows,total,page,limit }`. Salary totals cover the full selected roster independently of search.

An adjustment write includes context, account, signed `amount`, `adjustment_type`, `obligation_status`, `description`, optional `reference_source` and nullable integer `reference_id`. A draft adds `draft_action` and, for edit/delete, `source_adjustment_id`; trusted source hashes are calculated by the server. Draft source/context/action cannot be reassigned.

Expenses include context, account, positive `amount`, valid in-year `expense_date` (`YYYY-MM-DD`), and `description`. Salary writes include context, `display_name`, nullable faculty/required staff `uin`, `previous_salary` and `salary_increase`; the server calculates `new_salary`.

Import previews include context, `import_type` (`adjustments`, `faculty_salaries`, `staff_salaries`), `workspace_mode` (`active`, or `draft` for adjustments), and `csv`. Successful previews return a token, normalized rows, count, expiry and replacement warning. Invalid previews return `{valid:false,errors:[{row,message}],row_count}`. Commit repeats the exact context/type/mode with `token`, without CSV.

400: invalid fields. 401: sign in. 403: permission/scope/CSRF/origin denied. 404: unavailable record. 409: archived writes, unique conflicts, draft source conflict, stale/expired/reused preview, unsafe rollover. Failed financial transactions roll back their audit entries as well. Internal database errors are not exposed to clients.

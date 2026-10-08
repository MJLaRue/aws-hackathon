# MySQL schema inventory

Generated from server/db.js. 22 application tables, 184 columns, plus SequelizeMeta(name VARCHAR(255) PRIMARY KEY). All timestamps are stored in UTC; fiscal-year boundaries use America/Chicago. Canonical schema changes use recorded migrations; database/schema.sql is a reference export of the initialized MySQL database.

## roles

| Column           | MySQL type   | Null | Default | Keys and references |
| ---------------- | ------------ | ---- | ------- | ------------------- |
| id               | INTEGER      | no   | —       | PK; auto increment  |
| role_name        | VARCHAR(100) | no   | —       | UQ                  |
| permissions_json | TEXT         | yes  | —       | —                   |
| is_system        | TINYINT(1)   | no   | false   | —                   |

## departments

| Column               | MySQL type   | Null | Default | Keys and references                  |
| -------------------- | ------------ | ---- | ------- | ------------------------------------ |
| id                   | INTEGER      | no   | —       | PK; auto increment                   |
| dept_code            | VARCHAR(50)  | no   | —       | UQ                                   |
| dept_name            | VARCHAR(255) | no   | —       | —                                    |
| parent_department_id | INTEGER      | yes  | —       | FK → departments.id; delete SET NULL |
| is_workspace         | TINYINT(1)   | no   | true    | —                                    |
| is_active            | TINYINT(1)   | no   | true    | —                                    |

## users

| Column        | MySQL type   | Null | Default           | Keys and references                  |
| ------------- | ------------ | ---- | ----------------- | ------------------------------------ |
| id            | INTEGER      | no   | —                 | PK; auto increment                   |
| uin           | VARCHAR(9)   | no   | —                 | UQ                                   |
| netid         | VARCHAR(50)  | no   | —                 | UQ                                   |
| email         | VARCHAR(255) | no   | —                 | UQ                                   |
| first_name    | VARCHAR(100) | no   | —                 | —                                    |
| last_name     | VARCHAR(100) | no   | —                 | —                                    |
| role_id       | INTEGER      | no   | —                 | FK → roles.id; delete RESTRICT       |
| department_id | INTEGER      | no   | —                 | FK → departments.id; delete RESTRICT |
| is_active     | TINYINT(1)   | no   | true              | —                                    |
| created_at    | DATETIME     | no   | CURRENT_TIMESTAMP | —                                    |

## banner_accounts

| Column        | MySQL type   | Null | Default | Keys and references |
| ------------- | ------------ | ---- | ------- | ------------------- |
| account_code  | VARCHAR(50)  | no   | —       | PK                  |
| category_name | VARCHAR(255) | no   | —       | —                   |
| group_type    | VARCHAR(100) | no   | —       | —                   |

## budget_bases

| Column        | MySQL type    | Null | Default           | Keys and references                                |
| ------------- | ------------- | ---- | ----------------- | -------------------------------------------------- |
| id            | INTEGER       | no   | —                 | PK; auto increment                                 |
| department_id | INTEGER       | no   | —                 | FK → departments.id; delete RESTRICT               |
| account_code  | VARCHAR(50)   | no   | —                 | FK → banner_accounts.account_code; delete RESTRICT |
| fiscal_year   | INTEGER       | no   | —                 | —                                                  |
| base_amount   | DECIMAL(14,2) | no   | 0                 | —                                                  |
| updated_at    | DATETIME      | no   | CURRENT_TIMESTAMP | —                                                  |

- Unique key: department_id + account_code + fiscal_year
- Index: department_id + fiscal_year

## budget_adjustments

| Column             | MySQL type    | Null | Default           | Keys and references                                |
| ------------------ | ------------- | ---- | ----------------- | -------------------------------------------------- |
| id                 | INTEGER       | no   | —                 | PK; auto increment                                 |
| department_id      | INTEGER       | no   | —                 | FK → departments.id; delete RESTRICT               |
| account_code       | VARCHAR(50)   | no   | —                 | FK → banner_accounts.account_code; delete RESTRICT |
| fiscal_year        | INTEGER       | no   | —                 | —                                                  |
| amount             | DECIMAL(14,2) | no   | —                 | —                                                  |
| adjustment_type    | VARCHAR(100)  | no   | —                 | —                                                  |
| obligation_status  | VARCHAR(100)  | yes  | —                 | —                                                  |
| description        | VARCHAR(500)  | yes  | —                 | —                                                  |
| reference_source   | VARCHAR(255)  | yes  | —                 | —                                                  |
| reference_id       | INTEGER       | yes  | —                 | —                                                  |
| created_by_user_id | INTEGER       | yes  | —                 | FK → users.id; delete SET NULL                     |
| created_at         | DATETIME      | no   | CURRENT_TIMESTAMP | —                                                  |
| updated_at         | DATETIME      | yes  | —                 | —                                                  |
| updated_by_user_id | INTEGER       | yes  | —                 | FK → users.id; delete SET NULL                     |
| deleted_at         | DATETIME      | yes  | —                 | —                                                  |
| deleted_by_user_id | INTEGER       | yes  | —                 | FK → users.id; delete SET NULL                     |
| is_draft           | TINYINT(1)    | no   | false             | —                                                  |

- Index: department_id + fiscal_year + deleted_at
- Index: adjustment_type + obligation_status

## budget_adjustment_drafts

| Column               | MySQL type                         | Null | Default           | Keys and references                                |
| -------------------- | ---------------------------------- | ---- | ----------------- | -------------------------------------------------- |
| id                   | INTEGER                            | no   | —                 | PK; auto increment                                 |
| source_adjustment_id | INTEGER                            | yes  | —                 | FK → budget_adjustments.id; delete SET NULL        |
| draft_action         | ENUM('create', 'update', 'delete') | no   | —                 | —                                                  |
| department_id        | INTEGER                            | no   | —                 | FK → departments.id; delete RESTRICT               |
| account_code         | VARCHAR(50)                        | no   | —                 | FK → banner_accounts.account_code; delete RESTRICT |
| fiscal_year          | INTEGER                            | no   | —                 | —                                                  |
| amount               | DECIMAL(14,2)                      | no   | —                 | —                                                  |
| adjustment_type      | VARCHAR(100)                       | no   | —                 | —                                                  |
| obligation_status    | VARCHAR(100)                       | yes  | —                 | —                                                  |
| description          | VARCHAR(500)                       | yes  | —                 | —                                                  |
| created_by_user_id   | INTEGER                            | yes  | —                 | —                                                  |
| updated_by_user_id   | INTEGER                            | yes  | —                 | —                                                  |
| created_at           | DATETIME                           | no   | CURRENT_TIMESTAMP | —                                                  |
| updated_at           | DATETIME                           | no   | CURRENT_TIMESTAMP | —                                                  |
| source_snapshot_hash | VARCHAR(64)                        | yes  | —                 | —                                                  |
| status               | ENUM('pending', 'expired')         | no   | pending           | —                                                  |
| expired_at           | DATETIME                           | yes  | —                 | —                                                  |
| expiration_reason    | VARCHAR(255)                       | yes  | —                 | —                                                  |

- Unique key: source_adjustment_id + status
- Index: department_id + fiscal_year + status

## fiscal_year_expenses

| Column             | MySQL type    | Null | Default           | Keys and references                                |
| ------------------ | ------------- | ---- | ----------------- | -------------------------------------------------- |
| id                 | INTEGER       | no   | —                 | PK; auto increment                                 |
| department_id      | INTEGER       | no   | —                 | FK → departments.id; delete RESTRICT               |
| account_code       | VARCHAR(50)   | no   | —                 | FK → banner_accounts.account_code; delete RESTRICT |
| fiscal_year        | INTEGER       | no   | —                 | —                                                  |
| expense_date       | DATE          | no   | —                 | —                                                  |
| amount             | DECIMAL(14,2) | no   | —                 | —                                                  |
| description        | VARCHAR(500)  | no   | —                 | —                                                  |
| created_at         | DATETIME      | no   | CURRENT_TIMESTAMP | —                                                  |
| created_by_user_id | INTEGER       | yes  | —                 | FK → users.id; delete SET NULL                     |
| updated_at         | DATETIME      | yes  | —                 | —                                                  |
| updated_by_user_id | INTEGER       | yes  | —                 | FK → users.id; delete SET NULL                     |
| deleted_at         | DATETIME      | yes  | —                 | —                                                  |
| deleted_by_user_id | INTEGER       | yes  | —                 | FK → users.id; delete SET NULL                     |

- Index: department_id + fiscal_year + deleted_at
- Index: expense_date

## line_notes

| Column             | MySQL type  | Null | Default           | Keys and references                                |
| ------------------ | ----------- | ---- | ----------------- | -------------------------------------------------- |
| id                 | INTEGER     | no   | —                 | PK; auto increment                                 |
| department_id      | INTEGER     | no   | —                 | FK → departments.id; delete RESTRICT               |
| account_code       | VARCHAR(50) | no   | —                 | FK → banner_accounts.account_code; delete RESTRICT |
| fiscal_year        | INTEGER     | no   | —                 | —                                                  |
| note_text          | TEXT        | no   | —                 | —                                                  |
| created_by_user_id | INTEGER     | yes  | —                 | FK → users.id; delete SET NULL                     |
| created_at         | DATETIME    | no   | CURRENT_TIMESTAMP | —                                                  |
| is_resolved        | TINYINT(1)  | no   | false             | —                                                  |

- Index: department_id + account_code + fiscal_year + is_resolved

## audit_logs

| Column        | MySQL type   | Null | Default           | Keys and references            |
| ------------- | ------------ | ---- | ----------------- | ------------------------------ |
| id            | INTEGER      | no   | —                 | PK; auto increment             |
| user_id       | INTEGER      | yes  | —                 | FK → users.id; delete SET NULL |
| actor_uin     | VARCHAR(50)  | yes  | —                 | —                              |
| action_type   | VARCHAR(100) | no   | —                 | —                              |
| target_table  | VARCHAR(100) | no   | —                 | —                              |
| record_id     | INTEGER      | yes  | —                 | —                              |
| department_id | INTEGER      | yes  | —                 | —                              |
| account_code  | VARCHAR(50)  | yes  | —                 | —                              |
| fiscal_year   | INTEGER      | yes  | —                 | —                              |
| changes_json  | LONGTEXT     | yes  | —                 | —                              |
| timestamp     | DATETIME     | no   | CURRENT_TIMESTAMP | —                              |

- Index: department_id + account_code + fiscal_year + timestamp
- Index: timestamp

## faculty_members

| Column       | MySQL type   | Null | Default           | Keys and references |
| ------------ | ------------ | ---- | ----------------- | ------------------- |
| id           | CHAR(36)     | no   | —                 | PK                  |
| uin          | VARCHAR(9)   | yes  | —                 | UQ                  |
| display_name | VARCHAR(255) | no   | —                 | —                   |
| created_at   | DATETIME     | no   | CURRENT_TIMESTAMP | —                   |
| updated_at   | DATETIME     | no   | CURRENT_TIMESTAMP | —                   |

## faculty_salaries

| Column              | MySQL type    | Null | Default           | Keys and references                           |
| ------------------- | ------------- | ---- | ----------------- | --------------------------------------------- |
| id                  | INTEGER       | no   | —                 | PK; auto increment                            |
| department_id       | INTEGER       | no   | —                 | FK → departments.id; delete RESTRICT          |
| faculty_id          | CHAR(36)      | no   | —                 | FK → faculty_members.id; delete RESTRICT      |
| faculty_name        | VARCHAR(255)  | no   | —                 | —                                             |
| previous_salary     | DECIMAL(14,2) | no   | —                 | —                                             |
| salary_increase     | DECIMAL(14,2) | no   | —                 | —                                             |
| new_salary          | DECIMAL(14,2) | no   | —                 | —                                             |
| fiscal_year         | INTEGER       | no   | —                 | —                                             |
| rolled_over_from_id | INTEGER       | yes  | —                 | UQ; FK → faculty_salaries.id; delete SET NULL |
| created_at          | DATETIME      | no   | CURRENT_TIMESTAMP | —                                             |
| updated_at          | DATETIME      | no   | CURRENT_TIMESTAMP | —                                             |
| created_by_user_id  | INTEGER       | yes  | —                 | FK → users.id; delete SET NULL                |
| updated_by_user_id  | INTEGER       | yes  | —                 | FK → users.id; delete SET NULL                |

- Unique key: faculty_id + department_id + fiscal_year
- Index: department_id + fiscal_year

## faculty_salary_rollovers

| Column             | MySQL type  | Null | Default           | Keys and references                           |
| ------------------ | ----------- | ---- | ----------------- | --------------------------------------------- |
| id                 | INTEGER     | no   | —                 | PK; auto increment                            |
| source_salary_id   | INTEGER     | no   | —                 | UQ; FK → faculty_salaries.id; delete RESTRICT |
| target_salary_id   | INTEGER     | yes  | —                 | UQ; FK → faculty_salaries.id; delete SET NULL |
| source_fiscal_year | INTEGER     | no   | —                 | —                                             |
| target_fiscal_year | INTEGER     | no   | —                 | —                                             |
| department_id      | INTEGER     | no   | —                 | FK → departments.id; delete RESTRICT          |
| status             | VARCHAR(50) | no   | —                 | —                                             |
| created_at         | DATETIME    | no   | CURRENT_TIMESTAMP | —                                             |
| updated_at         | DATETIME    | no   | CURRENT_TIMESTAMP | —                                             |

## staff_members

| Column       | MySQL type   | Null | Default           | Keys and references |
| ------------ | ------------ | ---- | ----------------- | ------------------- |
| id           | CHAR(36)     | no   | —                 | PK                  |
| uin          | VARCHAR(9)   | no   | —                 | UQ                  |
| display_name | VARCHAR(255) | no   | —                 | —                   |
| created_at   | DATETIME     | no   | CURRENT_TIMESTAMP | —                   |
| updated_at   | DATETIME     | no   | CURRENT_TIMESTAMP | —                   |

## staff_salaries

| Column              | MySQL type    | Null | Default           | Keys and references                         |
| ------------------- | ------------- | ---- | ----------------- | ------------------------------------------- |
| id                  | INTEGER       | no   | —                 | PK; auto increment                          |
| department_id       | INTEGER       | no   | —                 | FK → departments.id; delete RESTRICT        |
| staff_id            | CHAR(36)      | no   | —                 | FK → staff_members.id; delete RESTRICT      |
| staff_name          | VARCHAR(255)  | no   | —                 | —                                           |
| previous_salary     | DECIMAL(14,2) | no   | —                 | —                                           |
| salary_increase     | DECIMAL(14,2) | no   | —                 | —                                           |
| new_salary          | DECIMAL(14,2) | no   | —                 | —                                           |
| fiscal_year         | INTEGER       | no   | —                 | —                                           |
| rolled_over_from_id | INTEGER       | yes  | —                 | UQ; FK → staff_salaries.id; delete SET NULL |
| created_at          | DATETIME      | no   | CURRENT_TIMESTAMP | —                                           |
| updated_at          | DATETIME      | no   | CURRENT_TIMESTAMP | —                                           |
| created_by_user_id  | INTEGER       | yes  | —                 | FK → users.id; delete SET NULL              |
| updated_by_user_id  | INTEGER       | yes  | —                 | FK → users.id; delete SET NULL              |

- Unique key: staff_id + department_id + fiscal_year
- Index: department_id + fiscal_year

## staff_salary_rollovers

| Column             | MySQL type  | Null | Default           | Keys and references                         |
| ------------------ | ----------- | ---- | ----------------- | ------------------------------------------- |
| id                 | INTEGER     | no   | —                 | PK; auto increment                          |
| source_salary_id   | INTEGER     | no   | —                 | UQ; FK → staff_salaries.id; delete RESTRICT |
| target_salary_id   | INTEGER     | yes  | —                 | UQ; FK → staff_salaries.id; delete SET NULL |
| source_fiscal_year | INTEGER     | no   | —                 | —                                           |
| target_fiscal_year | INTEGER     | no   | —                 | —                                           |
| department_id      | INTEGER     | no   | —                 | FK → departments.id; delete RESTRICT        |
| status             | VARCHAR(50) | no   | —                 | —                                           |
| created_at         | DATETIME    | no   | CURRENT_TIMESTAMP | —                                           |
| updated_at         | DATETIME    | no   | CURRENT_TIMESTAMP | —                                           |

## fiscal_year_states

| Column                | MySQL type                 | Null | Default | Keys and references |
| --------------------- | -------------------------- | ---- | ------- | ------------------- |
| fiscal_year           | INTEGER                    | no   | —       | PK                  |
| status                | ENUM('active', 'archived') | no   | active  | —                   |
| archived_at           | DATETIME                   | yes  | —       | —                   |
| rolled_to_fiscal_year | INTEGER                    | yes  | —       | —                   |

## fiscal_year_rollovers

| Column               | MySQL type | Null | Default           | Keys and references |
| -------------------- | ---------- | ---- | ----------------- | ------------------- |
| id                   | INTEGER    | no   | —                 | PK; auto increment  |
| source_fiscal_year   | INTEGER    | no   | —                 | —                   |
| target_fiscal_year   | INTEGER    | no   | —                 | —                   |
| budget_base_count    | INTEGER    | no   | 0                 | —                   |
| faculty_salary_count | INTEGER    | no   | 0                 | —                   |
| completed_at         | DATETIME   | no   | CURRENT_TIMESTAMP | —                   |
| staff_salary_count   | INTEGER    | no   | 0                 | —                   |

- Unique key: source_fiscal_year + target_fiscal_year

## import_previews

| Column              | MySQL type                                                | Null | Default           | Keys and references                  |
| ------------------- | --------------------------------------------------------- | ---- | ----------------- | ------------------------------------ |
| token_hash          | VARCHAR(64)                                               | no   | —                 | PK                                   |
| import_type         | ENUM('adjustments', 'faculty_salaries', 'staff_salaries') | no   | —                 | —                                    |
| user_id             | INTEGER                                                   | no   | —                 | FK → users.id; delete CASCADE        |
| department_id       | INTEGER                                                   | yes  | —                 | FK → departments.id; delete SET NULL |
| fiscal_year         | INTEGER                                                   | no   | —                 | —                                    |
| workspace_mode      | ENUM('active', 'draft')                                   | no   | —                 | —                                    |
| context_hash        | VARCHAR(64)                                               | no   | —                 | —                                    |
| payload_json        | LONGTEXT                                                  | no   | —                 | —                                    |
| dataset_fingerprint | VARCHAR(64)                                               | yes  | —                 | —                                    |
| status              | ENUM('pending', 'consumed', 'stale', 'expired')           | no   | pending           | —                                    |
| expires_at          | DATETIME                                                  | no   | —                 | —                                    |
| created_at          | DATETIME                                                  | no   | CURRENT_TIMESTAMP | —                                    |
| consumed_at         | DATETIME                                                  | yes  | —                 | —                                    |

- Index: expires_at + status

## sessions

| Column     | MySQL type   | Null | Default | Keys and references |
| ---------- | ------------ | ---- | ------- | ------------------- |
| sid        | VARCHAR(128) | no   | —       | PK                  |
| expires_at | DATETIME     | no   | —       | —                   |
| data       | LONGTEXT     | no   | —       | —                   |

- Index: expires_at

## saml_requests

| Column           | MySQL type   | Null | Default           | Keys and references |
| ---------------- | ------------ | ---- | ----------------- | ------------------- |
| request_id       | VARCHAR(255) | no   | —                 | PK                  |
| issued_at        | DATETIME     | no   | CURRENT_TIMESTAMP | —                   |
| expires_at       | DATETIME     | no   | —                 | —                   |
| validation_state | VARCHAR(20)  | no   | pending           | —                   |
| validation_token | VARCHAR(64)  | yes  | —                 | —                   |

- Index: expires_at

## transaction_locks

| Column     | MySQL type   | Null | Default           | Keys and references |
| ---------- | ------------ | ---- | ----------------- | ------------------- |
| lock_key   | VARCHAR(191) | no   | —                 | PK                  |
| updated_at | DATETIME     | no   | CURRENT_TIMESTAMP | —                   |

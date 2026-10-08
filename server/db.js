import "dotenv/config";
import { Sequelize, DataTypes as D } from "sequelize";

export const db = new Sequelize(
  process.env.DATABASE_URL ||
    "mysql://budget:budget_local_only@127.0.0.1:3307/uic_budget",
  {
    logging: process.env.SQL_LOG === "true" ? console.log : false,
    dialectOptions: {
      decimalNumbers: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
    },
    pool: { max: 10, min: 0, acquire: 30000 },
    timezone: "+00:00",
  },
);
const field = (type, extra = {}) => ({ type, allowNull: false, ...extra });
const id = () => field(D.INTEGER, { primaryKey: true, autoIncrement: true });
const str = (n, extra) => field(D.STRING(n), extra);
const int = (extra) => field(D.INTEGER, extra);
const money = (extra) => field(D.DECIMAL(14, 2), extra);
const date = (extra) => field(D.DATE, extra);
const now = () => date({ defaultValue: D.NOW });
const bool = (v = false) => field(D.BOOLEAN, { defaultValue: v });
const nullable = { allowNull: true };
const ref = (model, key = "id", optional = false, onDelete) => ({
  references: { model, key },
  onUpdate: "CASCADE",
  onDelete: onDelete || (optional ? "SET NULL" : "RESTRICT"),
  ...(optional ? nullable : {}),
});
const dept = () => int(ref("departments"));
const account = () => str(50, ref("banner_accounts", "account_code"));
const actor = () => int(ref("users", "id", true));
const context = () => ({
  department_id: dept(),
  account_code: account(),
  fiscal_year: int(),
});
const enumOf = (...values) => field(D.ENUM(...values));
const uniq = (...fields) => ({ unique: true, fields });
const index = (...fields) => ({ fields });
export const definitions = {};
function table(name, attributes, indexes = []) {
  definitions[name] = { attributes, indexes };
}
table("roles", {
  id: id(),
  role_name: str(100, { unique: true }),
  permissions_json: field(D.TEXT, nullable),
  is_system: bool(),
});
table("departments", {
  id: id(),
  dept_code: str(50, { unique: true }),
  dept_name: str(255),
  parent_department_id: int(ref("departments", "id", true)),
  is_workspace: bool(true),
  is_active: bool(true),
});
table("users", {
  id: id(),
  uin: str(9, { unique: true }),
  netid: str(50, { unique: true }),
  email: str(255, { unique: true }),
  first_name: str(100),
  last_name: str(100),
  role_id: int(ref("roles")),
  department_id: dept(),
  is_active: bool(true),
  created_at: now(),
});
table("banner_accounts", {
  account_code: str(50, { primaryKey: true }),
  category_name: str(255),
  group_type: str(100),
});
table(
  "budget_bases",
  {
    id: id(),
    ...context(),
    base_amount: money({ defaultValue: 0 }),
    updated_at: now(),
  },
  [
    uniq("department_id", "account_code", "fiscal_year"),
    index("department_id", "fiscal_year"),
  ],
);
table(
  "budget_adjustments",
  {
    id: id(),
    ...context(),
    amount: money(),
    adjustment_type: str(100),
    obligation_status: str(100, nullable),
    description: str(500, nullable),
    reference_source: str(255, nullable),
    reference_id: int(nullable),
    created_by_user_id: actor(),
    created_at: now(),
    updated_at: date(nullable),
    updated_by_user_id: actor(),
    deleted_at: date(nullable),
    deleted_by_user_id: actor(),
    is_draft: bool(),
  },
  [
    index("department_id", "fiscal_year", "deleted_at"),
    index("adjustment_type", "obligation_status"),
  ],
);
table(
  "budget_adjustment_drafts",
  {
    id: id(),
    source_adjustment_id: int(ref("budget_adjustments", "id", true)),
    draft_action: enumOf("create", "update", "delete"),
    ...context(),
    amount: money(),
    adjustment_type: str(100),
    obligation_status: str(100, nullable),
    description: str(500, nullable),
    created_by_user_id: int(nullable),
    updated_by_user_id: int(nullable),
    created_at: now(),
    updated_at: now(),
    source_snapshot_hash: str(64, nullable),
    status: { ...enumOf("pending", "expired"), defaultValue: "pending" },
    expired_at: date(nullable),
    expiration_reason: str(255, nullable),
  },
  [
    uniq("source_adjustment_id", "status"),
    index("department_id", "fiscal_year", "status"),
  ],
);
table(
  "fiscal_year_expenses",
  {
    id: id(),
    ...context(),
    expense_date: field(D.DATEONLY),
    amount: money(),
    description: str(500),
    created_at: now(),
    created_by_user_id: actor(),
    updated_at: date(nullable),
    updated_by_user_id: actor(),
    deleted_at: date(nullable),
    deleted_by_user_id: actor(),
  },
  [index("department_id", "fiscal_year", "deleted_at"), index("expense_date")],
);
table(
  "line_notes",
  {
    id: id(),
    ...context(),
    note_text: field(D.TEXT),
    created_by_user_id: actor(),
    created_at: now(),
    is_resolved: bool(),
  },
  [index("department_id", "account_code", "fiscal_year", "is_resolved")],
);
table(
  "audit_logs",
  {
    id: id(),
    user_id: actor(),
    actor_uin: str(50, nullable),
    action_type: str(100),
    target_table: str(100),
    record_id: int(nullable),
    department_id: int(nullable),
    account_code: str(50, nullable),
    fiscal_year: int(nullable),
    changes_json: field(D.TEXT("long"), nullable),
    timestamp: now(),
  },
  [
    index("department_id", "account_code", "fiscal_year", "timestamp"),
    index("timestamp"),
  ],
);
for (const kind of ["faculty", "staff"]) {
  table(`${kind}_members`, {
    id: field(D.CHAR(36), { primaryKey: true }),
    uin: str(9, { unique: true, ...(kind === "faculty" ? nullable : {}) }),
    display_name: str(255),
    created_at: now(),
    updated_at: now(),
  });
  table(
    `${kind}_salaries`,
    {
      id: id(),
      department_id: dept(),
      [`${kind}_id`]: field(D.CHAR(36), ref(`${kind}_members`)),
      [`${kind}_name`]: str(255),
      previous_salary: money(),
      salary_increase: money(),
      new_salary: money(),
      fiscal_year: int(),
      rolled_over_from_id: int({
        ...ref(`${kind}_salaries`, "id", true),
        unique: true,
      }),
      created_at: now(),
      updated_at: now(),
      created_by_user_id: actor(),
      updated_by_user_id: actor(),
    },
    [
      uniq(`${kind}_id`, "department_id", "fiscal_year"),
      index("department_id", "fiscal_year"),
    ],
  );
  table(`${kind}_salary_rollovers`, {
    id: id(),
    source_salary_id: int({ ...ref(`${kind}_salaries`), unique: true }),
    target_salary_id: int({
      ...ref(`${kind}_salaries`, "id", true),
      unique: true,
    }),
    source_fiscal_year: int(),
    target_fiscal_year: int(),
    department_id: dept(),
    status: str(50),
    created_at: now(),
    updated_at: now(),
  });
}
table("fiscal_year_states", {
  fiscal_year: int({ primaryKey: true }),
  status: { ...enumOf("active", "archived"), defaultValue: "active" },
  archived_at: date(nullable),
  rolled_to_fiscal_year: int(nullable),
});
table(
  "fiscal_year_rollovers",
  {
    id: id(),
    source_fiscal_year: int(),
    target_fiscal_year: int(),
    budget_base_count: int({ defaultValue: 0 }),
    faculty_salary_count: int({ defaultValue: 0 }),
    completed_at: now(),
    staff_salary_count: int({ defaultValue: 0 }),
  },
  [uniq("source_fiscal_year", "target_fiscal_year")],
);
table(
  "import_previews",
  {
    token_hash: str(64, { primaryKey: true }),
    import_type: enumOf("adjustments", "faculty_salaries", "staff_salaries"),
    user_id: int(ref("users", "id", false, "CASCADE")),
    department_id: int(ref("departments", "id", true)),
    fiscal_year: int(),
    workspace_mode: enumOf("active", "draft"),
    context_hash: str(64),
    payload_json: field(D.TEXT("long")),
    dataset_fingerprint: str(64, nullable),
    status: {
      ...enumOf("pending", "consumed", "stale", "expired"),
      defaultValue: "pending",
    },
    expires_at: date(),
    created_at: now(),
    consumed_at: date(nullable),
  },
  [index("expires_at", "status")],
);
table(
  "sessions",
  {
    sid: str(128, { primaryKey: true }),
    expires_at: date(),
    data: field(D.TEXT("long")),
  },
  [index("expires_at")],
);
table(
  "saml_requests",
  {
    request_id: str(255, { primaryKey: true }),
    issued_at: now(),
    expires_at: date(),
    validation_state: str(20, { defaultValue: "pending" }),
    validation_token: str(64, nullable),
  },
  [index("expires_at")],
);
table("transaction_locks", {
  lock_key: str(191, { primaryKey: true }),
  updated_at: now(),
});
export const models = Object.fromEntries(
  Object.entries(definitions).map(([name, d]) => [
    name,
    db.define(name, d.attributes, {
      tableName: name,
      timestamps: false,
      indexes: d.indexes,
    }),
  ]),
);

// An explicit, recorded migration; no destructive runtime sync or alter.
export async function migrate() {
  await db.authenticate();
  const qi = db.getQueryInterface();
  await qi.createTable("SequelizeMeta", {
    name: str(255, { primaryKey: true }),
  });
  const [applied] = await db.query(
    "SELECT name FROM `SequelizeMeta` WHERE name = ?",
    { replacements: ["001-initial-schema"] },
  );
  if (!applied.length) {
    // MySQL DDL commits implicitly. createTable/addIndex are resumable after an interrupted migration.
    for (const [name, d] of Object.entries(definitions)) {
      await qi.createTable(name, d.attributes);
      const existing = await qi.showIndex(name);
      for (const [i, idx] of d.indexes.entries()) {
        const idxName = `${name}_idx_${i}`;
        if (!existing.some((x) => x.name === idxName))
          await qi.addIndex(name, idx.fields, { ...idx, name: idxName });
      }
    }
    await db.query("INSERT INTO `SequelizeMeta` (name) VALUES (?)", {
      replacements: ["001-initial-schema"],
    });
  }
  const [defaults] = await db.query(
    "SELECT name FROM `SequelizeMeta` WHERE name = ?",
    { replacements: ["002-timestamp-defaults"] },
  );
  if (!defaults.length) {
    for (const [name, definition] of Object.entries(definitions))
      for (const [column, attribute] of Object.entries(definition.attributes)) {
        if (
          attribute.defaultValue === D.NOW ||
          attribute.defaultValue instanceof D.NOW
        )
          await qi.changeColumn(name, column, {
            ...attribute,
            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
          });
      }
    await db.query("INSERT INTO `SequelizeMeta` (name) VALUES (?)", {
      replacements: ["002-timestamp-defaults"],
    });
  }
  const [branding] = await db.query(
    "SELECT name FROM `SequelizeMeta` WHERE name = ?",
    { replacements: ["003-uic-branding"] },
  );
  if (!branding.length) {
    await db.transaction(async (transaction) => {
      await models.departments.update(
        { dept_code: "UIC", dept_name: "UIC" },
        {
          where: { dept_code: "COE", dept_name: "College of Engineering" },
          transaction,
        },
      );
      await db.query("INSERT INTO `SequelizeMeta` (name) VALUES (?)", {
        replacements: ["003-uic-branding"],
        transaction,
      });
    });
  }
}

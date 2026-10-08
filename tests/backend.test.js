import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";

// Tests only run against an explicitly separate database. The development dataset is never reset.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "mysql://budget:budget_local_only@127.0.0.1:3307/uic_budget_test";
if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test"))
  throw new Error(
    "Refusing to test against a database without the _test suffix.",
  );
process.env.NODE_ENV = "test";
process.env.MOCK_AUTH = "true";
const { db, models: M, definitions, migrate } = await import("../server/db.js");
const { seed } = await import("../server/seed.js");
const { createApp } = await import("../server/app.js");
const { currentFiscalYear, add, snapshot, hash } =
  await import("../server/core.js");
const { rollover } = await import("../server/rollover.js");
let app,
  admin,
  manager,
  reviewer,
  csrf,
  managerCsrf,
  reviewerCsrf,
  dept,
  other,
  year,
  adminCtx;
async function login(id) {
  const agent = request.agent(app);
  await agent.post("/api/auth/mock").send({ user_id: id }).expect(200);
  const me = (await agent.get("/api/auth/me").expect(200)).body;
  return { agent, me };
}
const write = (agent, token, method, path, body) =>
  agent[method](`/api${path}`).set("X-CSRF-Token", token).send(body);
const live = (data) => ({
  department_id: dept,
  fiscal_year: year,
  account_code: "2400",
  amount: "100.00",
  adjustment_type: "permanent",
  obligation_status: "none",
  description: "Test adjustment",
  ...data,
});
test("workbook analytics retains workspace session, scope, origin, and CSRF guards", async () => {
  await request(app).get("/api/analytics/summary").expect(401);
  await manager.get("/api/analytics/summary").expect(403);
  await admin.post("/api/analytics/forecast/run").send({}).expect(403);
  await admin.post("/api/analytics/scenarios/run")
    .set("X-CSRF-Token", csrf).set("Origin", "https://untrusted.example")
    .send({ adjustments: [] }).expect(403);
  await admin.get("/api/analytics/unknown").expect(404);
});
before(async () => {
  await db.authenticate();
  await db.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of [...Object.keys(definitions), "SequelizeMeta"])
    await db.query(`DROP TABLE IF EXISTS \`${table}\``);
  await db.query("SET FOREIGN_KEY_CHECKS = 1");
  await migrate();
  await seed();
  app = createApp();
  let x = await login(1);
  admin = x.agent;
  csrf = x.me.csrf;
  adminCtx = { ...x.me, departmentIds: x.me.departments.map((x) => x.id) };
  x = await login(2);
  manager = x.agent;
  managerCsrf = x.me.csrf;
  x = await login(3);
  reviewer = x.agent;
  reviewerCsrf = x.me.csrf;
  dept = (await M.departments.findOne({ where: { dept_code: "CS" } })).id;
  other = (await M.departments.findOne({ where: { dept_code: "ECE" } })).id;
  year = currentFiscalYear();
});
after(async () => {
  await db.close();
});

test("schema matches all documented tables and columns, with actual DECIMAL precision and physical constraints", async () => {
  const [columns] = await db.query(
    "SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,NUMERIC_PRECISION,NUMERIC_SCALE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()",
  );
  assert.equal(Object.keys(definitions).length, 22);
  assert.equal(columns.length, 185);
  const money = columns.find(
    (x) => x.TABLE_NAME === "budget_bases" && x.COLUMN_NAME === "base_amount",
  );
  assert.equal(money.DATA_TYPE, "decimal");
  assert.equal(money.NUMERIC_PRECISION, 14);
  assert.equal(money.NUMERIC_SCALE, 2);
  const [indexes] = await db.query("SHOW INDEX FROM budget_bases");
  assert.ok(
    indexes.some(
      (x) => x.Key_name === "budget_bases_idx_0" && x.Non_unique === 0,
    ),
  );
  const [fk] = await db.query(
    "SELECT COUNT(*) n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()",
  );
  assert.ok(Number(fk[0].n) > 30);
  await migrate();
  assert.equal(await M.roles.count(), 3);
  const [defaults] = await db.query(
    "SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='created_at'",
  );
  assert.match(defaults[0].COLUMN_DEFAULT, /CURRENT_TIMESTAMP/i);
});
test("authentication, CSRF, and origin checks guard mutations", async () => {
  await request(app).get("/api/matrix").expect(401);
  await admin.post("/api/adjustments").send(live()).expect(403);
  await write(admin, csrf, "post", "/adjustments", live())
    .set("Origin", "https://untrusted.example")
    .expect(403);
  await admin.get("/api/auth/saml/login").expect(503);
});
test("department scope, read-only roles, and salary privacy are enforced on the backend", async () => {
  await manager
    .get(`/api/matrix?department_id=${other}&fiscal_year=${year}`)
    .expect(403);
  await write(
    manager,
    managerCsrf,
    "post",
    "/adjustments",
    live({ department_id: other }),
  ).expect(403);
  await write(reviewer, reviewerCsrf, "post", "/expenses", {
    ...live(),
    expense_date: `${year - 1}-08-05`,
  }).expect(403);
  await reviewer
    .get(`/api/salaries/faculty?department_id=${dept}&fiscal_year=${year}`)
    .expect(403);
  await manager.get("/api/admin").expect(403);
});
test("inactive accounts lose access immediately, without waiting for their session to expire", async () => {
  await M.users.update({ is_active: false }, { where: { id: 2 } });
  await manager.get("/api/meta").expect(401);
  await M.users.update({ is_active: true }, { where: { id: 2 } });
  await manager.get("/api/meta").expect(200);
});
test("money stays exact and base edits preserve real before and after audit values", async () => {
  const base = await M.budget_bases.findOne({
    where: { department_id: dept, account_code: "2400", fiscal_year: year },
  });
  const before = base.base_amount;
  await write(admin, csrf, "post", "/bases", {
    ...live(),
    base_amount: "250000.10",
  }).expect(201);
  const log = await M.audit_logs.findOne({
    where: { target_table: "budget_bases", action_type: "update" },
    order: [["id", "DESC"]],
  });
  const change = JSON.parse(log.changes_json);
  assert.equal(change.before.base_amount, before);
  assert.equal(change.after.base_amount, "250000.10");
  await write(
    admin,
    csrf,
    "post",
    "/adjustments",
    live({ amount: "0.10" }),
  ).expect(201);
  await write(
    admin,
    csrf,
    "post",
    "/adjustments",
    live({ amount: "0.20" }),
  ).expect(201);
  const m = (
    await admin
      .get(`/api/matrix?department_id=${dept}&fiscal_year=${year}`)
      .expect(200)
  ).body;
  const row = m.rows.find((x) => x.account_code === "2400");
  assert.equal(row.adjustments, "-17999.70");
  assert.equal(row.planned_budget, "232000.40");
  await write(
    admin,
    csrf,
    "post",
    "/adjustments",
    live({ amount: "0.001" }),
  ).expect(400);
});
test("expense dates, positivity, soft deletion, and base-only balance calculations", async () => {
  const path = `/api/matrix?department_id=${dept}&fiscal_year=${year}`;
  const before = (await admin.get(path)).body;
  const data = {
    ...live(),
    amount: "123.45",
    expense_date: `${year - 1}-08-15`,
    description: "Recorded test expense",
  };
  await write(admin, csrf, "post", "/expenses", {
    ...data,
    amount: "-1.00",
  }).expect(400);
  await write(admin, csrf, "post", "/expenses", {
    ...data,
    expense_date: `${year - 1}-02-30`,
  }).expect(400);
  await write(admin, csrf, "post", "/expenses", {
    ...data,
    expense_date: `${year}-07-01`,
  }).expect(400);
  const row = (await write(admin, csrf, "post", "/expenses", data).expect(201))
    .body;
  const after = (await admin.get(path)).body;
  assert.equal(after.totals.planned_budget, before.totals.planned_budget);
  assert.equal(after.totals.spent, add(before.totals.spent, "123.45"));
  await write(admin, csrf, "put", `/expenses/${row.id}`, {
    ...data,
    description: "Edited expense",
  }).expect(200);
  await write(admin, csrf, "delete", `/expenses/${row.id}`).expect(200);
  assert.ok((await M.fiscal_year_expenses.findByPk(row.id)).deleted_at);
  assert.equal((await admin.get(path)).body.totals.spent, before.totals.spent);
});
test("archived financial records reject writes across all financial workflows", async () => {
  await write(
    admin,
    csrf,
    "post",
    "/adjustments",
    live({ fiscal_year: year - 1 }),
  ).expect(409);
  await write(admin, csrf, "post", "/notes", {
    ...live({ fiscal_year: year - 1 }),
    note_text: "No",
  }).expect(409);
  const salary = await M.faculty_salaries.findOne({
    where: { department_id: dept, fiscal_year: year - 1 },
  });
  await write(admin, csrf, "delete", `/salaries/faculty/${salary.id}`).expect(
    409,
  );
  await write(admin, csrf, "post", "/imports/preview", {
    department_id: dept,
    fiscal_year: year - 1,
    import_type: "adjustments",
    csv: "account_code,amount,adjustment_type\n2400,100,permanent",
  }).expect(409);
});
test("draft create overlays affect preview only and publishing is atomic", async () => {
  await M.budget_adjustment_drafts.destroy({
    where: { department_id: dept, fiscal_year: year },
  });
  const url = `/api/matrix?department_id=${dept}&fiscal_year=${year}`,
    before = (await admin.get(url)).body;
  const row = (
    await write(admin, csrf, "post", "/drafts", {
      ...live(),
      amount: "555.55",
      draft_action: "create",
    }).expect(201)
  ).body;
  assert.equal(
    (await admin.get(url)).body.totals.planned_budget,
    before.totals.planned_budget,
  );
  assert.equal(
    (await admin.get(`${url}&mode=draft`)).body.totals.planned_budget,
    add(before.totals.planned_budget, "555.55"),
  );
  const result = (
    await write(admin, csrf, "post", "/drafts/publish", {
      department_id: dept,
      fiscal_year: year,
    }).expect(200)
  ).body;
  assert.equal(result.published, 1);
  assert.equal(await M.budget_adjustment_drafts.findByPk(row.id), null);
  assert.equal(
    (await admin.get(url)).body.totals.planned_budget,
    add(before.totals.planned_budget, "555.55"),
  );
});
test("source conflicts prevent every pending draft from being partially published", async () => {
  const liveRow = (
    await write(
      admin,
      csrf,
      "post",
      "/adjustments",
      live({ amount: "100.00" }),
    ).expect(201)
  ).body;
  const draft = (
    await write(admin, csrf, "post", "/drafts", {
      ...live(),
      amount: "200.00",
      draft_action: "update",
      source_adjustment_id: liveRow.id,
    }).expect(201)
  ).body;
  const newDraft = (
    await write(admin, csrf, "post", "/drafts", {
      ...live(),
      amount: "300.00",
      draft_action: "create",
    }).expect(201)
  ).body;
  await write(
    admin,
    csrf,
    "put",
    `/adjustments/${liveRow.id}`,
    live({ amount: "150.00" }),
  ).expect(200);
  const count = await M.budget_adjustments.count();
  await write(admin, csrf, "post", "/drafts/publish", {
    department_id: dept,
    fiscal_year: year,
  }).expect(409);
  assert.equal(await M.budget_adjustments.count(), count);
  assert.equal(
    await M.budget_adjustment_drafts.count({
      where: { status: "pending", department_id: dept, fiscal_year: year },
    }),
    2,
  );
  await write(admin, csrf, "delete", `/drafts/${draft.id}`).expect(200);
  await write(admin, csrf, "delete", `/drafts/${newDraft.id}`).expect(200);
});
test("draft edits retain their original source snapshot; delete overlays remove exactly their source", async () => {
  const source = (
    await write(
      admin,
      csrf,
      "post",
      "/adjustments",
      live({ amount: "77.77" }),
    ).expect(201)
  ).body;
  const draft = (
    await write(admin, csrf, "post", "/drafts", {
      ...live(),
      draft_action: "update",
      source_adjustment_id: source.id,
    }).expect(201)
  ).body;
  await write(admin, csrf, "put", `/drafts/${draft.id}`, {
    ...live(),
    amount: "88.88",
    draft_action: "update",
    source_adjustment_id: source.id,
  }).expect(200);
  assert.equal(
    (await M.budget_adjustment_drafts.findByPk(draft.id)).source_snapshot_hash,
    draft.source_snapshot_hash,
  );
  await write(admin, csrf, "post", "/drafts/publish", {
    department_id: dept,
    fiscal_year: year,
  }).expect(200);
  assert.equal(
    (await M.budget_adjustments.findByPk(source.id)).amount,
    "88.88",
  );
  await write(admin, csrf, "post", "/drafts", {
    ...live(),
    amount: "88.88",
    draft_action: "delete",
    source_adjustment_id: source.id,
  }).expect(201);
  const url = `/api/matrix?department_id=${dept}&fiscal_year=${year}`;
  const liveBudget = (await admin.get(url)).body;
  const proposed = (await admin.get(`${url}&mode=draft`)).body;
  assert.equal(
    add(proposed.totals.planned_budget, "88.88"),
    liveBudget.totals.planned_budget,
  );
  await write(admin, csrf, "post", "/drafts/publish", {
    department_id: dept,
    fiscal_year: year,
  }).expect(200);
  assert.ok((await M.budget_adjustments.findByPk(source.id)).deleted_at);
});
test("settlement preserves adjustment totals, records an audit, and does not create expenses", async () => {
  const row = (
    await write(
      admin,
      csrf,
      "post",
      "/adjustments",
      live({ adjustment_type: "temporary", obligation_status: "owed" }),
    ).expect(201)
  ).body;
  const count = await M.fiscal_year_expenses.count();
  await write(admin, csrf, "post", `/commitments/${row.id}/settle`).expect(200);
  const settled = await M.budget_adjustments.findByPk(row.id);
  assert.equal(settled.adjustment_type, "permanent");
  assert.equal(settled.obligation_status, "settled");
  assert.equal(await M.fiscal_year_expenses.count(), count);
  await write(admin, csrf, "post", `/commitments/${row.id}/settle`).expect(409);
});
test("salary validation, stable identities, separate faculty/staff UINs, and calculated totals", async () => {
  const data = {
    department_id: dept,
    fiscal_year: year,
    uin: "940000001",
    display_name: "Regression Faculty",
    previous_salary: "100000.10",
    salary_increase: "3000.20",
  };
  const row = (
    await write(admin, csrf, "post", "/salaries/faculty", data).expect(201)
  ).body;
  assert.equal(row.new_salary, "103000.30");
  await write(admin, csrf, "post", "/salaries/faculty", data).expect(409);
  await write(admin, csrf, "put", `/salaries/faculty/${row.id}`, {
    ...data,
    uin: "940000002",
  }).expect(400);
  await write(admin, csrf, "post", "/salaries/staff", {
    ...data,
    uin: null,
  }).expect(400);
  await write(admin, csrf, "post", "/salaries/staff", data).expect(201);
  await write(admin, csrf, "post", "/salaries/faculty", {
    ...data,
    uin: null,
    previous_salary: "1.00",
    salary_increase: "-2.00",
  }).expect(400);
  await write(admin, csrf, "post", "/salaries/faculty", {
    ...data,
    uin: null,
    display_name: "Legacy Faculty",
  }).expect(201);
});
test("notes are line-scoped, resolvable, and auditable", async () => {
  const row = (
    await write(admin, csrf, "post", "/notes", {
      ...live(),
      note_text: "Review equipment timing.",
    }).expect(201)
  ).body;
  await write(admin, csrf, "patch", `/notes/${row.id}`, {
    is_resolved: true,
  }).expect(200);
  assert.equal((await M.line_notes.findByPk(row.id)).is_resolved, true);
  const response = (
    await admin
      .get(
        `/api/notes?department_id=${dept}&fiscal_year=${year}&account_code=2400`,
      )
      .expect(200)
  ).body;
  assert.ok(response.rows.some((x) => x.id === row.id));
});
test("CSV previews validate every row, unknown accounts, duplicated UINs, and negative salary totals", async () => {
  const context = {
    department_id: dept,
    fiscal_year: year,
    import_type: "adjustments",
    workspace_mode: "active",
  };
  const bad = (
    await write(admin, csrf, "post", "/imports/preview", {
      ...context,
      csv: "account_code,amount,adjustment_type\nUNKNOWN,100,permanent",
    }).expect(200)
  ).body;
  assert.equal(bad.valid, false);
  const invalid = (
    await write(admin, csrf, "post", "/imports/preview", {
      ...context,
      csv: "account_code,amount,adjustment_type\n2400,10.123,permanent",
    }).expect(200)
  ).body;
  assert.equal(invalid.valid, false);
  const duplicate = (
    await write(admin, csrf, "post", "/imports/preview", {
      ...context,
      import_type: "staff_salaries",
      csv: "uin,display_name,previous_salary,salary_increase\n950000001,A,100,0\n950000001,B,200,0",
    }).expect(200)
  ).body;
  assert.equal(duplicate.valid, false);
  const negative = (
    await write(admin, csrf, "post", "/imports/preview", {
      ...context,
      import_type: "staff_salaries",
      csv: "uin,display_name,previous_salary,salary_increase\n950000001,A,100,-200",
    }).expect(200)
  ).body;
  assert.equal(negative.valid, false);
});
test("import tokens are owned, bound to context, single-use, and expire", async () => {
  const context = {
    department_id: dept,
    fiscal_year: year,
    import_type: "adjustments",
    workspace_mode: "active",
  };
  const preview = (
    await write(admin, csrf, "post", "/imports/preview", {
      ...context,
      csv: "account_code,amount,adjustment_type,description\n2400,33.33,permanent,Imported allocation",
    }).expect(200)
  ).body;
  await write(manager, managerCsrf, "post", "/imports/commit", {
    ...context,
    token: preview.token,
  }).expect(404);
  await write(admin, csrf, "post", "/imports/commit", {
    ...context,
    workspace_mode: "draft",
    token: preview.token,
  }).expect(409);
  await write(admin, csrf, "post", "/imports/commit", {
    ...context,
    token: preview.token,
  }).expect(200);
  await write(admin, csrf, "post", "/imports/commit", {
    ...context,
    token: preview.token,
  }).expect(409);
  const expired = (
    await write(admin, csrf, "post", "/imports/preview", {
      ...context,
      csv: "account_code,amount,adjustment_type\n2400,10,permanent",
    })
  ).body;
  await M.import_previews.update(
    { expires_at: new Date(0) },
    { where: { token_hash: hash(expired.token) } },
  );
  await write(admin, csrf, "post", "/imports/commit", {
    ...context,
    token: expired.token,
  }).expect(409);
  assert.equal(
    (await M.import_previews.findByPk(hash(expired.token))).status,
    "expired",
  );
});
test("dataset changes invalidate import previews and concurrent commits consume once", async () => {
  const context = {
      department_id: dept,
      fiscal_year: year,
      import_type: "adjustments",
      workspace_mode: "active",
    },
    csv = "account_code,amount,adjustment_type\n2400,21.00,permanent";
  const p = (
    await write(admin, csrf, "post", "/imports/preview", { ...context, csv })
  ).body;
  await write(
    admin,
    csrf,
    "post",
    "/adjustments",
    live({ description: "Change after preview" }),
  ).expect(201);
  await write(admin, csrf, "post", "/imports/commit", {
    ...context,
    token: p.token,
  }).expect(409);
  assert.equal(
    (await M.import_previews.findByPk(hash(p.token))).status,
    "stale",
  );
  const fresh = (
    await write(admin, csrf, "post", "/imports/preview", { ...context, csv })
  ).body;
  const responses = await Promise.all(
    [1, 2].map(() =>
      write(admin, csrf, "post", "/imports/commit", {
        ...context,
        token: fresh.token,
      }),
    ),
  );
  assert.deepEqual(responses.map((x) => x.status).sort(), [200, 409]);
});
test("salary replacement preserves prior-year history and nulls target rollover references", async () => {
  const sourceCount = await M.faculty_salaries.count({
    where: { department_id: other, fiscal_year: year - 1 },
  });
  const priorTargets = await M.faculty_salaries.findAll({
    where: { department_id: other, fiscal_year: year },
  });
  const context = {
    department_id: other,
    fiscal_year: year,
    import_type: "faculty_salaries",
    workspace_mode: "active",
  };
  const p = (
    await write(admin, csrf, "post", "/imports/preview", {
      ...context,
      csv: "uin,display_name,previous_salary,salary_increase\n960000001,Replacement Faculty,120000.00,3600.00",
    }).expect(200)
  ).body;
  await write(admin, csrf, "post", "/imports/commit", {
    ...context,
    token: p.token,
  }).expect(200);
  assert.equal(
    await M.faculty_salaries.count({
      where: { department_id: other, fiscal_year: year },
    }),
    1,
  );
  assert.equal(
    await M.faculty_salaries.count({
      where: { department_id: other, fiscal_year: year - 1 },
    }),
    sourceCount,
  );
  const ledger = await M.faculty_salary_rollovers.findOne({
    where: { source_fiscal_year: year - 1, department_id: other },
  });
  assert.equal(ledger.target_salary_id, null);
  assert.equal(ledger.status, "target_removed");
});
test("CSV/XLSX exports include accurate matrix totals; server pagination and search work", async () => {
  const csv = await admin
    .get(`/api/export?department_id=${dept}&fiscal_year=${year}&format=csv`)
    .expect(200);
  assert.match(csv.text, /planned_budget/);
  assert.match(csv.text, /TOTAL/);
  const xlsx = await admin
    .get(`/api/export?department_id=${dept}&fiscal_year=${year}&format=xlsx`)
    .buffer(true)
    .parse((res, callback) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  assert.match(xlsx.headers["content-disposition"], /\.xlsx/);
  assert.ok(xlsx.body.length > 1000);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.body);
  assert.equal(
    workbook.worksheets[0].getRow(1).getCell(6).value,
    "planned budget",
  );
  assert.equal(workbook.worksheets[0].getRow(10).getCell(2).value, "TOTAL");
  const page = (
    await admin
      .get(
        `/api/expenses?department_id=${dept}&fiscal_year=${year}&limit=2&page=2`,
      )
      .expect(200)
  ).body;
  assert.equal(page.rows.length, 2);
  assert.equal(page.page, 2);
  const search = (
    await admin
      .get(
        `/api/adjustments?department_id=${dept}&fiscal_year=${year}&q=Imported`,
      )
      .expect(200)
  ).body;
  assert.ok(search.rows.length > 0);
  assert.ok(search.rows.every((x) => x.description.includes("Imported")));
});
test("administration protects system roles, validates hierarchy, and prevents self-lockout", async () => {
  const user = await M.users.findByPk(1);
  await write(admin, csrf, "put", "/admin/users/1", {
    ...user.get({ plain: true }),
    is_active: false,
  }).expect(409);
  const system = await M.roles.findByPk(1);
  await write(admin, csrf, "put", "/admin/roles/1", {
    role_name: "Edited",
    permissions: JSON.parse(system.permissions_json),
  }).expect(409);
  await write(admin, csrf, "post", "/admin/departments", {
    dept_code: "BAD",
    dept_name: "Invalid nested workspace",
    parent_department_id: dept,
    is_workspace: true,
  }).expect(400);
  const permissions = { scope: "own", budgets: "read" };
  const role = (
    await write(admin, csrf, "post", "/admin/roles", {
      role_name: "Custom reviewer",
      permissions,
    }).expect(201)
  ).body;
  assert.equal(JSON.parse(role.permissions_json).salaries, "none");
});
test("rollover obeys Chicago July 1, is idempotent, carries planned bases and salary totals, and expires drafts", async () => {
  await assert.rejects(
    () =>
      rollover(
        adminCtx,
        { source_fiscal_year: year },
        new Date(`${year}-07-01T04:59:00Z`),
      ),
    /becomes available/,
  );
  const source = year - 4,
    target = source + 1;
  await M.fiscal_year_states.create({ fiscal_year: source, status: "active" });
  await M.budget_bases.create({
    department_id: dept,
    account_code: "2400",
    fiscal_year: source,
    base_amount: "1000.10",
  });
  await M.budget_adjustments.create({
    ...live(),
    fiscal_year: source,
    amount: "100.20",
  });
  await M.fiscal_year_expenses.create({
    ...live(),
    fiscal_year: source,
    expense_date: `${source - 1}-08-01`,
    amount: "300.00",
  });
  const draft = await M.budget_adjustment_drafts.create({
    ...live(),
    fiscal_year: source,
    amount: "500.00",
    draft_action: "create",
  });
  const member = await M.staff_members.create({
    id: randomUUID(),
    uin: "970000001",
    display_name: "Rollover staff",
  });
  const salary = await M.staff_salaries.create({
    department_id: dept,
    fiscal_year: source,
    staff_id: member.id,
    staff_name: member.display_name,
    previous_salary: "100.10",
    salary_increase: "5.20",
    new_salary: "105.30",
  });
  const first = await rollover(
    adminCtx,
    { source_fiscal_year: source },
    new Date(`${target - 1}-07-01T05:00:00Z`),
  );
  assert.equal(first.budget_base_count, 1);
  assert.equal(first.staff_salary_count, 1);
  const next = await M.budget_bases.findOne({
    where: { department_id: dept, account_code: "2400", fiscal_year: target },
  });
  assert.equal(next.base_amount, "1100.30");
  const nextSalary = await M.staff_salaries.findOne({
    where: { rolled_over_from_id: salary.id },
  });
  assert.equal(nextSalary.previous_salary, "105.30");
  assert.equal(nextSalary.new_salary, "105.30");
  assert.equal(nextSalary.salary_increase, "0.00");
  assert.equal(
    await M.fiscal_year_expenses.count({ where: { fiscal_year: target } }),
    0,
  );
  assert.equal(
    (await M.budget_adjustment_drafts.findByPk(draft.id)).status,
    "expired",
  );
  assert.equal(
    (await M.fiscal_year_states.findByPk(source)).status,
    "archived",
  );
  const repeat = await rollover(adminCtx, { source_fiscal_year: source });
  assert.equal(repeat.already_completed, true);
  await write(admin, csrf, "delete", `/salaries/staff/${nextSalary.id}`).expect(
    200,
  );
  assert.equal(
    (
      await M.staff_salary_rollovers.findOne({
        where: { source_salary_id: salary.id },
      })
    ).target_salary_id,
    null,
  );
});

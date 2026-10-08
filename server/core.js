import { createHash, randomBytes } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { Op } from "sequelize";
import { db, models as M } from "./db.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => {
  throw new HttpError(status, message);
};
export const plain = (x) =>
  x == null ? x : structuredClone(x?.get ? x.get({ plain: true }) : x);
export const hash = (x) =>
  createHash("sha256")
    .update(typeof x === "string" ? x : JSON.stringify(x))
    .digest("hex");
export const token = () => randomBytes(32).toString("hex");
export const amount = (x) => new Decimal(x || 0).toFixed(2);
export const add = (...xs) =>
  xs.reduce((a, x) => a.plus(x || 0), new Decimal(0)).toFixed(2);
export const subtract = (a, b) => new Decimal(a).minus(b).toFixed(2);
export const sum = (xs, key) => add(...xs.map((x) => x[key]));
export function chicagoDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function currentFiscalYear(now = new Date()) {
  const [y, m] = chicagoDate(now).split("-").map(Number);
  return y + (m >= 7 ? 1 : 0);
}
export const moneySchema = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine(
    (x) => /^-?\d{1,12}(\.\d{1,2})?$/.test(x),
    "Use a monetary amount with at most 12 digits and 2 decimal places.",
  )
  .transform(amount);
export const yearSchema = z.coerce.number().int().min(2000).max(2200);
export const idSchema = z.coerce.number().int().positive();
export const contextSchema = z.object({
  department_id: idSchema,
  fiscal_year: yearSchema,
});
export const lineSchema = contextSchema.extend({
  account_code: z.string().min(1).max(50),
});
export const adjustmentSchema = lineSchema.extend({
  amount: moneySchema,
  adjustment_type: z.enum(["permanent", "temporary"]),
  obligation_status: z
    .enum(["none", "owed", "settled"])
    .nullable()
    .optional()
    .default("none"),
  description: z.string().max(500).default(""),
  reference_source: z.string().max(255).nullable().optional().default(null),
  reference_id: idSchema.nullable().optional().default(null),
});
export const expenseSchema = lineSchema.extend({
  amount: moneySchema.refine(
    (x) => new Decimal(x).gt(0),
    "Expenses must be positive.",
  ),
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(1).max(500),
});
export const salarySchema = contextSchema
  .extend({
    uin: z
      .string()
      .regex(/^\d{9}$/)
      .nullable()
      .optional(),
    display_name: z.string().trim().min(1).max(255),
    previous_salary: moneySchema.refine(
      (x) => new Decimal(x).gte(0),
      "Previous salary cannot be negative.",
    ),
    salary_increase: moneySchema,
  })
  .refine(
    (x) =>
      new Decimal(x.previous_salary).plus(x.salary_increase).gte(0) &&
      new Decimal(x.previous_salary)
        .plus(x.salary_increase)
        .lt("1000000000000"),
    "Calculated salary is outside the permitted range.",
  );
export const permissionsSchema = z.object({
  scope: z.enum(["own", "children", "all"]),
  ...Object.fromEntries(
    [
      "budgets",
      "expenses",
      "salaries",
      "notes",
      "drafts",
      "imports",
      "audit",
      "admin",
      "rollover",
    ].map((x) => [x, z.enum(["none", "read", "write"]).default("none")]),
  ),
});
export function requirePermission(ctx, resource, write = false) {
  const p = ctx.permissions[resource];
  if (p !== "write" && (write || p !== "read"))
    fail(
      403,
      `You do not have ${write ? "write" : "read"} access to ${resource}.`,
    );
}
export function requireScope(ctx, department) {
  if (!ctx.departmentIds.includes(Number(department)))
    fail(403, "This department is outside your permitted workspaces.");
}
export async function scopedDepartments(user, permissions) {
  const all = await M.departments.findAll({
    where: { is_active: true },
    order: [["dept_name", "ASC"]],
  });
  return all.filter(
    (d) =>
      permissions.scope === "all" ||
      d.id === user.department_id ||
      (permissions.scope === "children" &&
        d.parent_department_id === user.department_id),
  );
}
export function scopeWhere(ctx, query = {}) {
  if (query.department_id) {
    const id = idSchema.parse(query.department_id);
    requireScope(ctx, id);
    return { department_id: id };
  }
  return { department_id: { [Op.in]: ctx.departmentIds } };
}
export async function audit(ctx, action, table, before, after, transaction) {
  const row = plain(after || before) || {};
  await M.audit_logs.create(
    {
      user_id: ctx?.user?.id || null,
      actor_uin: ctx?.user?.uin || null,
      action_type: action,
      target_table: table,
      record_id: Number.isInteger(row.id) ? row.id : null,
      department_id: row.department_id || null,
      account_code: row.account_code || null,
      fiscal_year: row.fiscal_year || null,
      changes_json: JSON.stringify({
        before: plain(before) || null,
        after: plain(after) || null,
      }),
    },
    { transaction },
  );
}
export async function lockYear(year, transaction) {
  await db.query(
    "INSERT INTO transaction_locks (lock_key, updated_at) VALUES (?, NOW()) ON DUPLICATE KEY UPDATE updated_at = updated_at",
    { replacements: [`fiscal-year:${year}`], transaction },
  );
  await M.transaction_locks.findByPk(`fiscal-year:${year}`, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
}
export async function financialWrite(ctx, resource, input, fn) {
  requirePermission(ctx, resource, true);
  requireScope(ctx, input.department_id);
  return db.transaction(async (transaction) => {
    await lockYear(input.fiscal_year, transaction);
    const state = await M.fiscal_year_states.findByPk(input.fiscal_year, {
      transaction,
    });
    if (!state || state.status !== "active")
      fail(
        409,
        "This fiscal year is archived or unavailable and cannot be changed.",
      );
    const dept = await M.departments.findByPk(input.department_id, {
      transaction,
    });
    if (!dept?.is_workspace || !dept.is_active)
      fail(400, "Choose an active department workspace.");
    if (
      input.account_code &&
      !(await M.banner_accounts.findByPk(input.account_code, { transaction }))
    )
      fail(400, "Unknown Banner account.");
    return fn(transaction);
  });
}
export async function record(model, id, ctx, resource, transaction) {
  requirePermission(ctx, resource);
  const row = await model.findByPk(idSchema.parse(id), { transaction });
  if (!row || row.deleted_at) fail(404, "Record not found.");
  requireScope(ctx, row.department_id);
  return row;
}
export function snapshot(row) {
  const x = plain(row);
  return hash(
    Object.fromEntries(
      [
        "id",
        "department_id",
        "account_code",
        "fiscal_year",
        "amount",
        "adjustment_type",
        "obligation_status",
        "description",
        "reference_source",
        "reference_id",
        "created_by_user_id",
        "created_at",
        "updated_at",
        "updated_by_user_id",
        "deleted_at",
        "deleted_by_user_id",
        "is_draft",
      ].map((k) => [k, k === "amount" ? amount(x[k]) : (x[k] ?? null)]),
    ),
  );
}
export const liveWhere = { deleted_at: null, is_draft: false };
export async function matrix(ctx, query, transaction) {
  requirePermission(ctx, "budgets");
  const input = contextSchema.parse(query);
  requireScope(ctx, input.department_id);
  const accounts = await M.banner_accounts.findAll({
    order: [["account_code", "ASC"]],
    transaction,
  });
  const bases = await M.budget_bases.findAll({ where: input, transaction });
  let adjustments = (
    await M.budget_adjustments.findAll({
      where: { ...input, ...liveWhere },
      transaction,
    })
  ).map(plain);
  const drafts =
    query.mode === "draft"
      ? await M.budget_adjustment_drafts.findAll({
          where: { ...input, status: "pending" },
          transaction,
        })
      : [];
  if (query.mode === "draft") {
    requirePermission(ctx, "drafts");
    const sources = new Set(
      drafts.map((x) => x.source_adjustment_id).filter(Boolean),
    );
    adjustments = adjustments
      .filter((x) => !sources.has(x.id))
      .concat(drafts.filter((x) => x.draft_action !== "delete").map(plain));
  }
  const expenses =
    ctx.permissions.expenses === "none" || !ctx.permissions.expenses
      ? []
      : await M.fiscal_year_expenses.findAll({
          where: { ...input, deleted_at: null },
          transaction,
        });
  const rows = accounts.map((account) => {
    const base = amount(
      bases.find((x) => x.account_code === account.account_code)?.base_amount,
    );
    const adjustment = sum(
      adjustments.filter((x) => x.account_code === account.account_code),
      "amount",
    );
    const spent = sum(
      expenses.filter((x) => x.account_code === account.account_code),
      "amount",
    );
    return {
      ...plain(account),
      base_amount: base,
      adjustments: adjustment,
      planned_budget: add(base, adjustment),
      spent,
      remaining_base: subtract(base, spent),
    };
  });
  return {
    rows,
    totals: Object.fromEntries(
      [
        "base_amount",
        "adjustments",
        "planned_budget",
        "spent",
        "remaining_base",
      ].map((key) => [key, sum(rows, key)]),
    ),
    mode: query.mode === "draft" ? "draft" : "active",
  };
}
export function pagination(query) {
  const page = Math.floor(
    Math.max(1, Math.min(Number(query.page) || 1, 100000)),
  );
  const limit = Math.floor(
    Math.max(1, Math.min(Number(query.limit) || 20, 100)),
  );
  return { page, limit, offset: (page - 1) * limit };
}
export async function list(
  ctx,
  resource,
  model,
  query,
  extra = {},
  searchFields = ["description"],
) {
  requirePermission(ctx, resource);
  const p = pagination(query);
  const where = { ...scopeWhere(ctx, query), ...extra };
  if (query.fiscal_year)
    where.fiscal_year = yearSchema.parse(query.fiscal_year);
  if (query.account_code) where.account_code = String(query.account_code);
  if (query.q)
    where[Op.and] = [
      {
        [Op.or]: searchFields.map((k) => ({
          [k]: { [Op.like]: `%${String(query.q).slice(0, 100)}%` },
        })),
      },
    ];
  const { rows, count } = await model.findAndCountAll({
    where,
    order: [["id", "DESC"]],
    limit: p.limit,
    offset: p.offset,
  });
  return { rows, total: count, page: p.page, limit: p.limit };
}

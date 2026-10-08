import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { models as M } from "./db.js";
import {
  adjustmentSchema,
  expenseSchema,
  salarySchema,
  lineSchema,
  contextSchema,
  moneySchema,
  financialWrite,
  record,
  audit,
  snapshot,
  plain,
  fail,
  amount,
  add,
  liveWhere,
  requirePermission,
  requireScope,
} from "./core.js";

export async function saveBase(ctx, raw) {
  const input = lineSchema.extend({ base_amount: moneySchema }).parse(raw);
  return financialWrite(ctx, "budgets", input, async (transaction) => {
    const where = {
      department_id: input.department_id,
      account_code: input.account_code,
      fiscal_year: input.fiscal_year,
    };
    const before = await M.budget_bases.findOne({ where, transaction });
    const original = plain(before);
    const row = before
      ? await before.update(
          { base_amount: input.base_amount, updated_at: new Date() },
          { transaction },
        )
      : await M.budget_bases.create(input, { transaction });
    await audit(
      ctx,
      before ? "update" : "create",
      "budget_bases",
      original,
      row,
      transaction,
    );
    return row;
  });
}
export async function saveAdjustment(ctx, raw, id) {
  const input = adjustmentSchema.parse(raw);
  return financialWrite(ctx, "budgets", input, async (transaction) => {
    let row, before;
    if (id) {
      row = await record(M.budget_adjustments, id, ctx, "budgets", transaction);
      if (
        row.department_id !== input.department_id ||
        row.fiscal_year !== input.fiscal_year
      )
        fail(
          400,
          "An adjustment cannot be moved between departments or years.",
        );
      before = plain(row);
      await row.update(
        { ...input, updated_at: new Date(), updated_by_user_id: ctx.user.id },
        { transaction },
      );
    } else
      row = await M.budget_adjustments.create(
        { ...input, created_by_user_id: ctx.user.id },
        { transaction },
      );
    await audit(
      ctx,
      id ? "update" : "create",
      "budget_adjustments",
      before,
      row,
      transaction,
    );
    return row;
  });
}
export async function softDelete(ctx, model, resource, id) {
  const row = await record(model, id, ctx, resource);
  return financialWrite(ctx, resource, row, async (transaction) => {
    const fresh = await record(model, id, ctx, resource, transaction);
    const before = plain(fresh);
    await fresh.update(
      { deleted_at: new Date(), deleted_by_user_id: ctx.user.id },
      { transaction },
    );
    await audit(ctx, "delete", model.tableName, before, fresh, transaction);
    return { success: true };
  });
}
export async function saveExpense(ctx, raw, id) {
  const input = expenseSchema.parse(raw);
  const d = new Date(`${input.expense_date}T12:00:00Z`);
  if (
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== input.expense_date ||
    input.expense_date < `${input.fiscal_year - 1}-07-01` ||
    input.expense_date > `${input.fiscal_year}-06-30`
  )
    fail(
      400,
      "Expense date must be a valid date within the selected fiscal year.",
    );
  return financialWrite(ctx, "expenses", input, async (transaction) => {
    let row, before;
    if (id) {
      row = await record(
        M.fiscal_year_expenses,
        id,
        ctx,
        "expenses",
        transaction,
      );
      if (
        row.department_id !== input.department_id ||
        row.fiscal_year !== input.fiscal_year
      )
        fail(400, "An expense cannot be moved between departments or years.");
      before = plain(row);
      await row.update(
        { ...input, updated_at: new Date(), updated_by_user_id: ctx.user.id },
        { transaction },
      );
    } else
      row = await M.fiscal_year_expenses.create(
        { ...input, created_by_user_id: ctx.user.id },
        { transaction },
      );
    await audit(
      ctx,
      id ? "update" : "create",
      "fiscal_year_expenses",
      before,
      row,
      transaction,
    );
    return row;
  });
}
export async function saveDraft(ctx, raw, id) {
  const input = adjustmentSchema
    .omit({ reference_source: true, reference_id: true })
    .extend({
      draft_action: z.enum(["create", "update", "delete"]),
      source_adjustment_id: z.coerce
        .number()
        .int()
        .positive()
        .nullable()
        .optional(),
    })
    .parse(raw);
  return financialWrite(ctx, "drafts", input, async (transaction) => {
    let source;
    if (input.draft_action !== "create") {
      source = await record(
        M.budget_adjustments,
        input.source_adjustment_id,
        ctx,
        "budgets",
        transaction,
      );
      if (
        source.department_id !== input.department_id ||
        source.fiscal_year !== input.fiscal_year
      )
        fail(400, "The source must belong to this workspace and fiscal year.");
    } else if (input.source_adjustment_id)
      fail(400, "A new draft cannot reference a live adjustment.");
    let row, before;
    if (id) {
      row = await record(
        M.budget_adjustment_drafts,
        id,
        ctx,
        "drafts",
        transaction,
      );
      if (
        row.status !== "pending" ||
        row.department_id !== input.department_id ||
        row.fiscal_year !== input.fiscal_year ||
        row.source_adjustment_id !== (input.source_adjustment_id || null) ||
        row.draft_action !== input.draft_action
      )
        fail(409, "Only the contents of a pending draft can be edited.");
      before = plain(row);
      await row.update(
        { ...input, updated_at: new Date(), updated_by_user_id: ctx.user.id },
        { transaction },
      );
    } else
      row = await M.budget_adjustment_drafts.create(
        {
          ...input,
          source_snapshot_hash: source ? snapshot(source) : null,
          created_by_user_id: ctx.user.id,
        },
        { transaction },
      );
    await audit(
      ctx,
      id ? "update_draft" : "create_draft",
      "budget_adjustment_drafts",
      before,
      row,
      transaction,
    );
    return row;
  });
}
export async function discardDraft(ctx, id) {
  const row = await record(M.budget_adjustment_drafts, id, ctx, "drafts");
  return financialWrite(ctx, "drafts", row, async (transaction) => {
    const fresh = await record(
      M.budget_adjustment_drafts,
      id,
      ctx,
      "drafts",
      transaction,
    );
    if (fresh.status !== "pending")
      fail(409, "This draft is no longer pending.");
    await audit(
      ctx,
      "discard_draft",
      "budget_adjustment_drafts",
      fresh,
      null,
      transaction,
    );
    await fresh.destroy({ transaction });
    return { success: true };
  });
}
export async function publishDrafts(ctx, raw) {
  const input = contextSchema.parse(raw);
  requirePermission(ctx, "budgets", true);
  return financialWrite(ctx, "drafts", input, async (transaction) => {
    const drafts = await M.budget_adjustment_drafts.findAll({
      where: { ...input, status: "pending" },
      order: [["id", "ASC"]],
      transaction,
    });
    for (const draft of drafts) {
      if (!draft.source_adjustment_id) continue;
      const source = await M.budget_adjustments.findByPk(
        draft.source_adjustment_id,
        { transaction },
      );
      if (
        !source ||
        source.deleted_at ||
        snapshot(source) !== draft.source_snapshot_hash
      )
        fail(
          409,
          `Draft ${draft.id} conflicts with a changed live adjustment. Discard and recreate it after reviewing the source.`,
        );
    }
    for (const draft of drafts) {
      const data = Object.fromEntries(
        [
          "department_id",
          "account_code",
          "fiscal_year",
          "amount",
          "adjustment_type",
          "obligation_status",
          "description",
        ].map((k) => [k, draft[k]]),
      );
      let source, before;
      if (draft.draft_action === "create")
        source = await M.budget_adjustments.create(
          { ...data, created_by_user_id: ctx.user.id },
          { transaction },
        );
      else {
        source = await M.budget_adjustments.findByPk(
          draft.source_adjustment_id,
          { transaction },
        );
        before = plain(source);
        await source.update(
          draft.draft_action === "delete"
            ? { deleted_at: new Date(), deleted_by_user_id: ctx.user.id }
            : {
                ...data,
                updated_at: new Date(),
                updated_by_user_id: ctx.user.id,
              },
          { transaction },
        );
      }
      await audit(
        ctx,
        `publish_${draft.draft_action}`,
        "budget_adjustments",
        before,
        source,
        transaction,
      );
      await audit(
        ctx,
        "publish_draft",
        "budget_adjustment_drafts",
        draft,
        null,
        transaction,
      );
      await draft.destroy({ transaction });
    }
    return { published: drafts.length };
  });
}
export async function settleCommitment(ctx, id) {
  const row = await record(M.budget_adjustments, id, ctx, "budgets");
  return financialWrite(ctx, "budgets", row, async (transaction) => {
    const fresh = await record(
      M.budget_adjustments,
      id,
      ctx,
      "budgets",
      transaction,
    );
    if (
      fresh.adjustment_type !== "temporary" &&
      fresh.obligation_status !== "owed"
    )
      fail(409, "This record is not an outstanding commitment.");
    const before = plain(fresh);
    await fresh.update(
      {
        adjustment_type: "permanent",
        obligation_status: "settled",
        updated_by_user_id: ctx.user.id,
        updated_at: new Date(),
      },
      { transaction },
    );
    await audit(
      ctx,
      "settle",
      "budget_adjustments",
      before,
      fresh,
      transaction,
    );
    return fresh;
  });
}
export async function saveSalaryInTransaction(
  ctx,
  kind,
  input,
  id,
  transaction,
) {
  if (kind === "staff" && !input.uin) fail(400, "Staff UIN is required.");
  const new_salary = add(input.previous_salary, input.salary_increase);
  if (
    new Decimal(new_salary).lt(0) ||
    new Decimal(new_salary).gte("1000000000000")
  )
    fail(400, "Calculated salary is outside the permitted range.");
  const members = M[`${kind}_members`],
    salaries = M[`${kind}_salaries`];
  let row, before, member;
  if (id) {
    row = await record(salaries, id, ctx, "salaries", transaction);
    if (
      row.department_id !== input.department_id ||
      row.fiscal_year !== input.fiscal_year
    )
      fail(400, "A salary cannot be moved between departments or years.");
    before = plain(row);
    member = await members.findByPk(row[`${kind}_id`], { transaction });
    if ((input.uin || null) !== member.uin)
      fail(
        400,
        "An existing appointment cannot be reassigned to a different UIN.",
      );
  } else {
    member = input.uin
      ? await members.findOne({ where: { uin: input.uin }, transaction })
      : null;
    if (!member)
      member = await members.create(
        {
          id: randomUUID(),
          uin: input.uin || null,
          display_name: input.display_name,
        },
        { transaction },
      );
  }
  const data = {
    department_id: input.department_id,
    fiscal_year: input.fiscal_year,
    [`${kind}_id`]: member.id,
    [`${kind}_name`]: input.display_name,
    previous_salary: input.previous_salary,
    salary_increase: input.salary_increase,
    new_salary,
    updated_at: new Date(),
  };
  if (row)
    await row.update(
      { ...data, updated_by_user_id: ctx.user.id },
      { transaction },
    );
  else
    row = await salaries.create(
      { ...data, created_by_user_id: ctx.user.id },
      { transaction },
    );
  await audit(
    ctx,
    id ? "update" : "create",
    `${kind}_salaries`,
    before,
    row,
    transaction,
  );
  return { ...plain(row), uin: member.uin };
}
export async function saveSalary(ctx, kind, raw, id) {
  const input = salarySchema.parse(raw);
  return financialWrite(ctx, "salaries", input, (transaction) =>
    saveSalaryInTransaction(ctx, kind, input, id, transaction),
  );
}
export async function deleteSalaryInTransaction(ctx, kind, row, transaction) {
  const ledger = M[`${kind}_salary_rollovers`];
  // Source rows are durable once rolled over; active-year targets can be removed.
  if (
    await ledger.findOne({ where: { source_salary_id: row.id }, transaction })
  )
    fail(409, "A rolled-over source salary must be preserved.");
  await ledger.update(
    { status: "target_removed", updated_at: new Date() },
    { where: { target_salary_id: row.id }, transaction },
  );
  await audit(ctx, "delete", `${kind}_salaries`, row, null, transaction);
  await row.destroy({ transaction });
}
export async function deleteSalary(ctx, kind, id) {
  const row = await record(M[`${kind}_salaries`], id, ctx, "salaries");
  return financialWrite(ctx, "salaries", row, async (transaction) => {
    const fresh = await record(
      M[`${kind}_salaries`],
      id,
      ctx,
      "salaries",
      transaction,
    );
    await deleteSalaryInTransaction(ctx, kind, fresh, transaction);
    return { success: true };
  });
}
export async function saveNote(ctx, raw, id) {
  if (id) {
    const row = await record(M.line_notes, id, ctx, "notes");
    const { is_resolved } = z.object({ is_resolved: z.boolean() }).parse(raw);
    return financialWrite(ctx, "notes", row, async (transaction) => {
      const fresh = await record(M.line_notes, id, ctx, "notes", transaction);
      const before = plain(fresh);
      await fresh.update({ is_resolved }, { transaction });
      await audit(
        ctx,
        "resolve_note",
        "line_notes",
        before,
        fresh,
        transaction,
      );
      return fresh;
    });
  }
  const input = lineSchema
    .extend({ note_text: z.string().trim().min(1).max(10000) })
    .parse(raw);
  return financialWrite(ctx, "notes", input, async (transaction) => {
    const row = await M.line_notes.create(
      { ...input, created_by_user_id: ctx.user.id },
      { transaction },
    );
    await audit(ctx, "create", "line_notes", null, row, transaction);
    return row;
  });
}

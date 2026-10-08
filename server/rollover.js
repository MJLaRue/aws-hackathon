import { Op } from "sequelize";
import { db, models as M } from "./db.js";
import {
  yearSchema,
  requirePermission,
  lockYear,
  currentFiscalYear,
  fail,
  plain,
  add,
  audit,
  liveWhere,
} from "./core.js";

export async function rollover(ctx, raw, now = new Date()) {
  requirePermission(ctx, "rollover", true);
  if (ctx.permissions.scope !== "all")
    fail(403, "Fiscal-year rollover requires access to all departments.");
  const source = yearSchema.parse(raw.source_fiscal_year),
    target = source + 1;
  if (target > currentFiscalYear(now))
    fail(
      409,
      `Rollover to FY ${target} becomes available on July 1, ${target - 1}, in America/Chicago.`,
    );
  return db.transaction(async (transaction) => {
    await lockYear(source, transaction);
    await lockYear(target, transaction);
    const previous = await M.fiscal_year_rollovers.findOne({
      where: { source_fiscal_year: source, target_fiscal_year: target },
      transaction,
    });
    if (previous) return { ...plain(previous), already_completed: true };
    const state = await M.fiscal_year_states.findByPk(source, { transaction });
    if (!state || state.status !== "active")
      fail(409, "Only an active fiscal year can be rolled over.");
    for (const table of [
      "budget_bases",
      "budget_adjustments",
      "budget_adjustment_drafts",
      "fiscal_year_expenses",
      "faculty_salaries",
      "staff_salaries",
      "line_notes",
    ]) {
      if (await M[table].count({ where: { fiscal_year: target }, transaction }))
        fail(
          409,
          "The target fiscal year already contains records. Rollover will not overwrite them.",
        );
    }
    const targetState = await M.fiscal_year_states.findByPk(target, {
      transaction,
    });
    if (targetState?.status === "archived")
      fail(409, "The target fiscal year is archived.");
    if (!targetState)
      await M.fiscal_year_states.create(
        { fiscal_year: target, status: "active" },
        { transaction },
      );
    const bases = await M.budget_bases.findAll({
      where: { fiscal_year: source },
      transaction,
    });
    const adjustments = await M.budget_adjustments.findAll({
      where: { fiscal_year: source, ...liveWhere },
      transaction,
    });
    const lines = new Map();
    for (const base of bases)
      lines.set(`${base.department_id}:${base.account_code}`, {
        department_id: base.department_id,
        account_code: base.account_code,
        base_amount: base.base_amount,
      });
    for (const adjustment of adjustments) {
      const key = `${adjustment.department_id}:${adjustment.account_code}`;
      const line = lines.get(key) || {
        department_id: adjustment.department_id,
        account_code: adjustment.account_code,
        base_amount: "0.00",
      };
      line.base_amount = add(line.base_amount, adjustment.amount);
      lines.set(key, line);
    }
    for (const line of lines.values()) {
      const row = await M.budget_bases.create(
        { ...line, fiscal_year: target },
        { transaction },
      );
      await audit(ctx, "rollover_base", "budget_bases", null, row, transaction);
    }
    const counts = {};
    for (const kind of ["faculty", "staff"]) {
      const rows = await M[`${kind}_salaries`].findAll({
        where: { fiscal_year: source },
        transaction,
      });
      counts[kind] = rows.length;
      for (const row of rows) {
        const next = await M[`${kind}_salaries`].create(
          {
            department_id: row.department_id,
            [`${kind}_id`]: row[`${kind}_id`],
            [`${kind}_name`]: row[`${kind}_name`],
            previous_salary: row.new_salary,
            salary_increase: "0.00",
            new_salary: row.new_salary,
            fiscal_year: target,
            rolled_over_from_id: row.id,
            created_by_user_id: ctx.user?.id || null,
          },
          { transaction },
        );
        await M[`${kind}_salary_rollovers`].create(
          {
            source_salary_id: row.id,
            target_salary_id: next.id,
            source_fiscal_year: source,
            target_fiscal_year: target,
            department_id: row.department_id,
            status: "completed",
          },
          { transaction },
        );
        await audit(
          ctx,
          "rollover_salary",
          `${kind}_salaries`,
          row,
          next,
          transaction,
        );
      }
    }
    await M.budget_adjustment_drafts.update(
      {
        status: "expired",
        expired_at: now,
        expiration_reason: "Fiscal-year rollover",
      },
      { where: { fiscal_year: source, status: "pending" }, transaction },
    );
    await M.import_previews.update(
      { status: "expired" },
      { where: { fiscal_year: source, status: "pending" }, transaction },
    );
    const before = plain(state);
    await state.update(
      { status: "archived", archived_at: now, rolled_to_fiscal_year: target },
      { transaction },
    );
    await audit(
      ctx,
      "archive_year",
      "fiscal_year_states",
      before,
      state,
      transaction,
    );
    const marker = await M.fiscal_year_rollovers.create(
      {
        source_fiscal_year: source,
        target_fiscal_year: target,
        budget_base_count: lines.size,
        faculty_salary_count: counts.faculty,
        staff_salary_count: counts.staff,
      },
      { transaction },
    );
    await audit(
      ctx,
      "rollover",
      "fiscal_year_rollovers",
      null,
      { ...plain(marker), fiscal_year: source },
      transaction,
    );
    return marker;
  });
}
export async function rolloverDueYears() {
  const states = await M.fiscal_year_states.findAll({
    where: { status: "active", fiscal_year: { [Op.lt]: currentFiscalYear() } },
    order: [["fiscal_year", "ASC"]],
  });
  const ctx = { user: null, permissions: { scope: "all", rollover: "write" } };
  for (const state of states)
    for (let year = state.fiscal_year; year < currentFiscalYear(); year++)
      await rollover(ctx, { source_fiscal_year: year });
}

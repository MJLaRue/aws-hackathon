import { parse } from "csv-parse/sync";
import { z } from "zod";
import { db, models as M } from "./db.js";
import {
  contextSchema,
  adjustmentSchema,
  salarySchema,
  hash,
  token,
  plain,
  financialWrite,
  requirePermission,
  requireScope,
  fail,
  audit,
  liveWhere,
} from "./core.js";
import {
  saveSalaryInTransaction,
  deleteSalaryInTransaction,
} from "./finance.js";

const previewSchema = contextSchema.extend({
  import_type: z.enum(["adjustments", "faculty_salaries", "staff_salaries"]),
  workspace_mode: z.enum(["active", "draft"]).default("active"),
  csv: z.string().min(1).max(1000000),
});
const resourceOf = (type) => (type === "adjustments" ? "budgets" : "salaries");
const workspace = (x) => ({
  department_id: x.department_id,
  fiscal_year: x.fiscal_year,
  import_type: x.import_type,
  workspace_mode: x.workspace_mode,
});
async function fingerprint(input, transaction) {
  const where = {
    department_id: input.department_id,
    fiscal_year: input.fiscal_year,
  };
  const table =
    input.import_type === "adjustments"
      ? "budget_adjustments"
      : input.import_type;
  const rows = await M[table].findAll({
    where,
    order: [["id", "ASC"]],
    transaction,
  });
  const drafts =
    input.workspace_mode === "draft"
      ? await M.budget_adjustment_drafts.findAll({
          where: { ...where, status: "pending" },
          order: [["id", "ASC"]],
          transaction,
        })
      : [];
  return hash({ rows: rows.map(plain), drafts: drafts.map(plain) });
}
export async function previewImport(ctx, raw) {
  const input = previewSchema.parse(raw),
    resource = resourceOf(input.import_type);
  requirePermission(ctx, resource, true);
  if (input.workspace_mode === "draft") {
    if (input.import_type !== "adjustments")
      fail(400, "Salary imports use the active workspace.");
    requirePermission(ctx, "drafts", true);
  }
  let rows;
  try {
    rows = parse(input.csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      max_record_size: 20000,
    });
  } catch {
    fail(400, "Invalid CSV. Check headers, quoting, and column counts.");
  }
  if (!rows.length || rows.length > 2000)
    fail(400, "Import between 1 and 2,000 records at a time.");
  const errors = [],
    validated = [],
    uins = new Set();
  for (const [index, row] of rows.entries()) {
    const schema =
      input.import_type === "adjustments" ? adjustmentSchema : salarySchema;
    const parsed = schema.safeParse({
      ...row,
      department_id: input.department_id,
      fiscal_year: input.fiscal_year,
      ...(input.import_type !== "adjustments" ? { uin: row.uin || null } : {}),
    });
    if (!parsed.success) {
      errors.push({
        row: index + 2,
        message: parsed.error.issues
          .map((x) => `${x.path.join(".")}: ${x.message}`)
          .join("; "),
      });
      continue;
    }
    if (input.import_type === "staff_salaries" && !parsed.data.uin) {
      errors.push({ row: index + 2, message: "Staff UIN is required." });
      continue;
    }
    if (input.import_type !== "adjustments" && parsed.data.uin) {
      if (uins.has(parsed.data.uin)) {
        errors.push({
          row: index + 2,
          message: "Duplicate UIN within import.",
        });
        continue;
      }
      uins.add(parsed.data.uin);
    }
    validated.push(parsed.data);
  }
  if (errors.length) return { valid: false, errors, row_count: rows.length };
  return financialWrite(ctx, "imports", input, async (transaction) => {
    if (input.import_type === "adjustments") {
      const accounts = new Set(
        (await M.banner_accounts.findAll({ transaction })).map(
          (x) => x.account_code,
        ),
      );
      for (const [i, row] of validated.entries())
        if (!accounts.has(row.account_code))
          errors.push({
            row: i + 2,
            message: `Unknown Banner account ${row.account_code}.`,
          });
    }
    if (errors.length) return { valid: false, errors, row_count: rows.length };
    const previewToken = token();
    await M.import_previews.create(
      {
        token_hash: hash(previewToken),
        ...workspace(input),
        user_id: ctx.user.id,
        context_hash: hash(workspace(input)),
        payload_json: JSON.stringify(validated),
        dataset_fingerprint: await fingerprint(input, transaction),
        expires_at: new Date(Date.now() + 15 * 60 * 1000),
      },
      { transaction },
    );
    await audit(
      ctx,
      "preview_import",
      "import_previews",
      null,
      { ...workspace(input), row_count: rows.length },
      transaction,
    );
    return {
      valid: true,
      token: previewToken,
      rows: validated,
      row_count: rows.length,
      replaces_existing: input.import_type !== "adjustments",
      expires_in_minutes: 15,
    };
  });
}
export async function commitImport(ctx, raw) {
  const input = previewSchema
    .omit({ csv: true })
    .extend({ token: z.string().length(64) })
    .parse(raw);
  requirePermission(ctx, resourceOf(input.import_type), true);
  if (input.workspace_mode === "draft") requirePermission(ctx, "drafts", true);
  const result = await financialWrite(
    ctx,
    "imports",
    input,
    async (transaction) => {
      const preview = await M.import_previews.findByPk(hash(input.token), {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!preview || preview.user_id !== ctx.user.id)
        fail(404, "Import preview not found.");
      if (preview.status !== "pending")
        fail(409, `This preview is ${preview.status}. Generate a new preview.`);
      if (preview.context_hash !== hash(workspace(input)))
        fail(409, "The import workspace does not match its preview.");
      if (preview.expires_at <= new Date()) {
        await preview.update({ status: "expired" }, { transaction });
        return { error: "This preview has expired. Generate a new preview." };
      }
      if (
        preview.dataset_fingerprint !== (await fingerprint(input, transaction))
      ) {
        await preview.update({ status: "stale" }, { transaction });
        return {
          error: "The dataset changed after preview. Generate a new preview.",
        };
      }
      const rows = JSON.parse(preview.payload_json);
      if (input.import_type === "adjustments") {
        for (const data of rows) {
          const draft = input.workspace_mode === "draft";
          const table = draft
            ? "budget_adjustment_drafts"
            : "budget_adjustments";
          const row = await M[table].create(
            {
              ...data,
              ...(draft ? { draft_action: "create" } : {}),
              created_by_user_id: ctx.user.id,
            },
            { transaction },
          );
          await audit(ctx, "import", table, null, row, transaction);
        }
      } else {
        const kind = input.import_type.startsWith("faculty")
          ? "faculty"
          : "staff";
        const existing = await M[input.import_type].findAll({
          where: {
            department_id: input.department_id,
            fiscal_year: input.fiscal_year,
          },
          transaction,
        });
        for (const row of existing)
          await deleteSalaryInTransaction(ctx, kind, row, transaction);
        for (const data of rows)
          await saveSalaryInTransaction(ctx, kind, data, null, transaction);
      }
      await preview.update(
        { status: "consumed", consumed_at: new Date() },
        { transaction },
      );
      await audit(
        ctx,
        "commit_import",
        "import_previews",
        null,
        { ...workspace(input), row_count: rows.length },
        transaction,
      );
      return { imported: rows.length };
    },
  );
  if (result.error) fail(409, result.error);
  return result;
}

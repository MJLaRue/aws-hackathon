import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import {
  Op,
  ValidationError,
  ForeignKeyConstraintError,
  UniqueConstraintError,
} from "sequelize";
import { ZodError } from "zod";
import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { db, models as M } from "./db.js";
import {
  authRoutes,
  loadIdentity,
  authenticated,
  csrfGuard,
  originGuard,
  secret,
} from "./auth.js";
import {
  fail,
  plain,
  contextSchema,
  matrix,
  requirePermission,
  requireScope,
  list,
  scopeWhere,
  pagination,
  yearSchema,
  currentFiscalYear,
  sum,
  liveWhere,
} from "./core.js";
import {
  saveBase,
  saveAdjustment,
  saveExpense,
  softDelete,
  saveDraft,
  discardDraft,
  publishDrafts,
  settleCommitment,
  saveSalary,
  deleteSalary,
  saveNote,
} from "./finance.js";
import { previewImport, commitImport } from "./imports.js";
import { rollover } from "./rollover.js";
import { saveAdmin, adminData } from "./admin.js";
import { analyticsRouter } from "./analytics.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests:
            process.env.NODE_ENV === "production" ? [] : null,
        },
      },
    }),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 500,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use(
    express.json({ limit: "2mb" }),
    express.urlencoded({ extended: false, limit: "1mb" }),
    cookieParser(secret),
  );
  app.get("/api/health", async (req, res) => {
    await db.authenticate();
    res.json({ status: "ok", database: "mysql" });
  });
  app.use(
    "/api",
    (req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    loadIdentity,
  );
  authRoutes(app);
  app.use("/api", authenticated, originGuard, csrfGuard);
  app.use("/api/analytics", analyticsRouter());
  app.get("/api/meta", async (req, res) =>
    res.json({
      departments: req.ctx.departments,
      accounts: await M.banner_accounts.findAll({
        order: [["account_code", "ASC"]],
      }),
      years: await M.fiscal_year_states.findAll({
        order: [["fiscal_year", "DESC"]],
      }),
      current_fiscal_year: currentFiscalYear(),
      synthetic_data: process.env.DEMO_DATA === "true",
    }),
  );
  app.get("/api/matrix", async (req, res) =>
    res.json(
      await db.transaction((transaction) =>
        matrix(req.ctx, req.query, transaction),
      ),
    ),
  );
  app.get("/api/overview", async (req, res) => {
    const input = contextSchema.parse(req.query);
    requireScope(req.ctx, input.department_id);
    requirePermission(req.ctx, "expenses");
    const result = await db.transaction(async (transaction) => {
      const budget = await matrix(req.ctx, input, transaction);
      const expenses = await M.fiscal_year_expenses.findAll({
        where: { ...input, deleted_at: null },
        transaction,
      });
      const monthly = Array.from({ length: 12 }, (_, i) => {
        const month = i < 6 ? i + 7 : i - 5,
          year = i < 6 ? input.fiscal_year - 1 : input.fiscal_year,
          prefix = `${year}-${String(month).padStart(2, "0")}`;
        return {
          month: prefix,
          label: new Date(`${prefix}-15`).toLocaleDateString("en-US", {
            month: "short",
            timeZone: "UTC",
          }),
          amount: sum(
            expenses.filter((x) => x.expense_date.startsWith(prefix)),
            "amount",
          ),
        };
      });
      const canDrafts = ["read", "write"].includes(req.ctx.permissions.drafts);
      const canNotes = ["read", "write"].includes(req.ctx.permissions.notes);
      const pending = canDrafts
        ? await M.budget_adjustment_drafts.count({
            where: { ...input, status: "pending" },
            transaction,
          })
        : null;
      const notes = canNotes
        ? await M.line_notes.count({
            where: { ...input, is_resolved: false },
            transaction,
          })
        : null;
      const commitments = await M.budget_adjustments.findAll({
        where: {
          ...input,
          ...liveWhere,
          [Op.or]: [
            { adjustment_type: "temporary" },
            { obligation_status: "owed" },
          ],
        },
        transaction,
      });
      return {
        ...budget,
        monthly,
        pending_drafts: pending,
        unresolved_notes: notes,
        commitments: {
          count: commitments.length,
          amount: sum(commitments, "amount"),
        },
        recent_expenses: expenses
          .sort((a, b) => b.expense_date.localeCompare(a.expense_date))
          .slice(0, 5),
      };
    });
    res.json(result);
  });
  app.get("/api/adjustments", async (req, res) =>
    res.json(
      await list(
        req.ctx,
        "budgets",
        M.budget_adjustments,
        req.query,
        liveWhere,
      ),
    ),
  );
  app.post("/api/bases", async (req, res) =>
    res.status(201).json(await saveBase(req.ctx, req.body)),
  );
  app.post("/api/adjustments", async (req, res) =>
    res.status(201).json(await saveAdjustment(req.ctx, req.body)),
  );
  app.put("/api/adjustments/:id", async (req, res) =>
    res.json(await saveAdjustment(req.ctx, req.body, req.params.id)),
  );
  app.delete("/api/adjustments/:id", async (req, res) =>
    res.json(
      await softDelete(req.ctx, M.budget_adjustments, "budgets", req.params.id),
    ),
  );
  app.get("/api/expenses", async (req, res) =>
    res.json(
      await list(req.ctx, "expenses", M.fiscal_year_expenses, req.query, {
        deleted_at: null,
      }),
    ),
  );
  app.post("/api/expenses", async (req, res) =>
    res.status(201).json(await saveExpense(req.ctx, req.body)),
  );
  app.put("/api/expenses/:id", async (req, res) =>
    res.json(await saveExpense(req.ctx, req.body, req.params.id)),
  );
  app.delete("/api/expenses/:id", async (req, res) =>
    res.json(
      await softDelete(
        req.ctx,
        M.fiscal_year_expenses,
        "expenses",
        req.params.id,
      ),
    ),
  );
  app.get("/api/drafts", async (req, res) =>
    res.json(
      await list(req.ctx, "drafts", M.budget_adjustment_drafts, req.query, {
        status: "pending",
      }),
    ),
  );
  app.post("/api/drafts", async (req, res) =>
    res.status(201).json(await saveDraft(req.ctx, req.body)),
  );
  app.put("/api/drafts/:id", async (req, res) =>
    res.json(await saveDraft(req.ctx, req.body, req.params.id)),
  );
  app.delete("/api/drafts/:id", async (req, res) =>
    res.json(await discardDraft(req.ctx, req.params.id)),
  );
  app.post("/api/drafts/publish", async (req, res) =>
    res.json(await publishDrafts(req.ctx, req.body)),
  );
  app.get("/api/commitments", async (req, res) =>
    res.json(
      await list(req.ctx, "budgets", M.budget_adjustments, req.query, {
        ...liveWhere,
        [Op.or]: [
          { adjustment_type: "temporary" },
          { obligation_status: "owed" },
        ],
      }),
    ),
  );
  app.post("/api/commitments/:id/settle", async (req, res) =>
    res.json(await settleCommitment(req.ctx, req.params.id)),
  );
  for (const kind of ["faculty", "staff"]) {
    app.get(`/api/salaries/${kind}`, async (req, res) => {
      const result = await list(
        req.ctx,
        "salaries",
        M[`${kind}_salaries`],
        req.query,
        {},
        [`${kind}_name`],
      );
      const identities = await M[`${kind}_members`].findAll({
        where: { id: { [Op.in]: result.rows.map((x) => x[`${kind}_id`]) } },
      });
      const all = await M[`${kind}_salaries`].findAll({
        where: {
          ...scopeWhere(req.ctx, req.query),
          ...(req.query.fiscal_year
            ? { fiscal_year: yearSchema.parse(req.query.fiscal_year) }
            : {}),
        },
      });
      res.json({
        ...result,
        rows: result.rows.map((x) => ({
          ...plain(x),
          uin: identities.find((m) => m.id === x[`${kind}_id`])?.uin,
        })),
        totals: {
          previous_salary: sum(all, "previous_salary"),
          salary_increase: sum(all, "salary_increase"),
          new_salary: sum(all, "new_salary"),
        },
      });
    });
    app.post(`/api/salaries/${kind}`, async (req, res) =>
      res.status(201).json(await saveSalary(req.ctx, kind, req.body)),
    );
    app.put(`/api/salaries/${kind}/:id`, async (req, res) =>
      res.json(await saveSalary(req.ctx, kind, req.body, req.params.id)),
    );
    app.delete(`/api/salaries/${kind}/:id`, async (req, res) =>
      res.json(await deleteSalary(req.ctx, kind, req.params.id)),
    );
  }
  app.get("/api/notes", async (req, res) =>
    res.json(
      await list(
        req.ctx,
        "notes",
        M.line_notes,
        req.query,
        req.query.resolved === "false" ? { is_resolved: false } : {},
        ["note_text"],
      ),
    ),
  );
  app.post("/api/notes", async (req, res) =>
    res.status(201).json(await saveNote(req.ctx, req.body)),
  );
  app.patch("/api/notes/:id", async (req, res) =>
    res.json(await saveNote(req.ctx, req.body, req.params.id)),
  );
  app.get("/api/audit", async (req, res) => {
    requirePermission(req.ctx, "audit");
    const p = pagination(req.query);
    const where =
      req.ctx.permissions.scope === "all" && !req.query.department_id
        ? {}
        : scopeWhere(req.ctx, req.query);
    if (req.query.fiscal_year)
      where.fiscal_year = yearSchema.parse(req.query.fiscal_year);
    if (req.query.account_code)
      where.account_code = String(req.query.account_code);
    const hiddenTables = [];
    if (!["read", "write"].includes(req.ctx.permissions.salaries))
      hiddenTables.push(
        "faculty_salaries",
        "staff_salaries",
        "faculty_members",
        "staff_members",
        "faculty_salary_rollovers",
        "staff_salary_rollovers",
      );
    if (!["read", "write"].includes(req.ctx.permissions.admin))
      hiddenTables.push("users", "roles");
    if (hiddenTables.length) where.target_table = { [Op.notIn]: hiddenTables };
    if (req.query.q)
      where[Op.or] = ["action_type", "target_table", "actor_uin"].map((k) => ({
        [k]: { [Op.like]: `%${String(req.query.q).slice(0, 100)}%` },
      }));
    const result = await M.audit_logs.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit: p.limit,
      offset: p.offset,
    });
    res.json({
      rows: result.rows,
      total: result.count,
      page: p.page,
      limit: p.limit,
    });
  });
  app.post("/api/imports/preview", async (req, res) =>
    res.json(await previewImport(req.ctx, req.body)),
  );
  app.post("/api/imports/commit", async (req, res) =>
    res.json(await commitImport(req.ctx, req.body)),
  );
  app.get("/api/export", async (req, res) => {
    const result = await db.transaction((transaction) =>
      matrix(req.ctx, req.query, transaction),
    );
    const columns = [
      "account_code",
      "category_name",
      "group_type",
      "base_amount",
      "adjustments",
      "planned_budget",
      "spent",
      "remaining_base",
    ];
    const filename = `budget-${Number(req.query.department_id)}-FY${Number(req.query.fiscal_year)}-${result.mode}`;
    if (req.query.format === "xlsx") {
      const workbook = new ExcelJS.Workbook(),
        sheet = workbook.addWorksheet("Budget matrix");
      sheet.columns = columns.map((key) => ({
        header: key.replaceAll("_", " "),
        key,
        width: key === "category_name" ? 30 : 20,
      }));
      result.rows.forEach((row) =>
        sheet.addRow({
          ...row,
          ...Object.fromEntries(
            columns.slice(3).map((k) => [k, Number(row[k])]),
          ),
        }),
      );
      sheet.addRow({
        category_name: "TOTAL",
        ...Object.fromEntries(
          Object.entries(result.totals).map(([k, v]) => [k, Number(v)]),
        ),
      });
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF152824" },
      };
      for (let i = 4; i <= 8; i++)
        sheet.getColumn(i).numFmt = "#,##0.00;[Red](#,##0.00)";
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      res.attachment(`${filename}.xlsx`);
      await workbook.xlsx.write(res);
      res.end();
    } else {
      const csvValue = (value) => {
        let s = String(value ?? "");
        if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-\d+(\.\d+)?$/.test(s)))
          s = `'${s}`;
        return `"${s.replaceAll('"', '""')}"`;
      };
      res
        .attachment(`${filename}.csv`)
        .type("text/csv")
        .send(
          [
            columns,
            ...result.rows.map((row) => columns.map((k) => row[k])),
            columns.map((k) =>
              k === "category_name" ? "TOTAL" : (result.totals[k] ?? ""),
            ),
          ]
            .map((row) => row.map(csvValue).join(","))
            .join("\r\n"),
        );
    }
  });
  app.post("/api/fiscal-years/rollover", async (req, res) =>
    res.json(await rollover(req.ctx, req.body)),
  );
  app.get("/api/admin", async (req, res) =>
    res.json(await adminData(req.ctx, req.query)),
  );
  for (const type of ["users", "roles", "departments", "accounts"]) {
    app.post(`/api/admin/${type}`, async (req, res) =>
      res.status(201).json(await saveAdmin(req.ctx, type, req.body)),
    );
    app.put(`/api/admin/${type}/:id`, async (req, res) =>
      res.json(await saveAdmin(req.ctx, type, req.body, req.params.id)),
    );
  }
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "API endpoint not found." }),
  );
  const dist = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("/{*path}", (req, res) =>
      res.sendFile(resolve(dist, "index.html")),
    );
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ZodError)
      return res
        .status(400)
        .json({
          error: "Please correct the highlighted values.",
          details: error.issues.map((x) => ({
            field: x.path.join("."),
            message: x.message,
          })),
        });
    if (error instanceof UniqueConstraintError)
      return res
        .status(409)
        .json({ error: "A record with these unique values already exists." });
    if (error instanceof ForeignKeyConstraintError)
      return res
        .status(409)
        .json({ error: "This change conflicts with a linked record." });
    if (error instanceof ValidationError)
      return res
        .status(400)
        .json({
          error: "Invalid data.",
          details: error.errors.map((x) => ({
            field: x.path,
            message: x.message,
          })),
        });
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    console.error(error);
    res
      .status(500)
      .json({
        error:
          "An unexpected error occurred. No incomplete transaction was saved.",
      });
  });
  return app;
}

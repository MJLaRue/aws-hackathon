import { randomUUID } from "node:crypto";
import { db, models as M } from "./db.js";
import { currentFiscalYear, amount, add, chicagoDate } from "./core.js";

export async function seed() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Synthetic seeding is disabled in production.");
  if (await M.users.count()) {
    console.log("Existing records found. Seed skipped without modifying data.");
    return;
  }
  const year = currentFiscalYear(),
    today = chicagoDate();
  await db.transaction(async (transaction) => {
    const resources = [
      "budgets",
      "expenses",
      "salaries",
      "notes",
      "drafts",
      "imports",
      "audit",
      "admin",
      "rollover",
    ];
    const admin = await M.roles.create(
      {
        role_name: "Administrator",
        is_system: true,
        permissions_json: JSON.stringify({
          scope: "all",
          ...Object.fromEntries(resources.map((x) => [x, "write"])),
        }),
      },
      { transaction },
    );
    const manager = await M.roles.create(
      {
        role_name: "Department manager",
        is_system: true,
        permissions_json: JSON.stringify({
          scope: "own",
          ...Object.fromEntries(
            resources.map((x) => [
              x,
              ["admin", "rollover"].includes(x)
                ? "none"
                : x === "audit"
                  ? "read"
                  : "write",
            ]),
          ),
        }),
      },
      { transaction },
    );
    const viewer = await M.roles.create(
      {
        role_name: "Budget reviewer",
        is_system: true,
        permissions_json: JSON.stringify({
          scope: "children",
          ...Object.fromEntries(
            resources.map((x) => [
              x,
              ["admin", "rollover", "imports", "audit", "salaries"].includes(x)
                ? "none"
                : "read",
            ]),
          ),
        }),
      },
      { transaction },
    );
    const parent = await M.departments.create(
      {
        dept_code: "UIC",
        dept_name: "UIC",
        is_workspace: false,
      },
      { transaction },
    );
    const depts = [];
    for (const [code, name] of [
      ["CS", "Computer Science"],
      ["ECE", "Electrical & Computer Engineering"],
      ["MIE", "Mechanical & Industrial Engineering"],
      ["BME", "Biomedical Engineering"],
      ["CME", "Civil, Materials & Environmental Engineering"],
    ])
      depts.push(
        await M.departments.create(
          { dept_code: code, dept_name: name, parent_department_id: parent.id },
          { transaction },
        ),
      );
    const user = await M.users.create(
      {
        uin: "900000001",
        netid: "demo.admin",
        email: "demo.admin@example.test",
        first_name: "Alex",
        last_name: "Morgan",
        role_id: admin.id,
        department_id: parent.id,
      },
      { transaction },
    );
    await M.users.create(
      {
        uin: "900000002",
        netid: "demo.manager",
        email: "demo.manager@example.test",
        first_name: "Jordan",
        last_name: "Lee",
        role_id: manager.id,
        department_id: depts[0].id,
      },
      { transaction },
    );
    await M.users.create(
      {
        uin: "900000003",
        netid: "demo.reviewer",
        email: "demo.reviewer@example.test",
        first_name: "Taylor",
        last_name: "Reed",
        role_id: viewer.id,
        department_id: parent.id,
      },
      { transaction },
    );
    const accounts = [
      ["1100", "Faculty salaries", "Personnel", 2100000],
      ["1200", "Staff salaries", "Personnel", 680000],
      ["1300", "Student employment", "Personnel", 240000],
      ["2100", "Supplies & materials", "Operations", 160000],
      ["2200", "Travel & development", "Operations", 85000],
      ["2300", "Software & subscriptions", "Operations", 125000],
      ["2400", "Equipment", "Operations", 250000],
      ["2500", "Facilities & services", "Operations", 95000],
    ];
    for (const [code, name, group] of accounts)
      await M.banner_accounts.create(
        { account_code: code, category_name: name, group_type: group },
        { transaction },
      );
    for (const fiscal of [year - 2, year - 1, year]) {
      await M.fiscal_year_states.create(
        {
          fiscal_year: fiscal,
          status: fiscal === year ? "active" : "archived",
          ...(fiscal !== year
            ? {
                archived_at: new Date(`${fiscal}-07-01T05:00:00Z`),
                rolled_to_fiscal_year: fiscal + 1,
              }
            : {}),
        },
        { transaction },
      );
      for (const [di, dept] of depts.entries()) {
        for (const [ai, [code, name, group, base]] of accounts.entries()) {
          const factor = (1 - di * 0.13) * (1 - (year - fiscal) * 0.04);
          const baseAmount = amount(Math.round(base * factor));
          await M.budget_bases.create(
            {
              department_id: dept.id,
              account_code: code,
              fiscal_year: fiscal,
              base_amount: baseAmount,
            },
            { transaction },
          );
          if ([0, 3, 5, 6].includes(ai))
            await M.budget_adjustments.create(
              {
                department_id: dept.id,
                account_code: code,
                fiscal_year: fiscal,
                amount: amount((ai === 6 ? -18000 : 24000) * (1 - di * 0.1)),
                adjustment_type: ai === 5 ? "temporary" : "permanent",
                obligation_status: ai === 5 ? "owed" : "none",
                description: [
                  "Faculty recruitment allocation",
                  "",
                  "",
                  "Laboratory materials allocation",
                  "",
                  "Annual software renewal commitment",
                  "Equipment allocation transfer",
                ][ai],
                created_by_user_id: user.id,
              },
              { transaction },
            );
          for (let mi = 0; mi < 12; mi++) {
            const month = mi < 6 ? mi + 7 : mi - 5,
              calYear = mi < 6 ? fiscal - 1 : fiscal,
              expenseDate = `${calYear}-${String(month).padStart(2, "0")}-05`;
            if (expenseDate > today) continue;
            const seasonal = ai < 3 ? 1 : 0.65 + ((mi + ai * 2) % 6) * 0.14;
            const spent = amount(
              Math.round(
                (Number(baseAmount) / 12) * seasonal * (ai === 5 ? 1.13 : 0.94),
              ),
            );
            await M.fiscal_year_expenses.create(
              {
                department_id: dept.id,
                account_code: code,
                fiscal_year: fiscal,
                amount: spent,
                expense_date: expenseDate,
                description: `${name} · ${new Date(`${expenseDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })}`,
                created_by_user_id: user.id,
              },
              { transaction },
            );
          }
        }
      }
    }
    for (const [ki, kind] of ["faculty", "staff"].entries()) {
      for (const [di, dept] of depts.entries())
        for (let i = 0; i < 4; i++) {
          const name = [
            ["Avery Chen", "Samira Patel", "Noah Williams", "Elena Garcia"],
            ["Casey Brooks", "Morgan Davis", "Riley Thompson", "Jamie Rivera"],
          ][ki][i];
          const member = await M[`${kind}_members`].create(
            {
              id: randomUUID(),
              uin: String(910000000 + ki * 100000 + di * 100 + i),
              display_name: name,
            },
            { transaction },
          );
          let previousRow;
          for (const fiscal of [year - 2, year - 1, year]) {
            const prev = previousRow
              ? previousRow.new_salary
              : amount((ki === 0 ? 118000 : 68000) + i * 6500 + di * 2000);
            const increase = amount(Math.round(Number(prev) * 0.03));
            const row = await M[`${kind}_salaries`].create(
              {
                department_id: dept.id,
                [`${kind}_id`]: member.id,
                [`${kind}_name`]: name,
                previous_salary: prev,
                salary_increase: increase,
                new_salary: add(prev, increase),
                fiscal_year: fiscal,
                rolled_over_from_id: previousRow?.id || null,
                created_by_user_id: user.id,
              },
              { transaction },
            );
            if (previousRow)
              await M[`${kind}_salary_rollovers`].create(
                {
                  source_salary_id: previousRow.id,
                  target_salary_id: row.id,
                  source_fiscal_year: fiscal - 1,
                  target_fiscal_year: fiscal,
                  department_id: dept.id,
                  status: "completed",
                },
                { transaction },
              );
            previousRow = row;
          }
        }
    }
    await M.line_notes.create(
      {
        department_id: depts[0].id,
        account_code: "2300",
        fiscal_year: year,
        note_text:
          "Review software renewal timing before the next budget meeting.",
        created_by_user_id: user.id,
      },
      { transaction },
    );
    await M.budget_adjustment_drafts.create(
      {
        department_id: depts[0].id,
        account_code: "2400",
        fiscal_year: year,
        amount: "15000.00",
        adjustment_type: "permanent",
        obligation_status: "none",
        description: "Proposed lab equipment allocation",
        draft_action: "create",
        created_by_user_id: user.id,
      },
      { transaction },
    );
    await M.audit_logs.create(
      {
        user_id: user.id,
        actor_uin: user.uin,
        action_type: "seed_synthetic_data",
        target_table: "budget_bases",
        department_id: depts[0].id,
        fiscal_year: year,
        changes_json: JSON.stringify({
          before: null,
          after: {
            description:
              "Synthetic demonstration dataset. No real UIC financial or employee records.",
          },
        }),
      },
      { transaction },
    );
  });
  console.log(`Synthetic dataset created for FY ${year - 2}–${year}.`);
}

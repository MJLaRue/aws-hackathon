import { test, expect } from "@playwright/test";

async function signIn(page, role = "admin") {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open your workspace", exact: true })
    .click();
  await page
    .getByLabel("Demo account")
    .selectOption({
      label:
        role === "admin"
          ? "Alex Morgan · admin"
          : role === "manager"
            ? "Jordan Lee · manager"
            : "Taylor Reed · reviewer",
    });
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Budget at a glance")).toBeVisible();
}
test("landing, every workspace screen, and responsive navigation render without browser errors", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /A clearer picture/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/landing-desktop.png",
    fullPage: true,
  });
  await signIn(page);
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    fullPage: true,
  });
  for (const [label, heading] of [
    ["Budget matrix", "Department budget matrix"],
    ["Expenditures", "Recorded expenditures"],
    ["Draft workspace", "Pending draft changes"],
    ["Temporary board", "Open commitments"],
    ["Faculty & staff", "Faculty appointments"],
    ["Import data", "Bring your data into Ledger"],
    ["Notes", "Budget line conversations"],
    ["Audit history", "Change history"],
    ["Fiscal years", "Fiscal years"],
    ["Administration", "People & access"],
  ]) {
    await page
      .getByRole("navigation")
      .getByRole("button", { name: label, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator(".loading")).toHaveCount(0);
    await expect(page.locator(".error")).toHaveCount(0);
  }
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await expect(page.getByText("Budget at a glance")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/overview-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Expenditures", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Expenditures", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("record an expense, edit it, verify persistent data, and remove it through the UI", async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Expenditures", exact: true })
    .click();
  await page.getByRole("button", { name: "Record expense" }).click();
  await page.getByLabel("Amount (USD)").fill("321.45");
  const desc = `Browser test expense ${Date.now()}`;
  await page.getByLabel("Description").fill(desc);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText(desc, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(desc, { exact: true })).toBeVisible();
  let row = page.getByRole("row").filter({ hasText: desc });
  await row.getByRole("button", { name: "Edit record" }).click();
  await page.getByLabel("Amount (USD)").fill("421.45");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(row).toContainText("$421.45");
  await row.getByRole("button", { name: "Delete record" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText(desc, { exact: true })).toHaveCount(0);
});
test("archived years hide mutation controls and the reviewer cannot navigate to salary or administration", async ({
  page,
}) => {
  await signIn(page, "reviewer");
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Administration" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Faculty & staff" }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Budget matrix", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add adjustment" }),
  ).toHaveCount(0);
  const options = await page
    .getByLabel("Fiscal year", { exact: true })
    .locator("option")
    .allTextContents();
  const archived = options.find((x) => x.includes("Archive"));
  await page
    .getByLabel("Fiscal year", { exact: true })
    .selectOption({ label: archived });
  await expect(
    page.getByText("Archived fiscal year", { exact: true }),
  ).toBeVisible();
});
test("draft publishing, CSV import, and salary editing work through their review flows", async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByLabel("Department workspace")
    .selectOption({ label: "Biomedical Engineering" });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Draft workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "New draft" }).click();
  const description = `Browser draft ${Date.now()}`;
  await page.getByLabel("Amount (USD)").fill("12.34");
  await page.getByLabel("Description").fill(description);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish drafts" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText(description, { exact: true })).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Budget matrix", exact: true })
    .click();
  let row = page.getByRole("row").filter({ hasText: description });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Delete record" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText(description, { exact: true })).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Import data", exact: true })
    .click();
  const imported = `Browser CSV ${Date.now()}`;
  await page
    .getByLabel("Or paste CSV content")
    .fill(
      `account_code,amount,adjustment_type,obligation_status,description\n2400,23.45,permanent,none,${imported}`,
    );
  await page.getByRole("button", { name: "Validate & preview" }).click();
  await expect(
    page.getByRole("heading", { name: "Import preview" }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /I reviewed the preview/ }).check();
  await page.getByRole("button", { name: "Commit 1 records" }).click();
  await expect(
    page.getByRole("heading", { name: "Import preview" }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Budget matrix", exact: true })
    .click();
  row = page.getByRole("row").filter({ hasText: imported });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Delete record" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Faculty & staff", exact: true })
    .click();
  await page.getByRole("button", { name: "Add appointment" }).click();
  const name = `Browser Faculty ${Date.now()}`;
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Nine-digit UIN").fill("980000001");
  await page.getByLabel("Previous salary (USD)").fill("100000.00");
  await page.getByLabel("Salary increase (USD)").fill("3000.00");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toContainText("$103,000.00");
  await row.getByRole("button", { name: "Edit record" }).click();
  await page.getByLabel("Salary increase (USD)").fill("3500.00");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(row).toContainText("$103,500.00");
  await row.getByRole("button", { name: "Delete record" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
});

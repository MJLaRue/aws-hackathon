import { test, expect } from "@playwright/test";

async function signIn(page, account = "Alex Morgan · admin") {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open your workspace", exact: true })
    .click();
  await page.getByLabel("Demo account").selectOption({ label: account });
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
}

test("workspace opens workbook analytics, forecasts, anomalies, and scenarios with the same session", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  await page.getByRole("link", { name: "Forecasting & scenarios" }).click();
  await expect(page).toHaveURL(/forecasting\.html$/);
  await expect(page.getByText("1,154 records")).toBeVisible();
  await expect(
    page.getByText("Historical workbook analysis", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("⚠", { exact: false })).toHaveCount(0);

  await page.getByRole("button", { name: "Forecasting", exact: false }).click();
  await expect(
    page.getByText("Historical + Forecast", { exact: false }),
  ).toBeVisible();
  const forecast = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/analytics/forecast/run") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Run Forecast/ }).click();
  expect((await forecast).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: /Run Forecast/ }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "Anomalies", exact: false }).click();
  await expect(
    page.getByText("Anomaly Summary", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Scenario Planner", exact: false })
    .click();
  await page.getByRole("button", { name: "Salary +5%", exact: true }).click();
  await expect(
    page.getByText("Baseline 6-Month", { exact: true }),
  ).toBeVisible();
  await page.getByRole("spinbutton").first().fill("10");
  const scenario = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/analytics/scenarios/run") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run Custom Scenario" }).click();
  expect((await scenario).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Run Custom Scenario" }),
  ).toBeEnabled();
  await page.screenshot({
    path: "test-results/combined-scenario.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Budget workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("scoped workspace accounts cannot read the all-department workbook", async ({
  page,
}) => {
  await signIn(page, "Jordan Lee · manager");
  await expect(
    page.getByRole("link", { name: "Forecasting & scenarios" }),
  ).toHaveCount(0);
  const response = await page.request.get("/api/analytics/summary");
  expect(response.status()).toBe(403);
});

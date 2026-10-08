import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { analyticsRouter } from "../server/analytics.js";

function application(ctx, fetchImpl) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.ctx = ctx;
    next();
  });
  app.use("/api/analytics", analyticsRouter({ fetchImpl }));
  app.use((error, req, res, next) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
  return app;
}
const globalReader = { permissions: { budgets: "read", scope: "all" } };

test("workbook proxy blocks signed-out, scoped, and unauthorized users before contacting Python", async () => {
  const upstream = () => {
    throw new Error("Should not call the service");
  };
  for (const [ctx, status] of [
    [undefined, 401],
    [{ permissions: { budgets: "read", scope: "own" } }, 403],
    [{ permissions: { budgets: "none", scope: "all" } }, 403],
  ])
    await request(application(ctx, upstream))
      .get("/api/analytics/summary")
      .expect(status);
});

test("workbook proxy forwards filters and service status without session credentials", async () => {
  const app = application(globalReader, async (url, options) => {
    assert.equal(url.pathname, "/api/summary");
    assert.equal(url.searchParams.get("department"), "University Library");
    assert.equal(options.headers.Cookie, undefined);
    return new Response(JSON.stringify({ error: "No dataset" }), {
      status: 404,
    });
  });
  const result = await request(app)
    .get("/api/analytics/summary?department=University%20Library")
    .expect(404);
  assert.equal(result.body.error, "No dataset");
});

test("workbook proxy passes scenario JSON and allows only known routes", async () => {
  let calls = 0;
  const body = {
    scenario_name: "Test",
    adjustments: [{ type: "category", name: "Travel", change_pct: -10 }],
  };
  const app = application(globalReader, async (url, options) => {
    calls++;
    assert.equal(url.pathname, "/api/scenarios/run");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), body);
    return Response.json({ summary: { difference_pct: -10 } });
  });
  await request(app)
    .post("/api/analytics/scenarios/run")
    .send(body)
    .expect(200);
  await request(app).post("/api/analytics/summary").send({}).expect(404);
  await request(app).get("/api/analytics/admin").expect(404);
  assert.equal(calls, 1);
});

test("workbook proxy reports an unavailable service clearly", async () => {
  const app = application(globalReader, async () => {
    throw new Error("ECONNREFUSED");
  });
  const result = await request(app).get("/api/analytics/health").expect(503);
  assert.match(result.body.error, /npm run dev:analytics/);
});

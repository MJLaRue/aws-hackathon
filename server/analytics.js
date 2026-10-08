import { Router } from "express";
import { fail, requirePermission } from "./core.js";

const routes = new Set([
  "GET /health",
  "GET /filters",
  "GET /summary",
  "GET /trends/monthly",
  "GET /breakdown/department",
  "GET /breakdown/category",
  "GET /anomalies",
  "GET /anomalies/summary",
  "GET /series",
  "POST /forecast/run",
  "GET /forecast/results",
  "GET /forecast/metrics",
  "GET /scenarios/presets",
  "POST /scenarios/run",
]);

// Mounted after the workspace's session, origin, and CSRF guards.
// The workbook covers all departments, so scoped users cannot access it.
export function analyticsRouter({ fetchImpl = fetch } = {}) {
  const router = Router();
  router.use(async (req, res, next) => {
    try {
      if (!req.ctx) fail(401, "Please sign in to your workspace.");
      requirePermission(req.ctx, "budgets");
      if (req.ctx.permissions.scope !== "all")
        fail(403, "Workbook analytics requires access to all departments.");
      const preset =
        req.method === "GET" &&
        /^\/scenarios\/preset\/[a-z0-9_]+$/.test(req.path);
      if (!routes.has(`${req.method} ${req.path}`) && !preset)
        return res.status(404).json({ error: "Analytics endpoint not found." });
      const base =
        process.env.ANALYTICS_URL ||
        `http://127.0.0.1:${process.env.ANALYTICS_PORT || 8001}`;
      const url = new URL(`/api${req.url}`, base);
      let upstream;
      try {
        upstream = await fetchImpl(url, {
          method: req.method,
          headers: { "Content-Type": "application/json" },
          ...(req.method === "POST"
            ? { body: JSON.stringify(req.body ?? {}) }
            : {}),
          signal: AbortSignal.timeout(120000),
          redirect: "error",
        });
      } catch {
        return res
          .status(503)
          .json({
            error:
              "Workbook analytics is unavailable. Start the Python service with npm run dev:analytics.",
          });
      }
      res
        .status(upstream.status)
        .type("json")
        .send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      next(error);
    }
  });
  return router;
}

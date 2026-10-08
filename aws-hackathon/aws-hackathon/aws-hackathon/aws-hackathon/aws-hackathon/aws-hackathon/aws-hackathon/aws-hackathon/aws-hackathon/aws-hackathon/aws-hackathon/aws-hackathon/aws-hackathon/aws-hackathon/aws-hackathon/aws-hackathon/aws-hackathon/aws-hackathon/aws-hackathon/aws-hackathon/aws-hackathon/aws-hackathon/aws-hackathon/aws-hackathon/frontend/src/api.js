/**
 * api.js
 * Thin client for the Python budget API.
 * All functions accept an optional `filters` object matching the API query params.
 */

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function get(path, params = {}) {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `${BASE}${path}${query ? "?" + query : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

export const api = {
  health:               ()       => get("/api/health"),
  filters:              ()       => get("/api/filters"),
  summary:              (f = {}) => get("/api/summary",               f),
  monthlyTrend:         (f = {}) => get("/api/trends/monthly",        f),
  departmentBreakdown:  (f = {}) => get("/api/breakdown/department",  f),
  categoryBreakdown:    (f = {}) => get("/api/breakdown/category",    f),
  anomalies:            (f = {}) => get("/api/anomalies",             f),
  anomalySummary:       (f = {}) => get("/api/anomalies/summary",     f),
  series:               (dept, cat, f = {}) =>
    get("/api/series", { ...f, department: dept, category: cat }),

  // Phase 2 – forecasting
  forecastRun:     ()              => fetch(`${BASE}/api/forecast/run`, { method: "POST" }).then(r => r.json()),
  forecastResults: (f = {})        => get("/api/forecast/results", f),
  forecastMetrics: ()              => get("/api/forecast/metrics"),

  // Phase 2 – scenarios
  scenarioPresets:  ()             => get("/api/scenarios/presets"),
  scenarioRun:      (body)         => fetch(`${BASE}/api/scenarios/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json()),
  scenarioPreset:   (id)           => get(`/api/scenarios/preset/${id}`),
};

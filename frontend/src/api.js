/** Same-origin client for the workbook service behind workspace authentication. */
const BASE = "/api/analytics";
let session;

async function identity() {
  session ??= fetch("/api/auth/me", { credentials: "same-origin" }).then(async (response) => {
    if (response.status === 401) {
      window.location.assign("/app/overview");
      throw new Error("Sign in to open workbook analytics.");
    }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to load your session.");
    return body;
  });
  return session;
}

async function request(path, { params = {}, body } = {}) {
  const me = await identity();
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) =>
    value !== undefined && value !== null && value !== ""
  ));
  const response = await fetch(`${BASE}${path}${query.size ? `?${query}` : ""}`, {
    credentials: "same-origin",
    ...(body !== undefined ? {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrf },
      body: JSON.stringify(body),
    } : {}),
  });
  const data = await response.json();
  if (response.status === 401) window.location.assign("/app/overview");
  if (!response.ok) throw new Error(data.error || `Analytics request failed (${response.status}).`);
  return data;
}
const get = (path, params = {}) => request(path, { params });
export const api = {
  health: () => get("/health"),
  filters: () => get("/filters"),
  summary: (f = {}) => get("/summary", f),
  monthlyTrend: (f = {}) => get("/trends/monthly", f),
  departmentBreakdown: (f = {}) => get("/breakdown/department", f),
  categoryBreakdown: (f = {}) => get("/breakdown/category", f),
  anomalies: (f = {}) => get("/anomalies", f),
  anomalySummary: (f = {}) => get("/anomalies/summary", f),
  series: (department, category, f = {}) => get("/series", { ...f, department, category }),
  forecastRun: () => request("/forecast/run", { body: {} }),
  forecastResults: (f = {}) => get("/forecast/results", f),
  forecastMetrics: () => get("/forecast/metrics"),
  scenarioPresets: () => get("/scenarios/presets"),
  scenarioRun: (body) => request("/scenarios/run", { body }),
  scenarioPreset: (id) => get(`/scenarios/preset/${encodeURIComponent(id)}`),
};

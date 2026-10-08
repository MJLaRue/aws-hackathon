import React, { useState, useEffect, useCallback } from "react";
import { api } from "./api.js";
import { C } from "./utils.js";

import Shell         from "./components/Shell.jsx";
import FiltersBar    from "./components/FiltersBar.jsx";
import Overview      from "./pages/Overview.jsx";
import ForecastPage  from "./pages/ForecastPage.jsx";
import AnomaliesPage from "./pages/AnomaliesPage.jsx";
import ScenariosPage from "./pages/ScenariosPage.jsx";
import AIPage        from "./pages/AIPage.jsx";

// ── Error banner ──────────────────────────────────────────────────────────────
function ErrorBanner({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      margin: "12px 24px 0", padding: "10px 14px",
      background: C.redLight, color: C.red, borderRadius: 6, fontSize: 13,
    }}>
      ⚠ {msg}
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,          setTab]          = useState("overview");
  const [filters,      setFilters]      = useState({});
  const [options,      setOptions]      = useState({});
  const [rowCount,     setRowCount]     = useState(null);

  // Overview data
  const [summary,      setSummary]      = useState(null);
  const [trendData,    setTrendData]    = useState([]);
  const [deptData,     setDeptData]     = useState([]);
  const [catData,      setCatData]      = useState([]);
  const [anomalies,    setAnomalies]    = useState([]);
  const [anomSummary,  setAnomSummary]  = useState(null);

  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);

  // ── One-time initialisation ──────────────────────────────────────────────
  useEffect(() => {
    api.filters()
      .then(setOptions)
      .catch(() => {});
    api.health()
      .then(d => setRowCount(d.rows))
      .catch(() => {});
  }, []);

  // ── Reload data when filters change or tab navigated to overview/anomalies ─
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, trend, dept, cat, anom, anomSum] = await Promise.all([
        api.summary(filters),
        api.monthlyTrend(filters),
        api.departmentBreakdown(filters),
        api.categoryBreakdown(filters),
        api.anomalies({ ...filters, limit: 300 }),
        api.anomalySummary(filters),
      ]);
      setSummary(s);
      setTrendData(trend);
      setDeptData(dept);
      setCatData(cat);
      setAnomalies(anom);
      setAnomSummary(anomSum);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Re-fetch when filters change, and also when switching back to a data tab
  useEffect(() => {
    if (tab === "overview" || tab === "anomalies") {
      loadData();
    }
  }, [filters, tab, loadData]);

  // Forecast and scenario tabs handle their own data fetching internally

  const showFilters = tab === "overview" || tab === "anomalies";

  return (
    <Shell activeTab={tab} onTabChange={setTab} rowCount={rowCount}>
      {showFilters && (
        <FiltersBar options={options} filters={filters} onChange={setFilters} />
      )}

      <ErrorBanner msg={error} />

      {tab === "overview" && (
        <Overview
          summary={summary}
          trendData={trendData}
          deptData={deptData}
          catData={catData}
          anomalies={anomalies}
          loading={loading}
        />
      )}

      {tab === "forecast" && <ForecastPage />}

      {tab === "anomalies" && (
        <AnomaliesPage
          anomalies={anomalies}
          anomalySummary={anomSummary}
          loading={loading}
        />
      )}

      {tab === "scenarios" && <ScenariosPage />}

      {tab === "ai" && <AIPage filters={filters} />}
    </Shell>
  );
}

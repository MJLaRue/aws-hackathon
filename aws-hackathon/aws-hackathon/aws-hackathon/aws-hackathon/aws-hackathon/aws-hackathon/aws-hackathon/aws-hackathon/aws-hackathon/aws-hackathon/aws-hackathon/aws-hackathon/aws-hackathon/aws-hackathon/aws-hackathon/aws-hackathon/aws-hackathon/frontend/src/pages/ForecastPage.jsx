import React, { useState, useEffect } from "react";
import { api } from "../api.js";
import ForecastChart from "../components/ForecastChart.jsx";
import { C } from "../utils.js";

const SERIES_LABELS = [
  ["College of Pharmacy",      "Personnel & Salaries"],
  ["University Library",       "Administrative Costs"],
  ["College of Architecture",  "Research Operations"],
  ["IT Services",              "Technology & Equipment"],
  ["Student Affairs",          "Student Scholarships"],
  ["Facilities Management",    "Maintenance & Repairs"],
  ["College of Business",      "Consulting & Contracts"],
  ["Research Institute",       "Research Operations"],
  ["College of Engineering",   "Personnel & Salaries"],
  ["Finance & Administration", "Administrative Costs"],
];

export default function ForecastPage() {
  const [results,  setResults]  = useState(null);
  const [metrics,  setMetrics]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [running,  setRunning]  = useState(false);
  const [error,    setError]    = useState(null);
  const [selected, setSelected] = useState("all");

  async function loadSaved() {
    setLoading(true); setError(null);
    try {
      const [r, m] = await Promise.all([
        api.forecastResults(),
        api.forecastMetrics(),
      ]);
      if (r.error) throw new Error(r.error);
      setResults(r); setMetrics(m);
    } catch {
      setResults(null); setMetrics(null);
    } finally {
      setLoading(false);
    }
  }

  async function runForecast() {
    setRunning(true); setError(null);
    try {
      const r = await api.forecastRun();
      if (r.error) throw new Error(r.error);
      await loadSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => { loadSaved(); }, []);

  // Filter series by selection
  const seriesList = results?.series
    ? (selected === "all"
        ? results.series
        : results.series.filter(s =>
            `${s.department}|${s.category}` === selected
          ))
    : [];

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Controls */}
      <div style={{
        background: "#fff", borderRadius: 10, padding: "16px 20px",
        boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      }}>
        <button
          onClick={runForecast}
          disabled={running || loading}
          style={{
            padding: "8px 20px", background: C.navy, color: "#fff",
            border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600,
            cursor: running ? "default" : "pointer",
          }}
        >
          {running ? "Training…" : "Run Forecast"}
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.6px" }}>Series</span>
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            style={{ padding: "5px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, minWidth: 240 }}
          >
            <option value="all">All 10 Series (aggregated)</option>
            {SERIES_LABELS.map(([d, c]) => (
              <option key={`${d}|${c}`} value={`${d}|${c}`}>
                {d} · {c}
              </option>
            ))}
          </select>
        </div>

        <div style={{ fontSize: 12, color: C.textMuted }}>
          Training: Jul 2023 – Dec 2025 &nbsp;·&nbsp;
          Validation: Jan – Jun 2026 &nbsp;·&nbsp;
          Forecast: <strong style={{ color: C.navy }}>Jul – Dec 2026</strong>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: "10px 14px", background: C.redLight, color: C.red, borderRadius: 6, fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}

      {/* Main chart */}
      <div style={{
        background: "#fff", borderRadius: 10, padding: "18px 20px",
        boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>
          Historical + Forecast — {selected === "all" ? "All Series Combined" : selected.replace("|", " · ")}
        </div>
        <ForecastChart
          seriesList={seriesList}
          metrics={selected === "all" ? metrics : null}
          loading={loading}
        />
      </div>

      {/* Series table */}
      {results?.series && (
        <div style={{
          background: "#fff", borderRadius: 10, padding: "18px 20px",
          boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>
            Forecasting Series Coverage
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.navy }}>
                  {["Department","Category","Forecast Months","History Source"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", color: "#fff", fontWeight: 600, fontSize: 11, textAlign: "left" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.series.map((s, i) => (
                  <tr
                    key={i}
                    style={{ background: i % 2 === 0 ? "#fff" : "#F7F9FC", cursor: "pointer" }}
                    onClick={() => setSelected(`${s.department}|${s.category}`)}
                  >
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}` }}>{s.department}</td>
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}` }}>{s.category}</td>
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}` }}>
                      {s.forecasts?.length ?? 0} months
                    </td>
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}` }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 10,
                        background: s.history_is_synthetic ? C.amberLight : C.greenLight,
                        color: s.history_is_synthetic ? C.amber : C.green,
                      }}>
                        {s.history_is_synthetic ? "Synthetic" : "Source-derived"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

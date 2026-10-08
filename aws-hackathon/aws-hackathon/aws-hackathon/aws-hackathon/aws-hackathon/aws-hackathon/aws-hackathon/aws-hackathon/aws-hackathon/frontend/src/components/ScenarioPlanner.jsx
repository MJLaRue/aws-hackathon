import React, { useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, Cell,
} from "recharts";
import { api } from "../api.js";
import { C, fmtUsd, fmtPct, tickUsd } from "../utils.js";

const PRESETS = [
  { id: "salary_increase_5pct",  label: "Salary +5%"             },
  { id: "travel_cut_10pct",      label: "Travel −10%"            },
  { id: "tech_investment_8pct",  label: "Technology +8%"         },
  { id: "austerity",             label: "Austerity (−5% all)"    },
  { id: "research_push",         label: "Research Push +15%"     },
];

const CATEGORIES = [
  "Personnel & Salaries",
  "Administrative Costs",
  "Research Operations",
  "Technology & Equipment",
  "Student Scholarships",
  "Maintenance & Repairs",
  "Consulting & Contracts",
  "Travel & Conferences",
];

function SummaryCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 8, padding: "14px 18px",
      borderTop: `3px solid ${accent}`,
      boxShadow: "0 1px 4px rgba(0,0,0,0.07)", flex: 1,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: C.textMuted }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function ScenarioPlanner() {
  const [result,   setResult]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [activePreset, setActivePreset] = useState(null);

  // Custom adjustment state
  const [customAdj, setCustomAdj] = useState(
    CATEGORIES.reduce((acc, c) => ({ ...acc, [c]: "" }), {})
  );

  async function runPreset(id) {
    setLoading(true); setError(null); setActivePreset(id);
    try {
      const r = await api.scenarioPreset(id);
      if (r.error) throw new Error(r.error);
      setResult(r);
    } catch (e) {
      setError(e.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function runCustom() {
    const adjustments = Object.entries(customAdj)
      .filter(([, v]) => v !== "" && !isNaN(parseFloat(v)))
      .map(([name, v]) => ({ type: "category", name, change_pct: parseFloat(v) }));

    if (!adjustments.length) {
      setError("Enter at least one percentage adjustment.");
      return;
    }
    setLoading(true); setError(null); setActivePreset("custom");
    try {
      const r = await api.scenarioRun({ scenario_name: "Custom", adjustments });
      if (r.error) throw new Error(r.error);
      setResult(r);
    } catch (e) {
      setError(e.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  // Build comparison chart data from result
  const chartData = result?.series?.map(s => ({
    name: `${s.department.split(" ").slice(-1)[0]} · ${s.category.split(" ")[0]}`,
    baseline: s.baseline_total,
    adjusted: s.adjusted_total,
    diff:     s.difference_usd,
  })) ?? [];

  const sm = result?.summary;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Presets ── */}
      <Section title="Preset Scenarios">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => runPreset(p.id)}
              disabled={loading}
              style={{
                padding: "7px 16px", border: `1px solid ${C.border}`,
                borderRadius: 20, fontSize: 12, fontWeight: 600,
                cursor: loading ? "default" : "pointer",
                background: activePreset === p.id ? C.navy : "#fff",
                color:      activePreset === p.id ? "#fff" : C.navy,
                transition: "all 0.15s",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Section>

      {/* ── Custom ── */}
      <Section title="Custom Adjustment (% change by category)">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
          {CATEGORIES.map(cat => (
            <div key={cat} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: C.text, flex: 1 }}>{cat}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  type="number"
                  value={customAdj[cat]}
                  onChange={e => setCustomAdj(a => ({ ...a, [cat]: e.target.value }))}
                  placeholder="0"
                  style={{
                    width: 64, padding: "5px 8px", border: `1px solid ${C.border}`,
                    borderRadius: 6, fontSize: 12, textAlign: "right",
                  }}
                />
                <span style={{ fontSize: 11, color: C.textMuted }}>%</span>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={runCustom}
          disabled={loading}
          style={{
            marginTop: 14, padding: "8px 20px", background: C.navy, color: "#fff",
            border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600,
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "Running…" : "Run Custom Scenario"}
        </button>
      </Section>

      {/* ── Error ── */}
      {error && (
        <div style={{
          padding: "10px 14px", background: C.redLight, color: C.red,
          borderRadius: 6, fontSize: 13,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Results ── */}
      {result && sm && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <SummaryCard label="Scenario"             value={result.scenario_name}                   accent={C.navy} />
            <SummaryCard label="Baseline 6-Month"     value={fmtUsd(sm.baseline_total_6m)}           accent={C.slate} />
            <SummaryCard label="Adjusted 6-Month"     value={fmtUsd(sm.adjusted_total_6m)}           accent={C.teal} />
            <SummaryCard
              label="Impact"
              value={fmtUsd(sm.difference_usd)}
              sub={fmtPct(sm.difference_pct, true) + " vs baseline"}
              accent={(sm.difference_usd ?? 0) > 0 ? C.red : C.green}
            />
            <SummaryCard label="Series Affected" value={sm.series_affected ?? "—"} accent={C.blue} />
          </div>

          <Section title={`Baseline vs Adjusted by Series — ${sm.period}`}>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 160 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                  <XAxis type="number" tickFormatter={tickUsd} tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={155} />
                  <Tooltip
                    formatter={(v, n) => [fmtUsd(v), n]}
                    labelStyle={{ fontWeight: 700, color: C.text }}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                  <Bar dataKey="baseline" name="Baseline" fill={C.border}   radius={[0,3,3,0]} barSize={8} />
                  <Bar dataKey="adjusted" name="Adjusted" radius={[0,3,3,0]} barSize={8}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={(d.diff ?? 0) > 0 ? C.red : C.teal} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ padding: 20, color: C.textMuted, fontSize: 13 }}>No series data.</div>
            )}
          </Section>

          {/* Per-series detail table */}
          <Section title="Series Detail">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: C.navy }}>
                    {["Department","Category","Mult.","Baseline","Adjusted","Impact ($)","Impact (%)"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", color: "#fff", fontWeight: 600, fontSize: 11, textAlign: h.includes("$") || h.includes("%") || h === "Mult." || h === "Baseline" || h === "Adjusted" ? "right" : "left" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.series.map((s, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#F7F9FC" }}>
                      <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}` }}>{s.department}</td>
                      <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}` }}>{s.category}</td>
                      <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>
                        {((s.multiplier_applied - 1) * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtUsd(s.baseline_total)}</td>
                      <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtUsd(s.adjusted_total)}</td>
                      <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums",
                        color: (s.difference_usd ?? 0) > 0 ? C.red : C.green, fontWeight: 600 }}>
                        {fmtUsd(s.difference_usd)}
                      </td>
                      <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, textAlign: "right",
                        color: (s.difference_pct ?? 0) > 0 ? C.red : C.green }}>
                        {fmtPct(s.difference_pct, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <div style={{
            padding: "8px 12px", background: C.amberLight, borderRadius: 6,
            fontSize: 11, color: C.amber,
          }}>
            ⓘ {sm.note}
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 10, padding: "18px 20px",
      boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}

import React from "react";
import { C, fmtUsd, fmtPct, fmtInt } from "../utils.js";

function Skeleton() {
  return (
    <div style={{ height: 14, borderRadius: 6, background: "#E2E8F0", width: "60%", marginTop: 8 }} />
  );
}

function KPICard({ label, value, sub, accent, loading, trend }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 10, padding: "18px 20px",
      boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
      borderTop: `3px solid ${accent ?? C.navy}`,
      display: "flex", flexDirection: "column", gap: 2,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.6px" }}>
        {label}
      </div>
      {loading
        ? <Skeleton />
        : <div style={{ fontSize: 24, fontWeight: 800, color: C.text, lineHeight: 1.2, marginTop: 4 }}>
            {value}
          </div>
      }
      {sub && !loading && (
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

export default function KPICards({ summary = {}, loading = false }) {
  const varUsd = summary.total_variance_usd ?? 0;
  const varPct = summary.total_variance_pct;

  const cards = [
    {
      label:  "Total Budget",
      value:  fmtUsd(summary.total_budget),
      accent: C.navy,
    },
    {
      label:  "Actual Spending",
      value:  fmtUsd(summary.total_actual),
      accent: C.teal,
    },
    {
      label:  "Forecast",
      value:  fmtUsd(summary.total_forecast),
      accent: C.blue,
    },
    {
      label:  "Variance ($)",
      value:  varUsd === 0 ? "—" : fmtUsd(varUsd),
      sub:    varPct != null ? fmtPct(varPct, true) + " vs budget" : null,
      accent: varUsd > 0 ? C.red : varUsd < 0 ? C.green : C.slate,
    },
    {
      label:  "Anomalies",
      value:  fmtInt(summary.anomaly_count),
      sub:    summary.anomaly_rate_pct != null ? `${fmtPct(summary.anomaly_rate_pct)} of records` : null,
      accent: (summary.anomaly_count ?? 0) > 0 ? C.red : C.green,
    },
    {
      label:  "Forecast Accuracy",
      value:  fmtPct(summary.avg_forecast_accuracy),
      accent: C.teal,
    },
    {
      label:  "Total Records",
      value:  fmtInt(summary.total_records),
      accent: C.slate,
    },
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))",
      gap: 14, padding: "20px 24px 8px",
    }}>
      {cards.map(c => (
        <KPICard key={c.label} loading={loading} {...c} />
      ))}
    </div>
  );
}

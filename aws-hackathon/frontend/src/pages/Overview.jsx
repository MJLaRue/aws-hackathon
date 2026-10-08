import React from "react";
import { C, fmtUsd, fmtPct, varColor, anomalyBadge } from "../utils.js";
import KPICards       from "../components/KPICards.jsx";
import MonthlyChart   from "../components/MonthlyChart.jsx";
import DeptBarChart   from "../components/DeptBarChart.jsx";
import CategoryDonut  from "../components/CategoryDonut.jsx";

function Card({ title, children, style }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 10, padding: "18px 20px",
      boxShadow: "0 1px 4px rgba(0,0,0,0.07)", ...style,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function TopVariances({ deptData, loading }) {
  if (loading) return <div style={{ color: C.textMuted, fontSize: 12 }}>Loading…</div>;
  const top = [...(deptData ?? [])]
    .sort((a, b) => Math.abs(b.variance_usd) - Math.abs(a.variance_usd))
    .slice(0, 6);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {top.map(r => (
        <div key={r.department} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 0", borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ flex: 1, fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.department}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: varColor(r.variance_usd), whiteSpace: "nowrap" }}>
            {fmtUsd(r.variance_usd)}
          </div>
          <div style={{ fontSize: 11, color: varColor(r.variance_usd), minWidth: 42, textAlign: "right" }}>
            {fmtPct(r.variance_pct, true)}
          </div>
        </div>
      ))}
    </div>
  );
}

function AnomalyAlerts({ anomalies, loading }) {
  if (loading) return <div style={{ color: C.textMuted, fontSize: 12 }}>Loading…</div>;
  const top = (anomalies ?? []).slice(0, 5);
  if (!top.length) return (
    <div style={{ color: C.textMuted, fontSize: 12, padding: "12px 0" }}>No anomalies detected.</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {top.map((r, i) => {
        const ab = anomalyBadge(r.anomaly_type);
        return (
          <div key={r.record_id ?? i} style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "7px 10px", borderRadius: 6, background: ab.bg,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: ab.color, whiteSpace: "nowrap", marginTop: 1 }}>
              {r.anomaly_type ?? "—"}
            </span>
            <div style={{ flex: 1, fontSize: 11, color: C.text }}>
              <strong>{r.department}</strong> · {r.budget_category}
              <div style={{ color: C.textMuted, marginTop: 1 }}>
                {r.month} · {r.report_status}
                {r.variance_usd != null && ` · Variance: ${fmtUsd(r.variance_usd)}`}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Overview({ summary, trendData, deptData, catData, anomalies, loading }) {
  return (
    <div style={{ padding: "0 0 24px" }}>
      <KPICards summary={summary ?? {}} loading={loading} />

      {/* Monthly trend + anomaly alerts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, padding: "16px 24px 0" }}>
        <Card title="Monthly Spending: Budget vs Actual vs Forecast">
          <MonthlyChart data={trendData} loading={loading} />
        </Card>
        <Card title="⚑ Unusual Spending Alerts">
          <AnomalyAlerts anomalies={anomalies} loading={loading} />
        </Card>
      </div>

      {/* Dept + category */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "16px 24px 0" }}>
        <Card title="Department Spending (Actual vs Budget)">
          <DeptBarChart data={deptData} loading={loading} />
        </Card>
        <Card title="Expense Category Breakdown">
          <CategoryDonut data={catData} loading={loading} />
        </Card>
      </div>

      {/* Top variances */}
      <div style={{ padding: "16px 24px 0" }}>
        <Card title="Top Spending Variances by Department">
          <TopVariances deptData={deptData} loading={loading} />
        </Card>
      </div>
    </div>
  );
}

import React from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, Cell,
} from "recharts";
import { C, tickUsd, fmtUsd, fmtPct, varColor } from "../utils.js";

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload ?? {};
  return (
    <div style={{
      background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8,
      padding: "10px 14px", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
      maxWidth: 240,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: C.text }}>{label}</div>
      <div style={{ color: C.textMuted }}>Budget: <strong style={{ color: C.text }}>{fmtUsd(d.budget)}</strong></div>
      <div style={{ color: C.textMuted }}>Actual: <strong style={{ color: C.text }}>{fmtUsd(d.actual)}</strong></div>
      <div style={{ color: varColor(d.variance_usd) }}>
        Variance: <strong>{fmtUsd(d.variance_usd)} ({fmtPct(d.variance_pct, true)})</strong>
      </div>
      {d.anomaly_count > 0 && (
        <div style={{ color: C.red, marginTop: 4 }}>⚑ {d.anomaly_count} anomal{d.anomaly_count === 1 ? "y" : "ies"}</div>
      )}
    </div>
  );
};

export default function DeptBarChart({ data = [], loading = false }) {
  if (loading) return <ChartSkeleton />;
  if (!data.length) return <Empty />;

  const top = [...data].sort((a, b) => b.actual - a.actual).slice(0, 12);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={top} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 130 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
        <XAxis type="number" tickFormatter={tickUsd} tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} />
        <YAxis
          type="category" dataKey="department"
          tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={125}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
        <Bar dataKey="budget" name="Budget" fill={C.border} radius={[0,3,3,0]} barSize={8} />
        <Bar dataKey="actual" name="Actual" radius={[0,3,3,0]} barSize={8}>
          {top.map((d, i) => (
            <Cell key={i} fill={(d.variance_usd ?? 0) > 0 ? C.red : C.teal} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ChartSkeleton() {
  return (
    <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: 13 }}>
      Loading chart…
    </div>
  );
}

function Empty() {
  return (
    <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: 13 }}>
      No data for selected filters
    </div>
  );
}

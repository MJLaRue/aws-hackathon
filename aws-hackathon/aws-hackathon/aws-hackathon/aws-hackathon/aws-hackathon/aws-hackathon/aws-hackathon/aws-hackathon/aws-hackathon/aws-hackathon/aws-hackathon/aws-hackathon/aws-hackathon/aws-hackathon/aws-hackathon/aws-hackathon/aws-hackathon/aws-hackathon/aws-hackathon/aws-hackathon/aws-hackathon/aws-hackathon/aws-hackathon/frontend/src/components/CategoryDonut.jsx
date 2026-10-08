import React from "react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
} from "recharts";
import { C, CHART_COLORS, fmtUsd, fmtPct } from "../utils.js";

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div style={{
      background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8,
      padding: "10px 14px", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: C.text }}>{d.name}</div>
      <div>Actual: <strong>{fmtUsd(d.value)}</strong></div>
      <div style={{ color: C.textMuted }}>
        Share: {fmtPct((d.value / d.payload.total) * 100)}
      </div>
    </div>
  );
};

// Custom label: only show if slice > 6%
const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  if (percent < 0.06) return null;
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

export default function CategoryDonut({ data = [], loading = false }) {
  if (loading) return <ChartSkeleton />;
  if (!data.length) return <Empty />;

  const total = data.reduce((s, d) => s + (d.actual ?? 0), 0);
  const slices = [...data]
    .sort((a, b) => b.actual - a.actual)
    .slice(0, 8)
    .map(d => ({ ...d, name: d.category, value: d.actual, total }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={slices}
          cx="50%" cy="50%"
          innerRadius={65} outerRadius={105}
          paddingAngle={2}
          dataKey="value"
          labelLine={false}
          label={renderLabel}
        >
          {slices.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          iconType="circle" iconSize={8}
          formatter={v => <span style={{ fontSize: 11 }}>{v}</span>}
          wrapperStyle={{ paddingTop: 8 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

function ChartSkeleton() {
  return (
    <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: 13 }}>
      Loading chart…
    </div>
  );
}
function Empty() {
  return (
    <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: 13 }}>
      No data
    </div>
  );
}

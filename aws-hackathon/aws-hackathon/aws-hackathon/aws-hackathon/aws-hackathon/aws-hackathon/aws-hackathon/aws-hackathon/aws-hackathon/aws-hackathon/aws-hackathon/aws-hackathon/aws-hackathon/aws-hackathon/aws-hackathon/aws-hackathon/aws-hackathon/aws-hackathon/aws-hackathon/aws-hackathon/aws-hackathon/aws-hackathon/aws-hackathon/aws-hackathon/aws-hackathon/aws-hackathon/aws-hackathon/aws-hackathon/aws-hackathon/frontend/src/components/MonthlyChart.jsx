import React from "react";
import {
  ResponsiveContainer, ComposedChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from "recharts";
import { C, tickUsd, fmtUsd } from "../utils.js";

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8,
      padding: "10px 14px", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: C.text }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
          <span style={{ color: C.textMuted }}>{p.name}:</span>
          <span style={{ fontWeight: 600, color: C.text }}>{fmtUsd(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

export default function MonthlyChart({ data = [], loading = false }) {
  if (loading) return <ChartSkeleton />;
  if (!data.length) return <Empty />;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
        <XAxis
          dataKey="month_label"
          tick={{ fontSize: 10, fill: C.textMuted }}
          tickLine={false} axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={tickUsd}
          tick={{ fontSize: 10, fill: C.textMuted }}
          tickLine={false} axisLine={false}
          width={62}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          iconType="circle" iconSize={8}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
        />
        <Bar dataKey="budget"   name="Budget"   fill={C.border}   radius={[3,3,0,0]} barSize={8} />
        <Line dataKey="actual"  name="Actual"   stroke={C.navy}   strokeWidth={2.5} dot={false} />
        <Line dataKey="forecast" name="Forecast" stroke={C.teal}  strokeWidth={2} dot={false} strokeDasharray="5 3" />
      </ComposedChart>
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
      No data for selected filters
    </div>
  );
}

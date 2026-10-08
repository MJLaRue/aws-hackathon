import React from "react";
import {
  ResponsiveContainer, ComposedChart, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from "recharts";
import { C, tickUsd, fmtUsd } from "../utils.js";

const SPLIT_MONTH = "2026-07"; // first forecast month

function buildChartData(seriesList) {
  // Merge all series into a per-month aggregate for the chart
  const map = {};
  for (const s of seriesList) {
    // Historical actuals
    for (const h of (s.validation ?? [])) {
      const k = h.month;
      if (!map[k]) map[k] = { month: k, actual: 0, isForecast: false };
      map[k].actual += h.actual ?? 0;
    }
    // Forecasts
    for (const f of (s.forecasts ?? [])) {
      const k = f.month;
      if (!map[k]) map[k] = { month: k, gb: 0, naive: 0, isForecast: true };
      map[k].gb    = (map[k].gb    ?? 0) + (f.forecast_gb    ?? 0);
      map[k].naive = (map[k].naive ?? 0) + (f.forecast_naive ?? 0);
      map[k].isForecast = true;
    }
  }
  return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8,
      padding: "10px 14px", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: C.text }}>{label}</div>
      {payload.map(p => p.value != null && (
        <div key={p.dataKey} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
          <span style={{ color: C.textMuted }}>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{fmtUsd(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

export default function ForecastChart({ seriesList = [], metrics = null, loading = false }) {
  if (loading) return <ChartSkeleton />;
  if (!seriesList.length) return <NeedRun />;

  const chartData = buildChartData(seriesList);

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />

          {/* Shaded forecast region */}
          <Area
            dataKey="gb"
            name="GB Forecast"
            fill={C.tealLight}
            stroke="none"
            activeDot={false}
            legendType="none"
          />

          <XAxis
            dataKey="month"
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
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />

          {/* Historical actuals */}
          <Line dataKey="actual" name="Historical Actual" stroke={C.navy} strokeWidth={2.5} dot={false} connectNulls />
          {/* GB forecast */}
          <Line dataKey="gb"     name="GB Forecast"       stroke={C.teal}  strokeWidth={2} dot={{ r: 3 }} strokeDasharray="6 3" connectNulls />
          {/* Naive baseline */}
          <Line dataKey="naive"  name="Naive Baseline"    stroke={C.amber} strokeWidth={1.5} dot={false} strokeDasharray="3 3" connectNulls />

          {/* Divider between history and forecast */}
          <ReferenceLine
            x={SPLIT_MONTH}
            stroke={C.slate}
            strokeDasharray="4 2"
            label={{ value: "Forecast →", position: "insideTopRight", fontSize: 10, fill: C.textMuted }}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Metrics row */}
      {metrics && (
        <div style={{
          display: "flex", gap: 12, flexWrap: "wrap",
          padding: "12px 0 0",
        }}>
          <MetricPill
            label="GB Validation MAE"
            value={`$${metrics.gradient_boosting?.val_mae?.toLocaleString("en-US", { maximumFractionDigits: 0 }) ?? "—"}`}
          />
          <MetricPill
            label="GB WAPE"
            value={`${metrics.gradient_boosting?.val_wape?.toFixed(1) ?? "—"}%`}
          />
          <MetricPill
            label="Naive MAE"
            value={`$${metrics.seasonal_naive?.val_mae?.toLocaleString("en-US", { maximumFractionDigits: 0 }) ?? "—"}`}
            muted
          />
          <MetricPill
            label="Naive WAPE"
            value={`${metrics.seasonal_naive?.val_wape?.toFixed(1) ?? "—"}%`}
            muted
          />
          <MetricPill
            label="Model used"
            value={metrics.model_used_for_forecast === "gradient_boosting" ? "Gradient Boosting ✓" : "Seasonal Naive ✓"}
            highlight
          />
        </div>
      )}

      {/* Synthetic disclaimer */}
      <div style={{
        marginTop: 10, padding: "8px 12px",
        background: C.amberLight, borderRadius: 6, fontSize: 11, color: C.amber,
      }}>
        ⓘ Forecasting series are derived from <strong>synthetic historical data</strong>.
        MAE/WAPE metrics are illustrative of model behaviour, not real-world accuracy.
        Validation period: Jan – Jun 2026. Forecast period: Jul – Dec 2026.
      </div>
    </div>
  );
}

function MetricPill({ label, value, muted, highlight }) {
  return (
    <div style={{
      padding: "5px 12px", borderRadius: 20, fontSize: 11,
      background: highlight ? C.tealLight : muted ? "#F1F5F9" : C.blueLight,
      color: highlight ? C.teal : muted ? C.slate : C.blue,
      display: "flex", gap: 6, alignItems: "center",
    }}>
      <span style={{ opacity: 0.7 }}>{label}:</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: 13 }}>
      Loading forecast…
    </div>
  );
}

function NeedRun() {
  return (
    <div style={{
      height: 200, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 8,
      color: C.textMuted, fontSize: 13,
    }}>
      <span style={{ fontSize: 28 }}>◉</span>
      <div>No forecast data yet.</div>
      <div style={{ fontSize: 12 }}>Click <strong>Run Forecast</strong> to train models and generate Jul–Dec 2026 forecasts.</div>
    </div>
  );
}

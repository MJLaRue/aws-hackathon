import React from "react";
import AnomalyTable from "../components/AnomalyTable.jsx";
import { C, anomalyBadge, reviewBadge } from "../utils.js";

function SummaryPill({ label, count, style }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "12px 18px", borderRadius: 8,
      background: style?.bg ?? "#F1F5F9",
      border: `1px solid ${style?.color ?? C.border}22`,
      minWidth: 100,
    }}>
      <span style={{ fontSize: 22, fontWeight: 800, color: style?.color ?? C.text }}>{count}</span>
      <span style={{ fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>
        {label}
      </span>
    </div>
  );
}

export default function AnomaliesPage({ anomalies = [], anomalySummary = null, loading = false }) {
  const byType   = anomalySummary?.by_type   ?? {};
  const byStatus = anomalySummary?.by_review_status ?? {};

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Summary pills by type */}
      {anomalySummary && (
        <div style={{
          background: "#fff", borderRadius: 10, padding: "16px 20px",
          boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>
            Anomaly Summary
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <SummaryPill label="Total" count={anomalySummary.total_anomalies ?? 0} style={{ bg: "#F1F5F9", color: C.slate }} />
            {Object.entries(byType).map(([t, c]) => (
              <SummaryPill key={t} label={t} count={c} style={anomalyBadge(t)} />
            ))}
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Review Status
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(byStatus).map(([s, c]) => {
              const rb = reviewBadge(s);
              return (
                <div key={s} style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                  background: rb.bg, color: rb.color,
                }}>
                  {s}: {c}
                </div>
              );
            })}
          </div>

          {anomalySummary.finalized_mismatches > 0 && (
            <div style={{
              marginTop: 12, padding: "8px 12px", background: C.purpleLight, borderRadius: 6,
              fontSize: 12, color: C.purple, fontWeight: 600,
            }}>
              ⚑ {anomalySummary.finalized_mismatches} finalized record(s) have anomaly type mismatches.
              These are read-only — flagged for historical review only.
            </div>
          )}
        </div>
      )}

      {/* Finalized read-only notice */}
      <div style={{
        padding: "8px 14px", background: C.greenLight, borderRadius: 6,
        fontSize: 12, color: C.green, display: "flex", gap: 8, alignItems: "center",
      }}>
        <span style={{ fontWeight: 700 }}>🔒 Finalized records are read-only.</span>
        Approved anomaly labels are preserved. Newly discovered inconsistencies appear as
        "Flagged for Historical Review" and cannot be silently modified.
      </div>

      {/* Full anomaly table */}
      <div style={{
        background: "#fff", borderRadius: 10, padding: "18px 20px",
        boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>
          All Anomaly Records
          <span style={{ fontSize: 11, fontWeight: 400, color: C.textMuted, marginLeft: 8 }}>
            (sorted by month descending · click column headers to sort)
          </span>
        </div>
        <AnomalyTable records={anomalies} loading={loading} />
      </div>
    </div>
  );
}

import React, { useState } from "react";
import { C, fmtUsd, fmtPct, anomalyBadge, reviewBadge } from "../utils.js";

function Badge({ label, style }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 10,
      fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
      ...style,
    }}>
      {label}
    </span>
  );
}

const PAGE_SIZE = 25;

export default function AnomalyTable({ records = [], loading = false }) {
  const [page, setPage]       = useState(0);
  const [sortCol, setSortCol] = useState("month");
  const [sortDir, setSortDir] = useState("desc");

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
    setPage(0);
  }

  if (loading) return <LoadingState />;
  if (!records.length) return <EmptyState />;

  // Sort
  const sorted = [...records].sort((a, b) => {
    const av = a[sortCol] ?? "";
    const bv = b[sortCol] ?? "";
    const cmp = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageData   = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const th = (col, label, align = "left") => {
    const active = sortCol === col;
    return (
      <th
        onClick={() => toggleSort(col)}
        style={{
          background: C.navy, color: "#fff", padding: "10px 12px",
          textAlign: align, fontWeight: 600, fontSize: 11,
          cursor: "pointer", whiteSpace: "nowrap", userSelect: "none",
        }}
      >
        {label} {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </th>
    );
  };

  return (
    <div>
      {/* Summary row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          { label: "Overrun",            style: anomalyBadge("Overrun") },
          { label: "Underspend",         style: anomalyBadge("Underspend") },
          { label: "YoY Spike",          style: anomalyBadge("YoY Spike") },
          { label: "Forecast Deviation", style: anomalyBadge("Forecast Deviation") },
        ].map(b => {
          const count = records.filter(r => r.anomaly_type === b.label).length;
          return count > 0 ? (
            <Badge key={b.label} label={`${b.label}: ${count}`} style={b.style} />
          ) : null;
        })}
        <span style={{ fontSize: 12, color: C.textMuted, alignSelf: "center" }}>
          {records.length} total anomal{records.length === 1 ? "y" : "ies"}
        </span>
      </div>

      <div style={{ overflowX: "auto", borderRadius: 8, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {th("month",               "Month")}
              {th("department",          "Department")}
              {th("budget_category",     "Category")}
              {th("report_status",       "Status")}
              {th("actual_spend_usd",    "Actual",    "right")}
              {th("budgeted_amount_usd", "Budget",    "right")}
              {th("variance_usd",        "Variance",  "right")}
              {th("anomaly_type",        "Type")}
              {th("anomaly_review_status", "Review Status")}
              <th style={{ background: C.navy, color: "#fff", padding: "10px 12px", fontSize: 11 }}>Synth</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map((r, i) => {
              const isFinalized = r.report_status === "Finalized";
              const rowBg = isFinalized ? "#FAFCFF" : i % 2 === 0 ? "#fff" : "#F7F9FC";
              const ab = anomalyBadge(r.anomaly_type);
              const rb = reviewBadge(r.anomaly_review_status);
              return (
                <tr key={r.record_id ?? i} style={{ background: rowBg }}>
                  <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{r.month ?? "—"}</td>
                  <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.department ?? "—"}
                  </td>
                  <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{r.budget_category ?? "—"}</td>
                  <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}` }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 10,
                      background: isFinalized ? C.greenLight : C.amberLight,
                      color: isFinalized ? C.green : C.amber,
                    }}>
                      {r.report_status ?? "—"}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtUsd(r.actual_spend_usd)}
                  </td>
                  <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtUsd(r.budgeted_amount_usd)}
                  </td>
                  <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums",
                    color: (r.variance_usd ?? 0) > 0 ? C.red : C.green, fontWeight: 600 }}>
                    {r.variance_usd != null ? fmtUsd(r.variance_usd) : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}` }}>
                    <Badge label={r.anomaly_type ?? "—"} style={ab} />
                  </td>
                  <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}` }}>
                    <Badge label={r.anomaly_review_status ?? "—"} style={rb} />
                  </td>
                  <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, textAlign: "center", color: C.textMuted }}>
                    {r.is_synthetic ? "S" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, justifyContent: "center" }}>
          <PgBtn onClick={() => setPage(0)}          disabled={page === 0}>«</PgBtn>
          <PgBtn onClick={() => setPage(p => p - 1)} disabled={page === 0}>‹</PgBtn>
          <span style={{ fontSize: 12, color: C.textMuted, padding: "4px 8px" }}>
            Page {page + 1} of {totalPages}
          </span>
          <PgBtn onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>›</PgBtn>
          <PgBtn onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>»</PgBtn>
        </div>
      )}
    </div>
  );
}

function PgBtn({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        padding: "4px 10px", border: `1px solid ${C.border}`, borderRadius: 6,
        background: disabled ? "#F1F5F9" : "#fff", cursor: disabled ? "default" : "pointer",
        fontSize: 13, color: disabled ? C.border : C.navy,
      }}
    >
      {children}
    </button>
  );
}

function LoadingState() {
  return (
    <div style={{ padding: 32, textAlign: "center", color: C.textMuted, fontSize: 13 }}>
      Loading anomalies…
    </div>
  );
}
function EmptyState() {
  return (
    <div style={{ padding: 32, textAlign: "center", color: C.textMuted, fontSize: 13 }}>
      No anomalies found for the selected filters.
    </div>
  );
}

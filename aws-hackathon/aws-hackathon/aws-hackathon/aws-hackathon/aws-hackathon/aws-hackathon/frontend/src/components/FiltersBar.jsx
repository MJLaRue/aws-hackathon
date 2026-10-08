import React from "react";
import { C } from "../utils.js";

export default function FiltersBar({ options = {}, filters, onChange }) {
  function update(key, value) {
    onChange({ ...filters, [key]: value || undefined });
  }
  function reset() { onChange({}); }

  const sel = (key, label, items) => (
    <div key={key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.6px" }}>
        {label}
      </span>
      <select
        value={filters[key] ?? ""}
        onChange={e => update(key, e.target.value)}
        style={{
          padding: "5px 10px", border: `1px solid ${C.border}`, borderRadius: 6,
          fontSize: 12, background: "#fff", color: C.text, cursor: "pointer",
          minWidth: 130,
        }}
      >
        <option value="">All</option>
        {items.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  );

  const hasSynthetic = "include_synthetic" in filters;

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end",
      padding: "10px 24px", background: "#fff",
      borderBottom: `1px solid ${C.border}`,
    }}>
      {sel("fiscal_year",   "Fiscal Year",    options.fiscal_years    ?? [])}
      {sel("department",    "Department",     options.departments     ?? [])}
      {sel("category",      "Category",       options.categories      ?? [])}
      {sel("fund_source",   "Fund Source",    options.fund_sources    ?? [])}
      {sel("report_status", "Report Status",  options.report_statuses ?? [])}

      {/* Synthetic toggle */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.6px" }}>
          Data Source
        </span>
        <select
          value={filters.include_synthetic === false ? "real" : "all"}
          onChange={e => onChange({ ...filters, include_synthetic: e.target.value !== "real" ? undefined : false })}
          style={{
            padding: "5px 10px", border: `1px solid ${C.border}`, borderRadius: 6,
            fontSize: 12, background: "#fff", color: C.text, cursor: "pointer", minWidth: 130,
          }}
        >
          <option value="all">All (incl. synthetic)</option>
          <option value="real">Source-derived only</option>
        </select>
      </div>

      <button
        onClick={reset}
        style={{
          padding: "6px 14px", background: C.navy, color: "#fff",
          border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600,
          cursor: "pointer", alignSelf: "flex-end",
        }}
      >
        Reset
      </button>

      {Object.keys(filters).filter(k => filters[k] != null && filters[k] !== false).length > 0 && (
        <span style={{
          fontSize: 11, color: C.blue, alignSelf: "flex-end", paddingBottom: 2,
        }}>
          {Object.keys(filters).filter(k => filters[k] != null && filters[k] !== false).length} filter(s) active
        </span>
      )}
    </div>
  );
}

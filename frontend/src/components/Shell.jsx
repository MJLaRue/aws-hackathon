import React from "react";
import { C } from "../utils.js";

const TABS = [
  { id: "overview",  label: "Overview",        icon: "◈" },
  { id: "forecast",  label: "Forecasting",     icon: "◉" },
  { id: "anomalies", label: "Anomalies",        icon: "⚑" },
  { id: "scenarios", label: "Scenario Planner", icon: "⇄" },
  { id: "ai",        label: "AI Assistant",     icon: "✦" },
];

export default function Shell({ activeTab, onTabChange, rowCount, children }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column" }}>
      {/* ── Top bar ── */}
      <header style={{
        background: C.navy, color: "#fff",
        padding: "0 24px",
        display: "flex", alignItems: "stretch",
        justifyContent: "space-between",
        boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
        height: 56, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>⬡</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "0.2px" }}>
              Budget Intelligence
            </div>
            <div style={{ fontSize: 11, opacity: 0.65 }}>
              University Financial Analytics · AWS Hackathon
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {rowCount != null && (
            <span style={{
              fontSize: 11, opacity: 0.7, background: "rgba(255,255,255,0.12)",
              padding: "3px 10px", borderRadius: 20,
            }}>
              {rowCount.toLocaleString()} records
            </span>
          )}
        </div>
      </header>

      {/* ── Tab nav ── */}
      <nav style={{
        background: "#fff",
        borderBottom: `2px solid ${C.border}`,
        display: "flex", alignItems: "stretch",
        padding: "0 20px",
        gap: 2, flexShrink: 0,
      }}>
        {TABS.map(t => {
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              title={t.placeholder ? "Coming soon – Amazon Bedrock AI chat" : undefined}
              style={{
                border: "none", background: "none", cursor: t.placeholder ? "default" : "pointer",
                padding: "12px 18px",
                fontSize: 13, fontWeight: active ? 700 : 500,
                color: t.placeholder ? "#BFC8D4" : active ? C.navy : C.slate,
                borderBottom: active ? `3px solid ${C.navy}` : "3px solid transparent",
                marginBottom: -2,
                transition: "color 0.15s",
                display: "flex", alignItems: "center", gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ fontSize: 14 }}>{t.icon}</span>
              {t.label}
              {t.placeholder && (
                <span style={{
                  fontSize: 9, background: C.amberLight, color: C.amber,
                  padding: "1px 5px", borderRadius: 8, fontWeight: 600,
                }}>SOON</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Page content ── */}
      <main style={{ flex: 1, overflowY: "auto" }}>
        {children}
      </main>
    </div>
  );
}

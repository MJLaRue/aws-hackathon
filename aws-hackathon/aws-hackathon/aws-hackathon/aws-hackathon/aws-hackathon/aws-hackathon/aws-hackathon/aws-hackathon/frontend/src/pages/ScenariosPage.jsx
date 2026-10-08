import React from "react";
import ScenarioPlanner from "../components/ScenarioPlanner.jsx";
import { C } from "../utils.js";

export default function ScenariosPage() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Scenario Planner</div>
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
          Adjust spending assumptions and see projected Jul – Dec 2026 impact.
          Run a forecast first if you haven't already.
        </div>
      </div>
      <ScenarioPlanner />
    </div>
  );
}

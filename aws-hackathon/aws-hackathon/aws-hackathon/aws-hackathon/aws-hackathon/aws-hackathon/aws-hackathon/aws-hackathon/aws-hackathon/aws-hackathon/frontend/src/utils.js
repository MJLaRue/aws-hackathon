// ── Design tokens ─────────────────────────────────────────────────────────────
export const C = {
  navy:        "#1F4E79",
  navyLight:   "#2E6DA4",
  blue:        "#3B82F6",
  blueLight:   "#DBEAFE",
  teal:        "#0D9488",
  tealLight:   "#CCFBF1",
  green:       "#16A34A",
  greenLight:  "#DCFCE7",
  amber:       "#D97706",
  amberLight:  "#FEF3C7",
  red:         "#DC2626",
  redLight:    "#FEE2E2",
  purple:      "#7C3AED",
  purpleLight: "#EDE9FE",
  slate:       "#64748B",
  bg:          "#F0F4F8",
  surface:     "#FFFFFF",
  border:      "#E2E8F0",
  text:        "#1A2332",
  textMuted:   "#64748B",
};

// ── Chart palette ─────────────────────────────────────────────────────────────
export const CHART_COLORS = [
  C.navy, C.teal, C.blue, C.amber, C.purple,
  "#0EA5E9", "#F97316", "#10B981", "#8B5CF6", "#EF4444",
];

// ── Number formatters ─────────────────────────────────────────────────────────
export function fmtUsd(v, compact = true) {
  if (v == null || isNaN(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (!compact) return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function fmtPct(v, showSign = false) {
  if (v == null || isNaN(v)) return "—";
  const sign = showSign && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

export function fmtInt(v) {
  if (v == null || isNaN(v)) return "—";
  return Math.round(v).toLocaleString("en-US");
}

// ── Axis tick formatter for charts ────────────────────────────────────────────
export function tickUsd(v) {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

// ── Variance colour helper ────────────────────────────────────────────────────
export function varColor(v) {
  if (v == null) return C.slate;
  return v > 0 ? C.red : C.green;
}

// ── Anomaly badge colours ─────────────────────────────────────────────────────
export function anomalyBadge(type) {
  const map = {
    "Overrun":            { bg: C.redLight,    color: C.red    },
    "Underspend":         { bg: C.amberLight,  color: C.amber  },
    "YoY Spike":          { bg: C.purpleLight, color: C.purple },
    "Forecast Deviation": { bg: C.blueLight,   color: C.blue   },
    "Misallocation":      { bg: "#FFF7ED",     color: "#C2410C"},
  };
  return map[type] ?? { bg: "#F1F5F9", color: C.slate };
}

// ── Review status colours ─────────────────────────────────────────────────────
export function reviewBadge(status) {
  if (!status) return { bg: "#F1F5F9", color: C.slate };
  if (status.includes("Correction"))         return { bg: C.amberLight,  color: C.amber  };
  if (status.includes("Approval"))           return { bg: C.blueLight,   color: C.blue   };
  if (status.includes("Historical Review"))  return { bg: C.purpleLight, color: C.purple };
  if (status.includes("Mismatch"))           return { bg: C.redLight,    color: C.red    };
  if (status.includes("Locked"))             return { bg: C.greenLight,  color: C.green  };
  if (status.includes("Delayed"))            return { bg: C.amberLight,  color: C.amber  };
  return { bg: "#F1F5F9", color: C.slate };
}

import React, { useState, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Building2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  ChevronDown,
  BarChart3,
  ShieldCheck,
  Wallet,
  Receipt,
  Sparkles,
  Activity,
  Table2,
  LayoutGrid,
  Archive,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileSearch,
  X,
  Search,
} from "lucide-react";
import { DATA } from "../data.js";
import "../styles.css";
import "./dashboard.css";

// ─── helpers ────────────────────────────────────────────────────────────────
const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const fmtFull = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (v) => fmt.format(v ?? 0);
const moneyFull = (v) => fmtFull.format(v ?? 0);
const pct = (v) =>
  (v > 0 ? "+" : "") + (v ?? 0).toFixed(1) + "%";

const FISCAL_YEARS = ["FY2024", "FY2025", "FY2026"];
const ALL_DEPTS = [...new Set(DATA.map((r) => r.dept))].sort();
const ALL_CATS = [...new Set(DATA.map((r) => r.cat))].sort();
const ANOMALY_STATUSES_ACTIVE = [
  "Pending Approval",
  "Pending Correction",
  "Delayed - Anomaly Outstanding",
  "Flagged for Historical Review",
];

function filter(data, { fy, dept, cat }) {
  return data.filter(
    (r) =>
      (!fy || r.fy === fy) &&
      (!dept || r.dept === dept) &&
      (!cat || r.cat === cat),
  );
}

function aggregate(rows) {
  return rows.reduce(
    (acc, r) => {
      acc.budget += r.budget;
      acc.actual += r.actual;
      acc.forecast += r.forecast;
      acc.var_usd += r.var_usd;
      acc.count += 1;
      return acc;
    },
    { budget: 0, actual: 0, forecast: 0, var_usd: 0, count: 0 },
  );
}

// ─── shared UI ──────────────────────────────────────────────────────────────
function Brand({ light = false }) {
  return (
    <span className={`brand ${light ? "brand-light" : ""}`}>
      <span className="brand-mark">
        <span />
        <span />
        <span />
      </span>
      analytics<span className="brand-dot">.</span>
    </span>
  );
}

function Badge({ children, tone = "" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Stat({ label, value, detail, icon: Icon = Wallet, accent = false, tone = "" }) {
  return (
    <div className={`stat ${accent ? "stat-accent" : ""} ${tone}`}>
      <div className="stat-label">
        <span>{label}</span>
        <span className="stat-icon">
          <Icon size={18} />
        </span>
      </div>
      <strong>{value}</strong>
      <div className="stat-detail">{detail}</div>
    </div>
  );
}

function VarPill({ pct: v }) {
  const tone = v > 5 ? "red" : v < -5 ? "green" : "amber";
  const Icon = v > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`var-pill var-pill-${tone}`}>
      <Icon size={13} />
      {pct(v)}
    </span>
  );
}

function AnomalyBadge({ status }) {
  const tone =
    status === "Pending Approval" || status === "Pending Correction"
      ? "amber"
      : status === "Locked - Approved"
        ? "green"
        : status === "No Anomaly" || status === "Delayed - No Anomaly"
          ? ""
          : "red";
  return <Badge tone={tone}>{status}</Badge>;
}

function FilterBar({ fy, setFy, dept, setDept, cat, setCat, query, setQuery }) {
  return (
    <div className="filter-bar dash-filters">
      <label className="search">
        <Search size={15} />
        <input
          placeholder="Search departments or categories…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <label>
        <Archive size={14} />
        <select value={fy} onChange={(e) => setFy(e.target.value)}>
          <option value="">All years</option>
          {FISCAL_YEARS.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
      </label>
      <label>
        <Building2 size={14} />
        <select value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">All departments</option>
          {ALL_DEPTS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </label>
      <label>
        <Table2 size={14} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {ALL_CATS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {(fy || dept || cat || query) && (
        <button
          className="button ghost small"
          onClick={() => {
            setFy("FY2026");
            setDept("");
            setCat("");
            setQuery("");
          }}
        >
          <X size={14} /> Clear
        </button>
      )}
    </div>
  );
}

// ─── pages ──────────────────────────────────────────────────────────────────

function Overview({ rows }) {
  const agg = useMemo(() => aggregate(rows), [rows]);
  const varPct = agg.budget ? ((agg.actual - agg.budget) / agg.budget) * 100 : 0;
  const activeAnomalies = rows.filter((r) =>
    ANOMALY_STATUSES_ACTIVE.includes(r.astatus),
  ).length;
  const avgConf = useMemo(() => {
    const valid = rows.filter((r) => r.conf != null);
    return valid.length
      ? (valid.reduce((s, r) => s + r.conf, 0) / valid.length).toFixed(1)
      : "—";
  }, [rows]);

  // dept rollup
  const byDept = useMemo(() => {
    const m = {};
    for (const r of rows) {
      if (!m[r.dept]) m[r.dept] = { dept: r.dept, budget: 0, actual: 0 };
      m[r.dept].budget += r.budget;
      m[r.dept].actual += r.actual;
    }
    return Object.values(m)
      .map((d) => ({
        ...d,
        varPct: d.budget ? ((d.actual - d.budget) / d.budget) * 100 : 0,
      }))
      .sort((a, b) => Math.abs(b.varPct) - Math.abs(a.varPct))
      .slice(0, 8);
  }, [rows]);

  const maxBudget = Math.max(...byDept.map((d) => d.budget), 1);

  return (
    <>
      <div className="stats-grid">
        <Stat
          label="Total budget"
          value={money(agg.budget)}
          detail={`${rows.length.toLocaleString()} records in view`}
          icon={Wallet}
        />
        <Stat
          label="Total actual spend"
          value={money(agg.actual)}
          detail={`vs ${money(agg.forecast)} forecasted`}
          icon={Receipt}
        />
        <Stat
          label="Overall variance"
          value={pct(varPct)}
          detail={`${money(Math.abs(agg.var_usd))} ${agg.var_usd >= 0 ? "over" : "under"} budget`}
          icon={varPct >= 0 ? TrendingUp : TrendingDown}
          tone={varPct > 5 ? "stat-warn" : varPct < -5 ? "stat-good" : ""}
        />
        <Stat
          label="Active anomalies"
          value={activeAnomalies}
          detail="Pending approval, correction, or review"
          icon={AlertTriangle}
          accent
          tone={activeAnomalies > 0 ? "stat-alert" : ""}
        />
      </div>

      <div className="overview-grid">
        {/* Spend vs Budget chart */}
        <section className="card chart-card">
          <div className="card-header">
            <div>
              <div className="section-kicker">SPEND OVERVIEW</div>
              <h2>Budget vs. Actual by department</h2>
              <p>Top 8 by absolute variance · amounts in USD</p>
            </div>
            <span className="chart-legend-group">
              <span className="chart-legend"><i style={{ background: "#bfdbfe" }} />Budget</span>
              <span className="chart-legend"><i style={{ background: "#2563eb" }} />Actual</span>
            </span>
          </div>
          <div className="dept-bars">
            {byDept.map((d) => (
              <div key={d.dept} className="dept-bar-row">
                <span className="dept-bar-label" title={d.dept}>
                  {d.dept.replace(/^College of /, "").replace(/^Office of /, "")}
                </span>
                <div className="dept-bar-tracks">
                  <div className="dept-bar-track">
                    <div
                      className="dept-bar budget-bar"
                      style={{ width: `${(d.budget / maxBudget) * 100}%` }}
                    />
                  </div>
                  <div className="dept-bar-track">
                    <div
                      className={`dept-bar actual-bar ${d.actual > d.budget ? "over" : ""}`}
                      style={{ width: `${(d.actual / maxBudget) * 100}%` }}
                    />
                  </div>
                </div>
                <VarPill pct={d.varPct} />
              </div>
            ))}
          </div>
        </section>

        {/* On your radar */}
        <section className="card attention-card">
          <div className="card-header">
            <h2>On your radar</h2>
            <span className="tiny-label">ANALYTICS</span>
          </div>
          <div className="radar-items">
            <div className="radar-item">
              <span className="attention-icon"><AlertTriangle size={20} /></span>
              <span>
                <strong>{activeAnomalies} active anomalies</strong>
                <small>Pending approval, correction, or review</small>
              </span>
            </div>
            <div className="radar-item">
              <span className="attention-icon"><Activity size={20} /></span>
              <span>
                <strong>Avg confidence: {avgConf}/5</strong>
                <small>Across all filtered records</small>
              </span>
            </div>
            <div className="radar-item">
              <span className="attention-icon"><TrendingUp size={20} /></span>
              <span>
                <strong>{rows.filter((r) => r.atype === "Overrun").length} overrun records</strong>
                <small>Actual spend exceeded budget</small>
              </span>
            </div>
            <div className="radar-item">
              <span className="attention-icon"><FileSearch size={20} /></span>
              <span>
                <strong>{rows.filter((r) => r.atype === "YoY Spike").length} YoY spikes</strong>
                <small>Year-over-year spend anomalies</small>
              </span>
            </div>
          </div>
          <div className="radar-footer">
            <ShieldCheck size={15} />
            <span>Data sourced from Team6Dataset_Enhanced 1.xlsx</span>
          </div>
        </section>
      </div>
    </>
  );
}

function DeptTable({ rows }) {
  const byDeptYear = useMemo(() => {
    const m = {};
    for (const r of rows) {
      const key = `${r.dept}||${r.fy}`;
      if (!m[key]) m[key] = { dept: r.dept, fy: r.fy, budget: 0, actual: 0, anomalies: 0 };
      m[key].budget += r.budget;
      m[key].actual += r.actual;
      if (ANOMALY_STATUSES_ACTIVE.includes(r.astatus)) m[key].anomalies++;
    }
    return Object.values(m).sort((a, b) =>
      a.dept !== b.dept ? a.dept.localeCompare(b.dept) : a.fy.localeCompare(b.fy),
    );
  }, [rows]);

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <div className="section-kicker">ALLOCATION BREAKDOWN</div>
          <h2>Department × Fiscal Year</h2>
          <p>{byDeptYear.length} rows · Amounts in USD</p>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Department</th>
              <th>Year</th>
              <th className="numeric">Budget</th>
              <th className="numeric">Actual</th>
              <th className="numeric">Variance $</th>
              <th>Variance %</th>
              <th>Anomalies</th>
            </tr>
          </thead>
          <tbody>
            {byDeptYear.map((d) => {
              const varUsd = d.actual - d.budget;
              const varP = d.budget ? ((d.actual - d.budget) / d.budget) * 100 : 0;
              return (
                <tr key={`${d.dept}-${d.fy}`}>
                  <td>
                    <strong>{d.dept}</strong>
                  </td>
                  <td><Badge>{d.fy}</Badge></td>
                  <td className="numeric">{moneyFull(d.budget)}</td>
                  <td className="numeric">{moneyFull(d.actual)}</td>
                  <td className={`numeric ${varUsd > 0 ? "positive" : varUsd < 0 ? "negative" : ""}`}>
                    {varUsd > 0 ? "+" : ""}{moneyFull(varUsd)}
                  </td>
                  <td><VarPill pct={varP} /></td>
                  <td>
                    {d.anomalies > 0 ? (
                      <Badge tone="amber">{d.anomalies} flagged</Badge>
                    ) : (
                      <Badge tone="green">Clean</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AnomalyTable({ rows }) {
  const flagged = useMemo(
    () =>
      rows
        .filter((r) => r.anomaly || ANOMALY_STATUSES_ACTIVE.includes(r.astatus))
        .sort((a, b) => {
          const order = { "Pending Correction": 0, "Pending Approval": 1, "Delayed - Anomaly Outstanding": 2, "Flagged for Historical Review": 3 };
          return (order[a.astatus] ?? 9) - (order[b.astatus] ?? 9);
        }),
    [rows],
  );

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <div className="section-kicker">ANOMALY TRACKER</div>
          <h2>Flagged records</h2>
          <p>{flagged.length} records requiring attention</p>
        </div>
        <Badge tone={flagged.length > 0 ? "amber" : "green"}>
          {flagged.length > 0 ? `${flagged.length} active` : "All clear"}
        </Badge>
      </div>
      {flagged.length === 0 ? (
        <div className="empty">
          <CheckCircle2 size={30} />
          <h3>No anomalies in view</h3>
          <p>Adjust filters to see other records.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Record ID</th>
                <th>Department</th>
                <th>Category</th>
                <th>Year / Quarter</th>
                <th className="numeric">Budget</th>
                <th className="numeric">Actual</th>
                <th>Variance</th>
                <th>Anomaly type</th>
                <th>Review status</th>
              </tr>
            </thead>
            <tbody>
              {flagged.slice(0, 100).map((r) => (
                <tr key={r.id}>
                  <td>
                    <code className="record-id">{r.id}</code>
                    {r.src && <small className="cell-meta">{r.src}</small>}
                  </td>
                  <td>{r.dept}</td>
                  <td>{r.cat}</td>
                  <td>
                    <Badge>{r.fy}</Badge>
                    <small className="cell-meta">{r.fq}</small>
                  </td>
                  <td className="numeric">{moneyFull(r.budget)}</td>
                  <td className="numeric">{moneyFull(r.actual)}</td>
                  <td><VarPill pct={r.var_pct} /></td>
                  <td>
                    {r.atype ? (
                      <Badge tone={r.atype === "Overrun" ? "red" : r.atype === "Underspend" ? "" : "amber"}>
                        {r.atype}
                      </Badge>
                    ) : "—"}
                  </td>
                  <td><AnomalyBadge status={r.astatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {flagged.length > 100 && (
            <div className="pagination">
              <span>Showing 100 of {flagged.length} flagged records</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CategoryView({ rows }) {
  const byCat = useMemo(() => {
    const m = {};
    for (const r of rows) {
      if (!m[r.cat]) m[r.cat] = { cat: r.cat, budget: 0, actual: 0, count: 0 };
      m[r.cat].budget += r.budget;
      m[r.cat].actual += r.actual;
      m[r.cat].count++;
    }
    return Object.values(m)
      .map((c) => ({ ...c, varPct: c.budget ? ((c.actual - c.budget) / c.budget) * 100 : 0 }))
      .sort((a, b) => b.budget - a.budget);
  }, [rows]);

  const maxB = Math.max(...byCat.map((c) => c.budget), 1);

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <div className="section-kicker">CATEGORY BREAKDOWN</div>
          <h2>Spend by budget category</h2>
          <p>{byCat.length} categories · sorted by budget allocation</p>
        </div>
      </div>
      <div className="category-grid">
        {byCat.map((c) => (
          <article className="allocation-card" key={c.cat}>
            <div className="allocation-card-top">
              <span className="account-icon">
                <BarChart3 size={18} />
              </span>
              <Badge>{c.count} records</Badge>
            </div>
            <h3>{c.cat}</h3>
            <strong className="allocation-amount">{money(c.budget)}</strong>
            <div
              className="allocation-share"
              aria-label={`${c.cat}: ${Math.round((c.budget / Math.max(1, byCat.reduce((s, x) => s + x.budget, 0))) * 100)}% of total`}
            >
              <span style={{ width: `${(c.budget / Math.max(1, byCat.reduce((s, x) => s + x.budget, 0))) * 100}%` }} />
            </div>
            <dl>
              <div>
                <dt>Actual spend</dt>
                <dd>{money(c.actual)}</dd>
              </div>
              <div>
                <dt>Variance</dt>
                <dd className={c.varPct > 0 ? "positive" : c.varPct < 0 ? "negative" : ""}>
                  {pct(c.varPct)}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProcessHealth({ rows }) {
  const byDept = useMemo(() => {
    const m = {};
    const seen = new Set();
    for (const r of rows) {
      // deduplicate by source_record_id (use first row per BUD-source)
      const key = r.src || r.id;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!m[r.dept]) m[r.dept] = { dept: r.dept, conf: [], errors: [], days: [], versions: [], cycles: [] };
      if (r.conf != null) m[r.dept].conf.push(r.conf);
      if (r.errors != null) m[r.dept].errors.push(r.errors);
      if (r.days != null) m[r.dept].days.push(r.days);
      if (r.versions != null) m[r.dept].versions.push(r.versions);
      if (r.cycles != null) m[r.dept].cycles.push(r.cycles);
    }
    return Object.values(m)
      .map((d) => ({
        dept: d.dept,
        conf: d.conf.length ? (d.conf.reduce((s, v) => s + v, 0) / d.conf.length).toFixed(1) : null,
        errors: d.errors.length ? (d.errors.reduce((s, v) => s + v, 0) / d.errors.length).toFixed(1) : null,
        days: d.days.length ? (d.days.reduce((s, v) => s + v, 0) / d.days.length).toFixed(1) : null,
        versions: d.versions.length ? (d.versions.reduce((s, v) => s + v, 0) / d.versions.length).toFixed(1) : null,
        cycles: d.cycles.length ? (d.cycles.reduce((s, v) => s + v, 0) / d.cycles.length).toFixed(1) : null,
      }))
      .sort((a, b) => (b.conf ?? 0) - (a.conf ?? 0));
  }, [rows]);

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <div className="section-kicker">PROCESS HEALTH</div>
          <h2>Reporting quality by department</h2>
          <p>Deduped by source record · averages per department</p>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Department</th>
              <th className="numeric">Confidence (1–5)</th>
              <th className="numeric">Avg data errors</th>
              <th className="numeric">Avg days to report</th>
              <th className="numeric">Avg versions</th>
              <th className="numeric">Avg approval cycles</th>
            </tr>
          </thead>
          <tbody>
            {byDept.map((d) => (
              <tr key={d.dept}>
                <td><strong>{d.dept}</strong></td>
                <td className="numeric">
                  {d.conf != null ? (
                    <span className={`conf-score conf-${Math.round(d.conf)}`}>{d.conf}</span>
                  ) : "—"}
                </td>
                <td className={`numeric ${d.errors > 2 ? "negative" : ""}`}>{d.errors ?? "—"}</td>
                <td className={`numeric ${d.days > 25 ? "negative" : ""}`}>{d.days ?? "—"}</td>
                <td className="numeric">{d.versions ?? "—"}</td>
                <td className="numeric">{d.cycles ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── landing ────────────────────────────────────────────────────────────────
function Landing({ onEnter }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <a href="/" aria-label="UIC Analytics home">
          <Brand />
        </a>
        <nav>
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <button className="button dark" onClick={onEnter}>
            Open dashboard <ChevronRight size={16} />
          </button>
        </nav>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="uic-mark">UIC</span> BUDGET FORECASTING ANALYTICS
            </div>
            <h1>
              Spot the signal
              <br />
              in <span>every budget line.</span>
            </h1>
            <p>
              Explore spend patterns, track anomalies, and measure reporting
              quality across all UIC departments — powered by three fiscal years
              of real budget data.
            </p>
            <div className="hero-actions">
              <button className="button dark" onClick={onEnter}>
                Open analytics dashboard <ChevronRight size={18} />
              </button>
              <a href="#how">
                See how it works <ChevronDown size={17} />
              </a>
            </div>
            <div className="hero-foot">
              <ShieldCheck size={16} /> FY2024 – FY2026 · 21 departments · 1,147 records
            </div>
          </div>
        </section>

        <div className="landing-pillars">
          {[
            [Wallet, "Budget vs. Actual", "Variance by dept & category"],
            [AlertTriangle, "Anomaly tracking", "Flagged records & review status"],
            [Activity, "Process health", "Confidence, errors & report timing"],
          ].map(([Icon, title, detail]) => (
            <div key={title}>
              <Icon size={23} />
              <strong>{title}</strong>
              <span>{detail}</span>
            </div>
          ))}
        </div>

        <section className="landing-process" id="how">
          <div className="section-kicker">HOW IT WORKS</div>
          <h2>From raw data to actionable insight.</h2>
          <p className="landing-section-sub">
            Four views designed for budget analysts and department managers.
          </p>
          <div className="process-grid">
            {[
              [LayoutDashboard, "Overview", "KPI summary, top-line variance, and your attention items at a glance."],
              [Building2, "Department table", "Budget vs. actual for every department and fiscal year in one table."],
              [AlertTriangle, "Anomaly tracker", "Every flagged record with its review status, type, and variance."],
              [Activity, "Process health", "Reporting quality metrics deduped and averaged by department."],
            ].map(([Icon, title, text], i) => (
              <article key={title}>
                <span className="step-number">{i + 1}</span>
                <Icon size={25} />
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="foundation" id="features">
          <div>
            <div className="eyebrow">BUILT FOR FINANCIAL ANALYSIS</div>
            <h2>Every metric. One dashboard.</h2>
            <p className="landing-section-sub">
              Slice by department, category, fund source, and fiscal year.
            </p>
          </div>
          <div className="foundation-grid">
            {[
              [BarChart3, "Variance analysis", "Color-coded budget vs. actual bars with percentage variance for every department."],
              [AlertCircle, "Anomaly review workflow", "Track anomaly review status — Pending Approval, Correction, Flagged — in one filtered table."],
              [Clock, "Process health metrics", "Confidence scores, data entry errors, days to produce report, and approval cycles by department."],
              [TrendingUp, "Forecast accuracy", "Compare actual spend to forecast and prior-year figures across all categories."],
            ].map(([Icon, title, text]) => (
              <article key={title}>
                <span className="feature-icon"><Icon size={24} /></span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-ai">
          <Sparkles size={28} />
          <Badge tone="outline">AI layer · Hackathon demo</Badge>
          <h2>Built for the AWS / UIC Enterprise AI Hackathon.</h2>
          <p>
            Powered by the Team 6 enhanced dataset — 1,154 rows, 30 columns,
            monthly grain across 21 departments and 14 budget categories.
          </p>
          <button className="button cta-white" onClick={onEnter}>
            Open dashboard <ChevronRight size={17} />
          </button>
        </section>
      </main>
      <footer>
        <Brand />
        <span>AWS / UIC Enterprise AI Hackathon · Team 6</span>
        <span>Budget forecasting & anomaly detection</span>
      </footer>
    </div>
  );
}

// ─── workspace shell ─────────────────────────────────────────────────────────
const PAGES = [
  ["overview", "Overview", LayoutDashboard],
  ["departments", "Departments", Building2],
  ["anomalies", "Anomalies", AlertTriangle],
  ["categories", "Categories", BarChart3],
  ["health", "Process health", Activity],
];

const PAGE_DESCS = {
  overview: "High-level summary of spend, variance, and active anomalies.",
  departments: "Budget vs. actual for every department and fiscal year.",
  anomalies: "All flagged records with anomaly type and review status.",
  categories: "Spend and variance breakdown by budget category.",
  health: "Reporting quality metrics averaged per department.",
};

function Workspace() {
  const [page, setPage] = useState("overview");
  const [fy, setFy] = useState("FY2026");
  const [dept, setDept] = useState("");
  const [cat, setCat] = useState("");
  const [query, setQuery] = useState("");

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return filter(DATA, { fy, dept, cat }).filter(
      (r) => !q || r.dept.toLowerCase().includes(q) || r.cat.toLowerCase().includes(q),
    );
  }, [fy, dept, cat, query]);

  const current = PAGES.find(([id]) => id === page);

  return (
    <div className="workspace-v2">
      <aside className="tool-dock" aria-label="Analytics dock">
        <a className="dock-home" href="/dashboard.html" aria-label="UIC Analytics home">
          <span className="dock-monogram">a<span>.</span></span>
        </a>
        <nav className="dock-navigation" aria-label="Main navigation">
          {PAGES.map(([id, title, Icon]) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              aria-label={title}
              aria-current={page === id ? "page" : undefined}
              className={page === id ? "active" : ""}
              title={title}
            >
              <Icon size={20} />
              <span>{title}</span>
            </button>
          ))}
        </nav>
        <div className="dock-bottom">
          <button
            className="dock-avatar"
            aria-label="Dataset info"
            title="Dataset: Team6Dataset_Enhanced 1.xlsx"
          >
            T6
          </button>
        </div>
      </aside>

      <div className="work-area">
        <div className="work-context">
          <div className="context-brand">
            <Brand />
            <span className="context-separator" />
            <span className="uic-mark">UIC</span>
            <span>Budget Forecasting Analytics</span>
          </div>
          <div className="context-actions">
            <Badge tone="amber">Hackathon demo · Team 6</Badge>
          </div>
        </div>

        <main className="workspace-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">UIC / BUDGET ANALYTICS</div>
              <h1>{current?.[1]}</h1>
              <p>{PAGE_DESCS[page]}</p>
            </div>
          </div>

          <FilterBar
            fy={fy} setFy={setFy}
            dept={dept} setDept={setDept}
            cat={cat} setCat={setCat}
            query={query} setQuery={setQuery}
          />

          <div className="filter-summary">
            <span>{filteredRows.length.toLocaleString()} records in view</span>
            {fy && <Badge>{fy}</Badge>}
            {dept && <Badge tone="green">{dept}</Badge>}
            {cat && <Badge tone="green">{cat}</Badge>}
          </div>

          {page === "overview" && <Overview rows={filteredRows} />}
          {page === "departments" && <DeptTable rows={filteredRows} />}
          {page === "anomalies" && <AnomalyTable rows={filteredRows} />}
          {page === "categories" && <CategoryView rows={filteredRows} />}
          {page === "health" && <ProcessHealth rows={filteredRows} />}

          <footer className="workspace-footer">
            <span><ShieldCheck size={14} /> UIC Budget Analytics · Team 6</span>
            <span>Team6Dataset_Enhanced 1.xlsx · 1,147 records · FY2024–2026</span>
          </footer>
        </main>
      </div>

      {/* mobile nav */}
      <nav className="mobile-dock" aria-label="Quick navigation">
        {PAGES.slice(0, 4).map(([id, title, Icon]) => (
          <button
            key={id}
            aria-label={title}
            aria-current={page === id ? "page" : undefined}
            onClick={() => setPage(id)}
          >
            <Icon size={20} />
            <span>{title}</span>
          </button>
        ))}
        <button onClick={() => setPage("health")}>
          <LayoutGrid size={20} />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}

// ─── root ────────────────────────────────────────────────────────────────────
function App() {
  const [inApp, setInApp] = useState(false);
  return inApp ? <Workspace /> : <Landing onEnter={() => setInApp(true)} />;
}

createRoot(document.getElementById("dashboard-root")).render(<App />);

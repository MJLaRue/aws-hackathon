import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import {
  LayoutDashboard,
  Table2,
  Receipt,
  Users,
  ClipboardList,
  Layers,
  MessageSquare,
  History,
  Settings,
  Archive,
  Sparkles,
  Plus,
  Download,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Search,
  X,
  Check,
  CircleHelp,
  LogOut,
  Menu,
  Upload,
  FileSpreadsheet,
  Pencil,
  Trash2,
  Building2,
  ShieldCheck,
  Wallet,
  TrendingUp,
  Landmark,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  CircleDollarSign,
  PanelLeftClose,
} from "lucide-react";
import { api, setCsrf, qs, money, exactMoney, number, today } from "./api";
import "./styles.css";

const navigation = [
  ["overview", "Overview", LayoutDashboard, "budgets"],
  ["budget", "Budget matrix", Table2, "budgets"],
  ["expenses", "Expenditures", Receipt, "expenses"],
  ["drafts", "Draft workspace", Layers, "drafts"],
  ["commitments", "Temporary board", ClipboardList, "budgets"],
  ["salaries", "Faculty & staff", Users, "salaries"],
  ["imports", "Import data", Upload, "imports"],
  ["notes", "Notes", MessageSquare, "notes"],
  ["audit", "Audit history", History, "audit"],
  ["archives", "Fiscal years", Archive, "budgets"],
  ["admin", "Administration", Settings, "admin"],
];
const titles = Object.fromEntries(navigation.map(([id, title]) => [id, title]));
const navigationGroups = [
  [
    "Workspace",
    ["overview", "budget", "expenses", "drafts", "commitments", "salaries"],
  ],
  ["Manage", ["imports", "notes", "audit", "archives", "admin"]],
];
const descriptions = {
  overview: "Your department’s finances, in focus.",
  budget: "Opening budgets, live adjustments, and the plan ahead.",
  expenses: "Track actual spending against your opening base budget.",
  drafts: "Review proposed changes before publishing to the live budget.",
  commitments:
    "Keep temporary allocations and outstanding commitments in view.",
  salaries: "Manage appointments and salary changes by fiscal year.",
  imports: "Validate your spreadsheet data before it reaches your budget.",
  notes: "Keep the conversation connected to each budget line.",
  audit: "A traceable record of who changed what, and when.",
  archives: "Review prior years and manage the annual transition.",
  admin: "Manage access, departments, and your chart of accounts.",
};
function useData(path, version = 0) {
  const [state, setState] = useState({
    data: null,
    loading: true,
    error: null,
  });
  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });
    api(path, { signal: controller.signal })
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((error) => {
        if (error.name !== "AbortError")
          setState({ data: null, loading: false, error });
      });
    return () => controller.abort();
  }, [path, version]);
  return state;
}
function useDebounced(value) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), 250);
    return () => clearTimeout(t);
  }, [value]);
  return v;
}
function Brand({ light = false }) {
  return (
    <span className={`brand ${light ? "brand-light" : ""}`}>
      <span className="brand-mark">
        <span />
        <span />
        <span />
      </span>
      ledger<span className="brand-dot">.</span>
    </span>
  );
}
function Button({
  children,
  icon: Icon,
  variant = "",
  className = "",
  ...props
}) {
  return (
    <button className={`button ${variant} ${className}`} {...props}>
      {Icon && <Icon size={16} />} {children}
    </button>
  );
}
function Badge({ children, tone = "" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({ title = "Nothing here yet", children }) {
  return (
    <div className="empty">
      <FileSpreadsheet size={30} />
      <h3>{title}</h3>
      <p>
        {children ||
          "Records will appear here when they are added to this workspace."}
      </p>
    </div>
  );
}
function Status({ state, children }) {
  if (state.loading)
    return (
      <div className="loading">
        <span className="spinner" />
        Loading workspace…
      </div>
    );
  if (state.error)
    return (
      <div role="alert" className="error">
        <AlertCircle size={18} />
        {state.error.message}
      </div>
    );
  return children;
}
function Stat({ label, value, detail, icon: Icon = Wallet, accent = false }) {
  return (
    <div className={`stat ${accent ? "stat-accent" : ""}`}>
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
function Pagination({ data, page, setPage }) {
  if (!data) return null;
  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  return (
    <div className="pagination">
      <span>
        {number(data.total)} records · Page {page} of {pages}
      </span>
      <div>
        <button
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          aria-label="Next page"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
function SearchBox({ value, onChange, placeholder = "Search records…" }) {
  return (
    <label className="search">
      <Search size={16} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function RowActions({ edit, remove, extra }) {
  return (
    <div className="row-actions">
      {extra}
      {edit && (
        <button title="Edit record" aria-label="Edit record" onClick={edit}>
          <Pencil size={15} />
        </button>
      )}
      {remove && (
        <button
          title="Delete record"
          aria-label="Delete record"
          onClick={remove}
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}
function Modal({ title, subtitle, onClose, children, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    const cancel = (e) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener("cancel", cancel);
    return () => el.removeEventListener("cancel", cancel);
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-header">
        <div>
          <h2 id="modal-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          aria-label="Close dialog"
          className="icon-button"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  options,
  required = true,
  disabled = false,
  help,
  min,
  step,
}) {
  return (
    <label className="field">
      <span>
        {label}
        {!required && <small>Optional</small>}
      </span>
      {options ? (
        <select
          name={name}
          value={value ?? ""}
          onChange={onChange}
          required={required}
          disabled={disabled}
        >
          {options.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </select>
      ) : type === "textarea" ? (
        <textarea
          name={name}
          value={value ?? ""}
          onChange={onChange}
          required={required}
          maxLength={10000}
        />
      ) : (
        <input
          name={name}
          value={value ?? ""}
          onChange={onChange}
          type={type}
          required={required}
          disabled={disabled}
          min={min}
          step={step}
          maxLength={name === "uin" ? 9 : undefined}
        />
      )}{" "}
      {help && <small>{help}</small>}
    </label>
  );
}
function Chart({ monthly }) {
  const vals = monthly.map((x) => Number(x.amount)),
    max = Math.max(...vals, 1),
    w = 720,
    h = 190;
  const points = vals
    .map(
      (v, i) => `${24 + (i * (w - 48)) / 11},${h - 12 - (v / max) * (h - 32)}`,
    )
    .join(" ");
  return (
    <div className="spending-chart">
      <div className="chart-axis">
        {[max, max / 2, 0].map((v, i) => (
          <span key={i}>{money(v)}</span>
        ))}
      </div>
      <div className="chart-plot">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={`Monthly recorded expenses: ${monthly.map((x) => `${x.label} ${money(x.amount)}`).join(", ")}`}
        >
          <defs>
            <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d5a03c" stopOpacity=".22" />
              <stop offset="100%" stopColor="#d5a03c" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[20, 95, 178].map((y) => (
            <line
              key={y}
              x1="0"
              y1={y}
              x2={w}
              y2={y}
              stroke="#eae6df"
              strokeDasharray="5 5"
            />
          ))}
          <polygon
            points={`24,${h - 12} ${points} ${w - 24},${h - 12}`}
            fill="url(#chart-fill)"
          />
          <polyline
            points={points}
            fill="none"
            stroke="#c58b24"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          {vals.map((v, i) => (
            <circle
              key={i}
              cx={24 + (i * (w - 48)) / 11}
              cy={h - 12 - (v / max) * (h - 32)}
              r="4"
              fill="#c58b24"
              stroke="white"
              strokeWidth="2"
            >
              <title>
                {monthly[i].label}: {exactMoney(v)}
              </title>
            </circle>
          ))}
        </svg>
        <div className="chart-months">
          {monthly.map((x) => (
            <span key={x.month}>{x.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Landing({ onSignIn, config }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <a href="/" aria-label="Ledger home">
          <Brand />
        </a>
        <nav>
          <a href="#workspace">The workspace</a>
          <a href="#foundation">Built for your department</a>
          <Button onClick={onSignIn} variant="dark">
            Open workspace
          </Button>
        </nav>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="uic-mark">UIC</span> A BETTER VIEW OF YOUR BUDGET
            </div>
            <h1>
              A clearer picture
              <br />
              of <span>every dollar.</span>
            </h1>
            <p>
              Bring department budgets, expenditures, and salary planning
              together. One shared workspace, from the opening balance to the
              next fiscal year.
            </p>
            <div className="hero-actions">
              <Button onClick={onSignIn} variant="dark">
                Open your workspace
              </Button>
              <a href="#workspace">
                Explore the workspace <ChevronDown size={16} />
              </a>
            </div>
            <div className="hero-foot">
              <ShieldCheck size={17} /> Department access. Clear history.
              Confident planning.
            </div>
          </div>
          <div className="hero-preview" id="workspace">
            <div className="preview-top">
              <span className="mini-mark">L</span>
              <span>Department overview</span>
              <Badge>FY 2027</Badge>
            </div>
            <div className="preview-body">
              <div className="preview-label">YOUR BUDGET, CONNECTED</div>
              <h2>Everything adds up.</h2>
              <div className="preview-stats">
                <div>
                  <small>Opening budget</small>
                  <strong>Plan</strong>
                </div>
                <Plus size={20} />
                <div>
                  <small>Live adjustments</small>
                  <strong>Refine</strong>
                </div>
              </div>
              <div className="preview-bars">
                {[42, 62, 50, 78, 64, 90, 74, 98, 83, 110, 95, 126].map(
                  (h, i) => (
                    <span key={i} style={{ height: h }} />
                  ),
                )}
              </div>
              <div className="preview-caption">
                Illustrative workspace preview
              </div>
              <div className="preview-row">
                <span>
                  <Table2 size={17} /> Budget matrix
                </span>
                <CheckCircle2 size={17} />
              </div>
              <div className="preview-row">
                <span>
                  <Receipt size={17} /> Actual expenditures
                </span>
                <CheckCircle2 size={17} />
              </div>
              <div className="preview-row">
                <span>
                  <Users size={17} /> Faculty & staff planning
                </span>
                <CheckCircle2 size={17} />
              </div>
            </div>
            <div className="preview-note">
              <Layers size={20} />
              <div>
                <strong>Room to work things out.</strong>
                <small>
                  Stage changes. Review the impact. Publish when ready.
                </small>
              </div>
            </div>
          </div>
        </section>
        <section className="foundation" id="foundation">
          <div>
            <div className="eyebrow">FROM SPREADSHEETS TO A SHARED PLAN</div>
            <h2>
              The details matter.
              <br />
              So does the bigger picture.
            </h2>
          </div>
          <div className="foundation-grid">
            {[
              [
                Table2,
                "A budget you can follow",
                "See opening balances, signed adjustments, and planned totals by Banner account.",
              ],
              [
                Layers,
                "Changes with context",
                "Draft changes, keep notes, and trace updates through a clear audit history.",
              ],
              [
                Archive,
                "Ready for the next year",
                "Preserve prior-year records and carry budgets and salary appointments forward.",
              ],
            ].map(([Icon, title, text]) => (
              <article key={title}>
                <Icon size={25} />
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="landing-ai">
          <Sparkles size={27} />
          <div>
            <h3>A foundation for financial intelligence.</h3>
            <p>
              Reliable, structured records for the forecasting and scenario
              tools to come.
            </p>
          </div>
          <Badge tone="outline">AI layer · Next phase</Badge>
        </section>
      </main>
      <footer>
        <Brand />
        <span>AWS / UIC Enterprise AI Hackathon · Team 6</span>
        <span>Budgeting, forecasting & financial accuracy</span>
      </footer>
    </div>
  );
}

function Login({ config, onClose, onLogin }) {
  const [selected, setSelected] = useState(config.users?.[0]?.id || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title="Welcome to your workspace"
      subtitle="Sign in to access your permitted departments."
      onClose={onClose}
    >
      <div className="modal-body">
        {config.saml && (
          <a className="button dark full" href="/api/auth/saml/login">
            <Landmark size={18} />
            Sign in with UIC
          </a>
        )}
        {config.mock && (
          <>
            <div className="notice">
              <CircleHelp size={18} />
              <div>
                <strong>Development sign-in</strong>
                <p>
                  Explore with synthetic records. These are demonstration
                  accounts, not real UIC identities.
                </p>
              </div>
            </div>
            <Field
              label="Demo account"
              name="user"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              options={(config.users || []).map((x) => ({
                value: x.id,
                label: `${x.first_name} ${x.last_name} · ${x.netid.replace("demo.", "")}`,
              }))}
            />
            <Button
              variant="dark full"
              disabled={!selected || busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api("/auth/mock", {
                    method: "POST",
                    body: { user_id: Number(selected) },
                  });
                  await onLogin();
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Signing in…" : "Enter demo workspace"}
            </Button>
          </>
        )}
        {!config.mock && !config.saml && (
          <div className="notice">
            Sign-in is not configured. Ask your administrator to configure UIC
            SAML.
          </div>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function Overview({ context, version, go, can }) {
  const state = useData(`/overview?${qs(context)}`, version),
    data = state.data;
  return (
    <Status state={state}>
      {data && (
        <>
          <div className="stats-grid">
            <Stat
              label="Opening base budget"
              value={money(data.totals.base_amount)}
              detail="Approved starting allocation"
              icon={Wallet}
            />
            <Stat
              label="Planned budget"
              value={money(data.totals.planned_budget)}
              detail={`${money(data.totals.adjustments)} in live adjustments`}
              icon={TrendingUp}
            />
            <Stat
              label="Actual expenditures"
              value={money(data.totals.spent)}
              detail="Recorded expenses this fiscal year"
              icon={Receipt}
            />
            <Stat
              label="Remaining base balance"
              value={money(data.totals.remaining_base)}
              detail="Opening base less actual expenses"
              accent
              icon={CircleDollarSign}
            />
          </div>
          <div className="overview-grid">
            <section className="card chart-card">
              <div className="card-header">
                <div>
                  <h2>Spending throughout the year</h2>
                  <p>Actual expenses · July–June</p>
                </div>
                <span className="chart-legend">
                  <i />
                  Recorded spending
                </span>
              </div>
              <Chart monthly={data.monthly} />
              <div className="chart-bottom">
                <CircleHelp size={15} />
                Months without recorded expenses show zero.
              </div>
            </section>
            <section className="card attention-card">
              <div className="card-header">
                <h2>On your radar</h2>
                <span className="tiny-label">WORKSPACE</span>
              </div>
              <button onClick={() => go("commitments")}>
                <span className="attention-icon">
                  <ClipboardList size={20} />
                </span>
                <span>
                  <strong>{data.commitments.count} open commitments</strong>
                  <small>
                    {money(data.commitments.amount)} in signed allocations
                  </small>
                </span>
                <ChevronRight size={17} />
              </button>
              {can("drafts") && (
                <button onClick={() => go("drafts")}>
                  <span className="attention-icon">
                    <Layers size={20} />
                  </span>
                  <span>
                    <strong>{data.pending_drafts} pending drafts</strong>
                    <small>Changes awaiting review</small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              )}
              {can("notes") && (
                <button onClick={() => go("notes")}>
                  <span className="attention-icon">
                    <MessageSquare size={20} />
                  </span>
                  <span>
                    <strong>{data.unresolved_notes} open notes</strong>
                    <small>Keep the discussion moving</small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              )}
              <div className="radar-footer">
                <ShieldCheck size={18} />
                <span>Every financial change leaves a record.</span>
              </div>
            </section>
          </div>
          <section className="card">
            <div className="card-header">
              <div>
                <h2>Budget at a glance</h2>
                <p>Your allocation across expense categories</p>
              </div>
              <Button variant="ghost" onClick={() => go("budget")}>
                View budget matrix
                <ChevronRight size={15} />
              </Button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Account / category</th>
                    <th>Group</th>
                    <th className="numeric">Planned budget</th>
                    <th className="numeric">Actual spending</th>
                    <th>Base used</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.account_code}>
                      <td>
                        <strong>{row.category_name}</strong>
                        <small className="cell-meta">{row.account_code}</small>
                      </td>
                      <td>
                        <Badge>{row.group_type}</Badge>
                      </td>
                      <td className="numeric">
                        {exactMoney(row.planned_budget)}
                      </td>
                      <td className="numeric">{exactMoney(row.spent)}</td>
                      <td>
                        <div className="usage">
                          <span
                            className={
                              Number(row.spent) > Number(row.base_amount)
                                ? "over"
                                : ""
                            }
                            style={{
                              width: `${Math.min(100, Math.max(0, (Number(row.spent) / Math.max(1, Number(row.base_amount))) * 100))}%`,
                            }}
                          />
                        </div>
                        <small className="cell-meta">
                          {Math.round(
                            (Number(row.spent) /
                              Math.max(1, Number(row.base_amount))) *
                              100,
                          )}
                          %
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </Status>
  );
}

function Budget({
  context,
  version,
  open,
  can,
  readOnly,
  confirm,
  mode = "active",
}) {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [account, setAccount] = useState("");
  const q = useDebounced(query);
  useEffect(
    () => setPage(1),
    [q, account, context.department_id, context.fiscal_year],
  );
  const state = useData(`/matrix?${qs({ ...context, mode })}`, version),
    adjustments = useData(
      `/adjustments?${qs({ ...context, q, page, account_code: account })}`,
      version,
    );
  return (
    <>
      <div className="page-actions">
        <div className="inline-note">
          <ShieldCheck size={16} /> Live adjustments update the plan. Expenses
          remain separate.
        </div>
        <div className="action-group">
          <Export context={context} mode={mode} />
          {can("budgets", true) && !readOnly && (
            <Button
              icon={Plus}
              variant="dark"
              onClick={() => open({ kind: "adjustment" })}
            >
              Add adjustment
            </Button>
          )}
        </div>
      </div>
      <Status state={state}>
        {state.data && (
          <>
            <div className="stats-grid three budget-summary">
              <Stat
                label="Opening allocation"
                value={money(state.data.totals.base_amount)}
                detail="Your approved starting budget"
                icon={Wallet}
              />
              <Stat
                label="Net adjustments"
                value={money(state.data.totals.adjustments)}
                detail={
                  mode === "draft"
                    ? "Includes pending draft changes"
                    : "Signed changes to the live plan"
                }
                icon={TrendingUp}
              />
              <Stat
                label="Planned budget"
                value={money(state.data.totals.planned_budget)}
                detail="Opening allocation + adjustments"
                icon={CircleDollarSign}
                accent
              />
            </div>
            <section className="card budget-matrix">
              <div className="card-header">
                <div>
                  <div className="section-kicker">ALLOCATION BREAKDOWN</div>
                  <h2>Department budget matrix</h2>
                  <p>
                    {state.data.rows.length} accounts · Amounts in USD ·{" "}
                    {mode === "draft"
                      ? "With pending draft overlays"
                      : "Live budget"}
                  </p>
                </div>
                <Badge tone={mode === "draft" ? "amber" : "green"}>
                  {mode === "draft" ? "Draft preview" : "Live"}
                </Badge>
              </div>
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Department budget matrix accounts"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Banner account</th>
                      <th className="numeric">Opening base</th>
                      <th className="numeric">Adjustments</th>
                      <th className="numeric">Planned budget</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.rows.map((row) => (
                      <tr key={row.account_code}>
                        <td>
                          <div className="account-cell">
                            <span
                              className={`account-icon ${row.group_type === "Personnel" ? "personnel" : ""}`}
                            >
                              {row.group_type === "Personnel" ? (
                                <Users size={18} />
                              ) : (
                                <Landmark size={18} />
                              )}
                            </span>
                            <div>
                              <strong>{row.category_name}</strong>
                              <small className="cell-meta">
                                {row.account_code} · {row.group_type}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td className="numeric">
                          {exactMoney(row.base_amount)}
                        </td>
                        <td
                          className={`numeric ${Number(row.adjustments) > 0 ? "positive" : Number(row.adjustments) < 0 ? "negative" : ""}`}
                        >
                          {Number(row.adjustments) > 0 ? "+" : ""}
                          {exactMoney(row.adjustments)}
                        </td>
                        <td className="numeric emphasis">
                          {exactMoney(row.planned_budget)}
                          <div className="allocation-track" aria-hidden="true">
                            <span
                              style={{
                                width: `${Math.min(100, Math.max(0, (Number(row.planned_budget) / Math.max(1, Number(state.data.totals.planned_budget))) * 100))}%`,
                              }}
                            />
                          </div>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              aria-label={`View ${row.category_name}`}
                              onClick={() => open({ kind: "line", row })}
                            >
                              <MessageSquare size={16} />
                            </button>
                            {can("budgets", true) && !readOnly && (
                              <button
                                aria-label={`Edit base for ${row.category_name}`}
                                onClick={() => open({ kind: "base", row })}
                              >
                                <Pencil size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total allocation</td>
                      <td className="numeric">
                        {exactMoney(state.data.totals.base_amount)}
                      </td>
                      <td className="numeric">
                        {exactMoney(state.data.totals.adjustments)}
                      </td>
                      <td className="numeric">
                        {exactMoney(state.data.totals.planned_budget)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          </>
        )}
      </Status>
      <section className="card section-gap">
        <div className="card-header">
          <div>
            <h2>Live adjustments</h2>
            <p>Signed changes to the opening budget</p>
          </div>
          <SearchBox value={query} onChange={setQuery} />
        </div>
        <div className="filter-bar">
          <label>
            Account{" "}
            <select
              aria-label="Filter adjustments by account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">All accounts</option>
              {state.data?.rows.map((x) => (
                <option key={x.account_code} value={x.account_code}>
                  {x.account_code} · {x.category_name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Status state={adjustments}>
          <FinancialTable
            data={adjustments.data}
            kind="adjustment"
            open={open}
            can={can}
            readOnly={readOnly}
            confirm={confirm}
          />
          <Pagination data={adjustments.data} page={page} setPage={setPage} />
        </Status>
      </section>
    </>
  );
}
function Export({ context, mode = "active" }) {
  return (
    <div className="export">
      <Download size={16} />
      <a href={`/api/export?${qs({ ...context, mode, format: "csv" })}`}>CSV</a>
      <span>/</span>
      <a href={`/api/export?${qs({ ...context, mode, format: "xlsx" })}`}>
        XLSX
      </a>
    </div>
  );
}
function FinancialTable({ data, kind, open, can, readOnly, confirm }) {
  if (!data?.rows?.length) return <Empty />;
  const draft = kind === "draft",
    expense = kind === "expense",
    commitment = kind === "commitment",
    resource = expense ? "expenses" : draft ? "drafts" : "budgets";
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{expense ? "Date / account" : "Account / type"}</th>
            <th>Description</th>
            <th className="numeric">Amount</th>
            <th>{draft ? "Action" : "Status"}</th>
            <th className="actions-heading">Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.id}>
              <td>
                <strong>{expense ? row.expense_date : row.account_code}</strong>
                <small className="cell-meta">
                  {expense ? row.account_code : row.adjustment_type}
                </small>
              </td>
              <td className="description-cell">
                {row.description || "No description"}
              </td>
              <td className="numeric emphasis">{exactMoney(row.amount)}</td>
              <td>
                <Badge
                  tone={
                    draft || row.obligation_status === "owed"
                      ? "amber"
                      : "green"
                  }
                >
                  {draft
                    ? row.draft_action
                    : expense
                      ? "Recorded"
                      : row.obligation_status || "none"}
                </Badge>
              </td>
              <td>
                {!readOnly && can(resource, true) && (
                  <RowActions
                    edit={
                      !commitment && row.draft_action !== "delete"
                        ? () =>
                            open({
                              kind: expense
                                ? "expense"
                                : draft
                                  ? "draft"
                                  : "adjustment",
                              row,
                            })
                        : null
                    }
                    remove={
                      !commitment
                        ? () =>
                            confirm(
                              `Remove this ${draft ? "draft" : expense ? "expense" : "adjustment"}?`,
                              draft
                                ? "Discarding removes the proposed change. The live budget is unaffected."
                                : "The record will be removed from totals and retained in audit history.",
                              `/${draft ? "drafts" : expense ? "expenses" : "adjustments"}/${row.id}`,
                            )
                        : null
                    }
                    extra={
                      <>
                        {commitment && (
                          <Button
                            variant="small"
                            onClick={() =>
                              confirm(
                                "Settle this commitment?",
                                "This converts the adjustment to permanent with a settled status. It does not create an expense.",
                                `/commitments/${row.id}/settle`,
                                "POST",
                              )
                            }
                          >
                            Settle
                          </Button>
                        )}
                        {!draft &&
                          !expense &&
                          !commitment &&
                          can("drafts", true) && (
                            <>
                              <button
                                title="Stage an edit"
                                aria-label="Stage an edit"
                                onClick={() =>
                                  open({
                                    kind: "draft",
                                    row: {
                                      ...row,
                                      id: undefined,
                                      source_adjustment_id: row.id,
                                      draft_action: "update",
                                    },
                                  })
                                }
                              >
                                <Layers size={15} />
                              </button>
                              <button
                                title="Stage a deletion"
                                aria-label="Stage a deletion"
                                onClick={() =>
                                  open({
                                    kind: "draft",
                                    row: {
                                      ...row,
                                      id: undefined,
                                      source_adjustment_id: row.id,
                                      draft_action: "delete",
                                    },
                                  })
                                }
                              >
                                <PanelLeftClose size={15} />
                              </button>
                            </>
                          )}
                      </>
                    }
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Records({
  kind,
  context,
  version,
  open,
  can,
  readOnly,
  confirm,
  notify,
  refresh,
}) {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const q = useDebounced(query);
  useEffect(() => setPage(1), [q, context.department_id, context.fiscal_year]);
  const path =
      kind === "expense"
        ? "expenses"
        : kind === "draft"
          ? "drafts"
          : "commitments",
    resource =
      kind === "expense" ? "expenses" : kind === "draft" ? "drafts" : "budgets";
  const state = useData(`/${path}?${qs({ ...context, q, page })}`, version),
    matrixState = useData(
      kind === "draft"
        ? `/matrix?${qs({ ...context, mode: "draft" })}`
        : kind === "expense"
          ? `/matrix?${qs(context)}`
          : null,
      version,
    );
  return (
    <>
      {matrixState.data && (
        <div className="stats-grid three">
          <Stat
            label={
              kind === "draft" ? "Draft planned budget" : "Opening base budget"
            }
            value={money(
              matrixState.data.totals[
                kind === "draft" ? "planned_budget" : "base_amount"
              ],
            )}
            detail={
              kind === "draft"
                ? "Includes pending create, edit, and delete overlays"
                : "The baseline used for expenditure balances"
            }
          />
          <Stat
            label={
              kind === "draft" ? "Combined adjustments" : "Actual expenditures"
            }
            value={money(
              matrixState.data.totals[
                kind === "draft" ? "adjustments" : "spent"
              ],
            )}
            detail={
              kind === "draft"
                ? "Live changes with draft substitutions"
                : "Non-deleted expense records"
            }
            icon={Receipt}
          />
          <Stat
            label={
              kind === "draft" ? "Pending changes" : "Remaining base balance"
            }
            value={
              kind === "draft"
                ? (state.data?.total ?? "—")
                : money(matrixState.data.totals.remaining_base)
            }
            detail={
              kind === "draft"
                ? "Shared across this department workspace"
                : "Opening base less actual expenses"
            }
            accent
            icon={Layers}
          />
        </div>
      )}
      <div className="page-actions">
        <p className="inline-note">
          {kind === "draft"
            ? "Drafts are shared within the department. Publishing applies all pending changes together."
            : kind === "commitment"
              ? "Temporary allocations and existing owed commitments. Settling does not record spending."
              : "Only valid dates within the selected fiscal year are accepted."}
        </p>
        <div className="action-group">
          {kind === "draft" && <Export context={context} mode="draft" />}
          {!readOnly && can(resource, true) && (
            <Button icon={Plus} onClick={() => open({ kind })} variant="dark">
              {kind === "expense"
                ? "Record expense"
                : kind === "draft"
                  ? "New draft"
                  : "New commitment"}
            </Button>
          )}
          {kind === "draft" &&
            !readOnly &&
            can("budgets", true) &&
            can("drafts", true) && (
              <Button
                disabled={!state.data?.total}
                onClick={() =>
                  confirm(
                    "Publish all pending drafts?",
                    "All pending drafts in this department and year will be checked against their live sources and applied in one transaction.",
                    "/drafts/publish",
                    "POST",
                    context,
                  )
                }
              >
                Publish drafts
              </Button>
            )}
        </div>
      </div>
      <section className="card">
        <div className="card-header">
          <h2>
            {kind === "expense"
              ? "Recorded expenditures"
              : kind === "draft"
                ? "Pending draft changes"
                : "Open commitments"}
          </h2>
          <SearchBox value={query} onChange={setQuery} />
        </div>
        <Status state={state}>
          <FinancialTable
            data={state.data}
            kind={kind}
            open={open}
            can={can}
            readOnly={readOnly}
            confirm={confirm}
          />
          <Pagination data={state.data} page={page} setPage={setPage} />
        </Status>
      </section>
      {kind === "expense" && matrixState.data && (
        <section className="card section-gap">
          <div className="card-header">
            <h2>Balances by account</h2>
            <small>Based on opening budget</small>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="numeric">Opening base</th>
                  <th className="numeric">Actual expenses</th>
                  <th className="numeric">Remaining base</th>
                </tr>
              </thead>
              <tbody>
                {matrixState.data.rows.map((x) => (
                  <tr key={x.account_code}>
                    <td>{x.category_name}</td>
                    <td className="numeric">{exactMoney(x.base_amount)}</td>
                    <td className="numeric">{exactMoney(x.spent)}</td>
                    <td
                      className={`numeric ${Number(x.remaining_base) < 0 ? "negative" : ""}`}
                    >
                      {exactMoney(x.remaining_base)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function Salaries({ context, version, open, can, readOnly, confirm }) {
  const [kind, setKind] = useState("faculty"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const q = useDebounced(query);
  useEffect(
    () => setPage(1),
    [q, kind, context.department_id, context.fiscal_year],
  );
  const state = useData(
      `/salaries/${kind}?${qs({ ...context, q, page })}`,
      version,
    ),
    data = state.data;
  return (
    <>
      <div className="page-actions">
        <div className="segmented">
          {["faculty", "staff"].map((x) => (
            <button
              key={x}
              aria-pressed={kind === x}
              className={kind === x ? "selected" : ""}
              onClick={() => setKind(x)}
            >
              {x === "faculty" ? "Faculty salaries" : "Staff salaries"}
            </button>
          ))}
        </div>
        {!readOnly && can("salaries", true) && (
          <Button
            variant="dark"
            icon={Plus}
            onClick={() => open({ kind: "salary", salaryKind: kind })}
          >
            Add appointment
          </Button>
        )}
      </div>
      <Status state={state}>
        {data && (
          <>
            <div className="stats-grid three">
              <Stat
                label="Previous salaries"
                value={money(data.totals.previous_salary)}
                detail="Department appointments before increases"
                icon={Users}
              />
              <Stat
                label="Salary increases"
                value={money(data.totals.salary_increase)}
                detail="Signed changes to previous salaries"
                icon={TrendingUp}
              />
              <Stat
                label="New salary total"
                value={money(data.totals.new_salary)}
                detail="Previous salaries plus increases"
                accent
              />
            </div>
            <section className="card">
              <div className="card-header">
                <h2>{kind === "faculty" ? "Faculty" : "Staff"} appointments</h2>
                <SearchBox
                  value={query}
                  onChange={setQuery}
                  placeholder="Search names…"
                />
              </div>
              {data.rows.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Name / UIN</th>
                        <th className="numeric">Previous salary</th>
                        <th className="numeric">Increase</th>
                        <th className="numeric">New salary</th>
                        <th>Origin</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <strong>{row[`${kind}_name`]}</strong>
                            <small className="cell-meta">
                              {row.uin || "Legacy identity · no UIN"}
                            </small>
                          </td>
                          <td className="numeric">
                            {exactMoney(row.previous_salary)}
                          </td>
                          <td className="numeric positive">
                            {exactMoney(row.salary_increase)}
                          </td>
                          <td className="numeric emphasis">
                            {exactMoney(row.new_salary)}
                          </td>
                          <td>
                            <Badge>
                              {row.rolled_over_from_id
                                ? "Rolled over"
                                : "New appointment"}
                            </Badge>
                          </td>
                          <td>
                            {!readOnly && can("salaries", true) && (
                              <RowActions
                                edit={() =>
                                  open({
                                    kind: "salary",
                                    salaryKind: kind,
                                    row,
                                  })
                                }
                                remove={() =>
                                  confirm(
                                    "Remove this appointment?",
                                    "The current-year appointment will be removed. Any rollover ledger will retain its source history.",
                                    `/salaries/${kind}/${row.id}`,
                                  )
                                }
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="No appointments found" />
              )}
              <Pagination data={data} page={page} setPage={setPage} />
            </section>
          </>
        )}
      </Status>
    </>
  );
}

function Notes({ context, version, open, can, readOnly, mutate }) {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [resolved, setResolved] = useState("false");
  const q = useDebounced(query);
  useEffect(
    () => setPage(1),
    [q, resolved, context.department_id, context.fiscal_year],
  );
  const state = useData(
    `/notes?${qs({ ...context, q, page, resolved })}`,
    version,
  );
  return (
    <>
      <div className="page-actions">
        <div className="segmented">
          <button
            className={resolved === "false" ? "selected" : ""}
            onClick={() => setResolved("false")}
          >
            Open notes
          </button>
          <button
            className={resolved === "" ? "selected" : ""}
            onClick={() => setResolved("")}
          >
            All notes
          </button>
        </div>
        {!readOnly && can("notes", true) && (
          <Button
            variant="dark"
            icon={Plus}
            onClick={() => open({ kind: "note" })}
          >
            Add note
          </Button>
        )}
      </div>
      <section className="card">
        <div className="card-header">
          <h2>Budget line conversations</h2>
          <SearchBox value={query} onChange={setQuery} />
        </div>
        <Status state={state}>
          {state.data?.rows.length ? (
            <div className="notes-list">
              {state.data.rows.map((row) => (
                <article key={row.id}>
                  <div className="note-avatar">
                    <MessageSquare size={18} />
                  </div>
                  <div>
                    <div className="note-meta">
                      <Badge>{row.account_code}</Badge>
                      <span>
                        {new Date(row.created_at).toLocaleDateString()}
                      </span>
                      <Badge tone={row.is_resolved ? "green" : "amber"}>
                        {row.is_resolved ? "Resolved" : "Open"}
                      </Badge>
                    </div>
                    <p>{row.note_text}</p>
                    <small>
                      Author ID {row.created_by_user_id || "Former user"}
                    </small>
                  </div>
                  {!readOnly && can("notes", true) && (
                    <Button
                      variant="ghost small"
                      icon={Check}
                      onClick={() =>
                        mutate(
                          `/notes/${row.id}`,
                          "PATCH",
                          { is_resolved: !row.is_resolved },
                          row.is_resolved ? "Note reopened" : "Note resolved",
                        ).catch(() => {})
                      }
                    >
                      {row.is_resolved ? "Reopen" : "Resolve"}
                    </Button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <Empty title="No notes to show" />
          )}
          <Pagination data={state.data} page={page} setPage={setPage} />
        </Status>
      </section>
    </>
  );
}

function Audit({ context, version, open, globalAllowed }) {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [global, setGlobal] = useState(false),
    [account, setAccount] = useState("");
  const q = useDebounced(query);
  useEffect(
    () => setPage(1),
    [q, global, account, context.department_id, context.fiscal_year],
  );
  const state = useData(
    `/audit?${qs({ ...(global ? {} : context), q, page, account_code: account })}`,
    version,
  );
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>Change history</h2>
          <p>Before and after values are retained for review.</p>
        </div>
        <SearchBox value={query} onChange={setQuery} />
      </div>
      <div className="filter-bar">
        {globalAllowed && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={global}
              onChange={(e) => setGlobal(e.target.checked)}
            />
            All departments and years
          </label>
        )}
        <label>
          Account{" "}
          <input
            aria-label="Filter audit by account"
            placeholder="All accounts"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </label>
      </div>
      <Status state={state}>
        {state.data?.rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action / resource</th>
                  <th>Actor UIN</th>
                  <th>Budget context</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.timestamp).toLocaleString()}</td>
                    <td>
                      <strong>{row.action_type.replaceAll("_", " ")}</strong>
                      <small className="cell-meta">
                        {row.target_table}{" "}
                        {row.record_id ? `#${row.record_id}` : ""}
                      </small>
                    </td>
                    <td>{row.actor_uin || "System"}</td>
                    <td>
                      {row.department_id ? `Dept ${row.department_id}` : "—"}
                      {row.account_code ? ` · ${row.account_code}` : ""}
                      {row.fiscal_year ? ` · FY ${row.fiscal_year}` : ""}
                    </td>
                    <td>
                      <Button
                        variant="ghost small"
                        onClick={() => open({ kind: "auditDetail", row })}
                      >
                        Inspect
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No matching history" />
        )}
        <Pagination data={state.data} page={page} setPage={setPage} />
      </Status>
    </section>
  );
}

const templates = {
  adjustments:
    "account_code,amount,adjustment_type,obligation_status,description\n2400,15000.00,permanent,none,New laboratory allocation",
  faculty_salaries:
    "uin,display_name,previous_salary,salary_increase\n920000001,Demo Faculty,100000.00,3000.00",
  staff_salaries:
    "uin,display_name,previous_salary,salary_increase\n930000001,Demo Staff,65000.00,1950.00",
};
function Imports({ context, can, readOnly, refresh, notify }) {
  const [type, setType] = useState("adjustments"),
    [mode, setMode] = useState("active"),
    [csv, setCsv] = useState(""),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [commitConfirm, setCommitConfirm] = useState(false);
  const file = useRef();
  useEffect(() => {
    setPreview(null);
    setCommitConfirm(false);
    setError("");
  }, [type, mode, csv, context.department_id, context.fiscal_year]);
  const body = { ...context, import_type: type, workspace_mode: mode };
  const permitted =
    can("imports", true) &&
    can(type === "adjustments" ? "budgets" : "salaries", true) &&
    (mode !== "draft" || can("drafts", true));
  const action = async (commit = false) => {
    setBusy(true);
    setError("");
    try {
      const result = await api(`/imports/${commit ? "commit" : "preview"}`, {
        method: "POST",
        body: { ...body, ...(commit ? { token: preview.token } : { csv }) },
      });
      if (commit) {
        notify(`${result.imported} records imported`);
        setPreview(null);
        setCsv("");
        setCommitConfirm(false);
        refresh();
      } else setPreview(result);
    } catch (e) {
      setError(e.message);
      if (commit) setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="import-layout">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>Bring your data into Ledger</h2>
            <p>Upload a CSV, review the preview, then commit.</p>
          </div>
          <Upload size={22} />
        </div>
        <div className="card-body">
          <div className="form-grid">
            <Field
              label="Import type"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setMode("active");
                setCsv("");
              }}
              options={[
                { value: "adjustments", label: "Budget adjustments" },
                ...(can("salaries", true)
                  ? [
                      { value: "faculty_salaries", label: "Faculty salaries" },
                      { value: "staff_salaries", label: "Staff salaries" },
                    ]
                  : []),
              ]}
            />
            <Field
              label="Workspace"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              options={[
                { value: "active", label: "Active workspace" },
                ...(type === "adjustments" && can("drafts", true)
                  ? [{ value: "draft", label: "Draft workspace" }]
                  : []),
              ]}
            />
          </div>
          {type !== "adjustments" && (
            <div className="notice amber">
              <AlertCircle size={18} />
              <div>
                <strong>This import replaces the salary list.</strong>
                <p>
                  Committing replaces all{" "}
                  {type.startsWith("faculty") ? "faculty" : "staff"}{" "}
                  appointments in the selected department and year. Prior-year
                  records remain intact.
                </p>
              </div>
            </div>
          )}
          <input
            ref={file}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="Upload CSV file"
            onChange={async (e) => {
              const f = e.target.files[0];
              if (f) {
                if (f.size > 1000000) {
                  setError("The CSV must be smaller than 1 MB.");
                  return;
                }
                setCsv(await f.text());
              }
            }}
          />
          <button
            className="upload-zone"
            onClick={() => file.current.click()}
            disabled={readOnly || !permitted}
          >
            <span>
              <Upload size={25} />
            </span>
            <strong>Choose a CSV file</strong>
            <small>Up to 1 MB · 2,000 records per import</small>
          </button>
          <div className="csv-header">
            <label htmlFor="csv-input">Or paste CSV content</label>
            <button onClick={() => setCsv(templates[type])}>
              Use sample format
            </button>
          </div>
          <textarea
            id="csv-input"
            className="csv-input"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            spellCheck={false}
            placeholder={templates[type].split("\n")[0]}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <Button
            variant="dark"
            icon={FileSpreadsheet}
            disabled={busy || !csv || readOnly || !permitted}
            onClick={() => action()}
          >
            {busy ? "Processing…" : "Validate & preview"}
          </Button>
        </div>
      </section>
      <aside className="card import-guide">
        <div className="card-body">
          <Badge tone="green">A safer way to import</Badge>
          <h2>
            Preview first.
            <br />
            Commit with confidence.
          </h2>
          <ol>
            <li>
              <strong>Match the format</strong>
              <p>
                Use the sample headers. All monetary values accept up to two
                decimal places.
              </p>
            </li>
            <li>
              <strong>Review every row</strong>
              <p>
                Account codes, UINs, and required fields are validated before
                committing.
              </p>
            </li>
            <li>
              <strong>Keep your context</strong>
              <p>
                Previews belong to your account and workspace, expire after 15
                minutes, and detect changes to the dataset.
              </p>
            </li>
          </ol>
        </div>
      </aside>
      {preview && (
        <section className="card import-results">
          <div className="card-header">
            <div>
              <h2>{preview.valid ? "Import preview" : "Validation issues"}</h2>
              <p>
                {preview.row_count} records{" "}
                {preview.valid ? "validated" : "checked"}
              </p>
            </div>
            {preview.valid && <Badge tone="green">Ready for review</Badge>}
          </div>
          {!preview.valid ? (
            <div className="card-body">
              {preview.errors.map((x, i) => (
                <p key={i} className="error">
                  Row {x.row}: {x.message}
                </p>
              ))}
            </div>
          ) : (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {Object.keys(preview.rows[0])
                        .filter(
                          (k) => !["department_id", "fiscal_year"].includes(k),
                        )
                        .map((k) => (
                          <th key={k}>{k.replaceAll("_", " ")}</th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 50).map((row, i) => (
                      <tr key={i}>
                        {Object.entries(row)
                          .filter(
                            ([k]) =>
                              !["department_id", "fiscal_year"].includes(k),
                          )
                          .map(([k, v]) => (
                            <td key={k}>{v || "—"}</td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-body">
                <p className="muted">
                  {preview.row_count > 50 ? "Showing the first 50 rows. " : ""}
                  The full validated dataset will be committed.
                </p>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={commitConfirm}
                    onChange={(e) => setCommitConfirm(e.target.checked)}
                  />
                  I reviewed the preview
                  {preview.replaces_existing
                    ? " and approve replacing this salary list"
                    : ""}
                  .
                </label>
                <Button
                  variant="dark"
                  disabled={busy || !commitConfirm || readOnly}
                  onClick={() => action(true)}
                >
                  Commit {preview.row_count} records
                </Button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function Archives({ meta, context, selectYear, can, confirm }) {
  return (
    <>
      <div className="notice">
        <Archive size={21} />
        <div>
          <strong>A complete record, year after year.</strong>
          <p>
            Archived financial records are read-only. On rollover, the next
            opening budget includes live adjustments, and salary totals carry
            forward with zero increase. Expenses and unspent balances are not
            copied.
          </p>
        </div>
      </div>
      <section className="card">
        <div className="card-header">
          <h2>Fiscal years</h2>
          <span className="muted">July 1 – June 30 · America/Chicago</span>
        </div>
        <div className="year-grid">
          {meta.years.map((y) => (
            <article key={y.fiscal_year}>
              <div>
                <span className="year-icon">
                  <Archive size={22} />
                </span>
                <Badge tone={y.status === "active" ? "green" : ""}>
                  {y.status}
                </Badge>
              </div>
              <h3>FY {y.fiscal_year}</h3>
              <p>
                Jul 1, {y.fiscal_year - 1} – Jun 30, {y.fiscal_year}
              </p>
              {y.rolled_to_fiscal_year && (
                <small>Archived into FY {y.rolled_to_fiscal_year}</small>
              )}
              <Button variant="full" onClick={() => selectYear(y.fiscal_year)}>
                {context.fiscal_year === y.fiscal_year
                  ? "Currently selected"
                  : "Open this year"}
              </Button>
              {y.status === "active" && can("rollover", true) && (
                <Button
                  variant="ghost full"
                  disabled={y.fiscal_year >= meta.current_fiscal_year}
                  onClick={() =>
                    confirm(
                      `Roll FY ${y.fiscal_year} into FY ${y.fiscal_year + 1}?`,
                      "This archives the source year, expires pending drafts, and creates the next year’s budgets and salaries. This action affects all departments.",
                      "/fiscal-years/rollover",
                      "POST",
                      { source_fiscal_year: y.fiscal_year },
                    )
                  }
                >
                  Roll over fiscal year
                </Button>
              )}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function Administration({ version, open, can }) {
  const [tab, setTab] = useState("users"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const q = useDebounced(query);
  useEffect(() => setPage(1), [q]);
  const state = useData(`/admin?${qs({ q, page })}`, version),
    data = state.data;
  return (
    <>
      <div className="page-actions">
        <div className="segmented">
          {["users", "roles", "departments", "accounts"].map((x) => (
            <button
              key={x}
              className={tab === x ? "selected" : ""}
              onClick={() => setTab(x)}
            >
              {x.charAt(0).toUpperCase() + x.slice(1)}
            </button>
          ))}
        </div>
        {can("admin", true) && data && (
          <Button
            variant="dark"
            icon={Plus}
            onClick={() =>
              open({ kind: "admin", adminType: tab, adminData: data })
            }
          >
            Add{" "}
            {tab === "users"
              ? "user"
              : tab === "roles"
                ? "role"
                : tab === "departments"
                  ? "department"
                  : "account"}
          </Button>
        )}
      </div>
      <Status state={state}>
        {data && (
          <section className="card">
            <div className="card-header">
              <h2>
                {tab === "users"
                  ? "People & access"
                  : tab === "roles"
                    ? "Resource permissions"
                    : tab === "departments"
                      ? "Department hierarchy"
                      : "Banner accounts"}
              </h2>
              {tab === "users" && (
                <SearchBox
                  value={query}
                  onChange={setQuery}
                  placeholder="Search users…"
                />
              )}
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {(tab === "users"
                      ? [
                          "Name / NetID",
                          "Email",
                          "Role",
                          "Department",
                          "Status",
                          "",
                        ]
                      : tab === "roles"
                        ? ["Role", "Scope", "Permissions", ""]
                        : tab === "departments"
                          ? [
                              "Department",
                              "Code",
                              "Parent",
                              "Type",
                              "Status",
                              "",
                            ]
                          : ["Account", "Category", "Group", ""]
                    ).map((x, i) => (
                      <th key={i}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(tab === "users" ? data.users.rows : data[tab]).map(
                    (row) => (
                      <tr key={row.id || row.account_code}>
                        {tab === "users" ? (
                          <>
                            <td>
                              <strong>
                                {row.first_name} {row.last_name}
                              </strong>
                              <small className="cell-meta">
                                {row.netid} · {row.uin}
                              </small>
                            </td>
                            <td>{row.email}</td>
                            <td>
                              {
                                data.roles.find((x) => x.id === row.role_id)
                                  ?.role_name
                              }
                            </td>
                            <td>
                              {
                                data.departments.find(
                                  (x) => x.id === row.department_id,
                                )?.dept_code
                              }
                            </td>
                            <td>
                              <Badge tone={row.is_active ? "green" : ""}>
                                {row.is_active ? "Active" : "Disabled"}
                              </Badge>
                            </td>
                          </>
                        ) : tab === "roles" ? (
                          <>
                            <td>
                              <strong>{row.role_name}</strong>
                              {row.is_system && (
                                <small className="cell-meta">
                                  Protected system role
                                </small>
                              )}
                            </td>
                            <td>
                              {JSON.parse(row.permissions_json || "{}").scope}
                            </td>
                            <td className="permissions-cell">
                              {Object.entries(
                                JSON.parse(row.permissions_json || "{}"),
                              )
                                .filter(
                                  ([k, v]) => k !== "scope" && v !== "none",
                                )
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(" · ")}
                            </td>
                          </>
                        ) : tab === "departments" ? (
                          <>
                            <td>
                              <strong>{row.dept_name}</strong>
                            </td>
                            <td>{row.dept_code}</td>
                            <td>
                              {data.departments.find(
                                (x) => x.id === row.parent_department_id,
                              )?.dept_code || "—"}
                            </td>
                            <td>
                              {row.is_workspace ? "Workspace" : "Container"}
                            </td>
                            <td>
                              <Badge tone={row.is_active ? "green" : ""}>
                                {row.is_active ? "Active" : "Inactive"}
                              </Badge>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>{row.account_code}</td>
                            <td>{row.category_name}</td>
                            <td>{row.group_type}</td>
                          </>
                        )}
                        <td>
                          {can("admin", true) &&
                            !(tab === "roles" && row.is_system) && (
                              <RowActions
                                edit={() =>
                                  open({
                                    kind: "admin",
                                    adminType: tab,
                                    adminData: data,
                                    row,
                                  })
                                }
                              />
                            )}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            {tab === "users" && (
              <Pagination data={data.users} page={page} setPage={setPage} />
            )}
          </section>
        )}
      </Status>
    </>
  );
}

function LineDetail({ row, context, version, can, open, readOnly }) {
  const notes = useData(
      can("notes")
        ? `/notes?${qs({ ...context, account_code: row.account_code, limit: 100 })}`
        : null,
      version,
    ),
    history = useData(
      can("audit")
        ? `/audit?${qs({ ...context, account_code: row.account_code, limit: 10 })}`
        : null,
      version,
    );
  return (
    <div className="modal-body">
      <div className="line-summary">
        <div>
          <small>Opening base</small>
          <strong>{exactMoney(row.base_amount)}</strong>
        </div>
        <div>
          <small>Planned budget</small>
          <strong>{exactMoney(row.planned_budget)}</strong>
        </div>
      </div>
      {can("notes") && (
        <>
          <div className="card-header compact">
            <h3>Line notes</h3>
            {!readOnly && can("notes", true) && (
              <Button
                variant="small"
                icon={Plus}
                onClick={() =>
                  open({
                    kind: "note",
                    row: { account_code: row.account_code },
                  })
                }
              >
                Add note
              </Button>
            )}
          </div>
          <Status state={notes}>
            {notes.data?.rows.length ? (
              notes.data.rows.map((x) => (
                <div className="line-note" key={x.id}>
                  <Badge tone={x.is_resolved ? "green" : "amber"}>
                    {x.is_resolved ? "Resolved" : "Open"}
                  </Badge>
                  <p>{x.note_text}</p>
                </div>
              ))
            ) : (
              <p className="muted">No notes on this budget line.</p>
            )}
          </Status>
        </>
      )}
      {can("audit") && (
        <>
          <h3>Recent line history</h3>
          <Status state={history}>
            {history.data?.rows.length ? (
              history.data.rows.map((x) => (
                <button
                  className="history-item"
                  key={x.id}
                  onClick={() => open({ kind: "auditDetail", row: x })}
                >
                  <span>
                    {x.action_type.replaceAll("_", " ")}
                    <small>{new Date(x.timestamp).toLocaleString()}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))
            ) : (
              <p className="muted">No recorded changes on this line.</p>
            )}
          </Status>
        </>
      )}
    </div>
  );
}

function EditForm({ dialog, context, meta, onClose, onSaved }) {
  const {
    kind,
    row = {},
    salaryKind = "faculty",
    adminType,
    adminData,
  } = dialog;
  const [values, setValues] = useState(() => {
    const common = {
      account_code: row.account_code || meta.accounts[0]?.account_code || "",
      amount: row.amount || "",
      description: row.description || "",
      adjustment_type:
        row.adjustment_type ||
        (kind === "commitment" ? "temporary" : "permanent"),
      obligation_status:
        row.obligation_status || (kind === "commitment" ? "owed" : "none"),
      reference_source: row.reference_source || "",
      reference_id: row.reference_id || "",
    };
    if (kind === "base")
      return { base_amount: row.base_amount, account_code: row.account_code };
    if (kind === "salary")
      return {
        uin: row.uin || "",
        display_name: row[`${salaryKind}_name`] || "",
        previous_salary: row.previous_salary || "",
        salary_increase: row.salary_increase || "0.00",
      };
    if (kind === "note")
      return { account_code: common.account_code, note_text: "" };
    if (kind === "admin") {
      if (adminType === "users")
        return {
          uin: row.uin || "",
          netid: row.netid || "",
          email: row.email || "",
          first_name: row.first_name || "",
          last_name: row.last_name || "",
          role_id: row.role_id || adminData.roles[0]?.id,
          department_id: row.department_id || adminData.departments[0]?.id,
          is_active: row.is_active ?? true,
        };
      if (adminType === "departments")
        return {
          dept_code: row.dept_code || "",
          dept_name: row.dept_name || "",
          parent_department_id: row.parent_department_id || "",
          is_workspace: row.is_workspace ?? true,
          is_active: row.is_active ?? true,
        };
      if (adminType === "accounts")
        return {
          account_code: row.account_code || "",
          category_name: row.category_name || "",
          group_type: row.group_type || "Operations",
        };
      if (adminType === "roles")
        return {
          role_name: row.role_name || "",
          permissions: row.permissions_json
            ? JSON.parse(row.permissions_json)
            : {
                scope: "own",
                ...Object.fromEntries(
                  [
                    "budgets",
                    "expenses",
                    "salaries",
                    "notes",
                    "drafts",
                    "imports",
                    "audit",
                    "admin",
                    "rollover",
                  ].map((x) => [x, "none"]),
                ),
              },
        };
    }
    return {
      ...common,
      ...(kind === "expense"
        ? {
            expense_date:
              row.expense_date ||
              (today() >= `${context.fiscal_year - 1}-07-01` &&
              today() <= `${context.fiscal_year}-06-30`
                ? today()
                : `${context.fiscal_year - 1}-07-01`),
          }
        : {}),
      ...(kind === "draft"
        ? {
            draft_action: row.draft_action || "create",
            source_adjustment_id: row.source_adjustment_id || null,
          }
        : {}),
    };
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const change = (e) =>
    setValues((v) => ({
      ...v,
      [e.target.name]:
        e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));
  const field = (label, name, extra = {}) => (
    <Field
      label={label}
      name={name}
      value={values[name]}
      onChange={change}
      {...extra}
    />
  );
  const check = (label, name) => (
    <label className="checkbox">
      <input
        name={name}
        type="checkbox"
        checked={values[name]}
        onChange={change}
      />
      {label}
    </label>
  );
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const table =
        kind === "base"
          ? "bases"
          : kind === "salary"
            ? `salaries/${salaryKind}`
            : kind === "note"
              ? "notes"
              : kind === "draft"
                ? "drafts"
                : kind === "expense"
                  ? "expenses"
                  : kind === "admin"
                    ? `admin/${adminType}`
                    : "adjustments";
      let body = { ...context, ...values };
      if (kind === "salary") body.uin = values.uin || null;
      if (["adjustment", "commitment"].includes(kind)) {
        body.reference_source = values.reference_source || null;
        body.reference_id = values.reference_id
          ? Number(values.reference_id)
          : null;
      }
      if (kind === "expense")
        body = {
          ...context,
          account_code: values.account_code,
          amount: values.amount,
          expense_date: values.expense_date,
          description: values.description,
        };
      if (kind === "admin") {
        body = { ...values };
        if (adminType === "departments")
          body.parent_department_id = values.parent_department_id
            ? Number(values.parent_department_id)
            : null;
        if (adminType === "users") {
          body.role_id = Number(values.role_id);
          body.department_id = Number(values.department_id);
        }
      }
      const id =
        kind === "base"
          ? null
          : kind === "admin" && adminType === "accounts"
            ? row.account_code
            : row.id;
      await api(`/${table}${id ? `/${encodeURIComponent(id)}` : ""}`, {
        method: id ? "PUT" : "POST",
        body,
      });
      onSaved("Changes saved");
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <div className="modal-body">
        {kind === "draft" && (
          <div className="notice">
            <Layers size={18} />
            <div>
              <strong>
                {values.draft_action === "create"
                  ? "New proposed adjustment"
                  : values.draft_action === "update"
                    ? "Proposed edit to a live adjustment"
                    : "Proposed deletion of a live adjustment"}
              </strong>
              <p>
                Pending changes do not affect the live budget until published.
              </p>
            </div>
          </div>
        )}
        {kind === "base" && (
          <div className="notice amber">
            Changing the opening base changes expenditure balances. The change
            will be recorded in audit history.
          </div>
        )}
        {[
          "adjustment",
          "commitment",
          "draft",
          "expense",
          "base",
          "note",
        ].includes(kind) &&
          field("Banner account", "account_code", {
            options: meta.accounts.map((x) => ({
              value: x.account_code,
              label: `${x.account_code} · ${x.category_name}`,
            })),
            disabled: kind === "base",
          })}
        {kind === "base" &&
          field("Opening base budget", "base_amount", {
            type: "number",
            step: "0.01",
          })}
        {["adjustment", "commitment", "draft", "expense"].includes(kind) && (
          <>
            <div className="form-grid">
              {field("Amount (USD)", "amount", {
                type: "number",
                step: "0.01",
                min: kind === "expense" ? "0.01" : undefined,
              })}
              {kind === "expense"
                ? field("Expense date", "expense_date", { type: "date" })
                : field("Adjustment type", "adjustment_type", {
                    options: [
                      { value: "permanent", label: "Permanent" },
                      { value: "temporary", label: "Temporary" },
                    ],
                  })}
            </div>
            {kind !== "expense" &&
              field("Commitment status", "obligation_status", {
                options: [
                  { value: "none", label: "None" },
                  { value: "owed", label: "Owed" },
                  { value: "settled", label: "Settled" },
                ],
              })}
            {field("Description", "description", {
              type: "textarea",
              required: kind === "expense",
            })}
          </>
        )}
        {["adjustment", "commitment"].includes(kind) && (
          <div className="form-grid">
            {field("Reference source", "reference_source", {
              required: false,
              help: "Optional source system or record type.",
            })}
            {field("Reference ID", "reference_id", {
              required: false,
              type: "number",
              min: "1",
              step: "1",
            })}
          </div>
        )}
        {kind === "salary" && (
          <>
            {field("Full name", "display_name")}
            {field("Nine-digit UIN", "uin", {
              required: salaryKind === "staff",
              disabled: !!row.id,
              help: row.id
                ? "An existing appointment’s UIN is fixed."
                : salaryKind === "faculty"
                  ? "Optional for legacy faculty identities."
                  : undefined,
            })}
            <div className="form-grid">
              {field("Previous salary (USD)", "previous_salary", {
                type: "number",
                step: "0.01",
                min: "0",
              })}
              {field("Salary increase (USD)", "salary_increase", {
                type: "number",
                step: "0.01",
              })}
            </div>
            <div className="calculated">
              <span>Calculated new salary</span>
              <strong>
                {exactMoney(
                  Number(values.previous_salary || 0) +
                    Number(values.salary_increase || 0),
                )}
              </strong>
            </div>
          </>
        )}
        {kind === "note" && field("Note", "note_text", { type: "textarea" })}
        {kind === "admin" && adminType === "users" && (
          <>
            <div className="form-grid">
              {field("First name", "first_name")}
              {field("Last name", "last_name")}
              {field("UIN", "uin")}
              {field("NetID", "netid")}
            </div>
            {field("Email", "email", { type: "email" })}
            {field("Role", "role_id", {
              options: adminData.roles.map((x) => ({
                value: x.id,
                label: x.role_name,
              })),
            })}
            {field("Department", "department_id", {
              options: adminData.departments
                .filter((x) => x.is_active)
                .map((x) => ({ value: x.id, label: x.dept_name })),
            })}
            {check("Account is active", "is_active")}
          </>
        )}
        {kind === "admin" && adminType === "departments" && (
          <>
            {field("Department name", "dept_name")}
            {field("Department code", "dept_code")}
            {field("Parent container", "parent_department_id", {
              required: false,
              options: [
                { value: "", label: "None · top-level" },
                ...adminData.departments
                  .filter(
                    (x) =>
                      !x.is_workspace &&
                      !x.parent_department_id &&
                      x.id !== row.id,
                  )
                  .map((x) => ({ value: x.id, label: x.dept_name })),
              ],
            })}
            {check("Budget workspace", "is_workspace")}
            {check("Department is active", "is_active")}
          </>
        )}
        {kind === "admin" && adminType === "accounts" && (
          <>
            {field("Account code", "account_code", {
              disabled: !!row.account_code,
            })}
            {field("Category name", "category_name")}
            {field("Group", "group_type")}
          </>
        )}
        {kind === "admin" && adminType === "roles" && (
          <>
            {field("Role name", "role_name")}
            <Field
              label="Department scope"
              value={values.permissions.scope}
              onChange={(e) =>
                setValues((v) => ({
                  ...v,
                  permissions: { ...v.permissions, scope: e.target.value },
                }))
              }
              options={[
                { value: "own", label: "Own department" },
                {
                  value: "children",
                  label: "Own department and child workspaces",
                },
                { value: "all", label: "All departments" },
              ]}
            />
            <div className="permission-grid">
              {Object.keys(values.permissions)
                .filter((x) => x !== "scope")
                .map((key) => (
                  <Field
                    key={key}
                    label={
                      titles[key] || key.charAt(0).toUpperCase() + key.slice(1)
                    }
                    value={values.permissions[key]}
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        permissions: {
                          ...v.permissions,
                          [key]: e.target.value,
                        },
                      }))
                    }
                    options={["none", "read", "write"].map((x) => ({
                      value: x,
                      label: x.charAt(0).toUpperCase() + x.slice(1),
                    }))}
                  />
                ))}
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <Button type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="dark" type="submit" disabled={busy}>
          {busy ? "Saving…" : kind === "draft" ? "Save draft" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function App() {
  const [identity, setIdentity] = useState(null),
    [config, setConfig] = useState(null),
    [meta, setMeta] = useState(null),
    [ready, setReady] = useState(false),
    [page, setPage] = useState(location.pathname.split("/")[2] || "overview"),
    [inApp, setInApp] = useState(location.pathname.startsWith("/app")),
    [department, setDepartment] = useState(""),
    [year, setYear] = useState(""),
    [version, setVersion] = useState(0),
    [dialog, setDialog] = useState(null),
    [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false),
    [initError, setInitError] = useState("");
  const notify = (message) => setToast(message),
    refresh = () => setVersion((v) => v + 1);
  const can = (resource, write = false) =>
    identity?.permissions?.[resource] === "write" ||
    (!write && identity?.permissions?.[resource] === "read");
  const loadIdentity = async () => {
    const me = await api("/auth/me");
    setCsrf(me.csrf);
    setIdentity(me);
    const m = await api("/meta");
    setMeta(m);
    const workspaces = m.departments.filter((x) => x.is_workspace);
    setDepartment((d) =>
      workspaces.some((x) => String(x.id) === String(d))
        ? d
        : workspaces.find((x) => x.dept_code === "CS")?.id ||
          workspaces[0]?.id ||
          "",
    );
    setYear((y) =>
      m.years.some((x) => String(x.fiscal_year) === String(y))
        ? y
        : m.years.find((x) => x.status === "active")?.fiscal_year ||
          m.years[0]?.fiscal_year ||
          "",
    );
    return me;
  };
  useEffect(() => {
    Promise.all([
      api("/auth/config").then(setConfig),
      loadIdentity().catch((e) => {
        if (e.status !== 401) throw e;
      }),
    ])
      .catch((e) => setInitError(e.message))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!identity) return;
    api("/meta")
      .then(setMeta)
      .catch((e) => notify(e.message));
  }, [version]);
  useEffect(() => {
    const listener = () => {
      setInApp(location.pathname.startsWith("/app"));
      setPage(location.pathname.split("/")[2] || "overview");
      setDialog(null);
    };
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const go = (next) => {
    history.pushState({}, "", `/app/${next}`);
    setPage(next);
    setInApp(true);
    setMobile(false);
    setDialog(null);
    window.scrollTo(0, 0);
  };
  const signedIn = async () => {
    const me = await loadIdentity();
    setDialog(null);
    const first = navigation.find(
      ([id, , , resource]) =>
        ["read", "write"].includes(me.permissions[resource]) &&
        (id !== "overview" ||
          ["read", "write"].includes(me.permissions.expenses)),
    );
    go(first?.[0] || "overview");
    refresh();
  };
  const signIn = () =>
    identity ? go("overview") : setDialog({ kind: "login" });
  const context = {
      department_id: Number(department),
      fiscal_year: Number(year),
    },
    readOnly =
      meta?.years.find((x) => Number(x.fiscal_year) === Number(year))
        ?.status !== "active";
  const mutate = async (path, method, body, message) => {
    try {
      const result = await api(path, { method, body });
      notify(message || "Changes saved");
      refresh();
      return result;
    } catch (e) {
      notify(e.message);
      throw e;
    }
  };
  const confirm = (title, text, path, method = "DELETE", body) =>
    setDialog({ kind: "confirm", title, text, path, method, body });
  const common = {
    context,
    version,
    open: setDialog,
    can,
    readOnly,
    confirm,
    notify,
    refresh,
    mutate,
  };
  useEffect(() => {
    const expired = () => {
      setIdentity(null);
      setMeta(null);
      setCsrf("");
      setDialog(null);
    };
    window.addEventListener("ledger:unauthorized", expired);
    return () => window.removeEventListener("ledger:unauthorized", expired);
  }, []);
  if (!ready)
    return (
      <div className="boot">
        <Brand />
        <span className="spinner" />
        Opening Ledger…
      </div>
    );
  if (initError)
    return (
      <div className="boot">
        <Brand />
        <div className="error">{initError}</div>
        <Button onClick={() => location.reload()}>Retry connection</Button>
      </div>
    );
  const accessible = navigation.find((x) => x[0] === page),
    allowed = accessible && can(accessible[3]);
  return (
    <>
      {!inApp || !identity ? (
        <Landing onSignIn={signIn} config={config} />
      ) : (
        <div className="app-shell">
          <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
            <div className="sidebar-top">
              <a
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  history.pushState({}, "", "/");
                  setInApp(false);
                }}
              >
                <Brand light />
              </a>
              <button
                className="mobile-close icon-button"
                aria-label="Close navigation"
                onClick={() => setMobile(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="sidebar-context">
              <span className="uic-mark">UIC</span>
              <div>
                <strong>Budget workspace</strong>
                <small>Department finance</small>
              </div>
            </div>
            <nav aria-label="Main navigation">
              {navigationGroups.map(([group, ids]) => {
                const items = navigation.filter(
                  (x) =>
                    ids.includes(x[0]) &&
                    can(x[3]) &&
                    (x[0] !== "overview" || can("expenses")),
                );
                if (!items.length) return null;
                return (
                  <div className="nav-group" key={group}>
                    <div className="nav-label">{group}</div>
                    {items.map(([id, title, Icon]) => (
                      <button
                        key={id}
                        className={page === id ? "active" : ""}
                        aria-current={page === id ? "page" : undefined}
                        onClick={() => go(id)}
                      >
                        <Icon size={18} />
                        {title}
                        {page === id && <span className="nav-dot" />}
                      </button>
                    ))}
                  </div>
                );
              })}
            </nav>
            <div className="sidebar-bottom">
              <div className="ai-coming">
                <Sparkles size={19} />
                <strong>Intelligence, next.</strong>
                <p>
                  Your records are the foundation for forecasts and scenarios.
                </p>
                <span>AI layer · Planned</span>
              </div>
              <button
                className="profile"
                onClick={() => setDialog({ kind: "profile" })}
              >
                <span className="avatar">
                  {identity.user.first_name[0]}
                  {identity.user.last_name[0]}
                </span>
                <span>
                  <strong>
                    {identity.user.first_name} {identity.user.last_name}
                  </strong>
                  <small>{identity.role}</small>
                </span>
                <ChevronDown size={15} />
              </button>
            </div>
          </aside>
          {mobile && (
            <button
              className="sidebar-scrim"
              aria-label="Close navigation"
              onClick={() => setMobile(false)}
            />
          )}
          <div className="workspace-main">
            <header className="topbar">
              <div className="breadcrumb">
                <button
                  className="mobile-toggle icon-button"
                  aria-label="Open navigation"
                  aria-expanded={mobile}
                  onClick={() => setMobile(true)}
                >
                  <Menu size={22} />
                </button>
                <span>Workspace</span>
                <ChevronRight size={14} />
                <strong>{titles[page] || "Overview"}</strong>
              </div>
              <div className="topbar-right">
                <span className="workspace-secure">
                  <ShieldCheck size={15} /> UIC workspace
                </span>
                {meta?.synthetic_data && (
                  <Badge tone="amber">Synthetic demo data</Badge>
                )}
                <button
                  className="icon-button"
                  aria-label="Workspace help"
                  onClick={() => setDialog({ kind: "help" })}
                >
                  <CircleHelp size={19} />
                </button>
              </div>
            </header>
            <main className="workspace-content">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {meta?.departments.find(
                      (x) => Number(x.id) === Number(department),
                    )?.dept_code || "DEPARTMENT"}{" "}
                    / FINANCIAL WORKSPACE
                  </div>
                  <h1>{titles[page] || "Page not found"}</h1>
                  <p>{descriptions[page]}</p>
                </div>
                <div className="workspace-pickers">
                  <label>
                    <Building2 size={16} />
                    <select
                      aria-label="Department workspace"
                      value={department}
                      onChange={(e) => {
                        setDepartment(e.target.value);
                        setDialog(null);
                      }}
                    >
                      {meta?.departments
                        .filter((x) => x.is_workspace)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.dept_name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    <Archive size={15} />
                    <select
                      aria-label="Fiscal year"
                      value={year}
                      onChange={(e) => {
                        setYear(e.target.value);
                        setDialog(null);
                      }}
                    >
                      {meta?.years.map((x) => (
                        <option key={x.fiscal_year} value={x.fiscal_year}>
                          FY {x.fiscal_year}
                          {x.status === "archived" ? " · Archive" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              {readOnly && (
                <div className="archive-banner">
                  <Archive size={17} />
                  <strong>Archived fiscal year</strong>
                  <span>
                    These records are available for review. Financial changes
                    are disabled.
                  </span>
                </div>
              )}
              {!allowed ? (
                <Empty title="This page is unavailable">
                  Choose a workspace page you have permission to access.
                </Empty>
              ) : !department && page !== "admin" ? (
                <Empty title="No department workspaces">
                  Ask your administrator to assign an active department
                  workspace.
                </Empty>
              ) : (
                <div key={`${page}-${department}-${year}`}>
                  {page === "overview" && <Overview {...common} go={go} />}{" "}
                  {page === "budget" && <Budget {...common} />}{" "}
                  {["expenses", "drafts", "commitments"].includes(page) && (
                    <Records
                      {...common}
                      kind={
                        page === "expenses"
                          ? "expense"
                          : page === "drafts"
                            ? "draft"
                            : "commitment"
                      }
                    />
                  )}{" "}
                  {page === "salaries" && <Salaries {...common} />}{" "}
                  {page === "notes" && <Notes {...common} />}{" "}
                  {page === "audit" && (
                    <Audit
                      {...common}
                      globalAllowed={identity.permissions.scope === "all"}
                    />
                  )}{" "}
                  {page === "imports" && <Imports {...common} />}{" "}
                  {page === "archives" && (
                    <Archives
                      {...common}
                      meta={meta}
                      selectYear={(y) => {
                        setYear(y);
                        go("budget");
                      }}
                    />
                  )}{" "}
                  {page === "admin" && <Administration {...common} />}
                </div>
              )}
              <footer className="workspace-footer">
                <span>
                  <ShieldCheck size={14} /> UIC Budget Workspace
                </span>
                <span>Fiscal year {year} · USD</span>
              </footer>
            </main>
          </div>
        </div>
      )}
      {dialog?.kind === "login" && (
        <Login
          config={config || {}}
          onClose={() => setDialog(null)}
          onLogin={signedIn}
        />
      )}{" "}
      {dialog?.kind === "confirm" && (
        <ConfirmDialog
          dialog={dialog}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await mutate(
              dialog.path,
              dialog.method,
              dialog.body,
              "Action completed",
            );
            setDialog(null);
          }}
        />
      )}
      {dialog &&
        [
          "adjustment",
          "commitment",
          "expense",
          "draft",
          "base",
          "salary",
          "note",
          "admin",
        ].includes(dialog.kind) && (
          <Modal
            title={
              dialog.kind === "admin"
                ? `${dialog.row ? "Edit" : "Add"} ${dialog.adminType.replace(/s$/, "")}`
                : dialog.kind === "salary"
                  ? `${dialog.row ? "Edit" : "Add"} ${dialog.salaryKind} appointment`
                  : dialog.kind === "base"
                    ? "Edit opening budget"
                    : `${dialog.row?.id ? "Edit" : "Add"} ${dialog.kind === "note" ? "budget line note" : dialog.kind}`
            }
            subtitle={
              dialog.kind === "admin"
                ? undefined
                : `${meta?.departments.find((x) => Number(x.id) === Number(department))?.dept_name} · FY ${year}`
            }
            onClose={() => setDialog(null)}
          >
            <EditForm
              dialog={dialog}
              context={context}
              meta={meta}
              onClose={() => setDialog(null)}
              onSaved={(message) => {
                notify(message);
                refresh();
                if (dialog.kind === "admin")
                  loadIdentity().catch((e) => notify(e.message));
              }}
            />
          </Modal>
        )}
      {dialog?.kind === "line" && (
        <Modal
          title={dialog.row.category_name}
          subtitle={`${dialog.row.account_code} · FY ${year}`}
          onClose={() => setDialog(null)}
        >
          <LineDetail {...common} row={dialog.row} />
        </Modal>
      )}
      {dialog?.kind === "auditDetail" && (
        <Modal
          title="Change details"
          subtitle={`${dialog.row.target_table} · ${dialog.row.action_type}`}
          onClose={() => setDialog(null)}
          wide
        >
          <div className="modal-body">
            <div className="audit-json">
              <div>
                <h3>Before</h3>
                <pre>
                  {JSON.stringify(
                    JSON.parse(dialog.row.changes_json || "{}").before,
                    null,
                    2,
                  ) || "No previous record"}
                </pre>
              </div>
              <div>
                <h3>After</h3>
                <pre>
                  {JSON.stringify(
                    JSON.parse(dialog.row.changes_json || "{}").after,
                    null,
                    2,
                  ) || "Record removed"}
                </pre>
              </div>
            </div>
          </div>
        </Modal>
      )}
      {dialog?.kind === "profile" && (
        <Modal title="Your account" onClose={() => setDialog(null)}>
          <div className="modal-body">
            <h3>
              {identity.user.first_name} {identity.user.last_name}
            </h3>
            <p>{identity.user.email}</p>
            <p className="muted">
              {identity.role} · {identity.permissions.scope} department scope
            </p>
            <Button
              icon={LogOut}
              onClick={async () => {
                try {
                  await api("/auth/logout", { method: "POST" });
                  setIdentity(null);
                  setMeta(null);
                  setCsrf("");
                  setDialog(null);
                  history.pushState({}, "", "/");
                  setInApp(false);
                } catch (e) {
                  notify(e.message);
                }
              }}
            >
              Sign out
            </Button>
          </div>
        </Modal>
      )}
      {dialog?.kind === "help" && (
        <Modal
          title="Understanding your budget"
          onClose={() => setDialog(null)}
        >
          <div className="modal-body help-copy">
            <h3>Planned budget</h3>
            <p>
              Opening base plus non-deleted live adjustments. Draft preview
              substitutes pending edits and adds proposed adjustments.
            </p>
            <h3>Remaining base balance</h3>
            <p>
              Opening base minus non-deleted actual expenses. A budget
              adjustment does not itself create an expense.
            </p>
            <h3>Fiscal years</h3>
            <p>
              July 1 through June 30 in America/Chicago. Archived years are
              read-only.
            </p>
            <h3>AI capabilities</h3>
            <p>
              The current version provides the budget-management foundation.
              Forecasting, anomaly detection, and AI explanations are planned
              for the next phase.
            </p>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CircleHelp size={18} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
function ConfirmDialog({ dialog, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={dialog.title} onClose={onClose}>
      <div className="modal-body">
        <p>{dialog.text}</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="dark"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Working…" : "Confirm"}
        </Button>
      </div>
    </Modal>
  );
}
createRoot(document.getElementById("root")).render(<App />);

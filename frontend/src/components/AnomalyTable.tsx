import { Fragment, useMemo, useState, type KeyboardEvent } from 'react'
import { useApi } from '../hooks/useApi'
import { downloadCsv, pct, toCsv, type AnomalyRecord, type AnomalyResponse, type PersistentPattern } from '../types'

type Sev = AnomalyRecord['severity']
type SortKey = 'severity' | 'what' | 'when' | 'variance'
const SEV_RANK: Record<Sev, number> = { high: 3, medium: 2, low: 1 }
const SEVERITIES: Sev[] = ['high', 'medium', 'low']
const REASON = { both: 'z-score and absolute floor', zscore: 'z-score', abs_floor: 'absolute floor' }

/** One line in the table: every flagged row for the same department, category and quarter. */
export interface AnomalyGroup {
  key: string
  department: string
  category: string
  fiscal_year: string
  fiscal_quarter: string
  severity: Sev
  variance_pct: number        // the row with the largest magnitude
  rows: AnomalyRecord[]
}

export function groupAnomalies(rows: AnomalyRecord[], grouped: boolean): AnomalyGroup[] {
  const map = new Map<string, AnomalyRecord[]>()
  rows.forEach((r) => {
    const k = grouped ? `${r.department}|${r.category}|${r.fiscal_year}|${r.fiscal_quarter}` : r.record_id
    map.set(k, [...(map.get(k) ?? []), r])
  })
  return [...map.entries()].map(([key, rs]) => {
    const worst = rs.reduce((a, b) => (Math.abs(b.variance_pct) > Math.abs(a.variance_pct) ? b : a))
    const severity = rs.reduce<Sev>((a, b) => (SEV_RANK[b.severity] > SEV_RANK[a] ? b.severity : a), 'low')
    return { key, department: worst.department, category: worst.category, fiscal_year: worst.fiscal_year, fiscal_quarter: worst.fiscal_quarter, severity, variance_pct: worst.variance_pct, rows: rs }
  })
}

export function sortGroups(gs: AnomalyGroup[], key: SortKey, dir: 1 | -1): AnomalyGroup[] {
  const val = (g: AnomalyGroup): string | number =>
    key === 'severity' ? SEV_RANK[g.severity] * 1000 + Math.abs(g.variance_pct) / 1000
      : key === 'what' ? `${g.department} ${g.category}`
        : key === 'when' ? `${g.fiscal_year} ${g.fiscal_quarter}`
          : Math.abs(g.variance_pct)
  return [...gs].sort((a, b) => {
    const av = val(a), bv = val(b)
    return av === bv ? 0 : (av < bv ? -1 : 1) * dir
  })
}

function Patterns({ patterns }: { patterns: PersistentPattern[] }) {
  const [all, setAll] = useState(false)
  if (!patterns.length) return null
  const groups = [
    { id: 'over', title: 'Keeps running over budget', rows: patterns.filter((p) => p.direction === 'over') },
    { id: 'under', title: 'Keeps running under budget', rows: patterns.filter((p) => p.direction === 'under') },
  ].filter((g) => g.rows.length)
  const limit = all ? Infinity : 4
  return (
    <section className="patterns-block" aria-label="Recurring patterns">
      <h3>Recurring patterns</h3>
      <p className="note">Entities that missed budget in the same direction in most fiscal years, so likely a habit rather than a one-off.</p>
      <div className="two-col">
        {groups.map((g) => (
          <div key={g.id}>
            <h4>{g.title} <span className="note">({g.rows.length})</span></h4>
            <ul className="patterns">
              {g.rows.slice(0, limit).map((p) => {
                const years = Object.keys(p.per_year_variance)
                const miss = years.filter((y) => !p.qualifying_years.includes(y))
                return (
                  <li key={`${p.entity_type}-${p.entity_name}`}>
                    <span className="badge">{p.qualifying_years.length} of {years.length} years</span>{' '}
                    <strong>{p.entity_name}</strong> <span className="note">{p.entity_type}</span>
                    {miss.length > 0 && <span className="note"> · not {miss.map((y) => `${y} (${pct(p.per_year_variance[y])})`).join(', ')}</span>}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
      {patterns.length > 8 && (
        <button type="button" className="ghost" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${patterns.length}`}</button>
      )}
    </section>
  )
}

export default function AnomalyTable({ datasetId }: { datasetId: string }) {
  const { data, error, loading } = useApi<AnomalyResponse>('/anomalies', { dataset_id: datasetId })
  const [sev, setSev] = useState<Sev | null>(null)
  const [dept, setDept] = useState('')
  const [cat, setCat] = useState('')
  const [grouped, setGrouped] = useState(true)
  const [key, setKey] = useState<SortKey>('severity')
  const [dir, setDir] = useState<1 | -1>(-1)
  const [open, setOpen] = useState<string | null>(null)

  const all = data?.anomalies ?? []
  const counts = useMemo(() => Object.fromEntries(SEVERITIES.map((s) => [s, all.filter((r) => r.severity === s).length])) as Record<Sev, number>, [all])
  const filtered = useMemo(() => all.filter((r) => (!sev || r.severity === sev) && (!dept || r.department === dept) && (!cat || r.category === cat)), [all, sev, dept, cat])
  const groups = useMemo(() => sortGroups(groupAnomalies(filtered, grouped), key, dir), [filtered, grouped, key, dir])
  const departments = useMemo(() => [...new Set(all.map((r) => r.department))].sort(), [all])
  const categories = useMemo(() => [...new Set(all.map((r) => r.category))].sort(), [all])

  const sortBy = (k: SortKey) => { if (k === key) setDir((d) => (d === 1 ? -1 : 1)); else { setKey(k); setDir(k === 'severity' || k === 'variance' ? -1 : 1) } }
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id))
  const onRowKey = (e: KeyboardEvent, id: string) => { if (e.key === 'Enter') toggle(id) }
  const cm = data?.confusion_matrix
  const filtersOn = !!(sev || dept || cat)

  const exportCsv = () => downloadCsv('anomalies.csv', toCsv(
    ['Record', 'Department', 'Category', 'Fiscal year', 'Quarter', 'Severity', 'Variance %', 'Z-score', 'Peer group', 'Detector reason', 'Source flag', 'Source type', 'Synthetic'],
    filtered.map((r) => [r.record_id, r.department, r.category, r.fiscal_year, r.fiscal_quarter, r.severity, r.variance_pct.toFixed(1), r.z_score.toFixed(2), r.peer_group, r.detector_reason, r.source_anomaly_flag, r.source_anomaly_type, r.is_synthetic ? 'yes' : ''])))

  const cols: { k: SortKey; label: string; num?: boolean }[] = [
    { k: 'severity', label: 'Severity' }, { k: 'what', label: 'Department and category' }, { k: 'when', label: 'When' }, { k: 'variance', label: 'Variance', num: true },
  ]

  return (
    <section className="anomalies panel" aria-label="Anomaly detection" aria-busy={loading}>
      <div className="panel-head">
        <h2 id="anomaly-table" tabIndex={-1}>Anomalies</h2>
        {data && <button type="button" className="ghost" onClick={exportCsv} disabled={!filtered.length}>Download CSV</button>}
      </div>
      {error && <div className="error-note" role="alert">{error}</div>}
      {data && cm && (
        <>
          <p className="lede">
            {all.length} of {data.total_records_scanned} records stand out against their peer group: {counts.high} high, {counts.medium} medium and {counts.low} low severity.
          </p>

          <div className="sev-strip" role="group" aria-label="Filter by severity">
            {SEVERITIES.map((s) => (
              <button key={s} type="button" className={`sev sev-${s}`} aria-pressed={sev === s} onClick={() => setSev(sev === s ? null : s)}>
                <span className="sev-count">{counts[s]}</span><span>{s}</span>
              </button>
            ))}
            {sev && <button type="button" className="ghost" onClick={() => setSev(null)}>Clear severity filter</button>}
          </div>

          <details className="accuracy">
            <summary>How well does the detector agree with the source file?</summary>
            <p>
              The detector flagged {cm.tp + cm.fn} records. The source file also flagged {cm.tp} of them; the other {cm.fn} are new findings.
              The source file flagged {cm.fp} further records that the detector did not, usually smaller swings that sit within the range of their peers.
              Sensitivity is {data.sensitivity_used} standard deviations; {cm.tn.toLocaleString('en-US')} records were flagged by neither.
            </p>
          </details>

          <Patterns patterns={data.persistent_patterns} />

          <h3 className="chart-title">Flagged records</h3>
          <div className="controls filters">
            <label className="field" htmlFor="an-dept">Department
              <select id="an-dept" value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">All departments</option>{departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="field" htmlFor="an-cat">Category
              <select id="an-cat" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="check"><input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Group by quarter</label>
            {filtersOn && <button type="button" className="ghost" onClick={() => { setSev(null); setDept(''); setCat('') }}>Clear filters</button>}
          </div>
          <p className="note" role="status">
            Showing {groups.length} {grouped ? 'department, category and quarter combinations' : 'records'}
            {grouped && filtered.length !== groups.length ? ` (${filtered.length} records)` : ''}. Press Enter on a row for details.
          </p>

          <div className="table-wrap">
            <table>
              <caption className="sr-only">Flagged records. Press Enter on a row for details.</caption>
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.k} scope="col" className={c.num ? 'num' : ''} aria-sort={c.k === key ? (dir === 1 ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" className="th-btn" onClick={() => sortBy(c.k)}>{c.label}</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    <tr tabIndex={0} aria-expanded={open === g.key} onKeyDown={(e) => onRowKey(e, g.key)} onClick={() => toggle(g.key)}>
                      <td><span className={`sev-tag sev-${g.severity}`}>{g.severity}</span></td>
                      <td><strong>{g.department}</strong><br /><span className="note">{g.category}</span></td>
                      <td>{g.fiscal_year} {g.fiscal_quarter}{g.rows.length > 1 && <><br /><span className="note">{g.rows.length} records</span></>}</td>
                      <td className={`num ${g.variance_pct > 0 ? 'over' : 'under'}`}>{pct(g.variance_pct)}</td>
                    </tr>
                    {open === g.key && (
                      <tr className="drill"><td colSpan={cols.length}>
                        <ul className="drill-list">
                          {g.rows.map((r) => (
                            <li key={r.record_id}>
                              <strong>{r.record_id}</strong>{r.is_synthetic ? ' (synthetic)' : ''}: {pct(r.variance_pct)} against budget,
                              z-score {r.z_score.toFixed(2)} versus the {r.peer_group} peer group. Flagged by {REASON[r.detector_reason]}.
                              {' '}Source file says {r.source_anomaly_flag ? `anomaly (${r.source_anomaly_type ?? 'untyped'})` : 'not an anomaly'}.
                            </li>
                          ))}
                        </ul>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
                {!groups.length && <tr><td colSpan={cols.length} className="note">No records match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

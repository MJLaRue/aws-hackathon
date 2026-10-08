import { Fragment, useMemo, useState, type KeyboardEvent } from 'react'
import { useApi } from '../hooks/useApi'
import { pct, type AnomalyRecord, type AnomalyResponse } from '../types'

type Key = keyof Pick<AnomalyRecord, 'record_id' | 'department' | 'category' | 'fiscal_year' | 'fiscal_quarter' | 'variance_pct' | 'z_score' | 'severity' | 'source_anomaly_flag' | 'source_anomaly_type' | 'peer_group'>
const COLS: { key: Key; label: string }[] = [
  { key: 'record_id', label: 'Record' }, { key: 'department', label: 'Department' }, { key: 'category', label: 'Category' },
  { key: 'fiscal_year', label: 'Year' }, { key: 'fiscal_quarter', label: 'Quarter' }, { key: 'variance_pct', label: 'Variance %' },
  { key: 'z_score', label: 'Z-score' }, { key: 'severity', label: 'Severity' }, { key: 'source_anomaly_flag', label: 'Source flag' },
  { key: 'source_anomaly_type', label: 'Source type' }, { key: 'peer_group', label: 'Peer group' },
]
const SEV_RANK = { high: 3, medium: 2, low: 1 }
const SEV_STYLE: Record<string, React.CSSProperties> = {
  high: { color: '#DC2626', fontWeight: 600 },
  medium: { color: '#D97706', fontWeight: 700, fontSize: '1.1rem' },
  low: { color: '#6B7280' },
}

export function sortRows(rows: AnomalyRecord[], key: Key, dir: 1 | -1): AnomalyRecord[] {
  return [...rows].sort((a, b) => {
    const av = key === 'severity' ? SEV_RANK[a.severity] : a[key]
    const bv = key === 'severity' ? SEV_RANK[b.severity] : b[key]
    if (av === bv) return 0
    if (av === null || av === undefined) return 1
    if (bv === null || bv === undefined) return -1
    return (av < bv ? -1 : 1) * dir
  })
}

export default function AnomalyTable({ datasetId }: { datasetId: string }) {
  const { data, error, loading } = useApi<AnomalyResponse>('/anomalies', { dataset_id: datasetId })
  const [key, setKey] = useState<Key>('severity')
  const [dir, setDir] = useState<1 | -1>(-1)
  const [open, setOpen] = useState<string | null>(null)
  const rows = useMemo(() => (data ? sortRows(data.anomalies, key, dir) : []), [data, key, dir])

  const sortBy = (k: Key) => { if (k === key) setDir((d) => (d === 1 ? -1 : 1)); else { setKey(k); setDir(1) } }
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id))
  const onRowKey = (e: KeyboardEvent, id: string) => { if (e.key === 'Enter') toggle(id) }
  const cm = data?.confusion_matrix

  return (
    <section className="anomalies card" aria-label="Anomaly detection" aria-busy={loading}>
      <h2 id="anomaly-table" tabIndex={-1}>Anomalies</h2>
      {error && <div className="error-note" role="alert">{error}</div>}
      {data && cm && (
        <>
          <p>
            {data.anomalies.length} flagged of {data.total_records_scanned} rows (sensitivity {data.sensitivity_used}).
            Detector vs source flag: TP {cm.tp}, FP {cm.fp}, FN {cm.fn}, TN {cm.tn}.
          </p>
          {data.persistent_patterns.length > 0 && (
            <ul className="patterns" aria-label="Persistent patterns">
              {data.persistent_patterns.map((p) => {
                const all = Object.keys(p.per_year_variance)
                const non = all.filter((y) => !p.qualifying_years.includes(y))
                return (
                  <li key={`${p.entity_type}-${p.entity_name}-${p.direction}`}>
                    <span className="badge">persistent in {p.qualifying_years.length} of {all.length} years</span>{' '}
                    {p.entity_name} ({p.direction})
                    {non.length > 0 && <span className="note"> Not qualifying: {non.map((y) => `${y} ${pct(p.per_year_variance[y])}`).join(', ')}.</span>}
                  </li>
                )
              })}
            </ul>
          )}
          <table>
            <caption className="sr-only">Detected anomalies. Press Enter on a row for details.</caption>
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} scope="col" aria-sort={c.key === key ? (dir === 1 ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="th-btn" onClick={() => sortBy(c.key)}>{c.label}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.record_id}>
                  <tr tabIndex={0} aria-expanded={open === r.record_id}
                    onKeyDown={(e) => onRowKey(e, r.record_id)} onClick={() => toggle(r.record_id)}>
                    <td>{r.record_id}</td><td>{r.department}</td><td>{r.category}</td><td>{r.fiscal_year}</td><td>{r.fiscal_quarter}</td>
                    <td>{pct(r.variance_pct)}</td><td>{r.z_score.toFixed(2)}</td>
                    <td style={SEV_STYLE[r.severity]}>{r.severity}</td>
                    <td>{r.source_anomaly_flag ?? 'n/a'}</td><td>{r.source_anomaly_type ?? 'n/a'}</td><td>{r.peer_group}</td>
                  </tr>
                  {open === r.record_id && (
                    <tr key={`${r.record_id}-d`} className="drill"><td colSpan={COLS.length}>
                      Flagged by {r.detector_reason === 'both' ? 'z-score and absolute floor' : r.detector_reason === 'zscore' ? 'z-score' : 'absolute floor'}.
                      Peer group: {r.peer_group}. {r.is_synthetic ? 'Synthetic record. ' : ''}
                      Source says {r.source_anomaly_flag ? `anomaly (${r.source_anomaly_type ?? 'untyped'})` : 'not an anomaly'}.
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

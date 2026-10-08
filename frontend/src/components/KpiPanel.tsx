import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { pct, usd, type KpiEntityRow, type KpiResponse } from '../types'

function EntityList({ title, rows }: { title: string; rows: KpiEntityRow[] }) {
  return (
    <div className="kpi-list card">
      <h3>{title}</h3>
      <ol>
        {rows.map((r) => (
          <li key={r.entity_name}>
            {r.entity_name}: <strong>{pct(r.variance_pct_agg)}</strong> ({usd(r.variance_usd)})
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function KpiPanel({ datasetId }: { datasetId: string }) {
  const [fy, setFy] = useState('')
  const { data, error, loading } = useApi<KpiResponse>('/kpis', { dataset_id: datasetId, fiscal_year: fy })
  const [years, setYears] = useState<string[]>([])
  if (data && !fy && years.join() !== data.fiscal_year_summary.map((s) => s.fiscal_year).join()) {
    setYears(data.fiscal_year_summary.map((s) => s.fiscal_year))
  }

  return (
    <section className="kpi-panel card" aria-label="Key metrics" aria-busy={loading}>
      <div className="panel-head">
        <h2>Budget variance</h2>
        <label>Fiscal year{' '}
          <select value={fy} onChange={(e) => setFy(e.target.value)}>
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>
      {error && <div className="error-note" role="alert">{error}</div>}
      {data && (
        <>
          <div className="tiles">
            <div className="tile"><span className="tile-label">Actual</span><span className="tile-value">{usd(data.total_actual)}</span></div>
            <div className="tile"><span className="tile-label">Budget</span><span className="tile-value">{usd(data.total_budget)}</span></div>
            <div className="tile"><span className="tile-label">Variance</span>
              <span className={`tile-value ${data.total_variance_pct > 0 ? 'over' : 'under'}`}>{pct(data.total_variance_pct)}</span>
              <span className="tile-sub">{usd(data.total_actual - data.total_budget)}</span></div>
            <div className="tile"><span className="tile-label">Anomalies flagged</span><span className="tile-value">{data.anomaly_count}</span></div>
            <div className="tile"><span className="tile-label">Source flag disagreements</span><span className="tile-value">{data.source_flag_disagreement_count}</span></div>
          </div>
          <div className="kpi-grid">
            <EntityList title="Most over budget: departments" rows={data.top_over_departments} />
            <EntityList title="Most under budget: departments" rows={data.top_under_departments} />
            <EntityList title="Most over budget: categories" rows={data.top_over_categories} />
            <EntityList title="Most under budget: categories" rows={data.top_under_categories} />
          </div>
          <table>
            <caption>By fiscal year</caption>
            <thead><tr><th scope="col">Year</th><th scope="col">Actual</th><th scope="col">Budget</th><th scope="col">Variance</th></tr></thead>
            <tbody>
              {data.fiscal_year_summary.map((s) => (
                <tr key={s.fiscal_year}><th scope="row">{s.fiscal_year}</th><td>{usd(s.total_actual)}</td><td>{usd(s.total_budget)}</td><td>{pct(s.variance_pct)} ({usd(s.variance_usd)})</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

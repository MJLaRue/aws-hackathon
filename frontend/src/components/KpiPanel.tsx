import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { C } from '../theme'
import { pct, usd, type KpiEntityRow, type KpiResponse, type VarianceView } from '../types'
import { OutlookBanner, OutlookTable } from './Outlook'
import Sparkline from './Sparkline'

function EntityList({ title, rows }: { title: string; rows: KpiEntityRow[] }) {
  return (
    <div className="kpi-list">
      <h3>{title}</h3>
      <ol>
        {rows.map((r) => (
          <li key={r.entity_name}>
            <span>{r.entity_name}</span>
            <span className={`num ${r.variance_pct_agg > 0 ? 'over' : 'under'}`}><strong>{pct(r.variance_pct_agg)}</strong> ({usd(r.variance_usd)})</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function KpiPanel({ datasetId, onOpenForecast }: { datasetId: string; onOpenForecast: () => void }) {
  const [fy, setFy] = useState('')
  const { data, error, loading } = useApi<KpiResponse>('/kpis', { dataset_id: datasetId, fiscal_year: fy })
  const trend = useApi<VarianceView>('/variance', { dataset_id: datasetId, entity_level: 'total', grain: 'month' })
  const [years, setYears] = useState<string[]>([])
  if (data && !fy && years.join() !== data.fiscal_year_summary.map((s) => s.fiscal_year).join()) {
    setYears(data.fiscal_year_summary.map((s) => s.fiscal_year))
  }
  const series = trend.data?.quarterly_time_series ?? []
  const grainWord = trend.data?.grain === 'quarter' ? 'quarters' : 'months'

  return (
    <div className="stack">
      <OutlookBanner datasetId={datasetId} onOpenForecast={onOpenForecast} />
      <section className="panel" aria-label="Key metrics" aria-busy={loading}>
        <div className="panel-head">
          <h2>Budget variance</h2>
          <label className="field">Fiscal year
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
              <div className="tile"><span className="tile-label">Actual</span><span className="tile-value">{usd(data.total_actual)}</span>
                <Sparkline values={series.map((p) => p.actual)} /></div>
              <div className="tile"><span className="tile-label">Budget</span><span className="tile-value">{usd(data.total_budget)}</span>
                <Sparkline values={series.map((p) => p.budget)} color={C.steel} /></div>
              <div className="tile"><span className="tile-label">Variance</span>
                <span className={`tile-value ${data.total_variance_pct > 0 ? 'over' : 'under'}`}>{pct(data.total_variance_pct)}</span>
                <span className="tile-sub">{usd(data.total_actual - data.total_budget)}</span>
                <Sparkline values={series.map((p) => p.variance_pct_agg)} color={C.red} /></div>
              <div className="tile"><span className="tile-label">Anomalies flagged</span><span className="tile-value">{data.anomaly_count}</span></div>
              <div className="tile"><span className="tile-label">Source flag disagreements</span><span className="tile-value">{data.source_flag_disagreement_count}</span></div>
            </div>
            {series.length > 1 && <p className="note">Sparklines cover all {series.length} {grainWord} of history.</p>}
            <div className="kpi-grid">
              <EntityList title="Most over budget: departments" rows={data.top_over_departments} />
              <EntityList title="Most under budget: departments" rows={data.top_under_departments} />
              <EntityList title="Most over budget: categories" rows={data.top_over_categories} />
              <EntityList title="Most under budget: categories" rows={data.top_under_categories} />
            </div>
            <div className="two-col">
              <div className="table-wrap">
                <table>
                  <caption>By fiscal year</caption>
                  <thead><tr><th scope="col">Year</th><th scope="col" className="num">Actual</th><th scope="col" className="num">Budget</th><th scope="col" className="num">Variance</th></tr></thead>
                  <tbody>
                    {data.fiscal_year_summary.map((s) => (
                      <tr key={s.fiscal_year}><th scope="row">{s.fiscal_year}</th><td className="num">{usd(s.total_actual)}</td><td className="num">{usd(s.total_budget)}</td>
                        <td className={`num ${s.variance_pct > 0 ? 'over' : 'under'}`}>{pct(s.variance_pct)} ({usd(s.variance_usd)})</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {trend.data && trend.data.fund_source_split.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <caption>By fund source, all years</caption>
                    <thead><tr><th scope="col">Fund</th><th scope="col" className="num">Variance</th><th scope="col" className="num">Share of variance</th></tr></thead>
                    <tbody>
                      {trend.data.fund_source_split.map((f) => (
                        <tr key={f.fund_source}><th scope="row">{f.fund_source}</th>
                          <td className={`num ${f.variance_pct_agg > 0 ? 'over' : 'under'}`}>{pct(f.variance_pct_agg)} ({usd(f.variance_usd)})</td>
                          <td className="num">{(f.share_of_total_variance * 100).toFixed(0)}%</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </section>
      <section className="panel" aria-label="Projected FY2027 by entity">
        <div className="panel-head"><h2>Where FY2027 is headed</h2></div>
        <p className="note">Each entity's FY2027 forecast is compared with its FY2026 budget, since the FY2027 budget is not in the data. Open the forecast tab for the model and range behind any row.</p>
        <OutlookTable datasetId={datasetId} />
      </section>
    </div>
  )
}

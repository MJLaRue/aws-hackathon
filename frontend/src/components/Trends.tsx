import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { downloadCsv, periodLabel, pct, toCsv, type Entities, type Grain, type VarianceView } from '../types'
import EntitySelect, { parseEntity } from './EntitySelect'
import GrainToggle from './GrainToggle'
import TrendChart from './TrendChart'

export default function Trends({ datasetId, grain, onGrain }: { datasetId: string; grain: Grain; onGrain: (g: Grain) => void }) {
  const [sel, setSel] = useState('')
  const ents = useApi<Entities>('/entities', { dataset_id: datasetId })
  const { level, name } = parseEntity(sel)
  const v = useApi<VarianceView>('/variance', { dataset_id: datasetId, entity_level: level, entity_name: name, grain })
  const monthlyAvailable = v.data?.monthly_available ?? true
  // A dataset without a month column answers in quarters; reflect that in the toggle.
  useEffect(() => { if (v.data && !v.data.monthly_available && grain === 'month') onGrain('quarter') }, [v.data, grain, onGrain])

  const exportCsv = () => {
    if (!v.data) return
    const rows = v.data.quarterly_time_series.map((p) => [periodLabel(p), p.fiscal_year, p.fiscal_quarter, Math.round(p.actual), Math.round(p.budget), Math.round(p.actual - p.budget), p.variance_pct_agg.toFixed(2)])
    downloadCsv(`trend-${grain}-${(name ?? 'all-spending').replace(/\W+/g, '-')}.csv`,
      toCsv(['Period', 'Fiscal year', 'Fiscal quarter', 'Actual', 'Budget', 'Variance USD', 'Variance %'], rows))
  }

  const t = v.data?.quarterly_time_series ?? []
  const last = t[t.length - 1]
  return (
    <section aria-label="Trend" className="panel" aria-busy={v.loading}>
      <div className="panel-head">
        <h2>{grain === 'month' ? 'Monthly' : 'Quarterly'} trend</h2>
        <div className="controls">
          <EntitySelect id="trend-entity" entities={ents.data} value={sel} onChange={setSel} />
          <GrainToggle value={grain} onChange={onGrain} monthlyAvailable={monthlyAvailable} />
          <button type="button" className="ghost" onClick={exportCsv} disabled={!t.length}>Download CSV</button>
        </div>
      </div>
      {v.data && last && (
        <p className="lede">
          {name ?? 'All spending'} ran <strong className={v.data.total_variance_pct > 0 ? 'over' : 'under'}>{pct(v.data.total_variance_pct)}</strong> against
          budget over {t.length} {grain === 'month' ? 'months' : 'quarters'}; the latest, {periodLabel(last)}, was{' '}
          <strong className={last.variance_pct_agg > 0 ? 'over' : 'under'}>{pct(last.variance_pct_agg)}</strong>.
        </p>
      )}
      {v.error && <div className="error-note" role="alert">{v.error}</div>}
      {v.data && !v.data.entity_not_found && (
        <TrendChart entityName={name ?? 'All spending'} series={t} stlAvailable={v.data.stl_available} stlNote={v.data.stl_note} grain={v.data.grain} />
      )}
    </section>
  )
}

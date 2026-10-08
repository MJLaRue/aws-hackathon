import { useMemo } from 'react'
import { useApi } from '../hooks/useApi'
import { downloadCsv, pct, toCsv, usd, usdShort, type OutlookRow } from '../types'

const gapClass = (v: number) => (v > 0 ? 'over' : 'under')

/** Navy statement of next year's projected spend; the one loud element on the Overview. */
export function OutlookBanner({ datasetId, onOpenForecast }: { datasetId: string; onOpenForecast: () => void }) {
  const { data, error, loading } = useApi<OutlookRow[]>('/outlook', { dataset_id: datasetId })
  const total = data?.find((r) => r.entity_level === 'total')
  if (error) return <div className="error-note" role="alert">Outlook unavailable: {error}</div>
  if (!total) return <div className="banner" aria-busy={loading}><p className="banner-note">Calculating the FY2027 outlook…</p></div>
  return (
    <div className="banner">
      <div>
        <p className="banner-kicker">FY2027 outlook</p>
        <p className="banner-headline">
          Spend is projected at {usdShort(total.fy2027_forecast)}, {Math.abs(total.projected_gap_pct).toFixed(1)}%{' '}
          {total.projected_gap_pct > 0 ? 'above' : 'below'} the FY2026 budget of {usdShort(total.fy2026_budget)}.
        </p>
        <p className="banner-note">
          Rough 80% range {usdShort(total.fy2027_low_80)} to {usdShort(total.fy2027_high_80)}. Confidence {total.confidence_label.toLowerCase()}, model {total.model_name}.
        </p>
      </div>
      <button type="button" className="on-dark" onClick={onOpenForecast}>Open forecast</button>
    </div>
  )
}

export function OutlookTable({ datasetId }: { datasetId: string }) {
  const { data, loading } = useApi<OutlookRow[]>('/outlook', { dataset_id: datasetId })
  const rows = useMemo(
    () => (data ?? []).filter((r) => r.entity_level !== 'total').sort((a, b) => b.projected_gap_pct - a.projected_gap_pct),
    [data])
  if (!rows.length) return loading ? <p className="note" aria-busy="true">Loading projections…</p> : null
  const exportCsv = () => downloadCsv('fy2027-outlook.csv', toCsv(
    ['Level', 'Entity', 'FY2026 budget', 'FY2027 forecast', 'Gap USD', 'Gap %', 'Confidence'],
    rows.map((r) => [r.entity_level, r.entity_name, Math.round(r.fy2026_budget), Math.round(r.fy2027_forecast), Math.round(r.projected_gap_usd), r.projected_gap_pct.toFixed(1), r.confidence_label])))
  return (
    <div className="table-wrap">
      <table>
        <caption>Projected FY2027 spend against the FY2026 budget, most over first</caption>
        <thead><tr><th scope="col">Entity</th><th scope="col">Type</th><th scope="col" className="num">FY2026 budget</th><th scope="col" className="num">FY2027 forecast</th><th scope="col" className="num">Gap</th><th scope="col">Confidence</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.entity_level}-${r.entity_name}`}>
              <th scope="row">{r.entity_name}</th>
              <td>{r.entity_level.replace('_', ' ')}</td>
              <td className="num">{usd(r.fy2026_budget)}</td>
              <td className="num">{usd(r.fy2027_forecast)}</td>
              <td className={`num ${gapClass(r.projected_gap_pct)}`}>{pct(r.projected_gap_pct)} ({usd(r.projected_gap_usd)})</td>
              <td>{r.confidence_label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions"><button type="button" className="ghost" onClick={exportCsv}>Download CSV</button></div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi } from '../hooks/useApi'
import { C } from '../theme'
import {
  downloadCsv, periodLabel, pct, postJSON, toCsv, usd, usdShort,
  type Entities, type ForecastResponse, type Grain, type VarianceView,
} from '../types'
import EntitySelect, { parseEntity } from './EntitySelect'
import GrainToggle from './GrainToggle'

const HORIZONS: Record<Grain, { value: number; text: string }[]> = {
  quarter: [{ value: 4, text: 'FY2027 (4 quarters)' }, { value: 8, text: 'Two years (8 quarters)' }],
  month: [{ value: 6, text: '6 months' }, { value: 12, text: 'FY2027 (12 months)' }, { value: 24, text: 'Two years (24 months)' }],
}
const CONFIDENCE_TEXT: Record<string, string> = {
  High: 'Cross-validated error is small and the range is narrow.',
  Medium: 'Cross-validated error is moderate, or the range is wide.',
  Low: 'Too little history to score reliably, or the cross-validated error is large. Treat as a rough guide.',
}

function useForecast(datasetId: string, level: string, name: string | undefined, grain: Grain, horizon: number, budget: number | undefined) {
  const [state, setState] = useState<{ data: ForecastResponse | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    postJSON<ForecastResponse>('/forecast', { dataset_id: datasetId, entity_level: level, entity_name: name ?? null, grain, horizon, planned_budget_total: budget ?? null })
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e: Error) => alive && setState({ data: null, error: e.message, loading: false }))
    return () => { alive = false }
  }, [datasetId, level, name, grain, horizon, budget])
  return state
}

export default function Forecast({ datasetId, grain, onGrain }: { datasetId: string; grain: Grain; onGrain: (g: Grain) => void }) {
  const [sel, setSel] = useState('')
  const [horizon, setHorizon] = useState(HORIZONS[grain][grain === 'month' ? 1 : 0].value)
  const [draft, setDraft] = useState('')
  const [budget, setBudget] = useState<number | undefined>(undefined)
  const ents = useApi<Entities>('/entities', { dataset_id: datasetId })
  const { level, name } = parseEntity(sel)
  const hist = useApi<VarianceView>('/variance', { dataset_id: datasetId, entity_level: level, entity_name: name, grain })
  const fc = useForecast(datasetId, level, name, grain, horizon, budget)
  const monthlyAvailable = hist.data?.monthly_available ?? true

  useEffect(() => { if (hist.data && !hist.data.monthly_available && grain === 'month') onGrain('quarter') }, [hist.data, grain, onGrain])
  const changeGrain = (g: Grain) => { onGrain(g); setHorizon(HORIZONS[g][g === 'month' ? 1 : 0].value) }
  const applyBudget = () => {
    const n = Number(draft.replace(/[$,\s]/g, ''))
    setBudget(draft.trim() && Number.isFinite(n) && n > 0 ? n : undefined)
  }

  const f = fc.data
  const ok = !!f && !f.refusal && !f.entity_not_found && f.points.length > 0
  const perYear = f?.periods_per_year ?? (grain === 'month' ? 12 : 4)
  const base = f?.planned_budget_total ? f.planned_budget_total / perYear : null

  const chart = useMemo(() => {
    if (!ok || !f || !hist.data || hist.data.grain !== f.grain || f.dollar_forecast_available === false) return []
    const h = hist.data.quarterly_time_series
    const rows: Record<string, unknown>[] = h.map((p) => ({ label: periodLabel(p), actual: Math.round(p.actual) }))
    const last = rows[rows.length - 1]
    if (last) Object.assign(last, { forecast: last.actual, band80: [last.actual, last.actual], band95: [last.actual, last.actual] })
    f.points.forEach((p) => rows.push({
      label: p.forecast_period,
      forecast: Math.round(p.dollar_forecast ?? 0),
      band80: [Math.round(p.dollar_pi_80_low ?? 0), Math.round(p.dollar_pi_80_high ?? 0)],
      band95: [Math.round(p.dollar_pi_95_low ?? 0), Math.round(p.dollar_pi_95_high ?? 0)],
      budgetBase: base ? Math.round(base) : undefined,
    }))
    return rows
  }, [ok, f, hist.data, base])

  const total = ok && f.dollar_forecast_available ? f.points.reduce((a, p) => a + (p.dollar_forecast ?? 0), 0) : null
  const lo = ok && f.dollar_forecast_available ? f.points.reduce((a, p) => a + (p.dollar_pi_80_low ?? 0), 0) : null
  const hi = ok && f.dollar_forecast_available ? f.points.reduce((a, p) => a + (p.dollar_pi_80_high ?? 0), 0) : null
  const against = base ? base * (f?.points.length ?? 0) : null
  const gapPct = total !== null && against ? (total / against - 1) * 100 : null
  const span = ok ? `${f.points[0].forecast_period} to ${f.points[f.points.length - 1].forecast_period}` : ''

  const exportCsv = () => {
    if (!f) return
    downloadCsv(`forecast-${grain}-${(name ?? 'all-spending').replace(/\W+/g, '-')}.csv`, toCsv(
      ['Period', 'Fiscal quarter', 'Spend/budget ratio', 'Ratio 80% low', 'Ratio 80% high', 'Forecast USD', 'USD 80% low', 'USD 80% high', 'USD 95% low', 'USD 95% high'],
      f.points.map((p) => [p.forecast_period, p.forecast_quarter, p.ratio_forecast.toFixed(4), p.pi_80_low.toFixed(4), p.pi_80_high.toFixed(4),
        p.dollar_forecast?.toFixed(0), p.dollar_pi_80_low?.toFixed(0), p.dollar_pi_80_high?.toFixed(0), p.dollar_pi_95_low?.toFixed(0), p.dollar_pi_95_high?.toFixed(0)])))
  }

  return (
    <section aria-label="Forecast" className="panel" aria-busy={fc.loading}>
      <div className="panel-head">
        <h2>Forecast</h2>
        <div className="controls">
          <EntitySelect id="fc-entity" entities={ents.data} value={sel} onChange={setSel} />
          <GrainToggle value={grain} onChange={changeGrain} monthlyAvailable={monthlyAvailable} label="Forecast by" />
          <label htmlFor="fc-horizon" className="field">Horizon
            <select id="fc-horizon" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
              {HORIZONS[grain].map((h) => <option key={h.value} value={h.value}>{h.text}</option>)}
            </select>
          </label>
          <form className="field inline" onSubmit={(e) => { e.preventDefault(); applyBudget() }}>
            <label htmlFor="fc-budget">What if the annual budget is</label>
            <input id="fc-budget" type="text" inputMode="numeric" placeholder={f?.planned_budget_total ? usd(f.planned_budget_total) : 'FY2026 budget'} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="ghost">Apply</button>
            {budget !== undefined && <button type="button" className="ghost" onClick={() => { setDraft(''); setBudget(undefined) }}>Reset</button>}
          </form>
        </div>
      </div>

      {fc.error && <div className="error-note" role="alert">{fc.error}</div>}
      {f?.entity_not_found && <p className="callout" role="note">No data for this selection.</p>}
      {f?.refusal && (
        <div className="callout" role="note">
          {f.refusal}
          {grain === 'month' && f.entity_level !== 'dept_x_category' && <div className="actions"><button type="button" className="ghost" onClick={() => changeGrain('quarter')}>Switch to quarterly</button></div>}
        </div>
      )}

      {ok && (
        <>
          {total !== null && lo !== null && hi !== null ? (
            <p className="lede">
              Projected spend for {span} is <strong>{usd(total)}</strong>
              {gapPct !== null && <>, <strong className={gapPct > 0 ? 'over' : 'under'}>{pct(gapPct)}</strong> {gapPct > 0 ? 'above' : 'below'} the {budget !== undefined ? 'budget you entered' : 'FY2026 budget'} of {usd(against!)} for the same length of time</>}.
              A rough 80% range is {usd(lo)} to {usd(hi)}.
            </p>
          ) : (
            <p className="callout" role="note">{f.dollar_unavailable_reason ?? 'Dollar forecast unavailable.'} The table shows the spend-to-budget ratio.</p>
          )}

          <div className="facts">
            <div className={`badge-conf conf-${f.confidence_label.toLowerCase()}`}>
              <span className="fact-label">Confidence</span>
              <span className="fact-value">{f.confidence_label}</span>
              <span className="fact-sub">{CONFIDENCE_TEXT[f.confidence_label]}</span>
            </div>
            <div><span className="fact-label">Model</span><span className="fact-value">{f.model_name}</span>
              <span className="fact-sub">Chosen by rolling-origin cross-validation on {f.n_quarters} {grain === 'month' ? 'months' : 'quarters'}</span></div>
            <div><span className="fact-label">Cross-validated error</span>
              <span className="fact-value">{f.cv_mae !== null ? `MAE ${f.cv_mae.toFixed(3)}` : 'Not scored'}</span>
              <span className="fact-sub">{f.cv_smape !== null ? `sMAPE ${f.cv_smape.toFixed(1)}% on the spend-to-budget ratio` : 'Not enough history for a validation fold'}</span></div>
            <div><span className="fact-label">Seasonality</span><span className="fact-value">{f.stl_available ? 'Detected' : 'Not tested'}</span>
              <span className="fact-sub">{f.stl_available ? 'Enough history for seasonal decomposition' : f.stl_note}</span></div>
          </div>
          {f.interpolated_periods > 0 && (
            <p className="callout" role="note">
              {f.interpolated_periods} of {f.n_quarters} months had no records for this selection. They were filled by straight-line interpolation before fitting, so treat monthly detail as approximate.
            </p>
          )}

          {chart.length > 0 && (
            <figure className="trend-chart">
              <div role="img" aria-label={`Spend history and ${f.points.length}-${grain} forecast with 80% and 95% ranges for ${name ?? 'all spending'}`}>
                <ResponsiveContainer width="100%" height={340}>
                  <ComposedChart data={chart} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" minTickGap={grain === 'month' ? 24 : 8} tick={{ fill: C.ink }} />
                    <YAxis tickFormatter={usdShort} width={64} tick={{ fill: C.ink }} />
                    <Tooltip formatter={(v: number | number[]) => (Array.isArray(v) ? `${usd(v[0])} to ${usd(v[1])}` : usd(v))} />
                    <Legend />
                    <Area dataKey="band95" name="95% range" stroke="none" fill={C.slate} fillOpacity={0.35} isAnimationActive={false} />
                    <Area dataKey="band80" name="80% range" stroke="none" fill={C.slate} fillOpacity={0.7} isAnimationActive={false} />
                    <Line dataKey="budgetBase" name="FY2026 budget pace" stroke={C.steel} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                    <Line dataKey="actual" name="Actual spend" stroke={C.navy} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    <Line dataKey="forecast" name="Forecast" stroke={C.red} strokeWidth={3} dot={grain === 'quarter'} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </figure>
          )}

          <div className="table-wrap">
            <table>
              <caption>Forecast by {grain === 'month' ? 'month' : 'quarter'}</caption>
              <thead><tr><th scope="col">Period</th><th scope="col" className="num">Forecast</th><th scope="col" className="num">80% range</th><th scope="col" className="num">95% range</th><th scope="col" className="num">Spend / budget</th></tr></thead>
              <tbody>
                {f.points.map((p) => (
                  <tr key={p.period_index}>
                    <th scope="row">{p.forecast_period}{grain === 'month' && <span className="note"> · {p.forecast_quarter}</span>}</th>
                    <td className="num">{p.dollar_forecast !== null ? usd(p.dollar_forecast) : 'n/a'}</td>
                    <td className="num">{p.dollar_pi_80_low !== null && p.dollar_pi_80_high !== null ? `${usd(p.dollar_pi_80_low)} to ${usd(p.dollar_pi_80_high)}` : 'n/a'}</td>
                    <td className="num">{p.dollar_pi_95_low !== null && p.dollar_pi_95_high !== null ? `${usd(p.dollar_pi_95_low)} to ${usd(p.dollar_pi_95_high)}` : 'n/a'}</td>
                    <td className="num">{p.ratio_forecast.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions"><button type="button" className="ghost" onClick={exportCsv}>Download CSV</button></div>
          <p className="note">
            Forecasts model the ratio of spend to budget, then convert to dollars using the annual budget divided by {perYear}.
            {' '}Ranges come from a bootstrap of past errors and are approximate, not guaranteed coverage.
          </p>
        </>
      )}
    </section>
  )
}

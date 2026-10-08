import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { useApi } from '../hooks/useApi'
import { C } from '../theme'
import type { BenchmarkResponse } from '../types'

const MODEL_TEXT: Record<string, string> = {
  Naive: 'Repeats the latest value.',
  SeasonalNaive: 'Repeats the same period one year earlier.',
  Drift: 'Continues the average change seen so far.',
  ETS: 'Exponential smoothing with a damped trend.',
  LinearTrend: 'Fits a straight line through the history.',
}

export default function BenchmarkPanel({ datasetId }: { datasetId: string }) {
  const { data, error, loading } = useApi<BenchmarkResponse>('/benchmark', { dataset_id: datasetId })
  const maxMae = data ? Math.max(...data.model_comparison.map((m) => m.cv_mae), 0.0001) : 1
  const mae = data?.cv_mae ?? null
  const gaps = data?.gap_histogram ?? []

  return (
    <div className="stack">
      <section className="benchmark panel" aria-label="Forecast benchmark" aria-busy={loading}>
        <div className="panel-head"><h2>Benchmark</h2></div>
        {error && <div className="error-note" role="alert">{error}</div>}
        {data && (
          <>
            <p className="lede">
              {data.model_name && data.cv_smape !== null
                ? <>Our best model, <strong>{data.model_name}</strong>, is typically off by <strong>{data.cv_smape.toFixed(1)}%</strong> when predicting the spend-to-budget ratio on periods it has not seen.</>
                : <>There is not yet enough history to score a model.</>}
              {data.mean_gap !== null && data.gap_under_1pct_share !== null && (
                <> The forecast in the source file is off by <strong>{data.mean_gap.toFixed(1)}%</strong> on average, and <strong>{Math.round(data.gap_under_1pct_share * 100)}%</strong> of its rows land within 1% of actual spend.</>
              )}
            </p>
            {data.caveat && <p className="callout" role="note">{data.caveat}</p>}

            <div className="two-col">
              <div>
                <h3 className="chart-title">Every model we tried</h3>
                <p className="note">Each model forecast the next quarter {data.model_comparison[0]?.folds ?? 'several'} times, each time using only earlier quarters. Lower error is better; the winner drives the forecasts.</p>
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">Cross-validated error by model on the total spend-to-budget ratio</caption>
                    <thead><tr><th scope="col">Model</th><th scope="col">Error (MAE)</th><th scope="col" className="num">MAE</th><th scope="col" className="num">sMAPE</th></tr></thead>
                    <tbody>
                      {data.model_comparison.map((m) => (
                        <tr key={m.model} className={m.selected ? 'winner' : ''}>
                          <th scope="row">{m.model}{m.selected && <span className="badge"> selected</span>}<br /><span className="note">{MODEL_TEXT[m.model] ?? ''}</span></th>
                          <td><div className="meter" aria-hidden="true"><span style={{ width: `${(m.cv_mae / maxMae) * 100}%` }} /></div></td>
                          <td className="num">{m.cv_mae.toFixed(3)}</td>
                          <td className="num">{m.cv_smape.toFixed(1)}%</td>
                        </tr>
                      ))}
                      {!data.model_comparison.length && <tr><td colSpan={4} className="note">Not enough history to cross-validate ({data.n_quarters ?? 0} quarters).</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="chart-title">How close the source forecast is to actuals</h3>
                <p className="note">
                  Each bar counts rows by the gap between the source file's forecast and actual spend.
                  {data.gap_median !== null && <> Median gap {data.gap_median.toFixed(1)}%, largest {data.max_gap?.toFixed(1)}%.</>}
                </p>
                <div role="img" aria-label={`Rows by gap between source forecast and actual: ${gaps.map((g) => `${g.label} ${g.rows}`).join(', ')}`}>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={gaps} margin={{ top: 18, right: 8, bottom: 8, left: 0 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: C.ink, fontSize: 12 }} interval={0} />
                      <YAxis width={44} tick={{ fill: C.ink }} allowDecimals={false} />
                      <Bar dataKey="rows" fill={C.navy} isAnimationActive={false}><LabelList dataKey="rows" position="top" fill={C.ink} /></Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {data && (
        <section className="panel" aria-label="How to read the benchmark">
          <div className="panel-head"><h2>How to read this</h2></div>
          <dl className="glossary">
            <dt>Spend-to-budget ratio</dt>
            <dd>Actual spend divided by budget for a period. 1.00 is on budget, above 1.00 is over, below is under. The models forecast this ratio, then it is converted to dollars.</dd>
            <dt>MAE and sMAPE</dt>
            <dd>Average size of the miss. MAE is in ratio points (0.05 is five points of budget). sMAPE is the same miss as a percentage, so it is easier to compare across entities.</dd>
            <dt>Cross-validation</dt>
            <dd>Hide the most recent quarter, forecast it, compare, then repeat one quarter later. It measures how the model does on data it has not seen{mae !== null ? `, which is where the ${mae.toFixed(3)} above comes from` : ''}.</dd>
            <dt>Why the source forecast is kept out</dt>
            <dd>Its gap to actuals is small enough that it may have been adjusted after the fact. Using it as an input could teach our models a shortcut that will not exist for FY2027, so it is shown here for comparison only.</dd>
          </dl>
          <h3 className="chart-title">Data checks</h3>
          {data.inconsistency_warnings.length === 0
            ? <p className="note">No records have a zero dollar variance with a non-zero percentage variance.</p>
            : <><p className="note">{data.inconsistency_warnings.length} records have a zero dollar variance with a non-zero percentage. They are carried as-is.</p>
              {data.inconsistency_warnings.map((w) => <p key={w} className="dq-callout" role="note">{w}</p>)}</>}
        </section>
      )}
    </div>
  )
}

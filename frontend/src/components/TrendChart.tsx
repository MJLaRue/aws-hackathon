import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface QuarterPoint {
  period_index: number
  fiscal_year: string
  fiscal_quarter: string
  actual: number
  budget: number
  variance_pct_agg: number
  stl_trend?: number
  stl_seasonal?: number
}

interface Props {
  entityName: string
  series: QuarterPoint[]
  stlAvailable: boolean
  minQuarters?: number
}

/** Ordinary least squares y = a + b x over x = 0..n-1. */
export function olsLine(ys: number[]): number[] {
  const n = ys.length
  if (n < 2) return ys.slice()
  const mx = (n - 1) / 2
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  ys.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2 })
  const b = den === 0 ? 0 : num / den
  return ys.map((_, x) => my + b * (x - mx))
}

const label = (p: QuarterPoint) => `${p.fiscal_year} ${p.fiscal_quarter}`
const fmt = (v: number) => `${v.toFixed(1)}%`

export default function TrendChart({ entityName, series, stlAvailable, minQuarters = 8 }: Props) {
  const n = series.length
  const trend = olsLine(series.map((p) => p.variance_pct_agg))
  const data = series.map((p, i) => ({
    label: label(p),
    variance: Number(p.variance_pct_agg.toFixed(2)),
    ols: stlAvailable ? undefined : Number(trend[i].toFixed(2)),
    stlTrend: stlAvailable && p.stl_trend !== undefined ? Number(p.stl_trend.toFixed(2)) : undefined,
    stlSeasonal: stlAvailable && p.stl_seasonal !== undefined ? Number(p.stl_seasonal.toFixed(2)) : undefined,
  }))
  const title = `Quarterly spend vs budget variance for ${entityName}`
  const desc = n
    ? `Line chart of ${n} quarters from ${label(series[0])} to ${label(series[n - 1])}, showing variance as a percent of budget` +
      (stlAvailable ? ', with STL trend and seasonal components.' : ', with a linear trend line.')
    : 'No quarterly data available.'
  const id = entityName.replace(/\W+/g, '-')

  return (
    <figure className="trend-chart">
      <div role="img" aria-label={title} aria-labelledby={`t-${id}`} aria-describedby={`d-${id}`}>
        <svg width="0" height="0" aria-hidden="true" focusable="false">
          <title id={`t-${id}`}>{title}</title>
          <desc id={`d-${id}`}>{desc}</desc>
        </svg>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="2 4" />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={fmt} />
            <Tooltip formatter={(v: number) => fmt(v)} />
            <Legend />
            <Line dataKey="variance" name="Variance % of budget" stroke="#1d4ed8" strokeWidth={2} dot isAnimationActive={false} />
            {!stlAvailable && (
              <Line dataKey="ols" name="Linear trend (OLS)" stroke="#b91c1c" strokeDasharray="8 4" dot={false} isAnimationActive={false} />
            )}
            {stlAvailable && (
              <Line dataKey="stlTrend" name="STL trend" stroke="#047857" strokeDasharray="2 3" dot={false} isAnimationActive={false} />
            )}
            {stlAvailable && (
              <Line dataKey="stlSeasonal" name="STL seasonal" stroke="#7c2d12" strokeDasharray="10 3 2 3" dot={false} isAnimationActive={false} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {!stlAvailable && (
        <figcaption className="callout" role="note">
          STL decomposition unavailable: {entityName} has only {n} quarters of data (minimum {minQuarters} required).
        </figcaption>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th scope="col">Quarter</th><th scope="col">Actual</th><th scope="col">Budget</th><th scope="col">Variance %</th></tr></thead>
        <tbody>
          {series.map((p) => (
            <tr key={p.period_index}>
              <th scope="row">{label(p)}</th>
              <td>{Math.round(p.actual)}</td><td>{Math.round(p.budget)}</td><td>{fmt(p.variance_pct_agg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { C } from '../theme'
import { periodLabel, usd, usdShort, type Grain, type TimePoint } from '../types'

interface Props {
  entityName: string
  series: TimePoint[]
  stlAvailable: boolean
  stlNote: string | null
  grain: Grain
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

const fmt = (v: number) => `${v.toFixed(1)}%`

export default function TrendChart({ entityName, series, stlAvailable, stlNote, grain }: Props) {
  const n = series.length
  const unit = grain === 'month' ? 'months' : 'quarters'
  const trend = olsLine(series.map((p) => p.variance_pct_agg))
  const data = series.map((p, i) => ({
    label: periodLabel(p),
    actual: Math.round(p.actual),
    budget: Math.round(p.budget),
    overUnder: Math.round(p.actual - p.budget),
    variance: Number(p.variance_pct_agg.toFixed(2)),
    ols: stlAvailable ? undefined : Number(trend[i].toFixed(2)),
    stlTrend: stlAvailable && p.stl_trend !== undefined ? Number(p.stl_trend.toFixed(2)) : undefined,
    stlSeasonal: stlAvailable && p.stl_seasonal !== undefined ? Number(p.stl_seasonal.toFixed(2)) : undefined,
  }))
  const title = `${grain === 'month' ? 'Monthly' : 'Quarterly'} spend vs budget for ${entityName}`
  const desc = n
    ? `Charts of ${n} ${unit} from ${periodLabel(series[0])} to ${periodLabel(series[n - 1])}: spend against budget in dollars, ` +
      `and variance as a percent of budget${stlAvailable ? ', with STL trend and seasonal components.' : ', with a linear trend line.'}`
    : 'No data available.'
  const id = `${grain}-${entityName.replace(/\W+/g, '-')}`
  const tickGap = grain === 'month' ? 24 : 8

  return (
    <figure className="trend-chart">
      <div role="img" aria-labelledby={`t-${id}`} aria-describedby={`d-${id}`}>
        <svg width="0" height="0" aria-hidden="true" focusable="false">
          <title id={`t-${id}`}>{title}</title>
          <desc id={`d-${id}`}>{desc}</desc>
        </svg>
        <h3 className="chart-title">Spend and budget</h3>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" minTickGap={tickGap} tick={{ fill: C.ink }} />
            <YAxis tickFormatter={usdShort} width={64} tick={{ fill: C.ink }} />
            <Tooltip formatter={(v: number) => usd(v)} />
            <Legend />
            <Bar dataKey="budget" name="Budget" fill={C.slate} stroke={C.slateEdge} isAnimationActive={false} />
            <Line dataKey="actual" name="Actual spend" stroke={C.navy} strokeWidth={2.5} dot={grain === 'quarter'} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <h3 className="chart-title">Variance as a percent of budget</h3>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" minTickGap={tickGap} tick={{ fill: C.ink }} />
            <YAxis tickFormatter={fmt} width={56} tick={{ fill: C.ink }} />
            <Tooltip formatter={(v: number) => fmt(v)} />
            <Legend />
            <Line dataKey="variance" name="Variance % of budget" stroke={C.navy} strokeWidth={2.5} dot={grain === 'quarter'} isAnimationActive={false} />
            {!stlAvailable && <Line dataKey="ols" name="Linear trend (OLS)" stroke={C.brick} strokeDasharray="8 4" dot={false} isAnimationActive={false} />}
            {stlAvailable && <Line dataKey="stlTrend" name="STL trend" stroke={C.red} strokeWidth={2} dot={false} isAnimationActive={false} />}
            {stlAvailable && <Line dataKey="stlSeasonal" name="STL seasonal" stroke={C.steel} strokeDasharray="2 4" strokeWidth={2} dot={false} isAnimationActive={false} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {!stlAvailable && (
        <figcaption className="callout" role="note">
          {stlNote ?? `STL decomposition unavailable: ${entityName} has only ${n} ${unit} of data.`}
        </figcaption>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th scope="col">{grain === 'month' ? 'Month' : 'Quarter'}</th><th scope="col">Actual</th><th scope="col">Budget</th><th scope="col">Variance %</th></tr></thead>
        <tbody>
          {series.map((p) => (
            <tr key={p.period_index}>
              <th scope="row">{periodLabel(p)}</th>
              <td>{Math.round(p.actual)}</td><td>{Math.round(p.budget)}</td><td>{fmt(p.variance_pct_agg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

import { Line, LineChart, ResponsiveContainer } from 'recharts'
import { C } from '../theme'

/** Decorative trend line for a tile; the tile's text carries the figure, so this is hidden from assistive tech. */
export default function Sparkline({ values, color = C.navy }: { values: number[]; color?: string }) {
  if (values.length < 2) return null
  const data = values.map((v, i) => ({ i, v }))
  return (
    <div className="spark" aria-hidden="true">
      <ResponsiveContainer width="100%" height={36}>
        <LineChart data={data} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
          <Line dataKey="v" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

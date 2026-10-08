import type { Entities } from '../types'

/** Value is "department:Name" | "category:Name" | "fund_source:Name" | "" (everything). */
export function parseEntity(sel: string): { level: string; name?: string } {
  if (!sel) return { level: 'total' }
  const [level, name] = sel.split(/:(.*)/s) as [string, string]
  return { level, name }
}

export default function EntitySelect({ entities, value, onChange, id }: { entities: Entities | null; value: string; onChange: (v: string) => void; id: string }) {
  const e = entities?.entities
  return (
    <label htmlFor={id} className="field">Entity
      <select id={id} value={value} onChange={(ev) => onChange(ev.target.value)}>
        <option value="">All spending</option>
        {e && (
          <>
            <optgroup label="Departments">{e.departments.map((d) => <option key={d} value={`department:${d}`}>{d}</option>)}</optgroup>
            <optgroup label="Categories">{e.categories.map((c) => <option key={c} value={`category:${c}`}>{c}</option>)}</optgroup>
            <optgroup label="Fund sources">{e.fund_sources.map((f) => <option key={f} value={`fund_source:${f}`}>{f}</option>)}</optgroup>
          </>
        )}
      </select>
    </label>
  )
}

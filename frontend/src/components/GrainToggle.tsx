import type { Grain } from '../types'

export default function GrainToggle({ value, onChange, monthlyAvailable = true, label = 'View by' }: { value: Grain; onChange: (g: Grain) => void; monthlyAvailable?: boolean; label?: string }) {
  const opts: { id: Grain; text: string }[] = [{ id: 'month', text: 'Month' }, { id: 'quarter', text: 'Quarter' }]
  return (
    <fieldset className="segmented">
      <legend>{label}</legend>
      {opts.map((o) => (
        <label key={o.id} className={value === o.id ? 'on' : ''}>
          <input type="radio" name={`grain-${label}`} value={o.id} checked={value === o.id}
            disabled={o.id === 'month' && !monthlyAvailable} onChange={() => onChange(o.id)} />
          {o.text}
        </label>
      ))}
    </fieldset>
  )
}

import { useRef, useState, type KeyboardEvent } from 'react'
import { useApi } from '../hooks/useApi'
import AnomalyTable from './AnomalyTable'
import BenchmarkPanel from './BenchmarkPanel'
import Chat from './Chat'
import KpiPanel from './KpiPanel'
import TrendChart, { type QuarterPoint } from './TrendChart'

interface VarianceView { quarterly_time_series: QuarterPoint[]; stl_available: boolean; entity_not_found?: boolean }
interface Entities { entities: { departments: string[]; categories: string[] } }

function Trend({ datasetId }: { datasetId: string }) {
  const [sel, setSel] = useState('') // "department:Name" | "category:Name" | ''
  const ents = useApi<Entities>('/entities', { dataset_id: datasetId })
  const [level, name] = sel ? (sel.split(/:(.*)/s) as [string, string]) : ['total', undefined]
  const v = useApi<VarianceView>('/variance', { dataset_id: datasetId, entity_level: level, entity_name: name })
  return (
    <section aria-label="Trend" className="card">
      <div className="panel-head">
        <h2>Quarterly trend</h2>
        <label>Entity{' '}
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">All spending</option>
            {ents.data && (
              <>
                <optgroup label="Departments">
                  {ents.data.entities.departments.map((d) => <option key={d} value={`department:${d}`}>{d}</option>)}
                </optgroup>
                <optgroup label="Categories">
                  {ents.data.entities.categories.map((c) => <option key={c} value={`category:${c}`}>{c}</option>)}
                </optgroup>
              </>
            )}
          </select>
        </label>
      </div>
      {v.error && <div className="error-note" role="alert">{v.error}</div>}
      {v.data && !v.data.entity_not_found && (
        <TrendChart entityName={name ?? 'All spending'} series={v.data.quarterly_time_series} stlAvailable={v.data.stl_available} />
      )}
    </section>
  )
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'trends', label: 'Trends' },
  { id: 'anomalies', label: 'Anomalies' },
  { id: 'benchmark', label: 'Benchmark' },
] as const
type TabId = (typeof TABS)[number]['id']

export default function Dashboard({ datasetId, sessionId, replayMode }: { datasetId: string; sessionId: string; replayMode: boolean }) {
  const [tab, setTab] = useState<TabId>('overview')
  const [chatOpen, setChatOpen] = useState(true)
  const btns = useRef<Record<string, HTMLButtonElement | null>>({})

  const onKey = (e: KeyboardEvent, i: number) => {
    const move = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + move + TABS.length) % TABS.length
    if (!move && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    setTab(TABS[next].id); btns.current[TABS[next].id]?.focus()
  }

  return (
    <div className={`dashboard ${chatOpen ? '' : 'chat-closed'}`}>
      <button type="button" className="skip-link" onClick={() => { setTab('anomalies'); setTimeout(() => document.getElementById('anomaly-table')?.focus(), 50) }}>
        Skip to anomaly table
      </button>
      <div className="dash-main">
        <div className="tabbar">
          <div role="tablist" aria-label="Dashboard sections">
            {TABS.map((t, i) => (
              <button key={t.id} id={`tab-${t.id}`} role="tab" type="button" aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1} ref={(el) => { btns.current[t.id] = el }}
                onClick={() => setTab(t.id)} onKeyDown={(e) => onKey(e, i)}>
                {t.label}
              </button>
            ))}
          </div>
          <button type="button" className="ghost" aria-expanded={chatOpen} onClick={() => setChatOpen(!chatOpen)}>
            {chatOpen ? 'Hide chat' : 'Show chat'}
          </button>
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="tabpanel">
          {tab === 'overview' && <KpiPanel datasetId={datasetId} />}
          {tab === 'trends' && <Trend datasetId={datasetId} />}
          {tab === 'anomalies' && <AnomalyTable datasetId={datasetId} />}
          {tab === 'benchmark' && <BenchmarkPanel datasetId={datasetId} />}
        </div>
      </div>
      {chatOpen && <aside className="dash-chat"><Chat sessionId={sessionId} datasetId={datasetId} replayMode={replayMode} /></aside>}
    </div>
  )
}

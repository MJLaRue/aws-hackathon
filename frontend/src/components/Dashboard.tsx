import { useRef, useState, type KeyboardEvent } from 'react'
import type { Grain } from '../types'
import AnomalyTable from './AnomalyTable'
import BenchmarkPanel from './BenchmarkPanel'
import Chat from './Chat'
import KpiPanel from './KpiPanel'
import Forecast from './Forecast'
import Trends from './Trends'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'trends', label: 'Trends' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'anomalies', label: 'Anomalies' },
  { id: 'benchmark', label: 'Benchmark' },
] as const
type TabId = (typeof TABS)[number]['id']

export default function Dashboard({ datasetId, sessionId, replayMode }: { datasetId: string; sessionId: string; replayMode: boolean }) {
  const [tab, setTab] = useState<TabId>('overview')
  const [chatOpen, setChatOpen] = useState(true)
  const [grain, setGrain] = useState<Grain>('month')
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
          {tab === 'overview' && <KpiPanel datasetId={datasetId} onOpenForecast={() => setTab('forecast')} />}
          {tab === 'trends' && <Trends datasetId={datasetId} grain={grain} onGrain={setGrain} />}
          {tab === 'forecast' && <Forecast datasetId={datasetId} grain={grain} onGrain={setGrain} />}
          {tab === 'anomalies' && <AnomalyTable datasetId={datasetId} />}
          {tab === 'benchmark' && <BenchmarkPanel datasetId={datasetId} />}
        </div>
      </div>
      {chatOpen && <aside className="dash-chat"><Chat sessionId={sessionId} datasetId={datasetId} replayMode={replayMode} /></aside>}
    </div>
  )
}

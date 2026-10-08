import { useCallback, useEffect, useMemo, useState } from 'react'
import logo from './assets/uic-logo-white.png'
import Dashboard from './components/Dashboard'
import Upload from './components/Upload'
import { API_BASE, type UploadResult } from './types'

interface DatasetInfo { dataset_id: string; name: string; row_count: number }

const path = () => (window.location.pathname === '/upload' ? '/upload' : '/dashboard')

export default function App() {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [route, setRoute] = useState(path())
  const [loadedList, setLoadedList] = useState(false)
  const sessionId = useMemo(() => crypto.randomUUID(), [])
  const replayMode = new URLSearchParams(window.location.search).get('replay') === '1'

  const go = useCallback((to: '/upload' | '/dashboard') => {
    window.history.pushState({}, '', to + window.location.search); setRoute(to)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/datasets`)
      const list: DatasetInfo[] = res.ok ? await res.json() : []
      setDatasets(list)
      setActive((a) => a ?? list[0]?.dataset_id ?? null)
    } finally { setLoadedList(true) }
  }, [])

  useEffect(() => {
    void refresh()
    const onPop = () => setRoute(path())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [refresh])

  const onLoaded = (r: UploadResult) => { setActive(r.dataset_id); void refresh() }
  const showUpload = route === '/upload' || (loadedList && !active)

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <a href="https://www.uic.edu" className="brand-logo"><img src={logo} alt="University of Illinois Chicago" width="218" height="79" /></a>
          <h1>Budget Forecasting Analyst</h1>
        </div>
        <label className="field on-navy">Dataset{' '}
          <select value={active ?? ''} onChange={(e) => setActive(e.target.value || null)} disabled={!datasets.length}>
            {!datasets.length && <option value="">No datasets</option>}
            {datasets.map((d) => <option key={d.dataset_id} value={d.dataset_id}>{d.name} ({d.row_count} rows)</option>)}
          </select>
        </label>
        <nav>
          <button type="button" className="on-dark" onClick={() => go('/upload')} disabled={showUpload}>Upload data</button>
          <button type="button" className="on-dark" onClick={() => go('/dashboard')} disabled={!active || !showUpload}>Dashboard</button>
        </nav>
      </header>
      <main>
        {showUpload
          ? <Upload hasDataset={!!active} onLoaded={(r) => { onLoaded(r); go('/dashboard') }} />
          : active && <Dashboard key={active} datasetId={active} sessionId={sessionId} replayMode={replayMode} />}
      </main>
      <footer className="site-footer">
        <div className="footer-inner">
          <address>1200 West Harrison St. · Chicago, Illinois 60607 · (312) 996-7000</address>
          <p>
            &copy; {new Date().getFullYear()} The Board of Trustees of the University of Illinois
            {' | '}<a href="https://www.vpaa.uillinois.edu/resources/web_privacy">Privacy Statement</a>
          </p>
          <p className="footer-system">
            <a href="http://www.uillinois.edu/">University of Illinois System</a>
            {' | '}<a href="http://www.illinois.edu/">Urbana-Champaign</a>
            {' | '}<a href="http://www.uis.edu/">Springfield</a>
          </p>
        </div>
      </footer>
    </div>
  )
}

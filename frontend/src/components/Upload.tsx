import { useState, type DragEvent } from 'react'
import { API_BASE, CANONICAL_FIELDS, OPTIONAL_FEATURES, type UploadProposal, type UploadResult } from '../types'

interface Props {
  hasDataset: boolean
  onLoaded: (r: UploadResult) => void
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const j = await res.json()
    return typeof j.detail === 'string' ? j.detail : `Request failed (${res.status}).`
  } catch {
    return `Request failed (${res.status}).`
  }
}

export default function Upload({ hasDataset, onLoaded }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [proposal, setProposal] = useState<UploadProposal | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [result, setResult] = useState<UploadResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = (f: File | undefined) => {
    if (!f) return
    setFile(f)
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''))
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); pick(e.dataTransfer.files[0]) }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const upload = () => run(async () => {
    if (!file || !name.trim()) throw new Error('Choose a file and enter a dataset name.')
    const fd = new FormData()
    fd.append('file', file); fd.append('dataset_name', name.trim())
    const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: fd })
    if (!res.ok) throw new Error(await errorDetail(res))
    const p: UploadProposal = await res.json()
    setProposal(p)
    const init: Record<string, string> = {}
    for (const [src, field] of Object.entries(p.suggestions)) if (field) init[src] = field
    setMapping(init)
  })

  const confirm = () => run(async () => {
    if (!proposal) return
    const res = await fetch(`${API_BASE}/upload/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload_id: proposal.upload_id, dataset_name: proposal.dataset_name, mapping }),
    })
    if (!res.ok) throw new Error(await errorDetail(res))
    const r: UploadResult = await res.json()
    setResult(r); setProposal(null); onLoaded(r)
  })

  const sample = () => run(async () => {
    const res = await fetch(`${API_BASE}/upload/sample?variant=enhanced`, { method: 'POST' })
    if (!res.ok) throw new Error(await errorDetail(res))
    const r: UploadResult = await res.json()
    setResult(r); onLoaded(r)
  })

  const mapped = new Set(Object.values(mapping))
  const missingRequired = proposal ? proposal.required_fields.filter((f) => !mapped.has(f)) : []
  const unavailable = Object.entries(OPTIONAL_FEATURES).filter(([f]) => proposal && !mapped.has(f))
  const duplicates = Object.values(mapping).filter((v, i, a) => a.indexOf(v) !== i)

  return (
    <section className="upload" aria-label="Load data">
      {!hasDataset && !proposal && (
        <p>No dataset loaded. <button type="button" onClick={sample} disabled={busy}>Load sample data</button></p>
      )}
      {!proposal && (
        <div className="dropzone" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          <label>Upload CSV or XLSX{' '}
            <input type="file" accept=".csv,.xlsx" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          <label>Dataset name{' '}
            <input type="text" value={name} maxLength={128} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="button" onClick={upload} disabled={busy || !file}>Upload</button>
        </div>
      )}

      {proposal && (
        <div>
          <h2>Confirm column mapping</h2>
          <table>
            <thead><tr><th scope="col">Source column</th><th scope="col">Maps to</th></tr></thead>
            <tbody>
              {proposal.source_columns.map((c) => (
                <tr key={c}>
                  <th scope="row">{c}</th>
                  <td>
                    <select aria-label={`Field for ${c}`} value={mapping[c] ?? ''}
                      onChange={(e) => setMapping((m) => {
                        const n = { ...m }
                        if (e.target.value) n[c] = e.target.value; else delete n[c]
                        return n
                      })}>
                      <option value="">(ignore)</option>
                      {CANONICAL_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {missingRequired.length > 0 && (
            <div className="callout" role="alert">Required fields not mapped: {missingRequired.join(', ')}</div>
          )}
          {duplicates.length > 0 && (
            <div className="callout" role="alert">Mapped more than once: {[...new Set(duplicates)].join(', ')}</div>
          )}
          {unavailable.length > 0 && (
            <div className="callout" role="status">
              Some views will be unavailable without optional fields:
              <ul>{unavailable.map(([f, d]) => <li key={f}>{d} (needs {f})</li>)}</ul>
            </div>
          )}
          <button type="button" onClick={confirm} disabled={busy || missingRequired.length > 0 || duplicates.length > 0}>
            Confirm and load
          </button>{' '}
          <button type="button" onClick={() => setProposal(null)} disabled={busy}>Cancel</button>
        </div>
      )}

      {result && <Report result={result} />}
      {error && <div className="error-note" role="alert">{error}</div>}
    </section>
  )
}

function Report({ result }: { result: UploadResult }) {
  const r = result.report
  return (
    <div className="report">
      <h2>{result.dataset_name} loaded</h2>
      <p>
        {r.rows_accepted} of {r.total_rows} rows accepted ({r.rows_rejected} rejected, {r.rows_unmapped_period} with unmapped period).
        Fiscal periods: {r.fiscal_period_range}. {r.department_count} departments, {r.category_count} categories, {r.fund_source_count} fund sources.
        {r.rows_excluded_from_totals > 0 && ` ${r.rows_excluded_from_totals} rows excluded from totals.`}
        {r.rows_synthetic > 0 && ` ${r.rows_synthetic} synthetic rows.`}
      </p>
      {r.dq_findings.map((f) => (
        <div key={f.code} className="callout" role="note">
          {f.message}
          {f.record_ids.length > 0 && <div className="record-ids">e.g. {f.record_ids.slice(0, 5).join(', ')}</div>}
        </div>
      ))}
    </div>
  )
}

import { useApi } from '../hooks/useApi'
import type { BenchmarkResponse } from '../types'

export default function BenchmarkPanel({ datasetId }: { datasetId: string }) {
  const { data, error } = useApi<BenchmarkResponse>('/benchmark', { dataset_id: datasetId })
  return (
    <section className="benchmark card" aria-label="Forecast benchmark">
      <h2>Benchmark</h2>
      {error && <div className="error-note" role="alert">{error}</div>}
      {data && (
        <>
          <dl>
            <dt>Application model ({data.model_name ?? 'n/a'}), cross-validated</dt>
            <dd>
              MAE {data.cv_mae !== null ? data.cv_mae.toFixed(3) : 'n/a'}, sMAPE {data.cv_smape !== null ? `${data.cv_smape.toFixed(1)}%` : 'n/a'}
              {' '}on the {data.forecast_target.replace(/_/g, ' ')}
            </dd>
            <dt>Source forecast ({data.source_rows_compared} rows)</dt>
            <dd>
              {data.mean_gap !== null && data.max_gap !== null
                ? `Mean absolute gap ${data.mean_gap.toFixed(1)}%, max ${data.max_gap.toFixed(2)}%`
                : 'No source forecast values available'}
            </dd>
          </dl>
          {data.caveat && <p className="callout" role="note">{data.caveat}</p>}
          {data.inconsistency_warnings.map((w) => <p key={w} className="dq-callout" role="note">{w}</p>)}
        </>
      )}
    </section>
  )
}

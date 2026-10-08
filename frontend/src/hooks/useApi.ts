import { useEffect, useState } from 'react'
import { getJSON } from '../types'

export function useApi<T>(path: string, params: Record<string, string | undefined>, enabled = true) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const key = path + JSON.stringify(params)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    setLoading(true); setError(null)
    getJSON<T>(path, params)
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  return { data, error, loading }
}

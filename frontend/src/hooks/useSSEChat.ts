import { useCallback, useRef, useState } from 'react'
import { API_BASE, type ChatRequest, type SourceCall, type SSEEvent } from '../types'

/** Parse one SSE block ("data: ...") into an event. Returns null for [DONE], comments and junk. */
export function parseSSEBlock(block: string): SSEEvent | null {
  const line = block.split('\n').find((l) => l.startsWith('data:'))
  if (!line) return null
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    const ev = JSON.parse(payload) as SSEEvent
    return ev && typeof ev.type === 'string' ? ev : null
  } catch {
    return null
  }
}

/** Fetch + ReadableStream consumer (§8.2). Blocks are separated by a blank line. */
export async function* streamChat(
  request: ChatRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<SSEEvent> {
  const res = await fetchImpl(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })
  if (!res.ok || !res.body) {
    yield { type: 'error', message: `Chat request failed (${res.status}).` }
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const ev = parseSSEBlock(block)
      if (ev) yield ev
    }
  }
  const tail = parseSSEBlock(buffer)
  if (tail) yield tail
}

export interface ChatTurn {
  id: number
  question: string
  text: string
  toolCalls: { tool: string; input: Record<string, unknown>; summary?: string }[]
  sources: SourceCall[]
  groundingFailed: boolean
  failedValues: string[]
  groundingMessage: string | null
  warnings: string[]
  error: string | null
  done: boolean
}

export interface UseSSEChat {
  turns: ChatTurn[]
  isStreaming: boolean
  send: (message: string) => Promise<void>
  cancel: () => void
}

/** Pure reducer so the event handling is unit-testable without React. */
export function applyEvent(turn: ChatTurn, ev: SSEEvent): ChatTurn {
  switch (ev.type) {
    case 'token':
      return { ...turn, text: turn.text + ev.text }
    case 'tool_call':
      return { ...turn, toolCalls: [...turn.toolCalls, { tool: ev.tool, input: ev.input }] }
    case 'tool_result': {
      const calls = [...turn.toolCalls]
      for (let i = calls.length - 1; i >= 0; i--) {
        if (calls[i].tool === ev.tool && calls[i].summary === undefined) {
          calls[i] = { ...calls[i], summary: ev.summary }
          break
        }
      }
      return { ...turn, toolCalls: calls }
    }
    case 'grounding_ok':
      return { ...turn, groundingFailed: false }
    case 'grounding_flag':
      return { ...turn, groundingFailed: true, failedValues: ev.failed_values, groundingMessage: ev.message }
    case 'warning':
      return { ...turn, warnings: [...turn.warnings, ev.message] }
    case 'sources':
      return { ...turn, sources: ev.calls }
    case 'error':
      return { ...turn, error: ev.message }
  }
}

export function newTurn(id: number, question: string): ChatTurn {
  return {
    id, question, text: '', toolCalls: [], sources: [], groundingFailed: false, failedValues: [],
    groundingMessage: null, warnings: [], error: null, done: false,
  }
}

export function useSSEChat(sessionId: string, datasetId: string | null, replayMode = false): UseSSEChat {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [isStreaming, setStreaming] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const counter = useRef(0)

  const send = useCallback(async (message: string) => {
    if (!datasetId || !message.trim()) return
    const id = ++counter.current
    setTurns((t) => [...t, newTurn(id, message)])
    setStreaming(true)
    abort.current = new AbortController()
    const update = (fn: (t: ChatTurn) => ChatTurn) =>
      setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t)))
    try {
      for await (const ev of streamChat(
        { session_id: sessionId, dataset_id: datasetId, message, replay_mode: replayMode },
        abort.current.signal,
      )) {
        update((t) => applyEvent(t, ev))
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') update((t) => ({ ...t, error: 'Connection lost. Please try again.' }))
    } finally {
      update((t) => ({ ...t, done: true }))
      setStreaming(false)
    }
  }, [sessionId, datasetId, replayMode])

  const cancel = useCallback(() => abort.current?.abort(), [])
  return { turns, isStreaming, send, cancel }
}

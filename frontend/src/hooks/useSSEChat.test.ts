import { describe, expect, it } from 'vitest'
import { applyEvent, newTurn, streamChat } from './useSSEChat'
import type { SSEEvent } from '../types'

function fakeFetch(chunks: string[]): typeof fetch {
  const enc = new TextEncoder()
  return (async () =>
    new Response(
      new ReadableStream({
        start(c) {
          chunks.forEach((x) => c.enqueue(enc.encode(x)))
          c.close()
        },
      }),
      { status: 200 },
    )) as unknown as typeof fetch
}

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`

describe('streamChat', () => {
  it('yields typed events in order, skips [DONE], handles split chunks', async () => {
    const body =
      frame({ type: 'token', text: 'Hel' }) + frame({ type: 'token', text: 'lo' }) +
      frame({ type: 'tool_call', tool: 'list_entities', input: {} }) +
      frame({ type: 'grounding_ok' }) + 'data: [DONE]\n\n'
    const cut = 17 // split mid-frame
    const out: SSEEvent[] = []
    for await (const ev of streamChat({ session_id: 's', dataset_id: 'd', message: 'q' }, undefined,
      fakeFetch([body.slice(0, cut), body.slice(cut)]))) out.push(ev)
    expect(out.map((e) => e.type)).toEqual(['token', 'token', 'tool_call', 'grounding_ok'])
  })

  it('reports HTTP failure as an error event', async () => {
    const f = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch
    const out: SSEEvent[] = []
    for await (const ev of streamChat({ session_id: 's', dataset_id: 'd', message: 'q' }, undefined, f)) out.push(ev)
    expect(out[0].type).toBe('error')
  })
})

describe('applyEvent', () => {
  it('accumulates text, pairs tool results, records grounding flag', () => {
    let t = newTurn(1, 'q')
    const evs: SSEEvent[] = [
      { type: 'token', text: 'A' }, { type: 'token', text: 'B' },
      { type: 'tool_call', tool: 'x', input: {} }, { type: 'tool_result', tool: 'x', summary: 'ok' },
      { type: 'grounding_flag', failed_values: ['$204,000'], message: 'm' },
    ]
    evs.forEach((e) => { t = applyEvent(t, e) })
    expect(t.text).toBe('AB')
    expect(t.toolCalls[0].summary).toBe('ok')
    expect(t.groundingFailed).toBe(true)
    expect(t.failedValues).toEqual(['$204,000'])
  })
})

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useSSEChat, type ChatTurn } from '../hooks/useSSEChat'

interface Props {
  sessionId: string
  datasetId: string | null
  replayMode?: boolean
}

function Sources({ turn }: { turn: ChatTurn }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  if (!turn.sources.length) return null
  return (
    <div className="sources">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'Show'} sources ({turn.sources.length})
      </button>
      {open && (
        <ul id={panelId}>
          {turn.sources.map((c, i) => (
            <li key={i} tabIndex={0}>
              <strong>{c.tool}</strong>: {c.result_summary}
              {c.record_ids.length > 0 && (
                <div className="record-ids">Records: {c.record_ids.join(', ')}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Turn({ turn }: { turn: ChatTurn }) {
  return (
    <div className="turn">
      <div className="bubble user">{turn.question}</div>
      {turn.groundingFailed && (
        <div className="grounding-banner" role="alert">
          <strong>Unverified numbers.</strong> {turn.groundingMessage}
          <ul>{turn.failedValues.map((v) => <li key={v}>{v}</li>)}</ul>
        </div>
      )}
      <div className="bubble assistant" aria-live="polite" aria-busy={!turn.done}>
        {turn.text
          ? <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{turn.text}</ReactMarkdown></div>
          : (!turn.done && 'Thinking…')}
        {turn.toolCalls.length > 0 && !turn.done && (
          <div className="tool-status">Running {turn.toolCalls[turn.toolCalls.length - 1].tool}…</div>
        )}
      </div>
      {turn.warnings.map((w, i) => <div key={i} className="note" role="status">{w}</div>)}
      {turn.error && <div className="error-note" role="alert">{turn.error}</div>}
      <Sources turn={turn} />
    </div>
  )
}

export default function Chat({ sessionId, datasetId, replayMode }: Props) {
  const { turns, isStreaming, send } = useSSEChat(sessionId, datasetId, replayMode)
  const [draft, setDraft] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => { bottom.current?.scrollIntoView?.({ block: 'end' }) }, [turns])

  const submit = () => {
    const m = draft.trim()
    if (!m || isStreaming || !datasetId) return
    setDraft('')
    void send(m)
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  return (
    <section className="chat" aria-label="Chat with the budget analyst">
      <div className="messages">
        {turns.length === 0 && <p className="hint">Ask about variances, anomalies, forecasts or reporting health.</p>}
        {turns.map((t) => <Turn key={t.id} turn={t} />)}
        <div ref={bottom} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); submit() }}>
        <label htmlFor="chat-input" className="sr-only">Message</label>
        <textarea id="chat-input" autoFocus rows={2} value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey} placeholder={datasetId ? 'Ask a question (Enter to send, Shift+Enter for newline)' : 'Load a dataset first'}
          disabled={!datasetId} />
        <button type="submit" disabled={isStreaming || !datasetId || !draft.trim()}>Send</button>
      </form>
    </section>
  )
}

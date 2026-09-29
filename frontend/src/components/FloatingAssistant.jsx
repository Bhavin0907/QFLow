import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { serviceColor } from '../lib/colors'
import { Button, formatMinutes } from './ui'

const PROMPTS = ['How long is my wait?', 'Where do I go?', 'What documents do I need?']

function buildContext(active) {
  return (active || []).map((t) => ({
    label: t.label,
    service_name: t.service_name,
    counter: t.counter,
    status: t.status,
    position: t.position,
    eta_min: t.eta_min,
    eta_clock: t.eta_clock,
    documents: t.documents || [],
  }))
}

export default function FloatingAssistant() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState([])
  const [tokenContext, setTokenContext] = useState([])

  const loadContext = useCallback(async () => {
    try {
      const mine = await api('/api/tokens/me')
      setTokenContext(buildContext(mine.active))
    } catch {
      setTokenContext([])
    }
  }, [])

  useEffect(() => {
    if (open) loadContext()
  }, [open, loadContext])

  const send = async (text) => {
    const message = text.trim()
    if (message.length < 2 || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: message }])
    setBusy(true)
    try {
      const res = await api('/api/assistant', {
        method: 'POST',
        body: { message, token_context: tokenContext.length ? tokenContext : undefined },
      })
      setMessages((m) => [...m, { role: 'bot', text: res.reply, match: res.match }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'bot', text: e.message }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 min-h-[52px] rounded-full bg-ink text-white px-5 text-sm font-bold shadow-lg active:scale-[0.98] sm:bottom-6 sm:right-6"
          aria-label="Ask QFlow"
        >
          Ask QFlow
        </button>
      )}

      {open && (
        <div
          className="fixed bottom-5 right-5 z-50 w-[min(100vw-2rem,22rem)] max-h-[min(70vh,32rem)] flex flex-col rounded-3xl border-2 border-ink bg-canvas shadow-xl sm:bottom-6 sm:right-6"
          role="dialog"
          aria-label="QFlow assistant"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="font-bold text-sm wide">Ask QFlow</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-muted text-sm font-semibold min-h-[44px] min-w-[44px]"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <p className="text-xs text-muted">
                {tokenContext.length
                  ? 'Ask about your queue, documents, or where to go.'
                  : 'Ask about a service or what you need at campus counters.'}
              </p>
            )}
            {messages.map((msg, i) => (
              <div key={i}>
                <div
                  className={`rounded-2xl px-3 py-2 text-sm ${
                    msg.role === 'user' ? 'bg-ink text-white ml-6' : 'bg-soft text-ink mr-4'
                  }`}
                >
                  {msg.text}
                </div>
                {msg.match && (
                  <div
                    className="mt-2 rounded-2xl p-3 text-xs mr-4"
                    style={{
                      backgroundColor: serviceColor({ id: msg.match.service_id }).bg,
                      color: serviceColor({ id: msg.match.service_id }).text,
                    }}
                  >
                    <p className="font-bold">{msg.match.service_name}</p>
                    <p className="opacity-80">{msg.match.counter}</p>
                    <p className="mt-1 numeral">
                      {msg.match.is_paused
                        ? 'Paused'
                        : `${msg.match.waiting} waiting · ${formatMinutes(msg.match.eta_min)}`}
                    </p>
                  </div>
                )}
              </div>
            ))}
            {busy && <p className="text-xs text-muted">Thinking…</p>}
          </div>

          <div className="border-t border-line px-3 py-2 flex flex-wrap gap-1.5">
            {PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={busy || (p.includes('wait') && !tokenContext.length)}
                onClick={() => send(p)}
                className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40"
              >
                {p}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              send(input)
            }}
            className="flex gap-2 border-t border-line p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={300}
              placeholder="Type a question…"
              className="flex-1 min-h-[44px] rounded-xl border-2 border-line px-3 text-sm outline-none focus:border-ink"
            />
            <Button type="submit" variant="primary" className="min-h-[44px] px-4 text-sm" busy={busy} disabled={input.trim().length < 2}>
              Send
            </Button>
          </form>
        </div>
      )}
    </>
  )
}

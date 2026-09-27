import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { formatMinutes } from './ui'

const SUGGESTIONS = ['I lost my ID card', 'I need a bonafide certificate', 'My college Wi-Fi login stopped working', 'How do I apply for revaluation?']

export default function Assistant({ onJoin }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState([
    { from: 'bot', text: "Tell me what you need and I'll point you to the right counter and what to bring." },
  ])
  const endRef = useRef(null)

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, open])

  const send = async (text) => {
    const message = text.trim()
    if (message.length < 2 || busy) return
    setMessages((m) => [...m, { from: 'me', text: message }])
    setInput('')
    setBusy(true)
    try {
      const res = await api('/api/assistant', { method: 'POST', body: { message } })
      setMessages((m) => [...m, { from: 'bot', text: res.reply, match: res.match, source: res.source }])
    } catch (e) {
      setMessages((m) => [...m, { from: 'bot', text: e.message }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-40 rounded-full bg-ink text-white pl-4 pr-5 py-3 font-semibold shadow-lg hover:bg-ink-soft flex items-center gap-2"
        aria-expanded={open}
      >
        <span className="grid place-items-center w-6 h-6 rounded-full bg-signal text-ink text-sm font-black">?</span>
        {open ? 'Close assistant' : 'Where do I go?'}
      </button>

      {open && (
        <section
          aria-label="Service assistant"
          className="fixed z-40 bottom-20 right-3 left-3 sm:left-auto sm:right-5 sm:w-[380px] h-[70vh] max-h-[560px] bg-white rounded-2xl shadow-2xl border border-line flex flex-col overflow-hidden"
        >
          <header className="bg-ink text-white px-4 py-3">
            <h2 className="font-bold">Service assistant</h2>
            <p className="text-xs text-white/70">Finds the right counter, documents and current wait.</p>
          </header>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-mist/60">
            {messages.map((m, i) => (
              <div key={i} className={m.from === 'me' ? 'flex justify-end' : ''}>
                <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm ${m.from === 'me' ? 'bg-ink text-white rounded-br-sm' : 'bg-white border border-line rounded-bl-sm'}`}>
                  <p>{m.text}</p>
                  {m.match && (
                    <div className="mt-3 rounded-xl bg-mist p-3">
                      <div className="font-bold">{m.match.service_name}</div>
                      <div className="text-xs text-muted">{m.match.counter}</div>
                      <ul className="mt-2 space-y-0.5 text-xs list-disc pl-4">
                        {m.match.documents.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                      <div className="mt-2 text-xs">
                        {m.match.is_paused ? 'Counter is paused right now.' : `${m.match.waiting} waiting, about ${formatMinutes(m.match.eta_min)}`}
                      </div>
                      {onJoin && (
                        <button
                          onClick={() => onJoin(m.match.service_id)}
                          className="mt-2.5 w-full rounded-lg bg-signal hover:bg-signal-deep font-bold py-2 text-sm"
                        >
                          Join this queue
                        </button>
                      )}
                    </div>
                  )}
                  {m.source && (
                    <div className="mt-1.5 text-[11px] text-muted">{m.source === 'ai' ? 'Answered by AI' : 'Answered offline by keyword match'}</div>
                  )}
                </div>
              </div>
            ))}
            {busy && <div className="text-sm text-muted">Looking that up…</div>}
            {messages.length === 1 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="text-xs rounded-full border border-line bg-white px-3 py-1.5 hover:border-ink">
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="p-3 border-t border-line flex gap-2">
            <label htmlFor="assistant-input" className="sr-only">
              Your question
            </label>
            <input
              id="assistant-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send(input)}
              maxLength={300}
              placeholder="e.g. I need my transfer certificate"
              className="flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-ink"
            />
            <button onClick={() => send(input)} disabled={busy || input.trim().length < 2} className="rounded-lg bg-ink text-white px-4 text-sm font-semibold disabled:opacity-40">
              Ask
            </button>
          </div>
        </section>
      )}
    </>
  )
}

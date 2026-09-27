import { useState } from 'react'
import { api } from '../lib/api'
import { serviceColor } from '../lib/colors'
import { Button, formatMinutes } from './ui'

const SUGGESTIONS = ['I lost my ID card', 'I need a bonafide certificate', 'My college Wi-Fi login stopped working']

export default function Assistant({ onJoin, joining }) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const send = async (text) => {
    const message = text.trim()
    if (message.length < 2 || busy) return
    setInput('')
    setBusy(true)
    setResult(null)
    try {
      const res = await api('/api/assistant', { method: 'POST', body: { message } })
      setResult(res)
    } catch (e) {
      setResult({ reply: e.message, match: null, source: null })
    } finally {
      setBusy(false)
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    send(input)
  }

  return (
    <section aria-label="Find a service">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <label htmlFor="assistant-search" className="sr-only">
          Search for a service
        </label>
        <input
          id="assistant-search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={300}
          placeholder="Type what you need, like 'lost ID card'"
          className="flex-1 min-h-[52px] rounded-2xl border-2 border-line bg-white px-4 text-base outline-none focus:border-ink"
        />
        <button
          type="submit"
          disabled={busy || input.trim().length < 2}
          className="shrink-0 rounded-2xl bg-ink text-white px-5 text-base font-bold disabled:opacity-40 min-h-[52px] min-w-[52px] active:scale-[0.98]"
        >
          Go
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => send(s)}
            disabled={busy}
            className="rounded-2xl border-2 border-line bg-white px-4 py-2.5 text-sm font-semibold hover:border-ink min-h-[48px] active:scale-[0.98]"
          >
            {s}
          </button>
        ))}
      </div>

      {busy && <p className="mt-4 text-sm text-muted">Looking that up…</p>}

      {result && !busy && (
        <div className="mt-4">
          {result.reply && !result.match && (
            <p className="text-sm text-muted rounded-2xl bg-soft p-4">{result.reply}</p>
          )}
          {result.match && (() => {
            const c = serviceColor({ id: result.match.service_id })
            return (
              <div className="rounded-3xl p-5 sm:p-6" style={{ backgroundColor: c.bg, color: c.text }}>
                <h3 className="text-xl font-extrabold wide">{result.match.service_name}</h3>
                <p className="text-sm opacity-80 mt-0.5">{result.match.counter}</p>
                {result.match.documents?.length > 0 && (
                  <ul className="mt-4 space-y-1 text-sm">
                    {result.match.documents.map((d) => (
                      <li key={d}>· {d}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-4 numeral text-3xl">
                  {result.match.is_paused
                    ? 'Paused right now'
                    : `${result.match.waiting} waiting · about ${formatMinutes(result.match.eta_min)}`}
                </p>
                {result.reply && <p className="mt-2 text-sm opacity-80">{result.reply}</p>}
                {onJoin && (
                  <Button
                    variant="lime"
                    className="w-full mt-5"
                    onClick={() => onJoin(result.match.service_id)}
                    busy={joining === result.match.service_id}
                  >
                    Get token
                  </Button>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </section>
  )
}

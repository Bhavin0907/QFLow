import { useState } from 'react'
import { Button, formatMinutes, ordinal } from './ui'

export default function Ticket({ token, onCancel, cancelling }) {
  const [checked, setChecked] = useState({})
  const called = token.status === 'called'
  const almost = token.status === 'waiting' && token.position <= 3

  return (
    <article
      className={`rounded-2xl shadow-[0_1px_0_#d5dbe5,0_12px_32px_-18px_rgba(21,34,74,0.45)] ${called ? 'bg-signal pulse-ring' : 'bg-white'}`}
      aria-live="polite"
    >
      <div className="px-6 pt-5 pb-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-lg leading-tight">{token.service_name}</h3>
            <p className={`text-sm ${called ? 'text-ink' : 'text-muted'}`}>{token.counter}</p>
          </div>
          {token.priority && <span className="text-xs font-bold bg-ink text-white rounded-full px-2.5 py-1">Priority lane</span>}
        </div>

        <div key={token.label + token.status} className="flip-in numeral text-[5.5rem] sm:text-[7rem] mt-3">
          {token.label}
        </div>

        {called ? (
          <p className="text-xl font-bold mt-2">It's your turn. Please go to {token.counter}.</p>
        ) : (
          <div className="mt-2 space-y-1">
            <p className="text-xl font-bold">
              {token.position === 1 ? "You're next" : `You're ${ordinal(token.position)} in line`}
            </p>
            <p className="text-muted">
              About {formatMinutes(token.eta_min)}, expected around {token.eta_clock}
            </p>
          </div>
        )}
      </div>

      <div className="ticket-tear mx-0" />

      <div className="px-6 py-5 space-y-4">
        {token.is_paused && (
          <div role="status" className="rounded-lg bg-ink text-white px-4 py-3 text-sm">
            <strong className="block">This counter is paused</strong>
            {token.pause_message} Your place in line is kept.
          </div>
        )}
        {almost && !token.is_paused && (
          <div role="status" className="rounded-lg bg-signal/30 border border-signal-deep/50 px-4 py-3 text-sm font-semibold">
            You're almost up. Start heading to {token.counter}.
          </div>
        )}

        <div className="flex items-center justify-between text-sm">
          <span className={called ? 'text-ink' : 'text-muted'}>Now serving</span>
          <span className="numeral text-3xl">{token.now_serving || '–'}</span>
        </div>

        {token.documents?.length > 0 && !called && (
          <fieldset>
            <legend className="text-sm font-semibold mb-2">Have these ready</legend>
            <ul className="space-y-1.5">
              {token.documents.map((doc) => (
                <li key={doc}>
                  <label className="flex items-center gap-2.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-ink"
                      checked={!!checked[doc]}
                      onChange={(e) => setChecked((c) => ({ ...c, [doc]: e.target.checked }))}
                    />
                    <span className={checked[doc] ? 'line-through text-muted' : ''}>{doc}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        {!called && (
          <Button variant="danger" className="w-full" onClick={() => onCancel(token)} busy={cancelling}>
            Leave queue
          </Button>
        )}
      </div>
    </article>
  )
}

import { useState } from 'react'
import { serviceColor } from '../lib/colors'
import { formatMinutes } from './ui'

function CounterIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M4 4h16v12H4V4zm2 2v8h12V6H6zm-2 14h16v2H4v-2z" />
    </svg>
  )
}

function LineVisual({ ahead, tone }) {
  const capped = Math.min(ahead, 12)
  const extra = ahead > 12 ? ahead - 12 : 0
  const dotColor = tone === 'lime' ? 'bg-ink/25' : 'bg-white/35'

  return (
    <div key={ahead} className="line-shift flex items-center gap-1.5 mt-6 mb-2 overflow-x-auto pb-1">
      {Array.from({ length: capped }, (_, i) => (
        <span key={i} className={`shrink-0 w-2.5 h-2.5 rounded-full ${dotColor}`} aria-hidden />
      ))}
      {extra > 0 && <span className="shrink-0 text-xs font-bold opacity-80">+{extra}</span>}
      <span className="shrink-0 flex flex-col items-center mx-1">
        <span className="w-5 h-5 rounded-full bg-white ring-2 ring-white/50" />
        <span className="text-[10px] font-bold mt-0.5 opacity-90">You</span>
      </span>
      <span className="flex-1 min-w-[24px] border-t-2 border-dashed opacity-30 mx-1" aria-hidden />
      <span className="shrink-0 flex flex-col items-center opacity-80">
        <CounterIcon className="w-7 h-7" />
        <span className="text-[10px] font-semibold mt-0.5">Counter</span>
      </span>
    </div>
  )
}

export default function Ticket({ token, onCancel, cancelling }) {
  const [checked, setChecked] = useState({})
  const called = token.status === 'called'
  const almost = token.status === 'waiting' && token.position <= 3
  const paused = token.is_paused
  const color = serviceColor({ id: token.service_id, code: token.label?.split('-')[0] })
  const ahead = token.ahead ?? Math.max(0, (token.position ?? 1) - 1)

  const blockStyle = called
    ? { backgroundColor: '#C6F432', color: '#101828' }
    : paused
      ? { backgroundColor: color.soft, color: '#101828', filter: 'saturate(0.45)' }
      : { backgroundColor: color.bg, color: color.text }

  const statusLine = called
    ? null
    : token.position === 1
      ? "You're next"
      : `${ahead} ${ahead === 1 ? 'person' : 'people'} ahead of you`

  return (
    <article className="rounded-3xl p-6 sm:p-8 w-full" style={blockStyle} aria-live="polite">
      <div className="text-sm opacity-80">
        <div className="font-semibold">{token.service_name}</div>
        <div>{token.counter}</div>
      </div>

      {called ? (
        <>
          <p className="text-3xl sm:text-4xl font-extrabold wide mt-4">It's your turn</p>
          <div key={token.label} className="flip-in numeral text-[5rem] sm:text-[7rem] mt-2">
            {token.label}
          </div>
          <p className="text-xl sm:text-2xl font-bold mt-2">Go to {token.counter}</p>
        </>
      ) : paused ? (
        <>
          <div key={token.label} className="flip-in numeral text-[5rem] sm:text-[7rem] mt-4">
            {token.label}
          </div>
          <div className="mt-5 rounded-2xl bg-white text-ink p-5">
            <p className="font-bold text-lg">Counter paused</p>
            <p className="mt-1">{token.pause_message}</p>
            <p className="text-sm text-muted mt-2">You keep your place.</p>
          </div>
        </>
      ) : (
        <>
          <div key={token.label} className="flip-in numeral text-[5rem] sm:text-[7rem] mt-4">
            {token.label}
          </div>

          <LineVisual ahead={ahead} tone={called ? 'lime' : 'service'} />

          {almost && (
            <div role="status" className="rounded-xl bg-lime text-ink px-4 py-3 text-sm font-bold mt-3">
              Almost your turn. Start walking to {token.counter}.
            </div>
          )}

          <p className="text-xl sm:text-2xl font-bold mt-4">{statusLine}</p>
          <p className="text-base opacity-80 mt-1">
            About {formatMinutes(token.eta_min)}, around {token.eta_clock}
          </p>
        </>
      )}

      {token.documents?.length > 0 && !called && (
        <div className="mt-6 rounded-2xl bg-white text-ink p-5">
          <fieldset>
            <legend className="text-sm font-bold mb-3">Have these ready</legend>
            <ul className="space-y-1">
              {token.documents.map((doc) => (
                <li key={doc}>
                  <label className="flex items-center gap-3 text-base cursor-pointer min-h-[48px]">
                    <input
                      type="checkbox"
                      className="w-6 h-6 accent-ink shrink-0"
                      checked={!!checked[doc]}
                      onChange={(e) => setChecked((c) => ({ ...c, [doc]: e.target.checked }))}
                    />
                    <span className={checked[doc] ? 'line-through text-muted' : ''}>{doc}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        </div>
      )}

      {token.priority && !called && (
        <p className="mt-4 text-xs font-bold opacity-80">Priority lane</p>
      )}

      {!called && (
        <button
          type="button"
          onClick={() => onCancel(token)}
          disabled={cancelling}
          className="mt-6 text-sm font-semibold underline underline-offset-4 opacity-70 hover:opacity-100 min-h-[48px]"
        >
          {cancelling ? 'Leaving…' : 'Leave queue'}
        </button>
      )}
    </article>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { api, joinUrl } from '../lib/api'
import { useLive } from '../lib/live'
import { isLocalhost, usePublicOrigin } from '../lib/network'
import { Alert, Button, Shell, Stat, formatMinutes } from '../components/ui'

export default function Staff() {
  const [services, setServices] = useState([])
  const [sid, setSid] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [pauseMsg, setPauseMsg] = useState('Lunch break, back at 2:00 PM.')
  const debounce = useRef(null)
  const sidRef = useRef(null)
  sidRef.current = sid
  const origin = usePublicOrigin()

  useEffect(() => {
    api('/api/services')
      .then((list) => {
        setServices(list)
        if (list.length) setSid(list[0].id)
      })
      .catch((e) => setError(e.message))
  }, [])

  const load = useCallback(async () => {
    if (!sidRef.current) return
    try {
      setData(await api(`/api/staff/services/${sidRef.current}`))
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    setData(null)
    load()
  }, [sid, load])

  const live = useLive((msg) => {
    if (msg.type === 'reconnected' || msg.service_id === sidRef.current) {
      clearTimeout(debounce.current)
      debounce.current = setTimeout(load, 150)
    }
  })

  const act = useCallback(
    async (key, path, body) => {
      setError('')
      setBusy(key)
      try {
        await api(path, { method: 'POST', body })
        await load()
      } catch (e) {
        setError(e.message)
      } finally {
        setBusy('')
      }
    },
    [load]
  )

  // Keyboard shortcut: N calls the next token
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() === 'n' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && sidRef.current && !busy) {
        act('next', `/api/staff/services/${sidRef.current}/call-next`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act, busy])

  const s = data?.service

  return (
    <Shell live={live}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold wide">Counter controls</h1>
          <p className="text-muted mt-1">Call tokens, handle no-shows, and pause the queue when you step away.</p>
        </div>
      </div>

      <nav aria-label="Choose service" className="mt-6 flex gap-2 overflow-x-auto pb-1">
        {services.map((svc) => (
          <button
            key={svc.id}
            onClick={() => setSid(svc.id)}
            aria-current={svc.id === sid}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold border ${svc.id === sid ? 'bg-ink text-white border-ink' : 'bg-white border-line hover:border-ink'}`}
          >
            {svc.name}
          </button>
        ))}
      </nav>

      <div className="mt-4">
        <Alert onClose={() => setError('')}>{error}</Alert>
      </div>

      {!data ? (
        <div className="mt-6 h-72 bg-white rounded-2xl border border-line animate-pulse" />
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            <section className={`rounded-2xl p-6 sm:p-8 ${s.is_paused ? 'bg-white border-2 border-dashed border-ink/40' : 'bg-ink text-white'}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className={s.is_paused ? 'text-muted' : 'text-white/60'}>{s.is_paused ? 'Queue paused' : 'Now serving'}</p>
                  <div key={data.current?.label} className={`flip-in numeral text-[6rem] sm:text-[8rem] ${s.is_paused ? 'text-ink/40' : 'text-signal'}`}>
                    {data.current?.label || '–'}
                  </div>
                  {s.is_paused && <p className="font-semibold">Students see: "{s.pause_message}"</p>}
                </div>
                <div className={`text-right text-sm ${s.is_paused ? 'text-muted' : 'text-white/60'}`}>
                  <div>{s.counter}</div>
                  <div>{data.waiting.length} waiting</div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  className="text-lg px-6 py-3"
                  busy={busy === 'next'}
                  disabled={s.is_paused || data.waiting.length === 0}
                  onClick={() => act('next', `/api/staff/services/${sid}/call-next`)}
                  title="Shortcut: N"
                >
                  Call next
                </Button>
                <Button variant="ghost" busy={busy === 'serve'} disabled={!data.current} onClick={() => act('serve', `/api/staff/services/${sid}/serve`)}>
                  Mark served
                </Button>
                <Button variant="danger" busy={busy === 'skip'} disabled={!data.current} onClick={() => act('skip', `/api/staff/services/${sid}/skip`)}>
                  No-show
                </Button>
              </div>
              {!s.is_paused && data.waiting.length === 0 && <p className="mt-3 text-sm text-white/60">Nobody is waiting. New tokens appear here instantly.</p>}
              {!s.is_paused && <p className="mt-3 text-xs text-white/40 hidden sm:block">Press N to call the next token.</p>}
            </section>

            <section className="bg-white rounded-2xl border border-line p-5">
              <h2 className="font-bold">Pause this queue</h2>
              <p className="text-sm text-muted">Everyone waiting sees your message instantly and keeps their place.</p>
              {s.is_paused ? (
                <Button className="mt-3" variant="dark" busy={busy === 'resume'} onClick={() => act('resume', `/api/staff/services/${sid}/resume`)}>
                  Resume queue
                </Button>
              ) : (
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                  <label htmlFor="pause-msg" className="sr-only">
                    Message for students
                  </label>
                  <input
                    id="pause-msg"
                    value={pauseMsg}
                    maxLength={120}
                    onChange={(e) => setPauseMsg(e.target.value)}
                    className="flex-1 rounded-lg border border-line px-3 py-2.5 outline-none focus:border-ink"
                  />
                  <Button variant="dark" busy={busy === 'pause'} onClick={() => act('pause', `/api/staff/services/${sid}/pause`, { message: pauseMsg })}>
                    Pause and notify
                  </Button>
                </div>
              )}
            </section>

            <section className="bg-white rounded-2xl border border-line">
              <h2 className="font-bold px-5 pt-5">Waiting list</h2>
              {data.waiting.length === 0 ? (
                <p className="px-5 pb-5 pt-2 text-sm text-muted">The line is empty.</p>
              ) : (
                <ol className="mt-3 divide-y divide-line">
                  {data.waiting.map((w, i) => (
                    <li key={w.id} className="flex items-center gap-4 px-5 py-3">
                      <span className="text-muted text-sm w-6">{i + 1}</span>
                      <span className="numeral text-2xl w-20">{w.label}</span>
                      <span className="flex-1 text-sm truncate">{w.user_name || 'Walk-in'}</span>
                      {w.priority ? (
                        <span className="text-xs font-bold bg-ink text-white rounded-full px-2.5 py-1">Priority</span>
                      ) : (
                        <button
                          onClick={() => act(`prio-${w.id}`, `/api/staff/tokens/${w.id}/priority`)}
                          disabled={busy === `prio-${w.id}`}
                          className="text-xs font-semibold underline underline-offset-2 text-muted hover:text-ink"
                        >
                          Move to priority lane
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <aside className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Served today" value={data.stats.served} />
              <Stat label="Waiting" value={data.stats.waiting} />
              <Stat label="Avg wait" value={data.stats.avg_wait_min ? formatMinutes(data.stats.avg_wait_min) : '–'} />
              <Stat label="No-shows" value={data.stats.skipped} />
            </div>

            <div className="bg-white rounded-2xl border border-line p-5 text-center">
              <h2 className="font-bold">Scan to join {s.name}</h2>
              <p className="text-sm text-muted mb-4">Print this at the counter or show it on the display.</p>
              <div className="inline-block bg-white p-3 rounded-xl border border-line">
                <QRCodeSVG value={joinUrl(sid, origin)} size={180} fgColor="#15224a" />
              </div>
              <p className="text-xs text-muted mt-3 break-all">{joinUrl(sid, origin)}</p>
              {isLocalhost(origin) && (
                <p className="text-xs text-stop mt-2">
                  This link only works on this laptop. Connect to Wi-Fi or a hotspot, or set VITE_PUBLIC_URL to a tunnel address.
                </p>
              )}
              <a href={`/display/${sid}`} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm font-semibold underline underline-offset-4">
                Open the TV display for this counter
              </a>
            </div>
          </aside>
        </div>
      )}
    </Shell>
  )
}

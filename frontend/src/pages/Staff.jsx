import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { api, joinUrl } from '../lib/api'
import { serviceColor } from '../lib/colors'
import { useLive } from '../lib/live'
import { isLocalhost, usePublicOrigin } from '../lib/network'
import { Alert, Button, Shell, Stat, formatMinutes } from '../components/ui'
import GraceTimer from '../components/GraceTimer'
import RushAlerts from '../components/RushAlerts'

const PAUSE_CHIPS = ['Lunch break, back at 2:00 PM', 'Back in 10 minutes', 'Closed for today']

function waitMinutes(createdAt) {
  if (!createdAt) return '–'
  const mins = Math.round((Date.now() - new Date(createdAt).getTime()) / 60000)
  return Math.max(0, mins)
}

export default function Staff() {
  const [services, setServices] = useState([])
  const [sid, setSid] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [pauseMsg, setPauseMsg] = useState(PAUSE_CHIPS[0])
  const [pauseOpen, setPauseOpen] = useState(false)
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

  useEffect(() => {
    if (!data?.current?.grace_seconds_left || data.current.responded) return
    const id = setInterval(load, 1000)
    return () => clearInterval(id)
  }, [data?.current?.grace_seconds_left, data?.current?.responded, load])

  const live = useLive((msg) => {
    if (
      msg.type === 'reconnected' ||
      msg.event === 'rush_alert' ||
      msg.event === 'rush_cleared' ||
      msg.service_id === sidRef.current
    ) {
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
        if (key === 'pause') setPauseOpen(false)
      } catch (e) {
        setError(e.message)
      } finally {
        setBusy('')
      }
    },
    [load]
  )

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
  const c = s ? serviceColor(s) : null

  return (
    <Shell live={live}>
      <nav aria-label="Choose service" className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {services.map((svc) => {
          const sc = serviceColor(svc)
          const active = svc.id === sid
          return (
            <button
              key={svc.id}
              onClick={() => setSid(svc.id)}
              aria-current={active}
              className={`whitespace-nowrap rounded-full px-4 min-h-[48px] text-sm font-bold border-2 flex items-center gap-2 transition-colors ${
                active ? '' : 'bg-white border-line text-ink'
              }`}
              style={active ? { backgroundColor: sc.bg, color: sc.text, borderColor: sc.bg } : undefined}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: active ? 'rgba(255,255,255,0.9)' : sc.bg }}
                aria-hidden
              />
              {svc.name}
            </button>
          )
        })}
      </nav>

      <div className="mt-4 space-y-3">
        <RushAlerts alerts={data?.rush_alerts} />
        <Alert onClose={() => setError('')}>{error}</Alert>
      </div>

      {!data ? (
        <div className="mt-6 h-80 bg-soft rounded-3xl animate-pulse" />
      ) : (
        <div className="mt-6 space-y-6">
          <section
            className={`rounded-3xl p-6 sm:p-8 ${s.is_paused ? 'bg-soft text-ink' : ''}`}
            style={s.is_paused ? undefined : { backgroundColor: c.bg, color: c.text }}
          >
            {s.is_paused ? (
              <>
                <p className="text-sm font-semibold text-muted uppercase tracking-wide">Queue paused</p>
                <p className="text-3xl sm:text-4xl font-extrabold wide mt-3 leading-tight">{s.pause_message}</p>
                <p className="text-muted mt-2 text-sm">Students see this message and keep their place.</p>
                <button
                  type="button"
                  disabled={busy === 'resume'}
                  onClick={() => act('resume', `/api/staff/services/${sid}/resume`)}
                  className="mt-6 w-full min-h-[96px] rounded-2xl bg-ink text-white text-xl font-bold active:scale-[0.98] disabled:opacity-50"
                >
                  {busy === 'resume' ? 'Working…' : 'Resume'}
                </button>
              </>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[1fr_280px] lg:items-center">
                <div>
                  <p className="text-sm opacity-80 uppercase tracking-wide font-semibold">Now serving</p>
                  {data.current?.label ? (
                    <>
                      <div key={data.current.label} className="flip-in numeral text-[5rem] sm:text-[7rem] lg:text-[8rem] text-lime leading-none mt-1">
                        {data.current.label}
                      </div>
                      <div className="mt-4 max-w-xs">
                        <GraceTimer
                          secondsLeft={data.current.grace_seconds_left}
                          responded={data.current.responded}
                          variant="staff"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="mt-2">
                      <p className="text-[2rem] font-bold opacity-80">Nobody at the counter</p>
                      {data.waiting.length > 0 && (
                        <p className="text-base font-semibold opacity-80 mt-1">Press Call next to start</p>
                      )}
                    </div>
                  )}
                  <p className="text-sm opacity-70 mt-2">{s.counter}</p>
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    disabled={busy === 'next' || data.waiting.length === 0}
                    onClick={() => act('next', `/api/staff/services/${sid}/call-next`)}
                    title="Shortcut: N"
                    className="w-full min-h-[96px] rounded-2xl bg-white text-ink text-2xl font-extrabold active:scale-[0.98] disabled:opacity-50"
                  >
                    {busy === 'next' ? 'Working…' : data.waiting.length === 0 ? 'No one waiting' : 'Call next'}
                  </button>
                  <p className="text-center text-xs opacity-60">Press N</p>
                </div>
              </div>
            )}

            {!s.is_paused && (
              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={!data.current || busy === 'serve'}
                  onClick={() => act('serve', `/api/staff/services/${sid}/serve`)}
                  className="min-h-[52px] rounded-2xl border-2 border-white/35 font-bold text-base active:scale-[0.98] disabled:opacity-40"
                >
                  {busy === 'serve' ? 'Working…' : 'Served'}
                </button>
                <button
                  type="button"
                  disabled={!data.current || busy === 'skip'}
                  onClick={() => act('skip', `/api/staff/services/${sid}/skip`)}
                  className="min-h-[52px] rounded-2xl border-2 border-white/35 font-bold text-base active:scale-[0.98] disabled:opacity-40"
                >
                  {busy === 'skip' ? 'Working…' : 'No-show'}
                </button>
              </div>
            )}
          </section>

          {!s.is_paused && (
            <section className="rounded-3xl bg-soft p-5">
              {!pauseOpen ? (
                <button
                  type="button"
                  onClick={() => setPauseOpen(true)}
                  className="w-full min-h-[52px] rounded-2xl border-2 border-line bg-white font-bold text-ink active:scale-[0.98]"
                >
                  Pause queue
                </button>
              ) : (
                <div className="space-y-4">
                  <p className="font-bold">Pause message for students</p>
                  <div className="flex flex-wrap gap-2">
                    {PAUSE_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setPauseMsg(chip)}
                        className={`rounded-2xl px-4 py-2.5 text-sm font-semibold min-h-[48px] border-2 active:scale-[0.98] ${
                          pauseMsg === chip ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink'
                        }`}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                  <label htmlFor="pause-msg" className="sr-only">
                    Custom pause message
                  </label>
                  <input
                    id="pause-msg"
                    value={pauseMsg}
                    maxLength={120}
                    onChange={(e) => setPauseMsg(e.target.value)}
                    className="w-full min-h-[52px] rounded-xl border-2 border-line px-4 text-base outline-none focus:border-ink bg-white"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      className="flex-1"
                      busy={busy === 'pause'}
                      onClick={() => act('pause', `/api/staff/services/${sid}/pause`, { message: pauseMsg })}
                    >
                      Confirm pause
                    </Button>
                    <Button variant="ghost" onClick={() => setPauseOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section>
            <h2 className="font-bold text-lg mb-3">Waiting</h2>
            {data.waiting.length === 0 ? (
              <p className="text-sm text-muted py-4">The line is empty.</p>
            ) : (
              <ol className="divide-y divide-line">
                {data.waiting.map((w) => (
                  <li key={w.id} className="flex items-center gap-2 sm:gap-3 py-3 min-h-[52px]">
                    <span className="numeral text-2xl font-extrabold w-20 shrink-0">{w.label}</span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium">{w.user_name || 'Guest'}</div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${
                            w.queue_type === 'BOOKED' ? 'bg-[#E3EEF8] text-[#1E4D8C]' : 'bg-soft text-muted'
                          }`}
                        >
                          {w.queue_type || 'WALK-IN'}
                        </span>
                        {w.slot_time && (
                          <span className="text-[10px] font-semibold text-muted">Slot {w.slot_time}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-sm text-muted shrink-0">{waitMinutes(w.created_at)}m</span>
                    {w.priority ? (
                      <span className="shrink-0 text-xs font-bold bg-lime text-ink rounded-full px-2.5 py-1">Priority</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => act(`prio-${w.id}`, `/api/staff/tokens/${w.id}/priority`)}
                        disabled={busy === `prio-${w.id}`}
                        className="shrink-0 text-xs font-semibold text-muted underline underline-offset-2 min-h-[48px] px-1"
                      >
                        Priority
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
            <Stat label="Served today" value={data.stats.served} />
            <Stat label="Waiting" value={data.stats.waiting} />
            <Stat label="Avg wait" value={data.stats.avg_wait_min ? formatMinutes(data.stats.avg_wait_min) : '–'} />
            <Stat label="No-shows" value={data.stats.skipped} />
          </div>

          <details className="rounded-3xl bg-soft p-5 group">
            <summary className="font-bold cursor-pointer list-none flex items-center justify-between min-h-[48px] [&::-webkit-details-marker]:hidden">
              Join QR and TV screen
              <span className="text-muted text-sm group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="mt-4 text-center">
              <div className="inline-block bg-white p-3 rounded-xl">
                <QRCodeSVG value={joinUrl(sid, origin)} size={180} fgColor="#101828" />
              </div>
              <p className="text-xs text-muted mt-3 break-all">{joinUrl(sid, origin)}</p>
              {isLocalhost(origin) && (
                <p className="text-xs text-danger mt-2">
                  This link only works on this laptop. Connect to Wi-Fi or a hotspot, or set VITE_PUBLIC_URL to a tunnel address.
                </p>
              )}
              <a href={`/display/${sid}`} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm font-semibold underline underline-offset-4 min-h-[48px] leading-[48px]">
                Open the TV display for this counter
              </a>
            </div>
          </details>
        </div>
      )}
    </Shell>
  )
}

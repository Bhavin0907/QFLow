import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { askNotificationPermission, notify, useLive } from '../lib/live'
import { Alert, Button, Shell, formatMinutes, hourLabel } from '../components/ui'
import Ticket from '../components/Ticket'
import Heatmap from '../components/Heatmap'
import Assistant from '../components/Assistant'

export default function Student() {
  const { user } = useAuth()
  const [services, setServices] = useState(null)
  const [mine, setMine] = useState({ active: [], history: [] })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [joining, setJoining] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const [detail, setDetail] = useState(null)
  const prev = useRef({})
  const debounce = useRef(null)

  const load = useCallback(async () => {
    try {
      const [svc, tokens] = await Promise.all([api('/api/services'), api('/api/tokens/me')])
      setServices(svc)
      setMine(tokens)
      // Alerts when my token changes state
      tokens.active.forEach((t) => {
        const before = prev.current[t.id]
        if (before) {
          if (before.status === 'waiting' && t.status === 'called') {
            notify(`${t.label}: it's your turn`, `Please go to ${t.counter}.`)
          } else if (t.status === 'waiting' && before.position > 3 && t.position <= 3) {
            notify(`${t.label}: you're almost up`, `${t.position === 1 ? 'You are next' : `${t.position - 1} ahead of you`}. Head to ${t.counter}.`)
          }
        }
      })
      prev.current = Object.fromEntries(tokens.active.map((t) => [t.id, { status: t.status, position: t.position }]))
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 30000) // keeps "expected around" times fresh
    return () => clearInterval(id)
  }, [load])

  const live = useLive(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(load, 200)
  })

  const join = async (serviceId) => {
    setError('')
    setJoining(serviceId)
    try {
      const t = await api(`/api/services/${serviceId}/join`, { method: 'POST' })
      askNotificationPermission()
      setNotice(`You're in line with token ${t.label}. We'll alert you when you're 3 away.`)
      await load()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setError(e.message)
    } finally {
      setJoining(null)
    }
  }

  const cancel = async (token) => {
    if (!window.confirm(`Leave the queue and give up ${token.label}?`)) return
    setCancelling(token.id)
    try {
      await api(`/api/tokens/${token.id}/cancel`, { method: 'POST' })
      setNotice(`${token.label} cancelled.`)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setCancelling(null)
    }
  }

  const openDetail = async (id) => {
    if (detail?.id === id) return setDetail(null)
    setDetail({ id, loading: true })
    try {
      const [info, heat] = await Promise.all([api(`/api/services/${id}`), api(`/api/services/${id}/heatmap`)])
      setDetail({ id, info, heat })
    } catch (e) {
      setError(e.message)
      setDetail(null)
    }
  }

  const activeIds = new Set(mine.active.map((t) => t.service_id))

  return (
    <Shell live={live}>
      <h1 className="text-3xl font-extrabold wide">Hi, {user.name.split(' ')[0]}</h1>
      <p className="text-muted mt-1">Join a queue, then go about your day. Your ticket updates live.</p>

      <div className="mt-5 space-y-3">
        <Alert onClose={() => setError('')}>{error}</Alert>
        <Alert kind="ok" onClose={() => setNotice('')}>{notice}</Alert>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[400px_1fr]">
        <section aria-labelledby="my-tickets">
          <h2 id="my-tickets" className="font-bold text-lg mb-3">
            Your tickets
          </h2>
          {mine.active.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-line p-8 text-center">
              <p className="font-semibold">You're not in any queue.</p>
              <p className="text-sm text-muted mt-1">Pick a service to get a token, or ask the assistant where to go.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {mine.active.map((t) => (
                <Ticket key={t.id} token={t} onCancel={cancel} cancelling={cancelling === t.id} />
              ))}
            </div>
          )}

          {mine.history.length > 0 && (
            <div className="mt-8">
              <h3 className="font-semibold text-sm text-muted mb-2">Recent visits</h3>
              <ul className="bg-white rounded-xl border border-line divide-y divide-line text-sm">
                {mine.history.slice(0, 5).map((h) => (
                  <li key={h.id} className="flex justify-between px-4 py-2.5">
                    <span>
                      <span className="font-bold">{h.label}</span> <span className="text-muted">{h.service_name}</span>
                    </span>
                    <span className="capitalize text-muted">{h.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section aria-labelledby="services">
          <h2 id="services" className="font-bold text-lg mb-3">
            Services
          </h2>
          {!services ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 bg-white rounded-xl border border-line animate-pulse" />
              ))}
            </div>
          ) : (
            <ul className="space-y-3">
              {services.map((s) => (
                <li key={s.id} className="bg-white rounded-xl border border-line">
                  <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-lg">{s.name}</h3>
                        {s.is_paused && <span className="text-xs font-bold bg-ink text-white rounded-full px-2 py-0.5">Paused</span>}
                      </div>
                      <p className="text-sm text-muted">{s.description}</p>
                      <p className="text-sm mt-2">
                        <span className="font-semibold">{s.waiting} waiting</span>
                        <span className="text-muted">, now serving {s.now_serving || 'nobody yet'}</span>
                      </p>
                    </div>
                    <div className="flex sm:flex-col items-center sm:items-end gap-3 sm:gap-1.5">
                      <div className="sm:text-right">
                        <div className="numeral text-4xl">{formatMinutes(s.eta_if_join_min)}</div>
                        <div className="text-xs text-muted">predicted wait if you join now</div>
                      </div>
                    </div>
                  </div>
                  <div className="px-4 sm:px-5 pb-4 flex gap-2">
                    <Button
                      variant="primary"
                      onClick={() => join(s.id)}
                      busy={joining === s.id}
                      disabled={activeIds.has(s.id)}
                      className="flex-1 sm:flex-none"
                    >
                      {activeIds.has(s.id) ? "You're in this queue" : 'Get a token'}
                    </Button>
                    <Button variant="ghost" onClick={() => openDetail(s.id)} aria-expanded={detail?.id === s.id}>
                      {detail?.id === s.id ? 'Hide details' : 'Best time to visit'}
                    </Button>
                  </div>

                  {detail?.id === s.id && (
                    <div className="border-t border-line p-4 sm:p-5 bg-mist/50 rounded-b-xl">
                      {detail.loading ? (
                        <p className="text-sm text-muted">Loading history…</p>
                      ) : (
                        <>
                          {detail.info.best_time && (
                            <div className="grid sm:grid-cols-3 gap-3 mb-4 text-sm">
                              <div className="bg-white rounded-lg border border-line p-3">
                                <div className="text-muted">Quietest time overall</div>
                                <div className="font-bold">
                                  {detail.info.best_time.best_overall.day} {hourLabel(detail.info.best_time.best_overall.hour)}, about{' '}
                                  {formatMinutes(detail.info.best_time.best_overall.avg_wait)}
                                </div>
                              </div>
                              <div className="bg-white rounded-lg border border-line p-3">
                                <div className="text-muted">Best slot left today</div>
                                <div className="font-bold">
                                  {detail.info.best_time.best_today
                                    ? `${hourLabel(detail.info.best_time.best_today.hour)}, about ${formatMinutes(detail.info.best_time.best_today.avg_wait)}`
                                    : 'Closed for today'}
                                </div>
                              </div>
                              <div className="bg-white rounded-lg border border-line p-3">
                                <div className="text-muted">Avoid</div>
                                <div className="font-bold">
                                  {detail.info.best_time.busiest.day} {hourLabel(detail.info.best_time.busiest.hour)}, about{' '}
                                  {formatMinutes(detail.info.best_time.busiest.avg_wait)}
                                </div>
                              </div>
                            </div>
                          )}
                          <Heatmap data={detail.heat} highlight={detail.info.best_time?.best_overall} />
                          <div className="mt-4 text-sm">
                            <span className="font-semibold">Bring: </span>
                            {detail.info.documents.join(', ')}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Assistant onJoin={join} />
    </Shell>
  )
}

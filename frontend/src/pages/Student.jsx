import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { serviceColor } from '../lib/colors'
import { askNotificationPermission, notify, useLive } from '../lib/live'
import { Alert, Button, Shell, formatMinutes, hourLabel } from '../components/ui'
import Ticket from '../components/Ticket'
import Heatmap from '../components/Heatmap'
import Assistant from '../components/Assistant'

function ServiceSheet({ service, detail, onClose, onJoin, joining, alreadyIn }) {
  const c = serviceColor(service)
  const [heatOpen, setHeatOpen] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-ink/40" onClick={onClose} aria-label="Close" />
      <div className="relative w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-canvas rounded-t-3xl sm:rounded-3xl p-6 sm:p-8">
        <div className="rounded-2xl p-4 mb-5" style={{ backgroundColor: c.bg, color: c.text }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-extrabold wide">{service.name}</h2>
              <p className="text-sm opacity-80">{service.counter}</p>
            </div>
            {service.is_paused && (
              <span className="shrink-0 text-xs font-bold bg-white/25 rounded-full px-2.5 py-1">Paused</span>
            )}
          </div>
          <p className="numeral text-4xl mt-3">
            {service.waiting} waiting · about {formatMinutes(service.eta_if_join_min)}
          </p>
        </div>

        {detail?.loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : detail?.info ? (
          <>
            <p className="text-base">{service.description}</p>
            {service.documents?.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-bold">Bring</p>
                <ul className="mt-1 text-sm text-muted space-y-0.5">
                  {(detail.info.documents || service.documents || []).map((d) => (
                    <li key={d}>· {d}</li>
                  ))}
                </ul>
              </div>
            )}
            {detail.info.best_time && (
              <div className="mt-5 rounded-2xl bg-soft p-4 text-sm space-y-2">
                <p>
                  <span className="font-bold">Quietest: </span>
                  {detail.info.best_time.best_overall.day} {hourLabel(detail.info.best_time.best_overall.hour)},{' '}
                  about {formatMinutes(detail.info.best_time.best_overall.avg_wait)}
                </p>
                <p>
                  <span className="font-bold">Best left today: </span>
                  {detail.info.best_time.best_today
                    ? `${hourLabel(detail.info.best_time.best_today.hour)}, about ${formatMinutes(detail.info.best_time.best_today.avg_wait)}`
                    : 'Closed for today'}
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setHeatOpen((o) => !o)}
              className="mt-4 text-sm font-semibold underline underline-offset-4 min-h-[48px]"
            >
              {heatOpen ? 'Hide wait-time heatmap' : 'Show wait-time heatmap'}
            </button>
            {heatOpen && (
              <div className="mt-3">
                <Heatmap data={detail.heat} highlight={detail.info.best_time?.best_overall} colors={c} />
              </div>
            )}
          </>
        ) : null}

        <Button
          variant="primary"
          className="w-full mt-6"
          onClick={() => onJoin(service.id)}
          busy={joining === service.id}
          disabled={alreadyIn}
        >
          {alreadyIn ? "You're in this queue" : 'Get token'}
        </Button>
        <button type="button" onClick={onClose} className="w-full mt-3 text-sm font-semibold text-muted min-h-[48px]">
          Close
        </button>
      </div>
    </div>
  )
}

export default function Student() {
  const { user } = useAuth()
  const [services, setServices] = useState(null)
  const [mine, setMine] = useState({ active: [], history: [] })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [joining, setJoining] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const [sheetId, setSheetId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [showQueues, setShowQueues] = useState(false)
  const prev = useRef({})
  const debounce = useRef(null)

  const load = useCallback(async () => {
    try {
      const [svc, tokens] = await Promise.all([api('/api/services'), api('/api/tokens/me')])
      setServices(svc)
      setMine(tokens)
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
    const id = setInterval(load, 30000)
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
      setSheetId(null)
      setDetail(null)
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

  const openSheet = async (id) => {
    setSheetId(id)
    setDetail({ id, loading: true })
    try {
      const [info, heat] = await Promise.all([api(`/api/services/${id}`), api(`/api/services/${id}/heatmap`)])
      setDetail({ id, info, heat })
    } catch (e) {
      setError(e.message)
      setSheetId(null)
      setDetail(null)
    }
  }

  const closeSheet = () => {
    setSheetId(null)
    setDetail(null)
  }

  const activeIds = new Set(mine.active.map((t) => t.service_id))
  const hasActive = mine.active.length > 0
  const sheetService = sheetId ? services?.find((s) => s.id === sheetId) : null

  const serviceTiles = (
    <ul className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {services?.map((s) => {
        const c = serviceColor(s)
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => openSheet(s.id)}
              className="w-full text-left rounded-3xl p-5 min-h-[120px] active:scale-[0.98] transition-transform"
              style={{ backgroundColor: c.bg, color: c.text }}
            >
              <div className="font-bold text-lg leading-tight pr-2">{s.name}</div>
              {s.is_paused && (
                <span className="inline-block mt-1 text-xs font-bold bg-white/20 rounded-full px-2 py-0.5">Paused</span>
              )}
              <div className="mt-4 flex items-end justify-between gap-2">
                <div>
                  <div className="numeral text-4xl">{s.waiting}</div>
                  <div className="text-xs opacity-80">waiting</div>
                </div>
                <div className="text-right">
                  <div className="numeral text-2xl">~{Math.round(s.eta_if_join_min)}</div>
                  <div className="text-xs opacity-80">min</div>
                </div>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )

  return (
    <Shell live={live}>
      <div className="space-y-3">
        <Alert onClose={() => setError('')}>{error}</Alert>
        <Alert kind="ok" onClose={() => setNotice('')}>{notice}</Alert>
      </div>

      {hasActive ? (
        <div className="mt-4 space-y-6">
          {mine.active.map((t) => (
            <Ticket key={t.id} token={t} onCancel={cancel} cancelling={cancelling === t.id} />
          ))}

          <div className="pt-2">
            {!showQueues ? (
              <button
                type="button"
                onClick={() => setShowQueues(true)}
                className="text-sm font-semibold underline underline-offset-4 text-muted min-h-[48px]"
              >
                Join another queue
              </button>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-lg">Other queues</h2>
                  <button type="button" onClick={() => setShowQueues(false)} className="text-sm text-muted min-h-[48px]">
                    Hide
                  </button>
                </div>
                {!services ? (
                  <div className="grid grid-cols-2 gap-3">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-28 bg-soft rounded-3xl animate-pulse" />
                    ))}
                  </div>
                ) : (
                  serviceTiles
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold wide">What do you need today?</h1>
            <div className="mt-5">
              <Assistant onJoin={join} joining={joining} />
            </div>
          </div>

          {!services ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-32 bg-soft rounded-3xl animate-pulse" />
              ))}
            </div>
          ) : (
            serviceTiles
          )}
        </div>
      )}

      {mine.history.length > 0 && (
        <div className="mt-10 pt-6 border-t border-line">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Recent visits</h3>
          <ul className="text-sm text-muted space-y-1">
            {mine.history.slice(0, 5).map((h) => (
              <li key={h.id} className="flex justify-between gap-4 min-h-[32px] items-center">
                <span>
                  <span className="font-semibold text-ink">{h.label}</span> {h.service_name}
                </span>
                <span className="capitalize shrink-0">{h.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sheetService && (
        <ServiceSheet
          service={sheetService}
          detail={detail?.id === sheetId ? detail : null}
          onClose={closeSheet}
          onJoin={join}
          joining={joining}
          alreadyIn={activeIds.has(sheetId)}
        />
      )}
    </Shell>
  )
}

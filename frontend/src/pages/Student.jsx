import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { serviceColor } from '../lib/colors'
import { askNotificationPermission, notify, useLive } from '../lib/live'
import { Alert, Button, Shell, formatMinutes, hourLabel } from '../components/ui'
import Ticket from '../components/Ticket'
import Heatmap from '../components/Heatmap'
import Assistant from '../components/Assistant'
import FloatingAssistant from '../components/FloatingAssistant'
import DocumentChecklist from '../components/DocumentChecklist'
import { bookableDates, dayLabel, EMPTY_SLOT_COPY, formatSlotTime, nextBookableDate } from '../lib/timezone'

const CROWD_STYLE = {
  low: 'bg-[#E3F6EE] text-[#0A8F5B]',
  medium: 'bg-[#FFF0E0] text-[#FF7A00]',
  high: 'bg-[#FDE7F0] text-[#E8196F]',
}

function SlotsEmpty({ reason, bookDate, bookable, onSwitchDay, onJoinWalkin, canProceed, joining }) {
  const message = EMPTY_SLOT_COPY[reason] || EMPTY_SLOT_COPY.unavailable
  const nextDate = nextBookableDate(bookDate, bookable)
  const canSwitch = nextDate && nextDate !== bookDate && reason !== 'closed_sunday'

  return (
    <div className="rounded-2xl bg-soft border-2 border-line p-4 space-y-3">
      <p className="text-sm">{message}</p>
      {canSwitch && (
        <button
          type="button"
          onClick={() => onSwitchDay(nextDate)}
          className="text-sm font-bold underline underline-offset-4 min-h-[44px]"
        >
          Book for {dayLabel(nextDate, 1)}
        </button>
      )}
      <Button variant="primary" className="w-full" onClick={onJoinWalkin} busy={joining} disabled={!canProceed}>
        Join live queue
      </Button>
    </div>
  )
}

function ServiceSheet({ service, detail, onClose, onJoin, onBook, joining, booking, alreadyIn, hasBooking }) {
  const c = serviceColor(service)
  const [heatOpen, setHeatOpen] = useState(false)
  const [mode, setMode] = useState('walkin')
  const [slotsMeta, setSlotsMeta] = useState(null)
  const [bookDate, setBookDate] = useState(null)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [docsConfirmed, setDocsConfirmed] = useState(false)
  const docList = detail?.info?.documents || service.documents || []
  const canProceed = !docList.length || docsConfirmed

  useEffect(() => {
    setDocsConfirmed(false)
  }, [service.id])

  useEffect(() => {
    if (mode !== 'book') return
    setBookDate((d) => d || bookableDates(3)[0])
  }, [mode])

  useEffect(() => {
    if (mode !== 'book' || !bookDate) return
    setSlotsLoading(true)
    api(`/api/services/${service.id}/slots?date=${bookDate}`)
      .then(setSlotsMeta)
      .catch(() => setSlotsMeta({ slots: [], empty_reason: 'unavailable', bookable_dates: bookableDates(3) }))
      .finally(() => setSlotsLoading(false))
  }, [mode, service.id, bookDate])

  const bookable = slotsMeta?.bookable_dates || bookableDates(3)
  const slots = slotsMeta?.slots || []

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

        <div className="flex rounded-2xl bg-soft p-1 mb-5">
          {[
            { id: 'walkin', label: 'Join now' },
            { id: 'book', label: 'Book a slot' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMode(tab.id)}
              className={`flex-1 min-h-[48px] rounded-xl text-sm font-bold transition-colors ${
                mode === tab.id ? 'bg-white text-ink shadow-sm' : 'text-muted'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {detail?.loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : detail?.info ? (
          <>
            <p className="text-base">{service.description}</p>
            <DocumentChecklist
              documents={docList}
              confirmed={docsConfirmed}
              onConfirmedChange={setDocsConfirmed}
            />
            {mode === 'book' && (
              <div className="mt-5">
                <p className="text-sm font-bold mb-2">Pick a day</p>
                <div className="flex gap-2 mb-4">
                  {bookable.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setBookDate(d)}
                      className={`flex-1 min-h-[44px] rounded-xl text-xs sm:text-sm font-bold px-2 transition-colors ${
                        bookDate === d ? 'bg-ink text-white' : 'bg-white border-2 border-line text-muted'
                      }`}
                    >
                      {dayLabel(d, i)}
                    </button>
                  ))}
                </div>
                <p className="text-sm font-bold mb-2">
                  Available slots · {dayLabel(bookDate, bookable.indexOf(bookDate))}
                </p>
                {slotsLoading ? (
                  <p className="text-sm text-muted">Loading slots…</p>
                ) : !slots.length ? (
                  <SlotsEmpty
                    reason={slotsMeta?.empty_reason || 'unavailable'}
                    bookDate={bookDate}
                    bookable={bookable}
                    onSwitchDay={setBookDate}
                    onJoinWalkin={() => onJoin(service.id, docsConfirmed)}
                    canProceed={canProceed && !alreadyIn && !hasBooking}
                    joining={joining === service.id}
                  />
                ) : (
                  <ul className="space-y-2 max-h-48 overflow-y-auto">
                    {slots.map((s) => (
                      <li key={s.slot_start}>
                        <button
                          type="button"
                          disabled={booking === s.slot_start || hasBooking || !canProceed}
                          onClick={() => onBook(service.id, s.slot_start, docsConfirmed)}
                          className="w-full flex items-center justify-between gap-3 rounded-2xl border-2 border-line bg-white px-4 min-h-[52px] active:scale-[0.98] disabled:opacity-50"
                        >
                          <span className="font-bold">{formatSlotTime(s.slot_start)}</span>
                          <span className={`text-xs font-bold rounded-full px-2.5 py-1 capitalize ${CROWD_STYLE[s.crowd_level]}`}>
                            {s.crowd_level}
                          </span>
                          <span className="text-xs text-muted shrink-0">{s.spots_left} left</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {detail.info.best_time && mode === 'walkin' && (
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
            {mode === 'walkin' && (
              <>
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
            )}
          </>
        ) : null}

        {mode === 'walkin' && (
          <Button
            variant="primary"
            className="w-full mt-6"
            onClick={() => onJoin(service.id, docsConfirmed)}
            busy={joining === service.id}
            disabled={alreadyIn || hasBooking || !canProceed}
          >
            {alreadyIn ? "You're in this queue" : hasBooking ? 'You have a booking — check in or cancel first' : 'Get token'}
          </Button>
        )}
        <button type="button" onClick={onClose} className="w-full mt-3 text-sm font-semibold text-muted min-h-[48px]">
          Close
        </button>
      </div>
    </div>
  )
}

function RequeueCard({ item, onRequeue, requeuing }) {
  const [left, setLeft] = useState(item.rejoin_seconds_left ?? 0)

  useEffect(() => {
    setLeft(item.rejoin_seconds_left ?? 0)
  }, [item.rejoin_seconds_left])

  useEffect(() => {
    if (left <= 0) return
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [left > 0])

  if (left <= 0) return null

  const mins = Math.ceil(left / 60)

  return (
    <article className="rounded-3xl p-5 border-2 border-danger/30 bg-[#FFF5F5]">
      <p className="text-xs font-bold text-danger uppercase tracking-wide">Missed your turn</p>
      <h3 className="text-lg font-extrabold wide mt-1">
        {item.label} · {item.service_name}
      </h3>
      <p className="text-sm text-muted mt-2">You can re-join once at the back of the line.</p>
      <p className="text-sm font-semibold text-danger mt-1">
        Rejoin available for {mins} more min
      </p>
      <Button variant="primary" className="w-full mt-4" busy={requeuing === item.id} onClick={() => onRequeue(item.id)}>
        Re-join at the back
      </Button>
    </article>
  )
}

function BookingCard({ booking, onCheckIn, onCancel, checkingIn, cancelling }) {
  const c = serviceColor({ code: booking.service_name?.[0], id: booking.service_id })
  return (
    <article className="rounded-3xl p-5 border-2 border-line bg-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-muted uppercase tracking-wide">Booked slot</p>
          <h3 className="text-lg font-extrabold wide mt-1">{booking.service_name}</h3>
          <p className="text-sm text-muted">{booking.counter}</p>
        </div>
        <span className="shrink-0 text-xs font-bold rounded-full px-2.5 py-1" style={{ backgroundColor: c.soft, color: c.bg }}>
          {booking.slot_time}
        </span>
      </div>
      <p className="text-sm mt-3 text-muted">Check in when you arrive at the counter area.</p>
      <div className="mt-4 flex gap-2">
        <Button variant="lime" className="flex-1" busy={checkingIn === booking.id} onClick={() => onCheckIn(booking.id)}>
          I've arrived
        </Button>
        <Button variant="ghost" busy={cancelling === booking.id} onClick={() => onCancel(booking)}>
          Cancel
        </Button>
      </div>
    </article>
  )
}

export default function Student() {
  const { user } = useAuth()
  const [services, setServices] = useState(null)
  const [mine, setMine] = useState({ active: [], bookings: [], requeue_eligible: [], history: [] })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [joining, setJoining] = useState(null)
  const [booking, setBooking] = useState(null)
  const [checkingIn, setCheckingIn] = useState(null)
  const [cancellingAppt, setCancellingAppt] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const [responding, setResponding] = useState(null)
  const [requeuing, setRequeuing] = useState(null)
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
          } else if (t.status === 'waiting' && before.position > 2 && t.position <= 2) {
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

  const inGrace = mine.active.some((t) => t.status === 'called' && !t.responded && (t.grace_seconds_left ?? 0) > 0)
  useEffect(() => {
    if (!inGrace) return
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [inGrace, load])

  const hasRequeue = (mine.requeue_eligible || []).some((r) => (r.rejoin_seconds_left ?? 0) > 0)
  useEffect(() => {
    if (!hasRequeue) return
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [hasRequeue, load])

  const live = useLive(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(load, 200)
  })

  const join = async (serviceId, documentsConfirmed = false) => {
    setError('')
    setJoining(serviceId)
    try {
      const t = await api(`/api/services/${serviceId}/join`, {
        method: 'POST',
        body: { documents_confirmed: documentsConfirmed },
      })
      askNotificationPermission()
      setNotice(`You're in line with token ${t.label}. We'll alert you when you're 2 away.`)
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

  const book = async (serviceId, slotStart, documentsConfirmed = false) => {
    setError('')
    setBooking(slotStart)
    try {
      const appt = await api(`/api/services/${serviceId}/book`, {
        method: 'POST',
        body: { slot_start: slotStart, documents_confirmed: documentsConfirmed },
      })
      setNotice(`Booked ${appt.slot_time} at ${appt.service_name}. Check in when you arrive.`)
      setSheetId(null)
      setDetail(null)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBooking(null)
    }
  }

  const checkIn = async (appointmentId) => {
    setError('')
    setCheckingIn(appointmentId)
    try {
      const t = await api(`/api/appointments/${appointmentId}/check-in`, { method: 'POST' })
      askNotificationPermission()
      setNotice(`Checked in — your token is ${t.label}.`)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setCheckingIn(null)
    }
  }

  const cancelBooking = async (appt) => {
    if (!window.confirm(`Cancel your ${appt.slot_time} booking at ${appt.service_name}?`)) return
    setCancellingAppt(appt.id)
    try {
      await api(`/api/appointments/${appt.id}/cancel`, { method: 'POST' })
      setNotice('Booking cancelled.')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setCancellingAppt(null)
    }
  }

  const respond = async (token) => {
    setError('')
    setResponding(token.id)
    try {
      await api(`/api/tokens/${token.id}/respond`, { method: 'POST' })
      setNotice(`${token.label}: staff notified you're at the counter.`)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setResponding(null)
    }
  }

  const requeue = async (tokenId) => {
    setError('')
    setRequeuing(tokenId)
    try {
      const t = await api(`/api/tokens/${tokenId}/requeue`, { method: 'POST' })
      setNotice(`Re-joined with token ${t.label} at the back of the line.`)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setRequeuing(null)
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
  const requeueEligible = (mine.requeue_eligible || []).filter((r) => !activeIds.has(r.service_id))
  const bookingServiceIds = new Set((mine.bookings || []).map((b) => b.service_id))
  const hasActive = mine.active.length > 0
  const hasBookings = (mine.bookings || []).length > 0
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

      {requeueEligible.length > 0 && (
        <div className="mt-4 space-y-4">
          {requeueEligible.map((r) => (
            <RequeueCard key={r.id} item={r} onRequeue={requeue} requeuing={requeuing} />
          ))}
        </div>
      )}

      {hasBookings && (
        <div className="mt-4 space-y-4">
          <h2 className="font-bold text-lg">Your bookings</h2>
          {mine.bookings.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              onCheckIn={checkIn}
              onCancel={cancelBooking}
              checkingIn={checkingIn}
              cancelling={cancellingAppt}
            />
          ))}
        </div>
      )}

      {hasActive ? (
        <div className="mt-4 space-y-6">
          {mine.active.map((t) => (
            <Ticket
              key={t.id}
              token={t}
              onCancel={cancel}
              cancelling={cancelling === t.id}
              onRespond={respond}
              responding={responding === t.id}
            />
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
      ) : !hasBookings ? (
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
      ) : (
        <div className="mt-6">{serviceTiles}</div>
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

      <FloatingAssistant />

      {sheetService && (
        <ServiceSheet
          service={sheetService}
          detail={detail?.id === sheetId ? detail : null}
          onClose={closeSheet}
          onJoin={join}
          onBook={book}
          joining={joining}
          booking={booking}
          alreadyIn={activeIds.has(sheetId)}
          hasBooking={bookingServiceIds.has(sheetId)}
        />
      )}
    </Shell>
  )
}

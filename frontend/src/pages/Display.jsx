import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { api, joinUrl } from '../lib/api'
import { serviceColor } from '../lib/colors'
import { chime, useLive } from '../lib/live'
import { usePublicOrigin } from '../lib/network'
import { Logo } from '../components/ui'

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return <span className="numeral text-3xl sm:text-4xl">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
}

function Picker() {
  const [services, setServices] = useState([])
  useEffect(() => {
    api('/api/services').then(setServices).catch(() => {})
  }, [])
  return (
    <div className="min-h-screen bg-canvas p-6 sm:p-10">
      <Logo />
      <h1 className="text-3xl sm:text-4xl font-extrabold wide mt-8">Choose a counter</h1>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((s) => {
          const c = serviceColor(s)
          return (
            <li key={s.id}>
              <Link
                to={`/display/${s.id}`}
                className="block rounded-3xl p-8 min-h-[140px] active:scale-[0.98] transition-transform"
                style={{ backgroundColor: c.bg, color: c.text }}
              >
                <span className="numeral text-4xl opacity-70">{s.code}</span>
                <div className="font-extrabold text-2xl wide mt-2 leading-tight">{s.name}</div>
                <div className="opacity-70 text-base mt-1">{s.counter}</div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function Display() {
  const { serviceId } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [sound, setSound] = useState(false)
  const lastLabel = useRef(null)
  const soundRef = useRef(false)
  soundRef.current = sound

  const load = useCallback(async () => {
    if (!serviceId) return
    try {
      const d = await api(`/api/display/${serviceId}`)
      if (lastLabel.current && d.now_serving && d.now_serving !== lastLabel.current && soundRef.current) chime()
      lastLabel.current = d.now_serving
      setData(d)
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [serviceId])

  useEffect(() => {
    load()
  }, [load])

  const live = useLive((msg) => {
    if (msg.type === 'reconnected' || String(msg.service_id) === String(serviceId)) load()
  })

  const origin = usePublicOrigin()

  if (!serviceId) return <Picker />

  const c = data ? serviceColor({ code: data.code, id: Number(serviceId) }) : null
  const screenStyle = c ? { backgroundColor: c.bg, color: c.text } : { backgroundColor: '#101828', color: '#FFFFFF' }

  return (
    <div className="min-h-screen flex flex-col" style={screenStyle}>
      <header className="flex items-center gap-4 sm:gap-6 px-6 sm:px-10 py-5 border-b border-current/15">
        <Logo light />
        {data && (
          <h1 className="flex-1 text-xl sm:text-2xl lg:text-3xl font-extrabold wide truncate">{data.service_name}</h1>
        )}
        <div className="flex items-center gap-4 sm:gap-6 shrink-0">
          {!sound && (
            <button
              type="button"
              onClick={() => { setSound(true); chime() }}
              className="text-sm rounded-2xl border-2 border-current/25 px-3 sm:px-4 min-h-[44px] font-semibold opacity-80 hover:opacity-100"
            >
              Chime
            </button>
          )}
          <span className={`w-2.5 h-2.5 rounded-full ${live ? 'bg-lime' : 'bg-danger'}`} title={live ? 'Live' : 'Reconnecting'} aria-hidden />
          <Clock />
        </div>
      </header>

      {error && <p className="px-6 sm:px-10 py-4 text-lime font-bold">{error}</p>}

      {data && (
        <main className="flex-1 grid lg:grid-cols-[1fr_340px] min-h-0">
          <section className="px-6 sm:px-10 lg:px-14 py-8 sm:py-10 flex flex-col justify-center min-h-[45vh] lg:min-h-[50vh]">
            {data.is_paused ? (
              <>
                <p className="text-2xl sm:text-3xl opacity-70 font-semibold">Counter paused</p>
                <p className="text-4xl sm:text-6xl lg:text-7xl font-extrabold wide mt-4 leading-tight max-w-4xl">{data.pause_message}</p>
                <p className="text-xl sm:text-2xl opacity-70 mt-6">Everyone keeps their place.</p>
              </>
            ) : (
              <>
                <p className="text-2xl sm:text-3xl opacity-70 font-semibold">Now serving</p>
                <div
                  key={data.now_serving}
                  className="flip-in numeral text-lime leading-none mt-2 text-[min(28vw,22rem)] sm:text-[min(22vw,24rem)] lg:text-[min(18vw,28rem)]"
                >
                  {data.now_serving || '–'}
                </div>
                <p className="text-lg sm:text-xl opacity-70 mt-4">{data.counter}</p>
              </>
            )}
          </section>

          <aside className="px-6 sm:px-8 lg:px-10 py-8 flex flex-col border-t lg:border-t-0 lg:border-l border-current/15 min-h-[40vh] lg:min-h-0">
            <div className="flex-1">
              <h2 className="text-lg sm:text-xl opacity-70 font-semibold">Up next</h2>
              {data.up_next.length === 0 ? (
                <p className="text-3xl sm:text-4xl mt-3 font-bold">No one waiting</p>
              ) : (
                <ol className="mt-4 space-y-3">
                  {data.up_next.map((label, i) => (
                    <li key={label} className={`numeral ${i === 0 ? 'text-5xl sm:text-7xl' : 'text-3xl sm:text-5xl opacity-70'}`}>
                      {label}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="mt-8 lg:mt-auto bg-white text-ink rounded-3xl p-5 sm:p-6 flex items-center gap-4 sm:gap-5">
              <div className="shrink-0">
                <QRCodeSVG value={joinUrl(serviceId, origin)} size={120} fgColor="#101828" />
              </div>
              <div>
                <p className="font-extrabold text-lg sm:text-xl leading-tight">Scan to join</p>
                <p className="text-muted text-base sm:text-lg mt-1">
                  {data.waiting} waiting, about {Math.round(data.eta_if_join_min)} min
                </p>
              </div>
            </div>
          </aside>
        </main>
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { api, joinUrl } from '../lib/api'
import { chime, useLive } from '../lib/live'
import { usePublicOrigin } from '../lib/network'
import { Logo } from '../components/ui'

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return <span className="numeral text-4xl">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
}

function Picker() {
  const [services, setServices] = useState([])
  useEffect(() => {
    api('/api/services').then(setServices).catch(() => {})
  }, [])
  return (
    <div className="min-h-screen bg-ink text-white p-8">
      <Logo light />
      <h1 className="text-3xl font-extrabold wide mt-10">Choose a counter to display</h1>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((s) => (
          <li key={s.id}>
            <Link to={`/display/${s.id}`} className="block rounded-xl bg-white/10 hover:bg-white/20 p-5">
              <div className="font-bold text-lg">{s.name}</div>
              <div className="text-white/60 text-sm">{s.counter}</div>
            </Link>
          </li>
        ))}
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

  return (
    <div className="min-h-screen bg-ink text-white flex flex-col">
      <header className="flex items-center justify-between px-8 py-5 border-b border-white/10">
        <Logo light />
        <div className="flex items-center gap-6">
          {!sound && (
            <button onClick={() => { setSound(true); chime() }} className="text-sm rounded-full border border-white/30 px-4 py-1.5 hover:bg-white/10">
              Turn on chime
            </button>
          )}
          <span className={`w-2.5 h-2.5 rounded-full ${live ? 'bg-go' : 'bg-stop'}`} title={live ? 'Live' : 'Reconnecting'} />
          <Clock />
        </div>
      </header>

      {error && <p className="p-8 text-signal">{error}</p>}
      {data && (
        <main className="flex-1 grid lg:grid-cols-[1fr_380px]">
          <section className="px-8 lg:px-14 py-10 flex flex-col justify-center">
            <h1 className="text-3xl lg:text-4xl font-extrabold wide">{data.service_name}</h1>
            <p className="text-white/60 text-lg">{data.counter}</p>

            {data.is_paused ? (
              <div className="mt-10">
                <p className="text-white/60 text-2xl">Counter paused</p>
                <p className="text-4xl lg:text-5xl font-extrabold mt-3 max-w-3xl leading-tight">{data.pause_message}</p>
                <p className="text-white/60 text-xl mt-4">Everyone keeps their place in line.</p>
              </div>
            ) : (
              <div className="mt-8">
                <p className="text-white/60 text-2xl">Now serving</p>
                <div key={data.now_serving} className="flip-in numeral text-signal text-[9rem] sm:text-[14rem] lg:text-[18rem]">
                  {data.now_serving || '–'}
                </div>
              </div>
            )}
          </section>

          <aside className="bg-white/5 border-l border-white/10 px-8 py-10 flex flex-col gap-8">
            <div>
              <h2 className="text-white/60 text-lg">Up next</h2>
              {data.up_next.length === 0 ? (
                <p className="text-2xl mt-2">No one waiting</p>
              ) : (
                <ol className="mt-3 space-y-2">
                  {data.up_next.map((label, i) => (
                    <li key={label} className={`numeral ${i === 0 ? 'text-6xl' : 'text-4xl text-white/70'}`}>
                      {label}
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="mt-auto">
              <div className="flex items-center gap-5">
                <div className="bg-white p-3 rounded-xl shrink-0">
                  <QRCodeSVG value={joinUrl(serviceId, origin)} size={132} fgColor="#15224a" />
                </div>
                <div>
                  <p className="font-bold text-xl leading-tight">Scan to join from your phone</p>
                  <p className="text-white/60 mt-1">
                    {data.waiting} waiting, about {Math.round(data.eta_if_join_min)} min
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </main>
      )}
    </div>
  )
}

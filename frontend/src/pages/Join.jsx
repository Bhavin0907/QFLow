import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { serviceColor } from '../lib/colors'
import { askNotificationPermission } from '../lib/live'
import { Button, formatMinutes } from '../components/ui'

export default function Join() {
  const { serviceId } = useParams()
  const { user, guest } = useAuth()
  const navigate = useNavigate()
  const [service, setService] = useState(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api(`/api/services/${serviceId}`).then(setService).catch((e) => setError(e.message))
  }, [serviceId])

  const joinNow = async () => {
    setError('')
    if (!user && name.trim().length < 2) return setError('Enter your name so staff can call you')
    setBusy(true)
    try {
      if (!user) await guest(name.trim())
      await api(`/api/services/${serviceId}/join`, { method: 'POST' })
      askNotificationPermission()
      navigate('/student')
    } catch (e) {
      if (e.status === 409) navigate('/student')
      else setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const wrongRole = user && user.role !== 'student'
  const c = service ? serviceColor(service) : null

  return (
    <div
      className="min-h-screen flex flex-col px-6 py-8"
      style={c ? { backgroundColor: c.bg, color: c.text } : { backgroundColor: '#101828', color: '#FFFFFF' }}
    >
      <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full">
        {!service && !error && <p className="opacity-70 text-lg">Loading…</p>}

        {service && (
          <>
            <h1 className="text-3xl sm:text-4xl font-extrabold wide leading-tight">{service.name}</h1>

            <p className="numeral text-5xl sm:text-6xl mt-8 leading-none">
              {service.waiting} waiting
            </p>
            <p className="text-2xl sm:text-3xl font-bold mt-2 opacity-90">
              about {formatMinutes(service.eta_if_join_min)}
            </p>

            {service.is_paused && (
              <p className="mt-4 text-sm font-semibold opacity-90">Paused — you can still join and keep your place.</p>
            )}

            {wrongRole ? (
              <p className="mt-10 text-base opacity-90">
                You're logged in as {user.role}. Log out and scan again to join as a student.
              </p>
            ) : (
              <div className="mt-10 space-y-4">
                {!user && (
                  <label className="block">
                    <span className="sr-only">Your name</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={40}
                      autoComplete="given-name"
                      placeholder="Your name"
                      className="w-full min-h-[52px] rounded-2xl border-2 border-white/30 bg-white/15 px-4 text-base text-white placeholder:text-white/60 outline-none focus:border-white"
                    />
                  </label>
                )}
                {user && <p className="text-base opacity-90">Joining as {user.name}</p>}
                {error && (
                  <p className="rounded-2xl bg-white text-danger px-4 py-3 text-sm font-semibold">{error}</p>
                )}
                <Button
                  variant="lime"
                  className="w-full text-xl min-h-[60px]"
                  onClick={joinNow}
                  busy={busy}
                >
                  Get my token
                </Button>
              </div>
            )}
          </>
        )}

        {error && !service && <p className="text-lime font-semibold">{error}</p>}
      </div>
    </div>
  )
}

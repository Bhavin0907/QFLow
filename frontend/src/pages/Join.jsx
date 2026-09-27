import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { askNotificationPermission } from '../lib/live'
import { Alert, Button, Field, Logo, formatMinutes } from '../components/ui'

// Landing page for the QR code: join a queue in one step, no signup form.
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

  return (
    <div className="min-h-screen bg-ink text-white flex flex-col">
      <div className="px-6 pt-6">
        <Logo light />
      </div>
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          {!service && !error && <p className="text-white/70">Loading queue…</p>}
          {service && (
            <>
              <p className="text-white/60">You're joining</p>
              <h1 className="text-3xl font-extrabold wide mt-1">{service.name}</h1>
              <p className="text-white/60 text-sm">{service.counter}</p>

              <div className="grid grid-cols-2 gap-3 mt-6">
                <div className="rounded-xl bg-white/10 p-4">
                  <div className="text-sm text-white/60">Waiting now</div>
                  <div className="numeral text-5xl text-signal">{service.waiting}</div>
                </div>
                <div className="rounded-xl bg-white/10 p-4">
                  <div className="text-sm text-white/60">Predicted wait</div>
                  <div className="numeral text-5xl text-signal">{Math.round(service.eta_if_join_min)}m</div>
                </div>
              </div>

              {service.is_paused && (
                <div className="mt-4 rounded-lg bg-signal text-ink px-4 py-3 text-sm font-semibold">
                  Paused: {service.pause_message} You can still join and keep your place.
                </div>
              )}

              <div className="mt-6 bg-white text-ink rounded-2xl p-5 space-y-4">
                {wrongRole ? (
                  <p className="text-sm">
                    You're logged in as {user.role}. Log out and scan again to join as a student.
                  </p>
                ) : (
                  <>
                    {!user && (
                      <Field label="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" placeholder="e.g. Priya" />
                    )}
                    {user && <p className="text-sm">Joining as <strong>{user.name}</strong></p>}
                    <Alert onClose={() => setError('')}>{error}</Alert>
                    <Button variant="primary" className="w-full text-lg py-3" onClick={joinNow} busy={busy}>
                      Get my token
                    </Button>
                    <p className="text-xs text-muted">
                      Expected wait about {formatMinutes(service.eta_if_join_min)}. We'll alert you on this phone when you're 3 away.
                    </p>
                  </>
                )}
              </div>
              {!user && (
                <p className="text-sm text-white/60 mt-4">
                  Have an account? <Link to="/login" className="underline text-white">Log in</Link>
                </p>
              )}
            </>
          )}
          {error && !service && <Alert>{error}</Alert>}
        </div>
      </div>
    </div>
  )
}

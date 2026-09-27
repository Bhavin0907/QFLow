import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function Logo({ light = false }) {
  // The yellow Q tile is the first letter of the name: [Q]flow
  return (
    <span className={`flex items-center gap-1 font-extrabold wide text-xl ${light ? 'text-white' : 'text-ink'}`} aria-label="Qflow">
      <span className="grid place-items-center w-8 h-8 rounded-md bg-signal text-ink numeral text-2xl" aria-hidden>
        Q
      </span>
      <span aria-hidden>flow</span>
    </span>
  )
}

export function Shell({ children, live }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="min-h-screen">
      <header className="bg-ink text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/" aria-label="Qflow home">
            <Logo light />
          </Link>
          <div className="flex items-center gap-4 text-sm">
            {live !== undefined && (
              <span className="hidden sm:flex items-center gap-2 text-white/80" title={live ? 'Receiving live updates' : 'Reconnecting'}>
                <span className={`w-2 h-2 rounded-full ${live ? 'bg-go' : 'bg-stop'}`} />
                {live ? 'Live' : 'Reconnecting'}
              </span>
            )}
            {user && (
              <>
                <span className="hidden sm:inline text-white/80">
                  {user.name} <span className="text-white/50">({user.role})</span>
                </span>
                <button
                  onClick={() => {
                    logout()
                    navigate('/login')
                  }}
                  className="px-3 py-1.5 rounded-md border border-white/25 hover:bg-white/10"
                >
                  Log out
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</main>
    </div>
  )
}

const variants = {
  primary: 'bg-signal text-ink hover:bg-signal-deep font-bold',
  dark: 'bg-ink text-white hover:bg-ink-soft font-semibold',
  ghost: 'bg-white text-ink border border-line hover:border-ink font-semibold',
  danger: 'bg-white text-stop border border-stop/40 hover:bg-stop hover:text-white font-semibold',
}

export function Button({ variant = 'dark', className = '', busy, children, ...props }) {
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {busy ? 'Working…' : children}
    </button>
  )
}

export function Field({ label, error, ...props }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold mb-1.5">{label}</span>
      <input
        {...props}
        className={`w-full rounded-lg border bg-white px-3 py-2.5 outline-none focus:border-ink ${error ? 'border-stop' : 'border-line'}`}
      />
      {error && <span className="block text-sm text-stop mt-1">{error}</span>}
    </label>
  )
}

export function Alert({ kind = 'error', children, onClose }) {
  if (!children) return null
  const styles = {
    error: 'bg-stop/10 text-stop border-stop/30',
    info: 'bg-ink/5 text-ink border-ink/20',
    warn: 'bg-signal/25 text-ink border-signal-deep/40',
    ok: 'bg-go/10 text-go border-go/30',
  }
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${styles[kind]}`}>
      <span>{children}</span>
      {onClose && (
        <button onClick={onClose} aria-label="Dismiss" className="font-bold opacity-70 hover:opacity-100">
          ×
        </button>
      )}
    </div>
  )
}

export function Stat({ label, value, hint }) {
  return (
    <div className="bg-white rounded-xl border border-line p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="numeral text-4xl mt-1">{value ?? '–'}</div>
      {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
    </div>
  )
}

export function formatMinutes(min) {
  if (min === null || min === undefined) return '–'
  if (min < 1) return 'under a minute'
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h} h ${m} min` : `${h} h`
}

export function hourLabel(h) {
  if (h === null || h === undefined) return '–'
  const suffix = h < 12 ? 'AM' : 'PM'
  return `${((h + 11) % 12) + 1} ${suffix}`
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

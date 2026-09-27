import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function Logo({ light = false }) {
  return (
    <span className="flex items-center gap-1.5 font-extrabold wide text-xl" aria-label="Qflow">
      <span className="grid place-items-center w-9 h-9 rounded-xl bg-ink text-white numeral text-2xl" aria-hidden>
        Q
      </span>
      <span className={light ? 'text-white' : 'text-ink'} aria-hidden>
        flow
      </span>
    </span>
  )
}

export function Shell({ children, live }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-white border-b border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/" aria-label="Qflow home">
            <Logo />
          </Link>
          <div className="flex items-center gap-4 text-sm">
            {live !== undefined && (
              <span className="hidden sm:flex items-center gap-2 text-muted" title={live ? 'Receiving live updates' : 'Reconnecting'}>
                <span className={`w-2 h-2 rounded-full ${live ? 'bg-[#0A8F5B]' : 'bg-danger'}`} />
                {live ? 'Live' : 'Reconnecting'}
              </span>
            )}
            {user && (
              <>
                <span className="hidden sm:inline text-muted">{user.name}</span>
                <button
                  onClick={() => {
                    logout()
                    navigate('/login')
                  }}
                  className="font-semibold text-ink underline underline-offset-4 hover:text-muted"
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
  primary: 'bg-ink text-white hover:bg-ink/90',
  lime: 'bg-lime text-ink hover:bg-lime/90',
  ghost: 'bg-white text-ink border-2 border-line hover:border-ink',
  danger: 'bg-white text-danger border-2 border-danger/40 hover:bg-danger hover:text-white',
}

export function Button({ variant = 'primary', className = '', busy, children, ...props }) {
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={`inline-flex items-center justify-center gap-2 min-h-[52px] rounded-2xl px-5 text-base font-bold transition-all active:scale-[0.98] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 ${variants[variant]} ${className}`}
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
        className={`w-full min-h-[52px] rounded-xl border-2 bg-white px-4 text-base outline-none focus:border-ink ${error ? 'border-danger' : 'border-line'}`}
      />
      {error && <span className="block text-sm text-danger mt-1">{error}</span>}
    </label>
  )
}

export function Alert({ kind = 'error', children, onClose }) {
  if (!children) return null
  const styles = {
    error: 'bg-danger/10 text-danger border-danger/30',
    info: 'bg-soft text-ink border-line',
    warn: 'bg-lime/40 text-ink border-lime',
    ok: 'bg-[#0A8F5B]/10 text-[#0A8F5B] border-[#0A8F5B]/30',
  }
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-xl border-2 px-4 py-3 text-sm ${styles[kind]}`}>
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
    <div>
      <div className="text-sm text-muted">{label}</div>
      <div className="numeral text-4xl mt-0.5">{value ?? '–'}</div>
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

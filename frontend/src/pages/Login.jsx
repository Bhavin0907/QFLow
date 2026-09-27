import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { homeFor, useAuth } from '../lib/auth'
import { Alert, Button, Field, Logo } from '../components/ui'

const DEMO = [
  { role: 'Student', email: 'student@campus.edu', password: 'student123', bg: '#2B59FF', text: '#FFFFFF' },
  { role: 'Staff', email: 'staff@campus.edu', password: 'staff123', bg: '#E8196F', text: '#FFFFFF' },
  { role: 'Admin', email: 'admin@campus.edu', password: 'admin123', bg: '#0A8F5B', text: '#FFFFFF' },
]

function PreviewLine() {
  return (
    <div className="flex items-center gap-1.5 mt-6 mb-4" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-2.5 h-2.5 rounded-full bg-white/35 shrink-0" />
      ))}
      <span className="flex flex-col items-center mx-1 shrink-0">
        <span className="w-5 h-5 rounded-full bg-white ring-2 ring-white/50" />
        <span className="text-[10px] font-bold mt-0.5">You</span>
      </span>
      <span className="flex-1 min-w-[20px] border-t-2 border-dashed border-white/30 mx-1" />
      <span className="shrink-0 w-6 h-6 rounded bg-white/20" />
    </div>
  )
}

function TicketPreview() {
  return (
    <div className="rounded-3xl bg-white/10 p-6 sm:p-8 max-w-md">
      <p className="text-sm opacity-70">Certificates · Block A, Ground Floor</p>
      <div className="numeral text-[5rem] sm:text-[6rem] leading-none mt-2">C-042</div>
      <PreviewLine />
      <p className="text-xl font-bold">3 people ahead of you</p>
    </div>
  )
}

export default function Login() {
  const { user, login, register } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={homeFor(user.role)} replace />

  const validate = () => {
    const e = {}
    if (mode === 'register' && form.name.trim().length < 2) e.name = 'Enter your name (at least 2 characters)'
    if (!/^\S+@\S+\.\S+$/.test(form.email)) e.email = 'Enter a valid email address'
    if (form.password.length < (mode === 'register' ? 6 : 1)) e.password = mode === 'register' ? 'Use at least 6 characters' : 'Enter your password'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!validate()) return
    setBusy(true)
    try {
      const u = mode === 'login' ? await login(form.email, form.password) : await register(form.name, form.email, form.password)
      navigate(homeFor(u.role))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const demoLogin = async (d) => {
    setError('')
    setBusy(true)
    try {
      const u = await login(d.email, d.password)
      navigate(homeFor(u.role))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <div className="min-h-screen bg-canvas">
      <div className="h-2 bg-[#2B59FF] lg:hidden" aria-hidden />

      <div className="min-h-screen grid lg:grid-cols-2">
        <section className="hidden lg:flex bg-[#2B59FF] text-white px-10 xl:px-14 py-12 flex-col justify-center gap-10">
          <TicketPreview />
          <p className="text-2xl sm:text-3xl font-extrabold wide max-w-md leading-tight">
            Join the line from your phone. Walk in when it's your turn.
          </p>
        </section>

        <section className="px-6 sm:px-12 py-10 flex items-center min-h-[calc(100vh-0.5rem)] lg:min-h-screen">
          <div className="w-full max-w-sm mx-auto">
            <Logo />
            <h2 className="text-2xl font-extrabold wide mt-8">{mode === 'login' ? 'Log in' : 'Create a student account'}</h2>
            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              {mode === 'register' && <Field label="Full name" value={form.name} onChange={set('name')} error={errors.name} autoComplete="name" />}
              <Field label="College email" type="email" value={form.email} onChange={set('email')} error={errors.email} autoComplete="email" />
              <Field label="Password" type="password" value={form.password} onChange={set('password')} error={errors.password} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
              <Alert onClose={() => setError('')}>{error}</Alert>
              <Button type="submit" variant="primary" className="w-full" busy={busy}>
                {mode === 'login' ? 'Log in' : 'Create account'}
              </Button>
            </form>
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setErrors({})
                setError('')
              }}
              className="mt-4 text-sm font-semibold underline underline-offset-4 min-h-[48px]"
            >
              {mode === 'login' ? 'New here? Create a student account' : 'Already have an account? Log in'}
            </button>

            <div className="mt-10 pt-6 border-t-2 border-line">
              <p className="text-sm text-muted mb-3">Demo accounts</p>
              <div className="flex flex-wrap gap-2">
                {DEMO.map((d) => (
                  <button
                    key={d.role}
                    type="button"
                    onClick={() => demoLogin(d)}
                    disabled={busy}
                    className="rounded-full px-5 min-h-[48px] text-sm font-bold active:scale-[0.98] disabled:opacity-50"
                    style={{ backgroundColor: d.bg, color: d.text }}
                  >
                    {d.role}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

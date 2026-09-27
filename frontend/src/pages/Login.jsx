import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { homeFor, useAuth } from '../lib/auth'
import { Alert, Button, Field, Logo } from '../components/ui'

const DEMO = [
  { role: 'Student', email: 'student@campus.edu', password: 'student123' },
  { role: 'Staff', email: 'staff@campus.edu', password: 'staff123' },
  { role: 'Admin', email: 'admin@campus.edu', password: 'admin123' },
]

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
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <section className="bg-ink text-white px-6 sm:px-12 py-10 flex flex-col justify-between gap-10">
        <Logo light />
        <div>
          <p className="text-white/60 text-lg">Now serving</p>
          <div className="numeral text-signal text-[8rem] sm:text-[11rem] -ml-1">C-042</div>
          <h1 className="text-3xl sm:text-4xl font-extrabold wide max-w-lg mt-4 leading-tight">
            Join the line from your phone. Walk in when it's your turn.
          </h1>
          <p className="text-white/70 mt-4 max-w-md">
            Live positions, predicted wait times, and an assistant that tells you which counter to visit and what to bring.
          </p>
        </div>
        <p className="text-white/40 text-sm">Certificates, ID cards, fees, exam cell and IT help, all in one queue system.</p>
      </section>

      <section className="px-6 sm:px-12 py-10 flex items-center">
        <div className="w-full max-w-sm mx-auto">
          <h2 className="text-2xl font-extrabold">{mode === 'login' ? 'Log in' : 'Create a student account'}</h2>
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
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setErrors({})
              setError('')
            }}
            className="mt-4 text-sm font-semibold underline underline-offset-4"
          >
            {mode === 'login' ? 'New here? Create a student account' : 'Already have an account? Log in'}
          </button>

          <div className="mt-10 pt-6 border-t border-line">
            <p className="text-sm text-muted mb-3">Demo accounts</p>
            <div className="grid grid-cols-3 gap-2">
              {DEMO.map((d) => (
                <Button key={d.role} variant="ghost" onClick={() => demoLogin(d)} disabled={busy} className="text-sm px-2">
                  {d.role}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

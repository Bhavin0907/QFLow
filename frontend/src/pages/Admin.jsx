import { useCallback, useEffect, useRef, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import { useLive } from '../lib/live'
import { Alert, Button, Field, Shell, Stat, formatMinutes, hourLabel } from '../components/ui'
import Heatmap from '../components/Heatmap'

const EMPTY = { name: '', code: '', counter: '', description: '', documents: '', keywords: '' }

export default function Admin() {
  const [overview, setOverview] = useState(null)
  const [insight, setInsight] = useState(null)
  const [services, setServices] = useState([])
  const [heatSid, setHeatSid] = useState(null)
  const [heat, setHeat] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retraining, setRetraining] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [formErrors, setFormErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const debounce = useRef(null)

  const load = useCallback(async () => {
    try {
      const [ov, svc] = await Promise.all([api('/api/admin/overview'), api('/api/services')])
      setOverview(ov)
      setServices(svc)
      setHeatSid((cur) => cur ?? svc[0]?.id ?? null)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  const loadInsight = useCallback(() => {
    setInsight(null)
    api('/api/admin/insight').then(setInsight).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    load()
    loadInsight()
  }, [load, loadInsight])

  useEffect(() => {
    if (!heatSid) return
    setHeat(null)
    api(`/api/services/${heatSid}/heatmap`).then(setHeat).catch((e) => setError(e.message))
  }, [heatSid])

  const live = useLive(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(load, 500)
  })

  const retrain = async () => {
    setRetraining(true)
    try {
      const m = await api('/api/admin/retrain', { method: 'POST' })
      setNotice(`Model retrained on ${m.trained_on.toLocaleString()} visits.`)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setRetraining(false)
    }
  }

  const createService = async (e) => {
    e.preventDefault()
    const errs = {}
    if (form.name.trim().length < 3) errs.name = 'At least 3 characters'
    if (!/^[A-Za-z]{1,2}$/.test(form.code.trim())) errs.code = '1 or 2 letters, used as the token prefix'
    setFormErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true)
    try {
      const split = (v) => v.split(',').map((x) => x.trim()).filter(Boolean)
      await api('/api/services', {
        method: 'POST',
        body: { ...form, code: form.code.trim(), documents: split(form.documents), keywords: split(form.keywords) },
      })
      setNotice(`${form.name} is live. Students can join it now.`)
      setForm(EMPTY)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const k = overview?.kpis
  const m = overview?.model

  return (
    <Shell live={live}>
      <h1 className="text-3xl font-extrabold wide">Operations overview</h1>
      <p className="text-muted mt-1">How every counter is doing today, and where the lines are longest.</p>

      <div className="mt-5 space-y-3">
        <Alert onClose={() => setError('')}>{error}</Alert>
        <Alert kind="ok" onClose={() => setNotice('')}>{notice}</Alert>
      </div>

      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Served today" value={k?.served_today} />
        <Stat label="Waiting right now" value={k?.waiting_now} />
        <Stat label="Average wait today" value={k?.avg_wait_today ? formatMinutes(k.avg_wait_today) : '–'} />
        <Stat label="No-shows today" value={k?.no_shows_today} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="bg-ink text-white rounded-2xl p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold text-lg">Daily insight</h2>
            {insight && (
              <span className="text-xs rounded-full bg-white/15 px-2.5 py-1">
                {insight.source === 'ai' ? 'Written by AI' : 'Auto-generated from stats'}
              </span>
            )}
          </div>
          {insight?.day && <p className="text-sm text-white/60">For {insight.day}</p>}
          {!insight ? (
            <p className="mt-4 text-white/60">Analysing yesterday's queues…</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {insight.lines.map((line, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full bg-signal shrink-0" />
                  <span className="leading-relaxed">{line}</span>
                </li>
              ))}
            </ul>
          )}
          <button onClick={loadInsight} className="mt-5 text-sm font-semibold underline underline-offset-4 text-white/80 hover:text-white">
            Regenerate
          </button>
        </section>

        <section className="bg-white rounded-2xl border border-line p-6">
          <h2 className="font-bold text-lg">Wait-time prediction model</h2>
          <p className="text-sm text-muted">Gradient-boosted trees trained on past visits: people ahead, hour, weekday and service.</p>
          {m ? (
            <>
              <div className="mt-5 flex items-end gap-6">
                <div>
                  <div className="numeral text-6xl text-go">{m.improvement_pct}%</div>
                  <div className="text-sm text-muted">more accurate than a simple average</div>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-mist p-3">
                  <dt className="text-muted">Model error</dt>
                  <dd className="font-bold">± {m.mae_model_min} min</dd>
                </div>
                <div className="rounded-lg bg-mist p-3">
                  <dt className="text-muted">Simple average error</dt>
                  <dd className="font-bold">± {m.mae_naive_min} min</dd>
                </div>
              </dl>
              <p className="text-xs text-muted mt-3">
                Trained on {m.trained_on.toLocaleString()} visits, tested on a held-out 20%. Last trained {m.trained_at}.
              </p>
            </>
          ) : (
            <p className="mt-4 text-sm text-muted">Not enough history yet. The model trains once 200 visits are recorded.</p>
          )}
          <Button variant="ghost" className="mt-4" onClick={retrain} busy={retraining}>
            Retrain with latest data
          </Button>
        </section>
      </div>

      <section className="mt-6 bg-white rounded-2xl border border-line p-6">
        <h2 className="font-bold text-lg">Last 14 days</h2>
        <div className="h-72 mt-4">
          {overview ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={overview.daily} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#d5dbe5" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fontSize: 12, fill: '#5b6478' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 12, fill: '#5b6478' }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: '#5b6478' }} unit="m" />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="served" name="Students served" fill="#15224a" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" dataKey="avg_wait" name="Avg wait (min)" stroke="#e5a800" strokeWidth={3} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full bg-mist rounded-xl animate-pulse" />
          )}
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="bg-white rounded-2xl border border-line p-6 overflow-x-auto">
          <h2 className="font-bold text-lg">Counters today</h2>
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="font-medium pb-2">Service</th>
                <th className="font-medium pb-2 text-right">Served</th>
                <th className="font-medium pb-2 text-right">Avg wait</th>
                <th className="font-medium pb-2 text-right">Peak</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {overview?.services.map((s) => (
                <tr key={s.service}>
                  <td className="py-2.5 font-semibold">{s.service}</td>
                  <td className="py-2.5 text-right">{s.served}</td>
                  <td className="py-2.5 text-right">{s.avg_wait ? formatMinutes(s.avg_wait) : '–'}</td>
                  <td className="py-2.5 text-right">{hourLabel(s.peak_hour)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="bg-white rounded-2xl border border-line p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold text-lg">Peak hours</h2>
            <label className="text-sm">
              <span className="sr-only">Service</span>
              <select
                value={heatSid ?? ''}
                onChange={(e) => setHeatSid(Number(e.target.value))}
                className="rounded-lg border border-line px-3 py-2 bg-white"
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4">
            <Heatmap data={heat} />
          </div>
        </section>
      </div>

      <section className="mt-6 bg-white rounded-2xl border border-line p-6">
        <h2 className="font-bold text-lg">Add a service</h2>
        <p className="text-sm text-muted">New counters appear for students immediately. Keywords help the assistant route questions here.</p>
        <form onSubmit={createService} noValidate className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Service name" value={form.name} onChange={set('name')} error={formErrors.name} placeholder="Library Desk" />
          <Field label="Token prefix" value={form.code} onChange={set('code')} error={formErrors.code} maxLength={2} placeholder="L" />
          <Field label="Counter location" value={form.counter} onChange={set('counter')} placeholder="Library, Ground Floor" />
          <Field label="Short description" value={form.description} onChange={set('description')} placeholder="Book returns, fines, membership" />
          <Field label="Documents to bring (comma separated)" value={form.documents} onChange={set('documents')} placeholder="College ID card, Library card" />
          <Field label="Assistant keywords (comma separated)" value={form.keywords} onChange={set('keywords')} placeholder="library, book, fine" />
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" busy={saving}>
              Add service
            </Button>
          </div>
        </form>
      </section>
    </Shell>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import { serviceColor } from '../lib/colors'
import { useLive } from '../lib/live'
import { Alert, Button, Field, Shell, Stat, formatMinutes, hourLabel } from '../components/ui'
import Heatmap from '../components/Heatmap'

const EMPTY = { name: '', code: '', counter: '', description: '', documents: '', keywords: '' }

function ErrorBars({ model, naive }) {
  const max = Math.max(model, naive, 1)
  const rows = [
    { label: 'Model', value: model, tone: 'bg-ink' },
    { label: 'Simple average', value: naive, tone: 'bg-muted' },
  ]
  return (
    <div className="mt-5 space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted">{r.label}</span>
            <span className="font-bold">± {r.value} min</span>
          </div>
          <div className="h-3 rounded-full bg-white overflow-hidden">
            <div className={`h-full rounded-full ${r.tone}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

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
  const heatService = services.find((s) => s.id === heatSid)
  const heatColors = heatService ? serviceColor(heatService) : null
  const totalServed = overview?.services?.reduce((sum, s) => sum + s.served, 0) || 0

  return (
    <Shell live={live}>
      <div className="space-y-3">
        <Alert onClose={() => setError('')}>{error}</Alert>
        <Alert kind="ok" onClose={() => setNotice('')}>{notice}</Alert>
      </div>

      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
        <Stat label="Served today" value={k?.served_today} />
        <Stat label="Waiting right now" value={k?.waiting_now} />
        <Stat label="Average wait today" value={k?.avg_wait_today ? formatMinutes(k.avg_wait_today) : '–'} />
        <Stat label="No-shows today" value={k?.no_shows_today} />
      </div>

      <section className="mt-8 rounded-3xl bg-lime text-ink p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-extrabold text-xl wide">Daily insight</h2>
          {insight && (
            <span className="text-xs font-bold rounded-full bg-ink/10 px-3 py-1">
              {insight.source === 'ai' ? 'Written by AI' : 'Auto-generated from stats'}
            </span>
          )}
        </div>
        {insight?.day && <p className="text-sm opacity-70 mt-1">For {insight.day}</p>}
        {!insight ? (
          <p className="mt-4 opacity-70">Analysing yesterday's queues…</p>
        ) : (
          <ul className="mt-5 space-y-3 text-base sm:text-lg leading-relaxed">
            {insight.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={loadInsight}
          className="mt-5 text-sm font-bold underline underline-offset-4 opacity-70 hover:opacity-100 min-h-[48px]"
        >
          Regenerate
        </button>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl bg-soft p-6 sm:p-8">
          <h2 className="font-bold text-lg">Wait-time model</h2>
          {m ? (
            <>
              <div className="numeral text-6xl sm:text-7xl mt-4">{m.improvement_pct}%</div>
              <p className="text-sm text-muted mt-1">more accurate than a simple average</p>
              <ErrorBars model={m.mae_model_min} naive={m.mae_naive_min} />
              <p className="text-xs text-muted mt-4">
                Trained on {m.trained_on.toLocaleString()} visits · last trained {m.trained_at}
              </p>
            </>
          ) : (
            <p className="mt-4 text-sm text-muted">Not enough history yet. The model trains once 200 visits are recorded.</p>
          )}
          <Button variant="primary" className="mt-5" onClick={retrain} busy={retraining}>
            Retrain
          </Button>
        </section>

        <section className="rounded-3xl bg-soft p-6 sm:p-8">
          <h2 className="font-bold text-lg">Last 14 days</h2>
          <div className="h-64 sm:h-72 mt-4">
            {overview ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={overview.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#E3E7EF" vertical={false} strokeDasharray="4 4" />
                  <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fontSize: 11, fill: '#5D6B82' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#5D6B82' }} axisLine={false} tickLine={false} width={40} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#5D6B82' }} axisLine={false} tickLine={false} width={40} unit="m" />
                  <Tooltip />
                  <Bar yAxisId="left" dataKey="served" name="Served" fill="#101828" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="right" dataKey="avg_wait" name="Avg wait" stroke="#E8196F" strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full bg-white rounded-xl animate-pulse" />
            )}
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl bg-soft p-6 sm:p-8">
          <h2 className="font-bold text-lg">Counters today</h2>
          <ul className="mt-5 space-y-5">
            {overview?.services.map((s, i) => {
              const svc = services.find((x) => x.name === s.service)
              const c = serviceColor(svc || { id: i, code: s.service?.[0] })
              const share = totalServed > 0 ? (s.served / totalServed) * 100 : 0
              return (
                <li key={s.service}>
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.bg }} aria-hidden />
                    <span className="font-bold flex-1 truncate">{s.service}</span>
                    <span className="numeral text-xl shrink-0">{s.served}</span>
                    <span className="text-sm text-muted shrink-0 w-16 text-right">{s.avg_wait ? formatMinutes(s.avg_wait) : '–'}</span>
                    <span className="text-sm text-muted shrink-0 w-14 text-right">{hourLabel(s.peak_hour)}</span>
                  </div>
                  <div className="mt-2 h-1 rounded-full bg-white overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: c.bg }} />
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-muted mt-4">Bar shows share of students served today.</p>
        </section>

        <section className="rounded-3xl bg-soft p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold text-lg">Peak hours</h2>
            <label className="text-sm">
              <span className="sr-only">Service</span>
              <select
                value={heatSid ?? ''}
                onChange={(e) => setHeatSid(Number(e.target.value))}
                className="min-h-[48px] rounded-xl border-2 border-line px-4 text-base bg-white"
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
            <Heatmap data={heat} colors={heatColors} />
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-3xl bg-soft p-6 sm:p-8">
        <h2 className="font-bold text-lg">Add a service</h2>
        <p className="text-sm text-muted mt-1">New counters appear for students immediately. Keywords help the assistant route questions here.</p>
        <form onSubmit={createService} noValidate className="mt-5 grid gap-4 sm:grid-cols-2">
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

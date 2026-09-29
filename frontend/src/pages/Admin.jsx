import { useCallback, useEffect, useRef, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import { serviceColor } from '../lib/colors'
import { useLive } from '../lib/live'
import { Alert, Button, Field, Shell, Stat, formatMinutes, hourLabel } from '../components/ui'
import Heatmap from '../components/Heatmap'
import RushAlerts from '../components/RushAlerts'

const EMPTY = { name: '', code: '', counter: '', description: '', documents: '', keywords: '' }

function ServiceDocsEditor({ service, onSaved, onError }) {
  const [docs, setDocs] = useState((service.documents || []).join(', '))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDocs((service.documents || []).join(', '))
  }, [service.id, service.documents])

  const save = async () => {
    setSaving(true)
    try {
      const split = docs.split(',').map((x) => x.trim()).filter(Boolean)
      await api(`/api/services/${service.id}`, { method: 'PATCH', body: { documents: split } })
      onSaved?.(`${service.name} documents updated.`)
    } catch (e) {
      onError?.(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="rounded-2xl bg-white p-4 space-y-3">
      <div>
        <p className="font-bold">{service.name}</p>
        <p className="text-xs text-muted">{service.counter}</p>
      </div>
      <Field
        label="Documents to bring (comma separated)"
        value={docs}
        onChange={(e) => setDocs(e.target.value)}
        placeholder="College ID card, Fee receipt"
      />
      <Button variant="ghost" busy={saving} onClick={save}>
        Save documents
      </Button>
    </li>
  )
}

function EtaAccuracyCard({ data }) {
  if (!data) return <div className="h-64 bg-white rounded-xl animate-pulse mt-4" />
  if (!data.count) {
    return (
      <p className="mt-4 text-sm text-muted">
        No completed tokens with logged predictions yet today. Accuracy appears once students are called.
      </p>
    )
  }
  return (
    <>
      <div className="mt-4 flex flex-wrap items-end gap-6">
        <div>
          <div className="numeral text-5xl sm:text-6xl">{data.improvement_pct}%</div>
          <p className="text-sm text-muted mt-1">better than naive today</p>
        </div>
        <div className="text-sm space-y-1">
          <p>
            <span className="text-muted">Model MAE:</span>{' '}
            <span className="font-bold">± {data.mae_model_min} min</span>
          </p>
          <p>
            <span className="text-muted">Naive MAE:</span>{' '}
            <span className="font-bold">± {data.mae_naive_min} min</span>
          </p>
          <p className="text-muted">{data.count} tokens logged today</p>
        </div>
      </div>
      {(data.by_type?.walk_in?.count > 0 || data.by_type?.booked?.count > 0) && (
        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          {data.by_type.walk_in.count > 0 && (
            <span className="rounded-full bg-white px-3 py-1.5 font-semibold">
              Walk-in: ± {data.by_type.walk_in.mae_model_min} vs ± {data.by_type.walk_in.mae_naive_min} min
            </span>
          )}
          {data.by_type.booked.count > 0 && (
            <span className="rounded-full bg-white px-3 py-1.5 font-semibold">
              Booked: ± {data.by_type.booked.mae_model_min} vs ± {data.by_type.booked.mae_naive_min} min
            </span>
          )}
        </div>
      )}
      <div className="h-52 sm:h-60 mt-5">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#E3E7EF" vertical={false} strokeDasharray="4 4" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#5D6B82' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: '#5D6B82' }} axisLine={false} tickLine={false} width={36} unit="m" />
            <Tooltip />
            <Line type="monotone" dataKey="predicted" name="Predicted" stroke="#2B59FF" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="actual" name="Actual" stroke="#E8196F" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="naive" name="Naive" stroke="#5D6B82" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted mt-2">Predicted vs actual wait for today's last {data.chart.length} completed tokens.</p>
    </>
  )
}

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
  const [aiStatus, setAiStatus] = useState(null)
  const [services, setServices] = useState([])
  const [heatSid, setHeatSid] = useState(null)
  const [heat, setHeat] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retraining, setRetraining] = useState(false)
  const [resettingDemo, setResettingDemo] = useState(false)
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

  const loadInsight = useCallback((refresh = false) => {
    setInsight(null)
    const q = refresh ? '?refresh=true' : ''
    api(`/api/admin/insight${q}`).then(setInsight).catch((e) => setError(e.message))
  }, [])

  const loadAiStatus = useCallback(() => {
    api('/api/ai/status').then(setAiStatus).catch(() => setAiStatus({ reachable: false }))
  }, [])

  useEffect(() => {
    load()
    loadInsight()
    loadAiStatus()
  }, [load, loadInsight, loadAiStatus])

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

  const resetDemo = async () => {
    if (!window.confirm("Reset today's live queues? Historical training data is kept.")) return
    setResettingDemo(true)
    try {
      const res = await api('/api/admin/reset-demo', { method: 'POST' })
      const lines = res.services.map((s) => `${s.name}: ${s.waiting} waiting`).join(', ')
      setNotice(`Live demo reset (IST ${res.server_now}). ${lines}`)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setResettingDemo(false)
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
  const eta = overview?.eta_accuracy
  const heatService = services.find((s) => s.id === heatSid)
  const heatColors = heatService ? serviceColor(heatService) : null
  const totalServed = overview?.services?.reduce((sum, s) => sum + s.served, 0) || 0

  return (
    <Shell live={live}>
      <div className="space-y-3">
        <RushAlerts alerts={overview?.rush_alerts} />
        {aiStatus && (
          <p className="text-xs font-bold">
            <span
              className={`inline-block rounded-full px-3 py-1 ${
                aiStatus.reachable ? 'bg-lime text-ink' : 'bg-soft text-muted'
              }`}
            >
              {aiStatus.reachable ? 'AI: Local (Ollama)' : 'AI: Offline fallback'}
            </span>
          </p>
        )}
        <Alert onClose={() => setError('')}>{error}</Alert>
        <Alert kind="ok" onClose={() => setNotice('')}>{notice}</Alert>
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8 flex-1">
          <Stat label="Served today" value={k?.served_today} />
          <Stat label="Waiting right now" value={k?.waiting_now} />
          <Stat label="Average wait today" value={k?.avg_wait_today ? formatMinutes(k.avg_wait_today) : '–'} />
          <Stat label="No-shows today" value={k?.no_shows_today} />
        </div>
        <Button variant="ghost" onClick={resetDemo} busy={resettingDemo}>
          Reset demo data
        </Button>
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
          onClick={() => loadInsight(true)}
          className="mt-5 text-sm font-bold underline underline-offset-4 opacity-70 hover:opacity-100 min-h-[48px]"
        >
          Refresh insights
        </button>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl bg-soft p-6 sm:p-8">
          <h2 className="font-bold text-lg">Wait-time model</h2>
          <p className="text-xs text-muted mt-1">Held-out test set (20% of history)</p>
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
          <h2 className="font-bold text-lg">ETA accuracy</h2>
          <p className="text-xs text-muted mt-1">Live from today's logged predictions</p>
          <EtaAccuracyCard data={eta} />
        </section>
      </div>

      <section className="mt-6 rounded-3xl bg-soft p-6 sm:p-8">
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
        <h2 className="font-bold text-lg">Edit service documents</h2>
        <p className="text-sm text-muted mt-1">Students must confirm these before joining or booking a slot.</p>
        <ul className="mt-5 space-y-3">
          {services.map((s) => (
            <ServiceDocsEditor
              key={s.id}
              service={s}
              onSaved={(msg) => {
                setNotice(msg)
                load()
              }}
              onError={setError}
            />
          ))}
        </ul>
      </section>

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

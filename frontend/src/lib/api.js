// Thin fetch wrapper: attaches the JWT, turns API errors into readable messages.
const BASE = import.meta.env.VITE_API_URL || ''

export function getToken() {
  return localStorage.getItem('qf_token')
}

function readError(data, status) {
  if (!data) return `Request failed (${status})`
  if (typeof data.detail === 'string') return data.detail
  if (Array.isArray(data.detail)) {
    // FastAPI/Pydantic validation errors
    return data.detail
      .map((d) => {
        const field = d.loc?.[d.loc.length - 1]
        const msg = (d.msg || '').replace(/^Value error, /, '')
        return field && field !== 'body' ? `${field}: ${msg}` : msg
      })
      .join('. ')
  }
  return `Request failed (${status})`
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.")
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(readError(data, res.status))
    err.status = res.status
    throw err
  }
  return data
}

export function wsUrl() {
  if (BASE) return BASE.replace(/^http/, 'ws') + '/ws'
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/ws`
}

export function joinUrl(serviceId, origin = window.location.origin) {
  return `${origin}/join/${serviceId}`
}

import { useEffect, useState } from 'react'
import { api } from './api'

export function isLocalhost(origin) {
  try {
    const { hostname } = new URL(origin)
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    )
  } catch {
    return false
  }
}

let cachedOrigin = null
let fetchPromise = null

function resolvePublicOrigin() {
  const envUrl = import.meta.env.VITE_PUBLIC_URL?.replace(/\/$/, '')
  if (envUrl) {
    cachedOrigin = envUrl
    return Promise.resolve(envUrl)
  }

  const current = window.location.origin
  if (!isLocalhost(current)) {
    cachedOrigin = current
    return Promise.resolve(current)
  }

  if (cachedOrigin) return Promise.resolve(cachedOrigin)
  if (fetchPromise) return fetchPromise

  fetchPromise = api('/api/network')
    .then(({ lan_ip }) => {
      if (lan_ip) {
        const { protocol, port } = window.location
        cachedOrigin = `${protocol}//${lan_ip}${port ? `:${port}` : ''}`
      } else {
        cachedOrigin = current
      }
      return cachedOrigin
    })
    .catch(() => {
      cachedOrigin = current
      return current
    })

  return fetchPromise
}

export function usePublicOrigin() {
  const [origin, setOrigin] = useState(window.location.origin)

  useEffect(() => {
    resolvePublicOrigin().then(setOrigin)
  }, [])

  return origin
}

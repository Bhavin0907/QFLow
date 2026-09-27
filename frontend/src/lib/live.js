import { useEffect, useRef, useState } from 'react'
import { wsUrl } from './api'

// Subscribes to server push events. Reconnects automatically with backoff,
// so a Wi-Fi blip during the demo heals itself.
export function useLive(onMessage) {
  const handler = useRef(onMessage)
  handler.current = onMessage
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let ws
    let retry = 0
    let closed = false
    let ping
    let timer

    const open = () => {
      ws = new WebSocket(wsUrl())
      ws.onopen = () => {
        retry = 0
        setConnected(true)
        ping = setInterval(() => ws.readyState === 1 && ws.send('ping'), 25000)
        handler.current?.({ type: 'reconnected' })
      }
      ws.onmessage = (e) => {
        try {
          handler.current?.(JSON.parse(e.data))
        } catch {
          /* ignore malformed */
        }
      }
      ws.onclose = () => {
        setConnected(false)
        clearInterval(ping)
        if (!closed) timer = setTimeout(open, Math.min(8000, 500 * 2 ** retry++))
      }
      ws.onerror = () => ws.close()
    }
    open()
    return () => {
      closed = true
      clearTimeout(timer)
      clearInterval(ping)
      ws?.close()
    }
  }, [])

  return connected
}

// Short two-tone chime via Web Audio (no sound files needed)
export function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;[880, 1320].forEach((freq, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = freq
      o.connect(g)
      g.connect(ctx.destination)
      const t = ctx.currentTime + i * 0.22
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
      o.start(t)
      o.stop(t + 0.45)
    })
  } catch {
    /* audio not available */
  }
}

export function notify(title, body) {
  chime()
  if (navigator.vibrate) navigator.vibrate([200, 100, 200])
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body })
    } catch {
      /* some mobile browsers only allow notifications from a service worker */
    }
  }
}

export function askNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {})
  }
}

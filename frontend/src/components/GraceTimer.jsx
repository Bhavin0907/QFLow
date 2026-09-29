import { useEffect, useState } from 'react'

export default function GraceTimer({ secondsLeft, responded, variant = 'staff' }) {
  const [left, setLeft] = useState(secondsLeft ?? 0)

  useEffect(() => {
    setLeft(secondsLeft ?? 0)
  }, [secondsLeft])

  useEffect(() => {
    if (responded || left <= 0) return
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [responded, left > 0])

  if (responded) {
    return (
      <p className={`text-sm font-bold ${variant === 'staff' ? 'opacity-90' : 'text-ink'}`}>
        Student confirmed — at the counter
      </p>
    )
  }

  const mins = Math.floor(left / 60)
  const secs = left % 60
  const urgent = left <= 10

  return (
    <div
      role="timer"
      className={`rounded-2xl px-4 py-3 ${
        variant === 'staff'
          ? urgent
            ? 'bg-white/25 ring-2 ring-white/50'
            : 'bg-white/15'
          : urgent
            ? 'bg-ink/10 ring-2 ring-ink/20'
            : 'bg-white/60'
      }`}
    >
      <p className={`text-xs font-semibold uppercase tracking-wide ${variant === 'staff' ? 'opacity-80' : 'text-muted'}`}>
        Grace period
      </p>
      <p className={`numeral text-3xl font-extrabold mt-1 ${urgent ? (variant === 'staff' ? 'text-white' : 'text-danger') : ''}`}>
        {mins}:{secs.toString().padStart(2, '0')}
      </p>
      <p className={`text-xs mt-1 ${variant === 'staff' ? 'opacity-70' : 'text-muted'}`}>
        {left > 0 ? 'Waiting for student to confirm' : 'Grace expired — auto no-show'}
      </p>
    </div>
  )
}

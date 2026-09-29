const TZ = 'Asia/Kolkata'

/** Parse a naive IST slot string from the API. */
export function parseIst(naive) {
  return new Date(`${naive.replace(' ', 'T')}+05:30`)
}

export function formatSlotTime(naive) {
  return parseIst(naive).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  })
}

export function todayIstDateStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

export function dayLabel(dateStr, index) {
  const today = todayIstDateStr()
  if (dateStr === today) return 'Today'
  const tomorrow = bookableDates(2)[1]
  if (dateStr === tomorrow) return 'Tomorrow'
  const d = parseIst(`${dateStr} 12:00:00`)
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })
}

/** Mirror backend: up to 3 dates from today, skipping Sundays (IST). */
export function bookableDates(count = 3) {
  const dates = []
  const cursor = new Date()
  while (dates.length < count) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(cursor)
    const y = parts.find((p) => p.type === 'year').value
    const m = parts.find((p) => p.type === 'month').value
    const d = parts.find((p) => p.type === 'day').value
    const iso = `${y}-${m}-${d}`
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(cursor)
    if (weekday !== 'Sun') dates.push(iso)
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

export function nextBookableDate(currentDate, dates = bookableDates(3)) {
  const i = dates.indexOf(currentDate)
  return i >= 0 && i < dates.length - 1 ? dates[i + 1] : dates[1] || dates[0]
}

export const EMPTY_SLOT_COPY = {
  closed_today: 'Office closed for today.',
  closed_sunday: 'Office is closed on Sundays.',
  all_full: 'All slots on this day are full.',
  all_past: 'All remaining slots today have passed.',
  past_date: 'This date is no longer bookable.',
  unavailable: 'No slots available on this day.',
}

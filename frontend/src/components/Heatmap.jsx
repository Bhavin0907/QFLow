import { hourLabel } from './ui'

// Weekday x hour grid of average waits. Darker = longer wait.
export default function Heatmap({ data, highlight }) {
  if (!data) return <div className="h-48 rounded-xl bg-white border border-line animate-pulse" />
  const values = data.cells.map((c) => c.avg_wait).filter((v) => v !== null)
  const max = Math.max(...values, 1)

  const color = (v) => {
    if (v === null) return 'transparent'
    const t = Math.min(1, v / max)
    // interpolate mist (237,240,244) -> ink (21,34,74)
    const mix = (a, b) => Math.round(a + (b - a) * t)
    return `rgb(${mix(237, 21)}, ${mix(240, 34)}, ${mix(244, 74)})`
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-xs" aria-label="Average wait by day and hour">
        <thead>
          <tr>
            <th />
            {data.hours.map((h) => (
              <th key={h} scope="col" className="font-medium text-muted px-1 whitespace-nowrap">
                {hourLabel(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.days.map((day) => (
            <tr key={day}>
              <th scope="row" className="font-medium text-muted pr-2 text-left">
                {day}
              </th>
              {data.hours.map((h) => {
                const cell = data.cells.find((c) => c.day === day && c.hour === h)
                const v = cell?.avg_wait ?? null
                const isBest = highlight && highlight.day === day && highlight.hour === h
                return (
                  <td
                    key={h}
                    title={v === null ? 'Closed or no data' : `${day} ${hourLabel(h)}: about ${Math.round(v)} min wait`}
                    className={`w-10 h-8 rounded-md text-center align-middle ${v === null ? 'border border-dashed border-line' : ''} ${isBest ? 'ring-2 ring-go ring-offset-1' : ''}`}
                    style={{ background: color(v), color: v !== null && v / max > 0.5 ? '#fff' : '#15224a' }}
                  >
                    {v === null ? '' : Math.round(v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted mt-2">Average minutes waited, from the last 30 days. Green outline marks the quietest slot.</p>
    </div>
  )
}

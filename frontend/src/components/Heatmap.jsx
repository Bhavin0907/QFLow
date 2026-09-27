import { hourLabel } from './ui'

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export default function Heatmap({ data, highlight, colors }) {
  if (!data) return <div className="h-48 rounded-xl bg-soft animate-pulse" />
  const values = data.cells.map((c) => c.avg_wait).filter((v) => v !== null)
  const max = Math.max(...values, 1)
  const soft = hexToRgb(colors?.soft || '#F4F5F9')
  const bg = hexToRgb(colors?.bg || '#101828')

  const color = (v) => {
    if (v === null) return 'transparent'
    const t = Math.min(1, v / max)
    const mix = (a, b) => Math.round(a + (b - a) * t)
    return `rgb(${mix(soft[0], bg[0])}, ${mix(soft[1], bg[1])}, ${mix(soft[2], bg[2])})`
  }

  const textOn = (v) => {
    if (v === null) return '#101828'
    const t = Math.min(1, v / max)
    return t > 0.55 ? (colors?.text === '#FFFFFF' ? '#FFFFFF' : colors?.text || '#FFFFFF') : '#101828'
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
                    className={`w-10 h-8 rounded-md text-center align-middle ${v === null ? 'border border-dashed border-line' : ''} ${isBest ? 'ring-2 ring-lime ring-offset-1' : ''}`}
                    style={{ background: color(v), color: textOn(v) }}
                  >
                    {v === null ? '' : Math.round(v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted mt-2">Average minutes waited, from the last 30 days. Lime outline marks the quietest slot.</p>
    </div>
  )
}

import { useEffect, useState } from 'react'

export default function DocumentChecklist({ documents, confirmed, onConfirmedChange, tone = 'light' }) {
  const [checked, setChecked] = useState({})
  const list = documents || []
  const allChecked = list.length === 0 || list.every((d) => checked[d])

  useEffect(() => {
    setChecked({})
  }, [list.join('|')])

  useEffect(() => {
    if (confirmed && !allChecked) onConfirmedChange?.(false)
  }, [allChecked, confirmed, onConfirmedChange])

  if (!list.length) return null

  const boxClass =
    tone === 'dark'
      ? 'rounded-2xl bg-white/15 border-2 border-white/30 p-4'
      : 'rounded-2xl bg-soft border-2 border-line p-4'

  return (
    <div className="mt-4">
      <h3 className={`text-sm font-bold mb-2 ${tone === 'dark' ? 'opacity-90' : ''}`}>Required documents</h3>
      <div className={boxClass}>
        <ul className="space-y-1">
          {list.map((doc) => (
            <li key={doc}>
              <label className="flex items-center gap-3 text-sm cursor-pointer min-h-[44px]">
                <input
                  type="checkbox"
                  className="w-5 h-5 accent-ink shrink-0"
                  checked={!!checked[doc]}
                  onChange={(e) => setChecked((c) => ({ ...c, [doc]: e.target.checked }))}
                />
                <span className={checked[doc] ? 'line-through opacity-70' : ''}>{doc}</span>
              </label>
            </li>
          ))}
        </ul>
        <label className="flex items-start gap-3 mt-4 pt-3 border-t border-line/60 cursor-pointer min-h-[44px]">
          <input
            type="checkbox"
            className="w-5 h-5 accent-ink shrink-0 mt-0.5"
            checked={!!confirmed}
            disabled={!allChecked}
            onChange={(e) => onConfirmedChange?.(e.target.checked)}
          />
          <span className={`text-sm font-semibold ${!allChecked ? 'text-muted' : ''}`}>
            I confirm I have all required documents with me
          </span>
        </label>
      </div>
    </div>
  )
}

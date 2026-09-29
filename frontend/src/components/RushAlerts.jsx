export default function RushAlerts({ alerts, compact = false }) {
  if (!alerts?.length) return null
  return (
    <div className={`space-y-2 ${compact ? '' : 'mt-4'}`} aria-live="polite">
      {alerts.map((a) => (
        <div
          key={a.service_id}
          role="alert"
          className="rounded-2xl border-2 border-[#FF7A00] bg-[#FFF0E0] text-ink px-4 py-3 sm:px-5 sm:py-4"
        >
          <p className="text-sm font-bold uppercase tracking-wide text-[#FF7A00]">Rush warning</p>
          <p className="font-extrabold text-base sm:text-lg wide mt-1 leading-snug">{a.message}</p>
          {!compact && (
            <p className="text-sm text-muted mt-1">
              {a.waiting_now} waiting now · peak forecast ~{Math.round(a.peak_wait_min)} min (threshold {a.threshold_min} min)
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

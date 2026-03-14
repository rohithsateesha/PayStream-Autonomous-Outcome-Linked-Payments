import { useEffect, useRef } from 'react'

const ACTION_STYLE = {
  charged: {
    row: 'border-l-2 border-emerald-500 bg-emerald-950/30',
    badge: 'bg-emerald-900/60 text-emerald-400',
    icon: '✓',
    label: 'CHARGED',
    amount: 'text-emerald-400',
  },
  paused: {
    row: 'border-l-2 border-red-500 bg-red-950/30',
    badge: 'bg-red-900/60 text-red-400',
    icon: '✗',
    label: 'PAUSED',
    amount: 'text-red-400',
  },
  reduced: {
    row: 'border-l-2 border-amber-500 bg-amber-950/20',
    badge: 'bg-amber-900/60 text-amber-400',
    icon: '↓',
    label: 'REDUCED',
    amount: 'text-amber-400',
  },
}

export default function PaymentLog({ events }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])

  const reversed = [...events].reverse()

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold text-sm">Payment Log</h3>
        <span className="text-gray-500 text-xs">
          {events.filter(e => e.action_taken).length} intervals
        </span>
      </div>

      {events.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
          Session not started yet…
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1" style={{ maxHeight: '340px' }}>
          {reversed.map((e, i) => {
            // ── Incident events get special full-width rows ──────────────
            if (e.type === 'incident_declared') {
              const severityColor = {
                minor:    'border-amber-500  bg-amber-950/40  text-amber-300',
                major:    'border-red-500    bg-red-950/50    text-red-300',
                critical: 'border-red-400    bg-red-950/70    text-red-200',
              }[e.severity] ?? 'border-red-500 bg-red-950/40 text-red-300'

              return (
                <div key={i} className={`rounded-lg px-3 py-2.5 border-l-4 ${severityColor}`}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-bold uppercase tracking-wide">
                      ⚠ INCIDENT DECLARED — {e.severity?.toUpperCase()}
                    </span>
                    <span className="ml-auto text-xs opacity-60">₹{e.estimated_impact_inr?.toFixed(2)} at risk</span>
                  </div>
                  <p className="text-xs opacity-80">{e.assessment}</p>
                  <p className="text-xs opacity-50 mt-0.5">
                    Recommended: {e.recommended_action === 'continue_monitoring' ? 'Continue monitoring' : 'Request termination'}
                  </p>
                </div>
              )
            }

            if (e.type === 'incident_resolved') {
              return (
                <div key={i} className="rounded-lg px-3 py-2.5 border-l-4 border-emerald-400 bg-emerald-950/40 text-emerald-300">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wide">✓ INCIDENT RESOLVED</span>
                  </div>
                  <p className="text-xs opacity-80 mt-0.5">{e.message}</p>
                </div>
              )
            }

            if (e.type === 'observation') {
              return (
                <div key={i} className="rounded-lg px-3 py-1.5 border-l-2 border-indigo-600 bg-indigo-950/20">
                  <span className="text-indigo-400 text-xs">
                    👁 Observing — {e.charge_rate} kW at {Math.round(e.elapsed_seconds)}s
                  </span>
                </div>
              )
            }

            // ── Normal payment events ────────────────────────────────────
            if (!e.action_taken) return null
            const style = ACTION_STYLE[e.action_taken] ?? ACTION_STYLE.charged

            return (
              <div key={i} className={`rounded-lg px-3 py-2.5 ${style.row} transition-all duration-300`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${style.badge} shrink-0`}>
                      {style.icon} {style.label}
                    </span>
                    <span className="text-gray-400 text-xs shrink-0">{e.metric_value ?? e.charge_rate} {e.unit ?? 'kW'}</span>
                    <span className="text-gray-500 text-xs truncate hidden sm:block">{e.reason}</span>
                  </div>
                  <span className={`text-xs font-semibold shrink-0 ${style.amount}`}>
                    ₹{e.amount_charged?.toFixed(2)}
                  </span>
                </div>
                <p className="text-gray-500 text-xs mt-1 sm:hidden truncate">{e.reason}</p>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Running total */}
      {events.some(e => e.action_taken) && (
        <div className="mt-3 pt-3 border-t border-gray-800 flex justify-between text-xs">
          <span className="text-gray-500">Total charged so far</span>
          <span className="text-white font-semibold">
            ₹{events.reduce((s, e) => s + (e.amount_charged ?? 0), 0).toFixed(2)}
          </span>
        </div>
      )}
    </div>
  )
}

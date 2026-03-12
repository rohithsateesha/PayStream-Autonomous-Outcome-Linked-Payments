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
        <span className="text-gray-500 text-xs">{events.length} intervals</span>
      </div>

      {events.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
          Session not started yet…
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1" style={{ maxHeight: '340px' }}>
          {reversed.map((e, i) => {
            const style = ACTION_STYLE[e.action_taken] ?? ACTION_STYLE.charged
            return (
              <div
                key={i}
                className={`rounded-lg px-3 py-2.5 ${style.row} transition-all duration-300`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${style.badge} shrink-0`}>
                      {style.icon} {style.label}
                    </span>
                    <span className="text-gray-400 text-xs shrink-0">
                      {e.charge_rate} kW
                    </span>
                    <span className="text-gray-500 text-xs truncate hidden sm:block">
                      {e.reason}
                    </span>
                  </div>
                  <span className={`text-xs font-semibold shrink-0 ${style.amount}`}>
                    ₹{e.amount_charged.toFixed(2)}
                  </span>
                </div>
                {/* Reason on second line for small screens */}
                <p className="text-gray-500 text-xs mt-1 sm:hidden truncate">{e.reason}</p>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Running total */}
      {events.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-800 flex justify-between text-xs">
          <span className="text-gray-500">Total charged so far</span>
          <span className="text-white font-semibold">
            ₹{events.reduce((s, e) => s + e.amount_charged, 0).toFixed(2)}
          </span>
        </div>
      )}
    </div>
  )
}

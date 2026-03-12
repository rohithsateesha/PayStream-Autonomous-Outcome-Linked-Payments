import { useEffect, useState, useRef } from 'react'
import TelemetryChart from './TelemetryChart'
import PaymentLog from './PaymentLog'
import SettlementView from './SettlementView'

const WS_BASE = 'ws://localhost:8000'

export default function SessionDashboard({ sessionId, threshold, onReset }) {
  const [events, setEvents] = useState([])
  const [sessionDone, setSessionDone] = useState(false)
  const [wsStatus, setWsStatus] = useState('connecting')
  const wsRef = useRef(null)

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}/ws/${sessionId}`)
    wsRef.current = ws

    ws.onopen = () => setWsStatus('connected')

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'session_complete') {
        setSessionDone(true)
        return
      }
      setEvents(prev => [...prev, msg])
    }

    ws.onerror = () => setWsStatus('error')
    ws.onclose = () => setWsStatus('closed')

    return () => ws.close()
  }, [sessionId])

  // Stats derived from events
  const charged = events.filter(e => e.action_taken === 'charged').length
  const paused  = events.filter(e => e.action_taken === 'paused').length
  const totalCharged = events.reduce((s, e) => s + e.amount_charged, 0)
  const lastEvent = events[events.length - 1]

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⚡</span>
          <div>
            <h1 className="text-white font-bold text-lg">PayStream</h1>
            <p className="text-gray-500 text-xs">Session {sessionId}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* WS status indicator */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`w-2 h-2 rounded-full ${
              wsStatus === 'connected' ? 'bg-emerald-400 animate-pulse' :
              wsStatus === 'error' || wsStatus === 'closed' ? 'bg-red-400' :
              'bg-amber-400'
            }`} />
            <span className="text-gray-500 capitalize">{wsStatus}</span>
          </div>

          {sessionDone && (
            <span className="text-xs bg-indigo-900/60 text-indigo-400 px-2 py-1 rounded-lg">
              Session complete
            </span>
          )}
        </div>
      </div>

      {/* Live stats strip */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Current Rate', value: lastEvent ? `${lastEvent.charge_rate} kW` : '—', color: 'text-white' },
          { label: 'Charged', value: charged, color: 'text-emerald-400' },
          { label: 'Paused', value: paused, color: 'text-red-400' },
          { label: 'Total Billed', value: `₹${totalCharged.toFixed(2)}`, color: 'text-amber-400' },
        ].map(stat => (
          <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
            <p className="text-gray-500 text-xs mb-1">{stat.label}</p>
            <p className={`font-bold text-base ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Last AI decision */}
      {lastEvent && (
        <div className={`rounded-xl px-4 py-2.5 mb-4 text-sm border transition-all duration-500 ${
          lastEvent.action_taken === 'paused'
            ? 'bg-red-950/40 border-red-800 text-red-300'
            : lastEvent.action_taken === 'reduced'
            ? 'bg-amber-950/30 border-amber-800 text-amber-300'
            : 'bg-emerald-950/30 border-emerald-800 text-emerald-300'
        }`}>
          <span className="font-medium">Agent: </span>
          {lastEvent.reason}
        </div>
      )}

      {/* Chart + Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <TelemetryChart events={events} threshold={threshold} />
        <PaymentLog events={events} />
      </div>

      {/* Settlement */}
      {sessionDone && (
        <SettlementView sessionId={sessionId} onReset={onReset} />
      )}

      {/* Manual settle button (in case WebSocket misses session_complete) */}
      {!sessionDone && events.length > 0 && (
        <div className="text-center mt-2">
          <button
            onClick={() => setSessionDone(true)}
            className="text-gray-600 hover:text-gray-400 text-xs underline"
          >
            Force settle (if session seems stuck)
          </button>
        </div>
      )}
    </div>
  )
}

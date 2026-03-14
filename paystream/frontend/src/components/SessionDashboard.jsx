import { useEffect, useState, useRef } from 'react'
import TelemetryChart from './TelemetryChart'
import PaymentLog from './PaymentLog'
import SettlementView from './SettlementView'

const WS_BASE = 'ws://localhost:8000'

export default function SessionDashboard({ sessionId, threshold, ruleText, agentDerived, useCaseDescription, metricKey = 'charge_rate', metricUnit = 'kW', onReset }) {
  const [events, setEvents] = useState([])
  const [sessionDone, setSessionDone] = useState(false)
  const [wsStatus, setWsStatus] = useState('connecting')
  const [activeIncident, setActiveIncident] = useState(null)   // current incident event
  const [incidentCount, setIncidentCount] = useState(0)
  const wsRef = useRef(null)

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}/ws/${sessionId}`)
    wsRef.current = ws

    ws.onopen = () => setWsStatus('connected')

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)

      if (msg.type === 'session_complete') {
        setSessionDone(true)
        setActiveIncident(null)
        return
      }
      if (msg.type === 'incident_declared') {
        setActiveIncident(msg)
        setIncidentCount(n => n + 1)
      }
      if (msg.type === 'incident_resolved') {
        setActiveIncident(null)
      }

      setEvents(prev => [...prev, msg])
    }

    ws.onerror = () => setWsStatus('error')
    ws.onclose = () => setWsStatus('closed')

    return () => ws.close()
  }, [sessionId])

  // Stats derived from payment events only
  const paymentEvents = events.filter(e => e.action_taken)
  const charged = paymentEvents.filter(e => e.action_taken === 'charged').length
  const paused  = paymentEvents.filter(e => e.action_taken === 'paused').length
  const totalCharged = paymentEvents.reduce((s, e) => s + e.amount_charged, 0)
  const lastPayment = [...paymentEvents].pop()

  // Severity colors for incident banner
  const incidentColor = {
    minor:    'bg-amber-900/50 border-amber-600 text-amber-200',
    major:    'bg-red-900/60  border-red-600   text-red-200',
    critical: 'bg-red-950/80  border-red-500   text-red-100',
  }[activeIncident?.severity] ?? 'bg-red-900/60 border-red-600 text-red-200'

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⚡</span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-white font-bold text-lg">PayStream</h1>
              {agentDerived && (
                <span className="text-xs bg-indigo-900/60 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-700">
                  🤖 Agent-derived rule
                </span>
              )}
            </div>
            <p className="text-gray-500 text-xs">Session {sessionId}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`w-2 h-2 rounded-full ${
              wsStatus === 'connected' ? 'bg-emerald-400 animate-pulse' :
              wsStatus === 'error' || wsStatus === 'closed' ? 'bg-red-400' : 'bg-amber-400'
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

      {/* Rule reminder */}
      {ruleText && (
        <div className="mb-4 bg-gray-900 border border-gray-800 rounded-xl px-4 py-2 text-xs text-gray-400 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-gray-600 mr-2">Active rule:</span>
            <span className="text-gray-300 italic">"{ruleText}"</span>
          </div>
          {useCaseDescription && (
            <span className="shrink-0 text-gray-600 border border-gray-700 rounded-lg px-2 py-0.5">
              {useCaseDescription}
            </span>
          )}
        </div>
      )}

      {/* ── Incident Banner (Feature 2) ─────────────────────────────────── */}
      {activeIncident && (
        <div className={`rounded-xl px-4 py-3 mb-4 border animate-pulse ${incidentColor}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠</span>
              <span className="font-bold text-sm uppercase tracking-wide">
                INCIDENT DECLARED — {activeIncident.severity?.toUpperCase()}
              </span>
            </div>
            <span className="text-sm font-semibold">
              ₹{activeIncident.estimated_impact_inr?.toFixed(2)} at risk
            </span>
          </div>
          <p className="text-sm opacity-80 mt-1">{activeIncident.assessment}</p>
          <p className="text-xs opacity-50 mt-0.5">
            Agent recommendation: {
              activeIncident.recommended_action === 'continue_monitoring'
                ? 'Continuing to monitor — payment withheld until quality restores'
                : 'Recommending session termination due to critical failure'
            }
          </p>
        </div>
      )}

      {/* Incident resolved banner */}
      {!activeIncident && incidentCount > 0 && !sessionDone && (
        <div className="rounded-xl px-4 py-2 mb-4 border border-emerald-800 bg-emerald-950/30 text-emerald-300 text-sm">
          ✓ Incident resolved — charge rate recovered. Payments resumed.
        </div>
      )}

      {/* Live stats strip */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Current Rate', value: lastPayment ? `${lastPayment.metric_value ?? lastPayment.charge_rate} ${metricUnit}` : '—', color: 'text-white' },
          { label: 'Charged', value: charged, color: 'text-emerald-400' },
          { label: 'Paused', value: paused, color: 'text-red-400' },
          { label: 'Incidents', value: incidentCount, color: incidentCount > 0 ? 'text-amber-400' : 'text-gray-500' },
        ].map(stat => (
          <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
            <p className="text-gray-500 text-xs mb-1">{stat.label}</p>
            <p className={`font-bold text-base ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Last agent decision */}
      {lastPayment && (
        <div className={`rounded-xl px-4 py-2.5 mb-4 text-sm border transition-all duration-500 ${
          lastPayment.action_taken === 'paused'
            ? 'bg-red-950/40 border-red-800 text-red-300'
            : lastPayment.action_taken === 'reduced'
            ? 'bg-amber-950/30 border-amber-800 text-amber-300'
            : 'bg-emerald-950/30 border-emerald-800 text-emerald-300'
        }`}>
          <span className="font-medium">Agent: </span>{lastPayment.reason}
        </div>
      )}

      {/* Chart + Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <TelemetryChart events={paymentEvents} threshold={threshold} metricKey={metricKey} metricUnit={metricUnit} />
        <PaymentLog events={events} />
      </div>

      {/* Settlement */}
      {sessionDone && (
        <SettlementView sessionId={sessionId} onReset={onReset} />
      )}

      {/* Manual settle fallback */}
      {!sessionDone && paymentEvents.length > 0 && (
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

import { useState, useEffect, useRef } from 'react'
import ContractAdvisor from './ContractAdvisor'

const API = 'http://localhost:8000'
const WS_BASE = 'ws://localhost:8000'
const MERCHANT_ID = 'merchant_demo'

export default function RuleSetup({ onSessionStart }) {
  const [mode, setMode] = useState('manual')  // 'manual' | 'agent'

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="flex items-center justify-center gap-3 mb-2">
          <span className="text-3xl">⚡</span>
          <h1 className="text-3xl font-bold text-white tracking-tight">PayStream</h1>
        </div>
        <p className="text-gray-400 text-sm">Autonomous Outcome-Linked Payments</p>
      </div>

      {/* Mode toggle */}
      <div className="w-full max-w-xl mb-4">
        <div className="grid grid-cols-2 gap-2 bg-gray-900 border border-gray-800 rounded-xl p-1.5">
          <button
            onClick={() => setMode('manual')}
            className={`py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
              mode === 'manual'
                ? 'bg-gray-700 text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            ✍️ Write My Rule
          </button>
          <button
            onClick={() => setMode('agent')}
            className={`py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
              mode === 'agent'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            🤖 Let Agent Decide
          </button>
        </div>
      </div>

      {mode === 'manual'
        ? <ManualRuleSetup onSessionStart={onSessionStart} />
        : <AgentDerivedSetup onSessionStart={onSessionStart} />
      }

      {/* Info strip */}
      <div className="mt-6 flex gap-6 text-gray-600 text-xs">
        <span>🔋 EV Charging Demo</span>
        <span>🤖 Powered by Claude Haiku</span>
        <span>💳 Pine Labs Payments</span>
      </div>
    </div>
  )
}

// ── Industry presets ──────────────────────────────────────────────────────────
const USE_CASES = [
  {
    id: 'ev',
    label: '🔋 EV Charging',
    rule: 'pause payment if charge rate drops below 20kW',
    description: 'EV Charger — real-time kW monitoring',
    threshold: 20,
    metricKey: 'charge_rate',
    metricUnit: 'kW',
  },
  {
    id: 'cloud',
    label: '☁️ Cloud SLA',
    rule: 'reduce payment by 50% if API latency exceeds 500ms',
    description: 'Cloud Infrastructure — API latency enforcement',
    threshold: 500,
    metricKey: 'api_latency_ms',
    metricUnit: 'ms',
  },
  {
    id: 'delivery',
    label: '🚴 Delivery',
    rule: 'pause payment if delivery time exceeds 45 minutes',
    description: 'Last-Mile Delivery — time window enforcement',
    threshold: 45,
    metricKey: 'delivery_minutes',
    metricUnit: 'min',
  },
  {
    id: 'solar',
    label: '⚡ Solar PPA',
    rule: 'reduce payment by 30% if power output drops below 5kW',
    description: 'Solar Energy — actual vs contracted generation',
    threshold: 5,
    metricKey: 'power_output_kw',
    metricUnit: 'kW',
  },
  {
    id: 'freelance',
    label: '👨‍💻 Freelance',
    rule: 'pause payment if milestone completion rate drops below 80%',
    description: 'Gig Economy — milestone-linked payment release',
    threshold: 80,
    metricKey: 'completion_rate',
    metricUnit: '%',
  },
]

// ── Mode A: Merchant writes the rule manually ─────────────────────────────────
function ManualRuleSetup({ onSessionStart }) {
  const [ruleText, setRuleText] = useState('pause payment if charge rate drops below 20kW')
  const [selectedUseCase, setSelectedUseCase] = useState('ev')
  const [compiled, setCompiled] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sessionLoading, setSessionLoading] = useState(false)
  const [showJson, setShowJson] = useState(false)

  function handleSelectUseCase(uc) {
    setSelectedUseCase(uc.id)
    setRuleText(uc.rule)
    setCompiled(null)
    setError('')
  }

  async function handleCompile(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setCompiled(null)
    try {
      const res = await fetch(`${API}/rules/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_id: MERCHANT_ID, rule_text: ruleText }),
      })
      setCompiled(await res.json())
    } catch {
      setError('Failed to reach backend. Is FastAPI running?')
    } finally {
      setLoading(false)
    }
  }

  async function handleStartSession() {
    setSessionLoading(true)
    try {
      const uc = USE_CASES.find(u => u.id === selectedUseCase)
      const scenario = uc?.id ?? 'ev'
      const res = await fetch(`${API}/sessions/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_id: MERCHANT_ID, amount_per_interval: 5.0, scenario }),
      })
      const data = await res.json()
      const threshold = uc?.threshold ?? compiled?.compiled?.threshold ?? 20
      const description = uc?.description ?? 'Custom Rule'
      const metricKey = uc?.metricKey ?? 'charge_rate'
      const metricUnit = uc?.metricUnit ?? 'kW'
      onSessionStart(data.session_id, threshold, ruleText, false, description, metricKey, metricUnit)
    } catch {
      setError('Failed to start session.')
    } finally {
      setSessionLoading(false)
    }
  }

  const activeUC = USE_CASES.find(u => u.id === selectedUseCase)

  return (
    <div className="w-full max-w-xl bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
      <h2 className="text-white font-semibold text-lg mb-1">Define Your Payment Rule</h2>
      <p className="text-gray-400 text-sm mb-4">
        Write your outcome in plain English. The AI compiles it into an executable payment contract.
      </p>

      {/* Industry template chips */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-gray-500 text-xs uppercase tracking-wide">Industry Templates</p>
          <ContractAdvisor
            scenario={selectedUseCase || 'ev'}
            onUseRule={(rule) => { setRuleText(rule); setSelectedUseCase(null); setCompiled(null); setError('') }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {USE_CASES.map(uc => (
            <button
              key={uc.id}
              type="button"
              onClick={() => handleSelectUseCase(uc)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                selectedUseCase === uc.id
                  ? 'bg-emerald-900/60 border-emerald-600 text-emerald-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-300'
              }`}
            >
              {uc.label}
            </button>
          ))}
        </div>
        {activeUC && (
          <p className="text-gray-600 text-xs mt-2">{activeUC.description}</p>
        )}
      </div>

      <form onSubmit={handleCompile} className="space-y-4">
        <textarea
          className="w-full bg-gray-800 text-white border border-gray-700 rounded-xl p-3 text-sm resize-none focus:outline-none focus:border-emerald-500 transition-colors"
          rows={3}
          value={ruleText}
          onChange={e => { setRuleText(e.target.value); setSelectedUseCase(null) }}
          placeholder="e.g. pause payment if charge rate drops below 20kW"
        />
        <button
          type="submit"
          disabled={loading || !ruleText.trim()}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
        >
          {loading ? 'Compiling with AI…' : 'Compile Rule'}
        </button>
      </form>

      {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}

      {compiled && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-400 rounded-full" />
              <span className="text-emerald-400 text-sm font-medium">Rule compiled successfully</span>
            </div>
            <div className="flex bg-gray-800 border border-gray-700 rounded-lg p-0.5">
              <button
                onClick={() => setShowJson(false)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  !showJson ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Summary
              </button>
              <button
                onClick={() => setShowJson(true)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  showJson ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                JSON
              </button>
            </div>
          </div>

          {showJson ? (
            <pre className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-xs text-emerald-300 overflow-auto">
              {JSON.stringify(compiled.compiled, null, 2)}
            </pre>
          ) : (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-xs w-20 shrink-0">Metric</span>
                <span className="text-white text-sm font-medium">{compiled.compiled.condition_metric?.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-xs w-20 shrink-0">Condition</span>
                <span className="text-white text-sm font-medium">
                  {compiled.compiled.operator === 'lt' ? 'Below' : compiled.compiled.operator === 'gt' ? 'Above' : compiled.compiled.operator}{' '}
                  {compiled.compiled.threshold} {compiled.compiled.unit}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-xs w-20 shrink-0">Action</span>
                <span className={`text-sm font-medium ${compiled.compiled.action === 'pause' ? 'text-red-400' : 'text-amber-400'}`}>
                  {compiled.compiled.action === 'pause' ? 'Pause payment' : `Reduce payment by ${compiled.compiled.reduce_by_percent}%`}
                </span>
              </div>
            </div>
          )}
          <button
            onClick={handleStartSession}
            disabled={sessionLoading}
            className="mt-4 w-full bg-white hover:bg-gray-100 disabled:bg-gray-700 disabled:text-gray-500 text-gray-950 font-semibold py-2.5 rounded-xl transition-colors text-sm"
          >
            {sessionLoading ? 'Starting session…' : '▶ Start EV Charging Session'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Mode B: Agent observes and derives the rule ───────────────────────────────
function AgentDerivedSetup({ onSessionStart }) {
  const [phase, setPhase] = useState('idle')     // 'idle' | 'observing' | 'derived' | 'starting'
  const [sessionId, setSessionId] = useState(null)
  const [observations, setObservations] = useState([])  // live charge rates during observation
  const [derivedRule, setDerivedRule] = useState(null)
  const [error, setError] = useState('')
  const wsRef = useRef(null)
  const pollRef = useRef(null)

  function cleanup() {
    if (wsRef.current) wsRef.current.close()
    if (pollRef.current) clearInterval(pollRef.current)
  }

  async function handleStartObservation() {
    setPhase('observing')
    setObservations([])
    setDerivedRule(null)
    setError('')

    try {
      const res = await fetch(`${API}/sessions/observe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_id: MERCHANT_ID }),
      })
      const data = await res.json()
      setSessionId(data.session_id)

      // Open WebSocket to receive live observation events
      const ws = new WebSocket(`${WS_BASE}/ws/${data.session_id}`)
      wsRef.current = ws
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'observation') {
          setObservations(prev => [...prev, msg.charge_rate])
        }
        if (msg.type === 'rule_derived') {
          setDerivedRule(msg)
          setPhase('derived')
          cleanup()
        }
      }

      // Fallback: poll for derived rule
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`${API}/sessions/${data.session_id}/derived-rule`)
          const d = await r.json()
          if (d.status === 'awaiting_confirmation' && d.derived_rule) {
            setDerivedRule(d.derived_rule)
            setPhase('derived')
            cleanup()
          }
        } catch {}
      }, 2000)

    } catch {
      setError('Failed to start observation.')
      setPhase('idle')
    }
  }

  async function handleApprove() {
    setPhase('starting')
    try {
      const res = await fetch(`${API}/sessions/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          rule_text: derivedRule.rule_text,
          amount_per_interval: 5.0,
        }),
      })
      await res.json()
      onSessionStart(sessionId, derivedRule.proposed_threshold_kw, derivedRule.rule_text, true)
    } catch {
      setError('Failed to confirm session.')
      setPhase('derived')
    }
  }

  return (
    <div className="w-full max-w-xl bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-indigo-400 text-lg">🤖</span>
        <h2 className="text-white font-semibold text-lg">Agent-Derived Rule</h2>
      </div>
      <p className="text-gray-400 text-sm mb-5">
        The agent observes 3 live readings (~15 seconds) and determines a fair payment threshold
        based on THIS charger's actual baseline performance — no rule writing needed.
      </p>

      {error && <p className="mb-4 text-red-400 text-sm">{error}</p>}

      {/* Idle */}
      {phase === 'idle' && (
        <button
          onClick={handleStartObservation}
          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
        >
          🔍 Start Observation (15 seconds)
        </button>
      )}

      {/* Observing */}
      {phase === 'observing' && (
        <div className="space-y-4">
          <div className="bg-gray-800 border border-indigo-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" />
              <span className="text-indigo-300 text-sm font-medium">Agent observing baseline performance…</span>
            </div>
            <div className="flex gap-2 items-end h-12">
              {observations.map((rate, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <span className="text-white text-xs font-bold">{rate}</span>
                  <div
                    className="bg-indigo-500 rounded w-8"
                    style={{ height: `${Math.round((rate / 30) * 40)}px` }}
                  />
                  <span className="text-gray-500 text-xs">#{i + 1}</span>
                </div>
              ))}
              {observations.length < 3 && (
                <div className="flex flex-col items-center gap-1 opacity-30">
                  <span className="text-white text-xs">…</span>
                  <div className="bg-gray-600 rounded w-8 h-8 animate-pulse" />
                </div>
              )}
            </div>
            <p className="text-gray-500 text-xs mt-2">
              Reading {observations.length}/3 — establishing baseline kW
            </p>
          </div>
        </div>
      )}

      {/* Derived rule ready */}
      {phase === 'derived' && derivedRule && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-indigo-400 rounded-full" />
            <span className="text-indigo-400 text-sm font-medium">Agent determined a fair rule</span>
          </div>

          <div className="bg-gray-800 border border-indigo-700 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-500 text-xs mb-0.5">Observed average</p>
                <p className="text-white font-bold">{derivedRule.observed_avg_kw} kW</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-0.5">Proposed threshold</p>
                <p className="text-indigo-400 font-bold">{derivedRule.proposed_threshold_kw} kW</p>
              </div>
            </div>

            <div className="border-t border-gray-700 pt-3">
              <p className="text-gray-500 text-xs mb-1">Derived rule</p>
              <p className="text-emerald-300 text-sm font-mono">"{derivedRule.rule_text}"</p>
            </div>

            <div className="border-t border-gray-700 pt-3">
              <p className="text-gray-500 text-xs mb-1">Agent's reasoning</p>
              <p className="text-gray-300 text-xs italic">{derivedRule.reasoning}</p>
            </div>
          </div>

          <button
            onClick={handleApprove}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
          >
            ✓ Approve & Start Session
          </button>
          <button
            onClick={() => setPhase('idle')}
            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-400 py-2 rounded-xl transition-colors text-sm"
          >
            ↩ Observe Again
          </button>
        </div>
      )}

      {/* Starting */}
      {phase === 'starting' && (
        <div className="text-center py-4 text-gray-400 text-sm">
          Starting session with agent-derived rule…
        </div>
      )}
    </div>
  )
}

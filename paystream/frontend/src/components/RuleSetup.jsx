import { useState } from 'react'

const API = 'http://localhost:8000'
const MERCHANT_ID = 'merchant_demo'

export default function RuleSetup({ onSessionStart }) {
  const [ruleText, setRuleText] = useState('pause payment if charge rate drops below 20kW')
  const [compiled, setCompiled] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sessionLoading, setSessionLoading] = useState(false)

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
      const data = await res.json()
      setCompiled(data)
    } catch (err) {
      setError('Failed to reach backend. Is FastAPI running?')
    } finally {
      setLoading(false)
    }
  }

  async function handleStartSession() {
    setSessionLoading(true)
    try {
      const res = await fetch(`${API}/sessions/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_id: MERCHANT_ID, amount_per_interval: 5.0 }),
      })
      const data = await res.json()
      const threshold = compiled?.compiled?.threshold ?? 20
      onSessionStart(data.session_id, threshold)
    } catch (err) {
      setError('Failed to start session.')
    } finally {
      setSessionLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      {/* Header */}
      <div className="mb-10 text-center">
        <div className="flex items-center justify-center gap-3 mb-2">
          <span className="text-3xl">⚡</span>
          <h1 className="text-3xl font-bold text-white tracking-tight">PayStream</h1>
        </div>
        <p className="text-gray-400 text-sm">Autonomous Outcome-Linked Payments</p>
      </div>

      {/* Rule card */}
      <div className="w-full max-w-xl bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
        <h2 className="text-white font-semibold text-lg mb-1">Define Your Payment Rule</h2>
        <p className="text-gray-400 text-sm mb-4">
          Write your rule in plain English. The AI compiles it into an executable payment contract.
        </p>

        <form onSubmit={handleCompile} className="space-y-4">
          <textarea
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-xl p-3 text-sm resize-none focus:outline-none focus:border-emerald-500 transition-colors"
            rows={3}
            value={ruleText}
            onChange={e => setRuleText(e.target.value)}
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

        {error && (
          <p className="mt-3 text-red-400 text-sm">{error}</p>
        )}

        {/* Compiled JSON display */}
        {compiled && (
          <div className="mt-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 bg-emerald-400 rounded-full" />
              <span className="text-emerald-400 text-sm font-medium">Rule compiled successfully</span>
            </div>
            <pre className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-xs text-emerald-300 overflow-auto">
              {JSON.stringify(compiled.compiled, null, 2)}
            </pre>
            <p className="text-gray-500 text-xs mt-2 italic">
              This contract will be evaluated by the AI agent every 5 seconds during the session.
            </p>

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

      {/* Info strip */}
      <div className="mt-6 flex gap-6 text-gray-600 text-xs">
        <span>🔋 EV Charging Demo</span>
        <span>🤖 Powered by Claude Haiku</span>
        <span>💳 Pine Labs Payments</span>
      </div>
    </div>
  )
}

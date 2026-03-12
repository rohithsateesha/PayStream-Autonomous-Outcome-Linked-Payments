import { useState } from 'react'

const API = 'http://localhost:8000'

export default function SettlementView({ sessionId, onReset }) {
  const [settlement, setSettlement] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSettle() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/sessions/${sessionId}/settlement`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setSettlement(data)
    } catch (err) {
      setError(`Settlement failed: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  if (!settlement) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h3 className="text-white font-semibold text-sm mb-3">Session Settlement</h3>
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <button
          onClick={handleSettle}
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
        >
          {loading ? 'Generating settlement…' : '🧾 Settle Session'}
        </button>
      </div>
    )
  }

  const savingsPercent = settlement.total_possible > 0
    ? Math.round((settlement.amount_withheld / settlement.total_possible) * 100)
    : 0

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">Settlement Report</h3>
        <span className="text-xs text-gray-500">Session {settlement.session_id}</span>
      </div>

      {/* Big numbers */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-800 rounded-xl p-3 text-center">
          <p className="text-gray-400 text-xs mb-1">Charged</p>
          <p className="text-emerald-400 text-xl font-bold">₹{settlement.total_billed.toFixed(2)}</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-3 text-center">
          <p className="text-gray-400 text-xs mb-1">Withheld</p>
          <p className="text-red-400 text-xl font-bold">₹{settlement.amount_withheld.toFixed(2)}</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-3 text-center">
          <p className="text-gray-400 text-xs mb-1">Savings</p>
          <p className="text-amber-400 text-xl font-bold">{savingsPercent}%</p>
        </div>
      </div>

      {/* Interval breakdown */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="bg-emerald-950/40 border border-emerald-900 rounded-lg py-2">
          <p className="text-emerald-400 font-semibold text-base">{settlement.charged_intervals}</p>
          <p className="text-gray-400">charged</p>
        </div>
        <div className="bg-red-950/40 border border-red-900 rounded-lg py-2">
          <p className="text-red-400 font-semibold text-base">{settlement.paused_intervals}</p>
          <p className="text-gray-400">paused</p>
        </div>
        <div className="bg-amber-950/40 border border-amber-900 rounded-lg py-2">
          <p className="text-amber-400 font-semibold text-base">{settlement.reduced_intervals}</p>
          <p className="text-gray-400">reduced</p>
        </div>
      </div>

      {/* AI Explanation */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-medium text-indigo-400 uppercase tracking-wide">AI Settlement Explanation</span>
        </div>
        <p className="text-gray-300 text-sm leading-relaxed">{settlement.explanation}</p>
      </div>

      {/* Closing punch */}
      <div className="border border-gray-700 rounded-xl p-4 text-center">
        <p className="text-gray-400 text-xs italic">
          "The payment contract enforced itself. No dispute. No chargeback. No human needed."
        </p>
      </div>

      <button
        onClick={onReset}
        className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-2 rounded-xl transition-colors text-sm"
      >
        ↩ Start New Session
      </button>
    </div>
  )
}

import { useState } from 'react'

const API = 'http://localhost:8000'

export default function SettlementView({ sessionId, onReset }) {
  const [settlement, setSettlement] = useState(null)
  const [dispute, setDispute] = useState(null)
  const [loadingSettle, setLoadingSettle] = useState(false)
  const [loadingDispute, setLoadingDispute] = useState(false)
  const [error, setError] = useState('')

  async function handleSettle() {
    setLoadingSettle(true)
    setError('')
    try {
      const res = await fetch(`${API}/sessions/${sessionId}/settlement`)
      if (!res.ok) throw new Error(await res.text())
      setSettlement(await res.json())
    } catch (err) {
      setError(`Settlement failed: ${err.message}`)
    } finally {
      setLoadingSettle(false)
    }
  }

  async function handleGenerateDispute() {
    setLoadingDispute(true)
    setError('')
    try {
      const res = await fetch(`${API}/sessions/${sessionId}/dispute`)
      if (!res.ok) throw new Error(await res.text())
      setDispute(await res.json())
    } catch (err) {
      setError(`Dispute package failed: ${err.message}`)
    } finally {
      setLoadingDispute(false)
    }
  }

  if (!settlement) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h3 className="text-white font-semibold text-sm mb-3">Session Settlement</h3>
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <button
          onClick={handleSettle}
          disabled={loadingSettle}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
        >
          {loadingSettle ? 'Generating settlement…' : '🧾 Settle Session'}
        </button>
      </div>
    )
  }

  const savingsPercent = settlement.total_possible > 0
    ? Math.round((settlement.amount_withheld / settlement.total_possible) * 100)
    : 0

  return (
    <div className="space-y-4">

      {/* Settlement card */}
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
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-wide mb-2">
            AI Settlement Explanation
          </p>
          <p className="text-gray-300 text-sm leading-relaxed">{settlement.explanation}</p>
        </div>

        {/* Closing punch */}
        <div className="border border-gray-700 rounded-xl p-4 text-center">
          <p className="text-gray-400 text-xs italic">
            "The payment contract enforced itself. No dispute. No chargeback. No human needed."
          </p>
        </div>
      </div>

      {/* ── Pine Labs Transaction Reference ──────────────────────────────── */}
      {settlement.pine_labs_order_id && (
        <div className="bg-gray-900 border border-indigo-800/60 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-indigo-400 text-lg">💳</span>
              <h3 className="text-white font-semibold text-sm">Pine Labs Transaction</h3>
            </div>
            {settlement.pine_labs_mock && (
              <span className="text-xs bg-gray-800 text-gray-500 border border-gray-700 px-2 py-0.5 rounded">
                UAT Mock
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-gray-800 rounded-xl p-3">
              <p className="text-gray-500 text-xs mb-1">Order ID</p>
              <p className="text-indigo-300 font-mono text-xs break-all">{settlement.pine_labs_order_id}</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-3">
              <p className="text-gray-500 text-xs mb-1">Status</p>
              <p className="text-emerald-400 font-semibold text-sm">{settlement.pine_labs_order_status}</p>
            </div>
          </div>

          <p className="text-gray-500 text-xs italic">
            Pine Labs order created for ₹{settlement.total_billed.toFixed(2)} — the autonomously verified amount,
            not the contracted ₹{settlement.total_possible.toFixed(2)} maximum.
          </p>
        </div>
      )}

      {/* ── Feature 3: Dispute Evidence Package ─────────────────────────── */}
      {settlement.amount_withheld > 0 && !dispute && (
        <div className="bg-gray-900 border border-amber-900/50 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-amber-400 text-lg">📄</span>
            <h3 className="text-white font-semibold text-sm">Autonomous Dispute Package</h3>
          </div>
          <p className="text-gray-400 text-xs mb-4">
            The agent detected ₹{settlement.amount_withheld.toFixed(2)} was withheld due to service failures.
            It can autonomously generate a formal Service Quality Breach Notice — a submittable document
            you can send to the charger operator. <span className="text-amber-400">You didn't ask for this. The agent built it anyway.</span>
          </p>
          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
          <button
            onClick={handleGenerateDispute}
            disabled={loadingDispute}
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
          >
            {loadingDispute ? 'Agent building dispute case…' : '⚖️ Generate Dispute Evidence Package'}
          </button>
        </div>
      )}

      {/* Dispute document */}
      {dispute && (
        <div className="bg-gray-900 border border-amber-700 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-amber-400">⚖️</span>
              <h3 className="text-white font-semibold text-sm">Service Quality Breach Notice</h3>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>{dispute.violations_count} violations</span>
              <span>·</span>
              <span>₹{dispute.total_withheld?.toFixed(2)} withheld</span>
            </div>
          </div>

          <div className="bg-gray-950 border border-gray-700 rounded-xl p-4">
            <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
              {dispute.document}
            </pre>
          </div>

          <p className="text-gray-500 text-xs mt-3 text-center italic">
            Generated autonomously by PayStream · Can be submitted to charger operator or dispute body
          </p>
        </div>
      )}

      <button
        onClick={onReset}
        className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-2 rounded-xl transition-colors text-sm"
      >
        ↩ Start New Session
      </button>
    </div>
  )
}

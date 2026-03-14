import { useState } from 'react'

const API = 'http://localhost:8000'

export default function ContractAdvisor({ scenario = 'ev', onUseRule }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [recommendation, setRecommendation] = useState(null)
  const [context, setContext] = useState('')
  const [error, setError] = useState('')

  async function fetchRecommendation() {
    setLoading(true)
    setError('')
    setRecommendation(null)
    try {
      const res = await fetch(`${API}/contracts/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, context }),
      })
      const data = await res.json()
      setRecommendation(data)
    } catch {
      setError('Failed to reach backend. Is FastAPI running?')
    } finally {
      setLoading(false)
    }
  }

  function handleOpen() {
    setOpen(true)
    if (!recommendation && !loading) {
      fetchRecommendation()
    }
  }

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        AI Rule Advisor
      </button>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-indigo-400 text-lg">💡</span>
            <div>
              <h3 className="text-white font-semibold text-sm">AI Rule Advisor</h3>
              <p className="text-gray-500 text-xs">Powered by Claude Haiku</p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Context input */}
          <div>
            <label className="text-gray-500 text-xs mb-1.5 block">Additional context (optional)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={context}
                onChange={e => setContext(e.target.value)}
                placeholder="e.g. overnight charging, budget-sensitive..."
                className="flex-1 bg-gray-800 text-white text-sm border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 transition-colors placeholder-gray-600"
              />
              <button
                onClick={fetchRecommendation}
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-2 rounded-lg transition-colors text-xs font-medium whitespace-nowrap"
              >
                {loading ? 'Thinking...' : 'Get Advice'}
              </button>
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          {/* Loading state */}
          {loading && (
            <div className="text-center py-6">
              <div className="inline-flex items-center gap-2 text-indigo-400 text-sm">
                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" />
                Analyzing scenario...
              </div>
            </div>
          )}

          {/* Recommendation */}
          {recommendation && !loading && (
            <div className="space-y-4">
              {/* Source badge */}
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  recommendation.source === 'bedrock'
                    ? 'bg-indigo-900/60 border-indigo-700 text-indigo-300'
                    : 'bg-gray-800 border-gray-700 text-gray-400'
                }`}>
                  {recommendation.source === 'bedrock' ? 'AI-generated' : 'Template'}
                </span>
              </div>

              {/* Recommended rule */}
              <div className="bg-gray-800 border border-indigo-700 rounded-xl p-4">
                <p className="text-gray-500 text-xs mb-1 uppercase tracking-wide">Recommended rule</p>
                <p className="text-emerald-300 text-sm font-mono">"{recommendation.recommended_rule}"</p>
                <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
                  <div>
                    <p className="text-gray-500 text-xs">Threshold</p>
                    <p className="text-white font-bold">{recommendation.recommended_threshold} {recommendation.threshold_unit}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Action</p>
                    <p className="text-indigo-400 font-bold capitalize">{recommendation.payment_action}</p>
                  </div>
                </div>
              </div>

              {/* Reasoning */}
              <div>
                <p className="text-gray-500 text-xs mb-1 uppercase tracking-wide">Why this rule?</p>
                <p className="text-gray-300 text-sm">{recommendation.reasoning}</p>
              </div>

              {/* Risk factors */}
              {recommendation.risk_factors?.length > 0 && (
                <div>
                  <p className="text-gray-500 text-xs mb-1.5 uppercase tracking-wide">Risk factors</p>
                  <ul className="space-y-1.5">
                    {recommendation.risk_factors.map((risk, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-amber-300/80">
                        <span className="text-amber-500 mt-0.5 shrink-0">!</span>
                        <span>{risk}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Alternatives */}
              {recommendation.alternatives?.length > 0 && (
                <div>
                  <p className="text-gray-500 text-xs mb-1.5 uppercase tracking-wide">Alternatives</p>
                  <div className="space-y-2">
                    {recommendation.alternatives.map((alt, i) => (
                      <div key={i} className="bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-gray-300 text-sm font-mono truncate">"{alt.rule}"</p>
                          <p className="text-gray-500 text-xs mt-0.5">{alt.description}</p>
                        </div>
                        {onUseRule && (
                          <button
                            onClick={() => { onUseRule(alt.rule); setOpen(false) }}
                            className="shrink-0 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-700 hover:border-indigo-500 px-2 py-1 rounded-lg transition-colors"
                          >
                            Use
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tip */}
              {recommendation.tips && (
                <div className="bg-indigo-950/30 border border-indigo-800 rounded-lg px-3 py-2.5">
                  <p className="text-indigo-300 text-xs">
                    <span className="font-medium">Pro tip:</span> {recommendation.tips}
                  </p>
                </div>
              )}

              {/* Use recommended rule button */}
              {onUseRule && (
                <button
                  onClick={() => { onUseRule(recommendation.recommended_rule); setOpen(false) }}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
                >
                  Use Recommended Rule
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

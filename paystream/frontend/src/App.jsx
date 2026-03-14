import { useState } from 'react'
import RuleSetup from './components/RuleSetup'
import SessionDashboard from './components/SessionDashboard'

export default function App() {
  const [view, setView] = useState('setup')
  const [sessionId, setSessionId] = useState(null)
  const [threshold, setThreshold] = useState(20)
  const [ruleText, setRuleText] = useState('')
  const [agentDerived, setAgentDerived] = useState(false)
  const [useCaseDescription, setUseCaseDescription] = useState('')
  const [metricKey, setMetricKey] = useState('charge_rate')
  const [metricUnit, setMetricUnit] = useState('kW')

  function handleSessionStart(id, thresh, rule, derived = false, description = '', mKey = 'charge_rate', mUnit = 'kW') {
    setSessionId(id)
    setThreshold(thresh)
    setRuleText(rule)
    setAgentDerived(derived)
    setUseCaseDescription(description)
    setMetricKey(mKey)
    setMetricUnit(mUnit)
    setView('session')
  }

  function handleReset() {
    setSessionId(null)
    setThreshold(20)
    setRuleText('')
    setAgentDerived(false)
    setUseCaseDescription('')
    setMetricKey('charge_rate')
    setMetricUnit('kW')
    setView('setup')
  }

  if (view === 'session' && sessionId) {
    return (
      <SessionDashboard
        sessionId={sessionId}
        threshold={threshold}
        ruleText={ruleText}
        agentDerived={agentDerived}
        useCaseDescription={useCaseDescription}
        metricKey={metricKey}
        metricUnit={metricUnit}
        onReset={handleReset}
      />
    )
  }

  return <RuleSetup onSessionStart={handleSessionStart} />
}

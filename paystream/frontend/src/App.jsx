import { useState } from 'react'
import RuleSetup from './components/RuleSetup'
import SessionDashboard from './components/SessionDashboard'

export default function App() {
  const [view, setView] = useState('setup')   // 'setup' | 'session'
  const [sessionId, setSessionId] = useState(null)
  const [threshold, setThreshold] = useState(20)

  function handleSessionStart(id, thresh) {
    setSessionId(id)
    setThreshold(thresh)
    setView('session')
  }

  function handleReset() {
    setSessionId(null)
    setThreshold(20)
    setView('setup')
  }

  if (view === 'session' && sessionId) {
    return (
      <SessionDashboard
        sessionId={sessionId}
        threshold={threshold}
        onReset={handleReset}
      />
    )
  }

  return <RuleSetup onSessionStart={handleSessionStart} />
}

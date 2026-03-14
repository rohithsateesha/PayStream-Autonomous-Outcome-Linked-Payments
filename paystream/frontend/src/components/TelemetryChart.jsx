import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'

// Y-axis domain per metric key — keeps chart readable for each scenario
const Y_DOMAIN_BY_METRIC = {
  charge_rate:      [0, 30],
  api_latency_ms:   [0, 1200],
  delivery_minutes: [0, 90],
  power_output_kw:  [0, 12],
  completion_rate:  [0, 100],
}

export default function TelemetryChart({ events, threshold, metricKey = 'charge_rate', metricUnit = 'kW' }) {
  const yDomain = Y_DOMAIN_BY_METRIC[metricKey] ?? [0, 100]

  const data = events.map((e, i) => ({
    t: `${Math.round(e.elapsed_seconds ?? i * 5)}s`,
    value: e[metricKey] ?? e.metric_value,
    paused: e.action_taken === 'paused' ? (e[metricKey] ?? e.metric_value) : null,
  }))

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const d = payload[0]?.payload
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs text-white shadow-lg">
        <p className="font-medium">{d?.t}</p>
        <p className="text-emerald-400">{payload[0]?.value} {metricUnit}</p>
        {d?.paused != null && <p className="text-red-400">Payment paused</p>}
      </div>
    )
  }

  const chartTitle = `${metricKey.replace(/_/g, ' ')} (${metricUnit})`

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold text-sm capitalize">{chartTitle}</h3>
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-emerald-400 inline-block" /> Live rate
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-red-500 border-dashed inline-block" /> Threshold ({threshold} {metricUnit})
          </span>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
          Waiting for first telemetry reading…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              dataKey="t"
              tick={{ fill: '#6b7280', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#374151' }}
            />
            <YAxis
              domain={yDomain}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#374151' }}
              tickFormatter={v => `${v}`}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Threshold reference line */}
            <ReferenceLine
              y={threshold}
              stroke="#ef4444"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{ value: `${threshold} ${metricUnit}`, fill: '#ef4444', fontSize: 10, position: 'insideTopRight' }}
            />

            {/* Main metric line */}
            <Line
              type="monotone"
              dataKey="value"
              stroke="#34d399"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#34d399' }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

import React from 'react'
import { fmtLacs, fmtNumber } from '../lib/format'

// Generic Recharts tooltip: shows each series' value formatted as ₹ Lacs.
// Pass `formatter` to override (e.g. counts, percentages).
export default function ChartTooltip({ active, payload, label, formatter, valueSuffix }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="bg-navy text-white text-xs rounded-md px-3 py-2 shadow-lg border border-navy-border min-w-[140px]">
      {label && <div className="font-semibold mb-1 opacity-90">{label}</div>}
      <div className="flex flex-col gap-0.5">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color }} />
              {p.name}
            </span>
            <span className="font-semibold tabular-nums">
              {formatter ? formatter(p.value) : `${fmtLacs(p.value)}`}
              {valueSuffix || ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function countFormatter(v) {
  return fmtNumber(v)
}

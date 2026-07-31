import React from 'react'
import { fmtLacs, fmtNumber } from '../lib/format'

// Generic Recharts tooltip: shows each series' value formatted as ₹ Lacs,
// plus an optional paired count ("₹120.50 L · 1,234 cards") pulled from the
// underlying data row. `countField` is either the sibling field name to read
// off `payload.payload` (e.g. "ActivationCount"), or a function
// `(p) => fieldName` for charts where the count field name varies per series
// (e.g. pivoted "Physical__count" style keys from lib/aggregate.js#pivot).
export default function ChartTooltip({ active, payload, label, formatter, valueSuffix, countField, countUnit = 'records' }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="bg-navy text-white text-xs rounded-md px-3 py-2 shadow-lg border border-navy-border min-w-[160px]">
      {label && <div className="font-semibold mb-1 opacity-90">{label}</div>}
      <div className="flex flex-col gap-1">
        {payload.map((p) => {
          const countKeyName = typeof countField === 'function' ? countField(p) : countField
          const count = countKeyName ? p.payload?.[countKeyName] : undefined
          const unit = typeof countUnit === 'function' ? countUnit(p) : countUnit
          return (
            <div key={p.dataKey} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: p.color }} />
                {p.name}
              </span>
              <span className="font-semibold tabular-nums text-right">
                {formatter ? formatter(p.value) : fmtLacs(p.value)}
                {valueSuffix || ''}
                {count != null && <span className="block font-normal text-white/60">{fmtNumber(count)} {unit}</span>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function countFormatter(v) {
  return fmtNumber(v)
}

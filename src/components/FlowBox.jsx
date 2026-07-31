import React from 'react'
import { fmtLacs, fmtPct, fmtNumber } from '../lib/format'

export function FlowBox({ label, amount, count, countUnit = 'cards', pct, color = '#1b2430', size = 'md' }) {
  const big = size === 'lg'
  return (
    <div
      className={`bg-card border-2 rounded-lg text-center shadow-sm ${big ? 'px-6 py-4 min-w-[180px]' : 'px-4 py-2.5 min-w-[130px]'}`}
      style={{ borderColor: color }}
    >
      <div className={`font-semibold text-navy ${big ? 'text-sm' : 'text-xs'}`}>{label}</div>
      <div className={`font-serif font-bold ${big ? 'text-xl' : 'text-base'}`} style={{ color }}>
        {fmtLacs(amount, big ? 2 : 2)}
      </div>
      {count !== undefined && (
        <div className="text-[11px] text-warmgray-muted">
          {fmtNumber(count)} {countUnit}
        </div>
      )}
      {pct !== undefined && <div className="text-[11px] text-warmgray-muted mt-0.5">{fmtPct(pct)} of total</div>}
    </div>
  )
}

// One parent -> N children, connected with a CSS org-chart stem/bar.
export function FlowBranch({ children }) {
  return (
    <div className="flex flex-col items-center w-full">
      <div className="w-px h-6 bg-warmgray-border" />
      <div className="relative flex flex-wrap justify-center gap-x-6 gap-y-6 pt-6 w-full">
        <div className="absolute top-0 left-[8%] right-[8%] h-px bg-warmgray-border hidden md:block" />
        {React.Children.map(children, (child) => (
          <div className="relative flex flex-col items-center">
            <div className="absolute -top-6 w-px h-6 bg-warmgray-border" />
            {child}
          </div>
        ))}
      </div>
    </div>
  )
}

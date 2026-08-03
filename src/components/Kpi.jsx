import React from 'react'
import DeltaBadge from './DeltaBadge'

const ACCENTS = {
  gold: 'border-l-gold text-gold',
  teal: 'border-l-teal text-teal',
  coral: 'border-l-coral text-coral',
  navy: 'border-l-navy text-navy',
  blue: 'border-l-cat-blue text-cat-blue'
}

export default function Kpi({ label, value, sub, accent = 'navy', deltas }) {
  return (
    <div className={`bg-card border border-warmgray-border border-l-[6px] rounded-lg px-4 py-3 ${ACCENTS[accent]}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-warmgray-muted">{label}</div>
      <div className="font-serif text-3xl font-extrabold mt-1 tracking-tight">{value}</div>
      {deltas && deltas.some((d) => d.pct != null) && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {deltas.map((d) => (
            <DeltaBadge key={d.label} pct={d.pct} label={d.label} />
          ))}
        </div>
      )}
      {sub && <div className="text-xs font-medium text-warmgray-muted mt-1">{sub}</div>}
    </div>
  )
}

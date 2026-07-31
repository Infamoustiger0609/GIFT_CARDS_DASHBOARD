import React from 'react'

const ACCENTS = {
  gold: 'border-l-gold text-gold',
  teal: 'border-l-teal text-teal',
  coral: 'border-l-coral text-coral',
  navy: 'border-l-navy text-navy'
}

export default function Kpi({ label, value, sub, accent = 'navy' }) {
  return (
    <div className={`bg-card border border-warmgray-border border-l-4 rounded-lg px-4 py-3 ${ACCENTS[accent]}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-warmgray-muted">{label}</div>
      <div className="font-serif text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs text-warmgray-muted mt-0.5">{sub}</div>}
    </div>
  )
}

import React from 'react'
import DeltaBadge from './DeltaBadge'

const ACCENTS = {
  gold: 'border-l-gold text-gold',
  teal: 'border-l-teal text-teal',
  coral: 'border-l-coral text-coral',
  navy: 'border-l-navy text-navy',
  blue: 'border-l-cat-blue text-cat-blue'
}

// `breakdown`: optional array of { label, value } rendered as a small,
// compact annotation tucked in the card's top-right corner — for a KPI
// that wants a "big total → small breakdown" hierarchy on one card instead
// of splitting into separate cards (e.g. Overview's Uptake KPI: Ticket vs
// F&B). Deliberately its own prop rather than overloading `sub` — `sub`
// stays a single muted caption line under the main number.
//
// Absolutely positioned (not a flex sibling of the main column) so it
// never competes with the main number for width — that competition is
// exactly what pushed "₹3,386.87 L" onto two lines before this fix, which
// broke the ribbon's row height (see CLAUDE.md). `pr-20` on the main
// column reserves clearance so the number's text never runs under it.
//
// `valueClassName`: optional override for the main number's font-size
// class (default `text-3xl`) — for a KPI whose value string is right at
// the edge of a card's width, e.g. Uptake's card also carries the
// top-right breakdown and needs a touch more headroom than the plain
// KPI cards next to it.
export default function Kpi({ label, value, sub, accent = 'navy', deltas, breakdown, valueClassName = 'text-3xl' }) {
  return (
    <div className={`relative bg-card border border-warmgray-border border-l-[6px] rounded-lg px-4 py-3 ${ACCENTS[accent]}`}>
      {breakdown && (
        <div className="absolute top-3 right-4 flex items-start gap-2.5">
          <div className="flex flex-col gap-1.5 pl-2.5 border-l border-warmgray-border">
            {breakdown.map((b) => (
              <div key={b.label} className="leading-tight">
                <div className="text-[9px] font-medium uppercase tracking-wide text-warmgray-muted">{b.label}</div>
                <div className="text-xs font-semibold text-navy tabular-nums whitespace-nowrap">{b.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={breakdown ? 'pr-20' : ''}>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-warmgray-muted">{label}</div>
        <div className={`font-serif font-extrabold mt-1 tracking-tight whitespace-nowrap ${valueClassName}`}>{value}</div>
        {deltas && deltas.some((d) => d.pct != null) && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {deltas.map((d) => (
              <DeltaBadge key={d.label} pct={d.pct} label={d.label} />
            ))}
          </div>
        )}
        {sub && <div className="text-xs font-medium text-warmgray-muted mt-1">{sub}</div>}
      </div>
    </div>
  )
}

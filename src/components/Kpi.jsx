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
// class (default `text-2xl`, tightened from `text-3xl` on 2026-08-25 —
// see CLAUDE.md's "visual tightening pass" entry — to bring every card
// back toward a plain rectangular proportion instead of the taller/boxier
// look the larger size produced once 5-card ribbons and breakdown-bearing
// cards became common). Still available for a KPI whose value string
// needs a size bump or reduction of its own.
//
// `subCount`: 2026-08-28 — the count portion of the caption line (e.g.
// "13,37,018 cards"), rendered with the shared `.count-ghost` utility
// (index.css) — present in the DOM and selectable/copyable, but painted
// invisible (opacity:0, never display:none/visibility:hidden, which would
// also block selection). Kept as its own prop rather than folded into
// `sub`, since a handful of call sites combine a count with other visible
// text (e.g. "51.5% of total") that must stay legible, and one call site
// (Activation.jsx's "Avg Ticket Size") passes a `sub` with no count at all
// ("per card") that must stay fully visible — Kpi.jsx can't tell a pure
// count string apart from other caption text on its own, so callers pass
// the count separately instead of Kpi.jsx guessing from the string. Always
// rendered on its own line (`block`) so an invisible count can never sit
// mid-line before/after visible `sub` text and leave a stray gap where it
// used to visibly read.
export default function Kpi({ label, value, sub, subCount, accent = 'navy', deltas, breakdown, valueClassName = 'text-2xl' }) {
  return (
    <div className={`relative bg-card border border-warmgray-border border-l-[6px] rounded-lg px-4 py-2 ${ACCENTS[accent]}`}>
      {breakdown && (
        // 2026-08-25: value text shrunk text-xs -> text-[10px] and the
        // label text-[9px] -> text-[8px] — a breakdown value now carries a
        // "(NN.N%)" suffix alongside the amount (e.g. "₹6,102 L (60.5%)",
        // ~16 characters at the widest realistic total on this ribbon),
        // wide enough at the old text-xs size to visually run into the
        // main number beside it. pl-2.5/gap-2.5 trimmed to pl-2/gap-2 too,
        // reclaiming a few more px — see the main column's matching pr-24
        // bump below.
        <div className="absolute top-3 right-4 flex items-start gap-2">
          <div className="flex flex-col gap-1 pl-2 border-l border-warmgray-border">
            {breakdown.map((b) => (
              <div key={b.label} className="leading-tight">
                <div className="text-[8px] font-medium uppercase tracking-wide text-warmgray-muted">{b.label}</div>
                <div className="text-[10px] font-semibold text-navy tabular-nums whitespace-nowrap">{b.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* pr-20 -> pr-24: extra clearance for the wider (now %-bearing)
          breakdown panel above — see its own comment. */}
      <div className={breakdown ? 'pr-24' : ''}>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-warmgray-muted">{label}</div>
        <div className={`font-serif font-extrabold mt-1 tracking-tight whitespace-nowrap ${valueClassName}`}>{value}</div>
        {deltas && deltas.some((d) => d.pct != null) && (
          // 2026-08-25: was `flex flex-wrap` — wrapped based on whichever
          // width happened to be available, so cards with a `breakdown`
          // panel eating into their width (Uptake, Total Transaction
          // Value) rendered one badge per line while wider breakdown-less
          // cards (Revenue, Total Redemption) fit two per line — a
          // width-driven accident, not an intentional difference. Always
          // stacking one per line makes every KPI's MoM/QoQ/YoY badges
          // render the same way regardless of the card's own width.
          <div className="flex flex-col gap-1 mt-1.5">
            {deltas.map((d) => (
              <DeltaBadge key={d.label} pct={d.pct} label={d.label} />
            ))}
          </div>
        )}
        {(sub || subCount) && (
          <div className="text-xs font-medium text-warmgray-muted mt-1">
            {sub}
            {subCount && <span className="count-ghost block">{subCount}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

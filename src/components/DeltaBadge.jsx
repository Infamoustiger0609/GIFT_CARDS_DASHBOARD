import React from 'react'

// Bank-dashboard style period-over-period badge, e.g. "▲ 12.4% YoY". Renders
// nothing when pct is null/NaN — the caller (lib/comparisons.js) returns null
// whenever a comparison period has no data, so a missing badge is the
// correct "can't compute this" state, not a bug.
export default function DeltaBadge({ pct, label }) {
  if (pct == null || !isFinite(pct)) return null
  const positive = pct >= 0
  return (
    <span
      // 2026-08-25: `leading-none` added — without an explicit line-height,
      // this span inherited the ambient one from its parent, which could
      // render taller than the pill's own px-1.5/py-0.5 padding box
      // accounted for, leaving a sliver of text (a glyph's ascender/
      // descender) sitting outside the colored background instead of
      // fully covered by it.
      className={`inline-flex items-center gap-0.5 text-[10px] font-bold leading-none px-1.5 py-1 rounded whitespace-nowrap ${
        positive ? 'bg-teal-light text-teal-dark' : 'bg-coral-light text-coral-dark'
      }`}
    >
      {positive ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%{label ? ` ${label}` : ''}
    </span>
  )
}

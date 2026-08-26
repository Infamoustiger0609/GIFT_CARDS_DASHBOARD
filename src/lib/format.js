export function toLacs(rupees) {
  return rupees / 100000
}

export function fmtLacs(rupees, decimals = 0) {
  const lacs = toLacs(rupees)
  return `₹${lacs.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })} L`
}

// Absolute-rupee formatter for per-unit/average metrics (e.g. "Avg per
// Redemption", "Avg Ticket Size") — these are typically only a few hundred
// rupees, so running them through fmtLacs (divide by 100000) rounds every
// one of them to "₹0 L" at the 0-decimal precision the rest of this app's
// currency figures use. Not a Lacs conversion at all — whole rupees,
// comma-grouped, same 0-decimal-by-default convention as fmtLacs, just at
// the unit the number actually lives at.
export function fmtRupees(rupees) {
  return `₹${Math.round(rupees).toLocaleString('en-IN')}`
}

export function fmtNumber(n) {
  return Math.round(n).toLocaleString('en-IN')
}

export function fmtPct(n, decimals = 1) {
  if (!isFinite(n)) return '—'
  return `${n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}%`
}

// Compact axis-tick label: rupees -> Lacs, no currency symbol (the YAxis's
// own "₹ in Lakhs" title now carries the unit), thousands-separated, no
// decimals.
export function fmtLacsAxis(rupees) {
  return Math.round(toLacs(rupees)).toLocaleString('en-IN')
}

// Bar-top / on-chart value label: rupees -> Lacs, WITH the ₹ symbol and " L"
// suffix — unlike fmtLacsAxis, a label sitting directly on a bar isn't
// backed by an axis title next to it, so it needs to carry the unit itself.
// Same compact (0-decimal) style as the axis ticks, just reusing fmtLacs's
// symbol/formatting rather than re-deriving it.
export function fmtLacsLabel(rupees) {
  return fmtLacs(rupees, 0)
}

// Amount + its % share of a KPI's own total, for a `breakdown` entry (e.g.
// Overview's/CardJourney's Transaction Value/Uptake cards' Ticket vs. F&B
// split) — "₹6,102 L (60.5%)", reusing fmtLacs/fmtPct's own formatting
// rather than a third ad hoc string builder. Omits the parenthetical
// entirely (not a broken "(—%)") when `total` is falsy/zero, since a share
// of a zero total isn't a meaningful number — same "hide broken math"
// convention every other comparison helper in this app already follows.
export function fmtLacsWithPct(amount, total) {
  if (!total) return fmtLacs(amount)
  return `${fmtLacs(amount)} (${fmtPct((amount / total) * 100, 1)})`
}

// Count-in-Lakhs formatter — the same "divide by 100,000, append ' L'"
// convention `fmtLacs` already uses for currency, minus the ₹ symbol,
// since a transaction/card COUNT isn't money. 2026-08-27: added for
// ChannelPerformance.jsx's "reformat every number using the dashboard's
// standard L-suffix Lakh notation" request — 2 decimals by default (not
// fmtLacs's 0) since this page's counts routinely fall well under 1L,
// where 0-decimal rounding would flatten every sub-Lakh figure to "0 L".
export function fmtLacsCount(n, decimals = 2) {
  if (n == null || !isFinite(n)) return '—'
  return `${(n / 100000).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} L`
}

// Axis-tick counterpart — bare number, no " L" suffix (the axis's own
// title carries the unit), mirroring fmtLacsAxis's identical role for
// currency axes. 1 decimal (not fmtLacsAxis's 0) for the same sub-Lakh-
// value reason fmtLacsCount uses 2 instead of fmtLacs's 0.
export function fmtLacsCountAxis(n) {
  return (n / 100000).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export function monthLabel(yearMonth) {
  const [y, m] = yearMonth.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

// A 'YYYY-MM' month array -> a compact human range, e.g. "Jun 26" (single
// month) or "Jun 26 – Jul 26" (a span). Originally built page-locally on
// ChannelPerformance.jsx for its own period-comparison subtitles; moved
// here (2026-08-25) so Overview.jsx's KPI ribbon can reuse the exact same
// formatting for its own date-range badge caption instead of a second,
// independently-authored copy.
export function periodLabel(months) {
  if (!months || months.length === 0) return '—'
  const sorted = [...months].sort()
  return sorted.length === 1 ? monthLabel(sorted[0]) : `${monthLabel(sorted[0])} – ${monthLabel(sorted[sorted.length - 1])}`
}

// Compact single-day label for the Date Range filter's control summary and
// its Overview panel title — 'YYYY-MM-DD' -> "15 Jul '24".
export function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
}

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

export function monthLabel(yearMonth) {
  const [y, m] = yearMonth.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

export function toLacs(rupees) {
  return rupees / 100000
}

export function fmtLacs(rupees, decimals = 2) {
  const lacs = toLacs(rupees)
  return `₹${lacs.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })} L`
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

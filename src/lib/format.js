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

// Compact axis-tick label: rupees -> Lacs, no currency symbol (chart title
// already states the unit), thousands-separated, no decimals.
export function fmtLacsAxis(rupees) {
  return Math.round(toLacs(rupees)).toLocaleString('en-IN')
}

export function monthLabel(yearMonth) {
  const [y, m] = yearMonth.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

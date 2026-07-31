// Month-arithmetic + period-over-period comparison helpers, used for the
// MoM / QoQ / YoY KPI delta badges. Months are always 'YYYY-MM' strings.

export function monthIndex(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number)
  return y * 12 + (m - 1)
}

export function indexToMonth(idx) {
  const y = Math.floor(idx / 12)
  const m = (idx % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

// Calendar-quarter boundaries (Jan/Apr/Jul/Oct) — these are the same 3-month
// windows as the Indian FY quarters (Q1 Apr-Jun .. Q4 Jan-Mar), just without
// the FY-year relabeling, which the arithmetic here doesn't need.
function quarterStartIndex(idx) {
  return idx - (idx % 3 < 0 ? (idx % 3) + 3 : idx % 3)
}

export function quarterMonths(anchorMonth) {
  const start = quarterStartIndex(monthIndex(anchorMonth))
  return [0, 1, 2].map((i) => indexToMonth(start + i))
}

export function previousQuarterMonths(anchorMonth) {
  const start = quarterStartIndex(monthIndex(anchorMonth)) - 3
  return [0, 1, 2].map((i) => indexToMonth(start + i))
}

// The same-length window of calendar months immediately before the earliest
// month in `months` — generalizes single-month MoM to an arbitrary period.
export function precedingPeriod(months) {
  const idxs = months.map(monthIndex).sort((a, b) => a - b)
  const n = idxs.length
  const start = idxs[0] - n
  return Array.from({ length: n }, (_, i) => indexToMonth(start + i))
}

// Same months, exactly one year earlier — generalizes single-month YoY.
export function yoyPeriod(months) {
  return months.map((m) => indexToMonth(monthIndex(m) - 12))
}

// Sums `field` over `rows` restricted to `months`. Returns null (not 0) when
// no row matches — the caller uses that to distinguish "genuinely zero" from
// "no data for this period", which must hide the badge, not show ±Infinity%.
function sumForMonths(rows, field, months) {
  const set = new Set(months)
  let total = 0
  let any = false
  for (const r of rows) {
    if (set.has(r.YearMonth)) {
      total += r[field] || 0
      any = true
    }
  }
  return any ? total : null
}

function pctChange(current, previous) {
  if (current == null || previous == null || previous === 0) return null
  return ((current - previous) / previous) * 100
}

// rows: already filtered by every active filter except Month (and, for the
// QoQ/MoM/YoY previous-period lookups, the previous period is allowed to
// fall in a different month than the current filter selection — that's the
// whole point of the comparison).
export function computeComparisons(rows, field, selectedMonths) {
  if (!selectedMonths || selectedMonths.length === 0) {
    return { mom: null, qoq: null, yoy: null }
  }
  const sorted = [...selectedMonths].sort()
  const current = sumForMonths(rows, field, sorted)
  const momPrev = sumForMonths(rows, field, precedingPeriod(sorted))
  const yoyPrev = sumForMonths(rows, field, yoyPeriod(sorted))

  const anchor = sorted[sorted.length - 1]
  const qoqCurrent = sumForMonths(rows, field, quarterMonths(anchor))
  const qoqPrev = sumForMonths(rows, field, previousQuarterMonths(anchor))

  return {
    mom: pctChange(current, momPrev),
    yoy: pctChange(current, yoyPrev),
    qoq: pctChange(qoqCurrent, qoqPrev)
  }
}

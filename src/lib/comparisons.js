// Month-arithmetic + period-over-period comparison helpers, used for the
// MoM / QoQ / YoY KPI delta badges. Months are always 'YYYY-MM' strings.

import { fyOf } from './constants'
import { sumBy, netBucketsProportionally } from './aggregate'

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
// Exported for the Summary page (2026-08-11), which needs the raw
// current-period sum alongside the deltas computeComparisons() returns.
export function sumForMonths(rows, field, months) {
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

// Shared MoM/QoQ/YoY windowing logic — takes a `summer(months)` function
// instead of a hardcoded field sum, so the same current/preceding/YoY/
// quarter month-window arithmetic can power both a plain field sum
// (computeComparisons below) and a netted-amount sum
// (computeNettedBucketComparisons further down) without duplicating the
// window math itself.
function computeComparisonsFromSummer(summer, selectedMonths) {
  if (!selectedMonths || selectedMonths.length === 0) {
    return { mom: null, qoq: null, yoy: null }
  }
  const sorted = [...selectedMonths].sort()
  const current = summer(sorted)
  const momPrev = summer(precedingPeriod(sorted))
  const yoyPrev = summer(yoyPeriod(sorted))

  const anchor = sorted[sorted.length - 1]
  const qoqCurrent = summer(quarterMonths(anchor))
  const qoqPrev = summer(previousQuarterMonths(anchor))

  return {
    mom: pctChange(current, momPrev),
    yoy: pctChange(current, yoyPrev),
    qoq: pctChange(qoqCurrent, qoqPrev)
  }
}

// rows: already filtered by every active filter except Month (and, for the
// QoQ/MoM/YoY previous-period lookups, the previous period is allowed to
// fall in a different month than the current filter selection — that's the
// whole point of the comparison).
export function computeComparisons(rows, field, selectedMonths) {
  return computeComparisonsFromSummer((months) => sumForMonths(rows, field, months), selectedMonths)
}

// Per-bucket MoM/YoY, for the Summary page's "by Region"/"by Source"/etc.
// breakdown tables (2026-08-11) — same computeComparisons() math, just run
// once per bucket after pre-filtering to that bucket's own predicate,
// exactly the pattern Overview.jsx's bucketRegionData() already established
// for its regional charts. `buckets` is an array of `{key, predicate}`.
// Drops any bucket whose current-period amount is 0 (no data under this
// bucket + the active filters), same zero-hiding convention used elsewhere.
//
// 2026-08-13 bug fix: `amount`/`count` (the headline figure shown on each
// card, and each row of the breakdown table) used to be computed via
// `sumForMonths(bucketRows, field, comparisonMonths)` — the same
// single-latest-month "anchor" `computeComparisons()` uses for its MoM/YoY
// deltas. That anchor is deliberately narrow (it's what lets a delta reach
// "the same month last year"), but it made the *headline total* silently
// collapse to just the latest month whenever Month was left unrestricted —
// e.g. FY2026-27 with Month=All showed "₹1,150L" (July 2026 alone) instead
// of the full FY total (₹2,464.50L, all 4 months summed) — every other
// page's headline KPI is a plain `sumBy(fully-filtered-rows, field)` with
// no such anchoring, so this was a real, page-specific bug, not a
// pre-existing app-wide convention. Fixed by taking two separate row pools:
// `currentRows` (the ordinary, Month-respecting filtered pool — same shape
// as `activationRows`/`redemptionRows` every other page's headline KPI
// already sums) for the headline amount/count, and `rowsAllMonths`
// (Month-unrestricted) only for the MoM/YoY delta math, which still
// genuinely needs to reach adjacent months beyond the Month filter.
export function computeBucketComparisons(currentRows, rowsAllMonths, buckets, field, countField, comparisonMonths) {
  return buckets
    .map((b) => {
      const currentBucketRows = currentRows.filter(b.predicate)
      const allMonthsBucketRows = rowsAllMonths.filter(b.predicate)
      const amount = sumBy(currentBucketRows, field)
      const count = sumBy(currentBucketRows, countField)
      const { mom, yoy } = computeComparisons(allMonthsBucketRows, field, comparisonMonths)
      return { key: b.key, amount, count, mom, yoy }
    })
    .filter((r) => r.amount !== 0)
}

// Same "current amount/count + MoM/YoY per bucket" shape as
// computeBucketComparisons() above, but for the handful of charts where a
// category-less subset of rows (Cancel Redeem transactions — see
// lib/aggregate.js#netBucketsProportionally) must be netted proportionally
// into the real buckets instead of appearing as its own row. `buckets` must
// be the REAL categories only (never 'Cancellation' itself) — there is no
// synthetic "Other" bucket here, unlike computeBucketComparisons, since the
// whole point is that the excluded subset never gets a row of its own.
// `sumForMonthsNetted` mirrors `sumForMonths`'s "null when nothing in this
// window" convention so a missing comparison period still hides the delta
// badge rather than showing a broken percentage.
function sumForMonthsNetted(rows, bucketPredicate, isExcludedRow, amountField, months) {
  const set = new Set(months)
  const inWindow = rows.filter((r) => set.has(r.YearMonth))
  if (inWindow.length === 0) return null
  const realRows = inWindow.filter((r) => !isExcludedRow(r))
  const totalGross = sumBy(realRows, amountField)
  const bucketGross = sumBy(realRows.filter(bucketPredicate), amountField)
  const excludedAmount = sumBy(inWindow.filter(isExcludedRow), amountField)
  return totalGross !== 0 ? bucketGross + excludedAmount * (bucketGross / totalGross) : bucketGross
}

export function computeNettedBucketComparisons(currentRows, rowsAllMonths, buckets, isExcludedRow, amountField, countField, comparisonMonths) {
  const currentNetted = netBucketsProportionally(currentRows, buckets, isExcludedRow, amountField, countField)
  return currentNetted
    .map((b) => {
      const bucket = buckets.find((bb) => bb.key === b.key)
      const { mom, yoy } = computeComparisonsFromSummer(
        (months) => sumForMonthsNetted(rowsAllMonths, bucket.predicate, isExcludedRow, amountField, months),
        comparisonMonths
      )
      return { key: b.key, amount: b[amountField], count: b[countField], mom, yoy }
    })
    .filter((r) => r.amount !== 0)
}

// Full-year (FY) totals for every fiscal year present in `rows` — `rows`
// should already be filtered by every active filter except FY (see
// FilterContext.jsx's activationRowsAllFY/redemptionRowsAllFY), same
// "skip only the one restriction being compared across" pattern as the
// Month-unrestricted pools above. Each entry is tagged `isPartial` (fewer
// than 12 distinct YearMonth values actually present for that FY — a
// data-driven check, not a hardcoded "current FY" assumption, so a future
// data refresh that completes FY2026-27 or adds FY2027-28 needs no code
// change here).
//
// The delta shown per FY is *not* simply "this FY's total vs. the previous
// FY's total" when the trailing FY is partial — full-year-vs-4-months would
// read as a huge fake decline, not a real YoY signal. Instead, a partial
// FY's delta compares its own YTD total against the *same relative months*
// of the previous FY (e.g. Apr-Jul 2026 vs. Apr-Jul 2025) — a real,
// apples-to-apples comparison, labeled distinctly ("vs LY (same months)")
// so it doesn't read as a full-year comparison it isn't. A full FY compares
// against the previous FY's full total as normal ("FY YoY"). The very first
// FY in the data has nothing to compare against and gets no delta at all —
// same "hide missing comparisons" rule as everywhere else in this app.
export function computeFYSeries(rows, field, countField) {
  const byFY = new Map()
  for (const r of rows) {
    const fy = fyOf(r.YearMonth)
    if (!byFY.has(fy)) byFY.set(fy, { months: new Set(), amount: 0, count: 0 })
    const entry = byFY.get(fy)
    entry.months.add(r.YearMonth)
    entry.amount += r[field] || 0
    entry.count += r[countField] || 0
  }
  const fys = [...byFY.keys()].sort()
  return fys.map((fy, i) => {
    const entry = byFY.get(fy)
    const isPartial = entry.months.size < 12
    let deltaPct = null
    let deltaLabel = 'FY YoY'
    if (i > 0) {
      const prevFY = fys[i - 1]
      const prevEntry = byFY.get(prevFY)
      if (isPartial) {
        const ytdPrevMonths = [...entry.months].map((m) => indexToMonth(monthIndex(m) - 12))
        const prevYtdAmount = sumForMonths(rows, field, ytdPrevMonths)
        if (prevYtdAmount != null) {
          deltaPct = pctChange(entry.amount, prevYtdAmount)
          deltaLabel = 'vs LY (same months)'
        }
      } else if (prevEntry && prevEntry.amount !== 0) {
        deltaPct = pctChange(entry.amount, prevEntry.amount)
      }
    }
    return { fy, amount: entry.amount, count: entry.count, monthsPresent: entry.months.size, isPartial, deltaPct, deltaLabel }
  })
}

// Bucket x FY matrix for the Summary page's per-category cards (2026-08-15)
// — replaces the flat "FY Comparison" (total per FY, no category detail)
// that used to sit below the single-period bucket breakdown table. The two
// blocks were showing overlapping-but-incomplete views (a bucket breakdown
// for the *current* filtered period, and a category-blind total per FY)
// with no single place answering "how much did each category contribute in
// each fiscal year" — this is that place. `fys` is the ordered FY list
// already computed by computeFYSeries() (so "which FYs exist and in what
// order" isn't derived a second, possibly-divergent way); a bucket is
// dropped entirely if every one of its FY cells comes out to exactly 0,
// same zero-hiding convention as computeBucketComparisons().
export function computeBucketFYSeries(rows, buckets, amountField, countField, fys) {
  return buckets
    .map((b) => {
      const bucketRows = rows.filter(b.predicate)
      const byFY = Object.fromEntries(fys.map((fy) => [fy, { amount: 0, count: 0 }]))
      for (const r of bucketRows) {
        const fy = fyOf(r.YearMonth)
        if (!byFY[fy]) continue
        byFY[fy].amount += r[amountField] || 0
        byFY[fy].count += r[countField] || 0
      }
      return { key: b.key, byFY }
    })
    .filter((br) => fys.some((fy) => br.byFY[fy].amount !== 0))
}

// Netted counterpart to computeBucketFYSeries() above — for the same
// charts computeNettedBucketComparisons() covers (see its own doc comment),
// nets the excluded subset (Cancel Redeem rows) proportionally into the
// real buckets *within each FY independently* (a cancellation's share of
// each real category's gross total can differ year to year, so the netting
// ratio is recomputed per FY, not applied as one dashboard-wide constant).
// `buckets` must be the REAL categories only, same restriction as
// computeNettedBucketComparisons.
export function computeNettedBucketFYSeries(rows, buckets, isExcludedRow, amountField, countField, fys) {
  const nettedByFY = new Map()
  for (const fy of fys) {
    const fyRows = rows.filter((r) => fyOf(r.YearMonth) === fy)
    nettedByFY.set(fy, netBucketsProportionally(fyRows, buckets, isExcludedRow, amountField, countField))
  }
  return buckets
    .map((b) => {
      const byFY = {}
      for (const fy of fys) {
        const found = nettedByFY.get(fy).find((x) => x.key === b.key)
        byFY[fy] = { amount: found ? found[amountField] : 0, count: found ? found[countField] : 0 }
      }
      return { key: b.key, byFY }
    })
    .filter((br) => fys.some((fy) => br.byFY[fy].amount !== 0))
}

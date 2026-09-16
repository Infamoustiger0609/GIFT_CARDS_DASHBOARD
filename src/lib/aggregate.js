// Small aggregation helpers shared by every page. Rows are always the
// already-filtered arrays produced by FilterContext — these functions never
// filter, only group/sum.

import { WEEKEND_DAYS, HEAD_ORDER } from './constants'

export function sumBy(rows, field) {
  let total = 0
  for (const r of rows) total += r[field] || 0
  return total
}

// 2026-09-16 — exact distinct-card count from a row-level pool (a real
// `CardNumber` field, e.g. `redemption_rowlevel.parquet`'s rows via
// FilterContext's `redemptionRowLevelFiltered`/`cohortRowLevelFiltered`/
// etc.), the shared replacement for every `sumBy(cubeRows,
// 'UniqueCardCount')`/`groupSum(cubeRows, dim, ['UniqueCardCount'])` call
// across the app — see the 2026-09-16 CLAUDE.md entry for the full audit
// this was built for. `UniqueCardCount` on `redemptionCube.json`/
// `cohortCube.json` is a PER-ROW distinct count; summing it across more
// than one row (which is what almost every chart/KPI does, since almost
// none narrow to exactly one cube row) silently double-counts any card
// that appears in more than one of those rows. A `Set` over real
// `CardNumber` values has no such failure mode regardless of how many
// underlying rows a card spans. Always excludes `Head === 'Cancellation'`
// rows — the same "amount nets cancellations in, count excludes them"
// convention already established dashboard-wide (e.g. Card Journey's own
// `redeemedCount`) — a cancellation is a reversal event, not a second
// distinct card to count.
export function exactCardCount(rows) {
  const seen = new Set()
  for (const r of rows) {
    if (r.Head === 'Cancellation') continue
    seen.add(r.CardNumber)
  }
  return seen.size
}

// Per-bucket exact counts — for every "by Region"/"by Head"/"by Format"/
// etc. breakdown that used to pair a `groupSum(..., ['UniqueCardCount'])`
// count with its own amount. Each bucket's `count` is computed
// independently via `exactCardCount()` on just that bucket's own rows —
// deliberately NOT required to sum to a single "total distinct count",
// the same accepted tension `netBucketsProportionally()`'s amount-side
// folding exists to sidestep for amounts (a card appearing in 2 buckets
// is a real, meaningful fact for a *count* breakdown, not a bug to paper
// over — e.g. a card redeemed at both Box Office and F&B in the same
// period is correctly 1 toward each bucket's own count).
// 2026-09-16 perf fix: this used to be `buckets.map(b => exactCardCount(
// rows.filter(b.predicate)))` — one full `.filter()` pass over `rows` PLUS
// one more pass (building the Set) per bucket, so a caller with B buckets
// walked a multi-million-row array 2*B times. Card Journey calls this (and
// the sibling exactWeekSlotCardCounts below) upward of a dozen times per
// render once its row-level pool is ready, which made CardJourney.jsx
// perform 40+ full passes over ~2.1M-row arrays per render — confirmed via
// Playwright instrumentation as the cause of a 10-20+ second render hang
// (see the 2026-09-16 CLAUDE.md entry). Rewritten to a single pass over
// `rows`, testing every bucket's predicate per row and adding to that
// bucket's own Set — same O(rows × buckets) predicate-evaluation count
// (unavoidable, since each row genuinely needs checking against each
// bucket), but exactly ONE array traversal instead of 2*B, with no
// intermediate `.filter()` array allocations.
export function exactCardCountByBucket(rows, buckets) {
  const sets = buckets.map(() => new Set())
  for (const r of rows) {
    if (r.Head === 'Cancellation') continue
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].predicate(r)) sets[i].add(r.CardNumber)
    }
  }
  return buckets.map((b, i) => ({ key: b.key, count: sets[i].size }))
}

// Single-key variant of exactCardCountByBucket(), for the case where every
// row belongs to exactly one bucket determined by one derived value (e.g.
// fiscal year) rather than N independent predicates to test per row — e.g.
// Card Journey's Year-on-Year chart, which used to run exactCardCountByBucket
// with one predicate per FY (each calling fyOf() again), tripling the
// per-row work for no reason once every bucket is really just "group by
// keyFn(row)". Calls `keyFn` exactly once per row instead of once per
// bucket per row.
export function exactCardCountByKey(rows, keyFn) {
  const sets = new Map()
  for (const r of rows) {
    if (r.Head === 'Cancellation') continue
    const key = keyFn(r)
    if (key == null) continue
    let s = sets.get(key)
    if (!s) {
      s = new Set()
      sets.set(key, s)
    }
    s.add(r.CardNumber)
  }
  return Object.fromEntries([...sets].map(([k, s]) => [k, s.size]))
}

// Exact-count counterpart to weekSlotBreakdown()'s own Weekday/Weekend
// split — shared by Overview.jsx/Trends.jsx/CardJourney.jsx, whichever of
// them has a row-level pool loaded, so a Weekday/Weekend card count can be
// merged into weekSlotBreakdown()'s own (amount-correct) output without
// re-deriving the weekend/weekday split a second time.
// 2026-09-16 perf fix: same single-pass rewrite as exactCardCountByBucket
// above (was 2 separate `.filter()` + Set-build passes).
export function exactWeekSlotCardCounts(rows) {
  const weekday = new Set()
  const weekend = new Set()
  for (const r of rows) {
    if (r.Head === 'Cancellation') continue
    ;(WEEKEND_DAYS.has(r.Weekday) ? weekend : weekday).add(r.CardNumber)
  }
  return { Weekday: weekday.size, Weekend: weekend.size }
}

export function groupSum(rows, keyField, valueFields) {
  const map = new Map()
  for (const r of rows) {
    const key = r[keyField]
    if (!map.has(key)) {
      const zero = {}
      for (const f of valueFields) zero[f] = 0
      map.set(key, { key, ...zero })
    }
    const entry = map.get(key)
    for (const f of valueFields) entry[f] += r[f] || 0
  }
  return [...map.values()]
}

// Group by two keys, e.g. month x mode, returning a wide array suitable for
// a multi-series Recharts line/bar: [{ x: '2024-04', Physical: 123, Online: 45 }, ...]
// When countField is given, each series also gets a `${series}__count` sibling
// key (e.g. Physical__count) so chart tooltips can show "amount (N cards)".
export function pivot(rows, xField, seriesField, valueField, countField) {
  const map = new Map()
  for (const r of rows) {
    const x = r[xField]
    const series = r[seriesField]
    if (!map.has(x)) map.set(x, { x })
    const entry = map.get(x)
    entry[series] = (entry[series] || 0) + (r[valueField] || 0)
    if (countField) {
      const countKey = `${series}__count`
      entry[countKey] = (entry[countKey] || 0) + (r[countField] || 0)
    }
  }
  return [...map.values()]
}

export function uniqueSorted(rows, field) {
  return [...new Set(rows.map((r) => r[field]))].sort()
}

// Weekday vs. Weekend split of Activation/Redemption amount+count — shared
// by Trends.jsx's "Week-slot Overview" and Overview.jsx's "Weekend vs
// Weekday" chart so the two can never drift on what counts as a weekend.
export function weekSlotBreakdown(activationRows, redemptionRows) {
  const slot = (weekday) => (WEEKEND_DAYS.has(weekday) ? 'Weekend' : 'Weekday')
  const actWeekday = activationRows.filter((r) => slot(r.Weekday) === 'Weekday')
  const actWeekend = activationRows.filter((r) => slot(r.Weekday) === 'Weekend')
  const redWeekday = redemptionRows.filter((r) => slot(r.Weekday) === 'Weekday')
  const redWeekend = redemptionRows.filter((r) => slot(r.Weekday) === 'Weekend')
  return [
    {
      slot: 'Weekday',
      Activation: sumBy(actWeekday, 'ActivationAmount'),
      ActivationCount: sumBy(actWeekday, 'ActivationCount'),
      Redemption: sumBy(redWeekday, 'RedemptionAmount'),
      RedemptionCount: sumBy(redWeekday, 'RedemptionCount'),
      RedemptionCardCount: sumBy(redWeekday, 'UniqueCardCount')
    },
    {
      slot: 'Weekend',
      Activation: sumBy(actWeekend, 'ActivationAmount'),
      ActivationCount: sumBy(actWeekend, 'ActivationCount'),
      Redemption: sumBy(redWeekend, 'RedemptionAmount'),
      RedemptionCount: sumBy(redWeekend, 'RedemptionCount'),
      RedemptionCardCount: sumBy(redWeekend, 'UniqueCardCount')
    }
  ]
}

// Splits `rows` into Digital/Physical amount+count, folding any remainder
// (rows with no CardType, or a CardType this dashboard doesn't chart as its
// own bucket — e.g. the redemption cube's "Unknown (pre-existing)"/"N/A")
// into whichever of Digital/Physical is larger. Same fold rule as
// lib/activationSource.js#groupByActivationSource's per-source Digital/
// Physical split — factored out here so a second call site (Overview.jsx's
// CardType chart) can't silently drop that remainder instead of folding it,
// which would make Digital+Physical stop summing to the row set's true
// total (caught by the 2026-08-03 data-binding audit: the remainder rows
// carry net-negative correction amounts, so dropping them silently
// inflates the displayed total above the real one, not just undercounts).
export function splitByCardType(rows, amountField, countField) {
  const digitalRows = rows.filter((r) => r.CardType === 'Digital')
  const physicalRows = rows.filter((r) => r.CardType === 'Physical')
  let digitalAmount = sumBy(digitalRows, amountField)
  let physicalAmount = sumBy(physicalRows, amountField)
  const unclassified = sumBy(rows, amountField) - digitalAmount - physicalAmount
  if (digitalAmount >= physicalAmount) digitalAmount += unclassified
  else physicalAmount += unclassified
  return {
    Digital: digitalAmount,
    Digital__count: sumBy(digitalRows, countField),
    Physical: physicalAmount,
    Physical__count: sumBy(physicalRows, countField)
  }
}

// Buckets `rows` into `modeTable`'s keys (each `{ key, modes }`) by
// whichever field carries the mode value (modeField), then splits each
// bucket by CardType via splitByCardType() so Digital+Physical always sums
// back to the bucket's own total. Shared by lib/activationSource.js's
// ACTIVATION_SOURCES (3 buckets, activation-origin model) and
// lib/redemptionMode.js's REDEMPTION_MODES (2 buckets, redemption-channel
// model) — same bucketing mechanics, two unrelated tables, so the fold
// logic can't drift between the two models.
export function groupByModeTable(rows, modeTable, { modeField, amountField, countField }) {
  return modeTable.map(({ key, modes }) => {
    const bucketRows = rows.filter((r) => modes.includes(r[modeField]))
    const split = splitByCardType(bucketRows, amountField, countField)
    return {
      key,
      amount: sumBy(bucketRows, amountField),
      count: sumBy(bucketRows, countField),
      digital: { amount: split.Digital, count: split.Digital__count },
      physical: { amount: split.Physical, count: split.Physical__count }
    }
  })
}

// Region+Month "winner" map for attributing a Physical-mode Cancel Redeem
// row to Box Office *or* F&B specifically — a cancellation row's own Head
// is always 'Cancellation', never the head it's reversing, so which of the
// two it belongs to is genuinely ambiguous at the single-row level. Proxy:
// each Region+Month is attributed *in bulk* to whichever of Box Office/F&B
// had the larger gross RedemptionAmount in that same Region+Month — not
// exact to the rupee, but every cancellation always lands on exactly one
// side, so nothing is double-counted or dropped regardless of which side
// "wins" (see netHeadRows() below, and netCinemaRedemption() above, which
// needs no such proxy since merging Box Office+F&B removes the ambiguity).
export function physicalCancelWinnerMap(redemptionRows) {
  const boxOfficeByRegionMonth = new Map()
  const fnbByRegionMonth = new Map()
  for (const r of redemptionRows) {
    if (r.Head !== 'Box Office' && r.Head !== 'F&B') continue
    const map = r.Head === 'Box Office' ? boxOfficeByRegionMonth : fnbByRegionMonth
    const rmKey = `${r.Region_Clean}|${r.YearMonth}`
    map.set(rmKey, (map.get(rmKey) || 0) + (r.RedemptionAmount || 0))
  }
  const winner = new Map()
  const allKeys = new Set([...boxOfficeByRegionMonth.keys(), ...fnbByRegionMonth.keys()])
  for (const rmKey of allKeys) {
    const boxOfficeShare = boxOfficeByRegionMonth.get(rmKey) || 0
    const fnbShare = fnbByRegionMonth.get(rmKey) || 0
    winner.set(rmKey, boxOfficeShare >= fnbShare ? 'Box Office' : 'F&B')
  }
  return winner
}

// Row-level "net Head X" pool: `headKey`'s own rows plus whichever Cancel
// Redeem rows are attributed to it — Online-mode cancellations map 1:1 to
// the Online head (exact, no ambiguity, since Online is the only head ever
// redeemed through that Outlet); Physical-mode cancellations split Box
// Office vs F&B via the winner map above. Returns real rows, not a
// pre-summed total, so callers can run sumBy/computeComparisons/groupSum
// on it exactly like any other row pool (including further breakdowns —
// a cancellation row's own Region_Clean/Weekday/CardType ride along
// unchanged, so e.g. netting into a CardType split needs no extra proxy,
// only Head-vs-Head needs the winner map).
//
// Single source of truth: every "net Box Office"/"net F&B"/"net Online"
// figure dashboard-wide must be computed via this function (or
// netRedemptionHeads() below), not re-derived from `Head === 'Box Office'`
// alone — see the 2026-08-06 CLAUDE.md entry for the bug that caused:
// Overview's flow diagram showed net Box Office/F&B, while
// RedemptionBoxOffice.jsx/RedemptionFnb.jsx's own headline KPIs showed
// gross, for the exact same nominal metric.
export function netHeadRows(redemptionRows, headKey, winnerMap) {
  const winner = winnerMap || physicalCancelWinnerMap(redemptionRows)
  const headRows = redemptionRows.filter((r) => r.Head === headKey)
  const cancelRows = redemptionRows.filter((r) => r.Head === 'Cancellation')
  const attributed = cancelRows.filter((r) => {
    if (headKey === 'Online') return r.RedemptionModeFinal === 'Online'
    if (r.RedemptionModeFinal !== 'Physical') return false
    const rmKey = `${r.Region_Clean}|${r.YearMonth}`
    return (winner.get(rmKey) || 'Box Office') === headKey
  })
  return [...headRows, ...attributed]
}

// Flat net Online/Box Office/F&B totals (amount + count) — e.g. the
// redemption flow diagram's 3 head nodes. RedemptionCount (transaction
// count) is kept alongside UniqueCardCount (distinct-card count) rather than
// replaced — some future/other consumer may still need the transaction
// figure; every current card-count display reads UniqueCardCount instead.
export function netRedemptionHeads(redemptionRows) {
  const winner = physicalCancelWinnerMap(redemptionRows)
  return ['Online', 'Box Office', 'F&B'].map((key) => {
    const rows = netHeadRows(redemptionRows, key, winner)
    return {
      key,
      RedemptionAmount: sumBy(rows, 'RedemptionAmount'),
      RedemptionCount: sumBy(rows, 'RedemptionCount'),
      UniqueCardCount: sumBy(rows, 'UniqueCardCount')
    }
  })
}

// True for a redemption row that counts toward "net Cinema (Box Office +
// F&B combined) redemption" — Head in (Box Office, F&B), plus their own
// Cancel Redeem reversals netted in directly. A cancellation row already
// carries its own real Region_Clean/YearMonth, so netting it into Cinema
// needs no proportional guessing — unlike attributing a cancellation to
// Box Office *vs* F&B specifically (a genuinely ambiguous split a
// cancellation row's Head never resolves, since it's always
// 'Cancellation' — see physicalCancelWinnerMap()/netHeadRows() above for
// that different, head-level proxy). Only Physical-mode cancellations
// qualify — Online-mode cancellations reverse the Online head, which isn't
// part of Cinema.
//
// Single source of truth: every chart/KPI/node that shows "net Cinema
// redemption" should filter through this predicate (or the two helpers
// below) rather than re-deriving its own Head/RedemptionModeFinal check —
// see the 2026-08-06 CLAUDE.md entry for the bug two independently-written
// copies of this filter caused (same region, two different numbers).
export function isNetCinemaRedemptionRow(row) {
  return row.Head === 'Box Office' || row.Head === 'F&B' || (row.Head === 'Cancellation' && row.RedemptionModeFinal === 'Physical')
}

// Flat net Cinema total (amount + count) — e.g. a single flow-diagram node.
export function netCinemaRedemption(redemptionRows) {
  const rows = redemptionRows.filter(isNetCinemaRedemptionRow)
  return {
    RedemptionAmount: sumBy(rows, 'RedemptionAmount'),
    RedemptionCount: sumBy(rows, 'RedemptionCount'),
    UniqueCardCount: sumBy(rows, 'UniqueCardCount')
  }
}

// Net Cinema total broken out by region — for any future "Cinema by
// Region" chart that needs to agree with the flat total above by
// construction (same predicate), not by coincidence.
export function netCinemaRedemptionByRegion(redemptionRows) {
  return groupSum(redemptionRows.filter(isNetCinemaRedemptionRow), 'Region_Clean', ['RedemptionAmount', 'RedemptionCount', 'UniqueCardCount'])
}

// Nets a "no real category" subset of rows (e.g. Cancel Redeem
// transactions — CardType is always 'N/A' on them, and they shouldn't get
// their own bar on a Head/Source/Region chart either) proportionally into
// the real buckets by each bucket's own share of the gross (non-excluded)
// total, instead of the excluded subset showing up as its own bucket/bar.
// 2026-08-15: Cancellation should only ever be a visible category on the
// dedicated Cancel Redeem page — everywhere else that breaks the
// redemption cube down by CardType/Head/Source/Region, its amount gets
// folded in like this. `buckets` must be the REAL categories only (e.g.
// Online/Box Office/F&B, never 'Cancellation' itself) — there's no
// synthetic "Other"/remainder bucket appended, since the whole point is
// that the excluded subset never gets a row of its own. `count` is left
// as each bucket's own gross count, unadjusted — same "amount nets
// cancellations in, count excludes them" convention already established
// dashboard-wide (e.g. the Mode-filter entries, Card Journey's own
// redeemedCount).
// The 3 real redemption heads (Online/Box Office/F&B), excluding
// 'Cancellation' — the bucket set to net Cancel Redeem rows into wherever a
// chart breaks the redemption cube down by Head, plus the predicate that
// identifies those rows. Shared by Summary.jsx and CardJourney.jsx (the two
// current consumers) so neither can drift from HEAD_ORDER's own definition
// of what the real heads are.
export const REAL_HEAD_BUCKETS = HEAD_ORDER.filter((h) => h !== 'Cancellation').map((h) => ({ key: h, predicate: (r) => r.Head === h }))
export function isCancellationRow(row) {
  return row.Head === 'Cancellation'
}

export function netBucketsProportionally(rows, buckets, isExcludedRow, amountField, countField) {
  const realRows = rows.filter((r) => !isExcludedRow(r))
  const excludedAmount = sumBy(rows.filter(isExcludedRow), amountField)
  const gross = buckets.map((b) => {
    const bucketRealRows = realRows.filter(b.predicate)
    return { key: b.key, amount: sumBy(bucketRealRows, amountField), count: sumBy(bucketRealRows, countField) }
  })
  const totalGross = sumBy(gross, 'amount')
  return gross.map((b) => ({
    key: b.key,
    [amountField]: totalGross !== 0 ? b.amount + excludedAmount * (b.amount / totalGross) : b.amount,
    [countField]: b.count
  }))
}

// Sums every numeric value field (not just valueField) into the "Other"
// bucket, so a paired count field carried on the same entries (e.g. from
// groupSum(rows, key, ['Amount', 'Count'])) stays correct after collapsing.
export function topNWithOther(entries, n, keyField, valueField) {
  const sorted = [...entries].sort((a, b) => b[valueField] - a[valueField])
  if (sorted.length <= n) return sorted
  const top = sorted.slice(0, n)
  const rest = sorted.slice(n)
  const numericFields = Object.keys(entries[0] || {}).filter((f) => f !== keyField && f !== 'key' && typeof entries[0][f] === 'number')
  const other = { [keyField]: 'Other', key: 'Other' }
  for (const f of numericFields) other[f] = rest.reduce((s, r) => s + (r[f] || 0), 0)
  top.push(other)
  return top
}

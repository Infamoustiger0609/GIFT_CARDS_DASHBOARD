// Month-arithmetic + period-over-period comparison helpers, used for the
// MoM / QoQ / YoY KPI delta badges. Months are always 'YYYY-MM' strings.
//
// 2026-08-25 — full redefinition of what MoM/QoQ/YoY mean, replacing the
// prior "sum whatever months are ticked, compare to the immediately
// preceding/1-year-back window of the same length" logic entirely. The new
// rule: every badge is anchored to the LATEST month in the current
// selection (last of `selectedMonths` after sorting — resolved by the
// caller, FilterContext.jsx#comparisonMonths, to either the explicit Month
// selection or the dataset's own latest month under the rest of the active
// filters). Region/CardType/Source/etc. only ever affect which ROWS get
// summed within a given month; they never change which month is the
// anchor or which months make up a comparison window — every window below
// is derived purely from calendar structure around the anchor:
//   MoM: the anchor month alone vs. the same calendar month one year
//        earlier.
//   QoQ: [the anchor's calendar-quarter start .. anchor] vs. the identical
//        span one year earlier. Quarter starts are fixed calendar
//        boundaries (Jan/Apr/Jul/Oct) — the same 3-month groupings as the
//        FY quarters (Apr-Jun/Jul-Sep/Oct-Dec/Jan-Mar), just without the
//        FY-year relabeling. An anchor that IS its own quarter's first
//        month (e.g. July) yields a length-1 window, same as MoM.
//   YoY: [the anchor's FY start (April) .. anchor] vs. the identical span
//        one year earlier.
// All three windows are always computable from the anchor alone, so all
// three badges are always attempted — there is no "single month selected
// -> MoM only" case; a lone selected month still gets a real (if
// short) QoQ/YoY window per the rules above. A badge still hides itself
// when the actual data for one of its two windows is missing (the
// established "don't show broken math" rule), but that's a data-
// availability outcome, never a rule about how many months were selected.

import { useEffect, useMemo, useRef, useState } from 'react'
import { fyOf, NONE_SELECTED } from './constants'
import { sumBy, netBucketsProportionally } from './aggregate'
import { useFilters } from './FilterContext'
import { periodLabel } from './format'

export function monthIndex(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number)
  return y * 12 + (m - 1)
}

export function indexToMonth(idx) {
  const y = Math.floor(idx / 12)
  const m = (idx % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

// Calendar-quarter boundaries (Jan/Apr/Jul/Oct) — see the file-level doc
// comment above for why these double as the FY quarter boundaries.
function quarterStartIndex(idx) {
  return idx - (idx % 3 < 0 ? (idx % 3) + 3 : idx % 3)
}

// Inclusive range of consecutive months, by index.
function monthRangeByIndex(startIdx, endIdx) {
  const out = []
  for (let i = startIdx; i <= endIdx; i++) out.push(indexToMonth(i))
  return out
}

// [anchor's calendar-quarter start .. anchor] — e.g. anchor '2025-09' (the
// Jul-Sep quarter) -> ['2025-07', '2025-08', '2025-09'].
function quarterToDateMonths(anchor) {
  const anchorIdx = monthIndex(anchor)
  return monthRangeByIndex(quarterStartIndex(anchorIdx), anchorIdx)
}

// [anchor's FY start (April) .. anchor] — e.g. anchor '2025-09' (FY2025-26,
// which starts April 2025) -> ['2025-04', ..., '2025-09']. Deliberately
// re-derives the FY-start year inline (matching fyOf()'s own
// `m >= 4 ? y : y - 1` rule) rather than parsing fyOf()'s "FYyyyy-yy"
// output string back into a year — that round-trip through a formatted
// label is more fragile than just repeating the one-line rule.
function fyToDateMonths(anchor) {
  const anchorIdx = monthIndex(anchor)
  const [y, m] = anchor.split('-').map(Number)
  const startYear = m >= 4 ? y : y - 1
  return monthRangeByIndex(monthIndex(`${startYear}-04`), anchorIdx)
}

// Same months, exactly one year earlier. Exported (2026-08-21) so
// ChannelPerformance.jsx can reuse this exact primitive for its own "this
// period vs. the same period one year earlier" table, rather than
// re-deriving the same one-year-back arithmetic a second time — see that
// page's own doc comment for why its "current period" is comparisonMonths
// itself (the same anchor concept every MoM/QoQ/YoY badge already reads)
// and its "prior period" is just this function applied to it.
export function oneYearEarlier(months) {
  return months.map((m) => indexToMonth(monthIndex(m) - 12))
}

// 2026-08-24 — MTD/QTD/YTD preset windows anchored at a given month, reusing
// the exact same quarterToDateMonths()/fyToDateMonths() window builders the
// MoM/QoQ/YoY engine below already computes from — a "select this preset"
// button can therefore set the Month/FY filters to reproduce precisely the
// window a badge is already showing, rather than a second, independently-
// authored definition of "this month"/"this quarter"/"this fiscal year to
// date". `anchor` is whatever the caller's own comparisonMonths resolves to
// (the last/latest month in the current selection) — same anchor concept
// every delta badge already reads.
export function presetWindows(anchor) {
  return {
    mtd: [anchor],
    qtd: quarterToDateMonths(anchor),
    ytd: fyToDateMonths(anchor)
  }
}

// 2026-08-25 — the 4 fixed calendar-quarter windows (Apr-Jun/Jul-Sep/
// Oct-Dec/Jan-Mar) of the fiscal year containing `anchor` — for
// Overview.jsx's QTD control, converted from a single "quarter-to-date"
// button into a Q1/Q2/Q3/Q4 dropdown that needs to enumerate (and
// independently gate, by data availability) all 4 of the relevant FY's
// quarters, not just the one quarterToDateMonths()/presetWindows().qtd
// already gives the QoQ badge (quarter-start through the anchor alone).
// Re-derives the FY-start year the same one-line way fyToDateMonths()
// already does, rather than a second copy of that rule.
export function fyQuarterMonths(anchor) {
  const [y, m] = anchor.split('-').map(Number)
  const startYear = m >= 4 ? y : y - 1
  const qStartIdx = monthIndex(`${startYear}-04`)
  return [0, 1, 2, 3].map((q) => {
    const start = qStartIdx + q * 3
    return [indexToMonth(start), indexToMonth(start + 1), indexToMonth(start + 2)]
  })
}

// 2026-08-30 — "Breakage": the cumulative unredeemed remainder across
// every activation cohort that's past its 13-month validity window (a
// card activated in month M is valid through M+12 inclusive, expired
// starting M+13) — NOT a single month's cohort, every month from the
// dataset's own start through the cutoff, summed. `anchorMonth` is the
// same anchor concept MTD/QTD/YTD/custom already share
// (`usePresetWindow()`'s own `anchorMonth`, below); the cutoff is derived
// from it as `anchorMonth − 13` months, via the same `monthIndex()`/
// `indexToMonth()` arithmetic every other window builder in this file
// already uses — no new month arithmetic invented for this.
//
// `activationRows` should be a Month/FY-unrestricted pool (e.g.
// `activationRowsForComparison`) — this calculation is *inherently* about
// activation months almost always outside whatever's currently selected
// (the cutoff sits 13 months behind the anchor), so restricting to the
// current Month/FY would silently zero it out. `cohortRows` should
// likewise be Month/FY-unrestricted (`cohortRowsForComparison`) with
// `RedemptionYearMonth` left completely open — "however much of that
// cohort has been redeemed to date, any redemption month" is exactly the
// same activation-fixed/redemption-unbounded shape the spillover chart's
// own `cohortRowsByActivation` already uses, just evaluated for every
// historical activation month at once instead of just the currently
// selected one. Both pools already exclude the cohort cube's
// "Pre-existing" sentinel rows unconditionally (`passesCohortCommon()` in
// FilterContext.jsx), so no extra exclusion is needed here.
//
// Because summation is linear, "sum each month's (activation − redeemed)"
// across every qualifying month equals "(sum of all qualifying
// activation) − (sum of all qualifying redeemed-to-date)" — no per-month
// grouping/matching needed, just two independently-filtered sums.
//
// Returns `{ amount, cutoffMonth, hasCohorts }`. `hasCohorts` is false
// whenever the cutoff falls before the dataset's own earliest activation
// month (derived from `activationRows` itself, not hardcoded, so a future
// data refresh needs no code change) — no cohort has reached expiry yet,
// so `amount` is 0 rather than computed from an empty/nonsensical window
// (verified: anchor Apr 2025 or earlier → cutoff Mar 2024 or earlier, one
// month short of this dataset's Apr 2024 start → ₹0). `amount` is also
// floored at 0 generally, never negative, per an explicit "show ₹0, don't
// go negative" instruction — aggregate redemption CAN exceed aggregate
// activation for a slice of this dataset (see this file's own ">100% bug"
// investigation elsewhere in CLAUDE.md), so this guard is a real safety
// net, not a defensive no-op.
export function computeBreakage(activationRows, cohortRows, anchorMonth) {
  if (!anchorMonth || activationRows.length === 0) return { amount: 0, cutoffMonth: null, hasCohorts: false }
  const cutoffIdx = monthIndex(anchorMonth) - 13
  const cutoffMonth = indexToMonth(cutoffIdx)
  const datasetStartIdx = Math.min(...activationRows.map((r) => monthIndex(r.YearMonth)))
  if (cutoffIdx < datasetStartIdx) return { amount: 0, cutoffMonth, hasCohorts: false }
  const activationTotal = sumBy(activationRows.filter((r) => monthIndex(r.YearMonth) <= cutoffIdx), 'ActivationAmount')
  const redeemedToDate = sumBy(cohortRows.filter((r) => monthIndex(r.ActivationYearMonth) <= cutoffIdx), 'RedemptionAmount')
  return { amount: Math.max(0, activationTotal - redeemedToDate), cutoffMonth, hasCohorts: true }
}

// Breakage's own delta — "compare against the equivalent cumulative figure
// using last year's anchor (same A−13 rule, one year earlier)". Breakage
// is a point-in-time cumulative BALANCE, not a flow quantity summed over a
// selected window, so MoM/QoQ sub-windows the way computeComparisons()
// derives them don't apply here — there is only ever this one meaningful
// comparison. Rendered as a single fixed "YoY"-labeled badge on both pages
// (via a plain `deltas={[{label:'YoY', pct: ...}]}`, not `kpiDeltas()`),
// same single-badge visual convention every other KPI's delta already
// uses, just without the preset-dependent label switch that only makes
// sense for a flow quantity. `pctChange`'s own "hide on a zero/missing
// previous value" rule already covers the "no cohorts yet" case (both
// sides computing to 0) with no extra guard needed here.
export function computeBreakageYoyPct(activationRows, cohortRows, anchorMonth) {
  if (!anchorMonth) return null
  const current = computeBreakage(activationRows, cohortRows, anchorMonth)
  const priorAnchor = indexToMonth(monthIndex(anchorMonth) - 12)
  const prior = computeBreakage(activationRows, cohortRows, priorAnchor)
  return pctChange(current.amount, prior.amount)
}

// 2026-08-28 — the entire MTD/QTD(Q1-Q4 dropdown)/YTD control area's state
// and behavior, extracted here so a second page (CardJourney.jsx) can carry
// the exact same control Overview.jsx built (2026-08-24/25) without a
// second, independently-authored copy of this ~130-line block. Nothing in
// here is Overview-specific — it only ever reads comparisonMonths/filters/
// setFilter/options from useFilters() and the anchor/window primitives
// above, so lifting it into one shared hook was a pure extraction, not a
// rewrite; Overview.jsx's own behavior is unchanged after switching to it
// (verified — see CLAUDE.md).
//
// Returns everything a page's JSX needs to render the MTD/QTD/YTD row and
// wire each KPI's `deltas` via kpiDeltas() below: `presets`/`selectedMonths`
// (the underlying windows), `quarterOptions` (for the Q1-Q4 dropdown, each
// gated on real data availability within the anchor FY), `activePreset`/
// `activeQuarter`/`qtdMenuOpen`/`setQtdMenuOpen`/`qtdMenuRef` (UI state),
// `applyPreset`/`applyQuarter` (click handlers), and `windowDateRangeLabel`
// (the one shared top-of-page caption both pages render once, instead of
// per-card).
export function usePresetWindow() {
  const { comparisonMonths, filters, setFilter, options } = useFilters()

  // The anchor MTD/QTD/YTD windows are built from — the same "latest month
  // in the current selection" comparisonMonths itself resolves to
  // (comparisonMonths may be a single anchor OR an explicit multi-month
  // selection; either way, its own latest month is the right anchor for
  // "what would clicking MTD/QTD/YTD select right now").
  const anchorMonth = comparisonMonths.length ? [...comparisonMonths].sort()[comparisonMonths.length - 1] : null
  const presets = useMemo(() => (anchorMonth ? presetWindows(anchorMonth) : { mtd: [], qtd: [], ytd: [] }), [anchorMonth])

  // `selectedMonths` (what the "custom window" badge sums over): whenever
  // Month=All, it's literally `presets.ytd` — the exact same
  // fyToDateMonths(anchorMonth) window the YTD button itself would set
  // (anchorMonth is unaffected by toggling any FY other than the one it
  // actually falls in, so this is immune to an unrelated older FY's toggle
  // state by construction). Whenever Month is an explicit restriction,
  // `selectedMonths` is the subset of the LITERAL ticked months that fall
  // in the anchor's own FY — `filters.month` itself, not the FY-narrowed
  // `options.months` — so an unrelated FY simultaneously ticked in the FY
  // filter can never leak extra months in or out.
  const isMonthAll = filters.month.length === 0
  const isMonthNoneSelected = filters.month.length === 1 && filters.month[0] === NONE_SELECTED
  const anchorFY = anchorMonth ? fyOf(anchorMonth) : null
  const selectedMonths = useMemo(() => {
    if (isMonthNoneSelected || !anchorMonth) return []
    if (isMonthAll) return presets.ytd
    return [...filters.month].filter((m) => fyOf(m) === anchorFY).sort()
  }, [isMonthNoneSelected, isMonthAll, anchorMonth, anchorFY, presets.ytd, filters.month])

  // QTD as a Q1-Q4 dropdown: `anchorFYMonths` is every month of the
  // anchor's own FY that actually exists in the dataset (`options.months`
  // is already FY-narrowed to whichever FY(s) are currently selected, and
  // anchorFY is always one of those, so filtering to just anchorFY gives
  // exactly "which real months of this FY are on file", independent of
  // Region/CardType/etc.). Each of the 4 quarters is restricted to
  // whichever of its own 3 months actually exist — a quarter with all 3
  // present is selectable as a full quarter; 1-2 present (the dataset's
  // current, ongoing quarter) is selectable as a quarter-to-date partial;
  // none present (fully in the future) is disabled entirely.
  const anchorFYMonths = useMemo(() => options.months.filter((m) => fyOf(m) === anchorFY), [options.months, anchorFY])
  const quarterOptions = useMemo(() => {
    if (!anchorMonth) return []
    return fyQuarterMonths(anchorMonth).map((qMonths, i) => {
      const availableMonths = qMonths.filter((m) => anchorFYMonths.includes(m))
      return { key: i + 1, label: `Q${i + 1}`, months: availableMonths, disabled: availableMonths.length === 0 }
    })
  }, [anchorMonth, anchorFYMonths])

  // Clicking a preset (MTD/YTD button, or a Q1-Q4 dropdown option) is a
  // one-shot action, not a toggleable "mode" kept in sync with whatever the
  // filters happen to equal — manually changing ANY filter afterward
  // (Month, FY, Region, etc.) drops back to "no preset active", even if the
  // resulting Month/FY selection would numerically match a preset's own
  // window. A pure "does filters.fy/month equal preset X's window"
  // derivation couldn't satisfy that (Region changing never touches
  // fy/month at all), so this is tracked as its own state, explicitly
  // cleared by a useEffect the moment `filters` changes for any reason
  // OTHER than the preset click that just set it. `activeQuarter` (1-4, or
  // null) is a second piece of state alongside `activePreset==='qtd'` —
  // which of the 4 dropdown rows to highlight — cleared any time a
  // different preset (or no preset) becomes active.
  const [activePreset, setActivePreset] = useState(null)
  const [activeQuarter, setActiveQuarter] = useState(null)
  const [qtdMenuOpen, setQtdMenuOpen] = useState(false)
  const qtdMenuRef = useRef(null)
  const presetAppliedFiltersRef = useRef(null)

  useEffect(() => {
    function onDocMouseDown(e) {
      if (qtdMenuRef.current && !qtdMenuRef.current.contains(e.target)) setQtdMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  function applyMonths(key, months) {
    if (!months || months.length === 0) return
    const targetFY = fyOf(months[months.length - 1])
    // FY set first, Month second — setFilter('fy', ...) prunes any
    // pre-existing Month selection against the NEW fy, but the very next
    // call overwrites Month unconditionally, so the final state is always
    // exactly { fy: [targetFY], month: [...months] } regardless of what
    // was selected before (see FilterContext.jsx#setFilter's own FY-change
    // pruning logic).
    setFilter('fy', [targetFY])
    setFilter('month', [...months].sort())
    setActivePreset(key)
    presetAppliedFiltersRef.current = 'pending'
  }

  function applyPreset(key) {
    setActiveQuarter(null)
    applyMonths(key, presets[key])
  }

  function applyQuarter(quarter) {
    if (quarter.disabled) return
    setActiveQuarter(quarter.key)
    applyMonths('qtd', quarter.months)
    setQtdMenuOpen(false)
  }

  useEffect(() => {
    if (presetAppliedFiltersRef.current === 'pending') {
      // The batched fy+month update from applyMonths() just landed —
      // capture this exact filters object as "what the preset produced",
      // not a signal to clear activePreset.
      presetAppliedFiltersRef.current = filters
      return
    }
    if (activePreset && filters !== presetAppliedFiltersRef.current) {
      setActivePreset(null)
      setActiveQuarter(null)
    }
  }, [filters, activePreset])

  // One shared date-range line, rendered once (top-left of the preset
  // control row, mirroring where the MTD/QTD/YTD controls sit top-right)
  // instead of repeated under every individual KPI's badge — the window is
  // a ribbon-wide concept, not per-KPI. MTD/YTD read their current window
  // straight from `presets`; QTD (a specific Q1-Q4 selection, not a single
  // "quarter-to-date-through-today" window) and the custom fallback both
  // read `selectedMonths` — once a quarter is picked, `filters.month` IS
  // exactly that quarter's own real months, which `selectedMonths` already
  // resolves to via its own "explicit Month restriction, within the
  // anchor's FY" branch, so no separate qtd-specific window is needed here.
  const windowCurrentMonths = activePreset === 'mtd' ? presets.mtd : activePreset === 'ytd' ? presets.ytd : selectedMonths
  const windowPriorMonths = useMemo(() => oneYearEarlier(windowCurrentMonths), [windowCurrentMonths])
  const windowDateRangeLabel = `${periodLabel(windowCurrentMonths)} vs. ${periodLabel(windowPriorMonths)}`

  return {
    anchorMonth,
    presets,
    selectedMonths,
    quarterOptions,
    activePreset,
    activeQuarter,
    qtdMenuOpen,
    setQtdMenuOpen,
    qtdMenuRef,
    applyPreset,
    applyQuarter,
    windowCurrentMonths,
    windowPriorMonths,
    windowDateRangeLabel
  }
}

// 2026-08-25 correction: the MTD/QTD/YTD badge rule is strictly 2-way — a
// preset active shows ONLY that preset's own badge (MTD->MoM, QTD->QoQ,
// YTD->YoY), the other two hidden entirely; anything else (including a
// page's own true default, FY=All/Month=All) shows exactly one generic
// badge. That generic badge's label is `''` (not "vs. Last Year" — a
// follow-up request replaced that wording with a plain "▲ X%", the actual
// date range stated separately via `usePresetWindow()`'s own
// `windowDateRangeLabel`) — same `label=""` convention
// `MetricComparisonCard.jsx` already uses for its own unlabeled MoM/YoY
// cells, not a new one.
//
// 2026-08-29 (Phase 4 audit): extracted the preset->label half into its own
// `presetBadgeLabel()` — Channel Performance's own metrics (a single
// this-vs-prior comparison over whichever ONE window is current, not 3
// parallel anchor-derived sub-windows the way computeComparisons() produces)
// can't use `kpiDeltas()` directly, since it expects a `{mom,qoq,yoy}`
// triple, but still needs the identical "which label does the active
// preset imply" rule — reusing this instead of a second, page-local copy of
// the same 3-line mapping (which is exactly what a first pass at that page
// had done, caught by this same audit).
export function presetBadgeLabel(activePreset) {
  if (activePreset === 'mtd') return 'MoM'
  if (activePreset === 'qtd') return 'QoQ'
  if (activePreset === 'ytd') return 'YoY'
  return ''
}

// 2026-08-28: promoted from an Overview.jsx-local function to here so
// CardJourney.jsx's own KPI ribbon can share the exact same badge-selection
// rule rather than a second copy.
export function kpiDeltas(activePreset, comparisonObj, customPct) {
  const label = presetBadgeLabel(activePreset)
  if (label === 'MoM') return [{ label, pct: comparisonObj.mom }]
  if (label === 'QoQ') return [{ label, pct: comparisonObj.qoq }]
  if (label === 'YoY') return [{ label, pct: comparisonObj.yoy }]
  return [{ label: '', pct: customPct }]
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

// Exported (2026-08-24) so Overview.jsx's own "custom window" comparison
// below can reuse this exact formula instead of a second hand-rolled copy
// (already duplicated once, page-locally, by ChannelPerformance.jsx before
// this export existed — extracting it here stops a third copy).
export function pctChange(current, previous) {
  if (current == null || previous == null || previous === 0) return null
  return ((current - previous) / previous) * 100
}

// Shared MoM/QoQ/YoY windowing logic — takes a `summer(months)` function
// instead of a hardcoded field sum, so the same anchor-derived window
// arithmetic can power a plain field sum (computeComparisons below), a
// netted-amount sum (computeNettedBucketComparisons further down), and a
// ratio (computeRatioComparisons) without duplicating the window math
// itself. See the file-level doc comment above for the actual MoM/QoQ/YoY
// rule this implements.
function computeComparisonsFromSummer(summer, selectedMonths) {
  if (!selectedMonths || selectedMonths.length === 0) {
    return { mom: null, qoq: null, yoy: null }
  }
  const sorted = [...selectedMonths].sort()
  const anchor = sorted[sorted.length - 1]

  const momCurrent = [anchor]
  const momPrev = oneYearEarlier(momCurrent)

  const qoqCurrent = quarterToDateMonths(anchor)
  const qoqPrev = oneYearEarlier(qoqCurrent)

  const yoyCurrent = fyToDateMonths(anchor)
  const yoyPrev = oneYearEarlier(yoyCurrent)

  return {
    mom: pctChange(summer(momCurrent), summer(momPrev)),
    qoq: pctChange(summer(qoqCurrent), summer(qoqPrev)),
    yoy: pctChange(summer(yoyCurrent), summer(yoyPrev))
  }
}

// rows: already filtered by every active filter except Month (and, for the
// QoQ/MoM/YoY previous-period lookups, the previous period is allowed to
// fall in a different month than the current filter selection — that's the
// whole point of the comparison).
export function computeComparisons(rows, field, selectedMonths) {
  return computeComparisonsFromSummer((months) => sumForMonths(rows, field, months), selectedMonths)
}

// MoM/QoQ/YoY for a ratio KPI (e.g. Average Transaction Value = amount ÷
// count) — same anchor-derived window logic as computeComparisons, but the
// "current"/"previous" value for each window is numerator-sum ÷
// denominator-sum rather than a single field's sum. Returns null for any
// window whose denominator sums to 0 or has no matching rows at all, same
// "hide missing/undefined comparisons" rule as everywhere else in this
// file.
export function computeRatioComparisons(rows, numeratorField, denominatorField, selectedMonths) {
  const ratioFor = (months) => {
    const numerator = sumForMonths(rows, numeratorField, months)
    const denominator = sumForMonths(rows, denominatorField, months)
    if (numerator == null || denominator == null || denominator === 0) return null
    return numerator / denominator
  }
  return computeComparisonsFromSummer(ratioFor, selectedMonths)
}

// 2026-08-24 — the single generic badge Overview.jsx's KPI ribbon shows
// when the current Month/FY selection isn't exactly one of the MTD/QTD/YTD
// presets (so labeling it "MoM"/"QoQ"/"YoY" would misdescribe an arbitrary
// custom range). Unlike computeComparisonsFromSummer above — which always
// re-derives 3 DIFFERENT anchor-based sub-windows from whichever month is
// latest — this treats the caller's entire `selectedMonths` array as ONE
// window, compared directly against the identical months one year earlier.
//
// 2026-08-29 — extracted the `summer(months)` engine out to
// `customWindowFromSummer` (same "takes a summer function instead of a
// hardcoded field sum" pattern computeComparisonsFromSummer already
// established for the anchor-based engine), so
// computeBucketComparisons/computeNettedBucketComparisons (below) can reuse
// the exact same custom-window arithmetic for their own per-bucket
// customPct — needed once Summary.jsx's MetricComparisonCard rollout gave
// every bucket row an MTD/QTD/YTD-aware badge too, not just this page-level
// KPI helper.
function customWindowFromSummer(summer, selectedMonths) {
  if (!selectedMonths || selectedMonths.length === 0) return null
  const current = summer(selectedMonths)
  const previous = summer(oneYearEarlier(selectedMonths))
  return pctChange(current, previous)
}

export function computeCustomWindowComparison(rows, field, selectedMonths) {
  return customWindowFromSummer((months) => sumForMonths(rows, field, months), selectedMonths)
}

// Ratio-KPI counterpart to computeCustomWindowComparison above (e.g.
// Overview's Gift Card ATV) — same "whole selectedMonths array as one
// window" treatment as computeRatioComparisons gives each of its 3
// anchor-derived sub-windows, just for the single custom window instead of
// three.
export function computeCustomWindowRatioComparison(rows, numeratorField, denominatorField, selectedMonths) {
  if (!selectedMonths || selectedMonths.length === 0) return null
  const priorMonths = oneYearEarlier(selectedMonths)
  const curNum = sumForMonths(rows, numeratorField, selectedMonths)
  const curDen = sumForMonths(rows, denominatorField, selectedMonths)
  const prevNum = sumForMonths(rows, numeratorField, priorMonths)
  const prevDen = sumForMonths(rows, denominatorField, priorMonths)
  if (curNum == null || curDen == null || curDen === 0 || prevNum == null || prevDen == null || prevDen === 0) return null
  return pctChange(curNum / curDen, prevNum / prevDen)
}

// 2026-08-29 — MoM/QoQ/YoY (and, via computeCustomWindowDifferenceComparison
// below, the custom-window fallback) for a DERIVED quantity that's the
// difference of two independently-summed windows — e.g. Overview.jsx/
// CardJourney.jsx's "Unredeemed Balance" (Activation total − Redemption
// total). Unlike computeComparisons/computeRatioComparisons, the two sides
// of the subtraction don't necessarily share a row pool or even a summing
// rule: Overview's redemption side is a plain sumForMonths() over
// redemptionRowsForComparison, while Card Journey's is a
// sumForMonthsCohort() over cohortRowsForComparison (that page's own
// "Of Those, Redeemed" is cohort-scoped, not the dataset-wide redemption
// pool). Takes two already-built `summer(months)` functions rather than a
// `(rows, field)` pair for exactly that reason — each caller builds its
// own summer from whichever primitive (sumForMonths/sumForMonthsCohort)
// matches its own pool shape, then hands both to this one shared engine,
// so the anchor/window arithmetic itself is never duplicated even though
// the two sides' own summing rules differ. Returns null (hides the badge)
// whenever either side has no data for a given window, same convention
// every other comparator in this file follows — never ±Infinity or a
// fabricated 0.
function differenceFor(summerA, summerB) {
  return (months) => {
    const a = summerA(months)
    const b = summerB(months)
    if (a == null || b == null) return null
    return a - b
  }
}

export function computeDifferenceComparisons(summerA, summerB, selectedMonths) {
  return computeComparisonsFromSummer(differenceFor(summerA, summerB), selectedMonths)
}

export function computeCustomWindowDifferenceComparison(summerA, summerB, selectedMonths) {
  return customWindowFromSummer(differenceFor(summerA, summerB), selectedMonths)
}

// Sums `field` over `rows` restricted to a window, requiring BOTH
// `row[activationField]` and `row[redemptionField]` to fall within the
// *same* window — cohortCube.json's own "activated AND redeemed within
// this period" rule (see FilterContext.jsx#filterCohort), generalized to
// whichever window a MoM/QoQ/YoY badge needs rather than just the literal
// Month-filter selection. A plain `sumForMonths()` can't express this — it
// only ever checks one field (`r.YearMonth`), and cohortCube.json rows have
// no such field at all, only the two independent date fields. Returns null
// (not 0) when nothing matches, same "hide missing comparisons" convention
// as `sumForMonths`. Exported (2026-08-29) so CardJourney.jsx's own
// "Unredeemed Balance" can build a cohort-aware summer closure for
// computeDifferenceComparisons()/computeCustomWindowDifferenceComparison()
// above, the same way computeCohortComparisons() already uses it
// internally.
export function sumForMonthsCohort(rows, activationField, redemptionField, amountField, months) {
  const set = new Set(months)
  let total = 0
  let any = false
  for (const r of rows) {
    if (set.has(r[activationField]) && set.has(r[redemptionField])) {
      total += r[amountField] || 0
      any = true
    }
  }
  return any ? total : null
}

// Cohort-aware counterpart to computeComparisons() — for CardJourney.jsx's
// own KPIs ("Of Those, Redeemed"/"Transaction Value"/"Uptake"), which are
// cohort-scoped (activated *and* redeemed within the same period), not the
// broader "redeemed this period regardless of activation date" question
// Overview's own deltas answer. `rows` should be
// FilterContext.jsx#cohortRowsForComparison (Month AND FY both
// unrestricted, every other filter still applied) — same reasoning as
// computeComparisons' own `rows` doc comment, just for the cohort cube's
// two-date-field shape instead of one.
export function computeCohortComparisons(rows, activationField, redemptionField, amountField, selectedMonths) {
  return computeComparisonsFromSummer((months) => sumForMonthsCohort(rows, activationField, redemptionField, amountField, months), selectedMonths)
}

// Cohort-aware counterpart to computeRatioComparisons() — for CardJourney's
// Gift Card ATV (redeemedAmount ÷ redeemedCount). Takes two separate row
// pools rather than one, since the two halves of that ratio are
// deliberately NOT drawn from the same filtered set: the amount nets
// Cancellation rows in (a real, signed RedemptionAmount), but the card
// count excludes them entirely (a cancellation isn't a redemption event to
// count) — the same "amount nets cancellations in, count excludes them"
// split this app uses everywhere else. `numeratorRows`/`denominatorRows`
// are each expected to already reflect that distinction (e.g.
// cohortRowsForComparison for the amount, the same pool with Cancellation
// rows filtered out for the count) before being passed in here.
export function computeCohortRatioComparisons(
  numeratorRows,
  denominatorRows,
  activationField,
  redemptionField,
  numeratorField,
  denominatorField,
  selectedMonths
) {
  const ratioFor = (months) => {
    const numerator = sumForMonthsCohort(numeratorRows, activationField, redemptionField, numeratorField, months)
    const denominator = sumForMonthsCohort(denominatorRows, activationField, redemptionField, denominatorField, months)
    if (numerator == null || denominator == null || denominator === 0) return null
    return numerator / denominator
  }
  return computeComparisonsFromSummer(ratioFor, selectedMonths)
}

// 2026-08-28 — cohort-aware counterparts to computeCustomWindowComparison()/
// computeCustomWindowRatioComparison() above, for CardJourney.jsx's own
// "custom window" (no MTD/QTD/YTD preset active) badge — the same parallel
// computeCohortComparisons()/computeCohortRatioComparisons() already draw
// against computeComparisons()/computeRatioComparisons(), just for the
// custom-window case those two never covered. Same "treat the whole
// selectedMonths array as ONE window" treatment, built on sumForMonthsCohort
// instead of sumForMonths since cohortCube.json rows have no single
// YearMonth field to match against.
export function computeCustomWindowCohortComparison(rows, activationField, redemptionField, amountField, selectedMonths) {
  if (!selectedMonths || selectedMonths.length === 0) return null
  const current = sumForMonthsCohort(rows, activationField, redemptionField, amountField, selectedMonths)
  const previous = sumForMonthsCohort(rows, activationField, redemptionField, amountField, oneYearEarlier(selectedMonths))
  return pctChange(current, previous)
}

export function computeCustomWindowCohortRatioComparison(
  numeratorRows,
  denominatorRows,
  activationField,
  redemptionField,
  numeratorField,
  denominatorField,
  selectedMonths
) {
  if (!selectedMonths || selectedMonths.length === 0) return null
  const priorMonths = oneYearEarlier(selectedMonths)
  const curNum = sumForMonthsCohort(numeratorRows, activationField, redemptionField, numeratorField, selectedMonths)
  const curDen = sumForMonthsCohort(denominatorRows, activationField, redemptionField, denominatorField, selectedMonths)
  const prevNum = sumForMonthsCohort(numeratorRows, activationField, redemptionField, numeratorField, priorMonths)
  const prevDen = sumForMonthsCohort(denominatorRows, activationField, redemptionField, denominatorField, priorMonths)
  if (curNum == null || curDen == null || curDen === 0 || prevNum == null || prevDen == null || prevDen === 0) return null
  return pctChange(curNum / curDen, prevNum / prevDen)
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
// 2026-08-29: gained a `qoq` field (computeComparisons already computed it
// internally, just wasn't destructured out before — this page's own table
// had no QoQ column "by design choice" until the Summary-page MTD/QTD/YTD
// rollout gave every bucket row a single preset-aware badge, which needs
// `qoq` available for when QTD is the active preset) and an optional
// `selectedMonths` param — when passed, each row also carries a `customPct`
// (the same "treat selectedMonths as one window" arithmetic
// computeCustomWindowComparison uses, via the shared customWindowFromSummer
// engine) for the generic badge kpiDeltas() falls back to when no
// MTD/QTD/YTD preset is active. `selectedMonths` is optional (not every
// caller needs a customPct) so this stays backward-compatible with any call
// site that only wants mom/qoq/yoy.
export function computeBucketComparisons(currentRows, rowsAllMonths, buckets, field, countField, comparisonMonths, selectedMonths) {
  return buckets
    .map((b) => {
      const currentBucketRows = currentRows.filter(b.predicate)
      const allMonthsBucketRows = rowsAllMonths.filter(b.predicate)
      const amount = sumBy(currentBucketRows, field)
      const count = sumBy(currentBucketRows, countField)
      const { mom, qoq, yoy } = computeComparisons(allMonthsBucketRows, field, comparisonMonths)
      const customPct =
        selectedMonths !== undefined ? customWindowFromSummer((months) => sumForMonths(allMonthsBucketRows, field, months), selectedMonths) : undefined
      return { key: b.key, amount, count, mom, qoq, yoy, customPct }
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

// 2026-08-29: same `qoq` + optional `selectedMonths`/`customPct` addition as
// computeBucketComparisons above, for the netted-bucket case (Cancel Redeem
// rows folded proportionally into the real categories) — same
// customWindowFromSummer engine, just fed this function's own
// sumForMonthsNetted() summer instead of a plain sumForMonths() one.
export function computeNettedBucketComparisons(currentRows, rowsAllMonths, buckets, isExcludedRow, amountField, countField, comparisonMonths, selectedMonths) {
  const currentNetted = netBucketsProportionally(currentRows, buckets, isExcludedRow, amountField, countField)
  return currentNetted
    .map((b) => {
      const bucket = buckets.find((bb) => bb.key === b.key)
      const summer = (months) => sumForMonthsNetted(rowsAllMonths, bucket.predicate, isExcludedRow, amountField, months)
      const { mom, qoq, yoy } = computeComparisonsFromSummer(summer, comparisonMonths)
      const customPct = selectedMonths !== undefined ? customWindowFromSummer(summer, selectedMonths) : undefined
      return { key: b.key, amount: b[amountField], count: b[countField], mom, qoq, yoy, customPct }
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
//
// This is a separate, independent concept from the anchor-based MoM/QoQ/YoY
// badges the rest of this file computes — a per-FY total vs. the previous
// FY (or the same YTD months a year back), not anchored to a single latest
// month — so the 2026-08-25 MoM/QoQ/YoY redefinition above doesn't touch
// this function at all.
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

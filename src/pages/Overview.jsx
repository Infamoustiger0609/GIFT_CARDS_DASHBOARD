import React, { useEffect, useMemo } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
  BarChart,
  Bar,
  PieChart,
  Pie,
  LabelList
} from 'recharts'
import { useFilters } from '../lib/FilterContext'
import {
  sumBy,
  groupSum,
  weekSlotBreakdown,
  netCinemaRedemption,
  netRedemptionHeads,
  netHeadRows,
  netBucketsProportionally,
  REAL_HEAD_BUCKETS,
  isCancellationRow,
  exactCardCount,
  exactCardCountByBucket,
  exactWeekSlotCardCounts
} from '../lib/aggregate'
import {
  computeComparisons,
  computeCustomWindowComparison,
  computeBreakage,
  computeBreakageYoyPct,
  usePresetWindow,
  kpiDeltas
} from '../lib/comparisons'
import { DENOM_ORDER, WEEKDAY_ORDER, REGION_ORDER, fyOf, regionLabel, orderBy } from '../lib/constants'
import { COLORS, REGION_COLORS, HEAD_COLORS, ACTIVATION_SOURCE_COLORS, CARD_TYPE_COLORS, categoricalColor, WEEKDAY_COLORS } from '../lib/theme'
import { groupByActivationSource, sourceOf } from '../lib/activationSource'
import { redemptionModeOf } from '../lib/redemptionMode'
import { ACTIVATION_REGION_BUCKETS, REDEMPTION_REGION_BUCKETS, redemptionRegionLabel } from '../lib/regionBuckets'
import { fmtLacs, fmtNumber, fmtLacsAxis, fmtRupees, fmtLacsWithPct, fmtPct, monthLabel, dayLabel } from '../lib/format'
import Card from '../components/Card'
import Kpi from '../components/Kpi'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'
import { FlowBox, FlowBranch } from '../components/FlowBox'
import { AmountLabel, regionDeltaLabel } from '../components/ChartLabels'

// Shared by both charts: sums each bucket's own predicate-filtered rows
// (current + Month-unrestricted, for the MoM delta), dropping any bucket
// that comes out to an exact zero under the active filters — same
// zero-hiding convention every other regional chart in this file uses.
function bucketRegionData(rows, rowsAllMonths, buckets, amountField, countField, comparisonMonths) {
  return buckets
    .map((b) => {
      const bucketRows = rows.filter(b.predicate)
      const bucketRowsAllMonths = rowsAllMonths.filter(b.predicate)
      const { mom } = computeComparisons(bucketRowsAllMonths, amountField, comparisonMonths)
      return {
        key: b.key,
        [amountField]: sumBy(bucketRows, amountField),
        [countField]: sumBy(bucketRows, countField),
        mom
      }
    })
    .filter((r) => r[amountField] !== 0)
}

// 2026-08-26: on-slice label for the two weekday pies (Activation,
// Redemption) — replaces the single combined pie's hover-only tooltip from
// the prior phase, since each pie is now single-series (its own hover
// payload already has an unambiguous value, so a plain
// <ChartTooltip countField="..."/> works directly, no custom tooltip
// needed anymore). "3-letter weekday abbreviation + %" stacked on two
// lines, positioned partway between center and edge (not radiating outward
// past the pie like ChartLabels.jsx#donutLabel — these pies are half of an
// already-narrow 30% column, with no outside clearance to radiate into).
// Reuses donutLabel's own <3% suppression threshold (a slice too thin to
// read legibly at this size), not its outward placement.
const WEEKDAY_PIE_RADIAN = Math.PI / 180
function weekdayPieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) {
  if (percent < 0.03) return null
  const radius = innerRadius + (outerRadius - innerRadius) * 0.62
  const x = cx + radius * Math.cos(-midAngle * WEEKDAY_PIE_RADIAN)
  const y = cy + radius * Math.sin(-midAngle * WEEKDAY_PIE_RADIAN)
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={9} fontWeight="bold">
      <tspan x={x} dy="-0.5em">{name.slice(0, 3).toUpperCase()}</tspan>
      <tspan x={x} dy="1.1em">{Math.round(percent * 100)}%</tspan>
    </text>
  )
}

// 2026-08-25: compact proportional-bar list for the Date Range panel's new
// by-region / by-source/head mini-breakdowns — same visual language as
// RedemptionFnb.jsx's "Hero Products" list (label, a CSS-width bar, the
// value), reused here rather than a full Recharts BarChart, since a real
// chart's axes/grid/margins have no room to breathe in a panel already
// this compact. `formatter` defaults to fmtRupees since a single day (or a
// short range) split across regions/sources routinely produces sub-Lac
// figures that fmtLacs would just round to "₹0 L".
function MiniBarList({ data, keyField, valueField, labelFn, colorFn, formatter = fmtRupees }) {
  // Scaled by magnitude, not the raw signed value — "Redemption by Head"'s
  // Cancellation row carries a real negative RedemptionAmount (the netting
  // convention this app uses everywhere), and a negative CSS `width` is
  // simply invalid: the browser drops it and falls back to `auto`, which
  // rendered as a near-full-width bar here (caught via screenshot, not
  // assumed) — the opposite of what a small-magnitude negative value
  // should show. `formatter` still receives the original signed value, so
  // the printed figure keeps its sign.
  const max = Math.max(...data.map((d) => Math.abs(d[valueField])), 1)
  return (
    <div className="flex flex-col gap-1.5">
      {data.map((d, i) => (
        <div key={d[keyField]} className="flex items-center gap-2">
          <span className="text-[10px] text-navy w-14 truncate flex-shrink-0" title={labelFn ? labelFn(d[keyField]) : d[keyField]}>
            {labelFn ? labelFn(d[keyField]) : d[keyField]}
          </span>
          <div className="flex-1 bg-warmgray-border/40 rounded-full h-2 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(Math.abs(d[valueField]) / max) * 100}%`, backgroundColor: colorFn(d[keyField], i) }} />
          </div>
          <span className="text-[10px] font-semibold text-navy tabular-nums w-16 text-right flex-shrink-0">{formatter(d[valueField])}</span>
        </div>
      ))}
    </div>
  )
}

// 2026-08-14 split: "Activation by Region"/"Redemption by Region" used to
// mix pure geography with non-regional channel totals (Aggregators/
// Corporate/Online on the activation side) in one 8/6-bucket chart. Split
// into 4 charts instead — two pure-geography ones (Physical/Cinema rows
// only) and two pure-channel ones, so each chart answers exactly one
// question. The region-only charts reuse the exact region predicates from
// `lib/regionBuckets.js` (sliced to just the 6 REGION_ORDER entries, before
// each array's own trailing channel-total buckets) rather than a second
// hand-written copy — same "extract instead of duplicate" discipline this
// file already used once when those buckets were pulled out to
// regionBuckets.js in the first place.
const ACTIVATION_REGION_ONLY_BUCKETS = ACTIVATION_REGION_BUCKETS.slice(0, 6)
// 2026-08-15 reverted (see the 2026-08-14 follow-up entry in CLAUDE.md for
// the prior "5 named regions" version this undoes): the 6th region bucket
// belongs on this chart, not on "Redemption by Head" — it's a Region_Clean
// value, not a Head value, and mixing it into the Head breakdown was itself
// the bug this reversion fixes (see REDEMPTION_HEAD_BUCKETS below). Back to
// all 6 buckets REDEMPTION_REGION_BUCKETS exports (5 named regions +
// "Director's Cut" — see lib/regionBuckets.js for why that 6th one is no
// longer the shared NO_SITE sentinel on this cube).
const REDEMPTION_REGION_ONLY_BUCKETS = REDEMPTION_REGION_BUCKETS.slice(0, 6)

// 2026-08-15: all 3 real activation sources (Aggregator, Corporate, Cinema),
// bucketed via the shared `sourceOf()` mapping (lib/activationSource.js) —
// not a raw-value passthrough — so 'Online' (legacy, pre-Aug-2024 activation
// through the "PVR Inox Online" outlet, ~₹114.2L, before it was shut down
// for fraud) folds into 'Corporate' here exactly like it already does on the
// flow diagram above (`activationBySource`, via `groupByActivationSource`).
// This is now the complete, self-reconciling activation-source breakdown —
// all 3 bars sum exactly to Total Activation on their own (Aggregator +
// Corporate + Cinema), independent of "Activation by Region" beside it,
// which answers a different question (Cinema's own rows split by
// geography) and deliberately overlaps this chart's Cinema bar rather than
// needing to partition against it.
const ACTIVATION_SOURCE_ONLY_BUCKETS = [
  { key: 'Aggregators', predicate: (r) => sourceOf(r.ActivationModeFinal) === 'Aggregators' },
  { key: 'Corporate', predicate: (r) => sourceOf(r.ActivationModeFinal) === 'Corporate' },
  { key: 'Cinema', predicate: (r) => sourceOf(r.ActivationModeFinal) === 'Cinema' }
]

// 2026-08-19 audit fix: this chart used to hard-exclude Cancellation
// (HEAD_ORDER.filter(head => head !== 'Cancellation')) and call that
// "gross, not net — intentional, not a bug." That's a real violation of
// this app's own standing rule (Cancellation is only ever its own visible
// category on the dedicated /cancel-redeem page; everywhere else it must
// net proportionally into Online/Box Office/F&B, never silently dropped) —
// this chart was silently dropping it instead of either showing or netting
// it. Fixed by switching to the same netBucketsProportionally() pattern
// this file's own dailyRedByHead panel and CardJourney.jsx's "Redemption by
// Head" chart already use for this exact bucket set (REAL_HEAD_BUCKETS,
// imported from lib/aggregate.js) — see the redemptionByHead computation
// below. The 3 bars now sum exactly to "Total Redemption (net)" again, by
// construction, since proportional netting redistributes 100% of the
// Cancellation amount across the 3 real heads rather than dropping it.

export default function Overview() {
  const {
    activationRows,
    redemptionRows,
    activationRowsForComparison,
    redemptionRowsForComparison,
    activationRowsAllFY,
    redemptionRowsAllFY,
    comparisonMonths,
    filters,
    dateRangeAvailable,
    dailyActivationRows,
    dailyRedemptionRows,
    dailyCubesLoaded,
    dailyLoading,
    dailyError,
    cohortRowsForComparison,
    loadCohortCube,
    cohortLoading,
    redemptionRowLevelFiltered,
    redemptionRowLevelAllFY,
    redemptionRowLevelReady,
    loadRedemptionRowLevel
  } = useFilters()

  // ---- MTD / QTD / YTD preset ribbon (2026-08-24, extracted into the
  // shared usePresetWindow() hook 2026-08-28 — see lib/comparisons.js's own
  // doc comment — so CardJourney.jsx's identical control isn't a second,
  // independently-authored copy of this state/logic) ----
  const {
    anchorMonth,
    selectedMonths,
    quarterOptions,
    activePreset,
    activeQuarter,
    qtdMenuOpen,
    setQtdMenuOpen,
    qtdMenuRef,
    applyPreset,
    applyQuarter,
    windowDateRangeLabel
  } = usePresetWindow()

  // 2026-08-30: "Breakage" (below) is this page's one and only consumer of
  // cohortCube.json — every other KPI/chart on Overview.jsx reads the main
  // activation/redemption cubes, which have no ActivationYearMonth field on
  // the redemption side and so can't answer "how much of THIS activation
  // month has been redeemed to date" at all. Same lazy-load-on-mount
  // pattern CardJourney.jsx's own loadCohortCube() already established —
  // idempotent, so visiting both pages in one session only fetches the
  // (large) cohort cube once.
  useEffect(() => {
    loadCohortCube()
  }, [loadCohortCube])
  // 2026-09-16: same lazy-load-on-mount pattern as cohortCube above — this
  // page's own "known limitation, can't be fixed client-side" premise for
  // `totalUniqueCards` (see its own doc comment below) predates this file
  // existing; it's stale now, not a permanent ceiling.
  useEffect(() => {
    loadRedemptionRowLevel()
  }, [loadRedemptionRowLevel])

  // 2026-08-21, deferred further 2026-09-17: this page is the one and only
  // CONSUMER of the Date Range filter's daily cubes (see FilterContext.jsx's
  // "Date Range" section), but the fetch itself is no longer kicked off by
  // this page's own mount — it used to run unconditionally here, meaning
  // just landing on Overview downloaded+parsed ~3.3MB of daily cubes even
  // for a visit that never opens the Date Range picker. `loadDailyCubes` is
  // now called from inside DateRangeFilter's own open-button click handler
  // (via FilterBar.jsx), page-agnostic — it fires the first time the picker
  // is opened on ANY page, not just Overview. Still idempotent (a ref-guard
  // inside `loadDailyCubes` itself), so opening the picker more than once,
  // on this page or another, only ever fetches once per app session.

  // True only when the user has actually picked a start day AND none of
  // Card Type/Denomination/Activation Source/Redemption Source is active
  // (dateRangeAvailable) — the panel below renders on this, not on
  // filters.dateRange.start alone, so a stored-but-now-inert selection
  // stays hidden rather than showing numbers that silently stopped
  // reflecting the active filters.
  const dateRangeActive = dateRangeAvailable && !!filters.dateRange.start
  const dailyActAmt = sumBy(dailyActivationRows, 'ActivationAmount')
  const dailyActCount = sumBy(dailyActivationRows, 'ActivationCount')
  const dailyRedAmt = sumBy(dailyRedemptionRows, 'RedemptionAmount')
  const dailyRedCount = sumBy(dailyRedemptionRows, 'RedemptionCount')
  const dateRangeLabel =
    filters.dateRange.end && filters.dateRange.end !== filters.dateRange.start
      ? `${dayLabel(filters.dateRange.start)} – ${dayLabel(filters.dateRange.end)}`
      : dateRangeActive
        ? dayLabel(filters.dateRange.start)
        : ''

  // 2026-08-25: by-region / by-source(activation)-and-head(redemption)
  // mini-breakdowns for the same panel — both daily cubes carry
  // Region_Clean, and ActivationModeFinal/RedemptionModeFinal+Head
  // respectively (confirmed directly against the files when the Date
  // Range filter was first built), so these need no new fields, just a
  // groupby over the same dailyActivationRows/dailyRedemptionRows pools
  // the panel's headline Kpis already sum. Ordered by the same
  // REGION_ORDER/HEAD_ORDER every other region/head chart in this app
  // uses, zero-value buckets dropped (same convention as every other
  // bucketed chart here). Activation Source uses the shared sourceOf()
  // 3-bucket model, not a raw ActivationModeFinal passthrough, for the
  // same reason every other "by Source" chart in this app does.
  //
  // 2026-08-29 fix: "Activation by Region"/"Redemption by Region" used to
  // group ALL rows (every channel) by raw Region_Clean — same class of bug
  // Overview's own main "Region Contribution" chart had before its
  // 2026-08-05 fix (see CLAUDE.md): Aggregator/Corporate/Online-channel
  // rows aren't real geography (Corporate/Online are ~100% NORTH-tagged;
  // Aggregator sometimes carries the 'NO_SITE' sentinel), so mixing them
  // in both inflated the real regions' bars and, via the shared
  // regionLabel() NO_SITE->"Online" rename, surfaced a visible "Online"
  // row that had nothing to do with the Online redemption *channel* —
  // confirmed directly against the raw daily cubes before writing this fix
  // (see CLAUDE.md's own hand-computation). Fixed the same way the main
  // charts already are: restrict to Physical-mode rows only
  // (`ActivationModeFinal === 'Physical'` / `RedemptionModeFinal ===
  // 'Physical'`, matching `lib/regionBuckets.js`'s own predicates) before
  // grouping by region. Activation's Physical rows never carry 'NO_SITE'
  // (confirmed directly, same fact already on record for the main
  // activation cube), so no further exclusion is needed there. Redemption's
  // Physical rows still do carry a real 'NO_SITE' value on this
  // not-yet-migrated daily cube (unlike the main redemptionCube.json,
  // which replaced it with the literal string "Director's Cut" in the
  // 2026-08-19 refresh) — explicitly dropped here rather than shown, since
  // the request asked for the misleading "Online" row removed, not
  // relabeled into a new bucket this compact panel never had before.
  const dailyActByRegion = useMemo(() => {
    const rows = groupSum(
      dailyActivationRows.filter((r) => r.ActivationModeFinal === 'Physical'),
      'Region_Clean',
      ['ActivationAmount']
    )
    return orderBy(rows.map((r) => r.key), REGION_ORDER)
      .map((k) => rows.find((r) => r.key === k))
      .filter((r) => r.ActivationAmount !== 0)
  }, [dailyActivationRows])
  const dailyRedByRegion = useMemo(() => {
    const rows = groupSum(
      dailyRedemptionRows.filter((r) => r.RedemptionModeFinal === 'Physical' && r.Region_Clean !== 'NO_SITE'),
      'Region_Clean',
      ['RedemptionAmount']
    )
    return orderBy(rows.map((r) => r.key), REGION_ORDER)
      .map((k) => rows.find((r) => r.key === k))
      .filter((r) => r.RedemptionAmount !== 0)
  }, [dailyRedemptionRows])
  const dailyActBySource = useMemo(
    () =>
      ['Aggregators', 'Corporate', 'Cinema']
        .map((key) => ({
          key,
          ActivationAmount: sumBy(
            dailyActivationRows.filter((r) => sourceOf(r.ActivationModeFinal) === key),
            'ActivationAmount'
          )
        }))
        .filter((r) => r.ActivationAmount !== 0),
    [dailyActivationRows]
  )
  // 2026-08-29 fix: was a plain groupSum including 'Cancellation' as its
  // own visible 4th bar — per this app's standing rule (Cancellation is
  // only ever its own visible category on the dedicated Cancel Redeem
  // page), it's now netted proportionally into Online/Box Office/F&B
  // instead, the same `netBucketsProportionally()` utility Card Journey's
  // own "Redemption by Head" chart already uses for the identical fix.
  // REAL_HEAD_BUCKETS is already in Online/Box Office/F&B order (HEAD_ORDER
  // minus Cancellation), so no separate orderBy step is needed the way the
  // old groupSum-based version required.
  const dailyRedByHead = useMemo(
    () =>
      netBucketsProportionally(dailyRedemptionRows, REAL_HEAD_BUCKETS, isCancellationRow, 'RedemptionAmount', 'RedemptionCount').filter(
        (r) => r.RedemptionAmount !== 0
      ),
    [dailyRedemptionRows]
  )

  const totalActivation = sumBy(activationRows, 'ActivationAmount')
  const totalRedemption = sumBy(redemptionRows, 'RedemptionAmount')
  const totalActivationCount = sumBy(activationRows, 'ActivationCount')
  const totalUptake = sumBy(redemptionRows, 'Uptake')
  // 2026-08-19: card-based (not transaction-based) count for the "Total
  // Redemption (net)"/"Total Transaction Value"/"Uptake" KPI sub-lines —
  // UniqueCardCount (redemption cube only, added the same data refresh as
  // Region_Clean's "Director's Cut" value) is the distinct card count per
  // row's own dimension combination, unlike RedemptionCount (transaction
  // count — one card redeeming 3 times in a month is 3 RedemptionCount but
  // 1 UniqueCardCount). All three KPIs read the same redemptionRows pool,
  // so they intentionally show the same figure here, same as they did when
  // this sub-line existed before (as a RedemptionCount-based "X
  // redemptions" line) — reintroduced with the correct measure per an
  // explicit request, not a coincidence.
  //
  // 2026-09-16: the "KNOWN LIMITATION, can't be fixed client-side" this
  // comment used to document no longer holds — `redemption_rowlevel
  // .parquet` (FilterContext.jsx) now ships the exact per-transaction data
  // (a real `CardNumber` field) this note said didn't exist. Switched to
  // an exact `COUNT(DISTINCT CardNumber)` over `redemptionRowLevelFiltered`
  // (the row-level pool filtered by every currently-active global filter,
  // the same set `redemptionRows` itself reflects), falling back to the
  // old (documented-inflation-prone) sum only while the ~26MB file is still
  // loading — see the 2026-09-16 CLAUDE.md entry for the full audit and
  // before/after figures across every location this affected.
  const totalUniqueCardsExact = redemptionRowLevelReady ? exactCardCount(redemptionRowLevelFiltered) : null
  const totalUniqueCards = totalUniqueCardsExact != null ? totalUniqueCardsExact : sumBy(redemptionRows, 'UniqueCardCount')
  // Total Redemption Amount + Total Uptake — a combined-total KPI, not a
  // sub-component of another KPI on this ribbon (same "no meaningful
  // parent" reasoning as Revenue/Activation Amount), so it gets deltas but
  // no "% of..." sub-line, per the KPI-parity convention established
  // earlier in this file.
  const totalTransactionValue = totalRedemption + totalUptake
  // 2026-08-30: "Additional Revenue" (Uptake) as a % of Total Redemption —
  // the "how much extra are we generating per rupee redeemed" framing,
  // one plain sub-line, no delta badge (this ratio is derived from two
  // KPIs already on this ribbon, same "no meaningful parent, no comparison
  // of its own" treatment Avg Ticket Size/Avg per Redemption already get
  // elsewhere in this app, rather than a 3rd MTD/QTD/YTD-aware comparison
  // stacked onto an already-two-line card).
  const uptakePct = totalRedemption > 0 ? (totalUptake / totalRedemption) * 100 : NaN

  // ---- "Breakage" KPI (2026-08-30, replaces the former "Unredeemed
  // Balance" card — itself a same-day replacement of ATV/Universal-ATV —
  // in this exact ribbon slot) ----
  // Not "Activation minus Redemption for the current selection" anymore —
  // a card activated in month M is only valid through M+12 (13 real
  // calendar months of usable life); Breakage is the CUMULATIVE unredeemed
  // remainder across every activation cohort that's already past that
  // window, i.e. every month from this dataset's own start through
  // (anchor − 13), summed — not just the currently selected month(s).
  // computeBreakage() (lib/comparisons.js) does the actual month
  // arithmetic/summation; both pools it's given are Month/FY-unrestricted
  // (activationRowsForComparison — this KPI is fundamentally about
  // activation months almost always outside whatever's currently selected
  // — and cohortRowsForComparison, the one pool on this page that reaches
  // cohortCube.json, loaded lazily above specifically for this KPI).
  const breakage = useMemo(
    () => computeBreakage(activationRowsForComparison, cohortRowsForComparison, anchorMonth),
    [activationRowsForComparison, cohortRowsForComparison, anchorMonth]
  )
  // Sub-line states the cutoff month in plain terms so the figure doesn't
  // read as scoped to the current selection's own months (it isn't) — e.g.
  // "Cards activated Jun 2025 or earlier". `breakage.hasCohorts === false`
  // means the anchor is too recent for any cohort to have expired yet
  // (verified: anchor Apr 2025 or earlier → ₹0) — a different, dedicated
  // message rather than a nonsensical pre-dataset date.
  const breakageSub = breakage.hasCohorts
    ? `Cards activated ${monthLabel(breakage.cutoffMonth)} or earlier`
    : 'No cohorts have reached 13 months yet'
  // Breakage's own delta — see computeBreakageYoyPct()'s own doc comment
  // for why this is a single fixed "YoY" badge (comparing this anchor's
  // cumulative figure against the identical A−13 calculation one year
  // earlier) rather than routed through kpiDeltas()'s MTD/QTD/YTD
  // label-switching — a point-in-time cumulative balance has no
  // meaningful "month-to-date"/"quarter-to-date" sub-window the way a
  // flow quantity (Activation Amount, Redemption Amount, ...) does, so
  // there's only ever this one comparison to show, regardless of which
  // preset button is active elsewhere on the page.
  const breakageYoyPct = useMemo(
    () => computeBreakageYoyPct(activationRowsForComparison, cohortRowsForComparison, anchorMonth),
    [activationRowsForComparison, cohortRowsForComparison, anchorMonth]
  )

  // 2026-08-25 bug fix: these all used to sum over activationRowsAllMonths/
  // redemptionRowsAllMonths — Month-unrestricted, but still FY-restricted
  // — so a specific FY selection (e.g. FY2026-27 alone) silently zeroed
  // out every delta whose prior-year window fell in a different FY. Now
  // sums over activationRowsForComparison/redemptionRowsForComparison
  // (both Month AND FY unrestricted — see FilterContext.jsx's own doc
  // comment) instead; the anchor month itself still comes from
  // comparisonMonths, which stays FY-aware on purpose.
  const activationDeltas = useMemo(
    () => computeComparisons(activationRowsForComparison, 'ActivationAmount', comparisonMonths),
    [activationRowsForComparison, comparisonMonths]
  )
  const redemptionDeltas = useMemo(
    () => computeComparisons(redemptionRowsForComparison, 'RedemptionAmount', comparisonMonths),
    [redemptionRowsForComparison, comparisonMonths]
  )
  const uptakeDeltas = useMemo(
    () => computeComparisons(redemptionRowsForComparison, 'Uptake', comparisonMonths),
    [redemptionRowsForComparison, comparisonMonths]
  )
  // TransactionValue isn't a raw field on redemption rows — synthesized per
  // row (RedemptionAmount + Uptake) on the Month/FY-unrestricted pool so
  // computeComparisons can run over it exactly like every other delta here.
  const transactionValueRowsForComparison = useMemo(
    () => redemptionRowsForComparison.map((r) => ({ ...r, TransactionValue: (r.RedemptionAmount || 0) + (r.Uptake || 0) })),
    [redemptionRowsForComparison]
  )
  const transactionValueDeltas = useMemo(
    () => computeComparisons(transactionValueRowsForComparison, 'TransactionValue', comparisonMonths),
    [transactionValueRowsForComparison, comparisonMonths]
  )
  // 2026-08-24 — "custom mode" badge for each of the 5 KPIs above: the
  // single generic comparison kpiDeltas() falls back to whenever no
  // MTD/QTD/YTD preset is active and FY/Month aren't at their true
  // unrestricted default. Reuses the exact same *RowsForComparison pools
  // (Month AND FY both unrestricted) the anchor-based deltas above already
  // read, just summed over the literal `selectedMonths` window instead of
  // an anchor-derived sub-window — computed unconditionally (cheap, same
  // cost class as the deltas above) rather than behind a conditional hook,
  // since React hooks can't be called conditionally; which one actually
  // renders is decided in the JSX via kpiDeltas().
  const activationCustomPct = useMemo(
    () => computeCustomWindowComparison(activationRowsForComparison, 'ActivationAmount', selectedMonths),
    [activationRowsForComparison, selectedMonths]
  )
  const redemptionCustomPct = useMemo(
    () => computeCustomWindowComparison(redemptionRowsForComparison, 'RedemptionAmount', selectedMonths),
    [redemptionRowsForComparison, selectedMonths]
  )
  const uptakeCustomPct = useMemo(
    () => computeCustomWindowComparison(redemptionRowsForComparison, 'Uptake', selectedMonths),
    [redemptionRowsForComparison, selectedMonths]
  )
  const transactionValueCustomPct = useMemo(
    () => computeCustomWindowComparison(transactionValueRowsForComparison, 'TransactionValue', selectedMonths),
    [transactionValueRowsForComparison, selectedMonths]
  )
  // ---- Activation flow: 3 origin sources, each split by CardType ----
  // See lib/activationSource.js for the shared bucketing logic (also used
  // by Activation.jsx / RedemptionBoxOffice.jsx / RedemptionFnb.jsx).
  const activationBySource = useMemo(
    () => groupByActivationSource(activationRows, { modeField: 'ActivationModeFinal', amountField: 'ActivationAmount', countField: 'ActivationCount' }),
    [activationRows]
  )

  // 2026-08-05 fix: Online/Box Office/F&B must be shown NET of their own
  // Cancel Redeem transactions, not gross — otherwise they don't sum to
  // "Total Redemption (net)" above them (which already nets out ALL
  // cancellations as one lump sum) and their "% of total" shares sum to
  // well over 100%. Cancel Redeem rows carry Head='Cancellation', not the
  // Head of whatever they're reversing, so attributing one back to
  // Online/Box Office/F&B needs a proxy:
  //   - RedemptionModeFinal === 'Online' (Outlet = "PVR Inox Online") maps
  //     1:1 to the Online head — exact, no ambiguity, since Online is the
  //     only head ever redeemed through that Outlet.
  //   - RedemptionModeFinal === 'Physical' (a physical cinema) could be
  //     reversing either a Box Office or an F&B redemption — the row
  //     doesn't say which — so each Region+Month's physical cancellations
  //     are attributed *in bulk* to whichever of Box Office/F&B had the
  //     larger gross redemption in that same Region+Month. This is a
  //     reasonable proxy, not exact to the rupee, but the sum of the 3 net
  //     heads still always equals the net total exactly regardless of how
  //     the Box Office/F&B split lands — every cancellation rupee is
  //     attributed to exactly one of the 3 heads either way, so nothing is
  //     double-counted or dropped (verified: FY2025-26 Jun/Jul both sum to
  //     the pre-existing net total to the rupee — see CLAUDE.md).
  // 2026-08-06: physicalCancelWinnerMap/positiveHeads used to be defined
  // locally on this page — now imported from lib/aggregate.js so
  // RedemptionBoxOffice.jsx/RedemptionFnb.jsx can compute the exact same
  // net Box Office/F&B figures instead of their own gross sums (the bug
  // that motivated centralizing this — see the 2026-08-06 CLAUDE.md entry).
  // 2026-09-16: card counts for these 3 nodes (Online/Box Office/F&B, and
  // Cinema below) switched from netRedemptionHeads()'s own summed
  // UniqueCardCount to an exact COUNT(DISTINCT CardNumber) over
  // `redemptionRowLevelFiltered` — no netting/attribution needed for a
  // count the way there is for an amount (`exactCardCount()` already
  // excludes Cancellation rows entirely, the established "count excludes
  // cancellations" convention) — see the 2026-09-16 CLAUDE.md entry. Amount
  // fields are completely untouched, still netRedemptionHeads()'s own
  // figures.
  const redemptionHeadExactCounts = useMemo(() => {
    if (!redemptionRowLevelReady) return null
    return {
      Online: exactCardCount(redemptionRowLevelFiltered.filter((r) => r.Head === 'Online')),
      'Box Office': exactCardCount(redemptionRowLevelFiltered.filter((r) => r.Head === 'Box Office')),
      'F&B': exactCardCount(redemptionRowLevelFiltered.filter((r) => r.Head === 'F&B')),
      Cinema: exactCardCount(redemptionRowLevelFiltered.filter((r) => r.Head === 'Box Office' || r.Head === 'F&B'))
    }
  }, [redemptionRowLevelFiltered, redemptionRowLevelReady])
  const positiveHeads = useMemo(() => {
    const base = netRedemptionHeads(redemptionRows)
    if (!redemptionHeadExactCounts) return base
    return base.map((h) => ({ ...h, UniqueCardCount: redemptionHeadExactCounts[h.key] ?? h.UniqueCardCount }))
  }, [redemptionRows, redemptionHeadExactCounts])

  // ---- Uptake bifurcation for the Uptake KPI card: Ticket (Head='Box
  // Office' + Head='Online') vs F&B (Head='F&B'), net of their own Cancel
  // Redeem transactions — composed from the same shared netHeadRows() pools
  // as positiveHeads above, just summed on Uptake instead of
  // RedemptionAmount and re-bucketed into 2 groups instead of 3. Uptake is
  // 0 on every Head='Online'/'Cancellation' row in the current data
  // (checked directly), so this nets to exactly Box Office + F&B Uptake
  // today — but the netting is still real, not hardcoded, so a future data
  // refresh that populates Uptake on those heads is handled correctly
  // without a code change.
  //
  // 2026-08-12 cross-page audit: no longer threads an explicit winner map
  // through — netHeadRows() already self-derives one from whatever rows
  // it's given when none is passed. Passing an externally-computed map here
  // was never wrong (the winner decision for any Region+Month key is
  // invariant to what else is in the array it's computed from — proven and
  // spot-checked live across 3 filter combinations, see the 2026-08-12
  // CLAUDE.md entry), just an unnecessary second `physicalCancelWinnerMap`
  // call site duplicating what RedemptionBoxOffice.jsx/RedemptionFnb.jsx
  // each also computed independently. Removed from all three rather than
  // left as harmless-but-duplicated. ----
  const uptakeTicketFnb = useMemo(() => {
    const netBoxOffice = netHeadRows(redemptionRows, 'Box Office')
    const netOnline = netHeadRows(redemptionRows, 'Online')
    const netFnb = netHeadRows(redemptionRows, 'F&B')
    return {
      ticket: sumBy(netBoxOffice, 'Uptake') + sumBy(netOnline, 'Uptake'),
      fnb: sumBy(netFnb, 'Uptake')
    }
  }, [redemptionRows])

  // ---- Total Transaction Value bifurcation (2026-08-22), same shape as
  // uptakeTicketFnb above — Ticket = net Box Office + net Online (redemption
  // + Uptake), F&B = net F&B (redemption + Uptake). Reuses netHeadRows()
  // rather than a second parallel computation, so this can't drift from
  // uptakeTicketFnb's own Box Office/Online/F&B netting. The two halves sum
  // to totalTransactionValue exactly by construction: netHeadRows(...,
  // 'Box Office') + netHeadRows(..., 'Online') + netHeadRows(..., 'F&B')
  // already partitions all of redemptionRows' RedemptionAmount (verified
  // dashboard-wide since the 2026-08-06 net-heads rewire), and Uptake sums
  // the same way — so (ticket redemption + ticket uptake) + (F&B redemption
  // + F&B uptake) = totalRedemption + totalUptake, no separate proof needed.
  const totalTransactionValueTicketFnb = useMemo(() => {
    const netBoxOffice = netHeadRows(redemptionRows, 'Box Office')
    const netOnline = netHeadRows(redemptionRows, 'Online')
    const netFnb = netHeadRows(redemptionRows, 'F&B')
    const ticketRedemption = sumBy(netBoxOffice, 'RedemptionAmount') + sumBy(netOnline, 'RedemptionAmount')
    const ticketUptake = sumBy(netBoxOffice, 'Uptake') + sumBy(netOnline, 'Uptake')
    const fnbRedemption = sumBy(netFnb, 'RedemptionAmount')
    const fnbUptake = sumBy(netFnb, 'Uptake')
    return {
      ticket: ticketRedemption + ticketUptake,
      fnb: fnbRedemption + fnbUptake
    }
  }, [redemptionRows])

  // ---- Cinema flow node (Box Office + F&B combined) for the redemption
  // flow diagram's new intermediate layer — Total Redemption -> (Online,
  // Cinema) -> Cinema -> (Box Office, F&B). Computed via the shared
  // lib/aggregate.js#netCinemaRedemption() utility, NOT independently
  // re-derived, so it's provably equal to positiveHeads' own Box Office +
  // F&B (both net the same Physical-mode cancellations in, just via two
  // different but mathematically equivalent routes — see the 2026-08-06
  // CLAUDE.md entry). Online/Box Office/F&B's own individual values below
  // are untouched, still positiveHeads' proportional-netting figures. ----
  const cinemaTotal = useMemo(() => {
    const base = netCinemaRedemption(redemptionRows)
    return { ...base, UniqueCardCount: redemptionHeadExactCounts?.Cinema ?? base.UniqueCardCount }
  }, [redemptionRows, redemptionHeadExactCounts])
  // positiveHeads is always exactly [Online, Box Office, F&B], in that
  // fixed order (see its own definition above) — destructured once here
  // rather than re-filtering the array at each flow-diagram node.
  const [onlineHead, boxOfficeHead, fnbHead] = positiveHeads

  // ---- Activation by Region (5 physical-cinema regions, pure geography)
  // and Redemption by Region (5 regions + Director's Cut, pure geography) — see
  // the module-level bucket definitions above for why these are bucketed
  // this way instead of a raw Region_Clean groupby. Each bar's MoM delta is
  // computed the same way the KPI deltas are (computeComparisons against
  // the Month-unrestricted pool), just further filtered down to each
  // bucket's own predicate first. ----
  const activationByRegion = useMemo(
    () => bucketRegionData(activationRows, activationRowsForComparison, ACTIVATION_REGION_ONLY_BUCKETS, 'ActivationAmount', 'ActivationCount', comparisonMonths),
    [activationRows, activationRowsForComparison, comparisonMonths]
  )
  const redemptionByRegion = useMemo(() => {
    const base = bucketRegionData(redemptionRows, redemptionRowsForComparison, REDEMPTION_REGION_ONLY_BUCKETS, 'RedemptionAmount', 'UniqueCardCount', comparisonMonths)
    if (!redemptionRowLevelReady) return base
    const exact = exactCardCountByBucket(redemptionRowLevelFiltered, REDEMPTION_REGION_ONLY_BUCKETS)
    return base.map((b) => ({ ...b, UniqueCardCount: exact.find((e) => e.key === b.key)?.count ?? b.UniqueCardCount }))
  }, [redemptionRows, redemptionRowsForComparison, comparisonMonths, redemptionRowLevelFiltered, redemptionRowLevelReady])

  // ---- Activation by Source (Aggregators/Corporate [Corporate+Online
  // merged]/Cinema — all 3 real sources, self-reconciling to Total
  // Activation) and Redemption by Head (Online/Box Office/F&B, Cancellation
  // netted proportionally into all 3 via netBucketsProportionally rather
  // than shown raw or dropped — see the 2026-08-19 audit-fix comment above
  // — so this DOES now reconcile to "Total Redemption (net)") —
  // "Activation by Region"/"Redemption by Region" beside them answer a
  // different (geography-only) question and aren't meant to partition
  // against these. No MoM label on this chart's bars — netBucketsProportionally
  // only has a single-snapshot signature (no month-over-month variant exists
  // anywhere in this codebase yet), same limitation CardJourney.jsx's own
  // netted "Redemption by Head" chart already accepts, plain AmountLabel
  // there too. ----
  const activationBySourceRaw = useMemo(
    () => bucketRegionData(activationRows, activationRowsForComparison, ACTIVATION_SOURCE_ONLY_BUCKETS, 'ActivationAmount', 'ActivationCount', comparisonMonths),
    [activationRows, activationRowsForComparison, comparisonMonths]
  )
  const redemptionByHead = useMemo(() => {
    const base = netBucketsProportionally(redemptionRows, REAL_HEAD_BUCKETS, isCancellationRow, 'RedemptionAmount', 'UniqueCardCount')
    if (!redemptionRowLevelReady) return base
    const exact = exactCardCountByBucket(redemptionRowLevelFiltered, REAL_HEAD_BUCKETS)
    return base.map((b) => ({ ...b, UniqueCardCount: exact.find((e) => e.key === b.key)?.count ?? b.UniqueCardCount }))
  }, [redemptionRows, redemptionRowLevelFiltered, redemptionRowLevelReady])

  // ---- Year-on-Year: Activation vs. Redemption per FY, all filters except
  // FY still applied (same skipFY pattern as skipMonth's "all months" pools
  // — see FilterContext.jsx). FY isn't a raw field on either cube, so this
  // groups by fyOf(YearMonth) with a plain reduce rather than groupSum,
  // which only groups by a literal row field. ----
  const yoyByFY = useMemo(() => {
    const fys = [...new Set([...activationRowsAllFY.map((r) => fyOf(r.YearMonth)), ...redemptionRowsAllFY.map((r) => fyOf(r.YearMonth))])].sort()
    const exactByFY = redemptionRowLevelReady
      ? exactCardCountByBucket(
          redemptionRowLevelAllFY,
          fys.map((fy) => ({ key: fy, predicate: (r) => fyOf(r.YearMonth) === fy }))
        )
      : null
    return fys.map((fy) => {
      const actRows = activationRowsAllFY.filter((r) => fyOf(r.YearMonth) === fy)
      const redRows = redemptionRowsAllFY.filter((r) => fyOf(r.YearMonth) === fy)
      return {
        fy,
        Activation: sumBy(actRows, 'ActivationAmount'),
        ActivationCount: sumBy(actRows, 'ActivationCount'),
        Redemption: sumBy(redRows, 'RedemptionAmount'),
        RedemptionCardCount: exactByFY ? exactByFY.find((e) => e.key === fy)?.count || 0 : sumBy(redRows, 'UniqueCardCount')
      }
    })
  }, [activationRowsAllFY, redemptionRowsAllFY, redemptionRowLevelAllFY, redemptionRowLevelReady])

  // ---- Redemption Trend (Weekday vs. Weekend) — reuses the same
  // weekSlotBreakdown() Trends.jsx's "Week-slot Overview" is built on (both
  // Activation and Redemption come back; this chart only renders the
  // Redemption side) so the two pages can never drift on what counts as a
  // weekend. ----
  const weekSlot = useMemo(() => {
    const base = weekSlotBreakdown(activationRows, redemptionRows)
    if (!redemptionRowLevelReady) return base
    const exact = exactWeekSlotCardCounts(redemptionRowLevelFiltered)
    return base.map((s) => ({ ...s, RedemptionCardCount: exact[s.slot] ?? s.RedemptionCardCount }))
  }, [activationRows, redemptionRows, redemptionRowLevelFiltered, redemptionRowLevelReady])

  // ---- Activation vs. Redemption amount by Denomination tier. Iterates
  // DENOM_ORDER directly (fixed buckets, 11 magnitude tiers + the honest
  // 'Unknown (pre-existing)' 12th bucket as of the 2026-08-19 refresh)
  // rather than deriving-then-ordering the set of values actually present,
  // so a value outside this list can't slip back in via orderBy()'s
  // "unknown, append alphabetically" fallback. The `DENOM_ORDER.includes`
  // filters below were originally written to exclude 'N/A'/'Other'
  // cancellation-side entries — as of the 2026-08-19 refresh the
  // redemption cube has neither value anymore (everything is a real
  // magnitude bucket or 'Unknown (pre-existing)', both now in DENOM_ORDER),
  // so these filters are currently a no-op but stay in place as the same
  // live safety net every other Denomination chart in this app keeps. ----
  const denominationSplit = useMemo(() => {
    const act = groupSum(
      activationRows.filter((r) => DENOM_ORDER.includes(r.Denom)),
      'Denom',
      ['ActivationAmount', 'ActivationCount']
    )
    const red = groupSum(
      redemptionRows.filter((r) => DENOM_ORDER.includes(r.Denom)),
      'Denom',
      ['RedemptionAmount', 'UniqueCardCount']
    )
    const exactByDenom = redemptionRowLevelReady
      ? exactCardCountByBucket(
          redemptionRowLevelFiltered.filter((r) => DENOM_ORDER.includes(r.Denom)),
          DENOM_ORDER.map((d) => ({ key: d, predicate: (r) => r.Denom === d }))
        )
      : null
    return DENOM_ORDER.map((d) => ({
      denom: d,
      Activation: act.find((r) => r.key === d)?.ActivationAmount || 0,
      ActivationCount: act.find((r) => r.key === d)?.ActivationCount || 0,
      Redemption: red.find((r) => r.key === d)?.RedemptionAmount || 0,
      RedemptionCardCount: exactByDenom ? exactByDenom.find((e) => e.key === d)?.count || 0 : red.find((r) => r.key === d)?.UniqueCardCount || 0
    }))
  }, [activationRows, redemptionRows, redemptionRowLevelFiltered, redemptionRowLevelReady])

  // ---- Pan-India month-wise trend ----
  const monthTrend = useMemo(() => {
    const act = groupSum(activationRows, 'YearMonth', ['ActivationAmount', 'ActivationCount'])
    const red = groupSum(redemptionRows, 'YearMonth', ['RedemptionAmount', 'UniqueCardCount'])
    const months = [...new Set([...act.map((r) => r.key), ...red.map((r) => r.key)])].sort()
    const exactByMonth = redemptionRowLevelReady
      ? exactCardCountByBucket(
          redemptionRowLevelFiltered,
          months.map((m) => ({ key: m, predicate: (r) => r.YearMonth === m }))
        )
      : null
    return months.map((m) => ({
      month: m,
      label: monthLabel(m),
      Activation: act.find((r) => r.key === m)?.ActivationAmount || 0,
      ActivationCount: act.find((r) => r.key === m)?.ActivationCount || 0,
      Redemption: red.find((r) => r.key === m)?.RedemptionAmount || 0,
      RedemptionCardCount: exactByMonth ? exactByMonth.find((e) => e.key === m)?.count || 0 : red.find((r) => r.key === m)?.UniqueCardCount || 0
    }))
  }, [activationRows, redemptionRows, redemptionRowLevelFiltered, redemptionRowLevelReady])

  // ---- Activation vs. Redemption by Weekday (2026-08-17) — replaces the
  // removed "Daily Activation & Redemption Trend" (day-of-month) chart.
  // Same concept as Activation.jsx's "Week-slot Activation Trend" and both
  // Redemption pages' "Week-slot Redemption Trend", combined into one
  // 2-series chart here rather than the per-page single-series versions.
  // Redemption is `redemptionRows` grouped by Weekday directly (Online +
  // Box Office + F&B + Cancellation, i.e. the exact same rows
  // `totalRedemption` above sums) — not netHeadRows()'s per-head netting,
  // which exists to solve a Head-attribution ambiguity that doesn't apply
  // here: this chart never asks "how much of this belongs to Box Office vs.
  // F&B," only "how much redeemed (net, cancellations included) on this
  // weekday," which a plain groupBy already answers exactly, cancellations
  // netting in via their own real (negative) RedemptionAmount and real
  // Weekday value like any other row. Both series are therefore guaranteed
  // to sum to this page's own Total Activation / Total Redemption (net)
  // KPIs by construction, not by a separately-verified coincidence. ----
  const weekdayTrend = useMemo(() => {
    const act = groupSum(activationRows, 'Weekday', ['ActivationAmount', 'ActivationCount'])
    const red = groupSum(redemptionRows, 'Weekday', ['RedemptionAmount', 'UniqueCardCount'])
    const exactByWeekday = redemptionRowLevelReady
      ? exactCardCountByBucket(
          redemptionRowLevelFiltered,
          WEEKDAY_ORDER.map((w) => ({ key: w, predicate: (r) => r.Weekday === w }))
        )
      : null
    return orderBy([...new Set([...act.map((r) => r.key), ...red.map((r) => r.key)])], WEEKDAY_ORDER).map((w) => ({
      key: w,
      Activation: act.find((r) => r.key === w)?.ActivationAmount || 0,
      ActivationCount: act.find((r) => r.key === w)?.ActivationCount || 0,
      Redemption: red.find((r) => r.key === w)?.RedemptionAmount || 0,
      RedemptionCardCount: exactByWeekday ? exactByWeekday.find((e) => e.key === w)?.count || 0 : red.find((r) => r.key === w)?.UniqueCardCount || 0
    }))
  }, [activationRows, redemptionRows, redemptionRowLevelFiltered, redemptionRowLevelReady])

  // 2026-08-26: the same card's two weekday pies (Activation, Redemption)
  // read `weekdayTrend` directly, no reshape needed — see the JSX below for
  // why each pie's slices sum to this page's own Total Activation / Total
  // Redemption (net) by construction.

  const hasData = activationRows.length > 0 || redemptionRows.length > 0

  return (
    <div className="flex flex-col gap-6">
      {/* 2026-08-22: sm:grid-cols-3 lg:grid-cols-5 follows Activation.jsx's
          own 5-card ribbon exactly. Its base breakpoint is grid-cols-1, not
          grid-cols-2 like Activation.jsx's — 3 of these 5 cards carry a
          `breakdown` (Uptake, Total Transaction Value, ATV), whose
          absolutely-positioned top-right block collides with the main
          value's text at the ~180px-wide half-columns grid-cols-2 produces
          on a 390px phone (confirmed via screenshot: Uptake's "₹3,387"
          ran under its own "F&B" breakdown figure). Activation.jsx's own
          5 cards never hit this because none of them use `breakdown`.
          grid-cols-1 keeps every card full-width on the narrowest phones,
          exactly as this ribbon already behaved before this change. */}
      {/* 2026-08-24/25 — preset control row directly above the KPI grid:
          the shared date-range line on the left (mirrors where the
          MTD/QTD/YTD controls sit on the right), the MTD button, the
          Q1-Q4 QTD dropdown, and the YTD button on the right. Each control
          sets Month/FY to reproduce an exact calendar window — MTD/YTD via
          presetWindows() (same anchor the MoM/QoQ/YoY engine uses), QTD via
          fyQuarterMonths() (see applyQuarter() above for why a specific
          quarter needs its own window, not presetWindows().qtd's
          "quarter-to-date-through-today" one). Active-state styling
          (filled gold, matching the nav's own active-tab treatment in
          Layout.jsx) reflects `activePreset`/`activeQuarter` directly, so
          it's never out of sync with which single badge type the ribbon
          below is currently showing. */}
      <div className="flex justify-between items-center gap-2 -mb-2 flex-wrap">
        <p className="text-xs italic text-warmgray-muted">{windowDateRangeLabel}</p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => applyPreset('mtd')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
              activePreset === 'mtd' ? 'bg-gold text-navy' : 'bg-card border border-warmgray-border text-warmgray-muted hover:border-gold hover:text-navy'
            }`}
          >
            MTD
          </button>
          <div className="relative" ref={qtdMenuRef}>
            <button
              type="button"
              onClick={() => setQtdMenuOpen((o) => !o)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                activePreset === 'qtd' ? 'bg-gold text-navy' : 'bg-card border border-warmgray-border text-warmgray-muted hover:border-gold hover:text-navy'
              }`}
            >
              {activePreset === 'qtd' && activeQuarter ? `Q${activeQuarter}` : 'QTD'} ▾
            </button>
            {qtdMenuOpen && (
              <div className="absolute z-50 top-full right-0 mt-1 bg-card border border-warmgray-border rounded-md shadow-lg py-1 w-28">
                {quarterOptions.map((q) => (
                  <button
                    key={q.key}
                    type="button"
                    disabled={q.disabled}
                    onClick={() => applyQuarter(q)}
                    title={q.disabled ? 'No data yet for this quarter' : q.months.join(', ')}
                    className={`w-full text-left px-3 py-1.5 text-xs font-medium ${
                      q.disabled
                        ? 'text-warmgray-muted/50 cursor-not-allowed'
                        : activePreset === 'qtd' && activeQuarter === q.key
                          ? 'bg-gold-light text-navy font-semibold'
                          : 'text-navy hover:bg-cream cursor-pointer'
                    }`}
                  >
                    {q.label}
                    {!q.disabled && q.months.length < 3 && <span className="text-[10px] text-warmgray-muted ml-1">(to date)</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => applyPreset('ytd')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
              activePreset === 'ytd' ? 'bg-gold text-navy' : 'bg-card border border-warmgray-border text-warmgray-muted hover:border-gold hover:text-navy'
            }`}
          >
            YTD
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Kpi
          label="Activation Amount"
          value={fmtLacs(totalActivation)}
          subCount={`${fmtNumber(totalActivationCount)} cards`}
          accent="gold"
          deltas={kpiDeltas(activePreset, activationDeltas, activationCustomPct)}
        />
        <Kpi
          label="Redemption Amount"
          value={fmtLacs(totalRedemption)}
          subCount={`${fmtNumber(totalUniqueCards)} cards`}
          accent="teal"
          deltas={kpiDeltas(activePreset, redemptionDeltas, redemptionCustomPct)}
        />
        <Kpi
          label="Transaction Value"
          value={fmtLacs(totalTransactionValue)}
          subCount={`${fmtNumber(totalUniqueCards)} cards`}
          accent="blue"
          deltas={kpiDeltas(activePreset, transactionValueDeltas, transactionValueCustomPct)}
          breakdown={[
            { label: 'Ticket', value: fmtLacsWithPct(totalTransactionValueTicketFnb.ticket, totalTransactionValue) },
            { label: 'F&B', value: fmtLacsWithPct(totalTransactionValueTicketFnb.fnb, totalTransactionValue) }
          ]}
        />
        <Kpi
          label="Additional Revenue"
          value={fmtLacs(totalUptake)}
          sub={`Additional Revenue is ${fmtPct(uptakePct, 1)} of Redemption`}
          subCount={`${fmtNumber(totalUniqueCards)} cards`}
          accent="navy"
          deltas={kpiDeltas(activePreset, uptakeDeltas, uptakeCustomPct)}
          breakdown={[
            { label: 'Ticket', value: fmtLacsWithPct(uptakeTicketFnb.ticket, totalUptake) },
            { label: 'F&B', value: fmtLacsWithPct(uptakeTicketFnb.fnb, totalUptake) }
          ]}
        />
        <Kpi
          label="Breakage"
          value={cohortLoading ? '—' : fmtLacs(breakage.amount)}
          sub={breakageSub}
          accent="navy"
          deltas={[{ label: 'YoY', pct: breakageYoyPct }]}
        />
      </div>

      {/* 2026-08-21: Date Range filter's one and only consumer — see
          FilterContext.jsx's own "Date Range" section. Reads the lighter
          daily cubes, completely independent of the 4-card ribbon above and
          every chart below it, both of which stay on the monthly cubes
          regardless of this filter. Renders only when a range is both
          picked and not gated off by Card Type/Denomination/Activation
          Source/Redemption Source. */}
      {dateRangeActive && (
        <Card
          title={`Selected Date Range: ${dateRangeLabel}`}
          subtitle="From the daily-level cubes — independent of every other KPI/chart on this page."
        >
          {dailyError ? (
            <EmptyState message="Couldn't load daily data." />
          ) : !dailyCubesLoaded ? (
            <EmptyState message={dailyLoading ? 'Loading daily data…' : 'Daily data not loaded yet.'} />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Kpi label="Activation (selected range)" value={fmtLacs(dailyActAmt)} subCount={`${fmtNumber(dailyActCount)} cards`} accent="gold" />
                <Kpi label="Redemption (selected range)" value={fmtLacs(dailyRedAmt)} subCount={`${fmtNumber(dailyRedCount)} redemptions`} accent="teal" />
              </div>
              {/* 2026-08-25: compact by-region and by-source/head
                  mini-breakdowns — still this panel's own daily cubes only,
                  same scope limit as the two Kpis above. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-warmgray-muted mb-1.5">Activation by Region</div>
                  {dailyActByRegion.length === 0 ? (
                    <div className="text-[11px] text-warmgray-muted italic">No data</div>
                  ) : (
                    <MiniBarList
                      data={dailyActByRegion}
                      keyField="key"
                      valueField="ActivationAmount"
                      labelFn={regionLabel}
                      colorFn={(k) => REGION_COLORS[k] || COLORS.inkMuted}
                    />
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-warmgray-muted mb-1.5">Redemption by Region</div>
                  {dailyRedByRegion.length === 0 ? (
                    <div className="text-[11px] text-warmgray-muted italic">No data</div>
                  ) : (
                    <MiniBarList
                      data={dailyRedByRegion}
                      keyField="key"
                      valueField="RedemptionAmount"
                      labelFn={regionLabel}
                      colorFn={(k) => REGION_COLORS[k] || COLORS.inkMuted}
                    />
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-warmgray-muted mb-1.5">Activation by Source</div>
                  {dailyActBySource.length === 0 ? (
                    <div className="text-[11px] text-warmgray-muted italic">No data</div>
                  ) : (
                    <MiniBarList
                      data={dailyActBySource}
                      keyField="key"
                      valueField="ActivationAmount"
                      colorFn={(k) => ACTIVATION_SOURCE_COLORS[k] || COLORS.inkMuted}
                    />
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-warmgray-muted mb-1.5">Redemption by Head</div>
                  {dailyRedByHead.length === 0 ? (
                    <div className="text-[11px] text-warmgray-muted italic">No data</div>
                  ) : (
                    <MiniBarList
                      data={dailyRedByHead}
                      keyField="key"
                      valueField="RedemptionAmount"
                      colorFn={(k) => HEAD_COLORS[k] || COLORS.inkMuted}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card title="Gift Card Activation vs. Redemption">
        {!hasData ? (
          <EmptyState />
        ) : (
          <div className="grid md:grid-cols-2 gap-8 md:gap-4 overflow-x-auto pb-2">
            {/* Activation flow */}
            <div className="flex flex-col items-center min-w-[460px]">
              <div className="text-xs font-semibold uppercase tracking-wide text-gold mb-2">Activation</div>
              <FlowBox label="Total Activation" amount={totalActivation} count={totalActivationCount} color={COLORS.activation} size="lg" />
              <FlowBranch>
                {activationBySource.map((src) => (
                  <FlowBox
                    key={src.key}
                    label={src.key}
                    amount={src.amount}
                    count={src.count}
                    pct={totalActivation ? (src.amount / totalActivation) * 100 : 0}
                    color={ACTIVATION_SOURCE_COLORS[src.key]}
                  />
                ))}
              </FlowBranch>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full mt-6">
                {activationBySource.map((src) => (
                  <div key={src.key} className="flex flex-col items-center gap-2">
                    <div className="text-[10px] font-semibold uppercase text-warmgray-muted">{src.key}</div>
                    <FlowBox
                      label="Digital"
                      amount={src.digital.amount}
                      count={src.digital.count}
                      pct={src.amount ? (src.digital.amount / src.amount) * 100 : 0}
                      color={CARD_TYPE_COLORS.Digital}
                    />
                    <FlowBox
                      label="Physical"
                      amount={src.physical.amount}
                      count={src.physical.count}
                      pct={src.amount ? (src.physical.amount / src.amount) * 100 : 0}
                      color={CARD_TYPE_COLORS.Physical}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Redemption flow — 3 layers: Total Redemption -> (Online,
                Cinema) -> Cinema -> (Box Office, F&B). Online/Box
                Office/F&B values are untouched (still positiveHeads'
                proportional-netting figures); only Cinema is new, computed
                via the shared netCinemaRedemption() utility so it's
                provably Box Office + F&B, not a separately re-derived
                number — see the 2026-08-06 CLAUDE.md entry. */}
            <div className="flex flex-col items-center min-w-[380px]">
              <div className="text-xs font-semibold uppercase tracking-wide text-teal mb-2">Redemption</div>
              <FlowBox
                label="Total Redemption (net)"
                amount={totalRedemption}
                count={totalUniqueCards}
                color={COLORS.redemption}
                size="lg"
              />
              <FlowBranch>
                <FlowBox
                  key={onlineHead.key}
                  label={onlineHead.key}
                  amount={onlineHead.RedemptionAmount}
                  count={onlineHead.UniqueCardCount}
                  pct={totalRedemption ? (onlineHead.RedemptionAmount / totalRedemption) * 100 : 0}
                  color={HEAD_COLORS[onlineHead.key] || COLORS.inkMuted}
                />
                <div className="flex flex-col items-center">
                  <FlowBox
                    label="Cinema"
                    amount={cinemaTotal.RedemptionAmount}
                    count={cinemaTotal.UniqueCardCount}
                    pct={totalRedemption ? (cinemaTotal.RedemptionAmount / totalRedemption) * 100 : 0}
                    color={HEAD_COLORS.Cinema}
                  />
                  <FlowBranch>
                    {[boxOfficeHead, fnbHead].map((h) => (
                      <FlowBox
                        key={h.key}
                        label={h.key}
                        amount={h.RedemptionAmount}
                        count={h.UniqueCardCount}
                        pct={totalRedemption ? (h.RedemptionAmount / totalRedemption) * 100 : 0}
                        color={HEAD_COLORS[h.key] || COLORS.inkMuted}
                      />
                    ))}
                  </FlowBranch>
                </div>
              </FlowBranch>
            </div>
            {/* 2026-09-16: Box Office/F&B here won't always match every
                other chart on this dashboard that also splits Cinema into
                the two — not a bug, see the note below. Added after
                Summary's own nested Cinema breakdown
                (netBucketsProportionally, a different heuristic) was found
                to disagree with this diagram by ~₹48L per side; flagged
                and confirmed with the user rather than silently picking
                one, per this file's own standing practice. */}
            <p className="text-xs text-warmgray-muted italic col-span-full">
              Box Office/F&B split above uses the Region+Month winner-map
              heuristic (physicalCancelWinnerMap/netHeadRows — a
              cancellation's Region+Month goes entirely to whichever of the
              two had the larger gross that Region+Month). Summary's own
              "Redemption by Source" nested breakdown uses a different,
              also-legitimate heuristic (proportional-by-gross-share) for
              the same ambiguous split — the two won't match to the rupee.
              Both sum to the same Cinema total.
            </p>
          </div>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Activation by Region">
          {activationByRegion.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={activationByRegion} margin={{ top: 36, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis
                  dataKey="key"
                  tickFormatter={regionLabel}
                  tick={{ fontSize: 9, fill: COLORS.inkMuted }}
                  axisLine={{ stroke: COLORS.border }}
                  tickLine={false}
                  interval={0}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tickFormatter={fmtLacsAxis}
                  label={{ value: '₹ in Lakhs', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
                />
                <Tooltip
                  content={<ChartTooltip countField="ActivationCount" countUnit="cards" />}
                  labelFormatter={regionLabel}
                  cursor={{ fill: 'rgba(27,36,48,0.04)' }}
                />
                <Bar dataKey="ActivationAmount" name="Activation" radius={[4, 4, 0, 0]} maxBarSize={48}>
                  <LabelList dataKey="ActivationAmount" content={regionDeltaLabel(activationByRegion)} />
                  {activationByRegion.map((r, i) => (
                    <Cell key={r.key} fill={REGION_COLORS[r.key] || categoricalColor(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Redemption by Region">
          {redemptionByRegion.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={redemptionByRegion} margin={{ top: 36, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis
                  dataKey="key"
                  tickFormatter={redemptionRegionLabel}
                  tick={{ fontSize: 9, fill: COLORS.inkMuted }}
                  axisLine={{ stroke: COLORS.border }}
                  tickLine={false}
                  interval={0}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tickFormatter={fmtLacsAxis}
                  label={{ value: '₹ in Lakhs', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
                />
                <Tooltip
                  content={<ChartTooltip countField="UniqueCardCount" countUnit="cards" />}
                  labelFormatter={redemptionRegionLabel}
                  cursor={{ fill: 'rgba(27,36,48,0.04)' }}
                />
                <Bar dataKey="RedemptionAmount" name="Redemption" radius={[4, 4, 0, 0]} maxBarSize={48}>
                  <LabelList dataKey="RedemptionAmount" content={regionDeltaLabel(redemptionByRegion)} />
                  {redemptionByRegion.map((r, i) => (
                    <Cell key={r.key} fill={REGION_COLORS[r.key] || categoricalColor(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Activation by Source">
          {activationBySourceRaw.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={activationBySourceRaw} margin={{ top: 36, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis
                  dataKey="key"
                  tick={{ fontSize: 10, fill: COLORS.inkMuted }}
                  axisLine={{ stroke: COLORS.border }}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tickFormatter={fmtLacsAxis}
                  label={{ value: '₹ in Lakhs', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
                />
                <Tooltip
                  content={<ChartTooltip countField="ActivationCount" countUnit="cards" />}
                  cursor={{ fill: 'rgba(27,36,48,0.04)' }}
                />
                <Bar dataKey="ActivationAmount" name="Activation" radius={[4, 4, 0, 0]} maxBarSize={64}>
                  <LabelList dataKey="ActivationAmount" content={regionDeltaLabel(activationBySourceRaw)} />
                  {activationBySourceRaw.map((r) => (
                    <Cell key={r.key} fill={ACTIVATION_SOURCE_COLORS[r.key]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Redemption by Head">
          {redemptionByHead.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={redemptionByHead} margin={{ top: 36, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis
                  dataKey="key"
                  tick={{ fontSize: 10, fill: COLORS.inkMuted }}
                  axisLine={{ stroke: COLORS.border }}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tickFormatter={fmtLacsAxis}
                  label={{ value: '₹ in Lakhs', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
                />
                <Tooltip
                  content={<ChartTooltip countField="UniqueCardCount" countUnit="cards" />}
                  cursor={{ fill: 'rgba(27,36,48,0.04)' }}
                />
                <Bar dataKey="RedemptionAmount" name="Redemption" radius={[4, 4, 0, 0]} maxBarSize={64}>
                  <LabelList dataKey="RedemptionAmount" content={AmountLabel} />
                  {redemptionByHead.map((r) => (
                    <Cell key={r.key} fill={HEAD_COLORS[r.key] || HEAD_COLORS.Cinema} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Year-on-Year">
          {yoyByFY.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={yoyByFY} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis dataKey="fy" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tickFormatter={fmtLacsAxis}
                  label={{ value: '₹ in Lakhs', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      countField={(p) => (p.dataKey === 'Activation' ? 'ActivationCount' : 'RedemptionCardCount')}
                      countUnit="cards"
                    />
                  }
                  cursor={{ fill: 'rgba(27,36,48,0.04)' }}
                />
                <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
                <Bar dataKey="Activation" fill={COLORS.activationDark} radius={[4, 4, 0, 0]} maxBarSize={72}>
                  <LabelList dataKey="Activation" content={AmountLabel} />
                </Bar>
                <Bar dataKey="Redemption" fill={COLORS.redemption} radius={[4, 4, 0, 0]} maxBarSize={72}>
                  <LabelList dataKey="Redemption" content={AmountLabel} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Redemption Trend">
          {weekSlot.every((s) => s.Redemption === 0) ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={weekSlot} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis dataKey="slot" tick={{ fontSize: 12, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tickFormatter={fmtLacsAxis}
                  label={{ value: '₹ in Lakhs', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
                />
                <Tooltip content={<ChartTooltip countField="RedemptionCardCount" countUnit="cards" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
                <Bar dataKey="Redemption" fill={COLORS.redemption} radius={[4, 4, 0, 0]} maxBarSize={72}>
                  <LabelList dataKey="Redemption" content={AmountLabel} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card title="Activation vs. Redemption by Weekday">
        {weekdayTrend.length === 0 ? (
          <EmptyState />
        ) : (
          // 2026-08-24: 70/30 split (bar chart / pie chart), md+ only —
          // grid-cols-1 at base stacks the pie below the bar chart on
          // mobile instead of forcing the split at a width neither chart
          // would fit. The bar chart's own data/colors/structure are
          // unchanged; only its ResponsiveContainer width now fills its
          // 70% column instead of the whole card (height untouched).
          <div className="grid grid-cols-1 md:grid-cols-[7fr_3fr] gap-4">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={weekdayTrend} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tickFormatter={fmtLacsAxis}
                  label={{ value: '₹ in Lakhs', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      countField={(p) => (p.dataKey === 'Activation' ? 'ActivationCount' : 'RedemptionCardCount')}
                      countUnit="cards"
                    />
                  }
                  cursor={{ fill: 'rgba(27,36,48,0.04)' }}
                />
                <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
                <Bar dataKey="Activation" fill={COLORS.activationDark} radius={[4, 4, 0, 0]} maxBarSize={48}>
                  <LabelList dataKey="Activation" content={AmountLabel} />
                </Bar>
                <Bar dataKey="Redemption" fill={COLORS.redemption} radius={[4, 4, 0, 0]} maxBarSize={48}>
                  <LabelList dataKey="Redemption" content={AmountLabel} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* 2026-08-26: two separate pies (Activation, Redemption),
                side by side within this same 30% column — replaces the
                prior phase's single combined pie. Both read `weekdayTrend`
                directly (no reshape), so each pie's 7 slices sum to this
                page's own Total Activation / Total Redemption (net) by
                construction — weekdayTrend is already a complete
                per-weekday partition of both activationRows and
                redemptionRows (see its own doc comment above), the exact
                same guarantee its two bar series already carry
                individually. WEEKDAY_COLORS (lib/theme.js) is a dedicated
                7-hue rainbow, not categoricalColor()'s 5-hue cycle — see
                that constant's own comment for why a 5-hue cycle can't
                give 7 slices all-pairs separation. Same weekday->color
                mapping on both pies (a plain object lookup, not
                position-based), so a viewer can match a slice on one pie
                to the same weekday on the other. Labels sit directly on
                each slice (weekdayPieLabel, above) instead of the prior
                phase's hover-only tooltip + color-dot legend — flat pies
                (innerRadius 0), not donuts, specifically to maximize
                in-slice label room at this halved-again width. */}
            <div className="grid grid-cols-2 gap-1 items-center">
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie
                      data={weekdayTrend}
                      dataKey="Activation"
                      nameKey="key"
                      cx="50%"
                      cy="50%"
                      outerRadius={68}
                      paddingAngle={1}
                      stroke="none"
                      label={weekdayPieLabel}
                      labelLine={false}
                    >
                      {weekdayTrend.map((w) => (
                        <Cell key={w.key} fill={WEEKDAY_COLORS[w.key]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip countField="ActivationCount" countUnit="cards" />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-warmgray-muted -mt-1">Activation</div>
              </div>
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie
                      data={weekdayTrend}
                      dataKey="Redemption"
                      nameKey="key"
                      cx="50%"
                      cy="50%"
                      outerRadius={68}
                      paddingAngle={1}
                      stroke="none"
                      label={weekdayPieLabel}
                      labelLine={false}
                    >
                      {weekdayTrend.map((w) => (
                        <Cell key={w.key} fill={WEEKDAY_COLORS[w.key]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip countField="RedemptionCardCount" countUnit="cards" />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-warmgray-muted -mt-1">Redemption</div>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="Activation vs. Redemption by Denomination">
        {denominationSplit.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={denominationSplit} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
              <XAxis dataKey="denom" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                axisLine={false}
                tickLine={false}
                width={64}
                tickFormatter={fmtLacsAxis}
                label={{ value: '₹ in Lakhs', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    countField={(p) => (p.dataKey === 'Activation' ? 'ActivationCount' : 'RedemptionCardCount')}
                    countUnit="cards"
                  />
                }
                cursor={{ fill: 'rgba(27,36,48,0.04)' }}
              />
              <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
              <Bar dataKey="Activation" fill={COLORS.activationDark} radius={[4, 4, 0, 0]} maxBarSize={40}>
                <LabelList dataKey="Activation" content={AmountLabel} />
              </Bar>
              <Bar dataKey="Redemption" fill={COLORS.redemption} radius={[4, 4, 0, 0]} maxBarSize={40}>
                <LabelList dataKey="Redemption" content={AmountLabel} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Pan-India Monthly Trend">
        {monthTrend.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={monthTrend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                axisLine={false}
                tickLine={false}
                width={64}
                tickFormatter={fmtLacsAxis}
                label={{ value: '₹ in Lakhs', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    countField={(p) => (p.dataKey === 'Activation' ? 'ActivationCount' : 'RedemptionCardCount')}
                    countUnit="cards"
                  />
                }
              />
              <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
              <Line type="monotone" dataKey="Activation" stroke={COLORS.activationDark} strokeWidth={3} dot={{ r: 3.5 }} activeDot={{ r: 6 }} />
              <Line type="monotone" dataKey="Redemption" stroke={COLORS.redemption} strokeWidth={3} dot={{ r: 3.5 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  )
}

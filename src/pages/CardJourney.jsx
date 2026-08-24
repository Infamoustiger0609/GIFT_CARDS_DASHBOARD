import React, { useEffect, useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, LabelList } from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { sumBy, groupSum, weekSlotBreakdown, netBucketsProportionally, netHeadRows, netCinemaRedemption, REAL_HEAD_BUCKETS, isCancellationRow } from '../lib/aggregate'
import {
  computeComparisons,
  computeCohortComparisons,
  computeCustomWindowComparison,
  computeCustomWindowCohortComparison,
  computeBreakage,
  computeBreakageYoyPct,
  usePresetWindow,
  kpiDeltas
} from '../lib/comparisons'
import { WEEKDAY_ORDER, orderBy, regionLabel, fyOf } from '../lib/constants'
import { ACTIVATION_REGION_BUCKETS, REDEMPTION_REGION_BUCKETS, redemptionRegionLabel } from '../lib/regionBuckets'
import { sourceOf, groupByActivationSource } from '../lib/activationSource'
import { REDEMPTION_MODES } from '../lib/redemptionMode'
import { COLORS, HEAD_COLORS, REGION_COLORS, ACTIVATION_SOURCE_COLORS, CARD_TYPE_COLORS, REDEMPTION_SOURCE_COLORS, categoricalColor } from '../lib/theme'
import { fmtLacs, fmtNumber, fmtPct, fmtLacsAxis, fmtLacsWithPct, monthLabel } from '../lib/format'
import Card from '../components/Card'
import Kpi from '../components/Kpi'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'
import { FlowBox, FlowBranch } from '../components/FlowBox'
import { AmountLabel, amountWithPctLabel, MIN_BAR_WIDTH_FOR_ON_BAR_LABEL } from '../components/ChartLabels'

// Same region-only / source-only bucket slicing Overview.jsx already
// defines locally from the shared lib/regionBuckets.js/lib/activationSource.js
// tables — duplicated here rather than exported from Overview.jsx, matching
// this codebase's existing "each page keeps its own module-scope slice of
// the shared arrays" precedent (Overview.jsx's own
// ACTIVATION_REGION_ONLY_BUCKETS/REDEMPTION_REGION_ONLY_BUCKETS/
// ACTIVATION_SOURCE_ONLY_BUCKETS comment explains the same slicing).
const ACTIVATION_REGION_ONLY_BUCKETS = ACTIVATION_REGION_BUCKETS.slice(0, 6)
const REDEMPTION_REGION_ONLY_BUCKETS = REDEMPTION_REGION_BUCKETS.slice(0, 6)
const ACTIVATION_SOURCE_ONLY_BUCKETS = [
  { key: 'Aggregators', predicate: (r) => sourceOf(r.ActivationModeFinal) === 'Aggregators' },
  { key: 'Corporate', predicate: (r) => sourceOf(r.ActivationModeFinal) === 'Corporate' },
  { key: 'Cinema', predicate: (r) => sourceOf(r.ActivationModeFinal) === 'Cinema' }
]

// Plain per-bucket amount+count sum, no MoM (unlike Overview.jsx's own
// bucketRegionData) — none of this page's new charts carry delta badges,
// so there's no comparisonMonths/AllMonths pool to compute one from.
function bucketSum(rows, buckets, amountField, countField) {
  return buckets
    .map((b) => {
      const bucketRows = rows.filter(b.predicate)
      return { key: b.key, [amountField]: sumBy(bucketRows, amountField), [countField]: sumBy(bucketRows, countField) }
    })
    .filter((r) => r[amountField] !== 0)
}

// 2026-08-13, rebuilt twice the same day as cohortCube.json's own schema
// grew a second date field. First rewrite replaced "redemptions happening
// in the selected period" (same shape as Overview's own two KPIs) with a
// "to-date" cohort total (activation period fixed, redemption unbounded).
// This second rewrite narrows that further per an explicit follow-up
// request: "of cards activated in this period, how much got redeemed
// *within that same period*" — both ActivationYearMonth and
// RedemptionYearMonth must independently satisfy the current FY/Month
// selection (see FilterContext.jsx#filterCohort). The "to-date"/spillover
// question didn't go away — it's now the bonus chart at the bottom, using
// the same cube's `cohortRowsByActivation` pool (activation-only
// restricted), since the wider cube schema answers both questions at once.
export default function CardJourney() {
  const {
    activationRows,
    activationRowsForComparison,
    activationRowsAllFY,
    cohortRows,
    cohortRowsByActivation,
    cohortRowsForComparison,
    cohortRowsAllFY,
    comparisonMonths,
    loadCohortCube,
    cohortLoading,
    cohortError
  } = useFilters()

  // 2026-08-28: MTD/QTD(Q1-Q4 dropdown)/YTD preset control, brought up to
  // Overview's own latest state via the shared usePresetWindow() hook
  // (lib/comparisons.js) — the exact same control, state machine, and
  // window/anchor logic Overview.jsx itself now calls, not a second
  // independently-authored copy.
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

  // 2026-08-16: cohortCube.json (17MB+, only this page reads it) is no
  // longer part of the app's eager initial load — every other page would
  // otherwise pay for fetching/parsing it on every visit for no reason. This
  // page kicks the fetch off itself on mount instead; loadCohortCube() is a
  // no-op after the first call (see FilterContext.jsx), so navigating away
  // and back doesn't re-fetch.
  useEffect(() => {
    loadCohortCube()
  }, [loadCohortCube])

  // "Activated in This Period" — identical computation to Overview's own
  // headline Activation KPI (same activationRows pool), unchanged.
  const totalActivation = sumBy(activationRows, 'ActivationAmount')
  const totalActivationCount = sumBy(activationRows, 'ActivationCount')

  // "Redeemed Within This Period" — amount is net across every Head
  // (Cancellation rows carry a real negative RedemptionAmount and net in
  // automatically, same convention as every other net figure in this
  // app). Count deliberately excludes Head='Cancellation' rows entirely —
  // a cancellation isn't a redemption event to count, same "count excludes
  // cancellations, amount nets them in" split already established
  // elsewhere in this app (e.g. the 2026-07-31/2026-08-04 Mode-filter
  // entries' own count-convention notes).
  //
  // 2026-08-20: card count here is UniqueCardCount (distinct cards), not
  // RedemptionCount (transactions) — and it's this page's one hard
  // invariant: since cohortRows is already restricted to cards whose
  // ActivationYearMonth AND RedemptionYearMonth both fall in the selected
  // period (see FilterContext.jsx#filterCohort), this count is by
  // definition a subset of "Cards Activated" (totalActivationCount) below,
  // never independent of it and never larger. Every other page's
  // redemption card count can legitimately exceed its activation card
  // count for the same period (redemption includes cards activated in
  // prior periods) — that's normal there, but NOT here, since this page
  // asks a narrower, same-cohort question. If this ever renders larger
  // than totalActivationCount, that's a real bug, not expected variance.
  const redeemedAmount = sumBy(cohortRows, 'RedemptionAmount')
  const redeemedNonCancelRows = useMemo(() => cohortRows.filter((r) => !isCancellationRow(r)), [cohortRows])
  const redeemedCount = sumBy(redeemedNonCancelRows, 'UniqueCardCount')

  const samePeriodRedemptionRate = totalActivation > 0 ? (redeemedAmount / totalActivation) * 100 : NaN
  // "By Cards" — same question, card-count basis instead of amount:
  // redeemedCount is already UniqueCardCount (distinct cards, non-cancel
  // rows only — see its own doc comment above), totalActivationCount is
  // ActivationCount. Two independently meaningful rates, not one derived
  // from the other (a card can be worth more or less than the dataset's
  // average ticket size, so these two %s aren't expected to match).
  const samePeriodRedemptionRateByCards = totalActivationCount > 0 ? (redeemedCount / totalActivationCount) * 100 : NaN

  // ---- 2026-08-25 additions: bring the KPI ribbon up to Overview's own
  // 5-card structure (Activation Amount / Redemption Amount / Transaction
  // Value / Uptake / ATV), same Kpi.jsx component and MoM/QoQ/YoY deltas,
  // but every redemption-side figure stays cohort-scoped (cohortRows /
  // cohortRowsForComparison — never redemptionRows/redemptionRowsForComparison,
  // per this page's one standing rule, see the comment above the region/
  // source charts below). "Cards Activated" is the one exception: it has
  // no cohort-specific version at all (cohortCube.json carries no
  // ActivationAmount field, only Redemption-side measures), so its deltas
  // reuse the exact same activationRowsForComparison pool Overview's own
  // "Activation Amount" KPI does — the two pages' Cards Activated/
  // Activation Amount deltas are provably identical by construction, not
  // just similar. ----
  const activationDeltas = useMemo(
    () => computeComparisons(activationRowsForComparison, 'ActivationAmount', comparisonMonths),
    [activationRowsForComparison, comparisonMonths]
  )

  // cohortRowsForComparison has BOTH ActivationYearMonth and
  // RedemptionYearMonth unrestricted (every other filter still applies —
  // see FilterContext.jsx's own doc comment) so a MoM/QoQ/YoY window can
  // always find a prior-year cohort, even when a specific FY is selected —
  // the exact bug class the 2026-08-25 FY-comparison-pool fix addressed
  // for the main pools, generalized here to cohortCube.json's two-date-field
  // shape via computeCohortComparisons() (lib/comparisons.js), not
  // computeComparisons() itself, which only knows how to match rows
  // against a single YearMonth field.
  const redeemedAmountDeltas = useMemo(
    () => computeCohortComparisons(cohortRowsForComparison, 'ActivationYearMonth', 'RedemptionYearMonth', 'RedemptionAmount', comparisonMonths),
    [cohortRowsForComparison, comparisonMonths]
  )

  // "Transaction Value" = redeemedAmount + this cohort's own Uptake — same
  // combined-total shape as Overview's "Transaction Value" KPI, just summed
  // over cohortRows instead of redemptionRows. TransactionValue isn't a raw
  // field on cohort rows either, so it's synthesized per row on the
  // comparison pool exactly like Overview.jsx does for its own version.
  const cohortUptake = sumBy(cohortRows, 'Uptake')
  const transactionValue = redeemedAmount + cohortUptake
  const cohortRowsForComparisonWithTV = useMemo(
    () => cohortRowsForComparison.map((r) => ({ ...r, TransactionValue: (r.RedemptionAmount || 0) + (r.Uptake || 0) })),
    [cohortRowsForComparison]
  )
  const transactionValueDeltas = useMemo(
    () => computeCohortComparisons(cohortRowsForComparisonWithTV, 'ActivationYearMonth', 'RedemptionYearMonth', 'TransactionValue', comparisonMonths),
    [cohortRowsForComparisonWithTV, comparisonMonths]
  )
  const uptakeDeltas = useMemo(
    () => computeCohortComparisons(cohortRowsForComparison, 'ActivationYearMonth', 'RedemptionYearMonth', 'Uptake', comparisonMonths),
    [cohortRowsForComparison, comparisonMonths]
  )

  // Ticket (Box Office + Online) vs. F&B breakdown for the Transaction
  // Value/Uptake cards — same netHeadRows()-based netting Overview.jsx's
  // own uptakeTicketFnb/totalTransactionValueTicketFnb use, reused rather
  // than re-derived: netHeadRows()/physicalCancelWinnerMap() key their
  // Region+Month winner decision off `r.YearMonth`, a field cohortCube.json
  // rows don't have (only ActivationYearMonth/RedemptionYearMonth) — so
  // this aliases RedemptionYearMonth to YearMonth first (the redemption
  // event's own month is what the winner-map/netting logic actually cares
  // about) rather than duplicating netHeadRows()'s own Cancellation-
  // attribution logic a second time for a differently-shaped cube.
  const cohortRowsForNetting = useMemo(() => cohortRows.map((r) => ({ ...r, YearMonth: r.RedemptionYearMonth })), [cohortRows])
  const cohortUptakeTicketFnb = useMemo(() => {
    const netBoxOffice = netHeadRows(cohortRowsForNetting, 'Box Office')
    const netOnline = netHeadRows(cohortRowsForNetting, 'Online')
    const netFnb = netHeadRows(cohortRowsForNetting, 'F&B')
    return {
      ticket: sumBy(netBoxOffice, 'Uptake') + sumBy(netOnline, 'Uptake'),
      fnb: sumBy(netFnb, 'Uptake')
    }
  }, [cohortRowsForNetting])
  const cohortTransactionValueTicketFnb = useMemo(() => {
    const netBoxOffice = netHeadRows(cohortRowsForNetting, 'Box Office')
    const netOnline = netHeadRows(cohortRowsForNetting, 'Online')
    const netFnb = netHeadRows(cohortRowsForNetting, 'F&B')
    const ticketRedemption = sumBy(netBoxOffice, 'RedemptionAmount') + sumBy(netOnline, 'RedemptionAmount')
    const ticketUptake = sumBy(netBoxOffice, 'Uptake') + sumBy(netOnline, 'Uptake')
    const fnbRedemption = sumBy(netFnb, 'RedemptionAmount')
    const fnbUptake = sumBy(netFnb, 'Uptake')
    return {
      ticket: ticketRedemption + ticketUptake,
      fnb: fnbRedemption + fnbUptake
    }
  }, [cohortRowsForNetting])

  // "Breakage" (2026-08-30, replaces the former "Unredeemed Balance" card
  // in this exact ribbon slot — see Overview.jsx's own matching doc
  // comment for the full M+13 cumulative rule). Deliberately the SAME
  // computation as Overview.jsx's own Breakage, via the exact same shared
  // computeBreakage() (lib/comparisons.js) fed this page's own
  // activationRowsForComparison/cohortRowsForComparison — Breakage is a
  // dataset-wide historical concept (every activation cohort past its own
  // 13-month validity window, cumulatively), not a per-page-scoped one the
  // way "Cards Activated"/"Of Those, Redeemed" are, so unlike the former
  // "Unredeemed Balance" (which deliberately differed between the two
  // pages), this reads identically on both pages under the same filters —
  // by design, not an oversight.
  const breakage = useMemo(
    () => computeBreakage(activationRowsForComparison, cohortRowsForComparison, anchorMonth),
    [activationRowsForComparison, cohortRowsForComparison, anchorMonth]
  )
  const breakageSub = breakage.hasCohorts
    ? `Cards activated ${monthLabel(breakage.cutoffMonth)} or earlier`
    : 'No cohorts have reached 13 months yet'
  // Single fixed "YoY" badge (this anchor's cumulative figure vs. the
  // identical A−13 calculation one year earlier) — see
  // computeBreakageYoyPct()'s own doc comment for why this bypasses
  // kpiDeltas()'s MTD/QTD/YTD label-switching: Breakage is a point-in-time
  // cumulative balance, not a flow quantity, so there's no meaningful
  // "month-to-date"/"quarter-to-date" version of it to switch to.
  const breakageYoyPct = useMemo(
    () => computeBreakageYoyPct(activationRowsForComparison, cohortRowsForComparison, anchorMonth),
    [activationRowsForComparison, cohortRowsForComparison, anchorMonth]
  )

  // 2026-08-28 — "custom window" badge for each of the other 4 KPIs above:
  // the single generic comparison kpiDeltas() falls back to whenever no
  // MTD/QTD/YTD preset is active, same rule Overview.jsx's own ribbon
  // follows. "Cards Activated" reuses computeCustomWindowComparison()
  // directly (activationRowsForComparison has a plain single YearMonth
  // field, same shape Overview's own version reads); "Of Those, Redeemed"/
  // "Transaction Value"/"Additional Revenue" are cohort-scoped, via the
  // cohort-aware counterpart added alongside this page's own MTD/QTD/YTD
  // rollout (computeCustomWindowCohortComparison, lib/comparisons.js).
  // Neither is a page-local reimplementation of the "treat selectedMonths
  // as one window" arithmetic those shared functions already do
  // generically. Breakage (above) doesn't need one of these — see its own
  // "single fixed YoY badge" doc comment.
  const activationCustomPct = useMemo(
    () => computeCustomWindowComparison(activationRowsForComparison, 'ActivationAmount', selectedMonths),
    [activationRowsForComparison, selectedMonths]
  )
  const redeemedAmountCustomPct = useMemo(
    () => computeCustomWindowCohortComparison(cohortRowsForComparison, 'ActivationYearMonth', 'RedemptionYearMonth', 'RedemptionAmount', selectedMonths),
    [cohortRowsForComparison, selectedMonths]
  )
  const transactionValueCustomPct = useMemo(
    () =>
      computeCustomWindowCohortComparison(cohortRowsForComparisonWithTV, 'ActivationYearMonth', 'RedemptionYearMonth', 'TransactionValue', selectedMonths),
    [cohortRowsForComparisonWithTV, selectedMonths]
  )
  const uptakeCustomPct = useMemo(
    () => computeCustomWindowCohortComparison(cohortRowsForComparison, 'ActivationYearMonth', 'RedemptionYearMonth', 'Uptake', selectedMonths),
    [cohortRowsForComparison, selectedMonths]
  )
  // ---- Phase 2: Overview's flow diagram, cohort-scoped on the redemption
  // side ----
  // Activation side is byte-identical to Overview's own — same
  // groupByActivationSource() call on the same activationRows pool, no
  // cohort-specific version exists (same reasoning Phase 1 used for the
  // "Cards Activated" KPI: cohortCube.json carries no ActivationAmount
  // field at all, so there is nothing cohort-specific to build here).
  const activationSourceFlow = useMemo(
    () => groupByActivationSource(activationRows, { modeField: 'ActivationModeFinal', amountField: 'ActivationAmount', countField: 'ActivationCount' }),
    [activationRows]
  )
  // Redemption side mirrors Overview's 3-layer tree (Total -> Online +
  // Cinema -> Cinema -> Box Office + F&B), built from cohortRowsForNetting
  // (the RedemptionYearMonth->YearMonth alias Phase 1 already established
  // for the Uptake/Transaction Value breakdowns) via the exact same
  // netHeadRows()/netCinemaRedemption() Overview itself calls — not a
  // cohort-specific reimplementation. netCinemaRedemption()/
  // isNetCinemaRedemptionRow() never reference r.YearMonth at all (only
  // Head/RedemptionModeFinal), so the alias is only load-bearing for the
  // netHeadRows() calls below, but reusing the one pool for both keeps
  // this page's netting inputs from ever drifting apart on which alias
  // they saw.
  const cohortOnlineHead = useMemo(() => {
    const rows = netHeadRows(cohortRowsForNetting, 'Online')
    return { RedemptionAmount: sumBy(rows, 'RedemptionAmount'), UniqueCardCount: sumBy(rows, 'UniqueCardCount') }
  }, [cohortRowsForNetting])
  const cohortBoxOfficeHead = useMemo(() => {
    const rows = netHeadRows(cohortRowsForNetting, 'Box Office')
    return { RedemptionAmount: sumBy(rows, 'RedemptionAmount'), UniqueCardCount: sumBy(rows, 'UniqueCardCount') }
  }, [cohortRowsForNetting])
  const cohortFnbHead = useMemo(() => {
    const rows = netHeadRows(cohortRowsForNetting, 'F&B')
    return { RedemptionAmount: sumBy(rows, 'RedemptionAmount'), UniqueCardCount: sumBy(rows, 'UniqueCardCount') }
  }, [cohortRowsForNetting])
  const cohortCinemaTotal = useMemo(() => netCinemaRedemption(cohortRowsForNetting), [cohortRowsForNetting])

  // ---- "Year-on-Year: Activated vs. Redeemed" ----
  // Activation side is Overview's own computation verbatim — same
  // activationRowsAllFY pool, same fyOf(YearMonth) grouping — since there's
  // no cohort-specific version of plain activation to build (same
  // reasoning as Phases 1-2).
  //
  // Redemption side answers a genuinely narrower question than Overview's
  // own Year-on-Year chart: not "how much redeemed in FY X" (any card,
  // any activation date), but "of cards ACTIVATED in FY X, how much was
  // redeemed within that SAME FY" — spillover into a later FY doesn't
  // count here, same as this page's own "Of Those, Redeemed" KPI (see its
  // doc comment above) generalized from Month/FY-filter granularity to a
  // per-FY chart. `cohortRowsAllFY` lifts the FY restriction (Month and
  // every other filter still applied — see FilterContext.jsx's own doc
  // comment) but does NOT by itself enforce "same FY" for a given row —
  // with FY unrestricted, the cube's own cross-product of (activation
  // month, redemption month) pairs includes real spillover rows — so each
  // bar is built by first keeping only rows where fyOf(ActivationYearMonth)
  // === fyOf(RedemptionYearMonth), *then* grouping by that shared FY.
  const cohortYoyByFY = useMemo(
    () => cohortRowsAllFY.filter((r) => fyOf(r.ActivationYearMonth) === fyOf(r.RedemptionYearMonth)),
    [cohortRowsAllFY]
  )
  const yoyByFY = useMemo(() => {
    const fys = [...new Set([...activationRowsAllFY.map((r) => fyOf(r.YearMonth)), ...cohortYoyByFY.map((r) => fyOf(r.ActivationYearMonth))])].sort()
    return fys.map((fy) => {
      const actRows = activationRowsAllFY.filter((r) => fyOf(r.YearMonth) === fy)
      const redRows = cohortYoyByFY.filter((r) => fyOf(r.ActivationYearMonth) === fy)
      return {
        fy,
        Activation: sumBy(actRows, 'ActivationAmount'),
        ActivationCount: sumBy(actRows, 'ActivationCount'),
        Redemption: sumBy(redRows, 'RedemptionAmount'),
        RedemptionCardCount: sumBy(redRows, 'UniqueCardCount')
      }
    })
  }, [activationRowsAllFY, cohortYoyByFY])

  // 2026-08-15: was a plain groupSum(cohortRows, 'Head', ...) including
  // Cancellation as its own 4th bar — Cancellation should only ever be a
  // visible category on the dedicated Cancel Redeem page, so its amount is
  // now netted proportionally into Online/Box Office/F&B instead (see
  // lib/aggregate.js#netBucketsProportionally). The 3 bars now sum exactly
  // to "Of Those, Redeemed" above, by construction — that KPI is
  // sumBy(cohortRows, 'RedemptionAmount'), the same total this netting
  // redistributes without dropping or double-counting any of it.
  const byHead = useMemo(
    () => netBucketsProportionally(cohortRows, REAL_HEAD_BUCKETS, isCancellationRow, 'RedemptionAmount', 'UniqueCardCount'),
    [cohortRows]
  )

  // ---- 2026-08-23 additions ----
  // THE ONE RULE for every chart below: Activation-side series come from
  // `activationRows` (this page's own activation pool, already restricted
  // to the current period); Redemption-side series come from `cohortRows`
  // — never `redemptionRows` (that's Overview's "all redemptions this
  // period regardless of activation date" question, already answered
  // there) and never `cohortRowsByActivation` (the unbounded-redemption
  // spillover pool above, a different question again). `cohortRows` is
  // exactly the pool "Of Those, Redeemed" itself sums, so every chart here
  // that's a *complete* partition of it (no bucket exclusion) reconciles to
  // that KPI exactly by construction — verified directly against the raw
  // cubes before writing this (see CLAUDE.md). "Redemption by Region"
  // below is a deliberate exception to that reconciliation, same as
  // Overview's own chart of the same name: it excludes the Online
  // channel-total bucket by design (a "pure geography" chart, not a
  // complete Head/channel partition), so its own sum is smaller than
  // "Of Those, Redeemed" — that gap is real and expected, not a bug.
  const activationByRegion = useMemo(
    () => bucketSum(activationRows, ACTIVATION_REGION_ONLY_BUCKETS, 'ActivationAmount', 'ActivationCount'),
    [activationRows]
  )
  const redemptionByRegion = useMemo(
    () => bucketSum(cohortRows, REDEMPTION_REGION_ONLY_BUCKETS, 'RedemptionAmount', 'UniqueCardCount'),
    [cohortRows]
  )
  const activationBySource = useMemo(
    () => bucketSum(activationRows, ACTIVATION_SOURCE_ONLY_BUCKETS, 'ActivationAmount', 'ActivationCount'),
    [activationRows]
  )
  // 2026-08-27: "Redemption by Source" (Online/Cinema) — same
  // REDEMPTION_MODES bucketing/REDEMPTION_SOURCE_COLORS this app's other
  // "by Source" charts use (CancelRedeem.jsx's "Cancel Redeem by Source" is
  // the closest structural twin: a plain 2-bucket bar, not the CardType-
  // stacked version RedemptionBoxOffice.jsx's own "by Source" chart uses),
  // built from `cohortRows` per the one rule above. Online (RedemptionModeFinal
  // ='Online') + Cinema (='Physical') is a complete, non-overlapping
  // partition of every RedemptionModeFinal value on this cube (confirmed
  // directly — no third/unclassified value exists), so unlike "Redemption
  // by Region" this chart's own 2 bars reconcile exactly to "Of Those,
  // Redeemed" (redeemedAmount) by construction — verified against the raw
  // cube before writing this (see CLAUDE.md).
  const redemptionBySource = useMemo(
    () =>
      REDEMPTION_MODES.map(({ key, modes }) => {
        const rows = cohortRows.filter((r) => modes.includes(r.RedemptionModeFinal))
        return { key, RedemptionAmount: sumBy(rows, 'RedemptionAmount'), UniqueCardCount: sumBy(rows, 'UniqueCardCount') }
      }).filter((r) => r.RedemptionAmount !== 0),
    [cohortRows]
  )
  const weekdayTrend = useMemo(() => {
    const act = groupSum(activationRows, 'Weekday', ['ActivationAmount', 'ActivationCount'])
    const red = groupSum(cohortRows, 'Weekday', ['RedemptionAmount', 'UniqueCardCount'])
    return orderBy([...new Set([...act.map((r) => r.key), ...red.map((r) => r.key)])], WEEKDAY_ORDER).map((w) => ({
      key: w,
      Activation: act.find((r) => r.key === w)?.ActivationAmount || 0,
      ActivationCount: act.find((r) => r.key === w)?.ActivationCount || 0,
      Redemption: red.find((r) => r.key === w)?.RedemptionAmount || 0,
      RedemptionCardCount: red.find((r) => r.key === w)?.UniqueCardCount || 0
    }))
  }, [activationRows, cohortRows])
  // Same weekSlotBreakdown() Overview.jsx/Trends.jsx already share — called
  // with cohortRows as the "redemption rows" argument instead of the main
  // redemptionCube-derived pool, per the one rule above.
  const cohortWeekSlot = useMemo(() => weekSlotBreakdown(activationRows, cohortRows), [activationRows, cohortRows])

  // ---- Bonus: spillover ---- cards activated in the selected period,
  // grouped by whichever month they actually got redeemed in — including
  // months outside the selection entirely (before the data's very first
  // month can't happen, since nothing redeems before it's activated, but
  // well after the period is common and is the whole point of this
  // chart).
  //
  // 2026-08-16: added the Activation side of the same cohort as a second
  // series alongside the Redemption tail — a viewer sees at a glance which
  // months are the activation window itself (a gold bar present) versus
  // pure spillover (only a teal bar, no gold bar for that month). This
  // replaces the earlier within-period/outside-period teal/gold Cell
  // coloring on the Redemption bars alone — that distinction is now
  // conveyed structurally (gold+teal bar together = within the activation
  // window; teal bar alone = spillover) rather than by a 2nd color pair,
  // and the chart uses this app's dominant "gold=Activation, teal=
  // Redemption" 2-series convention (Year-on-Year, the Denomination
  // comparison, etc.).
  //
  // 2026-08-24: rendered as a diverging (Activation up, Redemption down as
  // a negated `RedemptionDown` field) bar chart for one release, then
  // reverted back to a normal side-by-side grouped chart (both series
  // positive, both rising from the same zero baseline) — the diverging
  // version's only advantage was slightly clearer "which months have both
  // series," which a grouped chart still shows just as well via two bars
  // sitting side by side versus one. `RedemptionDown`/`ReferenceLine y={0}`
  // are gone; `Redemption` (always the plain positive amount, never
  // negated) is the bar's own dataKey again.
  //
  // Activation-by-month comes from `activationRows` (already filtered to
  // the selected period) grouped by its own YearMonth — not the cohort
  // cube, which carries no ActivationAmount measure at all (only
  // RedemptionAmount/RedemptionCount/Uptake) — so by construction it can
  // only ever cover the activation period's own months, and sums exactly
  // to "Cards Activated" above (same activationRows, same field, just
  // broken out by month instead of summed once). Redemption-by-month is
  // unchanged from the original spillover computation (cohortRowsByActivation
  // grouped by RedemptionYearMonth) and still sums exactly to
  // sumBy(cohortRowsByActivation, 'RedemptionAmount') — this cohort's full
  // to-date redemption total, not "Of Those, Redeemed" above (which is the
  // narrower same-period-only figure) unless the selected period happens to
  // be the most recent one with nothing yet to spill into.
  // 2026-08-23: for each activation month, what % of that month's activated
  // amount was redeemed in that SAME calendar month — a narrower question
  // than the spillover chart's own "redeemed whenever" Redemption series.
  // From cohortRowsByActivation (activation period fixed, per this page's
  // own convention — the spillover pool, not cohortRows, which would
  // additionally restrict the *activation* side to the current filter's
  // Month/FY a second time in a way that's already handled by
  // activationRows above) filtered to RedemptionYearMonth ===
  // ActivationYearMonth, grouped by month. Grouping key is
  // ActivationYearMonth (equivalently RedemptionYearMonth once filtered to
  // the equal-month subset) so it lines up directly with `spillover`'s own
  // `key` (activation month).
  const sameMonthByActivation = useMemo(
    () =>
      groupSum(
        cohortRowsByActivation.filter((r) => r.RedemptionYearMonth === r.ActivationYearMonth),
        'ActivationYearMonth',
        ['RedemptionAmount']
      ),
    [cohortRowsByActivation]
  )

  const spillover = useMemo(() => {
    const actByMonth = groupSum(activationRows, 'YearMonth', ['ActivationAmount', 'ActivationCount'])
    const redByMonth = groupSum(cohortRowsByActivation, 'RedemptionYearMonth', ['RedemptionAmount', 'UniqueCardCount'])
    const months = [...new Set([...actByMonth.map((r) => r.key), ...redByMonth.map((r) => r.key)])].sort()
    return months.map((m) => {
      const act = actByMonth.find((r) => r.key === m)
      const red = redByMonth.find((r) => r.key === m)
      const redemptionAmount = red?.RedemptionAmount || 0
      const activationAmount = act?.ActivationAmount || 0
      const sameMonthRedeemed = sameMonthByActivation.find((r) => r.key === m)?.RedemptionAmount || 0
      return {
        key: m,
        label: monthLabel(m),
        Activation: activationAmount,
        ActivationCount: act?.ActivationCount || 0,
        Redemption: redemptionAmount,
        RedemptionCardCount: red?.UniqueCardCount || 0,
        SameMonthRedeemed: sameMonthRedeemed,
        SameMonthPct: activationAmount ? (sameMonthRedeemed / activationAmount) * 100 : null
      }
    })
  }, [activationRows, cohortRowsByActivation, sameMonthByActivation])

  // 2026-08-24 fix: `spillover.length` (total categories, activation +
  // spillover-only tail months) is the wrong density signal for the
  // Activation bar's own on-bar label — an early FY's tail can run nearly
  // as long as "All" (both extend to the end of the dataset), so gating on
  // total categories almost never let the label show. This counts only
  // the months that actually have an Activation bar, which is what
  // determines how crowded *that* bar's own label gets — see
  // amountWithPctLabel's own doc comment in ChartLabels.jsx.
  const activationMonthCount = useMemo(() => spillover.filter((m) => m.Activation > 0).length, [spillover])

  const hasData = activationRows.length > 0 || cohortRowsByActivation.length > 0
  // Both cohort-fed charts below share one empty/loading/error message —
  // distinguishes "still fetching the (large, lazily-loaded) cohort cube"
  // and "cube failed to load" from the generic "no rows match the current
  // filters", which would otherwise read as a real (mis)diagnosis during
  // the brief window before the fetch resolves.
  const cohortEmptyMessage = cohortError
    ? "Couldn't load cohort data."
    : cohortLoading
    ? 'Loading cohort data…'
    : undefined

  return (
    <div className="flex flex-col gap-6">
      {/* 2026-08-25: KPI ribbon brought up to Overview's own 5-card
          structure (Kpi.jsx, same grid breakpoints) — see the
          computations' own doc comment above for why "Cards Activated"
          reuses Overview's activation pool exactly while the other 4 stay
          cohort-scoped. This replaces the funnel's own two number blocks;
          the Redemption Rate figures move into their own compact strip
          right below, rather than being dropped just because they don't
          map onto one of Overview's 5 cards. (2026-08-29: that strip's
          "What does this mean?" disclosure was removed, and the single
          rate split into "By Revenue"/"By Cards" — see that block's own
          doc comment.)
          2026-08-28: brought up to Overview's LATEST ribbon state —
          the same MTD/QTD(Q1-Q4 dropdown)/YTD control row (via the shared
          usePresetWindow() hook, see its own doc comment in
          lib/comparisons.js) and the same single collapsed `kpiDeltas()`
          badge per card (MoM/QoQ/YoY no longer shown together), plus the
          one shared top-left comparison-date line — reusing the exact
          same control/JSX Overview.jsx renders, not a second copy. */}
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
          label="Cards Activated"
          value={fmtLacs(totalActivation)}
          subCount={`${fmtNumber(totalActivationCount)} cards`}
          accent="gold"
          deltas={kpiDeltas(activePreset, activationDeltas, activationCustomPct)}
        />
        <Kpi
          label="Of Those, Redeemed"
          value={fmtLacs(redeemedAmount)}
          subCount={`${fmtNumber(redeemedCount)} cards`}
          accent="teal"
          deltas={kpiDeltas(activePreset, redeemedAmountDeltas, redeemedAmountCustomPct)}
        />
        <Kpi
          label="Transaction Value"
          value={fmtLacs(transactionValue)}
          subCount={`${fmtNumber(redeemedCount)} cards`}
          accent="blue"
          deltas={kpiDeltas(activePreset, transactionValueDeltas, transactionValueCustomPct)}
          breakdown={[
            { label: 'Ticket', value: fmtLacsWithPct(cohortTransactionValueTicketFnb.ticket, transactionValue) },
            { label: 'F&B', value: fmtLacsWithPct(cohortTransactionValueTicketFnb.fnb, transactionValue) }
          ]}
        />
        <Kpi
          label="Additional Revenue"
          value={fmtLacs(cohortUptake)}
          subCount={`${fmtNumber(redeemedCount)} cards`}
          accent="navy"
          deltas={kpiDeltas(activePreset, uptakeDeltas, uptakeCustomPct)}
          breakdown={[
            { label: 'Ticket', value: fmtLacsWithPct(cohortUptakeTicketFnb.ticket, cohortUptake) },
            { label: 'F&B', value: fmtLacsWithPct(cohortUptakeTicketFnb.fnb, cohortUptake) }
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

      {/* Border/padding/typography match Card.jsx/Kpi.jsx exactly
          (2026-08-13 consistency pass) — the only intentional deviation
          from a plain Card.jsx is the `border-l-[6px] border-l-gold`
          accent, the same pattern Kpi.jsx's own `accent="gold"` cards
          already use elsewhere in this app, not a one-off treatment
          invented for this page. */}
      <div className="bg-card border border-warmgray-border border-l-[6px] border-l-gold rounded-lg p-4 md:p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gold mb-4">Redemption Percentage</div>
        {!hasData ? (
          <EmptyState />
        ) : (
          // 2026-08-29: was one "Redemption Rate" figure (amount-basis
          // only, redeemedAmount/totalActivation) — split into two
          // separately-labeled rates, same compact strip, same styling:
          // "By Revenue" (the same amount-basis rate this used to be, just
          // relabeled) and "By Cards" (the card-count-basis equivalent,
          // UniqueCardCount/ActivationCount) — two independently
          // meaningful numbers, not a duplicate of the same one.
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-warmgray-muted">By Revenue</div>
              <div className="text-2xl font-serif font-extrabold text-navy">{fmtPct(samePeriodRedemptionRate, 1)}</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-warmgray-muted">By Cards</div>
              <div className="text-2xl font-serif font-extrabold text-navy">{fmtPct(samePeriodRedemptionRateByCards, 1)}</div>
            </div>
          </div>
        )}
      </div>

      {/* Phase 2: Overview's own "Gift Card Activation vs. Redemption"
          flow diagram, reusing FlowBox/FlowBranch exactly as Overview does
          — same components, same visual style. Activation side is
          identical to Overview's (see activationSourceFlow's own doc
          comment above); the redemption side is labeled "Of Those,
          Redeemed" rather than "Total Redemption (net)" specifically so
          it reads as this page's own narrower cohort question at a
          glance, not a relabeled copy of Overview's broader one. */}
      <Card title="Activation vs. Redemption (This Cohort)">
        {!hasData ? (
          <EmptyState message={cohortEmptyMessage} />
        ) : (
          <div className="grid md:grid-cols-2 gap-8 md:gap-4 overflow-x-auto pb-2">
            <div className="flex flex-col items-center min-w-[460px]">
              <div className="text-xs font-semibold uppercase tracking-wide text-gold mb-2">Activation</div>
              <FlowBox label="Cards Activated" amount={totalActivation} count={totalActivationCount} color={COLORS.activation} size="lg" />
              <FlowBranch>
                {activationSourceFlow.map((src) => (
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
                {activationSourceFlow.map((src) => (
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

            <div className="flex flex-col items-center min-w-[380px]">
              <div className="text-xs font-semibold uppercase tracking-wide text-teal mb-2">Redemption</div>
              <FlowBox label="Of Those, Redeemed" amount={redeemedAmount} count={redeemedCount} color={COLORS.redemption} size="lg" />
              <FlowBranch>
                <FlowBox
                  label="Online"
                  amount={cohortOnlineHead.RedemptionAmount}
                  count={cohortOnlineHead.UniqueCardCount}
                  pct={redeemedAmount ? (cohortOnlineHead.RedemptionAmount / redeemedAmount) * 100 : 0}
                  color={HEAD_COLORS.Online}
                />
                <div className="flex flex-col items-center">
                  <FlowBox
                    label="Cinema"
                    amount={cohortCinemaTotal.RedemptionAmount}
                    count={cohortCinemaTotal.UniqueCardCount}
                    pct={redeemedAmount ? (cohortCinemaTotal.RedemptionAmount / redeemedAmount) * 100 : 0}
                    color={HEAD_COLORS.Cinema}
                  />
                  <FlowBranch>
                    <FlowBox
                      label="Box Office"
                      amount={cohortBoxOfficeHead.RedemptionAmount}
                      count={cohortBoxOfficeHead.UniqueCardCount}
                      pct={redeemedAmount ? (cohortBoxOfficeHead.RedemptionAmount / redeemedAmount) * 100 : 0}
                      color={HEAD_COLORS['Box Office']}
                    />
                    <FlowBox
                      label="F&B"
                      amount={cohortFnbHead.RedemptionAmount}
                      count={cohortFnbHead.UniqueCardCount}
                      pct={redeemedAmount ? (cohortFnbHead.RedemptionAmount / redeemedAmount) * 100 : 0}
                      color={HEAD_COLORS['F&B']}
                    />
                  </FlowBranch>
                </div>
              </FlowBranch>
            </div>
          </div>
        )}
      </Card>

      {/* Mirrors Overview's own "Year-on-Year" chart exactly (same
          BarChart/props), Activation side sharing its literal
          activationRowsAllFY-per-FY computation. Redemption side is
          cohort-scoped — see yoyByFY's own doc comment above for why a
          bar here answers "of cards activated in FY X, redeemed within
          that same FY" rather than Overview's plain "redeemed in FY X". */}
      <Card title="Year-on-Year: Activated vs. Redeemed">
        {yoyByFY.length === 0 ? (
          <EmptyState message={cohortEmptyMessage} />
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

      <Card title="Redemption by Head">
        {byHead.length === 0 ? (
          <EmptyState message={cohortEmptyMessage} />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byHead} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
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
              <Tooltip content={<ChartTooltip countField="UniqueCardCount" countUnit="cards" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
              <Bar dataKey="RedemptionAmount" name="Redemption" radius={[4, 4, 0, 0]} maxBarSize={64}>
                <LabelList dataKey="RedemptionAmount" content={AmountLabel} />
                {byHead.map((r) => (
                  <Cell key={r.key} fill={HEAD_COLORS[r.key] || COLORS.inkMuted} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Bonus capability (2026-08-13, extended 2026-08-16, reverted from a
          diverging up/down layout back to a normal grouped chart 2026-08-24):
          activation period fixed, redemption period unbounded — a
          side-by-side grouped bar chart, Activation (gold) against
          Redemption (teal), both rising from the same zero baseline, both
          by month. Activation only ever appears within the activation
          window itself (activationRows is already period-filtered); a month
          with a teal bar but no gold bar is pure spillover — redeemed
          later, outside the window. Each series sums exactly to its own
          total: Activation to "Cards Activated" above, Redemption to this
          cohort's full to-date redemption total (sumBy(cohortRowsByActivation,
          'RedemptionAmount') — broader than "Of Those, Redeemed" above
          unless the period is the most recent one with nothing yet to
          spill into). */}
      <Card title="Activation & Redemption Spillover — Cards Activated in This Period">
        {spillover.length === 0 ? (
          <EmptyState message={cohortEmptyMessage} />
        ) : (
          // 2026-08-23: top margin bumped 20 -> 34 for the Activation bar's
          // new 2-line label (amount + same-month %) — same clearance
          // regionDeltaLabel's own 2-line (amount + MoM) case needs
          // elsewhere in this app. Height bumped 300 -> 310 for the same
          // reason (screenshot-verified, not guessed).
          <ResponsiveContainer width="100%" height={310}>
            <BarChart data={spillover} margin={{ top: 34, right: 8, left: 0, bottom: 0 }} barGap={10}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} interval={0} angle={-30} textAnchor="end" height={50} />
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
                    formatter={(v) => fmtLacs(Math.abs(v))}
                    countField={(p) => (p.dataKey === 'Activation' ? 'ActivationCount' : 'RedemptionCardCount')}
                    countUnit="cards"
                  />
                }
                cursor={{ fill: 'rgba(27,36,48,0.04)' }}
              />
              <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
              <Bar dataKey="Activation" name="Activation" fill={COLORS.activation} radius={[3, 3, 0, 0]} maxBarSize={32}>
                {/* 2026-08-23: shows this month's own same-month-redeemed %
                    stacked underneath the amount (SameMonthPct — see the
                    spillover useMemo's own doc comment). Both lines render
                    above the bar, normal top-of-bar placement — the
                    below-baseline variant from the diverging-chart era
                    doesn't apply once the chart is a normal grouped bar
                    chart with nothing below zero to place it against. */}
                <LabelList dataKey="Activation" content={amountWithPctLabel(spillover, 'SameMonthPct', activationMonthCount)} />
              </Bar>
              <Bar dataKey="Redemption" name="Redemption" fill={COLORS.redemption} radius={[3, 3, 0, 0]} maxBarSize={32}>
                {/* Plain AmountLabel, gated by the same
                    MIN_BAR_WIDTH_FOR_ON_BAR_LABEL check the Activation bar's
                    own label already applies internally — at the 28-month/
                    all-FY zoom this bar renders at the same ~15px width as
                    Activation's, narrow enough that an always-on label here
                    would collide with Activation's own (confirmed via
                    screenshot, see ChartLabels.jsx's own doc comment). */}
                <LabelList
                  dataKey="Redemption"
                  content={(props) => (props.width < MIN_BAR_WIDTH_FOR_ON_BAR_LABEL ? null : AmountLabel(props))}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* 2026-08-23 additions — see the computations' own doc comment above
          for the one rule every chart here follows (Activation ->
          activationRows, Redemption -> cohortRows, never redemptionRows/
          cohortRowsByActivation). Structure/styling mirrored from each
          chart's Overview.jsx equivalent exactly, just the pool swapped and
          MoM-delta labels replaced with plain AmountLabel (this page has no
          comparisonMonths-based delta badges to attach). */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Activation by Region">
          {activationByRegion.length === 0 ? (
            <EmptyState message={cohortEmptyMessage} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={activationByRegion} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
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
                  <LabelList dataKey="ActivationAmount" content={AmountLabel} />
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
            <EmptyState message={cohortEmptyMessage} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={redemptionByRegion} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
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
                  <LabelList dataKey="RedemptionAmount" content={AmountLabel} />
                  {redemptionByRegion.map((r, i) => (
                    <Cell key={r.key} fill={REGION_COLORS[r.key] || categoricalColor(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* 2026-08-27: widened 2->3 columns to fit the new "Redemption by
          Source" card next to "Redemption Trend" — it directly closes the
          gap "Redemption by Region" leaves (that chart excludes the Online
          channel-total bucket by design, see its own doc comment above),
          making the excluded Online amount visible here instead of via a
          separate note/6th bar on the region chart itself. */}
      <div className="grid md:grid-cols-3 gap-6">
        <Card title="Activation by Source">
          {activationBySource.length === 0 ? (
            <EmptyState message={cohortEmptyMessage} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={activationBySource} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 10, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} interval={0} />
                <YAxis
                  tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tickFormatter={fmtLacsAxis}
                  label={{ value: '₹ in Lakhs', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
                />
                <Tooltip content={<ChartTooltip countField="ActivationCount" countUnit="cards" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
                <Bar dataKey="ActivationAmount" name="Activation" radius={[4, 4, 0, 0]} maxBarSize={64}>
                  <LabelList dataKey="ActivationAmount" content={AmountLabel} />
                  {activationBySource.map((r) => (
                    <Cell key={r.key} fill={ACTIVATION_SOURCE_COLORS[r.key]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Redemption Trend">
          {cohortWeekSlot.every((s) => s.Redemption === 0) ? (
            <EmptyState message={cohortEmptyMessage} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={cohortWeekSlot} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
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

        <Card title="Redemption by Source">
          {redemptionBySource.length === 0 ? (
            <EmptyState message={cohortEmptyMessage} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={redemptionBySource} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
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
                <Tooltip content={<ChartTooltip countField="UniqueCardCount" countUnit="cards" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
                <Bar dataKey="RedemptionAmount" name="Redemption" radius={[4, 4, 0, 0]} maxBarSize={64}>
                  <LabelList dataKey="RedemptionAmount" content={AmountLabel} />
                  {redemptionBySource.map((r) => (
                    <Cell key={r.key} fill={REDEMPTION_SOURCE_COLORS[r.key] || COLORS.inkMuted} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card title="Activation vs. Redemption by Weekday">
        {weekdayTrend.length === 0 ? (
          <EmptyState message={cohortEmptyMessage} />
        ) : (
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
        )}
      </Card>
    </div>
  )
}

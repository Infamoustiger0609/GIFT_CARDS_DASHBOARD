import React, { useMemo } from 'react'
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
  LabelList
} from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { sumBy, groupSum, weekSlotBreakdown, netCinemaRedemption, netRedemptionHeads, netHeadRows } from '../lib/aggregate'
import { computeComparisons } from '../lib/comparisons'
import { DENOM_ORDER, HEAD_ORDER, fyOf, regionLabel } from '../lib/constants'
import { COLORS, REGION_COLORS, HEAD_COLORS, ACTIVATION_SOURCE_COLORS, CARD_TYPE_COLORS, categoricalColor } from '../lib/theme'
import { groupByActivationSource, sourceOf } from '../lib/activationSource'
import { redemptionModeOf } from '../lib/redemptionMode'
import { ACTIVATION_REGION_BUCKETS, REDEMPTION_REGION_BUCKETS, redemptionRegionLabel } from '../lib/regionBuckets'
import { fmtLacs, fmtPct, fmtNumber, fmtLacsAxis, monthLabel } from '../lib/format'
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
// the prior "5 named regions" version this undoes): NO_SITE belongs on this
// chart, not on "Redemption by Head" — it's a Region_Clean value, not a
// Head value, and mixing it into the Head breakdown was itself the bug this
// reversion fixes (see REDEMPTION_HEAD_BUCKETS below). Back to all 6
// REGION_ORDER entries (5 named regions + NO_SITE).
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

// 2026-08-15: strictly Head-scoped, real-redemption heads only (Online/Box
// Office/F&B) — HEAD_ORDER minus 'Cancellation'. Cancellation deliberately
// does NOT appear on this chart: it has its own dedicated page
// (/cancel-redeem) and its own "by Source"/"by Weekday"/"by Region" charts
// there, so showing it a second time here would be redundant. This is a
// gross, per-head breakdown — with Cancellation excluded, the 3 bars sum to
// the gross total (₹8,157.90L in the baseline dataset), NOT to "Total
// Redemption (net)" above (₹6,695.32L) — cancellations are the only thing
// that nets the two figures apart, and removing the one bar that carried
// them here means this chart no longer reconciles to that KPI. That's
// intentional, not a bug — don't add Cancellation back just to make the sum
// match; the "Total Redemption (net)" reconciliation is Redemption by
// Head's own no-longer-a-goal, not something to re-engineer around.
const REDEMPTION_HEAD_BUCKETS = HEAD_ORDER.filter((head) => head !== 'Cancellation').map((head) => ({
  key: head,
  predicate: (r) => r.Head === head
}))

export default function Overview() {
  const {
    activationRows,
    redemptionRows,
    activationRowsAllMonths,
    redemptionRowsAllMonths,
    activationRowsAllFY,
    redemptionRowsAllFY,
    comparisonMonths,
    dailyTrendAvailable,
    dailyMonthActivationRows,
    dailyMonthRedemptionRows
  } = useFilters()

  const totalActivation = sumBy(activationRows, 'ActivationAmount')
  const totalRedemption = sumBy(redemptionRows, 'RedemptionAmount')
  const totalActivationCount = sumBy(activationRows, 'ActivationCount')
  const totalRedemptionCount = sumBy(redemptionRows, 'RedemptionCount')
  const totalUptake = sumBy(redemptionRows, 'Uptake')
  const overallRedemptionPct = totalActivation > 0 ? (totalRedemption / totalActivation) * 100 : NaN
  // Total Redemption Amount + Total Uptake — a combined-total KPI, not a
  // sub-component of another KPI on this ribbon (same "no meaningful
  // parent" reasoning as Revenue/Activation Amount), so it gets deltas but
  // no "% of..." sub-line, per the KPI-parity convention established
  // earlier in this file.
  const totalTransactionValue = totalRedemption + totalUptake

  const activationDeltas = useMemo(
    () => computeComparisons(activationRowsAllMonths, 'ActivationAmount', comparisonMonths),
    [activationRowsAllMonths, comparisonMonths]
  )
  const redemptionDeltas = useMemo(
    () => computeComparisons(redemptionRowsAllMonths, 'RedemptionAmount', comparisonMonths),
    [redemptionRowsAllMonths, comparisonMonths]
  )
  const uptakeDeltas = useMemo(
    () => computeComparisons(redemptionRowsAllMonths, 'Uptake', comparisonMonths),
    [redemptionRowsAllMonths, comparisonMonths]
  )
  // TransactionValue isn't a raw field on redemption rows — synthesized per
  // row (RedemptionAmount + Uptake) on the Month-unrestricted pool so
  // computeComparisons can run over it exactly like every other delta here.
  const transactionValueRowsAllMonths = useMemo(
    () => redemptionRowsAllMonths.map((r) => ({ ...r, TransactionValue: (r.RedemptionAmount || 0) + (r.Uptake || 0) })),
    [redemptionRowsAllMonths]
  )
  const transactionValueDeltas = useMemo(
    () => computeComparisons(transactionValueRowsAllMonths, 'TransactionValue', comparisonMonths),
    [transactionValueRowsAllMonths, comparisonMonths]
  )
  const uptakePct = totalRedemption > 0 ? (totalUptake / totalRedemption) * 100 : NaN

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
  const positiveHeads = useMemo(() => netRedemptionHeads(redemptionRows), [redemptionRows])

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

  // ---- Cinema flow node (Box Office + F&B combined) for the redemption
  // flow diagram's new intermediate layer — Total Redemption -> (Online,
  // Cinema) -> Cinema -> (Box Office, F&B). Computed via the shared
  // lib/aggregate.js#netCinemaRedemption() utility, NOT independently
  // re-derived, so it's provably equal to positiveHeads' own Box Office +
  // F&B (both net the same Physical-mode cancellations in, just via two
  // different but mathematically equivalent routes — see the 2026-08-06
  // CLAUDE.md entry). Online/Box Office/F&B's own individual values below
  // are untouched, still positiveHeads' proportional-netting figures. ----
  const cinemaTotal = useMemo(() => netCinemaRedemption(redemptionRows), [redemptionRows])
  // positiveHeads is always exactly [Online, Box Office, F&B], in that
  // fixed order (see its own definition above) — destructured once here
  // rather than re-filtering the array at each flow-diagram node.
  const [onlineHead, boxOfficeHead, fnbHead] = positiveHeads

  // ---- Activation by Region (5 physical-cinema regions, pure geography)
  // and Redemption by Region (5 regions + NO_SITE, pure geography) — see
  // the module-level bucket definitions above for why these are bucketed
  // this way instead of a raw Region_Clean groupby. Each bar's MoM delta is
  // computed the same way the KPI deltas are (computeComparisons against
  // the Month-unrestricted pool), just further filtered down to each
  // bucket's own predicate first. ----
  const activationByRegion = useMemo(
    () => bucketRegionData(activationRows, activationRowsAllMonths, ACTIVATION_REGION_ONLY_BUCKETS, 'ActivationAmount', 'ActivationCount', comparisonMonths),
    [activationRows, activationRowsAllMonths, comparisonMonths]
  )
  const redemptionByRegion = useMemo(
    () => bucketRegionData(redemptionRows, redemptionRowsAllMonths, REDEMPTION_REGION_ONLY_BUCKETS, 'RedemptionAmount', 'RedemptionCount', comparisonMonths),
    [redemptionRows, redemptionRowsAllMonths, comparisonMonths]
  )

  // ---- Activation by Source (Aggregators/Corporate [Corporate+Online
  // merged]/Cinema — all 3 real sources, self-reconciling to Total
  // Activation) and Redemption by Head (Online/Box Office/F&B only, gross —
  // Cancellation deliberately excluded, see REDEMPTION_HEAD_BUCKETS above,
  // so this one does NOT reconcile to "Total Redemption (net)", by design)
  // — "Activation by Region"/"Redemption by Region" beside them answer a
  // different (geography-only) question and aren't meant to partition
  // against these. ----
  const activationBySourceRaw = useMemo(
    () => bucketRegionData(activationRows, activationRowsAllMonths, ACTIVATION_SOURCE_ONLY_BUCKETS, 'ActivationAmount', 'ActivationCount', comparisonMonths),
    [activationRows, activationRowsAllMonths, comparisonMonths]
  )
  const redemptionByHead = useMemo(
    () => bucketRegionData(redemptionRows, redemptionRowsAllMonths, REDEMPTION_HEAD_BUCKETS, 'RedemptionAmount', 'RedemptionCount', comparisonMonths),
    [redemptionRows, redemptionRowsAllMonths, comparisonMonths]
  )

  // ---- Year-on-Year: Activation vs. Redemption per FY, all filters except
  // FY still applied (same skipFY pattern as skipMonth's "all months" pools
  // — see FilterContext.jsx). FY isn't a raw field on either cube, so this
  // groups by fyOf(YearMonth) with a plain reduce rather than groupSum,
  // which only groups by a literal row field. ----
  const yoyByFY = useMemo(() => {
    const fys = [...new Set([...activationRowsAllFY.map((r) => fyOf(r.YearMonth)), ...redemptionRowsAllFY.map((r) => fyOf(r.YearMonth))])].sort()
    return fys.map((fy) => {
      const actRows = activationRowsAllFY.filter((r) => fyOf(r.YearMonth) === fy)
      const redRows = redemptionRowsAllFY.filter((r) => fyOf(r.YearMonth) === fy)
      return {
        fy,
        Activation: sumBy(actRows, 'ActivationAmount'),
        ActivationCount: sumBy(actRows, 'ActivationCount'),
        Redemption: sumBy(redRows, 'RedemptionAmount'),
        RedemptionCount: sumBy(redRows, 'RedemptionCount')
      }
    })
  }, [activationRowsAllFY, redemptionRowsAllFY])

  // ---- Redemption Trend (Weekday vs. Weekend) — reuses the same
  // weekSlotBreakdown() Trends.jsx's "Week-slot Overview" is built on (both
  // Activation and Redemption come back; this chart only renders the
  // Redemption side) so the two pages can never drift on what counts as a
  // weekend. ----
  const weekSlot = useMemo(() => weekSlotBreakdown(activationRows, redemptionRows), [activationRows, redemptionRows])

  // ---- Activation vs. Redemption amount by Denomination tier. 'N/A'
  // (cancellation-side entries) and 'Other' are both excluded here the same
  // way they're excluded from the filter's own dropdown options — neither
  // is one of the 11 fixed DENOM_ORDER buckets (2026-08-12: 'Other' is a
  // real Denom value but is no longer offered as its own bucket/option, per
  // an explicit request — same treatment 'N/A' already had). Iterates
  // DENOM_ORDER directly (fixed 11 buckets) rather than deriving-then-
  // ordering the set of values actually present, so a value outside this
  // list can't slip back in via orderBy()'s "unknown, append alphabetically"
  // fallback the way 'Other' used to before this fix. ----
  const denominationSplit = useMemo(() => {
    const act = groupSum(
      activationRows.filter((r) => DENOM_ORDER.includes(r.Denom)),
      'Denom',
      ['ActivationAmount', 'ActivationCount']
    )
    const red = groupSum(
      redemptionRows.filter((r) => DENOM_ORDER.includes(r.Denom)),
      'Denom',
      ['RedemptionAmount', 'RedemptionCount']
    )
    return DENOM_ORDER.map((d) => ({
      denom: d,
      Activation: act.find((r) => r.key === d)?.ActivationAmount || 0,
      ActivationCount: act.find((r) => r.key === d)?.ActivationCount || 0,
      Redemption: red.find((r) => r.key === d)?.RedemptionAmount || 0,
      RedemptionCount: red.find((r) => r.key === d)?.RedemptionCount || 0
    }))
  }, [activationRows, redemptionRows])

  // ---- Pan-India month-wise trend ----
  const monthTrend = useMemo(() => {
    const act = groupSum(activationRows, 'YearMonth', ['ActivationAmount', 'ActivationCount'])
    const red = groupSum(redemptionRows, 'YearMonth', ['RedemptionAmount', 'RedemptionCount'])
    const months = [...new Set([...act.map((r) => r.key), ...red.map((r) => r.key)])].sort()
    return months.map((m) => ({
      month: m,
      label: monthLabel(m),
      Activation: act.find((r) => r.key === m)?.ActivationAmount || 0,
      ActivationCount: act.find((r) => r.key === m)?.ActivationCount || 0,
      Redemption: red.find((r) => r.key === m)?.RedemptionAmount || 0,
      RedemptionCount: red.find((r) => r.key === m)?.RedemptionCount || 0
    }))
  }, [activationRows, redemptionRows])

  // ---- Day-by-day breakdown (2026-08-10) — only meaningful, and only
  // rendered, when exactly one month is selected and no field the daily
  // cubes lack (CardType/Denomination/either Source) is active — see
  // FilterContext.jsx's "Daily Activation & Redemption Trend chart
  // availability" doc comment. Always covers every day of the selected
  // month. 2026-08-15: this chart itself is unchanged (still backed by the
  // daily cubes, still day-of-month analysis) — only the highlight-one-
  // specific-day layer is gone, since that was driven by the old numeric
  // "Day" global filter, which no longer exists (replaced by "Weekday" on
  // the main cubes — see FilterBar.jsx). Every bar now renders at full
  // opacity; there's no narrower "selection" than the whole month anymore. ----
  const dailyTrend = useMemo(() => {
    if (!dailyTrendAvailable) return []
    const act = groupSum(dailyMonthActivationRows, 'DateStr', ['ActivationAmount', 'ActivationCount'])
    const red = groupSum(dailyMonthRedemptionRows, 'DateStr', ['RedemptionAmount', 'RedemptionCount'])
    const dates = [...new Set([...act.map((r) => r.key), ...red.map((r) => r.key)])].sort()
    return dates.map((d) => ({
      date: d,
      day: Number(d.slice(8, 10)),
      Activation: act.find((r) => r.key === d)?.ActivationAmount || 0,
      ActivationCount: act.find((r) => r.key === d)?.ActivationCount || 0,
      Redemption: red.find((r) => r.key === d)?.RedemptionAmount || 0,
      RedemptionCount: red.find((r) => r.key === d)?.RedemptionCount || 0
    }))
  }, [dailyTrendAvailable, dailyMonthActivationRows, dailyMonthRedemptionRows])

  const hasData = activationRows.length > 0 || redemptionRows.length > 0

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="Revenue/Activation Amount"
          value={fmtLacs(totalActivation)}
          sub={`${fmtNumber(totalActivationCount)} cards`}
          accent="gold"
          deltas={[
            { label: 'MoM', pct: activationDeltas.mom },
            { label: 'QoQ', pct: activationDeltas.qoq },
            { label: 'YoY', pct: activationDeltas.yoy }
          ]}
        />
        <Kpi
          label="Total Redemption (net)"
          value={fmtLacs(totalRedemption)}
          sub={`${fmtNumber(totalRedemptionCount)} redemptions · ${fmtPct(overallRedemptionPct, 0)} of total activation`}
          accent="teal"
          deltas={[
            { label: 'MoM', pct: redemptionDeltas.mom },
            { label: 'QoQ', pct: redemptionDeltas.qoq },
            { label: 'YoY', pct: redemptionDeltas.yoy }
          ]}
        />
        <Kpi
          label="Total Transaction Value"
          value={fmtLacs(totalTransactionValue)}
          sub={`${fmtNumber(totalRedemptionCount)} redemptions · Redemption + Uptake`}
          accent="blue"
          deltas={[
            { label: 'MoM', pct: transactionValueDeltas.mom },
            { label: 'QoQ', pct: transactionValueDeltas.qoq },
            { label: 'YoY', pct: transactionValueDeltas.yoy }
          ]}
        />
        <Kpi
          label="Uptake"
          value={fmtLacs(totalUptake)}
          valueClassName="text-2xl"
          sub={`${fmtNumber(totalRedemptionCount)} redemptions · ${fmtPct(uptakePct, 0)} of total redemption`}
          accent="navy"
          deltas={[
            { label: 'MoM', pct: uptakeDeltas.mom },
            { label: 'QoQ', pct: uptakeDeltas.qoq },
            { label: 'YoY', pct: uptakeDeltas.yoy }
          ]}
          breakdown={[
            { label: 'Ticket', value: fmtLacs(uptakeTicketFnb.ticket) },
            { label: 'F&B', value: fmtLacs(uptakeTicketFnb.fnb) }
          ]}
        />
      </div>

      {dailyTrendAvailable && (
        <Card title="Daily Activation & Redemption Trend">
          {dailyTrend.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dailyTrend} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
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
                      countField={(p) => (p.dataKey === 'Activation' ? 'ActivationCount' : 'RedemptionCount')}
                      countUnit={(p) => (p.dataKey === 'Activation' ? 'cards' : 'redemptions')}
                    />
                  }
                  labelFormatter={(day) => `Day ${day}`}
                  cursor={{ fill: 'rgba(27,36,48,0.04)' }}
                />
                <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
                <Bar dataKey="Activation" fill={COLORS.activationDark} radius={[3, 3, 0, 0]} maxBarSize={18} />
                <Bar dataKey="Redemption" fill={COLORS.redemption} radius={[3, 3, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
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
                count={totalRedemptionCount}
                countUnit="redemptions"
                color={COLORS.redemption}
                size="lg"
              />
              <FlowBranch>
                <FlowBox
                  key={onlineHead.key}
                  label={onlineHead.key}
                  amount={onlineHead.RedemptionAmount}
                  count={onlineHead.RedemptionCount}
                  countUnit="redemptions"
                  pct={totalRedemption ? (onlineHead.RedemptionAmount / totalRedemption) * 100 : 0}
                  color={HEAD_COLORS[onlineHead.key] || COLORS.inkMuted}
                />
                <div className="flex flex-col items-center">
                  <FlowBox
                    label="Cinema"
                    amount={cinemaTotal.RedemptionAmount}
                    count={cinemaTotal.RedemptionCount}
                    countUnit="redemptions"
                    pct={totalRedemption ? (cinemaTotal.RedemptionAmount / totalRedemption) * 100 : 0}
                    color={HEAD_COLORS.Cinema}
                  />
                  <FlowBranch>
                    {[boxOfficeHead, fnbHead].map((h) => (
                      <FlowBox
                        key={h.key}
                        label={h.key}
                        amount={h.RedemptionAmount}
                        count={h.RedemptionCount}
                        countUnit="redemptions"
                        pct={totalRedemption ? (h.RedemptionAmount / totalRedemption) * 100 : 0}
                        color={HEAD_COLORS[h.key] || COLORS.inkMuted}
                      />
                    ))}
                  </FlowBranch>
                </div>
              </FlowBranch>
            </div>
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
                  content={<ChartTooltip countField="RedemptionCount" countUnit="redemptions" />}
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
                  content={<ChartTooltip countField="RedemptionCount" countUnit="redemptions" />}
                  cursor={{ fill: 'rgba(27,36,48,0.04)' }}
                />
                <Bar dataKey="RedemptionAmount" name="Redemption" radius={[4, 4, 0, 0]} maxBarSize={64}>
                  <LabelList dataKey="RedemptionAmount" content={regionDeltaLabel(redemptionByHead)} />
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
                      countField={(p) => (p.dataKey === 'Activation' ? 'ActivationCount' : 'RedemptionCount')}
                      countUnit={(p) => (p.dataKey === 'Activation' ? 'cards' : 'redemptions')}
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
                <Tooltip content={<ChartTooltip countField="RedemptionCount" countUnit="redemptions" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
                <Bar dataKey="Redemption" fill={COLORS.redemption} radius={[4, 4, 0, 0]} maxBarSize={72}>
                  <LabelList dataKey="Redemption" content={AmountLabel} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

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
                    countField={(p) => (p.dataKey === 'Activation' ? 'ActivationCount' : 'RedemptionCount')}
                    countUnit={(p) => (p.dataKey === 'Activation' ? 'cards' : 'redemptions')}
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
                    countField={(p) => (p.dataKey === 'Activation' ? 'ActivationCount' : 'RedemptionCount')}
                    countUnit={(p) => (p.dataKey === 'Activation' ? 'cards' : 'redemptions')}
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

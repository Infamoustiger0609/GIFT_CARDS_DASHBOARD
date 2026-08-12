import React, { useMemo } from 'react'
import { useFilters } from '../lib/FilterContext'
import { netHeadRows, REAL_HEAD_BUCKETS, isCancellationRow } from '../lib/aggregate'
import { ACTIVATION_SOURCES, sourceOf } from '../lib/activationSource'
import { REDEMPTION_MODES, redemptionModeOf } from '../lib/redemptionMode'
import { ACTIVATION_REGION_BUCKETS, REDEMPTION_REGION_BUCKETS, redemptionRegionLabel } from '../lib/regionBuckets'
import { DENOM_ORDER, regionLabel } from '../lib/constants'
import MetricComparisonCard from '../components/MetricComparisonCard'

// Bucket definitions are pure predicates over a row — static, so defined
// once at module scope rather than recomputed every render. Each reuses the
// exact same bucketing logic (sourceOf/redemptionModeOf/the shared region
// buckets) every other chart on Activation/Redemption/Overview already
// uses, so this page's numbers can't drift from theirs.
const ACTIVATION_SOURCE_BUCKETS = ACTIVATION_SOURCES.map((s) => ({ key: s.key, predicate: (r) => sourceOf(r.ActivationModeFinal) === s.key }))
const REDEMPTION_SOURCE_BUCKETS = REDEMPTION_MODES.map((s) => ({ key: s.key, predicate: (r) => redemptionModeOf(r.RedemptionModeFinal) === s.key }))
const CARD_TYPE_BUCKETS = ['Digital', 'Physical'].map((c) => ({ key: c, predicate: (r) => r.CardType === c }))
// 'N/A' (cancellation-side bookkeeping rows) is deliberately excluded — same
// "not a real Denom tier" treatment as the Denomination *filter*'s own
// dropdown and Overview's Denomination chart.
const DENOM_BUCKETS = DENOM_ORDER.map((d) => ({ key: d, predicate: (r) => r.Denom === d }))
// 2026-08-15: "Redemption by Head" and "Redemption by Card Type" both had
// Cancel Redeem rows leaking in as their own visible bucket ("Cancellation"
// on Head — CardType is always 'N/A' on a cancellation row, which used to
// land in the synthetic "Other" bucket on Card Type). Cancellation should
// only ever be a visible category on the dedicated Cancel Redeem page —
// everywhere else it nets proportionally into the real categories instead
// (see MetricComparisonCard's `cancelPredicate` prop /
// lib/aggregate.js#netBucketsProportionally). REAL_HEAD_BUCKETS/
// isCancellationRow are shared with CardJourney.jsx, the other consumer of
// this exact same netting.

export default function Summary() {
  const {
    activationRows,
    activationRowsAllMonths,
    activationRowsAllFY,
    redemptionRows,
    redemptionRowsAllMonths,
    redemptionRowsAllFY,
    comparisonMonths
  } = useFilters()

  // Box Office / F&B, net of their own Cancel Redeem transactions — the
  // same shared netHeadRows() pool RedemptionBoxOffice.jsx/RedemptionFnb.jsx
  // use for their own headline KPIs. Computed for all three row pools
  // (current, AllMonths, AllFY) each derives its own winner map internally
  // when none is passed (see lib/aggregate.js) so this page's Box Office/
  // F&B totals can't drift from what those two pages themselves show.
  const boxOfficeRows = useMemo(() => netHeadRows(redemptionRows, 'Box Office'), [redemptionRows])
  const boxOfficeRowsAllMonths = useMemo(() => netHeadRows(redemptionRowsAllMonths, 'Box Office'), [redemptionRowsAllMonths])
  const boxOfficeRowsAllFY = useMemo(() => netHeadRows(redemptionRowsAllFY, 'Box Office'), [redemptionRowsAllFY])
  const fnbRows = useMemo(() => netHeadRows(redemptionRows, 'F&B'), [redemptionRows])
  const fnbRowsAllMonths = useMemo(() => netHeadRows(redemptionRowsAllMonths, 'F&B'), [redemptionRowsAllMonths])
  const fnbRowsAllFY = useMemo(() => netHeadRows(redemptionRowsAllFY, 'F&B'), [redemptionRowsAllFY])

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="font-serif text-lg font-extrabold text-navy mb-1">Activation</h2>
        <p className="text-xs text-warmgray-muted mb-3 max-w-3xl">
          YoY = this month vs. the same month last year. MoM = this month vs. the immediately preceding month. FY
          Comparison = full fiscal-year totals side by side (Apr-Mar); the most recent FY is marked Partial/YTD
          when it doesn't yet have all 12 months of data, and its own delta compares the same YTD month range
          against last year rather than a misleading full-year-vs-partial-year number. Every card below respects
          the filters above, live.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <MetricComparisonCard
            title="Total Activation"
            accent="gold"
            rows={activationRows}
            rowsAllMonths={activationRowsAllMonths}
            rowsAllFY={activationRowsAllFY}
            amountField="ActivationAmount"
            countField="ActivationCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
          />
          <MetricComparisonCard
            title="Activation by Source"
            accent="gold"
            rows={activationRows}
            rowsAllMonths={activationRowsAllMonths}
            rowsAllFY={activationRowsAllFY}
            amountField="ActivationAmount"
            countField="ActivationCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            buckets={ACTIVATION_SOURCE_BUCKETS}
          />
          <MetricComparisonCard
            title="Activation by Region"
            accent="gold"
            rows={activationRows}
            rowsAllMonths={activationRowsAllMonths}
            rowsAllFY={activationRowsAllFY}
            amountField="ActivationAmount"
            countField="ActivationCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            buckets={ACTIVATION_REGION_BUCKETS}
            bucketLabelFn={regionLabel}
          />
          <MetricComparisonCard
            title="Activation by Card Type"
            accent="gold"
            rows={activationRows}
            rowsAllMonths={activationRowsAllMonths}
            rowsAllFY={activationRowsAllFY}
            amountField="ActivationAmount"
            countField="ActivationCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            buckets={CARD_TYPE_BUCKETS}
          />
          <MetricComparisonCard
            title="Activation by Denomination"
            accent="gold"
            rows={activationRows}
            rowsAllMonths={activationRowsAllMonths}
            rowsAllFY={activationRowsAllFY}
            amountField="ActivationAmount"
            countField="ActivationCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            buckets={DENOM_BUCKETS}
          />
        </div>
      </div>

      <div>
        <h2 className="font-serif text-lg font-extrabold text-navy mb-1">Redemption</h2>
        <p className="text-xs text-warmgray-muted mb-3 max-w-3xl">
          Same YoY/MoM/FY definitions as above, applied to the redemption cube. "Total Redemption," "by Head," "by
          Source," "by Region," "by Card Type," and "by Denomination" are all gross per row — cancellations net in
          automatically since they carry real signed amounts, same convention as the Redemption Heads Breakdown
          chart elsewhere in the app. "Box Office Redemption" and "F&B Redemption" are each net of their own Cancel
          Redeem transactions specifically, matching those two pages' own headline KPIs exactly.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <MetricComparisonCard
            title="Total Redemption (net)"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsAllMonths}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="RedemptionCount"
            unit="redemptions"
            comparisonMonths={comparisonMonths}
          />
          <MetricComparisonCard
            title="Redemption by Head"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsAllMonths}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="RedemptionCount"
            unit="redemptions"
            comparisonMonths={comparisonMonths}
            buckets={REAL_HEAD_BUCKETS}
            cancelPredicate={isCancellationRow}
          />
          <MetricComparisonCard
            title="Box Office Redemption (net)"
            accent="teal"
            rows={boxOfficeRows}
            rowsAllMonths={boxOfficeRowsAllMonths}
            rowsAllFY={boxOfficeRowsAllFY}
            amountField="RedemptionAmount"
            countField="RedemptionCount"
            unit="redemptions"
            comparisonMonths={comparisonMonths}
          />
          <MetricComparisonCard
            title="F&B Redemption (net)"
            accent="teal"
            rows={fnbRows}
            rowsAllMonths={fnbRowsAllMonths}
            rowsAllFY={fnbRowsAllFY}
            amountField="RedemptionAmount"
            countField="RedemptionCount"
            unit="redemptions"
            comparisonMonths={comparisonMonths}
          />
          <MetricComparisonCard
            title="Redemption by Source"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsAllMonths}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="RedemptionCount"
            unit="redemptions"
            comparisonMonths={comparisonMonths}
            buckets={REDEMPTION_SOURCE_BUCKETS}
          />
          <MetricComparisonCard
            title="Redemption by Region"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsAllMonths}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="RedemptionCount"
            unit="redemptions"
            comparisonMonths={comparisonMonths}
            buckets={REDEMPTION_REGION_BUCKETS}
            bucketLabelFn={redemptionRegionLabel}
          />
          <MetricComparisonCard
            title="Redemption by Card Type"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsAllMonths}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="RedemptionCount"
            unit="redemptions"
            comparisonMonths={comparisonMonths}
            buckets={CARD_TYPE_BUCKETS}
            cancelPredicate={isCancellationRow}
          />
          <MetricComparisonCard
            title="Redemption by Denomination"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsAllMonths}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="RedemptionCount"
            unit="redemptions"
            comparisonMonths={comparisonMonths}
            buckets={DENOM_BUCKETS}
          />
        </div>
      </div>
    </div>
  )
}

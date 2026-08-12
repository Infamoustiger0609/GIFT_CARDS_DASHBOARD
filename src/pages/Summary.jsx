import React, { useMemo } from 'react'
import { useFilters } from '../lib/FilterContext'
import { netHeadRows, isCancellationRow } from '../lib/aggregate'
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
// 2026-08-15: "Redemption by Head" (now folded into "Redemption by
// Source"'s nested Cinema breakdown below, see 2026-08-19) and "Redemption
// by Card Type" both had Cancel Redeem rows leaking in as their own visible
// bucket. Cancellation should only ever be a visible category on the
// dedicated Cancel Redeem page — everywhere else it nets proportionally
// into the real categories instead (see MetricComparisonCard's
// `cancelPredicate` prop / lib/aggregate.js#netBucketsProportionally).
// isCancellationRow is shared with CardJourney.jsx, another consumer of
// this exact same netting.
//
// 2026-08-19: "Redemption by Head" (Online/Box Office/F&B) removed as its
// own top-level card — it covered the same ground as "Redemption by
// Source" (Online/Cinema), just one level more granular on the Cinema side.
// Rather than two overlapping cards, "Redemption by Source" now nests a
// Box Office/F&B sub-breakdown under its own Cinema row (via
// MetricComparisonCard's `nestedBreakdowns` prop) — Online has no further
// split, Cinema does. CINEMA_HEAD_BUCKETS is scoped to just those 2 real
// heads (not REAL_HEAD_BUCKETS' 3 — Online isn't part of Cinema), with
// Cancel Redeem netted proportionally into them the same way the old
// "Redemption by Head" card netted into all 3 — so Box Office + F&B here
// still sum exactly to the Cinema row directly above them.
const CINEMA_HEAD_BUCKETS = [
  { key: 'Box Office', predicate: (r) => r.Head === 'Box Office' },
  { key: 'F&B', predicate: (r) => r.Head === 'F&B' }
]

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
        {/* 2026-08-18 restructure: was two separate "Activation"/
            "Redemption" sections, each internally sorted by dimension —
            now one section, cards interleaved Activation-then-its-
            Redemption-equivalent so the md:grid-cols-2 grid lays each pair
            out side by side by construction (no extra layout code needed,
            just emission order).
            2026-08-19: "Activation by Source" now pairs with "Redemption by
            Source" directly (Online/Cinema — the global Redemption Source
            filter's own vocabulary), not the former "Redemption by Head"
            card, which is gone (see CINEMA_HEAD_BUCKETS above for where its
            Box Office/F&B detail moved instead: a nested breakdown under
            "Redemption by Source"'s own Cinema row). */}
        <h2 className="font-serif text-lg font-extrabold text-navy mb-1">Activation &amp; Redemption Trends</h2>
        <p className="text-xs text-warmgray-muted mb-3 max-w-3xl">
          YoY = this month vs. the same month last year. MoM = this month vs. the immediately preceding month. FY
          Comparison = full fiscal-year totals side by side (Apr-Mar); the most recent FY is marked Partial/YTD
          when it doesn't yet have all 12 months of data, and its own delta compares the same YTD month range
          against last year rather than a misleading full-year-vs-partial-year number. Activation-side figures are
          gross (no cancellation concept exists on that cube); Redemption-side figures are net — cancellations
          carry real signed amounts and net in automatically for "Total," "by Region," "by Source," and "by
          Denomination," while "by Head" and "by Card Type" net Cancel Redeem transactions in proportionally
          rather than showing them as their own category (see the Cancel Redeem page for that breakdown). Every
          card below respects the filters above, live.
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
            title="Total Redemption (net)"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsAllMonths}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="UniqueCardCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
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
          <MetricComparisonCard
            title="Redemption by Denomination"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsAllMonths}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="UniqueCardCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            buckets={DENOM_BUCKETS}
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
            title="Redemption by Region"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsAllMonths}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="UniqueCardCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            buckets={REDEMPTION_REGION_BUCKETS}
            bucketLabelFn={redemptionRegionLabel}
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
            title="Redemption by Source"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsAllMonths}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="UniqueCardCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            buckets={REDEMPTION_SOURCE_BUCKETS}
            nestedBreakdowns={{ Cinema: { buckets: CINEMA_HEAD_BUCKETS, cancelPredicate: isCancellationRow } }}
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
            title="Redemption by Card Type"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsAllMonths}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="UniqueCardCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            buckets={CARD_TYPE_BUCKETS}
            cancelPredicate={isCancellationRow}
          />
        </div>
      </div>

      <div>
        <div className="grid md:grid-cols-2 gap-4">
          <MetricComparisonCard
            title="Box Office Redemption (net)"
            accent="teal"
            rows={boxOfficeRows}
            rowsAllMonths={boxOfficeRowsAllMonths}
            rowsAllFY={boxOfficeRowsAllFY}
            amountField="RedemptionAmount"
            countField="UniqueCardCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
          />
          <MetricComparisonCard
            title="F&B Redemption (net)"
            accent="teal"
            rows={fnbRows}
            rowsAllMonths={fnbRowsAllMonths}
            rowsAllFY={fnbRowsAllFY}
            amountField="RedemptionAmount"
            countField="UniqueCardCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
          />
        </div>
      </div>
    </div>
  )
}

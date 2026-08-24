import React, { useMemo } from 'react'
import { useFilters } from '../lib/FilterContext'
import { usePresetWindow } from '../lib/comparisons'
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

// 2026-08-19 audit fix: ACTIVATION_REGION_BUCKETS/REDEMPTION_REGION_BUCKETS
// (lib/regionBuckets.js) each carry 3 non-geographic channel-total buckets
// tacked on after the real regions (Aggregators/Corporate/Online on the
// activation side; Director's Cut/Online on the redemption side, where
// "Online" is the 100%-NORTH-tagged backend-logging channel, not a real
// region). Overview.jsx/CardJourney.jsx already slice to just the first 6
// (region-only) entries before charting a "by Region" breakdown, precisely
// so that channel total never shows up under a region heading — this page
// was passing the unsliced array straight through, so "Activation by
// Region"/"Redemption by Region" were showing an "Online" row alongside
// NORTH/SOUTH/etc. Fixed by applying the same slice; the channel totals
// this drops are already covered by this page's own "Activation by
// Source"/"Redemption by Source" cards above, so no information is lost.
const ACTIVATION_REGION_ONLY_BUCKETS = ACTIVATION_REGION_BUCKETS.slice(0, 6)
const REDEMPTION_REGION_ONLY_BUCKETS = REDEMPTION_REGION_BUCKETS.slice(0, 6)

export default function Summary() {
  const {
    activationRows,
    activationRowsForComparison,
    activationRowsAllFY,
    redemptionRows,
    redemptionRowsForComparison,
    redemptionRowsAllFY,
    comparisonMonths
  } = useFilters()

  // 2026-08-29: MTD/QTD(Q1-Q4 dropdown)/YTD preset control, called ONCE at
  // the page level (not once per card) — every one of this page's 13
  // MetricComparisonCard instances below receives the resulting
  // `activePreset`/`selectedMonths` as props and reads its own delta off
  // that single shared selection, so none of them can drift onto a
  // different window from the others.
  const {
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

  // Box Office / F&B, net of their own Cancel Redeem transactions — the
  // same shared netHeadRows() pool RedemptionBoxOffice.jsx/RedemptionFnb.jsx
  // use for their own headline KPIs. Computed for all three row pools
  // (current, ForComparison, AllFY) each derives its own winner map
  // internally when none is passed (see lib/aggregate.js) so this page's
  // Box Office/F&B totals can't drift from what those two pages themselves
  // show.
  //
  // 2026-08-25 bug fix: the *ForComparison pools (Month AND FY
  // unrestricted — see FilterContext.jsx's own doc comment) replace the
  // old *AllMonths pools (Month-unrestricted only) here — a specific FY
  // selection used to zero out any MoM/YoY delta whose prior-year window
  // fell in a different FY. *AllFY (Month-unrestricted only, FY lifted)
  // is untouched — it feeds computeFYSeries/computeBucketFYSeries's "By
  // Year" blocks, a separate concept with no anchor-month logic of its
  // own that was never affected by this bug.
  const boxOfficeRows = useMemo(() => netHeadRows(redemptionRows, 'Box Office'), [redemptionRows])
  const boxOfficeRowsForComparison = useMemo(() => netHeadRows(redemptionRowsForComparison, 'Box Office'), [redemptionRowsForComparison])
  const boxOfficeRowsAllFY = useMemo(() => netHeadRows(redemptionRowsAllFY, 'Box Office'), [redemptionRowsAllFY])
  const fnbRows = useMemo(() => netHeadRows(redemptionRows, 'F&B'), [redemptionRows])
  const fnbRowsForComparison = useMemo(() => netHeadRows(redemptionRowsForComparison, 'F&B'), [redemptionRowsForComparison])
  const fnbRowsAllFY = useMemo(() => netHeadRows(redemptionRowsAllFY, 'F&B'), [redemptionRowsAllFY])

  return (
    <div className="flex flex-col gap-8">
      {/* 2026-08-29: MTD/QTD(Q1-Q4 dropdown)/YTD control row + single
          top-left comparison-date line — copied verbatim from Overview.jsx's
          own render, rendered ONCE here at the top of the page rather than
          once per MetricComparisonCard below (see that component's own doc
          comment on `activePreset`/`selectedMonths`). */}
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
        <div className="grid md:grid-cols-2 gap-4">
          <MetricComparisonCard
            title="Total Activation"
            accent="gold"
            rows={activationRows}
            rowsAllMonths={activationRowsForComparison}
            rowsAllFY={activationRowsAllFY}
            amountField="ActivationAmount"
            countField="ActivationCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            activePreset={activePreset}
            selectedMonths={selectedMonths}
          />
          <MetricComparisonCard
            title="Total Redemption (net)"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsForComparison}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="UniqueCardCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            activePreset={activePreset}
            selectedMonths={selectedMonths}
          />
          <MetricComparisonCard
            title="Activation by Source"
            accent="gold"
            rows={activationRows}
            rowsAllMonths={activationRowsForComparison}
            rowsAllFY={activationRowsAllFY}
            amountField="ActivationAmount"
            countField="ActivationCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            activePreset={activePreset}
            selectedMonths={selectedMonths}
            buckets={ACTIVATION_SOURCE_BUCKETS}
          />
          <MetricComparisonCard
            title="Redemption by Source"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsForComparison}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="UniqueCardCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            activePreset={activePreset}
            selectedMonths={selectedMonths}
            buckets={REDEMPTION_SOURCE_BUCKETS}
            nestedBreakdowns={{ Cinema: { buckets: CINEMA_HEAD_BUCKETS, cancelPredicate: isCancellationRow } }}
          />
          <MetricComparisonCard
            title="Activation by Card Type"
            accent="gold"
            rows={activationRows}
            rowsAllMonths={activationRowsForComparison}
            rowsAllFY={activationRowsAllFY}
            amountField="ActivationAmount"
            countField="ActivationCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            activePreset={activePreset}
            selectedMonths={selectedMonths}
            buckets={CARD_TYPE_BUCKETS}
          />
          <MetricComparisonCard
            title="Redemption by Card Type"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsForComparison}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="UniqueCardCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            activePreset={activePreset}
            selectedMonths={selectedMonths}
            buckets={CARD_TYPE_BUCKETS}
            cancelPredicate={isCancellationRow}
          />
          <MetricComparisonCard
            title="Activation by Region"
            accent="gold"
            rows={activationRows}
            rowsAllMonths={activationRowsForComparison}
            rowsAllFY={activationRowsAllFY}
            amountField="ActivationAmount"
            countField="ActivationCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            activePreset={activePreset}
            selectedMonths={selectedMonths}
            buckets={ACTIVATION_REGION_ONLY_BUCKETS}
            bucketLabelFn={regionLabel}
          />
          <MetricComparisonCard
            title="Redemption by Region"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsForComparison}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="UniqueCardCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            activePreset={activePreset}
            selectedMonths={selectedMonths}
            buckets={REDEMPTION_REGION_ONLY_BUCKETS}
            bucketLabelFn={redemptionRegionLabel}
          />
        </div>
      </div>

      <div>
        <div className="grid md:grid-cols-2 gap-4">
          <MetricComparisonCard
            title="Box Office Redemption (net)"
            accent="teal"
            rows={boxOfficeRows}
            rowsAllMonths={boxOfficeRowsForComparison}
            rowsAllFY={boxOfficeRowsAllFY}
            amountField="RedemptionAmount"
            countField="UniqueCardCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            activePreset={activePreset}
            selectedMonths={selectedMonths}
          />
          <MetricComparisonCard
            title="F&B Redemption (net)"
            accent="teal"
            rows={fnbRows}
            rowsAllMonths={fnbRowsForComparison}
            rowsAllFY={fnbRowsAllFY}
            amountField="RedemptionAmount"
            countField="UniqueCardCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            activePreset={activePreset}
            selectedMonths={selectedMonths}
          />
        </div>
      </div>

      <div>
        <div className="grid md:grid-cols-2 gap-4">
          <MetricComparisonCard
            title="Activation by Denomination"
            accent="gold"
            rows={activationRows}
            rowsAllMonths={activationRowsForComparison}
            rowsAllFY={activationRowsAllFY}
            amountField="ActivationAmount"
            countField="ActivationCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            activePreset={activePreset}
            selectedMonths={selectedMonths}
            buckets={DENOM_BUCKETS}
          />
          <MetricComparisonCard
            title="Redemption by Denomination"
            accent="teal"
            rows={redemptionRows}
            rowsAllMonths={redemptionRowsForComparison}
            rowsAllFY={redemptionRowsAllFY}
            amountField="RedemptionAmount"
            countField="UniqueCardCount"
            unit="cards"
            comparisonMonths={comparisonMonths}
            activePreset={activePreset}
            selectedMonths={selectedMonths}
            buckets={DENOM_BUCKETS}
          />
        </div>
      </div>
    </div>
  )
}

import React from 'react'
import Card from './Card'
import DeltaBadge from './DeltaBadge'
import EmptyState from './EmptyState'
import { computeBucketComparisons, computeFYSeries, computeBucketFYSeries, computeNettedBucketComparisons, computeNettedBucketFYSeries } from '../lib/comparisons'
import { fmtLacs, fmtNumber } from '../lib/format'

const TOTAL_BUCKET = [{ key: 'Total', predicate: () => true }]

// Same accent map Kpi.jsx uses (gold = activation-cube cards, teal =
// redemption-cube cards throughout this app) — kept as a local literal
// rather than importing Kpi.jsx's own map, since this component styles its
// own header block rather than rendering a <Kpi> inside a <Card> (which
// would double up the title — Card already renders one above it).
const ACCENTS = {
  gold: { border: 'border-l-gold', text: 'text-gold' },
  teal: { border: 'border-l-teal', text: 'text-teal' }
}

// One reusable "metric + comparison views" block for the Summary page
// (2026-08-11): headline total with MoM/YoY badges (same DeltaBadge
// component every other page's KPIs already use), an optional per-bucket
// breakdown table (Region/Source/Head/CardType/Denomination — whichever
// `buckets` the caller passes) each with its own MoM/YoY for the current
// filtered period, and a bottom block covering every fiscal year present in
// the data — a bucket x FY matrix when `buckets` is given (2026-08-15;
// see computeBucketFYSeries), or a flat per-FY total when it isn't (nothing
// to break a category out of). All views read from `rows`/`rowsAllFY` —
// already filtered by every active global filter (see FilterContext.jsx) —
// so this recomputes live as filters change, same as every other comparison
// already on this dashboard; no filter-plumbing of its own.
//
// 2026-08-13: takes both `rows` (the ordinary, Month-respecting filtered
// pool — same shape as activationRows/redemptionRows every other page's
// headline KPI sums) and `rowsAllMonths` (Month-unrestricted, only for the
// MoM/YoY delta lookups) — see comparisons.js#computeBucketComparisons's
// doc comment for the bug this split fixes (the headline total used to
// silently collapse to just the latest month whenever Month was left
// unrestricted). Also visually restyled to match the app's established
// KPI language — colored left-border accent + text-3xl serif value, same
// as Kpi.jsx — rather than a plain unaccented number.
export default function MetricComparisonCard({
  title,
  rows,
  rowsAllMonths,
  rowsAllFY,
  amountField,
  countField,
  unit,
  comparisonMonths,
  buckets,
  bucketLabelFn,
  cancelPredicate,
  accent = 'navy'
}) {
  const accentClasses = ACCENTS[accent] || { border: 'border-l-navy', text: 'text-navy' }
  const [totalRow] = computeBucketComparisons(rows, rowsAllMonths, TOTAL_BUCKET, amountField, countField, comparisonMonths)
  const total = totalRow || { amount: 0, count: 0, mom: null, yoy: null }
  // 2026-08-14 fix: some bucket sets (Denomination, Card Type) don't
  // partition every row — a row with Denom/CardType='N/A' (a real,
  // typically negative correction/adjustment amount, not junk) matched
  // none of the named buckets, so the table's own rows summed to less than
  // — or, once cancellation-attributed rows are involved, more than — the
  // card's own headline total above it. Region/Source/Head bucket sets are
  // already complete partitions of their field's raw values, so this never
  // fires for them (confirmed: every row matches exactly one of their
  // predicates). Appending a synthetic "Other" bucket whose predicate is
  // simply "didn't match any of the real ones" captures whatever gap
  // exists generically, for any bucket set, without per-dimension
  // special-casing — same "show it, don't hide it" rule already applied to
  // the Redemption Heads Breakdown chart's visible Cancellation bar and
  // the 3 pages' own by-Format/Category/Denomination chart fixes earlier
  // the same day. computeBucketComparisons() already drops zero-amount
  // buckets, so "Other" simply doesn't render for bucket sets with no gap.
  // 2026-08-15: `cancelPredicate` marks a bucket set where a category-less
  // subset of rows (Cancel Redeem transactions) must be netted
  // proportionally into the real buckets instead of getting its own
  // "Other"/N/A row — see lib/aggregate.js#netBucketsProportionally. Only
  // "Redemption by Card Type" and "Redemption by Head" pass this; every
  // other bucketed card keeps the plain computeBucketComparisons path with
  // its synthetic "Other" bucket (Region/Source/Head-elsewhere are already
  // complete partitions with no such leak; Activation's own "Other" is a
  // real correction-row bucket, not Cancellation).
  const bucketsWithOther = buckets && !cancelPredicate ? [...buckets, { key: 'Other', predicate: (r) => !buckets.some((b) => b.predicate(r)) }] : null
  const bucketRows = cancelPredicate
    ? computeNettedBucketComparisons(rows, rowsAllMonths, buckets, cancelPredicate, amountField, countField, comparisonMonths)
    : bucketsWithOther
      ? computeBucketComparisons(rows, rowsAllMonths, bucketsWithOther, amountField, countField, comparisonMonths)
      : []
  const fySeries = computeFYSeries(rowsAllFY, amountField, countField)
  // Same bucket partition as the current-period table above, just crossed
  // against every FY instead of the active filter period — reuses
  // fySeries' own FY ordering so the two blocks can't disagree on which FYs
  // exist or how they're sorted.
  const bucketFYRows = cancelPredicate
    ? computeNettedBucketFYSeries(rowsAllFY, buckets, cancelPredicate, amountField, countField, fySeries.map((f) => f.fy))
    : bucketsWithOther
      ? computeBucketFYSeries(rowsAllFY, bucketsWithOther, amountField, countField, fySeries.map((f) => f.fy))
      : []

  const hasAnyData = rows.length > 0 || rowsAllFY.length > 0

  return (
    <Card title={title} className={`border-l-[6px] ${accentClasses.border}`}>
      {!hasAnyData ? (
        <EmptyState />
      ) : (
        <>
          <div className="flex items-start justify-between flex-wrap gap-2 mb-4">
            <div>
              <div className={`text-3xl font-serif font-extrabold tracking-tight ${accentClasses.text}`}>{fmtLacs(total.amount)}</div>
              <div className="text-xs font-medium text-warmgray-muted mt-1">
                {fmtNumber(total.count)} {unit}
              </div>
            </div>
            <div className="flex gap-1.5 pt-1">
              <DeltaBadge pct={total.mom} label="MoM" />
              <DeltaBadge pct={total.yoy} label="YoY" />
            </div>
          </div>

          {buckets && bucketRows.length > 0 && (
            <div className="border-t border-warmgray-border pt-3 mb-4 overflow-x-auto">
              <table className="w-full text-xs min-w-[280px] border-separate border-spacing-0">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-warmgray-muted">
                    <th className="text-left font-semibold pb-1.5">{title.replace(/^(Activation|Redemption) by /, '')}</th>
                    <th className="text-right font-semibold pb-1.5">Amount</th>
                    <th className="text-right font-semibold pb-1.5">MoM</th>
                    <th className="text-right font-semibold pb-1.5">YoY</th>
                  </tr>
                </thead>
                <tbody>
                  {bucketRows.map((r) => (
                    <tr key={r.key} className="border-t border-warmgray-border/60 hover:bg-cream/60 transition-colors">
                      <td className="py-1.5 text-navy font-medium whitespace-nowrap">{bucketLabelFn ? bucketLabelFn(r.key) : r.key}</td>
                      <td className="py-1.5 text-right text-navy tabular-nums whitespace-nowrap">{fmtLacs(r.amount)}</td>
                      <td className="py-1.5 text-right">
                        <DeltaBadge pct={r.mom} label="" />
                      </td>
                      <td className="py-1.5 text-right">
                        <DeltaBadge pct={r.yoy} label="" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {buckets && bucketFYRows.length > 0 ? (
            // 2026-08-15: bucket x FY matrix, replacing the flat per-FY total
            // block below (still used when there's no `buckets` to break a
            // category out of) — that block and the current-period bucket
            // table above it were both partial views of "totals," with no
            // single place showing each category's own year-wise trend. The
            // Total row re-displays fySeries' own (already-verified) per-FY
            // amount directly, rather than re-summing the bucket cells, so it
            // can't silently drift from the headline/flat-total figure this
            // replaces.
            <div className="border-t border-warmgray-border pt-3 overflow-x-auto">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-warmgray-muted mb-2">By Year</div>
              <table className="w-full text-xs min-w-[280px] border-separate border-spacing-0">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-warmgray-muted">
                    <th className="text-left font-semibold pb-1.5">{title.replace(/^(Activation|Redemption) by /, '')}</th>
                    {fySeries.map((f) => (
                      <th key={f.fy} className="text-right font-semibold pb-1.5 whitespace-nowrap">
                        {f.fy}
                        {f.isPartial && <span className="block normal-case text-gold font-semibold">YTD, {f.monthsPresent}/12 mo</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bucketFYRows.map((r) => (
                    <tr key={r.key} className="border-t border-warmgray-border/60 hover:bg-cream/60 transition-colors">
                      <td className="py-1.5 text-navy font-medium whitespace-nowrap">{bucketLabelFn ? bucketLabelFn(r.key) : r.key}</td>
                      {fySeries.map((f) => (
                        <td key={f.fy} className="py-1.5 text-right text-navy tabular-nums whitespace-nowrap">
                          {fmtLacs(r.byFY[f.fy].amount)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t border-warmgray-border font-semibold">
                    <td className="py-1.5 text-navy">Total</td>
                    {fySeries.map((f) => (
                      <td key={f.fy} className="py-1.5 text-right text-navy tabular-nums whitespace-nowrap">
                        {fmtLacs(f.amount)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            !buckets &&
            fySeries.length > 0 && (
              <div className="border-t border-warmgray-border pt-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-warmgray-muted mb-2">FY Comparison</div>
                <div className="flex flex-wrap gap-2.5">
                  {fySeries.map((f) => (
                    <div key={f.fy} className="min-w-[112px] bg-cream/70 border border-warmgray-border rounded-md px-3 py-2">
                      <div className="text-[11px] font-bold text-navy">{f.fy}</div>
                      <div className="text-sm font-semibold text-navy tabular-nums mt-0.5">{fmtLacs(f.amount)}</div>
                      <div className="text-[10px] text-warmgray-muted">
                        {fmtNumber(f.count)} {unit}
                      </div>
                      {f.isPartial && <div className="text-[9px] text-gold font-semibold italic mt-0.5">Partial — {f.monthsPresent}/12 months (YTD)</div>}
                      <div className="mt-1">
                        <DeltaBadge pct={f.deltaPct} label={f.deltaLabel} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </>
      )}
    </Card>
  )
}

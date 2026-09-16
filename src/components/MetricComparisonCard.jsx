import React from 'react'
import Card from './Card'
import DeltaBadge from './DeltaBadge'
import EmptyState from './EmptyState'
import {
  computeBucketComparisons,
  computeFYSeries,
  computeBucketFYSeries,
  computeNettedBucketComparisons,
  computeNettedBucketFYSeries,
  kpiDeltas
} from '../lib/comparisons'
import { exactCardCount } from '../lib/aggregate'
import { fyOf } from '../lib/constants'
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
// headline KPI sums) and `rowsAllMonths` (only for the MoM/YoY delta
// lookups) — see comparisons.js#computeBucketComparisons's doc comment for
// the bug this split fixes (the headline total used to silently collapse
// to just the latest month whenever Month was left unrestricted). Also
// visually restyled to match the app's established KPI language — colored
// left-border accent + text-3xl serif value, same as Kpi.jsx — rather than
// a plain unaccented number.
//
// 2026-08-25 bug fix: despite the name, `rowsAllMonths` must have BOTH the
// Month *and* FY restrictions lifted (activationRowsForComparison/
// redemptionRowsForComparison from FilterContext.jsx, not
// activationRowsAllMonths/redemptionRowsAllMonths, which only lift Month) —
// a specific FY selection used to zero out any delta whose prior-year
// window fell in a different FY, since the old Month-only pool never had
// that other FY's rows to find. The prop kept its original name rather
// than being renamed dashboard-wide for a one-word precision gain; every
// caller now passes the correctly-unrestricted pool as its value.
// 2026-08-19: `nestedBreakdowns` — an optional `{ [parentBucketKey]:
// { buckets, cancelPredicate? } }` map — lets one top-level bucket (e.g.
// "Redemption by Source"'s Cinema row) expand into its own indented
// sub-rows (e.g. Box Office vs. F&B) instead of needing a second,
// overlapping top-level card. Reuses the exact same computeBucketComparisons
// /computeNettedBucketComparisons/computeBucketFYSeries/
// computeNettedBucketFYSeries functions the top-level table already calls —
// just re-run against `rows`/`rowsAllMonths`/`rowsAllFY` pre-filtered to the
// parent bucket's own predicate first, so the child buckets always sum
// exactly to their parent row's own amount, by the same construction
// guarantee the top-level table already has (a netted child set sums to
// whatever pool it's given; here that pool is the parent's own rows, not
// the whole card's). Only one level of nesting is supported — this isn't a
// general tree, just enough to fold two overlapping "by X" cards into one.
function computeNestedBreakdown(nested, parentRows, parentRowsAllMonths, parentRowsAllFY, amountField, countField, comparisonMonths, fys, selectedMonths) {
  const current = nested.cancelPredicate
    ? computeNettedBucketComparisons(
        parentRows,
        parentRowsAllMonths,
        nested.buckets,
        nested.cancelPredicate,
        amountField,
        countField,
        comparisonMonths,
        selectedMonths
      )
    : computeBucketComparisons(parentRows, parentRowsAllMonths, nested.buckets, amountField, countField, comparisonMonths, selectedMonths)
  const byYear = nested.cancelPredicate
    ? computeNettedBucketFYSeries(parentRowsAllFY, nested.buckets, nested.cancelPredicate, amountField, countField, fys)
    : computeBucketFYSeries(parentRowsAllFY, nested.buckets, amountField, countField, fys)
  return { current, byYear }
}

// 2026-08-29 — `activePreset`/`selectedMonths`: the MTD/QTD/YTD preset
// control lives ONCE at the page level (Summary.jsx's own single
// usePresetWindow() call), never per-card — every instance of this
// component just receives the resulting `activePreset`/`selectedMonths` as
// props and feeds them straight into kpiDeltas()/computeBucketComparisons()
// below, so all 13+ cards on the page stay in lockstep with the one shared
// selection by construction, not by each card independently reading
// useFilters() and risking drift.
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
  nestedBreakdowns,
  accent = 'navy',
  activePreset,
  selectedMonths,
  exactCountRows,
  exactCountRowsAllFY
}) {
  const accentClasses = ACCENTS[accent] || { border: 'border-l-navy', text: 'text-navy' }
  const [totalRow] = computeBucketComparisons(rows, rowsAllMonths, TOTAL_BUCKET, amountField, countField, comparisonMonths, selectedMonths)
  const total = totalRow || { amount: 0, count: 0, mom: null, qoq: null, yoy: null, customPct: null }
  // 2026-08-14 fix: some bucket sets (Denomination, Card Type at the time)
  // don't partition every row — a row with Denom/CardType='N/A' (a real,
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
  //
  // 2026-08-17: Activation's own Card Type joined the "complete partition"
  // group above — a data-level fix reclassified Cancel Activate rows from
  // CardType='N/A' to their real Digital/Physical value, so
  // ACTIVATION_CUBE-backed CardType buckets now always sum exactly to the
  // headline total and "Other" no longer renders for that card. Nothing
  // changed here to make that happen — the zero-amount filter above
  // already handled it once the underlying data stopped leaking.
  //
  // 2026-08-18: same fix, same mechanism, extended to Denomination —
  // another data-level refresh reclassified Cancel Activate rows away from
  // Denom='N/A' into their own real bucket (plus closed a fractional-amount
  // boundary gap between adjacent buckets), so "Activation by
  // Denomination" also no longer renders an "Other" row (confirmed: the 11
  // DENOM_ORDER buckets now sum to the headline total with zero leftover).
  // "Redemption by Denomination" still legitimately shows "Other" —
  // Cancel *Redeem* rows on the redemption cube still carry a real
  // Denom='N/A' (confirmed: ~1,103 rows, -₹146.3L), a different, untouched
  // situation the request creating this fix explicitly said not to touch.
  // Both cards share the exact same DENOM_BUCKETS predicate array
  // (Summary.jsx) — which one shows "Other" is entirely a function of
  // which `rows` pool (activationRows vs. redemptionRows) each card is
  // given, not any per-card special-casing here.
  // 2026-08-15: `cancelPredicate` marks a bucket set where a category-less
  // subset of rows (Cancel Redeem transactions) must be netted
  // proportionally into the real buckets instead of getting its own
  // "Other"/N/A row — see lib/aggregate.js#netBucketsProportionally.
  // "Redemption by Card Type" passes this (and, nested, "Redemption by
  // Source"'s Cinema→Box Office/F&B breakdown below); every other bucketed
  // card keeps the plain computeBucketComparisons path with its synthetic
  // "Other" bucket (Region/Source-itself/Head-elsewhere are already
  // complete partitions with no such leak; Activation's own "Other" is a
  // real correction-row bucket, not Cancellation).
  const bucketsWithOther = buckets && !cancelPredicate ? [...buckets, { key: 'Other', predicate: (r) => !buckets.some((b) => b.predicate(r)) }] : null
  const bucketRows = cancelPredicate
    ? computeNettedBucketComparisons(rows, rowsAllMonths, buckets, cancelPredicate, amountField, countField, comparisonMonths, selectedMonths)
    : bucketsWithOther
      ? computeBucketComparisons(rows, rowsAllMonths, bucketsWithOther, amountField, countField, comparisonMonths, selectedMonths)
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

  // See computeNestedBreakdown()'s own doc comment above. `nested` here is
  // keyed by parent bucket key (e.g. 'Cinema'), each value `{ current,
  // byYear }` shaped exactly like `bucketRows`/`bucketFYRows` themselves so
  // the render below can treat parent and child rows uniformly.
  const nestedByParentKey = {}
  if (nestedBreakdowns && buckets) {
    const fys = fySeries.map((f) => f.fy)
    for (const [parentKey, nested] of Object.entries(nestedBreakdowns)) {
      const parentBucket = buckets.find((b) => b.key === parentKey)
      if (!parentBucket) continue
      nestedByParentKey[parentKey] = computeNestedBreakdown(
        nested,
        rows.filter(parentBucket.predicate),
        rowsAllMonths.filter(parentBucket.predicate),
        rowsAllFY.filter(parentBucket.predicate),
        amountField,
        countField,
        comparisonMonths,
        fys,
        selectedMonths
      )
    }
  }

  // 2026-09-16 — optional exact-count override, see the 2026-09-16
  // CLAUDE.md entry. `exactCountRows`/`exactCountRowsAllFY` are a
  // row-level pool (`redemption_rowlevel.parquet` via FilterContext.jsx),
  // already filtered the same way `rows`/`rowsAllFY` are — passed only by
  // redemption-side cards (Summary.jsx; activation-side cards leave both
  // undefined and every count below stays exactly what it already was).
  // Every bucket predicate here (Region_Clean/Head/CardType/Denom/
  // RedemptionModeFinal) is field-name generic, so the SAME predicate
  // functions already built for the cube-level buckets work unmodified
  // against row-level rows too — no second bucket definition needed.
  // `exactCardCount()` always excludes Head==='Cancellation' rows on its
  // own, so this needs no netting/attribution logic the way the amount
  // side does — "how many distinct cards have a real row in this bucket"
  // is well-defined without it, unlike an amount, which does need
  // cancellations folded in somewhere.
  if (exactCountRows) {
    total.count = exactCardCount(exactCountRows)
    const bucketList = bucketsWithOther || buckets || []
    for (const b of bucketRows) {
      const bucket = bucketList.find((bb) => bb.key === b.key)
      if (bucket) b.count = exactCardCount(exactCountRows.filter(bucket.predicate))
    }
  }
  if (exactCountRowsAllFY) {
    const bucketList = bucketsWithOther || buckets || []
    for (const br of bucketFYRows) {
      const bucket = bucketList.find((bb) => bb.key === br.key)
      if (!bucket) continue
      for (const fy of Object.keys(br.byFY)) {
        br.byFY[fy].count = exactCardCount(exactCountRowsAllFY.filter((r) => fyOf(r.YearMonth) === fy && bucket.predicate(r)))
      }
    }
  }
  if ((exactCountRows || exactCountRowsAllFY) && nestedBreakdowns && buckets) {
    for (const [parentKey, nested] of Object.entries(nestedBreakdowns)) {
      const parentBucket = buckets.find((b) => b.key === parentKey)
      const nb = nestedByParentKey[parentKey]
      if (!parentBucket || !nb) continue
      if (exactCountRows) {
        const parentExactRows = exactCountRows.filter(parentBucket.predicate)
        for (const cr of nb.current) {
          const cb = nested.buckets.find((bb) => bb.key === cr.key)
          if (cb) cr.count = exactCardCount(parentExactRows.filter(cb.predicate))
        }
      }
      if (exactCountRowsAllFY) {
        const parentExactRowsAllFY = exactCountRowsAllFY.filter(parentBucket.predicate)
        for (const br of nb.byYear) {
          const cb = nested.buckets.find((bb) => bb.key === br.key)
          if (!cb) continue
          for (const fy of Object.keys(br.byFY)) {
            br.byFY[fy].count = exactCardCount(parentExactRowsAllFY.filter((r) => fyOf(r.YearMonth) === fy && cb.predicate(r)))
          }
        }
      }
    }
  }

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
              <div className="text-xs font-medium text-warmgray-muted mt-1 count-ghost">
                {fmtNumber(total.count)} {unit}
              </div>
            </div>
            {/* 2026-08-29: collapsed from 2 always-shown badges (MoM+YoY) to
                the single preset-aware badge every other page's KPI ribbon
                now renders via kpiDeltas() — `activePreset`/`selectedMonths`
                come from Summary.jsx's own single, page-level
                usePresetWindow() call (passed down as props), not a
                per-card control of this component's own. */}
            <div className="flex gap-1.5 pt-1">
              {kpiDeltas(activePreset, total, total.customPct).map((d) => (
                <DeltaBadge key={d.label || 'delta'} pct={d.pct} label={d.label} />
              ))}
            </div>
          </div>

          {buckets && bucketRows.length > 0 && (
            <div className="border-t border-warmgray-border pt-3 mb-4 overflow-x-auto">
              <table className="w-full text-xs min-w-[280px] border-separate border-spacing-0">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-warmgray-muted">
                    <th className="text-left font-semibold pb-1.5">{title.replace(/^(Activation|Redemption) by /, '')}</th>
                    <th className="text-right font-semibold pb-1.5">Amount</th>
                    <th className="text-right font-semibold pb-1.5">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {bucketRows.map((r) => (
                    <React.Fragment key={r.key}>
                      <tr className="border-t border-warmgray-border/60 hover:bg-cream/60 transition-colors">
                        <td className="py-1.5 text-navy font-medium whitespace-nowrap">{bucketLabelFn ? bucketLabelFn(r.key) : r.key}</td>
                        <td className="py-1.5 text-right text-navy tabular-nums whitespace-nowrap">
                          {fmtLacs(r.amount)}
                          <span className="block font-normal text-[10px] text-warmgray-muted count-ghost">
                            ({fmtNumber(r.count)} {unit})
                          </span>
                        </td>
                        <td className="py-1.5 text-right">
                          <DeltaBadge pct={kpiDeltas(activePreset, r, r.customPct)[0].pct} label="" />
                        </td>
                      </tr>
                      {nestedByParentKey[r.key]?.current.map((nr) => (
                        <tr key={`${r.key}-${nr.key}`} className="border-t border-warmgray-border/30 hover:bg-cream/40 transition-colors">
                          <td className="py-1 pl-4 text-warmgray-muted font-normal whitespace-nowrap text-[11px]">↳ {nr.key}</td>
                          <td className="py-1 text-right text-warmgray-muted tabular-nums whitespace-nowrap text-[11px]">
                            {fmtLacs(nr.amount)}
                            <span className="block font-normal text-[9px] text-warmgray-muted count-ghost">
                              ({fmtNumber(nr.count)} {unit})
                            </span>
                          </td>
                          <td className="py-1 text-right">
                            <DeltaBadge pct={kpiDeltas(activePreset, nr, nr.customPct)[0].pct} label="" />
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              {nestedBreakdowns && (
                // 2026-09-16: this card's nested breakdown(s) use
                // netBucketsProportionally (proportional-by-gross-share) —
                // a different, also-legitimate heuristic from the one
                // Overview's flow diagram uses for the same Box Office/F&B
                // split (a Region+Month winner-map). Both sum to the same
                // parent total; only the split between the two children
                // differs, by ~₹48L each way on the current data. Added
                // after the divergence was found and confirmed with the
                // user rather than silently reconciled to match Overview.
                <p className="text-[11px] text-warmgray-muted italic mt-2">
                  Nested rows above (↳) net Cancel Redeem in proportionally,
                  by each row's own share of gross — Overview's flow
                  diagram splits the same ambiguous Box Office/F&B
                  attribution differently (a Region+Month winner-take-all),
                  so the two won't match to the rupee. Both reconcile to
                  their own parent row exactly.
                </p>
              )}
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
                    <React.Fragment key={r.key}>
                      <tr className="border-t border-warmgray-border/60 hover:bg-cream/60 transition-colors">
                        <td className="py-1.5 text-navy font-medium whitespace-nowrap">{bucketLabelFn ? bucketLabelFn(r.key) : r.key}</td>
                        {fySeries.map((f) => (
                          <td key={f.fy} className="py-1.5 text-right text-navy tabular-nums whitespace-nowrap">
                            {fmtLacs(r.byFY[f.fy].amount)}
                            <span className="block font-normal text-[10px] text-warmgray-muted count-ghost">
                              ({fmtNumber(r.byFY[f.fy].count)} {unit})
                            </span>
                          </td>
                        ))}
                      </tr>
                      {nestedByParentKey[r.key]?.byYear.map((nr) => (
                        <tr key={`${r.key}-${nr.key}`} className="border-t border-warmgray-border/30 hover:bg-cream/40 transition-colors">
                          <td className="py-1 pl-4 text-warmgray-muted font-normal whitespace-nowrap text-[11px]">↳ {nr.key}</td>
                          {fySeries.map((f) => (
                            <td key={f.fy} className="py-1 text-right text-warmgray-muted tabular-nums whitespace-nowrap text-[11px]">
                              {fmtLacs(nr.byFY[f.fy].amount)}
                              <span className="block font-normal text-[9px] text-warmgray-muted count-ghost">
                                ({fmtNumber(nr.byFY[f.fy].count)} {unit})
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                  <tr className="border-t border-warmgray-border font-semibold">
                    <td className="py-1.5 text-navy">Total</td>
                    {fySeries.map((f) => (
                      <td key={f.fy} className="py-1.5 text-right text-navy tabular-nums whitespace-nowrap">
                        {fmtLacs(f.amount)}
                        <span className="block font-normal text-[10px] text-warmgray-muted count-ghost">
                          ({fmtNumber(f.count)} {unit})
                        </span>
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
                      <div className="text-[10px] text-warmgray-muted count-ghost">
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

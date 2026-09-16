import React, { useMemo, useEffect } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList } from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { sumBy, groupSum, topNWithOther, netHeadRows, exactCardCount, exactCardCountByBucket } from '../lib/aggregate'
import { computeComparisons, computeCustomWindowComparison, usePresetWindow, kpiDeltas } from '../lib/comparisons'
import { orderBy, REGION_ORDER, WEEKDAY_ORDER, DENOM_ORDER, regionLabel } from '../lib/constants'
import { COLORS, REGION_COLORS, categoricalColor } from '../lib/theme'
import { fmtLacs, fmtRupees, fmtNumber, fmtPct, fmtLacsAxis } from '../lib/format'
import Card from '../components/Card'
import Kpi from '../components/Kpi'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'
import { AmountLabel, HorizontalAmountLabel } from '../components/ChartLabels'

export default function RedemptionFnb() {
  const {
    redemptionRows,
    redemptionRowsForComparison,
    comparisonMonths,
    redemptionRowLevelFiltered,
    redemptionRowLevelReady,
    loadRedemptionRowLevel,
    heroProductsTop15,
    loadHeroProductsRowLevel,
    heroProductsLoading,
    heroProductsError
  } = useFilters()

  // 2026-09-16: same lazy-load-on-mount pattern as every other page's own
  // row-level pool — see the 2026-09-16 CLAUDE.md entry for the full audit.
  useEffect(() => {
    loadRedemptionRowLevel()
  }, [loadRedemptionRowLevel])
  // 2026-09-17: same lazy-load-on-mount pattern, for heroProductsCube.parquet
  // — see FilterContext.jsx's "Hero Products row-level cube" section. Only
  // this page ever calls it.
  useEffect(() => {
    loadHeroProductsRowLevel()
  }, [loadHeroProductsRowLevel])
  const fnbRowLevel = useMemo(() => redemptionRowLevelFiltered.filter((r) => r.Head === 'F&B'), [redemptionRowLevelFiltered])

  // 2026-08-29: MTD/QTD(Q1-Q4 dropdown)/YTD preset control, via the same
  // shared usePresetWindow() hook every other page's KPI ribbon now uses —
  // no page-local reimplementation of the anchor/window logic.
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

  // 2026-08-06 fix: this page's own "F&B Redemption" KPI (and every chart
  // derived from it below) used to be gross (Head='F&B' rows only, no
  // cancellation involvement) — a different, smaller number than
  // Overview.jsx's flow diagram, which nets Cancel Redeem into F&B
  // (₹1,748.29L gross vs. ₹1,432.74L net, same nominal metric, two
  // different figures on two pages). Rewired onto the same shared
  // netHeadRows() pool Overview.jsx and RedemptionBoxOffice.jsx use — see
  // lib/aggregate.js and the 2026-08-06 CLAUDE.md entry.
  //
  // 2026-08-12 cross-page audit: no longer computes its own winner map —
  // see RedemptionBoxOffice.jsx's matching comment (identical reasoning,
  // this page had the exact same duplicated
  // `physicalCancelWinnerMap(redemptionRowsAllMonths)` call site).
  const fnbRows = useMemo(() => redemptionRows.filter((r) => r.Head === 'F&B'), [redemptionRows])
  const netFnbRows = useMemo(() => netHeadRows(redemptionRows, 'F&B'), [redemptionRows])
  // 2026-08-25 bug fix: was netHeadRows(redemptionRowsAllMonths, ...) —
  // Month-unrestricted but still FY-restricted, so a specific FY selection
  // zeroed out any delta whose prior-year window fell in a different FY.
  // redemptionRowsForComparison lifts both restrictions (see
  // FilterContext.jsx's own doc comment).
  const netFnbRowsForComparison = useMemo(() => netHeadRows(redemptionRowsForComparison, 'F&B'), [redemptionRowsForComparison])
  const total = sumBy(netFnbRows, 'RedemptionAmount')
  // 2026-08-20: kept distinct from the new card-based count below —
  // RedemptionCount is a transaction count, needed as-is for "Avg per
  // Redemption" (revenue per redemption *event*, not per card). Only the
  // "X redemptions" display line switches to the card-based measure.
  const totalCount = sumBy(netFnbRows, 'RedemptionCount')
  const totalCardCount = redemptionRowLevelReady ? exactCardCount(fnbRowLevel) : sumBy(netFnbRows, 'UniqueCardCount')
  const deltas = useMemo(
    () => computeComparisons(netFnbRowsForComparison, 'RedemptionAmount', comparisonMonths),
    [netFnbRowsForComparison, comparisonMonths]
  )
  // 2026-08-29: "custom window" (no MTD/QTD/YTD preset active) badge — same
  // netFnbRowsForComparison/digitalRowsForComparison pools the anchor-based
  // deltas above already read, just summed over the literal `selectedMonths`
  // window instead of an anchor-derived sub-window.
  const totalCustomPct = useMemo(
    () => computeCustomWindowComparison(netFnbRowsForComparison, 'RedemptionAmount', selectedMonths),
    [netFnbRowsForComparison, selectedMonths]
  )
  const digitalRows = netFnbRows.filter((r) => r.CardType === 'Digital')
  const digitalAmt = sumBy(digitalRows, 'RedemptionAmount')
  const digitalCardCount = redemptionRowLevelReady
    ? exactCardCount(fnbRowLevel.filter((r) => r.CardType === 'Digital'))
    : sumBy(digitalRows, 'UniqueCardCount')
  const digitalRowsForComparison = useMemo(
    () => netFnbRowsForComparison.filter((r) => r.CardType === 'Digital'),
    [netFnbRowsForComparison]
  )
  const digitalDeltas = useMemo(
    () => computeComparisons(digitalRowsForComparison, 'RedemptionAmount', comparisonMonths),
    [digitalRowsForComparison, comparisonMonths]
  )
  const digitalCustomPct = useMemo(
    () => computeCustomWindowComparison(digitalRowsForComparison, 'RedemptionAmount', selectedMonths),
    [digitalRowsForComparison, selectedMonths]
  )

  // "F&B Redemption" KPI's own "% of..." sub-line — its share of all
  // redemption city-wide (every head, net), same cross-total framing
  // "Total Redemption (net)"'s own sub-line already uses on Overview.jsx,
  // and the same fix just applied to "Box Office Redemption".
  const grandRedemptionTotal = sumBy(redemptionRows, 'RedemptionAmount')
  const totalPct = grandRedemptionTotal > 0 ? (total / grandRedemptionTotal) * 100 : NaN

  const byRegion = useMemo(() => {
    const g = groupSum(netFnbRows, 'Region_Clean', ['RedemptionAmount', 'UniqueCardCount'])
    if (redemptionRowLevelReady) {
      const exact = exactCardCountByBucket(
        fnbRowLevel,
        g.map((r) => ({ key: r.key, predicate: (row) => row.Region_Clean === r.key }))
      )
      for (const r of g) r.UniqueCardCount = exact.find((e) => e.key === r.key)?.count ?? r.UniqueCardCount
    }
    return orderBy(g.map((r) => r.key), REGION_ORDER).map((k) => g.find((r) => r.key === k))
  }, [netFnbRows, fnbRowLevel, redemptionRowLevelReady])

  // 2026-08-14 fix (superseded 2026-09-17, kept for history): used to
  // pre-filter out Category='N/A' rows before grouping — same root cause
  // as RedemptionBoxOffice.jsx's matching Format-chart fix, just on
  // Category instead: every Cancel Redeem row netHeadRows() attributes to
  // F&B carries no Category of its own ('N/A'), so excluding it dropped
  // the whole netting correction and inflated this chart's total to the
  // gross F&B figure (₹1,748.29L) instead of the net total the KPI above
  // it shows (₹1,432.74L). The 2026-08-14 fix stopped pre-filtering and
  // let topNWithOther() fold the large negative 'N/A' bucket into "Other"
  // naturally — correct on the total, but it meant the chart could show
  // two separate bars both labeled "Other": the real raw Category='Other'
  // value (its own top-10 entry) and topNWithOther's synthetic overflow
  // bucket (also keyed 'Other', containing the N/A cancellation
  // correction folded in with whatever other long-tail categories didn't
  // make the top 10) — confusing, even though both individually landed on
  // the correct reserved gray color.
  //
  // 2026-09-17: N/A is now split out BEFORE grouping/topNWithOther, not
  // folded into the tail — confirmed dashboard-wide that Category='N/A'
  // on this cube is always the attributed Cancel Redeem correction (8,839
  // such rows, all Head='Cancellation', never a real F&B row), so this is
  // a real, always-a-cancellation bucket, not a genuine long-tail
  // category getting special-cased. The real Category='Other' classifier
  // value is completely unaffected — it's grouped/topN'd exactly as
  // before, just without a same-labeled synthetic sibling ever colliding
  // with it. The N/A group is appended as its own explicit, always-last
  // 'Cancellations' row (only when non-empty) instead — same "shown
  // separately, not silently folded into a differently-meaning bucket"
  // treatment this app already gives Cancel Redeem everywhere else
  // (Redemption Heads Breakdown, the dedicated /cancel-redeem page, etc.).
  // Total (sum of all bars) is unchanged by construction: every row still
  // lands in exactly one bucket (a real category, the synthetic "Other"
  // overflow, or "Cancellations"), just partitioned differently.
  const byCategory = useMemo(() => {
    const cancelRows = netFnbRows.filter((r) => r.Category === 'N/A')
    const realRows = netFnbRows.filter((r) => r.Category !== 'N/A')
    const g = groupSum(realRows, 'Category', ['RedemptionAmount', 'UniqueCardCount'])
    if (redemptionRowLevelReady) {
      const exact = exactCardCountByBucket(
        fnbRowLevel,
        g.map((r) => ({ key: r.key, predicate: (row) => row.Category === r.key }))
      )
      for (const r of g) r.UniqueCardCount = exact.find((e) => e.key === r.key)?.count ?? r.UniqueCardCount
    }
    const result = topNWithOther(g, 10, 'key', 'RedemptionAmount')
    if (cancelRows.length > 0) {
      result.push({
        key: 'Cancellations',
        RedemptionAmount: sumBy(cancelRows, 'RedemptionAmount'),
        UniqueCardCount: sumBy(cancelRows, 'UniqueCardCount')
      })
    }
    return result
  }, [netFnbRows, fnbRowLevel, redemptionRowLevelReady])

  // Chart-parity pass (2026-08-12): this page was the one of the three
  // missing a weekday breakdown — Activation.jsx has "Week-slot Activation
  // Trend", RedemptionBoxOffice.jsx has the matching "Week-slot Redemption
  // Trend" (renamed same day from "Weekday Trend"). Same shape/colors as
  // both.
  const byWeekday = useMemo(() => {
    const g = groupSum(netFnbRows, 'Weekday', ['RedemptionAmount', 'UniqueCardCount'])
    if (redemptionRowLevelReady) {
      const exact = exactCardCountByBucket(
        fnbRowLevel,
        g.map((r) => ({ key: r.key, predicate: (row) => row.Weekday === r.key }))
      )
      for (const r of g) r.UniqueCardCount = exact.find((e) => e.key === r.key)?.count ?? r.UniqueCardCount
    }
    return orderBy(g.map((r) => r.key), WEEKDAY_ORDER).map((k) => g.find((r) => r.key === k))
  }, [netFnbRows, fnbRowLevel, redemptionRowLevelReady])

  // Same DENOM_ORDER bucket list as Activation.jsx/RedemptionBoxOffice.jsx's
  // "by Denomination" charts and Overview's.
  //
  // 2026-08-14 fix: same root cause as byCategory above — fold non-listed
  // Denom values (including the Cancel Redeem correction, which used to
  // always be 'N/A') into an explicit "Other" bucket instead of dropping
  // them, so this chart's total reconciles with the KPI above it.
  //
  // 2026-08-19 data refresh: 'N/A'/'Other' Denom values are gone from the
  // redemption cube entirely — Cancel Redeem rows now carry a real
  // denomination or the honest 'Unknown (pre-existing)' 12th bucket (now
  // part of DENOM_ORDER itself), so "Other" no longer renders here. The
  // fallback below stays as a live safety net, not dead code.
  const byDenomination = useMemo(() => {
    const g = groupSum(netFnbRows, 'Denom', ['RedemptionAmount', 'UniqueCardCount'])
    const named = DENOM_ORDER.map((d) => g.find((r) => r.key === d) || { key: d, RedemptionAmount: 0, UniqueCardCount: 0 })
    const otherRows = netFnbRows.filter((r) => !DENOM_ORDER.includes(r.Denom))
    const result = otherRows.length === 0 ? named : [...named, { key: 'Other', RedemptionAmount: sumBy(otherRows, 'RedemptionAmount'), UniqueCardCount: sumBy(otherRows, 'UniqueCardCount') }]
    if (redemptionRowLevelReady) {
      const exact = exactCardCountByBucket(
        fnbRowLevel,
        result.map((r) => (r.key === 'Other' ? { key: 'Other', predicate: (row) => !DENOM_ORDER.includes(row.Denom) } : { key: r.key, predicate: (row) => row.Denom === r.key }))
      )
      for (const r of result) r.UniqueCardCount = exact.find((e) => e.key === r.key)?.count ?? r.UniqueCardCount
    }
    return result
  }, [netFnbRows, fnbRowLevel, redemptionRowLevelReady])

  // 2026-09-17: heroProductsTop15 (context, from heroProductsCube.parquet)
  // is already grouped/summed/sorted/sliced to the top 15 — see
  // FilterContext.jsx's own doc comment. Replaces the old static
  // heroProducts.json top-15, which never moved with the filters.
  const heroSorted = heroProductsTop15
  const heroMax = heroSorted[0]?.amount || 1
  const heroProductsEmptyMessage = heroProductsError
    ? "Couldn't load Hero Products data."
    : heroProductsLoading
    ? 'Loading products…'
    : undefined

  return (
    <div className="flex flex-col gap-6">
      {/* 2026-08-29: MTD/QTD(Q1-Q4 dropdown)/YTD control row + single
          top-left comparison-date line — copied verbatim from Overview.jsx/
          CardJourney.jsx/Activation.jsx/RedemptionBoxOffice.jsx's own
          render, not a re-styled approximation. */}
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
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Kpi
          label="F&B Redemption"
          value={fmtLacs(total)}
          sub={`${fmtPct(totalPct, 0)} of total redemption`}
          subCount={`${fmtNumber(totalCardCount)} cards`}
          accent="teal"
          deltas={kpiDeltas(activePreset, deltas, totalCustomPct)}
        />
        <Kpi
          label="Digital Card Redemption"
          value={fmtLacs(digitalAmt)}
          sub={fmtPct(total ? (digitalAmt / total) * 100 : 0)}
          subCount={`${fmtNumber(digitalCardCount)} cards`}
          accent="blue"
          deltas={kpiDeltas(activePreset, digitalDeltas, digitalCustomPct)}
        />
        <Kpi label="Avg per Redemption" value={totalCount ? fmtRupees(total / totalCount) : '—'} accent="navy" />
      </div>

      <Card title="F&B Redemption by Region">
        {byRegion.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byRegion} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
              {/* 2026-08-19: interval={0}/angle/height added preemptively,
                  same as Box Office/Cancel Redeem's identical charts — this
                  one didn't reproduce the CENTRAL-tick-drop bug in testing
                  at 800/1024/1440px, but relies on the same
                  width-dependent Recharts auto-skip behavior that did break
                  on those two, so it's fixed the same way rather than left
                  to get lucky at untested widths. */}
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
                content={<ChartTooltip countField="UniqueCardCount" countUnit="cards" />}
                labelFormatter={regionLabel}
                cursor={{ fill: 'rgba(27,36,48,0.04)' }}
              />
              <Bar dataKey="RedemptionAmount" name="Redemption" radius={[4, 4, 0, 0]} maxBarSize={56}>
                <LabelList dataKey="RedemptionAmount" content={AmountLabel} />
                {byRegion.map((r) => (
                  <Cell key={r.key} fill={REGION_COLORS[r.key] || COLORS.teal} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="F&B Redemption by Category">
        {byCategory.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={byCategory} layout="vertical" margin={{ top: 8, right: 40, left: 8, bottom: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                axisLine={false}
                tickLine={false}
                tickFormatter={fmtLacsAxis}
                label={{ value: '₹ in Lakhs', position: 'insideBottom', offset: -8, style: { fontSize: 11, fill: COLORS.inkMuted } }}
              />
              <YAxis dataKey="key" type="category" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={110} />
              <Tooltip content={<ChartTooltip countField="UniqueCardCount" countUnit="cards" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
              <Bar dataKey="RedemptionAmount" name="Redemption" radius={[0, 4, 4, 0]} maxBarSize={22}>
                <LabelList dataKey="RedemptionAmount" content={HorizontalAmountLabel} />
                {byCategory.map((r, i) => (
                  <Cell key={r.key} fill={r.key === 'Cancellations' ? COLORS.warning : categoricalColor(i, r.key === 'Other')} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Week-slot Redemption Trend">
        {byWeekday.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byWeekday} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
              <XAxis dataKey="key" tick={{ fontSize: 10, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis
                tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                axisLine={false}
                tickLine={false}
                width={64}
                tickFormatter={fmtLacsAxis}
                label={{ value: '₹ in Lakhs', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
              />
              <Tooltip content={<ChartTooltip countField="UniqueCardCount" countUnit="cards" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
              <Bar dataKey="RedemptionAmount" name="Redemption" radius={[4, 4, 0, 0]} maxBarSize={40}>
                <LabelList dataKey="RedemptionAmount" content={AmountLabel} />
                {byWeekday.map((r, i) => (
                  <Cell key={r.key} fill={categoricalColor(i)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="F&B Redemption by Denomination">
        {byDenomination.every((d) => d.RedemptionAmount === 0) ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byDenomination} margin={{ top: 20, right: 8, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
              <XAxis
                dataKey="key"
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
              <Tooltip content={<ChartTooltip countField="UniqueCardCount" countUnit="cards" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
              <Bar dataKey="RedemptionAmount" name="Redemption" radius={[4, 4, 0, 0]} maxBarSize={44}>
                <LabelList dataKey="RedemptionAmount" content={AmountLabel} />
                {byDenomination.map((r, i) => (
                  <Cell key={r.key} fill={categoricalColor(i, r.key === 'Other')} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Deliberately still no "F&B Redemption by Source" chart (2026-08-12
          chart-parity pass considered and rejected re-adding it): Head='F&B'
          rows are 100% RedemptionModeFinal='Physical' (checked directly,
          same fact on record since the chart was first removed) and, unlike
          Box Office, there's no second head F&B can combine with to give
          Online real volume (nothing is ever bought via F&B through PVR Inox
          Online) — so this chart would always be exactly 100% Cinema / 0%
          Online, conveying no information. Treated as a "genuinely doesn't
          make sense here" exception, same category as Format/Category not
          existing on the other two pages, not an oversight. */}

      <Card title="Hero Products">
        {heroSorted.length === 0 ? (
          <EmptyState message={heroProductsEmptyMessage} />
        ) : (
          <div className="flex flex-col gap-2">
            {heroSorted.map((p, i) => (
              <div key={p.name} className="flex items-center gap-3">
                <span className="text-xs text-warmgray-muted w-5 text-right tabular-nums">{i + 1}</span>
                <span className="text-xs text-navy flex-1 truncate" title={p.name}>
                  {p.name}
                </span>
                <div className="flex-[2] bg-warmgray-border/40 rounded-full h-2.5 overflow-hidden">
                  <div className="h-full bg-gold rounded-full" style={{ width: `${(p.amount / heroMax) * 100}%` }} />
                </div>
                <span className="text-xs font-semibold text-navy tabular-nums w-20 text-right">₹{Math.round(p.amount)} L</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

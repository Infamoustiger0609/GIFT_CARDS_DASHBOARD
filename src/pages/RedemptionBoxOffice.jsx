import React, { useMemo, useEffect } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, LabelList } from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { sumBy, groupSum, topNWithOther, netHeadRows, exactCardCount, exactCardCountByBucket } from '../lib/aggregate'
import { computeComparisons, computeCustomWindowComparison, usePresetWindow, kpiDeltas } from '../lib/comparisons'
import { groupByRedemptionMode, REDEMPTION_MODES } from '../lib/redemptionMode'
import { orderBy, REGION_ORDER, WEEKDAY_ORDER, DENOM_ORDER, regionLabel } from '../lib/constants'
import { COLORS, REGION_COLORS, CARD_TYPE_COLORS, categoricalColor } from '../lib/theme'
import { fmtLacs, fmtRupees, fmtNumber, fmtPct, fmtLacsAxis } from '../lib/format'
import Card from '../components/Card'
import Kpi from '../components/Kpi'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'
import { AmountLabel, HorizontalAmountLabel, stackTotalLabel } from '../components/ChartLabels'

export default function RedemptionBoxOffice() {
  const {
    redemptionRows,
    redemptionRowsForComparison,
    comparisonMonths,
    redemptionRowLevelFiltered,
    redemptionRowLevelReady,
    loadRedemptionRowLevel
  } = useFilters()

  // 2026-09-16: same lazy-load-on-mount pattern as CardJourney.jsx/
  // Overview.jsx's own cohort/row-level cube — every count on this page
  // switches from a per-row UniqueCardCount sum (inflation-prone, see the
  // 2026-09-16 CLAUDE.md entry) to an exact COUNT(DISTINCT CardNumber) once
  // this file has loaded, no fallback gate needed (full filter parity).
  useEffect(() => {
    loadRedemptionRowLevel()
  }, [loadRedemptionRowLevel])
  // Box Office's own row-level pool, scoped the same way netBoxOfficeRows
  // is scoped (Head='Box Office'), read from the exact-count source
  // instead of the netted cube-level pool — no netting/attribution needed
  // for a count (see exactCardCount()'s own doc comment).
  const boxOfficeRowLevel = useMemo(() => redemptionRowLevelFiltered.filter((r) => r.Head === 'Box Office'), [redemptionRowLevelFiltered])

  // 2026-08-29: MTD/QTD(Q1-Q4 dropdown)/YTD preset control, via the same
  // shared usePresetWindow() hook Overview.jsx/CardJourney.jsx/Activation.jsx
  // already use — no page-local reimplementation of the anchor/window logic.
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

  // 2026-08-06 fix: this page's own "Box Office Redemption" KPI (and every
  // chart derived from it below) used to be gross (Head='Box Office' rows
  // only, no cancellation involvement) — a different, smaller number than
  // Overview.jsx's flow diagram, which nets Cancel Redeem into Box Office
  // (₹1,119.23L gross vs. ₹1,023.50L net, same nominal metric, two
  // different figures on two pages). Rewired onto the same shared
  // netHeadRows() pool Overview.jsx uses — see lib/aggregate.js and the
  // 2026-08-06 CLAUDE.md entry.
  //
  // 2026-08-12 cross-page audit: no longer computes its own winner map —
  // netHeadRows() self-derives one from whatever rows it's given when none
  // is passed, and the per-Region+Month winner decision is provably
  // invariant to whether it's derived from `redemptionRows` or the broader
  // `redemptionRowsAllMonths` (removing the Month restriction only adds
  // keys for other months, never changes the rows behind a key already
  // present). This page and RedemptionFnb.jsx were each independently
  // computing `physicalCancelWinnerMap(redemptionRowsAllMonths)` — a real
  // instance of the exact duplicated-aggregation-logic pattern flagged in
  // the 2026-08-12 audit, even though it never produced a wrong number
  // (verified live across 3 filter combinations first — see CLAUDE.md).
  // Removed rather than left as harmless-but-duplicated.
  const netBoxOfficeRows = useMemo(() => netHeadRows(redemptionRows, 'Box Office'), [redemptionRows])
  // 2026-08-25 bug fix: was netHeadRows(redemptionRowsAllMonths, ...) —
  // Month-unrestricted but still FY-restricted, so a specific FY selection
  // zeroed out any delta whose prior-year window fell in a different FY.
  // redemptionRowsForComparison lifts both restrictions (see
  // FilterContext.jsx's own doc comment).
  const netBoxOfficeRowsForComparison = useMemo(() => netHeadRows(redemptionRowsForComparison, 'Box Office'), [redemptionRowsForComparison])
  const total = sumBy(netBoxOfficeRows, 'RedemptionAmount')
  // 2026-08-20: kept distinct from the new card-based count below —
  // RedemptionCount is a transaction count, needed as-is for "Avg per
  // Redemption" (revenue per redemption *event*, not per card). Only the
  // "X redemptions" display line switches to the card-based measure.
  const totalCount = sumBy(netBoxOfficeRows, 'RedemptionCount')
  const totalCardCount = redemptionRowLevelReady ? exactCardCount(boxOfficeRowLevel) : sumBy(netBoxOfficeRows, 'UniqueCardCount')
  const deltas = useMemo(
    () => computeComparisons(netBoxOfficeRowsForComparison, 'RedemptionAmount', comparisonMonths),
    [netBoxOfficeRowsForComparison, comparisonMonths]
  )
  // 2026-08-29: "custom window" (no MTD/QTD/YTD preset active) badge — same
  // netBoxOfficeRowsForComparison/digitalRowsForComparison pools the
  // anchor-based deltas above already read, just summed over the literal
  // `selectedMonths` window instead of an anchor-derived sub-window.
  const totalCustomPct = useMemo(
    () => computeCustomWindowComparison(netBoxOfficeRowsForComparison, 'RedemptionAmount', selectedMonths),
    [netBoxOfficeRowsForComparison, selectedMonths]
  )
  const digitalRows = netBoxOfficeRows.filter((r) => r.CardType === 'Digital')
  const digitalAmt = sumBy(digitalRows, 'RedemptionAmount')
  const digitalCardCount = redemptionRowLevelReady
    ? exactCardCount(boxOfficeRowLevel.filter((r) => r.CardType === 'Digital'))
    : sumBy(digitalRows, 'UniqueCardCount')
  const digitalRowsForComparison = useMemo(
    () => netBoxOfficeRowsForComparison.filter((r) => r.CardType === 'Digital'),
    [netBoxOfficeRowsForComparison]
  )
  const digitalDeltas = useMemo(
    () => computeComparisons(digitalRowsForComparison, 'RedemptionAmount', comparisonMonths),
    [digitalRowsForComparison, comparisonMonths]
  )
  const digitalCustomPct = useMemo(
    () => computeCustomWindowComparison(digitalRowsForComparison, 'RedemptionAmount', selectedMonths),
    [digitalRowsForComparison, selectedMonths]
  )

  // "Box Office Redemption" KPI's own "% of..." sub-line — its share of all
  // redemption city-wide (every head, net), same cross-total framing
  // "Total Redemption (net)"'s own sub-line already uses on Overview.jsx.
  const grandRedemptionTotal = sumBy(redemptionRows, 'RedemptionAmount')
  const totalPct = grandRedemptionTotal > 0 ? (total / grandRedemptionTotal) * 100 : NaN

  const byRegion = useMemo(() => {
    const g = groupSum(netBoxOfficeRows, 'Region_Clean', ['RedemptionAmount', 'UniqueCardCount'])
    if (redemptionRowLevelReady) {
      const exact = exactCardCountByBucket(
        boxOfficeRowLevel,
        g.map((r) => ({ key: r.key, predicate: (row) => row.Region_Clean === r.key }))
      )
      for (const r of g) r.UniqueCardCount = exact.find((e) => e.key === r.key)?.count ?? r.UniqueCardCount
    }
    return orderBy(g.map((r) => r.key), REGION_ORDER).map((k) => g.find((r) => r.key === k))
  }, [netBoxOfficeRows, boxOfficeRowLevel, redemptionRowLevelReady])

  // ---- Redemption Source split (Online/Cinema, via RedemptionModeFinal —
  // never ActivationMode), each further split by CardType. Head='Box
  // Office' rows are redeemed exclusively through physical outlets
  // (RedemptionModeFinal is always 'Physical' there — checked directly
  // against the cube), so a Box-Office-only cut of this chart would always
  // show a structural-zero Online bar. Box Office and Online are both
  // ticket-type redemptions (F&B is the only head that's genuinely
  // Cinema-only — see RedemptionFnb.jsx, where this chart was removed
  // rather than fixed for that reason), so this chart's dataset is net Box
  // Office + net Online combined (each via the shared netHeadRows() pool),
  // giving Online real volume here. The page's own "Box Office Redemption"
  // KPI above stays scoped to Box Office only — unchanged, this chart's
  // wider scope doesn't leak into it. ----
  const ticketRows = useMemo(() => [...netBoxOfficeRows, ...netHeadRows(redemptionRows, 'Online')], [netBoxOfficeRows, redemptionRows])
  const bySource = useMemo(
    () => groupByRedemptionMode(ticketRows, { modeField: 'RedemptionModeFinal', amountField: 'RedemptionAmount', countField: 'UniqueCardCount' }),
    [ticketRows]
  )
  // 2026-09-16: exact digital/physical card counts for this chart's own
  // ticket pool (Box Office + Online, no netting needed — Cancellation
  // rows are excluded from both Head filters below by construction).
  const ticketRowLevel = useMemo(
    () => [...boxOfficeRowLevel, ...redemptionRowLevelFiltered.filter((r) => r.Head === 'Online')],
    [boxOfficeRowLevel, redemptionRowLevelFiltered]
  )
  const sourceChartData = useMemo(
    () =>
      bySource.map((s) => {
        if (!redemptionRowLevelReady) {
          return { key: s.key, digitalAmount: s.digital.amount, physicalAmount: s.physical.amount, digitalCount: s.digital.count, physicalCount: s.physical.count }
        }
        const modes = REDEMPTION_MODES.find((m) => m.key === s.key)?.modes || []
        const modeRows = ticketRowLevel.filter((r) => modes.includes(r.RedemptionModeFinal))
        return {
          key: s.key,
          digitalAmount: s.digital.amount,
          physicalAmount: s.physical.amount,
          digitalCount: exactCardCount(modeRows.filter((r) => r.CardType === 'Digital')),
          physicalCount: exactCardCount(modeRows.filter((r) => r.CardType === 'Physical'))
        }
      }),
    [bySource, ticketRowLevel, redemptionRowLevelReady]
  )
  const hasSourceData = sourceChartData.some((s) => s.digitalAmount || s.physicalAmount)

  // 2026-08-14 fix: used to pre-filter out Format='N/A' rows before
  // grouping — which, on a *net* row pool, silently dropped 100% of the
  // Cancel Redeem rows netHeadRows() attributes to Box Office (a
  // cancellation transaction carries no seating-tier Format of its own,
  // so every one of them is 'N/A'). That made this chart's own total
  // collapse back to the *gross* Box Office figure (₹1,119.20L) instead of
  // the net total the KPI above it shows (₹1,023.50L) — the exact
  // gross-vs-net drift the 2026-08-06 rewire fixed for the KPI itself,
  // reappearing here through a different code path. Fixed by not
  // pre-filtering at all: topNWithOther() already sorts descending and
  // folds anything past the top 10 into "Other", so the (large, negative)
  // 'N/A'/Cancellation bucket sorts to the very bottom and lands in
  // "Other" naturally — same "real Other value + synthetic overflow bucket
  // both correctly land on the same gray color" pattern already documented
  // for RedemptionFnb.jsx's Category chart.
  // 2026-09-16: exact card counts computed BEFORE topNWithOther() folds the
  // long tail into "Other" — topNWithOther() folds every numeric field
  // (see its own doc comment), so an exact per-Format count merged in here
  // first still folds correctly into "Other"'s own summed count.
  const byFormat = useMemo(() => {
    const g = groupSum(netBoxOfficeRows, 'Format', ['RedemptionAmount', 'UniqueCardCount'])
    if (redemptionRowLevelReady) {
      const exact = exactCardCountByBucket(
        boxOfficeRowLevel,
        g.map((r) => ({ key: r.key, predicate: (row) => row.Format === r.key }))
      )
      for (const r of g) r.UniqueCardCount = exact.find((e) => e.key === r.key)?.count ?? r.UniqueCardCount
    }
    return topNWithOther(g, 10, 'key', 'RedemptionAmount')
  }, [netBoxOfficeRows, boxOfficeRowLevel, redemptionRowLevelReady])

  const byWeekday = useMemo(() => {
    const g = groupSum(netBoxOfficeRows, 'Weekday', ['RedemptionAmount', 'UniqueCardCount'])
    if (redemptionRowLevelReady) {
      const exact = exactCardCountByBucket(
        boxOfficeRowLevel,
        g.map((r) => ({ key: r.key, predicate: (row) => row.Weekday === r.key }))
      )
      for (const r of g) r.UniqueCardCount = exact.find((e) => e.key === r.key)?.count ?? r.UniqueCardCount
    }
    return orderBy(g.map((r) => r.key), WEEKDAY_ORDER).map((k) => g.find((r) => r.key === k))
  }, [netBoxOfficeRows, boxOfficeRowLevel, redemptionRowLevelReady])

  // Chart-parity pass (2026-08-12): same DENOM_ORDER 11-bucket list as
  // Activation.jsx's new "by Denomination" chart and Overview's — see that
  // file's matching comment.
  //
  // 2026-08-14 fix: same root cause as byFormat above — Denom used to be
  // always 'N/A' on the Cancel Redeem rows netted into this pool, so
  // excluding non-listed Denom values dropped the entire netting
  // correction and inflated this chart's total to the gross figure. Fixed
  // the same way Activation.jsx's Denomination chart was fixed: keep the
  // named buckets, fold everything else into an explicit "Other" bucket
  // instead of dropping it.
  //
  // 2026-08-19 data refresh: Cancel Redeem rows (and every other redemption
  // row) now carry a real Denom value — one of the 11 magnitude buckets or
  // the honest 'Unknown (pre-existing)' 12th bucket (now part of
  // DENOM_ORDER itself) — never 'N/A'/'Other'. `otherRows` is confirmed
  // always empty on this cube now, so "Other" no longer renders; the
  // fallback below stays as a live safety net rather than dead code.
  const byDenomination = useMemo(() => {
    const g = groupSum(netBoxOfficeRows, 'Denom', ['RedemptionAmount', 'UniqueCardCount'])
    const named = DENOM_ORDER.map((d) => g.find((r) => r.key === d) || { key: d, RedemptionAmount: 0, UniqueCardCount: 0 })
    const otherRows = netBoxOfficeRows.filter((r) => !DENOM_ORDER.includes(r.Denom))
    const result = otherRows.length === 0 ? named : [...named, { key: 'Other', RedemptionAmount: sumBy(otherRows, 'RedemptionAmount'), UniqueCardCount: sumBy(otherRows, 'UniqueCardCount') }]
    if (redemptionRowLevelReady) {
      const exact = exactCardCountByBucket(
        boxOfficeRowLevel,
        result.map((r) => (r.key === 'Other' ? { key: 'Other', predicate: (row) => !DENOM_ORDER.includes(row.Denom) } : { key: r.key, predicate: (row) => row.Denom === r.key }))
      )
      for (const r of result) r.UniqueCardCount = exact.find((e) => e.key === r.key)?.count ?? r.UniqueCardCount
    }
    return result
  }, [netBoxOfficeRows, boxOfficeRowLevel, redemptionRowLevelReady])

  return (
    <div className="flex flex-col gap-6">
      {/* 2026-08-29: MTD/QTD(Q1-Q4 dropdown)/YTD control row + single
          top-left comparison-date line — copied verbatim from Overview.jsx/
          CardJourney.jsx/Activation.jsx's own render, not a re-styled
          approximation. */}
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
          label="Box Office Redemption"
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

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Box Office Redemption by Source">
          {!hasSourceData ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={sourceChartData} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
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
                      countField={(p) => (p.dataKey === 'digitalAmount' ? 'digitalCount' : 'physicalCount')}
                      countUnit="cards"
                    />
                  }
                  cursor={{ fill: 'rgba(27,36,48,0.04)' }}
                />
                <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
                <Bar dataKey="digitalAmount" name="Digital" stackId="source" fill={CARD_TYPE_COLORS.Digital} maxBarSize={64} />
                <Bar dataKey="physicalAmount" name="Physical" stackId="source" fill={CARD_TYPE_COLORS.Physical} radius={[4, 4, 0, 0]} maxBarSize={64}>
                  <LabelList dataKey="physicalAmount" content={stackTotalLabel(sourceChartData, ['digitalAmount', 'physicalAmount'])} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Box Office Redemption by Region">
          {byRegion.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byRegion} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                {/* 2026-08-19: interval={0}/angle/height added — without
                    them Recharts silently auto-skips ticks it decides won't
                    fit; confirmed live (Playwright at 800/1024px) that
                    CENTRAL's label was dropping off this axis below 1440px
                    now that Director's Cut is a real 6th category here too.
                    Same treatment Overview's own "by Region" charts already
                    use for the identical crowding problem. */}
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
      </div>

      <Card title="Box Office Redemption by Format">
        {byFormat.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={byFormat} layout="vertical" margin={{ top: 8, right: 40, left: 8, bottom: 16 }}>
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
                {byFormat.map((r, i) => (
                  <Cell key={r.key} fill={categoricalColor(i, r.key === 'Other')} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* 2026-08-12: renamed from "Weekday Trend" — no calculation change,
          just naming parity with Activation.jsx's "Week-slot Activation
          Trend" and RedemptionFnb.jsx's new matching chart, so the same
          concept reads as the same name across all 3 pages. */}
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

      <Card title="Box Office Redemption by Denomination">
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
    </div>
  )
}

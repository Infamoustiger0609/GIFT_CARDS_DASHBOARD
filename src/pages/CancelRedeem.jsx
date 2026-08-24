import React, { useMemo } from 'react'
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList } from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { sumBy, groupSum } from '../lib/aggregate'
import { computeComparisons, computeCustomWindowComparison, usePresetWindow, kpiDeltas } from '../lib/comparisons'
import { REDEMPTION_MODES, redemptionModeOf } from '../lib/redemptionMode'
import { orderBy, REGION_ORDER, WEEKDAY_ORDER, regionLabel } from '../lib/constants'
import { COLORS, REGION_COLORS, REDEMPTION_SOURCE_COLORS, categoricalColor } from '../lib/theme'
import { fmtLacs, fmtNumber, fmtPct, fmtLacsAxis, monthLabel } from '../lib/format'
import Card from '../components/Card'
import Kpi from '../components/Kpi'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'
import { AmountLabel } from '../components/ChartLabels'

export default function CancelRedeem() {
  const { redemptionRows, redemptionRowsForComparison, comparisonMonths } = useFilters()

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

  // Same rows that power Overview.jsx's "Cancel Redeem" KPI
  // (`Head === 'Cancellation'`), read through the same `useFilters()` pool
  // every other page uses — respects the global filter bar automatically.
  const cancelRows = useMemo(() => redemptionRows.filter((r) => r.Head === 'Cancellation'), [redemptionRows])

  // Cancellation rows carry a negative RedemptionAmount (the netting
  // convention documented throughout this app). Every aggregation below
  // sums that raw signed field first, same as everywhere else, then takes
  // the absolute value only at display time — mirroring Overview.jsx's
  // existing "Cancel Redeem" KPI (`Math.abs(cancellationRow.RedemptionAmount)`)
  // — so amounts/bars read as a positive magnitude instead of pointing the
  // wrong way on a page where *every* row is a cancellation.
  const total = Math.abs(sumBy(cancelRows, 'RedemptionAmount'))
  const totalCount = sumBy(cancelRows, 'RedemptionCount')

  // Deltas use the *magnitude* of the signed field (same reasoning as
  // Overview.jsx's own Cancel Redeem KPI, added in the same pass) so a
  // rising cancellation total reads as "▲", matching how the KPI's value
  // itself is displayed. % sub-line uses gross (pre-cancellation)
  // redemption as the denominator — same cancellation-rate framing as
  // Overview.jsx's Cancel Redeem KPI, kept consistent dashboard-wide.
  // 2026-08-25 bug fix: was built off redemptionRowsAllMonths — Month-
  // unrestricted but still FY-restricted, so a specific FY selection
  // zeroed out any delta whose prior-year window fell in a different FY.
  // redemptionRowsForComparison lifts both restrictions (see
  // FilterContext.jsx's own doc comment).
  const cancelRowsForComparison = useMemo(
    () => redemptionRowsForComparison.filter((r) => r.Head === 'Cancellation').map((r) => ({ ...r, AbsRedemptionAmount: Math.abs(r.RedemptionAmount) })),
    [redemptionRowsForComparison]
  )
  const deltas = useMemo(
    () => computeComparisons(cancelRowsForComparison, 'AbsRedemptionAmount', comparisonMonths),
    [cancelRowsForComparison, comparisonMonths]
  )
  // 2026-08-29: "custom window" (no MTD/QTD/YTD preset active) badge — same
  // cancelRowsForComparison pool the anchor-based deltas above already
  // read, just summed over the literal `selectedMonths` window instead of
  // an anchor-derived sub-window.
  const totalCustomPct = useMemo(
    () => computeCustomWindowComparison(cancelRowsForComparison, 'AbsRedemptionAmount', selectedMonths),
    [cancelRowsForComparison, selectedMonths]
  )
  const grossPositiveRedemption = useMemo(
    () => sumBy(
      redemptionRows.filter((r) => r.Head !== 'Cancellation'),
      'RedemptionAmount'
    ),
    [redemptionRows]
  )
  const cancelRatePct = grossPositiveRedemption > 0 ? (total / grossPositiveRedemption) * 100 : NaN

  const monthTrend = useMemo(() => {
    const g = groupSum(cancelRows, 'YearMonth', ['RedemptionAmount', 'RedemptionCount'])
    return g
      .sort((a, b) => (a.key > b.key ? 1 : -1))
      .map((r) => ({ label: monthLabel(r.key), RedemptionAmount: Math.abs(r.RedemptionAmount), RedemptionCount: r.RedemptionCount }))
  }, [cancelRows])

  // Phase 7: Cinema-side only (Box Office + F&B territory) — excludes
  // Redemption Source = Online, since Online cancellations have no
  // meaningful region tie the way a cinema-outlet cancellation does. This
  // narrows only this chart; the top-line "Cancel Redeem" KPI above stays
  // on the full, unfiltered cancelRows.
  const cinemaCancelRows = useMemo(() => cancelRows.filter((r) => redemptionModeOf(r.RedemptionModeFinal) === 'Cinema'), [cancelRows])
  const byRegion = useMemo(() => {
    const g = groupSum(cinemaCancelRows, 'Region_Clean', ['RedemptionAmount', 'RedemptionCount'])
    return orderBy(g.map((r) => r.key), REGION_ORDER)
      .map((k) => g.find((r) => r.key === k))
      .map((r) => ({ ...r, RedemptionAmount: Math.abs(r.RedemptionAmount) }))
  }, [cinemaCancelRows])

  const byWeekday = useMemo(() => {
    const g = groupSum(cancelRows, 'Weekday', ['RedemptionAmount', 'RedemptionCount'])
    return orderBy(g.map((r) => r.key), WEEKDAY_ORDER)
      .map((k) => g.find((r) => r.key === k))
      .map((r) => ({ ...r, RedemptionAmount: Math.abs(r.RedemptionAmount) }))
  }, [cancelRows])

  // Redemption Source split (Online/Cinema, via RedemptionModeFinal — never
  // ActivationMode, same REDEMPTION_MODES table every other "by Source"
  // chart on the redemption side uses). Unlike Box Office/F&B, cancel rows
  // have real volume on both channels (not a structural 100%/0% split), so
  // this bar is genuinely informative here.
  const bySource = useMemo(
    () =>
      REDEMPTION_MODES.map(({ key, modes }) => {
        const rows = cancelRows.filter((r) => modes.includes(r.RedemptionModeFinal))
        return {
          key,
          RedemptionAmount: Math.abs(sumBy(rows, 'RedemptionAmount')),
          RedemptionCount: sumBy(rows, 'RedemptionCount')
        }
      }),
    [cancelRows]
  )

  const hasData = cancelRows.length > 0

  return (
    <div className="flex flex-col gap-6">
      {/* 2026-08-29: MTD/QTD(Q1-Q4 dropdown)/YTD control row + single
          top-left comparison-date line — copied verbatim from Overview.jsx's
          own render, not a re-styled approximation. */}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Kpi
          label="Cancel Redeem"
          value={fmtLacs(total)}
          sub={`${fmtPct(cancelRatePct, 1)} of gross redemption`}
          subCount={`${fmtNumber(totalCount)} cancellations`}
          accent="coral"
          deltas={kpiDeltas(activePreset, deltas, totalCustomPct)}
        />
      </div>

      <Card title="Cancel Redeem — Monthly Trend">
        {!hasData ? (
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
              <Tooltip content={<ChartTooltip countField="RedemptionCount" countUnit="cancellations" />} />
              <Line
                type="monotone"
                dataKey="RedemptionAmount"
                name="Cancel Redeem"
                stroke={COLORS.warning}
                strokeWidth={3}
                dot={{ r: 3.5 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div className="grid md:grid-cols-3 gap-6">
        <Card title="Cancel Redeem by Source">
          {bySource.every((s) => s.RedemptionAmount === 0) ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={bySource} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
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
                <Tooltip content={<ChartTooltip countField="RedemptionCount" countUnit="cancellations" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
                <Bar dataKey="RedemptionAmount" name="Cancel Redeem" radius={[4, 4, 0, 0]} maxBarSize={64}>
                  <LabelList dataKey="RedemptionAmount" content={AmountLabel} />
                  {bySource.map((r) => (
                    <Cell key={r.key} fill={REDEMPTION_SOURCE_COLORS[r.key] || COLORS.inkMuted} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Cancel Redeem by Region">
          {byRegion.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byRegion} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                {/* 2026-08-19: interval={0}/angle/height added — without
                    them Recharts silently auto-skips ticks it decides won't
                    fit, which was dropping CENTRAL's label off this axis
                    now that Director's Cut is a real 6th category here too
                    (5 ticks fit fine without this; 6 didn't). Same
                    angle/height/fontSize treatment Overview's own "by
                    Region" charts already use for the identical crowding
                    problem. */}
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
                  content={<ChartTooltip countField="RedemptionCount" countUnit="cancellations" />}
                  labelFormatter={regionLabel}
                  cursor={{ fill: 'rgba(27,36,48,0.04)' }}
                />
                <Bar dataKey="RedemptionAmount" name="Cancel Redeem" radius={[4, 4, 0, 0]} maxBarSize={56}>
                  <LabelList dataKey="RedemptionAmount" content={AmountLabel} />
                  {byRegion.map((r) => (
                    <Cell key={r.key} fill={REGION_COLORS[r.key] || COLORS.inkMuted} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Cancel Redeem by Weekday">
          {byWeekday.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byWeekday} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis
                  dataKey="key"
                  tick={{ fontSize: 10, fill: COLORS.inkMuted }}
                  axisLine={{ stroke: COLORS.border }}
                  tickLine={false}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tickFormatter={fmtLacsAxis}
                  label={{ value: '₹ in Lakhs', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
                />
                <Tooltip content={<ChartTooltip countField="RedemptionCount" countUnit="cancellations" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
                <Bar dataKey="RedemptionAmount" name="Cancel Redeem" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  <LabelList dataKey="RedemptionAmount" content={AmountLabel} />
                  {byWeekday.map((r, i) => (
                    <Cell key={r.key} fill={categoricalColor(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>
    </div>
  )
}

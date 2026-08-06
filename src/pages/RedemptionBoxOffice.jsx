import React, { useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, LabelList } from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { sumBy, groupSum, topNWithOther, netHeadRows, physicalCancelWinnerMap } from '../lib/aggregate'
import { computeComparisons } from '../lib/comparisons'
import { groupByRedemptionMode } from '../lib/redemptionMode'
import { orderBy, REGION_ORDER, WEEKDAY_ORDER, HEAD_ORDER, regionLabel } from '../lib/constants'
import { COLORS, REGION_COLORS, HEAD_COLORS, CARD_TYPE_COLORS, categoricalColor } from '../lib/theme'
import { fmtLacs, fmtNumber, fmtPct, fmtLacsAxis } from '../lib/format'
import Card from '../components/Card'
import Kpi from '../components/Kpi'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'
import { AmountLabel, HorizontalAmountLabel } from '../components/ChartLabels'

export default function RedemptionBoxOffice() {
  const { redemptionRows, redemptionRowsAllMonths, comparisonMonths } = useFilters()

  // 2026-08-06 fix: this page's own "Box Office Redemption" KPI (and every
  // chart derived from it below) used to be gross (Head='Box Office' rows
  // only, no cancellation involvement) — a different, smaller number than
  // Overview.jsx's flow diagram, which nets Cancel Redeem into Box Office
  // (₹1,119.23L gross vs. ₹1,023.50L net, same nominal metric, two
  // different figures on two pages). Rewired onto the same shared
  // netHeadRows() pool Overview.jsx uses, via a Region+Month winner map
  // computed from redemptionRowsAllMonths (the broadest available pool for
  // this page's filters) so the winner decision stays consistent between
  // the "current" and "AllMonths" (delta-comparison) pools — see
  // lib/aggregate.js and the 2026-08-06 CLAUDE.md entry.
  const winnerMap = useMemo(() => physicalCancelWinnerMap(redemptionRowsAllMonths), [redemptionRowsAllMonths])
  const boxOfficeRows = useMemo(() => redemptionRows.filter((r) => r.Head === 'Box Office'), [redemptionRows])
  const netBoxOfficeRows = useMemo(() => netHeadRows(redemptionRows, 'Box Office', winnerMap), [redemptionRows, winnerMap])
  const netBoxOfficeRowsAllMonths = useMemo(
    () => netHeadRows(redemptionRowsAllMonths, 'Box Office', winnerMap),
    [redemptionRowsAllMonths, winnerMap]
  )
  const total = sumBy(netBoxOfficeRows, 'RedemptionAmount')
  const totalCount = sumBy(netBoxOfficeRows, 'RedemptionCount')
  const deltas = useMemo(
    () => computeComparisons(netBoxOfficeRowsAllMonths, 'RedemptionAmount', comparisonMonths),
    [netBoxOfficeRowsAllMonths, comparisonMonths]
  )
  const digitalRows = netBoxOfficeRows.filter((r) => r.CardType === 'Digital')
  const digitalAmt = sumBy(digitalRows, 'RedemptionAmount')
  const digitalCount = sumBy(digitalRows, 'RedemptionCount')
  const digitalRowsAllMonths = useMemo(() => netBoxOfficeRowsAllMonths.filter((r) => r.CardType === 'Digital'), [netBoxOfficeRowsAllMonths])
  const digitalDeltas = useMemo(
    () => computeComparisons(digitalRowsAllMonths, 'RedemptionAmount', comparisonMonths),
    [digitalRowsAllMonths, comparisonMonths]
  )

  // "Box Office Redemption" KPI's own "% of..." sub-line — its share of all
  // redemption city-wide (every head, net), same cross-total framing
  // "Total Redemption (net)"'s own sub-line already uses on Overview.jsx.
  const grandRedemptionTotal = sumBy(redemptionRows, 'RedemptionAmount')
  const totalPct = grandRedemptionTotal > 0 ? (total / grandRedemptionTotal) * 100 : NaN

  const headsBreakdown = useMemo(() => {
    const g = groupSum(redemptionRows, 'Head', ['RedemptionAmount', 'RedemptionCount'])
    return orderBy(g.map((r) => r.key), HEAD_ORDER).map((k) => g.find((r) => r.key === k))
  }, [redemptionRows])

  const byRegion = useMemo(() => {
    const g = groupSum(netBoxOfficeRows, 'Region_Clean', ['RedemptionAmount', 'RedemptionCount'])
    return orderBy(g.map((r) => r.key), REGION_ORDER).map((k) => g.find((r) => r.key === k))
  }, [netBoxOfficeRows])

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
  const ticketRows = useMemo(
    () => [...netBoxOfficeRows, ...netHeadRows(redemptionRows, 'Online', winnerMap)],
    [netBoxOfficeRows, redemptionRows, winnerMap]
  )
  const bySource = useMemo(
    () => groupByRedemptionMode(ticketRows, { modeField: 'RedemptionModeFinal', amountField: 'RedemptionAmount', countField: 'RedemptionCount' }),
    [ticketRows]
  )
  const sourceChartData = useMemo(
    () =>
      bySource.map((s) => ({
        key: s.key,
        digitalAmount: s.digital.amount,
        physicalAmount: s.physical.amount,
        digitalCount: s.digital.count,
        physicalCount: s.physical.count
      })),
    [bySource]
  )
  const hasSourceData = sourceChartData.some((s) => s.digitalAmount || s.physicalAmount)

  const byFormat = useMemo(() => {
    const g = groupSum(
      netBoxOfficeRows.filter((r) => r.Format && r.Format !== 'N/A'),
      'Format',
      ['RedemptionAmount', 'RedemptionCount']
    )
    return topNWithOther(g, 10, 'key', 'RedemptionAmount')
  }, [netBoxOfficeRows])

  const byWeekday = useMemo(() => {
    const g = groupSum(netBoxOfficeRows, 'Weekday', ['RedemptionAmount', 'RedemptionCount'])
    return orderBy(g.map((r) => r.key), WEEKDAY_ORDER).map((k) => g.find((r) => r.key === k))
  }, [netBoxOfficeRows])

  const hasData = boxOfficeRows.length > 0

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Kpi
          label="Box Office Redemption"
          value={fmtLacs(total)}
          sub={`${fmtNumber(totalCount)} redemptions · ${fmtPct(totalPct, 0)} of total redemption`}
          accent="teal"
          deltas={[
            { label: 'MoM', pct: deltas.mom },
            { label: 'QoQ', pct: deltas.qoq },
            { label: 'YoY', pct: deltas.yoy }
          ]}
        />
        <Kpi
          label="Digital Card Redemption"
          value={fmtLacs(digitalAmt)}
          sub={`${fmtNumber(digitalCount)} redemptions · ${fmtPct(total ? (digitalAmt / total) * 100 : 0)}`}
          accent="blue"
          deltas={[
            { label: 'MoM', pct: digitalDeltas.mom },
            { label: 'QoQ', pct: digitalDeltas.qoq },
            { label: 'YoY', pct: digitalDeltas.yoy }
          ]}
        />
        <Kpi label="Avg per Redemption" value={totalCount ? fmtLacs(total / totalCount, 4) : '—'} accent="navy" />
      </div>

      <Card title="Redemption Heads Breakdown" subtitle="Online / Box Office / F&B / Cancellation (net), ₹ Lacs">
        {!hasData && redemptionRows.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={headsBreakdown} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
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
              <Tooltip content={<ChartTooltip countField="RedemptionCount" countUnit="redemptions" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
              <Bar dataKey="RedemptionAmount" name="Redemption" radius={[4, 4, 0, 0]} maxBarSize={64}>
                <LabelList dataKey="RedemptionAmount" content={AmountLabel} />
                {headsBreakdown.map((r) => (
                  <Cell key={r.key} fill={HEAD_COLORS[r.key] || COLORS.inkMuted} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Box Office Redemption by Source" subtitle="Ticket redemptions (Box Office + Online), by source, split by card type, ₹ Lacs">
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
                      countUnit="redemptions"
                    />
                  }
                  cursor={{ fill: 'rgba(27,36,48,0.04)' }}
                />
                <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
                <Bar dataKey="digitalAmount" name="Digital" stackId="source" fill={CARD_TYPE_COLORS.Digital} maxBarSize={64} />
                <Bar dataKey="physicalAmount" name="Physical" stackId="source" fill={CARD_TYPE_COLORS.Physical} radius={[4, 4, 0, 0]} maxBarSize={64} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="text-[11px] text-warmgray-muted mt-2 italic">
            Combines Head='Box Office' with Head='Online' — both are ticket-type redemptions, just different channels — so the
            Online bar reflects real volume here, unlike a Box-Office-only cut which would always be zero.
          </p>
        </Card>

        <Card title="Box Office Redemption by Region">
          {byRegion.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byRegion} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis dataKey="key" tickFormatter={regionLabel} tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
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

      <Card title="Box Office Redemption by Format" subtitle="Seating tier — top 10 + Other, ₹ Lacs">
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
              <Tooltip content={<ChartTooltip countField="RedemptionCount" countUnit="redemptions" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
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

      <Card title="Weekday Trend" subtitle="Box Office redemption amount">
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
              <Tooltip content={<ChartTooltip countField="RedemptionCount" countUnit="redemptions" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
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
    </div>
  )
}

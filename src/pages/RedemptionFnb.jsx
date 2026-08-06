import React, { useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList } from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { sumBy, groupSum, topNWithOther, netHeadRows, physicalCancelWinnerMap } from '../lib/aggregate'
import { computeComparisons } from '../lib/comparisons'
import { orderBy, REGION_ORDER, regionLabel } from '../lib/constants'
import { COLORS, REGION_COLORS, categoricalColor } from '../lib/theme'
import { fmtLacs, fmtNumber, fmtPct, fmtLacsAxis } from '../lib/format'
import Card from '../components/Card'
import Kpi from '../components/Kpi'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'
import { AmountLabel, HorizontalAmountLabel } from '../components/ChartLabels'

export default function RedemptionFnb() {
  const { redemptionRows, redemptionRowsAllMonths, comparisonMonths, heroProducts } = useFilters()

  // 2026-08-06 fix: this page's own "F&B Redemption" KPI (and every chart
  // derived from it below) used to be gross (Head='F&B' rows only, no
  // cancellation involvement) — a different, smaller number than
  // Overview.jsx's flow diagram, which nets Cancel Redeem into F&B
  // (₹1,748.29L gross vs. ₹1,432.74L net, same nominal metric, two
  // different figures on two pages). Rewired onto the same shared
  // netHeadRows() pool Overview.jsx and RedemptionBoxOffice.jsx use, via a
  // Region+Month winner map computed from redemptionRowsAllMonths (the
  // broadest available pool for this page's filters) so the winner
  // decision stays consistent between the "current" and "AllMonths"
  // (delta-comparison) pools — see lib/aggregate.js and the 2026-08-06
  // CLAUDE.md entry.
  const winnerMap = useMemo(() => physicalCancelWinnerMap(redemptionRowsAllMonths), [redemptionRowsAllMonths])
  const fnbRows = useMemo(() => redemptionRows.filter((r) => r.Head === 'F&B'), [redemptionRows])
  const netFnbRows = useMemo(() => netHeadRows(redemptionRows, 'F&B', winnerMap), [redemptionRows, winnerMap])
  const netFnbRowsAllMonths = useMemo(
    () => netHeadRows(redemptionRowsAllMonths, 'F&B', winnerMap),
    [redemptionRowsAllMonths, winnerMap]
  )
  const total = sumBy(netFnbRows, 'RedemptionAmount')
  const totalCount = sumBy(netFnbRows, 'RedemptionCount')
  const deltas = useMemo(
    () => computeComparisons(netFnbRowsAllMonths, 'RedemptionAmount', comparisonMonths),
    [netFnbRowsAllMonths, comparisonMonths]
  )
  const digitalRows = netFnbRows.filter((r) => r.CardType === 'Digital')
  const digitalAmt = sumBy(digitalRows, 'RedemptionAmount')
  const digitalCount = sumBy(digitalRows, 'RedemptionCount')
  const digitalRowsAllMonths = useMemo(() => netFnbRowsAllMonths.filter((r) => r.CardType === 'Digital'), [netFnbRowsAllMonths])
  const digitalDeltas = useMemo(
    () => computeComparisons(digitalRowsAllMonths, 'RedemptionAmount', comparisonMonths),
    [digitalRowsAllMonths, comparisonMonths]
  )

  // "F&B Redemption" KPI's own "% of..." sub-line — its share of all
  // redemption city-wide (every head, net), same cross-total framing
  // "Total Redemption (net)"'s own sub-line already uses on Overview.jsx,
  // and the same fix just applied to "Box Office Redemption".
  const grandRedemptionTotal = sumBy(redemptionRows, 'RedemptionAmount')
  const totalPct = grandRedemptionTotal > 0 ? (total / grandRedemptionTotal) * 100 : NaN

  const byRegion = useMemo(() => {
    const g = groupSum(netFnbRows, 'Region_Clean', ['RedemptionAmount', 'RedemptionCount'])
    return orderBy(g.map((r) => r.key), REGION_ORDER).map((k) => g.find((r) => r.key === k))
  }, [netFnbRows])

  const byCategory = useMemo(() => {
    const g = groupSum(
      netFnbRows.filter((r) => r.Category && r.Category !== 'N/A'),
      'Category',
      ['RedemptionAmount', 'RedemptionCount']
    )
    return topNWithOther(g, 10, 'key', 'RedemptionAmount')
  }, [netFnbRows])

  const heroSorted = useMemo(() => [...heroProducts].sort((a, b) => b.amount - a.amount), [heroProducts])
  const heroMax = heroSorted[0]?.amount || 1

  const hasData = fnbRows.length > 0

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Kpi
          label="F&B Redemption"
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

      <Card title="F&B Redemption by Region">
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

      <Card title="F&B Redemption by Category" subtitle="Top 10 + Other, ₹ Lacs">
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
              <Tooltip content={<ChartTooltip countField="RedemptionCount" countUnit="redemptions" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
              <Bar dataKey="RedemptionAmount" name="Redemption" radius={[0, 4, 4, 0]} maxBarSize={22}>
                <LabelList dataKey="RedemptionAmount" content={HorizontalAmountLabel} />
                {byCategory.map((r, i) => (
                  <Cell key={r.key} fill={categoricalColor(i, r.key === 'Other')} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Hero Products" subtitle="Top 15 F&B items by amount, whole-dataset (not affected by filters)">
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
              <span className="text-xs font-semibold text-navy tabular-nums w-20 text-right">₹{p.amount.toFixed(2)} L</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-warmgray-muted mt-3 italic">
          No unit-count field ships with this list (source data has amount only) — bar length reflects amount, not units sold.
        </p>
        {!hasData && <p className="text-xs text-warmgray-muted mt-1 italic">Static list, not affected by filters.</p>}
      </Card>
    </div>
  )
}

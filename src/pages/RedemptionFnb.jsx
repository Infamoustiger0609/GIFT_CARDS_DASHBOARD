import React, { useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList } from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { sumBy, groupSum, topNWithOther, netHeadRows } from '../lib/aggregate'
import { computeComparisons } from '../lib/comparisons'
import { orderBy, REGION_ORDER, WEEKDAY_ORDER, DENOM_ORDER, regionLabel } from '../lib/constants'
import { COLORS, REGION_COLORS, categoricalColor } from '../lib/theme'
import { fmtLacs, fmtRupees, fmtNumber, fmtPct, fmtLacsAxis } from '../lib/format'
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
  // netHeadRows() pool Overview.jsx and RedemptionBoxOffice.jsx use — see
  // lib/aggregate.js and the 2026-08-06 CLAUDE.md entry.
  //
  // 2026-08-12 cross-page audit: no longer computes its own winner map —
  // see RedemptionBoxOffice.jsx's matching comment (identical reasoning,
  // this page had the exact same duplicated
  // `physicalCancelWinnerMap(redemptionRowsAllMonths)` call site).
  const fnbRows = useMemo(() => redemptionRows.filter((r) => r.Head === 'F&B'), [redemptionRows])
  const netFnbRows = useMemo(() => netHeadRows(redemptionRows, 'F&B'), [redemptionRows])
  const netFnbRowsAllMonths = useMemo(() => netHeadRows(redemptionRowsAllMonths, 'F&B'), [redemptionRowsAllMonths])
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

  // 2026-08-14 fix: used to pre-filter out Category='N/A' rows before
  // grouping — same root cause as RedemptionBoxOffice.jsx's matching
  // Format-chart fix, just on Category instead: every Cancel Redeem row
  // netHeadRows() attributes to F&B carries no Category of its own
  // ('N/A'), so excluding it dropped the whole netting correction and
  // inflated this chart's total to the gross F&B figure (₹1,748.29L)
  // instead of the net total the KPI above it shows (₹1,432.74L). Fixed
  // by not pre-filtering — topNWithOther() sorts descending and folds the
  // large negative 'N/A' bucket into "Other" naturally, same as
  // RedemptionBoxOffice.jsx's Format chart.
  const byCategory = useMemo(() => {
    const g = groupSum(netFnbRows, 'Category', ['RedemptionAmount', 'RedemptionCount'])
    return topNWithOther(g, 10, 'key', 'RedemptionAmount')
  }, [netFnbRows])

  // Chart-parity pass (2026-08-12): this page was the one of the three
  // missing a weekday breakdown — Activation.jsx has "Week-slot Activation
  // Trend", RedemptionBoxOffice.jsx has the matching "Week-slot Redemption
  // Trend" (renamed same day from "Weekday Trend"). Same shape/colors as
  // both.
  const byWeekday = useMemo(() => {
    const g = groupSum(netFnbRows, 'Weekday', ['RedemptionAmount', 'RedemptionCount'])
    return orderBy(g.map((r) => r.key), WEEKDAY_ORDER).map((k) => g.find((r) => r.key === k))
  }, [netFnbRows])

  // Same DENOM_ORDER 11-bucket list as Activation.jsx/RedemptionBoxOffice.jsx's
  // new "by Denomination" charts and Overview's.
  //
  // 2026-08-14 fix: same root cause as byCategory above — fold non-listed
  // Denom values (including the Cancel Redeem correction, always 'N/A')
  // into an explicit "Other" bucket instead of dropping them, so this
  // chart's total reconciles with the KPI above it.
  const byDenomination = useMemo(() => {
    const g = groupSum(netFnbRows, 'Denom', ['RedemptionAmount', 'RedemptionCount'])
    const named = DENOM_ORDER.map((d) => g.find((r) => r.key === d) || { key: d, RedemptionAmount: 0, RedemptionCount: 0 })
    const otherRows = netFnbRows.filter((r) => !DENOM_ORDER.includes(r.Denom))
    if (otherRows.length === 0) return named
    return [...named, { key: 'Other', RedemptionAmount: sumBy(otherRows, 'RedemptionAmount'), RedemptionCount: sumBy(otherRows, 'RedemptionCount') }]
  }, [netFnbRows])

  const heroSorted = useMemo(() => [...heroProducts].sort((a, b) => b.amount - a.amount), [heroProducts])
  const heroMax = heroSorted[0]?.amount || 1

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
        <Kpi label="Avg per Redemption" value={totalCount ? fmtRupees(total / totalCount) : '—'} accent="navy" />
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
              <Tooltip content={<ChartTooltip countField="RedemptionCount" countUnit="redemptions" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
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
      </Card>
    </div>
  )
}

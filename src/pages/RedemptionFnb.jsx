import React, { useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { sumBy, groupSum, topNWithOther } from '../lib/aggregate'
import { orderBy, MODE_ORDER, REGION_ORDER } from '../lib/constants'
import { COLORS, MODE_COLORS, REGION_COLORS } from '../lib/theme'
import { fmtLacs, fmtNumber, fmtPct, fmtLacsAxis } from '../lib/format'
import Card from '../components/Card'
import Kpi from '../components/Kpi'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'

export default function RedemptionFnb() {
  const { redemptionRows, heroProducts } = useFilters()

  const fnbRows = useMemo(() => redemptionRows.filter((r) => r.Head === 'F&B'), [redemptionRows])
  const total = sumBy(fnbRows, 'RedemptionAmount')
  const totalCount = sumBy(fnbRows, 'RedemptionCount')
  const sourceAmt = sumBy(fnbRows.filter((r) => r.SourceFlag === 'Source'), 'RedemptionAmount')

  const byRegion = useMemo(() => {
    const g = groupSum(fnbRows, 'Region_Clean', ['RedemptionAmount'])
    return orderBy(g.map((r) => r.key), REGION_ORDER).map((k) => g.find((r) => r.key === k))
  }, [fnbRows])

  const byMode = useMemo(() => {
    const g = groupSum(fnbRows, 'ActivationMode', ['RedemptionAmount'])
    return orderBy(g.map((r) => r.key), MODE_ORDER).map((k) => g.find((r) => r.key === k))
  }, [fnbRows])

  const byCategory = useMemo(() => {
    const g = groupSum(
      fnbRows.filter((r) => r.Category && r.Category !== 'N/A'),
      'Category',
      ['RedemptionAmount']
    )
    return topNWithOther(g, 10, 'key', 'RedemptionAmount')
  }, [fnbRows])

  const heroSorted = useMemo(() => [...heroProducts].sort((a, b) => b.amount - a.amount), [heroProducts])
  const heroMax = heroSorted[0]?.amount || 1

  const hasData = fnbRows.length > 0

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="F&B Redemption" value={fmtLacs(total)} sub={`${fmtNumber(totalCount)} redemptions`} accent="teal" />
        <Kpi label="Source Redemption" value={fmtLacs(sourceAmt)} sub={fmtPct(total ? (sourceAmt / total) * 100 : 0)} accent="teal" />
        <Kpi label="Non-Source Redemption" value={fmtLacs(total - sourceAmt)} sub={fmtPct(total ? ((total - sourceAmt) / total) * 100 : 0)} accent="coral" />
        <Kpi label="Avg per Redemption" value={totalCount ? fmtLacs(total / totalCount, 4) : '—'} accent="navy" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="F&B Redemption by Region">
          {byRegion.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byRegion} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={64} tickFormatter={fmtLacsAxis} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
                <Bar dataKey="RedemptionAmount" name="Redemption" radius={[4, 4, 0, 0]} maxBarSize={56}>
                  {byRegion.map((r) => (
                    <Cell key={r.key} fill={REGION_COLORS[r.key] || COLORS.teal} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="F&B Redemption by Mode" subtitle="Origin channel of the redeemed card">
          {byMode.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byMode} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 10, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={64} tickFormatter={fmtLacsAxis} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
                <Bar dataKey="RedemptionAmount" name="Redemption" radius={[4, 4, 0, 0]} maxBarSize={56}>
                  {byMode.map((r) => (
                    <Cell key={r.key} fill={MODE_COLORS[r.key] || COLORS.teal} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card title="F&B Redemption by Category" subtitle="Top 10 + Other, ₹ Lacs">
        {byCategory.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={byCategory} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} tickFormatter={fmtLacsAxis} />
              <YAxis dataKey="key" type="category" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={110} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
              <Bar dataKey="RedemptionAmount" name="Redemption" fill={COLORS.teal} radius={[0, 4, 4, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Hero Products" subtitle="Top 15 F&B items, whole-dataset (not affected by filters)">
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
              <span className="text-xs font-semibold text-navy tabular-nums w-16 text-right">{p.amount.toFixed(2)}</span>
            </div>
          ))}
        </div>
        {!hasData && <p className="text-xs text-warmgray-muted mt-3 italic">Note: hero products list is static and always shown regardless of filters.</p>}
      </Card>
    </div>
  )
}

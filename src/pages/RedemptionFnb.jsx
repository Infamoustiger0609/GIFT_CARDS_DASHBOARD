import React, { useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, LabelList } from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { sumBy, groupSum, topNWithOther } from '../lib/aggregate'
import { computeComparisons } from '../lib/comparisons'
import { ACTIVATION_SOURCES, groupByActivationSource } from '../lib/activationSource'
import { orderBy, REGION_ORDER } from '../lib/constants'
import { COLORS, REGION_COLORS, CARD_TYPE_COLORS, CATEGORICAL_GRAY } from '../lib/theme'
import { fmtLacs, fmtNumber, fmtPct, fmtLacsAxis } from '../lib/format'
import Card from '../components/Card'
import Kpi from '../components/Kpi'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'
import { AmountLabel } from '../components/ChartLabels'

export default function RedemptionFnb() {
  const { redemptionRows, redemptionRowsAllMonths, comparisonMonths, heroProducts } = useFilters()

  const fnbRows = useMemo(() => redemptionRows.filter((r) => r.Head === 'F&B'), [redemptionRows])
  const fnbRowsAllMonths = useMemo(() => redemptionRowsAllMonths.filter((r) => r.Head === 'F&B'), [redemptionRowsAllMonths])
  const total = sumBy(fnbRows, 'RedemptionAmount')
  const totalCount = sumBy(fnbRows, 'RedemptionCount')
  const deltas = useMemo(
    () => computeComparisons(fnbRowsAllMonths, 'RedemptionAmount', comparisonMonths),
    [fnbRowsAllMonths, comparisonMonths]
  )
  const sourceRows = fnbRows.filter((r) => r.SourceFlag === 'Source')
  const sourceAmt = sumBy(sourceRows, 'RedemptionAmount')
  const sourceCount = sumBy(sourceRows, 'RedemptionCount')
  const nonSourceCount = totalCount - sourceCount

  const byRegion = useMemo(() => {
    const g = groupSum(fnbRows, 'Region_Clean', ['RedemptionAmount', 'RedemptionCount'])
    return orderBy(g.map((r) => r.key), REGION_ORDER).map((k) => g.find((r) => r.key === k))
  }, [fnbRows])

  // 3-source split (PVR Corporate / Aggregators / Cinema) by CardType, plus
  // whatever doesn't map to any of the 3 (mostly cards activated before
  // Apr 2024, when CardType/source tracking began) shown as its own
  // "Pre-existing" bucket rather than silently dropped.
  const byActivationSource = useMemo(() => {
    const sources = groupByActivationSource(fnbRows, {
      modeField: 'ActivationMode',
      amountField: 'RedemptionAmount',
      countField: 'RedemptionCount'
    }).map((s) => ({ ...s, other: { amount: 0, count: 0 } }))
    const bucketedModes = ACTIVATION_SOURCES.flatMap((s) => s.modes)
    const preExistingRows = fnbRows.filter((r) => !bucketedModes.includes(r.ActivationMode))
    const preExistingAmount = sumBy(preExistingRows, 'RedemptionAmount')
    const preExistingCount = sumBy(preExistingRows, 'RedemptionCount')
    const rest =
      preExistingAmount || preExistingCount
        ? [
            {
              key: 'Pre-existing',
              amount: preExistingAmount,
              count: preExistingCount,
              digital: { amount: 0, count: 0 },
              physical: { amount: 0, count: 0 },
              other: { amount: preExistingAmount, count: preExistingCount }
            }
          ]
        : []
    return [...sources, ...rest]
  }, [fnbRows])
  const byActivationSourceChartData = useMemo(
    () =>
      byActivationSource.map((s) => ({
        key: s.key,
        digitalAmount: s.digital.amount,
        physicalAmount: s.physical.amount,
        otherAmount: s.other.amount,
        digitalCount: s.digital.count,
        physicalCount: s.physical.count,
        otherCount: s.other.count
      })),
    [byActivationSource]
  )

  const byCategory = useMemo(() => {
    const g = groupSum(
      fnbRows.filter((r) => r.Category && r.Category !== 'N/A'),
      'Category',
      ['RedemptionAmount', 'RedemptionCount']
    )
    return topNWithOther(g, 10, 'key', 'RedemptionAmount')
  }, [fnbRows])

  const heroSorted = useMemo(() => [...heroProducts].sort((a, b) => b.amount - a.amount), [heroProducts])
  const heroMax = heroSorted[0]?.amount || 1

  const hasData = fnbRows.length > 0

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi
          label="F&B Redemption"
          value={fmtLacs(total)}
          sub={`${fmtNumber(totalCount)} redemptions`}
          accent="teal"
          deltas={[
            { label: 'MoM', pct: deltas.mom },
            { label: 'QoQ', pct: deltas.qoq },
            { label: 'YoY', pct: deltas.yoy }
          ]}
        />
        <Kpi
          label="Source Redemption"
          value={fmtLacs(sourceAmt)}
          sub={`${fmtNumber(sourceCount)} redemptions · ${fmtPct(total ? (sourceAmt / total) * 100 : 0)}`}
          accent="teal"
        />
        <Kpi
          label="Non-Source Redemption"
          value={fmtLacs(total - sourceAmt)}
          sub={`${fmtNumber(nonSourceCount)} redemptions · ${fmtPct(total ? ((total - sourceAmt) / total) * 100 : 0)}`}
          accent="coral"
        />
        <Kpi label="Avg per Redemption" value={totalCount ? fmtLacs(total / totalCount, 4) : '—'} accent="navy" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="F&B Redemption by Region">
          {byRegion.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byRegion} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={64} tickFormatter={fmtLacsAxis} />
                <Tooltip content={<ChartTooltip countField="RedemptionCount" countUnit="redemptions" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
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

        <Card title="F&B Redemption by Source" subtitle="PVR Corporate / Aggregators / Cinema, split by card type">
          {byActivationSourceChartData.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byActivationSourceChartData} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 10, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} interval={0} />
                <YAxis tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={64} tickFormatter={fmtLacsAxis} />
                <Tooltip
                  content={
                    <ChartTooltip
                      countField={(p) => {
                        if (p.dataKey === 'digitalAmount') return 'digitalCount'
                        if (p.dataKey === 'physicalAmount') return 'physicalCount'
                        return 'otherCount'
                      }}
                      countUnit="redemptions"
                    />
                  }
                  cursor={{ fill: 'rgba(27,36,48,0.04)' }}
                />
                <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
                <Bar dataKey="digitalAmount" name="Digital" stackId="source" fill={CARD_TYPE_COLORS.Digital} maxBarSize={56} />
                <Bar dataKey="physicalAmount" name="Physical" stackId="source" fill={CARD_TYPE_COLORS.Physical} maxBarSize={56} />
                <Bar dataKey="otherAmount" name="Pre-existing" stackId="source" fill={CATEGORICAL_GRAY} maxBarSize={56} />
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
            <BarChart data={byCategory} layout="vertical" margin={{ top: 8, right: 40, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} tickFormatter={fmtLacsAxis} />
              <YAxis dataKey="key" type="category" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={110} />
              <Tooltip content={<ChartTooltip countField="RedemptionCount" countUnit="redemptions" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
              <Bar dataKey="RedemptionAmount" name="Redemption" fill={COLORS.teal} radius={[0, 4, 4, 0]} maxBarSize={22}>
                <LabelList dataKey="RedemptionAmount" position="right" formatter={fmtLacsAxis} style={{ fontSize: 11, fill: COLORS.inkMuted }} />
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
              <span className="text-xs font-semibold text-navy tabular-nums w-16 text-right">{p.amount.toFixed(2)}</span>
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

import React, { useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, PieChart, Pie, Legend, LabelList } from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { sumBy, groupSum, topNWithOther } from '../lib/aggregate'
import { computeComparisons } from '../lib/comparisons'
import { ACTIVATION_SOURCES, groupByActivationSource } from '../lib/activationSource'
import { orderBy, REGION_ORDER, WEEKDAY_ORDER, HEAD_ORDER } from '../lib/constants'
import { COLORS, REGION_COLORS, HEAD_COLORS, SOURCE_COLORS, CARD_TYPE_COLORS, CATEGORICAL_GRAY } from '../lib/theme'
import { fmtLacs, fmtNumber, fmtPct, fmtLacsAxis } from '../lib/format'
import Card from '../components/Card'
import Kpi from '../components/Kpi'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'
import { AmountLabel, donutLabel } from '../components/ChartLabels'

export default function RedemptionBoxOffice() {
  const { redemptionRows, redemptionRowsAllMonths, comparisonMonths } = useFilters()

  const boxOfficeRows = useMemo(() => redemptionRows.filter((r) => r.Head === 'Box Office'), [redemptionRows])
  const boxOfficeRowsAllMonths = useMemo(() => redemptionRowsAllMonths.filter((r) => r.Head === 'Box Office'), [redemptionRowsAllMonths])
  const total = sumBy(boxOfficeRows, 'RedemptionAmount')
  const totalCount = sumBy(boxOfficeRows, 'RedemptionCount')
  const deltas = useMemo(
    () => computeComparisons(boxOfficeRowsAllMonths, 'RedemptionAmount', comparisonMonths),
    [boxOfficeRowsAllMonths, comparisonMonths]
  )
  const sourceRows = boxOfficeRows.filter((r) => r.SourceFlag === 'Source')
  const sourceAmt = sumBy(sourceRows, 'RedemptionAmount')
  const sourceCount = sumBy(sourceRows, 'RedemptionCount')
  const nonSourceCount = totalCount - sourceCount

  const headsBreakdown = useMemo(() => {
    const g = groupSum(redemptionRows, 'Head', ['RedemptionAmount', 'RedemptionCount'])
    return orderBy(g.map((r) => r.key), HEAD_ORDER).map((k) => g.find((r) => r.key === k))
  }, [redemptionRows])

  const byRegion = useMemo(() => {
    const g = groupSum(boxOfficeRows, 'Region_Clean', ['RedemptionAmount', 'RedemptionCount'])
    return orderBy(g.map((r) => r.key), REGION_ORDER).map((k) => g.find((r) => r.key === k))
  }, [boxOfficeRows])

  // 3-source split (PVR Corporate / Aggregators / Cinema) by CardType, plus
  // whatever doesn't map to any of the 3 (mostly cards activated before
  // Apr 2024, when CardType/source tracking began) shown as its own
  // "Pre-existing" bucket rather than silently dropped.
  const byActivationSource = useMemo(() => {
    const sources = groupByActivationSource(boxOfficeRows, {
      modeField: 'ActivationMode',
      amountField: 'RedemptionAmount',
      countField: 'RedemptionCount'
    }).map((s) => ({ ...s, other: { amount: 0, count: 0 } }))
    const bucketedModes = ACTIVATION_SOURCES.flatMap((s) => s.modes)
    const preExistingRows = boxOfficeRows.filter((r) => !bucketedModes.includes(r.ActivationMode))
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
  }, [boxOfficeRows])
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

  const byFormat = useMemo(() => {
    const g = groupSum(
      boxOfficeRows.filter((r) => r.Format && r.Format !== 'N/A'),
      'Format',
      ['RedemptionAmount', 'RedemptionCount']
    )
    return topNWithOther(g, 10, 'key', 'RedemptionAmount')
  }, [boxOfficeRows])

  const bySource = useMemo(() => {
    const g = groupSum(
      boxOfficeRows.filter((r) => r.SourceFlag !== 'N/A'),
      'SourceFlag',
      ['RedemptionAmount', 'RedemptionCount']
    )
    return g
  }, [boxOfficeRows])

  const byWeekday = useMemo(() => {
    const g = groupSum(boxOfficeRows, 'Weekday', ['RedemptionAmount', 'RedemptionCount'])
    return orderBy(g.map((r) => r.key), WEEKDAY_ORDER).map((k) => g.find((r) => r.key === k))
  }, [boxOfficeRows])

  const hasData = boxOfficeRows.length > 0

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi
          label="Box Office Redemption"
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

      <Card title="Redemption Heads Breakdown" subtitle="Online / Box Office / F&B / Cancellation (net), ₹ Lacs">
        {!hasData && redemptionRows.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={headsBreakdown} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
              <XAxis dataKey="key" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={64} tickFormatter={fmtLacsAxis} />
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
        <Card title="Box Office Redemption by Region">
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

        <Card title="Box Office Redemption by Source" subtitle="PVR Corporate / Aggregators / Cinema, split by card type">
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

      <Card title="Box Office Redemption by Format" subtitle="Seating tier — top 10 + Other, ₹ Lacs">
        {byFormat.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={byFormat} layout="vertical" margin={{ top: 8, right: 40, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} tickFormatter={fmtLacsAxis} />
              <YAxis dataKey="key" type="category" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={110} />
              <Tooltip content={<ChartTooltip countField="RedemptionCount" countUnit="redemptions" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
              <Bar dataKey="RedemptionAmount" name="Redemption" fill={COLORS.redemption} radius={[0, 4, 4, 0]} maxBarSize={22}>
                <LabelList dataKey="RedemptionAmount" position="right" formatter={fmtLacsAxis} style={{ fontSize: 11, fill: COLORS.inkMuted }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Source vs Non-Source" subtitle="Box Office redemption">
          {bySource.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={bySource}
                  dataKey="RedemptionAmount"
                  nameKey="key"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                  strokeWidth={3}
                  stroke="#ffffff"
                  label={donutLabel}
                  labelLine={false}
                >
                  {bySource.map((r) => (
                    <Cell key={r.key} fill={SOURCE_COLORS[r.key] || COLORS.inkMuted} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip countField="RedemptionCount" countUnit="redemptions" />} />
                <Legend verticalAlign="bottom" height={36} formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
              </PieChart>
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
                <YAxis tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={64} tickFormatter={fmtLacsAxis} />
                <Tooltip content={<ChartTooltip countField="RedemptionCount" countUnit="redemptions" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
                <Bar dataKey="RedemptionAmount" name="Redemption" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  <LabelList dataKey="RedemptionAmount" content={AmountLabel} />
                  {byWeekday.map((r) => (
                    <Cell key={r.key} fill={r.key === 'Saturday' || r.key === 'Sunday' ? COLORS.warning : COLORS.redemption} />
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

import React, { useMemo } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  Cell,
  LabelList
} from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { sumBy, groupSum, pivot } from '../lib/aggregate'
import { orderBy, MODE_ORDER, REGION_ORDER, WEEKDAY_ORDER } from '../lib/constants'
import { COLORS, MODE_COLORS, REGION_COLORS } from '../lib/theme'
import { fmtLacs, fmtNumber, fmtPct, fmtLacsAxis, monthLabel } from '../lib/format'
import Card from '../components/Card'
import Kpi from '../components/Kpi'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'
import { AmountLabel } from '../components/ChartLabels'

export default function Activation() {
  const { activationRows } = useFilters()

  const total = sumBy(activationRows, 'ActivationAmount')
  const totalCount = sumBy(activationRows, 'ActivationCount')
  const physicalRows = useMemo(() => activationRows.filter((r) => r.ActivationModeFinal === 'Physical'), [activationRows])
  const physicalTotal = sumBy(physicalRows, 'ActivationAmount')
  const physicalCount = sumBy(physicalRows, 'ActivationCount')
  const nonPhysicalTotal = total - physicalTotal
  const nonPhysicalCount = totalCount - physicalCount

  const regionalSplit = useMemo(() => {
    const g = groupSum(physicalRows, 'Region_Clean', ['ActivationAmount', 'ActivationCount'])
    return orderBy(g.map((r) => r.key), REGION_ORDER).map((k) => g.find((r) => r.key === k))
  }, [physicalRows])

  const channelSplit = useMemo(() => {
    const rows = activationRows.filter((r) => r.ActivationModeFinal !== 'Physical')
    const g = groupSum(rows, 'ActivationModeFinal', ['ActivationAmount', 'ActivationCount'])
    return orderBy(g.map((r) => r.key), MODE_ORDER).map((k) => g.find((r) => r.key === k))
  }, [activationRows])

  const monthTrend = useMemo(() => {
    const p = pivot(activationRows, 'YearMonth', 'ActivationModeFinal', 'ActivationAmount', 'ActivationCount')
    return p
      .sort((a, b) => (a.x > b.x ? 1 : -1))
      .map((r) => ({ ...r, label: monthLabel(r.x) }))
  }, [activationRows])

  const weekdayTrend = useMemo(() => {
    const g = groupSum(activationRows, 'Weekday', ['ActivationAmount', 'ActivationCount'])
    return orderBy(g.map((r) => r.key), WEEKDAY_ORDER).map((k) => g.find((r) => r.key === k))
  }, [activationRows])

  const hasData = activationRows.length > 0

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Total Activation" value={fmtLacs(total)} sub={`${fmtNumber(totalCount)} cards`} accent="gold" />
        <Kpi
          label="Physical"
          value={fmtLacs(physicalTotal)}
          sub={`${fmtNumber(physicalCount)} cards · ${fmtPct(total ? (physicalTotal / total) * 100 : 0)}`}
          accent="gold"
        />
        <Kpi
          label="Non-Physical"
          value={fmtLacs(nonPhysicalTotal)}
          sub={`${fmtNumber(nonPhysicalCount)} cards · ${fmtPct(total ? (nonPhysicalTotal / total) * 100 : 0)}`}
          accent="teal"
        />
        <Kpi label="Avg Ticket Size" value={totalCount ? fmtLacs(total / totalCount, 4) : '—'} sub="per card, ₹ Lacs" accent="navy" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Physical Activation — Regional Split" subtitle="Activation amount by region">
          {regionalSplit.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={regionalSplit} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={64} tickFormatter={fmtLacsAxis} />
                <Tooltip content={<ChartTooltip countField="ActivationCount" countUnit="cards" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
                <Bar dataKey="ActivationAmount" name="Activation" radius={[4, 4, 0, 0]} maxBarSize={56}>
                  <LabelList dataKey="ActivationAmount" content={AmountLabel} />
                  {regionalSplit.map((r) => (
                    <Cell key={r.key} fill={REGION_COLORS[r.key] || COLORS.activation} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Non-Physical Activation — Channel Split" subtitle="Aggregator / Corporate / Online">
          {channelSplit.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={channelSplit} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={64} tickFormatter={fmtLacsAxis} />
                <Tooltip content={<ChartTooltip countField="ActivationCount" countUnit="cards" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
                <Bar dataKey="ActivationAmount" name="Activation" radius={[4, 4, 0, 0]} maxBarSize={56}>
                  <LabelList dataKey="ActivationAmount" content={AmountLabel} />
                  {channelSplit.map((r) => (
                    <Cell key={r.key} fill={MODE_COLORS[r.key] || COLORS.teal} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card title="Month-wise Activation Trend" subtitle="By channel, ₹ Lacs">
        {!hasData ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={monthTrend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={64} tickFormatter={fmtLacsAxis} />
              <Tooltip content={<ChartTooltip countField={(p) => `${p.dataKey}__count`} countUnit="cards" />} />
              <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
              {MODE_ORDER.map((mode) => (
                <Line
                  key={mode}
                  type="monotone"
                  dataKey={mode}
                  name={mode}
                  stroke={MODE_COLORS[mode]}
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Week-slot Activation Trend" subtitle="Activation amount by weekday">
        {weekdayTrend.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={weekdayTrend} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
              <XAxis dataKey="key" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={64} tickFormatter={fmtLacsAxis} />
              <Tooltip content={<ChartTooltip countField="ActivationCount" countUnit="cards" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
              <Bar dataKey="ActivationAmount" name="Activation" fill={COLORS.activation} radius={[4, 4, 0, 0]} maxBarSize={56}>
                <LabelList dataKey="ActivationAmount" content={AmountLabel} />
                {weekdayTrend.map((r) => (
                  <Cell key={r.key} fill={r.key === 'Saturday' || r.key === 'Sunday' ? COLORS.redemption : COLORS.activation} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  )
}

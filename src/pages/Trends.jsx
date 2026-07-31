import React, { useMemo } from 'react'
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList } from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { groupSum } from '../lib/aggregate'
import { WEEKEND_DAYS } from '../lib/constants'
import { COLORS } from '../lib/theme'
import { monthLabel, fmtLacsAxis, fmtNumber } from '../lib/format'
import Card from '../components/Card'
import EmptyState from '../components/EmptyState'
import ChartTooltip, { countFormatter } from '../components/ChartTooltip'
import { AmountLabel } from '../components/ChartLabels'

export default function Trends() {
  const { activationRows, redemptionRows } = useFilters()

  const monthAmountTrend = useMemo(() => {
    const act = groupSum(activationRows, 'YearMonth', ['ActivationAmount', 'ActivationCount'])
    const red = groupSum(redemptionRows, 'YearMonth', ['RedemptionAmount', 'RedemptionCount'])
    const months = [...new Set([...act.map((r) => r.key), ...red.map((r) => r.key)])].sort()
    return months.map((m) => ({
      label: monthLabel(m),
      Activation: act.find((r) => r.key === m)?.ActivationAmount || 0,
      ActivationCount: act.find((r) => r.key === m)?.ActivationCount || 0,
      Redemption: red.find((r) => r.key === m)?.RedemptionAmount || 0,
      RedemptionCount: red.find((r) => r.key === m)?.RedemptionCount || 0
    }))
  }, [activationRows, redemptionRows])

  const monthCountTrend = useMemo(() => {
    const act = groupSum(activationRows, 'YearMonth', ['ActivationCount'])
    const red = groupSum(redemptionRows, 'YearMonth', ['RedemptionCount'])
    const months = [...new Set([...act.map((r) => r.key), ...red.map((r) => r.key)])].sort()
    return months.map((m) => ({
      label: monthLabel(m),
      Activation: act.find((r) => r.key === m)?.ActivationCount || 0,
      Redemption: red.find((r) => r.key === m)?.RedemptionCount || 0
    }))
  }, [activationRows, redemptionRows])

  const weekSlot = useMemo(() => {
    const slot = (weekday) => (WEEKEND_DAYS.has(weekday) ? 'Weekend' : 'Weekday')
    const actWeekday = activationRows.filter((r) => slot(r.Weekday) === 'Weekday')
    const actWeekend = activationRows.filter((r) => slot(r.Weekday) === 'Weekend')
    const redWeekday = redemptionRows.filter((r) => slot(r.Weekday) === 'Weekday')
    const redWeekend = redemptionRows.filter((r) => slot(r.Weekday) === 'Weekend')
    const sum = (rows, f) => rows.reduce((s, r) => s + (r[f] || 0), 0)
    return [
      {
        slot: 'Weekday',
        Activation: sum(actWeekday, 'ActivationAmount'),
        ActivationCount: sum(actWeekday, 'ActivationCount'),
        Redemption: sum(redWeekday, 'RedemptionAmount'),
        RedemptionCount: sum(redWeekday, 'RedemptionCount')
      },
      {
        slot: 'Weekend',
        Activation: sum(actWeekend, 'ActivationAmount'),
        ActivationCount: sum(actWeekend, 'ActivationCount'),
        Redemption: sum(redWeekend, 'RedemptionAmount'),
        RedemptionCount: sum(redWeekend, 'RedemptionCount')
      }
    ]
  }, [activationRows, redemptionRows])

  const hasData = activationRows.length > 0 || redemptionRows.length > 0

  return (
    <div className="flex flex-col gap-6">
      <Card title="Monthly Trend — Amount" subtitle="Activation vs. Redemption, ₹ Lacs">
        {!hasData ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={monthAmountTrend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={64} tickFormatter={fmtLacsAxis} />
              <Tooltip
                content={
                  <ChartTooltip
                    countField={(p) => (p.dataKey === 'Activation' ? 'ActivationCount' : 'RedemptionCount')}
                    countUnit={(p) => (p.dataKey === 'Activation' ? 'cards' : 'redemptions')}
                  />
                }
              />
              <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
              <Line type="monotone" dataKey="Activation" stroke={COLORS.activation} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="Redemption" stroke={COLORS.redemption} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Monthly Trend — Card Count" subtitle="Activation vs. Redemption transaction counts">
        {!hasData ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={monthCountTrend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={64} tickFormatter={fmtNumber} />
              <Tooltip content={<ChartTooltip formatter={countFormatter} />} />
              <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
              <Line type="monotone" dataKey="Activation" stroke={COLORS.activation} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="Redemption" stroke={COLORS.redemption} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Week-slot Overview" subtitle="Weekday vs. Weekend — Activation and Redemption amount, ₹ Lacs">
        {!hasData ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={weekSlot} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
              <XAxis dataKey="slot" tick={{ fontSize: 12, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} width={64} tickFormatter={fmtLacsAxis} />
              <Tooltip
                content={
                  <ChartTooltip
                    countField={(p) => (p.dataKey === 'Activation' ? 'ActivationCount' : 'RedemptionCount')}
                    countUnit={(p) => (p.dataKey === 'Activation' ? 'cards' : 'redemptions')}
                  />
                }
                cursor={{ fill: 'rgba(27,36,48,0.04)' }}
              />
              <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
              <Bar dataKey="Activation" fill={COLORS.activation} radius={[4, 4, 0, 0]} maxBarSize={72}>
                <LabelList dataKey="Activation" content={AmountLabel} />
              </Bar>
              <Bar dataKey="Redemption" fill={COLORS.redemption} radius={[4, 4, 0, 0]} maxBarSize={72}>
                <LabelList dataKey="Redemption" content={AmountLabel} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  )
}

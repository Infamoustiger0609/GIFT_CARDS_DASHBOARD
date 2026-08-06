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
import { sumBy, groupSum } from '../lib/aggregate'
import { computeComparisons } from '../lib/comparisons'
import { ACTIVATION_SOURCES, groupByActivationSource, pivotByActivationSource, sourceOf } from '../lib/activationSource'
import { orderBy, REGION_ORDER, WEEKDAY_ORDER, regionLabel } from '../lib/constants'
import { COLORS, REGION_COLORS, ACTIVATION_SOURCE_COLORS, CARD_TYPE_COLORS, categoricalColor } from '../lib/theme'
import { fmtLacs, fmtNumber, fmtPct, fmtLacsAxis, monthLabel } from '../lib/format'
import Card from '../components/Card'
import Kpi from '../components/Kpi'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'
import { AmountLabel } from '../components/ChartLabels'

// Kpi's accent prop only has 4 fixed colors; map each source to whichever
// reads closest to its ACTIVATION_SOURCE_COLORS hex (Aggregators' blue has
// no existing accent slot, added to Kpi.jsx alongside gold/teal/coral/navy).
const SOURCE_ACCENT = { Corporate: 'teal', Aggregators: 'blue', Cinema: 'gold' }

export default function Activation() {
  const { activationRows, activationRowsAllMonths, comparisonMonths } = useFilters()

  const total = sumBy(activationRows, 'ActivationAmount')
  const totalCount = sumBy(activationRows, 'ActivationCount')
  const deltas = useMemo(
    () => computeComparisons(activationRowsAllMonths, 'ActivationAmount', comparisonMonths),
    [activationRowsAllMonths, comparisonMonths]
  )

  // ---- 3-source split (Aggregators / Corporate / Cinema), each by CardType ----
  const bySource = useMemo(
    () => groupByActivationSource(activationRows, { modeField: 'ActivationModeFinal', amountField: 'ActivationAmount', countField: 'ActivationCount' }),
    [activationRows]
  )

  // Per-source MoM/QoQ/YoY deltas, same "AllMonths" pool the headline KPI's
  // own deltas use, just further split by sourceOf() first — bringing
  // these up to the same info-parity level as the headline KPI (which
  // already had deltas) and every other "% but no deltas" KPI on this page.
  const sourceDeltas = useMemo(() => {
    const map = {}
    for (const s of ACTIVATION_SOURCES) {
      const rows = activationRowsAllMonths.filter((r) => sourceOf(r.ActivationModeFinal) === s.key)
      map[s.key] = computeComparisons(rows, 'ActivationAmount', comparisonMonths)
    }
    return map
  }, [activationRowsAllMonths, comparisonMonths])
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

  // Cinema = ActivationModeFinal === 'Physical' (same rows the old "Physical
  // Activation — Regional Split" chart used, just renamed to match the
  // 3-source model's label).
  const cinemaRows = useMemo(() => activationRows.filter((r) => r.ActivationModeFinal === 'Physical'), [activationRows])
  const regionalSplit = useMemo(() => {
    const g = groupSum(cinemaRows, 'Region_Clean', ['ActivationAmount', 'ActivationCount'])
    return orderBy(g.map((r) => r.key), REGION_ORDER).map((k) => g.find((r) => r.key === k))
  }, [cinemaRows])

  const monthTrend = useMemo(() => {
    const p = pivotByActivationSource(activationRows, 'YearMonth', {
      modeField: 'ActivationModeFinal',
      amountField: 'ActivationAmount',
      countField: 'ActivationCount'
    })
    return p.sort((a, b) => (a.x > b.x ? 1 : -1)).map((r) => ({ ...r, label: monthLabel(r.x) }))
  }, [activationRows])

  const weekdayTrend = useMemo(() => {
    const g = groupSum(activationRows, 'Weekday', ['ActivationAmount', 'ActivationCount'])
    return orderBy(g.map((r) => r.key), WEEKDAY_ORDER).map((k) => g.find((r) => r.key === k))
  }, [activationRows])

  const hasData = activationRows.length > 0
  const hasSourceData = sourceChartData.some((s) => s.digitalAmount || s.physicalAmount)

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Kpi
          label="Total Activation"
          value={fmtLacs(total)}
          sub={`${fmtNumber(totalCount)} cards`}
          accent="gold"
          deltas={[
            { label: 'MoM', pct: deltas.mom },
            { label: 'QoQ', pct: deltas.qoq },
            { label: 'YoY', pct: deltas.yoy }
          ]}
        />
        {bySource.map((s) => (
          <Kpi
            key={s.key}
            label={s.key}
            value={fmtLacs(s.amount)}
            sub={`${fmtNumber(s.count)} cards · ${fmtPct(total ? (s.amount / total) * 100 : 0)}`}
            accent={SOURCE_ACCENT[s.key]}
            deltas={[
              { label: 'MoM', pct: sourceDeltas[s.key]?.mom },
              { label: 'QoQ', pct: sourceDeltas[s.key]?.qoq },
              { label: 'YoY', pct: sourceDeltas[s.key]?.yoy }
            ]}
          />
        ))}
        <Kpi label="Avg Ticket Size" value={totalCount ? fmtLacs(total / totalCount, 4) : '—'} sub="per card, ₹ Lacs" accent="navy" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Cinema Activation — Regional Split" subtitle="Activation amount by region">
          {regionalSplit.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={regionalSplit} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
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
                  content={<ChartTooltip countField="ActivationCount" countUnit="cards" />}
                  labelFormatter={regionLabel}
                  cursor={{ fill: 'rgba(27,36,48,0.04)' }}
                />
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

        <Card title="Activation by Source" subtitle="Aggregators / Corporate / Cinema, split by card type, ₹ Lacs">
          {!hasSourceData ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
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
                <Bar dataKey="physicalAmount" name="Physical" stackId="source" fill={CARD_TYPE_COLORS.Physical} radius={[4, 4, 0, 0]} maxBarSize={64} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card title="Month-wise Activation Trend" subtitle="By source, ₹ Lacs">
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
              <Tooltip content={<ChartTooltip countField={(p) => `${p.dataKey}__count`} countUnit="cards" />} />
              <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
              {ACTIVATION_SOURCES.map(({ key }) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={key}
                  stroke={ACTIVATION_SOURCE_COLORS[key]}
                  strokeWidth={3}
                  dot={{ r: 3 }}
                  activeDot={{ r: 6 }}
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
              <YAxis
                tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                axisLine={false}
                tickLine={false}
                width={64}
                tickFormatter={fmtLacsAxis}
                label={{ value: '₹ in Lakhs', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
              />
              <Tooltip content={<ChartTooltip countField="ActivationCount" countUnit="cards" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
              <Bar dataKey="ActivationAmount" name="Activation" radius={[4, 4, 0, 0]} maxBarSize={56}>
                <LabelList dataKey="ActivationAmount" content={AmountLabel} />
                {weekdayTrend.map((r, i) => (
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

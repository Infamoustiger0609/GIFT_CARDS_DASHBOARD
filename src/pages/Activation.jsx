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
import { orderBy, REGION_ORDER, WEEKDAY_ORDER, DENOM_ORDER, regionLabel } from '../lib/constants'
import { COLORS, REGION_COLORS, ACTIVATION_SOURCE_COLORS, CARD_TYPE_COLORS, categoricalColor } from '../lib/theme'
import { fmtLacs, fmtRupees, fmtNumber, fmtPct, fmtLacsAxis, monthLabel } from '../lib/format'
import Card from '../components/Card'
import Kpi from '../components/Kpi'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'
import { AmountLabel, stackTotalLabel } from '../components/ChartLabels'

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

  // Chart-parity pass (2026-08-12): "by Denomination" existed only as a
  // combined Activation-vs-Redemption chart on Overview.jsx — added here
  // (and to both Redemption pages) so each page has its own scoped version,
  // same DENOM_ORDER 11-bucket list Overview/the Denomination filter use.
  //
  // 2026-08-14 fix: this chart used to silently exclude Denom values
  // outside the 11-bucket list ('N/A'/'Other') before summing, which made
  // its own total drift from this page's own "Total Activation" KPI right
  // above it — the excluded rows carry a real, negative amount (~134
  // correction/adjustment rows, documented in the 2026-08-03 "3-source
  // activation flow" entry), so dropping them *inflated* the visible sum
  // above the true total by exactly that amount (checked directly:
  // ₹8,347.19L shown vs. ₹8,266.57L actual — an ₹80.61L gap). A chart whose
  // entire purpose is decomposing this page's own headline KPI needs to sum
  // back to it exactly, unlike Overview's combined Activation-vs-Redemption
  // Denomination chart (a different, cross-cube comparison with no single
  // KPI it's meant to reconcile against, left as-is). Fixed by keeping the
  // 11 named buckets and folding everything else into an explicit "Other"
  // bucket (gray, same reserved color as topNWithOther's own "Other"
  // convention) instead of dropping it — same "show it, don't hide it"
  // rule as the Redemption Heads Breakdown chart's visible Cancellation bar.
  const byDenomination = useMemo(() => {
    const g = groupSum(activationRows, 'Denom', ['ActivationAmount', 'ActivationCount'])
    const named = DENOM_ORDER.map((d) => g.find((r) => r.key === d) || { key: d, ActivationAmount: 0, ActivationCount: 0 })
    const otherRows = activationRows.filter((r) => !DENOM_ORDER.includes(r.Denom))
    if (otherRows.length === 0) return named
    return [...named, { key: 'Other', ActivationAmount: sumBy(otherRows, 'ActivationAmount'), ActivationCount: sumBy(otherRows, 'ActivationCount') }]
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
        <Kpi label="Avg Ticket Size" value={totalCount ? fmtRupees(total / totalCount) : '—'} sub="per card" accent="navy" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Cinema Activation — Regional Split">
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

        <Card title="Activation by Source">
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
                <Bar dataKey="physicalAmount" name="Physical" stackId="source" fill={CARD_TYPE_COLORS.Physical} radius={[4, 4, 0, 0]} maxBarSize={64}>
                  <LabelList dataKey="physicalAmount" content={stackTotalLabel(sourceChartData, ['digitalAmount', 'physicalAmount'])} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card title="Month-wise Activation Trend">
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

      <Card title="Week-slot Activation Trend">
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

      <Card title="Activation by Denomination">
        {byDenomination.every((d) => d.ActivationAmount === 0) ? (
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
              <Tooltip content={<ChartTooltip countField="ActivationCount" countUnit="cards" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
              <Bar dataKey="ActivationAmount" name="Activation" radius={[4, 4, 0, 0]} maxBarSize={44}>
                <LabelList dataKey="ActivationAmount" content={AmountLabel} />
                {byDenomination.map((r, i) => (
                  <Cell key={r.key} fill={categoricalColor(i, r.key === 'Other')} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  )
}

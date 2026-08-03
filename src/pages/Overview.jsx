import React, { useMemo } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LabelList
} from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { sumBy, groupSum } from '../lib/aggregate'
import { computeComparisons } from '../lib/comparisons'
import { orderBy, MODE_ORDER, REGION_ORDER } from '../lib/constants'
import { COLORS, REGION_COLORS, HEAD_COLORS, ACTIVATION_SOURCE_COLORS, CARD_TYPE_COLORS } from '../lib/theme'
import { fmtLacs, fmtPct, fmtNumber, fmtLacsAxis, monthLabel } from '../lib/format'
import Card from '../components/Card'
import Kpi from '../components/Kpi'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'
import { FlowBox, FlowBranch } from '../components/FlowBox'
import { PctLabel, donutLabel } from '../components/ChartLabels'

const ACTIVATION_SOURCES = [
  { key: 'PVR Corporate', modes: ['Corporate', 'Online'] },
  { key: 'Aggregators', modes: ['Aggregator'] },
  { key: 'Cinema', modes: ['Physical'] }
]

export default function Overview() {
  const { activationRows, redemptionRows, activationRowsAllMonths, redemptionRowsAllMonths, comparisonMonths } = useFilters()

  const totalActivation = sumBy(activationRows, 'ActivationAmount')
  const totalRedemption = sumBy(redemptionRows, 'RedemptionAmount')
  const totalActivationCount = sumBy(activationRows, 'ActivationCount')
  const totalRedemptionCount = sumBy(redemptionRows, 'RedemptionCount')
  const totalUptake = sumBy(redemptionRows, 'Uptake')
  const overallRedemptionPct = totalActivation > 0 ? (totalRedemption / totalActivation) * 100 : NaN

  const activationDeltas = useMemo(
    () => computeComparisons(activationRowsAllMonths, 'ActivationAmount', comparisonMonths),
    [activationRowsAllMonths, comparisonMonths]
  )
  const redemptionDeltas = useMemo(
    () => computeComparisons(redemptionRowsAllMonths, 'RedemptionAmount', comparisonMonths),
    [redemptionRowsAllMonths, comparisonMonths]
  )

  // ---- Activation flow: 3 origin sources, each split by CardType ----
  // "PVR Corporate" merges the Corporate + Online modes (per clarification:
  // PVR Inox Online + PVR-Corporate together represent the Corporate
  // channel's redeem/activate split). ActivationModeFinal has exactly 4
  // values (Aggregator, Corporate, Online, Physical), so every row lands in
  // exactly one of these 3 buckets — no leftover "Other" group.
  const activationBySource = useMemo(() => {
    return ACTIVATION_SOURCES.map(({ key, modes }) => {
      const rows = activationRows.filter((r) => modes.includes(r.ActivationModeFinal))
      const amount = sumBy(rows, 'ActivationAmount')
      const count = sumBy(rows, 'ActivationCount')
      const digitalRows = rows.filter((r) => r.CardType === 'Digital')
      const physicalRows = rows.filter((r) => r.CardType === 'Physical')
      let digitalAmount = sumBy(digitalRows, 'ActivationAmount')
      let physicalAmount = sumBy(physicalRows, 'ActivationAmount')
      // A handful of rows carry no CardType (small correction/adjustment
      // entries, always zero count) — fold that remainder into whichever
      // bucket is larger so Digital + Physical always sums exactly back to
      // the source total, and neither bucket is ever pushed negative.
      const unclassified = amount - digitalAmount - physicalAmount
      if (digitalAmount >= physicalAmount) digitalAmount += unclassified
      else physicalAmount += unclassified
      return {
        key,
        amount,
        count,
        digital: { amount: digitalAmount, count: sumBy(digitalRows, 'ActivationCount') },
        physical: { amount: physicalAmount, count: sumBy(physicalRows, 'ActivationCount') }
      }
    })
  }, [activationRows])

  // ---- Redemption flow: by Head ----
  const byHead = useMemo(() => {
    const g = groupSum(redemptionRows, 'Head', ['RedemptionAmount', 'RedemptionCount'])
    return orderBy(g.map((r) => r.key), ['Online', 'Box Office', 'F&B', 'Cancellation']).map((k) => g.find((r) => r.key === k))
  }, [redemptionRows])
  const cancellationRow = byHead.find((h) => h.key === 'Cancellation')
  const positiveHeads = byHead.filter((h) => h.key !== 'Cancellation')

  // ---- Redemption % per mode (join ActivationModeFinal <-> ActivationMode) ----
  const redemptionPctByMode = useMemo(() => {
    const actByMode = groupSum(activationRows, 'ActivationModeFinal', ['ActivationAmount'])
    const redByMode = groupSum(redemptionRows, 'ActivationMode', ['RedemptionAmount'])
    return MODE_ORDER.map((mode) => {
      const act = actByMode.find((r) => r.key === mode)?.ActivationAmount || 0
      const red = redByMode.find((r) => r.key === mode)?.RedemptionAmount || 0
      return { mode, pct: act > 0 ? (red / act) * 100 : 0, act, red }
    })
  }, [activationRows, redemptionRows])

  // ---- Overall region contribution (activation amount) ----
  const regionContribution = useMemo(() => {
    const g = groupSum(activationRows, 'Region_Clean', ['ActivationAmount', 'ActivationCount'])
    return orderBy(g.map((r) => r.key), REGION_ORDER)
      .map((k) => g.find((r) => r.key === k))
      .filter((r) => r.ActivationAmount !== 0)
  }, [activationRows])

  // ---- Pan-India month-wise trend ----
  const monthTrend = useMemo(() => {
    const act = groupSum(activationRows, 'YearMonth', ['ActivationAmount', 'ActivationCount'])
    const red = groupSum(redemptionRows, 'YearMonth', ['RedemptionAmount', 'RedemptionCount'])
    const months = [...new Set([...act.map((r) => r.key), ...red.map((r) => r.key)])].sort()
    return months.map((m) => ({
      month: m,
      label: monthLabel(m),
      Activation: act.find((r) => r.key === m)?.ActivationAmount || 0,
      ActivationCount: act.find((r) => r.key === m)?.ActivationCount || 0,
      Redemption: red.find((r) => r.key === m)?.RedemptionAmount || 0,
      RedemptionCount: red.find((r) => r.key === m)?.RedemptionCount || 0
    }))
  }, [activationRows, redemptionRows])

  const hasData = activationRows.length > 0 || redemptionRows.length > 0

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi
          label="Revenue/Activation Amount"
          value={fmtLacs(totalActivation)}
          sub={`${fmtNumber(totalActivationCount)} cards`}
          accent="gold"
          deltas={[
            { label: 'MoM', pct: activationDeltas.mom },
            { label: 'QoQ', pct: activationDeltas.qoq },
            { label: 'YoY', pct: activationDeltas.yoy }
          ]}
        />
        <Kpi
          label="Total Redemption (net)"
          value={fmtLacs(totalRedemption)}
          sub={`${fmtNumber(totalRedemptionCount)} redemptions · ${fmtPct(overallRedemptionPct, 0)} of total activation`}
          accent="teal"
          deltas={[
            { label: 'MoM', pct: redemptionDeltas.mom },
            { label: 'QoQ', pct: redemptionDeltas.qoq },
            { label: 'YoY', pct: redemptionDeltas.yoy }
          ]}
        />
        <Kpi label="Uptake" value={fmtLacs(totalUptake)} sub={`${fmtNumber(totalRedemptionCount)} redemptions`} accent="navy" />
        <Kpi
          label="Cancellations"
          value={cancellationRow ? fmtLacs(Math.abs(cancellationRow.RedemptionAmount)) : '₹0.00 L'}
          sub={`${fmtNumber(cancellationRow?.RedemptionCount || 0)} cancellations · netted into total`}
          accent="coral"
        />
      </div>

      <Card title="Gift Card Process Flow" subtitle="Activation channels and redemption heads, current filter selection">
        {!hasData ? (
          <EmptyState />
        ) : (
          <div className="grid md:grid-cols-2 gap-8 md:gap-4 overflow-x-auto pb-2">
            {/* Activation flow */}
            <div className="flex flex-col items-center min-w-[460px]">
              <div className="text-xs font-semibold uppercase tracking-wide text-gold mb-2">Activation</div>
              <FlowBox label="Total Activation" amount={totalActivation} count={totalActivationCount} color={COLORS.activation} size="lg" />
              <FlowBranch>
                {activationBySource.map((src) => (
                  <FlowBox
                    key={src.key}
                    label={src.key}
                    amount={src.amount}
                    count={src.count}
                    pct={totalActivation ? (src.amount / totalActivation) * 100 : 0}
                    color={ACTIVATION_SOURCE_COLORS[src.key]}
                  />
                ))}
              </FlowBranch>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full mt-6">
                {activationBySource.map((src) => (
                  <div key={src.key} className="flex flex-col items-center gap-2">
                    <div className="text-[10px] font-semibold uppercase text-warmgray-muted">{src.key}</div>
                    <FlowBox
                      label="Digital"
                      amount={src.digital.amount}
                      count={src.digital.count}
                      pct={src.amount ? (src.digital.amount / src.amount) * 100 : 0}
                      color={CARD_TYPE_COLORS.Digital}
                    />
                    <FlowBox
                      label="Physical"
                      amount={src.physical.amount}
                      count={src.physical.count}
                      pct={src.amount ? (src.physical.amount / src.amount) * 100 : 0}
                      color={CARD_TYPE_COLORS.Physical}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Redemption flow */}
            <div className="flex flex-col items-center min-w-[380px]">
              <div className="text-xs font-semibold uppercase tracking-wide text-teal mb-2">Redemption</div>
              <FlowBox
                label="Total Redemption (net)"
                amount={totalRedemption}
                count={totalRedemptionCount}
                countUnit="redemptions"
                color={COLORS.redemption}
                size="lg"
              />
              <FlowBranch>
                {positiveHeads.map((h) => (
                  <FlowBox
                    key={h.key}
                    label={h.key}
                    amount={h.RedemptionAmount}
                    count={h.RedemptionCount}
                    countUnit="redemptions"
                    pct={totalRedemption ? (h.RedemptionAmount / totalRedemption) * 100 : 0}
                    color={HEAD_COLORS[h.key] || COLORS.inkMuted}
                  />
                ))}
              </FlowBranch>
              {cancellationRow && (
                <div className="mt-6 text-xs text-coral bg-coral-light rounded-md px-3 py-2">
                  Cancellations: {fmtLacs(cancellationRow.RedemptionAmount, 2)} ({fmtNumber(cancellationRow.RedemptionCount)}{' '}
                  transactions) netted into the total above (not excluded)
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Redemption % by Mode" subtitle="Redemption amount ÷ Activation amount, per origin channel">
          {redemptionPctByMode.every((r) => r.pct === 0) ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={redemptionPctByMode} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                <XAxis dataKey="mode" tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: COLORS.inkMuted }} axisLine={false} tickLine={false} unit="%" width={40} />
                <Tooltip content={<ChartTooltip formatter={(v) => fmtPct(v)} />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
                <Bar dataKey="pct" name="Redemption %" fill={COLORS.redemption} radius={[4, 4, 0, 0]} maxBarSize={56}>
                  <LabelList dataKey="pct" content={PctLabel} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Region Contribution" subtitle="Share of total activation amount by region">
          {regionContribution.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={regionContribution}
                  dataKey="ActivationAmount"
                  nameKey="key"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                  strokeWidth={3}
                  stroke="#ffffff"
                  label={donutLabel}
                  labelLine={false}
                >
                  {regionContribution.map((r) => (
                    <Cell key={r.key} fill={REGION_COLORS[r.key] || COLORS.inkMuted} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip countField="ActivationCount" countUnit="cards" />} />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  formatter={(value) => <span className="text-xs text-navy">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card title="Pan-India Monthly Trend" subtitle="Activation vs. Redemption, ₹ Lacs">
        {monthTrend.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={monthTrend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
              <Line type="monotone" dataKey="Activation" stroke={COLORS.activationDark} strokeWidth={3} dot={{ r: 3.5 }} activeDot={{ r: 6 }} />
              <Line type="monotone" dataKey="Redemption" stroke={COLORS.redemption} strokeWidth={3} dot={{ r: 3.5 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  )
}

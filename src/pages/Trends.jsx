import React, { useMemo } from 'react'
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList } from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { groupSum, weekSlotBreakdown } from '../lib/aggregate'
import { usePresetWindow } from '../lib/comparisons'
import { COLORS } from '../lib/theme'
import { monthLabel, fmtLacsAxis, fmtNumber } from '../lib/format'
import Card from '../components/Card'
import EmptyState from '../components/EmptyState'
import ChartTooltip, { countFormatter } from '../components/ChartTooltip'
import { AmountLabel } from '../components/ChartLabels'

export default function Trends() {
  const { activationRows, redemptionRows } = useFilters()

  // 2026-08-29: MTD/QTD(Q1-Q4 dropdown)/YTD preset control, via the same
  // shared usePresetWindow() hook every other page's KPI ribbon now uses —
  // this page has no KPI/delta badge to collapse (confirmed: no comparison
  // logic exists anywhere in this file, see CLAUDE.md's own audit note),
  // but the control still does something real here — it sets the same
  // FY/Month filter every chart below already respects, exposed the same
  // consistent way as on every other page, and the date line states
  // exactly which window is currently selected.
  const { quarterOptions, activePreset, activeQuarter, qtdMenuOpen, setQtdMenuOpen, qtdMenuRef, applyPreset, applyQuarter, windowDateRangeLabel } =
    usePresetWindow()

  const monthAmountTrend = useMemo(() => {
    const act = groupSum(activationRows, 'YearMonth', ['ActivationAmount', 'ActivationCount'])
    const red = groupSum(redemptionRows, 'YearMonth', ['RedemptionAmount', 'UniqueCardCount'])
    const months = [...new Set([...act.map((r) => r.key), ...red.map((r) => r.key)])].sort()
    return months.map((m) => ({
      label: monthLabel(m),
      Activation: act.find((r) => r.key === m)?.ActivationAmount || 0,
      ActivationCount: act.find((r) => r.key === m)?.ActivationCount || 0,
      Redemption: red.find((r) => r.key === m)?.RedemptionAmount || 0,
      RedemptionCardCount: red.find((r) => r.key === m)?.UniqueCardCount || 0
    }))
  }, [activationRows, redemptionRows])

  // 2026-08-20: "Card Count" per this chart's own title — UniqueCardCount
  // (distinct cards), not RedemptionCount (transaction count), same swap as
  // every other "X redemptions" display dashboard-wide.
  const monthCountTrend = useMemo(() => {
    const act = groupSum(activationRows, 'YearMonth', ['ActivationCount'])
    const red = groupSum(redemptionRows, 'YearMonth', ['UniqueCardCount'])
    const months = [...new Set([...act.map((r) => r.key), ...red.map((r) => r.key)])].sort()
    return months.map((m) => ({
      label: monthLabel(m),
      Activation: act.find((r) => r.key === m)?.ActivationCount || 0,
      Redemption: red.find((r) => r.key === m)?.UniqueCardCount || 0
    }))
  }, [activationRows, redemptionRows])

  const weekSlot = useMemo(() => weekSlotBreakdown(activationRows, redemptionRows), [activationRows, redemptionRows])

  const hasData = activationRows.length > 0 || redemptionRows.length > 0

  return (
    <div className="flex flex-col gap-6">
      {/* 2026-08-29: MTD/QTD(Q1-Q4 dropdown)/YTD control row + single
          top-left comparison-date line — copied verbatim from Overview.jsx's
          own render, not a re-styled approximation. No delta badge exists
          on this page to collapse, but the control still narrows the same
          FY/Month filter every chart below already respects. */}
      <div className="flex justify-between items-center gap-2 -mb-2 flex-wrap">
        <p className="text-xs italic text-warmgray-muted">{windowDateRangeLabel}</p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => applyPreset('mtd')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
              activePreset === 'mtd' ? 'bg-gold text-navy' : 'bg-card border border-warmgray-border text-warmgray-muted hover:border-gold hover:text-navy'
            }`}
          >
            MTD
          </button>
          <div className="relative" ref={qtdMenuRef}>
            <button
              type="button"
              onClick={() => setQtdMenuOpen((o) => !o)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                activePreset === 'qtd' ? 'bg-gold text-navy' : 'bg-card border border-warmgray-border text-warmgray-muted hover:border-gold hover:text-navy'
              }`}
            >
              {activePreset === 'qtd' && activeQuarter ? `Q${activeQuarter}` : 'QTD'} ▾
            </button>
            {qtdMenuOpen && (
              <div className="absolute z-50 top-full right-0 mt-1 bg-card border border-warmgray-border rounded-md shadow-lg py-1 w-28">
                {quarterOptions.map((q) => (
                  <button
                    key={q.key}
                    type="button"
                    disabled={q.disabled}
                    onClick={() => applyQuarter(q)}
                    title={q.disabled ? 'No data yet for this quarter' : q.months.join(', ')}
                    className={`w-full text-left px-3 py-1.5 text-xs font-medium ${
                      q.disabled
                        ? 'text-warmgray-muted/50 cursor-not-allowed'
                        : activePreset === 'qtd' && activeQuarter === q.key
                          ? 'bg-gold-light text-navy font-semibold'
                          : 'text-navy hover:bg-cream cursor-pointer'
                    }`}
                  >
                    {q.label}
                    {!q.disabled && q.months.length < 3 && <span className="text-[10px] text-warmgray-muted ml-1">(to date)</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => applyPreset('ytd')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
              activePreset === 'ytd' ? 'bg-gold text-navy' : 'bg-card border border-warmgray-border text-warmgray-muted hover:border-gold hover:text-navy'
            }`}
          >
            YTD
          </button>
        </div>
      </div>
      <Card title="Monthly Trend — Amount">
        {!hasData ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={monthAmountTrend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
              <Tooltip
                content={
                  <ChartTooltip
                    countField={(p) => (p.dataKey === 'Activation' ? 'ActivationCount' : 'RedemptionCardCount')}
                    countUnit="cards"
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

      <Card title="Monthly Trend — Card Count">
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
              <Line type="monotone" dataKey="Activation" stroke={COLORS.activationDark} strokeWidth={3} dot={{ r: 3.5 }} activeDot={{ r: 6 }} />
              <Line type="monotone" dataKey="Redemption" stroke={COLORS.redemption} strokeWidth={3} dot={{ r: 3.5 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Week-slot Overview">
        {!hasData ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={weekSlot} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
              <XAxis dataKey="slot" tick={{ fontSize: 12, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
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
                    countField={(p) => (p.dataKey === 'Activation' ? 'ActivationCount' : 'RedemptionCardCount')}
                    countUnit="cards"
                  />
                }
                cursor={{ fill: 'rgba(27,36,48,0.04)' }}
              />
              <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
              <Bar dataKey="Activation" fill={COLORS.activationDark} radius={[4, 4, 0, 0]} maxBarSize={72}>
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

import React, { useEffect, useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, LabelList, ReferenceLine } from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { sumBy, groupSum, netBucketsProportionally, REAL_HEAD_BUCKETS, isCancellationRow } from '../lib/aggregate'
import { COLORS, HEAD_COLORS } from '../lib/theme'
import { fmtLacs, fmtNumber, fmtPct, fmtLacsAxis, monthLabel } from '../lib/format'
import Card from '../components/Card'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'
import { AmountLabel, DivergingAmountLabel } from '../components/ChartLabels'

// 2026-08-13, rebuilt twice the same day as cohortCube.json's own schema
// grew a second date field. First rewrite replaced "redemptions happening
// in the selected period" (same shape as Overview's own two KPIs) with a
// "to-date" cohort total (activation period fixed, redemption unbounded).
// This second rewrite narrows that further per an explicit follow-up
// request: "of cards activated in this period, how much got redeemed
// *within that same period*" — both ActivationYearMonth and
// RedemptionYearMonth must independently satisfy the current FY/Month
// selection (see FilterContext.jsx#filterCohort). The "to-date"/spillover
// question didn't go away — it's now the bonus chart at the bottom, using
// the same cube's `cohortRowsByActivation` pool (activation-only
// restricted), since the wider cube schema answers both questions at once.
export default function CardJourney() {
  const { activationRows, cohortRows, cohortRowsByActivation, loadCohortCube, cohortLoading, cohortError } = useFilters()

  // 2026-08-16: cohortCube.json (17MB+, only this page reads it) is no
  // longer part of the app's eager initial load — every other page would
  // otherwise pay for fetching/parsing it on every visit for no reason. This
  // page kicks the fetch off itself on mount instead; loadCohortCube() is a
  // no-op after the first call (see FilterContext.jsx), so navigating away
  // and back doesn't re-fetch.
  useEffect(() => {
    loadCohortCube()
  }, [loadCohortCube])

  // "Activated in This Period" — identical computation to Overview's own
  // headline Activation KPI (same activationRows pool), unchanged.
  const totalActivation = sumBy(activationRows, 'ActivationAmount')
  const totalActivationCount = sumBy(activationRows, 'ActivationCount')

  // "Redeemed Within This Period" — amount is net across every Head
  // (Cancellation rows carry a real negative RedemptionAmount and net in
  // automatically, same convention as every other net figure in this
  // app). Count deliberately excludes Head='Cancellation' rows entirely —
  // a cancellation isn't a redemption event to count, same "count excludes
  // cancellations, amount nets them in" split already established
  // elsewhere in this app (e.g. the 2026-07-31/2026-08-04 Mode-filter
  // entries' own count-convention notes).
  const redeemedAmount = sumBy(cohortRows, 'RedemptionAmount')
  const redeemedNonCancelRows = useMemo(() => cohortRows.filter((r) => !isCancellationRow(r)), [cohortRows])
  const redeemedCount = sumBy(redeemedNonCancelRows, 'RedemptionCount')

  const samePeriodRedemptionRate = totalActivation > 0 ? (redeemedAmount / totalActivation) * 100 : NaN

  // 2026-08-15: was a plain groupSum(cohortRows, 'Head', ...) including
  // Cancellation as its own 4th bar — Cancellation should only ever be a
  // visible category on the dedicated Cancel Redeem page, so its amount is
  // now netted proportionally into Online/Box Office/F&B instead (see
  // lib/aggregate.js#netBucketsProportionally). The 3 bars now sum exactly
  // to "Of Those, Redeemed" above, by construction — that KPI is
  // sumBy(cohortRows, 'RedemptionAmount'), the same total this netting
  // redistributes without dropping or double-counting any of it.
  const byHead = useMemo(
    () => netBucketsProportionally(cohortRows, REAL_HEAD_BUCKETS, isCancellationRow, 'RedemptionAmount', 'RedemptionCount'),
    [cohortRows]
  )

  // ---- Bonus: spillover ---- cards activated in the selected period,
  // grouped by whichever month they actually got redeemed in — including
  // months outside the selection entirely (before the data's very first
  // month can't happen, since nothing redeems before it's activated, but
  // well after the period is common and is the whole point of this
  // chart).
  //
  // 2026-08-16: added the Activation side of the same cohort as an up
  // (positive) series against the Redemption tail's down (negative) series
  // — a diverging bar chart, not two separately-scaled charts, so a viewer
  // sees at a glance which months are the activation window itself (an up
  // bar present) versus pure spillover (only a down bar, no up bar for that
  // month). This replaces the earlier within-period/outside-period
  // teal/gold Cell coloring on the Redemption bars alone — that distinction
  // is now conveyed structurally (up+down bar together = within the
  // activation window; down bar alone = spillover) rather than by a 2nd
  // color pair, and the chart now uses this app's dominant "gold=
  // Activation, teal=Redemption" 2-series convention (Year-on-Year, the
  // Denomination comparison, etc.) instead of a one-off scheme.
  //
  // Activation-by-month comes from `activationRows` (already filtered to
  // the selected period) grouped by its own YearMonth — not the cohort
  // cube, which carries no ActivationAmount measure at all (only
  // RedemptionAmount/RedemptionCount/Uptake) — so by construction it can
  // only ever cover the activation period's own months, and sums exactly
  // to "Cards Activated" above (same activationRows, same field, just
  // broken out by month instead of summed once). Redemption-by-month is
  // unchanged from the original spillover computation (cohortRowsByActivation
  // grouped by RedemptionYearMonth) and still sums exactly to
  // sumBy(cohortRowsByActivation, 'RedemptionAmount') — this cohort's full
  // to-date redemption total, not "Of Those, Redeemed" above (which is the
  // narrower same-period-only figure) unless the selected period happens to
  // be the most recent one with nothing yet to spill into.
  const spillover = useMemo(() => {
    const actByMonth = groupSum(activationRows, 'YearMonth', ['ActivationAmount', 'ActivationCount'])
    const redByMonth = groupSum(cohortRowsByActivation, 'RedemptionYearMonth', ['RedemptionAmount', 'RedemptionCount'])
    const months = [...new Set([...actByMonth.map((r) => r.key), ...redByMonth.map((r) => r.key)])].sort()
    return months.map((m) => {
      const act = actByMonth.find((r) => r.key === m)
      const red = redByMonth.find((r) => r.key === m)
      const redemptionAmount = red?.RedemptionAmount || 0
      return {
        key: m,
        label: monthLabel(m),
        Activation: act?.ActivationAmount || 0,
        ActivationCount: act?.ActivationCount || 0,
        Redemption: redemptionAmount,
        RedemptionDown: -redemptionAmount,
        RedemptionCount: red?.RedemptionCount || 0
      }
    })
  }, [activationRows, cohortRowsByActivation])

  const hasData = activationRows.length > 0 || cohortRowsByActivation.length > 0
  // Both cohort-fed charts below share one empty/loading/error message —
  // distinguishes "still fetching the (large, lazily-loaded) cohort cube"
  // and "cube failed to load" from the generic "no rows match the current
  // filters", which would otherwise read as a real (mis)diagnosis during
  // the brief window before the fetch resolves.
  const cohortEmptyMessage = cohortError
    ? "Couldn't load cohort data."
    : cohortLoading
    ? 'Loading cohort data…'
    : undefined

  return (
    <div className="flex flex-col gap-6">
      {/* Deliberately NOT the Kpi-ribbon-plus-FlowBox visual language
          Overview's "Activation vs. Redemption" uses — a horizontal
          funnel (Activated -> tracked forward -> Redeemed -> Rate) reads
          as a distinct kind of comparison at a glance, not a relabeled
          copy of Overview's diagram. Border/padding/typography otherwise
          match Card.jsx/Kpi.jsx exactly (2026-08-13 consistency pass) —
          the only intentional deviation from a plain Card.jsx is the
          `border-l-[6px] border-l-gold` accent, the same pattern Kpi.jsx's
          own `accent="gold"` cards already use elsewhere in this app, not
          a one-off treatment invented for this page. */}
      <div className="bg-card border border-warmgray-border border-l-[6px] border-l-gold rounded-lg p-4 md:p-5">
        <div className="text-xs font-medium text-gold mb-5">Follows individual cards from activation to redemption.</div>
        {!hasData ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-8">
            <div className="text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-warmgray-muted mb-1">Cards Activated</div>
              <div className="text-3xl font-serif font-extrabold text-gold">{fmtLacs(totalActivation)}</div>
              <div className="text-xs font-medium text-warmgray-muted mt-1">{fmtNumber(totalActivationCount)} cards</div>
            </div>

            <div className="flex flex-col items-center gap-1 px-2 md:px-4">
              <div className="text-2xl text-warmgray-muted leading-none">&rarr;</div>
              <div className="text-[10px] text-warmgray-muted text-center whitespace-nowrap">same cards, redeemed</div>
            </div>

            <div className="text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-warmgray-muted mb-1">Of Those, Redeemed</div>
              <div className="text-3xl font-serif font-extrabold text-teal">{fmtLacs(redeemedAmount)}</div>
              <div className="text-xs font-medium text-warmgray-muted mt-1">{fmtNumber(redeemedCount)} redemptions</div>
            </div>

            <div className="text-2xl text-warmgray-muted leading-none px-1 hidden md:block">=</div>

            <div className="text-center bg-gold-light rounded-lg py-3 px-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-warmgray-muted mb-1">Redemption Rate</div>
              <div className="text-3xl font-serif font-extrabold text-navy">{fmtPct(samePeriodRedemptionRate, 1)}</div>
            </div>
          </div>
        )}

        <details className="group mt-5 pt-3 border-t border-warmgray-border/60">
          <summary className="text-xs font-semibold text-navy cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden flex items-center gap-1.5 w-fit">
            <span className="inline-block text-warmgray-muted transition-transform group-open:rotate-90">&#9656;</span>
            What does this mean?
          </summary>
          <p className="text-sm text-navy leading-relaxed mt-2 max-w-3xl">
            Overview shows two independent totals for the period — total activated, and total redeemed, regardless of
            when those redemptions' cards were originally activated. This page instead follows one specific set of
            cards: those activated in the selected period. A redemption only counts here if the card was also activated
            in that same period — if it's redeemed later, it shows up in the spillover view below instead of here.
          </p>
        </details>
      </div>

      <Card title="Redemption by Head">
        {byHead.length === 0 ? (
          <EmptyState message={cohortEmptyMessage} />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byHead} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
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
              <Tooltip content={<ChartTooltip countField="RedemptionCount" countUnit="redemptions" />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
              <Bar dataKey="RedemptionAmount" name="Redemption" radius={[4, 4, 0, 0]} maxBarSize={64}>
                <LabelList dataKey="RedemptionAmount" content={AmountLabel} />
                {byHead.map((r) => (
                  <Cell key={r.key} fill={HEAD_COLORS[r.key] || COLORS.inkMuted} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Bonus capability (2026-08-13, extended 2026-08-16): activation
          period fixed, redemption period unbounded — a diverging up/down
          bar chart, Activation (gold, up) against Redemption (teal, down),
          both by month. Activation only ever appears within the activation
          window itself (activationRows is already period-filtered); a month
          with a down bar but no up bar is pure spillover — redeemed later,
          outside the window. Each series sums exactly to its own total:
          Activation to "Cards Activated" above, Redemption to this cohort's
          full to-date redemption total (sumBy(cohortRowsByActivation,
          'RedemptionAmount') — broader than "Of Those, Redeemed" above
          unless the period is the most recent one with nothing yet to
          spill into). */}
      <Card title="Activation & Redemption Spillover — Cards Activated in This Period">
        {spillover.length === 0 ? (
          <EmptyState message={cohortEmptyMessage} />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={spillover} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} interval={0} angle={-30} textAnchor="end" height={50} />
              <YAxis
                tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                axisLine={false}
                tickLine={false}
                width={64}
                tickFormatter={fmtLacsAxis}
                label={{ value: '₹ in Lakhs', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
              />
              <ReferenceLine y={0} stroke={COLORS.border} />
              <Tooltip
                content={
                  <ChartTooltip
                    formatter={(v) => fmtLacs(Math.abs(v))}
                    countField={(p) => (p.dataKey === 'Activation' ? 'ActivationCount' : 'RedemptionCount')}
                    countUnit={(p) => (p.dataKey === 'Activation' ? 'cards' : 'redemptions')}
                  />
                }
                cursor={{ fill: 'rgba(27,36,48,0.04)' }}
              />
              <Legend formatter={(value) => <span className="text-xs text-navy">{value}</span>} />
              <Bar dataKey="Activation" name="Activation" fill={COLORS.activation} radius={[3, 3, 0, 0]} maxBarSize={32}>
                <LabelList dataKey="Activation" content={DivergingAmountLabel} />
              </Bar>
              <Bar dataKey="RedemptionDown" name="Redemption" fill={COLORS.redemption} radius={[0, 0, 3, 3]} maxBarSize={32}>
                <LabelList dataKey="RedemptionDown" content={DivergingAmountLabel} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  )
}

import React, { useMemo, useState } from 'react'
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts'
import { useFilters } from '../lib/FilterContext'
import { groupSum } from '../lib/aggregate'
import { sumForMonths, oneYearEarlier, usePresetWindow, presetBadgeLabel } from '../lib/comparisons'
import { CHANNEL_ORDER, channelLabel, NONE_SELECTED, fyOf } from '../lib/constants'
import { COLORS, CHANNEL_COLORS } from '../lib/theme'
import { fmtNumber, fmtPct, monthLabel, periodLabel } from '../lib/format'
import Card from '../components/Card'
import Kpi from '../components/Kpi'
import Select from '../components/Select'
import EmptyState from '../components/EmptyState'
import ChartTooltip from '../components/ChartTooltip'
import DeltaBadge from '../components/DeltaBadge'

// Gift Card is a payment method, not a booking channel — it no longer
// appears in Section 1 (the 4-real-channel table/charts) or this page-local
// selector at all; see the 2026-08-22 CLAUDE.md entry for why.
const REAL_CHANNELS = CHANNEL_ORDER.filter((c) => c !== 'Gift Card')
const CHANNEL_SELECT_OPTIONS = REAL_CHANNELS.map((c) => ({ value: c, label: channelLabel(c) }))

// Same "[] = every option, NONE_SELECTED sentinel = nothing ticked"
// convention Select.jsx/FilterContext.jsx's own matches() already
// establishes dashboard-wide — reused here for a page-LOCAL selection
// (never touches FilterContext, per the request: "doesn't affect any
// other page") rather than re-deriving a second visibility convention.
function isShown(selected, key) {
  if (selected.length === 1 && selected[0] === NONE_SELECTED) return false
  return selected.length === 0 || selected.includes(key)
}

// Plain percentage-change / percentage-of-total arithmetic — not a period
// WINDOW definition (that's selectedMonths/oneYearEarlier, reused as-is
// below), just the two formulas the resulting two sums feed into. Returns
// null (not 0/±Infinity) whenever either input is missing or the
// denominator is 0, same "hide broken math, don't show a fake number"
// convention every comparison helper in lib/comparisons.js already follows.
function pctChange(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null
  return ((cur - prev) / prev) * 100
}
function pctOfTotal(part, total) {
  if (part == null || total == null || total === 0) return null
  return (part / total) * 100
}
function fmtPctOrDash(n, decimals = 1) {
  return n == null ? '—' : fmtPct(n, decimals)
}
function fmtDiff(n) {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${fmtNumber(n)}`
}
function fmtCountOrDash(n) {
  return n == null ? '—' : fmtNumber(n)
}
// Compact axis-tick formatter for a % axis — same "no decimals on the tick
// itself, the axis title carries the unit" convention every ₹ axis in this
// app already follows via fmtLacsAxis (rupees -> rounded Lacs, no symbol);
// this is the same idea for a percentage instead of a currency.
function fmtPctAxis(v) {
  return `${Math.round(v)}%`
}

// 2026-08-29 (Phase 4 dashboard-wide audit): this page's own single "which
// window is current" concept (`windowCurrentMonths` below) already
// collapses to the exact MTD/QTD/YTD anchor window when a preset is
// active, same as every other page — but unlike Overview/Activation/etc.,
// this page never computes 3 PARALLEL anchor-derived sub-windows
// (mom/qoq/yoy at once) the way `computeComparisons()` does, since its
// own `channelRows`/`giftCard`/`giftCardTotal` are each a single
// this-vs-prior comparison over whichever ONE window is current. So
// `kpiDeltas()` (built for a `{mom,qoq,yoy}` triple) doesn't fit directly —
// `presetBadgeLabel()` (lib/comparisons.js) is the exact same "which label
// does the active preset imply" mapping `kpiDeltas()` itself uses
// internally, imported here rather than re-implemented a second time.

// Shared by both the vs.-Total and vs.-PVR-INOX cards so they can't
// visually drift apart. 2026-08-26: dropped the percentage-POINT delta
// ("+1.76 pp") and the two-value this/prior layout entirely, per an
// explicit request — the single top-right date-range line (rendered once,
// at the top of the page body below) already states which two periods
// are being compared, so a second date-bearing value here was redundant.
// What's shown now is just the current period's own % plus a
// plain relative-growth badge (`pctChange(thisVal, priorVal)` through the
// same `DeltaBadge` every other KPI on this app already renders its
// delta through — a relative % change of the contribution figure itself,
// not an absolute point difference; label left blank, matching the
// generic-badge convention Overview's own ribbon already established for
// a delta with no more specific name than "the change").
function ContributionCard({ label, thisVal, priorVal, accent }) {
  const changePct = pctChange(thisVal, priorVal)
  const accentClasses = { teal: 'border-l-teal text-teal-dark', gold: 'border-l-gold text-gold' }[accent] || 'border-l-navy text-navy'
  return (
    <div className={`bg-card border border-warmgray-border border-l-[6px] rounded-lg px-4 py-3 ${accentClasses.split(' ')[0]}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-warmgray-muted">{label}</div>
      <div className={`text-2xl font-serif font-extrabold tracking-tight mt-1 ${accentClasses.split(' ')[1]}`}>{fmtPctOrDash(thisVal, 2)}</div>
      <div className="mt-1.5">
        <DeltaBadge pct={changePct} label="" />
      </div>
    </div>
  )
}

export default function ChannelPerformance() {
  const { channelTransactionsRows, giftCardTransactionRows, filters } = useFilters()

  // Page-local only — a useState, not a FilterContext filter, per the
  // request ("separate from the global filter bar ... doesn't affect any
  // other page"). Governs Section 1 (the 4 real channels) only — Gift
  // Card is no longer one of its options at all (see REAL_CHANNELS above).
  // Defaults to [] (every real option), which is exactly Select.jsx's own
  // "unrestricted -> displays every box pre-ticked" convention, so "all
  // shown by default" needed no separate initial-value array of its own.
  const [channelsShown, setChannelsShown] = useState([])

  // 2026-08-29 (Phase 4 dashboard-wide audit): this page was the one
  // remaining page with no MTD/QTD/YTD control at all — every other page
  // in the app had one by this point. `usePresetWindow()` is the exact
  // same shared hook Overview/Activation/Redemption·Box Office/
  // Redemption·F&B/Cancel Redeem/Trends/Summary/Card Journey all already
  // call — reused here for the preset button state/anchor/`quarterOptions`
  // gating/`applyPreset`/`applyQuarter`, NOT for its own `selectedMonths`
  // (see the comment on this page's own `selectedMonths` below for why:
  // that hook's version is deliberately scoped to just the anchor's own
  // FY, which would silently break this page's own, already-verified
  // "select 2+ FYs at once, sum across all of them" behavior — a real
  // design difference from every other page, not an oversight).
  const { presets, quarterOptions, activePreset, activeQuarter, qtdMenuOpen, setQtdMenuOpen, qtdMenuRef, applyPreset, applyQuarter } = usePresetWindow()

  // 2026-08-26 bug fix, replacing the narrower 2026-08-23 fix below: THIS
  // is now the one and only "current window" computation on the whole
  // page — every section that needs "which months does the current FY/
  // Month selection cover" reads from here, nothing else on this page
  // derives its own copy anymore.
  //
  // Root cause of the reported bug (Market Channels table + both GC
  // Contribution cards showing only the anchor month's figures under
  // FY2026-27+Month=All, or under FY=All+Month=All): those 3 sections had
  // their OWN separate window, `thisMonths = comparisonMonths` —
  // `comparisonMonths` is the single-ANCHOR-month concept every MoM/QoQ/
  // YoY delta badge elsewhere in this app needs (explicit Month selection
  // wins; otherwise it collapses to just the latest month under the active
  // filters — that collapse is correct and load-bearing for MTD/QTD/YTD,
  // but wrong for a "sum this whole selection" total). Whenever Month is
  // left at "All" (the normal way to view a whole FY, or the page's own
  // default), `comparisonMonths` is ALWAYS exactly one month — so
  // `thisMonths`/`priorMonths` silently collapsed the table and both
  // Contribution cards down to that one anchor month every time, the exact
  // symptom reported. This is the same "headline total silently collapsed
  // to the latest month" bug class already fixed once on Summary
  // (2026-08-13) and once already on THIS page's own "Gift Card
  // Transactions" KPI (2026-08-23 entry below) — that earlier fix was
  // deliberately scoped to just that one KPI ("the Market Channels table
  // and the two ContributionCard percentages deliberately keep using the
  // anchor-based thisMonths/priorMonths ... per this fix's own scope"),
  // leaving the other 2 sections on the buggy anchor-only window — exactly
  // the "still not fully fixed" the user flagged.
  //
  // The fix: delete the separate `thisMonths`/`priorMonths` (comparisonMonths-
  // based) pair entirely, and point every section — the table, both
  // Contribution cards, AND the GC Transactions KPI — at this single
  // `selectedMonths`/`priorSelectedMonths` pair (every month the current
  // FY/Month selection actually matches, built off this page's own row
  // data since channelTransactionsRows/giftCardTransactionRows are
  // deliberately exposed unfiltered — see FilterContext.jsx's own doc
  // comments on why). `isShown()` (already defined above for the
  // page-local "Channels Shown" selector) is the exact same "[] =
  // unrestricted, NONE_SELECTED = nothing, else must be in the list"
  // convention FilterContext.jsx's own matches() implements — reused here
  // for FY/Month instead of re-deriving a third copy of it.
  const selectedMonths = useMemo(() => {
    const allMonths = [...new Set(channelTransactionsRows.map((r) => r.YearMonth))].sort()
    return allMonths.filter((m) => isShown(filters.fy, fyOf(m)) && isShown(filters.month, m))
  }, [channelTransactionsRows, filters.fy, filters.month])

  // 2026-08-29: `windowCurrentMonths` — the single "which window is active
  // right now" concept every metric on this page reads, same formula
  // Overview.jsx's own MTD/QTD/YTD ribbon uses (`presets.mtd`/`presets.ytd`
  // when that preset is active; `selectedMonths` — this page's own
  // multi-FY-aware version, unchanged — otherwise, which also covers the
  // QTD-quarter-click case exactly like Overview's own comment explains:
  // once a quarter is picked, `filters.month` IS that quarter's real
  // months, which `selectedMonths` already resolves to). Every metric
  // below (`channelRows`/`giftCard`/`giftCardTotal`) and the shared date
  // caption now read `windowCurrentMonths`/`windowPriorMonths` instead of
  // `selectedMonths`/`priorSelectedMonths` directly, so clicking MTD/QTD/YTD
  // actually changes what this page shows, matching every other page.
  const windowCurrentMonths = activePreset === 'mtd' ? presets.mtd : activePreset === 'ytd' ? presets.ytd : selectedMonths
  const windowPriorMonths = useMemo(() => oneYearEarlier(windowCurrentMonths), [windowCurrentMonths])
  // Reused everywhere a caption states the actual date range being
  // compared — same periodLabel() the table's own subtitle (and the GC
  // Transactions KPI's "vs. ..." sub line) already use, computed once
  // here rather than re-derived per call site.
  const thisLabel = periodLabel(windowCurrentMonths)
  const priorLabel = periodLabel(windowPriorMonths)

  // Section 1 — the 4 real booking channels only. channelTransactionsRows
  // is exposed UNFILTERED by FilterContext.jsx (see its own doc comments)
  // specifically so this page can sum two independently-chosen, arbitrary
  // month sets that reach on both sides of whatever FY/Month happens to be
  // selected — sumForMonths (reused from lib/comparisons.js, same
  // null-when-no-match convention every other comparison in this app
  // relies on) is exactly the primitive built for that.
  const { channelRows, totalThis, totalPrior } = useMemo(() => {
    const totalThisVal = sumForMonths(channelTransactionsRows, 'Total', windowCurrentMonths)
    const totalPriorVal = sumForMonths(channelTransactionsRows, 'Total', windowPriorMonths)
    const rows = REAL_CHANNELS.map((key) => {
      const thisVal = sumForMonths(channelTransactionsRows, key, windowCurrentMonths)
      const priorVal = sumForMonths(channelTransactionsRows, key, windowPriorMonths)
      return {
        key,
        thisVal,
        priorVal,
        diff: thisVal != null && priorVal != null ? thisVal - priorVal : null,
        growthPct: pctChange(thisVal, priorVal),
        contribThis: pctOfTotal(thisVal, totalThisVal),
        contribPrior: pctOfTotal(priorVal, totalPriorVal)
      }
    })
    return { channelRows: rows, totalThis: totalThisVal, totalPrior: totalPriorVal }
  }, [channelTransactionsRows, windowCurrentMonths, windowPriorMonths])

  // Section 2 — Gift Card, entirely separate from the channelRows/Total
  // computation above. Two distinct "% contribution" denominators: the
  // file's own Total (the whole market), and PVR INOX's own count (our
  // direct channel) — the latter is the more meaningful internal question
  // ("how much of our own channel do we power"), given equal card weight
  // below rather than a footnote, per the request. Same selectedMonths/
  // priorSelectedMonths window as the table above (and as giftCardTotal
  // below) — they're ratios against the Market Channels table's own
  // Total/PVR INOX figures directly above, so the numerator and
  // denominator have to stay on the same footing, which they now do by
  // construction (same shared window, not two independently-anchored
  // copies of "current period").
  const giftCard = useMemo(() => {
    const thisVal = sumForMonths(giftCardTransactionRows, 'RedemptionCount', windowCurrentMonths)
    const priorVal = sumForMonths(giftCardTransactionRows, 'RedemptionCount', windowPriorMonths)
    const pvrinoxThis = sumForMonths(channelTransactionsRows, 'PVRINOX', windowCurrentMonths)
    const pvrinoxPrior = sumForMonths(channelTransactionsRows, 'PVRINOX', windowPriorMonths)
    return {
      contribTotalThis: pctOfTotal(thisVal, totalThis),
      contribTotalPrior: pctOfTotal(priorVal, totalPrior),
      contribPvrinoxThis: pctOfTotal(thisVal, pvrinoxThis),
      contribPvrinoxPrior: pctOfTotal(priorVal, pvrinoxPrior)
    }
  }, [giftCardTransactionRows, channelTransactionsRows, windowCurrentMonths, windowPriorMonths, totalThis, totalPrior])

  // "Gift Card Transactions" KPI — same windowCurrentMonths/windowPriorMonths
  // window as every other section on this page now (see the root-cause
  // comment above `selectedMonths`/`windowCurrentMonths` itself).
  const giftCardTotal = useMemo(() => {
    const thisVal = sumForMonths(giftCardTransactionRows, 'RedemptionCount', windowCurrentMonths)
    const priorVal = sumForMonths(giftCardTransactionRows, 'RedemptionCount', windowPriorMonths)
    return {
      thisVal,
      priorVal,
      diff: thisVal != null && priorVal != null ? thisVal - priorVal : null,
      growthPct: pctChange(thisVal, priorVal)
    }
  }, [giftCardTransactionRows, windowCurrentMonths, windowPriorMonths])

  // All 28 months, 4 real channels only (Gift Card removed — see the
  // module-level REAL_CHANNELS doc comment) — for Section 1's trend chart.
  // Independent of selectedMonths/priorSelectedMonths; always the full
  // history regardless of which 2 periods the table above is comparing.
  // Not subject to the anchor-collapse bug fixed above — this chart never
  // computed a "current window" sum to begin with (checked directly, not
  // assumed, per the request's own "don't assume it's isolated" — same for
  // Contribution Mix and both Penetration Trend charts below, which are
  // all built the same always-full-history way).
  const monthlyTrend = useMemo(
    () =>
      [...channelTransactionsRows]
        .sort((a, b) => (a.YearMonth > b.YearMonth ? 1 : -1))
        .map((r) => ({
          label: monthLabel(r.YearMonth),
          BMS: r.BMS,
          PVRINOX: r.PVRINOX,
          PaytmDistrict: r.PaytmDistrict,
          BoxOffice: r.BoxOffice
        })),
    [channelTransactionsRows]
  )

  // Per-month % contribution to that month's own Total, 4 real channels
  // only — same pctOfTotal(part, total) formula the table's own
  // contribThis/contribPrior cells already use, just run once per month.
  // These 4 are a complete partition of Total (confirmed by hand against
  // the raw file before this page was ever built — Total ===
  // BMS+PVRINOX+PaytmDistrict+BoxOffice for every row), so their 4 stacked
  // segments always sum to exactly 100% every month, by construction — no
  // Gift Card segment poking past the reference line anymore, since GC's
  // overlap-with-Total story now lives entirely in Section 2 below.
  const contributionMix = useMemo(
    () =>
      [...channelTransactionsRows]
        .sort((a, b) => (a.YearMonth > b.YearMonth ? 1 : -1))
        .map((r) => ({
          label: monthLabel(r.YearMonth),
          BMS: pctOfTotal(r.BMS, r.Total),
          PVRINOX: pctOfTotal(r.PVRINOX, r.Total),
          PaytmDistrict: pctOfTotal(r.PaytmDistrict, r.Total),
          BoxOffice: pctOfTotal(r.BoxOffice, r.Total)
        })),
    [channelTransactionsRows]
  )

  // Section 2's two Penetration Trend charts — GC's own % of Total and % of
  // PVR INOX, full 28-month range. Two SEPARATE arrays/charts, not one
  // dual-line chart on a shared axis: the two ratios sit on very different
  // scales (≈0.7-3% vs. ≈7-43%), so a shared axis would flatten the Total
  // line to near-invisible next to PVR INOX's much larger one — the same
  // "don't force very different scales onto one shared axis" reasoning
  // that already justifies keeping this pair on 2 charts instead of 1.
  const gcPenetrationVsTotal = useMemo(() => {
    const gcByMonth = groupSum(giftCardTransactionRows, 'YearMonth', ['RedemptionCount'])
    const gcMap = new Map(gcByMonth.map((r) => [r.key, r.RedemptionCount]))
    return [...channelTransactionsRows]
      .sort((a, b) => (a.YearMonth > b.YearMonth ? 1 : -1))
      .map((r) => ({ label: monthLabel(r.YearMonth), 'vs. Total': pctOfTotal(gcMap.get(r.YearMonth) || 0, r.Total) }))
  }, [channelTransactionsRows, giftCardTransactionRows])

  const gcPenetrationVsPvrinox = useMemo(() => {
    const gcByMonth = groupSum(giftCardTransactionRows, 'YearMonth', ['RedemptionCount'])
    const gcMap = new Map(gcByMonth.map((r) => [r.key, r.RedemptionCount]))
    return [...channelTransactionsRows]
      .sort((a, b) => (a.YearMonth > b.YearMonth ? 1 : -1))
      .map((r) => ({ label: monthLabel(r.YearMonth), 'vs. PVR INOX': pctOfTotal(gcMap.get(r.YearMonth) || 0, r.PVRINOX) }))
  }, [channelTransactionsRows, giftCardTransactionRows])

  // Endpoint-only subtitles for the two Penetration Trend charts — the two
  // numbers/dates the request wants in place of a full explanatory
  // sentence, read directly off the same series each chart plots (never a
  // second, hand-authored computation that could drift from what's
  // actually drawn).
  const endpointLabel = (series, field) => {
    if (series.length === 0) return null
    const first = series[0]
    const last = series[series.length - 1]
    return `${fmtPctOrDash(first[field], 2)} (${first.label}) → ${fmtPctOrDash(last[field], 2)} (${last.label})`
  }
  const gcTotalEndpoints = endpointLabel(gcPenetrationVsTotal, 'vs. Total')
  const gcPvrinoxEndpoints = endpointLabel(gcPenetrationVsPvrinox, 'vs. PVR INOX')

  const hasData = channelTransactionsRows.length > 0

  return (
    <div className="flex flex-col gap-6">
      {!hasData ? (
        <EmptyState />
      ) : (
        <>
          {/* 2026-08-29 (Phase 4 audit): MTD/QTD(Q1-Q4 dropdown)/YTD
              control row + the single top-left comparison-date line —
              copied verbatim from Overview.jsx's own render, same as
              every other page in the app now uses. Previously this page
              had only the date line (2026-08-26), with no preset control
              at all — the one remaining inconsistency Phase 4 found. Every
              other per-card date mention on this page (the table's own
              subtitle, the GC Transactions KPI's "vs. ..." sub line, both
              ContributionCards' two-value/date layout) was already removed
              in an earlier pass — see each site's own comment. */}
          <div className="flex justify-between items-center gap-2 -mb-2 flex-wrap">
            <p className="text-xs italic text-warmgray-muted">
              {thisLabel} vs. {priorLabel}
            </p>
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

          {/* 2026-08-26: Market Channels now renders first, Gift Card
              Performance below it — reverses the "Gift Card first" order
              from an earlier pass, per this request. */}
          <div>
            <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
              <h2 className="font-serif text-lg font-extrabold text-navy">Market Channels</h2>
              <div className="w-full sm:w-64">
                <Select label="Channels Shown" value={channelsShown} options={CHANNEL_SELECT_OPTIONS} onChange={setChannelsShown} />
              </div>
            </div>

            <div className="flex flex-col gap-6">
              {/* subtitle removed — the top-right line above now states
                  the two periods being compared, once, for the whole page. */}
              <Card title="Channel Performance — Period Comparison">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[720px] border-separate border-spacing-0">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-warmgray-muted">
                        <th className="text-left font-semibold pb-2">Channel</th>
                        {/* 2026-08-26: literal "This Period"/"Prior Period"
                            replaced with the actual date ranges (thisLabel/
                            priorLabel, the same periodLabel()-built strings
                            the top-right line and every other date caption
                            on this page already use). */}
                        <th className="text-right font-semibold pb-2">{thisLabel}</th>
                        <th className="text-right font-semibold pb-2">{priorLabel}</th>
                        <th className="text-right font-semibold pb-2">Difference</th>
                        <th className="text-right font-semibold pb-2">% Growth</th>
                        {/* 2026-08-30: literal "(This)"/"(Prior)" replaced
                            with the same thisLabel/priorLabel date-range
                            strings the amount columns above already use —
                            same periodLabel()-built values, no new
                            formatting logic. */}
                        <th className="text-right font-semibold pb-2">% Contribution ({thisLabel})</th>
                        <th className="text-right font-semibold pb-2">% Contribution ({priorLabel})</th>
                      </tr>
                    </thead>
                    <tbody>
                      {channelRows
                        .filter((r) => isShown(channelsShown, r.key))
                        .map((r) => (
                          <tr key={r.key} className="border-t border-warmgray-border/60 hover:bg-cream/60 transition-colors">
                            <td className="py-2 text-navy font-medium whitespace-nowrap">
                              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: CHANNEL_COLORS[r.key] }} />
                              {channelLabel(r.key)}
                            </td>
                            <td className="py-2 text-right text-navy tabular-nums whitespace-nowrap">{fmtCountOrDash(r.thisVal)}</td>
                            <td className="py-2 text-right text-navy tabular-nums whitespace-nowrap">{fmtCountOrDash(r.priorVal)}</td>
                            <td className="py-2 text-right text-navy tabular-nums whitespace-nowrap">{fmtDiff(r.diff)}</td>
                            <td
                              className={`py-2 text-right tabular-nums whitespace-nowrap font-semibold ${
                                r.growthPct == null ? 'text-warmgray-muted' : r.growthPct >= 0 ? 'text-teal-dark' : 'text-coral-dark'
                              }`}
                            >
                              {fmtPctOrDash(r.growthPct)}
                            </td>
                            <td className="py-2 text-right text-navy tabular-nums whitespace-nowrap">{fmtPctOrDash(r.contribThis, 2)}</td>
                            <td className="py-2 text-right text-navy tabular-nums whitespace-nowrap">{fmtPctOrDash(r.contribPrior, 2)}</td>
                          </tr>
                        ))}
                      <tr className="border-t border-warmgray-border font-bold">
                        <td className="py-2 text-navy">Total</td>
                        <td className="py-2 text-right text-navy tabular-nums whitespace-nowrap">{fmtCountOrDash(totalThis)}</td>
                        <td className="py-2 text-right text-navy tabular-nums whitespace-nowrap">{fmtCountOrDash(totalPrior)}</td>
                        <td className="py-2 text-right text-navy tabular-nums whitespace-nowrap">
                          {fmtDiff(totalThis != null && totalPrior != null ? totalThis - totalPrior : null)}
                        </td>
                        <td className="py-2 text-right text-navy tabular-nums whitespace-nowrap">{fmtPctOrDash(pctChange(totalThis, totalPrior))}</td>
                        <td className="py-2 text-right text-navy tabular-nums whitespace-nowrap">100.00%</td>
                        <td className="py-2 text-right text-navy tabular-nums whitespace-nowrap">100.00%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* 2026-08-29: Gift Card Performance moved here — directly
                  below the Period Comparison table, right after "Market
                  Channels" — rather than all the way below every chart on
                  this page (Penetration Trend/Monthly Trend/Contribution
                  Mix), per an explicit follow-up request. Still its own
                  visually distinct block (Kpi.jsx/ContributionCard's
                  shared "accent left-border + big serif number" language),
                  just relocated within the same page, not restructured. */}
              <div>
                <h2 className="font-serif text-lg font-extrabold text-navy mb-1">Gift Card Performance</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Kpi
                    label="Gift Card Transactions"
                    value={fmtCountOrDash(giftCardTotal.thisVal)}
                    subCount={`${fmtCountOrDash(giftCardTotal.priorVal)} (${fmtDiff(giftCardTotal.diff)})`}
                    accent="teal"
                    deltas={[{ label: presetBadgeLabel(activePreset), pct: giftCardTotal.growthPct }]}
                  />
                  <ContributionCard
                    label="GC Contribution — % of Total Market"
                    thisVal={giftCard.contribTotalThis}
                    priorVal={giftCard.contribTotalPrior}
                    accent="teal"
                  />
                  <ContributionCard
                    label="GC Contribution — % of PVR INOX Channel"
                    thisVal={giftCard.contribPvrinoxThis}
                    priorVal={giftCard.contribPvrinoxPrior}
                    accent="gold"
                  />
                </div>
              </div>

              {/* Gift Card's own trend charts — still sit below the
                  Period Comparison table, per the earlier request that put
                  them here; Gift Card Performance (above) now sits between
                  the table and these charts, not after them. */}
              <div className="grid md:grid-cols-2 gap-6">
                <Card title="Gift Card Penetration Trend — vs. All Chanllels" subtitle={gcTotalEndpoints}>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={gcPenetrationVsTotal} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 9, fill: COLORS.inkMuted }}
                        axisLine={{ stroke: COLORS.border }}
                        tickLine={false}
                        interval={0}
                        angle={-45}
                        textAnchor="end"
                        height={50}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                        axisLine={false}
                        tickLine={false}
                        width={56}
                        tickFormatter={(v) => fmtPct(v, 1)}
                        label={{ value: '% of Total', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
                      />
                      <Tooltip content={<ChartTooltip formatter={(v) => fmtPct(v, 2)} />} />
                      <Line type="monotone" dataKey="vs. Total" name="vs. Total" stroke={CHANNEL_COLORS['Gift Card']} strokeWidth={3} dot={{ r: 2.5 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>

                <Card title="Gift Card Penetration Trend — vs. PVR INOX Channel" subtitle={gcPvrinoxEndpoints}>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={gcPenetrationVsPvrinox} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 9, fill: COLORS.inkMuted }}
                        axisLine={{ stroke: COLORS.border }}
                        tickLine={false}
                        interval={0}
                        angle={-45}
                        textAnchor="end"
                        height={50}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                        axisLine={false}
                        tickLine={false}
                        width={56}
                        tickFormatter={fmtPctAxis}
                        label={{ value: '% of PVR INOX', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
                      />
                      <Tooltip content={<ChartTooltip formatter={(v) => fmtPct(v, 2)} />} />
                      <Line type="monotone" dataKey="vs. PVR INOX" name="vs. PVR INOX" stroke={CHANNEL_COLORS.PVRINOX} strokeWidth={3} dot={{ r: 2.5 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              </div>

              <Card title="Monthly Trend by Channel">
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={monthlyTrend} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} interval={1} />
                    <YAxis
                      tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                      axisLine={false}
                      tickLine={false}
                      width={78}
                      tickFormatter={fmtNumber}
                      label={{ value: 'Transactions', angle: -90, position: 'insideLeft', dx: -8, style: { fontSize: 11, fill: COLORS.inkMuted } }}
                    />
                    <Tooltip content={<ChartTooltip formatter={fmtNumber} />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} formatter={(value) => channelLabel(value)} />
                    {REAL_CHANNELS.filter((key) => isShown(channelsShown, key)).map((key) => (
                      <Line key={key} type="monotone" dataKey={key} name={key} stroke={CHANNEL_COLORS[key]} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              <Card title="Contribution Mix">
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={contributionMix} margin={{ top: 8, right: 44, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridline} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: COLORS.inkMuted }} axisLine={{ stroke: COLORS.border }} tickLine={false} interval={1} />
                    <YAxis
                      tick={{ fontSize: 11, fill: COLORS.inkMuted }}
                      axisLine={false}
                      tickLine={false}
                      width={56}
                      tickFormatter={fmtPctAxis}
                      label={{ value: '% of Total', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.inkMuted } }}
                    />
                    <Tooltip content={<ChartTooltip formatter={(v) => fmtPct(v, 2)} />} cursor={{ fill: 'rgba(27,36,48,0.04)' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} formatter={(value) => channelLabel(value)} />
                    <ReferenceLine y={100} stroke={COLORS.inkMuted} strokeDasharray="4 4" label={{ value: '100%', position: 'right', fontSize: 10, fill: COLORS.inkMuted }} />
                    {REAL_CHANNELS.filter((key) => isShown(channelsShown, key)).map((key) => (
                      <Bar key={key} dataKey={key} name={key} stackId="mix" fill={CHANNEL_COLORS[key]} maxBarSize={28} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

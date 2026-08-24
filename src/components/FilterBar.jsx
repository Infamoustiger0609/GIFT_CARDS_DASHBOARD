import React from 'react'
import { useLocation } from 'react-router-dom'
import Select from './Select'
import DateRangeFilter from './DateRangeFilter'
import { useFilters } from '../lib/FilterContext'
import { monthLabel } from '../lib/format'
import { regionLabel, DAILY_CUBE_MIN_DATE, DAILY_CUBE_MAX_DATE } from '../lib/constants'

const WEEK_OPTIONS = [
  { value: 'Weekday', label: 'Weekday' },
  { value: 'Weekend', label: 'Weekend' }
]
const TICKET_FNB_OPTIONS = [
  { value: 'Ticket', label: 'Ticket' },
  { value: 'F&B', label: 'F&B' }
]

// 2026-08-21: ChannelPerformance.jsx reads channelTransactions.json (FY/
// Month only — no Region/CardType/ActivationSource/RedemptionSource/Week/
// Weekday/day-level field at all) plus its own Gift Card pool, which
// deliberately ignores those same dimensions too (see FilterContext.jsx's
// giftCardTransactionRows doc comment — narrowing GC by e.g. CardType while
// the other 4 channel columns can never be narrowed by it at all would put
// them on a different footing with no visible indication why). Greying out
// every control this page's own data genuinely can't support — rather than
// leaving them live-but-silently-inert — is the same "never let a filter
// look active while doing nothing" rule DateRangeFilter's own gating above
// already follows. Date Range is included here too even though FY/Month
// alone would "work": channelTransactions.json has no day-level field at
// all, so a sub-month range can't be represented against it (only whole
// months exist in that cube), unlike the daily cubes Date Range actually
// reads from.
//
// This reintroduces route-awareness to FilterBar.jsx, which the 2026-08-05
// "split Mode filter" entry (see CLAUDE.md) deliberately removed — but that
// removal was about a DIFFERENT concern (which OPTIONS a single shared Mode
// control offered per page) that this doesn't revive: every filter here
// still has one universal option list and one universal stored value
// dashboard-wide: this only toggles which controls are enabled, the same
// per-control `disabled` prop DateRangeFilter/Select already support for
// other reasons, gated on the current route instead of on another filter's
// value.
const CHANNEL_PAGE_PATH = '/channel-performance'
const CHANNEL_PAGE_DISABLED_REASON =
  "Not available on Channel Performance — channelTransactions.json (and this page's own Gift Card figure) only has a YearMonth dimension, no Region/Card Type/Source/Ticket-F&B/Week/Weekday/day-level field to narrow by."

export default function FilterBar() {
  // resetFilters is still provided by FilterContext (functionality intact) —
  // just not wired to a visible control right now, per request.
  const { filters, setFilter, setDateRange, dateRangeAvailable, options } = useFilters()
  const onChannelPage = useLocation().pathname === CHANNEL_PAGE_PATH

  return (
    <div className="bg-card border border-warmgray-border rounded-lg px-2.5 py-0.5 relative">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-11 gap-1 items-end">
        {/* 2026-08-21: first position, per request. Backed by a 4th pair of
            cubes (dailyActivationCube.json/dailyRedemptionCube.json) that
            only Overview.jsx's Date Range summary panel reads — see
            FilterContext.jsx's own "Date Range" section for why. Disabled
            whenever Card Type/Denomination/Activation Source/Redemption
            Source is active, since none of those 4 fields exist on the
            daily cubes and combining them can't be made accurate — same
            hard-gate pattern the 2026-08-10 Day filter used before its
            2026-08-15 removal (a separate, unrelated change — that filter
            was retired for the Weekday filter, not because gating itself
            was wrong). Also disabled outright on Channel Performance — see
            this file's own CHANNEL_PAGE_DISABLED_REASON doc comment above. */}
        <DateRangeFilter
          value={filters.dateRange}
          onChange={setDateRange}
          min={DAILY_CUBE_MIN_DATE}
          max={DAILY_CUBE_MAX_DATE}
          disabled={onChannelPage || !dateRangeAvailable}
          disabledReason={
            onChannelPage
              ? CHANNEL_PAGE_DISABLED_REASON
              : 'Not available with Card Type, Denomination, Activation Source, or Redemption Source active — those fields don\'t exist on the daily cubes this filter reads.'
          }
        />
        <Select label="Financial Year" value={filters.fy} options={options.fys} onChange={(v) => setFilter('fy', v)} />
        <Select
          label="Month"
          value={filters.month}
          options={options.months.map((m) => ({ value: m, label: monthLabel(m) }))}
          onChange={(v) => setFilter('month', v)}
          />
        <Select
          label="Week"
          value={filters.week}
          options={WEEK_OPTIONS}
          onChange={(v) => setFilter('week', v)}
          disabled={onChannelPage}
          disabledReason={CHANNEL_PAGE_DISABLED_REASON}
        />
        {/* 2026-08-15: replaces the old numeric "Day" (1-31) filter, which
            was powered by the lighter "daily" cubes and had to grey out
            CardType/Denomination/ActivationSource/RedemptionSource whenever
            active. Weekday is a real field on both MAIN cubes already, so
            it needs no such restriction and no `disabled` state — every
            page that reads activationRows/redemptionRows respects it like
            any other filter. (Channel Performance is the one exception —
            see CHANNEL_PAGE_DISABLED_REASON above.) */}
        <Select
          label="Weekday"
          value={filters.weekday}
          options={options.weekdays.map((w) => ({ value: w, label: w }))}
          onChange={(v) => setFilter('weekday', v)}
          disabled={onChannelPage}
          disabledReason={CHANNEL_PAGE_DISABLED_REASON}
        />
        <Select
          label="Region"
          value={filters.region}
          options={options.regions.map((r) => ({ value: r, label: regionLabel(r) }))}
          onChange={(v) => setFilter('region', v)}
          disabled={onChannelPage}
          disabledReason={CHANNEL_PAGE_DISABLED_REASON}
        />
        {/* Two fully independent filters — not a page-aware single "Mode"
            control anymore. Both are always visible: Overview shows both
            cubes at once, and every other page needs whichever one is
            relevant to the cube(s) it displays. Activation Source (3
            options: Aggregators/Corporate/Cinema, bucketed from
            ActivationModeFinal) only ever narrows activationRows;
            Redemption Source (2 options: Online/Cinema, bucketed from
            RedemptionModeFinal) only ever narrows redemptionRows — see
            FilterContext.jsx. */}
        <Select
          label="Activation Source"
          value={filters.activationSource}
          options={options.activationSources}
          onChange={(v) => setFilter('activationSource', v)}
          disabled={onChannelPage}
          disabledReason={CHANNEL_PAGE_DISABLED_REASON}
        />
        <Select
          label="Redemption Source"
          value={filters.redemptionSource}
          options={options.redemptionSources}
          onChange={(v) => setFilter('redemptionSource', v)}
          disabled={onChannelPage}
          disabledReason={CHANNEL_PAGE_DISABLED_REASON}
        />
        <Select
          label="Card Type"
          value={filters.cardType}
          options={options.cardTypes}
          onChange={(v) => setFilter('cardType', v)}
          disabled={onChannelPage}
          disabledReason={CHANNEL_PAGE_DISABLED_REASON}
        />
        <Select
          label="Ticket / F&B"
          value={filters.ticketFnb}
          options={TICKET_FNB_OPTIONS}
          onChange={(v) => setFilter('ticketFnb', v)}
          disabled={onChannelPage}
          disabledReason={CHANNEL_PAGE_DISABLED_REASON}
        />
        <Select
          label="Denomination"
          value={filters.denomination}
          options={options.denominations}
          onChange={(v) => setFilter('denomination', v)}
          disabled={onChannelPage}
          disabledReason={CHANNEL_PAGE_DISABLED_REASON}
        />
      </div>
    </div>
  )
}

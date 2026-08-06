import React from 'react'
import Select from './Select'
import { useFilters } from '../lib/FilterContext'
import { monthLabel } from '../lib/format'
import { orderBy, DENOM_ORDER, regionLabel } from '../lib/constants'

const WEEK_OPTIONS = [
  { value: 'Weekday', label: 'Weekday' },
  { value: 'Weekend', label: 'Weekend' }
]
const TICKET_FNB_OPTIONS = [
  { value: 'Ticket', label: 'Ticket' },
  { value: 'F&B', label: 'F&B' }
]

export default function FilterBar() {
  // resetFilters is still provided by FilterContext (functionality intact) —
  // just not wired to a visible control right now, per request.
  const { filters, setFilter, options } = useFilters()
  const denomOptions = orderBy(options.denominations, DENOM_ORDER)

  return (
    <div className="bg-card border border-warmgray-border rounded-lg px-3 py-2 relative">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-1.5 items-end">
        <Select label="Financial Year" value={filters.fy} options={options.fys} onChange={(v) => setFilter('fy', v)} />
        <Select
          label="Month"
          value={filters.month}
          options={options.months.map((m) => ({ value: m, label: monthLabel(m) }))}
          onChange={(v) => setFilter('month', v)}
          />
        <Select label="Week" value={filters.week} options={WEEK_OPTIONS} onChange={(v) => setFilter('week', v)} />
        <Select
          label="Region"
          value={filters.region}
          options={options.regions.map((r) => ({ value: r, label: regionLabel(r) }))}
          onChange={(v) => setFilter('region', v)}
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
        />
        <Select
          label="Redemption Source"
          value={filters.redemptionSource}
          options={options.redemptionSources}
          onChange={(v) => setFilter('redemptionSource', v)}
        />
        <Select label="Card Type" value={filters.cardType} options={options.cardTypes} onChange={(v) => setFilter('cardType', v)} />
        <Select label="Ticket / F&B" value={filters.ticketFnb} options={TICKET_FNB_OPTIONS} onChange={(v) => setFilter('ticketFnb', v)} />
        <Select label="Denomination" value={filters.denomination} options={denomOptions} onChange={(v) => setFilter('denomination', v)} />
      </div>
    </div>
  )
}

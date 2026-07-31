import React from 'react'
import Select from './Select'
import { useFilters } from '../lib/FilterContext'
import { monthLabel } from '../lib/format'
import { orderBy, DENOM_ORDER } from '../lib/constants'

const WEEK_OPTIONS = [
  { value: 'Weekday', label: 'Weekday' },
  { value: 'Weekend', label: 'Weekend' }
]
const SOURCE_OPTIONS = [
  { value: 'Source', label: 'Source' },
  { value: 'Non-Source', label: 'Non-Source' }
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
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1.5 items-end">
        <Select label="Financial Year" value={filters.fy} options={options.fys} onChange={(v) => setFilter('fy', v)} />
        <Select
          label="Month"
          value={filters.month}
          options={options.months.map((m) => ({ value: m, label: monthLabel(m) }))}
          onChange={(v) => setFilter('month', v)}
          />
        <Select label="Week" value={filters.week} options={WEEK_OPTIONS} onChange={(v) => setFilter('week', v)} />
        <Select label="Region" value={filters.region} options={options.regions} onChange={(v) => setFilter('region', v)} />
        <Select label="Mode" value={filters.mode} options={options.modes} onChange={(v) => setFilter('mode', v)} />
        <Select label="Source" value={filters.source} options={SOURCE_OPTIONS} onChange={(v) => setFilter('source', v)} />
        <Select label="Ticket / F&B" value={filters.ticketFnb} options={TICKET_FNB_OPTIONS} onChange={(v) => setFilter('ticketFnb', v)} />
        <Select label="Denomination" value={filters.denomination} options={denomOptions} onChange={(v) => setFilter('denomination', v)} />
      </div>
    </div>
  )
}

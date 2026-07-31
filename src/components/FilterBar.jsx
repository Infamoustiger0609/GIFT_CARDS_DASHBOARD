import React from 'react'
import Select from './Select'
import { useFilters, DEFAULT_FILTERS } from '../lib/FilterContext'
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

function chipLabel(key, value) {
  const labels = {
    fy: 'FY',
    region: 'Region',
    mode: 'Mode',
    month: 'Month',
    week: 'Week',
    source: 'Source',
    ticketFnb: 'Type',
    denomination: 'Denom'
  }
  const val = key === 'month' ? monthLabel(value) : value
  return `${labels[key]}: ${val}`
}

export default function FilterBar() {
  const { filters, setFilter, resetFilters, options } = useFilters()
  const activeChips = Object.entries(filters).filter(([, v]) => v !== 'All')
  const denomOptions = orderBy(options.denominations, DENOM_ORDER)

  return (
    <div className="bg-card border border-warmgray-border rounded-lg px-4 pt-3 pb-3 relative">
      <button
        onClick={resetFilters}
        className="absolute top-2.5 right-3 text-[11px] font-semibold text-coral hover:text-coral-dark hover:underline whitespace-nowrap"
      >
        Reset filters
      </button>
      <div className="flex flex-wrap gap-3 items-end pr-20">
        <Select label="Financial Year" value={filters.fy} options={options.fys} onChange={(v) => setFilter('fy', v)} />
        <Select label="Region" value={filters.region} options={options.regions} onChange={(v) => setFilter('region', v)} />
        <Select label="Mode" value={filters.mode} options={options.modes} onChange={(v) => setFilter('mode', v)} />
        <Select
          label="Month"
          value={filters.month}
          options={options.months.map((m) => ({ value: m, label: monthLabel(m) }))}
          onChange={(v) => setFilter('month', v)}
        />
        <Select label="Week" value={filters.week} options={WEEK_OPTIONS} onChange={(v) => setFilter('week', v)} />
        <Select label="Source" value={filters.source} options={SOURCE_OPTIONS} onChange={(v) => setFilter('source', v)} />
        <Select label="Ticket / F&B" value={filters.ticketFnb} options={TICKET_FNB_OPTIONS} onChange={(v) => setFilter('ticketFnb', v)} />
        <Select label="Denomination" value={filters.denomination} options={denomOptions} onChange={(v) => setFilter('denomination', v)} />
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-warmgray-border">
          {activeChips.map(([key, value]) => (
            <span
              key={key}
              className="inline-flex items-center gap-1.5 bg-gold-light text-navy text-xs font-medium px-2.5 py-1 rounded-full"
            >
              {chipLabel(key, value)}
              <button
                onClick={() => setFilter(key, DEFAULT_FILTERS[key])}
                className="text-navy/60 hover:text-coral font-bold leading-none"
                aria-label={`Clear ${key} filter`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

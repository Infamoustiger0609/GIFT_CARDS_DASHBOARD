import React, { createContext, useContext, useMemo, useState, useCallback } from 'react'
import activationCube from '../data/activationCube.json'
import redemptionCube from '../data/redemptionCube.json'
import heroProducts from '../data/heroProducts.json'
import { fyOf, WEEKEND_DAYS } from './constants'

const FilterContext = createContext(null)

export const DEFAULT_FILTERS = {
  fy: 'All', // 'All' | 'FY2024-25' | 'FY2025-26'
  region: 'All', // Region_Clean value | 'All'
  mode: 'All', // Physical | Aggregator | Corporate | Online | 'All'
  month: 'All', // YearMonth | 'All'
  week: 'All', // 'All' | 'Weekday' | 'Weekend'
  source: 'All', // 'All' | 'Source' | 'Non-Source'
  ticketFnb: 'All' // 'All' | 'Ticket' | 'F&B'
}

function isWeekend(weekday) {
  return WEEKEND_DAYS.has(weekday)
}

function passesCommon(row, filters) {
  if (filters.fy !== 'All' && fyOf(row.YearMonth) !== filters.fy) return false
  if (filters.region !== 'All' && row.Region_Clean !== filters.region) return false
  if (filters.month !== 'All' && row.YearMonth !== filters.month) return false
  if (filters.week !== 'All') {
    const wknd = isWeekend(row.Weekday)
    if (filters.week === 'Weekend' && !wknd) return false
    if (filters.week === 'Weekday' && wknd) return false
  }
  return true
}

export function FilterProvider({ children }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)

  const setFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), [])

  const filteredActivation = useMemo(() => {
    return activationCube.filter((row) => {
      if (!passesCommon(row, filters)) return false
      if (filters.mode !== 'All' && row.ActivationModeFinal !== filters.mode) return false
      // Source and Ticket/F&B filters don't apply to the activation cube
      // (no such fields exist there) — they only narrow redemption rows.
      return true
    })
  }, [filters])

  const filteredRedemption = useMemo(() => {
    return redemptionCube.filter((row) => {
      if (!passesCommon(row, filters)) return false
      if (filters.mode !== 'All' && row.ActivationMode !== filters.mode) return false
      if (filters.source !== 'All' && row.SourceFlag !== filters.source) return false
      if (filters.ticketFnb === 'Ticket' && !['Online', 'Box Office', 'Cancellation'].includes(row.Head)) return false
      if (filters.ticketFnb === 'F&B' && row.Head !== 'F&B') return false
      return true
    })
  }, [filters])

  // Options are derived from the full, unfiltered cubes so the dropdowns
  // never shrink based on other active filters.
  const options = useMemo(() => {
    const regions = [...new Set(activationCube.map((r) => r.Region_Clean).concat(redemptionCube.map((r) => r.Region_Clean)))].sort()
    const modes = [...new Set(activationCube.map((r) => r.ActivationModeFinal))].sort()
    const months = [...new Set(activationCube.map((r) => r.YearMonth).concat(redemptionCube.map((r) => r.YearMonth)))].sort()
    const fys = [...new Set(months.map(fyOf))].sort()
    return { regions, modes, months, fys }
  }, [])

  const value = {
    filters,
    setFilter,
    resetFilters,
    activationRows: filteredActivation,
    redemptionRows: filteredRedemption,
    heroProducts,
    options
  }

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useFilters() {
  const ctx = useContext(FilterContext)
  if (!ctx) throw new Error('useFilters must be used within FilterProvider')
  return ctx
}

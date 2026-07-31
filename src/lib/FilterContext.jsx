import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react'
import { fyOf, WEEKEND_DAYS } from './constants'

const FilterContext = createContext(null)

export const DEFAULT_FILTERS = {
  fy: 'All', // 'All' | 'FY2024-25' | 'FY2025-26'
  region: 'All', // Region_Clean value | 'All'
  mode: 'All', // Physical | Aggregator | Corporate | Online | 'All'
  month: 'All', // YearMonth | 'All'
  week: 'All', // 'All' | 'Weekday' | 'Weekend'
  source: 'All', // 'All' | 'Source' | 'Non-Source'
  ticketFnb: 'All', // 'All' | 'Ticket' | 'F&B'
  denomination: 'All' // Denom value | 'All'
}

function isWeekend(weekday) {
  return WEEKEND_DAYS.has(weekday)
}

// Fields present with the same meaning on both cubes — checked once for
// whichever cube is being filtered.
function passesCommon(row, filters) {
  if (filters.fy !== 'All' && fyOf(row.YearMonth) !== filters.fy) return false
  if (filters.region !== 'All' && row.Region_Clean !== filters.region) return false
  if (filters.month !== 'All' && row.YearMonth !== filters.month) return false
  if (filters.denomination !== 'All' && row.Denom !== filters.denomination) return false
  if (filters.week !== 'All') {
    const wknd = isWeekend(row.Weekday)
    if (filters.week === 'Weekend' && !wknd) return false
    if (filters.week === 'Weekday' && wknd) return false
  }
  return true
}

// The cubes are ~26MB combined — bundling them as JS imports would inline
// them into the JS chunk (measured ~22MB minified) that the browser has to
// parse/compile before first paint. Fetching them at runtime from
// public/data instead lets the shell render immediately and uses the
// engine's native (faster) JSON.parse off the critical path.
async function loadCube(path) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`)
  return res.json()
}

export function FilterProvider({ children }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadCube('/data/activationCube.json'),
      loadCube('/data/redemptionCube.json'),
      loadCube('/data/heroProducts.json')
    ])
      .then(([activationCube, redemptionCube, heroProducts]) => {
        if (!cancelled) setData({ activationCube, redemptionCube, heroProducts })
      })
      .catch((err) => {
        if (!cancelled) setError(err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), [])

  const filteredActivation = useMemo(() => {
    if (!data) return []
    return data.activationCube.filter((row) => {
      if (!passesCommon(row, filters)) return false
      if (filters.mode !== 'All' && row.ActivationModeFinal !== filters.mode) return false
      // Source and Ticket/F&B filters don't apply to the activation cube
      // (no such fields exist there) — they only narrow redemption rows.
      return true
    })
  }, [data, filters])

  const filteredRedemption = useMemo(() => {
    if (!data) return []
    return data.redemptionCube.filter((row) => {
      if (!passesCommon(row, filters)) return false
      if (filters.mode !== 'All' && row.ActivationMode !== filters.mode) return false
      if (filters.source !== 'All' && row.SourceFlag !== filters.source) return false
      if (filters.ticketFnb === 'Ticket' && !['Online', 'Box Office', 'Cancellation'].includes(row.Head)) return false
      if (filters.ticketFnb === 'F&B' && row.Head !== 'F&B') return false
      return true
    })
  }, [data, filters])

  // Options are derived from the full, unfiltered cubes so the dropdowns
  // never shrink based on other active filters.
  const options = useMemo(() => {
    if (!data) return { regions: [], modes: [], months: [], fys: [], denominations: [] }
    const { activationCube, redemptionCube } = data
    const regions = [...new Set(activationCube.map((r) => r.Region_Clean).concat(redemptionCube.map((r) => r.Region_Clean)))].sort()
    const modes = [...new Set(activationCube.map((r) => r.ActivationModeFinal))].sort()
    const months = [...new Set(activationCube.map((r) => r.YearMonth).concat(redemptionCube.map((r) => r.YearMonth)))].sort()
    const fys = [...new Set(months.map(fyOf))].sort()
    const denominations = [
      ...new Set(
        activationCube
          .map((r) => r.Denom)
          .concat(redemptionCube.map((r) => r.Denom))
          .filter((d) => d && d !== 'N/A')
      )
    ].sort()
    return { regions, modes, months, fys, denominations }
  }, [data])

  const value = {
    filters,
    setFilter,
    resetFilters,
    activationRows: filteredActivation,
    redemptionRows: filteredRedemption,
    heroProducts: data?.heroProducts || [],
    options,
    isLoading: !data && !error,
    error
  }

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useFilters() {
  const ctx = useContext(FilterContext)
  if (!ctx) throw new Error('useFilters must be used within FilterProvider')
  return ctx
}

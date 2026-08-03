import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react'
import { fyOf, WEEKEND_DAYS } from './constants'

const FilterContext = createContext(null)

// Every filter is now a multi-select: an array of allowed values. An empty
// array means "no restriction on this dimension" (the old 'All'). Within one
// dimension, multiple selected values combine with OR (row matches if its
// value is in the set); different dimensions still combine with AND.
export const DEFAULT_FILTERS = {
  fy: [],
  region: [],
  mode: [],
  month: [],
  week: [],
  source: [],
  ticketFnb: [],
  denomination: []
}

function isWeekend(weekday) {
  return WEEKEND_DAYS.has(weekday)
}

// selected.length === 0 => no restriction (matches everything).
function matches(selected, value) {
  return selected.length === 0 || selected.includes(value)
}

function ticketFnbBucket(head) {
  if (head === 'F&B') return 'F&B'
  if (head === 'Online' || head === 'Box Office' || head === 'Cancellation') return 'Ticket'
  return null
}

// Fields present with the same meaning on both cubes — checked once for
// whichever cube is being filtered. `skipMonth` is used to build the
// "all months" row pools that the MoM/QoQ/YoY comparisons sum over — every
// other filter (including FY) still applies, only the Month restriction is
// lifted so the comparison can reach adjacent months.
function passesCommon(row, filters, { skipMonth = false } = {}) {
  if (!matches(filters.fy, fyOf(row.YearMonth))) return false
  if (!matches(filters.region, row.Region_Clean)) return false
  if (!skipMonth && !matches(filters.month, row.YearMonth)) return false
  if (!matches(filters.denomination, row.Denom)) return false
  if (filters.week.length > 0) {
    const slot = isWeekend(row.Weekday) ? 'Weekend' : 'Weekday'
    if (!filters.week.includes(slot)) return false
  }
  return true
}

function filterActivation(cube, filters, opts) {
  return cube.filter((row) => {
    if (!passesCommon(row, filters, opts)) return false
    if (!matches(filters.mode, row.ActivationModeFinal)) return false
    // Source and Ticket/F&B filters don't apply to the activation cube
    // (no such fields exist there) — they only narrow redemption rows.
    return true
  })
}

function filterRedemption(cube, filters, opts) {
  return cube.filter((row) => {
    if (!passesCommon(row, filters, opts)) return false
    // Mode filters by *this redemption's own* channel (RedemptionModeFinal:
    // Online/Physical, based on the transaction's Outlet), not by where the
    // card was originally activated (ActivationMode) — those are two
    // independent questions. ActivationMode stays on the row for anyone
    // building a separate "origin channel" lens later; it must not drive
    // the main Mode filter's Online/Physical decision for redemption rows.
    if (!matches(filters.mode, row.RedemptionModeFinal)) return false
    if (!matches(filters.source, row.SourceFlag)) return false
    if (filters.ticketFnb.length > 0) {
      const bucket = ticketFnbBucket(row.Head)
      if (!bucket || !filters.ticketFnb.includes(bucket)) return false
    }
    return true
  })
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

  // value is always an array here (react-select isMulti onChange).
  const setFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value || [] }))
  }, [])

  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), [])

  const filteredActivation = useMemo(() => (data ? filterActivation(data.activationCube, filters) : []), [data, filters])
  const filteredRedemption = useMemo(() => (data ? filterRedemption(data.redemptionCube, filters) : []), [data, filters])

  // "All months" pools for the MoM/QoQ/YoY comparison badges — same filters,
  // Month restriction lifted (see passesCommon's skipMonth doc above).
  const activationRowsAllMonths = useMemo(
    () => (data ? filterActivation(data.activationCube, filters, { skipMonth: true }) : []),
    [data, filters]
  )
  const redemptionRowsAllMonths = useMemo(
    () => (data ? filterRedemption(data.redemptionCube, filters, { skipMonth: true }) : []),
    [data, filters]
  )

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

  // The month(s) comparisons treat as "current". Explicit Month selection
  // wins; otherwise default to the latest month present under the rest of
  // the active filters (so e.g. an FY filter still picks a sensible anchor).
  // Selecting every month via "Select All" is treated the same as selecting
  // none — both mean "no real restriction" — so the anchor logic still
  // kicks in instead of treating the whole date range as one "current period".
  const comparisonMonths = useMemo(() => {
    const isRealRestriction = filters.month.length > 0 && filters.month.length < options.months.length
    if (isRealRestriction) return [...filters.month].sort()
    const allMonths = [...new Set([...activationRowsAllMonths.map((r) => r.YearMonth), ...redemptionRowsAllMonths.map((r) => r.YearMonth)])].sort()
    const latest = allMonths[allMonths.length - 1]
    return latest ? [latest] : []
  }, [filters.month, options.months, activationRowsAllMonths, redemptionRowsAllMonths])

  const value = {
    filters,
    setFilter,
    resetFilters,
    activationRows: filteredActivation,
    redemptionRows: filteredRedemption,
    activationRowsAllMonths,
    redemptionRowsAllMonths,
    comparisonMonths,
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

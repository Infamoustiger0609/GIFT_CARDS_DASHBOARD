import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react'
import { fyOf, WEEKEND_DAYS, NONE_SELECTED } from './constants'
import { REDEMPTION_MODES, redemptionModeOf } from './redemptionMode'
import { ACTIVATION_SOURCES, sourceOf } from './activationSource'

const FilterContext = createContext(null)

// Every filter is now a multi-select: an array of allowed values. An empty
// array means "no restriction on this dimension" (the old 'All'). Within one
// dimension, multiple selected values combine with OR (row matches if its
// value is in the set); different dimensions still combine with AND.
//
// 2026-08-05: the single shared `mode` filter is gone, split into two fully
// independent filters — `activationSource` and `redemptionSource` — since
// they were never really the same question (see each one's doc comment at
// its filterActivation/filterRedemption call site below).
export const DEFAULT_FILTERS = {
  fy: [],
  region: [],
  activationSource: [],
  redemptionSource: [],
  cardType: [],
  month: [],
  week: [],
  ticketFnb: [],
  denomination: []
}

function isWeekend(weekday) {
  return WEEKEND_DAYS.has(weekday)
}

// selected.length === 0 => no restriction (matches everything).
// selected === [NONE_SELECTED] => every option was explicitly deselected
// (matches nothing) — see NONE_SELECTED's doc comment in constants.js.
function matches(selected, value) {
  if (selected.length === 1 && selected[0] === NONE_SELECTED) return false
  return selected.length === 0 || selected.includes(value)
}

// Exported so chart-grouping call sites (e.g. Overview.jsx's Ticket vs F&B
// chart) can reuse this exact bucketing instead of re-deriving it.
export function ticketFnbBucket(head) {
  if (head === 'F&B') return 'F&B'
  if (head === 'Online' || head === 'Box Office' || head === 'Cancellation') return 'Ticket'
  return null
}

// Fields present with the same meaning on both cubes — checked once for
// whichever cube is being filtered. `skipMonth` is used to build the
// "all months" row pools that the MoM/QoQ/YoY comparisons sum over — every
// other filter (including FY) still applies, only the Month restriction is
// lifted so the comparison can reach adjacent months. `skipFY` is the same
// idea for the Year-on-Year chart: every other filter (including Month)
// still applies, only the FY restriction is lifted so every FY present
// under the rest of the active filters shows up as its own bar.
function passesCommon(row, filters, { skipMonth = false, skipFY = false } = {}) {
  if (!skipFY && !matches(filters.fy, fyOf(row.YearMonth))) return false
  if (!matches(filters.region, row.Region_Clean)) return false
  if (!skipMonth && !matches(filters.month, row.YearMonth)) return false
  if (!matches(filters.denomination, row.Denom)) return false
  if (!matches(filters.cardType, row.CardType)) return false
  if (!matches(filters.week, isWeekend(row.Weekday) ? 'Weekend' : 'Weekday')) return false
  return true
}

function filterActivation(cube, filters, opts) {
  return cube.filter((row) => {
    if (!passesCommon(row, filters, opts)) return false
    // Bucketed via sourceOf() into the 3-source model (Aggregators /
    // Corporate / Cinema) — the exact same bucketing every "by Source"
    // chart uses (lib/activationSource.js), so the filter and every chart
    // agree by construction. Never touches redemption rows — the two
    // cubes have independent Source filters.
    if (!matches(filters.activationSource, sourceOf(row.ActivationModeFinal))) return false
    // Ticket/F&B filter doesn't apply to the activation cube (no such
    // field exists there) — it only narrows redemption rows.
    return true
  })
}

function filterRedemption(cube, filters, opts) {
  return cube.filter((row) => {
    if (!passesCommon(row, filters, opts)) return false
    // Determined solely by *this transaction's own* Outlet
    // (RedemptionModeFinal), via redemptionModeOf() — never by
    // ActivationMode / where the card was originally activated. There is
    // no origin-tracking here, and no "Aggregator" option: Aggregator-
    // activated cards have no redemption channel of their own, so a card
    // that was activated via an Aggregator is filtered by *where it was
    // redeemed* (Cinema or Corporate), exactly like every other card. See
    // lib/redemptionMode.js. Completely independent from
    // filters.activationSource above — never touches activation rows.
    if (!matches(filters.redemptionSource, redemptionModeOf(row.RedemptionModeFinal))) return false
    if (!matches(filters.ticketFnb, ticketFnbBucket(row.Head))) return false
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
  //
  // Changing `fy` also prunes any explicit `month` selection down to the
  // months that still belong to the newly-selected FY(s) — without this,
  // picking specific months under one FY and then switching FY would leave
  // stale out-of-FY months selected, and since fy/month AND together (see
  // passesCommon below), that combination can match zero rows, silently
  // zeroing every KPI. `[]` (unrestricted) and the NONE_SELECTED sentinel
  // both need no pruning: `[]` already means "every month the new FY
  // narrowing allows" with no special-casing, and NONE_SELECTED already
  // means "nothing" regardless of FY.
  const setFilter = useCallback((key, value) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value || [] }
      if (key !== 'fy') return next

      const monthIsNoneSelected = prev.month.length === 1 && prev.month[0] === NONE_SELECTED
      if (prev.month.length === 0 || monthIsNoneSelected) return next

      const fySelection = next.fy
      const fyIsNoneSelected = fySelection.length === 1 && fySelection[0] === NONE_SELECTED
      if (fyIsNoneSelected) {
        next.month = []
        return next
      }
      if (fySelection.length === 0) return next

      const pruned = prev.month.filter((m) => fySelection.includes(fyOf(m)))
      next.month = pruned.length > 0 ? pruned : []
      return next
    })
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

  // "All FY" pools for the Year-on-Year chart — same filters, FY restriction
  // lifted (see passesCommon's skipFY doc above).
  const activationRowsAllFY = useMemo(
    () => (data ? filterActivation(data.activationCube, filters, { skipFY: true }) : []),
    [data, filters]
  )
  const redemptionRowsAllFY = useMemo(
    () => (data ? filterRedemption(data.redemptionCube, filters, { skipFY: true }) : []),
    [data, filters]
  )

  // Options are derived from the full, unfiltered cubes so the dropdowns
  // never shrink based on other active filters — with one deliberate
  // exception: `months` narrows to whichever FY(s) are currently selected
  // (see below), since "which months exist" genuinely depends on "which
  // fiscal year" once there's more than one FY in the data.
  const options = useMemo(() => {
    if (!data) return { regions: [], activationSources: [], redemptionSources: [], cardTypes: [], months: [], fys: [], denominations: [] }
    const { activationCube, redemptionCube } = data
    const regions = [...new Set(activationCube.map((r) => r.Region_Clean).concat(redemptionCube.map((r) => r.Region_Clean)))].sort()
    // Two fully independent filters, each a fixed enumeration (not a raw
    // data-derived field list) since both are bucket models, not passthrough
    // fields: `activationSources` is the 3-bucket ACTIVATION_SOURCES model
    // (Aggregators/Corporate/Cinema, via sourceOf(ActivationModeFinal)) —
    // activation cube only. `redemptionSources` is the 2-bucket
    // REDEMPTION_MODES model (Online/Cinema, via
    // redemptionModeOf(RedemptionModeFinal)) — redemption cube only, no
    // Aggregators option at all since Aggregator-activated cards have no
    // redemption channel of their own.
    const activationSources = ACTIVATION_SOURCES.map((s) => s.key)
    const redemptionSources = REDEMPTION_MODES.map((s) => s.key)
    const allMonths = [...new Set(activationCube.map((r) => r.YearMonth).concat(redemptionCube.map((r) => r.YearMonth)))].sort()
    // `fys` is always derived from the full month universe — it's the thing
    // driving the narrowing below, so it can't be circular and narrow
    // itself. `months` narrows to the selected FY(s): [] (unrestricted)
    // keeps every month; the NONE_SELECTED sentinel (every FY explicitly
    // deselected) correctly yields no months, since no row can match.
    const fys = [...new Set(allMonths.map(fyOf))].sort()
    const fySelection = filters.fy
    const fyIsNoneSelected = fySelection.length === 1 && fySelection[0] === NONE_SELECTED
    const months = fyIsNoneSelected
      ? []
      : fySelection.length === 0
      ? allMonths
      : allMonths.filter((m) => fySelection.includes(fyOf(m)))
    const denominations = [
      ...new Set(
        activationCube
          .map((r) => r.Denom)
          .concat(redemptionCube.map((r) => r.Denom))
          .filter((d) => d && d !== 'N/A')
      )
    ].sort()
    // Same "real value, but not a pickable option" treatment as Denom's
    // N/A: the redemption cube's "Unknown (pre-existing)" and either
    // cube's "N/A" rows still pass through untouched whenever this filter
    // is left unrestricted, they just aren't offered as selectable values.
    const cardTypes = [
      ...new Set(
        activationCube
          .map((r) => r.CardType)
          .concat(redemptionCube.map((r) => r.CardType))
          .filter((c) => c && c !== 'N/A' && c !== 'Unknown (pre-existing)')
      )
    ].sort()
    return { regions, activationSources, redemptionSources, cardTypes, months, fys, denominations }
  }, [data, filters.fy])

  // The month(s) comparisons treat as "current". Explicit Month selection
  // wins; otherwise default to the latest month present under the rest of
  // the active filters (so e.g. an FY filter still picks a sensible anchor).
  // Selecting every month via "Select All" is treated the same as selecting
  // none — both mean "no real restriction" — so the anchor logic still
  // kicks in instead of treating the whole date range as one "current period".
  const comparisonMonths = useMemo(() => {
    const isNoneSelected = filters.month.length === 1 && filters.month[0] === NONE_SELECTED
    const isRealRestriction = !isNoneSelected && filters.month.length > 0 && filters.month.length < options.months.length
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
    activationRowsAllFY,
    redemptionRowsAllFY,
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

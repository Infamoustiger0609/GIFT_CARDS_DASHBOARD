import React, { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { fyOf, WEEKEND_DAYS, WEEKDAY_ORDER, NONE_SELECTED, DENOM_ORDER } from './constants'
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
  weekday: [],
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
  // 2026-08-15: replaces the old numeric "Day" (1-31) global filter — a
  // real field on the main cubes, unlike Day, so it needs no per-dimension
  // incompatibility restriction the way Day used to.
  if (!matches(filters.weekday, row.Weekday)) return false
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

// ---- Cohort cube (2026-08-13, schema replaced same day) ----
// A third, differently-shaped cube — `ActivationYearMonth`/
// `RedemptionYearMonth`/`Region_Clean`/`RedemptionModeFinal`/`Head` dims,
// `RedemptionAmount`/`RedemptionCount`/`Uptake` measures — pre-aggregated
// by BOTH the card's original activation month AND the redemption
// transaction's own month, independently. This is what makes "of the
// cards activated in period X, how much got redeemed within that *same*
// period" answerable at all: the main redemptionCube only has each row's
// own (redemption-event) YearMonth, no activation-month field, so
// filtering *it* by month always means "redemptions happening in the
// period regardless of when the card was activated" — a different
// question entirely (see CardJourney.jsx's 2026-08-13 rewrite for why that
// mattered enough to replace the whole page).
//
// Only CardJourney.jsx reads this. 2026-08-16: the cube gained
// ActivationModeFinal/CardType/Weekday (previously absent), so
// `filterCohort`/`filterCohortByActivation` now apply Activation Source, Card Type, and
// Weekday too, alongside the pre-existing FY/Month (via whichever month
// field(s) the function name says), Region, Redemption Source, and
// Ticket/F&B — every global filter this page's own data can support.
// Activation Source is bucketed via the shared sourceOf() mapping, exactly
// like the main activation cube's own filter (see filterActivation above) —
// not a second hand-rolled mapping. A minority of rows carry
// ActivationModeFinal = 'Pre-existing (activated before Apr 2024)' (a value
// that doesn't exist on the main activationCube at all) — sourceOf() returns
// undefined for it, same as any other unmapped value, so matches() correctly
// excludes those rows whenever a specific Activation Source is selected and
// includes them when the filter is unrestricted; no special-case needed.
//
// A minority of rows carry `ActivationYearMonth = 'Pre-existing (activated
// before Apr 2024)'` (never `RedemptionYearMonth` — confirmed directly,
// that field is always a real 'YYYY-MM'). `fyOf()` on that string doesn't
// throw (splits to one NaN-derived component, produces a nonsense
// 'FYNaN-NaN' that just never matches a real FY selection) — confirmed
// rather than assumed, so no special-case guard is needed: these rows
// count only when FY/Month are both unrestricted, and drop out cleanly
// the moment either narrows to a specific real period.
function passesCohortCommon(row, filters) {
  if (!matches(filters.region, row.Region_Clean)) return false
  if (!matches(filters.redemptionSource, redemptionModeOf(row.RedemptionModeFinal))) return false
  if (!matches(filters.ticketFnb, ticketFnbBucket(row.Head))) return false
  if (!matches(filters.activationSource, sourceOf(row.ActivationModeFinal))) return false
  if (!matches(filters.cardType, row.CardType)) return false
  // Week (Weekend/Weekday binary) also newly supported now that Weekday
  // exists on this cube — same isWeekend()/WEEKEND_DAYS canonical source
  // every other cube's Week filter already reads, not a second copy.
  if (!matches(filters.week, isWeekend(row.Weekday) ? 'Weekend' : 'Weekday')) return false
  if (!matches(filters.weekday, row.Weekday)) return false
  return true
}

// Both ActivationYearMonth AND RedemptionYearMonth must independently pass
// the same FY/Month selection — "of cards activated in this period, how
// much got redeemed within this same period" (2026-08-13's primary
// requirement). A row activated inside the period but redeemed outside it
// (before or after) is excluded here — that's the entire point of this
// cube existing, versus the simpler "to-date" version this replaced.
function filterCohort(cube, filters) {
  return cube.filter((row) => {
    if (!matches(filters.fy, fyOf(row.ActivationYearMonth))) return false
    if (!matches(filters.month, row.ActivationYearMonth)) return false
    if (!matches(filters.fy, fyOf(row.RedemptionYearMonth))) return false
    if (!matches(filters.month, row.RedemptionYearMonth)) return false
    return passesCohortCommon(row, filters)
  })
}

// Activation period fixed to the selection, RedemptionYearMonth left
// completely unrestricted — every redemption of this cohort, whenever it
// happens, including before or after the selected window. Powers the
// "spillover" chart (2026-08-13's bonus capability): the CardJourney page
// visualizes how a fixed activation cohort's redemptions actually spread
// out over time, extending past the activation period rather than being
// clipped to it. This is exactly what the previous (2026-08-13, same-day)
// schema's `filterCohort` computed before RedemptionYearMonth existed to
// narrow against — kept here under its own name since both questions are
// now simultaneously answerable from the one cube.
function filterCohortByActivation(cube, filters) {
  return cube.filter((row) => {
    if (!matches(filters.fy, fyOf(row.ActivationYearMonth))) return false
    if (!matches(filters.month, row.ActivationYearMonth)) return false
    return passesCohortCommon(row, filters)
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

  // 2026-08-16: cohortCube.json split out of the eager Promise.all below and
  // loaded lazily instead — only CardJourney.jsx reads it (via cohortRows/
  // cohortRowsByActivation), but every OTHER page was still paying for its
  // full fetch+parse on every load. It grew from ~1.1MB/4,990 rows to
  // ~17.3MB/57,726 rows the same day it gained ActivationModeFinal/CardType/
  // Weekday (see passesCohortCommon above), so the waste this fixes is
  // real and no longer trivial, even though a direct measurement (Playwright
  // resource timing, not wall-clock guessing) showed the app's overall
  // load time is dominated by redemptionCube.json's own ~56MB, not this —
  // the fix is still worth making since it's now cleanly separable and 7 of
  // 8 pages never need this file at all.
  const [cohortCube, setCohortCube] = useState(null)
  const [cohortLoading, setCohortLoading] = useState(false)
  const [cohortError, setCohortError] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadCube('/data/activationCube.json'), loadCube('/data/redemptionCube.json'), loadCube('/data/heroProducts.json')])
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

  // Idempotent — CardJourney.jsx calls this on mount every time it's
  // visited, but the fetch only actually happens once per app session
  // (skipped if already loaded or already in flight, e.g. from a quick
  // tab-away-and-back before the first fetch resolved). A ref (not state)
  // guards the "already started" check since it must be read synchronously
  // on the very first call, before any state update from that call could
  // have re-rendered this component.
  const cohortFetchStarted = useRef(false)
  const loadCohortCube = useCallback(() => {
    if (cohortFetchStarted.current) return
    cohortFetchStarted.current = true
    setCohortLoading(true)
    loadCube('/data/cohortCube.json')
      .then((cube) => setCohortCube(cube))
      .catch((err) => setCohortError(err))
      .finally(() => setCohortLoading(false))
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

  // Cards activated in the current period AND redeemed within that same
  // period — see filterCohort()'s doc comment above. Only CardJourney.jsx
  // reads either of these. `cohortCube` is null until loadCohortCube() has
  // been called (by CardJourney.jsx on mount) and resolved — both pools
  // are empty arrays until then, same "no data yet" shape every other pool
  // has before the main cubes load.
  const cohortRows = useMemo(() => (cohortCube ? filterCohort(cohortCube, filters) : []), [cohortCube, filters])
  // Cards activated in the current period, redeemed whenever (the
  // "spillover" pool) — see filterCohortByActivation()'s doc comment above.
  const cohortRowsByActivation = useMemo(() => (cohortCube ? filterCohortByActivation(cohortCube, filters) : []), [cohortCube, filters])

  // Options are derived from the full, unfiltered cubes so the dropdowns
  // never shrink based on other active filters — with one deliberate
  // exception: `months` narrows to whichever FY(s) are currently selected
  // (see below), since "which months exist" genuinely depends on "which
  // fiscal year" once there's more than one FY in the data.
  const options = useMemo(() => {
    if (!data) return { regions: [], activationSources: [], redemptionSources: [], cardTypes: [], months: [], fys: [], denominations: [], weekdays: [] }
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
    // 2026-08-12: fixed enumeration, not data-derived — same treatment as
    // activationSources/redemptionSources below. 2026-08-19: DENOM_ORDER
    // itself grew a 12th entry, 'Unknown (pre-existing)' — a real,
    // honestly-named bucket (not a synthetic catch-all), so it's a pickable
    // option here like every other DENOM_ORDER entry, unlike the old
    // 'Other'/'N/A' values it replaced (never added to this list, so never
    // pickable, same "not a pickable option, but real rows still pass
    // through untouched when unrestricted" treatment those had while they
    // still existed in the data).
    const denominations = DENOM_ORDER
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
    // 2026-08-15: fixed enumeration (WEEKDAY_ORDER), same treatment as
    // activationSources/redemptionSources/denominations above — a closed
    // 7-value set, not a raw data-derived field list.
    const weekdays = WEEKDAY_ORDER
    return { regions, activationSources, redemptionSources, cardTypes, months, fys, denominations, weekdays }
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
    cohortRows,
    cohortRowsByActivation,
    loadCohortCube,
    cohortLoading,
    cohortError,
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

import React, { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
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
  denomination: [],
  // 2026-08-21: not an array like every other filter above — a single day
  // or range, `{ start, end }` ('YYYY-MM-DD' strings or null). `start: null`
  // means unrestricted/no selection; `end: null` with a real `start` means a
  // single day. Set via its own `setDateRange()`, not the generic
  // `setFilter()`, since setFilter's `value || []` fallback assumes an
  // array. See the Date Range section below for why this needs its own
  // (much smaller) pair of "daily" cubes rather than reading the main ones.
  dateRange: { start: null, end: null }
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

// ---- Universal cube (2026-08-22) ----
// Universal.json — 28 monthly rows, whole-company transaction data (every
// payment method, not just gift cards): YearMonth/TotalTransactions/
// TotalRevenue/TotalTicketRevenue/TotalFnbRevenue. Powers Overview.jsx's
// ATV KPI card only. Deliberately narrower than passesCommon() above: this
// cube has no Region/CardType/ActivationSource/RedemptionSource/Weekday/
// DateStr field at all (confirmed directly against the file), so it must
// ONLY ever be narrowed by FY and Month — applying any of the others would
// either throw (no such field) or, worse, silently do nothing while
// looking like it should narrow the pool. `matches()` is reused as-is
// (same OR-within-dimension/AND-across-dimensions semantics), just against
// this cube's own two applicable fields.
function filterUniversal(cube, filters, { skipMonth = false, skipFY = false } = {}) {
  return cube.filter((row) => {
    if (!skipFY && !matches(filters.fy, fyOf(row.YearMonth))) return false
    if (!skipMonth && !matches(filters.month, row.YearMonth)) return false
    return true
  })
}

// Sentinel ActivationModeFinal/ActivationYearMonth value for cohortCube.json
// rows whose card was activated before this dataset's Apr 2024 start (no
// real activation month to report). See passesCohortCommon()'s own
// 2026-08-20 bug-fix comment below for why this needs a hard, unconditional
// exclusion rather than relying on FY/Month/Activation Source to filter it
// out incidentally.
const PRE_EXISTING_ACTIVATION = 'Pre-existing (activated before Apr 2024)'

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
// not a second hand-rolled mapping.
//
// 2026-08-20 bug fix: a minority of rows carry ActivationModeFinal (and the
// matching ActivationYearMonth) equal to PRE_EXISTING_ACTIVATION — cards
// activated before this dataset's Apr 2024 start, with no real activation
// month to report. The reasoning used to be "no special-case guard needed"
// because fyOf() on that sentinel string produces a nonsense 'FYNaN-NaN'
// that never matches a *specific* FY/Month selection, and sourceOf()
// returns undefined for it, which a *specific* Activation Source selection
// also correctly excludes. That reasoning missed the "All" case: matches([],
// x) is unconditionally true regardless of what x is (empty selection means
// unrestricted), so with FY/Month/Activation Source all left at "All" — the
// page's own default state — every one of these checks was a no-op and
// Pre-existing rows leaked straight into cohortRowsByActivation (inflating
// the spillover chart's Redemption series and, before RedemptionYearMonth
// existed on this cube, would have leaked into cohortRows the same way).
// These cards were never "activated in this period" under any FY/Month
// selection, so they must never appear on this page at all — fixed with a
// hard, unconditional exclusion below, independent of any filter's state.
function passesCohortCommon(row, filters) {
  if (row.ActivationModeFinal === PRE_EXISTING_ACTIVATION) return false
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
function filterCohort(cube, filters, { skipMonth = false, skipFY = false } = {}) {
  return cube.filter((row) => {
    if (!skipFY && !matches(filters.fy, fyOf(row.ActivationYearMonth))) return false
    if (!skipMonth && !matches(filters.month, row.ActivationYearMonth)) return false
    if (!skipFY && !matches(filters.fy, fyOf(row.RedemptionYearMonth))) return false
    if (!skipMonth && !matches(filters.month, row.RedemptionYearMonth)) return false
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

// ---- Card Journey row-level cube (2026-09-07) ----
// `cardJourneyRowLevel.parquet` — one row per (CardNumber, activation,
// redemption) pairing, the same shape `cohortCube.json` is pre-aggregated
// FROM, but kept at row level specifically so a real `CardNumber` field
// survives. cohortCube.json's own `UniqueCardCount` is a per-ROW distinct
// count (computed once, at cube-build time, over whatever grain that row's
// own group-by produced) — summing it across MULTIPLE rows (which is what
// every `sumBy(..., 'UniqueCardCount')` on Card Journey does, since the
// page almost never narrows to exactly one cohort-cube row) silently
// double-counts any card that appears in more than one of those rows
// (e.g. one card redeeming in 2 different regions, or across 2 different
// months, within the same filtered selection) — a classic "sum of
// per-group distinct counts != distinct count of the union" error. This
// is NOT a cohortCube.json data bug — cohortCube.json's own per-row
// UniqueCardCount values are individually correct; the bug is entirely in
// treating a SUM of them as if it were a true distinct count over a wider
// selection. Confirmed directly: FY2026-27's "Of Those, Redeemed" card
// count read 257,600 via the old sum, vs. the true 228,202 from an exact
// COUNT(DISTINCT CardNumber) over this row-level file (an 11.4% overcount)
// — see the 2026-09-07 CLAUDE.md entry for the full before/after.
//
// Scope: only the "Of Those, Redeemed" headline card count (and its direct
// dependents — the "Transaction Value"/"Additional Revenue" KPI subCounts,
// the "By Cards" rate, and the top-level flow-diagram node, all of which
// already read the exact same `redeemedCount` variable) is switched to this
// exact-count source. The deeper per-BUCKET card counts elsewhere on this
// page (by Head, by Region, by Weekday, the spillover chart's per-month
// counts, and the 4 individual flow-diagram child nodes) still read
// cohortCube.json's UniqueCardCount sums — switching those to exact
// per-bucket distinct counts is a separate, larger question (per-bucket
// exact distinct counts do not sum back to the exact distinct count of
// their own union, the same way `netBucketsProportionally`/`bucketSum`'s
// existing amount-based bucketing is designed to sum exactly to its own
// parent total — resolving that tension needs its own decision, not a
// silent guess here) — flagged, not fixed, in this pass.
//
// Fields present: CardNumber, ActivationYearMonth, RedemptionYearMonth,
// Region_Clean, RedemptionModeFinal, Head, RedemptionAmount, Uptake —
// confirmed directly against the file (no ActivationModeFinal/CardType/
// Weekday, unlike cohortCube.json), so this pool can only support the
// filters below: FY/Month (both date fields, same AND-both-dates rule as
// filterCohort), Region, Redemption Source, Ticket/F&B. Activation
// Source/Card Type/Week/Weekday are NOT supported — CardJourney.jsx gates
// on `cardJourneyRowLevelFiltersSupported` (same hard-gate pattern as
// `dateRangeAvailable()` above) and falls back to the old approximate sum
// whenever one of those 4 is active, rather than silently ignoring them.
function passesCardJourneyRowLevelCommon(row, filters) {
  if (!matches(filters.region, row.Region_Clean)) return false
  if (!matches(filters.redemptionSource, redemptionModeOf(row.RedemptionModeFinal))) return false
  if (!matches(filters.ticketFnb, ticketFnbBucket(row.Head))) return false
  return true
}
function filterCardJourneyRowLevel(rows, filters) {
  return rows.filter((row) => {
    if (row.ActivationYearMonth === PRE_EXISTING_ACTIVATION) return false
    if (!matches(filters.fy, fyOf(row.ActivationYearMonth))) return false
    if (!matches(filters.month, row.ActivationYearMonth)) return false
    if (!matches(filters.fy, fyOf(row.RedemptionYearMonth))) return false
    if (!matches(filters.month, row.RedemptionYearMonth)) return false
    return passesCardJourneyRowLevelCommon(row, filters)
  })
}
function cardJourneyRowLevelFiltersSupported(filters) {
  return filters.activationSource.length === 0 && filters.cardType.length === 0 && filters.week.length === 0 && filters.weekday.length === 0
}

// ---- Date Range (2026-08-21), backed by a 4th pair of cubes ----
// `dailyActivationCube.json`/`dailyRedemptionCube.json` are day-level
// (`DateStr`, not `YearMonth`) but otherwise much thinner than the main
// cubes — no CardType/Denom/ActivationSource/RedemptionSource dimension at
// all (confirmed directly against both files: DateStr/Region_Clean/
// ActivationModeFinal/ActivationAmount/ActivationCount on the activation
// side, DateStr/Region_Clean/RedemptionModeFinal/Head/RedemptionAmount/
// RedemptionCount/Uptake on the redemption side) — so a Date Range
// selection can only ever combine with FY/Month (both derivable from
// `DateStr`'s own 'YYYY-MM' prefix) and Region (a real field on both daily
// cubes). Only Overview.jsx reads the two row pools this produces; every
// other page's data is completely untouched by this filter, by
// construction — nothing here ever reads `activationCube`/`redemptionCube`.
//
// `dateRangeAvailable` is a hard gate, same "don't silently show wrong
// numbers" pattern the 2026-08-10 Day filter used for the same reason (and
// the reason that Day filter was removed for on 2026-08-15 was unrelated —
// it was replaced by the Weekday filter, a real field on the *main* cubes;
// this Date Range filter is a different feature, reusing the daily cubes
// that Day filter also used, for a different question: an arbitrary
// day/range instead of a day-of-month number).
function dateRangeAvailable(filters) {
  return (
    filters.cardType.length === 0 &&
    filters.denomination.length === 0 &&
    filters.activationSource.length === 0 &&
    filters.redemptionSource.length === 0
  )
}

function passesDailyCommon(row, filters) {
  if (!matches(filters.region, row.Region_Clean)) return false
  const ym = row.DateStr.slice(0, 7)
  if (!matches(filters.fy, fyOf(ym))) return false
  if (!matches(filters.month, ym)) return false
  return true
}

function filterDaily(cube, filters, start, end) {
  return cube.filter((row) => row.DateStr >= start && row.DateStr <= end && passesDailyCommon(row, filters))
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
    // 2026-08-22: Universal.json (28 monthly rows, whole-company transaction
    // data — every payment method, not just gift cards) joins the eager
    // load here rather than getting cohortCube.json's lazy-on-visit
    // treatment above — it's tiny (28 rows, a few KB) and every page that
    // reads it (currently just Overview.jsx's ATV card) would gain nothing
    // from deferring a fetch this small.
    // 2026-08-21: channelTransactions.json (28 monthly rows — BMS/PVRINOX/
    // PaytmDistrict/BoxOffice/Total, a whole-company booking-channel split)
    // joins the same eager load as Universal.json, for the same reason —
    // tiny (28 rows), and ChannelPerformance.jsx would gain nothing from
    // deferring a fetch this small.
    Promise.all([
      loadCube('/data/activationCube.json'),
      loadCube('/data/redemptionCube.json'),
      loadCube('/data/heroProducts.json'),
      loadCube('/data/Universal.json'),
      loadCube('/data/channelTransactions.json')
    ])
      .then(([activationCube, redemptionCube, heroProducts, universalCube, channelTransactionsCube]) => {
        if (!cancelled) setData({ activationCube, redemptionCube, heroProducts, universalCube, channelTransactionsCube })
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

  // 2026-09-07: same lazy-load-on-first-use pattern as cohortCube above —
  // only CardJourney.jsx reads this, and it's the one place on the page
  // that needs a true CardNumber (see filterCardJourneyRowLevel()'s own
  // doc comment for why). Parsed with hyparquet (pure JS, no WASM/worker,
  // no server needed — reads the whole ~13MB file into plain row objects
  // in one pass) rather than a live query engine like DuckDB-WASM: this
  // file's size (~13MB/1.98M rows) is comfortably in the same class as
  // cohortCube.json's own ~18.6MB, well within what this app already
  // parses/filters synchronously via plain `.filter()`, and the only
  // operation ever run against it (an AND of a handful of equality/
  // inclusion checks, then a `new Set(...).size` for the distinct count)
  // doesn't need SQL — a full query engine would be meaningfully heavier
  // (a separate WASM bundle + worker + async init) for no real benefit at
  // this size. A pre-aggregated JSON lookup table (the request's other
  // suggested option) was considered and rejected: an EXACT distinct count
  // under an arbitrary multi-select Month/Region/etc. combination can't be
  // derived from any fixed pre-aggregation without also storing per-cell
  // card-ID sets (to resolve overlap between cells) — which is essentially
  // the row-level data again, just reshaped, with none of the size
  // savings a lookup table is supposed to provide.
  const [cardJourneyRowLevelRows, setCardJourneyRowLevelRows] = useState([])
  const [cardJourneyRowLevelLoading, setCardJourneyRowLevelLoading] = useState(false)
  const [cardJourneyRowLevelError, setCardJourneyRowLevelError] = useState(null)
  const cardJourneyRowLevelFetchStarted = useRef(false)
  const loadCardJourneyRowLevel = useCallback(() => {
    if (cardJourneyRowLevelFetchStarted.current) return
    cardJourneyRowLevelFetchStarted.current = true
    setCardJourneyRowLevelLoading(true)
    asyncBufferFromUrl({ url: '/data/cardJourneyRowLevel.parquet' })
      // hyparquet's base build only decodes Uncompressed/Snappy pages —
      // this file's own row groups use ZSTD (confirmed directly: hyparquet
      // threw "unsupported compression codec: ZSTD" without this option),
      // so the `hyparquet-compressors` companion package's decoders are
      // required, not optional, for this specific file.
      .then((file) => parquetReadObjects({ file, compressors }))
      .then((rows) => setCardJourneyRowLevelRows(rows))
      .catch((err) => {
        console.error('loadCardJourneyRowLevel failed:', err)
        setCardJourneyRowLevelError(err)
      })
      .finally(() => setCardJourneyRowLevelLoading(false))
  }, [])

  // Same lazy-load-on-first-use pattern as cohortCube above, for the same
  // reason: only Overview.jsx's Date Range summary panel reads these, and
  // they're irrelevant (indeed never fetched) on every other page. Small
  // combined (~3.2MB, vs. cohortCube's ~18.6MB) so this is mostly about
  // keeping the other 7 pages' load profile exactly as it was, not a
  // meaningful payload saving on its own.
  const [dailyCubes, setDailyCubes] = useState(null)
  const [dailyLoading, setDailyLoading] = useState(false)
  const [dailyError, setDailyError] = useState(null)
  const dailyFetchStarted = useRef(false)
  const loadDailyCubes = useCallback(() => {
    if (dailyFetchStarted.current) return
    dailyFetchStarted.current = true
    setDailyLoading(true)
    Promise.all([loadCube('/data/dailyActivationCube.json'), loadCube('/data/dailyRedemptionCube.json')])
      .then(([dailyActivationCube, dailyRedemptionCube]) => setDailyCubes({ dailyActivationCube, dailyRedemptionCube }))
      .catch((err) => setDailyError(err))
      .finally(() => setDailyLoading(false))
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

  // Its own setter, not routed through setFilter() above — dateRange is an
  // `{ start, end }` object, not an array, so setFilter's `value || []`
  // fallback (built for the multi-select filters) doesn't apply here.
  // Deliberately does NOT get cleared when Card Type/Denomination/
  // Activation Source/Redemption Source turn on — same "grey out and hide,
  // don't force-clear" precedent the old Day filter used for the identical
  // gating (see dateRangeAvailable()'s own doc comment above): the stored
  // selection stays inert and picks back up once the conflicting filter
  // clears, rather than being silently lost.
  const setDateRange = useCallback((range) => {
    setFilters((prev) => ({ ...prev, dateRange: range || { start: null, end: null } }))
  }, [])

  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), [])

  const filteredActivation = useMemo(() => (data ? filterActivation(data.activationCube, filters) : []), [data, filters])
  const filteredRedemption = useMemo(() => (data ? filterRedemption(data.redemptionCube, filters) : []), [data, filters])
  // FY/Month-only — see filterUniversal()'s own doc comment above for why
  // every other filter dimension is deliberately not applied here.
  const universalRows = useMemo(() => (data ? filterUniversal(data.universalCube, filters) : []), [data, filters])

  // ---- Channel Transactions cube (ChannelPerformance.jsx, 2026-08-21) ----
  // channelTransactions.json — 28 monthly rows (YearMonth/BMS/PVRINOX/
  // PaytmDistrict/BoxOffice/Total), a whole-company BOOKING-CHANNEL split
  // (how a ticket was purchased — BookMyShow, the PVR INOX app/site, Paytm
  // Insider/District, or the physical Box Office window). A different
  // question from Universal.json's payment-method split, and from this
  // page's own added "Gift Card" line below (a payment method riding on
  // top of these 4 booking channels, not a 5th channel of the same kind —
  // a deliberate simplification the page itself documents, not an error).
  //
  // Exposed UNFILTERED, deliberately — not run through filterUniversal()
  // (even though it's cube-agnostic and would work) because
  // ChannelPerformance.jsx's own comparison table needs to sum two
  // arbitrary, independently-chosen month sets (the current period AND the
  // same months one year earlier — see comparisonMonths/oneYearEarlier),
  // which by construction reach on both sides of whatever FY/Month happens
  // to be selected. A single "respects the current FY/Month selection"
  // pool (this cube's equivalent of universalRows) couldn't answer that on
  // its own; the page does its own month-set filtering against this raw
  // 28-row array instead, the same "small enough that a page can just slice
  // it directly" treatment heroProducts already gets below.
  const channelTransactionsRows = data?.channelTransactionsCube || []

  // Gift Card is added to the Channel Performance page as a 5th, directly
  // comparable line using net (non-cancelled) RedemptionCount from the
  // redemption cube. It needs its own pool, not redemptionRows/
  // redemptionRowsForComparison, for the same reason channelTransactionsRows
  // above is exposed unfiltered: Region/CardType/Denomination/
  // ActivationSource/RedemptionSource/Week/Weekday don't exist on
  // channelTransactions.json at all, so ChannelPerformance.jsx greys out
  // those controls entirely (see FilterBar.jsx) — but if this pool still
  // silently applied whatever those filters happened to be set to from a
  // page visited earlier in the session, the Gift Card line would be on a
  // different footing than the 4 channel columns beside it (which can
  // never be narrowed by them) without any visible indication why. Only
  // the Head='Cancellation' exclusion applies here — FY/Month are handled
  // exactly like channelTransactionsRows above (the page filters this raw
  // pool by whichever explicit month set it needs), not via `filters`.
  const giftCardTransactionRows = useMemo(() => (data ? data.redemptionCube.filter((r) => r.Head !== 'Cancellation') : []), [data])

  // "All months" pools — Month restriction lifted, FY still applied (see
  // passesCommon's skipMonth doc above). Used for exactly one thing:
  // resolving `comparisonMonths`' own default anchor month below (the
  // latest month present *within whichever FY is currently selected* —
  // this needs to stay FY-aware, since the anchor for "FY2024-25 selected,
  // Month=All" must be Mar 2025, not the dataset's true latest month).
  // Do NOT reuse these as the row pool an actual comparison sums over —
  // see activationRowsForComparison/redemptionRowsForComparison below for
  // why, and the 2026-08-25 bug-fix entry in CLAUDE.md.
  const activationRowsAllMonths = useMemo(
    () => (data ? filterActivation(data.activationCube, filters, { skipMonth: true }) : []),
    [data, filters]
  )
  const redemptionRowsAllMonths = useMemo(
    () => (data ? filterRedemption(data.redemptionCube, filters, { skipMonth: true }) : []),
    [data, filters]
  )

  // 2026-08-25 bug fix: the MoM/QoQ/YoY comparison engine (lib/comparisons.js)
  // needs to actually find a prior-year window's rows regardless of which
  // FY is currently selected — e.g. FY2026-27 selected alone, comparing
  // against FY2025-26 data that was never itself ticked. `activationRowsAllMonths`
  // above still applies the FY filter (only Month is lifted), so a specific
  // FY selection silently zeroed out every comparison whose prior-year
  // window fell outside that FY — the delta badges just went blank with no
  // error, since `sumForMonths()` correctly (from its own point of view)
  // found no rows for a month excluded by the FY filter. These pools lift
  // BOTH the Month and FY restrictions — every other active filter (Region,
  // CardType, Source, etc.) still applies — so a comparison window can
  // always be found regardless of which FY/Month happens to be selected.
  // The *anchor* month itself is still resolved from the FY-aware
  // `comparisonMonths` above — only the actual amount lookups for the
  // current/prior-year windows use these. Every existing call site that
  // fed `activationRowsAllMonths`/`redemptionRowsAllMonths` into a
  // computeComparisons()-family function (Overview/Activation/Redemption
  // pages/CancelRedeem/Summary's MetricComparisonCard) switched to these
  // instead; nothing else ever read those two pools for anything other
  // than a delta lookup, confirmed by grep before making this change.
  const activationRowsForComparison = useMemo(
    () => (data ? filterActivation(data.activationCube, filters, { skipMonth: true, skipFY: true }) : []),
    [data, filters]
  )
  const redemptionRowsForComparison = useMemo(
    () => (data ? filterRedemption(data.redemptionCube, filters, { skipMonth: true, skipFY: true }) : []),
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
  // 2026-08-25: Month AND FY both unrestricted (every other active filter —
  // Region, CardType, Activation/Redemption Source, Denomination, Week,
  // Weekday — still applies), for CardJourney.jsx's own MoM/QoQ/YoY
  // comparison badges. Same reasoning as activationRowsForComparison/
  // redemptionRowsForComparison above: a specific FY selection must still
  // be able to find a prior-year window, which a Month-only-unrestricted
  // pool can't (see that entry's own doc comment and the CLAUDE.md entry
  // for the bug this pattern fixes). `ActivationYearMonth`/
  // `RedemptionYearMonth` are independently restricted-or-not by
  // `skipMonth`/`skipFY` exactly like `filterCohort()`'s normal call —
  // lifting both here just means every row in `cohortCube` that passes the
  // *other* filters is present, so a comparison window can look up any
  // activation-month/redemption-month pair it needs. `comparisonMonths`
  // itself (below) is unaffected — it's derived from the main cubes' own
  // AllMonths pools, not this one, since the anchor month is a
  // dashboard-wide concept, not cohort-specific.
  const cohortRowsForComparison = useMemo(
    () => (cohortCube ? filterCohort(cohortCube, filters, { skipMonth: true, skipFY: true }) : []),
    [cohortCube, filters]
  )
  // 2026-08-25: FY restriction lifted on both date fields, Month
  // restriction (and every other filter) still applied — same shape as
  // activationRowsAllFY/redemptionRowsAllFY above, for CardJourney.jsx's
  // own "Year-on-Year: Activated vs. Redeemed" chart, which needs every FY
  // present under the rest of the active filters to show up as its own
  // bar-pair, not just whichever FY happens to be selected.
  const cohortRowsAllFY = useMemo(() => (cohortCube ? filterCohort(cohortCube, filters, { skipFY: true }) : []), [cohortCube, filters])

  // 2026-09-07 — see filterCardJourneyRowLevel()'s own doc comment above
  // for what this pool is for and why it's scoped to only 3 of the 7
  // filters cohortRows itself supports. `cardJourneyRowLevelReady` is
  // exposed alongside so CardJourney.jsx can tell "not narrowed by X" (the
  // filters-unsupported case) apart from "still loading" (rows is `[]`
  // either way, before the fetch resolves).
  const cardJourneyRowLevelFiltered = useMemo(
    () => filterCardJourneyRowLevel(cardJourneyRowLevelRows, filters),
    [cardJourneyRowLevelRows, filters]
  )
  const cardJourneyRowLevelReady = cardJourneyRowLevelRows.length > 0 && cardJourneyRowLevelFiltersSupported(filters)

  // Date Range's own row pools — see the "Date Range" section above for
  // why these read a 4th pair of cubes instead of activationCube/
  // redemptionCube. `isDateRangeAvailable` false or no `start` picked yet
  // both correctly yield empty pools rather than the full daily cubes —
  // Overview.jsx's summary panel only ever renders when both are true, so
  // there's no case where an empty pool here should read as "zero
  // activity" instead of "not applicable."
  const isDateRangeAvailable = dateRangeAvailable(filters)
  const dailyRangeActive = isDateRangeAvailable && !!filters.dateRange.start
  const dailyActivationRows = useMemo(() => {
    if (!dailyRangeActive || !dailyCubes) return []
    const start = filters.dateRange.start
    const end = filters.dateRange.end || start
    return filterDaily(dailyCubes.dailyActivationCube, filters, start, end)
  }, [dailyCubes, filters, dailyRangeActive])
  const dailyRedemptionRows = useMemo(() => {
    if (!dailyRangeActive || !dailyCubes) return []
    const start = filters.dateRange.start
    const end = filters.dateRange.end || start
    return filterDaily(dailyCubes.dailyRedemptionCube, filters, start, end)
  }, [dailyCubes, filters, dailyRangeActive])

  // Options are derived from the full, unfiltered cubes so the dropdowns
  // never shrink based on other active filters — with one deliberate
  // exception: `months` narrows to whichever FY(s) are currently selected
  // (see below), since "which months exist" genuinely depends on "which
  // fiscal year" once there's more than one FY in the data.
  const options = useMemo(() => {
    if (!data) return { regions: [], activationSources: [], redemptionSources: [], cardTypes: [], months: [], fys: [], denominations: [], weekdays: [] }
    const { activationCube, redemptionCube } = data
    // 2026-08-25: NO_SITE and "Director's Cut" are both real Region_Clean
    // values (confirmed directly against activationCube.json/
    // redemptionCube.json/cohortCube.json), but neither is a true
    // geographic region — NO_SITE is a backend-logging artifact for
    // aggregator-fulfilled cards with no physical site, and "Director's
    // Cut" is a specific premium-format outlet with no region mapping.
    // NO_SITE is also where the "Online" option text came from: regionLabel()
    // (lib/constants.js) has rendered NO_SITE as "Online" everywhere in the
    // UI, including this filter's own dropdown, since 2026-08-03 — a
    // deliberate display-only rename, not a leaked non-Region_Clean value.
    // Checked directly before concluding that: this line only ever maps
    // `r.Region_Clean` (no ActivationModeFinal/RedemptionModeFinal
    // reference, no hardcoded list, nothing left over from the old unified
    // Mode filter), and the live dropdown's actual option set matched this
    // computation exactly (7 entries, no duplicate/extra "Online"). Both
    // values are excluded from this *pickable* list — same "real value,
    // not offered as a selectable option, but still passes through
    // untouched whenever the filter is left unrestricted" treatment
    // Denom's/CardType's own 'N/A'/'Unknown (pre-existing)' values already
    // get below. Every chart's own "by Region" bucketing
    // (lib/regionBuckets.js) reads Region_Clean directly, not this option
    // list, so nothing chart-side changes.
    const regions = [...new Set(activationCube.map((r) => r.Region_Clean).concat(redemptionCube.map((r) => r.Region_Clean)))]
      .filter((r) => r !== 'NO_SITE' && r !== "Director's Cut")
      .sort()
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
  //
  // 2026-08-25 bug fix: `isNoneSelected` (every month explicitly unticked,
  // the NONE_SELECTED sentinel) used to fall through to the same "default
  // to latest month" branch as the unrestricted case below it — so with an
  // FY selected and every month explicitly deselected, every headline KPI
  // correctly went to zero (matches([NONE_SELECTED], anyRealMonth) is
  // always false), but the MoM/QoQ/YoY badges kept showing real
  // percentages anchored to that FY's latest month, as if a month *was*
  // selected. Explicit "select nothing" must mean nothing to compare
  // either, not silently fall back to a default anchor — same "don't show
  // numbers for a selection that matches zero rows" principle every other
  // filter combination on this app already follows.
  const comparisonMonths = useMemo(() => {
    const isNoneSelected = filters.month.length === 1 && filters.month[0] === NONE_SELECTED
    if (isNoneSelected) return []
    const isRealRestriction = filters.month.length > 0 && filters.month.length < options.months.length
    if (isRealRestriction) return [...filters.month].sort()
    const allMonths = [...new Set([...activationRowsAllMonths.map((r) => r.YearMonth), ...redemptionRowsAllMonths.map((r) => r.YearMonth)])].sort()
    const latest = allMonths[allMonths.length - 1]
    return latest ? [latest] : []
  }, [filters.month, options.months, activationRowsAllMonths, redemptionRowsAllMonths])

  const value = {
    filters,
    setFilter,
    setDateRange,
    resetFilters,
    activationRows: filteredActivation,
    redemptionRows: filteredRedemption,
    universalRows,
    channelTransactionsRows,
    giftCardTransactionRows,
    activationRowsAllMonths,
    redemptionRowsAllMonths,
    activationRowsForComparison,
    redemptionRowsForComparison,
    activationRowsAllFY,
    redemptionRowsAllFY,
    comparisonMonths,
    heroProducts: data?.heroProducts || [],
    options,
    cohortRows,
    cohortRowsByActivation,
    cohortRowsForComparison,
    cohortRowsAllFY,
    loadCohortCube,
    cohortLoading,
    cohortError,
    cardJourneyRowLevelFiltered,
    cardJourneyRowLevelReady,
    loadCardJourneyRowLevel,
    cardJourneyRowLevelLoading,
    cardJourneyRowLevelError,
    dateRangeAvailable: isDateRangeAvailable,
    dailyActivationRows,
    dailyRedemptionRows,
    loadDailyCubes,
    dailyCubesLoaded: !!dailyCubes,
    dailyLoading,
    dailyError,
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

import React, { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
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

// ---- Redemption row-level cube (2026-09-07, upgraded 2026-09-16) ----
// `redemption_rowlevel.parquet` — one row per real redemption/cancellation
// transaction, the same shape `redemptionCube.json`/`cohortCube.json` are
// pre-aggregated FROM, but kept at row level specifically so a real
// `CardNumber` field survives. Both cubes' own `UniqueCardCount` fields are
// PER-ROW distinct counts (computed once, at cube-build time, over
// whatever grain that row's own group-by produced) — summing one across
// MULTIPLE rows (which is what every `sumBy(..., 'UniqueCardCount')` /
// `groupSum(..., ['UniqueCardCount'])` call in this app does, since almost
// no chart narrows to exactly one cube row) silently double-counts any card
// that appears in more than one of those rows (e.g. one card redeeming in
// 2 different regions, or across 2 different months, within the same
// filtered selection) — a classic "sum of per-group distinct counts !=
// distinct count of the union" error. This is NOT a cube data bug — the
// per-row UniqueCardCount values are individually correct; the bug is
// entirely in treating a SUM of them as a true distinct count over a wider
// selection. First found and fixed for Card Journey's own headline count
// alone (2026-09-07: FY2026-27's "Of Those, Redeemed" read 257,600 via the
// old sum vs. the true 228,202 exact count, an 11.4% overcount).
//
// 2026-09-16: replaced by a strictly richer file (`redemption_rowlevel
// .parquet`, superseding `cardJourneyRowLevel.parquet` — same 2,205,239
// rows, same 1,131,973 distinct CardNumbers, confirmed by direct
// comparison before switching) that adds Weekday/Format/Category/Denom/
// CardType/SourceFlag/ActivationMode/ActivationCohort on top of the fields
// the old file had (CardNumber/ActivationYearMonth/RedemptionYearMonth-as-
// `YearMonth`/Region_Clean/RedemptionModeFinal/Head/Amount-as-`Amount_num`
// /Uptake). This closes the exact gap the 2026-09-07 entry's own scope note
// left open ("the deeper per-bucket counts... are a separate, larger
// question") — every dimension every redemption-side chart in this app
// buckets by is now present on the row-level file, so there is no longer
// a "can't be done exactly" case on the redemption side, only "not yet
// converted." SIGN WARNING, confirmed directly against the file, not
// assumed: `Amount_num` uses the OPPOSITE sign convention from
// `redemptionCube.json`'s own `RedemptionAmount` — normal (Online/Box
// Office/F&B) transactions are NEGATIVE here, Cancellation rows are
// POSITIVE. Nothing in this app reads `Amount_num` today (only
// `CardNumber` identity + the dimension fields), but don't assume symmetry
// with the main cube's sign if a future feature ever does.
//
// Two filter shapes, matching the two questions this app's redemption-side
// charts ask (see cohortCube.json's own doc comment above for the same
// distinction at cube level):
//   - `filterRedemptionRowLevelCohort()` — both ActivationYearMonth AND
//     YearMonth (the row's own redemption-event month) must independently
//     satisfy the current FY/Month selection — the cohort question Card
//     Journey's own `cohortRows` answers, so this is that page's exact
//     counterpart to `cohortCube.json`.
//   - `filterRedemptionRowLevel()` — only the row's own `YearMonth` is
//     checked (no activation-side date restriction at all) — the plain
//     "redemptions happening in this period, regardless of when the card
//     was activated" question `redemptionCube.json`/`redemptionRows`
//     answers everywhere outside Card Journey (Overview, both dedicated
//     Redemption pages, Summary).
// Both share `passesRedemptionRowLevelCommon()` for the dimensions common
// to every consumer (Region, Redemption Source, Ticket/F&B, Card Type,
// Activation Source via the same sourceOf() bucketing filterActivation()
// uses, Week/Weekday) — full parity with every filter this app has, so
// unlike the old file, no `FiltersSupported()` gate/fallback is needed
// anywhere this pool is used.
function passesRedemptionRowLevelCommon(row, filters) {
  if (!matches(filters.region, row.Region_Clean)) return false
  if (!matches(filters.redemptionSource, redemptionModeOf(row.RedemptionModeFinal))) return false
  if (!matches(filters.ticketFnb, ticketFnbBucket(row.Head))) return false
  if (!matches(filters.cardType, row.CardType)) return false
  if (!matches(filters.activationSource, sourceOf(row.ActivationMode))) return false
  if (!matches(filters.week, isWeekend(row.Weekday) ? 'Weekend' : 'Weekday')) return false
  if (!matches(filters.weekday, row.Weekday)) return false
  return true
}
function filterRedemptionRowLevelCohort(rows, filters, { skipMonth = false, skipFY = false } = {}) {
  return rows.filter((row) => {
    if (row.ActivationYearMonth === PRE_EXISTING_ACTIVATION) return false
    if (!skipFY && !matches(filters.fy, fyOf(row.ActivationYearMonth))) return false
    if (!skipMonth && !matches(filters.month, row.ActivationYearMonth)) return false
    if (!skipFY && !matches(filters.fy, fyOf(row.YearMonth))) return false
    if (!skipMonth && !matches(filters.month, row.YearMonth)) return false
    return passesRedemptionRowLevelCommon(row, filters)
  })
}
// Activation period fixed to the selection, the row's own redemption
// YearMonth left completely unrestricted — the exact-count counterpart to
// `filterCohortByActivation()`, for the spillover chart's own per-bucket
// counts.
function filterRedemptionRowLevelByActivation(rows, filters) {
  return rows.filter((row) => {
    if (row.ActivationYearMonth === PRE_EXISTING_ACTIVATION) return false
    if (!matches(filters.fy, fyOf(row.ActivationYearMonth))) return false
    if (!matches(filters.month, row.ActivationYearMonth)) return false
    return passesRedemptionRowLevelCommon(row, filters)
  })
}
function filterRedemptionRowLevel(rows, filters, { skipMonth = false, skipFY = false } = {}) {
  return rows.filter((row) => {
    if (!skipFY && !matches(filters.fy, fyOf(row.YearMonth))) return false
    if (!skipMonth && !matches(filters.month, row.YearMonth)) return false
    return passesRedemptionRowLevelCommon(row, filters)
  })
}

// ---- Hero Products row-level cube (2026-09-17) ----
// heroProductsCube.parquet has its own field names/shape — ItemName/
// YearMonth/Region_Clean/RedemptionModeFinal/ActivationModeFinal/CardType/
// Denom/Weekday/ItemBillValue/RedemptionQuantity, one row per (item,
// redemption) — distinct from every other cube's own field names, so this
// gets its own filter function rather than reusing passesCommon()/
// passesRedemptionRowLevelCommon() (which read `RedemptionModeFinal`
// alongside a `Head` field this cube doesn't have). No per-row Ticket/F&B
// check is possible or needed — every row here already is F&B by
// construction (there's no Head field to check) — but if the Ticket/F&B
// *filter* itself is set to exclude F&B, every row must still be excluded,
// same as every other F&B-only chart on this page already behaves under
// that filter.
function filterHeroProductsRowLevel(rows, filters) {
  if (!matches(filters.ticketFnb, 'F&B')) return []
  return rows.filter((row) => {
    if (!matches(filters.fy, fyOf(row.YearMonth))) return false
    if (!matches(filters.month, row.YearMonth)) return false
    if (!matches(filters.region, row.Region_Clean)) return false
    if (!matches(filters.cardType, row.CardType)) return false
    if (!matches(filters.denomination, row.Denom)) return false
    if (!matches(filters.week, isWeekend(row.Weekday) ? 'Weekend' : 'Weekday')) return false
    if (!matches(filters.weekday, row.Weekday)) return false
    if (!matches(filters.activationSource, sourceOf(row.ActivationModeFinal))) return false
    if (!matches(filters.redemptionSource, redemptionModeOf(row.RedemptionModeFinal))) return false
    return true
  })
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

// 2026-09-16 (perf): which routes actually consume each row-level pool —
// gates the memos below so a filter click on a page that never reads a
// given pool doesn't pay the cost of re-filtering the full ~2.2M-row
// redemption_rowlevel.parquet array for it. See each pool's own doc
// comment above for what it's for and who reads it.
const COHORT_ROW_LEVEL_ROUTES = ['/card-journey']
const REDEMPTION_ROW_LEVEL_FILTERED_ROUTES = ['/', '/redemption/box-office', '/redemption/fnb', '/summary', '/trends']
const REDEMPTION_ROW_LEVEL_ALLFY_ROUTES = ['/', '/summary']
// 2026-09-17: same reasoning — heroProductsCube.parquet's ~294K rows have
// exactly one consumer (RedemptionFnb.jsx's Hero Products card), confirmed
// by grep, so this must not become a 6th pool re-filtering dashboard-wide.
const HERO_PRODUCTS_ROW_LEVEL_ROUTES = ['/redemption/fnb']

export function FilterProvider({ children }) {
  const { pathname } = useLocation()
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
    // 2026-08-21: channelTransactions.json (28 monthly rows — BMS/PVRINOX/
    // PaytmDistrict/BoxOffice/Total, a whole-company booking-channel split)
    // joins the eager load here rather than getting cohortCube.json's
    // lazy-on-visit treatment above — it's tiny (28 rows, a few KB) and
    // ChannelPerformance.jsx would gain nothing from deferring a fetch
    // this small.
    //
    // 2026-09-16: Universal.json (28 monthly rows, whole-company payment-
    // method split) removed from this load entirely — it powered
    // Overview.jsx's "Universal ATV" breakdown figure, but that whole KPI
    // card was replaced by "Breakage" on 2026-08-29/30, and the removal
    // deliberately left this fetch/filterUniversal()/universalRows plumbing
    // in place per this file's own "leave the dead export, don't chase it"
    // precedent — confirmed dead (zero consumers anywhere in src/pages) when
    // asked directly. Found while verifying the 2026-09-16 exact-card-count
    // audit that this file no longer exists on disk at all, which broke
    // every page's data load app-wide (an unconditional Promise.all member
    // failing fails the whole load) — removed for real this time, since
    // "leave it, it's harmless" stopped being true the moment the file
    // disappeared. Not a fabricated fix: nothing recreates the missing
    // file, since nothing needs it anymore.
    //
    // 2026-09-17: heroProducts.json's own eager load removed the same way —
    // RedemptionFnb.jsx (its one and only consumer, confirmed by grep) now
    // reads live top-15 hero products from heroProductsCube.parquet instead
    // (see the "Hero Products row-level cube" section below), so the static
    // JSON's fetch/field is genuinely unused, not just deferred.
    Promise.all([loadCube('/data/activationCube.json'), loadCube('/data/redemptionCube.json'), loadCube('/data/channelTransactions.json')])
      .then(([activationCube, redemptionCube, channelTransactionsCube]) => {
        if (!cancelled) setData({ activationCube, redemptionCube, channelTransactionsCube })
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

  // 2026-09-07, repointed 2026-09-16: same lazy-load-on-first-use pattern
  // as cohortCube above — most pages don't need a true CardNumber, only
  // Card Journey (headline count), Overview, both dedicated Redemption
  // pages, and Summary do (see the 2026-09-16 exact-card-count audit).
  // Parsed with hyparquet (pure JS, no WASM/worker, no server needed —
  // reads the whole ~26MB file into plain row objects in one pass) rather
  // than a live query engine like DuckDB-WASM: comfortably in the same
  // class as `redemptionCube.json`'s own ~73MB, well within what this app
  // already parses/filters synchronously via plain `.filter()`, and the
  // only operation ever run against it (an AND of a handful of equality/
  // inclusion checks, then a `new Set(...).size` for the distinct count)
  // doesn't need SQL. A pre-aggregated JSON lookup table (considered and
  // rejected the same way when this row-level approach was first chosen)
  // can't give an EXACT distinct count under an arbitrary multi-select
  // filter combination without also storing per-cell card-ID sets — which
  // is essentially the row-level data again, just reshaped.
  const [redemptionRowLevelRows, setRedemptionRowLevelRows] = useState([])
  const [redemptionRowLevelLoading, setRedemptionRowLevelLoading] = useState(false)
  const [redemptionRowLevelError, setRedemptionRowLevelError] = useState(null)
  const redemptionRowLevelFetchStarted = useRef(false)
  const loadRedemptionRowLevel = useCallback(() => {
    if (redemptionRowLevelFetchStarted.current) return
    redemptionRowLevelFetchStarted.current = true
    setRedemptionRowLevelLoading(true)
    asyncBufferFromUrl({ url: '/data/redemption_rowlevel.parquet' })
      .then((file) => parquetReadObjects({ file, compressors }))
      // hyparquet's base build only decodes Uncompressed/Snappy pages —
      // this file's own row groups use ZSTD (confirmed directly, same as
      // its predecessor), so the `hyparquet-compressors` companion
      // package's decoders are required, not optional, for this file.
      .then((rows) => {
        setRedemptionRowLevelRows(rows)
      })
      .catch((err) => {
        console.error('loadRedemptionRowLevel failed:', err)
        setRedemptionRowLevelError(err)
      })
      .finally(() => setRedemptionRowLevelLoading(false))
  }, [])

  // ---- Hero Products row-level cube (2026-09-17) ----
  // heroProductsCube.parquet — 294,261 rows, one per (item, redemption) —
  // replaces the old static heroProducts.json top-15 (whole-dataset, never
  // moved with the filters, explicitly flagged as a known limitation in this
  // page's own history) with a live top-15 that responds to every filter
  // this cube can support. Same lazy-load-on-first-use pattern as
  // redemptionRowLevelRows above (hyparquet + hyparquet-compressors — this
  // file's own row groups are ZSTD-compressed too, confirmed directly, not
  // assumed), since only RedemptionFnb.jsx's Hero Products card ever needs
  // it.
  const [heroProductsRowLevelRows, setHeroProductsRowLevelRows] = useState([])
  const [heroProductsLoading, setHeroProductsLoading] = useState(false)
  const [heroProductsError, setHeroProductsError] = useState(null)
  const heroProductsFetchStarted = useRef(false)
  const loadHeroProductsRowLevel = useCallback(() => {
    if (heroProductsFetchStarted.current) return
    heroProductsFetchStarted.current = true
    setHeroProductsLoading(true)
    asyncBufferFromUrl({ url: '/data/heroProductsCube.parquet' })
      .then((file) => parquetReadObjects({ file, compressors }))
      .then((rows) => {
        setHeroProductsRowLevelRows(rows)
      })
      .catch((err) => {
        console.error('loadHeroProductsRowLevel failed:', err)
        setHeroProductsError(err)
      })
      .finally(() => setHeroProductsLoading(false))
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

  // ---- Channel Transactions cube (ChannelPerformance.jsx, 2026-08-21) ----
  // channelTransactions.json — 28 monthly rows (YearMonth/BMS/PVRINOX/
  // PaytmDistrict/BoxOffice/Total), a whole-company BOOKING-CHANNEL split
  // (how a ticket was purchased — BookMyShow, the PVR INOX app/site, Paytm
  // Insider/District, or the physical Box Office window), and from this
  // page's own added "Gift Card" line below (a payment method riding on
  // top of these 4 booking channels, not a 5th channel of the same kind —
  // a deliberate simplification the page itself documents, not an error).
  //
  // Exposed UNFILTERED, deliberately: ChannelPerformance.jsx's own
  // comparison table needs to sum two arbitrary, independently-chosen
  // month sets (the current period AND the same months one year earlier —
  // see comparisonMonths/oneYearEarlier), which by construction reach on
  // both sides of whatever FY/Month happens to be selected. A single
  // "respects the current FY/Month selection" pool couldn't answer that on
  // its own; the page does its own month-set filtering against this raw
  // 28-row array instead.
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

  // 2026-09-16 — see `redemption_rowlevel.parquet`'s own doc comment above
  // for what these pools are for. `redemptionRowLevelReady` no longer
  // needs a `FiltersSupported()` gate (unlike its 2026-09-07 predecessor)
  // since this file has full parity with every filter this app has — it's
  // only ever "still loading" (`[]`) or ready.
  //
  // 2026-09-17 (perf): gate on a plain boolean, not `pathname` itself, so
  // navigating between two routes that are BOTH in the same list (e.g.
  // Overview -> Summary, both in REDEMPTION_ROW_LEVEL_FILTERED_ROUTES)
  // doesn't change the memo's dependency value and therefore doesn't
  // re-run the full filter over the ~2.2M-row array — only a real change
  // (entering/leaving the route set, or `filters`/`redemptionRowLevelRows`
  // itself changing) does. `pathname` still decides the boolean every
  // render, so a route actually crossing into/out of a list still flips it
  // and still recomputes — this only kills the redundant recompute when
  // the boolean would have come out the same either way.
  const cohortRouteActive = COHORT_ROW_LEVEL_ROUTES.includes(pathname)
  const redemptionFilteredRouteActive = REDEMPTION_ROW_LEVEL_FILTERED_ROUTES.includes(pathname)
  const redemptionAllFYRouteActive = REDEMPTION_ROW_LEVEL_ALLFY_ROUTES.includes(pathname)
  const cohortRowLevelFiltered = useMemo(
    () => (cohortRouteActive ? filterRedemptionRowLevelCohort(redemptionRowLevelRows, filters) : []),
    [redemptionRowLevelRows, filters, cohortRouteActive]
  )
  const cohortRowLevelByActivation = useMemo(
    () => (cohortRouteActive ? filterRedemptionRowLevelByActivation(redemptionRowLevelRows, filters) : []),
    [redemptionRowLevelRows, filters, cohortRouteActive]
  )
  // FY restriction lifted on both date fields (Month and every other
  // filter still applied) — the exact-count counterpart to
  // `cohortRowsAllFY`, for Card Journey's "Year-on-Year" chart's own
  // per-FY card counts.
  const cohortRowLevelAllFY = useMemo(
    () => (cohortRouteActive ? filterRedemptionRowLevelCohort(redemptionRowLevelRows, filters, { skipFY: true }) : []),
    [redemptionRowLevelRows, filters, cohortRouteActive]
  )
  // Plain (non-cohort) redemption-side pool — the exact-count counterpart
  // to `redemptionRows`, for Overview/both dedicated Redemption pages/
  // Summary, none of which ask Card Journey's "activated AND redeemed in
  // this same period" question.
  const redemptionRowLevelFiltered = useMemo(
    () => (redemptionFilteredRouteActive ? filterRedemptionRowLevel(redemptionRowLevelRows, filters) : []),
    [redemptionRowLevelRows, filters, redemptionFilteredRouteActive]
  )
  // FY restriction lifted (Month and every other filter still applied) —
  // the exact-count counterpart to `redemptionRowsAllFY`, for Summary's
  // "By Year" bucket x FY matrix cells.
  const redemptionRowLevelAllFY = useMemo(
    () => (redemptionAllFYRouteActive ? filterRedemptionRowLevel(redemptionRowLevelRows, filters, { skipFY: true }) : []),
    [redemptionRowLevelRows, filters, redemptionAllFYRouteActive]
  )
  const redemptionRowLevelReady = redemptionRowLevelRows.length > 0

  // Route-gated exactly like the 5 pools above — only Redemption · F&B ever
  // reads heroProductsCube.parquet, so a filter click on any other page must
  // not pay to re-filter its ~294K rows. `heroProductsRouteActive` is the
  // same "plain boolean computed once per render, not the raw pathname"
  // pattern the 2026-09-17 perf fix applied to the 5 memos above (see their
  // own doc comment) — navigating between two visits of the same route
  // (impossible here, since there's only one route in the list, but kept
  // consistent with the shared pattern) can't cause a spurious recompute.
  const heroProductsRouteActive = HERO_PRODUCTS_ROW_LEVEL_ROUTES.includes(pathname)
  const heroProductsRowLevelFiltered = useMemo(
    () => (heroProductsRouteActive ? filterHeroProductsRowLevel(heroProductsRowLevelRows, filters) : []),
    [heroProductsRowLevelRows, filters, heroProductsRouteActive]
  )
  // Top-15 by ItemBillValue, in Lacs — replaces the old static
  // heroProducts.json top-15 (whole-dataset, never moved with the filters).
  // Raw ItemName grouping, no de-dup — same "use the data as-is" convention
  // this app follows for every other messy string field (Format/Category —
  // see CLAUDE.md's own "Data reality vs. the original spec" section), so
  // the unfiltered #1 item no longer needs to match the old static file's
  // ₹413.13L figure exactly.
  const heroProductsTop15 = useMemo(() => {
    const byItem = new Map()
    for (const r of heroProductsRowLevelFiltered) {
      byItem.set(r.ItemName, (byItem.get(r.ItemName) || 0) + (r.ItemBillValue || 0))
    }
    return [...byItem.entries()]
      .map(([name, amount]) => ({ name, amount: amount / 100000 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15)
  }, [heroProductsRowLevelFiltered])
  const heroProductsReady = heroProductsRowLevelRows.length > 0

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
    channelTransactionsRows,
    giftCardTransactionRows,
    activationRowsAllMonths,
    redemptionRowsAllMonths,
    activationRowsForComparison,
    redemptionRowsForComparison,
    activationRowsAllFY,
    redemptionRowsAllFY,
    comparisonMonths,
    options,
    cohortRows,
    cohortRowsByActivation,
    cohortRowsForComparison,
    cohortRowsAllFY,
    loadCohortCube,
    cohortLoading,
    cohortError,
    cohortRowLevelFiltered,
    cohortRowLevelByActivation,
    cohortRowLevelAllFY,
    redemptionRowLevelFiltered,
    redemptionRowLevelAllFY,
    redemptionRowLevelReady,
    loadRedemptionRowLevel,
    redemptionRowLevelLoading,
    redemptionRowLevelError,
    heroProductsRowLevelRows,
    heroProductsTop15,
    heroProductsReady,
    loadHeroProductsRowLevel,
    heroProductsLoading,
    heroProductsError,
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

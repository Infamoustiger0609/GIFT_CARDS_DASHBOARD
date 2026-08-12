// Fixed display orders — data-driven options are still derived from the cubes,
// but when a canonical order exists we sort against it for readability.
export const REGION_ORDER = ['NORTH', 'SOUTH', 'EAST', 'WEST', 'CENTRAL', 'NO_SITE']
export const WEEKDAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
// 2026-08-05: redefined from {Saturday, Sunday} to {Friday, Saturday,
// Sunday} — every consumer (the "Week" filter, weekSlotBreakdown() in
// aggregate.js, and FilterContext.jsx's own isWeekend()) reads this single
// Set, so the change propagates everywhere without touching any of them.
export const WEEKEND_DAYS = new Set(['Friday', 'Saturday', 'Sunday'])
export const HEAD_ORDER = ['Online', 'Box Office', 'F&B', 'Cancellation']
// 2026-08-10: redemptionCube's new ActivationCohort field — how long before
// a given redemption its card was originally activated. 'N/A' is always
// cancellation rows (a cancellation reverses a redemption, not an
// activation, so "how long ago was it activated" doesn't apply) — kept as
// its own bucket rather than dropped, same "don't silently exclude real
// rows" convention as every other breakdown in this app, and required for
// the cohort chart's own sum-to-total invariant to hold (cancellation rows
// carry real, negative RedemptionAmount that's part of the total).
export const COHORT_ORDER = [
  'Same month',
  '1-3 months ago',
  '4-6 months ago',
  '7-9 months ago',
  '10-12 months ago',
  '12+ months ago',
  'Pre-existing (activated before Apr 2024)',
  'N/A'
]
// Chart-local display label for the 'N/A' cohort bucket — same "raw value
// stays the data key, only what's drawn changes" pattern as regionLabel()
// above, kept separate since 'N/A' means something different per field
// (there it's a real Region_Clean value; here it's cancellation rows).
export function cohortLabel(key) {
  return key === 'N/A' ? 'Cancel Redeem' : key
}
// 2026-08-10 data refresh regrouped the Denom tiers again (was ₹300/₹500/
// ₹1000/₹2000/₹2000+/₹5000+/₹10000+/Other-Custom — the currency-symbol
// strings from the 2026-08-04 refresh) into bare-number exact/range
// brackets. Found stale while building the Summary page's "by
// Denomination" comparison (2026-08-11): every real Denom value had
// silently stopped matching this list, so orderBy() calls (Overview.jsx's
// Denomination chart) were falling back to alphabetical sort with no
// values dropped, but a hard-equality bucket predicate (Summary.jsx) was
// dropping every row outright — fixed at the source rather than patched
// per call site, so both are correct again.
// 2026-08-12: narrowed to exactly these 11 magnitude buckets per explicit
// request — 'Other' (a real Denom value, same as 'N/A') is deliberately no
// longer part of this list, so it's excluded from the Denomination filter's
// option list and every "by Denomination" chart bucket, same "not a
// pickable option, but real rows still pass through untouched when the
// filter is unrestricted" treatment already applied to 'N/A' everywhere
// else in this app — not silently dropped from the data, just not offered
// as its own bucket/option anymore.
//
// 2026-08-19 data refresh (redemption cube only): the generic 'Other'/'N/A'
// catch-all Denom values are gone entirely, replaced by an honest, named
// 12th bucket — 'Unknown (pre-existing)', for redemptions of cards
// activated before the denomination was ever tracked (same "pre-existing"
// concept as ActivationCohort's own bucket of that name). Unlike the old
// 'Other'/'N/A' values, this is real, always-present, and not junk — added
// as a real 12th entry here rather than treated as an unlabeled leftover,
// so it renders as its own honestly-labeled bucket/bar instead of a
// synthetic "Other." Redemption-only: the activation cube has no such value
// (confirmed directly), so it simply never matches on that side, same as
// any other cube-specific value already tolerated by this shared list.
export const DENOM_ORDER = [
  '0-299',
  '300',
  '301-499',
  '500',
  '501-999',
  '1000',
  '1001-1999',
  '2000',
  '2000+',
  '5000+',
  '10000+',
  'Unknown (pre-existing)'
]

// Display-only rename: the raw Region_Clean value 'NO_SITE' renders as
// "Online" everywhere in the UI (axis ticks, tooltips, the Region filter
// dropdown, etc.) — the underlying data value, REGION_ORDER's sort key, and
// REGION_COLORS' lookup key all stay 'NO_SITE'; only what's drawn on screen
// changes. Unrelated to Head's real 'Online' value (HEAD_ORDER above) —
// same English word, two different fields/questions, just a naming
// coincidence.
const REGION_LABELS = { NO_SITE: 'Online' }
export function regionLabel(key) {
  return REGION_LABELS[key] || key
}

// Sentinel stored as the sole element of a filter's value array to mean
// "every option explicitly deselected" — distinct from the true empty array
// `[]`, which means "unrestricted" (the old 'All'). Never a real option
// value, so it can never collide with actual data. See Select.jsx's
// "Select All" toggle and FilterContext.jsx's `matches()`.
export const NONE_SELECTED = '__none_selected__'

// 2026-08-05: generalized from a single hardcoded FY2024-25/FY2025-26 split
// (`FY_SPLIT = '2025-04'`) to real Apr-Mar fiscal-year arithmetic, so a data
// refresh that adds a 3rd (or Nth) year — e.g. FY2026-27 starting 2026-04 —
// needs no code change here, just more months in the cube. Indian FY runs
// April to March, so a calendar month belongs to the FY that starts the
// most recent April on or before it.
export function fyOf(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number)
  const startYear = m >= 4 ? y : y - 1
  return `FY${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

export function orderBy(values, order) {
  const known = order.filter((o) => values.includes(o))
  const unknown = values.filter((v) => !order.includes(v)).sort()
  return [...known, ...unknown]
}

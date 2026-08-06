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
// 2026-08-04 data refresh regrouped the Denom tiers (was ₹300/500/1000/
// 1500/2000/2500/5000/Other-Custom).
export const DENOM_ORDER = ['₹300', '₹500', '₹1000', '₹2000', '₹2000+', '₹5000+', '₹10000+', 'Other / Custom']

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

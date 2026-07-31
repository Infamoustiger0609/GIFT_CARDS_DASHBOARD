// Fixed display orders — data-driven options are still derived from the cubes,
// but when a canonical order exists we sort against it for readability.
export const REGION_ORDER = ['NORTH', 'SOUTH', 'EAST', 'WEST', 'CENTRAL', 'NO_SITE']
export const MODE_ORDER = ['Physical', 'Aggregator', 'Corporate', 'Online']
export const WEEKDAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const WEEKEND_DAYS = new Set(['Saturday', 'Sunday'])
export const HEAD_ORDER = ['Online', 'Box Office', 'F&B', 'Cancellation']
export const DENOM_ORDER = ['₹300', '₹500', '₹1000', '₹1500', '₹2000', '₹2500', '₹5000', 'Other / Custom']

export const FY_SPLIT = '2025-04'

export function fyOf(yearMonth) {
  return yearMonth >= FY_SPLIT ? 'FY2025-26' : 'FY2024-25'
}

export function orderBy(values, order) {
  const known = order.filter((o) => values.includes(o))
  const unknown = values.filter((v) => !order.includes(v)).sort()
  return [...known, ...unknown]
}

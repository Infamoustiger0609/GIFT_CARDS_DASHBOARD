import { REGION_ORDER, regionLabel } from './constants'
import { redemptionModeOf } from './redemptionMode'

// Extracted from Overview.jsx (2026-08-11) so the Summary page's "by Region"
// comparisons can reuse the exact same bucket definitions instead of a
// second hand-written copy that could drift — see Overview.jsx's own doc
// comment (still there, unchanged) for the full reasoning on why this is
// bucketed rather than a raw Region_Clean groupby: a plain groupby would
// silently mix Corporate/Aggregator/Online activation rows (some of which
// carry a real, but not meaningfully "regional", Region_Clean) into the 5
// physical-cinema regional bars.
export const ACTIVATION_REGION_BUCKETS = [
  ...REGION_ORDER.map((region) => ({
    key: region,
    predicate: (r) => r.ActivationModeFinal === 'Physical' && r.Region_Clean === region
  })),
  { key: 'Aggregators', predicate: (r) => r.ActivationModeFinal === 'Aggregator' },
  { key: 'Corporate', predicate: (r) => r.ActivationModeFinal === 'Corporate' },
  { key: 'Online', predicate: (r) => r.ActivationModeFinal === 'Online' }
]

// Redemption side: 5 "Cinema" regional bars + one combined Online bar (never
// region-split — PVR Inox Online is always tagged Region_Clean='NORTH'
// regardless of the customer's actual location). No Aggregator bucket —
// aggregator-activated cards have no redemption channel of their own.
//
// 2026-08-19 data refresh: the redemption cube's own Region_Clean stopped
// using the shared 'NO_SITE' sentinel for its 6th value and now carries the
// literal string "Director's Cut" directly — a real, intentional 6th region
// (Director's Cut branded screens), not an inferred/guessed identity the way
// the old NO_SITE→"Director's Cut" relabel used to be (see
// redemptionRegionLabel's own history below). The activation cube is
// untouched by this refresh and still uses 'NO_SITE' (regionLabel() below
// still renames it to "Online" there) — the two cubes are now genuinely
// asymmetric on this one value, which is why this bucket set can no longer
// share REGION_ORDER's raw 6-entry list wholesale the way
// ACTIVATION_REGION_BUCKETS still does: only the 5 named regions
// (REGION_ORDER's first 5 entries) mean the same thing on both cubes.
const NAMED_REGIONS = REGION_ORDER.slice(0, 5)
export const REDEMPTION_REGION_BUCKETS = [
  ...NAMED_REGIONS.map((region) => ({
    key: region,
    predicate: (r) => redemptionModeOf(r.RedemptionModeFinal) === 'Cinema' && r.Region_Clean === region
  })),
  { key: "Director's Cut", predicate: (r) => redemptionModeOf(r.RedemptionModeFinal) === 'Cinema' && r.Region_Clean === "Director's Cut" },
  { key: 'Online', predicate: (r) => redemptionModeOf(r.RedemptionModeFinal) === 'Online' }
]

// 2026-08-19: no longer does any relabeling — the raw Region_Clean value on
// the redemption cube IS "Director's Cut" already (see above), so this is a
// plain passthrough to the shared regionLabel() (which only ever special-
// cases 'NO_SITE', a value that never appears on this cube's Region_Clean
// anymore). Kept as its own named function, not inlined at each call site,
// so a future redemption-cube refresh that reintroduces a sentinel-style
// value has one obvious place to add a redemption-specific relabel again —
// exactly what this function existed for previously (see the 2026-08-14/15
// history this replaces, kept in git history rather than repeated here).
export function redemptionRegionLabel(key) {
  return regionLabel(key)
}

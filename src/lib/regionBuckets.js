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
export const REDEMPTION_REGION_BUCKETS = [
  ...REGION_ORDER.map((region) => ({
    key: region,
    predicate: (r) => redemptionModeOf(r.RedemptionModeFinal) === 'Cinema' && r.Region_Clean === region
  })),
  { key: 'Online', predicate: (r) => redemptionModeOf(r.RedemptionModeFinal) === 'Online' }
]

// A small number of physical-cinema redemption rows carry Region_Clean=
// 'NO_SITE' (confirmed against the cube — real data, not an artifact:
// ~₹10.94L). regionLabel() would render that as "Online" (the established
// app-wide rename for the *activation*-side NO_SITE meaning), which would
// collide with this bucket set's own real "Online" bucket — so this
// chart-family needs its own distinct local label rather than the shared
// one.
//
// 2026-08-15: permanently relabeled back to "Director's Cut", per explicit
// user instruction — supersedes the 2026-08-14 "Other/Unmapped" entry this
// paragraph used to document (kept here for history rather than deleted).
// That entry's caveat still holds as a fact (this repo has no outlet-level
// export to independently confirm the identity from), but the label to use
// is now a settled decision, not a placeholder — applies everywhere this
// function is read, including Summary.jsx's "Redemption by Region" table,
// which shares this one function rather than a second copy.
export function redemptionRegionLabel(key) {
  return key === 'NO_SITE' ? "Director's Cut" : regionLabel(key)
}

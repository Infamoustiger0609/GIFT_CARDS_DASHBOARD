import { groupByModeTable } from './aggregate'

// The redemption-side channel model — completely independent from
// lib/activationSource.js's 3-bucket ACTIVATION_SOURCES model. Determined
// solely by *this transaction's own* Outlet, via RedemptionModeFinal — never
// by ActivationMode / where the card was originally activated. Exactly 2
// buckets, always: Aggregators (Amazon/GiftBig) have no redemption channel
// of any kind, so there is no third "Aggregators" bucket here, ever, and no
// "Pre-existing"/unclassified remainder either — every redemption row's
// RedemptionModeFinal is either 'Online' or 'Physical' (checked directly
// against the cube, not assumed).
//
// 'Online' here is a direct passthrough of RedemptionModeFinal='Online'
// (Outlet = "PVR Inox Online") — not a merge, not a relabel. It happens to
// be the same physical outlet that feeds into Activation Source's merged
// 'Corporate' bucket, but the two buckets are defined differently (this one
// is exactly 1 raw value; Activation's Corporate merges 2), so don't treat
// them as the same filter under different names, and don't merge this table
// with ACTIVATION_SOURCES or read ActivationMode from here.
export const REDEMPTION_MODES = [
  { key: 'Online', modes: ['Online'] },
  { key: 'Cinema', modes: ['Physical'] }
]

// The mapping from a raw RedemptionModeFinal value to its redemption-side
// bucket. Returns undefined for any value outside the 2 known ones (there
// shouldn't be any, but this stays consistent with sourceOf()'s contract
// rather than assuming).
export function redemptionModeOf(redemptionModeFinal) {
  return REDEMPTION_MODES.find((s) => s.modes.includes(redemptionModeFinal))?.key
}

// Buckets `rows` into Online/Cinema, each split by CardType. See
// lib/aggregate.js#groupByModeTable for the shared bucketing/fold mechanics
// (also used by lib/activationSource.js's unrelated 3-bucket activation
// model).
export function groupByRedemptionMode(rows, opts) {
  return groupByModeTable(rows, REDEMPTION_MODES, opts)
}

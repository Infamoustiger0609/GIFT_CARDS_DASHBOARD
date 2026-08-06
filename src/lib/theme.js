// Validated color roles (see CLAUDE.md "Palette validation" section for the
// accessibility check run behind these values).
export const COLORS = {
  activation: '#c8952e', // gold
  activationDark: '#a8791f',
  redemption: '#00805a', // teal (adjusted from brand #1d6b63 to clear WCAG chroma floor)
  redemptionDark: '#00664a',
  teal: '#00805a', // alias — same as redemption, used for chart fills
  warning: '#c1502e', // coral — reserved: cancellations / non-source / warnings
  warningDark: '#9e3f22',
  navy: '#1b2430',
  ink: '#1b2430',
  inkMuted: '#6b6459',
  gridline: '#eee9df',
  border: '#e2ddd3'
}

// Fixed-order categorical theme for multi-category breakdowns (regions, modes).
// Validated: lightness band, chroma floor, CVD separation (adjacent + all-pairs
// for <=4 slots), normal-vision floor. Gray is a reserved "Other/Unassigned"
// slot, not part of the rotation.
export const CATEGORICAL = ['#c8952e', '#3568b3', '#00805a', '#9c3f8a', '#6b7a1f']
export const CATEGORICAL_GRAY = '#9a9890'

// For single-series bar charts whose category axis has no dedicated color
// map (Weekday, Format, F&B Category — unlike Region/Head/CardType/
// ActivationSource, which each have their own named map below). Cycles
// through the 5 validated CATEGORICAL hues by position; bar charts only
// need adjacent-pair contrast (not all-pairs, which is only validated up to
// 4 slots for donuts), so a 5-color cycle stays within what's been checked
// even for longer category lists like Format's top-10. A trailing "Other"
// bucket (topNWithOther's synthetic key) should use CATEGORICAL_GRAY
// instead of a rotation slot, per the reserved-gray "Other" convention used
// elsewhere (NO_SITE, unmatched categories) — pass isOther to get that.
export function categoricalColor(i, isOther = false) {
  return isOther ? CATEGORICAL_GRAY : CATEGORICAL[i % CATEGORICAL.length]
}

// Keyed by the raw Region_Clean value, including 'NO_SITE' — the "Online"
// display rename (lib/constants.js#regionLabel) is a rendering-layer
// concern only, so this lookup key is untouched.
export const REGION_COLORS = {
  NORTH: '#c8952e',
  SOUTH: '#3568b3',
  EAST: '#00805a',
  WEST: '#9c3f8a',
  CENTRAL: '#6b7a1f',
  NO_SITE: '#9a9890'
}

export const HEAD_COLORS = {
  Online: '#3568b3',
  'Box Office': '#c8952e',
  'F&B': '#00805a',
  Cancellation: '#c1502e',
  // Not a real Head value — the redemption flow diagram's intermediate
  // "Cinema" rollup node (Box Office + F&B combined, see
  // lib/aggregate.js#netCinemaRedemption). Plum, since it's the one
  // CATEGORICAL hue not already claimed by a sibling/child in that same
  // diagram (Online=blue, Box Office=gold, F&B=teal) — reusing any of
  // those would make the parent node the same color as one of its own
  // children.
  Cinema: '#9c3f8a'
}

// Overview's activation flow: 3 origin sources, each further split by
// CardType. 'Corporate' merges the raw Corporate + Online activation modes
// (see lib/activationSource.js's ACTIVATION_SOURCES), so it takes the hue
// the old per-mode Corporate color used.
export const ACTIVATION_SOURCE_COLORS = {
  Cinema: '#c8952e',
  Aggregators: '#3568b3',
  Corporate: '#00805a'
}

export const CARD_TYPE_COLORS = {
  Digital: '#9c3f8a',
  Physical: '#6b7a1f'
}

// Redemption-side "by Source" charts (lib/redemptionMode.js's REDEMPTION_MODES,
// 2 buckets: Online/Cinema). 'Cinema' reuses ACTIVATION_SOURCE_COLORS.Cinema's
// hue — same word, same visual meaning on both sides of the dashboard.
// 'Online' reuses HEAD_COLORS.Online's blue rather than inventing a new hue:
// RedemptionModeFinal='Online' rows and Head='Online' rows are the exact
// same 3,811 rows in the current data (checked directly), so the color
// carrying across both "by Head" and "by Source" charts is a meaningful
// visual link, not a coincidence.
export const REDEMPTION_SOURCE_COLORS = {
  Online: '#3568b3',
  Cinema: '#c8952e'
}

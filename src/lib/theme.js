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

export const MODE_COLORS = {
  Physical: '#c8952e',
  Aggregator: '#3568b3',
  Corporate: '#00805a',
  Online: '#9c3f8a'
}

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
  Cancellation: '#c1502e'
}

export const SOURCE_COLORS = {
  Source: '#00805a',
  'Non-Source': '#c1502e',
  'N/A': '#9a9890'
}

import { groupByModeTable } from './aggregate'

// The 3-source ORIGIN model — activation-only, drives both the
// activationSource FILTER (FilterContext.jsx) and every "by Source" chart.
// Applies to ActivationModeFinal on the activation cube only — never reads
// or derives anything from the redemption cube; see lib/redemptionMode.js
// for the separate, unrelated 2-bucket model that drives every
// redemption-side Source question instead.
//
// 'Corporate' merges the raw 'Corporate' + 'Online' ActivationModeFinal
// values — 'Online' is real but time-boxed (Apr-Jul 2024 only, ~₹96.98L)
// and isn't offered as its own bucket; it folds into Corporate for
// reporting. 'Cinema' is the raw 'Physical' value, renamed here (not just
// display-renamed downstream) specifically to avoid colliding with the
// unrelated CardType field's own 'Physical' value (card form factor,
// e-gift vs. tangible — see lib/theme.js#CARD_TYPE_COLORS) — same word,
// two different questions, worth never letting collide even as an internal
// key.
export const ACTIVATION_SOURCES = [
  { key: 'Aggregators', modes: ['Aggregator'] },
  { key: 'Corporate', modes: ['Corporate', 'Online'] },
  { key: 'Cinema', modes: ['Physical'] }
]

// The mapping from a raw ActivationModeFinal value to its 3-source bucket —
// activation-side only (see the module doc comment above). Returns
// undefined for values with no source.
export function sourceOf(modeValue) {
  return ACTIVATION_SOURCES.find((s) => s.modes.includes(modeValue))?.key
}

// Buckets `rows` into the 3 activation sources, each split by CardType. See
// lib/aggregate.js#groupByModeTable for the shared bucketing/fold mechanics
// (also used by lib/redemptionMode.js's unrelated 2-bucket redemption
// model).
export function groupByActivationSource(rows, opts) {
  return groupByModeTable(rows, ACTIVATION_SOURCES, opts)
}

// Month-wise (or any x-field-wise) pivot of the 3 sources, for line-chart
// trends. Writes `${source}__count` sibling keys alongside each source's
// amount so ChartTooltip can show the paired count per line.
export function pivotByActivationSource(rows, xField, { modeField, amountField, countField }) {
  const map = new Map()
  for (const r of rows) {
    const key = sourceOf(r[modeField])
    if (!key) continue
    const x = r[xField]
    if (!map.has(x)) map.set(x, { x })
    const entry = map.get(x)
    entry[key] = (entry[key] || 0) + (r[amountField] || 0)
    entry[`${key}__count`] = (entry[`${key}__count`] || 0) + (r[countField] || 0)
  }
  return [...map.values()]
}

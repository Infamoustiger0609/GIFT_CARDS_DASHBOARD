import { sumBy } from './aggregate'

// The 3-source activation model shared across Overview/Activation/
// Redemption pages: ActivationModeFinal (activation cube) or ActivationMode
// (redemption cube's origin-channel field) always maps to exactly one of
// these — "PVR Corporate" merges the Corporate + Online mode values (PVR
// Inox Online + PVR-Corporate together represent the Corporate channel's
// redeem/activate split; "Online" never appears as its own label in the UI).
export const ACTIVATION_SOURCES = [
  { key: 'PVR Corporate', modes: ['Corporate', 'Online'] },
  { key: 'Aggregators', modes: ['Aggregator'] },
  { key: 'Cinema', modes: ['Physical'] }
]

export function sourceOf(modeValue) {
  return ACTIVATION_SOURCES.find((s) => s.modes.includes(modeValue))?.key
}

// Buckets `rows` into the 3 sources by whichever field carries the mode
// value (modeField), then splits each bucket by CardType (Digital/
// Physical). A handful of rows carry no CardType (small zero-count
// correction/adjustment entries) — folded into whichever of Digital/
// Physical is larger for that source, so the two always sum exactly back
// to the source total without ever going negative. Rows whose mode value
// doesn't match any of the 3 sources (e.g. the redemption cube's "N/A" or
// "Pre-existing (activated before Apr 2024)") aren't counted here — a
// caller that needs to surface that remainder computes it separately (see
// RedemptionBoxOffice.jsx / RedemptionFnb.jsx's "Pre-existing" bucket).
export function groupByActivationSource(rows, { modeField, amountField, countField, cardTypeField = 'CardType' }) {
  return ACTIVATION_SOURCES.map(({ key, modes }) => {
    const sourceRows = rows.filter((r) => modes.includes(r[modeField]))
    const amount = sumBy(sourceRows, amountField)
    const count = sumBy(sourceRows, countField)
    const digitalRows = sourceRows.filter((r) => r[cardTypeField] === 'Digital')
    const physicalRows = sourceRows.filter((r) => r[cardTypeField] === 'Physical')
    let digitalAmount = sumBy(digitalRows, amountField)
    let physicalAmount = sumBy(physicalRows, amountField)
    const unclassified = amount - digitalAmount - physicalAmount
    if (digitalAmount >= physicalAmount) digitalAmount += unclassified
    else physicalAmount += unclassified
    return {
      key,
      amount,
      count,
      digital: { amount: digitalAmount, count: sumBy(digitalRows, countField) },
      physical: { amount: physicalAmount, count: sumBy(physicalRows, countField) }
    }
  })
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

import { COLORS } from '../lib/theme'
import { fmtLacsLabel, fmtPct } from '../lib/format'

// Direct value label above a bar, e.g. "₹1,688 L". Use as
// <LabelList content={AmountLabel} />.
export function AmountLabel(props) {
  const { x, y, width, value } = props
  if (!value) return null
  return (
    <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fill={COLORS.inkMuted}>
      {fmtLacsLabel(value)}
    </text>
  )
}

// Direct value label for a diverging (up/down) bar chart, where one series
// is rendered as negative values purely to draw downward from a zero
// baseline (e.g. Card Journey's Activation-up/Redemption-down spillover
// chart). Always shows the bar's true magnitude (Math.abs) — the downward
// direction already conveys the sign, so a label reading "-₹123 L" would be
// redundant/confusing. Positive bars label above (like AmountLabel);
// negative bars label below, using the same y+offset approach
// regionDeltaLabel established for a negative Recharts bar (y is already
// the bar's bottom edge, height is negative, so a small positive offset
// from y clears the bar without walking back up over it).
export function DivergingAmountLabel(props) {
  const { x, y, width, value } = props
  if (!value) return null
  const isNegative = value < 0
  return (
    <text x={x + width / 2} y={isNegative ? y + 12 : y - 6} textAnchor="middle" fontSize={10} fill={COLORS.inkMuted}>
      {fmtLacsLabel(Math.abs(value))}
    </text>
  )
}

// Amount label with a period-over-period delta (▲/▼ %) stacked underneath,
// shown directly on the bar instead of requiring hover. Recharts' LabelList
// strips non-SVG props before calling `content`, so the per-bar delta can't
// ride along as an extra prop on the data row — this factory closes over
// `data` (the same array passed to <BarChart data={...}>) and looks the
// delta up by `props.index`, which LabelList always passes through intact.
//
// 2026-08-14: a negative-valued bar (e.g. "Redemption by Head"'s
// Cancellation bar) overlapped its own label — checked against the actual
// rendered SVG (not assumed): for a negative bar Recharts passes `y` as
// the bar's *bottom* edge already (further down the screen) with a
// *negative* `height`, so `y + height` walks back up to the zero line
// rather than down past the bar — the opposite of what's needed. For
// value < 0, `y` alone is already the bottom edge to anchor below.
export function regionDeltaLabel(data) {
  return function RegionDeltaLabel(props) {
    const { x, y, width, value, index } = props
    if (!value) return null
    const mom = data[index]?.mom
    const hasMom = mom != null && isFinite(mom)
    const isNegative = value < 0
    const amountY = isNegative ? y + (hasMom ? 28 : 14) : y - (hasMom ? 20 : 6)
    const momY = isNegative ? y + 14 : y - 6
    return (
      <g>
        <text x={x + width / 2} y={amountY} textAnchor="middle" fontSize={11} fill={COLORS.inkMuted}>
          {fmtLacsLabel(value)}
        </text>
        {hasMom && (
          <text
            x={x + width / 2}
            y={momY}
            textAnchor="middle"
            fontSize={10}
            fontWeight="bold"
            fill={mom >= 0 ? COLORS.redemption : COLORS.warning}
          >
            {mom >= 0 ? '▲' : '▼'} {Math.abs(mom).toFixed(1)}% MoM
          </text>
        )}
      </g>
    )
  }
}

// Direct value label to the right of a horizontal bar's end, e.g.
// "₹1,688 L". Recharts' built-in `<LabelList position="right"
// formatter={...} />` mis-sizes its internal text-wrap budget to the *bar's
// own* pixel width whenever no parentViewBox is supplied (confirmed against
// the installed recharts source, not assumed) — for a short bar that budget
// is tiny, so a label like "₹12 L" silently wraps onto two lines. A plain
// custom <text>, positioned the same way AmountLabel/PctLabel already are,
// sidesteps that wrapping machinery entirely. Use as
// <LabelList content={HorizontalAmountLabel} />.
export function HorizontalAmountLabel(props) {
  const { x, y, width, height, value } = props
  if (!value) return null
  return (
    <text x={x + width + 6} y={y + height / 2} dominantBaseline="central" textAnchor="start" fontSize={11} fill={COLORS.inkMuted}>
      {fmtLacsLabel(value)}
    </text>
  )
}

export function PctLabel(props) {
  const { x, y, width, value } = props
  return (
    <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fill={COLORS.inkMuted}>
      {fmtPct(value, 0)}
    </text>
  )
}

// Total value above a stacked bar (e.g. Digital+Physical), attached to the
// LAST-declared <Bar> in the stack — that segment renders visually on top,
// so its own x/y/width correspond to the top of the whole stack. Recharts'
// LabelList only ever gives a segment's own value, not the stack's combined
// total, so this closes over `data` (the same array passed to <BarChart
// data={...}>) and the stack's key names, summing them directly — same
// index-lookup pattern as regionDeltaLabel above, for the same reason
// (LabelList strips non-SVG props before calling `content`).
export function stackTotalLabel(data, keys) {
  return function StackTotalLabel(props) {
    const { x, y, width, index } = props
    const row = data[index]
    if (!row) return null
    const total = keys.reduce((s, k) => s + (row[k] || 0), 0)
    if (!total) return null
    return (
      <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fill={COLORS.inkMuted}>
        {fmtLacsLabel(total)}
      </text>
    )
  }
}

// Direct label on a donut/pie segment: category name + share %. Small
// slices (<3%) skip the label to avoid collisions per the dataviz skill.
const RADIAN = Math.PI / 180
export function donutLabel({ cx, cy, midAngle, outerRadius, percent, key }) {
  if (percent < 0.03) return null
  const radius = outerRadius + 18
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill={COLORS.inkMuted} fontSize={11} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
      {key} {(percent * 100).toFixed(0)}%
    </text>
  )
}

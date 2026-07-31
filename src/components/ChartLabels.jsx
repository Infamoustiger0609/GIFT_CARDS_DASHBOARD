import { COLORS } from '../lib/theme'
import { fmtLacsAxis, fmtPct } from '../lib/format'

// Direct value label above a bar, e.g. "1,688" (₹ Lacs, no symbol — the
// chart title/axis already states the unit). Use as <LabelList content={AmountLabel} />.
export function AmountLabel(props) {
  const { x, y, width, value } = props
  if (!value) return null
  return (
    <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fill={COLORS.inkMuted}>
      {fmtLacsAxis(value)}
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

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

// Amount label with a period-over-period delta (▲/▼ %) stacked underneath,
// shown directly on the bar instead of requiring hover. Recharts' LabelList
// strips non-SVG props before calling `content`, so the per-bar delta can't
// ride along as an extra prop on the data row — this factory closes over
// `data` (the same array passed to <BarChart data={...}>) and looks the
// delta up by `props.index`, which LabelList always passes through intact.
export function regionDeltaLabel(data) {
  return function RegionDeltaLabel(props) {
    const { x, y, width, value, index } = props
    if (!value) return null
    const mom = data[index]?.mom
    const hasMom = mom != null && isFinite(mom)
    return (
      <g>
        <text x={x + width / 2} y={y - (hasMom ? 20 : 6)} textAnchor="middle" fontSize={11} fill={COLORS.inkMuted}>
          {fmtLacsLabel(value)}
        </text>
        {hasMom && (
          <text
            x={x + width / 2}
            y={y - 6}
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

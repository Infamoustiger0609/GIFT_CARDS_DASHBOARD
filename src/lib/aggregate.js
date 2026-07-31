// Small aggregation helpers shared by every page. Rows are always the
// already-filtered arrays produced by FilterContext — these functions never
// filter, only group/sum.

export function sumBy(rows, field) {
  let total = 0
  for (const r of rows) total += r[field] || 0
  return total
}

export function groupSum(rows, keyField, valueFields) {
  const map = new Map()
  for (const r of rows) {
    const key = r[keyField]
    if (!map.has(key)) {
      const zero = {}
      for (const f of valueFields) zero[f] = 0
      map.set(key, { key, ...zero })
    }
    const entry = map.get(key)
    for (const f of valueFields) entry[f] += r[f] || 0
  }
  return [...map.values()]
}

// Group by two keys, e.g. month x mode, returning a wide array suitable for
// a multi-series Recharts line/bar: [{ x: '2024-04', Physical: 123, Online: 45 }, ...]
export function pivot(rows, xField, seriesField, valueField) {
  const map = new Map()
  for (const r of rows) {
    const x = r[xField]
    const series = r[seriesField]
    if (!map.has(x)) map.set(x, { x })
    const entry = map.get(x)
    entry[series] = (entry[series] || 0) + (r[valueField] || 0)
  }
  return [...map.values()]
}

export function uniqueSorted(rows, field) {
  return [...new Set(rows.map((r) => r[field]))].sort()
}

export function topNWithOther(entries, n, keyField, valueField) {
  const sorted = [...entries].sort((a, b) => b[valueField] - a[valueField])
  if (sorted.length <= n) return sorted
  const top = sorted.slice(0, n)
  const rest = sorted.slice(n)
  const otherValue = rest.reduce((s, r) => s + r[valueField], 0)
  top.push({ [keyField]: 'Other', key: 'Other', [valueField]: otherValue })
  return top
}

import React, { useEffect, useRef, useState } from 'react'
import { dayLabel } from '../lib/format'

// Compact "Date Range" control matching Select.jsx's visual weight so it
// sits naturally among the other 10 filters in the sticky bar. A from/to
// date-picker pair doesn't fit react-select's multi-select machinery (this
// isn't a value *set*, it's a contiguous span) and two full-size
// <input type="date"> fields side by side wouldn't survive an already-
// narrow 11-column grid — so the actual pickers live in a small floating
// panel behind one compact summary button, not inline. Native
// <input type="date"> rather than a custom calendar widget: no new
// dependency, and the browser's own picker already handles keyboard/
// locale/accessibility concerns this app has no reason to redo.
//
// 2026-08-29: control height corrected to 38px, not the 24px this file's
// own comment used to claim. Select.jsx's own react-select `styles.control`
// sets `minHeight: 24`, but a global override in index.css
// (`.rs__control { min-height: 38px !important; }`, present since before
// the 2026-08-12 "compacted filter bar" pass) wins over it — confirmed by
// measuring the actual rendered height live, not by re-reading Select.jsx's
// own styles object, which was the wrong source of truth here. This file's
// button previously matched the *documented* 24px, not the *real* 38px,
// which is what made it visibly shorter than every Select beside it.
// Left the index.css override itself alone — reconciling it with
// Select.jsx's own comment claiming 24px is a separate, wider-blast-radius
// cleanup than this fix, since it'd change every filter's height, not just
// this one.
// 2026-09-17: `onOpen` (FilterBar.jsx passes `loadDailyCubes` from
// useFilters()) fires the moment the picker's own button is clicked, not on
// mount — the daily cubes (~3.3MB combined) used to load unconditionally the
// instant Overview mounted, even for a visit that never touches this
// control. `loadDailyCubes` is idempotent (ref-guarded in FilterContext.jsx),
// so calling it on every open is harmless — the actual fetch only ever
// happens once per app session, whichever page's picker triggers it first.
export default function DateRangeFilter({ value, onChange, min, max, disabled, disabledReason, onOpen }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function onDocMouseDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  const start = value?.start || ''
  const end = value?.end || ''
  const hasSelection = !!start

  let summary = 'All'
  if (hasSelection) summary = end && end !== start ? `${dayLabel(start)} – ${dayLabel(end)}` : dayLabel(start)

  return (
    <div className="flex flex-col gap-0 w-full min-w-0 relative" ref={wrapRef}>
      <label className="text-[9px] leading-tight font-semibold uppercase tracking-wide text-warmgray-muted">Date Range</label>
      {/* A second, nested `relative` scoped to just this control (not the
          label above it or the popover below it) — the popover further
          down still resolves its own `absolute top-full` against the
          outer wrapper above (unchanged), while the clear button here
          resolves against this inner div, docking to the control's own
          right edge/vertical center instead of the combined
          label+button+popover stack's. */}
      <div className="relative w-full min-w-0">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onOpen?.()
            setOpen((o) => !o)
          }}
          title={disabled ? disabledReason : summary}
          style={{ minHeight: 38 }}
          className={`flex items-center rounded-md border text-[12px] text-navy px-1.5 truncate text-left w-full min-w-0 ${
            hasSelection && !disabled ? 'pr-5' : ''
          } ${
            disabled
              ? 'bg-cream border-warmgray-border opacity-60 cursor-not-allowed'
              : 'bg-white border-warmgray-border hover:border-gold cursor-pointer'
          }`}
        >
          <span className="truncate">{summary}</span>
        </button>

        {/* 2026-08-29: inline clear/reset — only rendered once a range is
            actually selected, docked to the control's own right edge (same
            spot react-select's own clear-x would sit, though Select.jsx
            deliberately turns that off for its own multi-selects — this
            control isn't a multi-select, so a real clear affordance doesn't
            conflict with that convention). stopPropagation so clicking it
            resets the range without also toggling the popover open, and
            resetting calls onChange with the same shape setDateRange()
            already expects — no other filter is touched. */}
        {hasSelection && !disabled && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
              onChange({ start: null, end: null })
            }}
            title="Clear date range"
            className="absolute right-1 top-1/2 -translate-y-1/2 text-warmgray-muted hover:text-coral text-sm leading-none w-4 h-4 flex items-center justify-center"
          >
            ×
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-card border border-warmgray-border rounded-md shadow-lg p-2.5 w-56 flex flex-col gap-2">
          <div>
            <label className="text-[9px] font-semibold uppercase tracking-wide text-warmgray-muted">From</label>
            <input
              type="date"
              value={start}
              min={min}
              max={end || max}
              onChange={(e) => onChange({ start: e.target.value || null, end })}
              className="w-full text-xs rounded border border-warmgray-border px-1.5 py-1 focus:outline-none focus:border-gold"
            />
          </div>
          <div>
            <label className="text-[9px] font-semibold uppercase tracking-wide text-warmgray-muted">
              To <span className="normal-case font-normal">(optional — single day if blank)</span>
            </label>
            <input
              type="date"
              value={end}
              min={start || min}
              max={max}
              onChange={(e) => onChange({ start, end: e.target.value || null })}
              className="w-full text-xs rounded border border-warmgray-border px-1.5 py-1 focus:outline-none focus:border-gold"
            />
          </div>
          {hasSelection && (
            <button
              type="button"
              onClick={() => onChange({ start: null, end: null })}
              className="text-[10px] text-warmgray-muted hover:text-coral text-left"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}

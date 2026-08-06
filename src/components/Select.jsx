import React from 'react'
import RSelect, { components } from 'react-select'
import { NONE_SELECTED } from '../lib/constants'

const ALL_VALUE = '__select_all__'

const styles = {
  control: (base, state) => ({
    ...base,
    borderRadius: 6,
    borderColor: state.isFocused ? '#c8952e' : '#e2ddd3',
    boxShadow: state.isFocused ? '0 0 0 1px #c8952e' : 'none',
    minHeight: 32,
    fontSize: 12,
    backgroundColor: '#ffffff',
    '&:hover': { borderColor: '#c8952e' }
  }),
  menu: (base) => ({ ...base, zIndex: 50, fontSize: 13, minWidth: 180 }),
  option: (base, state) => ({
    ...base,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    backgroundColor: state.isFocused ? '#f4e6c8' : '#ffffff',
    color: '#1b2430',
    cursor: 'pointer'
  }),
  valueContainer: (base) => ({ ...base, flexWrap: 'nowrap', overflow: 'hidden', padding: '0 6px' }),
  singleValue: (base) => ({ ...base, color: '#1b2430' }),
  dropdownIndicator: (base) => ({ ...base, padding: 4 }),
  indicatorSeparator: () => ({ display: 'none' }),
  clearIndicator: (base) => ({ ...base, padding: 4 })
}

// Selected values render as a compact summary ("All" / one label / "N
// selected") instead of react-select's default per-item pill chips, which
// would blow out the column width now that 8 filters share one row.
function ValueContainer({ children, ...props }) {
  const selected = props.getValue()
  const totalReal = (props.selectProps.options?.length || 1) - 1
  let label
  if (selected.length === totalReal) label = 'All'
  else if (selected.length === 0) label = 'None'
  else if (selected.length === 1) label = selected[0].label
  else label = `${selected.length} selected`
  const input = Array.isArray(children) ? children[1] : children
  return (
    <components.ValueContainer {...props}>
      <span className="text-[12px] text-navy truncate pr-1">{label}</span>
      {input}
    </components.ValueContainer>
  )
}

// "Select All" is a toggle: unchecked -> checks every option (back to
// unrestricted, same destination as the true default); checked (every real
// option already selected) -> unchecks every option, which stores the
// NONE_SELECTED sentinel so the filter matches zero rows rather than
// silently falling back to "All" (see constants.js). Uses onMouseDown +
// preventDefault instead of onClick because react-select's own mousedown
// handling (menu-close/blur) can otherwise swallow a click on a custom
// element before our handler runs.
function Option(props) {
  if (props.data.value === ALL_VALUE) {
    return (
      <div
        onMouseDown={(e) => {
          e.preventDefault()
          props.selectProps.onSelectAll()
        }}
        className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-gold uppercase tracking-wide cursor-pointer hover:bg-gold-light border-b border-warmgray-border"
      >
        <input type="checkbox" checked={props.selectProps.allChecked} onChange={() => {}} className="accent-gold" />
        Select All
      </div>
    )
  }
  return (
    <components.Option {...props}>
      <input type="checkbox" checked={props.isSelected} onChange={() => {}} className="accent-gold" />
      <span className="truncate">{props.label}</span>
    </components.Option>
  )
}

// The filter's own value is the ground truth: [] means unrestricted
// (matches everything, including rows outside this dropdown's option list —
// e.g. Denom/CardType "N/A" cancellation rows). But an *empty-looking*
// control reads as "nothing chosen" to a user, not "everything included",
// so the checkbox list displays every option ticked by default and the
// closed control reads "All" — exactly as if the user had ticked every box
// by hand. Unticking one option is real narrowing: react-select computes
// the new explicit list against the full "all ticked" baseline we feed it,
// so it comes out as every value except the one just unticked, and that
// list is used as-is (no separate "select all" code path to fall out of
// sync with — this is what was broken before: a fully-explicit "every
// value" array silently excluded rows whose field is "N/A", which isn't in
// any dropdown's option list, while true [] correctly matched them).
export default function Select({ label, value, options, onChange }) {
  const rsOptions = options.map((o) => ({ value: o.value ?? o, label: o.label ?? o }))
  const menuOptions = [{ value: ALL_VALUE, label: 'Select All' }, ...rsOptions]
  // Both "true unrestricted" ([]) and "every option explicitly deselected"
  // ([NONE_SELECTED]) resolve to zero checked boxes here — but only the
  // former should show every checkbox pre-ticked, so they're handled as
  // separate branches rather than folded into one `.filter()` call.
  const isNoneSelected = value.length === 1 && value[0] === NONE_SELECTED
  const effectiveSelected = value.length === 0 ? rsOptions : isNoneSelected ? [] : rsOptions.filter((o) => value.includes(o.value))
  const allChecked = effectiveSelected.length === rsOptions.length && rsOptions.length > 0

  function handleChange(opts) {
    const reals = (opts || []).filter((o) => o.value !== ALL_VALUE)
    if (reals.length === rsOptions.length) onChange([])
    else if (reals.length === 0) onChange([NONE_SELECTED])
    else onChange(reals.map((o) => o.value))
  }

  return (
    <div className="flex flex-col gap-0.5 w-full min-w-0">
      <label className="text-[10px] leading-tight font-semibold uppercase tracking-wide text-warmgray-muted">{label}</label>
      <RSelect
        classNamePrefix="rs"
        isMulti
        isClearable={false}
        closeMenuOnSelect={false}
        hideSelectedOptions={false}
        value={effectiveSelected}
        options={menuOptions}
        onChange={handleChange}
        onSelectAll={() => onChange(allChecked ? [NONE_SELECTED] : [])}
        allChecked={allChecked}
        styles={styles}
        isSearchable={false}
        components={{ ValueContainer, Option, MultiValue: () => null }}
        placeholder="All"
      />
    </div>
  )
}

import React from 'react'
import RSelect, { components } from 'react-select'

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
// "All real options individually selected" reads the same as "none
// selected" — both mean unrestricted — so both collapse to "All" here.
function ValueContainer({ children, ...props }) {
  const selected = props.getValue()
  const totalReal = (props.selectProps.options?.length || 1) - 1
  let label
  if (selected.length === 0 || selected.length === totalReal) label = 'All'
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

// "Select All" is a real toggle, not a static action: unchecked -> checks
// every option below it (and their boxes visibly tick); checked (every real
// option already individually selected) -> clears them all. Uses onMouseDown
// + preventDefault instead of onClick because react-select's own mousedown
// handling (menu-close/blur) can otherwise swallow a click on a custom
// element before our handler runs.
function Option(props) {
  if (props.data.value === ALL_VALUE) {
    const allChecked = props.selectProps.allChecked
    return (
      <div
        onMouseDown={(e) => {
          e.preventDefault()
          props.selectProps.onToggleSelectAll(allChecked)
        }}
        className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-gold uppercase tracking-wide cursor-pointer hover:bg-gold-light border-b border-warmgray-border"
      >
        <input type="checkbox" checked={allChecked} onChange={() => {}} className="accent-gold" />
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

export default function Select({ label, value, options, onChange }) {
  const rsOptions = options.map((o) => ({ value: o.value ?? o, label: o.label ?? o }))
  const menuOptions = [{ value: ALL_VALUE, label: 'Select All' }, ...rsOptions]
  const selected = rsOptions.filter((o) => value.includes(o.value))
  const allChecked = rsOptions.length > 0 && selected.length === rsOptions.length
  return (
    <div className="flex flex-col gap-0.5 w-full min-w-0">
      <label className="text-[10px] leading-tight font-semibold uppercase tracking-wide text-warmgray-muted">{label}</label>
      <RSelect
        classNamePrefix="rs"
        isMulti
        isClearable
        closeMenuOnSelect={false}
        hideSelectedOptions={false}
        value={selected}
        options={menuOptions}
        onChange={(opts) => onChange((opts || []).filter((o) => o.value !== ALL_VALUE).map((o) => o.value))}
        onToggleSelectAll={(wasAllChecked) => onChange(wasAllChecked ? [] : rsOptions.map((o) => o.value))}
        allChecked={allChecked}
        styles={styles}
        isSearchable={false}
        components={{ ValueContainer, Option, MultiValue: () => null }}
        placeholder="All"
      />
    </div>
  )
}

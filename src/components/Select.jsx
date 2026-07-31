import React from 'react'
import RSelect, { components } from 'react-select'

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
  let label
  if (selected.length === 0) label = 'All'
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

function Option(props) {
  return (
    <components.Option {...props}>
      <input type="checkbox" checked={props.isSelected} onChange={() => {}} className="accent-gold" />
      <span className="truncate">{props.label}</span>
    </components.Option>
  )
}

export default function Select({ label, value, options, onChange }) {
  const rsOptions = options.map((o) => ({ value: o.value ?? o, label: o.label ?? o }))
  const selected = rsOptions.filter((o) => value.includes(o.value))
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
        options={rsOptions}
        onChange={(opts) => onChange((opts || []).map((o) => o.value))}
        styles={styles}
        isSearchable={false}
        components={{ ValueContainer, Option, MultiValue: () => null }}
        placeholder="All"
      />
    </div>
  )
}

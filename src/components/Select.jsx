import React from 'react'
import RSelect from 'react-select'

const styles = {
  control: (base, state) => ({
    ...base,
    borderRadius: 6,
    borderColor: state.isFocused ? '#c8952e' : '#e2ddd3',
    boxShadow: state.isFocused ? '0 0 0 1px #c8952e' : 'none',
    minHeight: 38,
    fontSize: 13,
    backgroundColor: '#ffffff',
    '&:hover': { borderColor: '#c8952e' }
  }),
  menu: (base) => ({ ...base, zIndex: 50, fontSize: 13 }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected ? '#c8952e' : state.isFocused ? '#f4e6c8' : '#ffffff',
    color: state.isSelected ? '#ffffff' : '#1b2430',
    cursor: 'pointer'
  }),
  singleValue: (base) => ({ ...base, color: '#1b2430' }),
  dropdownIndicator: (base) => ({ ...base, padding: 6 }),
  indicatorSeparator: () => ({ display: 'none' })
}

export default function Select({ label, value, options, onChange, allLabel = 'All' }) {
  const rsOptions = [{ value: 'All', label: allLabel }, ...options.map((o) => ({ value: o.value ?? o, label: o.label ?? o }))]
  const selected = rsOptions.find((o) => o.value === value) || rsOptions[0]
  return (
    <div className="flex flex-col gap-1 w-full min-w-0">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-warmgray-muted">{label}</label>
      <RSelect
        classNamePrefix="rs"
        value={selected}
        options={rsOptions}
        onChange={(opt) => onChange(opt.value)}
        styles={styles}
        isSearchable={false}
      />
    </div>
  )
}

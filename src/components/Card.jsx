import React from 'react'

export default function Card({ title, subtitle, action, children, className = '' }) {
  return (
    <div className={`bg-card border border-warmgray-border rounded-lg p-4 md:p-5 ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between mb-3 gap-2">
          <div>
            {title && <h3 className="font-serif text-[15px] font-bold text-navy">{title}</h3>}
            {subtitle && <p className="text-xs text-warmgray-muted mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

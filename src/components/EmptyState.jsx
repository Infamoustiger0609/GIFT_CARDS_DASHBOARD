import React from 'react'

export default function EmptyState({ message = 'No data for the current filter selection.' }) {
  return (
    <div className="flex items-center justify-center h-full min-h-[180px] text-sm text-warmgray-muted italic">
      {message}
    </div>
  )
}

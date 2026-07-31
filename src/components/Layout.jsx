import React from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import FilterBar from './FilterBar'
import { useFilters } from '../lib/FilterContext'

const TABS = [
  { to: '/', label: 'Overview', end: true },
  { to: '/activation', label: 'Activation' },
  { to: '/redemption/box-office', label: 'Redemption · Box Office' },
  { to: '/redemption/fnb', label: 'Redemption · F&B' },
  { to: '/trends', label: 'Trends' }
]

function DataStatus({ isLoading, error }) {
  if (error) {
    return (
      <div className="bg-coral-light border border-coral text-coral rounded-lg px-4 py-6 text-center text-sm mb-6">
        Couldn't load the gift card data ({error.message}). Try refreshing the page.
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="bg-card border border-warmgray-border rounded-lg px-4 py-10 text-center text-sm text-warmgray-muted mb-6">
        Loading activation and redemption data…
      </div>
    )
  }
  return null
}

export default function Layout() {
  const { isLoading, error } = useFilters()
  return (
    <div className="min-h-screen bg-cream">
      {/* Header + filter bar stick together as one unit — sticking them
          separately would need a hardcoded offset equal to the header's
          height, which itself changes when the nav wraps on narrow screens. */}
      <div className="sticky top-0 z-40">
        <header className="bg-navy text-white shadow-md">
          <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <img src="/pvr-inox-logo.jpeg" alt="PVR INOX" className="h-8 w-auto rounded-sm" />
              <div className="border-l border-white/20 pl-3 hidden sm:block">
                <h1 className="font-serif text-sm font-bold leading-tight">Gift Card</h1>
                <p className="text-[11px] text-white/60 leading-tight tracking-wide uppercase">Analytics</p>
              </div>
            </div>
            <nav className="flex flex-wrap gap-1 text-sm">
              {TABS.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end={t.end}
                  className={({ isActive }) =>
                    `px-3 py-2 rounded-md font-medium transition-colors whitespace-nowrap ${
                      isActive ? 'bg-gold text-navy' : 'text-white/75 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  {t.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>

        {!isLoading && !error && (
          <div className="bg-cream border-b border-warmgray-border shadow-sm px-4 md:px-6 pt-3 pb-3">
            <div className="max-w-[1400px] mx-auto">
              <FilterBar />
            </div>
          </div>
        )}
      </div>

      <main className="max-w-[1400px] mx-auto px-4 md:px-6 py-6">
        <DataStatus isLoading={isLoading} error={error} />
        {!isLoading && !error && <Outlet />}
      </main>

      <footer className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 text-xs text-warmgray-muted">
        PVR INOX Gift Card Analytics · All figures in ₹ Lacs unless noted · Data updates on deploy
      </footer>
    </div>
  )
}

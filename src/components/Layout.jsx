import React from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import FilterBar from './FilterBar'

const TABS = [
  { to: '/', label: 'Overview', end: true },
  { to: '/activation', label: 'Activation' },
  { to: '/redemption/box-office', label: 'Redemption · Box Office' },
  { to: '/redemption/fnb', label: 'Redemption · F&B' },
  { to: '/trends', label: 'Trends' }
]

export default function Layout() {
  return (
    <div className="min-h-screen bg-cream">
      <header className="bg-navy text-white sticky top-0 z-40 shadow-md">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-gold flex items-center justify-center font-serif font-bold text-navy text-lg">
              G
            </div>
            <div>
              <h1 className="font-serif text-lg font-bold leading-tight">PVR INOX</h1>
              <p className="text-[11px] text-white/60 leading-tight tracking-wide uppercase">Gift Card Analytics</p>
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

      <main className="max-w-[1400px] mx-auto px-4 md:px-6 py-6">
        <FilterBar />
        <Outlet />
      </main>

      <footer className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 text-xs text-warmgray-muted">
        PVR INOX Gift Card Analytics · All figures in ₹ Lacs unless noted · Data updates on deploy
      </footer>
    </div>
  )
}

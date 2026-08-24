import React from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import { FilterProvider } from './lib/FilterContext'
import Overview from './pages/Overview'
import Activation from './pages/Activation'
import RedemptionBoxOffice from './pages/RedemptionBoxOffice'
import RedemptionFnb from './pages/RedemptionFnb'
import Trends from './pages/Trends'
import CancelRedeem from './pages/CancelRedeem'
import CardJourney from './pages/CardJourney'
import Summary from './pages/Summary'
import ChannelPerformance from './pages/ChannelPerformance'

export default function App() {
  return (
    <FilterProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/activation" element={<Activation />} />
          <Route path="/redemption/box-office" element={<RedemptionBoxOffice />} />
          <Route path="/redemption/fnb" element={<RedemptionFnb />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/cancel-redeem" element={<CancelRedeem />} />
          <Route path="/card-journey" element={<CardJourney />} />
          <Route path="/summary" element={<Summary />} />
          <Route path="/channel-performance" element={<ChannelPerformance />} />
        </Route>
      </Routes>
    </FilterProvider>
  )
}

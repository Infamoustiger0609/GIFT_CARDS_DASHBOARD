# PVR INOX — Gift Card Analytics Dashboard

A client-side BI dashboard for PVR INOX gift card activation and redemption
data: Overview, Activation, Redemption (Box Office), Redemption (F&B), and
Trends, all driven by a shared global filter bar.

## Stack

- Vite + React (JS, no TypeScript)
- Tailwind CSS for styling
- Recharts for charts
- React Router for the 5 page routes
- react-select for the filter dropdowns

All filtering happens client-side via `useMemo` over the two bundled JSON
cubes (`src/data/activationCube.json`, `src/data/redemptionCube.json`) — no
backend, no API calls.

## Getting started

```bash
npm install
npm run dev       # http://localhost:5173
```

```bash
npm run build      # production build to dist/
npm run preview    # preview the production build locally
```

## Project structure

```
src/
  data/                  activationCube.json, redemptionCube.json, heroProducts.json
  lib/
    FilterContext.jsx     global filter state + filtered row selectors
    aggregate.js           groupSum / pivot / topNWithOther helpers
    constants.js            region/mode/weekday orders, FY split logic
    format.js                 ₹ Lacs / % / number formatters
    theme.js                    validated color roles (see below)
  components/            Layout, FilterBar, Card, Kpi, FlowBox, ChartTooltip, Select
  pages/                  Overview, Activation, RedemptionBoxOffice, RedemptionFnb, Trends
```

## Data assumptions (see CLAUDE.md for the full log)

- **FY split**: `YearMonth >= '2025-04'` → FY2025-26, else FY2024-25.
- **Redemption %** = Redemption Amount ÷ Activation Amount, computed overall
  and per-mode by joining `ActivationModeFinal` (activation cube) against
  `ActivationMode` (redemption cube).
- **Cancellations** (negative `RedemptionAmount`, `Head = "Cancellation"`) are
  always summed into totals, never filtered out — the sign does the netting.
- **Mode filter** applies to `ActivationModeFinal` on the activation cube and
  to `ActivationMode` (origin channel) on the redemption cube — the two
  fields share the same value set (plus the redemption-only "Pre-existing"
  bucket).
- **Ticket / F&B filter**: "Ticket" = `Head` in (Online, Box Office,
  Cancellation); "F&B" = `Head === 'F&B'`.
- All monetary figures are divided by 100,000 for display and labeled "₹
  Lacs" (`fmtLacs` / `fmtLacsAxis` in `src/lib/format.js`).

## Deployment (GitHub → Vercel)

1. Push this repo to GitHub (see steps below).
2. In Vercel, "Add New Project" → import the GitHub repo. Framework preset
   "Vite" is auto-detected; no environment variables are required.
3. Every push to `main` triggers an auto-deploy. `vercel.json` contains the
   SPA rewrite rule so client-side routes (`/activation`, `/redemption/box-office`,
   etc.) resolve correctly on refresh/deep-link.

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

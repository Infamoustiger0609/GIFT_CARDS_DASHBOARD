# PVR INOX — Gift Card Analytics Dashboard

A client-side BI dashboard for PVR INOX gift card activation and redemption
data: Overview, Activation, Redemption (Box Office), Redemption (F&B), and
Trends, all driven by a shared, sticky global filter bar (8 filters: FY,
Region, Mode, Month, Week, Source, Ticket/F&B, Denomination). Every
monetary figure — KPI tiles, chart tooltips, bar/donut labels — is shown
paired with its underlying card/redemption count wherever the source data
has both fields (see `CLAUDE.md` for the one exception: hero products only
carry an amount).

## Stack

- Vite + React (JS, no TypeScript)
- Tailwind CSS for styling
- Recharts for charts
- React Router for the 5 page routes
- react-select for the filter dropdowns

All filtering happens client-side via `useMemo` over the two data cubes
(`public/data/activationCube.json`, `public/data/redemptionCube.json`) — no
backend, no API calls. The cubes are ~26MB combined, so they're fetched at
runtime (`fetch()` + native `JSON.parse`) rather than statically imported —
see "Performance" below for why.

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
public/
  data/                  activationCube.json, redemptionCube.json, heroProducts.json
                          (fetched at runtime, not bundled into the JS build)
src/
  lib/
    FilterContext.jsx     fetches the cubes on mount + global filter state / selectors
    aggregate.js           groupSum / pivot / topNWithOther helpers
    constants.js            region/mode/weekday/denom orders, FY split logic
    format.js                 ₹ Lacs / % / number formatters
    theme.js                    validated color roles (see below)
  components/            Layout, FilterBar, Card, Kpi, FlowBox, ChartTooltip, Select
  pages/                  Overview, Activation, RedemptionBoxOffice, RedemptionFnb, Trends
```

## Performance

The redemption cube is 81K rows (~25MB); the activation cube is 6.4K rows
(~1.2MB). Statically `import`-ing them (the original approach) inlined them
into the JS bundle: **22MB minified, 1.24MB gzipped**, taking ~90s to build
and forcing the browser to parse/compile 22MB of JS before the app could
paint anything. Moving them to `public/data/` and loading them with
`fetch()` on mount instead:

- drops the JS bundle to **~700KB (203KB gzipped)** and the build to ~10s;
- lets the shell (header, nav, filter bar skeleton) paint immediately while
  the data loads, with a loading state (`Layout.jsx`) shown in the interim;
- uses the browser's native `JSON.parse` on the fetched text, which is
  faster than V8 parsing the same data as an embedded JS object literal;
- lets the two cubes cache as independent network resources, so an app-code
  deploy doesn't force re-downloading 26MB of unchanged data.

Vercel's edge network gzips/brotlis text responses (including
`public/`-served JSON) automatically — no extra compression config needed.
If the cubes grow enough that even a compressed fetch feels slow, the next
lever is server-side pre-aggregation (e.g. precomputed monthly/regional
rollups) rather than shipping raw rows to the browser at all.

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
- **Denomination filter** (`Denom` field, present on both cubes): ₹300 /
  ₹500 / ₹1000 / ₹1500 / ₹2000 / ₹2500 / ₹5000 / "Other / Custom". `N/A`
  rows (cancellations) are excluded from the dropdown's options — you can't
  filter *for* "not applicable" — but still flow through untouched when the
  filter is left on "All".
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
git remote add origin <your-github-repo-url>
git push -u origin master
```

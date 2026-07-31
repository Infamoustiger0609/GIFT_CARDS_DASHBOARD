# CLAUDE.md — Build Log & Working Notes

This file tracks how this dashboard was built, the decisions made where the
spec was ambiguous, and things to know before extending it. Keep it updated
as the project evolves.

## What this is

A Vite + React + Tailwind + Recharts BI dashboard for PVR INOX gift card
activation/redemption data, built from three pre-generated JSON cubes
(`src/data/*.json`, not to be regenerated — see original spec). Five pages:
Overview, Activation, Redemption · Box Office, Redemption · F&B, Trends,
sharing one global filter bar (`src/lib/FilterContext.jsx`).

## Data reality vs. the original spec

The spec described the cubes at a high level; actual data had some things
worth recording:

- **`Format`** (box office seating tier) has ~90 messy raw values (typos,
  duplicates like "Recliner"/"Recliners"/"Recliiner Rows", inconsistent
  casing) rather than the ~8 clean tiers implied by the spec. Handled with
  `topNWithOther(n=10)` rather than trying to normalize/dedupe the strings —
  normalizing was out of scope and risks silently misclassifying real tiers.
- **`Category`** (F&B) similarly has an "Other" and an "Add-ons" bucket in
  addition to the documented list. Same top-10-plus-Other treatment.
- **`Region_Clean`** includes a `NO_SITE` bucket beyond North/South/East/West/
  Central — kept as a real category (rendered gray, "Other/Unassigned"),
  not dropped.
- Both `Head = "Box Office"` and `Head = "F&B"` rows carry real `SourceFlag`
  values (Source/Non-Source/N/A); `Head = "Online"` and `"Cancellation"`
  rows are always `SourceFlag = "N/A"`.

## Decisions made where the spec was ambiguous

- **Mode filter** — applies to `ActivationModeFinal` in the activation cube
  and to `ActivationMode` (origin channel) in the redemption cube. These are
  the join keys the spec itself describes for Redemption % by mode, so the
  global filter uses the same pairing.
- **Ticket / F&B global filter** — "Ticket" = `Head` in (Online, Box Office,
  Cancellation); "F&B" = `Head === 'F&B'`. Cancellations were bundled into
  "Ticket" since they're overwhelmingly box-office/online cancellations, not
  F&B reversals. This filter only narrows the redemption cube (no matching
  field on the activation cube).
- **Source/Non-Source filter** — redemption cube only, same reasoning.
- **Region Contribution (Overview)** — shows activation amount by region
  (not a blended activation+redemption figure), since activation is the
  primary "where does the business originate" signal and redemption is
  already broken out by head elsewhere on the page.
- **Cancellation netting** — never filtered out anywhere; every `sumBy`/
  `groupSum` over `RedemptionAmount` just sums the raw (signed) field, so
  cancellations net in automatically. The Redemption Heads Breakdown chart
  additionally shows Cancellation as its own (negative, coral) bar so the
  netting is visible, not hidden.

## Palette

Followed the `dataviz` skill's validated-palette workflow
(`node scripts/validate_palette.js`) rather than eyeballing colors:

- Brand gold `#c8952e` (activation) passed as specified.
- Brand teal `#1d6b63` failed the chroma floor (reads as gray, C≈0.075
  against a 0.10 floor). Re-stepped to `#00805a` — same hue family, holds
  brand intent, clears chroma floor / CVD separation / normal-vision floor
  against `#c8952e` (ΔE 13.8 CVD, 23.5 normal-vision — both comfortably
  above target). This is what's actually in `src/lib/theme.js` as
  `COLORS.redemption` / `COLORS.teal`.
- Coral `#c1502e` is reserved as a **status** color only (cancellations,
  non-source, warnings) — never used as a rotating categorical slot, per the
  skill's "status is fixed" rule.
- A 5-hue fixed-order categorical theme (gold, blue `#3568b3`, teal, plum
  `#9c3f8a`, olive `#6b7a1f`) covers region/mode breakdowns; validated
  adjacent-pair (bar charts) and all-pairs up to 4 slots (donut/pie charts).
  `NO_SITE` / unmatched categories fall back to a reserved gray
  (`#9a9890`), outside the rotation, per the skill's "Other" convention.
- Contrast on gold against white (2.5–2.7:1, below the 3:1 AA target) is a
  documented WARN in the validator, legal only with a relief channel — every
  gold chart element ships with a direct value label or legend, never color
  alone.

## Bugs found during verification (and how they were caught)

Verification was done by driving the built app with Playwright
(headless Chromium) against the Vite dev server and screenshotting every
page — see the `run` skill's browser-driven pattern. Two real bugs surfaced
this way that a static code read did not catch:

1. **Chart axes showed raw rupee values** (e.g. `10000000` clipped to
   `0000000` by a too-narrow axis width) instead of ₹ Lacs. KPI tiles used
   `fmtLacs` correctly but the Recharts `YAxis`/`XAxis` tick renderers had no
   `tickFormatter`. Fixed by adding `fmtLacsAxis()` (rupees → rounded Lacs,
   no currency symbol) to every amount axis, and widening axis width to 64px.
   Count-based axes (Trends → Monthly Trend, Card Count) intentionally use
   plain `fmtNumber`, not the Lacs formatter.
2. **`COLORS.teal` was undefined** — `theme.js` only exported
   `COLORS.redemption`, but several pages referenced `COLORS.teal` as a
   fallback fill for unmatched categories (e.g. the "Pre-existing" redemption
   mode, the F&B category bar). Undefined fill silently rendered as black in
   the SVG. Fixed by adding a `teal` alias in `theme.js` pointing at the same
   hex as `redemption`, rather than hunting down every call site (both names
   are legitimate: `redemption` for semantic/KPI use, `teal` for chart-fill
   call sites written before the alias existed).

A first screenshot pass mid-animation also looked broken (bars/lines/pie
slices missing, only axes and legends visible) — that turned out to be the
*test script* not waiting for Recharts' mount animation, not an app bug.
Confirmed by re-screenshotting after a 2s wait with zero code changes.
Lesson: always wait for animation settle before treating a partially-drawn
chart as a rendering bug.

## Verification performed

- All 5 pages screenshotted at desktop (1440px) and mobile (390px) viewports.
- Applied a Region filter on Overview and confirmed KPIs, the flow diagram,
  and every chart visibly recomputed (Total Activation ₹6,127.62L →
  ₹2,998.76L for Region=NORTH, filter chip appeared, Reset filters cleared
  it).
- Zero browser console errors across all page loads and the filter
  interaction.
- Mobile: the Overview process-flow diagram's "by Region"/"by Channel"
  sub-boxes overflowed the viewport at 390px (a `grid-cols-2` with
  `min-w-[130px]` children didn't shrink under the parent's `min-w-[380px]`
  scroll container). Fixed by stacking those two groups to a single column
  below the `sm` breakpoint instead of forcing 2 columns at every width.

Not yet done: no automated test suite (explicitly out of scope per the
original request — "skip writing tests").

## Known limitations / things to revisit

- `redemptionCube.json` (~41K rows, ~12MB) is bundled directly and filtered
  in-browser via `useMemo`. Fine at this size; if the cube grows
  materially, revisit (e.g. pre-aggregating by month/region at build time,
  or moving to a real backend).
- `Format` and `Category` string values are used as-is (see above) — a
  proper data-cleaning pass (typo/case normalization) would tighten the
  "by Format" / "by Category" charts but was out of scope here.
- Hero products (`heroProducts.json`) are explicitly whole-dataset/static
  per the spec — the F&B page says so in a subtitle so it doesn't read as a
  bug when filters don't move that list.

## Deployment

GitHub → Vercel, auto-deploy on push to `main`. `vercel.json` has the SPA
rewrite (`/(.*)` → `/index.html`) since routing is `BrowserRouter`, not
hash-based. See README.md for the exact push/import steps.

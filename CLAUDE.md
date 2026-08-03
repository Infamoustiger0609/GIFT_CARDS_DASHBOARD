# CLAUDE.md — Build Log & Working Notes

This file tracks how this dashboard was built, the decisions made where the
spec was ambiguous, and things to know before extending it. Keep it updated
as the project evolves.

## What this is

A Vite + React + Tailwind + Recharts BI dashboard for PVR INOX gift card
activation/redemption data, built from three pre-generated JSON cubes
(`public/data/*.json`, fetched at runtime — not to be regenerated, see
"Performance" in README.md for why they live in `public/` rather than
`src/data/`). Five pages: Overview, Activation, Redemption · Box Office,
Redemption · F&B, Trends, sharing one global filter bar
(`src/lib/FilterContext.jsx`).

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

- `redemptionCube.json` (81K rows, ~25MB as of the 2026-07-31 refresh) is
  fetched at runtime and filtered in-browser via `useMemo` — see the
  2026-07-31 entry below for why it's no longer a static import. Fine at
  this size; if the cube grows materially past this, revisit again (e.g.
  pre-aggregating by month/region at build time, or a real backend).
- `Format` and `Category` string values are used as-is (see above) — a
  proper data-cleaning pass (typo/case normalization) would tighten the
  "by Format" / "by Category" charts but was out of scope here.
- Hero products (`heroProducts.json`) are explicitly whole-dataset/static
  per the spec — the F&B page says so in a subtitle so it doesn't read as a
  bug when filters don't move that list.

## 2026-07-31 — Refinement: Denomination filter + data refresh

Data files were swapped for updated versions adding a `Denom` field to both
cubes (redemption cube grew from 41K/12MB to 81K/25MB rows in the process).
Scope: wire up a new global filter, keep filter coverage complete across
all 5 pages, and address the resulting file-size/load-time concern the
request flagged.

**Denom field, actual values vs. what was described**: the request said
redemption-cube `Denom` includes an `"Unknown (pre-existing)"` bucket for
cards activated before Apr 2024. The actual data doesn't have that value —
all 3,241 rows with `ActivationMode = "Pre-existing (activated before Apr
2024)"` carry `Denom = "Other / Custom"` instead. Since filter options are
always data-derived (never hardcoded), this needed no special-casing — the
dropdown just reflects what's actually in the data. Noted here so it's not
mistaken for a bug later. `N/A` (cancellation rows) is deliberately excluded
from the dropdown's option list — filtering *for* "not applicable" isn't a
meaningful user action — but `N/A` rows still pass through untouched
whenever the filter is left on "All".

**Filter implementation**: `Denom` exists on both cubes with the same
meaning, so it was added to `passesCommon()` in `FilterContext.jsx`
alongside FY/Region/Month/Week rather than needing per-cube branching like
Source or Ticket/F&B. Because every page reads exclusively through
`useFilters()` (verified with a repo-wide grep for direct cube imports —
none found outside `FilterContext.jsx`), this one change gave all 5 pages
correct Denomination filtering for free. Confirmed via Playwright:
Denom=₹500 took Total Activation from ₹6,127.62L → ₹1,688.14L on Overview
and propagated identically to Activation, Redemption·Box Office, and
Redemption·F&B (F&B Redemption → ₹487.69L at Denom=₹1000), with the filter
chip persisting across tab navigation and zero console errors throughout.

**Performance — why the data moved to `public/`**: building with the new
81K-row cube as a static `import` (the original architecture) produced a
**22MB minified JS bundle** (1.24MB gzipped) and a 90-second build — the
browser has to parse/compile all 22MB of JS before it can paint anything,
regardless of gzip transfer size. Moved both cubes (and `heroProducts.json`,
for consistency) to `public/data/` and load them via `fetch()` in
`FilterContext.jsx` on mount instead:

- JS bundle: 22MB → **700KB minified (203KB gzipped)**; build: 90s → ~10s.
- `Layout.jsx` now renders a loading state while the fetch is in flight
  (confirmed catchable — briefly visible on a cold load) and an error state
  if it fails, instead of pages rendering against `undefined` data.
- Vercel gzips/brotlis `public/`-served static assets automatically, so the
  request's "gzip compression on the Vercel side" suggestion is already
  covered with no extra config. Deliberately did **not** add custom
  `Cache-Control` headers for the JSON files in `vercel.json` — `public/`
  filenames aren't content-hashed, so an aggressive cache policy risks
  serving stale data after a future data refresh (like this one) without a
  matching filename change. Left on Vercel's default static-asset caching.
- This was the right lever over "lazy-loading per page": nearly every page
  needs both cubes, so deferring the fetch to route-change wouldn't avoid
  the download, just delay it and add jank. The actual cost was the
  bundle-embedding, not the fetch timing.

**Header logo**: found an untracked `public/PVR INOX LOGO.jpeg` (renamed to
`public/pvr-inox-logo.jpeg`) — the real brand mark, gold-on-charcoal, close
enough to the header's navy (`#1b2430`) that it reads as one continuous bar.
Swapped it in for the placeholder gold "G" box in `Layout.jsx`, keeping a
small "Gift Card / Analytics" label beside it since the logo itself doesn't
say what the app does.

## 2026-07-31 — UI/UX pass: sticky filters, counts everywhere, on-chart labels

Five requested fixes; the Denomination filter and header logo were already
done earlier the same day (see the two entries above) and just needed
re-verifying, not re-building.

**Sticky filter bar**: tried making the header and filter bar sticky
*separately* first (`top-0` on the header, `top-[header-height]` on the
filter bar) and rejected it — the header's height isn't constant (the nav
wraps to a second row below ~1024px and again on mobile), so a hardcoded
offset would drift and gap/overlap at those breakpoints. Instead both are
wrapped in one `sticky top-0` container (`Layout.jsx`) so they stick and
scroll as a single unit — no height bookkeeping needed, correct at every
breakpoint by construction.

**Reset filters button**: moved out of the filter row entirely (was
`ml-auto` inside the same `flex flex-wrap` as the selects, which is why it
got pushed onto its own full-width row once 8 filters stopped fitting one
line — exactly the "too much vertical space" complaint). Now `absolute
top-2.5 right-3` on the filter bar's own `relative` container, styled as
small secondary text (not a bordered button), with `pr-20` on the select
row so it never overlaps the last select on wide screens.

**Counts alongside amounts**: every `Amount` field in both cubes has a
sibling `Count` field (`ActivationAmount`/`ActivationCount`,
`RedemptionAmount`/`RedemptionCount`) — the work was mostly plumbing that
pairing through to every display surface rather than a design question:
  - `groupSum()` calls across all 5 pages now request both fields, not just
    the amount, so the count rides along on the same aggregated row.
  - `Kpi` and `FlowBox` call sites pass the paired count as `sub`/`count`.
  - `ChartTooltip` gained a `countField` prop (a sibling field name, or a
    `(payload) => fieldName` function for multi-series charts where the
    count field differs per series, e.g. the Activation-vs-Redemption trend
    or the per-mode pivoted lines) plus a matching `countUnit` (string or
    function) so mixed units render correctly ("34,709 cards" next to
    "55,582 redemptions" in the same tooltip, not one generic unit forced
    onto both). Verified by hovering the Pan-India trend line — see
    `15-tooltip-hover.png` in this session's scratch dir for the reference
    render.
  - `lib/aggregate.js#pivot()` gained an optional `countField` param that
    writes `${series}__count` sibling keys (e.g. `Physical__count`) into
    the wide pivoted rows, so the 4-line Activation-by-mode trend can look
    up the right count per line.
  - `topNWithOther()` was widened to fold *every* numeric field into the
    "Other" bucket (not just the sort field) — needed so the paired count
    survives collapsing the F&B Category / Box Office Format long tails,
    otherwise "Other" would show an amount with no matching count.
  - **Exception, documented in the UI**: `heroProducts.json` only has
    `{name, amount}` — no count field exists in the source data to pair
    with. Rather than inventing one, the Hero Products card states this
    directly ("No unit-count field ships with this list…") so it reads as
    a known data limitation, not a missed requirement.

**On-chart labels** (`components/ChartLabels.jsx`, shared across all 4
pages that chart amounts): `AmountLabel`/`PctLabel` via `<LabelList
content={...} />` on single-series bar charts, direct segment labels via a
custom `label` renderer on donut charts. Segments under 3% share suppress
their label (collision avoidance per the dataviz skill) — visible on the
Region Contribution donut, where CENTRAL's ~0.01% share stays label-free
while NORTH/SOUTH/WEST/NO_SITE all show. Deliberately did **not** add
permanent labels to line charts (Month-wise trend, Pan-India trend) — with
24 monthly points per line and up to 4 lines on one chart, always-on labels
would collide and violate the "recessive, readable" bar the dataviz skill
sets; those keep tooltip-only disclosure, which is standard practice for
dense line charts and is what real BI tools do.

**Verification quirk worth recording**: a `fullPage: true` Playwright
screenshot of the (very tall, ~4000px) mobile Overview page showed the
footer text bleeding into the sticky filter bar, reproduced twice in a row.
A plain viewport screenshot (no `fullPage`) at the same scroll position, and
a screenshot after a real `mouse.wheel` scroll, both came back clean — this
is a Chromium/Playwright tiling artifact specific to `fullPage` capture +
`position: sticky` on tall pages, not a real rendering bug. Don't chase this
one again if it resurfaces in a `fullPage` shot; confirm with a normal
viewport screenshot first.

## 2026-07-31 — Multi-select filters, MoM/QoQ/YoY badges, bolder visuals

**Multi-select filters (breaking change to filter shape)**: every filter
value went from a single string (`'All'` sentinel) to an array (`[]` =
no restriction). `lib/FilterContext.jsx`'s `matches(selected, value)`
helper — `selected.length === 0 || selected.includes(value)` — replaced
every `filters.x !== 'All' && row.field !== filters.x` check. Within one
dimension, selected values OR together (row matches if its value is in the
set); dimensions still AND. `Select.jsx` now renders `isMulti`, with a
custom `ValueContainer` showing a condensed summary ("All" / one label /
"N selected") instead of react-select's default per-item pill chips —
needed since the 8-filters-in-one-row layout (see the entry below this one)
has no room for chips once 2+ values are picked.

**Active-filter chip row removed** (`FilterBar.jsx`) — was redundant once
each dropdown shows its own "N selected" state; also freed vertical space.

**MoM / QoQ / YoY comparison badges** (`lib/comparisons.js`,
`components/DeltaBadge.jsx`): the genuinely new piece is
`FilterContext` exposing `activationRowsAllMonths` /
`redemptionRowsAllMonths` (all active filters applied *except* Month) and
`comparisonMonths` (resolved "current period": explicit Month selection if
set, else the latest month present under the rest of the active filters).
Pages compute `computeComparisons(rowsAllMonths, field, comparisonMonths)`
against these pools, never against the Month-filtered `activationRows` /
`redemptionRows` — the whole point is reaching adjacent months the Month
filter would otherwise exclude.
  - Quarters use plain calendar-quarter boundaries (Jan/Apr/Jul/Oct) — these
    are literally the same 3-month windows as the Indian FY quarters (Q1
    Apr-Jun .. Q4 Jan-Mar), just without FY-year relabeling, so no special
    FY arithmetic was needed, only the boundary check.
  - A multi-month Month selection generalizes MoM to "same-length window
    immediately before" and YoY to "same months, one year back"
    (`precedingPeriod`/`yoyPeriod` in `comparisons.js`) — single-month
    selection is just the n=1 case of the same code path. QoQ always
    compares whole quarters (the quarter containing the latest selected/
    default month vs. the one before), per the request's literal wording,
    not scaled by the exact sub-selection.
  - **Decided against** reaching across an active FY filter to find
    comparison data (e.g. YoY from FY2025-26 pulling FY2024-25 rows even
    with FY filtered to 2025-26 only) — the request's own hide-condition
    example ("FY2024-25 selected, no prior year exists → hide") describes
    exactly the FY-respecting behavior, so `activationRowsAllMonths` only
    lifts the Month restriction, not FY. Simpler, and matches the spec's
    own example rather than a more permissive reading of it.
  - Hide condition: `computeComparisons` returns `null` (not 0 or Infinity)
    whenever the comparison period has zero matching rows *or* the
    previous-period sum is exactly 0 (avoids ±Infinity%); `DeltaBadge`
    renders nothing for `null`. Verified by selecting Apr 2024 (the
    dataset's first month) — MoM, QoQ, and YoY all correctly disappear
    since Mar 2024, Jan-Mar 2024, and Apr 2023 all fall entirely outside
    the data.
  - Wired onto the one primary Amount KPI per page (Overview: Total
    Activation + Total Redemption; Activation: Total Activation; Redemption
    · Box Office: Box Office Redemption; Redemption · F&B: F&B Redemption)
    rather than every KPI tile — ratio/derived tiles (Overall Redemption %,
    Avg Ticket Size, Avg per Redemption) don't have a natural "amount to
    compare period-over-period" and adding badges there would mostly just
    be visual noise.

**Item 9 (Total Redemption count) was already done** in the previous
session's pass — `Total Redemption (net)` on Overview already carries
`sub={... redemptions ...}`. No change needed, just re-verified.

**Bolder visual pass**: KPI value `text-2xl font-bold` → `text-3xl
font-extrabold`; Card titles → `font-extrabold`; FlowBox border `2px` →
`3px` and amount text bumped a size; donut `strokeWidth` 2→3; line
`strokeWidth` 2→3 with larger dots. Left gridlines/axis lines alone —
the dataviz skill calls those recessive by design, and "bolder" was about
data marks and typography, not chrome. Where a chart used the base
`COLORS.activation` (gold) as a **solid single-color fill** (not part of
the validated 5-hue categorical rotation), switched to `COLORS.activationDark`
for the contrast bump the request asked for — gold was the one color with a
documented sub-3:1 contrast WARN from the original palette validation.
Left `REGION_COLORS`/`MODE_COLORS`/`HEAD_COLORS`/`SOURCE_COLORS` (the
validated categorical theme) untouched — those hexes are load-bearing for
the CVD-separation gates the dataviz skill's validator checked; changing
one shifts the adjacent-pair math for the others.

**Concurrent-edit note**: `FilterBar.jsx` was being hand-edited in the IDE
while this work was in progress (caught it mid-save twice, briefly invalid
JSX both times). Left it alone until it settled rather than fighting the
live edit — it landed with the filters in a different order (FY, Month,
Week, Region, Mode, Source, Ticket/F&B, Denomination) than originally
built, which is fine; nothing downstream depends on filter order.

**Verification**: multi-select tested with Region = North+South (OR
within the dimension — KPI fell between "just North" and "no filter",
`2 selected` shown in the control) combined with Mode = Physical (AND
across dimensions, further narrowed correctly); baseline Total Activation
still reads ₹6,127.62L, matching every prior verification pass in this
file; zero console errors across all interactions; production build
unaffected (705KB → 708KB JS, no new warnings beyond the pre-existing
500KB chunk-size notice).

## 2026-07-31 — Overview KPI grid redefinition

Display/calculation-only change to the Overview page's 4-card KPI grid, no
data changes:

- **Revenue** replaces "Total Activation" as the first card's label —
  same value (`ActivationAmount`), same count/deltas. The request framed
  this as "not redemption + uptake as previously defined — correction,"
  which doesn't match anything actually in this codebase (there was never
  a redemption+uptake "Revenue" card here) — read as a forward-looking
  correction to apply going in, not a bug in prior code. Confirmed with
  `git status`/`git diff` that nothing was uncommitted before starting, so
  this is a plain rename+reformula, not a merge of some other version.
- **"Overall Redemption %" card removed**, replaced in the same grid slot
  by **Uptake** — `sum(Uptake)` over the filtered redemption cube, paired
  with `RedemptionCount` per the existing count-alongside-amount
  convention. `Uptake` is rupee-scale like `RedemptionAmount` (checked:
  total ₹28.3Cr against total redemption ₹49.9Cr), so it's formatted with
  the same `fmtLacs` as every other Amount KPI, not as a raw number.
- **Total Redemption**'s sub-label now reads "`{count} redemptions · {pct}%
  of total activation"` — the redemption-% figure the removed card used to
  show, folded in here instead of standing alone. `cancellations netted`
  wording was dropped from this sub-line (redundant — the Process Flow
  diagram's callout box below already explains the netting explicitly).

No icons/emoji exist on any KPI card in this codebase — the request's
"keep the icon/emoji per KPI card as already implemented" doesn't apply to
anything currently built, so nothing was added or changed on that front.

Verified: `git status` clean before/after confirms no drift from a parallel
edit; Revenue = ₹6,127.62L unchanged from every prior verification pass;
Uptake = ₹2,830.05L matches `sum(Uptake)/100000` exactly; Total Redemption
sub-label reads "81% of total activation" matching the prior
`overallRedemptionPct` value; re-checked under Mode=Online filter (Revenue
₹96.98L, Uptake scales down proportionally, sub-label recomputes to 82%);
zero console errors; clean production build.

## 2026-07-31 — Bug fix: Mode filter used the wrong field on the redemption side

**The bug**: the global Mode filter's redemption-side check was
`row.ActivationMode` — the origin channel of the card being redeemed —
instead of `row.RedemptionModeFinal` — where *this specific redemption
transaction* happened (Online vs. Physical/Cinema, from that row's own
Outlet). Activation and redemption are independent questions (a
Corporate-activated card can be redeemed online, and vice versa), so
chaining the redemption-side Mode filter off the activation-origin field
was wrong. Confirmed with the data directly before touching code:
`ActivationMode='Online'` + FY2025-26 on the redemption cube → ₹0.58L /
163 rows; `RedemptionModeFinal='Online'` + FY2025-26 → ₹1,840.46L / 1,805
rows — the fix target the request specified almost exactly.

**The fix** (`lib/FilterContext.jsx#filterRedemption`): one-line change,
`matches(filters.mode, row.ActivationMode)` → `matches(filters.mode,
row.RedemptionModeFinal)`. Activation-side filtering
(`filterActivation` against `ActivationModeFinal`) was already correct
and untouched. `ActivationMode` stays on every redemption row — the
existing "by Mode" breakdown charts (`RedemptionBoxOffice`/`RedemptionFnb`
"by Mode" bars, subtitled "Origin channel of the redeemed card") and the
Overview "Redemption % by Mode" chart's `ActivationModeFinal` ↔
`ActivationMode` join both intentionally use it for a genuinely different
question ("which origin channel does this redemption trace back to") —
those were correct before this bug and stay as-is; only the *global Mode
filter's* redemption-side field changed.

**Data note**: the request described `ActivationModeFinal` as having 5
values including "PVR Director's Cut" — the actual data has 4 (Aggregator,
Corporate, Online, Physical), no fifth value. Didn't chase this since the
request said no data changes were needed and the fix is field-selection
logic, not a value-list problem; flagging in case that value is expected
in a future data refresh.

**Verified**: Total Redemption (net) at Mode=Online + FY2025-26 now reads
₹1,840.46L — matches the request's ~₹1,840L target almost exactly. The
displayed count (5,51,193) doesn't match the request's ~444,475 exactly —
traced this to the existing app-wide convention (documented in the
2026-07-31 "Denomination filter" entry above) of summing `RedemptionCount`
across *all* matching Head values including Cancellation, whereas 444,475
is the Head='Online'-only count with the 1,06,718 cancellation-count
excluded (551,193 − 106,718 = 444,475, confirmed by hand). Left the
existing sum-everything convention alone rather than special-casing this
one filter combination, since changing it would be inconsistent with
every other count on the site. Baseline (no filters) KPIs unchanged
(Revenue ₹6,127.62L, matching every prior verification pass); zero
console errors; clean production build.

## 2026-07-31 — "Select All" option in every filter dropdown

Added a "Select All" row at the top of every filter's option list
(`components/Select.jsx`), gold/bold, divider below it, above the regular
checkbox rows.

**First attempt was wrong, corrected same day**: shipped it as an
action-only row — clicking it called `onChange([])` (the existing
empty-array "unrestricted" convention) without writing individual values,
reasoning that empty-selection and all-selected are functionally
identical everywhere `matches()` is read. Functionally true, but the user
correctly called it broken: clicking "Select All" left every checkbox in
the open menu visibly unchecked, which reads as "did nothing" no matter
what the closed control's summary text says. A "Select All" control has
to visibly check the boxes — that's the entire point of it.

**Fixed to a real toggle**: unchecked → checks every option (writes the
full explicit value array); checked (all real options already
individually selected) → clears them all back to `[]`. Verified via
Playwright reading actual DOM `checkbox.checked` state, not just the
resulting KPI numbers, after getting burned by trusting the numbers alone
the first time — initial state all-unchecked, one click → all 7 (6
regions + the Select All row itself) `checked: true`, second click → all
back to `false`.

This reopened the exact edge case the first design had sidestepped:
selecting *every* Month explicitly (`filters.month.length === 24`) now
needs to behave identically to selecting none, or the MoM/QoQ/YoY
`comparisonMonths` anchor logic (`lib/FilterContext.jsx`) would treat the
whole 24-month range as one "current period" instead of defaulting to the
latest month. Fixed by changing the anchor condition from `filters.month
.length > 0` to `filters.month.length > 0 && filters.month.length <
options.months.length` (moved the `options` memo above `comparisonMonths`
so it can reference `options.months.length`) — "all selected" and "none
selected" now both fall through to the same latest-month default. Verified
by selecting Month → Select All and confirming the KPI grid, including
every MoM/QoQ/YoY badge, is byte-for-byte identical to the no-filter
baseline.

Implementation: a synthetic `{value: '__select_all__', ...}` entry
prepended to each dropdown's option list; the custom `Option` renderer
intercepts it and renders its own checkbox + row with `onMouseDown` (not
`onClick` — react-select's own mousedown-based blur/close handling can
swallow a plain click on a custom element) calling an `onToggleSelectAll`
prop threaded through to `<RSelect>` (react-select forwards unknown props
into `selectProps`, which is how custom option components reach them).
The real `onChange` handler strips the sentinel value out before calling
the filter's `onChange`, so it can never leak into `filters.<key>`.

Verified: Region = North+South narrowed Revenue to ₹5,183.97L; opening
Region again and clicking "Select All" reset it to ₹6,127.62L — the exact
unfiltered baseline every prior verification pass in this file has
confirmed — and the control's closed-state summary read "All" again.
Zero console errors; clean production build.

## 2026-08-03 — Data refresh (CardType field) + real "Select All" bug fix

**Data swap**: both cubes replaced (activation 6,363 → 6,608 rows, redemption
81,031 → 85,248 rows) adding a `CardType` field — `Digital`/`Physical` on
activation rows, plus `N/A` (a value the request didn't mention but the
actual data has, same pattern as every prior data-reality-vs-spec gap in
this log); `Digital`/`Physical`/`Unknown (pre-existing)`/`N/A` on
redemption rows, matching the request exactly. No other fields changed. Not
wired up as a filter yet — the request only asked for the swap, explicitly
flagging "nothing should change yet" for this phase. Confirmed via a full
page pass that every existing KPI/chart total is byte-for-byte identical to
every prior verification in this file despite the row-count change, so
whatever the refresh restructured, it didn't touch the aggregates anything
here reads.

**The "Select All" bug** (Denomination and Source gave different results
for "default/untouched" vs "every box manually ticked"): traced to the
2026-07-31 "Select All" fix itself. That version wrote every option's
*explicit* value into the filter array when toggled on. `Denom` and
`SourceFlag` both have real `N/A` rows in the data (cancellations, mostly)
that are deliberately excluded from each dropdown's option list — so an
explicit "every option" array never included `'N/A'`, and `matches()`
correctly-but-unintentionally excluded those rows, while the untouched `[]`
state (which bypasses the check entirely) correctly included them. Verified
the exact size of the discrepancy against the data directly before touching
code: excluding `Denom='N/A'` rows inflates the redemption total from
₹4,993.79L to ₹6,073.98L (those rows are the negative cancellation
amounts — excluding them un-nets the total); excluding `SourceFlag='N/A'`
drops it to ₹1,244.49L (51,628 rows, mostly the entire Online head).

**The real fix, and a UX request that came with it**: the request also
asked for every filter to *look* pre-ticked by default, not just
function as unrestricted — "should look and behave like a typical
bank-dashboard multi-select". Solved both at once by decoupling what's
*stored* from what's *displayed* in `Select.jsx`:
  - `filters.<key>` stays exactly `[]` for "unrestricted" — `matches()` in
    `FilterContext.jsx` is untouched, still just `selected.length === 0 ||
    selected.includes(value)`. This is what fixes the bug: the filter
    value pushed to `FilterContext` is normalized back to `[]` whenever
    the resulting selection covers every real option, so it can never
    again silently turn into an explicit list that excludes `N/A`.
  - The *display* layer independently computes `effectiveSelected = value
    .length === 0 ? everyRealOption : value`-derived subset, and passes
    that to `<RSelect value={...}>` — so the checkbox list shows
    everything ticked on first open (not just a text label reading "All"
    next to an empty-looking list), and unticking one option lands on a
    correctly-computed N-1 explicit array through react-select's own
    diffing (no separate code path to fall out of sync with — this
    directly satisfies the request's "deselecting one option should
    narrow... not switch to some different select-all code path").
  - `isClearable` had to be explicitly set `false`, not just omitted —
    react-select defaults it to `true` regardless of `isMulti`, and once
    `value` is never empty at the display layer, that default surfaced a
    permanent clear-× on all 8 filters simultaneously (an unrequested
    regression caught by screenshot, not by the functional checks, which
    all still passed with the × sitting there uselessly).

**Verified**: opening Denomination or Source now shows every checkbox
pre-ticked; clicking "Select All" (now effectively a no-op landing back on
the pre-ticked default) reproduces the exact unfiltered baseline for both
— the specific bug the request called out. Manually unticking one
Denomination option narrows the total as expected (confirms real per-item
narrowing still works through the same path). Re-ran every fixture from
the 2026-07-31 entries (Mode-filter fix, Month "Select All" vs. the
MoM/QoQ/YoY anchor) with corrected interaction scripts — the *old* test
scripts' "click an option to select it" pattern now does the opposite
(unticks it, since everything starts ticked), which is expected given the
new interaction model, not a regression; rewritten to untick every
non-target option instead, and the results matched their original
2026-07-31 figures exactly (Mode=Online-only + FY2025-26-only → still
₹1,840.46L / 5,51,193). Zero console errors; clean production build.

## 2026-08-03 — Overview activation flow reworked around CardType

Replaced the Overview page's Activation-side flow (was: Total Activation →
Physical/Non-Physical → "by Region" / "by Channel" sub-lists) with a
3-source × Digital/Physical tree using the newly-added `CardType` field:
Total Activation → PVR Corporate / Aggregators / Cinema → each →
Digital / Physical.

**Source grouping**: `ActivationModeFinal` has exactly 4 values (Aggregator,
Corporate, Online, Physical); per the request's clarification, "PVR
Corporate" merges Corporate + Online (PVR Inox Online + PVR-Corporate
together represent the Corporate channel's redeem/activate split),
Aggregators = Aggregator, Cinema = Physical. Every row lands in exactly one
of the 3 buckets — no leftover "Other" group, so the 3 sources always sum
exactly to the top-level total by construction.

**The one wrinkle**: ~134 activation rows carry `CardType = 'N/A'`
(negative-amount, zero-count correction/adjustment entries, e.g.
`ActivationAmount: -847500` — same netting pattern as the redemption
cube's Cancellation rows, just not broken out as its own bucket in this
schema). A strict Digital + Physical split would miss this remainder and
fail the request's own "children sum back to the source total" check.
Folded the remainder into whichever of Digital/Physical is the *larger*
bucket for that source, per row — verified this never flips a bucket
negative for the current data (Aggregators' real Physical amount is only
₹4.31L against a −₹6.27L adjustment; folding into the dominant Digital
bucket instead avoids a negative-looking node). Documented inline in
`Overview.jsx` rather than silently dropping the remainder.

**Colors** (`lib/theme.js`): `ACTIVATION_SOURCE_COLORS` reuses the exact
hues `MODE_COLORS` already assigns per mode (Cinema/Physical → gold,
Aggregators/Aggregator → blue, PVR Corporate → teal, Corporate's color)
rather than inventing new ones. `CARD_TYPE_COLORS` (Digital → plum,
Physical → olive) are the two categorical hues that weren't already in use
by this diagram, kept consistent across all 3 branches so the color means
the same thing everywhere in the tree.

**Verified the request's own arithmetic check directly against the data**
(not just visually): the 3 source totals sum to the grand total to the
rupee (₹61,27,61,674.97 both ways), and each source's folded Digital +
Physical sums exactly back to that source's own total, for all 3 sources.
Small percentages are shown as computed, not rounded away — Aggregators'
Physical share and Cinema's Digital share both render at sub-1-percent
scale exactly like the request called for.

## 2026-08-03 — Rolled out the 3-source activation model to 3 more pages

Extracted Overview.jsx's `ACTIVATION_SOURCES` + bucketing logic into
`lib/activationSource.js` (`groupByActivationSource`, `pivotByActivationSource`,
`sourceOf`) so Activation.jsx, RedemptionBoxOffice.jsx, and RedemptionFnb.jsx
share exactly one implementation — no risk of the pages drifting apart on
the unclassified-remainder-folding rule (see the 2026-08-03 activation-flow
entry above) the way there'd be if each page re-derived it.

**Activation.jsx**: KPI grid went from 4 cards (Total, Physical, Non-Physical,
Avg Ticket Size) to 5 (Total, PVR Corporate, Aggregators, Cinema, Avg Ticket
Size) — grid breakpoints widened to `sm:grid-cols-3 lg:grid-cols-5` to fit
the extra card. Added a `blue` accent to `Kpi.jsx` (`cat.blue`, already in
`tailwind.config.js`) since Aggregators' color didn't have an existing slot
among gold/teal/coral/navy. "Physical Activation — Regional Split" renamed
to "Cinema Activation — Regional Split" (identical underlying filter —
`ActivationModeFinal === 'Physical'` — just relabeled to match the new
model, per the request's "same filter, renamed" option). "Non-Physical
Activation — Channel Split" replaced by "Activation by Source": a stacked
bar (Digital/Physical per source) rather than a bar-in-bar or a second row
of small charts — reads cleanest at this chart size and keeps parity with
Overview's per-source Digital/Physical split. Month-wise trend now plots 3
source lines instead of 4 mode lines, via `pivotByActivationSource`.

**RedemptionBoxOffice.jsx / RedemptionFnb.jsx**: "by Mode" (grouped by the
raw `ActivationMode` origin-channel field, colored via `MODE_COLORS`)
replaced with "by Source" — the same 3-bucket model, each stacked by
CardType. The wrinkle: on the redemption cube, `ActivationMode` also
carries `"Pre-existing (activated before Apr 2024)"` and `"N/A"` values
that don't map to any of the 3 sources, and unlike the activation cube
these aren't negligible (~5–6% of each head's total: ₹50.2L of Box
Office's ₹803.3L, ₹60.5L of F&B's ₹1,472.5L). Rather than silently
dropping that remainder or excluding it from the chart, added it as an
explicit 4th "Pre-existing" bar in `CATEGORICAL_GRAY` (the reserved
"Other/Unassigned" color) — same "kept as a real category, not dropped"
convention already documented for `NO_SITE` and the Format/Category long
tails. Verified directly against the data: for both Box Office and F&B,
each of the 3 sources' Digital+Physical sums exactly to that source's own
total, and the 3 sources plus the Pre-existing remainder sum exactly to
each head's grand total (checked to the rupee, not just visually).

**Stacked-bar rounding**: initially rounded the last-declared segment's top
corners (standard "round only the outermost segment" practice), but for
the 4-bucket redemption charts the 3 main sources' "Pre-existing" segment
is usually zero height — rounding a zero-height segment doesn't round
anything visible. Removed the `radius` prop entirely from these 3-series
stacks rather than add per-category conditional rounding logic for a
secondary chart; Activation.jsx's 2-series stack (Digital always at the
bottom, Physical always on top and never zero in the current data) keeps
its rounded top since that edge case doesn't apply there.

**Confirmed before removing anything**: `MODE_ORDER`/`MODE_COLORS` in
`constants.js`/`theme.js` are untouched — Overview's "Redemption % by
Mode" chart still legitimately joins `ActivationModeFinal` against the
raw `ActivationMode` field (a different, already-documented question:
tracing redemption back to activation origin, not the 3-source model) and
was out of scope for this rollout.

Verified: all 4 pages screenshot cleanly with zero console errors: KPI
grid, stacked source/CardType charts, and the 3-line trend all render
with correct colors and visible small percentages (Aggregators' ~0.2%
Physical sliver, Cinema's ~2% Digital sliver, both on Activation.jsx and
the redemption pages); clean production build.

## Deployment

GitHub → Vercel, auto-deploy on push to `main`. `vercel.json` has the SPA
rewrite (`/(.*)` → `/index.html`) since routing is `BrowserRouter`, not
hash-based. See README.md for the exact push/import steps.

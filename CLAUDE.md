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

- **Mode filter** — superseded by the 2026-08-03 "Unify the Mode filter to
  the 3-source model" entry below; kept here only for history. It now always
  means the card's origin activation channel (PVR Corporate / Aggregators /
  Cinema, via `activationSource.js#sourceOf`) on both cubes, never a
  redemption-event field.
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

## 2026-08-03 — Unify the Mode filter to the 3-source model on both cubes

Redefined what the global Mode filter means, again — but this time as an
explicit product decision, not a bug fix. The 2026-07-31 "wrong field" fix
made the redemption-side Mode filter match `RedemptionModeFinal` (this
transaction's own Online/Physical channel), on the reasoning that
activation-origin and redemption-event channel are independent questions.
That was internally consistent, but the request now wants the Mode filter
to always mean *origin activation channel*, everywhere, using the same
3-bucket vocabulary (PVR Corporate / Aggregators / Cinema) the Overview/
Activation/Redemption pages already use for their "by Source" breakdowns —
not the raw 4-value `ActivationModeFinal` list, and not
`RedemptionModeFinal` at all anymore.

**No new mapping written** — `lib/activationSource.js#sourceOf()` (added in
the 2026-08-03 3-source rollout) already did exactly this bucketing from a
single `ACTIVATION_SOURCES` table. `FilterContext.jsx` now imports it
instead of hand-rolling a second mapping:
  - `filterActivation`: `matches(filters.mode, row.ActivationModeFinal)` →
    `matches(filters.mode, sourceOf(row.ActivationModeFinal))`.
  - `filterRedemption`: `matches(filters.mode, row.RedemptionModeFinal)` →
    `matches(filters.mode, sourceOf(row.ActivationMode))` —
    `RedemptionModeFinal` no longer drives this filter at all.
    `sourceOf()` returns `undefined` for the redemption cube's
    "Pre-existing"/"N/A" origin rows, which `matches()` then correctly
    excludes whenever a specific Mode is selected — same treatment as the
    "Pre-existing" bar on the Redemption pages' "by Source" charts.
  - `options.modes` changed from a data-derived
    `[...new Set(activationCube.map(r => r.ActivationModeFinal))]` (4 raw
    values) to the fixed `ACTIVATION_SOURCES.map(s => s.key)` (exactly
    "PVR Corporate", "Aggregators", "Cinema") — one option list, not
    data-derived per cube, since the bucket set is now a fixed enumeration
    rather than a pass-through of a raw field.
  - `groupByActivationSource`/`pivotByActivationSource` (the chart-grouping
    call sites) were already deriving from the same `ACTIVATION_SOURCES`
    table, so nothing there needed to change — the filter predicate and
    every chart now agree by construction, not by convention.

**Verified against raw data before and after** (not just the rendered
KPIs): manual groupby on `redemptionCube.json` for
`sourceOf(ActivationMode) === 'PVR Corporate'` and FY2025-26 gives
₹606.00L / 1,26,080 redemptions across 11,685 rows — the app matches this
exactly once Mode is narrowed to "PVR Corporate" and FY to "FY2025-26"
(previously this combination showed ₹0.00L / 0, since no
`ActivationMode` value at the time equaled a raw `ActivationModeFinal`-
style bucket key like the pre-2026-08-03 filter implicitly assumed).
Activation-side cross-check for the same filters: ₹597.62L / 91,447 cards
— also exact. Mode dropdown confirmed to show exactly 3 options
(PVR Corporate, Aggregators, Cinema); zero console errors; clean
production build.

**Left alone, on purpose**: Overview's "Redemption % by Mode" chart still
joins raw `ActivationModeFinal` ↔ `ActivationMode` per mode (Aggregator/
Corporate/Online/Physical, not the 3-bucket model) — that's a different,
already-documented question (redemption traced back to its exact origin
mode, not the merged Corporate+Online source), unrelated to the global
Mode filter, and untouched here. `RedemptionModeFinal` remains a real field
on every redemption row; nothing in the app reads it anymore after this
change, but it wasn't removed from the data.

## 2026-08-03 — Card Type (Digital/Physical) added as a real filter

Ninth global filter, added alongside Mode. `CardType` already existed on
both cubes (added in the earlier 2026-08-03 data refresh) but was only used
by the 3-source activation-flow charts, not as a user-facing filter.

**Implementation mirrors the Denomination filter exactly**, since both are
"field exists with the same meaning on both cubes, but some real values
shouldn't be offered as dropdown options":
  - `DEFAULT_FILTERS.cardType = []`; `passesCommon()` in `FilterContext.jsx`
    got one more line, `matches(filters.cardType, row.CardType)` — same
    `passesCommon` call site as Denom, since `CardType` means the same
    thing on both cubes and needs no per-cube branching.
  - `options.cardTypes` excludes `'N/A'` (both cubes) and the redemption
    cube's `'Unknown (pre-existing)'` from the pickable list, same
    "excluded from the dropdown, but rows still pass through untouched
    when unrestricted" treatment as Denom's `N/A` exclusion — picking
    "not applicable" or "unknown" isn't a meaningful filter action, but
    hiding those rows by default would silently shrink the unfiltered
    baseline.
  - `FilterBar.jsx`: added right after Mode. Grid breakpoint bumped
    `lg:grid-cols-8` → `lg:grid-cols-9` to fit the 9th control on one row
    at desktop widths; confirmed the mobile 2-column stack still lays out
    cleanly (Card Type lands directly under Mode, no overflow).

**Verified against raw data before checking the UI**: manual groupby for
`sourceOf(ActivationModeFinal) === 'Cinema' && CardType === 'Digital'` on
`activationCube.json` gives ₹34.81L / 6,955 cards (Digital is 2.05% of
Cinema's total activation amount — the request's "~1.9%" ballpark, exact
figure differs slightly from the informal estimate but is the real number);
the redemption-side equivalent (`sourceOf(ActivationMode) === 'Cinema' &&
CardType === 'Digital'`) gives ₹27.88L / 6,752 redemptions — both non-zero,
as expected. Driving the actual app with Mode=Cinema + Card Type=Digital
reproduced both figures exactly, and the Card Type dropdown showed exactly
`Digital`/`Physical` (no `N/A`, no `Unknown (pre-existing)`). Zero console
errors; clean production build.

## 2026-08-03 — Removed the Source filter entirely (UI-only, data untouched)

Removed `Source`/`Non-Source` (`SourceFlag`) from the app: the global
filter, its two Redemption-page KPI cards, and Box Office's "Source vs
Non-Source" donut. `SourceFlag` itself was left alone in both JSON cubes —
confirmed with a direct read of `redemptionCube.json` after the change
(`'N/A' | 'Non-Source' | 'Source'` still present on every row) — this was
a UI removal, not a data or schema change.

- `FilterContext.jsx`: dropped `source: []` from `DEFAULT_FILTERS` and the
  `matches(filters.source, row.SourceFlag)` line from `filterRedemption`.
- `FilterBar.jsx`: removed the `SOURCE_OPTIONS` constant and its `Select`;
  grid back to `lg:grid-cols-8` (was bumped to 9 for Card Type, now net
  +1/-1 from the two changes lands back at 8).
- `theme.js`: deleted `SOURCE_COLORS` — confirmed via grep it was only
  consumed by the donut being removed (`ACTIVATION_SOURCE_COLORS`, a
  differently-named constant for the unrelated 3-source model, was
  untouched — grep for the exact token `SOURCE_COLORS`, not a substring
  match, to tell them apart).
- `RedemptionBoxOffice.jsx`: removed `sourceRows`/`sourceAmt`/`sourceCount`/
  `nonSourceCount`, the `bySource` groupby, and the "Source vs Non-Source"
  `PieChart` card (dropped now-unused `Pie`/`PieChart`/`donutLabel`
  imports). The KPI grid's 2 freed slots became **Cinema Redemption** and
  **Digital Card Redemption** rather than resizing to a 2-card grid —
  picked because both are real, already-meaningful splits on this page
  (Cinema pulled from the existing `byActivationSource` computation,
  Digital from a direct `CardType === 'Digital'` filter on `boxOfficeRows`)
  and keep the KPI row's existing 4-card rhythm instead of leaving visible
  empty space. Accents: gold for Cinema (matches its color everywhere else
  in the app), blue for Digital (an accent slot not otherwise used on this
  page). The "Weekday Trend" card that used to sit next to the donut in a
  2-column row is now full-width on its own, since it no longer has a
  chart partner.
- `RedemptionFnb.jsx`: same KPI swap (Cinema Redemption / Digital Card
  Redemption replacing Source/Non-Source Redemption) — this page never had
  a Source donut chart, so no chart removal was needed here.

**Verified**: grepped the full `src/` tree for `SourceFlag`, exact-token
`SOURCE_COLORS`, `SOURCE_OPTIONS`, and `Non-Source` after the change — zero
hits outside `theme.js`'s now-deleted constant (confirmed gone) and the
raw-data reference in `Select.jsx`'s "N/A" doc comment (updated to cite
`CardType` instead, since `SourceFlag` is no longer filter-relevant). Filter
bar now shows exactly 8 controls (FY, Month, Week, Region, Mode, Card Type,
Ticket/F&B, Denomination) — confirmed via Playwright reading the actual
rendered `<label>` text, not just a visual check. All 5 pages checked for
leftover "Source"/"Non-Source" text — none found. Zero console errors;
clean production build.

## 2026-08-03 — Terminology audit: unify "Mode" fully around the 3-source model

Consistency pass after the Mode-unification (Phase 1), Card Type filter
(Phase 2), and Source removal (Phase 3) changes above, done last and
verified against a full grep + a live-app pass rather than by inspection
alone.

**Audited every "Online"/"Physical" occurrence in `src/` for origin-channel
meaning** (the thing that's supposed to be gone now) versus legitimate uses
of the same words for a different field:
  - All surviving `Online`/`Physical` hits are one of: `Head` values
    (Overview's redemption-flow branches, `RedemptionBoxOffice.jsx`'s
    "Redemption Heads Breakdown" subtitle/axis, `ticketFnbBucket()` in
    `FilterContext.jsx`) — a genuinely different field, unrelated to
    activation origin; `CardType` values (every "Digital"/"Physical" stacked
    bar/flow-box label) — explicitly out of scope per the request; or raw
    internal values inside `lib/activationSource.js`'s `ACTIVATION_SOURCES`
    table and doc comments, which is exactly where the raw vocabulary is
    supposed to still live (it's the one place translating *from* it).
    `Activation.jsx`'s `ActivationModeFinal === 'Physical'` check
    (Cinema's regional-split filter) is internal logic, not a rendered
    label — its Card title already reads "Cinema Activation — Regional
    Split" (renamed in the earlier 2026-08-03 3-source rollout). Zero
    remaining cases of "Online" or "Physical" rendered as an origin-channel
    label anywhere.

**Overview's "Redemption % by Mode" chart — folded into the 3-source model**
(the recommended option, taken deliberately): it used to join raw
`ActivationModeFinal` (activation) against raw `ActivationMode`
(redemption) via `MODE_ORDER`, a genuinely different, more granular
question than the Mode filter's 3-bucket model. Since this pass's whole
point is one unified definition, and the raw 4-value breakdown had no
other surviving use anywhere else in the app after Phases 1–3, kept it
consistent instead of preserving it as a labeled drill-down: renamed to
**"Redemption % by Source"**, subtitle spelled out as "per activation
source (PVR Corporate / Aggregators / Cinema)" so it reads as obviously
intentional, and recomputed via `groupByActivationSource()` /
`ACTIVATION_SOURCES` — the same shared bucketing every other "by Source"
chart in the app already uses — instead of a bespoke `MODE_ORDER.map()`.
Renamed `redemptionPctByMode` → `redemptionPctBySource` and its `mode` data
key → `source` to match.

**`MODE_ORDER` (`constants.js`) and `MODE_COLORS` (`theme.js`) removed.**
`MODE_ORDER`'s only call site was the chart just folded above.
`MODE_COLORS` turned out to already be fully dead before this pass even
started — grepped for it and found no import/usage anywhere, only a
comment in `theme.js` referencing it by name; that comment was reworded to
stop citing a constant that no longer exists. Removing both means neither
can get silently re-wired back into a filter or chart in a future change.

**Final reconciliation, all filters cleared**: Revenue/Total Activation
₹6,127.62L / 10,32,777 cards, Total Redemption (net) ₹4,993.79L /
15,56,752 redemptions — byte-for-byte identical to every prior
verification in this file, confirming Phases 1–4 only ever touched which
dimension drives filtering/labels, never the underlying row values. Zero
console errors across all 5 pages; clean production build.

## 2026-08-03 — Investigated the >100% bug on "Redemption % by Source"

The request diagnosed the Aggregators bar reading 103% as `sourceOf()`
(called `sourceForMode()` in the request) falling back to a default bucket
for `ActivationMode = "Pre-existing (activated before Apr 2024)"` rows,
double-counting redemption amount with no matching activation amount.
Checked this against the actual code before touching anything, per this
file's standing practice of confirming root causes against real data/code
rather than a request's assumed diagnosis:

- `lib/activationSource.js#sourceOf()` already has no fallback — `.find(...)
  ?.key` returns `undefined` for any value not in `ACTIVATION_SOURCES`
  (confirmed via source read, not just testing).
- `groupByActivationSource()` (which `redemptionPctBySource` already used,
  from the earlier same-day "Terminology audit" entry) filters
  `rows.filter(r => modes.includes(r[modeField]))` — Pre-existing/N/A rows
  never enter any of the 3 buckets' `amount` sums to begin with.

**So the specific bug described doesn't reproduce in this codebase** — it
was already structurally impossible by the time this request arrived
(Pre-existing exclusion was built into `sourceOf`/`groupByActivationSource`
from Phase 1 of the Mode-unification work, before this chart even existed
in its current form). Verified by hand against the raw cubes directly
(Node script summing `RedemptionAmount`/`ActivationAmount` per source using
the exact same bucketing rule, entirely independent of the React code):
with Pre-existing correctly excluded from both sides, Aggregators still
comes out to **102.81% (₹2,632.82L redeemed vs. ₹2,560.91L activated)** —
Cinema 81.72%, PVR Corporate 91.47%.

**Real cause, traced separately**: sampled redemption rows with nonzero
`Uptake` and found `Uptake` is not a subset of `RedemptionAmount` — it
independently over- or under-shoots it per row (e.g. one row: `Redemption
Amount: 500, Uptake: 3370`), consistent with `Uptake` representing a
different value (likely gross ticket/item value vs. actual wallet debit)
rather than a component that's bounded by the card's original activation
value. Also confirmed activation and redemption cubes cover the exact same
24-month window (2024-04 to 2026-03 in both), ruling out an out-of-window
activation gap as the explanation. Net effect: it's structurally possible,
and apparently actually happening for the Aggregators source in this
dataset, for aggregate redemption value to exceed aggregate activation
value for one source while the site-wide total stays under 100% (81%)
because the other two sources run under. This reads as a real
characteristic of the promotional/Uptake mechanic, not a data-quality or
code bug — flagged to the user rather than forced under 100%, since doing
that would require suppressing or misrepresenting real rows.

**Shipped anyway (harmless regardless of how the >100% question resolves)**:
added a `preExistingRedemption` computation and a small italic note under
the chart — "Excludes ₹736.19L (3,24,443 redemptions) from cards with no
matching activation-side source... a % ratio wouldn't be meaningful" —
making the exclusion visible instead of silent, same spirit as the
Redemption pages' explicit gray "Pre-existing" bar. Deliberately **not** a
4th bar on this specific chart, unlike those pages' amount-based "by
Source" stacked bars: this chart is a ratio (redemption ÷ activation), and
Pre-existing rows have no activation-side denominator by definition, so a
"Pre-existing %" bar would have no meaningful value to plot.

Zero console errors; clean production build.

## 2026-08-03 — Overview additions: YoY, Weekend/Weekday, Region deltas, Source amounts

Four new pieces on Overview.jsx, all reusing existing shared logic rather
than each inventing its own:

**Year-on-Year** (Activation vs. Redemption per FY): needed a "respect all
filters except FY" row pool, so `FilterContext.jsx` got a `skipFY` option
on `passesCommon()`/`filterActivation`/`filterRedemption`, exposed as
`activationRowsAllFY`/`redemptionRowsAllFY` — the exact same pattern
`skipMonth`/`*AllMonths` already established, just for FY instead of Month.
FY isn't a raw field on either cube (`fyOf(YearMonth)` derives it), so the
grouping itself is a plain `.filter()` per FY rather than `groupSum()`
(which only groups by a literal row field).

**Weekend vs. Weekday**: Trends.jsx already had this exact computation
inline (`weekSlot`). Extracted it to `lib/aggregate.js#weekSlotBreakdown()`
rather than writing a second copy for Overview — both pages now call the
same function, so they can't silently drift on what counts as a weekend.
Verified byte-identical output before/after the extraction by screenshotting
Trends' "Week-slot Overview" pre- and post-change (4,697/3,113 Weekday,
1,431/1,881 Weekend — unchanged).

**Region Contribution — converted from a donut to a bar chart with visible
MoM deltas**: the request's own "or convert to a bar chart if that reads
better with labels" option, taken because donut segment labels have no
room for a second line (arrow + %) without colliding, and every other
"by Region" chart in the app (`RedemptionBoxOffice`/`RedemptionFnb`) is
already a bar chart — this makes Region Contribution consistent with them
too. Per-region delta: filtered `activationRowsAllMonths` down to each
region, then ran the *exact same* `computeComparisons()` the KPI badges
use — no new comparison-math function needed, since `computeComparisons`
already takes an arbitrary row array. The tricky part was getting the delta
onto the bar itself without a hover: Recharts' `LabelList` strips
non-SVG-attribute props before calling a custom `content` renderer (checked
against the installed recharts source, not assumed), so a `mom` field
riding along on each data row never reaches the label function. Solved with
a factory (`ChartLabels.jsx#regionDeltaLabel(data)`) that closes over the
same array passed to `<BarChart data>` and looks the delta up by
`props.index` — `index` is one of the few props Recharts always passes
through unfiltered.

**Redemption % by Source — companion raw-amounts chart**: added
"Activation vs. Redemption by Source" right next to it, reusing
`redemptionPctBySource`'s existing `act`/`red` fields (no new
aggregation — just a second chart over the same data), extended with
`actCount`/`redCount` so the tooltip can show counts alongside amounts per
the app-wide convention.

**Verified against raw data by hand before checking the UI**: FY2024-25
₹2,321.80L activation / ₹1,866.27L redemption, FY2025-26 ₹3,805.81L /
₹3,127.53L — app renders ₹2,322L/₹1,866L/₹3,806L/₹3,128L (Lacs-axis
rounding). Weekday ₹4,696.61L activation / ₹3,113.27L redemption, Weekend
₹1,431.00L / ₹1,880.53L — exact match. Zero console errors across Overview
and Trends; clean production build.

## 2026-08-03 — Overview additions: CardType, Ticket/F&B, Denomination

Three more Overview.jsx charts, again reusing shared logic instead of
re-deriving it:

**Activation vs. Redemption by Card Type**: structured with `metric`
(Activation/Redemption) as the x-axis and CardType (Digital/Physical) as
the 2-series split, colored via `CARD_TYPE_COLORS` — the request's "using
CARD_TYPE_COLORS" only makes semantic sense this way round; coloring the
Activation/Redemption series themselves with `CARD_TYPE_COLORS.Digital`/
`.Physical` would have borrowed a color that already means "Digital card"
everywhere else in the app (Process Flow, every "by Source" stacked bar)
to mean something unrelated. Tooltip counts needed a small trick: the
count field name depends on the series (`Digital__count`/`Physical__count`)
*and* the unit depends on which row (Activation → "cards", Redemption →
"redemptions") — confirmed `ChartTooltip`'s `countField`/`countUnit`
function props both receive the full Recharts payload entry (`p.payload`
is the entire data row, not just the series value), so
`countUnit={(p) => p.payload?.metric === 'Activation' ? 'cards' :
'redemptions'}` reads the row's `metric` field directly rather than
needing a third prop.

**Ticket vs. F&B — redemption-only, explicitly labeled as such**: reused
`FilterContext.jsx`'s `ticketFnbBucket()` (exported for this purpose)
rather than re-deriving the Online/Box-Office/Cancellation→"Ticket"
grouping a second time. No activation-side equivalent was invented — the
Card subtitle reads "Redemption only — F&B/Ticket split doesn't exist at
activation" verbatim per the request, so the missing Activation bar reads
as intentional, not a bug.

**Activation vs. Redemption by Denomination**: grouped both cubes by
`Denom`, ordered via the existing `DENOM_ORDER`/`orderBy()` (no new
ordering logic). `Denom = 'N/A'` rows (cancellation-side entries — same
₹1,080.19L this file's Cancellations KPI already accounts for) are
excluded from the grouping, same treatment as `options.denominations`
already gives the filter's own dropdown — 'N/A' isn't a real Denom tier,
just cancellation bookkeeping.

**Verified against raw data by hand before checking the UI**: CardType —
Activation Digital ₹4,184.43L / Physical ₹2,017.60L, Redemption Digital
₹4,211.11L / Physical ₹1,518.87L. Ticket/F&B — Ticket ₹3,521.27L /
11,64,972 redemptions, F&B ₹1,472.52L / 3,91,780 redemptions (the F&B
figure exactly matches the existing F&B Redemption KPI on
`RedemptionFnb.jsx`, a useful cross-check that the bucketing is identical).
Denomination — all 8 tiers checked individually (e.g. "Other / Custom":
Activation ₹1,199.50L vs. Redemption ₹1,629.40L, the one tier where
redemption exceeds activation). All figures matched the rendered charts
exactly. Zero console errors; clean production build; mobile (390px)
screenshot confirmed no overflow.

## 2026-08-03 — Full data-binding audit of Overview.jsx (Phases 1–3 charts)

Systematic reconciliation pass, not a spot check: every Overview.jsx chart
(the 9 added across the "Phase 1–3" Overview work above, plus everything
already on the page) checked two ways — (1) a static read confirming it
derives only from `useFilters()`'s `activationRows`/`redemptionRows`/
`*AllMonths`/`*AllFY` (grepped the file for `activationCube`/
`redemptionCube`/`fetch(`/hardcoded totals — zero hits, so nothing reads a
stale or unfiltered copy), and (2) a hand-computed reconciliation of each
chart's own total against the raw cubes with a Node script mirroring the
exact aggregation each chart uses, run *before* touching the UI.

**Found one real bug**: "Activation vs. Redemption by Card Type" summed
Digital+Physical by simply filtering `CardType === 'Digital' | 'Physical'`,
silently dropping rows with no CardType or an unmodeled value (activation
cube's `CardType='N/A'`, redemption cube's `'Unknown (pre-existing)'`/
`'N/A'`). Those rows carry **net-negative** correction/cancellation
amounts (~134 activation rows, ~4,161 redemption rows), so dropping them
didn't undercount — it *overcounted*: the chart would have shown
₹6,202.03L activation (vs. the true ₹6,127.62L) and ₹5,729.98L redemption
(vs. ₹4,993.79L), both **higher** than the validated headline, which is
exactly the "technically wired but silently mis-scoped, passes a visual
check, fails reconciliation" failure mode this audit was written to catch.

**The fix**: extracted the exact fold-the-remainder-into-the-larger-bucket
rule `lib/activationSource.js#groupByActivationSource` already uses for
its per-source Digital/Physical split into a new shared
`lib/aggregate.js#splitByCardType(rows, amountField, countField)`, and
switched Overview's CardType chart to call it — rather than reimplementing
the same fold math a second time inline, which is exactly how this kind of
bug happens (see the 2026-08-03 "Rolled out the 3-source activation model"
entry's own reasoning for extracting `groupByActivationSource` in the
first place). Verified post-fix with the same Node script: Digital+Physical
now sums to ₹6,127.62L (activation) and ₹4,993.79L (redemption) exactly.

**Every other chart reconciled exactly on the first check** (diffs below
are pure float-summation noise, ~1e-6 out of ~6×10^8 paise):
  - `activationBySource` (Process Flow, 3 sources): diff 0.
  - `byHead` (Process Flow redemption branches + Cancellations): diff
    ~0.000003.
  - `redemptionPctBySource`'s `red` values + `preExistingRedemption`:
    diff ~0.000004 — confirms the Pre-existing exclusion documented
    earlier really is the *only* remainder, nothing else leaks out.
  - `regionContribution`: diff 0.
  - `weekSlot` (Weekend vs. Weekday): diff ~0.000003.
  - `monthTrend` (Pan-India Monthly Trend): diff ~0.000002.
  - `yoyByFY` (Year-on-Year, all filters cleared so the `skipFY` pool
    equals the normal pool): diff ~0.000003.
  - `ticketFnbSplit` (Ticket vs. F&B): diff exactly 0 — every `Head`
    value maps to a bucket, so nothing is dropped.
  - `denominationSplit`: does **not** sum to the headline by design
    (excludes `Denom = 'N/A'`, the same cancellation-bookkeeping rows
    documented throughout this file) — checked the *gap* instead, and it
    matches the N/A rows' amount to the rupee (−₹74.41L activation,
    −₹1,080.19L redemption, the latter being exactly the Cancellations
    KPI), confirming the exclusion is complete and nothing extra is
    missing beyond what's documented.

**Live-app confirmation, not just the raw-data math**: loaded Overview
with all filters cleared (Revenue ₹6,127.62L / Total Redemption ₹4,993.79L,
matching every prior verification in this file) and screenshotted every
chart; then applied Region=NORTH and re-screenshotted the same charts —
every one visibly recomputed (Total Activation → ₹2,998.76L, the exact
figure from this file's original Overview verification pass), confirming
the charts are live-filtered, not a static render. Zero console errors
throughout. Clean production build.

## 2026-08-03 — Dashboard-wide formatting fix: ₹ axis titles + bar labels

Two-part currency-legibility fix applied to every ₹-amount chart across all
5 pages (Overview, Activation, Redemption · Box Office, Redemption · F&B,
Trends) — count axes/labels and % axes/labels were explicitly left alone.

**Y-axis unit title**: every chart whose Y-axis (or, for the two
horizontal bar charts, X-axis) used `tickFormatter={fmtLacsAxis}` got a
`label={{ value: '₹ in Lakhs', angle: -90, position: 'insideLeft', ... }}`
(or, for the horizontal "by Format"/"by Category" charts, a non-rotated
`position: 'insideBottom'` variant, with the chart's bottom margin bumped
from 0 to 16 to give it room). 22 axes total. Left the one `unit="%"` axis
(Overview's "Redemption % by Source") and the one `tickFormatter={fmtNumber}`
axis (Trends' "Monthly Trend — Card Count") untouched, per the request.

**Bar-top labels now carry the ₹ symbol**: added `fmtLacsLabel(rupees)` to
`format.js` (`fmtLacs(rupees, 0)` — reuses `fmtLacs`'s existing
symbol/formatting rather than re-deriving it) and pointed `AmountLabel` and
`regionDeltaLabel` (`ChartLabels.jsx`) at it instead of the bare
`fmtLacsAxis`. `fmtLacsAxis` itself is untouched and still bare-number —
it's still correct for the axis *ticks*, which now sit next to the new
axis title instead of needing to carry the unit themselves.

**Swept for other bare-currency spots** the component-level fix wouldn't
reach: the two horizontal "by Format"/"by Category" charts
(`RedemptionBoxOffice.jsx`/`RedemptionFnb.jsx`) used
`<LabelList position="right" formatter={fmtLacsAxis} />` directly, not
`AmountLabel`. Fixing the formatter alone wasn't enough — while testing
found a second, unrelated bug in Recharts itself: `position="right"`
sizes its internal text-wrap budget off *the bar's own pixel width* when
no `parentViewBox` is supplied (confirmed by reading the installed
recharts source, not assumed), so short bars like the F&B "Add-ons" (₹12L)
or "Other" (₹1L) rows wrapped their label onto two lines ("₹12" / "L")
once the text got long enough to add the currency suffix — large bars
never hit this because their own width happened to be wide enough to fit
the text. Fixed by adding `HorizontalAmountLabel` (`ChartLabels.jsx`), a
plain custom `<text>` positioned the same way `AmountLabel`/`PctLabel`
already are, sidestepping Recharts' wrap machinery entirely rather than
fighting it with an explicit `width` prop. Also found `RedemptionFnb.jsx`'s
"Hero Products" list rendering `p.amount.toFixed(2)` as a bare number next
to its progress bar — fixed to `₹{p.amount.toFixed(2)} L`, keeping its
existing 2-decimal precision (a denser 15-row list, not a chart, so kept
its own established formatting instinct rather than forcing the 0-decimal
bar-label convention onto it).

**Verified**: clean production build; screenshotted at least one chart per
page (Overview's Region Contribution/Year-on-Year, Activation, Box Office's
horizontal "by Format", F&B's horizontal "by Category" + Hero Products,
Trends) confirming every currency bar label reads "₹1,688 L"-style and
every currency axis shows "₹ in Lakhs"; re-verified the horizontal-chart
fix specifically (small bars' labels now single-line); mobile (390px)
screenshot confirmed no overflow from the new axis titles. Zero console
errors throughout.

## 2026-08-03 — Overview cleanup: removed 4 charts, "Weekend vs. Weekday" → "Redemption Trend"

Trimmed Overview.jsx back down after the Phase 1–3 "Overview additions"
build-out above added more charts than turned out to be wanted long-term.

**Removed entirely** (component, computation, and imports): "Redemption %
by Source" (`redemptionPctBySource` + its `preExistingRedemption` caption
data), "Activation vs. Redemption by Source" (shared the same
`redemptionPctBySource` data), "Activation vs. Redemption by Card Type"
(`cardTypeSplit`), "Ticket vs. F&B" (`ticketFnbSplit`). `activationBySource`
was **not** removed — the Process Flow diagram still depends on it — only
the redemption-side `groupByActivationSource()` call `redemptionPctBySource`
made is gone.

**"Weekend vs. Weekday" → "Redemption Trend"**: kept calling the exact same
`lib/aggregate.js#weekSlotBreakdown()` Trends.jsx's "Week-slot Overview"
also uses (per the request, explicitly not reimplemented) — that function
still returns both Activation and Redemption per slot since Trends.jsx
still needs both; Overview's chart now just renders the `Redemption` bar
and drops the `Activation` `<Bar>`/`<LabelList>` and the now-single-series
`<Legend>`. Trends.jsx itself is completely untouched.

**Import cleanup**: removed `ticketFnbBucket` (FilterContext), `splitByCardType`
(aggregate.js), `ACTIVATION_SOURCES` (activationSource.js), and `PctLabel`
(ChartLabels.jsx) from Overview.jsx's import line — each had no remaining
call site in this file after the above. Left the underlying exported
functions themselves in place in their source modules (`ticketFnbBucket`
is still load-bearing for the real Ticket/F&B *filter* in
`FilterContext.jsx`; `splitByCardType` and `PctLabel` are now unused
anywhere but weren't asked to be deleted — same "leave the dead export,
don't chase it" call already made for `donutLabel` after the Region
Contribution donut→bar conversion earlier in this file).

**Verified**: grepped for the 4 removed chart titles and "Weekend vs.
Weekday" post-change — none found; "Redemption Trend" confirmed present.
Baseline KPIs unchanged (Revenue ₹6,127.62L / Total Redemption
₹4,993.79L, matching every prior verification in this file). Redemption
Trend's own bars (Weekday ₹3,113L, Weekend ₹1,881L) match the old
"Weekend vs. Weekday" chart's Redemption-side figures exactly — confirms
the underlying data pipeline didn't change, only which series renders.
Zero console errors; clean production build (bundle size dropped ~6KB
from the removed code, consistent with a pure deletion).

## 2026-08-03 — Display-only rename: Region "NO_SITE" → "Online"

Renders as "Online" everywhere in the UI; the raw `Region_Clean` value,
`REGION_ORDER`'s sort key, and `REGION_COLORS`' lookup key all stay
`'NO_SITE'` — confirmed a UI-only change, not a data or filter-logic one.

**Single source of truth**: `lib/constants.js#regionLabel(key)`, backed by
a small `REGION_LABELS` map (`{ NO_SITE: 'Online' }`), added right next to
`REGION_ORDER` rather than scattering the string `'Online'` across 5 call
sites. Noted inline that this is an unrelated naming coincidence with
`HEAD_ORDER`'s real `'Online'` value (the redemption `Head` field) — same
English word, two different questions, easy to conflate when grepping.

**Applied everywhere a region key renders as text**:
  - `FilterBar.jsx`: Region `<Select>` now gets `options.regions.map(r =>
    ({ value: r, label: regionLabel(r) }))` instead of the raw string
    array — same `{value, label}` pattern the Month filter already used
    for a different value/label split, not a new mechanism.
  - `Overview.jsx` (Region Contribution), `Activation.jsx` ("Cinema
    Activation — Regional Split"), `RedemptionBoxOffice.jsx` /
    `RedemptionFnb.jsx` ("by Region"): each region chart's `<XAxis
    dataKey="key">` got `tickFormatter={regionLabel}`, and its `<Tooltip>`
    got `labelFormatter={regionLabel}` (a standard Recharts prop that
    transforms the hovered category label before it reaches `ChartTooltip`
    — no change needed inside `ChartTooltip` itself). `REGION_COLORS`
    lookups (`Cell fill={REGION_COLORS[r.key]}`) were left keyed by the
    raw value, per the request — only what's drawn changed.
  - Confirmed no donut chart still renders a region label (Overview's
    Region Contribution was already converted to a bar chart in an
    earlier pass) and no `<Legend>` exists on any of these 4 charts (all
    single-series with per-bar `Cell` colors) — nothing else to touch.

**Verified**: grepped the rendered Overview page for the literal string
"NO_SITE" post-change — zero hits. Region filter dropdown shows exactly
`CENTRAL, EAST, NORTH, Online, SOUTH, WEST` (alphabetical position
unchanged, confirming the stored *value* is still `'NO_SITE'`, only the
*label* moved). Selecting "Online" in the filter narrowed Revenue to
₹279.23L — matching this file's own prior NO_SITE figure from the
Region Contribution chart exactly, confirming the filter still targets
the real underlying rows. All 4 charts screenshotted showing "Online" in
place of "NO_SITE" with the same gray color and same amounts as before
(Overview ₹279L, F&B ₹6L). Zero console errors; clean production build.

## 2026-08-03 — "Cancellations" KPI renamed to "Cancel Redeem" + new Cancel Redeem page

**Rename**: Overview.jsx's KPI label (`"Cancellations"` → `"Cancel Redeem"`)
and the coral note under the Process Flow diagram (`"Cancellations: ₹..."`
→ `"Cancel Redeem: ₹..."`). Deliberately left two other things unchanged:
the KPI's own sub-line still reads "`{count} cancellations · netted into
total`" (kept "cancellations" as the plain-English unit noun describing
what's being counted — same pattern as "cards"/"redemptions" elsewhere;
"X cancel redeems" would've read wrong), and `RedemptionBoxOffice.jsx`'s
"Redemption Heads Breakdown" subtitle ("Online / Box Office / F&B /
Cancellation (net)") — that's literally listing the 4 raw `Head` values as
they appear on that chart's own X-axis, not referring to this KPI, so
renaming just that one word would have desynced the subtitle from the bar
label it's describing. Every other `'Cancellation'` occurrence in the
codebase (`HEAD_ORDER`, `HEAD_COLORS`, `ticketFnbBucket()`) is the raw
`Head` data value and stays untouched, per the task's own scope.

**New `/cancel-redeem` page** (`pages/CancelRedeem.jsx`), added to
`App.jsx`'s `<Routes>` and `Layout.jsx`'s `TABS` array: same
`Head === 'Cancellation'` rows the Overview KPI already reads, filtered
from the same `useFilters()` pool every other page uses (so it
automatically respects FY/Region/Month/etc. — no new filter-plumbing
needed). Four pieces: one KPI card (amount + count, `accent="coral"`,
mirrors the Overview KPI exactly — no MoM/QoQ/YoY badges, since Overview's
own version doesn't have them either and the page's own Monthly Trend
chart already covers month-over-month reading), a monthly trend line, a
Region bar chart (colored via the same categorical `REGION_COLORS` every
other "by Region" chart uses, including the Phase 2 NO_SITE→"Online"
`regionLabel()` rename), and a Weekday bar chart (same shape as
`RedemptionBoxOffice.jsx`'s "Weekday Trend"). Left a `TODO` comment in
place of a by-Source chart, per the request — cancellations aren't
obviously attributable to an origin source the way a real redemption is,
and that's flagged as a separate pending decision rather than guessed at.

**Sign handling**: cancellation rows carry a negative `RedemptionAmount`
(the netting convention documented throughout this file). Every
aggregation sums that raw signed field first — same as everywhere else —
and only takes `Math.abs()` at display time, mirroring the existing
Overview KPI's own `Math.abs(cancellationRow.RedemptionAmount)`. Applied
to every chart on this page (not just the KPI), since unlike the mixed
Redemption Heads Breakdown chart — where the negative sign is the point,
making the netting visible — every row on this dedicated page is already
a cancellation, so there's no "netted against positive redemptions" story
left to tell visually; a downward-pointing line/bars would just read as a
bug.

**Verified**: hand-summed the raw cube (`Head === 'Cancellation'`) →
₹1,080.19L / 2,48,449 rows, matching both the pre-existing Overview KPI
and the new page's KPI exactly. Applied Region=SOUTH in the live app:
Overview's KPI and the new page's KPI both updated to the identical
₹91.93L / 21,989 figure, and the new page's Region chart correctly
collapsed to a single SOUTH bar. Zero console errors; clean production
build; mobile (390px) screenshot of the new page (reached via direct URL,
confirming the route works on a fresh load, not just client-side nav)
showed no overflow.

## 2026-08-04 — Correction: Redemption Mode is Cinema/Corporate via RedemptionModeFinal, not origin-tracking

Reverses the substance of the 2026-08-03 "Unify the Mode filter to the
3-source model" entry above for the *redemption side only* — that
unification turned out to be the wrong call. Kept here for history rather
than deleted, since it explains why `RedemptionModeFinal` briefly went
unused between that entry and this one.

**The corrected model**: Redemption has exactly 2 buckets, determined
solely by *that specific transaction's own* Outlet — `RedemptionModeFinal`
— never by `ActivationMode` or any other origin-tracking:
  - `RedemptionModeFinal = 'Online'` → labeled **"Corporate"** on the
    redemption side.
  - `RedemptionModeFinal = 'Physical'` → labeled **"Cinema"**.

This is a *labeling* difference only, not a data merge: "PVR Inox Online"
is the exact same outlet as activation's merged "PVR Corporate" bucket,
but the two sides of the dashboard deliberately call it two different
things ("PVR Corporate" on Activation, "Corporate" on Redemption) — same
business entity, described differently depending which side you're
looking at. The activation-side 3-source model (`ACTIVATION_SOURCES` /
`sourceOf()` in `lib/activationSource.js`) is completely untouched by this
entry; only the redemption side changed. Aggregators (Amazon/GiftBig) have
no redemption channel of any kind — confirmed directly against the cube
that `RedemptionModeFinal` only ever takes the 2 values above, never a
3rd/unclassified value — so there's no "Pre-existing"-style remainder
bucket needed on this side either, unlike the activation-origin model.

**New `lib/redemptionMode.js`** (deliberately a separate module from
`activationSource.js`, not a 3rd entry bolted onto `ACTIVATION_SOURCES`):
`REDEMPTION_MODES` (the 2-bucket table), `redemptionModeOf()` (the
predicate), `groupByRedemptionMode()` (chart-grouping, for if/when a
redemption-side "by Channel" chart is built). Both this file and
`activationSource.js` now share the actual bucketing/CardType-fold
mechanics via a new `lib/aggregate.js#groupByModeTable()` — extracted
from what used to be `groupByActivationSource`'s body — so the two
unrelated models (3-bucket activation-origin, 2-bucket redemption-channel)
can't drift on that math independently. `groupByActivationSource` is now a
1-line wrapper around it; verified this refactor is behavior-preserving
(identical math, just parameterized on which table to bucket against).

**`FilterContext.jsx#filterRedemption`**: `matches(filters.mode,
sourceOf(row.ActivationMode))` → `matches(filters.mode,
redemptionModeOf(row.RedemptionModeFinal))`. `filterActivation` is
untouched. `options` now exposes both `modes` (activation, 3 values) and
`redemptionModes` (redemption, 2 values, no Aggregators) side by side,
since a single shared filter value now needs two different option
vocabularies depending on which page is showing it.

**Mode filter options are now page-aware** (`FilterBar.jsx`, via
`useLocation()`): the Redemption pages (`/redemption/box-office`,
`/redemption/fnb`) and Cancel Redeem (`/cancel-redeem`, since it also
reads exclusively from the redemption cube) show exactly `Cinema,
Corporate` — Aggregators is not offered there at all, not just
zeroed-out. Overview/Activation/Trends — which need Activation's
Aggregators bucket too — keep the full 3-option activation vocabulary.
One side effect, accepted rather than engineered around: "Corporate" and
"PVR Corporate" are deliberately different strings, so selecting
"Corporate" on a Redemption page and then switching to Overview shows
₹0.00L activation (no activation bucket is literally named "Corporate")
— this is *correct*, not a bug: forcing the two strings to match would be
exactly the "merge the two views" the correction explicitly said not to
do. "Cinema" is spelled identically on both sides on purpose (it's
genuinely the same concept both ways), so it does carry across pages
without this effect.

**Removed entirely from `RedemptionBoxOffice.jsx` / `RedemptionFnb.jsx`**:
the `ActivationMode`-based "by Source" stacked chart (PVR Corporate /
Aggregators / Cinema + "Pre-existing") and the "Cinema Redemption" KPI
that read off it. Checked the data before deciding what to replace them
with, rather than guessing: `Head='Box Office'` and `Head='F&B'` rows are
**100% `RedemptionModeFinal='Physical'`** (37,386/37,386 and
42,535/42,535) — every `'Online'`/Corporate-channel redemption row has
`Head='Online'` or `Head='Cancellation'` instead. That means a "by
Channel" chart scoped to just the Box Office or F&B page would be a
single 100%-Cinema bar, and a "Cinema Redemption" KPI on these pages
would always equal the page's own total — both would be redundant/
misleading, not genuinely informative, so neither was rebuilt. The
freed-up "by Source" card slot was removed rather than left as a gap:
"by Region" is now full-width, and the KPI grid dropped from 4 cards to 3
(`Box Office/F&B Redemption`, `Digital Card Redemption`, `Avg per
Redemption`), `sm:grid-cols-3` instead of `md:grid-cols-4`.

**`CancelRedeem.jsx`**: its "TODO: by-Source breakdown" placeholder
(written before this correction existed) referenced the now-invalid PVR
Corporate/Aggregators/Cinema model — reworded to point at
`redemptionModeOf()`/Cinema-vs-Corporate instead, still not built (cancel
rows are the one place on the redemption side where both channels have
real volume — 759 Physical / 161 Online — so a chart here wouldn't be
degenerate the way Box Office/F&B's would be, but building it wasn't
asked for in this pass).

**Verified against the current (pre-swap) data, live in the app**:
Mode=Corporate + FY2025-26 on a Redemption page → Overview's Total
Redemption (net) reads ₹1,840.46L / 5,51,193 redemptions. The amount
matches the ₹1,840.5L target exactly. The count doesn't match the
~444,475 target — traced this to the same already-documented site-wide
convention as the original 2026-07-31 Mode-filter bug-fix entry: every
KPI on this site sums `RedemptionCount` across *all* matching `Head`
values including Cancellation, whereas 444,475 is specifically the
Head≠Cancellation count (551,193 − 1,06,718 cancellation-count =
444,475, confirmed by hand against the raw cube). Left the sum-everything
convention alone here too, for the same reason as before: changing it for
just this one filter combination would be inconsistent with every other
count on the site. Redemption pages' Mode dropdown confirmed to show
exactly `Cinema, Corporate` (no Aggregators); Overview/Activation/Trends
confirmed to still show the full `PVR Corporate, Aggregators, Cinema`.
Baseline totals with all filters cleared unchanged (₹6,127.62L activation
/ ₹4,993.79L redemption). Zero console errors; clean production build.

**Data swap** (completed after the user confirmed the files were already
placed in `public/data/`, which weren't there on the first check earlier
in this same pass): `activationCube.json` 6,608→6,238 rows,
`redemptionCube.json` 85,248→84,652 rows. `Denom` regrouped from
₹300/₹500/₹1000/₹1500/₹2000/₹2500/₹5000/Other-Custom to
₹300/₹500/₹1000/₹2000/₹2000+/₹5000+/₹10000+/Other-Custom — `DENOM_ORDER`
(`constants.js`) and the "Activation vs. Redemption by Denomination"
chart's subtitle (`Overview.jsx`) updated to match; no other field
changed shape. `RedemptionModeFinal`/`Head`/`YearMonth` (everything the
Mode-filter correction above depends on) are untouched by the refresh —
confirmed the Mode=Corporate/Cinema figures come out byte-identical
before and after the swap.

**Final verification, live in the app, post-swap**: baseline totals with
all filters cleared — ₹6,127.62L activation / ₹4,993.79L redemption,
unchanged. Denomination filter dropdown shows exactly the 8 new tiers in
`DENOM_ORDER`'s order; the Denomination chart renders all 8 (₹5000+ and
₹10000+ correctly render as near-zero bars — high-denomination cards are
rare, not a bug). Mode=Corporate + FY2025-26 still reads ₹1,840.46L /
5,51,193 redemptions, matching the pre-swap figures and the ₹1,840.5L
target exactly (same count-convention note as above still applies). Zero
console errors; clean production build.

## 2026-08-05 — Fix: Process Flow's redemption heads were gross, not net

**The bug**: Overview.jsx's Process Flow showed Online/Box Office/F&B as
gross amounts (their own redemption rows only), while "Total Redemption
(net)" above them already subtracted *all* Cancel Redeem transactions as
one lump sum (`Head='Cancellation'`, its own separate bucket). So the 3
heads summed to more than the net total, and each head's "% of total"
(gross ÷ net) summed well over 100% (117–119%, confirmed on two months
before the fix).

**The fix**: each head now shows *its own* net figure (own gross minus
its own attributed cancellations), computed in a rewritten
`positiveHeads` in Overview.jsx. The hard part is that Cancel Redeem rows
carry `Head='Cancellation'`, not the head of whatever they're reversing —
attributing one back to Online/Box Office/F&B needs a proxy:
  - `RedemptionModeFinal === 'Online'` (Outlet = "PVR Inox Online") maps
    1:1 to the Online head — exact, no ambiguity, since Online is the only
    head ever redeemed through that Outlet (confirmed against the 2026-08-04
    Redemption Mode correction above, which established this exact
    Outlet↔head relationship).
  - `RedemptionModeFinal === 'Physical'` (a physical cinema) could be
    reversing either a Box Office or an F&B redemption, and the row
    doesn't say which — so each Region+Month's physical cancellations are
    attributed *in bulk* to whichever of Box Office/F&B had the larger
    gross redemption in that same Region+Month. A proxy, not exact to the
    rupee — per the request's own framing, acceptable since cancellations
    are a small fraction of the total.

**Why the sum is still exact regardless of proxy accuracy**: this is a
pure redistribution, not a new number — every cancellation rupee gets
attributed to exactly one of the 3 heads (Online via the exact Outlet
match, Box Office/F&B via the proxy), so nothing is double-counted or
dropped. `netOnline + netBoxOffice + netFnB` always equals
`grossOnline + grossBoxOffice + grossFnB + cancellationTotal`, which is
definitionally `totalRedemption` — true by construction no matter how the
Box Office/F&B split lands. This means the "sum to the net total" and
"percentages sum to 100%" requirements hold exactly even though the
Box Office-vs-F&B attribution itself is a heuristic.

**Callout box reworded**: "Cancel Redeem: ₹X L (Y transactions) netted
into the total above (not excluded)" → "...already netted into Total
Redemption and into each of Online/Box Office/F&B above (not a separate
deduction you need to make yourself)" — per the request, this is now
purely informational since the netting is baked into every figure above
it, not something the reader still needs to reconcile by hand.

**Verified against raw data by hand first, then live in the app**:
FY2025-26 / Jun 2025 — gross Online ₹138.02L, own cancellations
−₹28.61L → net ₹109.41L (matches the request's ≈₹109.41L target exactly);
Online+Box Office+F&B = ₹109.41L + ₹41.81L + ₹137.65L = ₹288.86L, matching
the pre-existing "Total Redemption (net)" figure for that month to the
rupee. FY2025-26 / Jul 2025 — three heads sum to ₹302.93L, also matching
exactly. Baseline (all filters cleared) also re-checked: heads now sum to
₹4,993.79L (was previously summing higher than this before the fix) with
percentages 61.0 + 14.8 + 24.2 = 100.0%. Zero console errors; clean
production build.

## 2026-08-05 — Split the shared Mode filter into two independent filters

The single "Mode" filter (built in the 2026-08-04 "Redemption Mode is
Cinema/Corporate" correction above as one shared, page-aware control) is
gone, replaced by two always-visible, fully independent filters —
`activationSource` and `redemptionSource` — each touching exactly one cube.

**`activationSource`** (`lib/FilterContext.jsx`): raw `ActivationModeFinal`
values (Aggregator/Corporate/Online/Physical), matched directly in
`filterActivation` with no bucketing/merging — the 3-source "PVR
Corporate/Aggregators/Cinema" model in `lib/activationSource.js` stays a
chart-display concern only, now decoupled from the filter that shares its
name space. Never touches redemption rows.

**`redemptionSource`**: fixed 2-value set (Cinema/Corporate), matched in
`filterRedemption` via `redemptionModeOf(row.RedemptionModeFinal)` — same
`lib/redemptionMode.js` logic the 2026-08-04 correction introduced,
untouched. Never reads `ActivationMode`, never touches activation rows.
`options.redemptionSources` is now `REDEMPTION_MODES.map(s => s.key)` (a
fixed label list) rather than data-derived, since it's a display mapping,
not a raw field enumeration.

**Why split rather than keep one page-aware control**: the prior page-aware
version (different option lists depending on `useLocation()`) worked but
meant Overview — the one page needing both cubes' vocabularies at once —
couldn't actually filter both at the same time. Two independent controls,
always both visible on every page, removed that constraint entirely and
let `FilterBar.jsx` drop its `useLocation()`/`isRedemptionOnlyPath()`
special-casing. Grid widened `lg:grid-cols-8` → `lg:grid-cols-9` (9 filters
total). Grepped the full `src/` tree for `filters.mode`/`options.modes`/
`options.redemptionModes`/`isRedemptionOnlyPath` post-change — zero hits;
confirmed no page component reads raw filter values directly (all 5 pages
consume only `activationRows`/`redemptionRows` via `useFilters()`), so the
change was correctly scoped to just `FilterContext.jsx` and `FilterBar.jsx`.

**Verified live in the app** (Playwright, all filters cleared unless
noted): Activation Source dropdown shows exactly `Aggregator, Corporate,
Online, Physical`; Redemption Source shows exactly `Cinema, Corporate`.
Unticking Aggregator in Activation Source dropped Revenue ₹6,127.62L →
₹3,566.71L while Total Redemption (net) stayed at exactly ₹4,993.79L —
unmoved, confirming the two filters don't cross-contaminate; re-ticking
restored the exact baseline. Unticking Cinema in Redemption Source dropped
Total Redemption ₹4,993.79L → ₹3,043.86L while Revenue stayed at exactly
₹6,127.62L. FY2025-26 + Redemption Source=Corporate → ₹1,840.46L / 5,51,193
redemptions, matching the 2026-08-04 entry's figures exactly (same
sum-everything count convention noted there still applies — unchanged by
this phase). Spot-checked both Redemption pages directly: Activation
Source's Aggregator toggle left their KPIs completely unmoved (as
expected, since neither page's cube has any activation-side field), while
Redemption Source's Cinema toggle zeroed their KPIs out entirely
(₹803.31L → ₹0.00L Box Office, ₹1,472.52L → ₹0.00L F&B) — consistent with
the already-documented fact that both pages' rows are 100%
`RedemptionModeFinal='Physical'`/Cinema. Zero console errors across every
interaction on every page checked; clean production build (689.47 kB JS,
201.35 kB gzipped, no new warnings).

## 2026-08-05 — Final consolidated Source-filter model: bucketed Activation Source, renamed Redemption "Online", by-Source charts restored

Supersedes the same day's earlier "Split Mode into two independent filters"
entry above in one respect (what `activationSource` matches against) and
otherwise finalizes it. Kept both entries for history.

**`activationSource` is now bucketed, not a raw-field passthrough**: the
morning's split-filter phase matched `filters.activationSource` directly
against the raw 4-value `ActivationModeFinal` (Aggregator/Corporate/Online/
Physical). This request redefines it to match against the exact same
3-bucket model every "by Source" chart already uses
(`lib/activationSource.js#sourceOf()` — Aggregators/Corporate/Cinema, with
Corporate merging the raw Corporate + Online values). `FilterContext.jsx`'s
`filterActivation` changed from `matches(filters.activationSource,
row.ActivationModeFinal)` to `matches(filters.activationSource,
sourceOf(row.ActivationModeFinal))`, and `options.activationSources`
changed from a data-derived 4-value list to the fixed
`ACTIVATION_SOURCES.map(s => s.key)` (3 values) — same treatment
`options.redemptionSources` already got. This means the filter and every
chart now agree by construction, and "Aggregators" can never appear as a
Redemption-side option (there is no Aggregator redemption channel — see
`lib/redemptionMode.js`).

**Renaming, not just relabeling**: both bucket tables' *keys* changed, not
just display strings, specifically to kill two long-running naming
collisions this file has flagged repeatedly:
- `lib/activationSource.js#ACTIVATION_SOURCES`: `'PVR Corporate'` → `'Corporate'`,
  and the raw `'Physical'` `ActivationModeFinal` value now buckets to
  `'Cinema'` (unchanged — was already `'Cinema'` since the 3-source model's
  introduction) rather than ever being displayed as "Physical", which would
  collide with `CardType`'s own real `'Physical'` value (card form factor).
  Propagated to `lib/theme.js#ACTIVATION_SOURCE_COLORS` (key rename only,
  same hex) and `Activation.jsx#SOURCE_ACCENT`/chart subtitles.
- `lib/redemptionMode.js#REDEMPTION_MODES`: `'Corporate'` → `'Online'` (a
  direct passthrough of `RedemptionModeFinal='Online'`, no longer a
  relabel of the outlet). This retires the 2026-08-04 "same outlet,
  different label" framing — Redemption Source now literally says "Online"
  for that channel, and Activation Source's merged "Corporate" bucket is a
  genuinely different (2-raw-value) grouping, not two names for one
  question.

**Verified the merge is real, not just renamed** (requirement (c)):
Activation Source = Corporate only, all else cleared, reads ₹1,871.76L —
checked by hand against the cube first: raw `Corporate` ActivationModeFinal
sums to ₹1,774.79L, raw `Online` sums to ₹96.98L (the exact time-boxed
Apr–Jul-2024 sliver the request named), and 1,774.79 + 96.98 = 1,871.77L
(1-paisa rounding), confirming the Online sliver really is folded inside
Corporate's total, not dropped or double-counted.

**RedemptionBoxOffice.jsx / RedemptionFnb.jsx: "by Source" chart rebuilt**
(the old ActivationMode-based 3-bucket + "Pre-existing" gray-bar version was
already retired in the 2026-08-04 correction — nothing left to remove
there, just a fresh build). New "Box Office/F&B Redemption by Source" card,
paired with the existing "by Region" card in a 2-column row (mirrors the
grid this page had before 2026-08-04 freed up the slot), grouped via the
new `lib/redemptionMode.js#groupByRedemptionMode()` (previously unused,
built in the 2026-08-04 correction but never wired to a chart), stacked by
CardType the same way `Activation.jsx`'s "Activation by Source" chart is.
**Checked against the data before building, not after**: `Head='Box
Office'` and `Head='F&B'` rows are 100% `RedemptionModeFinal='Physical'`
(confirmed again directly: 37,386/37,386 and 42,535/42,535, same fact
already on record from 2026-08-04) — so the Online bar on both new charts
is a real structural zero, not a bug. Added an explicit italic caption
under each chart saying so, same "document the gap instead of guessing"
convention this file uses throughout, rather than silently building a
chart that looks broken.

**Cancel Redeem "by Source" placeholder resolved**: unlike Box Office/F&B,
cancellation rows have real, non-degenerate volume on both channels — a
new "Cancel Redeem by Source" card (single-series bar, colored via a new
`lib/theme.js#REDEMPTION_SOURCE_COLORS`, reusing `ACTIVATION_SOURCE_COLORS
.Cinema`'s gold for Cinema and `HEAD_COLORS.Online`'s blue for Online since
`RedemptionModeFinal='Online'` rows and `Head='Online'` rows are the exact
same 3,811 rows in the current data, checked directly). Verified against
the raw cube by hand first: Online cancellations ₹754.29L (161 rows),
Cinema cancellations ₹325.90L (759 rows) — sums to the page's existing
₹1,080.19L KPI exactly — and the live chart rendered those two figures to
the rupee.

**Director's Cut cinemas**: confirmed nothing miscategorizes them — they're
physical outlets with no separate flag in this schema, so they fall under
`RedemptionModeFinal='Physical'` → Redemption Source=Cinema the same as
every other physical outlet, by construction. No code path treats them
differently, so there was nothing to change.

**Full sweep, confirmed clean**: grepped `src/` for `PVR Corporate` (zero
hits), `MODE_ORDER`/`MODE_COLORS` (zero hits — already fully removed in the
2026-08-03 terminology audit), and every remaining `ActivationMode` mention
outside `ActivationModeFinal` (all are doc comments correctly stating it's
*not* read on the redemption side — no code path reads it). `CardType`'s
own `Digital`/`Physical` values are untouched and still read directly off
the `CardType` field everywhere, never conflated with Activation Source's
renamed `Cinema` bucket.

**Verified live in the app, all 4 requirement checks** (Playwright, fresh
page load per scenario to avoid a flaky-dropdown-reset false negative in
an earlier draft of this same check): (a) Activation Source dropdown shows
exactly `Aggregators, Corporate, Cinema`; Redemption Source shows exactly
`Online, Cinema` — no Aggregators option anywhere on the redemption side.
(b) Redemption Source=Online + FY2025-26 → ₹1,840.46L / 5,51,193
redemptions, matching the target and every prior verification of this
figure in this file. (c) Activation Source=Corporate (unfiltered
otherwise) → ₹1,871.76L, confirmed above to include the ₹96.98L Online
sliver. (d) All filters cleared → ₹6,127.62L activation / ₹4,993.79L net
redemption, byte-identical to every baseline in this file. Zero console
errors across every page and interaction checked; clean production build
(694.13 kB JS, 201.81 kB gzipped, no new warnings).

## 2026-08-05 — Overview flow visual refresh, missing Denomination labels, dashboard-wide color differentiation

Three independent phases, done together but documented separately since
they touch different concerns.

**Phase 1 — Overview redemption flow visual**: removed the coral "Cancel
Redeem: ₹-1,080.19L..." callout from the Process Flow card's redemption
column — Cancel Redeem has had its own dedicated page (`/cancel-redeem`)
since earlier the same day, so the netting note was becoming redundant
restatement rather than new information. In the freed space, added two
compact supporting charts: a small donut ("Head Split (excl. Cancel
Redeem)") over the existing `positiveHeads` array (already Online/Box
Office/F&B net-of-cancellation, so no new computation needed — reusing it
also guarantees the donut can never drift from the FlowBox figures above
it), colored via `HEAD_COLORS` with a compact color-dot legend underneath
instead of the outward-radiating `donutLabel` (no room for that at this
size); and a small bar chart, new `cinemaRegionSplit` computation
(`Head` in Box Office/F&B, grouped by `Region_Clean`, gross — same
convention `RedemptionBoxOffice.jsx`/`RedemptionFnb.jsx`'s own "by Region"
charts already use, not netted like `positiveHeads`). Deliberately titled
"Box Office + F&B by Region", not "Cinema Redemption by Region" — "Cinema"
is now a precise Redemption Source filter value
(`redemptionModeOf(RedemptionModeFinal)`) that would additionally include
Physical cancellations this chart omits, so reusing the word here would
have been misleading given how load-bearing that term became in the
morning's Source-filter phase. Card title renamed "Gift Card Process Flow"
→ "Gift Card Activation vs. Redemption"; subtitle dropped entirely (no
room once the two mini-charts moved in, and the new title is
self-explanatory without one).

**Phase 2 — Missing Denomination chart labels**: "Activation vs.
Redemption by Denomination" was the one 2-series bar chart on Overview.jsx
missing `<LabelList content={AmountLabel}>` on its bars — every sibling
2-series chart (Year-on-Year, this same page) already had it. Added
identically to both bars, matching the exact pattern already used one
chart up. Confirmed via screenshot: all 16 bars (8 tiers × 2 series) now
show their `₹NNN L` value directly, not hover-only.

**Phase 3 — Color differentiation audit**: added
`lib/theme.js#categoricalColor(i, isOther)` — cycles the existing 5-hue
validated `CATEGORICAL` array by position, with an explicit `isOther`
override to land on `CATEGORICAL_GRAY` instead (for `topNWithOther`'s
synthetic remainder bucket) rather than a rotation slot, per the
already-established reserved-gray "Other" convention (`NO_SITE`, unmatched
categories). Audited every chart on all 5 pages for flat single-color
fills masking multiple real categories; found and fixed 5 (every chart
whose category axis had no existing named color map — unlike
`REGION_COLORS`/`HEAD_COLORS`/`CARD_TYPE_COLORS`/`ACTIVATION_SOURCE_COLORS`,
all of which were already correctly wired to `<Cell>` per prior phases,
confirmed by an explicit pass over `Activation.jsx`'s regional/source
charts and every page's "by Region"/"by Head"/"by Source" charts — no
changes needed there):
  - `Activation.jsx` "Week-slot Activation Trend" — was a 2-color weekend/
    weekday ternary, now 7 distinct colors (one per weekday, cycling
    `categoricalColor`).
  - `RedemptionBoxOffice.jsx` "Weekday Trend" — same weekend/weekday
    ternary → 7 distinct colors.
  - `CancelRedeem.jsx` "Cancel Redeem by Weekday" — was one flat `COLORS
    .warning` fill with no `<Cell>` at all → 7 distinct colors.
  - `RedemptionBoxOffice.jsx` "Box Office Redemption by Format" — was one
    flat `COLORS.redemption` fill across all ~11 Format-tier bars → cycled
    `categoricalColor`, with the trailing `topNWithOther` "Other" bucket
    correctly landing on the reserved gray.
  - `RedemptionFnb.jsx` "F&B Redemption by Category" — same fix. Verified
    the chart legitimately shows gray twice: the raw `Category` field has
    its own real `'Other'` value (documented earlier in this file,
    alongside `'Add-ons'`) *in addition to* `topNWithOther`'s synthetic
    remainder bucket, which also keys as `'Other'` — both instances
    correctly land on `CATEGORICAL_GRAY` since both represent "not a
    specific named category," not a bug introduced by this pass.
  - Bar charts only need adjacent-pair color contrast (not all-pairs,
    which the original palette validation only checked up to 4 donut
    slots — see the "Palette" section above), so cycling 5 validated hues
    across 7 weekdays or 11 Format/Category bars stays within what's
    actually been checked (position `i` and `i+5` are never adjacent).
  - **Deliberately left unchanged**: every 2-series Activation-vs-
    Redemption comparison chart (Year-on-Year, Denomination, both Trends.jsx
    monthly-trend charts, Overview's Redemption Trend, Week-slot Overview)
    keeps its flat gold-family/teal-family fill per series — per the
    request's own instruction to preserve "gold=Activation-family,
    teal=Redemption-family" at the page/section level. Recoloring by
    category within those series would have meant every Activation bar and
    every Redemption bar at a given x-position sharing one color instead of
    being visually grouped by metric, which is a strictly worse read for a
    comparison chart, not a fix.

**Verified**: clean production build (723.84 kB JS, 207.46 kB gzipped);
screenshotted the Overview flow section confirming both new mini-charts
render with real (non-zero) data, the renamed card title, and the removed
banner; read back the actual SVG `fill` attributes on every touched chart
via Playwright to confirm 7/11 distinct colors (not just eyeballing) —
Week-slot Activation Trend, Box Office Weekday Trend, and Cancel Redeem by
Weekday all returned `[gold, blue, teal, plum, olive, gold, blue]`
(5-color cycle wrapping at position 6); Box Office "by Format" and F&B "by
Category" both returned the same 5-color cycle with gray at the `'Other'`
position(s). Zero console errors across every page checked.

## 2026-08-05 — Fix structurally-empty "by Source" charts; redefine weekend to include Friday

**Phase 4 — Box Office/F&B "by Source" charts**: the previous phase's "by
Source" charts on both Redemption pages were scoped to their own Head only
(`Head='Box Office'` / `Head='F&B'`), and both heads are 100%
`RedemptionModeFinal='Physical'` (checked repeatedly throughout this file),
so the Online bar was a structural, permanent zero on both — informative
once, not a chart worth keeping in that shape.

- **RedemptionBoxOffice.jsx**: rescoped the chart's dataset from
  `boxOfficeRows` to a new `ticketRows = Head='Box Office' OR Head='Online'`
  — both are ticket-type redemptions, just different channels (Box Office
  = in-cinema, Online = PVR Inox Online), so combining them gives the
  Online bucket real volume. Subtitle changed to "Ticket redemptions (Box
  Office + Online), by source, split by card type, ₹ Lacs" so the wider
  scope is explicit, not implied. The page's own "Box Office Redemption"
  KPI stays on `boxOfficeRows` alone, untouched — confirmed unchanged at
  ₹803.31L, both before and after this edit. Verified against the raw cube
  first: `ticketRows` splits to Online ₹3,798.16L (3,811 rows) / Cinema
  ₹803.31L (37,386 rows, i.e. exactly the Box Office total) — both real,
  non-zero buckets — and the live chart matched both figures exactly.
- **RedemptionFnb.jsx**: removed the "F&B Redemption by Source" chart
  entirely, along with its `bySource`/`sourceChartData`/`hasSourceData`
  computations and now-unused `groupByRedemptionMode`/`CARD_TYPE_COLORS`/
  `Legend` imports — F&B has no Online-redemption channel at all (ticket
  redemptions are the only thing ever bought online), so unlike Box
  Office, there's no combinable second head that would give this chart
  real content; it would always be 100% Cinema. "F&B Redemption by Region"
  (previously paired with the by-Source chart in a 2-column row) is now
  full-width again, same layout it had before the by-Source chart existed.

**Phase 5 — Weekend redefinition**: `lib/constants.js#WEEKEND_DAYS`
changed from `{Saturday, Sunday}` to `{Friday, Saturday, Sunday}`. This is
a single Set that `FilterContext.jsx`'s `isWeekend()` (the Week filter),
`lib/aggregate.js#weekSlotBreakdown()` (Trends.jsx's "Week-slot Overview"
and Overview.jsx's "Redemption Trend"), and every day-of-week
bar-coloring `<Cell>` all read from — no duplicated hardcoded
`'Saturday' || 'Sunday'` checks existed anywhere else in `src/` by this
point (grepped to confirm), since the prior phase's color-differentiation
pass had already replaced every such ternary with `categoricalColor()`
cycling instead of a weekend/weekday binary. So this phase was genuinely a
single-line change, not a multi-file sweep — the "search for hardcoded
checks" instruction found nothing left to fix, which is itself confirmation
the earlier refactor had already centralized this correctly.

**Verified against the raw cube first, then live in the app**: new
Weekend (Fri+Sat+Sun) redemption ₹2,724.35L, new Weekday (Mon-Thu)
₹2,269.44L, summing exactly to the ₹4,993.79L baseline. Overview's
"Redemption Trend" and Trends.jsx's "Week-slot Overview" both rendered
these exact figures. Cross-checked against the Week filter itself —
selecting Week=Weekend only produced Total Redemption ₹2,724.35L,
byte-identical to the chart's own Weekend bar, confirming the filter and
every weekend-aware chart still agree by construction after the
redefinition. Zero console errors across every page checked; clean
production build (722.23 kB JS, 207.40 kB gzipped).

## 2026-08-05 — KPI info-parity sweep, Cancel Redeem region scoping, final consistency pass

**Phase 6 — KPI info parity**: audited every `<Kpi>` card on all 5 pages
that have KPI grids (Trends.jsx has none) against a simple rule — any
currency KPI with both a meaningful period-over-period comparison and a
meaningful parent-total percentage should show both, added the missing
piece rather than removing the one already there:
  - **Overview.jsx**: `Uptake` gained MoM/QoQ/YoY deltas (via a new
    `uptakeDeltas = computeComparisons(redemptionRowsAllMonths, 'Uptake',
    comparisonMonths)`) and a "% of total redemption" sub-line (56.7% →
    displays "57%"). `Cancel Redeem` gained deltas and a "% of gross
    redemption" sub-line (17.8%, exact match to hand-computed
    `1,080.19 / 6,073.98`). Cancel Redeem's deltas deliberately compare the
    *magnitude* of the signed `RedemptionAmount` field (a new
    `AbsRedemptionAmount` computed field on the `AllMonths` pool), not the
    raw negative value — a rising cancellation total needed to read as "▲"
    to match how the KPI's own value is already displayed via `Math.abs()`;
    comparing the raw negative field would have produced a technically-
    correct but sign-confusing badge on a coral-accented card.
  - **Activation.jsx**: each of the 3 per-source KPIs (Aggregators/
    Corporate/Cinema — already had a "% of total" sub-line) gained
    MoM/QoQ/YoY deltas via a new `sourceDeltas` map, one
    `computeComparisons()` call per source against
    `activationRowsAllMonths` filtered through `sourceOf()`. `Total
    Activation` and `Avg Ticket Size` were left alone — the former has no
    meaningful parent (it *is* the page's top total), the latter is a
    ratio/derived tile, per the precedent already documented in the
    2026-07-31 Overview KPI entry above ("ratio/derived tiles... don't have
    a natural 'amount to compare period-over-period'").
  - **RedemptionBoxOffice.jsx / RedemptionFnb.jsx**: the headline KPI
    (`Box Office Redemption` / `F&B Redemption` — already had deltas, this
    is literally the phase's own cited example) gained a "% of total
    redemption" sub-line — each head's share of the whole filtered
    redemption cube (16% / 29%), the same cross-total framing Overview's
    `Total Redemption (net)` sub-line already uses. `Digital Card
    Redemption` (already had a "% of..." sub-line, also the phase's cited
    example) gained deltas via a new `digitalRowsAllMonths` pool. `Avg per
    Redemption` left alone (ratio tile, same precedent).
  - **CancelRedeem.jsx**: `Cancel Redeem` gained the exact same deltas
    (magnitude-based) and "% of gross redemption" framing as Overview's
    Cancel Redeem KPI, kept consistent dashboard-wide rather than inventing
    a second definition. Needed pulling `redemptionRowsAllMonths` and
    `comparisonMonths` into this page's `useFilters()` destructure (it
    previously only read `redemptionRows`) and importing
    `computeComparisons`.
  - **Definitional judgment call, flagged here rather than silently
    picked**: "% of gross redemption" (pre-cancellation) was chosen over
    "% of Total Redemption (net)" for Cancel Redeem specifically because
    the net figure already has this amount subtracted out — a % against it
    would be circular framing, not a real cancellation-rate metric. This
    mirrors the standard "cancellation/return rate" pattern from ticketing
    BI dashboards (cancelled ÷ attempted), not something invented for this
    pass.

**Phase 7 — Cancel Redeem by Region excludes Online**: new
`cinemaCancelRows = cancelRows.filter(r => redemptionModeOf(r
.RedemptionModeFinal) === 'Cinema')`, feeding only the "by Region" chart —
the top-line `Cancel Redeem` KPI and the other two charts (Monthly Trend,
by Source, by Weekday) stay on the full, unfiltered `cancelRows`, per the
request's explicit "stays visible elsewhere on the page, unfiltered."
Subtitle added: "Cinema only — Online cancellations excluded." Verified
against the raw cube first (Cinema-only cancel total ₹325.90L vs. the full
₹1,080.19L) and live in the app — the chart's 6 region bars sum to ₹326L
(rounding), matching exactly; the small "Online" bar visible there is the
unrelated `NO_SITE`→"Online" *region* label rename (a real Region_Clean
value, coincidentally the same word — see the 2026-08-03 entry on this
naming collision), not a Redemption Source leak.

**Phase 8 — Final consistency sweep, findings**: grepped and manually
walked every page against the 5 checklist items —
  - (a) terminology: zero stray `PVR Corporate`/`SourceFlag`/`Non-Source`
    hits outside historical doc comments; every `NO_SITE` reference is
    infrastructure for the intentional display rename, not a leak.
  - (b) currency labels: every non-stacked amount bar chart has
    `AmountLabel`/`HorizontalAmountLabel`. The 2 CardType-stacked bar
    charts (Activation's "Activation by Source", Box Office's "by Source")
    are consistently label-free/tooltip-only — a deliberate, already-
    consistent convention (stacked segments have no room for a label
    without overlap), not an oversight, so left as-is.
  - (c) Y-axis unit titles: every `tickFormatter={fmtLacsAxis}` axis
    across all 5 pages has its "₹ in Lakhs" title. Two documented
    exceptions, both pre-existing and intentional: Trends.jsx's "Monthly
    Trend — Card Count" (count axis, `fmtNumber`, no Lacs title needed) and
    Overview's new compact "Box Office + F&B by Region" mini-chart (`<YAxis
    hide />` — deliberately chartless/tooltip-only at that small size, per
    the 2026-08-05 "Overview flow visual refresh" entry above).
  - (d) KPI parity: confirmed complete across all 5 KPI-bearing pages (see
    Phase 6 above) — Trends.jsx has no KPI cards at all, nothing to check
    there.
  - (e) color differentiation: every single-series multi-category bar
    chart across all 5 pages already uses `<Cell>` with either a named map
    (`REGION_COLORS`/`HEAD_COLORS`/`REDEMPTION_SOURCE_COLORS`) or
    `categoricalColor()` cycling. Nothing found needing a fix — the
    2026-08-05 "color differentiation audit" entry above already covered
    every page, this pass just re-confirmed it.
  - **Nothing flagged as needing a product decision** — every gap found in
    this sweep had an unambiguous mechanical fix (the Cancel Redeem % study
    above was a definitional call but a well-precedented one, documented
    rather than silently guessed).

**Verified**: hand-computed every new %/delta figure against the raw
cubes before checking the UI (Uptake 56.7%→"57%", Cancel Redeem rate
17.8%, Box Office 16.1%→"16%", F&B 29.5%→"29%" via `fmtPct`'s existing
rounding), then confirmed byte-for-byte matches live in the app across
Overview/Activation/Box Office/F&B/Cancel Redeem; Cancel Redeem's deltas
came out identical on both Overview and the dedicated page (▲349.6% MoM /
▲3.4% QoQ / ▲284.8% YoY), a useful cross-check that both computations
agree. Zero console errors across every page checked; clean production
build (724.24 kB JS, 207.87 kB gzipped).

## 2026-08-05 — Removed Overview's Cancel Redeem KPI; black header ribbon with blended logo

**Cancel Redeem KPI removed from Overview's grid**: the ribbon now holds
exactly 3 cards (Revenue/Activation Amount, Total Redemption (net),
Uptake), grid changed from `grid-cols-2 md:grid-cols-4` to `grid-cols-1
sm:grid-cols-3`. Cancel Redeem remains fully available as its own nav tab/
page (`/cancel-redeem`, already existed) — this was purely "don't
duplicate it as a KPI card too," not a removal of the feature. Cleaned up
now-dead code the removed KPI was the only consumer of:
`byHead`/`cancellationRow`/`grossPositiveRedemption`/`cancelRatePct`/
`cancelRowsAllMonths`/`cancelDeltas` — none of these fed anything else on
the page (`positiveHeads` computes its own cancellation rows directly from
`redemptionRows`, never through `cancellationRow`), confirmed by grep
before deleting each one.

**Header ribbon: navy → black, logo enlarged to blend with it**: the
`<header>` background changed from `bg-navy` to a new `bg-ribbon`
(`tailwind.config.js`, `#231f20`) — not pure `#000000`. The exact hex was
pixel-sampled directly from `pvr-inox-logo.jpeg`'s own background (PowerShell
`System.Drawing.Bitmap.GetPixel()` on 5 corner/edge points, all agreeing at
`#231F20`/`#231F20`/`#251F22`-ish, i.e. the same dark warm-charcoal, not
guessed) — since the logo is a JPEG with no alpha channel, the only way to
make its rectangular background disappear into the ribbon is to match the
ribbon's color to the image's baked-in background exactly, not to eyeball
"black." Logo size increased `h-8` → `h-14 md:h-16` (was previously
capped well below the header's available height) and its `rounded-sm`
clipping/border removed, since there's no longer a visible seam to round
off. Header vertical padding trimmed `py-3` → `py-2` so the taller logo
fits the ribbon snugly rather than inflating the whole bar.

**Verified**: screenshotted the header at desktop (1440px) and mobile
(390px) — logo reads as one continuous black surface with the ribbon at
both sizes, nav tabs and the "Gift Card / Analytics" label unaffected,
mobile wrap behavior unchanged. Overview KPI grid confirmed to render
exactly 3 cards via Playwright (`grid > div` count = 3), all figures
unchanged from every prior verification in this file (₹6,127.62L /
₹4,993.79L / ₹2,830.05L). Zero console errors; clean production build
(723.43 kB JS, 207.66 kB gzipped).

## 2026-08-05 — Data refresh: 28 months, 3rd FY, "Prebuy" exclusion; FY→Month cross-filter

**Data swap**: `public/data/activationCube.json`/`redemptionCube.json`/
`heroProducts.json` replaced (the request said `src/data/` but, same as
every prior refresh in this file, the app only ever reads from
`public/data/` at runtime — confirmed the new files were already there,
`src/data/` is and stays empty). Date range expanded from 24 months (Apr
2024–Mar 2026) to 28 (Apr 2024–Jul 2026); "PVR INOX Prebuy egift card" is
now excluded dataset-wide as a retroactive rule (it's a reload/cash-card
product, not a real gift card) — confirmed via direct computation on the
new files before touching any code: 7,419 activation rows / 103,455
redemption rows, totals ₹8,266.57L activation / ₹6,695.32L redemption,
matching the request's target exactly. No code references the old
"Prebuy" product name or the old baseline figures (₹6,127.62L/₹4,993.79L)
anywhere in `src/` — grepped to confirm before starting, so nothing needed
manual updating there; those old figures only live in this file's own
historical entries above, which stay as a record of what was true at the
time.

**`fyOf()` generalized** (`lib/constants.js`): was a hardcoded single-split
function (`yearMonth >= '2025-04' ? 'FY2025-26' : 'FY2024-25'`) that could
only ever know about 2 fiscal years. Replaced with real Apr–Mar arithmetic
(`startYear = month >= 4 ? year : year - 1`, then formats
`FY{startYear}-{startYear+1}`), so a 3rd year (or Nth, in a future refresh)
falls out for free from more months existing in the cube — no code change
needed next time. `FY_SPLIT` constant removed, now unused.

**FY → Month cross-filter narrowing** (new, `lib/FilterContext.jsx`): the
request asked for the Month dropdown to only ever offer months belonging
to whichever FY(s) are currently selected. Two coordinated changes:
  - `options.months` gained a dependency on `filters.fy` (the `options`
    `useMemo`'s deps went from `[data]` to `[data, filters.fy]`) — when FY
    is unrestricted (`[]`), `months` is the full 28-month list as before;
    when specific FY(s) are selected, `months` filters down to just the
    months whose `fyOf()` matches; when FY is explicitly the
    `NONE_SELECTED` sentinel (every FY unticked), `months` is `[]` since no
    row could match anyway. `options.fys` itself stays derived from the
    full, unnarrowed month universe (it's the thing driving the narrowing,
    so it can't depend on itself).
  - `setFilter` gained FY-specific pruning logic: changing `fy` while
    `month` holds an *explicit* selection (not `[]`/unrestricted, not
    `NONE_SELECTED`) re-filters that selection down to only the months
    still valid under the new FY. This matters because `fy` and `month`
    combine with AND (`passesCommon`) — without pruning, picking specific
    months under one FY and then switching FY would leave stale out-of-FY
    months selected, and that combination can match zero rows, silently
    zeroing every KPI on the page. If the intersection is empty (none of
    the previously-selected months survive), `month` resets to `[]`
    (unrestricted within the new FY) rather than the more surprising
    "explicitly nothing" — the friendlier default when a user's month
    picks don't carry over. `[]` and `NONE_SELECTED` month states need no
    pruning at all: `[]` already means "whatever the new FY narrowing
    allows," and `NONE_SELECTED` already means "nothing," regardless of FY.

**Verified**: hand-computed the two headline totals and the 28/3 month/FY
counts against the raw cubes before touching the UI (see above), then
confirmed live: FY dropdown shows exactly `FY2024-25, FY2025-26,
FY2026-27`; Month dropdown shows exactly 28 options unrestricted (Apr 24 →
Jul 26); selecting FY2026-27 narrows the Month dropdown to exactly `Apr
26, May 26, Jun 26, Jul 26` and its own KPI (₹2,464.50L / ₹1,943.82L)
matches a direct filter on the raw cube; selecting FY2026-27 + Month=Jul
26 (₹1,149.77L / ₹831.41L) then switching FY to FY2024-25 correctly
pruned the stale "Jul 26" pick and landed on the real, non-zero FY2024-25
total (₹2,321.80L — notably an exact match to this same figure recorded
in the 2026-08-03 Year-on-Year entry above, a useful cross-check that
FY2024-25's own total was untouched by this refresh), with the Month
dropdown correctly showing FY2024-25's 12 months afterward. Month
"Select All" re-verified under an active FY narrowing (FY2025-26):
toggled off then back on, landed exactly back on the FY2025-26-only
baseline (₹3,480.27L / ₹2,885.23L), confirming Select All operates over
the narrowed list, not the full 28-month universe. Zero console errors
throughout; clean production build (723.83 kB JS, 207.80 kB gzipped).

## 2026-08-05 — "Region Contribution" replaced with corrected "Activation by Region" + new "Redemption by Region"

**The bug**: Overview.jsx's "Region Contribution" chart grouped *all*
activation rows by raw `Region_Clean`, regardless of `ActivationModeFinal`
— silently mixing Corporate/Aggregator/Online rows into the same 5
regional bars as real cinema (Physical) activations. Checked against the
data before fixing: Aggregator rows do carry a real `Region_Clean` some of
the time (NORTH/SOUTH/WEST/EAST/NO_SITE all appear), Corporate and Online
rows are 100% tagged NORTH — so the old chart's regional bars weren't
"activation in that region," they were "activation in that region *plus*
however much Corporate/Aggregator/Online happened to be tagged with that
region," which isn't a meaningful question. Every other "by Region" chart
in the app was already immune to this — `Activation.jsx`'s own regional
chart is already scoped to `ActivationModeFinal === 'Physical'` only, and
every redemption-side regional chart (`RedemptionBoxOffice.jsx`,
`RedemptionFnb.jsx`, `CancelRedeem.jsx`, Overview's own "Box Office + F&B
by Region" mini-chart) is Head-scoped to Box Office/F&B, which are already
100% `RedemptionModeFinal='Physical'` — confirmed via a repo-wide grep for
`Region_Clean` before touching anything, so this was the *one* place with
the actual bug, not a pattern needing a multi-file sweep.

**The fix — two charts replace the one**, side by side in a `md:grid-cols-2`
row (previously full-width):
  - **"Activation by Region"**: 5 bars from `ActivationModeFinal='Physical'`
    rows only, split by `Region_Clean` (North/South/East/West/Central) —
    plus 3 more bars that are each a single combined total, never split by
    region: **Aggregators** (`ActivationModeFinal='Aggregator'`, pulling
    every aggregator row out of the regional bars regardless of whatever
    `Region_Clean` it happens to carry), **Corporate**
    (`ActivationModeFinal='Corporate'`), **Online**
    (`ActivationModeFinal='Online'`). Together these 4 raw
    `ActivationModeFinal` values are a complete, non-overlapping partition
    of the activation cube (confirmed: no 5th value exists), so the 8 bars
    always sum exactly to Total Activation by construction — verified
    directly against the cube (₹8,266.57L both ways) and live in the app.
  - **"Redemption by Region"** (new): only 2 real `RedemptionModeFinal`
    values exist (see `lib/redemptionMode.js`), so this is simpler — 5
    "Cinema" bars from `RedemptionModeFinal='Physical'` rows split by
    region, plus one combined **Corporate** bar
    (`RedemptionModeFinal='Online'`, all 100% tagged `Region_Clean='NORTH'`
    in the current data — confirmed directly, so region-splitting it would
    misattribute real redemptions to NORTH; deliberately left as one bar).
    Labeled "Corporate" not "Online," matching the redemption-side
    terminology already established in `lib/redemptionMode.js`. No
    Aggregator bucket — aggregator-activated cards have no redemption
    channel of their own (established in the 2026-08-04 Redemption Mode
    correction). Sum of all bars = Total Redemption (net), verified
    (₹6,695.32L both ways).
  - **Data-reality finding, handled rather than silently dropped**: a small
    number of `RedemptionModeFinal='Physical'` rows carry
    `Region_Clean='NO_SITE'` (~₹10.94L, real data — confirmed directly,
    not an artifact). Every other regional chart in the app renders
    `NO_SITE` as "Online" via the established `regionLabel()` rename, but
    doing that *here* would sit a bar labeled "Online" directly next to
    this chart's own "Corporate" bar (which represents the actual online
    redemption channel) — a genuinely confusing collision this specific
    chart surfaces that no prior chart did (none of them had a competing
    "Corporate"/"Online" bar in the same view). Solved with a chart-local
    `redemptionRegionLabel()` override (renders `NO_SITE` as "Unassigned"
    just for this chart's ticks/tooltip) rather than changing the shared
    `regionLabel()`/`REGION_LABELS` every other chart in the app still
    correctly relies on. Activation's Physical rows never carry `NO_SITE`
    at all (confirmed — zero rows), so no equivalent bar/relabel was needed
    on the activation side; the 5 bars there are always exactly the 5 named
    regions.
  - **Bar colors**: `REGION_COLORS[key] || categoricalColor(i)` — for the
    named regions this resolves to the exact same hexes `REGION_COLORS`
    already assigns (its 5 entries were built from the same `CATEGORICAL`
    array in the same order, confirmed by inspection), and for the extra
    non-regional bars (Aggregators/Corporate/Online, Corporate on the
    redemption side) it falls through to the already-validated
    `categoricalColor()` cycle from the 2026-08-05 color-differentiation
    pass — reusing that mechanism rather than inventing a new palette,
    since the adjacent-pair-safe guarantee it was built for is exactly
    what's needed here (8 bars > 5 validated hues).
  - **Not changed**: `Activation.jsx`'s "Cinema Activation — Regional
    Split" stays exactly as it is — it was never mixing modes (already
    `Physical`-only), and its own title already scopes it to cinema, so it
    doesn't need the extra 3 channel bars this Overview chart gained; those
    would be out of scope for a chart specifically about the cinema-regional
    question. `Trends.jsx` has no regional breakdown at all (confirmed via
    grep) — nothing there to check.

**Verified**: hand-computed both sum invariants against the raw cubes
first (8 activation buckets → ₹8,266.57L exactly; 6 redemption buckets →
₹6,695.32L exactly), then confirmed the live app renders the identical
per-bar figures. Re-verified under an active `Region=NORTH` filter — the
5 named-region bars correctly collapse to just NORTH (or disappear via the
existing zero-hiding convention), while Aggregators/Corporate/Online only
narrow to whatever of *their own* rows happen to also be tagged NORTH
(Corporate and Online stayed at their full amounts, since those cubes are
100% NORTH-tagged already; Aggregators dropped from ₹4,254.87L to
₹271L) — and the two charts' bars still summed exactly to the page's
Total Activation (₹3,339.64L) and Total Redemption (₹5,326.07L) under that
filter, confirming the invariant holds generally, not just unfiltered.
Zero console errors; clean production build (725.59 kB JS, 208.06 kB
gzipped).

## 2026-08-05 — "Redemption by Region" fixes: stale "Corporate" label, NO_SITE relabel, narrow-width overlap

**Diagnosis first, before any fix**: the report described the symptom as a
Recharts key/collapse bug ("categories rendering as one smashed string,
same class of bug as a non-unique or missing key"). Checked this directly
against the live DOM before touching code — inspected the actual SVG tick
`<text>`/`<tspan>` node count and contents via Playwright (not just a
screenshot), including through simulated window resizes (the classic
trigger for `ResponsiveContainer`-inside-CSS-grid staleness bugs, since
this chart sits in a `md:grid-cols-2` grid): every check came back with
exactly 7 distinct tick groups and 7 distinct text contents
(`NORTH/SOUTH/EAST/WEST/CENTRAL/Unassigned/Corporate` at the time), at
every width tested and across resizes. **No data-wiring or React-key bug
exists** — `redemptionByRegion` was always a correctly-shaped array of 7
distinct objects, `<Cell key={r.key}>` keys were always unique. What *does*
reproduce, confirmed with screenshots at 768–850px (the exact width range
this chart's own column lands in on a `md:grid-cols-2` row at common
laptop widths): the angled X-axis tick labels visually crowd into each
other — not literally one fused string, but close enough at real-world
widths/fonts to read that way. Root cause: `interval={0}` forces all 7
ticks to render regardless of available space, at only `angle={-20}`,
which doesn't give long words like "Unassigned"/"Corporate"/"Aggregators"
enough horizontal clearance once the column narrows.

**Fix**: steepened both `activationByRegion` and `redemptionByRegion`'s
XAxis to `angle={-45}` (from `-20`) with `height={60}` (from `44`) and
`fontSize={9}` (from `10`) — a steeper angle projects less of each label's
length onto the horizontal axis for the same font size, directly widening
the clearance between adjacent ticks. Verified at 768/800/850px (previously-
broken widths) and 1440px: all 7 labels stay legibly separate at every
width checked. Applied to *both* region charts for consistency, even
though only the redemption one was reported — `Activation by Region`'s own
longest label ("Aggregators") is equally exposed to the same crowding at
the same breakpoints.

**Real bug #2, found while investigating**: the redemption-side "Online"
bucket was hand-labeled `'Corporate'` — stale terminology reintroduced by
mistake. Earlier the same day, the "Final consolidated Source-filter
model" phase renamed the redemption-side Online bucket from `'Corporate'`
back to `'Online'` everywhere in the app (`lib/redemptionMode.js
#REDEMPTION_MODES`). This "Redemption by Region" chart was written *after*
that rename but with a hand-rolled `r.RedemptionModeFinal === 'Online'`
predicate instead of reusing `redemptionModeOf()`/`REDEMPTION_MODES`, so it
silently fell back to the pre-rename label instead of inheriting the
current one. Fixed by routing both the Cinema-region predicate and the
Online bucket through `redemptionModeOf()` directly (`lib/redemptionMode.js`)
instead of a second hand-written string comparison — this is specifically
to prevent the same class of drift a third time, since the bucket's label
now can't diverge from the canonical one without both changing together.
Also fixed a stale "Corporate/Cinema" doc-comment in `redemptionMode.js`
itself (`groupByRedemptionMode`'s comment still said "Corporate" from
before that same-day rename).

**NO_SITE investigation**: ~1,572 `RedemptionModeFinal='Physical'` rows
(~₹10.94L) carry `Region_Clean='NO_SITE'`. This repo has no access to raw
per-transaction or outlet-level data — the app only ever consumes the
pre-aggregated JSON cubes in `public/data/`, confirmed by checking the
redemption cube's own field list (`YearMonth, Region_Clean,
RedemptionModeFinal, Head, SourceFlag, Weekday, ActivationMode, Format,
Category, Denom, CardType, RedemptionAmount, RedemptionCount, Uptake` — no
`Outlet` field), so an outlet name can't be read directly the way the
request's phrasing implied it could be checked "against the raw data
pipeline." What *was* checkable: these are real F&B (824 rows) and Box
Office (613 rows) redemptions, not placeholder/junk rows, and their
`Format` values on the Box Office side are a visibly different, boutique/
premium vocabulary (Platinum, Sofa Slider, Lounger, Picture Perfect,
P. Superior, Cla Superior) than the standard regional Box Office tiers
(Prime, Classic, Recliner, Club, Executive, Prime Plus, Royal) — consistent
with, not contradicting, a distinct premium-format cinema whose outlet
never received a region mapping. Confirmed as PVR Director's Cut per
direct confirmation from the request (this codebase cannot independently
derive an outlet name from the data it has access to — flagging that limit
explicitly rather than presenting the format-vocabulary pattern as
independent proof). Relabeled chart-locally via
`redemptionRegionLabel()`: `NO_SITE` → `"Director's Cut"` (was
`"Unassigned"`) — same local-override mechanism as before, still not
touching the shared `regionLabel()`/`REGION_LABELS` convention every other
chart in the app relies on, since the activation-side `NO_SITE` meaning
("Online," aggregator-fulfilled cards with no physical site) is a
different underlying cause on a different cube and must keep its own
separate label, per the request's explicit instruction not to unify them.
**Not done, out of scope for this codebase**: adding an outlet→region
mapping rule to "the cleanup pipeline" — no such pipeline exists in this
repository; it would live in whatever external process generates the
`public/data/*.json` cubes, which this React app only ever consumes. This
is a real action item, just not one this codebase can implement — flagging
it here so it isn't lost.

**Verified**: hand-computed the 7-bucket sum against the raw cube first
(₹6,695.32L, matching Total Redemption net exactly, unchanged by this fix
since only labels/predicate-expression changed, not the underlying
amounts), then confirmed live: X-axis reads exactly `NORTH, SOUTH, EAST,
WEST, CENTRAL, Director's Cut, Online` (7 distinct tick texts, read
directly from the SVG DOM, not just a screenshot), no "Corporate" or
"Unassigned" anywhere; screenshots at 768/800/850/1440px show all 7 labels
legibly separated at every width. Zero console errors; clean production
build (725.58 kB JS, 208.08 kB gzipped).

## 2026-08-05 — Uptake KPI bifurcation (Ticket vs F&B), on the same card

**`Kpi.jsx` gained an optional `breakdown` prop**: an array of `{label,
value}` rendered as a stacked sub-total column on the right, behind a thin
`border-l`, instead of a second KPI card — the main total stays exactly as
prominent as before (`text-3xl font-extrabold`), the breakdown values are
deliberately smaller/lighter (`text-sm font-semibold`) with muted uppercase
labels, so the hierarchy reads big-total-then-small-breakdown at a glance.
Optional and additive — every other `<Kpi>` call site across all 5 pages
renders identically since `breakdown` is simply `undefined` for them
(confirmed via screenshot: Revenue/Activation Amount and Total Redemption
(net), right next to the changed Uptake card, are pixel-identical to every
prior verification in this file).

**Ticket = Head='Box Office' + Head='Online'; F&B = Head='F&B'** — matches
the same bucketing `ticketFnbBucket()` (`FilterContext.jsx`) already uses
for the Ticket/F&B *filter* elsewhere in the app, not a new definition.

**Cancel Redeem netting, reusing the existing proxy rather than inventing a
second one**: extracted the Region+Month "which of Box Office/F&B had the
larger gross RedemptionAmount" winner-decision out of `positiveHeads`
(built for the redemption-heads % fix earlier the same day) into a shared
`physicalCancelWinnerMap()` function, so both call sites can't drift apart
on the tie-breaking rule the way two independently-written copies could.
`positiveHeads` itself is refactored to consume the shared map instead of
inlining the map-building — verified behavior-preserving (Online ₹4,239.09L
/ Box Office ₹1,023.50L / F&B ₹1,432.74L, byte-identical to every prior
verification of these figures in this file). The new `uptakeTicketFnb`
uses the same map: Online-mode Cancel Redeem rows map 1:1 to Ticket (same
reasoning as `positiveHeads`'s Online head), Physical-mode Cancel Redeem
rows split by whichever of Box Office/F&B "won" that Region+Month, summing
`Uptake` instead of `RedemptionAmount` through the same winner lookup.

**Data-reality check, done before writing any UI code**: `Uptake` is
exactly `0` on every `Head='Online'` and `Head='Cancellation'` row in the
current cube (checked directly, not assumed) — so today the netting logic
evaluates to a no-op and Ticket/F&B Uptake reduce to plain Box Office/F&B
sums. Implemented the real netting anyway, not a hardcoded 2-way split,
since the request asked for it explicitly and a future data refresh that
populates Uptake on those heads (the same way `RedemptionAmount` already
is) needs no code change to stay correct.

**Verified**: hand-computed against the raw cube first — Box Office Uptake
₹839.33L + F&B Uptake ₹2,547.54L = ₹3,386.87L, matching Total Uptake
exactly (both sides equal since Online/Cancellation contribute zero right
now) — then confirmed live in the app, unfiltered and under an active
Region=NORTH filter (₹407.75L + ₹1,368.02L = ₹1,775.77L, matching that
filtered Uptake total exactly too, confirming the invariant holds
generally). Zero console errors; clean production build (726.77 kB JS,
208.35 kB gzipped).

## 2026-08-05 — New "Total Transaction Value" KPI (Redemption + Uptake)

Fourth card on Overview's main KPI ribbon, placed last (right after Uptake,
its own two inputs) — grid widened `grid-cols-1 sm:grid-cols-3` →
`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` to fit it without cramping the
existing 3 at any breakpoint (confirmed via screenshot at both 1440px and
390px — clean 4-across on desktop, clean single-column stack on mobile).

`totalTransactionValue = totalRedemption + totalUptake` — both already
computed sums, no new data source. Given deltas but no "% of..." sub-line,
same reasoning already applied to Revenue/Activation Amount: it's a
combined top-level total, not a sub-component of anything else on this
ribbon, so there's no natural parent to express it as a % of.
`TransactionValue` isn't a raw field on redemption rows, so the MoM/QoQ/YoY
deltas needed a synthesized per-row field
(`RedemptionAmount + Uptake`) on the Month-unrestricted pool, same pattern
already used for Cancel Redeem's `AbsRedemptionAmount` — `computeComparisons`
only ever operates on a named row field, so any derived KPI's deltas need
that field materialized first, not computed post-hoc on the two component
deltas separately (which wouldn't be mathematically equivalent anyway).
Accent color `blue` — the one KPI-card accent slot (`gold`/`teal`/`coral`/
`navy`/`blue`) not already claimed by another card on this ribbon.

**Verified**: hand-summed the two component KPIs directly from the
already-displayed figures rather than a separate raw-cube computation
(both are themselves already-verified sums) — unfiltered ₹6,695.32L +
₹3,386.87L = ₹10,082.19L, and under an FY2025-26 filter ₹2,885.23L +
₹2,377.42L = ₹5,262.65L — both matched the new card's value to the rupee,
confirming the filter-respecting behavior holds generally, not just
unfiltered. Zero console errors; clean production build (727.14 kB JS,
208.44 kB gzipped).

## 2026-08-05 — Fix: Uptake KPI card taller than its row siblings

The Ticket/F&B breakdown added earlier the same day was a flex sibling of
the main number column (`flex items-stretch`), which meant it competed
with "₹3,386.87 L" for the card's horizontal space — at `text-3xl` that
string didn't fit in what was left, wrapped right before the "L", and the
extra line made the Uptake card taller than the other 3 in the ribbon.

**Fix, layout-only — no calculation logic touched**: `Kpi.jsx`'s
`breakdown` block is now `absolute top-3 right-4` instead of a flex
sibling, so it no longer takes width away from the main number; the main
column reserves clearance from it via `pr-20` rather than the two sharing
a `justify-between` row. Its divider is a plain `border-l` on the
breakdown block itself, so it's only ever as tall as the breakdown's own
2 stacked rows — never the full card. Added a `whitespace-nowrap` on the
value line unconditionally (harmless for every other card, which already
fit) and a new optional `valueClassName` prop (default `text-3xl`) so a
specific KPI can take a smaller value size without touching the shared
default; Overview.jsx's Uptake card passes `text-2xl`.

**Verified**: all 4 ribbon cards measured at an identical 162.5px height
via Playwright bounding boxes (not just eyeballed), "₹3,386.87 L" confirmed
on a single line, Ticket/F&B sitting compactly top-right near the "UPTAKE"
label at both 1440px and 390px with no collision/overflow at either width.
Zero console errors; clean production build (727.27 kB JS, 208.47 kB
gzipped).

## 2026-08-06 — Redemption flow diagram: added Cinema layer, removed 2 charts below it

**Prerequisite that hadn't landed yet**: the shared "net Cinema redemption"
utility proposed in the prior session's data-integrity audit (same-region-
different-numbers bug between "Box Office + F&B by Region" and "Redemption
by Region") was only ever reported/diagnosed, not implemented — that
conversation moved on to other work before getting a go-ahead. Since this
task explicitly depends on it ("using the same shared utility from the
earlier region-consistency fix"), built it now as `lib/aggregate.js
#isNetCinemaRedemptionRow()` / `#netCinemaRedemption()`: Head in ('Box
Office', 'F&B'), plus `Head='Cancellation' AND RedemptionModeFinal
='Physical'` netted in directly. A `netCinemaRedemptionByRegion()` variant
was added alongside it for a future by-region use, but nothing was wired
to it yet — migrating `redemptionByRegion`'s existing (already-equivalent)
predicate to call it explicitly is still a separate, not-yet-approved
change, left untouched here per this task's own "layout/structure only,
don't change calculation logic" constraint.

**Baseline captured before touching anything** (unfiltered): Online
₹4,239.09L / 9,91,767 / 63.3%, Box Office ₹1,023.50L / 2,14,829 / 15.3%,
F&B ₹1,432.74L / 4,51,731 / 21.4%, Total Redemption (net) ₹6,695.32L /
19,80,252 — all read directly off the live page, not assumed.

**Proof the new Cinema node can't diverge from Box Office + F&B**: worked
out algebraically before writing code — `positiveHeads`' Box Office and
F&B are each `gross + (their own share of Physical-mode cancellations,
per the Region+Month winner-map proxy)`. Summing the two, the winner-map's
Box-Office-vs-F&B split cancels out entirely (every cancellation lands on
exactly one side either way), leaving `grossBoxOffice + grossF&B + every
Physical-mode cancellation` — which is exactly what `netCinemaRedemption()`
computes directly, with no proportional attribution needed at all (merging
Box Office+F&B removes the very ambiguity the winner-map exists to
resolve). Confirmed against the raw cube before implementing: ₹2,456.23L
/ 7,65,318, and independently `positiveHeads['Box Office'] + positiveHeads
['F&B']` = 1,023.50 + 1,432.74 = ₹2,456.24L (1-paisa rounding) — same
number two different ways, as proven.

**Diagram restructured** (`Overview.jsx`, redemption column only): Total
Redemption (net) → (Online, **Cinema**) → Cinema → (Box Office, F&B).
Online/Box Office/F&B's own `<FlowBox>` props are byte-identical to before
— same `positiveHeads` array, same pct formula (`amount / totalRedemption`,
unchanged) — only Cinema is new, and it's a plain nested `<FlowBranch>`
inside one of the outer `<FlowBranch>`'s children, using the exact same
`FlowBox`/`FlowBranch` components as every other node (no new component,
so "matching existing visual style" was automatic, not a separate
styling pass). New `HEAD_COLORS.Cinema` (plum) added in `theme.js` — not a
real Head value, just this diagram's rollup-node color, picked specifically
because it's the one validated categorical hue not already claimed by
Online(blue)/Box Office(gold)/F&B(teal) in this same diagram, so a parent
node can never render the same color as one of its own children.

**Removed**: the "Head Split (excl. Cancel Redeem)" donut and "Box Office +
F&B by Region" bar chart that sat below the diagram — along with the now-
fully-unused `cinemaRegionSplit` computation and the `Pie`/`PieChart`
imports (confirmed via grep they had no other call site first). No
replacement content added in that space — the 3-layer diagram is simply
taller now (structurally symmetric with the Activation side, which was
always 3 layers deep: Total Activation → 3 sources → Digital/Physical),
so it naturally occupies the freed vertical area; the gap to the next card
below measured a plain 24px, the same `gap-6` used between every other
card on this page, not a leftover hole.

**Verified**: Online/Box Office/F&B read back byte-for-byte identical to
the pre-change baseline above (screenshotted before and after). New Cinema
node: ₹2,456.23L / 7,65,318 / 36.7% of total — matches the hand-computed
figure exactly. Online (63.3%) + Cinema (36.7%) = 100.0%, and
₹4,239.09L + ₹2,456.23L = ₹6,695.32L = Total Redemption (net), unchanged.
Both removed charts confirmed gone (0 DOM matches for their titles).
Checked at 1440px and 390px — mobile uses the same pre-existing horizontal-
scroll container this diagram already had (its `overflow-x-auto`/`min-w`
wrapper wasn't touched), not a new regression. Zero console errors; clean
production build, and *smaller* than before (698.14 kB JS / 202.88 kB
gzipped, down from 727.27 kB / 208.47 kB — net code removed, not added).

## 2026-08-06 — Full rewire: Box Office/F&B redemption now net (not gross) dashboard-wide

**The bug**: Overview.jsx's flow diagram showed Box Office ₹1,023.50L / F&B
₹1,432.74L (net of their own Cancel Redeem reversals, via the Region+Month
winner-map proxy — see the 2026-08-05 "Process Flow's redemption heads
were gross, not net" entry). `RedemptionBoxOffice.jsx`/`RedemptionFnb.jsx`'s
own headline "Box Office Redemption"/"F&B Redemption" KPIs showed
₹1,119.23L / ₹1,748.29L instead — plain gross `Head === 'Box Office'`/
`'F&B'` sums with zero cancellation involvement. Same nominal metric, two
different numbers on two pages, because the 2026-08-05 netting fix only
ever touched Overview.jsx — the Region+Month winner-map logic
(`physicalCancelWinnerMap`) was a *local* function on that page, so
`RedemptionBoxOffice.jsx`/`RedemptionFnb.jsx` never had access to it and
kept computing gross sums instead.

**Audited every page before touching anything** (per the request's own
instruction): `Activation.jsx` is activation-side only, never reads
`RedemptionAmount`/`Head` — not affected. `Trends.jsx`'s totals are whole-
cube sums with no Head split, so they were already correct (a raw sum over
every redemption row, including the negative Cancellation rows, is net by
construction — there's nothing to attribute). `CancelRedeem.jsx`'s own
"Cancel Redeem" KPI is the cancellation total itself, a different question
entirely, not affected. So the fix was scoped to exactly 3 files:
`lib/aggregate.js` (new shared utilities), `RedemptionBoxOffice.jsx`,
`RedemptionFnb.jsx`, plus migrating `Overview.jsx` off its now-duplicate
local copy.

**Shared utilities added to `lib/aggregate.js`** (single source of truth,
so this can't happen a third time):
  - `physicalCancelWinnerMap(redemptionRows)` — the Region+Month "Box
    Office or F&B, whichever had the larger gross RedemptionAmount that
    Region+Month" proxy, moved here verbatim from Overview.jsx.
  - `netHeadRows(redemptionRows, headKey, winnerMap)` — the real
    architectural fix. Returns *row-level* data (the head's own rows plus
    whichever Cancel Redeem rows are attributed to it), not a pre-summed
    total — so callers can run `sumBy`/`computeComparisons`/`groupSum` on
    it exactly like any other row pool. This is what let every downstream
    chart on the Box Office/F&B pages (by Region, by Format, by Weekday,
    Digital Card split, by Source) switch to net figures for free: a
    cancellation row's own `Region_Clean`/`Weekday`/`CardType` ride along
    unchanged inside the returned pool, so e.g. netting into a CardType
    split needed no new proxy — only Head-vs-Head attribution needs the
    winner map, since that's the one thing a cancellation row's own fields
    don't resolve on their own.
  - `netRedemptionHeads(redemptionRows)` — flat Online/Box Office/F&B
    totals built from `netHeadRows`, for Overview's flow diagram nodes.

**`Overview.jsx`**: local `physicalCancelWinnerMap` function deleted;
`positiveHeads` now calls the shared `netRedemptionHeads()` directly (same
algorithm, now single-sourced). `uptakeTicketFnb` recomposed from
`netHeadRows('Box Office')` + `netHeadRows('Online')` (Ticket) and
`netHeadRows('F&B')` (F&B), replacing its own hand-rolled winner-map loop
— same result, less duplicated logic.

**`RedemptionBoxOffice.jsx` / `RedemptionFnb.jsx`**: the headline KPI
(value, count, deltas), "Digital Card Redemption" (both its value and its
deltas), and every downstream chart (by Region, by Format/Category, by
Weekday, and Box Office's "by Source" — now built from net Box Office +
net Online combined instead of gross) all switched from the raw
`Head === 'Box Office'`/`'F&B'` row pool to `netHeadRows(...)`. The winner
map itself is computed once from `redemptionRowsAllMonths` (the broadest
pool available under the page's active filters) and reused for both the
"current" and "AllMonths" (MoM/QoQ/YoY comparison) pools, so the winner
decision can't disagree between the headline number and its own delta
badges. Deliberately **left unchanged**: "Redemption Heads Breakdown" (its
whole documented purpose is showing gross-per-head *plus* a visible
negative Cancellation bar, netting made visible rather than folded in —
changing it to net-per-head would make that bar redundant/zero, defeating
the chart's own point) and the page-level `hasData` checks (still gauge
real Head activity via the plain gross row filter, not the net pool, which
is the correct semantic — "does this page have real data" shouldn't
depend on which way a cancellation got attributed).

**Caught during self-review, before shipping**: an early edit changed
`byWeekday`'s computation body to read from the new `netBoxOfficeRows`
pool but left its `useMemo` dependency array pointing at the old
`boxOfficeRows` — a real bug (stale memoization) that would have shipped
if not re-read and checked line-by-line after editing.

**Verified**: hand-computed net Box Office (₹1,023.50L / 2,35,848) and net
F&B (₹1,432.74L / 5,29,470) against the raw cube first, independently of
the app. Confirmed live: Overview's flow diagram and both dedicated pages'
headline KPIs now read byte-for-byte identical, unfiltered *and* under an
active FY2025-26 filter (₹425.93L/96,578 and ₹814.69L/3,30,179, matching
across all three views). Screenshotted both full pages — every downstream
chart (by Region, by Format, by Category, by Source) visibly sums to the
new net headline total. Zero console errors; clean production build
(697.67 kB JS, 202.83 kB gzipped — smaller than before, net code reduction
from removing the two now-dead local Overview.jsx functions).

## 2026-08-10 — Data refresh (new Denom bucketing + ActivationCohort) + new "Card Journey" page

**Data swap**: `activationCube.json` (9,749 rows) / `redemptionCube.json`
(162,374 rows) replaced with versions carrying regrouped `Denom` values
(now includes explicit range/exact splits like `0-299`, `300`, `301-499`
rather than the prior single `₹300` bucket) and a new `ActivationCohort`
field on the redemption cube only. Two new files also added,
`dailyActivationCube.json` (6,664 rows) / `dailyRedemptionCube.json`
(12,842 rows), each with a real `DateStr` field ("2024-04-01") spanning the
same Apr 2024–Jul 2026 window as the main cubes — lighter/day-level cubes,
not yet wired into `FilterContext.jsx` or read by any page, per the
request's own "see [a later prompt] for their use." As with every prior
data refresh in this file, the request said `src/data/` but the files were
already placed in (and the app only ever reads from) `public/data/` —
confirmed, no code change needed for the swap itself. `Denom`'s new
bucketing wasn't specifically re-validated against the existing
Denomination filter/chart in this pass (out of scope for this request) —
worth a follow-up check if the exact bucket set matters for a future
change.

**`ActivationCohort` values** (confirmed directly against the data, not
assumed): `Same month`, `1-3 months ago`, `4-6 months ago`, `7-9 months
ago`, `10-12 months ago`, `12+ months ago`, `Pre-existing (activated before
Apr 2024)`, `N/A` — the last is exclusively cancellation rows (a
cancellation reverses a redemption, not an activation, so "how long ago
was this activated" doesn't apply). New `lib/constants.js#COHORT_ORDER` /
`#cohortLabel()` (renders `'N/A'` as "Cancel Redeem" for display, same
raw-key-stays-raw / label-is-a-view-concern pattern as `regionLabel()`).

**New `/card-journey` page** (`pages/CardJourney.jsx`): purpose is
separating two questions that sound similar but aren't — "cards activated
in the selected period" vs. "redemptions happening in the selected period,
regardless of when those specific cards were originally activated." Two
KPI cards side by side (Activated Cards = `sum(ActivationAmount)` over
`activationRows`, identical computation to every other page's headline
Activation KPI; Redeemed Cards = `sum(RedemptionAmount)` over
`redemptionRows`), an explicit callout paragraph between them stating
they're different questions (per the request — not left to be inferred
from two similarly-styled cards sitting next to each other), then a bar
chart grouping `redemptionRows` by `ActivationCohort` (`groupSum` +
`orderBy(COHORT_ORDER)`). Colored via `categoricalColor()` cycling for the
7 real cohorts plus `COLORS.warning` (reserved coral, the established
"cancellations" status color) for the `N/A`/"Cancel Redeem" bucket, which
renders as a negative bar — same "show cancellations as their own visible
negative bar rather than hiding them" convention as the Redemption Heads
Breakdown chart. X-axis labels angled `-45°`/`height 70` from the start
(long cohort strings, same crowding fix already applied to the "by Region"
charts after the 2026-08-05 label-overlap bug) rather than waiting to
discover the same problem again. Respects every existing global filter
automatically, no new filter-plumbing — both `activationRows` and
`redemptionRows` already come from `useFilters()`, already filtered.

**Verified the request's own sum invariant directly**: unfiltered, the 8
cohort bars (₹5,578L + ₹1,539L + ₹362L + ₹183L + ₹144L + ₹8L + ₹344L −
₹1,463L) sum to ₹6,695L, matching the Redeemed Cards KPI (₹6,695.32L,
rounding) exactly — true by construction since `groupSum` drops no rows
and every redemption row carries exactly one `ActivationCohort` value.
Re-verified under an active Region=NORTH filter (₹4,480L + ₹1,181L +
₹297L + ₹149L + ₹119L + ₹6L + ₹303L − ₹1,209L = ₹5,326L, matching that
filtered Redeemed Cards KPI exactly), confirming the invariant holds
generally, not just unfiltered. Zero console errors; clean production
build (700.83 kB JS, 203.64 kB gzipped).

## 2026-08-10 — Day filter (backed by the new daily cubes, Overview-only)

New 10th global filter, "Day" (1-31), positioned right after Month in
`FilterBar.jsx`. Deliberately narrow in scope — see below — rather than a
general row-level filter like every other control on the bar.

**Why it's structurally different from every other filter**: every existing
filter narrows the two *main* (monthly-granularity) cubes. The Day filter
instead reads from the two new lighter `dailyActivationCube.json` /
`dailyRedemptionCube.json` files (`DateStr`/`Region_Clean`/
`ActivationModeFinal`|`RedemptionModeFinal`|`Head` only — no CardType,
Denom, ActivationCohort, Format, or Category), because the main cubes have
no day-level field at all, only month-level `YearMonth`. So "select a day"
can't mean "narrow `activationRows`/`redemptionRows`" the way every other
filter works — there's a second, parallel row-filtering path
(`FilterContext.jsx`'s `dailyMonthActivationRows`/`dailyMonthRedemptionRows`/
`dailySelectionActivationRows`/`dailySelectionRedemptionRows`) that only
Overview.jsx's new "Daily Activation & Redemption Trend" card reads from.
Every other page, chart, and KPI in the app is completely unaffected by the
Day filter, by construction (they never read the daily pools).

**Availability gating**: `dayFilterAvailable` (`FilterContext.jsx`) is true
only when exactly one Month is selected AND none of Card Type,
Denomination, Activation Source, or Redemption Source is active. Per the
request's "don't silently show wrong/incomplete numbers" instruction, this
is a hard gate, not a partial combine — even though `ActivationModeFinal`/
`RedemptionModeFinal` do technically exist on the daily cubes (checked
directly), Activation Source/Redemption Source are still treated as
incompatible along with Card Type/Denomination, per the request's own
explicit list, rather than trying to derive which fields are "technically
fine" and only gating on the rest. When unavailable, `Select.jsx` (which
gained a new `disabled`/`disabledReason` prop, greyed control + `title`
tooltip) shows the Day dropdown disabled, and `FilterBar.jsx` surfaces a
small caption explaining why — but only once it's actually relevant (a
single Month is already picked, or a Day selection is already stored and
now inert) rather than on the default all-clear screen, where "select
exactly one month" would just be noise. Changing Month (or FY, which can
indirectly change Month via its own pruning) always resets `filters.day`
back to `[]` — a day number picked under one month is meaningless under a
different one.

**Overview.jsx's new "Daily Activation & Redemption Trend" card**: renders
only when `dayFilterAvailable`. Always plots every day of the selected
month (Activation + Redemption amount, grouped bars, gold/teal per the
existing Activation-vs-Redemption convention) — the specific Day
selection, if any, is shown as a *highlight* on top of the full month
(selected day(s) at full opacity, the rest dimmed to 0.25 via per-bar
`<Cell fillOpacity>`) rather than narrowing the chart's own dataset, so the
"spot the best/worst day, correlate with movie releases" use case the
request describes always has the whole month in view for comparison. A
small 2-KPI panel (Activation / Redemption amount + count) appears above
the chart only when `filters.day.length > 0`, scoped to exactly the
selected day(s) via `dailySelectionActivationRows`/
`dailySelectionRedemptionRows`. Deliberately **did not** rewire the
existing headline KPI ribbon (Revenue, Total Redemption (net), Total
Transaction Value, Uptake) to reflect the Day selection — those depend on
MoM/QoQ/YoY comparison logic, the Cancel Redeem netting/winner-map, and the
Uptake Ticket/F&B split, none of which the daily cubes have the fields to
support, and forcing a day-scoped number through machinery built for
month-scoped comparisons would be a bigger, riskier rewire than the request
asked for. This is a scope decision worth revisiting if the headline ribbon
itself is meant to go day-aware later, not an oversight.

**Verified against the raw daily cubes by hand first, then live in the
app**: Jul 2024, Day 15 — Activation ₹5.96L / 871 cards, Redemption ₹3.70L
/ 1,215 redemptions — both matched the app's selection-panel figures to the
rupee. Day 1 + Day 2 combined (a genuine multi-day OR, not the "all"/"none"
edge cases) — Activation ₹7.63L / 1,334 cards, Redemption ₹9.57L / 5,067
redemptions — also matched exactly, confirming the multi-day code path
works, not just the single-day one. "All days" was verified *by
construction* rather than by comparing two separately-summed numbers:
`dailySelectionActivationRows`/`...RedemptionRows` literally **are**
`dailyMonthActivationRows`/`...RedemptionRows` (the same array reference)
whenever `filters.day` is `[]`, so there's no second summation path that
could drift — confirmed by reading the code, and confirmed live that
ticking every real Day checkbox individually normalizes back to `filters.day
= []` (the same established "full selection = true unrestricted" rule
every other filter in this app already follows, from the 2026-08-03
"Select All" fix), landing back on "Whole month" rather than a 31-element
explicit list. Separately confirmed the daily cubes' own month-sums match
the main cubes' `YearMonth` totals to the paisa for every month in the
dataset (max abs diff ₹6.50 total across all 28 months — pure
floating-point noise, same pattern as every other cross-cube reconciliation
in this file). Confirmed live: activating Card Type mid-selection greys out
the Day control (`rs__control--is-disabled`), shows the incompatibility
caption, and hides the Daily Trend card entirely (falls back to exactly the
normal Overview page) rather than showing stale/partial numbers. Zero
console errors across every scenario; clean production build (705.98 kB
JS, 204.90 kB gzipped).

## 2026-08-11 — New "Summary" page: YoY/MoM/FY comparisons across every metric

New `/summary` page — 13 metric-comparison cards (5 Activation, 8
Redemption), each showing the same MoM/YoY/FY-to-FY comparison trio, built
from one new reusable component rather than 13 hand-written blocks.

**Scope decision, made explicit rather than silently guessed**: the
request named 5 breakdown dimensions (Region, Mode, Head, CardType,
Denomination) as what "underlying chart breakdowns" means. Not all of
these are literally separate charts on Activation/Redemption today (Denom
only existed on Overview; CardType only existed nested inside "by Source"
stacked bars) — read as the definitive dimension list to build comparisons
for, applied to whichever cube each is relevant to, rather than a stricter
"only exactly the chart titles that already exist" reading. "Mode" is
read as "Source" (Activation Source's 3-bucket model / Redemption
Source's 2-bucket model) — the only surviving concept with that meaning
after this app's several Mode→Source renames earlier in this file.
**Deliberately excluded**: Format (Box Office seating tier) and Category
(F&B item), and the Weekday/Week-slot trend charts — none were in the
request's named list, and both Format/Category are long-tail (~90/many
values) fields that would need their own top-N+Other treatment to stay
readable, which felt like scope creep beyond what was asked. Also
included, beyond a literal reading: `Box Office Redemption (net)` and
`F&B Redemption (net)` as their own headline metrics (not just a combined
`Total Redemption (net)`) — since Box Office and F&B are genuinely
separate pages with separate headline KPIs elsewhere in the app, a
faithful "every metric currently shown on the Redemption pages" needed
both, not just the site-wide total.

**Architecture — one reusable component, not 13 copies**
(`components/MetricComparisonCard.jsx`): takes `rowsAllMonths`/`rowsAllFY`
(the same Month-unrestricted/FY-unrestricted, filters-respecting pools
every other page's badges already read from — see FilterContext.jsx),
`amountField`/`countField`, and an optional `buckets` array of
`{key, predicate}`. Renders (a) the total with MoM/YoY `DeltaBadge`s — the
exact same badge component every other page's KPIs use, not a new one —
(b) an optional per-bucket table (Region/Source/Head/CardType/
Denomination), each row with its own MoM/YoY, and (c) an FY-to-FY row.
Because every metric on the page is just a different `{rows, buckets}`
pairing fed into this one component, adding a 14th metric later is a
config entry in `Summary.jsx`, not new chart code.

**New shared helpers in `lib/comparisons.js`**:
  - `computeBucketComparisons(rows, buckets, field, countField,
    comparisonMonths)` — runs the existing `computeComparisons()` once per
    bucket after pre-filtering to that bucket's predicate, same pattern
    Overview.jsx's `bucketRegionData()` already established for its
    regional charts (drops zero-current buckets, same convention). The
    card's own "total" row reuses this too, via a synthetic
    `[{key:'Total', predicate:()=>true}]` single-bucket call — one code
    path for both, not two.
  - `computeFYSeries(rows, field, countField)` — full-year totals per FY
    present in the data, each tagged `isPartial` (fewer than 12 distinct
    `YearMonth` values actually present for that FY — data-driven, not a
    hardcoded "current FY," so a future refresh completing FY2026-27 or
    adding FY2027-28 needs no code change). **The one piece of real
    design thought here**: a partial trailing FY's delta does *not*
    compare its own (partial) total against the previous FY's *full*
    total — that would read as a large fake decline purely from having
    fewer months, not a real signal. Instead it compares its own YTD
    total against the *same relative month range* one year prior (e.g.
    Apr-Jul 2026 vs. Apr-Jul 2025), labeled distinctly ("vs LY (same
    months)") so it's never mistaken for a full-year comparison. A full
    FY still compares against the previous FY's full total as normal
    ("FY YoY"). The very first FY in the data gets no delta at all — same
    "hide missing comparisons, don't show broken math" rule as
    `DeltaBadge`/`computeComparisons` already follow everywhere else.

**Region bucket definitions extracted, not duplicated**: `Summary.jsx`'s
"by Region" cards needed the exact same `ACTIVATION_REGION_BUCKETS`/
`REDEMPTION_REGION_BUCKETS`/`redemptionRegionLabel` Overview.jsx's own
region charts use (5 cinema regions + channel-total buckets — see those
constants' own doc comments for why a plain `Region_Clean` groupby would
be wrong). Rather than a second hand-written copy that could drift, moved
them out of `Overview.jsx` into new `lib/regionBuckets.js` and pointed
both pages at the one definition — same "extract instead of duplicate"
discipline this file has followed at every prior point where a second
call site needed the same nuanced bucketing (`groupByActivationSource`,
`netHeadRows`, etc.).

**Real bug found and fixed while building this, unrelated to the new
page's own logic**: `lib/constants.js#DENOM_ORDER` was still the
2026-08-04-era bracket list (`₹300`/`₹500`/.../`Other / Custom`, with a
currency symbol) — stale ever since the 2026-08-10 data refresh
regrouped `Denom` into bare-number exact/range brackets (`0-299`, `300`,
`301-499`, ..., `Other`). This was silently splitting behavior two ways
depending on how a call site used `DENOM_ORDER`: `orderBy()` calls
(Overview.jsx's Denomination chart) fell back to alphabetical sorting
with no data lost (every real value still rendered, just out of magnitude
order — a cosmetic bug that had been live since the refresh, unnoticed
until now), while a hard-equality bucket predicate (this page's own new
"by Denomination" cards) silently matched *zero* rows, since no real
`Denom` value has ever equaled `'₹300'` etc. — an empty breakdown table,
caught immediately by the "no rows in the per-bucket table" symptom
during this page's own verification pass. Fixed at the source
(`DENOM_ORDER` itself updated to the current 12-bracket list) rather than
patched per call site, so both the pre-existing Overview ordering bug and
the new page's empty table are fixed by the same one-line change;
`Overview.jsx`'s Denomination chart subtitle (which spelled out the old
bracket list literally) updated to match.

**Verified against the raw cubes by hand first, then live in the app,
unfiltered**: Total Activation for the current anchor month (Jul 2026,
the latest month in the data) — ₹1,149.77L, ▲125.7% MoM (vs. ₹509.51L
Jun 2026), ▲209.2% YoY (vs. ₹371.83L Jul 2025) — all three matched the
app exactly. FY series — FY2024-25 ₹2,321.80L, FY2025-26 ₹3,480.27L
(▲49.9% FY YoY), FY2026-27 ₹2,464.50L marked "Partial — 4/12 months
(YTD)" with ▲95.9% "vs LY (same months)" (vs. ₹1,258.17L for Apr-Jul
2025) — all matched exactly, confirming the partial-year YTD-vs-YTD delta
math (not a naive full-year comparison). Re-verified under an active
Region=NORTH filter — Total Activation ₹110.15L / ▲85.9% MoM / ▼43.5%
YoY — matched a direct hand-filtered computation on the raw cube exactly,
confirming every card recomputes live from the global filters rather than
showing one static view. Zero console errors; clean production build
(714.49 kB JS, 206.93 kB gzipped).

## 2026-08-11 — Remove all decimals from Lac-denominated currency, no exceptions

Second pass at this (an earlier same-session attempt was explicitly
reverted at the user's request before landing) — this time with an
explicit "no exceptions" instruction covering the 3 KPIs the first attempt
had deliberately excluded.

**Root fix, same as before**: `lib/format.js#fmtLacs`'s default `decimals`
param changed `2` → `0`. `toLocaleString('en-IN', {minimumFractionDigits:
0, maximumFractionDigits: 0})` performs standard round-half-away-from-zero
rounding (confirmed: this is `Intl.NumberFormat`'s spec-default rounding
mode, not truncation), so `7402.45` → `"7,402"`, matching the request's
own example exactly. `fmtLacsAxis`/`fmtLacsLabel` (chart axis ticks/
on-bar labels) were already 0-decimal before this pass, nothing to change
there — confirmed via the same repo-wide `toFixed|fmtLacs\(|decimals` grep
used the first time, re-run fresh since the codebase had moved on
(Card Journey, Day filter, Summary page all added since).

**Explicit call-site overrides, all removed this time**: `FlowBox.jsx`'s
redundant `fmtLacs(amount, big ? 2 : 2)` ternary (both branches were
already `2`, now just `fmtLacs(amount)`); `RedemptionFnb.jsx`'s Hero
Products list (`p.amount.toFixed(2)` → `Math.round(p.amount)` — this
field is pre-converted to Lacs in the source JSON, not raw rupees, so no
`fmtLacs`/`/100000` involved, just a plain round). **The 3 "Avg" KPIs**
(Activation's "Avg Ticket Size", both Redemption pages' "Avg per
Redemption") — the specific carve-out the first attempt made and reported
back, since these are genuinely sub-₹1L per-unit averages and rounding to
whole Lacs makes them display "₹0 L" — were removed this time per the
request's explicit "no exceptions" instruction. All three now show
"₹0 L", which is real, not a bug: verified directly (Activation's average
is ≈₹0.007L/card, F&B's ≈₹0.0027L/redemption) — flagged back to the user
as an observation, not silently left as a surprise.

**Real bug found and fixed while verifying, unrelated to this task's own
change**: a full-page sweep (Playwright, regex for any remaining `₹\d+\.\d+`
across all 8 routes) threw a React error on Overview — `ReferenceError:
regionLabel is not defined`. Traced to the 2026-08-11 Summary-page work
earlier the same day: extracting `ACTIVATION_REGION_BUCKETS`/
`REDEMPTION_REGION_BUCKETS` out of `Overview.jsx` into the new
`lib/regionBuckets.js` module also stripped `regionLabel` from
`Overview.jsx`'s own `lib/constants` import line (on the assumption it was
now only needed inside the extracted bucket file) — but `Overview.jsx`'s
"Activation by Region" chart's own `XAxis tickFormatter`/`Tooltip
labelFormatter` call `regionLabel` directly, a second, independent call
site the earlier grep-before-deleting pass missed. This had been silently
broken (Overview page crashing to a white error boundary on every load)
since that same-day change landed, caught only by this task's own
verification sweep rather than by that change's own testing. Fixed by
re-adding `regionLabel` to the import line; confirmed no other dropped
import from that same extraction (`REGION_ORDER` was correctly left out —
grepped, genuinely unused after the extraction).

**Verified**: Playwright swept all 8 routes (Overview, Activation, both
Redemption pages, Trends, Cancel Redeem, Card Journey, Summary) for any
remaining `₹<digits>.<digits>` pattern in the rendered page text — zero
matches on every page, post-fix. Confirmed the 3 "Avg" KPIs render exactly
"₹0 L" (not blank, not NaN). Hero Products list confirmed whole-number
(e.g. "₹393 L"). `ChartTooltip.jsx`'s default value formatter
(`fmtLacs(p.value)`, no explicit decimals argument) inherits the new
0-decimal default automatically — confirmed via source read that this is
the single shared tooltip component every chart on every page uses, with
no per-chart custom formatter bypassing it (re-ran the repo-wide grep from
this same entry's first paragraph to confirm). Zero console errors after
the `regionLabel` fix; clean production build (714.47 kB JS, 206.90 kB
gzipped).

## 2026-08-12 — Cross-page audit: Overview vs. every other page, no drift found

Requested as a "root-cause, not per-page patch" audit — verify every page
matches Overview to the rupee for identical filters, and consolidate any
duplicated aggregation logic found. Re-verified Overview itself first
(per the request's own "reverify if not confirmed" instruction): its
headline KPIs are plain `sumBy(activationRows, 'ActivationAmount')` /
`sumBy(redemptionRows, 'RedemptionAmount')` over the exact rows
`FilterContext.jsx` produces, no page-specific transformation — about as
close to ground truth as a computation can be, confirmed by reading the
source rather than assumed.

**Audit method**: hand-computed ground-truth totals directly from the raw
cubes in Node (replicating `physicalCancelWinnerMap`/`netHeadRows` exactly)
for 3 filter combinations — (1) no filters, (2) Region=NORTH, (3)
Month=Jul 26 — then compared every page's displayed figure against that
ground truth via Playwright, not just page-to-page. Also traced, via
direct source reading, exactly which shared arrays each page's totals
derive from (Overview/Activation/Trends/CancelRedeem all read
`activationRows`/`redemptionRows`/`redemptionRowsAllMonths` straight from
`useFilters()` with no independent re-filtering before summing — a
structural guarantee these can't drift, not just an empirical one).

**Result: zero numeric discrepancies found**, across all 3 combos, on all
6 pages. Total Activation matched exactly on Overview and Activation.jsx
(₹8,267L / ₹3,340L / ₹1,150L across the 3 combos). Overview's per-head
flow-diagram amounts (Box Office, F&B) matched RedemptionBoxOffice.jsx's/
RedemptionFnb.jsx's own headline KPIs exactly (₹1,023L/₹1,433L,
₹391L/₹696L, ₹85L/₹85L — the last pair's coincidental equality double-
checked against the unrounded values, ₹1023.4974L vs ₹1023.50L display
artifact in an earlier hand-check, not a real ambiguity). Trends.jsx
verified via its own chart tooltip under Month=Jul 26 (a single remaining
data point) — ₹1,150L/₹831L, matching Overview to the rupee — plus the
general case confirmed by the shared-array proof above. Cancel Redeem's
own "Cancel Redeem" KPI matched hand-computed cancellation totals exactly
(₹1,463L/₹1,209L/₹220L), and the arithmetic identity `grossPositiveRedemption
- CancelRedeemTotal = Overview's Total Redemption` held for all 3 combos
by hand computation. **One transient false alarm during this audit**:
an early automated run showed Overview's combo-3 numbers off from every
other page (and non-reproducible — different wrong numbers on a second
run) — traced to the test script's own insufficient wait after a Month
filter change on Overview specifically (the heaviest page, most charts to
recompute), not an app bug; a version with `networkidle` + longer settle
time reproduced the correct, matching numbers reliably across repeated
runs. Documented here so this specific false trail isn't re-chased.

**Root-cause consolidation, done anyway despite finding no active bug**:
`physicalCancelWinnerMap(redemptionRowsAllMonths)` was independently
computed via three separate `useMemo` call sites — one each in
`Overview.jsx`, `RedemptionBoxOffice.jsx`, `RedemptionFnb.jsx` — genuinely
duplicated logic per the request's own definition, even though it happened
to be numerically harmless (proven: a Region+Month winner decision depends
only on rows matching that exact key, and removing the Month restriction
only *adds* keys for other months, never changes the rows behind a key
already present — so self-deriving the winner map from whichever pool
`netHeadRows()` is given always agrees with an externally-pinned one, for
any key that computation could actually look up). Removed all three
`useMemo`/`physicalCancelWinnerMap` call sites and the explicit `winnerMap`
argument threaded through every `netHeadRows(...)` call in favor of
letting `netHeadRows()` self-derive one from whatever rows it's given
(already its documented fallback — `winnerMap || physicalCancelWinnerMap
(redemptionRows)` in `lib/aggregate.js`) — deleting the duplication rather
than relocating it to a new shared wrapper, since the existing shared
function already had the self-sufficient default. `Summary.jsx` (added
2026-08-11) was already written this way from the start, so it needed no
change — only the 3 older call sites had the redundant explicit-map
pattern. Re-ran the full 3-combo audit *after* this change and confirmed
every figure is byte-identical to before — the consolidation is provably
behavior-preserving, not just assumed so.

**Broader architecture note**: most of the aggregation surface this
request was worried about was already consolidated by prior work this
session — `lib/aggregate.js` (`sumBy`, `groupSum`, `netHeadRows`,
`netRedemptionHeads`, `weekSlotBreakdown`, `splitByCardType`,
`groupByModeTable`, `topNWithOther`, `netCinemaRedemption`), `lib/
comparisons.js` (`computeComparisons`, `computeBucketComparisons`,
`computeFYSeries`), `lib/activationSource.js`/`lib/redemptionMode.js`
(the two Source bucket models), `lib/regionBuckets.js` (Region bucket
definitions, extracted 2026-08-11), and `FilterContext.jsx`'s exported
`ticketFnbBucket()`. Every page's own computations are thin, page-specific
compositions of these shared primitives (e.g. Activation.jsx's regional
split just filters to `ActivationModeFinal==='Physical'` then calls the
shared `groupSum`) — not independently reimplemented aggregation
algorithms. The one real duplication this audit found (the winner-map
call sites above) is now gone.

**Verify explicitly, as requested — which pages don't match**: none.
Every one of Activation, Redemption · Box Office, Redemption · F&B,
Trends, and Cancel Redeem matched Overview exactly, for all 3 filter
combinations, both before and after the consolidation. Zero console
errors throughout; clean production build (714.38 kB JS, 206.85 kB
gzipped — smaller than before, net code removed).

## 2026-08-12 — Chart-parity pass: Activation vs. both Redemption pages + Denomination bucket update

**Checklist built first, before writing any chart code** — every chart on
Activation.jsx / RedemptionBoxOffice.jsx / RedemptionFnb.jsx, categorized
against the request's 4 named "general-purpose" types (weekday trend,
regional split, mode/source split, denomination split) vs. page-specific
ones (Format, Category, Hero Products, Heads Breakdown, Month-wise trend —
none of which were in the request's named list, left untouched):

| Chart type | Activation | Box Office | F&B |
|---|---|---|---|
| Weekday/Week-slot trend | had it | **had it already** (see below) | missing → added |
| Regional split | had it | had it | had it |
| Mode/Source split | had it | had it | missing, deliberately (see below) |
| Denomination split | missing → added | missing → added | missing → added |

**The request's own premise was half right**: it named "Week-slot
Activation Trend... missing from the Redemption pages" (plural) as the
motivating example. Checked before adding anything — RedemptionBoxOffice.jsx
already had this exact chart, just under the name "Weekday Trend" (same
`groupSum(netBoxOfficeRows, 'Weekday', ...)` shape, same `categoricalColor`
cycling, same convention as Activation's). Only RedemptionFnb.jsx was
genuinely missing it. Rather than add a redundant second weekday chart to
Box Office, renamed its existing one to **"Week-slot Redemption Trend"**
(pure rename, zero calculation change) so the same concept carries the
same name on all 3 pages, and added the matching chart to F&B for the
first time, same shape/colors.

**F&B "by Source" — considered and deliberately skipped, not an
oversight**: this chart existed briefly earlier in this project's history
and was removed (2026-08-05 "Fix structurally-empty by-Source charts"
entry) because `Head='F&B'` rows are 100% `RedemptionModeFinal='Physical'`
— nothing is ever bought via F&B through PVR Inox Online — so the chart
would always be exactly 100% Cinema / 0% Online, structurally, not just
usually. Box Office solved the analogous problem by widening its own
chart's scope to combine Box Office + Online (both "ticket-type"
redemptions); no such second head exists for F&B to combine with. Treated
as the same category of exception the request itself named for Format/
Category (fields that "genuinely don't apply" to a page) rather than
force-adding a chart that would always convey zero information — flagged
explicitly in a code comment and here, not silently dropped.

**Denomination**: genuinely missing as a *page-scoped* chart on all 3 —
only existed as one combined Activation-vs-Redemption chart on
Overview.jsx. Added "Activation by Denomination" / "Box Office Redemption
by Denomination" / "F&B Redemption by Denomination" to each page
respectively (`ActivationAmount` for Activation, `RedemptionAmount`
scoped to that page's own net rows — `netBoxOfficeRows`/`netFnbRows` — for
the two Redemption pages, consistent with every other breakdown chart
already on those pages being net-scoped). All 3 use the exact same
11-bucket `DENOM_ORDER` list (see below), angled X-axis labels
(`-45°`/`height 60`) matching the established crowding-avoidance pattern
from the Region charts, `categoricalColor()` cycling for bar fills.

**Denomination bucket set narrowed to exactly 11, per explicit request**:
`DENOM_ORDER` (`lib/constants.js`) dropped `'Other'` (was a 12th bucket,
added 2026-08-11) — now exactly `0-299, 300, 301-499, 500, 501-999, 1000,
1001-1999, 2000, 2000+, 5000+, 10000+`, in that order. `'Other'` is a real
Denom value (confirmed still present in the data, ~₹0.04L, negligible)
but is no longer offered as a pickable filter option or its own chart
bucket — same "not pickable, but real rows still pass through untouched
when the filter is unrestricted" treatment `'N/A'` already had. Two call
sites changed as a result:
  - `FilterContext.jsx`'s `options.denominations` — was data-derived
    (every non-'N/A' value actually present in the cubes, which included
    'Other'); now just `DENOM_ORDER` directly, a fixed enumeration, same
    pattern already used for `activationSources`/`redemptionSources`
    (bucket models aren't data-derived field lists). `FilterBar.jsx`'s
    now-redundant `orderBy(options.denominations, DENOM_ORDER)` simplified
    to use `options.denominations` directly, since it's already in the
    right order by construction.
  - Overview.jsx's "Activation vs. Redemption by Denomination" chart
    changed from deriving-then-`orderBy()`-ing the set of values actually
    present (which let 'Other' slip back in via `orderBy`'s "unknown,
    append alphabetically" fallback — the exact bug class the 2026-08-11
    entry already flagged once for a different reason) to iterating
    `DENOM_ORDER` directly and filtering rows to
    `DENOM_ORDER.includes(r.Denom)` — structurally can't include a value
    outside the fixed list anymore, not just correct today. Subtitle
    updated to drop "/ Other". `Summary.jsx`'s own Denomination cards
    needed no change — already built as `DENOM_ORDER.map(...)`, so the
    bucket-set narrowing propagated automatically.

**Verified against the raw cubes by hand first, then live in the app**:
unfiltered Activation by Denomination — 0-299 ₹242L, 300 ₹958L, 301-499
₹247L, 500 ₹2,131L, 501-999 ₹565L, 1000 ₹1,926L, 1001-1999 ₹740L, 2000
₹614L, 2000+ ₹798L, 5000+ ₹23L, 10000+ ₹103L — all 11 matched the app
exactly. Noted (not a bug): summing these 11 buckets (₹8,347L) exceeds
the page's own Total Activation (₹8,267L) by exactly the excluded `Denom
='N/A'` rows' amount (−₹80.65L, real negative correction/adjustment
entries) — same "gap equals the excluded rows' amount, not a leak"
pattern already documented for Overview's version of this chart. Box
Office and F&B's Week-slot Redemption Trend charts matched the exact
per-weekday figures already verified earlier this session (₹109L/₹104L/
.../₹182L for Box Office). Denomination filter dropdown confirmed to show
exactly the 11 buckets in the correct order (Playwright, read from actual
rendered `<option>` DOM text, not assumed). Zero console errors across
all 3 pages; clean production build (719.08 kB JS, 207.22 kB gzipped).

## 2026-08-12 — Compacted the sticky header + filter bar

Target was 30-40% less combined vertical height, verified by measuring
actual rendered pixel heights (Playwright `boundingBox()`), not just
eyeballing smaller-looking numbers.

**Header** (`Layout.jsx`): logo `h-14 md:h-16` → `h-8 md:h-10`, header
padding `py-2` → `py-1`, nav-pill padding `px-3 py-2` → `px-2.5 py-1`,
"Gift Card/Analytics" label text sizes trimmed one step (`text-sm`→`text-xs`,
`text-[11px]`→`text-[10px]`). Logo height dominates the header's total
height (nav pills are shorter), so shrinking it is what actually moves
the number — measured 80px → 48px, a 40% reduction on its own.

**Filter bar** (`Layout.jsx`'s wrapper + `FilterBar.jsx` + `Select.jsx`):
wrapper padding `py-2`→`py-0.5`, `FilterBar.jsx`'s own card `px-3 py-2`→
`px-2.5 py-0.5`, grid gap `gap-1.5`→`gap-1`, react-select control
`minHeight` `32`→`24`, `Select.jsx`'s label text `text-[10px]`→`text-[9px]`
with its gap to the control trimmed to 0. First pass only got to ~68px
(from an analytical ~80px baseline, computed from the exact pre-change
Tailwind values read before editing — not guessed) — short of the target
range, so trimmed padding further in a second pass down to 60px measured.

**Combined sticky height: 160px (analytical baseline) → 108px (measured),
a 32.3% reduction** — inside the requested 30-40% range. `Select.jsx`'s
disabled/focus states, the Day filter's greyed-out treatment, and the
"Select All" checkbox toggle were all re-verified working after the
resize (none of the edits touched interaction logic, only `styles`
dimensions) — confirmed live via Playwright reading actual DOM checkbox
`checked` state through two Select-All clicks (0/6 → 6/6), not just that
the dropdown opens.

**Verified the actual goal, not just the pixel math**: screenshotted
Overview at a common 1600×900 viewport with all filters cleared — the
full 4-card KPI ribbon *and* the entire Activation/Redemption flow
diagram tree (down to the Digital/Physical sub-boxes) are visible above
the fold, which was not the case at the previous header/filter-bar
height. Mobile (390px) re-checked too — nav still wraps cleanly across
multiple rows, filter grid stays 2-column, "Gift Card/Analytics" label
still correctly hidden below `sm` (unrelated to this change, already
existing behavior) — nothing overflows or overlaps at the smaller sizes.
Zero console errors; clean production build (719.09 kB JS, 207.23 kB
gzipped — unchanged from before this pass, pure styling).

**Near-miss during verification, caught before it mattered**: attempted
to measure the "before" baseline by `git stash`-ing this change and
rebuilding — `git stash` reverted the *entire* session's accumulated
uncommitted work (every page/feature built across this whole session is
still uncommitted), not just this one edit, since it was all one
undifferentiated working-tree diff. Caught immediately from the tool
output listing far more changed files than expected, and `git stash pop`
restored everything before any further action — confirmed via `grep` that
the compacting edits were back in place, then rebuilt. Used the
already-known pre-edit Tailwind values (read directly before making any
changes, further up this same entry) as the "before" baseline instead of
re-attempting a stash-based comparison.

## 2026-08-13 — Card Journey rebuilt on a real cohort cube, redemption side replaced entirely

The 2026-08-11 build of this page paired "Activated Cards" (activationRows,
period-filtered) with "Redeemed Cards (this period)" (redemptionRows,
period-filtered) — structurally the *same* "two independent per-period
totals" question Overview already answers on its own KPI ribbon, just
under different labels. The explicit complaint: this doesn't track cards
forward through time at all — a card activated in April 2026 but redeemed
in October 2026 would count in April's activation total and October's
redemption total, never showing up as "this April cohort has since been
70% redeemed." Fixed by replacing the redemption side entirely, not
patching the labels.

**New data source**: `cohortCube.json` (`ActivationYearMonth`/
`Region_Clean`/`RedemptionModeFinal`/`Head` dims, `RedemptionAmount`/
`RedemptionCount`/`Uptake` measures) — pre-aggregated by the card's
*original activation month*, not by when the redemption transaction
happened (that field doesn't exist on this cube at all, by design — there
is no way to additionally slice it by redemption date, which is the whole
point: it can't be filtered into "the same wrong shape" the old page had).

**`FilterContext.jsx#filterCohort()`**: applies FY/Month against
`ActivationYearMonth` (not the row's own event date — this cube has no
other date field), plus Region, Redemption Source, and Ticket/F&B — the
four dimensions that actually exist on this cube. Deliberately does *not*
attempt CardType/Denomination/Activation Source (fields don't exist here,
same reasoning as the Day filter's daily-cube limitation from 2026-08-10 —
not maximizing what's technically combinable, just what's actually
present). One data-reality wrinkle handled without a special case: a
minority of rows carry `ActivationYearMonth = 'Pre-existing (activated
before Apr 2024)'`, not a real `'YYYY-MM'` string — confirmed `fyOf()`
doesn't throw on it (produces a nonsense `'FYNaN-NaN'` that simply never
matches a real FY selection), so these rows correctly count only when
FY/Month are both unrestricted and drop out cleanly the moment either
narrows to a specific period, with no extra guard code needed.

**`CardJourney.jsx`**: the KPI-ribbon-plus-callout layout from 2026-08-11
was replaced with a visually distinct horizontal funnel (Activated → an
arrow annotated "tracked forward through time, even after this period
ends" → Redeemed to Date (Cohort) → "=" → a highlighted Cohort Redemption
Rate box), inside a gold-double-bordered card with its own explicit
"a different question from Overview" label — deliberately *not* reusing
`FlowBox`/`FlowBranch` (Overview's own Activation-vs-Redemption diagram
component), specifically so the two pages can't be visually mistaken for
the same comparison at a glance, per the request's explicit "make it
visually explicit these are two different concepts" requirement. The old
"by Original Activation Cohort" breakdown chart (built on the *main*
redemption cube's own `ActivationCohort` field, a different pre-existing
per-row bucket, unrelated to the new `cohortCube.json`) was removed along
with the rest of the old redemption side — keeping it would have
reintroduced the exact "redemptions happening in this period" framing the
whole page was just corrected away from. Replaced with a new "Redeemed to
Date (Cohort) — by Head" chart, using `cohortRows` grouped by `Head` (the
same `HEAD_COLORS`/`HEAD_ORDER` every other Heads-breakdown chart in the
app already uses), so the page isn't just three bare numbers.
`COHORT_ORDER`/`cohortLabel` (`lib/constants.js`) are now unused anywhere
in `src/` — left in place rather than chased for deletion, same "leave
the dead export" precedent as `donutLabel` earlier in this file, since
they still correctly describe a real field that still exists in the data
(`redemptionCube.json`'s own `ActivationCohort`), just not surfaced on
this particular page anymore.

**Verified against the raw cube by hand first, then live in the app**:
FY2026-27 — Activated ₹2,464.50L / 3,58,012 cards (unchanged from every
prior verification of this exact figure in this file), Redeemed to Date
(Cohort) ₹1,727.78L / 4,20,802 redemptions, Cohort Redemption Rate 70.1%
— all three matched the request's own target numbers exactly, both by
hand computation against `cohortCube.json` directly and live in the app.
The "by Head" breakdown (Online ₹1,567L, Box Office ₹300L, F&B ₹257L,
Cancellation −₹396L) sums to the same ₹1,727.78L, confirmed by hand before
checking the UI. Sanity-checked the unfiltered (all-time) case too: Cohort
Redemption Rate comes out to 81.0% — matching Overview's own "% of total
activation" figure exactly, which is the expected identity when every
activation cohort and every redemption are both included with no period
restriction (the cohort cube's un-filtered total must reconcile with the
main cubes' un-filtered totals, and does). Zero console errors; clean
production build (720.54 kB JS, 207.35 kB gzipped).

## 2026-08-13 — Fix: Summary page headline totals silently collapsed to the latest month

**The bug**: FY2026-27 + Month=All showed "Total Activation ₹1,150L /
1,63,878 cards" on the Summary page — that's July 2026 alone (the FY's
latest month), not the FY total (₹2,464.50L / 3,58,012 cards, confirmed
against the raw cube and matching every other page's FY figures for the
same period). The "Activation by Source" breakdown had the identical bug
one level down (its 3 rows summed to the same wrong ₹1,150L).

**Root cause**: `lib/comparisons.js#computeBucketComparisons()` computed
its `amount`/`count` (the headline figure shown on each Summary card, and
each row of its breakdown table) via `sumForMonths(bucketRows, field,
comparisonMonths)` — the same single-latest-month "anchor" used for the
MoM/YoY *delta* math. That anchor is deliberately narrow for deltas (it's
what lets "this month vs. the same month last year" work), but reusing it
for the headline total itself meant the total silently collapsed to just
that one anchor month whenever Month was left unrestricted — every other
page's headline KPI is a plain `sumBy(fully-filtered-rows, field)` with no
such anchoring (confirmed by re-reading Overview.jsx/Activation.jsx's own
KPI computations), so this was a real, Summary-page-specific bug
introduced when the page was first built (2026-08-11), not a pre-existing
app-wide pattern being correctly followed.

**The fix**: `computeBucketComparisons()` now takes two separate row
pools — `currentRows` (the ordinary, Month-respecting filtered pool, same
shape as `activationRows`/`redemptionRows` every other page already sums)
for the headline `amount`/`count` via a plain `sumBy()`, and
`rowsAllMonths` (Month-unrestricted) only for the MoM/YoY delta lookups,
which still genuinely need to reach adjacent months beyond the Month
filter. `MetricComparisonCard.jsx` gained a new `rows` prop threaded
through from `Summary.jsx` (`activationRows`/`redemptionRows`, plus
Month-respecting `netHeadRows(redemptionRows, 'Box Office'|'F&B')` pools
for those two net cards) alongside the existing `rowsAllMonths`/`rowsAllFY`
props. `computeFYSeries()` (the FY Comparison row at the bottom of each
card) was **not** part of this bug — it already does a plain per-row
accumulation with no month-anchoring, confirmed by re-reading it before
touching anything, which is exactly why the user's own report singled out
the *headline* number as wrong while pointing at "any other page's FY
comparison table" as already correct: that FY table was this page's own
FY row, already right.

**Also fixed — YoY badges missing when a specific FY is active**:
verified this is *not* a bug, before assuming it needed a fix.
`activationRowsAllMonths` (which the MoM/YoY deltas read) lifts the Month
restriction but deliberately keeps FY applied (see the 2026-08-05 "Decided
against reaching across an active FY filter" entry) — so a YoY badge
needing July 2025 data can't find it while FY is pinned to 2026-27 alone.
Confirmed Overview.jsx shows the *exact same* MoM/QoQ-only, no-YoY pattern
under an identical FY2026-27 filter — this is the established, deliberate,
app-wide convention working correctly, not a regression from this fix.

**Clarity improvement**: "Activation by Source" (and every other bucketed
card) gained a one-line `subtitle` explaining what its rows mean — e.g.
"Each row is that channel's own activation amount for the selected period
— Aggregators / Corporate (merges Corporate + Online) / Cinema" — instead
of a bare 3-row table with no framing text, per the request.

**Styling audit against the rest of the dashboard**: `MetricComparisonCard`
was visually generic (plain `text-2xl` unaccented number, unbordered FY
mini-blocks) compared to every other page's KPI language. Restyled to
match `Kpi.jsx`'s established visual system directly: `text-3xl
font-serif font-extrabold` value (was `text-2xl`), colored via the same
gold/teal accent map Kpi.jsx uses (`accent` prop, gold for every
Activation-section card, teal for every Redemption-section card — the
same color coding every other page already uses for these two cubes), and
a matching `border-l-[6px] border-l-{accent}` colored left border on the
whole card (via `Card.jsx`'s existing `className` passthrough — the exact
`border border-warmgray-border border-l-[6px]` combination Kpi.jsx already
uses, confirmed reused verbatim rather than approximated). Breakdown table
rows gained a hover state and slightly more padding; FY Comparison entries
changed from bare text blocks to bordered `bg-cream/70` chips, consistent
with the small-bordered-block pattern used elsewhere in the app (e.g.
Kpi.jsx's own `breakdown` prop).

**Verified against the raw cube by hand first, then live in the app**:
FY2026-27 + Month=All — Total Activation ₹2,464.50L / 3,58,012 cards
(rounds to the app's displayed ₹2,465L) — matches exactly. Activation by
Source — Aggregators ₹2,019.51L, Corporate ₹199.96L, Cinema ₹245.03L,
summing to the same ₹2,464.50L — all three matched the app to the rupee
(displayed, rounded: ₹2,020L/₹200L/₹245L). Re-verified every other
Summary card (by Region, by Card Type, by Denomination, and the full
Redemption section) under the same filter — every bucket table's rows now
sum back to its own card's headline total, confirmed by eye across all 13
cards in the screenshot used for this fix's own review. Zero console
errors; clean production build (721.86 kB JS, 207.65 kB gzipped).

## 2026-08-13 — Card Journey rebuilt again: cohortCube gained RedemptionYearMonth, "to-date" replaced with "same-period"

Same day as the previous cohort rewrite — `cohortCube.json` was replaced
again, this time adding a second date field (`RedemptionYearMonth`
alongside the existing `ActivationYearMonth`), which changes the question
this page can answer. The "to-date" version (redeem the cohort whenever,
no matter how much later) is exactly what the earlier rewrite built — this
pass narrows it further: "of cards activated in this period, how much got
redeemed within that *same* period" (both conditions true simultaneously),
with the old "to-date" question demoted to a bonus spillover chart now
that the cube can answer both from one dataset.

**`FilterContext.jsx`**: `filterCohort()` now requires BOTH
`ActivationYearMonth` and `RedemptionYearMonth` to independently satisfy
the current FY/Month selection — a row activated inside the period but
redeemed outside it (before or after) is excluded, which is the entire
point of this narrower question versus the "to-date" one. A new sibling,
`filterCohortByActivation()`, keeps only the activation-side restriction
(no restriction on `RedemptionYearMonth` at all) — this is structurally
identical to the *previous* `filterCohort()` from earlier the same day,
kept alive under a new name since the wider cube can now answer both
questions from the one dataset rather than needing two different cubes.
Both exposed via `useFilters()` as `cohortRows` (same-period) and
`cohortRowsByActivation` (activation-fixed, redemption-unbounded).
`Region_Clean` never carries `RedemptionYearMonth`'s equivalent of the
"Pre-existing" sentinel string — confirmed directly (`ActivationYearMonth`
is the only field with that value) — so no second guard was needed beyond
the one `fyOf()` already handles gracefully for `ActivationYearMonth`.

**Count convention, confirmed against the request's own target numbers
before writing any code**: the request's target amount (₹1,727.78L) is
net across every `Head` including `Cancellation` (cancellation rows carry
a real negative `RedemptionAmount` and net in automatically, same
convention as everywhere else in this app) — but the target *count*
(3,46,853) is **not** `sum(RedemptionCount)` across all rows (which comes
to 4,20,802, the number from the earlier "to-date" version, since the
count itself doesn't change between the two schema versions for a
same-period-restricted query — only which redemptions are *included*
differs). Checked directly: 4,20,802 minus the Cancellation-only count
(73,949) equals exactly 3,46,853 — so the count target deliberately
excludes `Head='Cancellation'` rows from the count entirely while still
netting their amount into the total, the same "amount nets cancellations
in, count excludes them" split already on record for other pages in this
file (e.g. the 2026-07-31/2026-08-04 Mode-filter entries). Implemented as
`redeemedAmount = sumBy(cohortRows, 'RedemptionAmount')` (all rows) vs.
`redeemedCount = sumBy(cohortRows.filter(r => r.Head !== 'Cancellation'),
'RedemptionCount')`.

**`CardJourney.jsx`**: same funnel visual (kept from the earlier rewrite,
still deliberately not `FlowBox`/`FlowBranch`, per the standing "visually
distinct from Overview" requirement) with updated labels ("Redeemed
Within This Period" / "Same-Period Redemption Rate") and updated callout
copy explaining the both-conditions-simultaneously rule with a concrete
example (an April-activated, October-redeemed card doesn't count here).
The "by Head" breakdown chart is unchanged in shape, just now built from
the narrower `cohortRows`.

**Bonus capability, implemented**: "Redemption Spillover — Cards Activated
in This Period" — a new chart grouping `cohortRowsByActivation` (the
activation-fixed, redemption-unbounded pool) by `RedemptionYearMonth`,
colored two ways: teal for months inside the selected period, gold for
months outside it. The teal/gold split is computed by checking membership
in `cohortRows`' own set of `RedemptionYearMonth` values (`new
Set(cohortRows.map(r => r.RedemptionYearMonth))`) rather than
re-implementing the FY/Month matching logic a second time in the page
component — a month is "within period" if and only if `cohortRows` itself
already kept it, so this can't drift from the headline numbers above it.
For the current FY (FY2026-27, the most recent period in the data with no
room to spill into the future) every bar renders teal, correctly — there's
nothing beyond the data's own frontier to spill into yet. Checked against
a past FY (FY2024-25) to confirm the spillover case actually works: 12
teal months (Apr24-Mar25) followed by 16 gold months trailing off toward
zero through Jul 2026, a clean decaying tail, confirming the feature reads
correctly no matter which period is selected.

**Verified against the raw cube by hand first, then live in the app**:
FY2026-27 — Activated ₹2,464.50L / 3,58,012 cards (unchanged, matches
every prior verification of this exact figure in this file), Redeemed
Within This Period ₹1,727.78L / **3,46,853** redemptions (the corrected
count, not the earlier 4,20,802 "to-date" figure), rate 70.1% — all three
matched the request's own target numbers exactly, both by hand
computation against the new `cohortCube.json` directly and live in the
app. Sum of the 4 spillover bars for FY2026-27 (₹240L + ₹320L + ₹373L +
₹795L = ₹1,728L) matches "Redeemed Within This Period" exactly, confirming
the spillover chart's own total reconciles with the headline figure. Zero
console errors; clean production build (724.17 kB JS, 208.09 kB gzipped).

## 2026-08-13 — Card Journey: verified no regression, wording cleanup

**Verification requested, done before any code changed**: FY2026-27 +
Month=Jul 26 — hand-computed directly against `cohortCube.json` first
(₹730.31L / 1,42,722 redemptions net of cancellations, vs. ₹1,149.77L /
1,63,878 cards activated, 63.5% rate), then confirmed live in the app —
exact match, both before touching anything and after this pass's wording
edits. The join logic (`ActivationYearMonth`/`RedemptionYearMonth` both
required to satisfy the same FY/Month selection) was already correct from
the same-day rewrite that introduced it — no regression, nothing to fix
here beyond confirming it.

**Wording cleanup**: the funnel banner and the explanation block below it
were over-explaining on every visit — a full sentence of context under
the arrow, a permanent paragraph-length callout underneath. Trimmed to:
  - Banner: one sentence ("Tracks the same cards from activation through
    redemption — not two independent totals.") replacing the previous
    uppercase kicker + quoted comparison to Overview. Dropped the
    uppercase/tracking-wide treatment too — that styling suits a short
    kicker label, not a full sentence, which reads better in normal case.
  - Under the arrow: "redeemed in the same period" (four words) replacing
    a two-line explanation.
  - The full explanation (the Overview-comparison paragraph, the April/
    October example) moved into a native `<details>/<summary>` disclosure
    — "What does this mean?", collapsed by default, custom rotating
    triangle marker (native disclosure markers are inconsistent across
    browsers, suppressed via `list-none` + a `[&::-webkit-details-marker]`
    override, replaced with one arrow character that rotates via a
    `group-open:` variant). No new component or JS state needed — native
    HTML handles the toggle, keeping the same "no framework beyond what's
    already used" footprint as the rest of the app. The core distinction
    (a card activated outside the period never counts, even if its
    redemption lands inside it) is still on the page, just opt-in to read
    rather than forced on every load.
  - Spillover chart's own caption trimmed the same way: "Teal = within the
    selected period. Gold = same cohort, redeemed outside it." replacing a
    two-clause sentence repeating the funnel's own numbers back.

**Verified**: re-confirmed the FY2026-27/Month=Jul 26 numbers are
unchanged after the wording edit (pure copy/markup change, no calculation
touched) — ₹730L / 1,42,722 redemptions, 63.5% rate, byte-identical to
the pre-edit numbers. Clicked the "What does this mean?" disclosure live
(Playwright) and confirmed it expands to show the full explanation and
the arrow rotates — collapsed by default on page load. Zero console
errors; clean production build (723.86 kB JS, 207.98 kB gzipped).

## 2026-08-13 — Card Journey: copy + visual polish, zero calculation changes

Explicitly copy/styling-only per the request — no filter, aggregation, or
data logic touched. Verified this held: re-checked FY2026-27 + Month=Jul 26
after every edit (₹1,150L / 1,63,878 cards activated, ₹730L / 1,42,722
redeemed, 63.5% rate) — byte-identical to the pre-edit numbers, confirming
the pass was purely presentational.

**Copy, card-first not period-first**: "Activated in This Period" → "Cards
Activated"; "Redeemed Within This Period" → "Of Those, Redeemed";
"Same-Period Redemption Rate" → "Redemption Rate"; arrow microcopy
"redeemed in the same period" → "same cards, redeemed" — the selected FY/
Month already reads at the top of the page via the filter bar, so the KPI
labels no longer repeat "period" on every line. Banner tagline replaced
("Tracks the same cards... — not two independent totals." → "Follows
individual cards from activation to redemption.") — states what the page
does rather than what it isn't. "Redeemed Within This Period — by Head"
chart title shortened to "Redemption by Head" (subtitle untouched, already
fine per the request). The "What does this mean?" disclosure's prose
tightened from 4 dense sentences to 3 short ones — same collapsed-by-
default `<details>` behavior, content only.

**Visual consistency pass**: the funnel banner previously used a one-off
`border-2 border-gold` (uniform 2px border) with `p-5 md:p-6` padding —
neither matches `Card.jsx`'s actual pattern (`border border-warmgray-border`
at 1px, `p-4 md:p-5`). Fixed by switching to the *same* accent treatment
`Kpi.jsx`'s own `accent="gold"` cards already use elsewhere in this app —
`border border-warmgray-border border-l-[6px] border-l-gold` — rather than
inventing a second "this card is gold-themed" pattern. Padding now matches
`Card.jsx` exactly. KPI sub-lines (`{count} cards`/`{count} redemptions`)
gained the `font-medium` weight `Kpi.jsx`'s own `sub` text always has —
was missing here, a small but real typographic drift from every other
KPI's sub-line in the app. The Rate box's value dropped from `text-4xl` to
`text-3xl`, matching the Activated/Redeemed values exactly instead of
reading disproportionately larger next to them — all three numbers in the
funnel are now the same size, weight, and font (`font-serif
font-extrabold`), matching `Kpi.jsx`'s default `valueClassName` used
everywhere else in the app.

**Visual hierarchy**: banner tagline demoted from `font-semibold` to
`font-medium` (reads as a caption, not competing prose) with its bottom
margin increased (`mb-4`→`mb-5`); the KPI row's internal gap widened
(`gap-3 md:gap-5`→`gap-4 md:gap-8`) so Activated/arrow/Redeemed/=/Rate
have more breathing room and read as the card's clear headline rather than
a cramped inline group under a paragraph-weight tagline.

**Verified**: re-ran the FY2026-27/Month=Jul 26 check after every edit
(numbers unchanged throughout, confirmed above); screenshotted the
unfiltered and filtered states to confirm layout/spacing renders as
intended at 1500px width; zero console errors; clean production build
(723.76 kB JS, 207.93 kB gzipped — smaller than before, net markup
simplification).

## 2026-08-14 — Redemption pages audit: KPI/chart mismatch, Avg formatting bug, and a subtler app-wide reconciliation bug found along the way

**1. Removed "Redemption Heads Breakdown" from RedemptionBoxOffice.jsx** —
it showed all 4 heads (Online/Box Office/F&B/Cancellation), a straight
duplicate of Overview's own head-split, and didn't belong on a page
scoped to one head. `RedemptionFnb.jsx` never had this chart, nothing to
remove there. Page-specific breakdowns to replace it with ("by Format" for
Box Office, "by Category" for F&B) **already existed on both pages** —
built during the 2026-08-12 chart-parity pass — so no new chart needed
building, just deleting the dead one (plus its now-orphaned
`headsBreakdown`/`boxOfficeRows`/`hasData` computations and `HEAD_ORDER`/
`HEAD_COLORS` imports).

**This directly fixed the reported KPI mismatch**: "Box Office Redemption"
showed ₹1,023L (net, via `netHeadRows()`, correct since the 2026-08-06
rewire) while the Heads Breakdown chart's own Box Office bar showed
₹1,119L (gross — that chart intentionally never nets, so cancellations
stay visible as their own bar, which is right for a *heads* comparison but
wrong to have sitting on a page whose own headline KPI is net). Removing
the chart removes the second, gross figure entirely — nothing left on the
page to disagree with the KPI.

**2. Fixed "Avg per Redemption"/"Avg Ticket Size" showing ₹0 L** — these
are genuinely sub-Lac values (a few hundred rupees per unit), so running
them through `fmtLacs` (÷100,000) rounded every one to "₹0 L" — a
formatting bug, not a real zero, exactly as reported. New
`lib/format.js#fmtRupees()` — whole rupees, comma-grouped, no Lacs
conversion — applied to `Activation.jsx`'s "Avg Ticket Size" (now "₹618"),
`RedemptionBoxOffice.jsx`'s and `RedemptionFnb.jsx`'s "Avg per Redemption"
(now "₹434" / "₹271"). This reverses a call made two entries ago (2026-08-11
"no exceptions" decimal-removal pass, which explicitly rounded these to
"₹0 L" per the request's own literal wording at the time) — this time with
the *right* fix (a unit-appropriate formatter) rather than either extreme
(decimals on a Lacs formatter, or a misleading whole-Lac zero).

**3. Found a real, previously-undetected bug while investigating #1's root
cause — the "by Format"/"by Category"/"by Denomination" breakdown charts
on Box Office and F&B were *also* silently showing gross, not net**, for a
subtler reason than the removed Heads Breakdown chart: they pre-filtered
out rows with `Format`/`Category`/`Denom = 'N/A'` before summing (a
reasonable-looking "exclude the meaningless bucket" filter) — but checked
directly against the cube: **every Cancel Redeem row `netHeadRows()`
attributes to Box Office or F&B carries exactly that 'N/A' value** on all
three fields (a cancellation transaction has no seating-tier Format, F&B
Category, or Denom of its own). So the filter was silently deleting 100%
of the netting correction, not just genuinely-missing metadata — Box
Office's "by Format"/"by Denomination" charts summed to ₹1,119-1,120L (the
gross figure) against the KPI's correct ₹1,023.50L net; F&B's "by
Category"/"by Denomination" summed to ₹1,748.29L gross against ₹1,432.74L
net. Same root cause as #1 (gross leaking back in through a second code
path), different mechanism (a metadata-cleanliness filter that
coincidentally erases the one correction that mattered).

**Checked whether this same pattern existed anywhere else before calling
it fixed** — grepped every page for `'N/A'`-filtering: found the identical
bug on **`Activation.jsx`'s own "by Denomination" chart** too (₹8,347.19L
shown vs. the page's real ₹8,266.57L Total Activation — a ₹80.61L gap,
this time from ~134 real correction/adjustment rows carrying
`Denom='N/A'`, not cancellation-attribution, but the identical class of
"exclude N/A, silently drop a real negative amount" bug). Also found the
same gap on **`Summary.jsx`'s shared `MetricComparisonCard`** for both its
Denomination *and* Card Type breakdown tables (Card Type buckets only
cover 'Digital'/'Physical', excluding the same 'N/A' correction rows).
Confirmed via direct grep that Region/Source/Head bucket sets never have
this problem — each is a complete partition of its field's raw values
(every row matches exactly one bucket), so there's no "N/A" case for those
dimensions to begin with.

**Fixed at two levels**: the 3 pages' own Format/Category/Denomination
charts (`Activation.jsx`, `RedemptionBoxOffice.jsx`, `RedemptionFnb.jsx`)
stopped pre-filtering — for `topNWithOther`-based charts (Format,
Category), simply not excluding 'N/A' lets it sort to the bottom (large
negative value) and fold into the existing "Other" bucket naturally, same
"real Other value + synthetic overflow both correctly land on the same
gray color" pattern already documented for `RedemptionFnb.jsx`'s Category
chart; for the fixed-11-bucket Denomination charts (no built-in "Other"),
added one explicitly. **`MetricComparisonCard.jsx` got the fix at the
component level instead of per-card**: appends a synthetic
`{key: 'Other', predicate: (r) => !buckets.some(b => b.predicate(r))}`
bucket to whatever `buckets` the caller passes, before running
`computeBucketComparisons()` — captures the gap generically for *any*
bucket set (not just Denomination/CardType), and
`computeBucketComparisons()`'s existing zero-amount filter means "Other"
silently doesn't render for the bucket sets that never needed it (Region/
Source/Head), no per-dimension special-casing required. This is the
"route through the shared calculation utility" fix the request explicitly
asked for, applied at the one place it could fix all 13 Summary cards
(and any future ones) at once.

**Verified against the raw cubes by hand first, then live in the app, for
every fix**: Box Office — KPI ₹1,023L, by Region/Format/Weekday/Denomination
all now sum to ₹1,023-1,024L (rounding noise only). F&B — KPI ₹1,433L, all
4 breakdown charts sum to ₹1,432-1,433L. Activation — KPI ₹8,267L,
Aggregators+Corporate+Cinema = ₹8,267L exactly, Denomination chart (with
new "Other" row, −₹81L) sums to ₹8,266L. Summary — Activation by
Denomination and Activation by Card Type breakdown tables both now include
an "Other" row (−₹81L) and both sum to the card's own ₹8,267L headline
exactly. Cancel Redeem — KPI ₹1,463L, "by Source"/"by Weekday" both sum to
₹1,462-1,463L; "by Region" intentionally doesn't (Cinema-only, Online
cancellations excluded, per its own subtitle — a documented scope
difference, not a bug). Card Journey — "Of Those, Redeemed" ₹6,695L
matches its own "by Head" chart (₹6,694L). Overview — Total Redemption
(net) ₹6,695L = Online ₹4,239L + Cinema ₹2,456L exactly, and Cinema
₹2,456L = Box Office ₹1,023L + F&B ₹1,433L exactly (an early check here
briefly looked broken — the Overview flow diagram has *two* "Cinema"
nodes, one on the Activation side's 3-source breakdown and one on the
Redemption side, and the first verification attempt's text match grabbed
the wrong one; re-scoped to the Redemption column specifically and
confirmed it reconciles perfectly — a test-script targeting mistake, not
an app bug, noted here so it isn't re-flagged). Overview's own combined
"Activation vs. Redemption by Denomination" chart still has a similar gap
by design (documented since 2026-08-03, doesn't correspond 1:1 to any
single KPI on that page — a cross-cube comparison, not a per-KPI
breakdown) — left untouched, flagged here rather than silently
reconciled to a fix it was never asking for. Zero console errors across
every page checked; clean production build (723.06 kB JS, 208.06 kB
gzipped).

## 2026-08-14 — Removed all chart captions app-wide; split Overview's region
charts into 4; on-bar totals for the two stacked "by Source" charts

Three-part request, verified against exact hand-supplied figures before
touching the UI.

**Chart captions removed app-wide**: every `<Card subtitle="...">` prop and
every post-chart italic caption `<p>` across all 8 pages (Overview,
Activation, Redemption · Box Office, Redemption · F&B, Trends, Cancel
Redeem, Card Journey, Summary) — ~30 `subtitle` occurrences plus 4 explicit
caption paragraphs (Box Office's "Combines Head='Box Office' with
Head='Online'..." note, Card Journey's "Teal = within the selected
period..." legend line, and F&B's Hero Products "No unit-count field..."
and "Static list..." notes). `MetricComparisonCard.jsx` (Summary's shared
card component) had its own `subtitle` prop and pass-through to `Card`
removed too, since every call site had already stopped passing one.
`Card.jsx` itself keeps the `subtitle` prop supported (harmless, unused) —
no call site anywhere in `src/` passes it anymore, confirmed by a
post-change repo-wide grep. Two small dead-code cleanups fell out of this:
Overview's `dayLabel`-driven daily-trend subtitle string and Card Journey's
`spilloverMonthsBeyond` counter both had no remaining use once their
subtitle strings were deleted, so removed rather than left dangling.
Deliberately **not** touched: `FilterBar.jsx`'s day-unavailable note and
`EmptyState.jsx`'s "no data" text — functional state messages, not
descriptive chart captions.

**Overview's "Activation by Region"/"Redemption by Region" split into 4
charts**, each answering exactly one question instead of mixing geography
with channel totals in one 6/8-bucket chart:
  - "Activation by Region" (5 bars, `ActivationModeFinal='Physical'` only)
    and "Redemption by Region" (6 bars, `RedemptionModeFinal='Physical'`
    only, including a real `NO_SITE` bucket) now use
    `ACTIVATION_REGION_BUCKETS`/`REDEMPTION_REGION_BUCKETS` sliced to just
    their first 6 (region-only) entries — reusing `lib/regionBuckets.js`'s
    existing predicates rather than a second hand-written copy.
  - New "Activation by Source" (3 bars: raw `ActivationModeFinal` values
    Aggregator/Corporate/Online, i.e. everything *except* Physical) and new
    "Redemption by Head" (4 bars: gross `Head` groupby, Online/Box
    Office/F&B/Cancellation — Cancellation stays negative, netting shown
    not hidden, same convention as the since-removed "Redemption Heads
    Breakdown" chart this now effectively relocates to Overview). Placed
    side by side in a new row directly below the region-charts row.
  - **`NO_SITE` relabel**: `lib/regionBuckets.js#redemptionRegionLabel()`
    changed from `"Director's Cut"` to `'Other/Unmapped'`. The prior label
    was an inferred identity (a Format-vocabulary pattern, documented in
    the file's own history) this repo has no outlet-level data to actually
    confirm — flagged as a placeholder that should say what the data says,
    not a guessed name. This function is shared with `Summary.jsx`'s
    "Redemption by Region" comparison table, so the fix applies there too
    with no separate edit.
  - Verified all 4 sets of figures against the raw cubes before touching
    the UI, then confirmed live, byte-for-byte: Activation by Region NORTH
    997/SOUTH 280/EAST 214/WEST 447/CENTRAL 2, sum ₹1,940L (target
    ₹1,939.97L); Redemption by Region adds Other/Unmapped ₹11L (target
    ₹10.94L), sum ₹2,456L (target ₹2,456.23L); Activation by Source
    Aggregator ₹4,255L/Corporate ₹1,958L/Online ₹114L, sum ₹6,327L (target
    4,254.87+1,957.53+114.2=6,326.6, and together with the region chart's
    ₹1,939.97L sums to the full ₹8,266.57L per the request's own check);
    Redemption by Head Online ₹5,290L/Box Office ₹1,119L/F&B ₹1,748L/
    Cancellation −₹1,463L, sum ₹8,157L gross-minus-cancellation nets to the
    target ₹6,695.32L. Zero console errors, no horizontal overflow on any
    of the 8 pages.

**On-bar total labels for stacked bar charts**: new
`ChartLabels.jsx#stackTotalLabel(data, keys)` factory — sums the named
stack keys for the row at `props.index` (same index-lookup pattern
`regionDeltaLabel` already used, since Recharts' `LabelList` strips
non-SVG props before calling a custom `content` renderer, so the row data
can't ride along as an extra prop) and renders the combined total above
the bar. Attached via `<LabelList content={stackTotalLabel(sourceChartData,
['digitalAmount', 'physicalAmount'])} />` on the **last-declared** `<Bar>`
in each stack (`physicalAmount`, which renders visually on top, so its own
`x`/`y`/`width` correspond to the top of the whole stack) — the Activation
page's "Activation by Source" chart (Aggregators ₹4,255L / Corporate
₹2,072L / Cinema ₹1,940L) and the Redemption · Box Office page's "Box
Office Redemption by Source" chart (Online ₹4,239L / Cinema ₹1,023L), both
confirmed live to show the bar's true combined total, not one segment,
alongside the existing legend/tooltip.

**Bug found and fixed while verifying "Redemption by Head" live, not
assumed from a code read**: the Cancellation bar (negative-valued) had its
label rendering directly on top of the bar and, at first, on top of the
X-axis category text too — `regionDeltaLabel` (`ChartLabels.jsx`) had only
ever been exercised against positive-valued bars before this chart existed.
Checked the actual rendered SVG (not assumed): for a negative-valued bar,
Recharts passes `y` as the bar's *bottom* edge already (further down the
screen) together with a *negative* `height` — so the existing `y - 6`
above-bar placement sat inside the bar, and a first fix attempt using
`y + height` walked back *up* to the zero line instead of down past the
bar (exactly backwards) since adding a negative height moves up, not down.
Fixed by branching on `value < 0`: negative bars anchor label position off
`y` directly (already the bottom edge) instead of `y + height`. Getting
enough clearance from the X-axis category labels below took a second
correction to the "Redemption by Head" chart's own layout (not the shared
label function) — `margin.bottom` 0 → 60, container `height` 280 → 320,
and `tickMargin={36}` on the XAxis — verified via 3 iterative screenshots
until the amount label, MoM label, and "Cancellation" axis tick text all
sat clear of each other with no overlap. `regionDeltaLabel` is shared by
several other charts (Activation/Redemption region and weekday charts) —
confirmed via a positive-value spot-check (Activation by Source's own
region chart) that the `value < 0` branch is additive, not a behavior
change for the positive case those charts all use.

Zero console errors across all 8 pages both before and after the label
fix; clean production build (722.01 kB JS, 207.21 kB gzipped).

## 2026-08-14 — Follow-up: moved the NO_SITE bucket from "Redemption by
Region" to "Redemption by Head" as "Director's Cut"; dropped Cancellation

Same-day follow-up to the region/head chart split above. Two bucket
constants in `Overview.jsx` changed, both still built on top of the same
shared `lib/regionBuckets.js` predicates rather than new hand-written ones:

- **`REDEMPTION_REGION_ONLY_BUCKETS`**: `REDEMPTION_REGION_BUCKETS.slice(0,
  6)` → `.slice(0, 5)` — drops the 6th (NO_SITE) entry, leaving just the 5
  named regions. "Redemption by Region" now reads NORTH/SOUTH/EAST/WEST/
  CENTRAL only, ₹2,445L (was ₹2,456L with NO_SITE included).
- **`REDEMPTION_HEAD_BUCKETS`**: rewritten from a plain `HEAD_ORDER.map()`
  passthrough (4 buckets: Online/Box Office/F&B/Cancellation) to an
  explicit 4-bucket list that (a) drops Cancellation entirely — this chart
  no longer shows the netting, gross-only heads — and (b) adds a
  `"Director's Cut"` bucket carrying the NO_SITE rows just removed from the
  region chart, so the same data moved rather than being duplicated or
  dropped. To avoid double-counting, Box Office/F&B's own predicates now
  explicitly exclude `Region_Clean='NO_SITE'` (`r.Head === 'Box Office' &&
  r.Region_Clean !== 'NO_SITE'`, same for F&B), with Director's Cut picking
  up exactly those excluded rows (`(Head='Box Office' || Head='F&B') &&
  Region_Clean='NO_SITE'`) — the 4 buckets still partition Head ∈ {Online,
  Box Office, F&B} exactly, Cancellation rows are simply excluded from
  every bucket now, by design.
- **Naming**: the request explicitly asked for the label "Director's Cut"
  here — a reversal, on this one bucket, of the earlier same-day decision
  to rename this exact NO_SITE identity to "Other/Unmapped" on the region
  chart (that entry's own reasoning — no outlet-level data in this repo to
  independently confirm the identity — still stands as a documented
  caveat, but the user directly specified the label to use this time, so
  implemented as asked rather than re-litigated).
- **Color**: `HEAD_COLORS` has no entry for `"Director's Cut"` (it's not a
  real `Head` value), so the chart's `<Cell>` fallback changed from
  `categoricalColor(0)` (gold — which would have collided with the
  adjacent Box Office bar's own gold) to `HEAD_COLORS.Cinema` (plum) — the
  existing "not a real Head value" rollup color already used for the
  Overview flow diagram's own Cinema node, and not otherwise in use among
  Online(blue)/Box Office(gold)/F&B(teal) on this chart.
- **Layout reverted**: the extra `margin.bottom`/`tickMargin`/container
  `height` bump added earlier the same day specifically to clear the
  negative Cancellation bar's label from the X-axis text is no longer
  needed — every bucket on this chart is positive again — so
  `margin={{ top: 36, right: 8, left: 0, bottom: 0 }}` and `height={280}`
  were reverted to match every sibling chart on the page.
- **Dead import cleanup**: `HEAD_ORDER` (`lib/constants.js`) was only used
  by the old bucket definition; removed from `Overview.jsx`'s import line
  since nothing else in the file references it.

**Verified against the raw cube by hand first** (a discrepancy was
expected and confirmed, not a bug): the region chart's old NO_SITE figure
(₹10.94L) was the *whole* Physical+NO_SITE slice of the cube, including
Cancellation's own NO_SITE rows (a real −₹3.90L, confirmed directly);
Director's Cut, scoped to Head='Box Office'/'F&B' only per the request,
correctly excludes those and comes out to **₹14.84L** instead (₹6.66L
Box Office + ₹8.18L F&B), a different, larger, and equally correct number
now that Cancellation is out of scope for this bucket entirely — checked
by hand against `redemptionCube.json` directly, not assumed from the old
figure. Region chart: 5 regions sum to ₹2,445.30L (2,456.23 − 10.94, i.e.
exactly the removed NO_SITE amount). Head chart: Online ₹5,290.38L + Box
Office (NO_SITE-excluded) ₹1,112.57L + F&B (NO_SITE-excluded) ₹1,740.12L +
Director's Cut ₹14.84L = ₹8,157.91L — confirmed live in the app to the
rupee (displayed, rounded: ₹5,290L/₹1,113L/₹1,740L/₹15L). Screenshotted
both charts: region chart shows exactly 5 bars with no "Other/Unmapped";
head chart shows exactly 4 positive bars (Online/Box Office/F&B/Director's
Cut) with no Cancellation bar and no negative axis range. Zero console
errors across all 8 pages; clean production build (722.26 kB JS, 207.25 kB
gzipped).

## Deployment

GitHub → Vercel, auto-deploy on push to `main`. `vercel.json` has the SPA
rewrite (`/(.*)` → `/index.html`) since routing is `BrowserRouter`, not
hash-based. See README.md for the exact push/import steps.

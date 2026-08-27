# Hygiene Notes — Overview / Channel Performance / Card Journey

Findings from a code-hygiene audit (2026-08-30) of the 3 currently-enabled
pages. None of these are correctness bugs — every number these pages
display has already been independently verified against the raw data
cubes (see CLAUDE.md). These are maintainability/consistency items only:
dead code, logic duplicated instead of reused from `lib/`, stale
comments, and inconsistent conventions. Nothing here has been fixed yet —
this file is a working list to pick items off of, not a log of completed
work (that's what CLAUDE.md is for, once something here is actually
done).

Status legend: `[ ]` open · `[x]` done (move the note to CLAUDE.md when
checked off, and delete the line here or mark it done — don't let this
file and CLAUDE.md both claim the same fix).

## Channel Performance (`src/pages/ChannelPerformance.jsx`)

- [ ] **Duplicated `pctChange()`** (lines 38-41) — a local copy of the
  exact function already exported from `lib/comparisons.js` (which was
  extracted specifically to kill this duplication, per its own doc
  comment) — this file never switched over to import it. Low-risk,
  mechanical fix: delete the local function, import the shared one,
  confirm no behavior change.
- [ ] **`ContributionCard`'s breakdown panel duplicates `Kpi.jsx`'s
  breakdown markup verbatim** (lines ~176-192) — now used 3× on this page
  (1 `Kpi` breakdown call + 2 `ContributionCard` calls) with identical
  `{label, value, deltaPct}` shape. Worth extracting into one shared
  `KpiBreakdown` sub-component both `Kpi.jsx` and this file render, so a
  future style tweak can't land on only 2 of the 3 call sites.
- [ ] **Stale comment ordering** (~line 407-ish, may have shifted after
  recent edits) — a comment says "same reasoning as `giftCard`/
  `giftCardTotal` above," but those two are defined *below* this comment,
  not above. Harmless but confusing; one-line fix.
- [ ] **Inconsistent line-chart styling** across the 4 sibling trend
  charts, no documented reason for the split: the two Penetration Trend
  charts use `strokeWidth={3}` / `activeDot r=6` / rotated every-month
  XAxis (`interval={0} angle={-45}`, tick fontSize 9); the Raw Trend and
  Monthly Trend charts use `strokeWidth={2.5}`/`{2}` / `activeDot r=5` /
  flat every-other-month XAxis (`interval={1}`, tick fontSize 10). All 4
  plot the same 28-month range.
- [ ] **Hardcoded `colSpan={7}`** in 3 places instead of derived from the
  header's own column count. Given this table's columns have already
  changed several times in rapid succession, a future column add/remove
  is one easy-to-miss edit away from breaking a spanning row. Fix: a
  `COMPARISON_TABLE_COLS` constant (or compute from `ComparisonHeaderRow`'s
  own children) reused at all 3 sites.
- [ ] **Zero-shown-channels edge case renders "0.00 L" instead of "—"** —
  when "Channels Shown" resolves to nothing selected, `monthSections`/
  `overallSection`/`fullYearTables` all reduce to `0` and render as a real
  (misleading) zero, breaking this page's own established "blank, not
  zero, for absent data" convention (see e.g. `fullYearTables`' own doc
  comment). Fix: guard these 3 computations to return `null` (not `0`)
  when `shownChannels.length === 0`, so `fmtCountOrDash`'s existing
  null → "—" path kicks in.

## Overview (`src/pages/Overview.jsx`)

- [ ] **Dead import**: `redemptionModeOf` (near the top imports) is
  imported but never called directly in this file — confirmed used
  downstream in `lib/regionBuckets.js`, but Overview itself has no call
  site. Remove the import.
- [ ] **`netHeadRows()` computed twice for the same 3 heads** —
  `uptakeTicketFnb` and `totalTransactionValueTicketFnb` each
  independently call `netHeadRows(redemptionRows, 'Box Office'/'Online'/
  'F&B')`, redoing the same netting work (including rebuilding the
  internal winner-map) twice per render. Fix: compute the 3 net-head row
  sets once, feed both `useMemo`s from that shared result.
- [ ] **Duplicated 3-line region-filter pattern** — `dailyActByRegion` and
  `dailyRedByRegion` both end with the identical
  `orderBy(rows.map(...), REGION_ORDER).map(...).filter(...)` shape,
  differing only in the field name. Small, but a candidate for a 1-line
  shared helper.
- [ ] **4× near-identical "merge two cubes' groupSums" pattern** —
  `yoyByFY`, `denominationSplit`, `monthTrend`, `weekdayTrend` each
  hand-roll the same "groupSum both cubes → union keys → `.find()` lookup
  with `|| 0` fallback" merge. `lib/aggregate.js#pivot()` doesn't cleanly
  fit (different field names per cube), so this isn't a strict "use the
  lib helper" fix — but a local helper extracting the common shape would
  remove real self-duplication.
- [ ] **Stale comment**: says "5 physical-cinema regions" but
  `ACTIVATION_REGION_ONLY_BUCKETS` is actually a 6-entry slice (includes
  NO_SITE). Update the comment's count, or double check whether the 6th
  bucket is intentionally always-zero-filtered and note that instead.
- [ ] **Inconsistent `HEAD_COLORS` fallback** — one chart falls back to
  `HEAD_COLORS.Cinema` (plum) for an unrecognized head, while every other
  `HEAD_COLORS` lookup on the page falls back to the neutral
  `COLORS.inkMuted`. Currently unreachable (the bucket set used there only
  ever produces heads that exist in `HEAD_COLORS`), but a latent
  inconsistency — align the fallback for safety.
- [ ] **Two undocumented one-off style divergences**: one chart's XAxis
  uses `fontSize: 12` where every sibling uses `11`; one LineChart's
  margin (`{ top: 8, right: 16, left: 0, bottom: 0 }`) diverges from every
  sibling BarChart's margin convention. Either document the reason or
  align them.
- [ ] **Magic number `0.03`** (slice-suppression threshold in a pie-label
  helper) duplicated from `ChartLabels.jsx`'s `donutLabel` because the
  latter isn't exported. Risk: tuning one without the other silently
  desyncs suppression behavior. Fix: export the threshold (or the whole
  helper) from `ChartLabels.jsx` and import it here.

## Card Journey (`src/pages/CardJourney.jsx`)

- [ ] **`netHeadRows()` re-derived 9 separate times**, each rebuilding the
  internal winner-map from scratch, instead of the one-call
  `netRedemptionHeads()` helper `Overview.jsx` already uses for the
  identical Online/Box Office/F&B netting. Fix: switch these 9 call sites
  to source from one shared `netRedemptionHeads(cohortRowsForNetting)`
  call, mirroring Overview's own `positiveHeads` pattern.
- [ ] **"Additional Revenue" KPI is missing a `sub` percentage line** that
  its structural twin on Overview has (`"Additional Revenue is X% of
  Redemption"`) — every other intentional deviation from Overview's own
  pattern in this file has a comment explaining why; this one doesn't.
  Either add the equivalent `cohortUptake`/`redeemedAmount` percentage
  line, or add a comment explaining why it's intentionally omitted here.
- No dead code and no stale comments found in this file (checked
  specifically for "Unredeemed Balance" leftovers from the Breakage
  rename — the only hits are correctly-labeled historical doc comments,
  not live code).

## Suggested order, if tackling these

1. Channel Performance's `pctChange()` dedup and the zero-shown-channels
   dash fix — small, mechanical, real correctness-adjacent value.
2. Overview's dead import and the double `netHeadRows()` computation, and
   Card Journey's 9× `netHeadRows()` re-derivation — same class of fix,
   worth doing together since they touch the same shared helper.
3. The stale comments (quick, low-risk).
4. The shared `KpiBreakdown` extraction and the two "merge two cubes"
   local-helper extractions — larger refactors, worth doing with a bit
   more care/testing since they touch rendering in multiple places.
5. Styling-consistency items (chart stroke widths, axis font sizes,
   margins, `HEAD_COLORS` fallback) — lowest priority, mostly a matter of
   taste rather than a real risk.

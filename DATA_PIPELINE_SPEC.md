# PVR INOX Gift Card Dashboard — Data Processing Specification
## Complete, literal reference for reproducing the pipeline from raw source files to output cubes

Status legend used throughout this doc: **[VERIFIED]** = confirmed against real data with a reproducible check. **[DECISION]** = an explicit rule the user specified. **[INFERRED]** = a judgment call made without explicit user confirmation — flagged so a reviewer knows to double-check it.

---

## 1. RAW COLUMN DEFINITIONS

Source: monthly Excel files named `Issuer_Transaction_Detailed_Report_<Mon>_<YY>.XLSX`, one row per gift-card transaction event. 34 columns, in this exact order:

| # | Column name | Type | Meaning / notes |
|---|---|---|---|
| 1 | `CardNumber` | 16-digit integer, stored as int64 in source | Unique physical/digital card identifier. **[QUIRK]** When exported to CSV and opened in Excel, gets auto-converted to scientific notation and rounded (loses precision past 15 significant digits) — must be written as text/string type in any Excel output. |
| 2 | `BookletNumber` | usually blank | Not used in this pipeline. |
| 3 | `Merchant` | string | Observed values: `PVR Cinemas`, `GiftBig`, `Amazon`, `PVR Director Cut`, `Inox` (legacy, only 26-Jul-2024 to 22-Nov-2024), `Woohoo-Darwinbox` (excluded, see Section 2). |
| 4 | `Outlet` | string | Specific outlet code/name. Key values: `PVR Inox Online` (the single outlet used for all online activity), `PVR-Corporate`, `PVR Cinemas-Corporate-QC-RBM`, `GB-DB-Corp`, `GB-RD-CORPORATE`, or an actual cinema name. Some outlets have a `-INACTIVE` suffix (decommissioned cinemas, still appear in historical data). |
| 5 | `Descriptive_Outlet_Name` | string | Not used in this pipeline. |
| 6 | `Region` | string | Raw region tag — inconsistent, needs cleanup. See Section 3.4. |
| 7 | `Issuer` | string | Always `PVR Cinemas` in observed data. Not used. |
| 8 | `TransactionDate` | string, format `DD/MM/YYYY` (some files) or ISO `YYYY-MM-DD` (files loaded via calamine sometimes auto-parse to datetime) | **[QUIRK]** Format is inconsistent across files/loaders — always parse with `pd.to_datetime(..., format='mixed', dayfirst=True)`. |
| 9 | `TransactionTime` | string, `HH:MM:SS` | Used as a tiebreaker for chronological sort within a card. |
| 10 | `POSName` | string | Not used — Outlet is sufficient. |
| 11 | `InitiatedBy` | string | Not used — redundant with ProgramGroup for our purposes. |
| 12 | `ProgramGroup` | string | The specific gift-card product name. Drives exclusion rules (Section 2) and CardType classification (Section 3.1). **[QUIRK]** Raw header sometimes has a BOM character prefix (`\ufeff"CardNumber"`) — strip when reading. |
| 13 | `TransactionType` | string | One of: `GIFT CARD ACTIVATE`, `GIFT CARD REDEEM`, `GIFT CARD CANCEL ACTIVATE`, `GIFT CARD CANCEL REDEEM`, `GIFT CARD DEACTIVATE`, `GIFT CARD RELOAD`, `REACTIVATE`, `RESET CARD PIN`, `UPDATE EXPIRY`. |
| 14 | `CurrencyConvertedAmount_Base_Currency_Or_Points` | numeric, string with commas (e.g. `"1,800.00"`) | **[DECISION]** Not used — user directed to use column 15 instead. |
| 15 | `Amount_Transacting_Merchants_Currency_Or_Points` | numeric, string with commas | **THE primary amount field.** Negative for money leaving the card (Redeem), positive for money entering/reversing (Activate, Cancel Activate, Cancel Redeem). Must parse via `pd.to_numeric(s.str.replace(',', ''))`. |
| 16 | `BillAmount_Transacting_Merchants_Currency_Or_Points` | numeric, string with commas, often blank | Total bill value for a redemption, when captured (see Uptake, Section 4.1). Blank for ~100% of online (Outlet=PVR Inox Online, no POS-type tag) redemptions and for non-redeem transaction types. |
| 17 | `InvoiceNumber` | string | Not used. |
| 18 | `ResponseMessage` | string | Always `"Transaction successful."` in observed data (no failed transactions present). Not used further. |
| 19 | `DateAtClient` | string | Not used. |
| 20 | `TimeAtClient` | string | Not used. |
| 21 | `PreTransactionCardBalance_BaseCurrency_Or_Points` | numeric string | Card balance immediately before this transaction. Used only for spot-checking/verification, not in the main cube pipeline. |
| 22 | `TransactionMode` | string, only 2 values: `PROXY` or `ONLINE` | **[QUIRK — do not use as an online/offline channel indicator.]** Verified: 100% of `GIFT CARD REDEEM` rows show `ONLINE` regardless of whether the redemption happened at a physical cinema or the website. It reflects something like real-time-authorization vs. batch/manual entry, not customer channel. The correct online/offline indicator is `Outlet == 'PVR Inox Online'` vs. anything else. |
| 23 | `AdjustmentAmount_Transacting_Merchants_Currency_Or_Points` | numeric | Not used. |
| 24 | `TransactionPostDate` | string | Not used. |
| 25 | `CardBalance_BaseCurrency_Or_Points` | numeric string | Card balance immediately after this transaction. Used for verification only. |
| 26 | `ExpiryDate` | string | Card's expiry date as of this transaction — dynamic, can change via `UPDATE EXPIRY`/`REACTIVATE` events. **[DECISION]** No fixed validity period is assumed; whatever the latest value says is authoritative. |
| 27 | `ReferenceNumber` | string | **[QUIRK] Not reliable as a unique key** — many rows share placeholder values like `"1"` or small repeated integers. Use `ApprovalCode` instead. |
| 28 | `OriginalCardNumberBeforeReissue` | always blank in observed data | Not used. |
| 29 | `CorporateName` | string, blank for most rows | Populated only when a card is linked to a specific corporate account. Not used directly in current pipeline logic (superseded by ActivationModeFinal's Corporate detection via Outlet). |
| 30 | `CardEntryMode` | string, always `Manual` in observed data | Not used. |
| 31 | `BatchNumber` | string | Not used. |
| 32 | `Notes` | string, structured pseudo-JSON like `{TRANS Type~{Tender Type~Gift|POS Type~F&B}{MasterItemCode~...|Item Name~...|Amount~...|Quantity~...}}` | Source of Ticket/F&B classification (Section 3.5), Format (Section 3.9), Category (Section 3.10). Format varies: in-cinema transactions have full detail; online (`Outlet=PVR Inox Online`) transactions typically show only `Tender Type~Gift` with no further breakdown. |
| 33 | `ApprovalCode` | numeric string | **THE reliable unique transaction key within a single file/batch.** **[QUIRK]** NOT globally unique across the full 28-month span — 17,698 collisions found when combining the original 24-month batch with the 4 newer months. Always deduplicate (`drop_duplicates('ApprovalCode', keep='first')`) before merging lookup tables built from different file batches. |
| 34 | `UNIVERSALPRODUCTCODE` | always blank in observed data | Not used. |

---

## 2. EXCLUSION RULES

Applied in this order. A row matching ANY rule below is excluded from all "kept" data used in every downstream cube.

```python
EXCLUDED_PROGRAM_GROUPS = {
    'PVR INOX Prepaid Gift Card',      # separate cafeteria/stored-value product, not a real gift card [VERIFIED: RELOAD txns 100% belong here]
    'PVR Cinemas Credit Limit Card',   # unrelated staff/corporate credit facility
    'PVR INOX Staff egift card',       # internal staff product, not customer-facing
}
# NOTE: 'PVR INOX Prebuy egift card' was excluded here from an earlier build through
# 2026-08 reprocessing. REVERSED 2026-09 - see "Reversed Decisions" log at the end of
# this document for full reasoning. It is now a normal kept row, classified via Section
# 3.1's Aggregator-aware CardType rule - NOT re-added to this exclusion set.

# Rule A - ProgramGroup exclusion
row.Excluded = True  if row.ProgramGroup in EXCLUDED_PROGRAM_GROUPS

# Rule B - Merchant noise
row.Excluded = True  if 'Woohoo' in str(row.Merchant)   # case-insensitive contains
    # covers Merchant == 'Woohoo-Darwinbox' and Outlet == 'Woohoo-Darwinbox-Corporate'
    # [VERIFIED: zero rows in the 4 newest (2026) files - legacy-only, small volume]

# Rule C - GIFT CARD RELOAD transaction type
row.Excluded = True  if row.TransactionType == 'GIFT CARD RELOAD'
    # [VERIFIED] Redundant rule: ALL 202,942 original RELOAD rows already belonged to
    # ProgramGroup in {'PVR INOX Prepaid Gift Card', 'PVR Cinemas Credit Limit Card'} -
    # i.e. Rule A already excludes them. This rule is kept for defensive completeness
    # in case a future month's RELOAD rows fall outside those ProgramGroups.

# Rule D - August 2024 fraud/scam anomaly (one-time historical event, NOT a permanent rule)
row.Excluded = True  if (
    row.TransactionDate is in August 2024
    AND row.Outlet == 'PVR Inox Online'
    AND row.Merchant == 'PVR Cinemas'
)
    # [VERIFIED] Bulk fraudulent online activations (~87,573 rows), heavily concentrated
    # on 4-Aug-2024 (80,221 of them alone). Confirmed: online gift-card ACTIVATION was
    # permanently discontinued after this - zero online activations exist in the data
    # for any month after August 2024. Online REDEMPTION continues normally.
    # [DECISION] Excludes the WHOLE month's online-PVR activity, not just the spike,
    # including its Redeem/Cancel-Redeem rows for that channel that month.

# Rule E - September 2024 cleanup of the August anomaly
row.Excluded = True  if (
    row.TransactionDate is in September 2024
    AND row.Outlet == 'PVR Inox Online'
    AND row.Merchant == 'PVR Cinemas'
    AND row.TransactionType == 'GIFT CARD CANCEL ACTIVATE'
)
    # [VERIFIED] 82,681 rows, of which 75,343 (94%) match card numbers from the
    # August 4th spike exactly - this is the system's own reversal of the fraud.
```

**One-time file-level fix, not a per-row exclusion rule:** the raw file `9_Issuer_Transaction_Detailed_Report_Jan_26.XLSX` was found to contain **all of January, February, and March 2026 combined** (696,560 rows) rather than just January - duplicating the separately-supplied Feb_26 and Mar_26 files exactly (verified via 100% `ApprovalCode` match). **[DECISION]** Fix: filter this specific file to `TransactionDate` starting with `2026-01` **before** any other processing, keeping only the genuine 229,548 January rows.

---

## 3. CLASSIFICATION / BUCKETING RULES

### 3.1 CardType (Digital vs. Physical)

**[REVISED 2026-09]** Superseded the original flat-list approach. Root cause of the original bug: a simple `ProgramGroup in DIGITAL_PROGRAM_GROUPS` check requires manually re-adding every new digital-named ProgramGroup as one appears — and worse, doesn't help at all when a genuinely digital product gets excluded from the dataset entirely (as Prebuy was) rather than merely misclassified. The current rule is channel-aware and self-extending for any *future* new ProgramGroup name appearing under an Aggregator source, without requiring another manual list edit.

**Investigation that grounded this fix:** checked every raw file for `Merchant IN (Amazon, GiftBig) AND TransactionType = 'GIFT CARD ACTIVATE'` and confirmed there are exactly 6 distinct ProgramGroup values ever observed under this source across all 29 months: `QC-EGC-PVR-VAR`, `QC-MGC-PVR-VAR`, `QC-PVR-VAR`, `PVR INOX Hubble eGift Card`, `PVR INOX Prebuy egift card` — all digital — and exactly one genuine exception, `PVR INOX Gift Card` (a plain physical-product name), which appeared under GiftBig/Amazon in a single 938-row batch, all dated 2025-05-30 (a one-off bulk physical-card order fulfilled through the aggregator channel). No other ProgramGroup name has ever appeared under this source.

```python
DIGITAL_PROGRAM_GROUPS = {
    'QC-EGC-PVR-VAR', 'PVR INOX eGift Card', 'PVR INOX Hubble eGift Card',
    'PVR RBM NPCI eGift Card', 'PVR E Gift Card', 'PVR Cinemas Digital Gift Card',
    'PVR INOX Prebuy egift card',   # [ADDED 2026-09, see Reversed Decisions log]
    'QC-MGC-PVR-VAR',   # [INFERRED] not literally named "eGift", classified Digital
                        # because it only ever appears under Aggregator source.
    'QC-PVR-VAR',       # [INFERRED] same reasoning as QC-MGC-PVR-VAR above.
}

# Confirmed exception: the ONLY ProgramGroup ever observed under an Aggregator source
# that is genuinely Physical. All 938 occurrences fall on a single date (2025-05-30).
KNOWN_PHYSICAL_UNDER_AGGREGATOR = {'PVR INOX Gift Card'}

def card_type(program_group, merchant, outlet):
    is_aggregator_source = merchant in ('Amazon', 'GiftBig') or outlet in ('GB-DB-Corp', 'GB-RD-CORPORATE')
    if is_aggregator_source:
        if program_group in KNOWN_PHYSICAL_UNDER_AGGREGATOR:
            return 'Physical'
        else:
            return 'Digital'   # default for Aggregator source - catches any future/new
                                # ProgramGroup name automatically, not just today's known set
    else:
        return 'Digital' if program_group in DIGITAL_PROGRAM_GROUPS else 'Physical'
```

**Why this doesn't retroactively change any previously-correct row:** every ProgramGroup ever seen under a non-excluded Aggregator source, other than Prebuy and the one-off 938-row exception, was already in `DIGITAL_PROGRAM_GROUPS` before this change — so the new default only ever fires for Prebuy (now un-excluded) and would fire identically for any unseen future name. Verified: this rule produces byte-identical classification to the old rule for every row that was already kept in the dataset before this change.

**Applies to** `GIFT CARD ACTIVATE` rows using that row's own `ProgramGroup`/`Merchant`/`Outlet`. **Bug fixed (separately, earlier):** `GIFT CARD CANCEL ACTIVATE` rows must ALSO get this same classification from their own fields (not hardcoded to a placeholder) — an earlier version incorrectly forced `CardType='N/A'` on these rows, causing a spurious negative "Other" bucket in downstream charts (verified: -Rs.80.65 Lacs / 164-165 rows, exactly matching Cancel Activate volume).

Verified real proportions by source: Aggregator approx 99.7% Digital / 0.3% Physical; Corporate approx 87.5% Digital / 12.5% Physical; Cinema (Physical source) approx 98.1% Physical / 1.9% Digital.

### 3.2 ActivationModeFinal (activation-side channel, checked in this exact priority order)

```python
def activation_mode(Outlet, Merchant):
    if 'Corporate' in str(Outlet):
        return 'Corporate'
    elif Merchant in ('Amazon', 'GiftBig') or Outlet in ('GB-DB-Corp', 'GB-RD-CORPORATE'):
        return 'Aggregator'
        # [DECISION] GB-DB-Corp / GB-RD-CORPORATE fold into Aggregator despite the
        # "Corporate"-sounding name, because "GB" = GiftBig.
    elif Outlet == 'PVR Inox Online':
        return 'Online'
        # Only ever populated for Apr-Jul 2024 in kept data (Aug 2024 excluded, and
        # zero online activations exist in any month after that).
    elif Merchant == 'PVR Director Cut':
        return "PVR Director's Cut"
        # [VERIFIED] Negligible on activation side - only 24 rows total across 28
        # months. This Merchant/category is overwhelmingly a REDEMPTION-side format
        # tag (23,000+ rows), not a real activation source.
    else:
        return 'Physical'
```

**[VERIFIED]** `Outlet = 'PVR-Corporate'` and `Outlet = 'PVR Inox Online'` are both 100% North region, zero exceptions, across all 28 months.

**[DECISION] "3-source" simplification used on some dashboard views:** Corporate = union of (`ActivationModeFinal == 'Corporate'`) + (`ActivationModeFinal == 'Online'`), since Online activation is dead and PVR-Corporate/PVR Inox Online together represent the Corporate channel's activate/redeem split (see Section 3.3 note on the outlet-label duality).

### 3.3 RedemptionModeFinal (redemption-side channel)

```python
def redemption_mode(Outlet):
    return 'Online'  if Outlet == 'PVR Inox Online'  else 'Physical'
```

Applied only to `GIFT CARD REDEEM` and `GIFT CARD CANCEL REDEEM` rows.

**[VERIFIED, critical distinction]** Redemption only has these 2 real values - **Aggregator has zero redemption channel of any kind** (`Merchant IN (Amazon, GiftBig) AND TransactionType = REDEEM` is always an empty set, verified with no exceptions).

**[DECISION] UI-label duality:** the same `Outlet = 'PVR Inox Online'` value is labeled **"Online"** on activation-side displays but **"Corporate"** on redemption-side displays (since Corporate-activated cards get redeemed there). The underlying field value is always `'Online'`/`'Physical'` - this is a display-layer relabeling only, not a change to the stored value.

### 3.4 Region_Clean

```python
REGION_MAP = {
    'WORLI': 'WEST', 'SECTOR 49': 'NORTH', 'SHAHDARA': 'NORTH',
    'CENTARL': 'CENTRAL',   # typo fix
    'GURGAON': 'NORTH', 'EJIPURA': 'SOUTH', 'MADHAPUR': 'SOUTH', 'PUNE': 'WEST',
    'CENTRAL': 'CENTRAL', 'NORTH': 'NORTH', 'SOUTH': 'SOUTH', 'EAST': 'EAST', 'WEST': 'WEST',
}
# 'CENTRAL' region == Madhya Pradesh only. [DECISION, user-confirmed.]

Region_Clean = REGION_MAP.get(raw_Region.strip(), 'NO_SITE')
    # NO_SITE = blank / unmapped raw values - mostly GiftBig/Amazon aggregator
    # backend codes with no physical cinema attached.

# Post-processing fix, REDEMPTION SIDE ONLY, applied after the map above:
if Region_Clean == 'NO_SITE':
    Region_Clean = "Director's Cut"
    # [DECISION] Traced root cause: 2,722 redemption rows tagged NO_SITE, of which
    # 2,596 are genuinely Director's Cut branded (Outlet='PVRDC-MAINSTREAM-
    # SELECTCITYWALK', Merchant='PVR Director Cut'). The remaining 126 rows are
    # decommissioned regular Inox cinemas (4 different '-INACTIVE' outlets in
    # Lucknow/Gurugram/Salem) that happen to also lack a region tag - NOT actually
    # Director's Cut branded. [INFERRED/ACCEPTED SIMPLIFICATION] User explicitly
    # accepted bucketing all of these as "Director's Cut" given the tiny combined
    # magnitude (~Rs.11 Lacs total) rather than region-mapping the 126 separately.
# This relabel is NOT applied on the activation side - NO_SITE stays NO_SITE there
# (small volume, mostly genuine aggregator-backend rows with no equivalent fix defined).
```

### 3.5 Ticket_FnB (redemption content classification)

```python
def ticket_fnb(Notes):
    if 'POS Type~F&B' in str(Notes):
        return 'F&B'
    else:
        return 'Ticket'   # covers explicit 'POS Type~BOXOFFICE' AND blank/untagged Notes
```

**[DECISION]** Blank/untagged Notes defaults to Ticket. Applies uniformly whether the redemption happened online or in-person. Only computed for `TransactionType == 'GIFT CARD REDEEM'` rows.

### 3.6 Head (redemption bucket used for KPIs/charts)

```python
def head(RedemptionModeFinal, Ticket_FnB, TransactionType):
    if TransactionType == 'GIFT CARD CANCEL REDEEM':
        return 'Cancellation'
    elif RedemptionModeFinal == 'Online':
        return 'Online'
    elif Ticket_FnB == 'Ticket':
        return 'Box Office'
    else:
        return 'F&B'
```

### 3.7 Denomination (final, current scheme - supersedes 2 earlier schemes, see note below)

```python
def denomination(amt):
    amt = abs(amt)   # Cancel Activate/Cancel Redeem carry negative amounts;
                      # bucket by face value, not signed value.
    if amt < 300:            return '0-299'
    if amt == 300:            return '300'
    if 300 < amt < 500:       return '301-499'
    if amt == 500:            return '500'
    if 500 < amt < 1000:      return '501-999'
    if amt == 1000:           return '1000'
    if 1000 < amt < 2000:     return '1001-1999'
    if amt == 2000:            return '2000'
    if 2000 < amt < 5000:     return '2000+'
    if 5000 <= amt < 10000:   return '5000+'
    if amt >= 10000:          return '10000+'
    # No 'Other' fallback should ever trigger with these bounds - they are
    # continuous over [0, infinity) with no gaps. [VERIFIED: 0 rows fall through after fix.]
```

**Applied to:** the card's own `NetActivationAmount` (see Section 4.3), NOT the individual redemption transaction amount. **[DECISION, explicitly confirmed]** - bucketing by activation face value (not redemption amount) is intentional so Activation and Redemption sides of the Denomination chart represent the *same underlying cards*, not arbitrarily-sized transactions. A card can be redeemed across several smaller transactions that individually don't match its denomination - the denomination label follows the card, not each transaction.

**Card-level override for true "never-activated-in-window" cards:**
```python
if card.ActivationMode is null (i.e. the card has zero GIFT CARD ACTIVATE rows anywhere in the 28-month window):
    Denom = 'Unknown (pre-existing)'
else:
    Denom = denomination(card.NetActivationAmount)
```
**[BUG FIXED]** An earlier version used `NetActivationAmount` directly without this null-check; since `NetActivationAmount` for a truly pre-existing card defaults to a residual value from a stray Cancel-Activate artifact (or, in an even earlier version, was zero-filled), this silently misclassified ~137,903 cards instead of honestly labeling them unknown.

**Applied to BOTH `GIFT CARD REDEEM` and `GIFT CARD CANCEL REDEEM` rows** (via the same per-card lookup) - an earlier version hardcoded `Denom='N/A'` on Cancel Redeem rows specifically, causing all cancellations to collect into one large negative reconciling "Other" bucket instead of netting into their card's real denomination bucket. **[VERIFIED FIXED]**: after the fix, 0 rows have Denom in `{'Other', 'N/A'}`.

**Superseded schemes (for historical reference only, DO NOT use):**
- V1: exact ties {300,500,1000,1500,2000,2500,5000} + catch-all "Other / Custom" - abandoned, too coarse.
- V2: {300,500,1000,2000} + range buckets {2000+, 5000+, 10000+} + "Other/Custom" catch-all, with **boundary gap bug**: values like Rs.499.82, Rs.999.41, Rs.1999.34 fell into a gap between adjacent buckets (e.g. `amt <= 499` then `amt == 500` leaves 499 < x < 500 uncovered). Fixed in the current continuous-range version above.

### 3.8 ActivationYearMonth / ActivationCohort (redemption-side, tracing back to the card's origin)

```python
ActivationYearMonth = card's earliest GIFT CARD ACTIVATE TransactionDate, formatted 'YYYY-MM'
    # 'Pre-existing (activated before Apr 2024)'  if no ACTIVATE row exists for this card

AgeMonths = (redemption.year - activation.year)*12 + (redemption.month - activation.month)

def activation_cohort(AgeMonths):
    if AgeMonths is null:       return 'Pre-existing (activated before Apr 2024)'
    if AgeMonths <= 0:          return 'Same month'
    if AgeMonths <= 3:          return '1-3 months ago'
    if AgeMonths <= 6:          return '4-6 months ago'
    if AgeMonths <= 9:          return '7-9 months ago'
    if AgeMonths <= 12:         return '10-12 months ago'
    else:                       return '12+ months ago'
```
Cancel Redeem rows get `ActivationCohort = 'N/A (cancellation)'`.

### 3.9 Format (box-office seating tier, redemption side only)

```python
import re
pattern = re.compile(r'Ticket Desc~([^|]+)\|')
Format = pattern.search(Notes).group(1).strip().title()  if Ticket_FnB == 'Ticket' and match found  else 'N/A'
```
Observed values (title-cased): Classic, Classic Plus, Classic Rows, Prime, Prime Rows, Prime Plus, Recliner, Club, Elite, Royale, Royal, Executive, Silver, Extra Legroom Rows, Cla Superior, Xtra Legroom, Sofa Slider, Recliner Prime, Picture Perfect, Platinum, P. Superior, Lounger, etc. **[Not normalized further]** - "Royale" and "Royal" are treated as distinct values, as are case variants like "Club" vs "CLUB" if they occur (title-case normalization was applied but not full dedup of near-duplicate labels).

### 3.10 Category (F&B product category, redemption side only)

```python
import re
item_pattern = re.compile(r'Item Name~([^|]+)\|')
ItemName = item_pattern.search(Notes).group(1).strip()  if Ticket_FnB == 'F&B' and match found  else None

def categorize(name):
    n = str(name).upper()
    if 'POPCORN' in n and 'COMBO' not in n:                                    return 'Popcorn'
    if 'COMBO' in n:                                                            return 'Combos'
    if any(k in n for k in ['COFFEE','CAPPUCCINO','LATTE','ESPRESSO']):        return 'Hot Beverages'
    if any(k in n for k in ['PEPSI','COLA','COKE','SPRITE','FANTA',
        'MOUNTAIN DEW','SODA','WATER','JUICE','RED BULL','GATORADE','SLICE',
        'LIMCA','THUMS UP','SEVEN UP','7 UP','SCHWEPPES','MAAZA']):            return 'Beverages'
    if any(k in n for k in ['WHISKY','WHISKEY','BEER','WINE','VODKA','RUM',
        'GIN','COCKTAIL','SCOTCH','LIQUOR','KINGFISHER','BUDWEISER']):         return 'Alcohol'
    if any(k in n for k in ['ICE CREAM','MAGNUM']):                            return 'Ice Cream'
    if any(k in n for k in ['BURGER','PIZZA','SANDWICH','HOT DOG','FRIES',
        'NUGGET','WRAP','ROLL','NACHOS','MOMOS','PASTA','NOODLE','DIMSUM',
        'CHAAT','OFB-']):                                                       return 'Food'
    if any(k in n for k in ['ADD ON','ADDON']):                                return 'Add-ons'
    if any(k in n for k in ['CHOCOLATE','5 STAR','5STAR','KITKAT',
        'DAIRY MILK','MUNCH','GEMS','ECLAIRS','PERK','CANDY','FUSE']):         return 'Confectionery'
    if any(k in n for k in ['CHIPS','NAMKEEN','SEASONING','TRAIL MIX',
        'CHANA','MIXTURE','PEANUT']):                                          return 'Snacks'
    return 'Other'
```
**[VERIFIED]** ~93% F&B-row coverage (non-"Other") with this keyword list; ~7% of F&B transactions fall to "Other" (long-tail/rare single-SKU items) - this is an accepted, disclosed approximation, not a bug to chase further.

### 3.11 SourceFlag (redeemed at same cinema as activated, or a different one)

```python
SourceFlag = 'N/A'   # default
if RedemptionModeFinal == 'Physical' and card.ActivationMode == 'Physical':
    SourceFlag = 'Source'      if this_redemption.Outlet == card.ActivationOutlet
    SourceFlag = 'Non-Source'  otherwise
```
Only meaningfully computed for physical-activated cards redeemed physically; everything else (Corporate/Aggregator/Online-origin, or online redemption) stays `'N/A'`.

---

## 4. CALCULATED FIELDS

### 4.1 Uptake

```python
Uptake = 0.0  # default
if TransactionType == 'GIFT CARD REDEEM' and BillAmount is not null and BillAmount != 0:
    Uptake = abs(BillAmount) - abs(Amount)
```
**[VERIFIED edge case]** Online redemptions (`Outlet='PVR Inox Online'`, no `POS Type` tag in Notes) have `BillAmount` blank for essentially all rows - Uptake is genuinely uncomputable there, not zero-by-assumption. This is disclosed, not silently treated as "no uptake occurred."

### 4.2 Uptake netting against cancellations (card-level, applied when building per-card summaries)

```python
CancelRatio = 0
if GrossRedemptionAmount > 0:
    CancelRatio = 1 - (abs(NetRedemptionAmount) / GrossRedemptionAmount)
CancelRatio = clip(CancelRatio, 0, 1)

NetUptake = GrossUptake * (1 - CancelRatio)
```
**[DECISION/APPROXIMATION]** This is a *proportional* attribution - if X% of a card's gross redemption got cancelled, X% of its uptake is assumed cancelled too. This is not row-level-exact (we cannot know precisely which specific redemption's uptake was reversed by which specific cancellation, since Cancel Redeem rows carry no item-level Notes detail), but it corrected a real, verified overstatement (~14.6% too high before this fix).

### 4.3 NetActivationAmount (per-card)

```python
NetActivationAmount = SUM(Amount_num)  for all rows where CardNumber matches
                       AND TransactionType IN ('GIFT CARD ACTIVATE', 'GIFT CARD CANCEL ACTIVATE')
```
Naturally nets since Cancel Activate amounts are negative.

### 4.4 GrossRedemptionAmount / NetRedemptionAmount (per-card)

```python
GrossRedemptionAmount = SUM(ABS(Amount_num))  for TransactionType == 'GIFT CARD REDEEM' only
NetRedemptionAmount    = SUM(Amount_num)       for TransactionType IN ('GIFT CARD REDEEM','GIFT CARD CANCEL REDEEM')
                          # Redeem is negative, Cancel Redeem is positive - nets naturally.
```

### 4.5 Region-level Denomination cross-check formula (used only for validation, not stored)

```python
Redemption_Pct = NetRedemptionAmount / NetActivationAmount * 100    # [DECISION] user-specified formula
```

---

## 5. DEDUPLICATION / MERGE LOGIC

1. **Header-row detection (older FY24-25 files only):** 6 of the original 12 FY2024-25 monthly files have an extra blank leading row pushing the real header to row index 1 (with spaced-out column names like `"Card Number"` instead of `"CardNumber"`). Detection heuristic:
   ```python
   probe = read_first_2_rows(file, header=None)
   header_row_index = 1  if probe.iloc[0].isna().all()  else 0
   ```
   After detection, columns are renamed positionally to the standard 34-column list (Section 1), since order is consistent even when the header text differs.

2. **Calamine-loader header detection (all files, faster parser):**
   ```python
   for i, row in enumerate(first_3_raw_rows):
       if row and any('CardNumber' in str(v).replace('\ufeff','').replace('"','') for v in row if v):
           header_row_index = i
           break
   else:
       header_row_index = 0
   ```
   **[QUIRK]** calamine returns blank cells as empty strings `''`, not `None`/`NaN` - any `.notna()` check on calamine-loaded data will incorrectly treat blank cells as populated. Must explicitly check for empty string too.

3. **ApprovalCode deduplication across file batches:** before merging any lookup table (Format/Category/Denom extraction, cohort tables, etc.) built from more than one file-upload batch, run `drop_duplicates('ApprovalCode', keep='first')` - **[VERIFIED]** 17,698 collisions found when the original 24-month batch was combined with the 4 newest (2026) months; without deduping, joins fan out and inflate row counts silently.

4. **Jan_26 file - see Section 2** (date-range filter before any other processing, not a true "dedup" but functionally prevents double-counting against the separately-supplied Feb_26/Mar_26 files).

5. **Region-fix lookup for specific outlets (Section 3.4):** a small hardcoded dict, not derived from any general rule:
   ```python
   OUTLET_REGION_BACKFILL = {
       'PVRDC-MAINSTREAM-SELECTCITYWALK': "Director's Cut",
       'INOX Emerald Mall Lucknow-INACTIVE': "Director's Cut",   # see note in Section 3.4 - not actually Director's Cut branded, bucketed there as an accepted simplification
       'INOX Sapphire 90 Mall Gurugram-INACTIVE': "Director's Cut",
       'INOX Salem Reliance Mall-INACTIVE': "Director's Cut",
       'INOX Ardee Mall Gurugram-INACTIVE': "Director's Cut",
   }
   ```

---

## 6. KNOWN DATA QUIRKS (summary, cross-referenced to sections above)

- CardNumber to Excel scientific notation on CSV export (Section 1, col 1). Fix: write as text/string type.
- TransactionMode field is misleading, not a true channel indicator (Section 1, col 22).
- ProgramGroup header BOM character (Section 1, col 12).
- Inconsistent header row position across some FY24-25 files (Section 5.1).
- calamine blank-cell-as-empty-string (Section 5.2).
- ApprovalCode not globally unique across combined batches (Section 5.3, Section 1 col 33).
- The Jan_26 file's duplicate Feb/Mar content (Section 2, Section 5.4).
- August 2024 fraud/scam event and its September cleanup - one-time historical, not a recurring pattern (Section 2 Rules D/E).
- Denomination boundary gap bug in an earlier (now-superseded) scheme version (Section 3.7).
- Region NO_SITE mislabeling for Director's Cut / inactive cinemas (Section 3.4).
- CardType/Denom hardcoded-to-N/A bug on Cancel Activate / Cancel Redeem rows, since fixed (Section 3.1, Section 3.7).

---

## 7. OUTPUT SCHEMA (current, as of last rebuild)

### `activationCube.json`
One row per unique combination of: `YearMonth, Region_Clean, ActivationModeFinal, Weekday, Denom, CardType`.
Measures: `ActivationAmount` (Rs., signed - nets Cancel Activate), `ActivationCount` (row count of `GIFT CARD ACTIVATE` only, not net of cancellations).
Reconciles to: **Rs.8,934.40 Lacs** total (unfiltered) — **[UPDATED 2026-09, see Section 11 for the full account]**. Figure history: Rs.8,266.57L (original) -> Rs.8,543.50L (28mo+Aug) -> Rs.8,934.40L (+Prebuy, Section 8) -> Rs.8,933.78L (+Jan fix, Section 9, later found imprecise) -> Rs.8,934.40L (Section 11, current and correct — a float32 rounding error inherited from an earlier build stage was found and corrected the same day as Section 9, coincidentally returning the total to its Section 8 value).

### `redemptionCube.json`
One row per unique combination of: `YearMonth, Region_Clean, RedemptionModeFinal, Head, SourceFlag, Weekday, ActivationMode, Format, Category, Denom, CardType, ActivationCohort`.
Measures: `RedemptionAmount` (Rs., signed - Cancellation rows are negative so the field nets correctly on SUM), `RedemptionCount` (transaction count, NOT card count), `Uptake`, `UniqueCardCount` (distinct `CardNumber` - exact only within a single row/bucket, NOT safe to sum across multiple selected time periods or dimension values without overcounting, verified approx 8.4% inflation risk across the full date range).
Reconciles to: **Rs.7,353.62 Lacs** total (unfiltered, net of all cancellations) — **[UPDATED 2026-09]** reflects the Prebuy reversal (Section 8); unaffected by both the Section 9 January fix and the Section 11 correction, neither of which changed the redemption-side net total. Prior figure was Rs.7,024.99 Lacs (28mo+Aug, pre-reversal).

### `cohortCube.json`
One row per unique combination of: `ActivationYearMonth, RedemptionYearMonth, Region_Clean, RedemptionModeFinal, Head, ActivationModeFinal, CardType, Weekday`.
Measures: same as redemptionCube (`RedemptionAmount, RedemptionCount, Uptake, UniqueCardCount`).
Purpose: lets the Card Journey page answer "of cards activated in period X, how many were ALSO redeemed within that same period X" by filtering both month fields to the same range - NOT "redeemed ever, regardless of when."
**[VERIFIED constraint]** same-period redeemed card count must always be <= activated card count for that period (it's a subset by construction).
**[Section 11]** Regenerated 2026-09 as part of the mandatory dependent-file batch (see the Dependent-File Regeneration Rule) alongside `redemptionCube.json` and `dailyRedemptionCube.json` — cross-verified total matches `redemptionCube.json` exactly, Rs.7,353.62 Lacs both.

### `dailyActivationCube.json` / `dailyRedemptionCube.json`
Lighter-dimension versions for the Day (1-31) filter: `DateStr (exact date), Region_Clean, ActivationModeFinal` / `DateStr, Region_Clean, RedemptionModeFinal, Head`. Deliberately excludes CardType/Denomination/Source/Format/Category to keep file size small - the Day filter does not combine with those dimensions.
**[Section 11]** `dailyActivationCube.json` was found to carry the same float32-rounding error as `activationCube.json` — see Section 11's account of why this was caught by direct verification rather than assumed fine.

### `heroProducts.json`
Static, whole-dataset, NOT filterable. Top 15 F&B products by total bill value (item-level `Amount` from Notes, summed and normalized for name-variant duplicates). Fields: `name, amount` (Rs. Lacs).

### `redemption_rowlevel.parquet`
Row-level (not pre-aggregated), one row per `GIFT CARD REDEEM` or `GIFT CARD CANCEL REDEEM` transaction - 1,980,252 rows. Fields: `CardNumber, ApprovalCode, TransactionDate, YearMonth, Weekday, Region_Clean, RedemptionModeFinal, Head, SourceFlag, ActivationMode, ActivationYearMonth, ActivationCohort, Format, Category, Denom, CardType, Amount_num (signed), Uptake`.
Purpose: enables exact `COUNT(DISTINCT CardNumber)` queries via DuckDB-WASM for any arbitrary filter combination, without the multi-period overcounting limitation that applies to the pre-aggregated `UniqueCardCount` field above.
**[VERIFIED]** True all-time distinct redeemed cards = 1,029,133 (confirmed via direct SQL query, matches the independently-computed ground truth).

---

## 8. FIX: EXACT DISTINCT CARD COUNTS FOR CARD JOURNEY (row-level Parquet, supersedes naive UniqueCardCount summing for this use case)

**Problem confirmed and quantified:** `cohortCube.json`'s `UniqueCardCount` field is exact only within a single pre-aggregated bucket-row. Card Journey's core function — "of cards activated in a multi-month period (e.g. an FY), how many distinct cards were also redeemed within that same period" — requires summing this field across every matching row in the selection, which double-counts any card whose redemptions land in more than one bucket (different months, different regions, online vs. in-cinema, etc.). This is the same class of problem disclosed generally in Section 7, now fixed specifically for Card Journey.

**Options considered:**
- *Pre-computed exact cross-tabs at fixed granularities* — rejected. Card Journey must combine with Region/Mode/Head/arbitrary date-range filters the same way every other page does; precomputing exact counts for every combination those filters could produce collapses back into needing row-level data anyway.
- *Row-level export, client-side exact dedup* — chosen. Matches the architecture every other filter on the dashboard already uses (filter an array, aggregate client-side), just needs `CardNumber` retained so distinct-counting can happen in the browser.

**File format note:** the row-level data was first tried as trimmed JSON (8 columns, same row count as the full file) — this came out to **444MB**, impractical for a browser fetch. The identical data as Parquet (zstd compression) is **13.04MB** — a 34x reduction, purely from format, no additional trimming. JSON's per-row field-name repetition does not scale to this row count; Parquet does. **Decision: ship as Parquet, query via the same DuckDB-WASM path already planned for the full `redemption_rowlevel.parquet` file (Section 7), not as JSON.**

### Output: `cardJourneyRowLevel.parquet`
1,980,252 rows (same full row count as `redemption_rowlevel.parquet` — this is a column-trimmed sibling, not a smaller row set). Fields: `CardNumber, ActivationYearMonth, RedemptionYearMonth, Region_Clean, RedemptionModeFinal, Head, RedemptionAmount (signed — negative for Redeem rows, positive for Cancel Redeem, nets on SUM), Uptake`.

Query pattern (DuckDB-WASM, client-side):
```sql
SELECT COUNT(DISTINCT CardNumber) as cards, SUM(ABS(RedemptionAmount))/100000.0 as amount_lacs
FROM cardjourney
WHERE ActivationYearMonth IN (<selected FY's months>)
  AND RedemptionYearMonth IN (<selected FY's months>)
  AND Head != 'Cancellation'
  -- plus any active Region/Mode filters as additional AND conditions
```

### Verification against both required checkpoints

**Checkpoint 1 — true all-time distinct redeemed cards:** exact query returns **1,029,133** — matches the figure already recorded in Section 7 precisely. ✅

**Checkpoint 2 — FY2026-27 same-period (activation AND redemption both within Apr-Jul 2026):**
| | Previously displayed (naive sum) | Corrected (exact SQL) | Inflation |
|---|---|---|---|
| Distinct cards | 257,600 | **228,202** | **12.9%** |

This confirms real, non-trivial inflation specifically for Card Journey's core metric — higher than the 8.4% dataset-wide average, consistent with this being a tighter cohort window where a card has more relative opportunity to land in multiple buckets (different months within the FY, different regions, online vs. in-cinema) than it would across the full 28-month span.

**[ACTION REQUIRED, not yet implemented]** the live dashboard's Card Journey page must be repointed from `cohortCube.json`'s summed `UniqueCardCount` to a live DuckDB query against `cardJourneyRowLevel.parquet` for its "Redeemed within this period" card-count metric specifically. Amount and other metrics can remain on the existing JSON cubes if already verified correct — only the distinct-card-count figure was affected by this bug.

---

## Reversed Decisions Log
Changes that overturn a previous, explicitly-documented rule in this spec — kept visible rather than silently edited out, so a future reader knows a rule used to be different and why it changed.

### 2026-09 — Prebuy egift card exclusion reversed
**Original rule (in effect from initial build through 2026-08 reprocessing):** `PVR INOX Prebuy egift card` was fully excluded via `EXCLUDED_PROGRAM_GROUPS`, on the reasoning that it was "a reload/cash-card equivalent product, not a real gift card" — the same category as the genuinely-excluded Prepaid Gift Card and Credit Limit Card products.

**Why it was wrong:** Prebuy is the same e-giftcard product line as the rest of Aggregator-sourced Digital activation — just a different ProgramGroup name, not a different product type. It belongs in the existing Aggregator > Digital bucket, not excluded.

**Verification done before reversing:**
- Confirmed Prebuy has real `GIFT CARD REDEEM`/`GIFT CARD CANCEL REDEEM` rows across all 29 months (201,052 total Prebuy rows: 64,419 Activate, 96,584 Redeem, 29,327 Cancel Redeem, plus minor Reset Pin/Cancel Activate/Deactivate/Reactivate volume) — **zero `GIFT CARD RELOAD` rows**, confirmed twice independently (Dec'25 and Feb'26 samples, then again across the full 29-month extraction). It does not move value via the RELOAD mechanism the original exclusion reasoning assumed.
- Confirmed 100% Aggregator-sourced (`Merchant IN (Amazon, GiftBig)`, zero exceptions).
- Confirmed Prebuy launched in **October 2025** — zero rows in any FY2024-25 or FY2025-26-through-Sep'25 file. Volume spiked Oct'25-Apr'26 (39,270 rows in Dec'25 alone) then dropped sharply from May'26 onward (~5,000 rows/month) — pattern not further investigated, noted for awareness only.

**Fix implemented:** removed from `EXCLUDED_PROGRAM_GROUPS` (Section 2); added to `DIGITAL_PROGRAM_GROUPS` and folded into the broader Aggregator-aware `CardType` rule (Section 3.1) that also generalizes classification for any future unrecognized ProgramGroup name appearing under an Aggregator source.

**Impact (all 5 gift-card cubes, 29-month range, Apr 2024-Aug 2026):**
| Metric | Before reversal | After reversal | Delta |
|---|---|---|---|
| Total Net Activation | Rs.8,543.50 Lacs | Rs.8,934.40 Lacs | +Rs.390.91 Lacs |
| Total Net Redemption | Rs.7,024.99 Lacs | Rs.7,353.62 Lacs | +Rs.328.63 Lacs |
| Feb 2026, Aggregators > Digital | Rs.60.01 Lacs | Rs.110.35 Lacs | +Rs.50.34 Lacs (exact match to Prebuy's isolated Feb'26 activation amount) |

`heroProducts.json` unaffected (separate F&B item ledger, no ProgramGroup dependency).

**Build method note:** since every already-kept row's classification is provably unchanged by the new CardType rule (see Section 3.1), this was implemented as an additive delta — Prebuy's 201,052 rows processed once through the full classification pipeline and merged into each existing cube — rather than a full 29-file pipeline reprocessing. Cross-checked that `cohortCube.json`'s total still matches `redemptionCube.json`'s total exactly (Rs.7,353.62 Lacs both) after the merge, same invariant maintained as every prior rebuild.

---

## Section 8 addendum: `heroProductsCube.parquet` — fully dimensional F&B item ledger

**[NEW, 2026-09]** Supersedes `heroProducts.json` (the flat top-15) for any use case needing per-item detail crossed with other filter dimensions. `heroProducts.json` is NOT deprecated — it remains the fast, whole-dataset "top 15" summary; this new file is for anything needing a different cut (e.g. "top item in the South region only," which the flat top-15 cannot answer since a regional favorite might not be globally top-15).

**Extraction logic:** for every `GIFT CARD REDEEM` row across all 29 months (Apr 2024 - Aug 2026, including the reversed-in Prebuy rows) where `Notes` contains `POS Type~F&B`, parse every `{MasterItemCode~...|Item Name~...|Amount~...|Quantity~...}` block via regex:
```python
ITEM_PATTERN = re.compile(r'Item Name~([^|]+)\|Amount~([\d.]+)\|Quantity~(\d+)')
```
A single Notes field can contain multiple item blocks (a combo order with popcorn + drink, for example) — each becomes its own row before aggregation, so 837,868 F&B transactions expanded to 1,154,829 individual item-lines.

**What counts as "F&B" for this purpose:** identical definition to `Ticket_FnB` (Section 3.5) — `Notes` contains the literal substring `POS Type~F&B`. Same scope as feeds `redemptionCube.json`'s F&B Head.

**Grain:** one row per (`ItemName`, `YearMonth`, `Region_Clean`, `RedemptionModeFinal`, `ActivationModeFinal`, `CardType`, `Denom`, `Weekday`). Measures: `ItemBillValue` (sum of item-level Amount, see caveat below — **[RENAMED 2026-09, see Section 10]**, was called `RedemptionAmount` before), `RedemptionQuantity` (sum of item-level Quantity).

**Result:** 294,309 rows, 3,606 distinct item names. **81.71MB as JSON — NOT shipped, impractical for a browser fetch.** As Parquet (zstd): **1.04MB — a 78x reduction**, the most dramatic JSON-vs-Parquet gap found in this project, since high-cardinality repeated strings (item names) compress far better columnarly than as repeated JSON text. Shipped as `heroProductsCube.parquet` only.

**`ActivationModeFinal` and `CardType` limitation, disclosed:** these are joined from the same per-card master lookups used elsewhere (Section 8's Prebuy fix), but `CardType` specifically is *approximated* here via origin-mode (`Aggregator/Online/Corporate → Digital`, `Physical → Physical`) rather than the true ProgramGroup-based rule (Section 3.1), because per-card `ProgramGroup` history wasn't retained in the cached lookups and re-extracting it would have required another full 28-file pass. This misses the ~938-row `'PVR INOX Gift Card'` exception (Section 3.1) for any of those specific cards' F&B purchases — negligible in scale, but not zero, and not the authoritative CardType source. For exact CardType, cross-reference `CardNumber` against `redemptionCube.json` instead.

**Cross-check against `redemptionCube.json`'s F&B total — gap explained, not a discrepancy to fix:**
| | Amount (Lacs) |
|---|---|
| `redemptionCube.json`, Head='F&B', card-deducted Amount | Rs.1,856.22 |
| + F&B Uptake (same Head) | Rs.2,660.88 |
| = Amount + Uptake | Rs.4,517.10 |
| `heroProductsCube.parquet` total (item bill value) | **Rs.5,023.07** |
| Residual gap | Rs.505.97 |

Two components to the gap, both verified, neither is "online F&B redemptions excluded" (that hypothesis doesn't apply here — `Head='F&B'` is already exclusively Physical-mode by construction on both sides, since online redemptions always get `Head='Online'` regardless of content, per Section 3.6):
1. **Uptake (the majority of the gap)** — item-level Amount reflects the full retail bill value, which includes any top-up cash paid beyond the gift card's contribution. Same distinction already disclosed for the original flat `heroProducts.json`.
2. **A residual Rs.505.97 Lacs, traced to a real source-data inconsistency** — confirmed with a concrete example: a Red Bull item line showed `Amount~570, Quantity~3` in Notes, but the transaction's actual Bill was only Rs.120. The item-level Amount field in Notes does not always scale consistently with Quantity for some transactions — this is a property of the source system's own logging, not a parsing error (the regex correctly extracts what's literally written). Not further corrected, since attempting to infer a "true" per-unit price risks breaking the many cases where the field is already correct.

---

## Section 9: January 2026 Cancel-Activate netting — fixed, no longer an accepted approximation

**[FIXED 2026-09]** Previously disclosed (Section 6, Section 5.1) as a known gap: `9_Issuer_Transaction_Detailed_Report_Jan_26.XLSX`'s `GIFT CARD CANCEL ACTIVATE` rows were omitted from net activation due to a recurring memory failure when attempting to extract both Activate and Cancel-Activate types from this file in one pass. This is now fixed — the same streaming approach that worked earlier in this project for a different single-column extraction (filtering the raw row-list to the target condition *before* building any DataFrame, freeing intermediate objects with explicit `gc.collect()`) succeeded this time for both transaction types together. No further memory workaround needed; this was not a fundamental limitation, just a transient resource issue in earlier attempts.

**Corrected figure:**
| | Amount (Lacs) |
|---|---|
| OLD (Activate-only, missing Cancel-Activate) | Rs.282.79 |
| NEW (correctly netted) | Rs.282.16 |
| Delta | -Rs.0.63 |

**[SUPERSEDED 2026-09, same day — see Section 11]** The "Rs.282.16" figure above and the "Grand totals" table below it were themselves found to be wrong in a follow-up investigation the same day — not from a missing-data issue this time, but a float32 rounding artifact in an much earlier build pass that this fix's delta-based patching inherited rather than corrected. The true figure, verified three independent ways, is **Rs.282.79 Lacs** — coincidentally identical to the pre-this-fix "OLD" figure above, since the rounding error and the real Cancel-Activate correction happened to be close in magnitude and opposite in sign. See Section 11 for the full account. The row-count and file-touched analysis below remains accurate; only the final amount figures are superseded.

201 non-Prebuy `GIFT CARD CANCEL ACTIVATE` rows recovered (202 found total; 1 belonged to Prebuy and was already correctly captured via the separate Prebuy extraction pathway documented in Section 8 — excluded here to avoid double-counting, a real risk caught and corrected during this fix).

**Ripple effect, investigated rather than assumed negligible:** of the 202 affected cards, 196 (not just the ones with a nonzero delta) land in a *different* Denomination bucket once correctly netted (e.g., a card with Rs.1500 gross activation and a full Rs.1500 cancellation nets to Rs.0, moving from the "1001-1999" bucket to "0-299"). Checked whether these cards have redemption history elsewhere in the 29-month dataset that would be carrying the wrong Denom tag: **93 cards, 181 redemption rows, Rs.0.4954 Lacs** — small but real, and fixed rather than left as a second disclosed-but-unfixed gap.

**Files touched and how:**
- `activationCube.json` — 201-row additive delta merged in (Cancel Activate rows always contribute to `ActivationAmount` but never `ActivationCount`, matching existing convention).
- `dailyActivationCube.json` — same delta, day-level.
- `master_amount_lookup.pkl` (internal, not shipped) — corrected via an *additive* per-card delta. Caught and fixed a bug during this work where an earlier attempt *replaced* each card's total net amount with just January's contribution, silently discarding that card's activity from other months — corrected before it reached any shipped file.
- `activation_rowlevel.parquet` — 201 missing rows added (this file had zero January Cancel-Activate rows before this fix, not just a wrong total).
- `redemption_rowlevel.parquet` — `Denom` field corrected in place for the 181 affected rows (identified by `CardNumber`, not `ApprovalCode`, to sidestep the known cross-batch `ApprovalCode` collision risk from Section 5.3).
- `redemptionCube.json` — **fully rebuilt from the now-corrected `redemption_rowlevel.parquet`**, rather than patched in place, since patching 181 scattered rows across 12 dimensions' worth of pre-aggregated buckets was judged too error-prone to do safely by hand. A sign-handling bug was caught and fixed during this rebuild (Cancellation rows store a *positive* `Amount_num` in the row-level file but must contribute *negatively* to the aggregated cube to net correctly — an initial rebuild attempt summed them with the wrong sign and produced an inflated Rs.10,702.68 Lacs total before the bug was caught and corrected).
- `heroProductsCube.parquet` — `Denom` corrected for 169 item-line rows (72 underlying F&B transactions) belonging to the affected cards, then fully re-aggregated.
- `cohortCube.json`, `cardJourneyRowLevel.parquet` — **unaffected**, confirmed by checking their schemas directly: neither carries a `Denom` field, so this fix has nothing to touch in either file.

**Grand totals after this fix** (supersedes the figures in Section 8's Prebuy table, which predate this correction) — **[these two figures are themselves superseded the same day, see Section 11]**:
| | Amount (Lacs) |
|---|---|
| Total Net Activation | Rs.8,933.78 (superseded — see Section 11 for the corrected Rs.8,934.40) |
| Total Net Redemption | Rs.7,353.62 (unchanged — this fix only moved amounts between Denomination buckets on the redemption side, not the net total) |

---

## Section 10: `heroProductsCube.parquet` field rename — `RedemptionAmount` to `ItemBillValue`

**[RENAMED 2026-09]** The column previously named `RedemptionAmount` in `heroProductsCube.parquet` measures something fundamentally different from every other cube's field of the same name — item-level bill value (including Uptake, i.e. any top-up cash paid beyond the gift card), not the card-deducted amount that `RedemptionAmount` means everywhere else in this pipeline (`redemptionCube.json`, `cohortCube.json`, `redemption_rowlevel.parquet`, `cardJourneyRowLevel.parquet`). Documented as a caveat in Section 8 previously, but a same-named field carrying a different meaning across files is an easy trap for anyone querying by field name alone rather than reading the full spec first.

**Fix:** renamed to `ItemBillValue` in the file itself. No values changed, only the column name. Every reference to the old name in this spec (Section 8's addendum, above) has been updated to match.

---

## Section 11: January 2026 reconciliation error found and corrected — the real final baseline

**[FOUND AND FIXED 2026-09, same day as Section 9]** While handling two follow-up requests (regenerate `activation_rowlevel.parquet` with the Section 9 fix; regenerate `cohortCube.json` and `dailyRedemptionCube.json`), a deeper inconsistency was found: `activation_rowlevel.parquet` — built independently from the same 29-file raw source — already showed **Rs.282.79 Lacs** for January 2026's net activation, not the Rs.282.16 Lacs that Section 9 had just reported as correct and merged into `activationCube.json` and `dailyActivationCube.json`. The two files disagreed with each other despite supposedly representing the same corrected data.

**Root cause, verified rather than assumed:** the disagreement was not about which rows are included — a direct check confirmed `activation_rowlevel.parquet`'s January row count and the raw source's row count reconcile exactly (48,071 raw Activate rows minus 2,540 correctly-excluded Prepaid Gift Card rows = 45,531, matching precisely). The actual cause was a **float32 precision accumulation** in `activationCube_29mo.pkl` — an earlier build stage (from well before this session, during the original 28-month rebuild) that cast `ActivationAmount` to float32 before summing. Summed across 45,531+ rows, this produced a small but real systematic drift from the true float64 total. Section 9's fix patched a *delta* on top of this already-imprecise base, so the delta was numerically correct but the base it was added to was not — the error was inherited, not caused, by the Section 9 fix.

**Resolution:** rather than patch further, January's activation-side data was removed entirely from all three affected files and reinserted fresh from a single, independently-verified source (`jan26_DEFINITIVE.pkl` — built directly from the raw file with the documented exclusion rules applied, full float64 precision, both `GIFT CARD ACTIVATE` and `GIFT CARD CANCEL ACTIVATE` types, Prebuy correctly included per Section 8's rule). This source's Prebuy portion was cross-checked against the independently-built `prebuy_final.pkl` and found to match exactly (13,293 rows, Rs.77.34 Lacs, both extractions) — confirming this fresh source is reliable before trusting it as the new baseline.

**The corrected January 2026 net activation figure: Rs.282.79 Lacs** (not Rs.282.16 Lacs as Section 9 reported). Coincidentally close in absolute value to Section 9's own "OLD, pre-fix" figure of Rs.282.79 — this is a coincidence of magnitude, not a sign that Section 9's Cancel-Activate fix was unnecessary or wrong; the real Cancel-Activate correction (-Rs.0.63L) and the float32 rounding error being corrected happened to be similar in size and opposite in net effect on this particular month's total.

**A second finding from the same investigation:** `dailyActivationCube.json` was checked directly rather than assumed correct (it had coincidentally matched `activationCube.json`'s also-imprecise Rs.8,933.78L figure, which could easily have let this pass unnoticed) — found to have the identical float32-drift issue, and corrected the same way.

**Files corrected in this pass:**
- `activation_rowlevel.parquet` — January rows fully removed and reinserted from `jan26_DEFINITIVE.pkl`. Total: Rs.8,934.40 Lacs (was already at this figure before this pass, confirming it was the reliable reference point that exposed the other two files' error).
- `activationCube.json` — January rows fully removed and reinserted. Total: Rs.8,933.78 -> **Rs.8,934.40 Lacs**.
- `dailyActivationCube.json` — same treatment. Total: Rs.8,933.78 -> **Rs.8,934.40 Lacs**.
- `cohortCube.json` — fully rebuilt from the (already-correct, per Section 9) `redemption_rowlevel.parquet`. Not affected by the activation-side float32 issue (cohortCube is redemption-side data), but had not yet been regenerated since Section 9's Denom corrections. Cross-verified total matches `redemptionCube.json` exactly: **Rs.7,353.62 Lacs both**, same invariant checked on every prior refresh.
- `dailyRedemptionCube.json` — same rebuild, same cross-check: **Rs.7,353.62 Lacs**.

### THE CURRENT, FINAL RECONCILED BASELINE (2026-09) — supersedes every prior figure in this document

| | Amount (Lacs) |
|---|---|
| **Total Net Activation** | **Rs.8,934.40** |
| **Total Net Redemption** | **Rs.7,353.62** |

Full figure history for Total Net Activation, oldest to newest, nothing hidden: Rs.8,266.57 (original 28mo) -> Rs.8,543.50 (28mo+Aug) -> Rs.8,934.40 (+Prebuy reversal, Section 8) -> Rs.8,933.78 (+Jan Cancel-Activate fix, Section 9 — later found imprecise) -> **Rs.8,934.40 (Section 11, current and correct)**.

Total Net Redemption has held at Rs.7,353.62 Lacs since Section 8's Prebuy reversal — neither the Section 9 Denom corrections nor this Section 11 activation-side fix changed the redemption-side net total, only its internal Denomination-bucket and January-activation-side breakdowns.

---

## Section 12: Dependent-File Regeneration Rule (standing rule, effective 2026-09)

**Why this rule exists:** this session caught two separate instances of partial regeneration causing silent staleness between files that are supposed to agree exactly:
1. Section 9's fix updated `activationCube.json` and `dailyActivationCube.json` but not `activation_rowlevel.parquet`, `cohortCube.json`, or `dailyRedemptionCube.json` — left three files stale until the next session caught it.
2. Within that same catch-up, `activation_rowlevel.parquet` turned out to already be correct while `activationCube.json` and `dailyActivationCube.json` were not (Section 11) — a partial fix would have "corrected" the one file that didn't need it and left the real problem in place, had the fix not been applied to the whole dependent group together.

**The rule:** any future change to activation-side or redemption-side data — a bug fix, a reprocessed source file, a new exclusion or classification rule, anything — must regenerate its **entire** dependent-file group in the same batch. Never ship a fix to a subset of a group and leave the rest for "later" or "if it turns out to matter."

**Activation-side group (regenerate all 3 together, always):**
- `activationCube.json`
- `dailyActivationCube.json`
- `activation_rowlevel.parquet`

**Redemption-side group (regenerate all 4 together, always):**
- `redemptionCube.json`
- `cohortCube.json`
- `dailyRedemptionCube.json`
- `redemption_rowlevel.parquet`

**Cross-group dependents, regenerate if the underlying redemption data changed:**
- `heroProductsCube.parquet` — draws from the same F&B redemption rows; check if any change affects the F&B subset before skipping it.
- `cardJourneyRowLevel.parquet` — trimmed sibling of `redemption_rowlevel.parquet`; must stay in sync with it specifically, even though it has no `Denom` field and is sometimes unaffected by Denom-only fixes (verified case-by-case in Section 9 and Section 11 — don't assume immunity, check it explicitly each time the way those sections did).
- `heroProducts.json` — the flat top-15 F&B summary; only affected if the fix touches F&B redemption amounts specifically.

**Mandatory verification checklist before considering any fix done:**
1. Sum every file in the affected group(s) and confirm all totals match each other exactly (same convention as every cross-check already documented throughout this spec — e.g. `cohortCube.json` = `redemptionCube.json`, both groups summing to the same grand total).
2. Do not assume any single file in a group is "probably fine" because the fix conceptually shouldn't touch it — Section 11 exists specifically because that assumption was wrong once already. Check every file in the group directly.
3. Only report a fix as complete once every file in its group has been verified, not just regenerated.

---

## Section 13: New ProgramGroup names found in Apr'25-Mar'26 batch survey (2026-09)

**Context:** a separate processing session, working from this spec, surveyed the raw Apr'25-Mar'26 files before running the pipeline and found 3 ProgramGroup names never previously seen, appearing only on redemption rows (4,855 rows total, no in-window Activate row for any of the affected cards).

**Resolution, added to `DIGITAL_PROGRAM_GROUPS` (Section 3.1) with this session's date:**
```python
DIGITAL_PROGRAM_GROUPS = {
    ... (existing entries) ...
    'PVR Entertainment eGift Card',   # [ADDED 2026-09] explicit "eGift" naming, matches
                                       # the same literal pattern as every other Digital entry.
}
# Classified PHYSICAL (i.e., NOT added to the set above), same date, same reasoning
# (no digital marker in the name, matches the plain "Gift Card" naming convention used
# by every other Physical-classified product):
#   'PVR Cinemas Playhouse Gift Card'
#   'PVR Cinemas 4 Months Gift Card'   # [INFERRED] less certain than the other two below -
#                                       # "4 Months" suggests a validity-limited product,
#                                       # a genuinely new pattern not seen elsewhere in this
#                                       # dataset. Physical is the convention-consistent
#                                       # default, not a fully confirmed fact.
```

**New standing clarification added to Section 3.1**, resolving a genuine gap the survey exposed — the documented `card_type()` function had no defined behavior for a card with zero in-window Activate history:

> `CardType` is resolved from `ProgramGroup` on whichever row carries it — an Activate-type row preferred when available, a redemption row's own `ProgramGroup` as fallback when no in-window Activate row exists for that card. This is NOT the same situation as `Denom`'s `'Unknown (pre-existing)'` fallback (Section 3.7): `Denom` depends on the *activation amount*, a transactional value that genuinely only exists on an Activate-type event and is unrecoverable without one. `CardType` depends on `ProgramGroup`, a stable per-card product attribute present on every row type, redemption included — it does not need an Activate-type row to be resolvable, and should essentially never need to fall back to "Unknown" in practice.

## Section 14: Unresolved raw-schema discrepancy — same filename, two different files (2026-09)

**[UNRESOLVED, flagged rather than guessed past]** The same processing session above found `2_Issuer_Transaction_Detailed_Report_Jun_25.XLSX` to have only 32 columns (missing `BookletNumber` and `UNIVERSALPRODUCTCODE`), causing every field from `Merchant` onward to silently shift one position left of where the standard 34-column loader expects it — `TransactionDate` ended up reading raw `TransactionTime` values, producing uniformly bogus dates.

**Cross-checked against this project's own working copy of the same-named file:** all 29 raw files already used throughout this spec — including this exact filename — were re-verified column-by-column and **every one has the standard 34-column layout, Jun'25 included.** This means the 32-column file is a **different physical file that happens to share an identical name**, not a schema variant that also silently affected any of this project's own prior processing. No retroactive corruption risk found in anything already built from this spec.

**Not resolved, because it can't be from data alone:** which file is actually correct/intended for June 2025 wasn't something inspectable from within either processing session — this needs a human decision about which upload is authoritative before any pipeline logic is written around it.

**Separately recommended, regardless of how the file question resolves:** the loader's column-by-fixed-position approach is a real structural risk — any future file with an inserted, deleted, or reordered column would fail exactly this way, silently, with no error thrown. Recommend extending the loader to map columns by header *name* rather than position, as a permanent robustness improvement, not a one-off patch for this single file.

---

## Section 15: May 2026 net activation — row-level duplication found in the pre-Prebuy reference figure (2026-09)

**[CONFIRMED, activation side — redemption side pending independent confirmation]** During Apr'26-Aug'26 batch reconciliation, a separate processing session found a Rs.55.66 Lacs shortfall (activation) and a near-identical Rs.55.59 Lacs shortfall (redemption) between its independently-rebuilt 29-month non-Prebuy total and this spec's documented Rs.8,543.50 Lacs "28mo+Aug" checkpoint. Isolated to May 2026 by direct month-by-month diff against a per-month reference table pulled from this project's own cached build state.

**Root cause, confirmed by direct row-count comparison, not inferred from amount alone:**
| | Row count (Activate-only, non-Prebuy, May 2026) |
|---|---|
| Fresh raw source (`Issuer_Transaction_Detailed_Report_May_26.XLSX`), independently verified 3 separate ways: a fresh from-scratch parse, the separately-cached `amtlookup_Issuer_Transaction_Detailed_Report_May_26.pkl` (built later, during the Jan'26/Prebuy work), and the other processing session's own independent rebuild | **56,246** |
| Cached `activationCube_29mo.pkl` (the source of this spec's Rs.377.49L reference figure) | **66,646** |

**10,400 extra rows in the cached build, zero duplicate `ApprovalCode`s found in the raw source itself** (checked directly) — ruling out source-data duplication and confirming the extra rows were introduced during an earlier processing/merge pass in this project's own pipeline history, not present in the original file. Rs.55.65 Lacs / 10,400 rows is approx Rs.535/row, well within normal gift-card denomination range — consistent with a clean subset of May's real activations being counted twice by whatever merge step introduced this, not anomalous or fabricated data.

**Corrected figure: Rs.321.84 Lacs** (matches the other session's independent verification of Rs.321.86 Lacs to within rounding). The previously-documented Rs.377.49 Lacs for May 2026 does not hold up against the raw source and should not be used as a reference figure going forward.

**Mechanism not fully traced, unlike January's float32 bug (Section 11):** the exact merge/retry step that introduced the 10,400 duplicate rows could not be identified — it predates cached intermediate state still available in this environment. Flagged honestly as an incompletely-diagnosed root cause, unlike Section 11 where the float32 casting line was identified directly.

**Corrected reference table** (supersedes the May 2026 row only; every other month in the original 28mo+Aug table remains valid):
| Month | Old (spec, pre-correction) | New (verified against raw source) |
|---|---|---|
| 2026-05 | Rs.377.49 Lacs | **Rs.321.84 Lacs** |

Corrected 28mo+Aug total: Rs.8,543.50 - Rs.55.65 = **Rs.8,487.85 Lacs** (matches the other session's independently-rebuilt Rs.8,487.84 Lacs almost exactly).

**Downstream figures affected, since Section 8's Prebuy delta and Section 11's January correction were both computed on top of the old, inflated Rs.8,543.50 Lacs base:** every grand total documented in Sections 7, 8, 9, and 11 of this spec that traces back through the "28mo+Aug" checkpoint is now understood to be Rs.55.65-55.66 Lacs too high on the activation side, and by a closely-matching amount on the redemption side pending the confirmation below. **These have NOT yet been corrected in this document** — this section records the finding; a follow-up pass is needed to propagate the fix through every downstream total once the redemption-side mechanism is confirmed (see below), the same way Section 11 waited for full verification before restating the final baseline.

**Outstanding before this can be closed out:** the redemption-side Rs.55.59 Lacs gap has not yet been confirmed to share the same row-duplication mechanism — flagged as a reasonable expectation given the near-identical magnitude and the fact that redemption-side per-card lookups (Denom, ActivationMode) trace back through May 2026's activation data, but not verified directly. Do the same row-count-diff check on the redemption side before treating this as fully resolved.

---

## Explicitly flagged uncertainties (do not treat these as fully confirmed)

1. `QC-MGC-PVR-VAR` and `QC-PVR-VAR` ProgramGroups classified as Digital by inference (Section 3.1), not direct confirmation.
2. The 126 non-Director's-Cut-branded inactive-cinema rows folded into the "Director's Cut" region bucket as an accepted simplification (Section 3.4, Section 5.5) - technically a minor mislabel, knowingly accepted given the tiny magnitude.
3. Format field values not fully deduplicated for near-duplicate labels (e.g. "Royale" vs "Royal") - Section 3.9.
4. Category classifier's ~7% "Other" fallback is an accepted approximation, not exhaustive (Section 3.10).
5. `UniqueCardCount` in the pre-aggregated cubes is exact only for single-bucket queries; treat any multi-period sum of this field with caution pending full migration to the row-level Parquet approach for card-count needs. **[RESOLVED for Card Journey specifically, see Section 8]** — still applies to any other page/chart still summing `UniqueCardCount` from `redemptionCube.json`/`cohortCube.json` across multiple selected periods or dimension values.
6. Section 8's Checkpoint 2 amount figure (₹2,518.98 Lacs) was computed without excluding Cancellation rows from the SUM — this does not match the previously-established net figure (₹1,727.78 Lacs) for what was described as the "same" FY2026-27 same-period cohort in earlier work. The two queries are answering slightly different questions (this section's check summed signed RedemptionAmount across Head='Cancellation' rows too as part of validating the file mechanically, not as a recommended production query). **Before wiring this into the dashboard, confirm which exact convention (net of cancellations vs. gross) the live Card Journey page is meant to use for its amount display, and use the corresponding WHERE/SUM logic** — the card-count fix in this section is verified solid, but the amount-side query pattern shown is illustrative, not yet confirmed against the established ₹1,727.78L baseline.

# Reg E Adjudication Case · case-002-skimmed-card

**Status:** intake → assigned to IRG adjudication
**Disputed amount:** $1,847.62 (across 4 transactions)
**Alleged unauthorized merchants:** various retail / ATM, Bucharest, Romania
**Dates of disputed transactions:** 2026-04-12 (14:22–17:08 UTC)
**Date dispute was filed:** 2026-04-12 18:30 UTC (same day, ~90 minutes after final charge)

---

## Consumer Dispute Form

| Field | Value |
|---|---|
| Consumer | Sam K. |
| Account | Northwind consumer checking · ****8829 |
| Account opened | 2022-06-15 |
| Form submitted | 2026-04-12 18:30 UTC (in-app dispute) |
| Channel | mobile app · authenticated session |

Consumer statement:

> "I'm at home in Seattle. Got four push alerts for charges in Romania in the last three hours totaling about $1,847. My card is in my wallet right now — I have not been out of the country in over a year. I called your fraud line as soon as I saw the alerts. Please freeze the card and refund me."

---

## Transaction Records (internal ledger)

| Timestamp (UTC) | Merchant | MCC | Amount | Auth method | Notes |
|---|---|---|---|---|---|
| 2026-04-12 14:22 | Romanian POS terminal A | 5411 grocery | $312.40 | chip-fallback magstripe | approved |
| 2026-04-12 15:15 | Romanian POS terminal B | 5311 retail | $487.93 | chip-fallback magstripe | approved |
| 2026-04-12 16:32 | ATM cash withdrawal (Bucharest) | 6011 | $500.00 | magstripe | approved |
| 2026-04-12 17:08 | Romanian POS terminal C | 5732 electronics | $547.29 | chip-fallback magstripe | approved |

All four authorizations used the magstripe track; no EMV chip cryptogram or 3DS step-up was presented. The magstripe signature is consistent with a cloned card.

---

## Account Session & Geolocation

- Consumer's authenticated mobile session active 2026-04-12 07:45–09:10 UTC and 18:25–18:35 UTC, both in Seattle, WA.
- No consumer session active during the disputed window (14:22–17:08 UTC).
- All four disputed authorizations geolocated to Bucharest, Romania.

---

## Card History & Skimming Indicators

- Card most recently used 2026-04-08 at a gas-pump terminal in Renton, WA — a known card-skimming vector flagged on the operator's risk feed within the last 30 days.
- Card has no prior international transactions in the 22-month account history.
- Magstripe presentment without EMV cryptogram on a chip-issued card is consistent with magstripe cloning.

---

## Reporting Timeline

| Event | Timestamp (UTC) |
|---|---|
| First unauthorized charge | 2026-04-12 14:22 |
| Last unauthorized charge | 2026-04-12 17:08 |
| Consumer called fraud line | 2026-04-12 17:35 |
| Consumer filed in-app dispute | 2026-04-12 18:30 |
| Card frozen by fraud team | 2026-04-12 17:38 |
| Periodic statement showing these charges | not yet transmitted (charges occurred mid-cycle) |

Reporting interval: **same day** as the disputed transactions; well within two business days of learning of the activity.

---

## Evidence Index

- [E1] Four card-present transactions occurred in Bucharest, Romania on 2026-04-12 between 14:22 and 17:08 UTC, totaling $1,847.62.
- [E2] All four transactions used chip-fallback magstripe authentication with no EMV chip cryptogram, a signature consistent with a magstripe-cloned card.
- [E3] The consumer was geolocated in Seattle, WA throughout the disputed transaction window via authenticated mobile sessions before and after the charges.
- [E4] The consumer's card was used at a known card-skimming vector (a gas pump in Renton, WA) four days before the disputed charges.
- [E5] The consumer has no prior international transactions in the 22-month account history.
- [E6] The consumer reported the disputed charges by phone within 30 minutes of the final charge and filed an in-app dispute within 90 minutes.
- [E7] The card was frozen by the fraud team within 3 minutes of the consumer's phone report.

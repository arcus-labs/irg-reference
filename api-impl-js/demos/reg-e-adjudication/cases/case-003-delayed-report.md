# Reg E Adjudication Case · case-003-delayed-report

**Status:** intake → assigned to IRG adjudication
**Disputed amount:** $3,412.55 (across 7 transactions on three monthly statements)
**Alleged unauthorized activity:** unrecognized online purchases at "ProShop365"
**Date range of disputed transactions:** 2026-01-04 through 2026-03-22
**Date dispute was filed:** 2026-05-29 (74 days after the periodic statement that first reflected the activity)

---

## Consumer Dispute Form

| Field | Value |
|---|---|
| Consumer | Riley T. |
| Account | Northwind consumer checking · ****4408 |
| Account opened | 2021-09-21 |
| Form submitted | 2026-05-29 11:08 UTC (in-app dispute) |
| Channel | mobile app · authenticated session |

Consumer statement:

> "I was going through my old statements and I see a bunch of charges to a 'ProShop365' that I do not recognize. They go back to January. I never signed up for this and I want all of them refunded. I admit I don't open every statement — I had a death in the family in the spring and got behind on paperwork."

---

## Transaction Records (internal ledger)

| Timestamp (UTC) | Merchant | Amount | Auth method | Statement appeared on |
|---|---|---|---|---|
| 2026-01-04 03:11 | ProShop365 | $487.93 | card-not-present, no 3DS | January statement (transmitted 2026-02-01) |
| 2026-01-18 02:42 | ProShop365 | $324.18 | card-not-present, no 3DS | January statement |
| 2026-02-05 04:09 | ProShop365 | $612.40 | card-not-present, no 3DS | February statement (transmitted 2026-03-01) |
| 2026-02-22 03:55 | ProShop365 | $458.71 | card-not-present, no 3DS | February statement |
| 2026-03-08 02:30 | ProShop365 | $397.15 | card-not-present, no 3DS | March statement (transmitted 2026-04-01) |
| 2026-03-15 04:21 | ProShop365 | $578.84 | card-not-present, no 3DS | March statement |
| 2026-03-22 03:48 | ProShop365 | $553.34 | card-not-present, no 3DS | March statement |

All seven transactions used card-not-present authorization without 3DS step-up. No recurring billing token is associated with the merchant in Northwind's tokenization vault — each authorization presented the PAN directly.

---

## Merchant Profile

- ProShop365 (merchant_id PSH-EU-204) is not on Northwind's known-merchant directory.
- Industry threat-intel feed flagged this merchant in 2026-02 as associated with card-not-present fraud rings (post-dates the first two disputed charges).

---

## Account Session & Geolocation

- All seven charges occurred between 02:00 and 04:30 UTC (early-morning Pacific time), outside the consumer's typical session window of 14:00–22:00 UTC.
- No authenticated consumer session was active at the time of any disputed charge.

---

## Customer Account History

- 21 months on file. No prior fraud claims.
- No prior transactions with ProShop365.

---

## Reporting Timeline

| Event | Timestamp |
|---|---|
| First unauthorized charge | 2026-01-04 |
| Periodic statement first reflecting these charges | 2026-02-01 (January statement) |
| Final unauthorized charge | 2026-03-22 |
| Consumer reported (in-app dispute) | 2026-05-29 |
| Business days from first statement to report | **~83 business days** (well beyond the 60-day reporting window for the January statement) |

---

## Evidence Index

- [E1] Seven card-not-present transactions to ProShop365 totaling $3,412.55 were posted to the account between 2026-01-04 and 2026-03-22.
- [E2] None of the seven authorizations carried a 3DS step-up or used a recurring billing token; each presented the PAN directly.
- [E3] All charges occurred between 02:00 and 04:30 UTC, outside the consumer's typical session window.
- [E4] No authenticated consumer session was active at the time of any disputed charge.
- [E5] ProShop365 is not on Northwind's known-merchant directory and was flagged in industry threat-intel as associated with card-not-present fraud rings in 2026-02.
- [E6] The consumer has no prior transactions with ProShop365 in 21 months of account history.
- [E7] The first periodic statement to reflect these charges was transmitted 2026-02-01.
- [E8] The consumer filed the dispute 2026-05-29, which is approximately 83 business days after the institution transmitted the first periodic statement showing the disputed activity (i.e., outside the 60-day reporting window).
- [E9] The consumer's statement attributes the late report to a personal/family circumstance and not to a denial of receiving the periodic statements.

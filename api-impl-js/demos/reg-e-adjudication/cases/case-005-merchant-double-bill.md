# Reg E Adjudication Case · case-005-merchant-double-bill

**Status:** intake → assigned to IRG adjudication
**Disputed amount:** $284.75 (one of two identical charges from the same merchant)
**Alleged error type:** duplicate posting / merchant double-billing
**Date of disputed transaction:** 2026-06-18 (the second posting)
**Date dispute was filed:** 2026-06-19

---

## Consumer Dispute Form

| Field | Value |
|---|---|
| Consumer | Dana L. |
| Account | Northwind consumer checking · ****2204 |
| Account opened | 2025-03-12 |
| Form submitted | 2026-06-19 09:42 UTC |
| Channel | mobile app · authenticated session |

Consumer statement:

> "GreenLeaf Wellness charged me $284.75 twice for the same visit. I only had one appointment on the 17th. I see the same amount posted twice on the 17th and the 18th. I want the second one removed."

---

## Transaction Records (internal ledger)

| Timestamp (UTC) | Merchant | Auth code | Amount | Auth method |
|---|---|---|---|---|
| 2026-06-17 21:14 | GreenLeaf Wellness (merchant_id GLW-US-077) | A1B-77291 | $284.75 | card-present chip + signature |
| 2026-06-18 14:08 | GreenLeaf Wellness (merchant_id GLW-US-077) | A1B-77291 | $284.75 | force-post (same auth code, same amount, no new card presentment) |

The two postings share the same merchant authorization code (`A1B-77291`). The second posting is a **force-post** under the original authorization, not a fresh card presentment. Card-network capture data indicates the merchant submitted the same authorization for settlement twice.

---

## Merchant Profile

- GreenLeaf Wellness is a legitimate healthcare merchant on Northwind's known-merchant directory.
- Northwind's chargeback ops desk records 4 similar duplicate-posting complaints against this merchant in the last 90 days — likely a settlement-batch defect on the merchant's PMS, not fraud.

---

## Customer Account History

- The consumer has 4 prior transactions with GreenLeaf Wellness on this account, each a single posting at typical amounts ($150–$300). No prior duplicate-posting events.

---

## Reporting Timeline

| Event | Timestamp |
|---|---|
| First (legitimate) posting | 2026-06-17 21:14 UTC |
| Duplicate posting | 2026-06-18 14:08 UTC |
| Periodic statement transmitted | 2026-06-19 04:00 UTC |
| Consumer reported (in-app dispute) | 2026-06-19 09:42 UTC |

Business days from statement to report: **same day**.

---

## Evidence Index

- [E1] Two postings of $284.75 each to GreenLeaf Wellness appear on the account, posted 2026-06-17 21:14 UTC and 2026-06-18 14:08 UTC.
- [E2] Both postings share the same merchant authorization code A1B-77291; the second posting was a force-post under the same authorization, not a fresh card presentment.
- [E3] Northwind's chargeback operations has recorded four prior duplicate-posting complaints against GreenLeaf Wellness in the last 90 days, consistent with a merchant-side settlement defect rather than fraud.
- [E4] The consumer acknowledges the first transaction (2026-06-17) as legitimate and is disputing only the duplicate posting (2026-06-18).
- [E5] The consumer has four prior single-posting transactions with this merchant on this account; the duplicate pattern is new.
- [E6] The consumer reported the duplicate posting the same business day the periodic statement reflecting it was transmitted.

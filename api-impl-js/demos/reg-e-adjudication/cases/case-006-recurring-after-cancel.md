# Reg E Adjudication Case · case-006-recurring-after-cancel

**Status:** intake → assigned to IRG adjudication
**Disputed amount:** $89.00 (single recurring debit)
**Alleged unauthorized event:** preauthorized transfer billed after a documented stop-payment order
**Date of disputed transaction:** 2026-09-15
**Date dispute was filed:** 2026-09-16

---

## Consumer Dispute Form

| Field | Value |
|---|---|
| Consumer | Quinn R. |
| Account | Northwind consumer checking · ****3318 |
| Account opened | 2024-08-30 |
| Form submitted | 2026-09-16 08:55 UTC |
| Channel | mobile app · authenticated session |

Consumer statement:

> "I called you on September 8th to stop the FitTrack Premium monthly debit before it ran again on the 15th. I got a confirmation number. Then it ran anyway on the 15th. Please refund me — I asked you to stop it."

---

## Transaction Record (internal ledger)

| Field | Value |
|---|---|
| Timestamp (UTC) | 2026-09-15 13:00:04 |
| Merchant | FitTrack Premium (merchant_id FTP-US-099) |
| Amount | $89.00 |
| Channel | card-not-present, recurring billing token |
| Recurring billing token | tok_4c7e0a91 (active) |
| Network response | approved |

---

## Stop-Payment Order Record

| Field | Value |
|---|---|
| Stop-payment request received | 2026-09-08 16:14 UTC (inbound call to support) |
| Channel | phone, authenticated by knowledge factors |
| Recorded next scheduled billing | 2026-09-15 |
| Stop-payment confirmation code | SP-7711-Q9 |
| Written confirmation requested by institution? | No — institution policy treats oral stop-payment as binding indefinitely |
| Action taken | logged in CSR notes; no flag was set on the recurring billing token |
| Operational defect | the merchant authorization profile in Northwind's recurring-billing engine was not updated; the billing token continued to be eligible for authorization |

The stop-payment request was received **7 calendar days before the scheduled transfer** — more than the required 3-business-day notice.

---

## Customer Account History

- FitTrack Premium has billed $89.00 on the 15th of each month for 14 consecutive months prior to the disputed event. All prior billings are undisputed.
- The consumer has no prior stop-payment requests on this account.

---

## Reporting Timeline

| Event | Timestamp |
|---|---|
| Stop-payment order received | 2026-09-08 16:14 UTC |
| Scheduled billing date | 2026-09-15 |
| Disputed transfer processed | 2026-09-15 13:00 UTC |
| Periodic statement transmitted | 2026-09-16 04:00 UTC |
| Consumer reported (in-app dispute) | 2026-09-16 08:55 UTC |

Business days from statement to report: **same day**.

---

## Evidence Index

- [E1] A recurring debit of $89.00 to FitTrack Premium was processed against the consumer's account on 2026-09-15 via recurring billing token tok_4c7e0a91.
- [E2] The consumer placed a stop-payment order by phone on 2026-09-08, seven calendar days before the scheduled transfer, and received confirmation code SP-7711-Q9.
- [E3] Northwind's institution policy treats an oral stop-payment order as binding without requiring written confirmation.
- [E4] Despite the recorded stop-payment order, Northwind's recurring-billing engine did not flag the token, and the disputed transfer was authorized — an operational defect on Northwind's side, not a merchant error.
- [E5] FitTrack Premium had billed the same $89.00 on the same monthly schedule for 14 prior months, all undisputed.
- [E6] The consumer reported the disputed transfer the same business day the periodic statement reflecting it was transmitted.

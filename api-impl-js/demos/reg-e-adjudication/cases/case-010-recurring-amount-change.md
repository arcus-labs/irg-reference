# Reg E Adjudication Case · case-010-recurring-amount-change

**Status:** intake → assigned to IRG adjudication
**Disputed amount:** $30.00 (the excess portion of an otherwise-authorized recurring debit)
**Alleged event:** preauthorized recurring debit billed at a higher amount than previously, without the advance notice required for amounts that vary
**Date of disputed transaction:** 2027-01-10
**Date dispute was filed:** 2027-01-11

---

## Consumer Dispute Form

| Field | Value |
|---|---|
| Consumer | Devon S. |
| Account | Northwind consumer checking · ****1156 |
| Account opened | 2024-05-02 |
| Form submitted | 2027-01-11 07:30 UTC |
| Channel | mobile app · authenticated session |

Consumer statement:

> "My monthly Riverstone Gym debit has been $39.00 for the last 18 months. This month they took $69.00 — that's $30 more than usual. I never got any notice that the price was going up. I want the extra $30 back."

---

## Transaction Record (internal ledger)

| Field | Value |
|---|---|
| Timestamp (UTC) | 2027-01-10 12:00:11 |
| Merchant | Riverstone Gym (merchant_id RSG-US-066) |
| Amount | $69.00 |
| Channel | card-not-present, recurring billing token |
| Recurring billing token | tok_2f88aa31 (active since 2025-07-10) |
| Authorization context | recurring billing under existing token; amount of authorization (.../$69.00) differs from prior recurring amount of $39.00 |

---

## Recurring Billing History

| Cycle | Date | Amount |
|---|---|---|
| 1–18 | monthly, 2025-07-10 through 2026-12-10 | $39.00 (consistent) |
| 19 | 2027-01-10 | **$69.00** (the disputed amount) |

---

## Merchant-Side Notice Record

- Northwind has no record of receiving an advance amount-change notice from Riverstone Gym for tok_2f88aa31.
- Consumer's email history (provided to support during follow-up) shows no merchant email referencing a price change between the prior billing date (2026-12-10) and the disputed billing date (2027-01-10).
- Riverstone Gym's public price page was updated on 2026-12-22 to show "$69 per month effective 2027-01-10" (per the consumer's screenshot, attached to the dispute) but no individual-customer notice was sent.
- Reg E §1005.10(d) requires the institution OR the designated payee to give the consumer reasonable advance notice (at least 10 days before the scheduled transfer) when a preauthorized transfer will vary in amount from the previous transfer. The notice on file does not satisfy this requirement.

---

## Reporting Timeline

| Event | Timestamp |
|---|---|
| Last prior recurring billing at $39.00 | 2026-12-10 |
| Disputed recurring billing at $69.00 | 2027-01-10 12:00 UTC |
| Periodic statement transmitted | 2027-01-11 04:00 UTC |
| Consumer reported (in-app dispute) | 2027-01-11 07:30 UTC |

Business days from statement to report: **same day**.

---

## Evidence Index

- [E1] On 2027-01-10 the consumer's account was debited $69.00 by Riverstone Gym under recurring billing token tok_2f88aa31.
- [E2] The same recurring token billed $39.00 monthly for the 18 prior cycles, without dispute.
- [E3] Northwind has no record of receiving an advance amount-change notice from Riverstone Gym for this token.
- [E4] The consumer's email history between 2026-12-10 and 2027-01-10 contains no merchant email referencing the price change.
- [E5] Riverstone Gym posted a price change on its public site on 2026-12-22, but no individual-customer notice was sent — short of the 10-day advance individual notice required for varying preauthorized transfer amounts under §1005.10(d).
- [E6] The consumer's objection is to the **excess $30.00** above the previously-authorized $39.00 recurring amount, not to the underlying $39.00 portion.
- [E7] The consumer reported the disputed billing the same business day the periodic statement reflecting it was transmitted.

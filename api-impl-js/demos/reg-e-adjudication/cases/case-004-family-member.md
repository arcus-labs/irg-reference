# Reg E Adjudication Case · case-004-family-member

**Status:** intake → assigned to IRG adjudication
**Disputed amount:** $1,290.00 (single transaction)
**Alleged unauthorized merchant:** SoundCraft Audio
**Date of disputed transaction:** 2026-07-09
**Date dispute was filed:** 2026-07-12

---

## Consumer Dispute Form

| Field | Value |
|---|---|
| Consumer | Morgan A. |
| Account | Northwind consumer checking · ****6611 |
| Account opened | 2023-02-08 |
| Form submitted | 2026-07-12 19:21 UTC |
| Channel | mobile app · authenticated session |

Consumer statement:

> "There's a $1,290 charge to SoundCraft Audio that I did not authorize. I think someone got my card info. I want a refund."

Consumer additional statement (provided during phone follow-up):

> "Well… my husband says he made the purchase. He used my card because his was being replaced. But I never told him he could spend that much without asking me. So I want to dispute it anyway."

---

## Transaction Record (internal ledger)

| Field | Value |
|---|---|
| Timestamp (UTC) | 2026-07-09 16:47:14 |
| Merchant | SoundCraft Audio (merchant_id SCA-US-118) |
| Amount | $1,290.00 |
| Channel | card-present, in-store |
| Auth method | EMV chip + PIN |
| 3DS step-up | not applicable (card-present) |
| Posting | 2026-07-09 23:15 UTC |

---

## Authorization Context

- The transaction was authorized by an EMV chip + correct PIN entry. The PIN matches the PIN on file for the consumer's account.
- Northwind's records show one supplemental cardholder on the account: **Casey A.**, listed since 2024-11-02, relationship: "spouse." Both the consumer and Casey A. have access credentials.
- The supplemental cardholder Casey A. requested a new physical card on 2026-07-01 due to wear. Replacement card was shipped 2026-07-02 and not yet activated at the time of the disputed transaction.

---

## Customer Account History

- 41 months on file. No prior fraud claims.
- Shared account use is established: the supplemental cardholder Casey A. has made an average of 3.5 transactions per month for the past 18 months.
- Prior transactions at audio-equipment merchants by either cardholder: zero. (The category itself is new for this account.)

---

## Consumer Acknowledgments (intake notes)

- During the phone follow-up, the consumer acknowledged that:
  - Casey A. is a supplemental cardholder with active access.
  - Casey A. has used the consumer's card with the consumer's knowledge on prior occasions because his replacement card has not arrived.
  - The consumer did not place a spending cap on the supplemental card.
  - The consumer's objection is to the AMOUNT and to not having been consulted beforehand — not to Casey A. having access.

---

## Reporting Timeline

| Event | Timestamp |
|---|---|
| Disputed transaction | 2026-07-09 16:47 UTC |
| Periodic statement transmitted | 2026-07-10 04:00 UTC |
| Consumer reported (in-app dispute) | 2026-07-12 19:21 UTC |

Business days from statement to report: **2** — well within the 60-day reporting window.

---

## Evidence Index

- [E1] A $1,290.00 transaction to SoundCraft Audio was processed 2026-07-09 16:47 UTC via EMV chip + PIN at a card-present terminal.
- [E2] The PIN used to authorize the transaction matches the PIN on file for the consumer's account.
- [E3] Northwind's records show a supplemental cardholder (Casey A., relationship "spouse") on the consumer's account since 2024-11-02 with full transaction privileges and no spending cap.
- [E4] The supplemental cardholder has made approximately 3.5 transactions per month on this account for the past 18 months — established shared use.
- [E5] The consumer acknowledged during phone follow-up that the supplemental cardholder, with the consumer's knowledge, used the card because his replacement card had not yet arrived.
- [E6] The consumer's objection is to the amount of the transaction and to not having been consulted beforehand, not to the supplemental cardholder having authority to use the card.
- [E7] The consumer reported the disputed transaction within 2 business days of the periodic statement.

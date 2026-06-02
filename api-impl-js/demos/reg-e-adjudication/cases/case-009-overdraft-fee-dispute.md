# Reg E Adjudication Case · case-009-overdraft-fee-dispute

**Status:** intake → assigned to IRG adjudication
**Disputed amount:** $35.00 (institution-charged overdraft fee)
**Alleged event:** consumer disputes an overdraft fee assessed by Northwind
**Date of fee assessment:** 2026-12-03
**Date dispute was filed:** 2026-12-03

---

## Consumer Dispute Form

| Field | Value |
|---|---|
| Consumer | Jamie F. |
| Account | Northwind consumer checking · ****8870 |
| Account opened | 2025-01-20 |
| Form submitted | 2026-12-03 15:44 UTC |
| Channel | mobile app · authenticated session |

Consumer statement:

> "Northwind charged me $35 for going overdrawn by $4.20. I did not authorize this fee. I never agreed to be charged $35. This is unauthorized — I want it refunded under Reg E."

---

## Fee Posting Record (internal ledger)

| Field | Value |
|---|---|
| Timestamp (UTC) | 2026-12-03 02:00 |
| Item | NSF / overdraft fee, paid-item |
| Amount | $35.00 |
| Triggering transaction | $42.18 ACH debit to PowerCo (utility), 2026-12-02 19:11 UTC |
| Account balance at time of triggering transaction | $37.98 |
| Resulting balance | −$4.20 + $35.00 fee = −$39.20 |

---

## Disclosures & Opt-in Status

- Consumer opted in to overdraft coverage for ATM and one-time debit-card transactions on 2025-01-20 (Reg E §1005.17 opt-in form, signed at account opening, on file).
- Standard NSF/overdraft fee schedule for ACH and check transactions is disclosed in the account-opening agreement at $35 per paid item, with a maximum of three per day. The consumer e-signed the agreement on 2025-01-20.
- The triggering transaction was an ACH debit (preauthorized utility payment), not an ATM or one-time debit-card transaction.

---

## Reporting Timeline

| Event | Timestamp |
|---|---|
| Triggering ACH posted | 2026-12-02 19:11 UTC |
| Overdraft fee posted | 2026-12-03 02:00 UTC |
| Consumer reported (in-app dispute) | 2026-12-03 15:44 UTC |

---

## Scope Note (out-of-band observation for the adjudicator)

This dispute concerns an **institution-assessed fee**, not an electronic fund transfer initiated by a third party or by the consumer. The Regulation E definition of an "unauthorized electronic fund transfer" under §1005.2(m) applies to transfers from a consumer's account initiated by a person other than the consumer without actual authority. A fee charged by the institution itself, pursuant to a disclosed fee schedule the consumer accepted at account opening, does not fall within that definition. Reg E §1005.17 governs the consumer's opt-in for overdraft coverage on ATM and one-time debit-card transactions; here the triggering transaction was a preauthorized ACH debit, for which the institution's fee disclosure (not Reg E opt-in) governs.

---

## Evidence Index

- [E1] Northwind assessed a $35.00 NSF/overdraft fee on the consumer's account on 2026-12-03 02:00 UTC.
- [E2] The fee was triggered by a $42.18 ACH debit to PowerCo (a preauthorized utility payment) on 2026-12-02 19:11 UTC, when the account balance was $37.98.
- [E3] Northwind's standard NSF/overdraft fee schedule was disclosed in the account-opening agreement and e-signed by the consumer on 2025-01-20.
- [E4] The consumer opted in to overdraft coverage for ATM and one-time debit-card transactions on 2025-01-20 (§1005.17), but that opt-in is not applicable here because the triggering transaction was an ACH debit.
- [E5] The triggering ACH debit was the consumer's own preauthorized utility payment; it was not initiated by a third party.
- [E6] The disputed item is an institution-assessed fee, not an electronic fund transfer initiated by a person other than the consumer.
- [E7] The consumer's claim invokes Reg E "unauthorized" framing, but the fact pattern (institution-assessed fee per a disclosed schedule) is outside the §1005.2(m) definition of an unauthorized EFT.

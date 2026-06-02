# Reg E Adjudication Case · case-008-remittance-wrong-account

**Status:** intake → assigned to IRG adjudication (Subpart B — remittance transfer)
**Disputed amount:** $500.00 (international remittance)
**Alleged error type:** funds delivered to the wrong recipient account due to a sender-input error
**Date of disputed transaction:** 2026-11-05 18:32 UTC
**Date dispute was filed:** 2026-11-07 (~37 hours after the transfer)

---

## Consumer Dispute Form

| Field | Value |
|---|---|
| Consumer (sender) | Priya N. |
| Account | Northwind consumer checking · ****0042 |
| Account opened | 2024-04-10 |
| Form submitted | 2026-11-07 08:15 UTC |
| Channel | mobile app · authenticated session |

Consumer statement:

> "I sent $500 to my mother in India and I just realized I entered the wrong account number — I transposed two digits at the end. The funds went to someone else's account. Please help me recover the money."

---

## Remittance Transfer Record (internal ledger)

| Field | Value |
|---|---|
| Timestamp (UTC) | 2026-11-05 18:32 |
| Send amount | $500.00 |
| Total fees | $4.99 |
| Total sent | $504.99 |
| Recipient designated by sender | "Anjali N." · IBAN INXXXX-…-**7421** |
| Recipient account number that received funds | INXXXX-…-7421 (matches sender's input — the input was wrong, the transfer was executed correctly per the input) |
| Disclosure delivered to sender | yes (prepayment + receipt disclosures per §1005.31) |
| Disclosed date of availability | 2026-11-06 |
| Cancellation window (per §1005.34) | expired 2026-11-05 19:02 (30 minutes after payment) |

---

## Tokenization and Address Book

- Sender's address book has an entry for "Mom — Anjali N." with IBAN ending in **7412** (not 7421).
- The IBAN actually entered into the disputed transfer was **7421** — two digits transposed at the end relative to the address-book entry.
- The receiving bank's record (returned upon investigation request) shows the funds were credited to an unrelated account in the name "Anika M."

---

## Reporting Timeline

| Event | Timestamp |
|---|---|
| Remittance transfer initiated | 2026-11-05 18:32 UTC |
| Cancellation window closed (§1005.34, 30 minutes) | 2026-11-05 19:02 UTC |
| Disclosed date of availability | 2026-11-06 |
| Consumer reported the error | 2026-11-07 08:15 UTC |
| Days since disclosed date of availability | **1** (well within 180 days per §1005.33) |

---

## Evidence Index

- [E1] A remittance transfer of $500.00 (plus $4.99 in fees) was initiated 2026-11-05 18:32 UTC, designated to IBAN ending in 7421.
- [E2] The sender's saved address-book entry for the intended recipient ("Mom — Anjali N.") lists IBAN ending in **7412**, not 7421 — two trailing digits transposed.
- [E3] The receiving bank's record shows the funds were credited to an account in the name "Anika M.," not the consumer's intended recipient.
- [E4] Northwind delivered the prepayment and receipt disclosures required by §1005.31, including the cancellation right under §1005.34.
- [E5] The 30-minute cancellation window under §1005.34(a) closed at 2026-11-05 19:02 UTC. The consumer did not request cancellation within that window.
- [E6] The consumer reported the error 2026-11-07 08:15 UTC — within one day of the disclosed date of availability and well inside the 180-day window for remittance-transfer error reporting under §1005.33.
- [E7] The error is a sender-input mistake (transposed digits), not a misdirection by the institution or the receiving bank. Reg E §1005.33 governs the institution's investigation and remedy obligations in this scenario.
